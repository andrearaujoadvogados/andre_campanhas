import { describe, it, expect } from 'vitest';
import {
  aplicarSelecaoIndividual,
  resolverAudiencia,
} from '../src/application/use-cases/resolver-audiencia.js';
import { verificarElegibilidade, type Contact } from '../src/domain/contact/contact.js';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { contactId, listId, TENANT_PADRAO } from '../src/domain/shared/ids.js';
import { unwrap } from '../src/domain/shared/result.js';
import { temRelacionamento, todos } from '../src/domain/segment/specification.js';
import type {
  ContactRepository,
  EmailHasher,
  SuppressionRepository,
} from '../src/application/ports/index.js';

const AGORA = new Date('2026-08-06T12:00:00Z');
const clock = { agora: () => AGORA };

// Adaptadores em memória — só possíveis porque o core não conhece AWS (§5.1).
const hasher: EmailHasher = { hash: (e) => `h:${e.value}` };

type OverrideContato = Omit<Partial<Contact>, 'email'> & { email: string };

function contato(over: OverrideContato): Contact {
  const { email, ...resto } = over;
  return {
    tenantId: TENANT_PADRAO,
    contactId: contactId(`c-${email}`),
    email: unwrap(EmailAddress.create(email)),
    camposCustomizados: {},
    status: 'ATIVO',
    relacionamento: 'CLIENTE_ATIVO',
    relacionamentoDesde: new Date('2025-06-01T00:00:00Z'),
    baseLegal: {
      base: 'LEGITIMO_INTERESSE',
      liaVersao: 'lia-2026-08',
      finalidade: 'Comunicação informativa a clientes',
      evidenciaRelacionamento: 'Contrato ativo',
      origemDeclarada: 'base-escritorio',
      registradoEm: AGORA,
    },
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'csv',
    ...resto,
  };
}

function repos(contatos: Contact[], suprimidos: string[] = []) {
  const contactRepo: ContactRepository = {
    listarPorLista: async () => ({ itens: contatos }),
    buscarPorId: async () => null,
    buscarPorEmail: async () => null,
    salvar: async () => undefined,
    salvarEmLote: async () => undefined,
    excluir: async () => undefined,
  };
  const suppressionRepo: SuppressionRepository = {
    filtrarSuprimidos: async (_t, hashes) => new Set(hashes.filter((h) => suprimidos.includes(h))),
    estaSuprimido: async (_t, h) => suprimidos.includes(h),
    suprimir: async () => undefined,
    remover: async () => undefined,
  };
  return { contatos: contactRepo, supressao: suppressionRepo, hasher, clock };
}

describe('resolverAudiencia', () => {
  const input = { tenantId: TENANT_PADRAO, listId: listId('l-1'), segmento: todos<Contact>() };

  it('inclui contato ativo, com vínculo e base legal', async () => {
    const r = await resolverAudiencia(repos([contato({ email: 'ok@exemplo.com' })]), input);
    expect(r.elegiveis).toHaveLength(1);
    expect(r.excluidos.total).toBe(0);
  });

  // As três condições abaixo excluíam, e deixaram de excluir por decisão do
  // escritório em 2026-08-09. Os testes permanecem, invertidos, porque o valor
  // deles agora é outro: garantir que ninguém as reintroduza sem perceber.

  it('relacionamento DESCONHECIDO recebe', async () => {
    const r = await resolverAudiencia(
      repos([contato({ email: 'x@exemplo.com', relacionamento: 'DESCONHECIDO' })]),
      input,
    );
    expect(r.elegiveis).toHaveLength(1);
  });

  it('contato sem base legal registrada recebe', async () => {
    // Era o caso que mais doía: a tela de criação nunca preenchia esse registro,
    // então todo contato cadastrado pelo painel nascia permanentemente
    // inelegível — e a tela não dizia o que fazer a respeito.
    const semBase = contato({ email: 'y@exemplo.com' });
    const { baseLegal: _b, ...resto } = semBase;
    const r = await resolverAudiencia(repos([resto as Contact]), input);

    expect(r.elegiveis).toHaveLength(1);
  });

  it('vínculo antigo recebe', async () => {
    const antigo = contato({
      email: 'antigo@exemplo.com',
      relacionamento: 'EX_CLIENTE',
      relacionamentoDesde: new Date('2020-01-01T00:00:00Z'),
    });
    const r = await resolverAudiencia(repos([antigo]), input);

    expect(r.elegiveis).toHaveLength(1);
  });

  it.each(['DESCADASTRADO', 'OPOSICAO', 'BOUNCE', 'RECLAMACAO', 'SUPRIMIDO'] as const)(
    'exclui contato com status %s',
    async (status) => {
      const r = await resolverAudiencia(
        repos([contato({ email: 'z@exemplo.com', status })]),
        input,
      );
      expect(r.elegiveis).toHaveLength(0);
      expect(r.excluidos.porMotivo[`STATUS_${status}`]).toBe(1);
    },
  );

  it('exclui quem está na lista de supressão, mesmo com status ATIVO', async () => {
    // O caso que a supressão existe para cobrir: contato reimportado do CSV com
    // status limpo, mas que já havia pedido para sair (§6.2, nota 2).
    const reimportado = contato({ email: 'saiu@exemplo.com' });
    const r = await resolverAudiencia(repos([reimportado], ['h:saiu@exemplo.com']), input);

    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidos.porMotivo['SUPRIMIDO']).toBe(1);
  });

  it('deduplica o mesmo endereço escrito de formas diferentes', async () => {
    const r = await resolverAudiencia(
      repos([contato({ email: 'Joao@Exemplo.com' }), contato({ email: ' joao@exemplo.com ' })]),
      input,
    );

    expect(r.elegiveis).toHaveLength(1);
    expect(r.excluidos.porMotivo['DUPLICADO_NA_LISTA']).toBe(1);
  });

  it('aplica o segmento antes dos demais filtros', async () => {
    const r = await resolverAudiencia(
      repos([
        contato({ email: 'cliente@exemplo.com', relacionamento: 'CLIENTE_ATIVO' }),
        contato({ email: 'evento@exemplo.com', relacionamento: 'EVENTO' }),
      ]),
      { ...input, segmento: temRelacionamento('CLIENTE_ATIVO') },
    );

    expect(r.elegiveis).toHaveLength(1);
    expect(r.excluidos.porMotivo['FORA_DO_SEGMENTO']).toBe(1);
  });

  it('reporta os motivos de exclusão — o operador precisa saber por quê', async () => {
    const r = await resolverAudiencia(
      repos(
        [
          contato({ email: 'a@exemplo.com' }),
          contato({ email: 'b@exemplo.com', relacionamento: 'DESCONHECIDO' }),
          contato({ email: 'c@exemplo.com', status: 'BOUNCE' }),
          contato({ email: 'd@exemplo.com' }),
        ],
        ['h:d@exemplo.com'],
      ),
      input,
    );

    // O de vínculo desconhecido agora recebe; sobram o bounce e o suprimido.
    expect(r.elegiveis).toHaveLength(2);
    expect(r.excluidos).toEqual({
      total: 2,
      porMotivo: { STATUS_BOUNCE: 1, SUPRIMIDO: 1 },
    });
  });
});

describe('leads e filtro de tags — §5', () => {
  const input = { tenantId: TENANT_PADRAO, listId: listId('l-1'), segmento: todos<Contact>() };

  it('lead não recebe por padrão', async () => {
    const r = await resolverAudiencia(
      repos([contato({ email: 'lead@exemplo.com', isLead: true })]),
      input,
    );
    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidos.porMotivo['LEAD']).toBe(1);
  });

  it('lead recebe quando a campanha marca incluir leads', async () => {
    const r = await resolverAudiencia(
      repos([contato({ email: 'lead@exemplo.com', isLead: true })]),
      {
        ...input,
        incluirLeads: true,
      },
    );
    expect(r.elegiveis).toHaveLength(1);
  });

  it('filtra por tag com lógica OU; sem tag pedida, não filtra', async () => {
    const contatos = [
      contato({ email: 'trib@exemplo.com', tags: ['tributário'] }),
      contato({ email: 'trab@exemplo.com', tags: ['trabalhista'] }),
      contato({ email: 'sem@exemplo.com' }),
    ];

    const semFiltro = await resolverAudiencia(repos(contatos), input);
    expect(semFiltro.elegiveis).toHaveLength(3);

    const comFiltro = await resolverAudiencia(repos(contatos), {
      ...input,
      tagsFiltro: ['Tributário', 'previdenciário'],
    });
    // Case-insensitive: "Tributário" casa "tributário". Os outros dois saem.
    expect(comFiltro.elegiveis).toHaveLength(1);
    expect(comFiltro.excluidos.porMotivo['FORA_DO_FILTRO_DE_TAGS']).toBe(2);
  });
});

describe('seleção individual — Etapa 3', () => {
  const ana = contato({ email: 'ana@exemplo.com' });
  const bruno = contato({ email: 'bruno@exemplo.com' });
  const carla = contato({ email: 'carla@exemplo.com' });
  const elegiveis = [ana, bruno, carla];

  it('sem seleção, vai para todos os elegíveis', () => {
    expect(aplicarSelecaoIndividual(elegiveis, undefined)).toHaveLength(3);
  });

  it('com seleção, vai só para os escolhidos', () => {
    const r = aplicarSelecaoIndividual(elegiveis, [String(ana.contactId), String(carla.contactId)]);
    expect(r.map((c) => c.email.value)).toEqual(['ana@exemplo.com', 'carla@exemplo.com']);
  });

  it('SELEÇÃO VAZIA NÃO VIRA "TODOS" — o operador desmarcou todo mundo', () => {
    // A regressão que este teste tranca: seleção vazia era tratada como ausente,
    // e o disparo saía para a lista inteira com a tela dizendo "0 selecionados".
    // Enviar para ninguém é recuperável; enviar para todos não é.
    expect(aplicarSelecaoIndividual(elegiveis, [])).toHaveLength(0);
  });

  it('id que não está entre os elegíveis é ignorado, não promove ninguém', () => {
    // Um contato pode ter sido descadastrado entre a prévia e o disparo: sai da
    // audiência e o id remanescente na seleção não deve trazê-lo de volta.
    const r = aplicarSelecaoIndividual(elegiveis, [String(bruno.contactId), 'c-fantasma@nada.com']);
    expect(r).toHaveLength(1);
    expect(r[0]?.email.value).toBe('bruno@exemplo.com');
  });
});

describe('verificarElegibilidade', () => {
  it('o status é o que bloqueia, e o motivo diz qual', () => {
    // Sobrou uma condição só. O motivo carrega o status para que a tela consiga
    // dizer "marcou como spam" em vez de "inelegível".
    const ruim = contato({
      email: 'ruim@exemplo.com',
      status: 'BOUNCE',
      relacionamento: 'DESCONHECIDO',
    });
    const { elegivel, motivos } = verificarElegibilidade(ruim, AGORA);

    expect(elegivel).toBe(false);
    expect(motivos).toEqual([{ motivo: 'STATUS', status: 'BOUNCE' }]);
  });
});
