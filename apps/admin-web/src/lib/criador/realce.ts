// Realce de sintaxe do editor de código do e-mail.
//
// Escrito à mão em vez de trazer uma biblioteca: o que aparece ali é sempre
// HTML de e-mail — tags, atributos, um `<style>` e as variáveis `{{...}}` do
// envio. Um Prism ou CodeMirror resolveria isso e mais mil linguagens que este
// editor nunca vai abrir, pesando no pacote que o navegador baixa.
//
// A saída é uma lista de pedaços; quem pinta é o componente. Separar assim
// deixa o tokenizador testável sem navegador.

export type TipoDeToken =
  | 'texto'
  | 'pontuacao'
  | 'tag'
  | 'atributo'
  | 'valor'
  | 'comentario'
  | 'variavel'
  | 'seletor'
  | 'propriedade'
  | 'numero';

export interface Token {
  tipo: TipoDeToken;
  texto: string;
}

const NOME = /[A-Za-z0-9_:.-]/;

/** Quebra um texto solto separando as variáveis `{{...}}` do resto. */
function comVariaveis(texto: string, tipo: TipoDeToken): Token[] {
  const saida: Token[] = [];
  const resto = texto;
  // As variáveis são o que o operador mais procura no meio do HTML: são elas
  // que dizem onde entra o nome do parceiro. Por isso ganham cor própria mesmo
  // dentro de um valor de atributo ou de um texto comum.
  const re = /\{\{[^}]*\}\}/g;
  let ultimo = 0;
  let casa: RegExpExecArray | null;
  while ((casa = re.exec(resto))) {
    if (casa.index > ultimo) {
      saida.push({ tipo, texto: resto.slice(ultimo, casa.index) });
    }
    saida.push({ tipo: 'variavel', texto: casa[0] });
    ultimo = casa.index + casa[0].length;
  }
  if (ultimo < resto.length) saida.push({ tipo, texto: resto.slice(ultimo) });
  return saida;
}

/** CSS de dentro de um `<style>`: seletor, propriedade, valor e comentário. */
function realcarCss(css: string): Token[] {
  const saida: Token[] = [];
  let i = 0;
  let dentroDeBloco = false;

  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const fim = css.indexOf('*/', i + 2);
      const ate = fim === -1 ? css.length : fim + 2;
      saida.push({ tipo: 'comentario', texto: css.slice(i, ate) });
      i = ate;
      continue;
    }

    const atual = css[i] as string;
    if (atual === '{' || atual === '}') {
      dentroDeBloco = atual === '{';
      saida.push({ tipo: 'pontuacao', texto: atual });
      i += 1;
      continue;
    }

    if (dentroDeBloco) {
      // propriedade: valor;
      const doisPontos = css.indexOf(':', i);
      const fimDaRegra = Math.min(
        ...[css.indexOf(';', i), css.indexOf('}', i)].filter((n) => n !== -1).concat([css.length]),
      );
      if (doisPontos === -1 || doisPontos > fimDaRegra) {
        saida.push({ tipo: 'texto', texto: css.slice(i, fimDaRegra) });
        i = fimDaRegra;
        continue;
      }
      saida.push({ tipo: 'propriedade', texto: css.slice(i, doisPontos) });
      saida.push({ tipo: 'pontuacao', texto: ':' });
      saida.push(...comVariaveis(css.slice(doisPontos + 1, fimDaRegra), 'valor'));
      i = fimDaRegra;
      if (css[i] === ';') {
        saida.push({ tipo: 'pontuacao', texto: ';' });
        i += 1;
      }
      continue;
    }

    // seletor até a próxima chave
    const proxima = Math.min(
      ...[css.indexOf('{', i), css.indexOf('/*', i)].filter((n) => n !== -1).concat([css.length]),
    );
    if (proxima === i) {
      saida.push({ tipo: 'texto', texto: atual });
      i += 1;
      continue;
    }
    saida.push({ tipo: 'seletor', texto: css.slice(i, proxima) });
    i = proxima;
  }

  return saida;
}

/**
 * Quebra HTML de e-mail em pedaços coloridos.
 *
 * Não é um parser: não valida, não fecha tag e não se importa com aninhamento.
 * É um scanner que anda uma vez pelo texto — o que basta para pintar, e é o
 * que permite realçar código quebrado no meio da digitação, que é justamente
 * quando a cor mais ajuda.
 */
export function realcarHtml(codigo: string): Token[] {
  const saida: Token[] = [];
  let i = 0;

  const empurrar = (tipo: TipoDeToken, texto: string) => {
    if (texto) saida.push({ tipo, texto });
  };

  while (i < codigo.length) {
    // ── comentário ──────────────────────────────────────────────
    if (codigo.startsWith('<!--', i)) {
      const fim = codigo.indexOf('-->', i + 4);
      const ate = fim === -1 ? codigo.length : fim + 3;
      empurrar('comentario', codigo.slice(i, ate));
      i = ate;
      continue;
    }

    // ── <!doctype ...> ──────────────────────────────────────────
    if (codigo.startsWith('<!', i)) {
      const fim = codigo.indexOf('>', i);
      const ate = fim === -1 ? codigo.length : fim + 1;
      empurrar('comentario', codigo.slice(i, ate));
      i = ate;
      continue;
    }

    // ── abertura ou fechamento de tag ───────────────────────────
    const abre = codigo[i] === '<';
    const proximo = codigo[i + 1] ?? '';
    if (abre && (NOME.test(proximo) || proximo === '/')) {
      const fechamento = proximo === '/';
      empurrar('pontuacao', fechamento ? '</' : '<');
      i += fechamento ? 2 : 1;

      let nome = '';
      while (i < codigo.length && NOME.test(codigo[i] as string)) {
        nome += codigo[i] as string;
        i += 1;
      }
      empurrar('tag', nome);

      // atributos até fechar a tag
      while (i < codigo.length && codigo[i] !== '>') {
        if (/\s/.test(codigo[i] as string)) {
          let espaco = '';
          while (i < codigo.length && /\s/.test(codigo[i] as string)) {
            espaco += codigo[i] as string;
            i += 1;
          }
          empurrar('texto', espaco);
          continue;
        }
        if (codigo[i] === '/') {
          empurrar('pontuacao', '/');
          i += 1;
          continue;
        }
        if (codigo[i] === '=') {
          empurrar('pontuacao', '=');
          i += 1;
          // valor entre aspas (ou solto)
          const aspas = codigo[i];
          if (aspas === '"' || aspas === "'") {
            const fim = codigo.indexOf(aspas, i + 1);
            const ate = fim === -1 ? codigo.length : fim + 1;
            saida.push(...comVariaveis(codigo.slice(i, ate), 'valor'));
            i = ate;
          } else {
            let solto = '';
            while (i < codigo.length && !/[\s>]/.test(codigo[i] as string)) {
              solto += codigo[i] as string;
              i += 1;
            }
            saida.push(...comVariaveis(solto, 'valor'));
          }
          continue;
        }
        let atributo = '';
        while (i < codigo.length && !/[\s=>]/.test(codigo[i] as string)) {
          atributo += codigo[i] as string;
          i += 1;
        }
        empurrar('atributo', atributo);
      }

      if (codigo[i] === '>') {
        empurrar('pontuacao', '>');
        i += 1;
      }

      // ── conteúdo de <style>: CSS, não texto ───────────────────
      if (nome.toLowerCase() === 'style' && !fechamento) {
        const fim = codigo.toLowerCase().indexOf('</style', i);
        const ate = fim === -1 ? codigo.length : fim;
        saida.push(...realcarCss(codigo.slice(i, ate)));
        i = ate;
      }
      continue;
    }

    // ── texto solto ─────────────────────────────────────────────
    const proximaTag = codigo.indexOf('<', i + 1);
    const ate = proximaTag === -1 ? codigo.length : proximaTag;
    saida.push(...comVariaveis(codigo.slice(i, ate), 'texto'));
    i = ate;
  }

  return saida;
}
