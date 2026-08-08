import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmailAddress,
  TENANT_PADRAO,
  campaignId,
  contactId,
  listId,
  templateId,
  unwrap,
  userId,
  type Campaign,
  type Contact,
  type Lista,
  type Template,
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
  contatosDaLista: Contact[];
  contatoParaExportar: Contact | null;
  contadores: Record<string, number>;
  auditados: { acao: string; recursoTipo: string }[];
  gravados: string[];
  adicionados: number;
  importacoesPublicadas: MensagemImportacao[];
  usuarios: UsuarioDoPainel[];
  papeisDefinidos: { id: string; papel: string }[];
  convitesReenviados: string[];
  desabilitados: string[];
}

let estado: Estado;

function templateFalso(): Template {
  return {
    tenantId: TENANT_PADRAO,
    templateId: templateId('t-1'),
    nome: 'Boletim',
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
      buscarPorEmail: async () => null,
      salvar: async () => undefined,
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: estado.contatosDaLista }),
      excluir: async () => undefined,
    },
    campanhas: {
      buscarPorId: async () => estado.campanha,
      salvar: async () => undefined,
      lerStatus: async () => estado.campanha?.status ?? null,
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
        return ids.length;
      },
      removerContato: async () => undefined,
      excluir: async () => void (estado.lista = null),
    },
    metricas: {
      incrementar: async () => undefined,
      ler: async () => estado.contadores,
    },
    envios: {
      buscarPorId: async () => null,
      buscarPorMessageId: async () => null,
      salvar: async () => undefined,
      contarPorCampanha: async () => 0,
      listarPorContato: async () => [],
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
  };
}

beforeEach(() => {
  estado = {
    template: templateFalso(),
    versoesGravadas: [],
    metaGravada: [],
    lista: listaFalsa(),
    campanha: null,
    contatosDaLista: [],
    contatoParaExportar: null,
    contadores: {},
    auditados: [],
    gravados: [],
    adicionados: 0,
    importacoesPublicadas: [],
    usuarios: [],
    papeisDefinidos: [],
    convitesReenviados: [] as string[],
    desabilitados: [] as string[],
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
  const conteudo = { nome: 'Boletim', assunto: 'Olá', corpoHtml: '<p>oi</p>' };

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

describe('listas', () => {
  it('cria lista estática', async () => {
    const r = await req('/listas', json({ nome: 'Nova lista' }));
    expect(r.status).toBe(201);
    expect(estado.auditados).toContainEqual({ acao: 'CRIOU', recursoTipo: 'List' });
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
    estado.contatosDaLista = [contatoFalso({ relacionamento: 'DESCONHECIDO' })];
    const corpo = (await (await req('/listas/l-1/contatos')).json()) as {
      itens: { elegivelParaCampanha: boolean; motivosInelegibilidade: { motivo: string }[] }[];
    };

    expect(corpo.itens[0]?.elegivelParaCampanha).toBe(false);
    expect(corpo.itens[0]?.motivosInelegibilidade).toContainEqual({
      motivo: 'RELACIONAMENTO_DESCONHECIDO',
    });
  });
});

describe('prévia de audiência — o número que importa antes de disparar', () => {
  it('mostra quantos recebem e explica quem não recebe', async () => {
    estado.contatosDaLista = [
      contatoFalso({ contactId: contactId('c-1') }),
      contatoFalso({ contactId: contactId('c-2'), relacionamento: 'DESCONHECIDO' }),
      contatoFalso({ contactId: contactId('c-3'), status: 'BOUNCE' }),
    ];

    const corpo = (await (await req('/listas/l-1/previa-audiencia')).json()) as {
      receberao: number;
      naoReceberao: number;
      explicacoes: { motivo: string; quantidade: number; explicacao: string }[];
    };

    expect(corpo.receberao).toBe(1);
    expect(corpo.naoReceberao).toBe(2);

    const desconhecido = corpo.explicacoes.find((e) => e.motivo === 'RELACIONAMENTO_DESCONHECIDO');
    expect(desconhecido?.quantidade).toBe(1);
    expect(desconhecido?.explicacao).toMatch(/legítimo interesse/i);
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
      nome: 'Boletim',
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
