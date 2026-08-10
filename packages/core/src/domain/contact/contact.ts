import type { EmailAddress } from '../shared/email-address.js';
import type { ContactId, TenantId } from '../shared/ids.js';

/**
 * Status do contato — §6.1.
 *
 * `DESCADASTRADO` e `OPOSICAO` são estados distintos de propósito (§6.2, nota 7):
 * sob legítimo interesse, o direito de oposição do art. 18 §2º é mais amplo que
 * parar de receber e-mail — significa cessar o tratamento. Colapsar os dois num
 * único status atenderia mal justamente o direito que a base legal escolhida
 * torna mais relevante.
 */
export type ContactStatus =
  'ATIVO' | 'DESCADASTRADO' | 'OPOSICAO' | 'BOUNCE' | 'RECLAMACAO' | 'SUPRIMIDO';

/**
 * Relacionamento — §6.2, nota 6.
 *
 * Campo obrigatório, e não por preciosismo de modelagem: a base legal do projeto
 * é legítimo interesse (art. 7º, IX). Consentimento se prova com um registro de
 * aceite; legítimo interesse se prova com o *vínculo*. Sem este campo não há como
 * demonstrar a base legal numa fiscalização.
 */
export type Relacionamento =
  'CLIENTE_ATIVO' | 'EX_CLIENTE' | 'PROSPECT_CONTATO' | 'EVENTO' | 'INDICACAO' | 'DESCONHECIDO';

export type BaseLegal = 'LEGITIMO_INTERESSE' | 'CONSENTIMENTO' | 'EXECUCAO_CONTRATO';

export interface RegistroBaseLegal {
  readonly base: BaseLegal;
  /** Versão do LIA aplicado. Sem isso, a base legal é alegação, não justificativa. */
  readonly liaVersao: string;
  readonly finalidade: string;
  readonly evidenciaRelacionamento: string;
  readonly origemDeclarada: string;
  readonly registradoEm: Date;
}

export interface Contact {
  readonly tenantId: TenantId;
  readonly contactId: ContactId;
  readonly email: EmailAddress;
  readonly nome?: string;
  /** Opcional; mantido no cadastro, mas não usado no e-mail. */
  readonly telefone?: string;
  readonly empresa?: string;
  /**
   * Etiquetas livres para segmentar disparos (lógica OU no filtro da campanha).
   * Ausente = sem tags. Normalizadas na borda (trim), guardadas como vieram.
   */
  readonly tags?: readonly string[];
  /**
   * Lead (ex.: recebido por webhook) — §5 do briefing. Leads não recebem
   * campanha por padrão; só entram quando a campanha marca "incluir leads".
   * Ausente ou `false` = contato normal.
   */
  readonly isLead?: boolean;
  readonly camposCustomizados: Readonly<Record<string, string>>;
  readonly status: ContactStatus;
  readonly relacionamento: Relacionamento;
  readonly relacionamentoDesde?: Date;
  readonly baseLegal?: RegistroBaseLegal;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
  readonly origem: string;
}

/** Um contato é lead quando marcado explicitamente. */
export function ehLead(contato: Contact): boolean {
  return contato.isLead === true;
}

/** Normaliza a lista de tags para comparação/filtragem: trim, sem vazias, sem duplicatas. */
export function normalizarTags(tags: readonly string[] | undefined): string[] {
  const limpas = (tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  return [...new Set(limpas)];
}

/** O contato tem ao menos uma das tags pedidas (lógica OU)? Vazio = não filtra. */
export function contatoTemAlgumaTag(contato: Contact, tagsFiltro: readonly string[]): boolean {
  const alvo = normalizarTags(tagsFiltro).map((t) => t.toLowerCase());
  if (alvo.length === 0) return true;
  const doContato = new Set(normalizarTags(contato.tags).map((t) => t.toLowerCase()));
  return alvo.some((t) => doContato.has(t));
}

/** Estados que nunca devem receber campanha. */
const STATUS_BLOQUEADOS: ReadonlySet<ContactStatus> = new Set<ContactStatus>([
  'DESCADASTRADO',
  'OPOSICAO',
  'BOUNCE',
  'RECLAMACAO',
  'SUPRIMIDO',
]);

export type MotivoInelegibilidade = { readonly motivo: 'STATUS'; readonly status: ContactStatus };

export interface ResultadoElegibilidade {
  readonly elegivel: boolean;
  readonly motivos: readonly MotivoInelegibilidade[];
}

/**
 * A porta única por onde um contato entra numa campanha.
 *
 * Concentrar isto aqui é intencional: se a verificação estivesse espalhada pelo
 * launcher, pelo importador e pela interface, bastaria uma delas ficar
 * desatualizada para um contato bloqueado receber e-mail. Aqui, esquecer de
 * chamar é visível; divergir é impossível.
 *
 * **Contato recebe por padrão.** Decisão do escritório em 2026-08-09.
 *
 * Antes, três condições a mais bloqueavam: vínculo não classificado, ausência de
 * registro de base legal por contato, e vínculo com mais de 24 meses. Elas
 * existiam para tornar o legítimo interesse verificável contato a contato — e o
 * custo disso foi um sistema em que ninguém recebia. Pior: a tela de criação de
 * contato **nunca preenchia** o registro de base legal, então todo contato
 * cadastrado pelo painel nascia permanentemente inelegível, sem que a tela
 * dissesse o que fazer a respeito.
 *
 * A base legal continua existindo; o que mudou é onde ela é declarada. Ela passa
 * a ser uma afirmação do escritório sobre a própria base de contatos —
 * registrada uma vez, no LIA —, e não um carimbo por pessoa. É como a maioria
 * dos sistemas de e-mail marketing opera, e é defensável: o que a LGPD cobra é
 * que exista base legal e que o titular possa se opor, não que cada linha do
 * banco carregue um atestado.
 *
 * O que **não** mudou, e não deve mudar: quem se descadastrou, se opôs, deu
 * bounce ou marcou como spam não recebe. Isso não é burocracia. Descadastro é
 * direito do titular, e bounce e reclamação são o que derruba a reputação de
 * envio — passar por cima deles não incomoda só o destinatário, suspende a conta
 * no SES e tira o sistema inteiro do ar.
 */
export function verificarElegibilidade(contato: Contact, _agora: Date): ResultadoElegibilidade {
  const motivos: MotivoInelegibilidade[] = [];

  if (STATUS_BLOQUEADOS.has(contato.status)) {
    motivos.push({ motivo: 'STATUS', status: contato.status });
  }

  return { elegivel: motivos.length === 0, motivos };
}
/** Transições de status disparadas por evento de envio ou por ação do titular. */
export function aplicarDescadastro(contato: Contact, agora: Date): Contact {
  return { ...contato, status: 'DESCADASTRADO', atualizadoEm: agora };
}

export function aplicarOposicao(contato: Contact, agora: Date): Contact {
  return { ...contato, status: 'OPOSICAO', atualizadoEm: agora };
}

export function aplicarHardBounce(contato: Contact, agora: Date): Contact {
  return { ...contato, status: 'BOUNCE', atualizadoEm: agora };
}

export function aplicarReclamacao(contato: Contact, agora: Date): Contact {
  return { ...contato, status: 'RECLAMACAO', atualizadoEm: agora };
}
