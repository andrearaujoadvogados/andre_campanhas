// Modelo de documento do Criador de e-mails (WYSIWYG).
// O design é a fonte da verdade dos modelos visuais; o MJML é gerado dele.
//
// Portado do avante-mail (github.com/FernandoAraujo89/avante-mail), que é a
// referência de funcionamento e usabilidade deste editor. As diferenças de
// adaptação estão em `presets.ts` (marca e variáveis) e `compile.ts` (Liquid).
//
// `customHtml` é a saída de emergência, disponível em três níveis (bloco, linha
// e documento): quando preenchido, o HTML escrito à mão SUBSTITUI o que aquele
// pedaço geraria. É override e não conversão — o design continua guardado ao
// lado, então voltar ao visual é apagar um campo, não refazer o e-mail.
//
// EXCEÇÃO: bloco de TEXTO não usa override — o `html` dele já é HTML livre,
// então editar o código ABSORVE de volta (lib/criador/absorver.ts): conteúdo
// vira `html`, moldura vira atributos, e o bloco segue 100% editável. Nos
// demais níveis não existe caminho de volta automático (HTML livre não vira
// colunas/atributos), mas NADA fica travado: o texto edita-se inline no canvas,
// e os controles do painel escrevem direto no customHtml
// (aplicarAttrsNaEstrutura / aplicarAttrsNoBloco, no mesmo absorver.ts).

export interface DesignSettings {
  bodyBackground: string;
  contentBackground: string;
  fontFamily: string;
  textColor: string;
  linkColor: string;
  /**
   * Largura do contêiner principal, em px. 600 é o padrão histórico de e-mail
   * (o que todo cliente renderiza sem surpresa); quem sabe o que está fazendo
   * ajusta aqui e o canvas acompanha. Designs salvos antes deste campo existirem
   * são normalizados para 600 na entrada (`normalizarDesign`).
   */
  contentWidth: number;
}

export interface TextBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'text';
  html: string;
  attrs: {
    fontSize: number;
    color: string; // vazio = herda da configuração global
    align: 'left' | 'center' | 'right';
    padding: string;
  };
}

export interface ImageBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'image';
  src: string;
  alt: string;
  href: string;
  attrs: {
    width: number | null; // null = largura total
    align: 'left' | 'center' | 'right';
    borderRadius: number;
    padding: string;
  };
}

export interface ButtonBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'button';
  text: string;
  href: string;
  attrs: {
    backgroundColor: string;
    color: string;
    fontSize: number;
    borderRadius: number;
    align: 'left' | 'center' | 'right';
    padding: string;
  };
}

export interface SpacerBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'spacer';
  attrs: { height: number };
}

export interface DividerBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'divider';
  attrs: {
    borderColor: string;
    borderWidth: number;
    padding: string;
  };
}

export interface SocialItem {
  label: string;
  iconSrc: string;
  href: string;
}

export interface SocialBlock {
  id: string;
  /** HTML próprio (um `<td>…</td>`) que substitui o gerado. */
  customHtml?: string;
  type: 'social';
  items: SocialItem[];
  attrs: {
    iconSize: number;
    align: 'left' | 'center' | 'right';
    padding: string;
  };
}

export type Block = TextBlock | ImageBlock | ButtonBlock | SpacerBlock | DividerBlock | SocialBlock;

export type BlockType = Block['type'];

export interface Column {
  id: string;
  widthPct: number;
  blocks: Block[];
}

export interface Row {
  id: string;
  /** HTML próprio (a tabela inteira da linha) que substitui o gerado. */
  customHtml?: string;
  columns: Column[];
  attrs: {
    backgroundColor: string; // vazio = herda contentBackground
    padding: string;
  };
}

export interface EmailDesign {
  version: 1;
  settings: DesignSettings;
  rows: Row[];
  /**
   * HTML do e-mail INTEIRO, escrito à mão. Preenchido, o criador visual deixa
   * de mandar no que é enviado — as linhas continuam guardadas para o caso de
   * voltar atrás, mas não geram mais nada.
   *
   * É também o caminho de migração: um modelo salvo pelo editor antigo
   * (GrapesJS) abre como design vazio com o `corpoHtml` aqui — nada se perde,
   * e remontar no visual é uma escolha, não uma exigência.
   */
  customHtml?: string;
}

export interface SavedModule {
  id: string;
  name: string;
  design: Row;
  createdAt: string;
}
