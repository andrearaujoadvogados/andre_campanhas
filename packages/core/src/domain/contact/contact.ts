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
  readonly camposCustomizados: Readonly<Record<string, string>>;
  readonly status: ContactStatus;
  readonly relacionamento: Relacionamento;
  readonly relacionamentoDesde?: Date;
  readonly baseLegal?: RegistroBaseLegal;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
  readonly origem: string;
}

/** Estados que nunca devem receber campanha. */
const STATUS_BLOQUEADOS: ReadonlySet<ContactStatus> = new Set<ContactStatus>([
  'DESCADASTRADO',
  'OPOSICAO',
  'BOUNCE',
  'RECLAMACAO',
  'SUPRIMIDO',
]);

export type MotivoInelegibilidade =
  | { readonly motivo: 'STATUS'; readonly status: ContactStatus }
  | { readonly motivo: 'RELACIONAMENTO_DESCONHECIDO' }
  | { readonly motivo: 'SEM_BASE_LEGAL' }
  | { readonly motivo: 'VINCULO_EXPIRADO'; readonly mesesDesdeVinculo: number };

export interface ResultadoElegibilidade {
  readonly elegivel: boolean;
  readonly motivos: readonly MotivoInelegibilidade[];
}

/**
 * Prazo após o qual o vínculo deixa de sustentar o legítimo interesse — §10.2.
 * Um ex-cliente de cinco anos atrás dificilmente ainda tem expectativa legítima
 * de receber comunicação. O valor definitivo sai do LIA do escritório; 24 meses
 * é um padrão conservador até lá.
 */
export const MESES_VALIDADE_VINCULO = 24;

/**
 * A porta única por onde um contato entra numa campanha.
 *
 * Concentrar isto aqui é intencional: se a verificação estivesse espalhada pelo
 * launcher, pelo importador e pela interface, bastaria uma delas ficar
 * desatualizada para um contato inelegível receber e-mail. Aqui, esquecer de
 * chamar é visível; divergir é impossível.
 */
export function verificarElegibilidade(contato: Contact, agora: Date): ResultadoElegibilidade {
  const motivos: MotivoInelegibilidade[] = [];

  if (STATUS_BLOQUEADOS.has(contato.status)) {
    motivos.push({ motivo: 'STATUS', status: contato.status });
  }

  // §6.2: DESCONHECIDO é cadastrável, mas não é enviável. Vira tarefa visível na
  // interface em vez de risco silencioso — e atende LGPD e OAB com um só controle.
  if (contato.relacionamento === 'DESCONHECIDO') {
    motivos.push({ motivo: 'RELACIONAMENTO_DESCONHECIDO' });
  }

  if (contato.baseLegal === undefined) {
    motivos.push({ motivo: 'SEM_BASE_LEGAL' });
  }

  if (contato.baseLegal?.base === 'LEGITIMO_INTERESSE' && contato.relacionamentoDesde) {
    const meses = mesesEntre(contato.relacionamentoDesde, agora);
    if (meses > MESES_VALIDADE_VINCULO) {
      motivos.push({ motivo: 'VINCULO_EXPIRADO', mesesDesdeVinculo: meses });
    }
  }

  return { elegivel: motivos.length === 0, motivos };
}

function mesesEntre(inicio: Date, fim: Date): number {
  const anos = fim.getUTCFullYear() - inicio.getUTCFullYear();
  const meses = fim.getUTCMonth() - inicio.getUTCMonth();
  const ajusteDia = fim.getUTCDate() < inicio.getUTCDate() ? -1 : 0;
  return anos * 12 + meses + ajusteDia;
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
