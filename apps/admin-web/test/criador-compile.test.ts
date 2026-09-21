import { describe, it, expect } from 'vitest';
import {
  MARCA_FIM,
  MARCA_INICIO,
  compileDesignToMjml,
  ehFundoEscuro,
  isValidDesign,
  larguraDoConteudo,
} from '@emailmkt/criador';
import { limparHtmlDoUsuario, recortarEntreMarcadores } from '../src/lib/criador/codigo.js';
import { addBlock, addRow, createRow, setRowCustomHtml } from '@emailmkt/criador';
import { createBlock, createDefaultDesign } from '@emailmkt/criador';
import type { EmailDesign, Row, TextBlock } from '@emailmkt/criador';

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

    expect(mjml).toContain('<mjml lang="pt-BR"');
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

describe('modo escuro dos clientes de e-mail', () => {
  it('todo e-mail declara o português e que foi desenhado só para o modo claro', () => {
    const { design } = designCom([createBlock('text')]);
    const mjml = compileDesignToMjml(design);

    expect(mjml).toContain('<mjml lang="pt-BR" dir="ltr">');
    expect(mjml).toContain('<meta name="color-scheme" content="light only">');
    expect(mjml).toContain('<meta name="supported-color-schemes" content="light only">');
    // Em <style> próprio: o Gmail descarta o bloco inteiro ao achar o que não
    // entende, e o `:root` não pode levar a proteção junto.
    expect(mjml).toMatch(/<style data-embed>:root \{ color-scheme: light only;[^<]*<\/style>/);
  });

  it('design só com fundos claros não leva nada da proteção do Gmail', () => {
    const { design } = designCom([createBlock('text'), createBlock('button')]);
    const mjml = compileDesignToMjml(design);

    expect(mjml).not.toContain('gmail-blend');
    expect(mjml).not.toContain('u + .body');
    expect(mjml).not.toContain('mj-html-attributes');
  });

  it('linha escura: a estrutura é marcada, o texto ganha as camadas e o gradiente só vale no Gmail', () => {
    const { design, row } = designCom([createBlock('text'), createBlock('image')]);
    const escura: EmailDesign = {
      ...design,
      rows: design.rows.map((r) =>
        r.id === row.id ? { ...r, attrs: { ...r.attrs, backgroundColor: '#16222c' } } : r,
      ),
    };
    const mjml = compileDesignToMjml(escura);

    expect(mjml).toContain('css-class="aa-secao-16222c"');
    // O gradiente vai na TABELA da estrutura, que é quem pinta o fundo.
    expect(mjml).toContain(
      '<mj-selector path=".aa-secao-16222c > table"><mj-html-attribute name="class">aa-fundo-16222c</mj-html-attribute></mj-selector>',
    );
    expect(mjml).toContain(
      'u + .body .aa-fundo-16222c { background-image: linear-gradient(#16222c, #16222c) !important; }',
    );
    // Uma camada por texto; a imagem fica como está.
    expect(
      mjml.split('<div class="gmail-blend-screen"><div class="gmail-blend-difference">'),
    ).toHaveLength(2);
    // Nunca inline: gradiente sem as camadas deixaria o texto escuro sobre o
    // fundo escuro no Gmail sem suporte a <style>.
    expect(mjml).not.toMatch(/style="[^"]*gradient/);
    // O Gmail só reconhece o documento com a classe no corpo.
    expect(mjml).toContain(
      '<mj-selector path="body"><mj-html-attribute name="class">body</mj-html-attribute></mj-selector>',
    );
  });

  it('fundo escuro na coluna: a célula que pinta recebe o gradiente e só o texto dela ganha camadas', () => {
    const { design, row } = designCom([createBlock('text')]);
    // A coluna com o bloco é a do design devolvido: as operações não mutam o original.
    const coluna = design.rows.find((r) => r.id === row.id)?.columns[0] as Row['columns'][0];
    const linhaClara = createRow([100]);
    (linhaClara.columns[0] as Row['columns'][0]).blocks = [createBlock('text')];
    const comCard: EmailDesign = {
      ...design,
      rows: [
        ...design.rows.map((r) =>
          r.id === row.id
            ? {
                ...r,
                columns: [{ ...coluna, attrs: { backgroundColor: '#721420', padding: '20px' } }],
              }
            : r,
        ),
        linhaClara,
      ],
    };

    const mjml = compileDesignToMjml(comCard);

    expect(mjml).toContain('css-class="aa-coluna-721420"');
    expect(mjml).toContain(
      '<mj-selector path=".aa-coluna-721420 > table > tbody > tr > td"><mj-html-attribute name="class">aa-fundo-721420</mj-html-attribute></mj-selector>',
    );
    // As linhas continuam claras: nem marca de estrutura escura, nem camadas no texto delas.
    expect(mjml).not.toContain('aa-secao-');
    expect(mjml.split('gmail-blend-screen"><div')).toHaveLength(2);
  });

  it('só as cores com contraste para texto claro contam como fundo escuro', () => {
    for (const escura of ['#721420', '#16222c', '#7d5e2c', '#000', '#4a5560']) {
      expect(ehFundoEscuro(escura), escura).toBe(true);
    }
    for (const clara of ['#FFFFFF', '#f2efe8', '#f1e7e4', '#e5dfd3', '#d5bc80', '#999999']) {
      expect(ehFundoEscuro(clara), clara).toBe(false);
    }
    // Notação que não é hex não arrisca um palpite: fica como clara.
    for (const outra of ['', 'transparent', 'rgb(0,0,0)', 'vinho']) {
      expect(ehFundoEscuro(outra), outra).toBe(false);
    }
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
