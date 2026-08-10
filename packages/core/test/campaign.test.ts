import { describe, it, expect } from 'vitest';
import {
  agendar,
  concluir,
  deveInterromperEnvio,
  falhar,
  iniciarEnvio,
  pausar,
  podeTransicionar,
  registrarDisparo,
  retomar,
  type Campaign,
} from '../src/domain/campaign/campaign.js';
import { campaignId, listId, templateId, TENANT_PADRAO, userId } from '../src/domain/shared/ids.js';
import { unwrap } from '../src/domain/shared/result.js';

const AUTOR = userId('u-operador');
const AGORA = new Date('2026-08-06T12:00:00Z');

function campanha(over: Partial<Campaign> = {}): Campaign {
  return {
    tenantId: TENANT_PADRAO,
    campaignId: campaignId('c-1'),
    nome: 'Boletim tributário — agosto',
    templateId: templateId('t-1'),
    templateVersao: 1,
    listId: listId('l-1'),
    status: 'RASCUNHO',
    remetenteNome: 'André Araújo Advogados',
    remetenteEmail: 'contato@mail.andrearaujoadvogados.com.br',
    criadoPor: AUTOR,
    criadoEm: AGORA,
    ...over,
  };
}

describe('máquina de estados da campanha — sem aprovação', () => {
  it('permite o caminho agendado completo', () => {
    let c = unwrap(agendar(campanha(), new Date('2026-08-07T09:00:00Z'), AGORA));
    expect(c.status).toBe('AGENDADA');

    c = unwrap(iniciarEnvio(c, AGORA));
    expect(c.status).toBe('ENVIANDO');

    c = unwrap(pausar(c));
    expect(c.status).toBe('PAUSADA');

    c = unwrap(retomar(c));
    expect(c.status).toBe('ENVIANDO');

    c = unwrap(concluir(c));
    expect(c.status).toBe('CONCLUIDA');
  });

  it('permite disparo imediato a partir do rascunho, sem revisão nem aprovação', () => {
    const c = unwrap(iniciarEnvio(campanha(), AGORA));
    expect(c.status).toBe('ENVIANDO');
  });

  it('impede estados impossíveis', () => {
    expect(podeTransicionar('CONCLUIDA', 'ENVIANDO')).toBe(false);
    expect(podeTransicionar('CANCELADA', 'ENVIANDO')).toBe(false);
    // Não existe mais o portão: RASCUNHO vai direto para ENVIANDO.
    expect(podeTransicionar('RASCUNHO', 'ENVIANDO')).toBe(true);

    const concluida = campanha({ status: 'CONCLUIDA' });
    expect(pausar(concluida).ok).toBe(false);
    expect(concluir(concluida).ok).toBe(false);
  });

  it('rejeita agendamento no passado', () => {
    const r = agendar(campanha(), new Date('2026-08-05T09:00:00Z'), AGORA);
    expect(r.ok).toBe(false);
  });
});

describe('auditoria do disparo — substitui a aprovação', () => {
  it('registrarDisparo grava quem disparou e o fingerprint do conteúdo', () => {
    const c = registrarDisparo(campanha(), AUTOR, 'hash-abc');
    expect(c.enviadaPor).toBe(AUTOR);
    expect(c.hashConteudoEnviado).toBe('hash-abc');
    // Não transiciona por si só: o carimbo é separado da mudança de estado.
    expect(c.status).toBe('RASCUNHO');
  });

  it('iniciarEnvio carimba o instante do disparo', () => {
    const c = unwrap(iniciarEnvio(campanha(), AGORA));
    expect(c.disparadaEm).toEqual(AGORA);
  });

  it('iniciarEnvio recusa campanha que não está pronta para sair', () => {
    const r = iniciarEnvio(campanha({ status: 'CONCLUIDA' }), AGORA);
    expect(r.ok).toBe(false);
  });
});

describe('falha de disparo', () => {
  it('ENVIANDO pode ir para FALHA e daí voltar para rascunho', () => {
    const enviando = unwrap(iniciarEnvio(campanha(), AGORA));
    const falhou = unwrap(falhar(enviando));
    expect(falhou.status).toBe('FALHA');
    expect(podeTransicionar('FALHA', 'RASCUNHO')).toBe(true);
  });
});

describe('interrupção do envio — ADR-05', () => {
  it.each([
    ['PAUSADA', true],
    ['CANCELADA', true],
    ['CONCLUIDA', true],
    ['FALHA', true],
    ['ENVIANDO', false],
  ] as const)('status %s → interrompe: %s', (status, esperado) => {
    expect(deveInterromperEnvio(status)).toBe(esperado);
  });
});
