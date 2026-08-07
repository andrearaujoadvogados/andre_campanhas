import { Hono } from 'hono';
import type { Context } from 'hono';
import { descadastrar, type TipoSaida } from '@emailmkt/core';
import { obterDependencias, log } from './container.js';
import { paginaConfirmacao, paginaErro, paginaSucesso } from './paginas.js';

/**
 * Endpoint público de descadastro — §11, item 7.
 *
 * Sem autenticação, por exigência legal: pedir login para sair de uma lista é
 * barreira ilegal e, na prática, empurra a pessoa a marcar como spam — o que
 * custa a reputação da conta inteira.
 *
 * A proteção é o token HMAC, não a sessão.
 */
export function criarApp() {
  const app = new Hono();

  /**
   * Cabeçalhos de segurança.
   *
   * `Referrer-Policy: no-referrer` é o mais importante e o menos óbvio: o token
   * viaja na query string, e sem esse cabeçalho ele vazaria no `Referer` de
   * qualquer requisição que a página fizesse. Hoje a página não carrega nada
   * externo, mas o cabeçalho é a garantia que sobrevive a uma edição futura.
   *
   * `noindex` porque uma página de descadastro indexada pelo Google seria
   * constrangedora para o escritório e inútil para todo mundo.
   */
  app.use('*', async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-store');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
  });

  app.onError((erro, c) => {
    log.error('falha no endpoint público', {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    // Nem aqui revelamos o motivo: a mesma página genérica de sempre.
    return c.html(paginaErro(), 500);
  });

  /**
   * GET — apenas mostra a confirmação. **Nunca descadastra.**
   *
   * Scanners de segurança corporativa e proxies de e-mail seguem os links das
   * mensagens automaticamente. Se o GET executasse a ação, pessoas seriam
   * descadastradas sem nunca ter clicado — e o escritório perderia contatos sem
   * entender por quê.
   *
   * Note que não validamos o token aqui de propósito: mostrar "link inválido"
   * antes do clique diria a um curioso se aquele token existe. A verificação
   * acontece no POST, onde a resposta é a mesma para token falso e contato
   * inexistente.
   */
  app.get('/', (c) => {
    const token = c.req.query('t') ?? '';
    if (token === '') return c.html(paginaErro(), 400);

    return c.html(paginaConfirmacao(token));
  });

  /**
   * POST — executa o descadastro.
   *
   * Atende dois chamadores diferentes com o mesmo caminho:
   *
   * 1. O **cliente de e-mail**, via RFC 8058: o Gmail e o Yahoo disparam este
   *    POST sozinhos, com corpo `List-Unsubscribe=One-Click`, sem interação da
   *    pessoa. Precisa funcionar sem confirmação nenhuma.
   * 2. O **botão** da página de confirmação.
   *
   * A resposta se adapta: JSON curto para o cliente de e-mail, HTML para quem
   * veio do navegador.
   */
  app.post('/', async (c) => {
    const { token, tipo, veioDoNavegador } = await extrairEntrada(c);

    if (token === '') return responder(c, veioDoNavegador, null, 400);

    const deps = await obterDependencias();
    const ipOrigem = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();

    const r = await descadastrar(deps, {
      token,
      tipo,
      ...(ipOrigem === undefined ? {} : { ipOrigem }),
    });

    if (!r.ok) {
      log.info('descadastro recusado', { code: r.error.code });
      return responder(c, veioDoNavegador, null, 400);
    }

    log.info('descadastro concluído', { tipo: r.value.tipo, jaEstavaFora: r.value.jaEstavaFora });
    return responder(c, veioDoNavegador, r.value.tipo, 200);
  });

  // O cliente de e-mail pode fazer HEAD antes do POST para checar o endpoint.
  app.on('HEAD', '/', (c) => c.body(null, 200));

  app.notFound((c) => c.html(paginaErro(), 404));

  return app;
}

/**
 * Declarado explicitamente, não derivado das assinaturas de rota: a derivação
 * por `Parameters<...>` colapsa para `never` quando há sobrecargas, e o erro
 * resultante aponta para todos os usos em vez da causa.
 */
type Ctx = Context;

/**
 * O token pode chegar de três formas, e todas precisam funcionar:
 * query string (link clicado), formulário (botão da página) ou JSON.
 */
async function extrairEntrada(
  c: Ctx,
): Promise<{ token: string; tipo: TipoSaida; veioDoNavegador: boolean }> {
  const tipoConteudo = c.req.header('content-type') ?? '';
  const aceita = c.req.header('accept') ?? '';

  let tokenCorpo = '';
  let acao = '';

  try {
    if (tipoConteudo.includes('application/json')) {
      const corpo = (await c.req.json()) as Record<string, unknown>;
      tokenCorpo = typeof corpo['t'] === 'string' ? corpo['t'] : '';
      acao = typeof corpo['acao'] === 'string' ? corpo['acao'] : '';
    } else if (tipoConteudo !== '') {
      const form = await c.req.parseBody();
      tokenCorpo = typeof form['t'] === 'string' ? form['t'] : '';
      acao = typeof form['acao'] === 'string' ? form['acao'] : '';
    }
  } catch {
    // Corpo ilegível — o token ainda pode vir na query. O cliente de e-mail do
    // RFC 8058 manda `List-Unsubscribe=One-Click` e o token fica só na URL.
  }

  return {
    token: tokenCorpo !== '' ? tokenCorpo : (c.req.query('t') ?? ''),
    tipo: acao === 'oposicao' ? 'OPOSICAO' : 'DESCADASTRO',
    // O cliente de e-mail não pede HTML; o navegador sim. É o que decide se a
    // resposta é página ou JSON.
    veioDoNavegador: aceita.includes('text/html'),
  };
}

function responder(c: Ctx, veioDoNavegador: boolean, tipo: TipoSaida | null, status: 200 | 400) {
  if (!veioDoNavegador) {
    // Resposta ao cliente de e-mail. O RFC 8058 só exige 2xx no sucesso.
    return c.json(tipo === null ? { ok: false } : { ok: true, tipo }, status);
  }
  return tipo === null ? c.html(paginaErro(), status) : c.html(paginaSucesso(tipo), status);
}
