import { type Result, type DomainError, ok, err, domainError } from '../shared/result.js';
import type {
  CampaignId,
  ListId,
  TemplateId,
  TenantId,
  TipoEmailId,
  UserId,
} from '../shared/ids.js';

/**
 * Ciclo de vida da campanha — §5.8.
 *
 *   RASCUNHO → AGENDADA → ENVIANDO ⇄ PAUSADA → CONCLUIDA
 *        └──────────────────────────────────────→ CANCELADA / FALHA
 *
 * **Sem etapa de aprovação.** O portão EM_REVISAO/APROVADA foi removido por
 * decisão do escritório: quem monta a campanha é quem dispara. A Etapa 4 do
 * assistente é só um resumo para a própria pessoa conferir e enviar um teste —
 * não um fluxo com aprovador e status "aguardando aprovação".
 *
 * O que **não** caiu junto foi a auditoria do disparo: `enviadaPor`,
 * `disparadaEm` e `hashConteudoEnviado` registram quem disparou, quando e um
 * fingerprint do conteúdo que saiu. Para um escritório de advocacia, esse rastro
 * é prova documental do que foi enviado — o portão sumiu, o registro não.
 */
export type CampaignStatus =
  'RASCUNHO' | 'AGENDADA' | 'ENVIANDO' | 'PAUSADA' | 'CONCLUIDA' | 'CANCELADA' | 'FALHA';

export interface Campaign {
  readonly tenantId: TenantId;
  readonly campaignId: CampaignId;
  readonly nome: string;
  /** Tipo de e-mail (catálogo gerenciável). Ausente = sem tipo. */
  readonly tipoEmailId?: TipoEmailId;
  readonly templateId: TemplateId;
  readonly templateVersao: number;
  readonly listId: ListId;
  readonly status: CampaignStatus;
  readonly agendadaPara?: Date;
  readonly remetenteNome: string;
  readonly remetenteEmail: string;
  readonly replyTo?: string;
  /**
   * Assunto próprio da campanha — §8. Quando presente, sobrepõe o assunto do
   * modelo no envio: o mesmo modelo pode sair com assuntos diferentes a cada
   * campanha. Ausente = usa o assunto do modelo.
   */
  readonly assunto?: string;
  /**
   * Segmentação da audiência — §8, Etapa 3. `tagsFiltro` filtra por tag (lógica
   * OU); `incluirLeads` libera leads (padrão falso); `destinatariosSelecionados`,
   * quando presente, restringe o disparo a esses contatos (desmarcação individual).
   */
  readonly tagsFiltro?: readonly string[];
  readonly incluirLeads?: boolean;
  readonly destinatariosSelecionados?: readonly string[];
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  /**
   * Auditoria do disparo — substitui a antiga `aprovacao`.
   *
   * `enviadaPor` é quem acionou o disparo ou o agendamento; `disparadaEm` é o
   * instante em que a campanha entrou em ENVIANDO; `hashConteudoEnviado` é o
   * fingerprint do conteúdo no disparo. Ausentes enquanto a campanha não saiu.
   */
  readonly enviadaPor?: UserId;
  readonly disparadaEm?: Date;
  readonly hashConteudoEnviado?: string;
  /**
   * Quantos destinatários o launcher enfileirou no disparo.
   *
   * Gravado no momento em que a campanha entra em ENVIANDO. Existe para o painel
   * poder mostrar "processados de N": sem ele, o total só vive dentro do Step
   * Functions, e a tela não tem como dizer se um disparo está a meio caminho ou
   * travado. Ausente enquanto a campanha não foi disparada.
   */
  readonly totalDestinatarios?: number;
}

/**
 * O que compõe o fingerprint de conteúdo da campanha — o insumo do hash de
 * auditoria gravado em `hashConteudoEnviado`.
 *
 * Mantido explícito (em vez de hashear o objeto inteiro) para que um campo
 * irrelevante — `atualizadoEm`, por exemplo — não mude o fingerprint sem que o
 * conteúdo tenha mudado de fato.
 */
export interface ConteudoCampanha {
  readonly templateId: TemplateId;
  readonly templateVersao: number;
  readonly listId: ListId;
  readonly remetenteNome: string;
  readonly remetenteEmail: string;
  readonly replyTo: string | undefined;
  readonly assunto: string;
  readonly corpoHtml: string;
}

const TRANSICOES: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  RASCUNHO: ['AGENDADA', 'ENVIANDO', 'CANCELADA'],
  AGENDADA: ['ENVIANDO', 'RASCUNHO', 'CANCELADA'],
  ENVIANDO: ['PAUSADA', 'CONCLUIDA', 'CANCELADA', 'FALHA'],
  PAUSADA: ['ENVIANDO', 'CANCELADA'],
  CONCLUIDA: [],
  CANCELADA: [],
  // Uma falha de disparo pode ser corrigida e o rascunho reaproveitado.
  FALHA: ['RASCUNHO', 'CANCELADA'],
};

/**
 * Falha fechado diante de status desconhecido.
 *
 * `TRANSICOES[de]` devolve `undefined` para qualquer valor fora do tipo — e o
 * banco guarda strings, não o tipo. Campanhas gravadas sob o fluxo antigo
 * trazem `EM_REVISAO` e `APROVADA`, que deixaram de existir aqui; sem o `?.`
 * isto lançaria `TypeError` e derrubaria a Lambda em vez de recusar a transição.
 * Um status que não se conhece não autoriza transição nenhuma.
 */
export function podeTransicionar(de: CampaignStatus, para: CampaignStatus): boolean {
  return TRANSICOES[de]?.includes(para) ?? false;
}

function transicionar(campanha: Campaign, para: CampaignStatus): Result<Campaign, DomainError> {
  if (!podeTransicionar(campanha.status, para)) {
    return err(
      domainError('TRANSICAO_INVALIDA', `Não é possível ir de ${campanha.status} para ${para}.`, {
        de: campanha.status,
        para,
      }),
    );
  }
  return ok({ ...campanha, status: para });
}

/**
 * Carimba a auditoria do disparo sobre a campanha, sem transicionar.
 *
 * Chamado pela rota no instante em que o operador aciona o disparo (ou o
 * agendamento): grava quem acionou e o fingerprint do conteúdo naquele momento.
 * A transição para ENVIANDO acontece depois, no launcher, que registra
 * `disparadaEm`.
 */
export function registrarDisparo(
  campanha: Campaign,
  enviadaPor: UserId,
  hashConteudo: string,
): Campaign {
  return { ...campanha, enviadaPor, hashConteudoEnviado: hashConteudo };
}

export function agendar(
  campanha: Campaign,
  quando: Date,
  agora: Date,
): Result<Campaign, DomainError> {
  if (quando.getTime() <= agora.getTime()) {
    return err(domainError('CAMPO_OBRIGATORIO', 'A data de agendamento deve estar no futuro.'));
  }
  const r = transicionar(campanha, 'AGENDADA');
  return r.ok ? ok({ ...r.value, agendadaPara: quando }) : r;
}

/**
 * RASCUNHO ou AGENDADA → ENVIANDO. Registra o instante do disparo.
 *
 * Sem verificação de aprovação: o portão foi removido. As barreiras que
 * permanecem são a transição de estado válida e, no launcher, a supressão e a
 * elegibilidade de cada contato.
 */
export function iniciarEnvio(campanha: Campaign, agora: Date): Result<Campaign, DomainError> {
  const r = transicionar(campanha, 'ENVIANDO');
  return r.ok ? ok({ ...r.value, disparadaEm: agora }) : r;
}

export const pausar = (c: Campaign): Result<Campaign, DomainError> => transicionar(c, 'PAUSADA');
export const retomar = (c: Campaign): Result<Campaign, DomainError> => transicionar(c, 'ENVIANDO');
export const concluir = (c: Campaign): Result<Campaign, DomainError> =>
  transicionar(c, 'CONCLUIDA');
export const cancelar = (c: Campaign): Result<Campaign, DomainError> =>
  transicionar(c, 'CANCELADA');
export const falhar = (c: Campaign): Result<Campaign, DomainError> => transicionar(c, 'FALHA');

/** Estados em que o `sender` deve parar de consumir a fila — ADR-05. */
export function deveInterromperEnvio(status: CampaignStatus): boolean {
  return (
    status === 'PAUSADA' || status === 'CANCELADA' || status === 'CONCLUIDA' || status === 'FALHA'
  );
}
