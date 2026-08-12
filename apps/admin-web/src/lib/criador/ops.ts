// Operações imutáveis sobre o documento do Criador de e-mails.
// Portado do avante-mail sem mudança de comportamento: é a camada que os
// testes de paridade cobrem.

import type { Block, Column, EmailDesign, Row } from './tipos.js';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createColumn(widthPct: number): Column {
  return { id: uid(), widthPct, blocks: [] };
}

export function createRow(widths: number[]): Row {
  return {
    id: uid(),
    columns: widths.map((w) => createColumn(w)),
    attrs: { backgroundColor: '', padding: '0px 0px' },
  };
}

/** Clona uma linha gerando ids novos (para duplicar/inserir módulos). */
export function cloneRowWithNewIds(row: Row): Row {
  return {
    ...row,
    id: uid(),
    attrs: { ...row.attrs },
    columns: row.columns.map((col) => ({
      ...col,
      id: uid(),
      blocks: col.blocks.map((block) => cloneBlockWithNewId(block)),
    })),
  };
}

export function cloneBlockWithNewId(block: Block): Block {
  const cloned = JSON.parse(JSON.stringify(block)) as Block;
  cloned.id = uid();
  return cloned;
}

function replaceRows(design: EmailDesign, rows: Row[]): EmailDesign {
  return { ...design, rows };
}

export function addRow(design: EmailDesign, row: Row, afterRowId?: string | null): EmailDesign {
  const index =
    afterRowId !== undefined && afterRowId !== null
      ? design.rows.findIndex((r) => r.id === afterRowId)
      : -1;
  const rows = [...design.rows];
  if (index === -1) rows.push(row);
  else rows.splice(index + 1, 0, row);
  return replaceRows(design, rows);
}

export function removeRow(design: EmailDesign, rowId: string): EmailDesign {
  return replaceRows(
    design,
    design.rows.filter((r) => r.id !== rowId),
  );
}

export function moveRow(design: EmailDesign, rowId: string, direction: -1 | 1): EmailDesign {
  const index = design.rows.findIndex((r) => r.id === rowId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= design.rows.length) {
    return design;
  }
  const rows = [...design.rows];
  const [row] = rows.splice(index, 1);
  rows.splice(target, 0, row as Row);
  return replaceRows(design, rows);
}

export function duplicateRow(design: EmailDesign, rowId: string): EmailDesign {
  const row = design.rows.find((r) => r.id === rowId);
  if (row === undefined) return design;
  return addRow(design, cloneRowWithNewIds(row), rowId);
}

export function updateRowAttrs(
  design: EmailDesign,
  rowId: string,
  patch: Partial<Row['attrs']>,
): EmailDesign {
  return replaceRows(
    design,
    design.rows.map((r) => (r.id === rowId ? { ...r, attrs: { ...r.attrs, ...patch } } : r)),
  );
}

function mapColumn(
  design: EmailDesign,
  rowId: string,
  colId: string,
  fn: (col: Column) => Column,
): EmailDesign {
  return replaceRows(
    design,
    design.rows.map((row) =>
      row.id !== rowId
        ? row
        : {
            ...row,
            columns: row.columns.map((col) => (col.id === colId ? fn(col) : col)),
          },
    ),
  );
}

/**
 * Guarda ou remove o `customHtml` de um objeto do design.
 *
 * Remover é apagar a chave, e não guardar string vazia: o compilador decide
 * pela presença, e um `customHtml: ""` viraria "tem override, e ele é vazio" —
 * o pedaço sumiria do e-mail sem ninguém ter pedido.
 */
export function comCustomHtml<T extends { customHtml?: string }>(alvo: T, html: string | null): T {
  if (html !== null && html !== '') return { ...alvo, customHtml: html };
  const copia = { ...alvo };
  delete copia.customHtml;
  return copia;
}

/** Liga ou desliga o HTML próprio de uma linha. */
export function setRowCustomHtml(
  design: EmailDesign,
  rowId: string,
  html: string | null,
): EmailDesign {
  return replaceRows(
    design,
    design.rows.map((r) => (r.id === rowId ? comCustomHtml(r, html) : r)),
  );
}

/** Idem para um bloco. */
export function setBlockCustomHtml(
  design: EmailDesign,
  blockId: string,
  html: string | null,
): EmailDesign {
  return updateBlock(design, blockId, (b) => comCustomHtml(b, html));
}

export function addBlock(
  design: EmailDesign,
  rowId: string,
  colId: string,
  block: Block,
  afterBlockId?: string | null,
): EmailDesign {
  return mapColumn(design, rowId, colId, (col) => {
    const index =
      afterBlockId !== undefined && afterBlockId !== null
        ? col.blocks.findIndex((b) => b.id === afterBlockId)
        : -1;
    const blocks = [...col.blocks];
    if (index === -1) blocks.push(block);
    else blocks.splice(index + 1, 0, block);
    return { ...col, blocks };
  });
}

export function removeBlock(
  design: EmailDesign,
  rowId: string,
  colId: string,
  blockId: string,
): EmailDesign {
  return mapColumn(design, rowId, colId, (col) => ({
    ...col,
    blocks: col.blocks.filter((b) => b.id !== blockId),
  }));
}

export function moveBlock(
  design: EmailDesign,
  rowId: string,
  colId: string,
  blockId: string,
  direction: -1 | 1,
): EmailDesign {
  return mapColumn(design, rowId, colId, (col) => {
    const index = col.blocks.findIndex((b) => b.id === blockId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= col.blocks.length) return col;
    const blocks = [...col.blocks];
    const [block] = blocks.splice(index, 1);
    blocks.splice(target, 0, block as Block);
    return { ...col, blocks };
  });
}

export function duplicateBlock(
  design: EmailDesign,
  rowId: string,
  colId: string,
  blockId: string,
): EmailDesign {
  const row = design.rows.find((r) => r.id === rowId);
  const col = row?.columns.find((c) => c.id === colId);
  const block = col?.blocks.find((b) => b.id === blockId);
  if (block === undefined) return design;
  return addBlock(design, rowId, colId, cloneBlockWithNewId(block), blockId);
}

/** Atualiza um bloco em qualquer lugar do documento. */
export function updateBlock(
  design: EmailDesign,
  blockId: string,
  fn: (block: Block) => Block,
): EmailDesign {
  return replaceRows(
    design,
    design.rows.map((row) => ({
      ...row,
      columns: row.columns.map((col) => ({
        ...col,
        blocks: col.blocks.map((b) => (b.id === blockId ? fn(b) : b)),
      })),
    })),
  );
}

/** Insere um bloco numa posição específica da coluna. */
export function insertBlockAt(
  design: EmailDesign,
  rowId: string,
  colId: string,
  block: Block,
  index: number,
): EmailDesign {
  return mapColumn(design, rowId, colId, (col) => {
    const blocks = [...col.blocks];
    const clamped = Math.max(0, Math.min(index, blocks.length));
    blocks.splice(clamped, 0, block);
    return { ...col, blocks };
  });
}

/** Insere uma linha numa posição específica do e-mail (drag da paleta). */
export function insertRowAt(design: EmailDesign, row: Row, index: number): EmailDesign {
  const rows = [...design.rows];
  const clamped = Math.max(0, Math.min(index, rows.length));
  rows.splice(clamped, 0, row);
  return replaceRows(design, rows);
}

/**
 * Move um bloco para uma posição específica (drag and drop).
 * Funciona dentro da mesma coluna e entre colunas/linhas.
 */
export function moveBlockTo(
  design: EmailDesign,
  blockId: string,
  targetRowId: string,
  targetColId: string,
  targetIndex: number,
): EmailDesign {
  const location = findBlock(design, blockId);
  if (location === null) return design;

  let index = targetIndex;
  if (location.row.id === targetRowId && location.column.id === targetColId) {
    const originalIndex = location.column.blocks.findIndex((b) => b.id === blockId);
    if (originalIndex === -1) return design;
    // Remover primeiro desloca os índices seguintes.
    if (originalIndex < index) index -= 1;
    if (originalIndex === index) return design; // soltou no mesmo lugar
  }

  const removed = removeBlock(design, location.row.id, location.column.id, blockId);
  return insertBlockAt(removed, targetRowId, targetColId, location.block, index);
}

/** Move uma linha para uma posição específica (drag and drop). */
export function moveRowTo(design: EmailDesign, rowId: string, targetIndex: number): EmailDesign {
  const from = design.rows.findIndex((r) => r.id === rowId);
  if (from === -1) return design;

  let to = targetIndex;
  if (from < to) to -= 1;
  to = Math.max(0, Math.min(to, design.rows.length - 1));
  if (from === to) return design;

  const rows = [...design.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row as Row);
  return { ...design, rows };
}

export interface BlockLocation {
  row: Row;
  column: Column;
  block: Block;
}

export function findBlock(design: EmailDesign, blockId: string): BlockLocation | null {
  for (const row of design.rows) {
    for (const column of row.columns) {
      const block = column.blocks.find((b) => b.id === blockId);
      if (block !== undefined) return { row, column, block };
    }
  }
  return null;
}
