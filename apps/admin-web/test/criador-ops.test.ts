import { describe, it, expect } from 'vitest';
import {
  addBlock,
  addRow,
  comCustomHtml,
  createRow,
  duplicateRow,
  findBlock,
  insertRowAt,
  moveBlockTo,
  moveRowTo,
  removeRow,
  updateBlock,
} from '@emailmkt/criador';
import { createBlock, createDefaultDesign } from '@emailmkt/criador';
import type { EmailDesign, Row } from '@emailmkt/criador';

function designVazio(): EmailDesign {
  return { version: 1, settings: createDefaultDesign().settings, rows: [] };
}

function designComLinha(): { design: EmailDesign; row: Row } {
  const row = createRow([50, 50]);
  return { design: addRow(designVazio(), row), row };
}

describe('operações do criador — imutáveis e por id', () => {
  it('adiciona linha depois da referência, não no fim', () => {
    const a = createRow([100]);
    const b = createRow([100]);
    const c = createRow([100]);
    let d = designVazio();
    d = addRow(d, a);
    d = addRow(d, c);
    d = addRow(d, b, a.id);

    expect(d.rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
  });

  it('duplicar linha clona com ids NOVOS — inserir módulo duas vezes não pode colidir', () => {
    const { design, row } = designComLinha();
    const comBloco = addBlock(
      design,
      row.id,
      (row.columns[0] as Row['columns'][0]).id,
      createBlock('text'),
    );

    const duplicado = duplicateRow(comBloco, row.id);

    expect(duplicado.rows).toHaveLength(2);
    const [original, copia] = duplicado.rows as [Row, Row];
    expect(copia.id).not.toBe(original.id);
    expect((copia.columns[0] as Row['columns'][0]).blocks[0]?.id).not.toBe(
      (original.columns[0] as Row['columns'][0]).blocks[0]?.id,
    );
  });

  it('não muta o design original', () => {
    const { design, row } = designComLinha();
    const antes = JSON.stringify(design);

    removeRow(design, row.id);
    updateBlock(design, 'inexistente', (b) => b);
    insertRowAt(design, createRow([100]), 0);

    expect(JSON.stringify(design)).toBe(antes);
  });

  it('moveBlockTo dentro da mesma coluna compensa o índice após a remoção', () => {
    // A regressão clássica de drag and drop: remover o bloco desloca os índices
    // seguintes, e sem compensação ele aterrissa uma posição depois do alvo.
    const { design, row } = designComLinha();
    const col = (row.columns[0] as Row['columns'][0]).id;
    const b1 = createBlock('text');
    const b2 = createBlock('spacer');
    const b3 = createBlock('divider');
    let d = addBlock(design, row.id, col, b1);
    d = addBlock(d, row.id, col, b2);
    d = addBlock(d, row.id, col, b3);

    // Arrasta o primeiro para depois do terceiro (zona de índice 3).
    d = moveBlockTo(d, b1.id, row.id, col, 3);

    const ids = d.rows[0]?.columns[0]?.blocks.map((b) => b.id);
    expect(ids).toEqual([b2.id, b3.id, b1.id]);
  });

  it('moveBlockTo entre colunas preserva o bloco', () => {
    const { design, row } = designComLinha();
    const colA = (row.columns[0] as Row['columns'][0]).id;
    const colB = (row.columns[1] as Row['columns'][0]).id;
    const bloco = createBlock('button');
    let d = addBlock(design, row.id, colA, bloco);

    d = moveBlockTo(d, bloco.id, row.id, colB, 0);

    expect(findBlock(d, bloco.id)?.column.id).toBe(colB);
  });

  it('moveRowTo compensa o índice quando desce', () => {
    const a = createRow([100]);
    const b = createRow([100]);
    const c = createRow([100]);
    let d = designVazio();
    d = addRow(d, a);
    d = addRow(d, b);
    d = addRow(d, c);

    // Solta a primeira linha na zona DEPOIS da última (índice 3).
    d = moveRowTo(d, a.id, 3);

    expect(d.rows.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('comCustomHtml com vazio APAGA a chave — vazio não é override', () => {
    // `customHtml: ""` significaria "tem override e ele é vazio": o pedaço
    // sumiria do e-mail sem ninguém pedir. Remover a chave é o contrato.
    const row = createRow([100]);
    const comHtml = comCustomHtml(row, '<tr><td>x</td></tr>');
    expect(comHtml.customHtml).toBeDefined();

    const semHtml = comCustomHtml(comHtml, null);
    expect('customHtml' in semHtml).toBe(false);

    const semHtml2 = comCustomHtml(comHtml, '');
    expect('customHtml' in semHtml2).toBe(false);
  });
});
