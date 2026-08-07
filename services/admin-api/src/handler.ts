import { handle } from 'hono/aws-lambda';
import { criarApp } from './app.js';

/**
 * Lambdalith da API administrativa — ADR-04.
 *
 * Uma função com roteamento interno, em vez de uma Lambda por rota: toda a API
 * está atrás do mesmo authorizer e opera sobre o mesmo conjunto de dados, então
 * o ganho de isolamento seria marginal diante da multiplicação de artefatos e de
 * cold starts. Os endpoints **públicos** — que não têm authorizer — ficam em
 * função separada justamente por não terem essa proteção.
 *
 * O app é construído fora do handler para ser reaproveitado entre invocações do
 * mesmo container.
 */
export const handler = handle(criarApp());
