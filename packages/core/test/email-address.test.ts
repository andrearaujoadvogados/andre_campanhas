import { describe, it, expect } from 'vitest';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { unwrap } from '../src/domain/shared/result.js';

describe('EmailAddress', () => {
  it('normaliza caixa e espaços — o caso do CSV do mundo real', () => {
    const a = unwrap(EmailAddress.create('  Joao@Exemplo.COM  '));
    const b = unwrap(EmailAddress.create('joao@exemplo.com'));

    expect(a.value).toBe('joao@exemplo.com');
    expect(a.equals(b)).toBe(true);
  });

  it('NÃO trata "+tag" como o mesmo endereço', () => {
    const a = unwrap(EmailAddress.create('joao+juridico@exemplo.com'));
    const b = unwrap(EmailAddress.create('joao@exemplo.com'));

    // São inscrições distintas para o servidor de destino. Unificá-las seria
    // decidir por conta própria que duas pessoas são a mesma.
    expect(a.equals(b)).toBe(false);
  });

  it.each([
    ['sem arroba', 'joaoexemplo.com'],
    ['sem domínio', 'joao@'],
    ['sem TLD', 'joao@exemplo'],
    ['com espaço interno', 'jo ao@exemplo.com'],
    ['com vírgula (colagem de lista)', 'joao@exemplo.com,maria@exemplo.com'],
    ['vazio', '   '],
  ])('rejeita %s', (_caso, entrada) => {
    const r = EmailAddress.create(entrada);
    expect(r.ok).toBe(false);
  });

  it('aceita endereços válidos incomuns em vez de ser estrito demais', () => {
    // Regex estrita rejeita endereço válido; quem confirma existência é o bounce.
    expect(EmailAddress.create("o'brien@exemplo.adv.br").ok).toBe(true);
    expect(EmailAddress.create('contato_1@sub.exemplo.com.br').ok).toBe(true);
  });

  it('mascara para log sem revelar o endereço nem o tamanho dele', () => {
    const curto = unwrap(EmailAddress.create('ab@avante.com.br'));
    const longo = unwrap(EmailAddress.create('fernando@avante.com.br'));

    expect(longo.mascarado).toBe('f***@avante.com.br');
    expect(longo.mascarado).not.toContain('fernando');

    // Largura fixa: o log não deixa inferir o tamanho da parte local.
    expect(curto.mascarado.length).toBe(longo.mascarado.length);
  });

  it('extrai o domínio', () => {
    expect(unwrap(EmailAddress.create('a@b.com.br')).dominio).toBe('b.com.br');
  });
});
