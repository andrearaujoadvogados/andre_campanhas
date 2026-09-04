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
import { LiquidEmailRenderer } from '@emailmkt/email-render';
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
    nome: 'Campanha',
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
  /** Hashes tratados como suprimidos pelo repositório falso. */
  suprimidosExistentes: string[];
  /** Endereços que o provedor de e-mail efetivamente recebeu. */
  enviados: string[];
  /** Corpo de cada e-mail que o provedor recebeu. */
  corposEnviados: string[];
  /** Quantos registros de envio a campanha tem — a trava da exclusão. */
  enviosDaCampanha: number;
  /** Versão vigente do modelo — o que `buscarMeta` devolve. */
  versaoAtualDoModelo: number;
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
      excluir: async () => undefined,
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
    templates: {
      // O conteúdo carrega a versão pedida: é o que deixa um teste provar
      // QUAL versão a rota foi buscar.
      buscarVersao: async (_t: unknown, _id: unknown, versao: number) => ({
        assunto: `Assunto v${versao}`,
        corpoHtml: `<p>conteudo-v${versao}</p>`,
      }),
      buscarMeta: async () => ({ versaoAtual: estado.versaoAtualDoModelo }),
    } as unknown as Dependencias['templates'],
    envios: {
      contarPorCampanha: async () => estado.enviosDaCampanha,
    } as unknown as Dependencias['envios'],
    renderer: new LiquidEmailRenderer(),
    provedorEmail: {
      enviar: async (m) => {
        estado.enviados.push(m.para.value);
        // Guarda o corpo: é o que permite afirmar QUAL versão do modelo saiu,
        // em vez de só verificar que algo saiu.
        estado.corposEnviados.push(m.corpoHtml);
        return { ok: true as const, value: { providerMessageId: 'ses-1' } };
      },
    },
    supressao: {
      estaSuprimido: async (_t, hash) => estado.suprimidosExistentes.includes(hash),
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
    fontesBoletim: {
      buscarPorId: async () => null,
      listar: async () => [],
      salvar: async () => undefined,
      excluir: async () => undefined,
    },
    execucoesBoletim: {
      salvar: async () => undefined,
      buscarPorId: async () => null,
      listarRecentes: async () => [],
    },
    geradorBoletim: { gerarAgora: async () => undefined },
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
    suprimidosExistentes: [],
    enviados: [],
    corposEnviados: [],
    enviosDaCampanha: 0,
    versaoAtualDoModelo: 1,
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

describe('sem etapa de aprovação — o portão foi removido', () => {
  it('a rota de aprovação não existe mais', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req(
      '/campanhas/k-1/aprovacao',
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
      evento({ grupos: ['admin'] }),
    );
    expect(r.status).toBe(404);
  });

  it('a rota de envio para revisão não existe mais', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req('/campanhas/k-1/revisao', { method: 'POST' }, evento());
    expect(r.status).toBe(404);
  });

  it('o detalhe da campanha expõe a auditoria do disparo, não a aprovação', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req('/campanhas/k-1', {}, evento());
    const corpo = (await r.json()) as Record<string, unknown>;

    expect(corpo).toHaveProperty('enviadaPor');
    expect(corpo).toHaveProperty('disparadaEm');
    expect(corpo).toHaveProperty('hashConteudoEnviado');
    expect(corpo).not.toHaveProperty('aprovacao');
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
    estado.contato = contatoFalso({ status: 'RECLAMACAO' });
    const r = await req('/contatos/c-1', {}, evento());
    const corpo = (await r.json()) as {
      elegivelParaCampanha: boolean;
      motivosInelegibilidade: { motivo: string; status?: string }[];
    };

    expect(corpo.elegivelParaCampanha).toBe(false);
    expect(corpo.motivosInelegibilidade).toContainEqual({
      motivo: 'STATUS',
      status: 'RECLAMACAO',
    });
  });

  it('vínculo não classificado recebe — contato recebe por padrão', async () => {
    estado.contato = contatoFalso({ relacionamento: 'DESCONHECIDO' });
    const r = await req('/contatos/c-1', {}, evento());
    const corpo = (await r.json()) as { elegivelParaCampanha: boolean };

    expect(corpo.elegivelParaCampanha).toBe(true);
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
        excluir: async () => undefined,
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

describe('agendamento e disparo — ADR-05 (sem aprovação)', () => {
  it('agendar valida a transição ANTES de criar o gatilho na AWS', async () => {
    // Invertido, uma campanha em estado inválido deixaria um agendamento órfão
    // que dispararia sozinho depois. CONCLUIDA não pode ser reagendada.
    estado.campanha = campanhaFalsa({ status: 'CONCLUIDA' });
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

  it('agenda a partir do rascunho e registra quem agendou', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req(
      '/campanhas/k-1/agendamento',
      {
        method: 'POST',
        body: JSON.stringify({ agendadaPara: '2099-01-01T09:00:00Z' }),
        headers: { 'content-type': 'application/json' },
      },
      evento({ sub: REVISOR }),
    );

    expect(r.status).toBe(200);
    expect(estado.agendamentos).toHaveLength(1);
    // Auditoria do disparo agendado.
    expect(estado.campanha?.enviadaPor).toBe(REVISOR);
    expect(estado.campanha?.hashConteudoEnviado).toBeTruthy();
  });

  it('disparo recusa status que não pode sair (CONCLUIDA)', async () => {
    estado.campanha = campanhaFalsa({ status: 'CONCLUIDA' });
    const r = await req('/campanhas/k-1/disparo', { method: 'POST' }, evento());

    expect(r.status).toBe(409);
    expect(estado.disparos).toBe(0);
  });

  it('dispara rascunho direto — quem monta dispara — e grava auditoria', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await req('/campanhas/k-1/disparo', { method: 'POST' }, evento({ sub: REVISOR }));
    const corpo = (await r.json()) as { execucao: string; aviso: string };

    expect(estado.disparos).toBe(1);
    expect(corpo.execucao).toBe('arn:exec:1');
    expect(corpo.aviso).toMatch(/cota do SES/i);
    expect(estado.auditados).toContainEqual({ acao: 'ENVIOU', recursoTipo: 'Campaign' });
    // Gravou enviadaPor + fingerprint antes de acionar o orquestrador.
    expect(estado.campanha?.enviadaPor).toBe(REVISOR);
    expect(estado.campanha?.hashConteudoEnviado).toBeTruthy();
  });

  it('cancelar remove o agendamento junto', async () => {
    // Sem isto, a campanha cancelada seguiria com o gatilho armado e uma
    // execução falsa apareceria no histórico.
    estado.campanha = campanhaFalsa({ status: 'AGENDADA' });
    await req('/campanhas/k-1/cancelamento', { method: 'POST' }, evento({ grupos: ['admin'] }));

    expect(estado.agendamentoCancelado).toBe(true);
  });
});

describe('e-mail de teste — a supressão vale aqui também', () => {
  const enviarTeste = (destinatarios: string[]) =>
    req(
      '/campanhas/k-1/teste',
      {
        method: 'POST',
        body: JSON.stringify({ destinatarios }),
        headers: { 'content-type': 'application/json' },
      },
      evento({ grupos: ['operador'] }),
    );

  beforeEach(() => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
  });

  it('envia para endereço limpo', async () => {
    const r = await enviarTeste(['operador@exemplo.com']);

    expect(r.status).toBe(200);
    expect(estado.enviados).toEqual(['operador@exemplo.com']);
  });

  it('RECUSA endereço na lista de supressão', async () => {
    // O teste pula audiência e elegibilidade de propósito — é uma cópia para
    // conferência. A supressão é outra coisa: quem se descadastrou pediu para
    // não receber mais nada deste remetente, e "era só um teste" não é uma
    // exceção que a pessoa concordou em abrir. Três endereços digitados à mão
    // erram com facilidade — basta colar o de um cliente para ver como ficou.
    estado.suprimidosExistentes = ['h:saiu@exemplo.com'];

    const r = await enviarTeste(['saiu@exemplo.com']);
    const corpo = (await r.json()) as { enviados: number; falhas: { motivo: string }[] };

    expect(estado.enviados).toEqual([]);
    expect(corpo.enviados).toBe(0);
    expect(corpo.falhas[0]?.motivo).toMatch(/supressão/i);
  });

  it('um endereço suprimido não impede os outros', async () => {
    estado.suprimidosExistentes = ['h:saiu@exemplo.com'];

    await enviarTeste(['saiu@exemplo.com', 'operador@exemplo.com']);

    expect(estado.enviados).toEqual(['operador@exemplo.com']);
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

// ── Gestão de campanhas ──────────────────────────────────────────────────────

describe('editar e excluir campanha', () => {
  const patch = (corpo: unknown, grupos: unknown = ['admin']) =>
    req(
      '/campanhas/k-1',
      {
        method: 'PATCH',
        body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json' },
      },
      evento({ grupos }),
    );

  const excluir = (grupos: unknown = ['admin']) =>
    req('/campanhas/k-1', { method: 'DELETE' }, evento({ grupos }));

  it('edita rascunho', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    const r = await patch({ nome: 'Nome novo' });

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ nome: 'Nome novo' });
  });

  it('edita campanha agendada sem mudar o status — continua agendada', async () => {
    // Sem portão de aprovação, editar não devolve para rascunho: a campanha
    // segue AGENDADA e o launcher lê o conteúdo mais recente no horário marcado.
    estado.campanha = campanhaFalsa({ status: 'AGENDADA' });
    const r = await patch({ nome: 'Outro nome' });
    const corpo = (await r.json()) as { status: string; nome: string };

    expect(r.status).toBe(200);
    expect(corpo.status).toBe('AGENDADA');
    expect(corpo.nome).toBe('Outro nome');
  });

  it('editar campanha agendada recalcula o fingerprint do conteúdo', async () => {
    // O hash é gravado no agendamento e o launcher só dispara depois, lendo o
    // conteúdo mais recente. Se a edição não o recalculasse, `hashConteudoEnviado`
    // descreveria o conteúdo de antes — um registro que aparenta provar o que
    // saiu e aponta para outra coisa. Num escritório de advocacia, é esse rastro
    // que precisa se sustentar.
    estado.campanha = campanhaFalsa({
      status: 'AGENDADA',
      hashConteudoEnviado: 'hash-de-quando-agendou',
    });

    const r = await patch({ listId: 'l-outra' });
    expect(r.status).toBe(200);

    const salva = estado.salvos.at(-1);
    expect(salva?.hashConteudoEnviado).toBeDefined();
    expect(salva?.hashConteudoEnviado).not.toBe('hash-de-quando-agendou');
  });

  it('editar rascunho nunca disparado não inventa fingerprint', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    await patch({ nome: 'Nome novo' });

    expect(estado.salvos.at(-1)?.hashConteudoEnviado).toBeUndefined();
  });

  it('não edita campanha que já saiu', async () => {
    estado.campanha = campanhaFalsa({ status: 'ENVIANDO' });
    const r = await patch({ nome: 'Tarde demais' });

    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'CAMPANHA_NAO_EDITAVEL' });
  });

  it('exclui rascunho', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    expect((await excluir()).status).toBe(204);
  });

  // A trava da exclusão é o envio, não o status. Antes só RASCUNHO saía, e o
  // efeito era ninguém conseguir limpar a lista: uma campanha cancelado, que nunca
  // mandou nada a ninguém, ficava na tela para sempre.

  it.each(['AGENDADA', 'CANCELADA', 'FALHA', 'CONCLUIDA'] as const)(
    'exclui campanha em %s que não enviou nada',
    async (status) => {
      estado.campanha = campanhaFalsa({ status });
      estado.enviosDaCampanha = 0;

      expect((await excluir()).status).toBe(204);
    },
  );

  it('NÃO exclui campanha que já enviou — o registro tem dono', async () => {
    // O destinatário tem direito de saber o que recebeu, e o relatório aponta
    // para esta campanha. Apagá-la deixaria os dois sem referente.
    estado.campanha = campanhaFalsa({ status: 'CONCLUIDA' });
    estado.enviosDaCampanha = 3;

    const r = await excluir();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'CAMPANHA_NAO_EXCLUIVEL' });
  });

  it('não exclui enquanto está enviando, mesmo sem registro ainda', async () => {
    estado.campanha = campanhaFalsa({ status: 'ENVIANDO' });
    estado.enviosDaCampanha = 0;

    const r = await excluir();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'CAMPANHA_NAO_EXCLUIVEL' });
  });

  it('operador também exclui — quem monta gerencia o própria campanha', async () => {
    // A trava de ADMIN caiu: excluir uma campanha que não enviou nada não apaga
    // prova nenhuma, e restringi-la a ADMIN só travava a limpeza da lista.
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO' });
    estado.enviosDaCampanha = 0;
    expect((await excluir(['operador'])).status).toBe(204);
  });

  it('duplica uma campanha, criando um rascunho novo', async () => {
    estado.campanha = campanhaFalsa({ status: 'CONCLUIDA', nome: 'Campanha de agosto' });
    const r = await req('/campanhas/k-1/duplicacao', { method: 'POST' }, evento());
    const corpo = (await r.json()) as { status: string; nome: string };

    expect(r.status).toBe(201);
    expect(corpo.status).toBe('RASCUNHO');
    expect(corpo.nome).toBe('Campanha de agosto (cópia)');
  });
});

describe('e-mail de teste do MODELO — sem campanha', () => {
  /**
   * Validar o modelo na criação ou na edição, antes de existir campanha — e
   * antes de salvar: o conteúdo vai no corpo, e nada é gravado.
   */
  const testar = (corpo: unknown) =>
    req(
      '/templates/teste',
      {
        method: 'POST',
        body: JSON.stringify(corpo),
        headers: { 'content-type': 'application/json' },
      },
      evento({ grupos: ['operador'] }),
    );

  it('envia o conteúdo da tela, marcado como teste e pelo remetente padrão', async () => {
    const r = await testar({
      assunto: 'Boletim de {{contato.primeiroNome}}',
      corpoHtml: '<p>Olá {{contato.primeiroNome}}, rascunho ainda não salvo.</p>',
      destinatarios: ['operador@exemplo.com'],
    });
    const corpo = (await r.json()) as { enviados: number; aviso: string };

    expect(r.status).toBe(200);
    expect(corpo.enviados).toBe(1);
    expect(corpo.aviso).toMatch(/\[TESTE\]/);
    expect(estado.enviados).toEqual(['operador@exemplo.com']);
    // O que saiu é o que estava na tela, personalizado com o contato de exemplo.
    expect(estado.corposEnviados[0]).toContain('rascunho ainda não salvo');
    expect(estado.corposEnviados[0]).toContain('Maria');
    // Nada gravado: testar não pode custar uma versão do modelo.
    expect(estado.salvos).toHaveLength(0);
    expect(estado.auditados).toContainEqual({ acao: 'ENVIOU', recursoTipo: 'Template' });
  });

  it('a supressão vale aqui como no teste da campanha', async () => {
    estado.suprimidosExistentes = ['h:saiu@exemplo.com'];

    const r = await testar({
      assunto: 'x',
      corpoHtml: '<p>x</p>',
      destinatarios: ['saiu@exemplo.com', 'fica@exemplo.com'],
    });
    const corpo = (await r.json()) as { enviados: number; falhas: { email: string }[] };

    expect(corpo.enviados).toBe(1);
    expect(corpo.falhas.map((f) => f.email)).toEqual(['saiu@exemplo.com']);
    expect(estado.enviados).toEqual(['fica@exemplo.com']);
  });

  it('exige assunto, corpo e ao menos um destinatário', async () => {
    expect(
      (await testar({ assunto: '', corpoHtml: '<p>x</p>', destinatarios: ['a@b.co'] })).status,
    ).toBe(400);
    expect((await testar({ assunto: 'x', corpoHtml: '<p>x</p>', destinatarios: [] })).status).toBe(
      400,
    );
    expect(estado.enviados).toEqual([]);
  });
});

describe('o teste mostra o e-mail que vai sair', () => {
  /**
   * O bug que estes testes fecham: `templateVersao` nascia cravado em 1 e o
   * PATCH nunca o atualizava. Editar o conteúdo cria a versão 2, 3… e a
   * campanha continuava presa na 1 — o teste devolvia o primeiro rascunho e,
   * pior, o `sender` lê o mesmo campo, então o **disparo real** sairia com o
   * conteúdo velho. Quem montasse, ajustasse e disparasse enviaria algo que já
   * tinha descartado, sem nenhum aviso na tela.
   */
  const enviarTeste = () =>
    req(
      '/campanhas/k-1/teste',
      {
        method: 'POST',
        body: JSON.stringify({ destinatarios: ['operador@exemplo.com'] }),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

  it('renderiza a versão vigente do modelo, não a que estava salva na campanha', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO', templateVersao: 1 });
    estado.versaoAtualDoModelo = 3;

    const r = await enviarTeste();

    expect(r.status).toBe(200);
    // A prova: saiu o conteudo da versao 3, nao o da 1 gravada na campanha.
    expect(estado.corposEnviados[0]).toContain('conteudo-v3');
    expect(estado.corposEnviados[0]).not.toContain('conteudo-v1');
  });

  it('editar a campanha reamarra a versão vigente do modelo', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO', templateVersao: 1 });
    estado.versaoAtualDoModelo = 4;

    const r = await req(
      '/campanhas/k-1',
      {
        method: 'PATCH',
        body: JSON.stringify({ nome: 'Nome novo' }),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

    expect(r.status).toBe(200);
    expect(estado.campanha?.templateVersao).toBe(4);
  });

  it('o disparo congela a versão vigente — o que o teste mostrou é o que sai', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO', templateVersao: 1 });
    estado.versaoAtualDoModelo = 5;

    await req('/campanhas/k-1/disparo', { method: 'POST' }, evento());

    expect(estado.disparos).toBe(1);
    expect(estado.campanha?.templateVersao).toBe(5);
  });

  it('agendar também congela a versão vigente', async () => {
    estado.campanha = campanhaFalsa({ status: 'RASCUNHO', templateVersao: 1 });
    estado.versaoAtualDoModelo = 6;

    await req(
      '/campanhas/k-1/agendamento',
      {
        method: 'POST',
        body: JSON.stringify({ agendadaPara: '2099-01-01T09:00:00Z' }),
        headers: { 'content-type': 'application/json' },
      },
      evento(),
    );

    expect(estado.campanha?.templateVersao).toBe(6);
  });
});
