import { describe, it, expect } from 'vitest';
import { EmailAddress, campaignId, contactId, tenantId, unwrap } from '@emailmkt/core';
import {
  CanonicalContentHasher,
  HmacUnsubscribeTokenService,
  Sha256EmailHasher,
  calcularSendId,
} from '../src/crypto/hashers.js';

const SAL = 'sal-de-teste-com-mais-de-32-caracteres-ok';
const SEGREDO = 'segredo-hmac-de-teste-com-mais-de-32-chars';

describe('Sha256EmailHasher', () => {
  const hasher = new Sha256EmailHasher(SAL);

  it('é determinístico', () => {
    const e = unwrap(EmailAddress.create('joao@exemplo.com'));
    expect(hasher.hash(e)).toBe(hasher.hash(e));
  });

  it('trata variações de escrita como o mesmo endereço', () => {
    // Depende da normalização do EmailAddress. Se ela quebrar, o descadastro de
    // "Joao@Exemplo.COM" não valeria para "joao@exemplo.com".
    const a = unwrap(EmailAddress.create('  Joao@Exemplo.COM '));
    const b = unwrap(EmailAddress.create('joao@exemplo.com'));
    expect(hasher.hash(a)).toBe(hasher.hash(b));
  });

  it('sais diferentes produzem hashes diferentes', () => {
    const outro = new Sha256EmailHasher('outro-sal-com-mais-de-32-caracteres-aqui');
    const e = unwrap(EmailAddress.create('joao@exemplo.com'));
    expect(hasher.hash(e)).not.toBe(outro.hash(e));
  });

  it('recusa sal curto — hash sem sal seria dado pessoal disfarçado', () => {
    expect(() => new Sha256EmailHasher('curto')).toThrow(/muito curto/i);
  });

  it('não devolve o e-mail em claro', () => {
    const e = unwrap(EmailAddress.create('joao@exemplo.com'));
    expect(hasher.hash(e)).not.toContain('joao');
    expect(hasher.hash(e)).not.toContain('exemplo');
  });
});

describe('CanonicalContentHasher', () => {
  const hasher = new CanonicalContentHasher();

  it('ignora a ordem das chaves', () => {
    // Sem isto, a aprovação de uma campanha seria invalidada por uma
    // reordenação irrelevante de campos na serialização (§5.8).
    expect(hasher.hash({ a: 1, b: 2 })).toBe(hasher.hash({ b: 2, a: 1 }));
  });

  it('ignora a ordem em objetos aninhados', () => {
    expect(hasher.hash({ x: { a: 1, b: 2 } })).toBe(hasher.hash({ x: { b: 2, a: 1 } }));
  });

  it('respeita a ordem de arrays — lista de destinatários não é conjunto', () => {
    expect(hasher.hash([1, 2])).not.toBe(hasher.hash([2, 1]));
  });

  it('muda quando o conteúdo muda', () => {
    const antes = hasher.hash({ assunto: 'Boletim de agosto', corpoHtml: '<p>x</p>' });
    const depois = hasher.hash({ assunto: 'Boletim de agosto', corpoHtml: '<p>y</p>' });
    expect(antes).not.toBe(depois);
  });

  it('trata undefined como campo ausente', () => {
    expect(hasher.hash({ a: 1, b: undefined })).toBe(hasher.hash({ a: 1 }));
  });
});

describe('HmacUnsubscribeTokenService', () => {
  const servico = new HmacUnsubscribeTokenService(SEGREDO);
  const payload = {
    tenantId: tenantId('andrearaujo'),
    contactId: contactId('c-123'),
    campaignId: campaignId('camp-9'),
  };

  it('emite e verifica o próprio token', () => {
    expect(servico.verificar(servico.emitir(payload))).toEqual(payload);
  });

  it('rejeita token assinado com outro segredo', () => {
    const impostor = new HmacUnsubscribeTokenService('outro-segredo-de-teste-com-32-chars-ok');
    expect(servico.verificar(impostor.emitir(payload))).toBeNull();
  });

  it('rejeita payload adulterado', () => {
    const token = servico.emitir(payload);
    const [corpo = '', assinatura = ''] = token.split('.');

    // Troca o contactId mantendo a assinatura original.
    const forjado = Buffer.from(
      JSON.stringify({ t: 'andrearaujo', c: 'c-OUTRO', k: 'camp-9' }),
      'utf8',
    ).toString('base64url');

    expect(servico.verificar(`${forjado}.${assinatura}`)).toBeNull();
    expect(corpo).not.toBe(forjado);
  });

  it.each([
    ['vazio', ''],
    ['sem separador', 'abcdef'],
    ['só assinatura', '.abc'],
    ['lixo', 'não-é-um-token'],
  ])('rejeita token %s', (_caso, token) => {
    expect(servico.verificar(token)).toBeNull();
  });

  it('não expõe o e-mail nem outro dado pessoal no token', () => {
    // O token viaja numa URL — vai para log de servidor, histórico e referer.
    const token = servico.emitir(payload);
    const decodificado = Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8');

    expect(decodificado).not.toMatch(/@/);
    expect(decodificado).not.toMatch(/nome/i);
  });

  it('não expira — o e-mail pode ficar anos na caixa do titular', () => {
    const token = servico.emitir(payload);
    const decodificado = Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8');

    // Ausência de campo de expiração é decisão, não esquecimento: link de
    // descadastro que expira é barreira ilegal disfarçada de segurança.
    expect(decodificado).not.toMatch(/exp|iat|ttl/i);
  });

  it('recusa segredo curto', () => {
    expect(() => new HmacUnsubscribeTokenService('curto')).toThrow(/muito curto/i);
  });
});

describe('calcularSendId', () => {
  it('é determinístico — é a guarda de idempotência do envio', () => {
    const a = calcularSendId(campaignId('camp-1'), contactId('c-1'));
    const b = calcularSendId(campaignId('camp-1'), contactId('c-1'));
    expect(a).toBe(b);
  });

  it('difere por campanha e por contato', () => {
    const base = calcularSendId(campaignId('camp-1'), contactId('c-1'));
    expect(calcularSendId(campaignId('camp-2'), contactId('c-1'))).not.toBe(base);
    expect(calcularSendId(campaignId('camp-1'), contactId('c-2'))).not.toBe(base);
  });

  it('não confunde a fronteira entre os dois identificadores', () => {
    // Concatenação ingênua faria ("camp-1","1:c") colidir com ("camp-1:1","c").
    expect(calcularSendId(campaignId('a'), contactId('b:c'))).not.toBe(
      calcularSendId(campaignId('a:b'), contactId('c')),
    );
  });
});
