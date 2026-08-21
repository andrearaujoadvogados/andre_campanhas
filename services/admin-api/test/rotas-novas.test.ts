import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmailAddress,
  TENANT_PADRAO,
  campaignId,
  contactId,
  execucaoBoletimId,
  listId,
  templateId,
  unwrap,
  userId,
  type Campaign,
  type Contact,
  type Envio,
  type ExecucaoBoletim,
  type FonteBoletim,
  type Lista,
  type RotinaBoletim,
  type Template,
  type TipoEmail,
  type UsuarioDoPainel,
  type VersaoTemplate,
} from '@emailmkt/core';
import type { MensagemImportacao } from '@emailmkt/contracts';
import { LiquidEmailRenderer } from '@emailmkt/email-render';
import { CanonicalContentHasher } from '@emailmkt/adapters-aws';
import { criarApp } from '../src/app.js';
import { definirDependenciasParaTeste, type Dependencias } from '../src/container.js';

const AGORA = new Date('2026-08-07T12:00:00Z');

function evento(grupos: unknown = ['operador'], sub = 'u-1') {
  return {
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: 'a@b.com', 'cognito:groups': grupos } } },
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
    baseLegal: {
      base: 'LEGITIMO_INTERESSE',
      liaVersao: 'lia-1',
      finalidade: 'x',
      evidenciaRelacionamento: 'y',
      origemDeclarada: 'z',
      registradoEm: AGORA,
    },
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'csv',
    ...over,
  };
}

interface Estado {
  template: Template | null;
  versoesGravadas: VersaoTemplate[];
  metaGravada: Template[];
  lista: Lista | null;
  campanha: Campaign | null;
  enviosDaCampanha: Envio[];
  tiposEmail: TipoEmail[];
  tiposSalvos: TipoEmail[];
  contatosDaLista: Contact[];
  contatoParaExportar: Contact | null;
  contatoPorEmail: Contact | null;
  contatosSalvos: Contact[];
  idsAdicionados: string[];
  contadores: Record<string, number>;
  serie: {
    dia: string;
    enviados: number;
    entregues: number;
    aberturas: number;
    cliques: number;
    bounces: number;
  }[];
  auditados: { acao: string; recursoTipo: string }[];
  gravados: string[];
  adicionados: number;
  importacoesPublicadas: MensagemImportacao[];
  usuarios: UsuarioDoPainel[];
  papeisDefinidos: { id: string; papel: string }[];
  convitesReenviados: string[];
  desabilitados: string[];
  fontes: FonteBoletim[];
  fontesSalvas: FonteBoletim[];
  geracoesDisparadas: number;
  execucoes: ExecucaoBoletim[];
  rotinas: RotinaBoletim[];
  rotinasSalvas: RotinaBoletim[];
  agendasSincronizadas: RotinaBoletim[];
  agendasRemovidas: string[];
  /** Simula a invocação da Lambda falhando — o caso que não deixava rastro nenhum. */
  falharDisparo: boolean;
}

let estado: Estado;

function templateFalso(): Template {
  return {
    tenantId: TENANT_PADRAO,
    templateId: templateId('t-1'),
    nome: 'Campanha',
    versaoAtual: 3,
    arquivado: false,
    criadoPor: userId('u-1'),
    criadoEm: AGORA,
    atualizadoEm: AGORA,
  };
}

function listaFalsa(): Lista {
  return {
    tenantId: TENANT_PADRAO,
    listId: listId('l-1'),
    nome: 'Clientes ativos',
    tipo: 'ESTATICA',
    totalContatos: 42,
    criadoPor: userId('u-1'),
    criadoEm: AGORA,
    atualizadoEm: AGORA,
  };
}

function montarDeps(): Dependencias {
  return {
    contatos: {
      buscarPorId: async () => estado.contatoParaExportar,
      buscarPorEmail: async () => estado.contatoPorEmail,
      salvar: async (contato) => void estado.contatosSalvos.push(contato),
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: estado.contatosDaLista }),
      excluir: async () => undefined,
    },
    campanhas: {
      buscarPorId: async () => estado.campanha,
      salvar: async () => undefined,
      lerStatus: async () => estado.campanha?.status ?? null,
      excluir: async () => undefined,
      listar: async () => ({ itens: [], truncado: false }),
    },
    agendador: {
      agendar: async () => undefined,
      cancelarAgendamento: async () => undefined,
      dispararAgora: async () => 'arn:exec:1',
    },
    templates: {
      buscarVersao: async () => ({
        assunto: 'Olá {{contato.primeiroNome}}',
        corpoHtml: '<p>oi</p>',
      }),
      buscarMeta: async () => estado.template,
      listar: async () => ({ itens: estado.template === null ? [] : [estado.template] }),
      salvarComVersao: async (t, v) => {
        estado.metaGravada.push(t);
        estado.versoesGravadas.push(v);
      },
      salvarMeta: async (t) => void estado.metaGravada.push(t),
    },
    listas: {
      buscarPorId: async () => estado.lista,
      listar: async () => ({ itens: estado.lista === null ? [] : [estado.lista] }),
      salvar: async () => undefined,
      adicionarContatos: async (_t, _l, ids) => {
        estado.adicionados = ids.length;
        estado.idsAdicionados.push(...ids);
        return ids.length;
      },
      removerContato: async () => undefined,
      excluir: async () => void (estado.lista = null),
    },
    tiposEmail: {
      buscarPorId: async () => estado.tiposEmail[0] ?? null,
      listar: async () => estado.tiposEmail,
      salvar: async (t) => void estado.tiposSalvos.push(t),
      excluir: async () => undefined,
    },
    metricas: {
      incrementar: async () => undefined,
      ler: async () => estado.contadores,
      incrementarSerie: async () => undefined,
      lerSerie: async () => estado.serie,
    },
    envios: {
      buscarPorId: async () => null,
      buscarPorMessageId: async () => null,
      salvar: async () => undefined,
      contarPorCampanha: async () => 0,
      listarPorContato: async () => [],
      listarPorCampanha: async () => ({ itens: estado.enviosDaCampanha }),
      listarRespondentes: async () => ({
        itens: estado.enviosDaCampanha.filter((e) => e.respondidoEm !== undefined),
      }),
    },
    eventos: {
      salvar: async () => undefined,
      listarPorEnvio: async () => [],
    },
    renderer: new LiquidEmailRenderer(),
    supressao: {
      estaSuprimido: async () => false,
      filtrarSuprimidos: async () => new Set(),
      suprimir: async () => undefined,
      remover: async () => undefined,
    },
    auditoria: {
      registrar: async (e) =>
        void estado.auditados.push({ acao: e.acao, recursoTipo: e.recursoTipo }),
    },
    armazenamento: {
      gravar: async (chave: string) => void estado.gravados.push(chave),
      urlDownload: async (chave: string) => `https://s3/${chave}?assinado`,
      urlUpload: async (chave: string) => `https://s3/${chave}?upload`,
    } as unknown as Dependencias['armazenamento'],
    filaImportacao: {
      publicar: async (m: MensagemImportacao) => void estado.importacoesPublicadas.push(m),
    } as unknown as Dependencias['filaImportacao'],
    gestaoUsuarios: {
      listar: async () => estado.usuarios,
      criar: async (email: string, papel: string) => {
        const novo = {
          id: email,
          sub: `sub-${email}`,
          email,
          papeis: [papel],
          habilitado: true,
          aguardandoPrimeiroAcesso: true,
          criadoEm: AGORA,
        };
        estado.usuarios.push(novo);
        return novo;
      },
      definirPapel: async (id: string, papel: string) =>
        void estado.papeisDefinidos.push({ id, papel }),
      reenviarConvite: async (id: string) => void estado.convitesReenviados.push(id),
      desabilitar: async (id: string) => void estado.desabilitados.push(id),
      reabilitar: async () => undefined,
    } as unknown as Dependencias['gestaoUsuarios'],
    hasher: { hash: (e) => `h:${e.value}` },
    hasherConteudo: new CanonicalContentHasher(),
    clock: { agora: () => AGORA },
    ids: { gerar: () => 'id-novo' },
    fontesBoletim: {
      buscarPorId: async (_t, id) => estado.fontes.find((f) => f.fonteId === id) ?? null,
      listar: async () => estado.fontes,
      salvar: async (f) => void estado.fontesSalvas.push(f),
      excluir: async (_t, id) => {
        estado.fontes = estado.fontes.filter((f) => f.fonteId !== id);
      },
    },
    execucoesBoletim: {
      salvar: async (e) => {
        // Put substitui: o dublê espelha o repositório real, senão o teste de
        // "fecha como FALHOU" veria duas execuções em vez de uma atualizada.
        estado.execucoes = [e, ...estado.execucoes.filter((x) => x.execucaoId !== e.execucaoId)];
      },
      buscarPorId: async (_t, id) => estado.execucoes.find((e) => e.execucaoId === id) ?? null,
      listarRecentes: async (_t, limite) =>
        [...estado.execucoes]
          .sort((a, b) => b.iniciadaEm.getTime() - a.iniciadaEm.getTime())
          .slice(0, limite),
    },
    geradorBoletim: {
      gerarAgora: async () => {
        if (estado.falharDisparo) throw new Error('Lambda indisponível');
        estado.geracoesDisparadas += 1;
      },
    },
    rotinasBoletim: {
      buscarPorId: async (_t, id) => estado.rotinas.find((r) => r.rotinaId === id) ?? null,
      listar: async () => estado.rotinas,
      salvar: async (r) => {
        estado.rotinasSalvas.push(r);
        estado.rotinas = [r, ...estado.rotinas.filter((x) => x.rotinaId !== r.rotinaId)];
      },
      excluir: async (_t, id) => {
        estado.rotinas = estado.rotinas.filter((r) => r.rotinaId !== id);
      },
    },
    agendadorRotinas: {
      sincronizar: async (r) => void estado.agendasSincronizadas.push(r),
      remover: async (_t, id) => void estado.agendasRemovidas.push(String(id)),
    },
  };
}

beforeEach(() => {
  estado = {
    template: templateFalso(),
    serie: [],
    versoesGravadas: [],
    metaGravada: [],
    lista: listaFalsa(),
    campanha: null,
    enviosDaCampanha: [],
    tiposEmail: [],
    tiposSalvos: [],
    contatosDaLista: [],
    contatoParaExportar: null,
    contatoPorEmail: null,
    contatosSalvos: [],
    idsAdicionados: [],
    contadores: {},
    auditados: [],
    gravados: [],
    adicionados: 0,
    importacoesPublicadas: [],
    usuarios: [],
    papeisDefinidos: [],
    convitesReenviados: [] as string[],
    desabilitados: [] as string[],
    fontes: [],
    fontesSalvas: [],
    geracoesDisparadas: 0,
    execucoes: [],
    rotinas: [],
    rotinasSalvas: [],
    agendasSincronizadas: [],
    agendasRemovidas: [],
    falharDisparo: false,
  };
  definirDependenciasParaTeste(montarDeps());
});

const req = (caminho: string, init: RequestInit = {}, grupos: unknown = ['operador']) =>
  criarApp().fetch(new Request(`http://local${caminho}`, init), evento(grupos));

const json = (corpo: unknown, metodo = 'POST'): RequestInit => ({
  method: metodo,
  body: JSON.stringify(corpo),
  headers: { 'content-type': 'application/json' },
});

// ── Templates ────────────────────────────────────────────────────────────────

describe('templates — versões imutáveis (§6.2, nota 3)', () => {
  const conteudo = { nome: 'Campanha', assunto: 'Olá', corpoHtml: '<p>oi</p>' };

  it('criar começa na versão 1', async () => {
    const r = await req('/templates', json(conteudo));

    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ versaoAtual: 1 });
    expect(estado.versoesGravadas[0]?.versao).toBe(1);
  });

  it('editar cria a PRÓXIMA versão, nunca altera a existente', async () => {
    // Se a versão pudesse mudar, o histórico diria que foi enviado um conteúdo
    // que nunca existiu naquela forma.
    const r = await req('/templates/t-1', json({ ...conteudo, corpoHtml: '<p>novo</p>' }, 'PUT'));

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ versaoAtual: 4 });
    expect(estado.versoesGravadas[0]?.versao).toBe(4);
  });

  it('avisa que campanhas aprovadas continuam na versão anterior', async () => {
    const r = await req('/templates/t-1', json(conteudo, 'PUT'));
    const corpo = (await r.json()) as { aviso?: string };

    expect(corpo.aviso).toMatch(/revisadas novamente/i);
  });

  it('grava metadados e versão na mesma operação', async () => {
    await req('/templates', json(conteudo));
    expect(estado.metaGravada).toHaveLength(1);
    expect(estado.versoesGravadas).toHaveLength(1);
  });

  it('404 para template inexistente', async () => {
    estado.template = null;
    expect((await req('/templates/t-999')).status).toBe(404);
  });

  it('valida entrada', async () => {
    expect((await req('/templates', json({ nome: '' }))).status).toBe(400);
  });
});

describe('templates — arquivar em vez de excluir', () => {
  it('operador não arquiva', async () => {
    expect((await req('/templates/t-1', { method: 'DELETE' })).status).toBe(403);
  });

  it('admin arquiva, e as versões seguem disponíveis', async () => {
    const r = await req('/templates/t-1', { method: 'DELETE' }, ['admin']);
    const corpo = (await r.json()) as { arquivado: boolean; aviso: string };

    expect(corpo.arquivado).toBe(true);
    expect(corpo.aviso).toMatch(/auditoria/i);
  });
});

describe('templates — quem criou aparece na listagem', () => {
  const usuarioDoPainel = (sub: string, email: string): UsuarioDoPainel => ({
    id: email,
    sub,
    email,
    papeis: ['OPERADOR'],
    habilitado: true,
    aguardandoPrimeiroAcesso: false,
    criadoEm: AGORA,
  });

  it('resolve o sub do criador para o e-mail — só dos subs presentes na página', async () => {
    estado.usuarios.push(
      usuarioDoPainel('u-1', 'ana@escritorio.adv.br'),
      usuarioDoPainel('u-2', 'beto@escritorio.adv.br'),
    );

    const corpo = (await (await req('/templates')).json()) as {
      itens: { criadoPor: string }[];
      criadores: Record<string, string>;
    };

    expect(corpo.itens[0]?.criadoPor).toBe('u-1');
    // u-2 não criou nada do que está listado: expor o quadro inteiro é papel
    // da rota de usuários, que é de ADMIN.
    expect(corpo.criadores).toEqual({ 'u-1': 'ana@escritorio.adv.br' });
  });

  it('Cognito indisponível degrada para o mapa vazio — a listagem não cai', async () => {
    const deps = montarDeps();
    definirDependenciasParaTeste({
      ...deps,
      gestaoUsuarios: {
        ...deps.gestaoUsuarios,
        listar: async () => {
          throw new Error('cognito fora do ar');
        },
      },
    });

    const r = await req('/templates');

    expect(r.status).toBe(200);
    expect(((await r.json()) as { criadores: Record<string, string> }).criadores).toEqual({});
  });
});

describe('templates — prévia', () => {
  it('renderiza com dados fictícios, não com contato real', async () => {
    const r = await req(
      '/templates/previa',
      json({
        nome: 'x',
        assunto: 'Oi {{contato.primeiroNome}}',
        corpoHtml: '<p>{{contato.email}}</p>',
      }),
    );
    const corpo = (await r.json()) as { assunto: string; corpoHtml: string; aviso: string };

    expect(corpo.assunto).toBe('Oi Maria');
    expect(corpo.corpoHtml).toContain('exemplo@destinatario.com.br');
    expect(corpo.aviso).toMatch(/fictícios/i);
  });

  it('a prévia inclui o rodapé de descadastro', async () => {
    const r = await req(
      '/templates/previa',
      json({ nome: 'x', assunto: 'a', corpoHtml: '<p>b</p>' }),
    );
    const corpo = (await r.json()) as { corpoHtml: string };

    expect(corpo.corpoHtml).toContain('Descadastrar-se');
  });

  it('lista as variáveis disponíveis para a interface não adivinhar', async () => {
    const corpo = (await (await req('/templates')).json()) as {
      variaveisDisponiveis: { chave: string }[];
    };
    expect(corpo.variaveisDisponiveis.map((v) => v.chave)).toContain('contato.primeiroNome');
  });
});

// ── Listas ───────────────────────────────────────────────────────────────────

describe('tipos de e-mail — catálogo gerenciável', () => {
  it('a primeira listagem semeia "Boletim" para o catálogo nunca nascer vazio', async () => {
    estado.tiposEmail = [];
    const corpo = (await (await req('/tipos')).json()) as { itens: { nome: string }[] };

    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.nome).toBe('Boletim');
    expect(estado.tiposSalvos).toHaveLength(1);
  });

  it('cria um tipo novo e audita', async () => {
    const r = await req('/tipos', json({ nome: 'Comunicado' }));

    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ nome: 'Comunicado' });
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'TipoEmail' });
  });
});

describe('listas', () => {
  it('cria lista estática', async () => {
    const r = await req('/listas', json({ nome: 'Nova lista' }));
    expect(r.status).toBe(201);
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'List' });
  });

  it('renomeia a lista (CRUD completo, sem exigir ADMIN)', async () => {
    const r = await req(
      '/listas/l-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ nome: 'Renomeada' }),
        headers: { 'content-type': 'application/json' },
      },
      ['operador'],
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ nome: 'Renomeada' });
    expect(estado.auditados).toContainEqual({ acao: 'EDITOU', recursoTipo: 'List' });
  });

  it('adiciona contatos em lote', async () => {
    const r = await req('/listas/l-1/contatos', json({ contactIds: ['c-1', 'c-2', 'c-3'] }));

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ adicionados: 3 });
  });

  it('deixa explícito que o total é aproximado', async () => {
    // O número exato sai da prévia de audiência, que é a que decide quem recebe.
    const corpo = (await (await req('/listas/l-1')).json()) as Record<string, unknown>;
    expect(corpo['totalContatosAproximado']).toBe(42);
    expect(corpo['totalContatos']).toBeUndefined();
  });

  it('excluir lista não apaga contatos, e avisa isso', async () => {
    const r = await req('/listas/l-1', { method: 'DELETE' }, ['admin']);
    const corpo = (await r.json()) as { aviso: string };

    expect(corpo.aviso).toMatch(/nunca apaga contatos/i);
  });

  it('operador não exclui lista', async () => {
    expect((await req('/listas/l-1', { method: 'DELETE' })).status).toBe(403);
  });

  it('a listagem de contatos usa a elegibilidade do domínio, não uma cópia', async () => {
    // Marcado para não receber: é o único caso que a tela precisa distinguir
    // de "recebe", já que vínculo e base legal deixaram de bloquear.
    estado.contatosDaLista = [contatoFalso({ status: 'SUPRIMIDO' })];
    const corpo = (await (await req('/listas/l-1/contatos')).json()) as {
      itens: { elegivelParaCampanha: boolean; motivosInelegibilidade: { motivo: string }[] }[];
    };

    expect(corpo.itens[0]?.elegivelParaCampanha).toBe(false);
    expect(corpo.itens[0]?.motivosInelegibilidade).toContainEqual({
      motivo: 'STATUS',
      status: 'SUPRIMIDO',
    });
  });

  it('vínculo não classificado recebe', async () => {
    estado.contatosDaLista = [contatoFalso({ relacionamento: 'DESCONHECIDO' })];
    const corpo = (await (await req('/listas/l-1/contatos')).json()) as {
      itens: { elegivelParaCampanha: boolean }[];
    };

    expect(corpo.itens[0]?.elegivelParaCampanha).toBe(true);
  });
});

describe('criar contato direto da tela da lista', () => {
  const novo = (over: Record<string, unknown> = {}) => ({
    email: 'maria@exemplo.com',
    nome: 'Maria',
    relacionamento: 'CLIENTE_ATIVO',
    ...over,
  });

  it('cria o contato e já o coloca na lista', async () => {
    const r = await req('/listas/l-1/contatos/novo', json(novo()));
    const corpo = (await r.json()) as { contactId: string; criado: boolean; aviso?: string };

    expect(r.status).toBe(201);
    expect(corpo).toMatchObject({ contactId: 'id-novo', criado: true });
    expect(corpo.aviso).toBeUndefined();
    expect(estado.contatosSalvos).toHaveLength(1);
    expect(estado.contatosSalvos[0]?.origem).toBe('manual');
    expect(estado.idsAdicionados).toEqual(['id-novo']);
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'Contact' });
    expect(estado.auditados).toContainEqual({ acao: 'EDITOU', recursoTipo: 'List' });
  });

  it('e-mail já cadastrado é reaproveitado e entra na lista, sem 409', async () => {
    // Um 409 aqui obrigaria a pessoa a sair da tela, procurar o contato e
    // voltar — trabalho manual para um pedido que já estava claro.
    estado.contatoPorEmail = contatoFalso({ contactId: contactId('c-77') });

    const r = await req('/listas/l-1/contatos/novo', json(novo({ email: 'titular@exemplo.com' })));
    const corpo = (await r.json()) as { contactId: string; criado: boolean; aviso: string };

    expect(r.status).toBe(201);
    expect(corpo.contactId).toBe('c-77');
    expect(corpo.criado).toBe(false);
    expect(corpo.aviso).toMatch(/reaproveitado/i);
    expect(corpo.aviso).toMatch(/base legal/i);
    expect(estado.idsAdicionados).toEqual(['c-77']);
  });

  it('o vínculo digitado NÃO sobrescreve o do contato existente', async () => {
    // Trocar o vínculo em silêncio, a partir da tela de uma lista, mudaria a
    // base legal daquela pessoa sem que ninguém percebesse (§6.2).
    estado.contatoPorEmail = contatoFalso({ relacionamento: 'CLIENTE_ATIVO' });

    const r = await req(
      '/listas/l-1/contatos/novo',
      json(novo({ email: 'titular@exemplo.com', relacionamento: 'DESCONHECIDO', nome: 'Outro' })),
    );
    const corpo = (await r.json()) as { aviso: string; relacionamento: string };

    expect(r.status).toBe(201);
    // O que prevaleceu é o vínculo do contato, não o do formulário. Sem esta
    // asserção, uma implementação que sobrescrevesse o vínculo em memória e
    // devolvesse o valor digitado passaria — bastaria não gravar.
    expect(corpo.relacionamento).toBe('CLIENTE_ATIVO');
    // E nada gravado: o contato existente saiu daqui exatamente como entrou.
    expect(estado.contatosSalvos).toHaveLength(0);
    expect(corpo.aviso).toMatch(/vínculo/i);
    expect(estado.auditados).not.toContainEqual({ acao: 'CRIOU', recursoTipo: 'Contact' });
  });

  it('404 para lista inexistente — e nada é criado', async () => {
    estado.lista = null;

    const r = await req('/listas/l-999/contatos/novo', json(novo()));

    expect(r.status).toBe(404);
    // O código distingue "lista inexistente" de "rota inexistente": sem ele o
    // teste passaria igual se a rota tivesse sumido, porque o 404 viria do
    // `notFound` do app e nada teria sido gravado de qualquer forma.
    expect(await r.json()).toMatchObject({ code: 'NAO_ENCONTRADO' });
    expect(estado.contatosSalvos).toHaveLength(0);
    expect(estado.idsAdicionados).toHaveLength(0);
  });

  it('valida a entrada com o mesmo schema da criação de contato', async () => {
    // Sem `relacionamento` não há como demonstrar a base legal (§6.2).
    const r = await req('/listas/l-1/contatos/novo', json({ email: 'maria@exemplo.com' }));
    expect(r.status).toBe(400);
  });
});

describe('prévia de audiência — o número que importa antes de disparar', () => {
  it('mostra quantos recebem e explica quem não recebe', async () => {
    estado.contatosDaLista = [
      contatoFalso({ contactId: contactId('c-1') }),
      contatoFalso({ contactId: contactId('c-2'), status: 'SUPRIMIDO' }),
      contatoFalso({ contactId: contactId('c-3'), status: 'BOUNCE' }),
    ];

    const corpo = (await (await req('/listas/l-1/previa-audiencia')).json()) as {
      receberao: number;
      naoReceberao: number;
      explicacoes: { motivo: string; quantidade: number; explicacao: string }[];
    };

    expect(corpo.receberao).toBe(1);
    expect(corpo.naoReceberao).toBe(2);

    const suprimido = corpo.explicacoes.find((e) => e.motivo === 'STATUS_SUPRIMIDO');
    expect(suprimido?.quantidade).toBe(1);
    expect(suprimido?.explicacao).toMatch(/marcou para não receber/i);
  });

  it('404 para lista inexistente', async () => {
    estado.lista = null;
    expect((await req('/listas/l-999/previa-audiencia')).status).toBe(404);
  });
});

// ── Relatórios ───────────────────────────────────────────────────────────────

describe('relatórios', () => {
  beforeEach(() => {
    estado.campanha = {
      tenantId: TENANT_PADRAO,
      campaignId: campaignId('k-1'),
      nome: 'Campanha',
      templateId: templateId('t-1'),
      templateVersao: 1,
      listId: listId('l-1'),
      status: 'CONCLUIDA',
      remetenteNome: 'X',
      remetenteEmail: 'a@b.com',
      criadoPor: userId('u-1'),
      criadoEm: AGORA,
    };
  });

  it('devolve contadores, taxas e risco juntos', async () => {
    estado.contadores = { enviados: 1000, entregues: 950, aberturasUnicas: 380, bouncesHard: 50 };

    const corpo = (await (await req('/relatorios/campanhas/k-1')).json()) as {
      taxas: { abertura: number; bounceHard: number };
      risco: { nivel: string; avisos: string[] };
    };

    expect(corpo.taxas.abertura).toBeCloseTo(0.4, 3);
    expect(corpo.taxas.bounceHard).toBe(0.05);
    // O número sozinho não comunica urgência.
    expect(corpo.risco.nivel).toBe('ATENCAO');
    expect(corpo.risco.avisos.join(' ')).toMatch(/higienize/i);
  });

  it('explica a base de cada taxa', async () => {
    // Sem isso, "abertura 42%" não diz se é sobre enviados ou entregues.
    const corpo = (await (await req('/relatorios/campanhas/k-1')).json()) as {
      baseDeCalculo: Record<string, string>;
    };

    expect(corpo.baseDeCalculo['abertura']).toBe('aberturas únicas / entregues');
    expect(corpo.baseDeCalculo['bounceHard']).toBe('bounces permanentes / enviados');
  });

  it('campanha sem eventos devolve tudo zerado, não erro', async () => {
    const corpo = (await (await req('/relatorios/campanhas/k-1')).json()) as {
      contadores: { enviados: number };
      taxas: { entrega: number };
    };

    expect(corpo.contadores.enviados).toBe(0);
    expect(corpo.taxas.entrega).toBe(0);
  });

  it('404 para campanha inexistente', async () => {
    estado.campanha = null;
    expect((await req('/relatorios/campanhas/k-999')).status).toBe(404);
  });

  it('resumo exige a lista de campanhas — não varre a base', async () => {
    // Um Scan para montar dashboard é o caminho mais rápido para uma conta
    // inesperada de DynamoDB.
    expect((await req('/relatorios/resumo')).status).toBe(400);
  });

  it('resumo agrega as campanhas informadas', async () => {
    estado.contadores = { enviados: 100, entregues: 90 };
    const corpo = (await (await req('/relatorios/resumo?campanhas=k-1,k-2')).json()) as {
      campanhasAgregadas: number;
      contadores: { enviados: number };
    };

    expect(corpo.campanhasAgregadas).toBe(2);
    expect(corpo.contadores.enviados).toBe(200);
  });

  it('expõe os limiares para a interface não reimplementar a régua', async () => {
    const corpo = (await (await req('/relatorios/limiares')).json()) as {
      bounce: { critico: number };
      reclamacao: { atencao: number };
    };

    expect(corpo.bounce.critico).toBe(0.1);
    expect(corpo.reclamacao.atencao).toBe(0.001);
  });

  it('lista os destinatários de uma campanha — contato, status de entrega e enviado em', async () => {
    estado.contatoParaExportar = contatoFalso();
    estado.enviosDaCampanha = [
      {
        status: 'ENTREGUE',
        contactId: 'c-1',
        enviadoEm: new Date('2026-08-08T10:00:00Z'),
      } as unknown as Envio,
    ];

    const corpo = (await (await req('/relatorios/campanhas/k-1/destinatarios')).json()) as {
      itens: { status: string; email: string | null }[];
    };

    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.status).toBe('ENTREGUE');
    expect(corpo.itens[0]?.email).not.toBeNull();
  });

  it('lista quem respondeu — e só quem respondeu', async () => {
    estado.contatoParaExportar = contatoFalso();
    estado.enviosDaCampanha = [
      { status: 'ENTREGUE', contactId: 'c-1' } as unknown as Envio,
      {
        status: 'ENTREGUE',
        contactId: 'c-2',
        enviadoEm: new Date('2026-08-08T10:00:00Z'),
        respondidoEm: new Date('2026-08-09T14:30:00Z'),
      } as unknown as Envio,
    ];

    const corpo = (await (await req('/relatorios/campanhas/k-1/respostas')).json()) as {
      itens: { contactId: string; respondidoEm: string | null }[];
    };

    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.contactId).toBe('c-2');
    expect(corpo.itens[0]?.respondidoEm).toBe('2026-08-09T14:30:00.000Z');
  });

  it('a série diária sai em ordem, pronta para o gráfico', async () => {
    estado.serie = [
      { dia: '2026-08-10', enviados: 50, entregues: 48, aberturas: 20, cliques: 3, bounces: 1 },
      { dia: '2026-08-11', enviados: 0, entregues: 2, aberturas: 12, cliques: 5, bounces: 0 },
    ];

    const corpo = (await (await req('/relatorios/campanhas/k-1/serie')).json()) as {
      pontos: { dia: string; aberturas: number }[];
    };

    expect(corpo.pontos).toHaveLength(2);
    expect(corpo.pontos[0]?.dia).toBe('2026-08-10');
    expect(corpo.pontos[1]?.aberturas).toBe(12);
  });

  it('o desempenho por campanha devolve contadores E taxas numa chamada só', async () => {
    estado.contadores = { enviados: 100, entregues: 90, aberturasUnicas: 30, respostas: 3 };

    const corpo = (await (await req('/relatorios/desempenho?campanhas=k-1')).json()) as {
      itens: { campaignId: string; nome: string; taxas: Record<string, number> }[];
    };

    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.nome).toBe('Campanha');
    expect(corpo.itens[0]?.taxas['abertura']).toBeCloseTo(30 / 90);
  });

  it('desempenho sem ids é recusado — nada de Scan para montar dashboard', async () => {
    expect((await req('/relatorios/desempenho')).status).toBe(400);
  });

  it('a tabela de destinatários traz os carimbos de abertura e clique', async () => {
    estado.contatoParaExportar = contatoFalso();
    estado.enviosDaCampanha = [
      {
        status: 'ENTREGUE',
        contactId: 'c-1',
        enviadoEm: new Date('2026-08-08T10:00:00Z'),
        primeiraAberturaEm: new Date('2026-08-08T11:00:00Z'),
        primeiroCliqueEm: new Date('2026-08-08T11:05:00Z'),
      } as unknown as Envio,
    ];

    const corpo = (await (await req('/relatorios/campanhas/k-1/destinatarios')).json()) as {
      itens: { abertoEm: string | null; clicadoEm: string | null }[];
    };

    expect(corpo.itens[0]?.abertoEm).toBe('2026-08-08T11:00:00.000Z');
    expect(corpo.itens[0]?.clicadoEm).toBe('2026-08-08T11:05:00.000Z');
  });

  it('o relatório da campanha traz o contador de respondidos e a taxa', async () => {
    estado.contadores = { enviados: 100, entregues: 90, respostas: 9 };

    const corpo = (await (await req('/relatorios/campanhas/k-1')).json()) as {
      contadores: Record<string, number>;
      taxas: Record<string, number>;
      baseDeCalculo: Record<string, string>;
    };

    expect(corpo.contadores['respostas']).toBe(9);
    // Sobre entregues, como abertura: responder ao que não chegou é impossível.
    expect(corpo.taxas['resposta']).toBeCloseTo(0.1);
    expect(corpo.baseDeCalculo['resposta']).toBe('e-mails respondidos / entregues');
  });
});

describe('exportação de portabilidade — art. 18, II e V', () => {
  beforeEach(() => {
    estado.contatoParaExportar = contatoFalso();
  });

  it('operador NÃO exporta — exige comprovação de identidade pelo escritório', async () => {
    // O art. 18, §5º permite ao controlador exigir prova de identidade; quem
    // faz essa verificação é o escritório, antes de acionar a rota.
    const r = await req('/contatos/c-1/exportacao', { method: 'POST' });

    expect(r.status).toBe(403);
    expect(estado.gravados).toHaveLength(0);
  });

  it('admin gera JSON e CSV', async () => {
    const r = await req('/contatos/c-1/exportacao', { method: 'POST' }, ['admin']);
    const corpo = (await r.json()) as { arquivos: { formato: string; url: string }[] };

    expect(r.status).toBe(200);
    expect(corpo.arquivos.map((a) => a.formato)).toEqual(['json', 'csv']);
    expect(estado.gravados).toHaveLength(2);
  });

  it('os links têm validade curta', async () => {
    // O arquivo reúne, num só lugar, tudo que se sabe sobre a pessoa.
    const r = await req('/contatos/c-1/exportacao', { method: 'POST' }, ['admin']);
    const corpo = (await r.json()) as { validadeSegundos: number; aviso: string };

    expect(corpo.validadeSegundos).toBeLessThanOrEqual(300);
    expect(corpo.aviso).toMatch(/não por e-mail/i);
  });

  it('registra auditoria da exportação', async () => {
    // Exportar dado pessoal é, ele próprio, tratamento — e dos mais sensíveis.
    await req('/contatos/c-1/exportacao', { method: 'POST' }, ['admin']);
    expect(estado.auditados).toContainEqual({ acao: 'EXPORTOU', recursoTipo: 'Contact' });
  });

  it('404 para contato inexistente', async () => {
    estado.contatoParaExportar = null;
    const r = await req('/contatos/c-1/exportacao', { method: 'POST' }, ['admin']);
    expect(r.status).toBe(404);
  });
});

// ── Importação de CSV ────────────────────────────────────────────────────────

describe('importação de CSV — §11, item 1', () => {
  const IMPORTACAO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  const pedido = (over: Record<string, unknown> = {}) => ({
    importacaoId: IMPORTACAO,
    nomeArquivo: 'clientes.csv',
    origemDeclarada: 'Cadastro de clientes do escritório, exportado do sistema interno',
    relacionamentoPadrao: 'CLIENTE_ATIVO',
    confirmaSemListaComprada: true,
    mapeamentoColunas: { email: 'E-mail', nome: 'Nome', relacionamento: 'Vinculo' },
    ...over,
  });

  const CHECKSUM = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

  it('assina a URL de upload sem receber o arquivo', async () => {
    // O CSV vai do navegador direto ao S3: o API Gateway tem teto de 10 MB.
    const r = await req(
      '/contatos/importacoes',
      json({ nomeArquivo: 'clientes.csv', checksumSha256: CHECKSUM }),
      ['admin'],
    );
    const corpo = (await r.json()) as { importacaoId: string; url: string };

    expect(r.status).toBe(201);
    expect(corpo.importacaoId).toBe('id-novo');
    expect(corpo.url).toContain('imports/');
  });

  it('assina o digest do arquivo, não o de um corpo vazio', async () => {
    // `ChecksumAlgorithm: SHA256` na URL presignada grava o digest da string
    // vazia — e aí o S3 só aceita arquivo vazio. O valor real vem do cliente.
    const r = await req(
      '/contatos/importacoes',
      json({ nomeArquivo: 'clientes.csv', checksumSha256: CHECKSUM }),
      ['admin'],
    );
    const corpo = (await r.json()) as { cabecalhosObrigatorios: Record<string, string> };

    expect(corpo.cabecalhosObrigatorios['x-amz-checksum-sha256']).toBe(CHECKSUM);
  });

  it('recusa checksum malformado', async () => {
    const r = await req(
      '/contatos/importacoes',
      json({ nomeArquivo: 'clientes.csv', checksumSha256: 'nao-e-base64' }),
      ['admin'],
    );

    expect(r.status).toBe(400);
  });

  it('deriva a chave do S3 do tenant e do id, não do nome do arquivo', async () => {
    // Nome de arquivo é entrada do usuário; dentro de uma chave de objeto, é
    // como se constrói um caminho para fora do prefixo pretendido.
    const r = await req(
      '/contatos/importacoes',
      json({ nomeArquivo: '../../exports/roubo.csv', checksumSha256: CHECKSUM }),
      ['admin'],
    );
    const corpo = (await r.json()) as { url: string };

    expect(corpo.url).toContain('imports/andrearaujo/id-novo/origem.csv');
    expect(corpo.url).not.toContain('exports/');
  });

  it('enfileira a importação em vez de processar na requisição', async () => {
    const r = await req(`/contatos/importacoes/${IMPORTACAO}/iniciar`, json(pedido()), ['admin']);

    expect(r.status).toBe(202);
    expect(estado.importacoesPublicadas).toHaveLength(1);
    expect(estado.importacoesPublicadas[0]).toMatchObject({
      importacaoId: IMPORTACAO,
      chaveS3: `imports/andrearaujo/${IMPORTACAO}/origem.csv`,
      solicitadoPor: 'u-1',
    });
  });

  it('exige a declaração de origem — é a prova da base legal (§10.2)', async () => {
    const r = await req(
      `/contatos/importacoes/${IMPORTACAO}/iniciar`,
      json(pedido({ origemDeclarada: 'planilha' })),
      ['admin'],
    );

    expect(r.status).toBe(400);
    expect(estado.importacoesPublicadas).toHaveLength(0);
  });

  it('exige a confirmação de que a lista não foi comprada', async () => {
    const r = await req(
      `/contatos/importacoes/${IMPORTACAO}/iniciar`,
      json(pedido({ confirmaSemListaComprada: false })),
      ['admin'],
    );

    expect(r.status).toBe(400);
    expect(estado.importacoesPublicadas).toHaveLength(0);
  });

  it('recusa id divergente entre o endereço e o corpo', async () => {
    // Divergirem significa que o corpo não é o do upload recém-assinado.
    const r = await req(
      '/contatos/importacoes/00000000-0000-4000-8000-000000000000/iniciar',
      json(pedido()),
      ['admin'],
    );

    expect(r.status).toBe(400);
    expect(estado.importacoesPublicadas).toHaveLength(0);
  });

  it('avisa quando o lote inteiro herda o vínculo padrão', async () => {
    // Sem coluna de vínculo, uma escolha errada no formulário classifica
    // milhares de pessoas de uma vez.
    const r = await req(
      `/contatos/importacoes/${IMPORTACAO}/iniciar`,
      json(pedido({ mapeamentoColunas: { email: 'E-mail' } })),
      ['admin'],
    );
    const corpo = (await r.json()) as { aviso: string };

    expect(corpo.aviso).toMatch(/todos os contatos entram como CLIENTE_ATIVO/i);
  });

  it('registra auditoria de quem declarou a origem', async () => {
    // A pergunta "de onde vieram estes 4.000 contatos" se responde aqui.
    await req(`/contatos/importacoes/${IMPORTACAO}/iniciar`, json(pedido()), ['admin']);
    expect(estado.auditados).toContainEqual({ acao: 'IMPORTOU', recursoTipo: 'Importacao' });
  });

  it('operador não importa — declarar base legal é decisão do controlador', async () => {
    const r = await req(`/contatos/importacoes/${IMPORTACAO}/iniciar`, json(pedido()), [
      'operador',
    ]);

    expect(r.status).toBe(403);
    expect(estado.importacoesPublicadas).toHaveLength(0);
  });
});

// ── Usuários ─────────────────────────────────────────────────────────────────

describe('usuários do painel', () => {
  const EU = 'u-1';

  const comoAdmin = (caminho: string, init: RequestInit = {}) =>
    criarApp().fetch(new Request(`http://local${caminho}`, init), evento(['admin'], EU));

  it('só ADMIN gerencia usuários', async () => {
    const r = await req('/usuarios');
    expect(r.status).toBe(403);
  });

  it('convida sem receber senha alguma', async () => {
    // O corpo não tem campo de senha: o Cognito gera e envia por e-mail. Se um
    // dia alguém acrescentar esse campo, este teste é onde a conversa começa.
    const r = await comoAdmin('/usuarios', json({ email: 'novo@exemplo.com', papel: 'OPERADOR' }));
    const corpo = (await r.json()) as { email: string; aviso: string };

    expect(r.status).toBe(201);
    expect(corpo.email).toBe('novo@exemplo.com');
    expect(corpo.aviso).toMatch(/7 dias/);
    expect(JSON.stringify(corpo)).not.toMatch(/senha.{0,20}[:=]/i);
  });

  it('recusa e-mail malformado', async () => {
    const r = await comoAdmin('/usuarios', json({ email: 'nao-e-email', papel: 'ADMIN' }));
    expect(r.status).toBe(400);
  });

  it('impede que o administrador remova o próprio acesso', async () => {
    // Com poucos admins, quem se rebaixa tranca a conta: não sobraria ninguém
    // para promover de volta, e o conserto voltaria a ser pelo CloudShell.
    estado.usuarios = [
      {
        id: 'username-do-fernando',
        sub: EU,
        email: 'eu@exemplo.com',
        papeis: ['ADMIN'],
        habilitado: true,
        aguardandoPrimeiroAcesso: false,
        criadoEm: AGORA,
      },
    ];

    const r = await comoAdmin(
      '/usuarios/username-do-fernando/papel',
      json({ papel: 'OPERADOR' }, 'PUT'),
    );

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'AUTO_REBAIXAMENTO' });
    expect(estado.papeisDefinidos).toHaveLength(0);
  });

  it('compara identidade pelo sub, não pelo username do Cognito', async () => {
    // Os dois divergem: conta criada pelo console tem username UUID, conta
    // criada pela API tem o e-mail. Comparar pelo campo errado deixaria alguém
    // rebaixar a si mesmo — ou impediria de rebaixar outra pessoa.
    estado.usuarios = [
      {
        id: 'outra-pessoa@exemplo.com',
        sub: 'sub-de-outra-pessoa',
        email: 'outra-pessoa@exemplo.com',
        papeis: ['ADMIN'],
        habilitado: true,
        aguardandoPrimeiroAcesso: false,
        criadoEm: AGORA,
      },
    ];

    const r = await comoAdmin(
      '/usuarios/outra-pessoa@exemplo.com/papel',
      json({ papel: 'OPERADOR' }, 'PUT'),
    );

    expect(r.status).toBe(200);
    expect(estado.papeisDefinidos).toEqual([{ id: 'outra-pessoa@exemplo.com', papel: 'OPERADOR' }]);
  });

  it('desativa em vez de excluir', async () => {
    estado.usuarios = [
      {
        id: 'alguem@exemplo.com',
        sub: 'sub-alguem',
        email: 'alguem@exemplo.com',
        papeis: ['OPERADOR'],
        habilitado: true,
        aguardandoPrimeiroAcesso: false,
        criadoEm: AGORA,
      },
    ];

    const r = await comoAdmin('/usuarios/alguem@exemplo.com', { method: 'DELETE' });

    expect(r.status).toBe(200);
    expect(estado.desabilitados).toEqual(['alguem@exemplo.com']);
  });

  it('reenvia o convite quando a senha provisória expira', async () => {
    const r = await comoAdmin('/usuarios/alguem@exemplo.com/convite', { method: 'POST' });

    expect(r.status).toBe(200);
    expect(estado.convitesReenviados).toEqual(['alguem@exemplo.com']);
  });
});

describe('fontes do boletim automatizado — §11, item 12', () => {
  const fonteValida = {
    nome: 'Migalhas',
    url: 'https://www.migalhas.com.br/quentes',
    instrucao: 'Decisões tributárias do STJ e do STF, resumo de duas frases.',
    ativa: true,
  };

  function fonteFalsa(): FonteBoletim {
    return {
      tenantId: TENANT_PADRAO,
      fonteId: 'f-1',
      criadoPor: userId('u-1'),
      criadoEm: AGORA,
      atualizadoEm: AGORA,
      ...fonteValida,
    } as unknown as FonteBoletim;
  }

  function execucaoFalsa(over: Partial<ExecucaoBoletim> = {}): ExecucaoBoletim {
    return {
      tenantId: TENANT_PADRAO,
      execucaoId: execucaoBoletimId('e-1'),
      situacao: 'CONCLUIDA',
      etapa: 'FINALIZADA',
      origem: 'MANUAL',
      iniciadaEm: AGORA,
      atualizadaEm: AGORA,
      fontesTotal: 1,
      fontesConcluidas: 1,
      totalNoticias: 3,
      avisos: [],
      ...over,
    };
  }

  it('cadastra uma fonte com instrução do que coletar', async () => {
    const r = await req('/boletim/fontes', json(fonteValida));

    expect(r.status).toBe(201);
    expect(estado.fontesSalvas[0]?.nome).toBe('Migalhas');
    expect(estado.fontesSalvas[0]?.instrucao).toContain('STJ');
    expect(estado.auditados.some((a) => a.recursoTipo === 'FonteBoletim')).toBe(true);
  });

  it('recusa URL de endereço interno — a guarda de SSRF roda no cadastro', async () => {
    // O worker faz requisições para onde a URL mandar; sem a guarda, cadastrar
    // o endpoint de metadados da nuvem viraria leitura de credenciais.
    const r = await req(
      '/boletim/fontes',
      json({ ...fonteValida, url: 'https://169.254.169.254/latest' }),
    );

    expect(r.status).toBe(400);
    const corpo = (await r.json()) as { code: string };
    expect(corpo.code).toBe('URL_INVALIDA');
    expect(estado.fontesSalvas).toHaveLength(0);
  });

  it('instrução curta demais é recusada — "notícias" não instrui ninguém', async () => {
    const r = await req('/boletim/fontes', json({ ...fonteValida, instrucao: 'notícias' }));

    expect(r.status).toBe(400);
  });

  it('gerar sem fonte ativa explica em vez de disparar à toa', async () => {
    estado.fontes = [];
    const r = await req('/boletim/gerar', json({}));

    expect(r.status).toBe(400);
    expect(estado.geracoesDisparadas).toBe(0);
  });

  it('gerar com fonte ativa dispara em segundo plano e devolve 202 com a execução', async () => {
    estado.fontes = [fonteFalsa()];
    const r = await req('/boletim/gerar', json({}));

    expect(r.status).toBe(202);
    expect(estado.geracoesDisparadas).toBe(1);

    // O 202 devolve a execução, não só uma frase: é ela que a tela acompanha
    // até o desfecho. Sem isso o operador clica e fica sem saber de nada.
    const corpo = (await r.json()) as { execucao: { execucaoId: string; situacao: string } };
    expect(corpo.execucao.situacao).toBe('EXECUTANDO');
    expect(corpo.execucao.execucaoId).not.toBe('');
  });

  it('a execução é registrada ANTES de invocar — a janela de partida não fica cega', async () => {
    estado.fontes = [fonteFalsa()];
    await req('/boletim/gerar', json({}));

    expect(estado.execucoes).toHaveLength(1);
    expect(estado.execucoes[0]?.situacao).toBe('EXECUTANDO');
    expect(estado.execucoes[0]?.origem).toBe('MANUAL');
    expect(String(estado.execucoes[0]?.solicitadaPor)).toBe('u-1');
  });

  it('segundo clique durante a geração recusa e devolve a execução em curso', async () => {
    estado.fontes = [fonteFalsa()];
    await req('/boletim/gerar', json({}));
    const r = await req('/boletim/gerar', json({}));

    expect(r.status).toBe(409);
    // Uma só invocação: dois boletins quase idênticos gastariam em dobro a
    // cota gratuita da IA e confundiriam a lista de modelos.
    expect(estado.geracoesDisparadas).toBe(1);
    const corpo = (await r.json()) as { code: string; execucao: { situacao: string } };
    expect(corpo.code).toBe('JA_EXECUTANDO');
    expect(corpo.execucao.situacao).toBe('EXECUTANDO');
  });

  it('execução sem sinal há muito tempo não tranca o botão para sempre', async () => {
    estado.fontes = [fonteFalsa()];
    estado.execucoes = [
      execucaoFalsa({
        situacao: 'EXECUTANDO',
        // O relógio do teste é AGORA; dez minutos de silêncio é processo morto.
        iniciadaEm: new Date(AGORA.getTime() - 10 * 60_000),
        atualizadaEm: new Date(AGORA.getTime() - 10 * 60_000),
      }),
    ];

    const r = await req('/boletim/gerar', json({}));

    expect(r.status).toBe(202);
    expect(estado.geracoesDisparadas).toBe(1);
  });

  it('falha ao invocar fecha a execução como FALHOU em vez de deixá-la pendurada', async () => {
    estado.fontes = [fonteFalsa()];
    estado.falharDisparo = true;

    const r = await req('/boletim/gerar', json({}));

    expect(r.status).toBe(502);
    expect(estado.execucoes[0]?.situacao).toBe('FALHOU');
    expect(estado.execucoes[0]?.erro).toContain('Lambda indisponível');
    expect(estado.execucoes[0]?.concluidaEm).toBeInstanceOf(Date);
  });

  it('lista as execuções recentes, da mais nova para a mais antiga', async () => {
    estado.execucoes = [
      execucaoFalsa({
        execucaoId: execucaoBoletimId('e-antiga'),
        iniciadaEm: new Date('2026-08-01T10:00:00Z'),
      }),
      execucaoFalsa({
        execucaoId: execucaoBoletimId('e-nova'),
        iniciadaEm: new Date('2026-08-06T10:00:00Z'),
      }),
    ];

    const r = await req('/boletim/execucoes');
    const corpo = (await r.json()) as { itens: { execucaoId: string }[] };

    expect(r.status).toBe(200);
    expect(corpo.itens.map((e) => e.execucaoId)).toEqual(['e-nova', 'e-antiga']);
  });

  it('execução parada há mais de quatro minutos é apresentada como TRAVADA', async () => {
    estado.execucoes = [
      execucaoFalsa({
        situacao: 'EXECUTANDO',
        atualizadaEm: new Date(AGORA.getTime() - 5 * 60_000),
      }),
    ];

    const r = await req('/boletim/execucoes');
    const corpo = (await r.json()) as { itens: { situacao: string }[] };

    // O estado derivado sai resolvido do servidor: o relógio do navegador não
    // é confiável para decidir se um processo morreu.
    expect(corpo.itens[0]?.situacao).toBe('TRAVADA');
  });

  it('excluir remove e audita', async () => {
    estado.fontes = [fonteFalsa()];
    const r = await req('/boletim/fontes/f-1', { method: 'DELETE' });

    expect(r.status).toBe(200);
    expect(estado.fontes).toHaveLength(0);
    expect(estado.auditados.some((a) => a.acao === 'EXCLUIU')).toBe(true);
  });
});

describe('rotina de envio automático do boletim', () => {
  const corpoValido = {
    nome: 'Boletim Tributário',
    periodicidade: 'SEMANAL',
    horario: '08:00',
    diaDaSemana: 1,
    listIds: ['l-1'],
    ativa: true,
  };

  it('cria a rotina e sincroniza a agenda recorrente', async () => {
    const r = await req('/boletim/rotinas', json(corpoValido));
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo['nome']).toBe('Boletim Tributário');
    expect(corpo['periodicidade']).toBe('SEMANAL');
    expect(corpo['diaDaSemana']).toBe(1);
    expect(corpo['listIds']).toEqual(['l-1']);

    expect(estado.rotinasSalvas).toHaveLength(1);
    // Banco primeiro, agenda depois — e a agenda recebe a mesma rotina gravada.
    expect(estado.agendasSincronizadas).toHaveLength(1);
    expect(String(estado.agendasSincronizadas[0]?.rotinaId)).toBe('id-novo');
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'RotinaBoletim' });
  });

  it('o recorte editorial — tipo, temas e fontes — viaja inteiro e volta na resposta', async () => {
    const r = await req(
      '/boletim/rotinas',
      json({
        ...corpoValido,
        nome: 'Notícias gerais',
        tipoEmailId: 'tipo-1',
        temas: ['Reforma Tributária', 'STJ'],
        fonteIds: ['f-1', 'f-2'],
        listIds: ['l-1'],
      }),
    );

    expect(r.status).toBe(201);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo['tipoEmailId']).toBe('tipo-1');
    expect(corpo['temas']).toEqual(['Reforma Tributária', 'STJ']);
    expect(corpo['fonteIds']).toEqual(['f-1', 'f-2']);
    expect(String(estado.rotinasSalvas[0]?.tipoEmailId)).toBe('tipo-1');
  });

  it('recusa semanal sem dia da semana — nenhum padrão decide em silêncio', async () => {
    const r = await req('/boletim/rotinas', json({ ...corpoValido, diaDaSemana: undefined }));
    expect(r.status).toBe(400);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo['code']).toBe('RECORRENCIA_INVALIDA');
    expect(estado.agendasSincronizadas).toHaveLength(0);
  });

  it('recusa lista inexistente no cadastro, não no primeiro disparo — e diz qual', async () => {
    estado.lista = null;
    const r = await req('/boletim/rotinas', json(corpoValido));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain('l-1');
    expect(estado.rotinasSalvas).toHaveLength(0);
  });

  it('rotina sem lista nenhuma é recusada na forma — envio automático precisa de destino', async () => {
    const r = await req('/boletim/rotinas', json({ ...corpoValido, listIds: [] }));
    expect(r.status).toBe(400);
  });

  it('mudar a periodicidade descarta o dia da configuração anterior', async () => {
    await req('/boletim/rotinas', json(corpoValido));

    const r = await req(
      '/boletim/rotinas/id-novo',
      json(
        {
          nome: 'Boletim Tributário',
          periodicidade: 'MENSAL',
          horario: '09:30',
          diaDoMes: 15,
          listIds: ['l-1'],
          ativa: true,
        },
        'PATCH',
      ),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo['diaDoMes']).toBe(15);
    // O dia da semana da versão semanal não sobrevive escondido no banco.
    expect(corpo['diaDaSemana']).toBeNull();
  });

  it('desativar mantém o cadastro e entrega a rotina inativa ao sincronizador', async () => {
    await req('/boletim/rotinas', json(corpoValido));

    const r = await req(
      '/boletim/rotinas/id-novo',
      json({ ...corpoValido, ativa: false }, 'PATCH'),
    );
    expect(r.status).toBe(200);
    // O adaptador é quem traduz "inativa" em remover a agenda; a rota só
    // precisa entregar o estado desejado.
    expect(estado.agendasSincronizadas[1]?.ativa).toBe(false);
    expect(estado.rotinas[0]?.ativa).toBe(false);
  });

  it('excluir remove a agenda ANTES do cadastro — nunca fica gatilho sem rotina', async () => {
    await req('/boletim/rotinas', json(corpoValido));

    const r = await req('/boletim/rotinas/id-novo', { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(estado.agendasRemovidas).toEqual(['id-novo']);
    expect(estado.rotinas).toHaveLength(0);
    expect(estado.auditados).toContainEqual({ acao: 'EXCLUIU', recursoTipo: 'RotinaBoletim' });
  });

  it('listagem devolve as rotinas cadastradas', async () => {
    await req('/boletim/rotinas', json(corpoValido));
    const r = await req('/boletim/rotinas');
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { itens: Record<string, unknown>[] };
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.['horario']).toBe('08:00');
    expect(corpo.itens[0]?.['nome']).toBe('Boletim Tributário');
  });
});
