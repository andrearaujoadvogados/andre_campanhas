// Presets do Criador de e-mails: estruturas, blocos padrão e design inicial.
//
// Aqui mora a adaptação de marca: a referência (avante-mail) traz os presets da
// Avante; estes são do escritório André Araújo. As VARIÁVEIS são as do Liquid
// deste sistema — `{{contato.primeiroNome}}`, `{{contato.nome}}`,
// `{{contato.email}}` e `{{url_descadastro}}` — porque o renderizador resolve
// qualquer outra para string vazia sem erro, e um token inventado sumiria no
// envio sem ninguém perceber.

import { createRow, uid } from './ops.js';
import type { Block, BlockType, DesignSettings, EmailDesign, Row } from './tipos.js';

// ─── Estruturas (layouts de colunas) ─────────────────────────────

export const STRUCTURES: { label: string; widths: number[] }[] = [
  { label: '1 coluna', widths: [100] },
  { label: '2 colunas', widths: [50, 50] },
  { label: '3 colunas', widths: [33.33, 33.33, 33.34] },
  { label: '4 colunas', widths: [25, 25, 25, 25] },
  { label: '1/3 + 2/3', widths: [33.33, 66.67] },
  { label: '2/3 + 1/3', widths: [66.67, 33.33] },
];

// ─── Cores da marca no e-mail ────────────────────────────────────
//
// Espelham os tokens do painel (index.css), mas vivem aqui como hex cru:
// e-mail não tem CSS custom properties — o valor precisa estar no atributo.

const VINHO = '#721420';
const TINTA = '#16222c';
const TINTA_SUAVE = '#4a5560';
const PAPEL = '#f2efe8';
const LINHA = '#e5dfd3';

// ─── Blocos padrão ───────────────────────────────────────────────

export function createBlock(type: BlockType): Block {
  switch (type) {
    case 'text':
      return {
        id: uid(),
        type: 'text',
        html: 'Escreva aqui o seu texto. Você pode usar variáveis como {{contato.primeiroNome}}.',
        attrs: { fontSize: 14, color: '', align: 'left', padding: '10px 24px' },
      };
    case 'image':
      return {
        id: uid(),
        type: 'image',
        // Placeholder neutro: imagem entra por URL (não há upload — decisão
        // registrada em docs/PENDENCIAS na época; o campo do painel é a URL).
        src: 'https://placehold.co/600x300/f2efe8/721420?text=Imagem',
        alt: '',
        href: '',
        attrs: { width: null, align: 'center', borderRadius: 0, padding: '10px 24px' },
      };
    case 'button':
      return {
        id: uid(),
        type: 'button',
        text: 'Saiba mais',
        href: 'https://andrearaujoadvogados.com.br',
        attrs: {
          backgroundColor: VINHO,
          color: '#FFFFFF',
          fontSize: 15,
          borderRadius: 6,
          align: 'center',
          padding: '12px 24px',
        },
      };
    case 'spacer':
      return { id: uid(), type: 'spacer', attrs: { height: 24 } };
    case 'divider':
      return {
        id: uid(),
        type: 'divider',
        attrs: { borderColor: LINHA, borderWidth: 1, padding: '10px 24px' },
      };
    case 'social':
      return {
        id: uid(),
        type: 'social',
        // Ícones são placeholders editáveis: o escritório troca o `src` pela
        // arte hospedada e o `href` pelo perfil. Não inventamos perfis.
        items: [
          {
            label: 'Instagram',
            iconSrc: 'https://placehold.co/72x72/721420/ffffff?text=IG',
            href: 'https://instagram.com',
          },
          {
            label: 'LinkedIn',
            iconSrc: 'https://placehold.co/72x72/721420/ffffff?text=IN',
            href: 'https://linkedin.com',
          },
        ],
        attrs: { iconSize: 36, align: 'center', padding: '12px 24px' },
      };
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Texto',
  image: 'Imagem',
  button: 'Botão',
  spacer: 'Espaçador',
  divider: 'Divisor',
  social: 'Social',
};

// ─── Configurações globais padrão ────────────────────────────────

export const DEFAULT_SETTINGS: DesignSettings = {
  bodyBackground: PAPEL,
  contentBackground: '#FFFFFF',
  // Georgia é a prima segura da Fraunces do painel: serifada, instalada em
  // todo cliente de e-mail, e coerente com a identidade do escritório.
  fontFamily: "Georgia, 'Times New Roman', serif",
  textColor: TINTA_SUAVE,
  linkColor: VINHO,
};

export const FONT_OPTIONS = [
  { label: 'Georgia (serifada)', value: "Georgia, 'Times New Roman', serif" },
  {
    label: 'Helvetica Neue',
    value: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  {
    label: 'Inter / sistema',
    value: "Inter, -apple-system, 'Segoe UI', sans-serif",
  },
];

// ─── Módulos de fábrica ──────────────────────────────────────────

/**
 * Cabeçalho em TEXTO, não em imagem — deliberado. Não existe logo hospedado
 * para e-mails (imagem entra por URL), e um cabeçalho que depende de um arquivo
 * externo quebraria em silêncio no dia em que o arquivo sumisse.
 */
export function createHeaderModuleRow(): Row {
  const row = createRow([100]);
  row.attrs.padding = '28px 24px 20px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${VINHO};font-weight:bold;letter-spacing:1px;">ANDRÉ ARAÚJO</span><br><span style="color:${TINTA_SUAVE};font-size:11px;letter-spacing:4px;">ADVOGADOS</span>`,
      attrs: { fontSize: 22, color: '', align: 'center', padding: '0px 0px' },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '16px 80px 0px 80px' },
    },
  ];
  return row;
}

export function createFooterModuleRow(): Row {
  const row = createRow([100]);
  row.attrs.backgroundColor = TINTA;
  row.attrs.padding = '32px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: '<span style="font-weight:bold;color:#FFFFFF;">André Araújo Advogados</span>',
      attrs: { fontSize: 14, color: '#FFFFFF', align: 'center', padding: '0px 0px 12px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: '<a href="https://andrearaujoadvogados.com.br" style="color:#d5bc80;text-decoration:none;">andrearaujoadvogados.com.br</a>',
      attrs: { fontSize: 12, color: '#d5bc80', align: 'center', padding: '0px 0px 16px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: 'Você recebe este e-mail porque tem relacionamento com o escritório.<br>Não quer mais receber? <a href="{{url_descadastro}}" style="color:#8A98A5;text-decoration:underline;">Descadastre-se aqui</a>.',
      attrs: { fontSize: 12, color: '#8A98A5', align: 'center', padding: '0px 0px' },
    },
  ];
  return row;
}

// ─── Design inicial de um e-mail novo ────────────────────────────

export function createDefaultDesign(): EmailDesign {
  const header = createHeaderModuleRow();

  const title = createRow([100]);
  title.attrs.padding = '8px 24px 0px 24px';
  (title.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: 'Olá {{contato.primeiroNome}},',
      attrs: { fontSize: 15, color: '', align: 'left', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-weight:bold;color:${TINTA};">Título do e-mail</span>`,
      attrs: { fontSize: 23, color: TINTA, align: 'left', padding: '0px 0px 8px 0px' },
    },
  ];

  const body = createRow([100]);
  body.attrs.padding = '8px 24px 8px 24px';
  (body.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: 'Escreva aqui o conteúdo do seu e-mail. Este texto é totalmente editável.',
      attrs: { fontSize: 14, color: '', align: 'left', padding: '0px 0px 12px 0px' },
    },
    {
      id: uid(),
      type: 'button',
      text: 'Leia a análise completa',
      href: 'https://andrearaujoadvogados.com.br',
      attrs: {
        backgroundColor: VINHO,
        color: '#FFFFFF',
        fontSize: 15,
        borderRadius: 6,
        align: 'left',
        padding: '8px 0px 24px 0px',
      },
    },
  ];

  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    rows: [header, title, body, createFooterModuleRow()],
  };
}
