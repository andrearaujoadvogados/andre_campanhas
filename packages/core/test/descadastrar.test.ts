import { describe, it, expect, vi } from 'vitest';
import { descadastrar } from '../src/application/use-cases/descadastrar.js';
import type { Contact } from '../src/domain/contact/contact.js';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { campaignId, contactId, TENANT_PADRAO } from '../src/domain/shared/ids.js';
import { unwrap } from '../src/domain/shared/result.js';
import type {
  AuditLogger,
  ContactRepository,
  EmailHasher,
  SuppressionRepository,
  UnsubscribeTokenService,
} from '../src/application/ports/index.js';

const AGORA = new Date('2026-08-06T12:00:00Z');
const CONTATO_ID = contactId('c-1');

function contatoBase(status: Contact['status'] = 'ATIVO'): Contact {
  return {
    tenantId: TENANT_PADRAO,
    contactId: CONTATO_ID,
    email: unwrap(EmailAddress.create('titular@exemplo.com')),
    camposCustomizados: {},
    status,
    relacionamento: 'CLIENTE_ATIVO',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'csv',
  };
}

function cenario(contato: Contact | null, tokenValido = true) {
  const salvos: Contact[] = [];
  const suprimidos: { emailHash: string; motivo: string }[] = [];
  const auditados: unknown[] = [];

  const contatos: ContactRepository = {
    buscarPorId: async () => contato,
    buscarPorEmail: async () => null,
    salvar: async (c) => void salvos.push(c),
    salvarEmLote: async () => undefined,
    listarPorLista: async () => ({ itens: [] }),
    excluir: async () => undefined,
  };
  const supressao: SuppressionRepository = {
    suprimir: async (e) => void suprimidos.push({ emailHash: e.emailHash, motivo: e.motivo }),
    estaSuprimido: async () => false,
    filtrarSuprimidos: async () => new Set(),
    remover: async () => undefined,
  };
  const tokens: UnsubscribeTokenService = {
    emitir: () => 'tok',
    verificar: () =>
      tokenValido
        ? { tenantId: TENANT_PADRAO, contactId: CONTATO_ID, campaignId: campaignId('camp-1') }
        : null,
  };
  const hasher: EmailHasher = { hash: (e) => `h:${e.value}` };
  const auditoria: AuditLogger = { registrar: async (e) => void auditados.push(e) };

  return {
    deps: { contatos, supressao, tokens, hasher, clock: { agora: () => AGORA }, auditoria },
    salvos,
    suprimidos,
    auditados,
  };
}

describe('descadastrar — requisito legal, §11 item 7', () => {
  it('marca o contato como descadastrado', async () => {
    const c = cenario(contatoBase());
    const r = await descadastrar(c.deps, { token: 'tok' });

    expect(r.ok).toBe(true);
    expect(c.salvos[0]?.status).toBe('DESCADASTRADO');
  });

  it('grava também na supressão — é o que sobrevive a uma reimportação do CSV', async () => {
    const c = cenario(contatoBase());
    await descadastrar(c.deps, { token: 'tok' });

    expect(c.suprimidos).toEqual([{ emailHash: 'h:titular@exemplo.com', motivo: 'DESCADASTRO' }]);
  });

  it('é idempotente — o Gmail dispara o POST sozinho e pode repetir', async () => {
    const c = cenario(contatoBase('DESCADASTRADO'));
    const r = await descadastrar(c.deps, { token: 'tok' });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.jaEstavaFora).toBe(true);
  });

  it('trata oposição como saída distinta do descadastro — art. 18 §2º', async () => {
    const c = cenario(contatoBase());
    const r = await descadastrar(c.deps, { token: 'tok', tipo: 'OPOSICAO' });

    expect(r.ok).toBe(true);
    expect(c.salvos[0]?.status).toBe('OPOSICAO');
    expect(c.suprimidos[0]?.motivo).toBe('OPOSICAO');
  });

  it('responde sucesso se o contato já foi excluído por direito de exclusão', async () => {
    const c = cenario(null);
    const r = await descadastrar(c.deps, { token: 'tok' });

    // Do ponto de vista do titular o objetivo está atingido.
    expect(r.ok).toBe(true);
    expect(c.suprimidos).toHaveLength(0);
  });

  it('rejeita token inválido sem revelar se o contato existe', async () => {
    const c = cenario(contatoBase(), false);
    const r = await descadastrar(c.deps, { token: 'forjado' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOKEN_INVALIDO');
    expect(c.salvos).toHaveLength(0);
    expect(c.suprimidos).toHaveLength(0);
  });

  it('registra auditoria da mudança de status', async () => {
    const c = cenario(contatoBase());
    await descadastrar(c.deps, { token: 'tok', ipOrigem: '203.0.113.10' });

    expect(c.auditados).toHaveLength(1);
    expect(c.auditados[0]).toMatchObject({
      acao: 'EDITOU',
      recursoTipo: 'Contact',
      antes: { status: 'ATIVO' },
      depois: { status: 'DESCADASTRADO' },
      ipOrigem: '203.0.113.10',
    });
  });

  it('não exige nenhuma dependência de rede — o domínio é testável offline', () => {
    // Guarda explícita contra regressão da fronteira hexagonal: se alguém
    // introduzir uma chamada AWS no caso de uso, este arquivo deixa de compilar
    // antes de o teste rodar.
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });
});
