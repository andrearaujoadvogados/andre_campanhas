import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmailAddress,
  TENANT_PADRAO,
  campaignId,
  contactId,
  unwrap,
  type Contact,
} from '@emailmkt/core';
import { criarApp } from '../src/app.js';
import { definirDependenciasParaTeste, type DependenciasPublicas } from '../src/container.js';

const AGORA = new Date('2026-08-07T12:00:00Z');
const TOKEN_VALIDO = 'token-valido';

interface Estado {
  contato: Contact | null;
  tokenValido: boolean;
  salvos: Contact[];
  suprimidos: { motivo: string }[];
  auditados: unknown[];
}

let estado: Estado;

function contatoAtivo(status: Contact['status'] = 'ATIVO'): Contact {
  return {
    tenantId: TENANT_PADRAO,
    contactId: contactId('c-1'),
    email: unwrap(EmailAddress.create('titular@exemplo.com')),
    camposCustomizados: {},
    status,
    relacionamento: 'CLIENTE_ATIVO',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'csv',
  };
}

function deps(): DependenciasPublicas {
  return {
    contatos: {
      buscarPorId: async () => estado.contato,
      buscarPorEmail: async () => null,
      salvar: async (c) => void estado.salvos.push(c),
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: [] }),
      excluir: async () => undefined,
    },
    supressao: {
      estaSuprimido: async () => false,
      filtrarSuprimidos: async () => new Set(),
      suprimir: async (e) => void estado.suprimidos.push({ motivo: e.motivo }),
      remover: async () => undefined,
    },
    tokens: {
      emitir: () => TOKEN_VALIDO,
      verificar: (t) =>
        estado.tokenValido && t === TOKEN_VALIDO
          ? {
              tenantId: TENANT_PADRAO,
              contactId: contactId('c-1'),
              campaignId: campaignId('k-1'),
            }
          : null,
    },
    hasher: { hash: (e) => `h:${e.value}` },
    clock: { agora: () => AGORA },
    auditoria: { registrar: async (e) => void estado.auditados.push(e) },
  };
}

beforeEach(() => {
  estado = {
    contato: contatoAtivo(),
    tokenValido: true,
    salvos: [],
    suprimidos: [],
    auditados: [],
  };
  definirDependenciasParaTeste(deps());
});

const app = () => criarApp();

const req = (caminho: string, init: RequestInit = {}) =>
  app().fetch(new Request(`http://local${caminho}`, init));

const comoNavegador = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { accept: 'text/html', ...(init.headers ?? {}) },
});

describe('GET — nunca descadastra', () => {
  it('mostra a confirmação sem alterar nada', async () => {
    // Scanners corporativos e proxies de e-mail seguem links automaticamente.
    // Se o GET executasse, pessoas seriam descadastradas sem clicar em nada.
    const r = await req(`/?t=${TOKEN_VALIDO}`, comoNavegador());

    expect(r.status).toBe(200);
    expect(estado.salvos).toHaveLength(0);
    expect(estado.suprimidos).toHaveLength(0);
  });

  it('a página traz um formulário POST com o token', async () => {
    const html = await (await req(`/?t=${TOKEN_VALIDO}`, comoNavegador())).text();

    expect(html).toContain('method="POST"');
    expect(html).toContain(`value="${TOKEN_VALIDO}"`);
  });

  it('oferece também a oposição ao tratamento — art. 18, §2º', async () => {
    const html = await (await req(`/?t=${TOKEN_VALIDO}`, comoNavegador())).text();
    expect(html).toContain('value="oposicao"');
  });

  it('sem token, mostra erro', async () => {
    expect((await req('/', comoNavegador())).status).toBe(400);
  });

  it('não revela se o token é válido antes do clique', async () => {
    // Dizer "link inválido" no GET diria a um curioso se aquele token existe.
    estado.tokenValido = false;
    const r = await req(`/?t=${TOKEN_VALIDO}`, comoNavegador());

    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Deseja parar de receber');
  });
});

describe('POST — descadastro em um clique, RFC 8058', () => {
  it('atende o cliente de e-mail sem confirmação nenhuma', async () => {
    // É exatamente o que o Gmail dispara sozinho, sem interação do titular.
    const r = await req(`/?t=${TOKEN_VALIDO}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });

    expect(r.status).toBe(200);
    expect(estado.salvos[0]?.status).toBe('DESCADASTRADO');
  });

  it('responde JSON ao cliente de e-mail e HTML ao navegador', async () => {
    const paraCliente = await req(`/?t=${TOKEN_VALIDO}`, { method: 'POST' });
    expect(paraCliente.headers.get('content-type')).toContain('application/json');

    estado.salvos = [];
    const paraNavegador = await req(
      '/',
      comoNavegador({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `t=${TOKEN_VALIDO}`,
      }),
    );
    expect(paraNavegador.headers.get('content-type')).toContain('text/html');
  });

  it('grava também na supressão — é o que sobrevive à reimportação do CSV', async () => {
    await req(`/?t=${TOKEN_VALIDO}`, { method: 'POST' });
    expect(estado.suprimidos).toEqual([{ motivo: 'DESCADASTRO' }]);
  });

  it('é idempotente — o Gmail pode repetir o POST', async () => {
    estado.contato = contatoAtivo('DESCADASTRADO');
    const r = await req(`/?t=${TOKEN_VALIDO}`, { method: 'POST' });

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it('registra oposição como saída distinta do descadastro', async () => {
    const r = await req(
      '/',
      comoNavegador({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `t=${TOKEN_VALIDO}&acao=oposicao`,
      }),
    );

    expect(r.status).toBe(200);
    expect(estado.salvos[0]?.status).toBe('OPOSICAO');
    expect(estado.suprimidos[0]?.motivo).toBe('OPOSICAO');
  });

  it('aceita token em JSON', async () => {
    const r = await req('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: TOKEN_VALIDO }),
    });

    expect(r.status).toBe(200);
    expect(estado.salvos[0]?.status).toBe('DESCADASTRADO');
  });

  it('registra auditoria com o IP de origem', async () => {
    await req(`/?t=${TOKEN_VALIDO}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    });

    expect(estado.auditados[0]).toMatchObject({ ipOrigem: '203.0.113.10' });
  });
});

describe('não vira oráculo da base de contatos — §10.1', () => {
  it('token inválido e contato inexistente dão a mesma resposta ao navegador', async () => {
    estado.tokenValido = false;
    const comTokenFalso = await req(
      '/',
      comoNavegador({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 't=forjado',
      }),
    );

    estado.tokenValido = true;
    estado.contato = null;
    const semContato = await req(
      '/',
      comoNavegador({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `t=${TOKEN_VALIDO}`,
      }),
    );

    // Distinguir os dois casos permitiria descobrir quem está na base.
    expect(await comTokenFalso.text()).not.toContain('Pronto');
    expect(await semContato.text()).toContain('Pronto');
    // Nenhuma das respostas menciona e-mail, nome ou identificador.
    expect(comTokenFalso.status).toBe(400);
  });

  it('nenhuma página expõe e-mail ou nome do contato', async () => {
    const confirmacao = await (await req(`/?t=${TOKEN_VALIDO}`, comoNavegador())).text();
    const sucesso = await (
      await req(
        '/',
        comoNavegador({
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `t=${TOKEN_VALIDO}`,
        }),
      )
    ).text();

    for (const html of [confirmacao, sucesso]) {
      expect(html).not.toContain('titular@exemplo.com');
      expect(html).not.toContain('c-1');
    }
  });
});

describe('cabeçalhos de segurança', () => {
  it('no-referrer impede o token de vazar no Referer', async () => {
    // O token está na query string; sem este cabeçalho, qualquer requisição
    // externa da página o entregaria a terceiros.
    const r = await req(`/?t=${TOKEN_VALIDO}`, comoNavegador());
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('marca a página como noindex', async () => {
    const r = await req(`/?t=${TOKEN_VALIDO}`, comoNavegador());
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await r.text()).toContain('noindex');
  });

  it('CSP bloqueia qualquer recurso externo', async () => {
    const csp = (await req(`/?t=${TOKEN_VALIDO}`, comoNavegador())).headers.get(
      'Content-Security-Policy',
    );

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('não guarda a página em cache — a URL contém o token', async () => {
    const r = await req(`/?t=${TOKEN_VALIDO}`, comoNavegador());
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});
