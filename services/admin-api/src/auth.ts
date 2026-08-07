import type { Context, MiddlewareHandler } from 'hono';
import { TENANT_PADRAO, userId, type TenantId, type UserId } from '@emailmkt/core';

export type Papel = 'ADMIN' | 'OPERADOR';

export interface Usuario {
  readonly userId: UserId;
  readonly email: string;
  readonly papeis: readonly Papel[];
  readonly tenantId: TenantId;
}

export interface Variaveis {
  usuario: Usuario;
  correlationId: string;
}

/**
 * Extrai o usuário das claims do JWT já validadas pelo authorizer do API
 * Gateway — §10.1.
 *
 * O authorizer verifica assinatura, emissor, audiência e expiração antes de a
 * requisição chegar aqui. Revalidar seria trabalho duplicado; **confiar sem que
 * o authorizer exista** seria falha grave. Por isso, se as claims não estiverem
 * presentes, a resposta é 401 e não "usuário anônimo": uma rota que escapou do
 * authorizer por erro de configuração precisa falhar fechada.
 */
export const autenticar = (): MiddlewareHandler<{ Variables: Variaveis }> => {
  return async (c, next) => {
    const claims = extrairClaims(c);

    if (claims === null) {
      return c.json({ code: 'NAO_AUTENTICADO', message: 'Requisição sem identidade válida.' }, 401);
    }

    const sub = claims['sub'];
    if (typeof sub !== 'string' || sub === '') {
      return c.json({ code: 'NAO_AUTENTICADO', message: 'Token sem identificador.' }, 401);
    }

    c.set('usuario', {
      userId: userId(sub),
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      papeis: extrairPapeis(claims),
      // Tenant fixo hoje; quando houver multi-cliente, vem de uma claim
      // customizada do Cognito (§12, V3). O ponto de mudança é só aqui.
      tenantId: TENANT_PADRAO,
    });

    return next();
  };
};

/**
 * Exige um papel — a verificação que a §10.1 chama de inegociável.
 *
 * "A UI esconder o botão não é controle de acesso": qualquer pessoa autenticada
 * pode montar a requisição à mão. Este middleware é onde a regra vale de fato.
 */
export const exigirPapel = (
  ...aceitos: readonly Papel[]
): MiddlewareHandler<{ Variables: Variaveis }> => {
  return async (c, next) => {
    const usuario = c.get('usuario');

    if (!usuario.papeis.some((p) => aceitos.includes(p))) {
      return c.json(
        {
          code: 'PERMISSAO_NEGADA',
          message: `Esta ação exige um dos papéis: ${aceitos.join(', ')}.`,
        },
        403,
      );
    }
    return next();
  };
};

function extrairClaims(c: Context): Record<string, unknown> | null {
  const evento = c.env as
    | {
        requestContext?: {
          authorizer?: { jwt?: { claims?: Record<string, unknown> } };
        };
      }
    | undefined;

  const claims = evento?.requestContext?.authorizer?.jwt?.claims;
  return claims === undefined ? null : claims;
}

/**
 * O Cognito entrega os grupos em `cognito:groups`, e o formato varia: às vezes
 * array, às vezes string separada por espaço ou entre colchetes, dependendo do
 * caminho pelo qual a claim passou. Normalizar aqui evita que uma diferença de
 * serialização vire falha de autorização silenciosa.
 */
function extrairPapeis(claims: Record<string, unknown>): readonly Papel[] {
  const bruto = claims['cognito:groups'];
  const nomes = Array.isArray(bruto)
    ? bruto.map(String)
    : typeof bruto === 'string'
      ? bruto.replace(/^\[|\]$/g, '').split(/[\s,]+/)
      : [];

  const papeis = new Set<Papel>();
  for (const nome of nomes) {
    const normalizado = nome.trim().toUpperCase();
    if (normalizado === 'ADMIN') papeis.add('ADMIN');
    if (normalizado === 'OPERADOR') papeis.add('OPERADOR');
  }
  return [...papeis];
}
