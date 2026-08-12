/**
 * Estruturas e blocos do criador de e-mails.
 *
 * Definidos aqui, e não herdados do preset MJML, por três razões concretas: os
 * rótulos precisam sair em português; a ordem e o recorte das seções seguem a
 * referência (Estruturas, depois Blocos); e o ícone de cada item é o que
 * permite reconhecer a estrutura de colunas sem ler o nome. O preset continua
 * responsável pelos *componentes* (mj-section, mj-text…) e pela compilação — o
 * que trocamos é só a vitrine.
 */

export interface DefinicaoBloco {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly content: string;
  readonly media: string;
  readonly attributes: { readonly class: string };
}

export const CATEGORIA_ESTRUTURAS = 'Estruturas';
export const CATEGORIA_BLOCOS = 'Blocos';

/** Caixa tracejada que representa uma coluna na miniatura da estrutura. */
const coluna = (x: number, largura: number): string =>
  `<rect x="${x}" y="4" width="${largura}" height="28" rx="3" fill="#eef2fb" stroke="#c7d2ea" stroke-width="1.5" stroke-dasharray="4 3"/>`;

/** Miniatura de uma estrutura, montada a partir das larguras das colunas (%). */
function miniatura(fracoes: readonly number[]): string {
  const total = 152;
  const espaco = 6;
  const disponivel = total - espaco * (fracoes.length - 1);
  let x = 4;
  const partes = fracoes.map((f) => {
    const largura = disponivel * f;
    const r = coluna(x, largura);
    x += largura + espaco;
    return r;
  });
  return `<svg viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg" width="100%">${partes.join('')}</svg>`;
}

const secao = (colunas: readonly string[]): string =>
  `<mj-section padding="10px 0">${colunas
    .map((largura) => `<mj-column width="${largura}"><mj-text>Escreva aqui</mj-text></mj-column>`)
    .join('')}</mj-section>`;

/** Ícone de bloco — traço simples, na cor do texto suave do painel. */
const icone = (caminho: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${caminho}</svg>`;

export const ESTRUTURAS: readonly DefinicaoBloco[] = [
  {
    id: 'estrutura-1',
    label: '1 coluna',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['100%']),
    media: miniatura([1]),
    attributes: { class: 'bloco-estrutura' },
  },
  {
    id: 'estrutura-2',
    label: '2 colunas',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['50%', '50%']),
    media: miniatura([0.5, 0.5]),
    attributes: { class: 'bloco-estrutura' },
  },
  {
    id: 'estrutura-3',
    label: '3 colunas',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['33.33%', '33.33%', '33.33%']),
    media: miniatura([1 / 3, 1 / 3, 1 / 3]),
    attributes: { class: 'bloco-estrutura' },
  },
  {
    id: 'estrutura-4',
    label: '4 colunas',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['25%', '25%', '25%', '25%']),
    media: miniatura([0.25, 0.25, 0.25, 0.25]),
    attributes: { class: 'bloco-estrutura' },
  },
  {
    id: 'estrutura-33-67',
    label: '1/3 + 2/3',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['33%', '67%']),
    media: miniatura([0.33, 0.67]),
    attributes: { class: 'bloco-estrutura' },
  },
  {
    id: 'estrutura-67-33',
    label: '2/3 + 1/3',
    category: CATEGORIA_ESTRUTURAS,
    content: secao(['67%', '33%']),
    media: miniatura([0.67, 0.33]),
    attributes: { class: 'bloco-estrutura' },
  },
];

export const BLOCOS: readonly DefinicaoBloco[] = [
  {
    id: 'bloco-texto',
    label: 'Texto',
    category: CATEGORIA_BLOCOS,
    content: '<mj-text>Escreva aqui o seu texto.</mj-text>',
    media: icone('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    attributes: { class: 'bloco-conteudo' },
  },
  {
    id: 'bloco-imagem',
    label: 'Imagem',
    category: CATEGORIA_BLOCOS,
    // `src` vazio mostra o marcador do próprio MJML até alguém apontar a
    // imagem — melhor que um link quebrado no corpo do e-mail.
    content: '<mj-image src="" alt="" />',
    media: icone(
      '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/>',
    ),
    attributes: { class: 'bloco-conteudo' },
  },
  {
    id: 'bloco-botao',
    label: 'Botão',
    category: CATEGORIA_BLOCOS,
    content: '<mj-button href="#">Clique aqui</mj-button>',
    media: icone('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>'),
    attributes: { class: 'bloco-conteudo' },
  },
  {
    id: 'bloco-espacador',
    label: 'Espaçador',
    category: CATEGORIA_BLOCOS,
    content: '<mj-spacer height="24px" />',
    media: icone('<path d="M12 4v16M8 7l4-3 4 3M8 17l4 3 4-3"/>'),
    attributes: { class: 'bloco-conteudo' },
  },
  {
    id: 'bloco-divisor',
    label: 'Divisor',
    category: CATEGORIA_BLOCOS,
    content: '<mj-divider border-width="1px" border-color="#e5dfd3" />',
    media: icone('<path d="M4 12h16"/>'),
    attributes: { class: 'bloco-conteudo' },
  },
  {
    id: 'bloco-social',
    label: 'Social',
    category: CATEGORIA_BLOCOS,
    content:
      '<mj-social font-size="13px" mode="horizontal"><mj-social-element name="instagram" href="#"></mj-social-element><mj-social-element name="linkedin" href="#"></mj-social-element></mj-social>',
    media: icone(
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    ),
    attributes: { class: 'bloco-conteudo' },
  },
];
