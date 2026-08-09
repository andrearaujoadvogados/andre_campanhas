import { type Result, type DomainError, ok, err, domainError } from '../shared/result.js';
import type { CampaignId, ListId, TemplateId, TenantId, UserId } from '../shared/ids.js';

/**
 * Ciclo de vida da campanha — §5.8.
 *
 *   RASCUNHO → EM_REVISAO → APROVADA → AGENDADA → ENVIANDO ⇄ PAUSADA → CONCLUIDA
 *        ↑__________|                       └──────────────────────────→ CANCELADA
 */
export type CampaignStatus =
  | 'RASCUNHO'
  | 'EM_REVISAO'
  | 'APROVADA'
  | 'AGENDADA'
  | 'ENVIANDO'
  | 'PAUSADA'
  | 'CONCLUIDA'
  | 'CANCELADA';

export interface Aprovacao {
  readonly aprovadoPor: UserId;
  readonly aprovadoEm: Date;
  /**
   * Hash do conteúdo no momento da aprovação. Sem ele, "aprovado" seria um
   * carimbo sem valor probatório — exatamente o oposto do que a exigência da
   * OAB pede (§10.3).
   */
  readonly hashConteudoAprovado: string;
}

export interface Campaign {
  readonly tenantId: TenantId;
  readonly campaignId: CampaignId;
  readonly nome: string;
  readonly templateId: TemplateId;
  readonly templateVersao: number;
  readonly listId: ListId;
  readonly status: CampaignStatus;
  readonly agendadaPara?: Date;
  readonly remetenteNome: string;
  readonly remetenteEmail: string;
  readonly replyTo?: string;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly aprovacao?: Aprovacao;
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
 * Tudo que, se mudar, invalida uma aprovação. É o insumo do hash.
 * Manter explícito (em vez de hashear o objeto inteiro) evita que um campo
 * irrelevante — `atualizadoEm`, por exemplo — invalide aprovações sem motivo.
 */
export interface ConteudoAprovavel {
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
  RASCUNHO: ['EM_REVISAO', 'CANCELADA'],
  EM_REVISAO: ['APROVADA', 'RASCUNHO', 'CANCELADA'],
  APROVADA: ['AGENDADA', 'ENVIANDO', 'RASCUNHO', 'CANCELADA'],
  AGENDADA: ['ENVIANDO', 'APROVADA', 'CANCELADA'],
  ENVIANDO: ['PAUSADA', 'CONCLUIDA', 'CANCELADA'],
  PAUSADA: ['ENVIANDO', 'CANCELADA'],
  CONCLUIDA: [],
  CANCELADA: [],
};

export function podeTransicionar(de: CampaignStatus, para: CampaignStatus): boolean {
  return TRANSICOES[de].includes(para);
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

export function enviarParaRevisao(campanha: Campaign): Result<Campaign, DomainError> {
  return transicionar(campanha, 'EM_REVISAO');
}

/**
 * Aprovação — §5.8.
 *
 * O autor pode aprovar a própria campanha.
 *
 * Já foi diferente: exigia-se um segundo `ADMIN`. A regra caiu por decisão do
 * escritório em 2026-08-08 — o sistema é de uso interno, e quem escreve as
 * campanhas é o advogado responsável por elas. Exigir uma segunda pessoa não
 * acrescentava revisão nenhuma, só um passo que não podia ser cumprido.
 *
 * **A etapa continua existindo, e não é formalidade.** Ela é o último ponto de
 * parada antes de um disparo que não tem volta: grava quem aprovou, quando, e um
 * hash do conteúdo aprovado — de modo que editar template, assunto ou audiência
 * depois invalida a aprovação e devolve a campanha para EM_REVISAO. Ver
 * `verificarAprovacaoVigente`. Sem esse hash, "aprovado" seria um carimbo sem
 * valor nenhum.
 */
export function aprovar(
  campanha: Campaign,
  aprovadoPor: UserId,
  hashConteudo: string,
  agora: Date,
): Result<Campaign, DomainError> {
  if (campanha.status !== 'EM_REVISAO') {
    return err(
      domainError(
        'APROVACAO_INVALIDA',
        `Só é possível aprovar campanha EM_REVISAO. Status atual: ${campanha.status}.`,
      ),
    );
  }
  const aprovada = transicionar(campanha, 'APROVADA');
  if (!aprovada.ok) return aprovada;

  return ok({
    ...aprovada.value,
    aprovacao: { aprovadoPor, aprovadoEm: agora, hashConteudoAprovado: hashConteudo },
  });
}

/**
 * A aprovação vale para *aquele* conteúdo. Editar template, assunto, remetente
 * ou audiência depois de aprovada invalida a aprovação e devolve a campanha
 * para revisão. Sem esta verificação, alguém poderia aprovar um boletim
 * institucional e disparar outra coisa com o mesmo carimbo.
 */
export function verificarAprovacaoVigente(
  campanha: Campaign,
  hashConteudoAtual: string,
): Result<Campaign, DomainError> {
  if (campanha.aprovacao === undefined) {
    return err(domainError('APROVACAO_INVALIDA', 'Campanha sem registro de aprovação.'));
  }
  if (campanha.aprovacao.hashConteudoAprovado !== hashConteudoAtual) {
    return err(
      domainError(
        'CONTEUDO_ALTERADO_APOS_APROVACAO',
        'O conteúdo mudou depois da aprovação. A campanha precisa ser revisada novamente.',
      ),
    );
  }
  return ok(campanha);
}

/** Edição de conteúdo revoga a aprovação — o caminho de volta para RASCUNHO. */
export function revogarAprovacaoPorEdicao(campanha: Campaign): Campaign {
  if (campanha.status !== 'APROVADA' && campanha.status !== 'AGENDADA') return campanha;
  const { aprovacao: _descartada, ...resto } = campanha;
  return { ...resto, status: 'RASCUNHO' };
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

export function iniciarEnvio(
  campanha: Campaign,
  hashConteudoAtual: string,
): Result<Campaign, DomainError> {
  const vigente = verificarAprovacaoVigente(campanha, hashConteudoAtual);
  if (!vigente.ok) return vigente;
  return transicionar(campanha, 'ENVIANDO');
}

export const pausar = (c: Campaign): Result<Campaign, DomainError> => transicionar(c, 'PAUSADA');
export const retomar = (c: Campaign): Result<Campaign, DomainError> => transicionar(c, 'ENVIANDO');
export const concluir = (c: Campaign): Result<Campaign, DomainError> =>
  transicionar(c, 'CONCLUIDA');
export const cancelar = (c: Campaign): Result<Campaign, DomainError> =>
  transicionar(c, 'CANCELADA');

/** Estados em que o `sender` deve parar de consumir a fila — ADR-05. */
export function deveInterromperEnvio(status: CampaignStatus): boolean {
  return status === 'PAUSADA' || status === 'CANCELADA' || status === 'CONCLUIDA';
}
