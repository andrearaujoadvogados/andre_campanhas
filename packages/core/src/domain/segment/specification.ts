import type { Contact } from '../contact/contact.js';

/**
 * Specification pattern — §5.9.
 *
 * No MVP a segmentação é simples. A razão de já existir como especificação
 * combinável é que a V2 prevê critérios compostos por E/OU/NÃO; sem esta
 * estrutura, o resolvedor de audiência precisaria ser reescrito em vez de
 * estendido.
 */
export interface Specification<T> {
  isSatisfiedBy(candidato: T): boolean;
  descrever(): string;
}

class And<T> implements Specification<T> {
  constructor(private readonly partes: readonly Specification<T>[]) {}
  isSatisfiedBy(c: T): boolean {
    return this.partes.every((p) => p.isSatisfiedBy(c));
  }
  descrever(): string {
    return `(${this.partes.map((p) => p.descrever()).join(' E ')})`;
  }
}

class Or<T> implements Specification<T> {
  constructor(private readonly partes: readonly Specification<T>[]) {}
  isSatisfiedBy(c: T): boolean {
    return this.partes.some((p) => p.isSatisfiedBy(c));
  }
  descrever(): string {
    return `(${this.partes.map((p) => p.descrever()).join(' OU ')})`;
  }
}

class Not<T> implements Specification<T> {
  constructor(private readonly parte: Specification<T>) {}
  isSatisfiedBy(c: T): boolean {
    return !this.parte.isSatisfiedBy(c);
  }
  descrever(): string {
    return `NÃO ${this.parte.descrever()}`;
  }
}

export const and = <T>(...partes: Specification<T>[]): Specification<T> => new And(partes);
export const or = <T>(...partes: Specification<T>[]): Specification<T> => new Or(partes);
export const not = <T>(parte: Specification<T>): Specification<T> => new Not(parte);

/** Sempre verdadeiro — audiência = lista inteira. Útil como base da composição. */
export const todos = <T>(): Specification<T> => ({
  isSatisfiedBy: () => true,
  descrever: () => 'todos',
});

// ── Especificações concretas de contato ──────────────────────────────────────

export const temRelacionamento = (
  ...aceitos: Contact['relacionamento'][]
): Specification<Contact> => ({
  isSatisfiedBy: (c) => aceitos.includes(c.relacionamento),
  descrever: () => `relacionamento em [${aceitos.join(', ')}]`,
});

export const temStatus = (...aceitos: Contact['status'][]): Specification<Contact> => ({
  isSatisfiedBy: (c) => aceitos.includes(c.status),
  descrever: () => `status em [${aceitos.join(', ')}]`,
});

export const campoCustomizadoIgual = (campo: string, valor: string): Specification<Contact> => ({
  isSatisfiedBy: (c) => c.camposCustomizados[campo] === valor,
  descrever: () => `${campo} = "${valor}"`,
});

export const dominioEmail = (dominio: string): Specification<Contact> => ({
  isSatisfiedBy: (c) => c.email.dominio === dominio.toLowerCase(),
  descrever: () => `domínio = ${dominio}`,
});
