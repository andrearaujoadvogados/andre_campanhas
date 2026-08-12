import { describe, it, expect } from 'vitest';
import { tenantId as novoTenantId, campaignId as novoCampaignId } from '@emailmkt/core';
import { contactId as novoContactId } from '@emailmkt/core';
import { MARCA_RESPOSTA, traduzirRespostaRecebida } from '../src/email/ses-inbound-parser.js';
import { montarEncaminhamento } from '../src/email/encaminhar-resposta.js';
import { calcularSendId, Sha256SendIdDeriver } from '../src/crypto/hashers.js';

const TENANT = novoTenantId('andrearaujo');

function envelope(mail: Record<string, unknown>, receipt: Record<string, unknown> = {}): unknown {
  return { tipoInterno: MARCA_RESPOSTA, ses: { mail, receipt } };
}

function cabecalhos(pares: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(pares).map(([name, value]) => ({ name, value }));
}

describe('tradução da resposta recebida', () => {
  it('extrai remetente, campanha e chave de deduplicação', () => {
    const r = traduzirRespostaRecebida(
      envelope({
        messageId: 'recebida-1',
        timestamp: '2026-08-11T09:00:00.000Z',
        source: 'envelope@mail.cliente.com',
        destination: ['resposta+c-123@respostas.mail.exemplo.com.br'],
        headers: cabecalhos({
          From: '"Maria Silva" <maria@cliente.com.br>',
          'Message-ID': '<abc@cliente.com.br>',
          'In-Reply-To': '<orig-ses@us-east-2.amazonses.com>',
        }),
      }),
      TENANT,
    );

    expect(r).toEqual({
      tenantId: TENANT,
      // O `From:` vence o remetente do envelope: é ele que identifica a pessoa.
      deEmail: 'maria@cliente.com.br',
      idMensagemRecebida: '<abc@cliente.com.br>',
      recebidoEm: new Date('2026-08-11T09:00:00.000Z'),
      campaignIdMarcado: 'c-123',
      sesMessageIdOriginal: 'orig-ses',
    });
  });

  it('nome de cabeçalho em qualquer caixa é reconhecido', () => {
    // Clientes de e-mail escrevem `In-Reply-To`, `In-reply-to`, `IN-REPLY-TO`.
    // Sem normalizar, a correlação dependeria de qual programa a pessoa usa.
    const r = traduzirRespostaRecebida(
      envelope({
        messageId: 'recebida-2',
        source: 'a@b.com',
        headers: cabecalhos({
          FROM: 'a@b.com',
          'MESSAGE-ID': '<x@b.com>',
          'in-reply-to': '<zz@us-east-2.amazonses.com>',
        }),
      }),
      TENANT,
    );

    expect(r?.sesMessageIdOriginal).toBe('zz');
  });

  it('sem Message-ID próprio, usa o messageId do recebimento como chave', () => {
    const r = traduzirRespostaRecebida(
      envelope({ messageId: 'recebida-3', source: 'a@b.com', headers: [] }),
      TENANT,
    );

    expect(r?.idMensagemRecebida).toBe('recebida-3');
  });

  it('encontra a marca no recipiente do recibo quando o destino veio limpo', () => {
    // Resposta com o nosso endereço em cópia oculta: não aparece em `To:`, mas
    // o SES sabe para quem entregou.
    const r = traduzirRespostaRecebida(
      envelope(
        { messageId: 'r4', source: 'a@b.com', headers: cabecalhos({ To: 'outro@x.com' }) },
        { recipients: ['resposta+c-999@respostas.mail.exemplo.com.br'] },
      ),
      TENANT,
    );

    expect(r?.campaignIdMarcado).toBe('c-999');
  });

  it('devolve null para o que não é resposta — inclusive evento de envio do SES', () => {
    expect(traduzirRespostaRecebida({ eventType: 'Delivery', mail: {} }, TENANT)).toBeNull();
    expect(traduzirRespostaRecebida(null, TENANT)).toBeNull();
    // Marca certa, mas sem `mail`: formato inesperado vai para a DLQ.
    expect(traduzirRespostaRecebida({ tipoInterno: MARCA_RESPOSTA, ses: {} }, TENANT)).toBeNull();
  });
});

describe('encaminhamento da resposta para o escritório', () => {
  const original = Buffer.from(
    'From: maria@cliente.com.br\r\nSubject: Ação\r\n\r\nCorpo com acento: ação.',
    'utf8',
  );

  it('anexa a mensagem original intacta e aponta o Reply-To para quem escreveu', () => {
    const bruto = montarEncaminhamento({
      de: 'respostas@mail.exemplo.com.br',
      para: 'caixa@escritorio.com.br',
      deOriginal: '"Maria" <maria@cliente.com.br>',
      assuntoOriginal: 'Ação de indenização',
      mensagemOriginal: original,
      campanha: 'c-123',
      identificavel: true,
    });

    expect(bruto).toContain('To: caixa@escritorio.com.br');
    // Responder ao encaminhamento fala com o cliente, não conosco.
    expect(bruto).toContain('Reply-To: "Maria" <maria@cliente.com.br>');
    expect(bruto).toContain('Content-Type: message/rfc822');

    // O anexo é a mensagem original byte a byte — nada reescrito.
    const partes = bruto.split('Content-Disposition: attachment');
    const anexo = (partes[1] ?? '').split('\r\n\r\n')[1] ?? '';
    const decodificado = Buffer.from(anexo.replace(/\r\n/g, '').split('--')[0] ?? '', 'base64');
    expect(decodificado.toString('utf8')).toBe(original.toString('utf8'));
  });

  it('assunto com acento vai codificado — cabeçalho só aceita ASCII', () => {
    const bruto = montarEncaminhamento({
      de: 'r@x.com',
      para: 'c@y.com',
      deOriginal: 'a@b.com',
      assuntoOriginal: 'Ação de indenização',
      mensagemOriginal: original,
      identificavel: true,
    });

    const linhaAssunto = bruto.split('\r\n').find((l) => l.startsWith('Subject:')) ?? '';
    expect(linhaAssunto).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(linhaAssunto.slice(18, -2), 'base64').toString('utf8')).toBe(
      'Resposta: Ação de indenização',
    );
  });

  it('a fronteira nunca colide com o conteúdo — o corpo é todo base64', () => {
    const bruto = montarEncaminhamento({
      de: 'r@x.com',
      para: 'c@y.com',
      deOriginal: 'a@b.com',
      assuntoOriginal: 'x',
      // Uma mensagem que contém a própria fronteira em texto: se as partes não
      // fossem codificadas, ela cortaria o multipart no meio.
      mensagemOriginal: Buffer.from('=_resposta_encaminhada_', 'utf8'),
      identificavel: true,
    });

    // Quatro ocorrências e só: a declaração no Content-Type, a abertura, o
    // separador e o fechamento. Nenhuma vinda do conteúdo.
    expect(bruto.split('=_resposta_encaminhada_').length - 1).toBe(4);
  });

  it('avisa quando a resposta não traz marca nenhuma', () => {
    const bruto = montarEncaminhamento({
      de: 'r@x.com',
      para: 'c@y.com',
      deOriginal: 'a@b.com',
      assuntoOriginal: 'x',
      mensagemOriginal: original,
      identificavel: false,
    });

    // [0] são os cabeçalhos, [1] os da primeira parte, [2] o corpo dela.
    const aviso = Buffer.from(
      (bruto.split('\r\n\r\n')[2] ?? '').split('\r\n--')[0] ?? '',
      'base64',
    ).toString('utf8');
    expect(aviso).toContain('NÃO vai aparecer no relatório');
  });

  it('nenhuma linha passa de 78 caracteres — RFC 2045 no corpo, RFC 5322 no cabeçalho', () => {
    const grande = Buffer.from('x'.repeat(5000), 'utf8');
    const bruto = montarEncaminhamento({
      de: 'r@x.com',
      para: 'c@y.com',
      deOriginal: 'a@b.com',
      assuntoOriginal: 'x',
      mensagemOriginal: grande,
      identificavel: true,
    });

    const maior = Math.max(...bruto.split('\r\n').map((l) => l.length));
    expect(maior).toBeLessThanOrEqual(78);
  });
});

describe('derivação do sendId como port', () => {
  it('o port devolve exatamente o mesmo valor que o launcher calcula', () => {
    // É o que faz a correlação por campanha+remetente funcionar: se as duas
    // pontas divergirem, o GetItem procura uma chave que não existe.
    const campanha = novoCampaignId('c-1');
    const contato = novoContactId('ct-1');

    expect(String(new Sha256SendIdDeriver().derivar(campanha, contato))).toBe(
      calcularSendId(campanha, contato),
    );
  });
});
