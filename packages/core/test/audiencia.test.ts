import { describe, it, expect } from 'vitest';
import { resolverAudiencia } from '../src/application/use-cases/resolver-audiencia.js';
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

  it('exclui relacionamento DESCONHECIDO — §6.2', async () => {
    const r = await resolverAudiencia(
      repos([contato({ email: 'x@exemplo.com', relacionamento: 'DESCONHECIDO' })]),
      input,
    );
    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidos.porMotivo['RELACIONAMENTO_DESCONHECIDO']).toBe(1);
  });

  it('exclui contato sem base legal registrada', async () => {
    const semBase = contato({ email: 'y@exemplo.com' });
    const { baseLegal: _b, ...resto } = semBase;
    const r = await resolverAudiencia(repos([resto as Contact]), input);

    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidos.porMotivo['SEM_BASE_LEGAL']).toBe(1);
  });

  it('exclui vínculo expirado — legítimo interesse não é permanente (§10.2)', async () => {
    const antigo = contato({
      email: 'antigo@exemplo.com',
      relacionamento: 'EX_CLIENTE',
      relacionamentoDesde: new Date('2020-01-01T00:00:00Z'),
    });
    const r = await resolverAudiencia(repos([antigo]), input);

    expect(r.elegiveis).toHaveLength(0);
    expect(r.excluidos.porMotivo['VINCULO_EXPIRADO']).toBe(1);
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

    expect(r.elegiveis).toHaveLength(1);
    expect(r.excluidos).toEqual({
      total: 3,
      porMotivo: { RELACIONAMENTO_DESCONHECIDO: 1, STATUS_BOUNCE: 1, SUPRIMIDO: 1 },
    });
  });
});

describe('verificarElegibilidade acumula motivos', () => {
  it('reporta todos os problemas de uma vez, não só o primeiro', () => {
    const ruim = contato({
      email: 'ruim@exemplo.com',
      status: 'BOUNCE',
      relacionamento: 'DESCONHECIDO',
    });
    const { motivos } = verificarElegibilidade(ruim, AGORA);

    expect(motivos).toHaveLength(2);
  });
});
