// Compila o documento do Criador de e-mails para MJML.
//
// O MJML gerado vira HTML no próprio navegador (mjml-browser) e segue o mesmo
// caminho de qualquer template: variáveis Liquid → renderização no envio.
//
// Diferença deliberada em relação à referência: sem `<mj-title>`/`<mj-preview>`
// com tokens de conteúdo. Assunto e preheader vivem em campos próprios do
// modelo neste sistema, e o Liquid resolve variável desconhecida para string
// vazia SEM erro — um `{{titulo}}` aqui sumiria no envio sem ninguém ver.

import type { Block, EmailDesign, Row } from './tipos.js';

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Marcadores usados para achar, no HTML já compilado, onde começa e termina
 * o pedaço de um bloco ou linha. São comentários HTML porque `mj-raw` dentro
 * de `mj-column` cai no `<tbody>` FORA do `<tr>` — péssimo para conteúdo, mas
 * é exatamente o que se quer de um delimitador: ele fica ao lado do `<tr>` do
 * bloco, e não dentro dele.
 */
export const MARCA_INICIO = '<!--criador:ini-->';
export const MARCA_FIM = '<!--criador:fim-->';

export type Marca = { tipo: 'bloco' | 'linha'; id: string } | null;

/** Envolve o pedaço nos marcadores quando ele é o alvo do recorte. */
function marcar(codigo: string, ehAlvo: boolean): string {
  if (!ehAlvo) return codigo;
  return `<mj-raw>${MARCA_INICIO}</mj-raw>\n${codigo}\n<mj-raw>${MARCA_FIM}</mj-raw>`;
}

function compileBlock(block: Block, design: EmailDesign): string {
  // O `<tr>` é nosso e o `<td>` é do usuário: sem envelope, o HTML cru entraria
  // no `<tbody>` fora de qualquer linha, e o cliente de e-mail o jogaria para
  // cima da tabela. Com ele, o bloco vira uma linha legítima da coluna.
  if (block.customHtml !== undefined && block.customHtml.trim() !== '') {
    return `<mj-raw><tr>${block.customHtml}</tr></mj-raw>`;
  }
  switch (block.type) {
    case 'text': {
      const color = block.attrs.color !== '' ? block.attrs.color : design.settings.textColor;
      return `<mj-text font-size="${String(block.attrs.fontSize)}px" color="${escAttr(color)}" align="${block.attrs.align}" line-height="1.6" padding="${escAttr(block.attrs.padding)}">${block.html}</mj-text>`;
    }
    case 'image': {
      const width =
        block.attrs.width !== null && block.attrs.width > 0
          ? ` width="${String(block.attrs.width)}px"`
          : '';
      const href = block.href !== '' ? ` href="${escAttr(block.href)}"` : '';
      const radius =
        block.attrs.borderRadius > 0
          ? ` border-radius="${String(block.attrs.borderRadius)}px"`
          : '';
      return `<mj-image src="${escAttr(block.src)}" alt="${escAttr(block.alt)}"${href}${width}${radius} align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}" fluid-on-mobile="true" />`;
    }
    case 'button':
      return `<mj-button href="${escAttr(block.href)}" background-color="${escAttr(block.attrs.backgroundColor)}" color="${escAttr(block.attrs.color)}" font-size="${String(block.attrs.fontSize)}px" font-weight="700" border-radius="${String(block.attrs.borderRadius)}px" inner-padding="12px 32px" align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}">${block.text}</mj-button>`;
    case 'spacer':
      return `<mj-spacer height="${String(block.attrs.height)}px" />`;
    case 'divider':
      return `<mj-divider border-color="${escAttr(block.attrs.borderColor)}" border-width="${String(block.attrs.borderWidth)}px" padding="${escAttr(block.attrs.padding)}" />`;
    case 'social': {
      const elements = block.items
        .map(
          (item) =>
            `<mj-social-element src="${escAttr(item.iconSrc)}" href="${escAttr(item.href)}" alt="${escAttr(item.label)}" padding="0 6px" />`,
        )
        .join('\n        ');
      return `<mj-social mode="horizontal" icon-size="${String(block.attrs.iconSize)}px" border-radius="${String(Math.round(block.attrs.iconSize / 2))}px" align="${block.attrs.align}" padding="${escAttr(block.attrs.padding)}">\n        ${elements}\n      </mj-social>`;
    }
  }
}

function compileRow(row: Row, design: EmailDesign, marca: Marca): string {
  const corpo =
    row.customHtml !== undefined && row.customHtml.trim() !== ''
      ? `  <mj-raw>${row.customHtml}</mj-raw>`
      : (() => {
          const background =
            row.attrs.backgroundColor !== ''
              ? row.attrs.backgroundColor
              : design.settings.contentBackground;
          const columns = row.columns
            .map((col) => {
              const blocks = col.blocks
                .map(
                  (block) =>
                    `      ${marcar(
                      compileBlock(block, design),
                      marca?.tipo === 'bloco' && marca.id === block.id,
                    )}`,
                )
                .join('\n');
              return `    <mj-column width="${String(col.widthPct)}%">\n${blocks}\n    </mj-column>`;
            })
            .join('\n');
          return `  <mj-section background-color="${escAttr(background)}" padding="${escAttr(row.attrs.padding)}">\n${columns}\n  </mj-section>`;
        })();

  return marcar(corpo, marca?.tipo === 'linha' && marca.id === row.id);
}

/**
 * Compila o design para MJML.
 *
 * `marca` pede que UM bloco ou UMA linha saia entre marcadores. Compilar o
 * documento inteiro e recortar entre eles devolve exatamente o HTML que aquele
 * pedaço gera de verdade — largura da coluna, fundo da linha e tipografia
 * global entram na conta. Montar um MJML só com o bloco daria outro HTML.
 *
 * A marcação é feita AQUI, percorrendo o modelo, e não procurando o trecho no
 * MJML pronto: dois espaçadores iguais compilam para o mesmo texto, e a busca
 * marcaria o primeiro — que pode não ser o que o usuário clicou.
 */
export function compileDesignToMjml(design: EmailDesign, marca: Marca = null): string {
  // HTML do documento inteiro sai como está — quem chama reconhece que não é
  // MJML (ver `compilarParaHtml`) e repassa direto; as variáveis Liquid
  // continuam sendo aplicadas no envio, como em qualquer template de código.
  // Ao recortar um pedaço é o design SEM o override de documento que interessa:
  // é dele que sai o HTML gerado que serve de ponto de partida para editar.
  if (design.customHtml !== undefined && design.customHtml.trim() !== '' && marca === null) {
    return design.customHtml;
  }

  const { settings } = design;
  const rows = design.rows.map((row) => compileRow(row, design, marca)).join('\n');

  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="${escAttr(settings.fontFamily)}" />
      <mj-text color="${escAttr(settings.textColor)}" font-size="14px" line-height="1.6" />
    </mj-attributes>
    <mj-style>
      a { color: ${settings.linkColor}; }
    </mj-style>
  </mj-head>
  <mj-body background-color="${escAttr(settings.bodyBackground)}" width="600px">
${rows}
  </mj-body>
</mjml>`;
}

/** Validação mínima de um design vindo de fora (banco ou colagem). */
export function isValidDesign(value: unknown): value is EmailDesign {
  if (value === null || typeof value !== 'object') return false;
  const design = value as EmailDesign;
  return (
    design.version === 1 &&
    typeof design.settings === 'object' &&
    typeof design.settings.bodyBackground === 'string' &&
    Array.isArray(design.rows)
  );
}

/** Validação mínima de uma linha de módulo vinda do armazenamento. */
export function isValidRow(value: unknown): value is Row {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Row;
  return (
    typeof row.id === 'string' &&
    Array.isArray(row.columns) &&
    row.columns.every((col) => Array.isArray(col.blocks))
  );
}
