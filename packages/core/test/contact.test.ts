import { describe, it, expect } from 'vitest';
import {
  EmailAddress,
  TENANT_PADRAO,
  contactId,
  unwrap,
  verificarElegibilidade,
  type Contact,
} from '../src/index.js';

describe('elegibilidade — recebe por padrão', () => {
  const base = (over: Partial<Contact> = {}): Contact =>
    ({
      tenantId: TENANT_PADRAO,
      contactId: contactId('c-1'),
      email: unwrap(EmailAddress.create('pessoa@exemplo.com')),
      camposCustomizados: {},
      status: 'ATIVO',
      relacionamento: 'CLIENTE_ATIVO',
      criadoEm: new Date('2020-01-01'),
      atualizadoEm: new Date('2020-01-01'),
      origem: 'manual',
      ...over,
    }) as Contact;

  const AGORA = new Date('2026-08-09T12:00:00Z');

  it('contato sem registro de base legal recebe', () => {
    // Era o caso mais comum e o mais invisível: a tela de criação nunca
    // preenchia esse registro, então todo contato do painel nascia bloqueado.
    expect(verificarElegibilidade(base(), AGORA).elegivel).toBe(true);
  });

  it('vínculo não classificado recebe', () => {
    expect(verificarElegibilidade(base({ relacionamento: 'DESCONHECIDO' }), AGORA).elegivel).toBe(
      true,
    );
  });

  it('vínculo antigo recebe', () => {
    const antigo = base({ relacionamentoDesde: new Date('2015-01-01') });
    expect(verificarElegibilidade(antigo, AGORA).elegivel).toBe(true);
  });

  // O que segue bloqueando, e por quê. Descadastro é direito do titular;
  // bounce e reclamação são o que derruba a reputação de envio da conta.
  for (const status of [
    'DESCADASTRADO',
    'OPOSICAO',
    'BOUNCE',
    'RECLAMACAO',
    'SUPRIMIDO',
  ] as const) {
    it(`${status} continua bloqueado`, () => {
      const r = verificarElegibilidade(base({ status }), AGORA);
      expect(r.elegivel).toBe(false);
      expect(r.motivos).toEqual([{ motivo: 'STATUS', status }]);
    });
  }
});
