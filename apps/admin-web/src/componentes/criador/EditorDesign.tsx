// Superfície de edição do Criador de e-mails (Canvas + paleta lateral),
// controlada: recebe o design em `value` e emite o novo em `onChange`.
//
// Reaproveitada tanto na criação de modelos quanto na edição do e-mail dentro
// do assistente de campanha — é o porte do design-editor da referência.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Redo2, RotateCcw, Undo2 } from 'lucide-react';

import {
  absorverHtmlEmBlocoDeTexto,
  aplicarAttrsNaEstrutura,
  aplicarAttrsNoBloco,
} from '../../lib/criador/absorver.js';
import { isValidRow } from '@emailmkt/criador';
import {
  addBlock,
  addRow,
  cloneRowWithNewIds,
  comCustomHtml,
  createRow,
  duplicateBlock,
  duplicateRow,
  insertBlockAt,
  insertRowAt,
  moveBlock,
  moveBlockTo,
  moveRow,
  moveRowTo,
  removeBlock,
  removeRow,
  setBlockCustomHtml,
  setRowCustomHtml,
  uid,
  updateBlock,
  updateRowAttrs,
} from '@emailmkt/criador';
import { BLOCK_LABELS, createBlock } from '@emailmkt/criador';
import type {
  Block,
  BlockType,
  DesignSettings,
  EmailDesign,
  Row,
  SavedModule,
} from '@emailmkt/criador';
import {
  Canvas,
  type BlockAction,
  type DragState,
  type RowAction,
  type Selection,
} from './Canvas.tsx';
import { Dialogo } from './Dialogo.tsx';
import { PainelCodigo, type AlvoDoCodigo } from './PainelCodigo.tsx';
import { Sidebar } from './Sidebar.tsx';

// ─── Módulos no navegador ────────────────────────────────────────
//
// A referência guarda módulos no servidor; aqui ficam no localStorage, como o
// editor anterior já fazia — um módulo é conveniência de quem monta, não dado
// do sistema. A chave é NOVA porque o formato mudou: antes era MJML do
// GrapesJS, agora é uma linha do design — um não abre no outro.

const CHAVE_MODULOS = 'emailmkt:criador-modulos';

function lerModulos(): SavedModule[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_MODULOS);
    if (bruto === null) return [];
    const lista = JSON.parse(bruto) as SavedModule[];
    return lista.filter((m) => isValidRow(m.design));
  } catch {
    return [];
  }
}

function gravarModulos(modulos: readonly SavedModule[]): void {
  try {
    window.localStorage.setItem(CHAVE_MODULOS, JSON.stringify(modulos));
  } catch {
    // Sem espaço ou modo privado: o editor continua funcionando sem módulos.
  }
}

export function EditorDesign({
  value,
  onChange,
}: {
  value: EmailDesign;
  onChange: (design: EmailDesign) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modules, setModules] = useState<SavedModule[]>(() => lerModulos());
  const [drag, setDrag] = useState<DragState | null>(null);

  const [alvoDoCodigo, setAlvoDoCodigo] = useState<AlvoDoCodigo | null>(null);

  const [moduleRowId, setModuleRowId] = useState<string | null>(null);
  const [moduleName, setModuleName] = useState('');

  // ─── Desfazer / refazer ──────────────────────────────────────
  //
  // Toda mudança de design passa por `apply`, então o histórico vive aqui:
  // antes de aplicar, o estado atual vai para a pilha. Applies em sequência
  // rápida (digitação num campo dispara um por tecla) colapsam num passo só.

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const passadoRef = useRef<EmailDesign[]>([]);
  const futuroRef = useRef<EmailDesign[]>([]);
  const ultimoApplyRef = useRef(0);
  const [, marcarHistorico] = useState(0);

  const apply = (fn: (design: EmailDesign) => EmailDesign) => {
    const agora = Date.now();
    if (agora - ultimoApplyRef.current > 600) {
      passadoRef.current.push(valueRef.current);
      if (passadoRef.current.length > 100) passadoRef.current.shift();
    }
    ultimoApplyRef.current = agora;
    futuroRef.current = [];
    marcarHistorico((v) => v + 1);
    onChangeRef.current(fn(valueRef.current));
  };

  const undo = useCallback(() => {
    const anterior = passadoRef.current.pop();
    if (anterior === undefined) return;
    futuroRef.current.push(valueRef.current);
    ultimoApplyRef.current = 0; // o próximo apply abre um passo novo
    marcarHistorico((v) => v + 1);
    onChangeRef.current(anterior);
  }, []);

  const redo = useCallback(() => {
    const seguinte = futuroRef.current.pop();
    if (seguinte === undefined) return;
    passadoRef.current.push(valueRef.current);
    ultimoApplyRef.current = 0;
    marcarHistorico((v) => v + 1);
    onChangeRef.current(seguinte);
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const tecla = e.key.toLowerCase();
      if (tecla !== 'z' && tecla !== 'y') return;
      // Dentro de campo de texto ou edição inline, vale o desfazer nativo.
      const ativo = document.activeElement as HTMLElement | null;
      if (
        ativo !== null &&
        (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA' || ativo.isContentEditable)
      )
        return;
      e.preventDefault();
      if (tecla === 'y' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [undo, redo]);

  // ─── Inserções da paleta ─────────────────────────────────────

  function handleAddStructure(widths: number[]) {
    const row = createRow(widths);
    apply((d) => addRow(d, row, selection?.rowId ?? null));
    setSelection({ rowId: row.id });
  }

  function handleAddBlock(type: BlockType) {
    const block = createBlock(type);

    let targetRowId = selection?.rowId ?? null;
    let targetColId = selection?.colId ?? null;
    const afterBlockId = selection?.blockId ?? null;

    if (targetRowId === null) {
      const last = value.rows[value.rows.length - 1];
      if (last !== undefined) {
        targetRowId = last.id;
        targetColId = (last.columns[0] as Row['columns'][0]).id;
      } else {
        const row = createRow([100]);
        targetRowId = row.id;
        targetColId = (row.columns[0] as Row['columns'][0]).id;
        apply((d) => addRow(d, row, null));
      }
    } else if (targetColId === null) {
      const row = value.rows.find((r) => r.id === targetRowId);
      targetColId = row?.columns[0]?.id ?? null;
    }

    if (targetRowId === null || targetColId === null) return;
    const rowId = targetRowId;
    const colId = targetColId;
    apply((d) => addBlock(d, rowId, colId, block, afterBlockId));
    setSelection({ rowId, colId, blockId: block.id });
  }

  function handleInsertModule(module: SavedModule) {
    const row = cloneRowWithNewIds(module.design);
    apply((d) => addRow(d, row, selection?.rowId ?? null));
    setSelection({ rowId: row.id });
  }

  function handleDeleteModule(id: string) {
    const proximos = modules.filter((m) => m.id !== id);
    setModules(proximos);
    gravarModulos(proximos);
  }

  // ─── Ações do canvas ─────────────────────────────────────────

  function handleRowAction(rowId: string, action: RowAction) {
    if (action === 'saveModule') {
      setModuleRowId(rowId);
      setModuleName('');
      return;
    }
    if (action === 'delete') {
      apply((d) => removeRow(d, rowId));
      setSelection(null);
      return;
    }
    if (action === 'duplicate') {
      apply((d) => duplicateRow(d, rowId));
      return;
    }
    apply((d) => moveRow(d, rowId, action === 'up' ? -1 : 1));
  }

  function handleBlockAction(rowId: string, colId: string, blockId: string, action: BlockAction) {
    if (action === 'delete') {
      apply((d) => removeBlock(d, rowId, colId, blockId));
      setSelection({ rowId, colId });
      return;
    }
    if (action === 'duplicate') {
      apply((d) => duplicateBlock(d, rowId, colId, blockId));
      return;
    }
    apply((d) => moveBlock(d, rowId, colId, blockId, action === 'up' ? -1 : 1));
  }

  function handleAddBlockAt(rowId: string, colId: string, type: BlockType) {
    const block = createBlock(type);
    apply((d) => addBlock(d, rowId, colId, block, null));
    setSelection({ rowId, colId, blockId: block.id });
  }

  // Insere um bloco novo (arrastado da paleta) numa posição exata da coluna.
  function handleInsertBlockAt(rowId: string, colId: string, index: number, type: BlockType) {
    const block = createBlock(type);
    apply((d) => insertBlockAt(d, rowId, colId, block, index));
    setSelection({ rowId, colId, blockId: block.id });
  }

  // Insere uma estrutura nova (arrastada da paleta) numa posição exata.
  function handleInsertStructureAt(index: number, widths: number[]) {
    const row = createRow(widths);
    apply((d) => insertRowAt(d, row, index));
    setSelection({ rowId: row.id });
  }

  function handleMoveBlockTo(
    blockId: string,
    targetRowId: string,
    targetColId: string,
    targetIndex: number,
  ) {
    apply((d) => moveBlockTo(d, blockId, targetRowId, targetColId, targetIndex));
    setSelection({ rowId: targetRowId, colId: targetColId, blockId });
  }

  function handleMoveRowTo(rowId: string, targetIndex: number) {
    apply((d) => moveRowTo(d, rowId, targetIndex));
    setSelection({ rowId });
  }

  function handleUpdateBlock(blockId: string, updater: (b: Block) => Block) {
    apply((d) =>
      updateBlock(d, blockId, (b) => {
        // Texto com override antigo: a primeira mexida no painel absorve o
        // código e o ajuste já cai num bloco comum.
        const base =
          b.type === 'text' && b.customHtml !== undefined && b.customHtml.trim() !== ''
            ? absorverHtmlEmBlocoDeTexto(b, b.customHtml)
            : b;
        const novo = updater(base);
        // Demais tipos com HTML próprio: o controle escreve direto no código.
        return novo.type !== 'text' &&
          novo.customHtml !== undefined &&
          novo.customHtml.trim() !== ''
          ? { ...novo, customHtml: aplicarAttrsNoBloco(novo) }
          : novo;
      }),
    );
  }

  function handleUpdateRowAttrs(rowId: string, patch: Partial<Row['attrs']>) {
    apply((d) => {
      const comAttrs = updateRowAttrs(d, rowId, patch);
      // Estrutura com HTML próprio: fundo/espaçamento entram no código também.
      return {
        ...comAttrs,
        rows: comAttrs.rows.map((r) =>
          r.id === rowId && r.customHtml !== undefined && r.customHtml.trim() !== ''
            ? { ...r, customHtml: aplicarAttrsNaEstrutura(r.customHtml, r.attrs) }
            : r,
        ),
      };
    });
  }

  function handleUpdateSettings(patch: Partial<DesignSettings>) {
    apply((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  // ─── Código à mão ────────────────────────────────────────────

  /**
   * O que o botão "Código" abre depende do que está selecionado — bloco, ou a
   * estrutura, ou (sem seleção) o e-mail inteiro. É a mesma lógica que a pessoa
   * já usa para editar: clicou no pedaço, o painel fala daquele pedaço.
   */
  const alvoAtual: AlvoDoCodigo = (() => {
    if (selection?.blockId !== undefined) {
      const achado = value.rows
        .flatMap((r) => r.columns.flatMap((c) => c.blocks))
        .find((b) => b.id === selection.blockId);
      if (achado !== undefined) {
        return {
          tipo: 'bloco',
          id: achado.id,
          rotulo: BLOCK_LABELS[achado.type],
          blockType: achado.type,
        };
      }
    }
    if (selection?.rowId !== undefined) return { tipo: 'linha', id: selection.rowId };
    return { tipo: 'documento' };
  })();

  const acharBloco = (blockId: string) =>
    value.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).find((b) => b.id === blockId);

  /**
   * HTML editado de um bloco: TEXTO absorve o código e segue bloco comum
   * (conteúdo vira `html`, moldura vira atributos — nada de override, os
   * controles do painel continuam valendo). Os demais tipos não têm para onde
   * absorver e ficam com o override de sempre.
   */
  function aplicarHtmlNoBloco(blockId: string, html: string | null) {
    const bloco = acharBloco(blockId);
    if (bloco?.type === 'text' && html !== null && html !== '') {
      apply((d) =>
        updateBlock(d, blockId, (b) =>
          b.type === 'text' ? absorverHtmlEmBlocoDeTexto(b, html) : b,
        ),
      );
      return;
    }
    apply((d) => setBlockCustomHtml(d, blockId, html));
  }

  const htmlProprioDoAlvo = (alvo: AlvoDoCodigo): string | null => {
    if (alvo.tipo === 'documento') return value.customHtml ?? null;
    if (alvo.tipo === 'linha') {
      return value.rows.find((r) => r.id === alvo.id)?.customHtml ?? null;
    }
    return (
      value.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).find((b) => b.id === alvo.id)
        ?.customHtml ?? null
    );
  };

  function aplicarCodigo(alvo: AlvoDoCodigo, html: string | null) {
    if (alvo.tipo === 'documento') {
      apply((d) => comCustomHtml(d, html));
    } else if (alvo.tipo === 'linha') {
      apply((d) => setRowCustomHtml(d, alvo.id, html));
    } else {
      aplicarHtmlNoBloco(alvo.id, html);
    }
    setAlvoDoCodigo(null);
  }

  // ─── Salvar módulo (linha reutilizável) ──────────────────────

  function handleSaveModule() {
    if (moduleRowId === null) return;
    const row = value.rows.find((r) => r.id === moduleRowId);
    if (row === undefined || moduleName.trim() === '') return;
    const novo: SavedModule = {
      id: uid(),
      name: moduleName.trim(),
      design: row,
      createdAt: new Date().toISOString(),
    };
    const proximos = [...modules, novo];
    setModules(proximos);
    gravarModulos(proximos);
    setModuleRowId(null);
  }

  const rotuloDoBotao =
    alvoAtual.tipo === 'bloco'
      ? 'Código do bloco'
      : alvoAtual.tipo === 'linha'
        ? 'Código da estrutura'
        : 'Código do e-mail';

  return (
    <>
      {/* Aviso do override de documento: enquanto ele existe, tudo o que se
          mexe no canvas fica guardado mas não é enviado. Dizer isso aqui, e não
          só dentro do painel, evita a pessoa editar meia hora à toa. */}
      {value.customHtml !== undefined && value.customHtml !== '' ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-alerta/30 bg-alerta-fundo px-4 py-3 text-sm text-alerta">
          <span>
            Este e-mail está com <strong>HTML próprio</strong>. O criador visual continua guardando
            o que você monta, mas quem é enviado é o código.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAlvoDoCodigo({ tipo: 'documento' })}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-paper-light px-3 text-sm font-medium text-ink hover:bg-accent-mist"
            >
              <Code2 className="size-4" />
              Editar código
            </button>
            <button
              type="button"
              onClick={() => aplicarCodigo({ tipo: 'documento' }, null)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-paper-light px-3 text-sm font-medium text-ink hover:bg-accent-mist"
            >
              <RotateCcw className="size-4" />
              Voltar ao visual
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={passadoRef.current.length === 0}
          title="Desfazer (Ctrl+Z)"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink disabled:opacity-50"
        >
          <Undo2 className="size-4" />
          Desfazer
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={futuroRef.current.length === 0}
          title="Refazer (Ctrl+Shift+Z)"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink disabled:opacity-50"
        >
          <Redo2 className="size-4" />
          Refazer
        </button>
        <button
          type="button"
          onClick={() => setAlvoDoCodigo(alvoAtual)}
          title="Mostra o HTML do que está selecionado; sem seleção, o e-mail inteiro"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink"
        >
          <Code2 className="size-4" />
          {rotuloDoBotao}
        </button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <Canvas
          design={value}
          selection={selection}
          drag={drag}
          onDragChange={setDrag}
          onSelect={setSelection}
          onTextCommit={(blockId, html) =>
            handleUpdateBlock(blockId, (b) => (b.type === 'text' ? { ...b, html } : b))
          }
          // Edição inline de pedaços com HTML próprio: o canvas devolve o HTML
          // já saneado, e ele entra pelo mesmo caminho do painel de código —
          // bloco de texto com override antigo é absorvido no primeiro commit.
          // Vazio (tudo apagado) derruba o override e o visual volta a valer.
          onRowHtmlCommit={(rowId, html) => apply((d) => setRowCustomHtml(d, rowId, html))}
          onBlockHtmlCommit={(blockId, html) =>
            aplicarHtmlNoBloco(blockId, html !== '' ? html : null)
          }
          onRowAction={handleRowAction}
          onBlockAction={handleBlockAction}
          onMoveBlockTo={handleMoveBlockTo}
          onMoveRowTo={handleMoveRowTo}
          onAddBlockAt={handleAddBlockAt}
          onInsertBlockAt={handleInsertBlockAt}
          onInsertStructureAt={handleInsertStructureAt}
        />
        {/* O max-h/overflow que limita a altura fica no próprio Sidebar (não
            aqui) — height percentual não resolve de forma confiável através de
            um ancestral position:sticky. */}
        <div className="lg:sticky lg:top-8">
          <Sidebar
            design={value}
            selection={selection}
            modules={modules}
            onAddStructure={handleAddStructure}
            onAddBlock={handleAddBlock}
            onInsertModule={handleInsertModule}
            onDeleteModule={handleDeleteModule}
            onUpdateBlock={handleUpdateBlock}
            onUpdateRowAttrs={handleUpdateRowAttrs}
            onUpdateSettings={handleUpdateSettings}
            onClearSelection={() => setSelection(null)}
            onDragChange={setDrag}
          />
        </div>
      </div>

      <PainelCodigo
        alvo={alvoDoCodigo}
        design={value}
        htmlProprio={alvoDoCodigo !== null ? htmlProprioDoAlvo(alvoDoCodigo) : null}
        onAplicar={(html) => {
          if (alvoDoCodigo !== null) aplicarCodigo(alvoDoCodigo, html);
        }}
        onVoltarAoGerado={() => {
          if (alvoDoCodigo !== null) aplicarCodigo(alvoDoCodigo, null);
        }}
        onFechar={() => setAlvoDoCodigo(null)}
      />

      {/* Diálogo: salvar linha como módulo reutilizável */}
      <Dialogo
        titulo="Salvar como módulo"
        descricao="A linha selecionada ficará disponível na aba Módulos para reutilizar em qualquer e-mail."
        aberto={moduleRowId !== null}
        aoFechar={() => setModuleRowId(null)}
        acoes={
          <>
            <button
              type="button"
              onClick={() => setModuleRowId(null)}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-medium text-ink-suave hover:bg-accent-mist hover:text-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveModule}
              disabled={moduleName.trim() === ''}
              className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper-light hover:bg-ink/90 disabled:opacity-60"
            >
              Salvar módulo
            </button>
          </>
        }
      >
        <label className="grid gap-1.5">
          <span className="text-xs text-ink-suave">Nome do módulo</span>
          <input
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            placeholder="Ex.: Cabeçalho, Rodapé, CTA principal…"
            autoFocus
            className="h-11 w-full rounded-md border border-line bg-paper-light px-3 text-sm text-ink"
          />
        </label>
      </Dialogo>
    </>
  );
}
