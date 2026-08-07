import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '@emailmkt/core';

/** Relógio real. Nos testes entra um fixo — por isso o domínio recebe um port. */
export class SystemClock implements Clock {
  agora(): Date {
    return new Date();
  }
}

/**
 * Identificadores UUIDv4.
 *
 * Deliberadamente aleatórios, não sequenciais: um id de contato previsível
 * transformaria qualquer endpoint em enumerador da base do escritório.
 */
export class UuidGenerator implements IdGenerator {
  gerar(): string {
    return randomUUID();
  }
}
