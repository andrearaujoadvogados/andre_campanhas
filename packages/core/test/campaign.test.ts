import { describe, it, expect } from 'vitest';
import {
  aprovar,
  agendar,
  cancelar,
  concluir,
  deveInterromperEnvio,
  enviarParaRevisao,
  iniciarEnvio,
  pausar,
  podeTransicionar,
  revogarAprovacaoPorEdicao,
  verificarAprovacaoVigente,
  type Campaign,
} from '../src/domain/campaign/campaign.js';
import { campaignId, listId, templateId, TENANT_PADRAO, userId } from '../src/domain/shared/ids.js';
import { unwrap } from '../src/domain/shared/result.js';

const AUTOR = userId('u-operador');
const REVISOR = userId('u-advogado');
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

describe('máquina de estados da campanha', () => {
  it('permite o caminho feliz completo', () => {
    let c = unwrap(enviarParaRevisao(campanha()));
    expect(c.status).toBe('EM_REVISAO');

    c = unwrap(aprovar(c, REVISOR, 'hash-abc', AGORA));
    expect(c.status).toBe('APROVADA');

    c = unwrap(agendar(c, new Date('2026-08-07T09:00:00Z'), AGORA));
    expect(c.status).toBe('AGENDADA');

    c = unwrap(iniciarEnvio(c, 'hash-abc'));
    expect(c.status).toBe('ENVIANDO');

    c = unwrap(pausar(c));
    expect(c.status).toBe('PAUSADA');

    c = unwrap(cancelar(c));
    expect(c.status).toBe('CANCELADA');
  });

  it('impede estados impossíveis', () => {
    expect(podeTransicionar('CONCLUIDA', 'ENVIANDO')).toBe(false);
    expect(podeTransicionar('CANCELADA', 'ENVIANDO')).toBe(false);
    expect(podeTransicionar('RASCUNHO', 'ENVIANDO')).toBe(false);

    const concluida = campanha({ status: 'CONCLUIDA' });
    expect(pausar(concluida).ok).toBe(false);
    expect(concluir(concluida).ok).toBe(false);
  });

  it('não deixa uma campanha não aprovada ser agendada', () => {
    const rascunho = campanha({ status: 'RASCUNHO' });
    const r = agendar(rascunho, new Date('2026-09-01T09:00:00Z'), AGORA);
    expect(r.ok).toBe(false);
  });

  it('rejeita agendamento no passado', () => {
    const aprovada = campanha({ status: 'APROVADA' });
    const r = agendar(aprovada, new Date('2026-08-05T09:00:00Z'), AGORA);
    expect(r.ok).toBe(false);
  });
});

describe('aprovação', () => {
  it('o autor aprova a própria campanha', () => {
    // A exigência de um segundo revisor caiu em 2026-08-08: o sistema é de uso
    // interno e quem escreve a campanha é o advogado responsável por ela.
    const emRevisao = unwrap(enviarParaRevisao(campanha()));
    const r = aprovar(emRevisao, AUTOR, 'hash-abc', AGORA);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('APROVADA');
  });

  it('só aprova campanha em revisão', () => {
    const r = aprovar(campanha({ status: 'RASCUNHO' }), REVISOR, 'hash-abc', AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('APROVACAO_INVALIDA');
  });

  it('registra quem aprovou, quando e sobre qual conteúdo', () => {
    const emRevisao = unwrap(enviarParaRevisao(campanha()));
    const aprovada = unwrap(aprovar(emRevisao, REVISOR, 'hash-abc', AGORA));

    expect(aprovada.aprovacao).toEqual({
      aprovadoPor: REVISOR,
      aprovadoEm: AGORA,
      hashConteudoAprovado: 'hash-abc',
    });
  });

  it('BLOQUEIA o envio se o conteúdo mudou depois da aprovação', () => {
    const emRevisao = unwrap(enviarParaRevisao(campanha()));
    const aprovada = unwrap(aprovar(emRevisao, REVISOR, 'hash-do-que-foi-revisado', AGORA));

    // Alguém editou o template depois do aval do advogado responsável.
    const r = iniciarEnvio(aprovada, 'hash-de-outra-coisa');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONTEUDO_ALTERADO_APOS_APROVACAO');
  });

  it('deixa enviar quando o conteúdo é o mesmo que foi aprovado', () => {
    const emRevisao = unwrap(enviarParaRevisao(campanha()));
    const aprovada = unwrap(aprovar(emRevisao, REVISOR, 'hash-abc', AGORA));

    expect(iniciarEnvio(aprovada, 'hash-abc').ok).toBe(true);
  });

  it('recusa envio de campanha que nunca foi aprovada', () => {
    const r = iniciarEnvio(campanha({ status: 'APROVADA' }), 'hash-abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('APROVACAO_INVALIDA');
  });

  it('edição devolve a campanha para rascunho e descarta a aprovação', () => {
    const emRevisao = unwrap(enviarParaRevisao(campanha()));
    const aprovada = unwrap(aprovar(emRevisao, REVISOR, 'hash-abc', AGORA));

    const editada = revogarAprovacaoPorEdicao(aprovada);

    expect(editada.status).toBe('RASCUNHO');
    expect(editada.aprovacao).toBeUndefined();
  });

  it('verificarAprovacaoVigente falha em campanha sem aprovação', () => {
    const r = verificarAprovacaoVigente(campanha(), 'qualquer');
    expect(r.ok).toBe(false);
  });
});

describe('interrupção do envio — ADR-05', () => {
  it.each([
    ['PAUSADA', true],
    ['CANCELADA', true],
    ['CONCLUIDA', true],
    ['ENVIANDO', false],
  ] as const)('status %s → interrompe: %s', (status, esperado) => {
    expect(deveInterromperEnvio(status)).toBe(esperado);
  });
});
