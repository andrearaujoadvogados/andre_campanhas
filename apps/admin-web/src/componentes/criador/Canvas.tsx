// Canvas do Criador de e-mails — porte fiel do avante-mail, com os tokens de
// cor do escritório no lugar dos da referência (primary→wine, border→line,
// card→paper-light, muted→ink-suave).

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import {
  AArrowDown,
  AArrowUp,
  Bold,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Italic,
  Link2,
  Minus,
  MousePointerClick,
  MoveVertical,
  RemoveFormatting,
  Share2,
  Trash2,
  Type,
  Underline,
} from 'lucide-react';

import { cn } from '../../lib/criador/cn.js';
import { larguraDoConteudo } from '../../lib/criador/compile.js';
import { limparHtmlDoUsuario } from '../../lib/criador/codigo.js';
import { limparHtmlColado, textoParaHtml } from '../../lib/criador/paste.js';
import { BLOCK_LABELS } from '../../lib/criador/presets.js';
import type { Block, BlockType, Column, EmailDesign, Row } from '../../lib/criador/tipos.js';

const PICKER_ICONS: Record<BlockType, React.ElementType> = {
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  spacer: MoveVertical,
  divider: Minus,
  social: Share2,
};

export interface Selection {
  rowId: string;
  colId?: string;
  blockId?: string;
}

export type RowAction = 'up' | 'down' | 'duplicate' | 'delete' | 'saveModule';
export type BlockAction = 'up' | 'down' | 'duplicate' | 'delete';

export type DragState =
  // Reordenação de itens já no layout.
  | { kind: 'block'; blockId: string }
  | { kind: 'row'; rowId: string }
  // Inserção de itens novos vindos da paleta (drag da sidebar).
  | { kind: 'new-block'; blockType: BlockType }
  | { kind: 'new-structure'; widths: number[] };

interface CanvasProps {
  design: EmailDesign;
  selection: Selection | null;
  drag: DragState | null;
  onDragChange: (drag: DragState | null) => void;
  onSelect: (selection: Selection | null) => void;
  onTextCommit: (blockId: string, html: string) => void;
  /** Edição inline de um pedaço com HTML próprio: devolve o novo `customHtml`. */
  onRowHtmlCommit: (rowId: string, html: string) => void;
  onBlockHtmlCommit: (blockId: string, html: string) => void;
  onRowAction: (rowId: string, action: RowAction) => void;
  onBlockAction: (rowId: string, colId: string, blockId: string, action: BlockAction) => void;
  onMoveBlockTo: (
    blockId: string,
    targetRowId: string,
    targetColId: string,
    targetIndex: number,
  ) => void;
  onMoveRowTo: (rowId: string, targetIndex: number) => void;
  onAddBlockAt: (rowId: string, colId: string, type: BlockType) => void;
  onInsertBlockAt: (rowId: string, colId: string, index: number, type: BlockType) => void;
  onInsertStructureAt: (index: number, widths: number[]) => void;
}

function ToolbarButton({
  label,
  onClick,
  onMouseDown,
  children,
  danger,
}: {
  label: string;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        'flex size-6 items-center justify-center rounded text-ink-suave hover:bg-accent-mist hover:text-ink [&_svg]:size-3.5',
        danger === true && 'hover:text-erro',
      )}
    >
      {children}
    </button>
  );
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

/**
 * Cola limpando. Sem isto o navegador insere o HTML da ORIGEM (fontes,
 * tamanhos, <p> aninhados), que quebra o layout, ignora a tipografia do
 * e-mail e ainda vai parar no envio.
 */
function aoColarLimpo(e: React.ClipboardEvent) {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const texto = e.clipboardData.getData('text/plain');
  const limpo = html !== '' ? limparHtmlColado(html) : textoParaHtml(texto);
  if (limpo !== '') exec('insertHTML', limpo);
}

// Nota: o tipo `Selection` deste arquivo é o de blocos selecionados e sombreia
// o do DOM — por isso estas funções leem a seleção do navegador sem anotá-la.

/** Elemento onde a seleção do navegador começa. */
function elementoDaSelecao(): HTMLElement | null {
  const node = window.getSelection()?.anchorNode ?? null;
  if (node instanceof HTMLElement) return node;
  return node?.parentElement ?? null;
}

/** Bloco editável que contém a seleção atual. */
function editavelDaSelecao(): HTMLElement | null {
  return elementoDaSelecao()?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
}

/**
 * Elemento de onde ler/atualizar o tamanho da fonte. Quando a seleção envolve
 * um elemento inteiro (o que acontece depois de aplicar um tamanho), a âncora
 * é o bloco PAI — medir nele leria o tamanho do bloco, e os cliques seguintes
 * não acumulariam. Aqui o span de dentro tem precedência.
 */
function elementoParaMedir(): HTMLElement | null {
  const sel = window.getSelection();
  if (sel !== null && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const inicio = range.startContainer;
    if (inicio instanceof HTMLElement) {
      const filho = inicio.childNodes[range.startOffset];
      if (filho instanceof HTMLElement) return filho;
    }
  }
  return elementoDaSelecao();
}

/**
 * Tamanho de fonte do TRECHO selecionado. O execCommand("fontSize") só aceita
 * os tamanhos legados 1–7 e gera <font size="7">; trocamos por um <span> com o
 * tamanho real em px, que é o que o e-mail entende.
 */
function aplicarTamanho(px: number) {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return;
  const raiz = editavelDaSelecao();
  if (raiz === null) return;

  // Clique repetido no mesmo trecho: atualiza o span que já existe. Sem isto
  // eles se aninhariam, e o span de DENTRO (o tamanho antigo) venceria.
  const range = sel.getRangeAt(0);
  const existente = elementoParaMedir()?.closest<HTMLElement>('span[style]');
  if (
    existente !== undefined &&
    existente !== null &&
    existente !== raiz &&
    raiz.contains(existente) &&
    existente.style.fontSize !== '' &&
    range.toString() === existente.textContent
  ) {
    existente.style.fontSize = `${String(px)}px`;
    return;
  }

  exec('fontSize', '7');
  const novos: HTMLElement[] = [];
  for (const fonte of Array.from(raiz.querySelectorAll('font[size="7"]'))) {
    const span = document.createElement('span');
    span.style.fontSize = `${String(px)}px`;
    span.innerHTML = fonte.innerHTML;
    fonte.replaceWith(span);
    novos.push(span);
  }

  // Trocar o elemento apaga a seleção — devolvê-la deixa clicar de novo para
  // continuar aumentando/diminuindo.
  if (novos.length > 0) {
    const novoRange = document.createRange();
    novoRange.setStartBefore(novos[0] as HTMLElement);
    novoRange.setEndAfter(novos[novos.length - 1] as HTMLElement);
    sel.removeAllRanges();
    sel.addRange(novoRange);
  }
}

/** Aumenta/diminui o tamanho do trecho selecionado a partir do atual. */
function ajustarTamanho(delta: number) {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed) return;
  const el = elementoParaMedir();
  const atual = el !== null ? parseFloat(window.getComputedStyle(el).fontSize) || 16 : 16;
  aplicarTamanho(Math.min(72, Math.max(8, Math.round(atual + delta))));
}

/** Alça de arrastar (blocos e linhas). */
function DragHandle({
  label,
  visible,
  className,
  onStart,
  onEnd,
  dragImageSelector,
}: {
  label: string;
  visible: boolean;
  className?: string;
  onStart: () => void;
  onEnd: () => void;
  dragImageSelector: string;
}) {
  return (
    <button
      type="button"
      draggable
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', label);
        e.dataTransfer.effectAllowed = 'move';
        const root = (e.currentTarget as HTMLElement).closest(dragImageSelector);
        if (root instanceof HTMLElement) {
          e.dataTransfer.setDragImage(root, 24, 16);
        }
        // Mudar o estado dentro do dragstart altera o DOM sob o elemento
        // arrastado e faz o Chrome CANCELAR o arraste nativo. Adiar um
        // tick deixa o navegador capturar o drag antes das zonas surgirem.
        window.setTimeout(onStart, 0);
      }}
      onDragEnd={() => onEnd()}
      className={cn(
        'absolute z-20 flex size-6 cursor-grab items-center justify-center rounded border border-line bg-paper-light text-ink-suave shadow-sm transition-opacity hover:text-ink active:cursor-grabbing',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/** Zona de soltura entre blocos de uma coluna. */
function BlockDropZone({ active, onDropBlock }: { active: boolean; onDropBlock: () => void }) {
  const [over, setOver] = useState(false);

  if (!active) return null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropBlock();
      }}
      className={cn(
        'mx-2 my-0.5 h-1.5 rounded-full transition-colors',
        over ? 'bg-wine' : 'bg-wine/20',
      )}
      aria-hidden="true"
    />
  );
}

/** Zona de soltura entre linhas do e-mail. */
function RowDropZone({ active, onDropRow }: { active: boolean; onDropRow: () => void }) {
  const [over, setOver] = useState(false);

  if (!active) return null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropRow();
      }}
      className={cn('my-1 h-3 rounded-full transition-colors', over ? 'bg-wine' : 'bg-wine/20')}
      aria-hidden="true"
    />
  );
}

/**
 * Botões de formatação de texto. Agem na seleção do navegador, então servem a
 * qualquer editável em foco — o bloco de texto comum e também o conteúdo de um
 * pedaço com HTML próprio, que continua editável no canvas.
 */
function FerramentasDeTexto() {
  return (
    <>
      <ToolbarButton
        label="Negrito"
        onMouseDown={(e) => {
          e.preventDefault();
          exec('bold');
        }}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Itálico"
        onMouseDown={(e) => {
          e.preventDefault();
          exec('italic');
        }}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Sublinhado"
        onMouseDown={(e) => {
          e.preventDefault();
          exec('underline');
        }}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        onMouseDown={(e) => {
          e.preventDefault();
          const url = window.prompt('URL do link:', 'https://');
          if (url !== null && url !== '') exec('createLink', url);
        }}
      >
        <Link2 />
      </ToolbarButton>
      <ToolbarButton
        label="Diminuir a fonte do trecho selecionado"
        onMouseDown={(e) => {
          e.preventDefault();
          ajustarTamanho(-2);
        }}
      >
        <AArrowDown />
      </ToolbarButton>
      <ToolbarButton
        label="Aumentar a fonte do trecho selecionado"
        onMouseDown={(e) => {
          e.preventDefault();
          ajustarTamanho(2);
        }}
      >
        <AArrowUp />
      </ToolbarButton>
      <ToolbarButton
        label="Limpar formatação do trecho selecionado"
        onMouseDown={(e) => {
          e.preventDefault();
          exec('removeFormat');
        }}
      >
        <RemoveFormatting />
      </ToolbarButton>
      <span className="mx-0.5 h-4 w-px bg-line" />
    </>
  );
}

function BlockToolbar({
  block,
  onAction,
}: {
  block: Block;
  onAction: (action: BlockAction) => void;
}) {
  // Texto comum OU HTML próprio: nos dois casos o conteúdo é um contentEditable
  // e os comandos de formatação funcionam sobre a seleção.
  const editaTexto = block.type === 'text' || Boolean(block.customHtml?.trim());

  return (
    <div className="absolute -top-3.5 right-1 z-20 flex items-center gap-0.5 rounded-md border border-line bg-paper-light px-1 py-0.5 shadow-lg">
      {editaTexto ? <FerramentasDeTexto /> : null}
      <ToolbarButton label="Mover para cima" onClick={() => onAction('up')}>
        <ChevronUp />
      </ToolbarButton>
      <ToolbarButton label="Mover para baixo" onClick={() => onAction('down')}>
        <ChevronDown />
      </ToolbarButton>
      <ToolbarButton label="Duplicar" onClick={() => onAction('duplicate')}>
        <Copy />
      </ToolbarButton>
      <ToolbarButton label="Remover" onClick={() => onAction('delete')} danger>
        <Trash2 />
      </ToolbarButton>
    </div>
  );
}

function BlockView({
  block,
  design,
  selected,
  onSelect,
  onTextCommit,
  onHtmlCommit,
  onAction,
  dragEnabled,
  onDragChange,
}: {
  block: Block;
  design: EmailDesign;
  selected: boolean;
  onSelect: () => void;
  onTextCommit: (html: string) => void;
  /** Recebe o `customHtml` editado direto no canvas; ausente = só leitura. */
  onHtmlCommit?: (html: string) => void;
  onAction: (action: BlockAction) => void;
  dragEnabled?: boolean;
  onDragChange?: (drag: DragState | null) => void;
}) {
  const { settings } = design;

  let content: React.ReactNode;

  // Com HTML próprio, o canvas mostra o HTML — não a versão visual dele. Se
  // continuasse desenhando pelos atributos, a tela mostraria um bloco e o
  // envio levaria outro, que é o pior desfecho possível para um editor.
  //
  // Só o CONTEÚDO muda: o wrapper lá embaixo continua dando seleção, barra de
  // ferramentas e alça de arrastar. Um bloco de código que não se pudesse
  // mover nem apagar seria uma armadilha. E o texto segue editável no lugar,
  // como num bloco comum — o que se digita volta para o `customHtml`.
  const temCodigoProprio = Boolean(block.customHtml?.trim());

  if (temCodigoProprio) {
    content = (
      <CodigoProprio html={block.customHtml as string} envolverEmTr onCommit={onHtmlCommit} />
    );
  } else
    switch (block.type) {
      case 'text':
        content = (
          <EditavelHtml
            html={block.html}
            contentEditable
            spellCheck={false}
            style={{
              fontSize: block.attrs.fontSize,
              color: block.attrs.color !== '' ? block.attrs.color : settings.textColor,
              textAlign: block.attrs.align,
              padding: block.attrs.padding,
              lineHeight: 1.6,
              fontFamily: settings.fontFamily,
              outline: 'none',
              wordBreak: 'break-word',
            }}
            onPaste={aoColarLimpo}
            onBlur={(e) => onTextCommit(e.currentTarget.innerHTML)}
          />
        );
        break;
      case 'image':
        content = (
          <div style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}>
            <img
              src={block.src}
              alt={block.alt}
              style={{
                width: block.attrs.width !== null ? `${String(block.attrs.width)}px` : '100%',
                maxWidth: '100%',
                borderRadius: block.attrs.borderRadius,
                display: 'inline-block',
              }}
            />
          </div>
        );
        break;
      case 'button':
        content = (
          <div style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: block.attrs.backgroundColor,
                color: block.attrs.color,
                fontSize: block.attrs.fontSize,
                fontWeight: 700,
                borderRadius: block.attrs.borderRadius,
                padding: '12px 32px',
                fontFamily: settings.fontFamily,
              }}
            >
              {block.text}
            </span>
          </div>
        );
        break;
      case 'spacer':
        content = (
          <div
            style={{ height: block.attrs.height }}
            className={cn(
              selected &&
                'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(114,20,32,0.12)_6px,rgba(114,20,32,0.12)_12px)]',
            )}
          />
        );
        break;
      case 'divider':
        content = (
          <div style={{ padding: block.attrs.padding }}>
            <div
              style={{
                borderTop: `${String(block.attrs.borderWidth)}px solid ${block.attrs.borderColor}`,
              }}
            />
          </div>
        );
        break;
      case 'social':
        content = (
          <div style={{ padding: block.attrs.padding, textAlign: block.attrs.align }}>
            {block.items.map((item, index) => (
              <img
                key={index}
                src={item.iconSrc}
                alt={item.label}
                style={{
                  width: block.attrs.iconSize,
                  height: block.attrs.iconSize,
                  borderRadius: '50%',
                  display: 'inline-block',
                  margin: '0 6px',
                }}
              />
            ))}
          </div>
        );
        break;
    }

  return (
    <div
      data-block-root
      className={cn(
        'group/block relative rounded-sm transition-shadow',
        selected ? 'ring-2 ring-wine' : 'hover:ring-1 hover:ring-wine/40',
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {selected ? <BlockToolbar block={block} onAction={onAction} /> : null}
      {dragEnabled === true && onDragChange !== undefined ? (
        <DragHandle
          label="Arrastar bloco"
          visible={selected}
          className={cn(
            'left-1 top-1',
            !selected && 'group-hover/block:pointer-events-auto group-hover/block:opacity-100',
          )}
          dragImageSelector="[data-block-root]"
          onStart={() => onDragChange({ kind: 'block', blockId: block.id })}
          onEnd={() => onDragChange(null)}
        />
      ) : null}
      {temCodigoProprio ? <SeloDeCodigo /> : null}
      {content}
    </div>
  );
}

/**
 * contentEditable FORA do reconciliador do React.
 *
 * Com dangerouslySetInnerHTML, o commit do React reescreve o innerHTML em
 * re-renders mesmo quando o __html é idêntico — recriando os nós de texto e
 * matando caret e seleção. Como clicar num bloco re-renderiza (seleção), a
 * edição virava roleta: o cursor não ficava onde se clicou e a seleção se
 * desfazia sozinha. Aqui o HTML entra imperativamente, e SÓ quando o VALOR da
 * prop muda de fato (deps do efeito) — re-render sem mudança não toca no DOM.
 */
function EditavelHtml({ html, ...props }: { html: string } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el !== null && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);
  return <div ref={ref} suppressContentEditableWarning {...props} />;
}

/**
 * Desenha um pedaço escrito à mão.
 *
 * O HTML é do próprio autor, já sem `<script>` e sem `on*`
 * (limparHtmlDoUsuario), exibido na tela dele via EditavelHtml.
 *
 * Com `onCommit`, o pedaço continua editável como texto: passar para o código
 * não pode custar o WYSIWYG. A pessoa clica, escreve e formata como num bloco
 * comum, e ao sair do campo o HTML editado volta para o `customHtml` — passando
 * de novo pelo limparHtmlDoUsuario, porque um colar pode trazer script. Sem
 * `onCommit` (previews de módulo), fica só leitura como antes.
 *
 * `envolverEmTr` é para bloco: o que o usuário escreve é um `<td>`, e `<td>`
 * solto no documento é descartado pelo navegador — a tabela e o `<tr>` daqui
 * são os mesmos que a compilação põe em volta, então a tela mostra o que o
 * e-mail vai ter. A linha já traz a tabela inteira e vai direto. Ao guardar,
 * o caminho inverso: sai o `<tr>` do wrapper, fica só o conteúdo dele.
 */
function CodigoProprio({
  html,
  envolverEmTr,
  onCommit,
}: {
  html: string;
  envolverEmTr?: boolean;
  onCommit?: (html: string) => void;
}) {
  // O host da edição é sempre um <div>: Safari se recusa a pôr o caret quando
  // o próprio contentEditable é um elemento de tabela (tbody/tr/td). Por isso
  // o bloco NÃO edita a tabela-wrapper diretamente — o div de fora é o
  // editável e a tabela vive dentro dele.
  const edicao =
    onCommit !== undefined
      ? ({
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: false,
          style: { outline: 'none' },
          onPaste: aoColarLimpo,
        } as const)
      : null;

  if (envolverEmTr !== true) {
    return (
      <EditavelHtml
        html={html}
        {...edicao}
        onBlur={
          onCommit !== undefined
            ? (e) => onCommit(limparHtmlDoUsuario(e.currentTarget.innerHTML))
            : undefined
        }
      />
    );
  }
  return (
    <EditavelHtml
      html={`<table style="width:100%;border-collapse:collapse"><tbody><tr>${html}</tr></tbody></table>`}
      {...edicao}
      // Clique na borda do bloco põe o caret FORA do <td> (filho direto do
      // host, antes/depois da tabela) — o que se digitasse ali ficaria fora
      // do commit. Empurra o caret para dentro da célula mais próxima.
      onClick={onCommit !== undefined ? (e) => caretParaDentroDoTd(e.currentTarget) : undefined}
      onFocus={onCommit !== undefined ? (e) => caretParaDentroDoTd(e.currentTarget) : undefined}
      onBlur={
        onCommit !== undefined
          ? (e) => {
              // Guarda-se só o miolo do <tr> — a tabela e o <tr> são do
              // canvas, e a compilação põe os dela. Se a edição engoliu a
              // tabela inteira, vale o que sobrou (vazio inclusive: aí o
              // override cai e o bloco volta ao visual).
              onCommit(limparHtmlDoUsuario(mioloDoTr(e.currentTarget)));
            }
          : undefined
      }
    />
  );
}

/**
 * Serializa o conteúdo editado de um bloco-wrapper (host > table > tr > td).
 *
 * O navegador às vezes deixa conteúdo digitado FORA da tabela (caret na borda
 * do host). Descartá-lo seria sumir com texto que a pessoa viu na tela — o que
 * ficou de fora é reencaixado no começo/fim da primeira/última célula.
 */
function mioloDoTr(host: HTMLElement): string {
  const tabela = host.querySelector('table');
  const tr = tabela?.querySelector('tr');
  if (tabela === null || tr === null || tr === undefined) return host.innerHTML;

  const antes: string[] = [];
  const depois: string[] = [];
  let passouTabela = false;
  for (const filho of Array.from(host.childNodes)) {
    if (filho === tabela) {
      passouTabela = true;
      continue;
    }
    const trecho =
      filho.nodeType === Node.TEXT_NODE
        ? (filho.textContent ?? '')
        : filho instanceof HTMLElement
          ? filho.outerHTML
          : '';
    if (trecho.trim() === '') continue;
    (passouTabela ? depois : antes).push(trecho);
  }

  const tds = tr.querySelectorAll('td');
  if (tds.length > 0) {
    if (antes.length > 0) (tds[0] as HTMLElement).insertAdjacentHTML('afterbegin', antes.join(''));
    if (depois.length > 0)
      (tds[tds.length - 1] as HTMLElement).insertAdjacentHTML('beforeend', depois.join(''));
    return tr.innerHTML;
  }
  // Sem célula nenhuma: vale tudo o que sobrou, na ordem.
  return [antes.join(''), tr.innerHTML, depois.join('')].join('');
}

/**
 * Caret solto no host (fora de qualquer <td>) vai para a célula mais próxima.
 *
 * Adiado para depois do evento: no `focus`, o navegador ainda não assentou a
 * seleção — corrigir na hora leria a seleção antiga (ou nenhuma) e desistiria.
 */
function caretParaDentroDoTd(host: HTMLElement) {
  setTimeout(() => {
    if (document.activeElement !== host) return;
    const sel = window.getSelection();
    if (sel === null || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const el = node instanceof HTMLElement ? node : node.parentElement;
    if (el === null || !host.contains(el)) return;
    if (el.closest('td') !== null) return; // já está dentro de uma célula
    const tds = host.querySelectorAll('td');
    if (tds.length === 0) return;
    const noInicio = range.startOffset === 0;
    const td = (noInicio ? tds[0] : tds[tds.length - 1]) as HTMLElement;
    const novo = document.createRange();
    novo.selectNodeContents(td);
    novo.collapse(noInicio);
    sel.removeAllRanges();
    sel.addRange(novo);
  }, 0);
}

/**
 * Sem o selo, um pedaço com código próprio ficaria idêntico a um comum — e a
 * pessoa mexeria nos controles laterais sem entender por que nada muda.
 *
 * No rodapé à esquerda porque o topo inteiro já é de alguém: alça de arrastar
 * de um lado, barra de ferramentas do outro, e a barra some por cima do selo
 * justamente quando o pedaço está selecionado.
 */
function SeloDeCodigo() {
  return (
    <span className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium text-paper-light">
      HTML próprio
    </span>
  );
}

function ColumnView({
  row,
  column,
  design,
  selection,
  drag,
  onSelect,
  onTextCommit,
  onBlockHtmlCommit,
  onBlockAction,
  onDragChange,
  onMoveBlockTo,
  onAddBlockAt,
  onInsertBlockAt,
}: {
  row: Row;
  column: Column;
  design: EmailDesign;
  selection: Selection | null;
  drag: DragState | null;
  onSelect: (selection: Selection) => void;
  onTextCommit: (blockId: string, html: string) => void;
  onBlockHtmlCommit: (blockId: string, html: string) => void;
  onBlockAction: CanvasProps['onBlockAction'];
  onDragChange: (drag: DragState | null) => void;
  onMoveBlockTo: CanvasProps['onMoveBlockTo'];
  onAddBlockAt: CanvasProps['onAddBlockAt'];
  onInsertBlockAt: CanvasProps['onInsertBlockAt'];
}) {
  const [overEmpty, setOverEmpty] = useState(false);

  const columnSelected =
    selection?.rowId === row.id && selection.colId === column.id && selection.blockId === undefined;

  // Aceita tanto mover um bloco existente quanto inserir um bloco novo da paleta.
  const blockDragActive = drag?.kind === 'block' || drag?.kind === 'new-block';

  // Solta um bloco na posição `index` desta coluna (mover ou inserir novo).
  function dropBlockAt(index: number) {
    if (drag?.kind === 'block') {
      onMoveBlockTo(drag.blockId, row.id, column.id, index);
    } else if (drag?.kind === 'new-block') {
      onInsertBlockAt(row.id, column.id, index, drag.blockType);
    }
  }

  return (
    <div style={{ width: `${String(column.widthPct)}%` }} className="min-w-0">
      {column.blocks.length === 0 && columnSelected && !blockDragActive ? (
        // Seletor de blocos direto na coluna: um clique escolhe e insere.
        <div
          className="m-1 grid grid-cols-2 gap-1.5 rounded border border-wine/60 bg-accent-mist/50 p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => {
            const Icon = PICKER_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddBlockAt(row.id, column.id, type);
                }}
                className="flex items-center gap-1.5 rounded border border-line bg-paper-light px-2 py-1.5 text-xs font-medium hover:border-wine hover:text-wine"
              >
                <Icon className="size-3.5 shrink-0 text-ink-suave" />
                {BLOCK_LABELS[type]}
              </button>
            );
          })}
        </div>
      ) : column.blocks.length === 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ rowId: row.id, colId: column.id });
          }}
          onDragOver={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              : undefined
          }
          onDragEnter={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  setOverEmpty(true);
                }
              : undefined
          }
          onDragLeave={blockDragActive ? () => setOverEmpty(false) : undefined}
          onDrop={
            blockDragActive
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOverEmpty(false);
                  dropBlockAt(0);
                }
              : undefined
          }
          className={cn(
            'm-1 flex min-h-16 w-[calc(100%-8px)] items-center justify-center rounded border border-dashed text-xs',
            overEmpty
              ? 'border-wine bg-accent-mist text-wine'
              : 'border-line text-ink-suave hover:border-wine/50',
          )}
        >
          {blockDragActive ? 'Soltar aqui' : '+ Adicionar bloco'}
        </button>
      ) : (
        <>
          <BlockDropZone active={blockDragActive} onDropBlock={() => dropBlockAt(0)} />
          {column.blocks.map((block, index) => (
            <Fragment key={block.id}>
              <BlockView
                block={block}
                design={design}
                selected={selection?.blockId === block.id}
                onSelect={() =>
                  onSelect({
                    rowId: row.id,
                    colId: column.id,
                    blockId: block.id,
                  })
                }
                onTextCommit={(html) => onTextCommit(block.id, html)}
                onHtmlCommit={(html) => onBlockHtmlCommit(block.id, html)}
                onAction={(action) => onBlockAction(row.id, column.id, block.id, action)}
                dragEnabled
                onDragChange={onDragChange}
              />
              <BlockDropZone active={blockDragActive} onDropBlock={() => dropBlockAt(index + 1)} />
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}

export function RowView({
  row,
  design,
  selection,
  drag,
  onSelect,
  onTextCommit,
  onHtmlCommit,
  onBlockHtmlCommit,
  onRowAction,
  onBlockAction,
  onDragChange,
  onMoveBlockTo,
  onAddBlockAt,
  onInsertBlockAt,
  readOnly,
}: {
  row: Row;
  design: EmailDesign;
  selection?: Selection | null;
  drag?: DragState | null;
  onSelect?: (selection: Selection) => void;
  onTextCommit?: (blockId: string, html: string) => void;
  /** Recebe o `customHtml` DA LINHA editado direto no canvas. */
  onHtmlCommit?: (html: string) => void;
  /** Idem para o `customHtml` de um bloco dentro dela. */
  onBlockHtmlCommit?: (blockId: string, html: string) => void;
  onRowAction?: (action: RowAction) => void;
  onBlockAction?: CanvasProps['onBlockAction'];
  onDragChange?: (drag: DragState | null) => void;
  onMoveBlockTo?: CanvasProps['onMoveBlockTo'];
  onAddBlockAt?: CanvasProps['onAddBlockAt'];
  onInsertBlockAt?: CanvasProps['onInsertBlockAt'];
  readOnly?: boolean;
}) {
  const rowSelected =
    readOnly !== true &&
    selection?.rowId === row.id &&
    selection.blockId === undefined &&
    selection.colId === undefined;

  // Estrutura com HTML próprio: as colunas continuam guardadas, mas não são o
  // que sai no e-mail, então não é o que a tela mostra. Como no bloco, troca-se
  // só o conteúdo — mover, duplicar e remover a linha continuam funcionando.
  const rowTemCodigoProprio = Boolean(row.customHtml?.trim());

  return (
    <div
      data-row-root
      className={cn(
        'group/row relative',
        readOnly !== true && 'rounded-sm',
        rowSelected ? 'ring-2 ring-wine' : readOnly !== true && 'hover:ring-1 hover:ring-wine/30',
      )}
      style={{
        backgroundColor:
          row.attrs.backgroundColor !== ''
            ? row.attrs.backgroundColor
            : design.settings.contentBackground,
        padding: row.attrs.padding,
      }}
      onClick={
        readOnly === true
          ? undefined
          : (e) => {
              e.stopPropagation();
              onSelect?.({ rowId: row.id });
            }
      }
    >
      {rowSelected && onRowAction !== undefined ? (
        <div className="absolute -top-3.5 right-1 z-20 flex items-center gap-0.5 rounded-md border border-line bg-paper-light px-1 py-0.5 shadow-lg">
          {/* Com HTML próprio o conteúdo da linha é um editável — os botões de
              formatação valem aqui do mesmo jeito que num bloco de texto. */}
          {rowTemCodigoProprio ? <FerramentasDeTexto /> : null}
          <ToolbarButton label="Mover para cima" onClick={() => onRowAction('up')}>
            <ChevronUp />
          </ToolbarButton>
          <ToolbarButton label="Mover para baixo" onClick={() => onRowAction('down')}>
            <ChevronDown />
          </ToolbarButton>
          <ToolbarButton label="Duplicar" onClick={() => onRowAction('duplicate')}>
            <Copy />
          </ToolbarButton>
          <ToolbarButton label="Salvar como módulo" onClick={() => onRowAction('saveModule')}>
            <Bookmark />
          </ToolbarButton>
          <ToolbarButton label="Remover linha" onClick={() => onRowAction('delete')} danger>
            <Trash2 />
          </ToolbarButton>
        </div>
      ) : null}

      {readOnly !== true && onDragChange !== undefined ? (
        <DragHandle
          label="Arrastar linha"
          visible={rowSelected}
          className={cn(
            '-top-3.5 left-1',
            !rowSelected && 'group-hover/row:pointer-events-auto group-hover/row:opacity-100',
          )}
          dragImageSelector="[data-row-root]"
          onStart={() => onDragChange({ kind: 'row', rowId: row.id })}
          onEnd={() => onDragChange(null)}
        />
      ) : null}

      {rowTemCodigoProprio && readOnly !== true ? <SeloDeCodigo /> : null}

      {rowTemCodigoProprio ? (
        <CodigoProprio
          html={row.customHtml as string}
          onCommit={readOnly === true ? undefined : onHtmlCommit}
        />
      ) : (
        <div className="flex flex-wrap">
          {row.columns.map((column) =>
            readOnly === true ? (
              <div
                key={column.id}
                style={{ width: `${String(column.widthPct)}%` }}
                className="min-w-0"
              >
                {column.blocks.map((block) => (
                  <BlockView
                    key={block.id}
                    block={block}
                    design={design}
                    selected={false}
                    onSelect={() => undefined}
                    onTextCommit={() => undefined}
                    onAction={() => undefined}
                  />
                ))}
              </div>
            ) : (
              <ColumnView
                key={column.id}
                row={row}
                column={column}
                design={design}
                selection={selection ?? null}
                drag={drag ?? null}
                onSelect={onSelect as (selection: Selection) => void}
                onTextCommit={onTextCommit as (blockId: string, html: string) => void}
                onBlockHtmlCommit={onBlockHtmlCommit as (blockId: string, html: string) => void}
                onBlockAction={onBlockAction as CanvasProps['onBlockAction']}
                onDragChange={onDragChange as (drag: DragState | null) => void}
                onMoveBlockTo={onMoveBlockTo as CanvasProps['onMoveBlockTo']}
                onAddBlockAt={onAddBlockAt as CanvasProps['onAddBlockAt']}
                onInsertBlockAt={onInsertBlockAt as CanvasProps['onInsertBlockAt']}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Escala de visualização: 1 quando o e-mail cabe; a fração exata quando não.
 *
 * Pura e exportada para o teste — o jsdom não mede layout, então o cálculo
 * precisa ser verificável sem navegador.
 */
export function escalaDeVisualizacao(disponivel: number, largura: number): number {
  // `NaN` entra quando o padding computado não é mensurável (jsdom, render
  // fora da árvore). `zoom: NaN` é inválido e o navegador reclama — medida
  // indisponível se trata como "não escale", igual à medida ainda não feita.
  if (!Number.isFinite(disponivel) || disponivel <= 0 || largura <= 0) return 1;
  return Math.min(1, disponivel / largura);
}

/**
 * Mede o espaço disponível e devolve a escala para a largura configurada.
 *
 * Um e-mail de 800px numa tela estreita não cabe ao lado do painel. Encolher o
 * contêiner (max-width) faria o conteúdo REFLUIR — colunas quebrando, texto
 * reajustando — e a tela deixaria de mostrar o que o e-mail é. Escalar a
 * visualização inteira preserva o layout real, só menor: é zoom, não reflow.
 *
 * `zoom` (CSS) em vez de transform: ele participa do layout — a altura
 * acompanha a escala sem compensação manual — e funciona com contentEditable
 * e drag and drop, que continuam recebendo as coordenadas certas.
 */
function useEscalaDoCanvas(largura: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  escala: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    /**
     * Medição direta, não só via ResizeObserver: o callback do observador roda
     * junto do pipeline de renderização, e a PRIMEIRA medida precisa acontecer
     * antes do primeiro paint — senão um e-mail largo pisca no tamanho cheio
     * antes de encolher. O observador entra como refinamento para mudanças de
     * contêiner que não vêm da janela; o `resize` cobre o resto em qualquer
     * ambiente (o jsdom dos testes não tem ResizeObserver).
     */
    const medir = () => {
      const estilos = window.getComputedStyle(el);
      const disponivel =
        el.clientWidth - parseFloat(estilos.paddingLeft) - parseFloat(estilos.paddingRight);
      setEscala(escalaDeVisualizacao(disponivel, largura));
    };

    medir();
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    observador?.observe(el);
    return () => {
      window.removeEventListener('resize', medir);
      observador?.disconnect();
    };
  }, [largura]);

  return { ref, escala };
}

export function Canvas({
  design,
  selection,
  drag,
  onDragChange,
  onSelect,
  onTextCommit,
  onRowHtmlCommit,
  onBlockHtmlCommit,
  onRowAction,
  onBlockAction,
  onMoveBlockTo,
  onMoveRowTo,
  onAddBlockAt,
  onInsertBlockAt,
  onInsertStructureAt,
}: CanvasProps) {
  // Zonas entre linhas aceitam reordenar linha OU inserir estrutura da paleta.
  const rowDragActive = drag?.kind === 'row' || drag?.kind === 'new-structure';
  const [overEmpty, setOverEmpty] = useState(false);

  // Solta uma linha na posição `index` (mover existente ou inserir estrutura).
  function dropRowAt(index: number) {
    if (drag?.kind === 'row') onMoveRowTo(drag.rowId, index);
    else if (drag?.kind === 'new-structure') onInsertStructureAt(index, drag.widths);
  }

  const largura = larguraDoConteudo(design.settings);
  const { ref: medidorRef, escala } = useEscalaDoCanvas(largura);

  return (
    <div
      ref={medidorRef}
      // `min-w-0`: numa célula de grid, a largura mínima automática é o
      // min-content — e um e-mail de 800px fixos forçaria a coluna a crescer,
      // empurrando o painel lateral para fora da tela em vez de encolher.
      // Sem isto o medidor nunca vê menos que a largura do e-mail, e a escala
      // nunca dispara: era exatamente o estouro reportado.
      className="min-w-0 rounded-xl border border-line p-4 sm:p-8"
      style={{ backgroundColor: design.settings.bodyBackground }}
      onClick={() => onSelect(null)}
    >
      {escala < 1 && (
        <p className="mb-3 text-center text-xs text-ink-suave">
          Visualização a {String(Math.round(escala * 100))}% — o e-mail sai com {String(largura)}
          px de largura.
        </p>
      )}
      <div className="mx-auto" style={{ width: largura, zoom: escala }}>
        {design.rows.length === 0 ? (
          <div
            onDragOver={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                : undefined
            }
            onDragEnter={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    setOverEmpty(true);
                  }
                : undefined
            }
            onDragLeave={rowDragActive ? () => setOverEmpty(false) : undefined}
            onDrop={
              rowDragActive
                ? (e) => {
                    e.preventDefault();
                    setOverEmpty(false);
                    dropRowAt(0);
                  }
                : undefined
            }
            className={cn(
              'rounded border border-dashed py-16 text-center text-sm transition-colors',
              overEmpty
                ? 'border-wine bg-accent-mist text-wine'
                : 'border-line bg-white/50 text-ink-suave',
            )}
          >
            {drag?.kind === 'new-structure'
              ? 'Solte aqui para adicionar a estrutura'
              : 'E-mail vazio — arraste uma estrutura ou clique nela no painel ao lado.'}
          </div>
        ) : (
          <>
            <RowDropZone active={rowDragActive} onDropRow={() => dropRowAt(0)} />
            {design.rows.map((row, index) => (
              <Fragment key={row.id}>
                <RowView
                  row={row}
                  design={design}
                  selection={selection}
                  drag={drag}
                  onSelect={onSelect}
                  onTextCommit={onTextCommit}
                  onHtmlCommit={(html) => onRowHtmlCommit(row.id, html)}
                  onBlockHtmlCommit={onBlockHtmlCommit}
                  onRowAction={(action) => onRowAction(row.id, action)}
                  onBlockAction={onBlockAction}
                  onDragChange={onDragChange}
                  onMoveBlockTo={onMoveBlockTo}
                  onAddBlockAt={onAddBlockAt}
                  onInsertBlockAt={onInsertBlockAt}
                />
                <RowDropZone active={rowDragActive} onDropRow={() => dropRowAt(index + 1)} />
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
