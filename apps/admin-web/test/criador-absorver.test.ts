import { describe, it, expect } from 'vitest';
import { absorverHtmlEmBlocoDeTexto } from '../src/lib/criador/absorver.js';
import { limparHtmlColado, textoParaHtml } from '../src/lib/criador/paste.js';
import { createBlock } from '../src/lib/criador/presets.js';
import type { TextBlock } from '../src/lib/criador/tipos.js';

function blocoDeTexto(): TextBlock {
  return createBlock('text') as TextBlock;
}

describe('absorção de HTML editado num bloco de texto', () => {
  it('traduz a moldura (<td> + <div>) para atributos e fica só com o conteúdo', () => {
    // É o que mantém o bloco 100% editável depois de alguém mexer no código:
    // conteúdo vira `html`, moldura vira attrs, e o override não existe.
    const bloco = blocoDeTexto();
    const html =
      '<td align="center" style="padding: 4px 8px;"><div style="font-size: 18px; color: #721420; text-align: center;">Olá <b>mundo</b></div></td>';

    const novo = absorverHtmlEmBlocoDeTexto(bloco, html);

    expect(novo.html).toBe('Olá <b>mundo</b>');
    expect(novo.attrs.align).toBe('center');
    expect(novo.attrs.padding).toBe('4px 8px');
    expect(novo.attrs.fontSize).toBe(18);
    expect(novo.attrs.color).toBe('#721420');
    expect('customHtml' in novo).toBe(false);
  });

  it('cor fora do formato hex não entra — o input de cor do painel fala hex', () => {
    const bloco = blocoDeTexto();
    const corOriginal = bloco.attrs.color;
    const novo = absorverHtmlEmBlocoDeTexto(
      bloco,
      '<td><div style="color: rgb(1,2,3);">texto</div></td>',
    );

    expect(novo.attrs.color).toBe(corOriginal);
    expect(novo.html).toBe('texto');
  });

  it('HTML sem <td> vale como conteúdo puro', () => {
    const novo = absorverHtmlEmBlocoDeTexto(blocoDeTexto(), 'só texto <i>livre</i>');
    expect(novo.html).toBe('só texto <i>livre</i>');
  });
});

describe('higienização do texto colado', () => {
  it('preserva significado e descarta aparência', () => {
    // Colar de Word/Docs injeta fontes e <p> aninhados que venceriam os estilos
    // do e-mail — e iriam parar no envio.
    const colado =
      '<div style="font-family: Comic Sans"><p class="MsoNormal">Um <b>negrito</b> e um <a href="https://exemplo.com" onclick="x()">link</a></p><p>Outra linha</p></div>';

    const limpo = limparHtmlColado(colado);

    expect(limpo).toContain('<b>negrito</b>');
    expect(limpo).toContain('<a href="https://exemplo.com">link</a>');
    expect(limpo).toContain('<br>');
    expect(limpo).not.toContain('font-family');
    expect(limpo).not.toContain('MsoNormal');
    expect(limpo).not.toContain('onclick');
  });

  it('link com esquema perigoso perde o <a> e fica o texto', () => {
    expect(limparHtmlColado('<a href="javascript:alert(1)">clique</a>')).toBe('clique');
  });

  it('texto puro vira HTML com quebras preservadas', () => {
    expect(textoParaHtml('linha 1\nlinha <2>')).toBe('linha 1<br>linha &lt;2&gt;');
  });
});
