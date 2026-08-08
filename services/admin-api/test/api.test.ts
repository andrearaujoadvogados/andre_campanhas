import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmailAddress,
  campaignId,
  contactId,
  listId,
  templateId,
  unwrap,
  userId,
  TENANT_PADRAO,
  type Campaign,
  type Contact,
} from '@emailmkt/core';
import { CanonicalContentHasher } from '@emailmkt/adapters-aws';
import { criarApp } from '../src/app.js';
import { definirDependenciasParaTeste, type Dependencias } from '../src/container.js';

const AGORA = new Date('2026-08-07T12:00:00Z');
const AUTOR = 'u-operador';
const REVISOR = 'u-admin';

/**
 * Evento do API Gateway com as claims que o authorizer JWT já validou.
 * `papeis: []` simula usuário autenticado sem grupo — o caso que a verificação
 * de papel precisa barrar.
 */
function evento(opcoes: { sub?: string; grupos?: unknown; semAuthorizer?: boolean } = {}) {
  if (opcoes.semAuthorizer === true) return { requestContext: {} };
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: opcoes.sub ?? AUTOR,
            email: 'alguem@escritorio.com.br',
            'cognito:groups': opcoes.grupos ?? ['operador'],
          },
        },
      },
    },
  };
}

function contatoFalso(over: Partial<Contact> = {}): Contact {
  return {
    tenantId: TENANT_PADRAO,
    contactId: contactId('c-1'),
    email: unwrap(EmailAddress.create('titular@exemplo.com')),
    camposCustomizados: {},
    status: 'ATIVO',
    relacionamento: 'CLIENTE_ATIVO',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'manual',
    ...over,
  };
}

function campanhaFalsa(over: Partial<Campaign> = {}): Campaign {
  return {
    tenantId: TENANT_PADRAO,
    campaignId: campaignId('k-1'),
    nome: 'Boletim',
    templateId: templateId('t-1'),
    templateVersao: 1,
    listId: listId('l-1'),
    status: 'RASCUNHO',
    remetenteNome: 'André Araújo Advogados',
    remetenteEmail: 'contato@mail.andrearaujoadvogados.com.br',
    criadoPor: userId(AUTOR),
    criadoEm: AGORA,
    ...over,
  };
}

interface Estado {
  contato: Contact | null;
  campanha: Campaign | null;
  agendamentos: string[];
  filtrosUsados: unknown[];
  truncado: boolean;
  agendamentoCancelado: boolean;
  disparos: number;
  salvos: unknown[];
  auditados: { acao: string; recursoTipo: string }[];
  suprimidos: string[];
}

let estado: Estado;

function montarDeps(): Dependencias {
  const hasherConteudo = new CanonicalContentHasher();
  return {
    contatos: {
      buscarPorId: async () => estado.contato,
      buscarPorEmail: async () => null,
      salvar: async (c) => void estado.salvos.push(c),
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: [] }),
      excluir: async () => void (estado.contato = null),
    },
    campanhas: {
      buscarPorId: async () => estado.campanha,
      salvar: async (k) => {
        estado.campanha = k;
        estado.salvos.push(k);
      },
      lerStatus: async () => estado.campanha?.status ?? null,
      listar: async (_t, filtro) => {
        estado.filtrosUsados.push(filtro);
        return {
          itens: estado.campanha === null ? [] : [estado.campanha],
          truncado: estado.truncado,
        };
      },
    },
    agendador: {
      agendar: async (_t, _k, quando) => void estado.agendamentos.push(quando.toISOString()),
      cancelarAgendamento: async () => void (estado.agendamentoCancelado = true),
      dispararAgora: async () => {
        estado.disparos += 1;
        return 'arn:exec:1';
      },
    },
    supressao: {
      estaSuprimido: async () => false,
      filtrarSuprimidos: async () => new Set(),
      suprimir: async (e) => void estado.suprimidos.push(e.emailHash),
      remover: async () => undefined,
    },
    auditoria: {
      registrar: async (e) =>
        void estado.auditados.push({ acao: e.acao, recursoTipo: e.recursoTipo }),
    },
    armazenamento: {} as Dependencias['armazenamento'],
    hasher: { hash: (e) => `h:${e.value}` },
    hasherConteudo,
    clock: { agora: () => AGORA },
    ids: { gerar: () => 'id-gerado' },
  };
}

beforeEach(() => {
  estado = {
    contato: null,
    campanha: null,
    agendamentos: [],
    filtrosUsados: [],
    truncado: false,
    agendamentoCancelado: false,
    disparos: 0,
    salvos: [],
    auditados: [],
    suprimidos: [],
  };
  definirDependenciasParaTeste(montarDeps());
});

const app = () => criarApp();

const req = (caminho: string, init: RequestInit, env: unknown) =>
  app().fetch(new Request(`http://local${caminho}`, init), env);

describe('autenticação', () => {
  it('/saude não exige identidade', async () => {
    const r = await req('/saude', {}, evento());
    expect(r.status).toBe(200);
  });

  it('falha fechada quando o authorizer não populou as claims', async () => {
    // Cenário real: rota configurada sem authorizer por engano no CDK. Tratar
    // como anônimo abriria a API inteira em silêncio.
    const r = await req('/contatos/c-1', {}, evento({ semAuthorizer: true }));
    expect(r.status).toBe(401);
  });

  it('recusa token sem identificador de usuário', async () => {
    const r = await req('/contatos/c-1', {}, evento({ sub: '' }));
    expect(r.status).toBe(401);
  });
});

describe('autorização por papel — §10.1', () => {
  beforeEach(() => {
    estado.contato = contatoFalso();
  });

  it('operador NÃO pode excluir contato', async () => {
    const r = await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: ['operador'] }));
    expect(r.status).toBe(403);
    expect(estado.suprimidos).toHaveLength(0);
  });

  it('admin pode excluir contato', async () => {
    const r = await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: ['admin'] }));
    expect(r.status).toBe(204);
  });

  it('usuário autenticado sem grupo nenhum não passa', async () => {
    const r = await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: [] }));
    expect(r.status).toBe(403);
  });

  it('aceita grupos serializados como string, não só array', async () => {
    // O Cognito varia o formato da claim conforme o caminho percorrido; uma
    // diferença de serialização não pode virar falha de autorização silenciosa.
    const r = await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: '[admin]' }));
    expect(r.status).toBe(204);
  });
});

describe('exclusão de contato — art. 18', () => {
  beforeEach(() => {
    estado.contato = contatoFalso();
  });

  it('suprime o hash antes de apagar o contato', async () => {
    // Sem a supressão, uma reimportação do CSV traria a pessoa de volta.
    await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: ['admin'] }));
    expect(estado.suprimidos).toEqual(['h:titular@exemplo.com']);
  });

  it('registra auditoria da exclusão', async () => {
    await req('/contatos/c-1', { method: 'DELETE' }, evento({ grupos: ['admin'] }));
    expect(estado.auditados).toContainEqual({ acao: 'EXCLUIU', recursoTipo: 'Contact' });
  });
});

describe('aprovação de campanha — §5.8 e §10.3', () => {
  const hash = (k: Campaign) =>
    new CanonicalContentHasher().hash({
      templateId: k.templateId,
      templateVersao: k.templateVersao,
      listId: k.listId,
      remetenteNome: k.remetenteNome,
      remetenteEmail: k.remetenteEmail,
      replyTo: k.replyTo,
    });

  const aprovar = (corpo: unknown, sub: string, grupos: unknown = ['admin']) =>
    req(
      '/campanhas/k-1/aprovacao',
      {
        method: 'POST',
        body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json' },
      },
      evento({ sub, grupos }),
    );

  it('operador não aprova — é papel de ADMIN', async () => {
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO' });
    const r = await aprovar({ hashConteudoRevisado: hash(estado.campanha) }, REVISOR, ['operador']);
    expect(r.status).toBe(403);
  });

  it('o autor aprova a própria campanha', async () => {
    // O papel continua sendo barreira — só ADMIN aprova. O que caiu foi a
    // exigência de que fosse outra pessoa.
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO', criadoPor: userId(REVISOR) });
    const r = await aprovar({ hashConteudoRevisado: hash(estado.campanha) }, REVISOR);

    expect(r.status).toBe(200);
  });

  it('recusa aprovação se o conteúdo mudou desde a tela de revisão', async () => {
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO' });
    const r = await aprovar({ hashConteudoRevisado: 'hash-de-outra-coisa' }, REVISOR);

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'CONTEUDO_ALTERADO_APOS_APROVACAO' });
  });

  it('aprova quando papel, autor e hash estão corretos', async () => {
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO' });
    const r = await aprovar({ hashConteudoRevisado: hash(estado.campanha) }, REVISOR);

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'APROVADA' });
    expect(estado.auditados).toContainEqual({ acao: 'APROVOU', recursoTipo: 'Campaign' });
  });

  it('devolve o hash atual para a interface reenviar na aprovação', async () => {
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO' });
    const r = await req('/campanhas/k-1', {}, evento());
    const corpo = (await r.json()) as { hashConteudoAtual: string };

    expect(corpo.hashConteudoAtual).toBe(hash(estado.campanha));
  });

  it('não aprova campanha que não está em revisão', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await aprovar({ hashConteudoRevisado: hash(estado.campanha) }, REVISOR);
    expect(r.status).toBe(409);
  });
});

describe('transições de campanha', () => {
  it('pausa avisa que mensagens em voo ainda saem', async () => {
    estado.campanha = campanhaFalsa({ status: 'ENVIANDO' });
    const r = await req('/campanhas/k-1/pausa', { method: 'POST' }, evento());
    const corpo = (await r.json()) as { aviso?: string };

    expect(r.status).toBe(200);
    expect(corpo.aviso).toMatch(/já entregues/i);
  });

  it('recusa transição inválida com 409, não 500', async () => {
    estado.campanha = campanhaFalsa({ status: 'CONCLUIDA' });
    const r = await req('/campanhas/k-1/pausa', { method: 'POST' }, evento());

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'TRANSICAO_INVALIDA' });
  });

  it('cancelamento é restrito a ADMIN', async () => {
    estado.campanha = campanhaFalsa({ status: 'ENVIANDO' });
    const r = await req('/campanhas/k-1/cancelamento', { method: 'POST' }, evento());
    expect(r.status).toBe(403);
  });

  it('404 para campanha inexistente', async () => {
    const r = await req('/campanhas/k-999', {}, evento());
    expect(r.status).toBe(404);
  });
});

describe('validação de entrada', () => {
  const criar = (corpo: unknown) =>
    req(
      '/contatos',
      {
        method: 'POST',
        body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

  it('exige relacionamento — é a prova da base legal (§6.2)', async () => {
    const r = await criar({ email: 'novo@exemplo.com' });
    expect(r.status).toBe(400);

    const corpo = (await r.json()) as { detalhes: { campos: { campo: string }[] } };
    expect(corpo.detalhes.campos.some((x) => x.campo === 'relacionamento')).toBe(true);
  });

  it('rejeita e-mail malformado apontando o campo', async () => {
    const r = await criar({ email: 'não-é-email', relacionamento: 'CLIENTE_ATIVO' });
    expect(r.status).toBe(400);
  });

  it('aceita contato válido e registra auditoria', async () => {
    const r = await criar({ email: 'novo@exemplo.com', relacionamento: 'CLIENTE_ATIVO' });

    expect(r.status).toBe(201);
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'Contact' });
  });

  it('expõe o motivo de inelegibilidade em vez de deixar o operador no escuro', async () => {
    estado.contato = contatoFalso({ relacionamento: 'DESCONHECIDO' });
    const r = await req('/contatos/c-1', {}, evento());
    const corpo = (await r.json()) as {
      elegivelParaCampanha: boolean;
      motivosInelegibilidade: { motivo: string }[];
    };

    expect(corpo.elegivelParaCampanha).toBe(false);
    expect(corpo.motivosInelegibilidade).toContainEqual({ motivo: 'RELACIONAMENTO_DESCONHECIDO' });
  });
});

describe('correlação e vazamento de erro', () => {
  it('devolve x-correlation-id em toda resposta', async () => {
    const r = await req('/saude', {}, evento());
    expect(r.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('preserva o correlationId informado pelo cliente', async () => {
    const r = await req('/saude', { headers: { 'x-correlation-id': 'meu-id' } }, evento());
    expect(r.headers.get('x-correlation-id')).toBe('meu-id');
  });

  it('não vaza detalhe interno quando o repositório falha', async () => {
    definirDependenciasParaTeste({
      ...montarDeps(),
      campanhas: {
        buscarPorId: async () => {
          throw new Error('ResourceNotFoundException: tabela emailmkt-prod-main não existe');
        },
        salvar: async () => undefined,
        lerStatus: async () => null,
      },
    });

    const r = await req('/campanhas/k-1', {}, evento());
    const corpo = (await r.json()) as { code: string; message: string; correlationId?: string };

    expect(r.status).toBe(500);
    expect(corpo.code).toBe('ERRO_INTERNO');
    // O nome da tabela ajudaria quem estivesse sondando a API.
    expect(JSON.stringify(corpo)).not.toMatch(/emailmkt-prod-main/);
    expect(corpo.correlationId).toBeTruthy();
  });
});

describe('agendamento e disparo — ADR-05', () => {
  const campanhaAprovada = () => campanhaFalsa({ status: 'APROVADA' });

  it('agendar valida a transição ANTES de criar o gatilho na AWS', async () => {
    // Invertido, uma campanha em estado inválido deixaria um agendamento órfão
    // que dispararia sozinho depois.
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req(
      '/campanhas/k-1/agendamento',
      {
        method: 'POST',
        body: JSON.stringify({ agendadaPara: '2099-01-01T09:00:00Z' }),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

    expect(r.status).toBe(409);
    expect(estado.agendamentos).toHaveLength(0);
  });

  it('agenda quando a campanha está aprovada', async () => {
    estado.campanha = campanhaAprovada();
    const r = await req(
      '/campanhas/k-1/agendamento',
      {
        method: 'POST',
        body: JSON.stringify({ agendadaPara: '2099-01-01T09:00:00Z' }),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

    expect(r.status).toBe(200);
    expect(estado.agendamentos).toHaveLength(1);
  });

  it('disparo imediato exige campanha aprovada', async () => {
    estado.campanha = campanhaFalsa({ status: 'EM_REVISAO' });
    const r = await req('/campanhas/k-1/disparo', { method: 'POST' }, evento());

    expect(r.status).toBe(409);
    expect(estado.disparos).toBe(0);
  });

  it('dispara campanha aprovada e avisa sobre a duração', async () => {
    estado.campanha = campanhaAprovada();
    const r = await req('/campanhas/k-1/disparo', { method: 'POST' }, evento());
    const corpo = (await r.json()) as { execucao: string; aviso: string };

    expect(estado.disparos).toBe(1);
    expect(corpo.execucao).toBe('arn:exec:1');
    expect(corpo.aviso).toMatch(/cota do SES/i);
    expect(estado.auditados).toContainEqual({ acao: 'ENVIOU', recursoTipo: 'Campaign' });
  });

  it('cancelar remove o agendamento junto', async () => {
    // Sem isto, a campanha cancelada seguiria com o gatilho armado e uma
    // execução falsa apareceria no histórico.
    estado.campanha = campanhaFalsa({ status: 'AGENDADA' });
    await req('/campanhas/k-1/cancelamento', { method: 'POST' }, evento({ grupos: ['admin'] }));

    expect(estado.agendamentoCancelado).toBe(true);
  });
});

describe('listagem de campanhas — §6.3, padrão 7', () => {
  it('sem filtro, varre todos os status', async () => {
    estado.campanha = campanhaFalsa();
    const r = await req('/campanhas', {}, evento());

    expect(r.status).toBe(200);
    // A chave é omitida, não passada como undefined — é o que o port espera
    // para distinguir "sem filtro" de "filtro vazio".
    expect(estado.filtrosUsados[0]).not.toHaveProperty('status');
    expect(estado.filtrosUsados[0]).toMatchObject({ limite: 50 });
  });

  it('com filtro, passa o status adiante para consultar uma partição só', async () => {
    estado.campanha = campanhaFalsa({ status: 'ENVIANDO' });
    await req('/campanhas?status=ENVIANDO', {}, evento());

    expect(estado.filtrosUsados[0]).toMatchObject({ status: 'ENVIANDO' });
  });

  it('recusa status inválido em vez de ignorar o filtro em silêncio', async () => {
    // Ignorar devolveria todas as campanhas para quem pediu um subconjunto —
    // e o operador confiaria no resultado errado.
    const r = await req('/campanhas?status=INVENTADO', {}, evento());
    expect(r.status).toBe(400);
  });

  it('avisa quando a listagem foi cortada', async () => {
    estado.campanha = campanhaFalsa();
    estado.truncado = true;
    const r = await req('/campanhas', {}, evento());
    const corpo = (await r.json()) as { truncado: boolean; aviso?: string };

    expect(corpo.truncado).toBe(true);
    expect(corpo.aviso).toMatch(/filtre por situação/i);
  });

  it('limita o tamanho da página pedida', async () => {
    estado.campanha = campanhaFalsa();
    await req('/campanhas?limite=9999', {}, evento());

    expect(estado.filtrosUsados[0]).toMatchObject({ limite: 100 });
  });

  it('exige autenticação', async () => {
    const r = await req('/campanhas', {}, evento({ semAuthorizer: true }));
    expect(r.status).toBe(401);
  });
});
