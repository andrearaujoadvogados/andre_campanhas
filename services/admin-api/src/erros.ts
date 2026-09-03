import type { DomainError, DomainErrorCode, FalhaEnvio } from '@emailmkt/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Tradução de erro de domínio para HTTP.
 *
 * Fica na borda de propósito: o domínio não conhece HTTP (§5.1). O mapa aqui é
 * exaustivo por tipo — se alguém adicionar um `DomainErrorCode` novo e esquecer
 * de mapeá-lo, o TypeScript aponta, em vez de o erro virar um 500 genérico em
 * produção.
 */
const STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  EMAIL_INVALIDO: 400,
  CAMPO_OBRIGATORIO: 400,
  TOKEN_INVALIDO: 400,
  TRANSICAO_INVALIDA: 409,
  APROVACAO_INVALIDA: 409,
  CONTEUDO_ALTERADO_APOS_APROVACAO: 409,
  CONTATO_INELEGIVEL: 422,
  CONTATO_SUPRIMIDO: 422,
  BASE_LEGAL_AUSENTE: 422,
  PERMISSAO_NEGADA: 403,
};

export function statusDeErro(erro: DomainError): ContentfulStatusCode {
  return STATUS[erro.code];
}

export interface CorpoErro {
  readonly code: string;
  readonly message: string;
  readonly detalhes?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

export function corpoDeErro(erro: DomainError, correlationId: string): CorpoErro {
  return {
    code: erro.code,
    message: erro.message,
    ...(erro.detalhes === undefined ? {} : { detalhes: erro.detalhes }),
    correlationId,
  };
}

/**
 * Erro inesperado nunca vaza detalhe para o cliente.
 *
 * Mensagem de exceção costuma conter nome de tabela, ARN, trecho de consulta —
 * material útil para quem estiver sondando a API. O `correlationId` é o que liga
 * a resposta genérica ao log estruturado, onde o detalhe está inteiro (§10.4).
 */
export function corpoDeErroInterno(correlationId: string): CorpoErro {
  return {
    code: 'ERRO_INTERNO',
    message: 'Erro inesperado. Informe o identificador de correlação ao suporte.',
    correlationId,
  };
}

/**
 * Mensagem legível a partir da falha de envio do provedor (§5.5).
 *
 * Compartilhada pelos dois e-mails de teste — o da campanha e o do modelo —,
 * para o operador ler o mesmo motivo nas duas telas.
 */
export function motivoFalhaEnvio(falha: FalhaEnvio): string {
  return falha.tipo === 'THROTTLED'
    ? 'Envio limitado pela cota do provedor; tente novamente em instantes.'
    : falha.detalhe;
}
