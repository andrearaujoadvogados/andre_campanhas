import { validator } from 'hono/validator';
import type { z } from 'zod';

/**
 * Validação de borda com Zod — §10.1.
 *
 * Toda entrada passa por aqui antes de virar tipo de domínio. O schema é o mesmo
 * que o frontend usa (`@emailmkt/contracts`), então a regra não é duplicada nem
 * pode divergir entre as pontas.
 *
 * Erros vêm com o caminho do campo para que a interface consiga destacar a
 * linha errada de um formulário — mensagem genérica obrigaria o operador a
 * adivinhar qual dos vinte campos está errado.
 */
export const validarCorpo = <T extends z.ZodTypeAny>(schema: T) =>
  validator('json', (valor, c) => {
    const r = schema.safeParse(valor);

    if (!r.success) {
      return c.json(
        {
          code: 'ENTRADA_INVALIDA',
          message: 'Dados inválidos.',
          detalhes: {
            campos: r.error.issues.map((i) => ({
              campo: i.path.join('.'),
              erro: i.message,
            })),
          },
        },
        400,
      );
    }
    return r.data as z.infer<T>;
  });

export const validarQuery = <T extends z.ZodTypeAny>(schema: T) =>
  validator('query', (valor, c) => {
    const r = schema.safeParse(valor);

    if (!r.success) {
      return c.json(
        {
          code: 'ENTRADA_INVALIDA',
          message: 'Parâmetros de consulta inválidos.',
          detalhes: {
            campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
          },
        },
        400,
      );
    }
    return r.data as z.infer<T>;
  });
