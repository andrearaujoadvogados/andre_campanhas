import { useMemo, useState } from 'react';

/**
 * Gráfico de engajamento — aberturas × cliques por dia.
 *
 * SVG próprio, porte do gráfico da referência (avante-mail): ~100 linhas
 * cobrem linha, área, eixos e hover. Uma biblioteca de gráficos custaria
 * centenas de KB no bundle para desenhar exatamente isto — e o painel inteiro
 * hoje pesa menos que isso.
 */
export interface PontoDoGrafico {
  dia: string; // AAAA-MM-DD
  aberturas: number;
  cliques: number;
}

const COR_ABERTURA = '#721420'; // vinho
const COR_CLIQUE = '#7d5e2c'; // ouro

const LARGURA = 900;
const ALTURA = 280;
const MARGEM = { topo: 16, direita: 20, baixo: 34, esquerda: 44 };

const formatoDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

function rotuloDoDia(dia: string): string {
  // Rotula ao meio-dia UTC: rotular à meia-noite deixaria o rótulo do dia
  // anterior em qualquer fuso a oeste de Greenwich — o nosso caso.
  return formatoDia.format(new Date(`${dia}T12:00:00Z`));
}

/**
 * Preenche os dias sem atividade com zero, do primeiro ao último ponto.
 *
 * O servidor só guarda dias com evento; sem o preenchimento, uma campanha com
 * atividade na segunda e na sexta desenharia uma reta enganosa ligando as
 * duas, como se terça a quinta tivessem tido leitores.
 */
export function preencherDias(pontos: readonly PontoDoGrafico[]): PontoDoGrafico[] {
  if (pontos.length === 0) return [];
  const ordenados = [...pontos].sort((a, b) => a.dia.localeCompare(b.dia));
  const porDia = new Map(ordenados.map((p) => [p.dia, p]));
  const saida: PontoDoGrafico[] = [];

  const cursor = new Date(`${ordenados[0]?.dia}T00:00:00Z`);
  const fim = new Date(`${ordenados[ordenados.length - 1]?.dia}T00:00:00Z`);
  // Guarda de sanidade: dados corrompidos não podem virar um laço de anos.
  for (let i = 0; cursor.getTime() <= fim.getTime() && i < 400; i += 1) {
    const dia = cursor.toISOString().slice(0, 10);
    saida.push(porDia.get(dia) ?? { dia, aberturas: 0, cliques: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return saida;
}

export function GraficoEngajamento({ pontos }: { pontos: readonly PontoDoGrafico[] }) {
  const serie = useMemo(() => preencherDias(pontos), [pontos]);
  const [foco, definirFoco] = useState<number | null>(null);

  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.baixo;

  const maxY = useMemo(() => {
    const m = Math.max(1, ...serie.flatMap((p) => [p.aberturas, p.cliques]));
    const passo = m <= 5 ? 1 : m <= 20 ? 5 : m <= 100 ? 10 : 50;
    return Math.ceil(m / passo) * passo;
  }, [serie]);

  if (serie.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-suave">
        Sem atividade registrada ainda. A série passa a acumular a partir dos próximos eventos de
        abertura e clique.
      </p>
    );
  }

  const n = serie.length;
  const x = (i: number) =>
    MARGEM.esquerda + (n <= 1 ? larguraUtil / 2 : (i / (n - 1)) * larguraUtil);
  const y = (v: number) => MARGEM.topo + alturaUtil - (v / maxY) * alturaUtil;

  const caminho = (campo: 'aberturas' | 'cliques') => {
    const pts = serie.map((p, i) => `${x(i)},${y(p[campo])}`);
    return {
      linha: `M${pts.join('L')}`,
      area: `M${x(0)},${MARGEM.topo + alturaUtil}L${pts.join('L')}L${x(n - 1)},${MARGEM.topo + alturaUtil}Z`,
    };
  };

  const aberturas = caminho('aberturas');
  const cliques = caminho('cliques');

  const marcasY = [
    ...new Set(
      Array.from({ length: Math.min(4, maxY) + 1 }, (_, i) =>
        Math.round((maxY / Math.min(4, maxY)) * i),
      ),
    ),
  ];
  const cadaX = Math.max(1, Math.ceil(n / 8));
  const focado = foco === null ? null : (serie[foco] ?? null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-suave">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-4 rounded-sm"
            style={{ background: COR_ABERTURA }}
          />
          Aberturas
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-4 rounded-sm"
            style={{ background: COR_CLIQUE }}
          />
          Cliques
        </span>
        {focado !== null && (
          <span className="ml-auto text-ink" aria-live="polite">
            {rotuloDoDia(focado.dia)}: {focado.aberturas} abertura(s), {focado.cliques} clique(s)
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        role="img"
        aria-label="Aberturas e cliques por dia"
        className="w-full"
        onMouseLeave={() => definirFoco(null)}
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const caixa = svg.getBoundingClientRect();
          const xr = ((e.clientX - caixa.left) / caixa.width) * LARGURA;
          const i = Math.round(((xr - MARGEM.esquerda) / Math.max(1, larguraUtil)) * (n - 1));
          definirFoco(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {marcasY.map((v) => (
          <g key={v}>
            <line
              x1={MARGEM.esquerda}
              x2={LARGURA - MARGEM.direita}
              y1={y(v)}
              y2={y(v)}
              stroke="#e5dfd3"
              strokeWidth={1}
            />
            <text
              x={MARGEM.esquerda - 8}
              y={y(v) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#4a5560"
            >
              {v}
            </text>
          </g>
        ))}

        {serie.map((p, i) =>
          i % cadaX === 0 ? (
            <text
              key={p.dia}
              x={x(i)}
              y={ALTURA - 10}
              textAnchor="middle"
              fontSize={11}
              fill="#4a5560"
            >
              {rotuloDoDia(p.dia)}
            </text>
          ) : null,
        )}

        <path d={aberturas.area} fill={COR_ABERTURA} opacity={0.08} />
        <path d={cliques.area} fill={COR_CLIQUE} opacity={0.08} />
        <path d={aberturas.linha} fill="none" stroke={COR_ABERTURA} strokeWidth={2} />
        <path d={cliques.linha} fill="none" stroke={COR_CLIQUE} strokeWidth={2} />

        {foco !== null && (
          <g>
            <line
              x1={x(foco)}
              x2={x(foco)}
              y1={MARGEM.topo}
              y2={MARGEM.topo + alturaUtil}
              stroke="#4a5560"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={x(foco)} cy={y(serie[foco]?.aberturas ?? 0)} r={3.5} fill={COR_ABERTURA} />
            <circle cx={x(foco)} cy={y(serie[foco]?.cliques ?? 0)} r={3.5} fill={COR_CLIQUE} />
          </g>
        )}
      </svg>
    </div>
  );
}
