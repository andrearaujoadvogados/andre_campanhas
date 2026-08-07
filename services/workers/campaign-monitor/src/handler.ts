import {
  DynamoAuditLogger,
  DynamoCampaignRepository,
  DynamoSendRepository,
  UuidGenerator,
  dynamoDoc,
} from '@emailmkt/adapters-aws';
import {
  campaignId as novoCampaignId,
  concluir,
  decidirProgresso,
  tenantId as novoTenantId,
  userId,
  type DecisaoProgresso,
} from '@emailmkt/core';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'campaign-monitor', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

export interface EntradaMonitor {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly enfileirados: number;
  /** ISO. Vem do estado do Step Functions, não do relógio local. */
  readonly iniciadoEm: string;
}

export interface SaidaVerificacao extends EntradaMonitor {
  readonly decisao: DecisaoProgresso['acao'];
  readonly esperarSegundos: number;
  readonly processados: number;
  readonly motivo?: string;
}

/**
 * Verifica o progresso de um disparo — o passo que o orquestrador chama em laço.
 *
 * Devolve o estado inteiro de volta, não só a decisão: o Step Functions passa a
 * saída de um passo como entrada do próximo, e reconstruir `enfileirados` e
 * `iniciadoEm` a cada volta exigiria consultá-los de novo. Repassar é mais
 * barato e mantém o laço sem estado externo.
 */
export const verificar = async (entrada: EntradaMonitor): Promise<SaidaVerificacao> => {
  const doc = dynamoDoc();
  const tabela = env('TABELA_PRINCIPAL');

  const tenantId = novoTenantId(entrada.tenantId);
  const campaignId = novoCampaignId(entrada.campaignId);

  const campanhas = new DynamoCampaignRepository(doc, tabela);
  const envios = new DynamoSendRepository(doc, tabela);

  const [statusCampanha, processados] = await Promise.all([
    campanhas.lerStatus(tenantId, campaignId),
    envios.contarPorCampanha(tenantId, campaignId),
  ]);

  const decorridoSegundos = Math.max(
    0,
    Math.floor((Date.now() - new Date(entrada.iniciadoEm).getTime()) / 1000),
  );

  const decisao = decidirProgresso({
    statusCampanha,
    esperados: entrada.enfileirados,
    processados,
    decorridoSegundos,
  });

  log('INFO', 'progresso verificado', {
    campaignId: entrada.campaignId,
    statusCampanha,
    processados,
    esperados: entrada.enfileirados,
    decorridoSegundos,
    decisao: decisao.acao,
  });

  return {
    ...entrada,
    decisao: decisao.acao,
    esperarSegundos: decisao.acao === 'AGUARDAR' ? decisao.esperarSegundos : 0,
    processados,
    ...('motivo' in decisao ? { motivo: decisao.motivo } : {}),
  };
};

export interface EntradaFinalizacao extends EntradaMonitor {
  readonly processados: number;
  readonly motivo?: string;
}

/**
 * Marca a campanha como concluída e registra a auditoria do disparo.
 *
 * Tolera a campanha já estar em estado final: o Step Functions pode reexecutar
 * um passo após uma falha transitória, e falhar aqui deixaria a execução em erro
 * por causa de um trabalho que já foi feito.
 */
export const finalizar = async (
  entrada: EntradaFinalizacao,
): Promise<{ campaignId: string; status: string; ressalva?: string }> => {
  const doc = dynamoDoc();
  const tabela = env('TABELA_PRINCIPAL');

  const tenantId = novoTenantId(entrada.tenantId);
  const campaignId = novoCampaignId(entrada.campaignId);

  const campanhas = new DynamoCampaignRepository(doc, tabela);
  const auditoria = new DynamoAuditLogger(doc, tabela, new UuidGenerator());

  const campanha = await campanhas.buscarPorId(tenantId, campaignId);
  if (campanha === null) {
    log('ERROR', 'campanha sumiu antes da finalização', { campaignId: entrada.campaignId });
    return { campaignId: entrada.campaignId, status: 'INEXISTENTE' };
  }

  const resultado = concluir(campanha);
  if (resultado.ok) {
    await campanhas.salvar(resultado.value);
  } else {
    // Transição inválida significa que a campanha já saiu de ENVIANDO — foi
    // cancelada ou concluída por outra execução. Não é erro do disparo.
    log('INFO', 'campanha já estava em estado final', {
      campaignId: entrada.campaignId,
      status: campanha.status,
    });
  }

  await auditoria.registrar({
    tenantId,
    userId: userId('sistema:orquestrador'),
    acao: 'ENVIOU',
    recursoTipo: 'Campaign',
    recursoId: entrada.campaignId,
    depois: {
      enfileirados: entrada.enfileirados,
      processados: entrada.processados,
      ressalva: entrada.motivo,
    },
    ocorridoEm: new Date(),
  });

  log('INFO', 'campanha finalizada', {
    campaignId: entrada.campaignId,
    enfileirados: entrada.enfileirados,
    processados: entrada.processados,
    ressalva: entrada.motivo,
  });

  return {
    campaignId: entrada.campaignId,
    status: resultado.ok ? 'CONCLUIDA' : campanha.status,
    ...(entrada.motivo === undefined ? {} : { ressalva: entrada.motivo }),
  };
};
