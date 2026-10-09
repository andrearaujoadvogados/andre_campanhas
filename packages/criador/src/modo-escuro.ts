// O e-mail diante do modo escuro dos clientes.
//
// O desenho é o do modo claro, e é ele que se quer em todo lugar. Cada cliente
// trata o modo escuro de um jeito, e nenhum respeita um pedido único:
//
//  - Apple Mail (iPhone, iPad e Mac) respeita a declaração `color-scheme:
//    light only` e mostra o e-mail exatamente como foi desenhado.
//  - Gmail na web não mexe nas cores.
//  - Gmail no Android escurece só o que é claro: faixas e cards vinho ficam
//    como estão, e o corpo branco vira escuro com texto claro — legível.
//  - Gmail no iPhone INVERTE TUDO, inclusive o que já era escuro: o vinho vira
//    rosa, o texto branco do card vira escuro e o logo dourado (imagem, que
//    ele não inverte) some sobre o rosa. É o que o escritório viu.
//
// Contra o Gmail do iPhone não há declaração que valha; o que funciona são dois
// truques conhecidos da comunidade de e-mail, que exploram o que ele NÃO muda:
//
//  1. Gradiente de uma cor só (`linear-gradient(#721420,#721420)`) é imagem de
//     fundo, e imagem ele não inverte: a superfície continua vinho.
//  2. O texto claro sobre essa superfície, que ele escureceria, volta a ser
//     claro com duas camadas de mesclagem (`screen` e `difference`) — a conta
//     das duas desfaz a inversão. Técnica de Rémi Parmentier:
//     https://www.hteumeuleu.com/2021/fixing-gmail-dark-mode-css-blend-modes/
//
// As duas regras vivem num `<style>` que só casa DENTRO do Gmail (`u + .body`:
// o Gmail troca o doctype por um `<u></u>` antes do corpo) e só chegam juntas
// ou não chegam. É essa a proteção: em qualquer outro cliente — ou no Gmail
// com conta que não é Google, que ignora `<style>` — nada muda e vale a
// inversão normal, que é feia mas legível. Gradiente sem as camadas deixaria o
// texto escuro sobre vinho, ilegível; por isso o gradiente de superfície com
// texto nunca vai inline.
//
// Limite conhecido: a conta das camadas devolve com exatidão branco e cinzas;
// texto COLORIDO sobre superfície escura (o chapéu dourado do card) volta
// claro e legível, mas com o matiz trocado, só no Gmail do iPhone escuro.

/** Luminância relativa (WCAG) de `#rgb`/`#rrggbb`; `null` para qualquer outra notação. */
function luminancia(cor: string): number | null {
  const hex = cor.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex === undefined) return null;
  const seis = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const canal = parseInt(seis.slice(i, i + 2), 16) / 255;
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Fundo escuro o bastante para levar texto claro — o que o Gmail do iPhone
 * estraga. O corte (0,18, um cinza #767676) separa vinho, tinta e bronze dos
 * papéis e névoas claros da paleta.
 */
export function ehFundoEscuro(cor: string): boolean {
  const valor = luminancia(cor);
  return valor !== null && valor <= 0.18;
}

/** `#721420` → `721420`: vira pedaço de nome de classe. */
function hexDaCor(cor: string): string {
  const hex = cor.trim().slice(1).toLowerCase();
  return hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
}

/** Classe que recebe o gradiente de proteção, no elemento que PINTA o fundo. */
export function classeDoFundoProtegido(cor: string): string {
  return `aa-fundo-${hexDaCor(cor)}`;
}

/** Marca da estrutura (`mj-section`) com fundo escuro — de onde se acha a tabela que pinta. */
export function classeDaSecaoEscura(cor: string): string {
  return `aa-secao-${hexDaCor(cor)}`;
}

/**
 * Marca da coluna com fundo escuro próprio (o card) — de onde se acha o
 * elemento que pinta. Com recuo, o MJML 5 põe o fundo numa célula interna
 * (o "gutter"); sem recuo, na própria tabela da coluna. As marcas diferem para
 * cada caso descer até o elemento certo.
 */
export function classeDaColunaEscura(cor: string, comRecuo: boolean): string {
  return `aa-coluna-${hexDaCor(cor)}${comRecuo ? '' : '-sem-recuo'}`;
}

/**
 * Classes das duas camadas de mesclagem, de fora para dentro. Quem lê o HTML
 * compilado de volta (o painel de código) precisa reconhecê-las e descartá-las:
 * gravadas no bloco, a compilação seguinte as poria de novo, uma dentro da outra.
 */
export const CAMADAS_DE_MESCLAGEM = ['gmail-blend-screen', 'gmail-blend-difference'] as const;

/** As duas camadas de mesclagem em volta do conteúdo de um texto sobre fundo escuro. */
export function envolverTextoEmFundoEscuro(html: string): string {
  const [fora, dentro] = CAMADAS_DE_MESCLAGEM;
  return `<div class="${fora}"><div class="${dentro}">${html}</div></div>`;
}

/**
 * O que vai no `<mj-head>` de todo e-mail: idioma do documento à parte, a
 * declaração de "só modo claro" e — quando o design tem superfícies escuras —
 * a proteção delas no Gmail.
 *
 * Cada regra vai num `<style data-embed>` próprio: `data-embed` faz o juice do
 * envio deixá-lo como está (as regras não casam com nada fora do cliente, e
 * seriam jogadas fora), e separar os blocos importa porque o Gmail descarta o
 * `<style>` INTEIRO quando encontra algo que não entende — o `:root` do esquema
 * de cor não pode levar junto a proteção.
 */
export function cabecalhoParaModoEscuro(coresEscuras: {
  readonly secoes: ReadonlySet<string>;
  readonly colunasComRecuo: ReadonlySet<string>;
  readonly colunasSemRecuo: ReadonlySet<string>;
}): string {
  const esquemaClaro = `    <mj-raw>
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light only">
      <style data-embed>:root { color-scheme: light only; supported-color-schemes: light only; }</style>
    </mj-raw>`;

  const todas = new Set(
    [...coresEscuras.secoes, ...coresEscuras.colunasComRecuo, ...coresEscuras.colunasSemRecuo].map(
      hexDaCor,
    ),
  );
  if (todas.size === 0) return esquemaClaro;

  // O gradiente precisa estar no elemento que PINTA o fundo — a tabela da
  // estrutura, a célula do card —, e o MJML não deixa pôr classe neles. As
  // marcas `aa-secao-…`/`aa-coluna-…` vão onde ele deixa (`css-class`), e daqui
  // se desce até o elemento certo. (`mj-html-attributes` troca o atributo
  // inteiro: esses elementos não têm classe própria no MJML 5.)
  const seletor = (caminho: string, classe: string): string =>
    `      <mj-selector path="${caminho}"><mj-html-attribute name="class">${classe}</mj-html-attribute></mj-selector>`;
  const atributos = [
    seletor('body', 'body'),
    ...[...coresEscuras.secoes].map((cor) =>
      seletor(`.${classeDaSecaoEscura(cor)} > table`, classeDoFundoProtegido(cor)),
    ),
    ...[...coresEscuras.colunasComRecuo].map((cor) =>
      seletor(
        `.${classeDaColunaEscura(cor, true)} > table > tbody > tr > td`,
        classeDoFundoProtegido(cor),
      ),
    ),
    ...[...coresEscuras.colunasSemRecuo].map((cor) =>
      seletor(`.${classeDaColunaEscura(cor, false)} > table`, classeDoFundoProtegido(cor)),
    ),
  ];

  const gradientes = [...todas]
    .map(
      (hex) =>
        `u + .body .aa-fundo-${hex} { background-image: linear-gradient(#${hex}, #${hex}) !important; }`,
    )
    .join('\n        ');

  return `${esquemaClaro}
    <mj-html-attributes>
${atributos.join('\n')}
    </mj-html-attributes>
    <mj-raw>
      <style data-embed>
        ${gradientes}
        u + .body .gmail-blend-screen { background: #000; mix-blend-mode: screen; }
        u + .body .gmail-blend-difference { background: #000; mix-blend-mode: difference; }
      </style>
    </mj-raw>`;
}
