import { fetchAuthSession } from 'aws-amplify/auth';

export interface ErroApi {
  readonly code: string;
  readonly message: string;
  readonly detalhes?: { readonly campos?: { readonly campo: string; readonly erro: string }[] };
  readonly correlationId?: string;
  readonly status: number;
}

export class FalhaApi extends Error {
  constructor(readonly erro: ErroApi) {
    super(erro.message);
    this.name = 'FalhaApi';
  }

  /** Erros por campo, para o formulário destacar a linha certa. */
  get porCampo(): Record<string, string> {
    const saida: Record<string, string> = {};
    for (const c of this.erro.detalhes?.campos ?? []) saida[c.campo] = c.erro;
    return saida;
  }
}

import { configuracao } from './configuracao.js';

/**
 * Obtém o token de identidade.
 *
 * **ID token, não access token.** O authorizer do HTTP API está configurado com
 * `jwtAudience: [clientId]`, e só o ID token carrega `aud` com esse valor — o
 * access token do Cognito traz `client_id` e nenhum `aud`. Mandar o access
 * token resulta em 401 sem explicação, e é o erro que mais consome tempo em
 * integração com Cognito.
 */
async function token(): Promise<string> {
  const sessao = await fetchAuthSession();
  const bruto = sessao.tokens?.idToken?.toString();
  if (bruto === undefined) throw new Error('Sessão expirada.');
  return bruto;
}

async function requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`${configuracao().apiUrl}${caminho}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await token()}`,
      ...(init.headers ?? {}),
    },
  });

  if (resposta.status === 204) return undefined as T;

  const corpo: unknown = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const erro = (corpo ?? {}) as Partial<ErroApi>;
    throw new FalhaApi({
      code: erro.code ?? 'ERRO_DESCONHECIDO',
      message: erro.message ?? `Falha na requisição (${resposta.status}).`,
      ...(erro.detalhes === undefined ? {} : { detalhes: erro.detalhes }),
      // O correlationId liga esta tela ao log estruturado. Mostrá-lo ao
      // operador é o que torna um chamado de suporte investigável.
      ...(erro.correlationId === undefined ? {} : { correlationId: erro.correlationId }),
      status: resposta.status,
    });
  }

  return corpo as T;
}

export const api = {
  get: <T>(caminho: string) => requisitar<T>(caminho),
  post: <T>(caminho: string, corpo?: unknown) =>
    requisitar<T>(caminho, {
      method: 'POST',
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  put: <T>(caminho: string, corpo: unknown) =>
    requisitar<T>(caminho, { method: 'PUT', body: JSON.stringify(corpo) }),
  patch: <T>(caminho: string, corpo: unknown) =>
    requisitar<T>(caminho, { method: 'PATCH', body: JSON.stringify(corpo) }),
  delete: <T>(caminho: string) => requisitar<T>(caminho, { method: 'DELETE' }),
};

/**
 * Muitas respostas do backend trazem um campo `aviso` — a pausa que não é
 * retroativa, a nova versão de template que invalida aprovações, o link de
 * exportação que expira em 5 minutos.
 *
 * São avisos que existem porque alguém decidiu que o operador precisa saber
 * daquilo. Descartá-los na interface anularia a decisão.
 */
export interface ComAviso {
  readonly aviso?: string;
}
