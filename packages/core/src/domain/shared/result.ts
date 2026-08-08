/**
 * Resultado explícito em vez de exceção para falhas *esperadas* de domínio.
 *
 * Motivo: neste sistema quase toda regra de negócio pode falhar de forma
 * prevista — contato inelegível, transição de estado inválida, cota estourada.
 * Exceção é para o que não deveria acontecer; `Result` é para o que a interface
 * precisa mostrar ao usuário. O tipo obriga quem chama a tratar os dois casos.
 */
export type Result<T, E = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/** Desempacota ou lança — use só em testes e em bordas onde a falha é bug. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap em Result de erro: ${JSON.stringify(r.error)}`);
}

export type DomainErrorCode =
  | 'EMAIL_INVALIDO'
  | 'TRANSICAO_INVALIDA'
  | 'APROVACAO_INVALIDA'
  | 'CONTEUDO_ALTERADO_APOS_APROVACAO'
  | 'CONTATO_INELEGIVEL'
  | 'CONTATO_SUPRIMIDO'
  | 'BASE_LEGAL_AUSENTE'
  | 'TOKEN_INVALIDO'
  | 'CAMPO_OBRIGATORIO'
  | 'PERMISSAO_NEGADA';

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly detalhes?: Readonly<Record<string, unknown>>;
}

export const domainError = (
  code: DomainErrorCode,
  message: string,
  detalhes?: Readonly<Record<string, unknown>>,
): DomainError => (detalhes === undefined ? { code, message } : { code, message, detalhes });
