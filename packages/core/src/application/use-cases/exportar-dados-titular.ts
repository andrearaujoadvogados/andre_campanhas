import type { Contact } from '../../domain/contact/contact.js';
import type { EventoEnvio, StatusEnvio } from '../../domain/send/envio.js';
import type { ContactId, TenantId } from '../../domain/shared/ids.js';
import type { Clock, ContactRepository, EventRepository, SendRepository } from '../ports/index.js';

/**
 * Dossiê do titular — direito de acesso e de portabilidade (LGPD, art. 18, II e V).
 *
 * O art. 19 exige formato "de uso comum e leitura automática". Não basta um PDF
 * bonito: a pessoa tem de conseguir levar os dados para outro lugar. Daí a
 * estrutura ser plana e explícita, com nomes que se explicam sozinhos.
 *
 * O que **não** entra aqui é tão importante quanto o que entra: nenhum hash de
 * supressão de terceiros, nenhum identificador interno de outro contato, nenhuma
 * métrica agregada de campanha. O dossiê responde "o que vocês têm sobre mim",
 * não "o que vocês têm".
 */
export interface DossieTitular {
  readonly geradoEm: string;
  readonly aviso: string;
  readonly identificacao: {
    readonly contactId: string;
    readonly email: string;
    readonly nome?: string;
    readonly camposAdicionais: Readonly<Record<string, string>>;
  };
  readonly situacao: {
    readonly status: string;
    readonly significado: string;
    readonly cadastradoEm: string;
    readonly atualizadoEm: string;
    readonly origemDoCadastro: string;
  };
  readonly baseLegalDoTratamento: {
    readonly base: string;
    readonly significado: string;
    readonly finalidade: string;
    readonly vinculoDeclarado: string;
    readonly vinculoDesde?: string;
    readonly evidencia: string;
    readonly origemDeclarada: string;
    readonly versaoDoTesteDeBalanceamento: string;
    readonly registradoEm: string;
  } | null;
  readonly comunicacoesRecebidas: readonly ComunicacaoExportada[];
  readonly comoExercerSeusDireitos: readonly string[];
}

export interface ComunicacaoExportada {
  readonly campanha: string;
  readonly situacao: string;
  readonly enviadoEm: string | null;
  readonly historico: readonly {
    readonly evento: string;
    readonly quando: string;
    readonly detalhe?: string;
  }[];
}

export interface DepsExportacao {
  readonly contatos: ContactRepository;
  readonly envios: SendRepository;
  readonly eventos: EventRepository;
  readonly clock: Clock;
}

const SIGNIFICADO_STATUS: Readonly<Record<string, string>> = {
  ATIVO: 'Você está apto a receber comunicações.',
  DESCADASTRADO: 'Você pediu para não receber mais e-mails e não está recebendo.',
  OPOSICAO: 'Você se opôs ao tratamento dos seus dados; o pedido está registrado.',
  BOUNCE: 'Seu endereço foi recusado permanentemente pelo servidor de e-mail; não enviamos mais.',
  RECLAMACAO: 'Uma mensagem nossa foi marcada como spam; não enviamos mais.',
  SUPRIMIDO: 'Seu endereço foi bloqueado para envios.',
};

const SIGNIFICADO_BASE: Readonly<Record<string, string>> = {
  LEGITIMO_INTERESSE:
    'Legítimo interesse (art. 7º, IX, da LGPD): tratamos seus dados por causa do vínculo declarado abaixo, e não por consentimento.',
  CONSENTIMENTO: 'Consentimento (art. 7º, I, da LGPD): você autorizou expressamente o tratamento.',
  EXECUCAO_CONTRATO: 'Execução de contrato (art. 7º, V, da LGPD).',
};

const SIGNIFICADO_ENVIO: Readonly<Record<StatusEnvio, string>> = {
  PENDENTE: 'Preparado, ainda não enviado.',
  ENVIADO: 'Enviado ao servidor de e-mail.',
  ENTREGUE: 'Entregue na sua caixa.',
  FALHOU: 'Não foi possível entregar.',
  SUPRIMIDO: 'Não enviado porque seu endereço estava bloqueado.',
  CANCELADO: 'Cancelado antes do envio.',
};

const NOME_EVENTO: Readonly<Record<EventoEnvio['tipo'], string>> = {
  SEND: 'Enviado',
  DELIVERY: 'Entregue',
  OPEN: 'Aberto',
  CLICK: 'Link clicado',
  BOUNCE: 'Devolvido pelo servidor',
  COMPLAINT: 'Marcado como spam',
  REJECT: 'Recusado antes do envio',
  RENDERING_FAILURE: 'Falha ao montar a mensagem',
  DELIVERY_DELAY: 'Entrega atrasada',
  RESPOSTA: 'Você respondeu a este e-mail',
};

const DIREITOS = [
  'Corrigir dados incorretos: responda a qualquer e-mail do escritório informando a correção.',
  'Parar de receber e-mails: use o link de descadastro presente em todas as mensagens.',
  'Opor-se ao tratamento dos seus dados (art. 18, §2º): use a segunda opção da página de descadastro.',
  'Solicitar a eliminação dos seus dados (art. 18, VI): peça ao encarregado de dados do escritório.',
  'Ao eliminarmos seus dados, mantemos apenas um código irreversível do seu e-mail, para garantir que uma futura importação de lista não volte a incluir você.',
];

/**
 * Monta o dossiê.
 *
 * Devolve `null` se o contato não existe — quem chama decide o que responder.
 * Diferenciar "não existe" de "não autorizado" aqui seria expor, a quem
 * perguntasse, se um endereço está ou não na base.
 */
export async function montarDossieTitular(
  deps: DepsExportacao,
  entrada: { tenantId: TenantId; contactId: ContactId },
): Promise<DossieTitular | null> {
  const contato = await deps.contatos.buscarPorId(entrada.tenantId, entrada.contactId);
  if (contato === null) return null;

  const envios = await deps.envios.listarPorContato(entrada.tenantId, entrada.contactId);

  const comunicacoes = await Promise.all(
    envios.map(async (envio): Promise<ComunicacaoExportada> => {
      const eventos = await deps.eventos.listarPorEnvio(entrada.tenantId, envio.sendId);
      return {
        campanha: String(envio.campaignId),
        situacao: SIGNIFICADO_ENVIO[envio.status],
        enviadoEm: envio.enviadoEm?.toISOString() ?? null,
        historico: eventos
          .slice()
          .sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime())
          .map((e) => ({
            evento: NOME_EVENTO[e.tipo],
            quando: e.ocorridoEm.toISOString(),
            ...(e.urlClicada === undefined ? {} : { detalhe: e.urlClicada }),
          })),
      };
    }),
  );

  return {
    geradoEm: deps.clock.agora().toISOString(),
    aviso:
      'Este arquivo reúne todos os dados que o escritório mantém sobre você neste sistema de comunicação por e-mail. ' +
      'Ele não inclui informações de processos, contratos ou outros sistemas do escritório.',
    identificacao: {
      contactId: String(contato.contactId),
      email: contato.email.value,
      ...(contato.nome === undefined ? {} : { nome: contato.nome }),
      camposAdicionais: contato.camposCustomizados,
    },
    situacao: {
      status: contato.status,
      significado: SIGNIFICADO_STATUS[contato.status] ?? 'Situação não catalogada.',
      cadastradoEm: contato.criadoEm.toISOString(),
      atualizadoEm: contato.atualizadoEm.toISOString(),
      origemDoCadastro: contato.origem,
    },
    baseLegalDoTratamento: montarBaseLegal(contato),
    comunicacoesRecebidas: comunicacoes,
    comoExercerSeusDireitos: DIREITOS,
  };
}

function montarBaseLegal(contato: Contact): DossieTitular['baseLegalDoTratamento'] {
  const b = contato.baseLegal;
  if (b === undefined) return null;

  return {
    base: b.base,
    significado: SIGNIFICADO_BASE[b.base] ?? 'Base legal não catalogada.',
    finalidade: b.finalidade,
    vinculoDeclarado: contato.relacionamento,
    ...(contato.relacionamentoDesde === undefined
      ? {}
      : { vinculoDesde: contato.relacionamentoDesde.toISOString() }),
    evidencia: b.evidenciaRelacionamento,
    origemDeclarada: b.origemDeclarada,
    versaoDoTesteDeBalanceamento: b.liaVersao,
    registradoEm: b.registradoEm.toISOString(),
  };
}

/**
 * Versão CSV do histórico de comunicações.
 *
 * O JSON é completo; o CSV existe porque planilha é o "formato de uso comum"
 * que a maioria das pessoas consegue abrir de fato. Exportar só JSON atenderia
 * a letra do art. 19 e falharia no propósito.
 */
export function dossieParaCsv(dossie: DossieTitular): string {
  const linhas: string[] = ['campanha;situacao;enviado_em;evento;quando;detalhe'];

  for (const c of dossie.comunicacoesRecebidas) {
    if (c.historico.length === 0) {
      linhas.push(csv([c.campanha, c.situacao, c.enviadoEm ?? '', '', '', '']));
      continue;
    }
    for (const h of c.historico) {
      linhas.push(
        csv([c.campanha, c.situacao, c.enviadoEm ?? '', h.evento, h.quando, h.detalhe ?? '']),
      );
    }
  }

  // BOM para o Excel reconhecer UTF-8; sem ele, acentuação vira lixo na planilha
  // de quem abrir no Windows — e o arquivo perde justamente a utilidade que
  // motivou gerar CSV.
  return `\ufeff${linhas.join('\r\n')}\r\n`;
}

/** Ponto e vírgula como separador: é o que o Excel em português espera. */
function csv(campos: readonly string[]): string {
  return campos.map(escaparCampo).join(';');
}

function escaparCampo(bruto: string): string {
  // A aspa dupla também neutraliza `=`, `+`, `-` e `@` iniciais, que o Excel
  // interpretaria como fórmula — a injeção de fórmula em CSV é o vetor clássico
  // de exportação de dados.
  const precisaAspas = /[";\r\n]/.test(bruto) || /^[=+\-@\t\r]/.test(bruto);
  const escapado = bruto.replace(/"/g, '""');
  return precisaAspas ? `"${escapado}"` : escapado;
}
