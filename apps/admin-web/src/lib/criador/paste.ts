// Higienização do texto colado no Criador de e-mails.
//
// Sem isto, colar de Word/Docs/site injeta o HTML da ORIGEM dentro do bloco:
// font-family e font-size próprios, <p>/<div> aninhados, classes e até <style>.
// O resultado é texto com a fonte errada, layout quebrado e — pior — os estilos
// da origem vencendo os do e-mail, o que faz o negrito e o tamanho do bloco
// "pararem de funcionar". Como block.html entra cru no <mj-text>, esse lixo
// chegaria também no e-mail enviado.
//
// A regra: preserva o SIGNIFICADO (negrito, itálico, sublinhado, link, quebra
// de linha) e descarta a APARÊNCIA (fontes, cores, tamanhos, espaçamentos),
// para o texto colado adotar a tipografia do e-mail.

/** Tags que sobrevivem à colagem — só ênfase e link. */
const PERMITIDAS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR']);

/** Tags de bloco: viram quebra de linha, senão o texto cola tudo junto. */
const BLOCO = new Set([
  'P',
  'DIV',
  'LI',
  'TR',
  'BLOCKQUOTE',
  'SECTION',
  'ARTICLE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

/** Descartadas junto com o conteúdo. */
const IGNORADAS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE']);

function escaparTexto(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escaparAtributo(valor: string): string {
  return escaparTexto(valor).replace(/"/g, '&quot;');
}

/** Só esquemas de link seguros — javascript:/data: ficam de fora. */
function linkSeguro(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}

function limpar(node: Node): string {
  let saida = '';

  for (const filho of Array.from(node.childNodes)) {
    if (filho.nodeType === Node.TEXT_NODE) {
      // Quebras e tabs viram espaço: no HTML de origem elas são só indentação.
      saida += escaparTexto((filho.textContent ?? '').replace(/\s+/g, ' '));
      continue;
    }
    if (filho.nodeType !== Node.ELEMENT_NODE) continue;

    const el = filho as Element;
    const tag = el.tagName.toUpperCase();

    if (IGNORADAS.has(tag)) continue;
    if (tag === 'BR') {
      saida += '<br>';
      continue;
    }

    const interno = limpar(el);

    if (PERMITIDAS.has(tag)) {
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        saida += linkSeguro(href) ? `<a href="${escaparAtributo(href)}">${interno}</a>` : interno;
      } else {
        const t = tag.toLowerCase();
        saida += `<${t}>${interno}</${t}>`;
      }
      continue;
    }

    // Tag não permitida: fica só o conteúdo. Se era bloco, marca a quebra.
    saida += interno;
    if (BLOCO.has(tag) && interno.trim()) saida += '<br>';
  }

  return saida;
}

/** Texto puro → HTML, preservando as quebras de linha. */
export function textoParaHtml(texto: string): string {
  return texto
    .split(/\r?\n/)
    .map((linha) => escaparTexto(linha))
    .join('<br>');
}

/**
 * HTML colado → HTML seguro, que herda a tipografia do bloco.
 * Roda só no navegador (usa DOMParser).
 */
export function limparHtmlColado(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (
    limpar(doc.body)
      // <br> sobrando no fim (do último bloco) só cria linha vazia.
      .replace(/(?:<br>\s*)+$/, '')
      .replace(/^(?:\s*<br>)+/, '')
      .trim()
  );
}
