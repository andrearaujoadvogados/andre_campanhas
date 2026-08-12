import { useEffect, useId, useMemo, useRef } from 'react';

import { cn } from '../../lib/criador/cn.js';
import { realcarHtml, type TipoDeToken } from '../../lib/criador/realce.js';

/**
 * Paleta do editor — inspirada no Dracula.
 *
 * Fica aqui, e não nos tokens do sistema, de propósito: o editor de código é
 * escuro sempre, independente do tema da aplicação. Código se lê em fundo
 * escuro, e alternar junto com o resto da tela mudaria as cores de sintaxe no
 * meio do trabalho.
 */
const DRACULA = {
  fundo: '#282A36',
  fundoDaLinha: '#44475A',
  frente: '#F8F8F2',
  comentario: '#6272A4',
  ciano: '#8BE9FD',
  verde: '#50FA7B',
  laranja: '#FFB86C',
  rosa: '#FF79C6',
  roxo: '#BD93F9',
  amarelo: '#F1FA8C',
} as const;

const COR: Record<TipoDeToken, string> = {
  texto: DRACULA.frente,
  pontuacao: DRACULA.frente,
  tag: DRACULA.rosa,
  atributo: DRACULA.verde,
  valor: DRACULA.amarelo,
  comentario: DRACULA.comentario,
  variavel: DRACULA.roxo,
  seletor: DRACULA.verde,
  propriedade: DRACULA.ciano,
  numero: DRACULA.laranja,
};

/** Itálico onde o Dracula usa itálico: comentário e nome de atributo. */
const ITALICO: Partial<Record<TipoDeToken, boolean>> = {
  comentario: true,
  atributo: true,
  seletor: true,
};

/**
 * Editor de código com realce, feito de um `<pre>` colorido por baixo de um
 * `<textarea>` transparente.
 *
 * É o truque padrão para ter realce sem trocar o campo de texto por um editor
 * de verdade: o `<textarea>` continua sendo um `<textarea>` — cursor, seleção,
 * desfazer, corretor do sistema, colar e leitor de tela seguem funcionando —
 * e o colorido é só pintura atrás dele.
 *
 * A regra que faz isso funcionar: as duas camadas precisam quebrar linha
 * EXATAMENTE no mesmo lugar. Por isso fonte, tamanho, entrelinha, espaçamento,
 * padding e regra de quebra são os mesmos nos dois, e ficam num só lugar
 * (`metricas`) — mexer num sem o outro desalinha o texto do cursor.
 */
export function EditorCodigo({
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (valor: string) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId().replace(/:/g, '');

  const tokens = useMemo(() => realcarHtml(value), [value]);

  // O `<pre>` acompanha a rolagem do `<textarea>`; sem isto, rolar o código
  // deixaria a pintura parada e o texto sairia de cima das cores.
  useEffect(() => {
    const ta = area.current;
    const p = pre.current;
    if (ta === null || p === null) return;
    p.scrollTop = ta.scrollTop;
    p.scrollLeft = ta.scrollLeft;
  }, [value]);

  const metricas: React.CSSProperties = {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 12,
    lineHeight: 1.65,
    letterSpacing: 0,
    tabSize: 2,
    padding: '12px 14px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    margin: 0,
    border: 0,
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border-[1.5px] border-[#44475A] focus-within:border-[#BD93F9]',
        className,
      )}
      style={{ backgroundColor: DRACULA.fundo }}
    >
      {/* A seleção é semitransparente porque ela é pintada NO textarea, que
          está por cima: opaca, ela apagaria o código colorido justamente no
          trecho que a pessoa selecionou para ler.

          A CALHA DA ROLAGEM VAI NAS DUAS CAMADAS, com a mesma largura. Só no
          textarea, ela estreita a área de texto de um lado só, as linhas
          quebram em lugares diferentes e a pintura descola do cursor — o erro
          cresce linha a linha e some no topo, onde ninguém testa. A do `<pre>`
          é transparente: ocupa o espaço, não aparece. */}
      <style>{`
        #ta-${id}::selection { background: rgba(98,114,164,0.45); }
        #ta-${id}::-webkit-scrollbar,
        #pre-${id}::-webkit-scrollbar { width: 10px; height: 10px; }
        #ta-${id}::-webkit-scrollbar-thumb {
          background: ${DRACULA.fundoDaLinha}; border-radius: 6px;
        }
        #ta-${id}::-webkit-scrollbar-track,
        #pre-${id}::-webkit-scrollbar-thumb,
        #pre-${id}::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <pre
        id={`pre-${id}`}
        ref={pre}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          ...metricas,
          color: DRACULA.frente,
          // `scroll`, e não `hidden`: é o que garante a mesma calha do
          // textarea. Com `hidden` o navegador não reserva nada.
          overflowY: 'scroll',
          overflowX: 'hidden',
        }}
      >
        {tokens.map((token, i) => (
          <span
            key={i}
            style={{
              color: COR[token.tipo],
              fontStyle: ITALICO[token.tipo] === true ? 'italic' : undefined,
            }}
          >
            {token.texto}
          </span>
        ))}
        {/* Uma quebra a mais: sem ela, um código terminado em Enter deixa o
            textarea uma linha mais alto que a pintura, e o fim rola sozinho. */}
        {'\n'}
      </pre>

      <textarea
        id={`ta-${id}`}
        ref={area}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const p = pre.current;
          if (p === null) return;
          p.scrollTop = e.currentTarget.scrollTop;
          p.scrollLeft = e.currentTarget.scrollLeft;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        className="relative block h-full w-full resize-none bg-transparent outline-none"
        style={{
          ...metricas,
          color: 'transparent',
          caretColor: DRACULA.frente,
          overflowY: 'scroll',
          overflowX: 'hidden',
        }}
      />
    </div>
  );
}
