import { handle } from 'hono/aws-lambda';
import { criarApp } from './app.js';

/**
 * Descadastro público — ADR-04.
 *
 * Lambda separada da admin-api de propósito: é a única superfície do sistema
 * exposta à internet sem authorizer, e por isso recebe permissão mínima — só
 * lê e escreve status de contato e supressão. Se estivesse dentro do lambdalith
 * administrativo, herdaria as permissões dele.
 *
 * Servida por Function URL em vez de API Gateway: menos uma cobrança por
 * requisição e menos superfície. A proteção é o token HMAC, não um authorizer.
 */
export const handler = handle(criarApp());
