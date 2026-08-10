import { describe, it, expect } from 'vitest';
import { itemParaCampanha } from '../src/mappers/campaign-mapper.js';

/** Item cru como o DynamoDB devolve — só os campos que o mapper exige. */
function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: 'andrearaujo',
    campaignId: 'k-1',
    nome: 'Boletim de agosto',
    templateId: 't-1',
    templateVersao: 1,
    listId: 'l-1',
    status: 'RASCUNHO',
    remetenteNome: 'André Araújo Advogados',
    remetenteEmail: 'contato@mail.andrearaujoadvogados.com.br',
    criadoPor: 'u-1',
    criadoEm: '2026-08-07T12:00:00.000Z',
    ...over,
  };
}

describe('status do fluxo antigo — campanhas gravadas antes de 2026-08-10', () => {
  // O portão de aprovação foi removido e `EM_REVISAO`/`APROVADA` saíram do
  // domínio. O banco, porém, guarda strings: sem tradução, o valor cru chegaria
  // ao domínio como um estado que `TRANSICOES` não conhece, e a campanha ficaria
  // inoperável — cancelar ou agendar derrubaria a Lambda com TypeError.
  it.each(['EM_REVISAO', 'APROVADA'])('%s é lido como RASCUNHO', (legado) => {
    expect(itemParaCampanha(item({ status: legado })).status).toBe('RASCUNHO');
  });

  it('não mexe nos status que continuam existindo', () => {
    for (const s of ['RASCUNHO', 'AGENDADA', 'ENVIANDO', 'PAUSADA', 'CONCLUIDA', 'CANCELADA']) {
      expect(itemParaCampanha(item({ status: s })).status).toBe(s);
    }
  });

  it('a campanha traduzida volta a ser operável', () => {
    // O ponto da tradução: uma campanha que estava APROVADA precisa poder ser
    // disparada ou cancelada de novo, e não só ser lida sem quebrar.
    const c = itemParaCampanha(item({ status: 'APROVADA' }));
    expect(c.nome).toBe('Boletim de agosto');
    expect(c.status).toBe('RASCUNHO');
  });
});
