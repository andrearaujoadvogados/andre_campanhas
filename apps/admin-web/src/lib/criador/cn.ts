/**
 * Junta classes condicionais — o suficiente do `clsx` para o porte do criador
 * manter a estrutura da referência, sem trazer a biblioteca.
 */
export function cn(...cls: (string | false | null | undefined)[]): string {
  return cls.filter(Boolean).join(' ');
}
