/**
 * Janelas de tempo do painel — "últimos 7 dias", "últimos 30", datas escolhidas.
 *
 * O período filtra **boletins pela data de disparo**, não eventos por dia. É a
 * única leitura que o modelo de dados sustenta sem mentir: os contadores são
 * totais acumulados por boletim, então um boletim disparado dentro da janela
 * entra com tudo o que já rendeu — inclusive as aberturas que chegaram depois.
 * Fatiar esses totais por dia daria um número inventado.
 *
 * A comparação com o período anterior usa a janela de mesma duração colada
 * antes desta: 30 dias contra os 30 imediatamente anteriores. Comparar contra
 * intervalos de tamanhos diferentes é como um resultado dobrar por ter tido o
 * dobro de dias — a variação diria mais sobre o calendário do que sobre os
 * boletins.
 */

/** Intervalo semiaberto `[desde, ate)` — o instante final não pertence à janela. */
export interface Janela {
  readonly desde: Date;
  readonly ate: Date;
}

export const PERIODOS = [
  { valor: '7', rotulo: '7 dias', dias: 7 },
  { valor: '30', rotulo: '30 dias', dias: 30 },
  { valor: '90', rotulo: '90 dias', dias: 90 },
  { valor: 'tudo', rotulo: 'Tudo', dias: null },
  { valor: 'personalizado', rotulo: 'Escolher datas', dias: null },
] as const;

export type ValorPeriodo = (typeof PERIODOS)[number]['valor'];

const DIA_EM_MS = 24 * 60 * 60 * 1000;

/**
 * Fuso do escritório, fixo.
 *
 * O Brasil não tem horário de verão desde 2019, então `-03:00` vale o ano
 * inteiro para São Paulo — o mesmo fuso em que o resto do painel formata datas.
 * Sem isto, "01/08" digitado aqui viraria 21h do dia 31 de julho para quem lê,
 * e um boletim disparado de manhã cairia no período errado.
 */
const FUSO = '-03:00';

/** Últimos `dias` dias corridos, terminando agora. */
export function janelaRecente(dias: number, agora: Date): Janela {
  return { desde: new Date(agora.getTime() - dias * DIA_EM_MS), ate: agora };
}

/**
 * Janela a partir de duas datas `AAAA-MM-DD` do formulário, com o dia final
 * **incluído** — quem escolhe "até 31/08" espera o dia 31 inteiro dentro da
 * conta, e não até a meia-noite que o abre.
 *
 * Devolve `null` quando o intervalo ainda não faz sentido (campo vazio, data
 * inválida, fim antes do início); quem chama mostra a dica em vez de filtrar
 * por um intervalo impossível.
 */
export function janelaPersonalizada(desde: string, ate: string): Janela | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return null;

  const inicio = new Date(`${desde}T00:00:00${FUSO}`);
  const fim = new Date(`${ate}T00:00:00${FUSO}`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return null;
  if (fim.getTime() < inicio.getTime()) return null;

  return { desde: inicio, ate: new Date(fim.getTime() + DIA_EM_MS) };
}

/** A janela de mesma duração imediatamente anterior. */
export function janelaAnterior(janela: Janela): Janela {
  const duracao = janela.ate.getTime() - janela.desde.getTime();
  return { desde: new Date(janela.desde.getTime() - duracao), ate: janela.desde };
}

export function dentroDaJanela(iso: string | null | undefined, janela: Janela): boolean {
  if (iso === null || iso === undefined || iso === '') return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= janela.desde.getTime() && t < janela.ate.getTime();
}

/** Quantos dias a janela cobre, arredondado — só para escrever o rótulo. */
export function diasDaJanela(janela: Janela): number {
  return Math.max(1, Math.round((janela.ate.getTime() - janela.desde.getTime()) / DIA_EM_MS));
}
