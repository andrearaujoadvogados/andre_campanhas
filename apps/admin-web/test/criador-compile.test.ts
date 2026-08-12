import { describe, it, expect } from 'vitest';
import {
  MARCA_FIM,
  MARCA_INICIO,
  compileDesignToMjml,
  isValidDesign,
  larguraDoConteudo,
} from '../src/lib/criador/compile.js';
import { limparHtmlDoUsuario, recortarEntreMarcadores } from '../src/lib/criador/codigo.js';
import { addBlock, addRow, createRow, setRowCustomHtml } from '../src/lib/criador/ops.js';
import { createBlock, createDefaultDesign } from '../src/lib/criador/presets.js';
import type { EmailDesign, Row, TextBlock } from '../src/lib/criador/tipos.js';

function designCom(blocos: ReturnType<typeof createBlock>[]): {
  design: EmailDesign;
  row: Row;
} {
  const row = createRow([100]);
  let design: EmailDesign = {
    version: 1,
    settings: createDefaultDesign().settings,
    rows: [],
  };
  design = addRow(design, row);
  for (const b of blocos)
    design = addBlock(design, row.id, (row.columns[0] as Row['columns'][0]).id, b);
  return { design, row };
}

describe('compilação do design para MJML', () => {
  it('gera o esqueleto com as configurações globais', () => {
    const { design } = designCom([createBlock('text')]);
    const mjml = compileDesignToMjml(design);

    expect(mjml).toContain('<mjml>');
    expect(mjml).toContain(`background-color="${design.settings.bodyBackground}"`);
    expect(mjml).toContain('mj-text');
  });

  it('bloco com HTML próprio sai como mj-raw com envelope <tr>', () => {
    // Sem o envelope, o <td> do usuário cai no <tbody> fora de qualquer linha e
    // o cliente de e-mail o joga para cima da tabela.
    const bloco = createBlock('text');
    (bloco as TextBlock).customHtml = '<td>meu html</td>';
    const { design } = designCom([bloco]);

    expect(compileDesignToMjml(design)).toContain('<mj-raw><tr><td>meu html</td></tr></mj-raw>');
  });

  it('linha com HTML próprio ignora as colunas', () => {
    const { design, row } = designCom([createBlock('text')]);
    const comOverride = setRowCustomHtml(design, row.id, '<table><tr><td>livre</td></tr></table>');

    const mjml = compileDesignToMjml(comOverride);
    expect(mjml).toContain('<mj-raw><table><tr><td>livre</td></tr></table></mj-raw>');
    expect(mjml).not.toContain('mj-column');
  });

  it('override de documento passa reto, sem compilar', () => {
    const { design } = designCom([createBlock('text')]);
    const html = '<html><body>documento inteiro</body></html>';

    expect(compileDesignToMjml({ ...design, customHtml: html })).toBe(html);
  });

  it('marca o bloco pedido — e só ele — para o recorte', () => {
    // Dois espaçadores idênticos compilam para o mesmo texto: achar por busca
    // marcaria o primeiro, que pode não ser o que o usuário clicou. A marca é
    // aplicada percorrendo o modelo, por id.
    const s1 = createBlock('spacer');
    const s2 = createBlock('spacer');
    const { design } = designCom([s1, s2]);

    const mjml = compileDesignToMjml(design, { tipo: 'bloco', id: s2.id });
    const antes = mjml.slice(0, mjml.indexOf(MARCA_INICIO));

    // O primeiro espaçador fica ANTES do marcador de início — não foi marcado.
    expect(antes).toContain('mj-spacer');
    expect(mjml.indexOf(MARCA_INICIO)).toBeLessThan(mjml.indexOf(MARCA_FIM));
  });

  it('recorta entre marcadores e desembrulha o <tr> de bloco', () => {
    const html = `qualquer coisa ${MARCA_INICIO}<tr class="x"><td>alvo</td></tr>${MARCA_FIM} resto`;
    expect(recortarEntreMarcadores(html, true)).toBe('<td>alvo</td>');
    expect(recortarEntreMarcadores(html, false)).toBe('<tr class="x"><td>alvo</td></tr>');
    expect(recortarEntreMarcadores('sem marcador', true)).toBeNull();
  });
});

describe('largura do contêiner principal', () => {
  it('a largura configurada vai para o mj-body e o padrão é 600', () => {
    const { design } = designCom([createBlock('text')]);

    expect(compileDesignToMjml(design)).toContain('width="600px"');
    expect(
      compileDesignToMjml({ ...design, settings: { ...design.settings, contentWidth: 720 } }),
    ).toContain('width="720px"');
  });

  it('design salvo ANTES do campo existir compila com 600, não com NaN', () => {
    // O tipo diz `number`, mas o JSON gravado no banco não lê tipos: todo design
    // salvo pela primeira versão do criador chega sem `contentWidth`.
    const { design } = designCom([createBlock('text')]);
    const antigo = { ...design, settings: { ...design.settings } } as EmailDesign;
    delete (antigo.settings as Partial<EmailDesign['settings']>).contentWidth;

    expect(compileDesignToMjml(antigo)).toContain('width="600px"');
    expect(larguraDoConteudo(antigo.settings)).toBe(600);
    expect(larguraDoConteudo({ contentWidth: 0 })).toBe(600);
    expect(larguraDoConteudo({ contentWidth: 480 })).toBe(480);
  });
});

describe('higiene do HTML do usuário', () => {
  it('remove script e handlers on*', () => {
    // O canvas mostra esse HTML com innerHTML: um <script> colado rodaria com a
    // sessão de quem edita. Nenhum cliente de e-mail executa script — remover
    // não custa nada ao resultado.
    const sujo =
      '<td onclick="roubar()"><script>alert(1)</script><a href="javascript:x()">oi</a></td>';
    const limpo = limparHtmlDoUsuario(sujo);

    expect(limpo).not.toContain('<script');
    expect(limpo).not.toContain('onclick');
    expect(limpo).not.toContain('javascript:');
  });
});

describe('validação de design', () => {
  it('aceita o design padrão e recusa o project data do GrapesJS', () => {
    expect(isValidDesign(createDefaultDesign())).toBe(true);
    // O formato antigo (GrapesJS) não tem version/settings — é o que dispara a
    // migração via customHtml no EditorVisual.
    expect(isValidDesign({ pages: [], styles: [] })).toBe(false);
    expect(isValidDesign(null)).toBe(false);
  });
});
