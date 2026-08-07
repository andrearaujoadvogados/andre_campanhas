import { describe, it, expect } from 'vitest';
import { TokenBucket } from '../src/domain/send/rate-limiter.js';

describe('TokenBucket — cota do SES, §5.6', () => {
  it('com 1 msg/s, o primeiro envio passa e o segundo espera ~1s', () => {
    // A cota atual da conta é exatamente esta (§1.1).
    const b = new TokenBucket(1, 0);

    expect(b.consumir(0)).toBe(0);
    expect(b.consumir(0)).toBe(1000);
  });

  it('recarrega com a passagem do tempo', () => {
    const b = new TokenBucket(1, 0);
    b.consumir(0);

    expect(b.consumir(1000)).toBe(0);
  });

  it('com 14 msg/s (cota pós-produção), libera 14 seguidos', () => {
    const b = new TokenBucket(14, 0);
    for (let i = 0; i < 14; i++) expect(b.consumir(0)).toBe(0);

    expect(b.consumir(0)).toBeGreaterThan(0);
  });

  it('nunca acumula além da capacidade — ficar parado não gera rajada', () => {
    // Sem o teto, uma Lambda ociosa por uma hora voltaria disparando milhares
    // de mensagens de uma vez e levaria throttling imediato.
    const b = new TokenBucket(1, 0);
    expect(b.consumir(3_600_000)).toBe(0);
    expect(b.consumir(3_600_000)).toBe(1000);
  });

  it('espera devolvida é proporcional ao déficit', () => {
    const b = new TokenBucket(2, 0);
    b.consumir(0);
    b.consumir(0);

    // 2 msg/s → meio segundo por token.
    expect(b.consumir(0)).toBe(500);
  });

  it('nunca devolve negativo mesmo com relógio andando para trás', () => {
    const b = new TokenBucket(1, 1000);
    expect(b.consumir(0)).toBe(0);
    expect(b.consumir(0)).toBeGreaterThanOrEqual(0);
  });

  it('recusa taxa inválida em vez de dividir por zero silenciosamente', () => {
    expect(() => new TokenBucket(0, 0)).toThrow(/inválida/i);
    expect(() => new TokenBucket(-1, 0)).toThrow(/inválida/i);
  });

  it('permite rajada configurada acima da taxa', () => {
    const b = new TokenBucket(1, 0, 5);
    for (let i = 0; i < 5; i++) expect(b.consumir(0)).toBe(0);
    expect(b.consumir(0)).toBe(1000);
  });
});
