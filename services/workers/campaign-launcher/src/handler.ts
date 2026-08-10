import {
  DynamoCampaignRepository,
  DynamoContactRepository,
  DynamoSuppressionRepository,
  SecretsProvider,
  Sha256EmailHasher,
  SqsSendQueuePublisher,
  SystemClock,
  calcularSendId,
  dynamoDoc,
  secrets,
  sqs,
} from '@emailmkt/adapters-aws';
import {
  aplicarSelecaoIndividual,
  campaignId as novoCampaignId,
  iniciarEnvio,
  resolverAudiencia,
  sendId as novoSendId,
  tenantId as novoTenantId,
  todos,
  type Contact,
} from '@emailmkt/core';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'campaign-launcher', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

export interface EntradaLauncher {
  readonly tenantId: string;
  readonly campaignId: string;
}

export interface SaidaLauncher {
  readonly campaignId: string;
  readonly enfileirados: number;
  readonly excluidos: { total: number; porMotivo: Record<string, number> };
}

/**
 * Resolve a audiência e enfileira o disparo — §2.2 e ADR-05.
 *
 * Invocado pelo Step Functions, que cuida de retomada e do histórico de
 * execução. O snapshot da audiência é imutável (§6.2, nota 4): a campanha envia
 * para quem estava elegível no momento do disparo, não para uma consulta
 * reavaliada a cada mensagem. É isso que torna o disparo determinístico e
 * permite retomar de onde parou sem enviar duplicado.
 */
export const handler = async (entrada: EntradaLauncher): Promise<SaidaLauncher> => {
  const tabela = env('TABELA_PRINCIPAL');
  const doc = dynamoDoc();

  const segredo = await new SecretsProvider(secrets()).ler(env('SEGREDO_HMAC_ARN'));
  const hasher = new Sha256EmailHasher(segredo);

  const campanhas = new DynamoCampaignRepository(doc, tabela);
  const contatos = new DynamoContactRepository(doc, tabela, hasher);
  const supressao = new DynamoSuppressionRepository(doc, tabela);
  const fila = new SqsSendQueuePublisher(sqs(), env('FILA_ENVIO'));
  const clock = new SystemClock();

  const tenantId = novoTenantId(entrada.tenantId);
  const campaignId = novoCampaignId(entrada.campaignId);

  const campanha = await campanhas.buscarPorId(tenantId, campaignId);
  if (campanha === null) throw new Error(`Campanha inexistente: ${entrada.campaignId}`);

  /**
   * Só dispara campanha pronta para sair.
   *
   * RASCUNHO (disparo imediato) e AGENDADA (disparo no horário) são os pontos de
   * partida válidos. A admin-api já valida a transição, mas esta função é
   * invocável pelo Step Functions e por um agendamento que pode ter sido
   * cancelado; recusar aqui evita disparar uma campanha já cancelada.
   */
  if (campanha.status !== 'RASCUNHO' && campanha.status !== 'AGENDADA') {
    throw new Error(
      `Campanha ${entrada.campaignId} está em ${campanha.status}; só RASCUNHO ou AGENDADA pode disparar.`,
    );
  }

  const audiencia = await resolverAudiencia(
    { contatos, supressao, hasher, clock },
    {
      tenantId,
      listId: campanha.listId,
      segmento: todos<Contact>(),
      incluirLeads: campanha.incluirLeads ?? false,
      tagsFiltro: campanha.tagsFiltro ?? [],
    },
  );

  // Seleção individual: se o operador desmarcou contatos na Etapa 3, o disparo
  // vai só para os escolhidos. **Ausente e vazio são coisas diferentes.**
  //
  // Tratar os dois como "todos" era um caminho para o pior erro que este sistema
  // pode cometer. Quem clicasse em "Desmarcar todos" gravava uma lista vazia, e
  // o disparo saía para a lista inteira — com a tela mostrando "0 destinatários"
  // no resumo, e sem volta depois que a mensagem sai.
  //
  // Ausente segue significando "todos os elegíveis". Vazio significa vazio, e
  // interrompe antes de enfileirar: é estado inválido, não instrução.
  const selecionados = campanha.destinatariosSelecionados;
  if (selecionados !== undefined && selecionados.length === 0) {
    throw new Error(
      `Campanha ${entrada.campaignId} tem seleção de destinatários vazia. ` +
        'Nenhum contato foi escolhido na Etapa 3; nada foi enviado.',
    );
  }

  const elegiveis = aplicarSelecaoIndividual(audiencia.elegiveis, selecionados);

  // O resumo de exclusões não é enfeite: numa primeira importação, é provável
  // que a maior parte esteja travada por falta de classificação de
  // relacionamento (§6.2). Sem este número, o operador vê "1.200 de 5.000" e
  // não sabe se a lista está saudável.
  log('INFO', 'audiência resolvida', {
    campaignId: entrada.campaignId,
    elegiveis: elegiveis.length,
    resolvidosAntesDaSelecao: audiencia.elegiveis.length,
    excluidos: audiencia.excluidos.total,
    porMotivo: audiencia.excluidos.porMotivo,
  });

  const mensagens = elegiveis.map((contato) => ({
    tenantId,
    // Determinístico: se o enfileiramento for repetido após uma falha, o mesmo
    // par campanha+contato gera o mesmo sendId e a idempotência barra o
    // duplicado no `sender` (§5.4).
    sendId: novoSendId(calcularSendId(campaignId, contato.contactId)),
    campaignId,
    contactId: contato.contactId,
  }));

  await fila.publicarLote(mensagens);

  // Transição validada pelo domínio, que também carimba `disparadaEm` (auditoria
  // do disparo). O total enfileirado é somado por cima, para o painel mostrar
  // "processados de N".
  const emEnvio = iniciarEnvio(campanha, clock.agora());
  if (!emEnvio.ok) {
    throw new Error(
      `Não foi possível iniciar o envio da campanha ${entrada.campaignId}: ${emEnvio.error.message}`,
    );
  }
  await campanhas.salvar({ ...emEnvio.value, totalDestinatarios: mensagens.length });

  log('INFO', 'campanha enfileirada', {
    campaignId: entrada.campaignId,
    enfileirados: mensagens.length,
  });

  return {
    campaignId: entrada.campaignId,
    enfileirados: mensagens.length,
    excluidos: {
      total: audiencia.excluidos.total,
      porMotivo: { ...audiencia.excluidos.porMotivo },
    },
  };
};
