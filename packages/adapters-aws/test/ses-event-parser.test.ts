import { describe, it, expect } from 'vitest';
import { TENANT_PADRAO } from '@emailmkt/core';
import { desembrulharMensagem, traduzirEventoSes } from '../src/email/ses-event-parser.js';

const traduzir = (bruto: unknown) => traduzirEventoSes(bruto, TENANT_PADRAO);

const mail = (over: Record<string, unknown> = {}) => ({
  messageId: 'ses-msg-1',
  timestamp: '2026-08-07T10:00:00.000Z',
  destination: ['titular@exemplo.com'],
  ...over,
});

describe('tradução de evento do SES — §5.10', () => {
  it('traduz entrega', () => {
    const e = traduzir({
      eventType: 'Delivery',
      mail: mail(),
      delivery: { timestamp: '2026-08-07T10:00:05.000Z' },
    });

    expect(e).toMatchObject({
      sesMessageId: 'ses-msg-1',
      tipo: 'DELIVERY',
      destinatario: 'titular@exemplo.com',
    });
    expect(e?.ocorridoEm.toISOString()).toBe('2026-08-07T10:00:05.000Z');
  });

  it('usa o instante DO EVENTO, não o do envio', () => {
    // Se caísse no mail.timestamp, todas as aberturas de uma campanha teriam o
    // mesmo instante e a chave de deduplicação as trataria como uma só (§5.4).
    const primeira = traduzir({
      eventType: 'Open',
      mail: mail(),
      open: { timestamp: '2026-08-07T11:00:00.000Z' },
    });
    const segunda = traduzir({
      eventType: 'Open',
      mail: mail(),
      open: { timestamp: '2026-08-07T15:30:00.000Z' },
    });

    expect(primeira?.ocorridoEm).not.toEqual(segunda?.ocorridoEm);
  });

  it('cai no timestamp do envio quando a seção não traz instante', () => {
    const e = traduzir({ eventType: 'Send', mail: mail() });
    expect(e?.ocorridoEm.toISOString()).toBe('2026-08-07T10:00:00.000Z');
  });

  it('extrai subtipo e destinatário do bounce', () => {
    const e = traduzir({
      eventType: 'Bounce',
      mail: mail({ destination: ['outro@exemplo.com'] }),
      bounce: {
        bounceType: 'Permanent',
        timestamp: '2026-08-07T10:01:00.000Z',
        bouncedRecipients: [
          { emailAddress: 'quebrado@exemplo.com', diagnosticCode: '550 5.1.1 user unknown' },
        ],
      },
    });

    expect(e).toMatchObject({
      tipo: 'BOUNCE',
      subtipoBounce: 'Permanent',
      // O destinatário do bounce, não o do envelope: é dele que veio o problema.
      destinatario: 'quebrado@exemplo.com',
      diagnostico: '550 5.1.1 user unknown',
    });
  });

  it('trata bounce Undetermined como transitório', () => {
    // Suprimir por bounce que o próprio servidor não soube classificar
    // descartaria contatos válidos, e supressão é permanente.
    const e = traduzir({
      eventType: 'Bounce',
      mail: mail(),
      bounce: { bounceType: 'Undetermined', bouncedRecipients: [] },
    });

    expect(e?.subtipoBounce).toBe('Undetermined');
  });

  it('extrai o destinatário da reclamação', () => {
    const e = traduzir({
      eventType: 'Complaint',
      mail: mail(),
      complaint: { complainedRecipients: [{ emailAddress: 'reclamou@exemplo.com' }] },
    });

    expect(e).toMatchObject({ tipo: 'COMPLAINT', destinatario: 'reclamou@exemplo.com' });
  });

  it('extrai a URL clicada', () => {
    const e = traduzir({
      eventType: 'Click',
      mail: mail(),
      click: { timestamp: '2026-08-07T12:00:00.000Z', link: 'https://exemplo.com/artigo' },
    });

    expect(e?.urlClicada).toBe('https://exemplo.com/artigo');
  });

  it('aceita notificationType além de eventType', () => {
    const e = traduzir({ notificationType: 'Delivery', mail: mail() });
    expect(e?.tipo).toBe('DELIVERY');
  });

  it.each([
    ['payload vazio', {}],
    ['sem messageId', { eventType: 'Delivery', mail: { timestamp: 'x' } }],
    ['tipo desconhecido', { eventType: 'AlgoNovoDaAWS', mail: mail() }],
    ['não é objeto', 'texto solto'],
    ['nulo', null],
  ])('devolve null para %s em vez de lançar', (_caso, bruto) => {
    // Formato inesperado deve ir para a DLQ para inspeção, não derrubar o lote.
    expect(traduzir(bruto)).toBeNull();
  });

  it('data inválida não gera Invalid Date', () => {
    const e = traduzir({
      eventType: 'Delivery',
      mail: mail({ timestamp: 'não é data' }),
      delivery: { timestamp: 'nem isso' },
    });

    expect(Number.isNaN(e?.ocorridoEm.getTime())).toBe(false);
  });
});

describe('desembrulho da mensagem do SQS', () => {
  it('lê o evento direto quando a entrega é bruta', () => {
    const corpo = JSON.stringify({ eventType: 'Delivery', mail: mail() });
    expect(desembrulharMensagem(corpo)).toMatchObject({ eventType: 'Delivery' });
  });

  it('lê o evento dentro do envelope do SNS', () => {
    // Aceitar os dois formatos evita que uma mudança na configuração do tópico
    // quebre o processamento em silêncio.
    const interno = JSON.stringify({ eventType: 'Bounce', mail: mail() });
    const envelope = JSON.stringify({ Type: 'Notification', Message: interno });

    expect(desembrulharMensagem(envelope)).toMatchObject({ eventType: 'Bounce' });
  });

  it('devolve null para corpo que não é JSON', () => {
    expect(desembrulharMensagem('{{{')).toBeNull();
  });

  it('devolve null quando o Message do envelope não é JSON', () => {
    const envelope = JSON.stringify({ Message: 'nem json nem nada' });
    expect(desembrulharMensagem(envelope)).toBeNull();
  });
});
