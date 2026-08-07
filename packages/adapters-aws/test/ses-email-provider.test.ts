import { describe, it, expect, vi } from 'vitest';
import type { SESv2Client } from '@aws-sdk/client-sesv2';
import { EmailAddress, unwrap, type MensagemEmail } from '@emailmkt/core';
import { SesEmailProvider } from '../src/email/ses-email-provider.js';

function mensagem(): MensagemEmail {
  return {
    para: unwrap(EmailAddress.create('destinatario@exemplo.com')),
    deNome: 'André Araújo Advogados',
    deEmail: 'contato@mail.andrearaujoadvogados.com.br',
    assunto: 'Boletim tributário',
    corpoHtml: '<p>Olá</p>',
    corpoTexto: 'Olá',
    listUnsubscribeUrl: 'https://exemplo.com/u?t=abc',
    configurationSet: 'cs',
    tags: { campanha: 'camp-1', tenant: 'andrearaujo' },
  };
}

function clienteFalso(resposta: unknown): SESv2Client {
  return {
    send: vi.fn().mockImplementation(() => {
      if (resposta instanceof Error) return Promise.reject(resposta);
      return Promise.resolve(resposta);
    }),
  } as unknown as SESv2Client;
}

function erroSes(name: string): Error {
  const e = new Error(`simulado: ${name}`);
  e.name = name;
  return e;
}

describe('SesEmailProvider — envio', () => {
  it('devolve o messageId no sucesso', async () => {
    const provider = new SesEmailProvider(clienteFalso({ MessageId: 'abc-123' }), {
      configurationSet: 'cs',
    });
    const r = await provider.enviar(mensagem());

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMessageId).toBe('abc-123');
  });

  it('inclui os cabeçalhos de descadastro em um clique (RFC 8058)', async () => {
    const cliente = clienteFalso({ MessageId: 'x' });
    const provider = new SesEmailProvider(cliente, { configurationSet: 'cs' });
    await provider.enviar(mensagem());

    const enviado = vi.mocked(cliente.send).mock.calls[0]?.[0] as unknown as {
      input: { Content: { Simple: { Headers?: { Name: string; Value: string }[] } } };
    };
    const headers = enviado.input.Content.Simple.Headers ?? [];

    // Exigência de entregabilidade do Gmail e do Yahoo desde 2024 (§1.3).
    expect(headers).toContainEqual({
      Name: 'List-Unsubscribe',
      Value: '<https://exemplo.com/u?t=abc>',
    });
    expect(headers).toContainEqual({
      Name: 'List-Unsubscribe-Post',
      Value: 'List-Unsubscribe=One-Click',
    });
  });

  it('sempre manda a parte texto junto com a HTML', async () => {
    const cliente = clienteFalso({ MessageId: 'x' });
    await new SesEmailProvider(cliente, { configurationSet: 'cs' }).enviar(mensagem());

    const enviado = vi.mocked(cliente.send).mock.calls[0]?.[0] as unknown as {
      input: { Content: { Simple: { Body: Record<string, unknown> } } };
    };
    // Mensagem só-HTML pontua pior em filtro de spam.
    expect(enviado.input.Content.Simple.Body['Text']).toBeDefined();
  });

  it('sanitiza tags para o formato aceito pelo SES', async () => {
    const cliente = clienteFalso({ MessageId: 'x' });
    const msg = { ...mensagem(), tags: { origem: 'lista/agosto 2026' } };
    await new SesEmailProvider(cliente, { configurationSet: 'cs' }).enviar(msg);

    const enviado = vi.mocked(cliente.send).mock.calls[0]?.[0] as unknown as {
      input: { EmailTags: { Name: string; Value: string }[] };
    };
    expect(enviado.input.EmailTags[0]?.Value).toBe('lista_agosto_2026');
  });

  it('trata resposta sem MessageId como erro transitório, não como sucesso', async () => {
    // Registrar envio sem messageId criaria um envio órfão: nenhum evento
    // futuro poderia ser correlacionado a ele.
    const provider = new SesEmailProvider(clienteFalso({}), { configurationSet: 'cs' });
    const r = await provider.enviar(mensagem());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tipo).toBe('ERRO_TRANSITORIO');
  });
});

describe('SesEmailProvider — classificação de erro (§5.5)', () => {
  const classificar = async (name: string) => {
    const provider = new SesEmailProvider(clienteFalso(erroSes(name)), { configurationSet: 'cs' });
    const r = await provider.enviar(mensagem());
    expect(r.ok).toBe(false);
    return r.ok ? null : r.error;
  };

  it.each(['TooManyRequestsException', 'ThrottlingException', 'Throttling'])(
    '%s → THROTTLED (fluxo normal com cota de 1 msg/s, não erro)',
    async (name) => {
      expect((await classificar(name))?.tipo).toBe('THROTTLED');
    },
  );

  it.each(['AccountSuspendedException', 'SendingPausedException', 'AccountSendingPausedException'])(
    '%s → CONTA_SUSPENSA (abre o circuit breaker)',
    async (name) => {
      expect((await classificar(name))?.tipo).toBe('CONTA_SUSPENSA');
    },
  );

  it.each(['MessageRejected', 'MailFromDomainNotVerifiedException', 'BadRequestException'])(
    '%s → REJEITADO_PERMANENTE (não retentar)',
    async (name) => {
      expect((await classificar(name))?.tipo).toBe('REJEITADO_PERMANENTE');
    },
  );

  it('LimitExceededException → THROTTLED com espera longa, não rejeição', async () => {
    // Cota diária estourada: a mensagem é boa, só precisa da próxima janela.
    const falha = await classificar('LimitExceededException');
    expect(falha?.tipo).toBe('THROTTLED');
    if (falha?.tipo === 'THROTTLED') expect(falha.tentarNovamenteEmMs).toBeGreaterThan(10_000);
  });

  it('erro desconhecido → ERRO_TRANSITORIO (retentar com backoff)', async () => {
    expect((await classificar('AlgumErroNovoDaAWS'))?.tipo).toBe('ERRO_TRANSITORIO');
  });
});
