// Absorção de HTML editado à mão de volta para o modelo do bloco de texto.
//
// Editar o código de um BLOCO DE TEXTO não cria override: o bloco engole o que
// foi escrito e continua sendo um bloco comum — texto editável no canvas e
// controles do painel lateral valendo. Dá para absorver porque `html` do bloco
// já é HTML livre; só a moldura precisa de tradução:
//
//   <td align/padding>            → attrs.align / attrs.padding
//     <div font-size/color/align> → attrs.fontSize / attrs.color / attrs.align
//       conteúdo                  → block.html
//
// A moldura é do bloco: propriedade de wrapper que não tem atributo
// correspondente (ex.: background no <td>, letter-spacing no <div>) é
// regenerada — quem precisa de moldura realmente livre usa o HTML próprio da
// ESTRUTURA, que continua sendo override.
//
// Roda só no navegador (DOMParser); o commit da edição inline e o painel de
// código são ambos client-side.

import type { Block, Row, TextBlock } from '@emailmkt/criador';

/**
 * Lê uma propriedade do ATRIBUTO style, sem passar pelo CSSOM — o CSSOM
 * normaliza cor para rgb(), e o modelo (e o input de cor do painel) fala hex.
 */
function propriedadeDoStyle(style: string, prop: string): string | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m?.[1] !== undefined ? m[1].trim() : null;
}

function alinhamentoValido(v: string | null): v is 'left' | 'center' | 'right' {
  return v === 'left' || v === 'center' || v === 'right';
}

/** Absorve o HTML editado (um `<td>…</td>`, em geral) num bloco de texto. */
export function absorverHtmlEmBlocoDeTexto(bloco: TextBlock, html: string): TextBlock {
  const attrs = { ...bloco.attrs };
  let conteudo = html.trim();

  // O parse ganha a mesma tabela que o canvas/compilação põem em volta — um
  // <td> solto fora de tabela é descartado pelo parser.
  const doc = new DOMParser().parseFromString(
    `<table><tbody><tr>${html}</tr></tbody></table>`,
    'text/html',
  );
  const tds = doc.querySelectorAll('td');

  if (tds.length === 1) {
    const td = tds[0] as HTMLTableCellElement;
    const styleTd = td.getAttribute('style') ?? '';
    const alignTd = (
      td.getAttribute('align') ?? propriedadeDoStyle(styleTd, 'text-align')
    )?.toLowerCase();
    if (alinhamentoValido(alignTd ?? null)) attrs.align = alignTd as typeof attrs.align;
    const padding = propriedadeDoStyle(styleTd, 'padding');
    if (padding) attrs.padding = padding;

    // Um único <div> filho é o wrapper que a compilação gera: desembrulha,
    // traduzindo o estilo dele para os atributos do bloco.
    const filhos = Array.from(td.childNodes).filter(
      (n) => n.nodeType !== Node.TEXT_NODE || Boolean(n.textContent?.trim()),
    );
    const primeiro = filhos[0];
    const div =
      filhos.length === 1 &&
      primeiro !== undefined &&
      primeiro.nodeType === Node.ELEMENT_NODE &&
      (primeiro as Element).tagName === 'DIV'
        ? (primeiro as Element)
        : null;

    if (div) {
      const styleDiv = div.getAttribute('style') ?? '';
      const fonte = propriedadeDoStyle(styleDiv, 'font-size');
      const px = fonte?.match(/^(\d+(?:\.\d+)?)px$/);
      if (px?.[1] !== undefined) attrs.fontSize = Math.round(parseFloat(px[1]));
      const cor = propriedadeDoStyle(styleDiv, 'color');
      // Só hex: rgb()/nomes não servem ao input de cor do painel.
      if (cor && /^#[0-9a-f]{3,8}$/i.test(cor)) attrs.color = cor;
      const alignDiv = propriedadeDoStyle(styleDiv, 'text-align')?.toLowerCase();
      if (alinhamentoValido(alignDiv ?? null)) attrs.align = alignDiv as typeof attrs.align;
      conteudo = div.innerHTML.trim();
    } else {
      conteudo = td.innerHTML.trim();
    }
  } else if (tds.length > 1) {
    // Mais de uma célula não cabe num bloco: fica o conteúdo, na ordem.
    conteudo = Array.from(tds)
      .map((t) => t.innerHTML.trim())
      .join('\n');
  }
  // Sem <td> nenhum: era só conteúdo — vale como está.

  const novo: TextBlock = { ...bloco, html: conteudo, attrs };
  delete novo.customHtml;
  return novo;
}

// ─── Controles escrevendo no HTML próprio ────────────────────────
//
// Estrutura e blocos que não são de texto continuam com override (tabela livre
// não vira colunas/atributos), mas os controles do painel NÃO morrem: cada
// ajuste é aplicado cirurgicamente no próprio código, nos elementos que o
// gerador teria estilizado. Quem edita a moldura na mão e depois mexe num
// controle vê o controle vencer NAQUELA propriedade — as demais ficam como
// escreveu.

/** Fundo e espaçamento da ESTRUTURA aplicados na tabela externa do código. */
export function aplicarAttrsNaEstrutura(html: string, attrs: Row['attrs']): string {
  const doc = new DOMParser().parseFromString(`<div id="__raiz__">${html}</div>`, 'text/html');
  const raiz = doc.getElementById('__raiz__');
  const tabela = raiz?.querySelector('table');
  if (!raiz || !tabela) return html;

  if (attrs.backgroundColor) {
    // O MJML põe a cor duas vezes (background e background-color) — repete-se
    // o padrão para valer tanto no canvas quanto nos clientes de e-mail.
    tabela.style.background = attrs.backgroundColor;
    tabela.style.backgroundColor = attrs.backgroundColor;
    tabela.setAttribute('bgcolor', attrs.backgroundColor);
  } else {
    tabela.style.removeProperty('background');
    tabela.style.removeProperty('background-color');
    tabela.removeAttribute('bgcolor');
  }

  const td = tabela.querySelector('td');
  if (td && attrs.padding.trim()) td.style.padding = attrs.padding;

  return raiz.innerHTML;
}

/**
 * Atributos de um bloco com HTML próprio aplicados no código dele (o `<td>`).
 * Bloco de texto nunca chega aqui — ele absorve o código e vira bloco comum.
 */
export function aplicarAttrsNoBloco(bloco: Block): string {
  const html = bloco.customHtml ?? '';
  const doc = new DOMParser().parseFromString(
    `<table><tbody><tr>${html}</tr></tbody></table>`,
    'text/html',
  );
  const tr = doc.querySelector('tr');
  const td = tr?.querySelector('td');
  if (!tr || !td) return html;

  const attrs = bloco.attrs as Partial<{ align: string; padding: string }>;
  if (attrs.align) {
    td.setAttribute('align', attrs.align);
    td.style.textAlign = attrs.align;
  }
  if (attrs.padding?.trim()) td.style.padding = attrs.padding;

  if (bloco.type === 'image') {
    const img = td.querySelector('img');
    if (img) {
      if (bloco.src) img.setAttribute('src', bloco.src);
      img.setAttribute('alt', bloco.alt);
      if (bloco.attrs.width) {
        img.setAttribute('width', String(bloco.attrs.width));
        img.style.width = `${bloco.attrs.width}px`;
      } else {
        img.removeAttribute('width');
        img.style.width = '100%';
      }
      img.style.borderRadius = `${bloco.attrs.borderRadius}px`;
      const a = img.closest('a');
      if (bloco.href) {
        if (a) a.setAttribute('href', bloco.href);
        else {
          const novo = doc.createElement('a');
          novo.setAttribute('href', bloco.href);
          novo.setAttribute('target', '_blank');
          img.replaceWith(novo);
          novo.appendChild(img);
        }
      } else if (a) {
        a.replaceWith(img);
      }
    }
  } else if (bloco.type === 'button') {
    const a = td.querySelector('a');
    if (a) {
      if (bloco.text.trim()) a.textContent = bloco.text;
      a.setAttribute('href', bloco.href);
      a.style.color = bloco.attrs.color;
      a.style.fontSize = `${bloco.attrs.fontSize}px`;
      const tdBotao = a.closest('td') ?? td;
      tdBotao.style.background = bloco.attrs.backgroundColor;
      tdBotao.setAttribute('bgcolor', bloco.attrs.backgroundColor);
      tdBotao.style.borderRadius = `${bloco.attrs.borderRadius}px`;
    }
  } else if (bloco.type === 'spacer') {
    const alvo = td.querySelector('div') ?? td;
    alvo.style.height = `${bloco.attrs.height}px`;
    alvo.style.lineHeight = `${bloco.attrs.height}px`;
  } else if (bloco.type === 'divider') {
    const p = td.querySelector('p');
    if (p) p.style.borderTop = `${bloco.attrs.borderWidth}px solid ${bloco.attrs.borderColor}`;
  } else if (bloco.type === 'social') {
    const imgs = Array.from(td.querySelectorAll('img'));
    for (const img of imgs) {
      img.setAttribute('width', String(bloco.attrs.iconSize));
      img.setAttribute('height', String(bloco.attrs.iconSize));
      img.style.width = `${bloco.attrs.iconSize}px`;
      img.style.height = `${bloco.attrs.iconSize}px`;
      // O MJML trava o tamanho também na célula e na tabelinha do ícone —
      // sem ajustá-las, o ícone fica preso na medida antiga.
      const celula = img.closest('td');
      if (celula && celula !== td) {
        celula.style.width = `${bloco.attrs.iconSize}px`;
        celula.style.height = `${bloco.attrs.iconSize}px`;
      }
      const tabelaIcone = img.closest('table');
      if (tabelaIcone && td.contains(tabelaIcone)) {
        tabelaIcone.style.width = `${bloco.attrs.iconSize}px`;
      }
    }
    // Cada rede é um <a><img></a>, na ordem dos itens. Trocar link/ícone de
    // item existente funciona; ADICIONAR/REMOVER item não tem onde encaixar
    // num código livre — aí é pelo painel de código.
    const as = Array.from(td.querySelectorAll('a'));
    bloco.items.forEach((item, i) => {
      if (as[i] && item.href) as[i].setAttribute('href', item.href);
      if (imgs[i] && item.iconSrc) imgs[i].setAttribute('src', item.iconSrc);
    });
  }

  return tr.innerHTML;
}
