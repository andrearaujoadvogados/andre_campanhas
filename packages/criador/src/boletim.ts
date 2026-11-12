// Boletim de notícias — o template periódico do escritório.
//
// Reproduz no criador o boletim de referência do escritório (edição
// "Os tribunais superiores voltaram a decidir", set/2026): faixa vinho com o
// logo, abertura com o título da edição, UM destaque num card vinho, o quadro
// "O que isso significa para você", as demais notícias sob "Também nestas
// semanas", o "No radar" com as datas que vêm aí, e o encerramento assinado
// sobre um rodapé claro.
//
// **Cada pedaço é uma LINHA do design, saída de uma fábrica.** Essa é a
// decisão que importa aqui: o operador acrescenta uma notícia duplicando a
// linha no canvas, e a automação (a rotina que busca as notícias na web e
// dispara a campanha) monta o e-mail inteiro chamando estas mesmas funções com
// o conteúdo pesquisado — em vez de manipular HTML ou clonar JSON às cegas.
// Por isso tudo aqui é objeto puro, sem DOM: precisa rodar igual no navegador e
// num worker.
//
// Tipografia e cores seguem o site do escritório: títulos serifados (Georgia,
// a prima instalada em todo cliente da Fraunces do site — web font em e-mail
// fica invisível enquanto não carrega, e foi testado), corpo em sans a 16px
// com entrelinha folgada, texto em tinta escura sobre branco, vinho nos links
// e bronze nos chapéus. É o que dá conforto de leitura num e-mail longo:
// contraste, tamanho e respiro, não ornamento.

import { createRow, uid } from './ops.js';
import type { DesignSettings, EmailDesign, Row } from './tipos.js';
import { DEFAULT_SETTINGS, LOGO_EMAIL_CLARO } from './presets.js';

// Mesmos hex de `presets.ts` e do site — e-mail não tem CSS custom properties.
const VINHO = '#721420';
const TINTA = '#16222c';
const TINTA_SUAVE = '#4a5560';
/** Dourado escurecido, o único da paleta com contraste AA para texto pequeno. */
const BRONZE = '#7d5e2c';
const OURO = '#d5bc80';
const LINHA = '#e5dfd3';
const PAPEL = '#f2efe8';
const NEVOA_VINHO = '#f1e7e4';
/** Texto corrido sobre o vinho: branco quente, não branco puro — cansa menos. */
const CREME = '#f4ebe6';

/**
 * Serifada dos títulos. Fraunces só entra se estiver instalada na máquina do
 * leitor; o que se desenha é para Georgia. Sem `@font-face`: um cliente que
 * espera a fonte remota mostra o título em branco enquanto ela não chega.
 */
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";

/**
 * Configuração global do boletim: corpo em sans e texto em tinta.
 *
 * Difere do `DEFAULT_SETTINGS` (Georgia, texto suave) de propósito: um boletim
 * são vários parágrafos seguidos, e sans a 16px sobre tinta escura cansa menos
 * do que serifada a 14px em cinza. Os títulos trazem a serifada inline.
 */
export const BOLETIM_SETTINGS: DesignSettings = {
  ...DEFAULT_SETTINGS,
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  textColor: TINTA,
};

/** Recuo lateral do conteúdo: 32px em 600px deixa ~70 caracteres por linha a 16px. */
const RECUO = '32px';

/** Chapéu: maiúsculas espaçadas em bronze — o mesmo desenho em toda seção. */
function chapeu(texto: string, opcoes: { cor?: string; espaco?: number } = {}): string {
  const cor = opcoes.cor ?? BRONZE;
  return `<span style="color:${cor};font-weight:bold;letter-spacing:${String(opcoes.espaco ?? 2)}px;">${texto.toUpperCase()}</span>`;
}

/** Título serifado; vira link discreto (sem sublinhado, mesma cor) quando há URL. */
function tituloSerifado(texto: string, cor: string, url?: string): string {
  const miolo = `<span style="font-family:${SERIF};font-weight:700;color:${cor};">${texto}</span>`;
  return url === undefined || url === ''
    ? miolo
    : `<a href="${url}" style="color:${cor};text-decoration:none;">${miolo}</a>`;
}

export interface Noticia {
  /** Chapéu da notícia — ex.: "STF · Holdings e planejamento patrimonial". Vai em maiúsculas bronze. */
  categoria: string;
  titulo: string;
  corpo: string;
  /** Link da matéria: o título passa a apontar para ele. Ausente = título sem link. */
  url?: string;
}

export interface ItemRadar {
  /** Ex.: "24/09", "01/10" ou "Em curso". */
  quando: string;
  texto: string;
}

/** @deprecated Nome antigo do `ItemRadar` — `dia` virou `quando`, porque nem tudo no radar tem data. */
export interface Prazo {
  dia: string;
  descricao: string;
}

/**
 * Faixa vinho com o logo dourado — o topo do boletim.
 *
 * Difere do cabeçalho dos demais e-mails (`createHeaderModuleRow`, logo vinho
 * sobre branco) de propósito: a faixa é a identidade do boletim de referência,
 * e o logo claro existe só para ela.
 */
export function criarLinhaCabecalhoBoletim(): Row {
  const row = createRow([100]);
  row.attrs.backgroundColor = VINHO;
  // O logo claro já traz 18px de fundo vinho em volta da arte: o recuo da
  // faixa desconta esse respiro, e a altura continua a mesma.
  row.attrs.padding = '12px 24px 8px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'image',
      src: LOGO_EMAIL_CLARO.src,
      alt: LOGO_EMAIL_CLARO.alt,
      href: LOGO_EMAIL_CLARO.href,
      attrs: {
        width: LOGO_EMAIL_CLARO.width,
        align: 'center',
        borderRadius: 0,
        padding: '0px 0px',
      },
    },
  ];
  return row;
}

/**
 * Abertura da edição: chapéu do boletim, título grande, linha de período e o
 * parágrafo de contexto. O título é o que muda a cada edição — a automação
 * escreve aqui o resumo do período.
 */
export function criarLinhaAbertura(edicao: {
  chapeu: string;
  titulo: string;
  periodo: string;
  introducao: string;
}): Row {
  const row = createRow([100]);
  row.attrs.padding = `34px ${RECUO} 10px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu(edicao.chapeu, { espaco: 3 }),
      attrs: { fontSize: 12, color: BRONZE, align: 'center', padding: '0px 0px 14px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: tituloSerifado(edicao.titulo, TINTA),
      attrs: {
        fontSize: 28,
        color: TINTA,
        align: 'center',
        padding: '0px 0px 12px 0px',
        lineHeight: 1.25,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="letter-spacing:1px;color:${TINTA_SUAVE};">${edicao.periodo}</span>`,
      attrs: { fontSize: 13, color: TINTA_SUAVE, align: 'center', padding: '0px 0px 24px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: edicao.introducao,
      attrs: {
        fontSize: 16,
        color: '',
        align: 'left',
        padding: '0px 0px 8px 0px',
        lineHeight: 1.65,
      },
    },
  ];
  return row;
}

/**
 * O aviso da edição de retrospectiva — a caixa que diz ao leitor, antes das
 * notícias, que não houve novidade e o que ele está recebendo no lugar.
 *
 * É linha própria, com fundo, e não uma frase escondida na abertura: quem
 * recebe o boletim toda semana percebe conteúdo repetido, e um aviso claro
 * transforma "mandaram coisa velha" em "não houve novidade, e me avisaram".
 */
export function criarLinhaAvisoRetrospectiva(aviso: { destaque: string; texto: string }): Row {
  const row = createRow([100]);
  row.attrs.backgroundColor = NEVOA_VINHO;
  row.attrs.padding = `18px ${RECUO} 18px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-weight:bold;color:${VINHO};">${aviso.destaque}</span> ${aviso.texto}`,
      attrs: { fontSize: 15, color: TINTA, align: 'left', padding: '0px 0px', lineHeight: 1.6 },
    },
  ];
  return row;
}

/**
 * O destaque da edição: um card vinho, recuado das bordas, com chapéu dourado
 * ("DESTAQUE · STJ, 03/09"), título branco e o desenvolvimento em parágrafos.
 *
 * O fundo vai na COLUNA, não na linha: a linha pinta de ponta a ponta, e o
 * card da referência tem margem branca dos dois lados. Cada parágrafo é um
 * bloco de texto — continua editável inline, e a automação passa o array.
 */
export function criarLinhaDestaque(destaque: {
  /** O que vem depois de "DESTAQUE · " — fonte e data, ex.: "STJ, 03/09". */
  chapeu: string;
  titulo: string;
  paragrafos: readonly string[];
  url?: string;
}): Row {
  const row = createRow([100]);
  row.attrs.padding = '12px 24px 8px 24px';
  const coluna = row.columns[0] as Row['columns'][0];
  coluna.attrs = { backgroundColor: VINHO, padding: '26px 28px 16px 28px', borderRadius: 4 };
  coluna.blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu(`Destaque · ${destaque.chapeu}`, { cor: OURO }),
      attrs: { fontSize: 11, color: OURO, align: 'left', padding: '0px 0px 12px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: tituloSerifado(destaque.titulo, '#FFFFFF', destaque.url),
      attrs: {
        fontSize: 23,
        color: '#FFFFFF',
        align: 'left',
        padding: '0px 0px 16px 0px',
        lineHeight: 1.3,
      },
    },
    ...destaque.paragrafos.map((paragrafo) => ({
      id: uid(),
      type: 'text' as const,
      html: paragrafo,
      attrs: {
        fontSize: 15,
        color: CREME,
        align: 'left' as const,
        padding: '0px 0px 12px 0px',
        lineHeight: 1.6,
      },
    })),
  ];
  return row;
}

/**
 * "O que isso significa para você": a leitura prática do destaque, em um
 * parágrafo — é o que transforma notícia em boletim de escritório. Termina
 * com o fio, como as notícias: é o que separa a seção da próxima.
 */
export function criarLinhaSignifica(texto: string): Row {
  const row = createRow([100]);
  row.attrs.padding = `24px ${RECUO} 6px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu('O que isso significa para você'),
      attrs: { fontSize: 11, color: BRONZE, align: 'left', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: texto,
      attrs: {
        fontSize: 16,
        color: '',
        align: 'left',
        padding: '0px 0px 16px 0px',
        lineHeight: 1.65,
      },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '6px 0px 0px 0px' },
    },
  ];
  return row;
}

/**
 * Título de seção ("Também nestas semanas", "No radar"): o chapéu centrado,
 * com respiro acima. Não traz fio próprio — a linha que vem antes (leitura
 * prática, notícia) já termina com o dela, e dois fios seguidos parecem erro.
 */
export function criarLinhaTituloDeSecao(titulo: string): Row {
  const row = createRow([100]);
  row.attrs.padding = `18px ${RECUO} 0px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu(titulo, { espaco: 3 }),
      attrs: { fontSize: 12, color: BRONZE, align: 'center', padding: '8px 0px 2px 0px' },
    },
  ];
  return row;
}

/**
 * Uma notícia do boletim: chapéu bronze, título serifado escuro (com link
 * para a matéria, quando há), corpo, e o fio que a separa da próxima.
 *
 * O fio vive DENTRO da linha da notícia, e não como linha própria, de
 * propósito: duplicar a notícia no canvas (ou a automação concatenar várias)
 * carrega o separador junto, sem ninguém precisar lembrar dele.
 */
export function criarLinhaNoticia(noticia: Noticia): Row {
  const row = createRow([100]);
  row.attrs.padding = `22px ${RECUO} 6px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu(noticia.categoria),
      attrs: { fontSize: 11, color: BRONZE, align: 'left', padding: '0px 0px 8px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: tituloSerifado(noticia.titulo, TINTA, noticia.url),
      attrs: {
        fontSize: 21,
        color: TINTA,
        align: 'left',
        padding: '0px 0px 10px 0px',
        lineHeight: 1.3,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: noticia.corpo,
      attrs: {
        fontSize: 16,
        color: '',
        align: 'left',
        padding: '0px 0px 16px 0px',
        lineHeight: 1.65,
      },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '6px 0px 0px 0px' },
    },
  ];
  return row;
}

/**
 * "No radar": o que vem aí — uma linha por item, com a data (ou "Em curso")
 * em vinho serifado à esquerda e a descrição à direita.
 *
 * As duas colunas são uma tabela DENTRO do bloco de texto, e não duas colunas
 * do design: colunas do MJML empilham no celular, e a data cairia em cima do
 * texto. A tabela inline fica lado a lado em qualquer largura, e o item
 * continua um único bloco editável.
 */
export function criarLinhaRadar(itens: readonly ItemRadar[]): Row {
  const row = createRow([100]);
  row.attrs.padding = `6px ${RECUO} 8px ${RECUO}`;
  const blocos: Row['columns'][0]['blocks'] = [];
  itens.forEach((item, indice) => {
    blocos.push({
      id: uid(),
      type: 'text',
      html:
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
        `<td width="88" valign="top" style="font-family:${SERIF};font-weight:bold;color:${VINHO};font-size:16px;line-height:1.55;padding-right:10px;white-space:nowrap;">${item.quando}</td>` +
        `<td valign="top" style="font-size:15px;line-height:1.55;color:${TINTA};">${item.texto}</td>` +
        `</tr></table>`,
      attrs: { fontSize: 15, color: TINTA, align: 'left', padding: '14px 0px 14px 0px' },
    });
    if (indice < itens.length - 1) {
      blocos.push({
        id: uid(),
        type: 'divider',
        attrs: { borderColor: LINHA, borderWidth: 1, padding: '0px 0px 0px 0px' },
      });
    }
  });
  (row.columns[0] as Row['columns'][0]).blocks = blocos;
  return row;
}

/**
 * @deprecated O quadro de prazos virou o "No radar" (`criarLinhaTituloDeSecao`
 * + `criarLinhaRadar`). Mantido para designs e chamadas antigas.
 */
export function criarLinhaPrazos(titulo: string, prazos: readonly Prazo[]): Row {
  const radar = criarLinhaRadar(prazos.map((p) => ({ quando: p.dia, texto: p.descricao })));
  const cabecalho = criarLinhaTituloDeSecao(titulo);
  const coluna = radar.columns[0] as Row['columns'][0];
  coluna.blocks = [...(cabecalho.columns[0] as Row['columns'][0]).blocks, ...coluna.blocks];
  return radar;
}

/** Encerramento: a frase de disponibilidade em itálico e a assinatura. */
export function criarLinhaEncerramento(assinatura: {
  mensagem: string;
  nome: string;
  registro: string;
}): Row {
  const row = createRow([100]);
  row.attrs.padding = `28px ${RECUO} 34px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: OURO, borderWidth: 2, padding: '0px 0px 26px 0px', width: '64px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<em>${assinatura.mensagem}</em>`,
      attrs: {
        fontSize: 15,
        color: '',
        align: 'center',
        padding: '0px 24px 18px 24px',
        lineHeight: 1.6,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-family:${SERIF};font-weight:bold;color:${TINTA};">${assinatura.nome}</span>`,
      attrs: { fontSize: 17, color: TINTA, align: 'center', padding: '0px 0px 4px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="letter-spacing:2px;color:${TINTA_SUAVE};">${assinatura.registro}</span>`,
      attrs: { fontSize: 11, color: TINTA_SUAVE, align: 'center', padding: '0px 0px' },
    },
  ];
  return row;
}

/**
 * Rodapé claro do boletim: nome do escritório em maiúsculas espaçadas,
 * endereço, área de atuação, o aviso legal (informativo não é parecer, fontes
 * citadas) e o descadastro — obrigatório em todo envio.
 *
 * Substitui, no boletim, o rodapé escuro dos demais e-mails
 * (`createFooterModuleRow`): a referência termina em papel, não em tinta.
 */
export function criarLinhaRodapeBoletim(rodape: {
  nome: string;
  endereco: string;
  area: string;
  fontes: string;
}): Row {
  const row = createRow([100]);
  row.attrs.backgroundColor = PAPEL;
  row.attrs.padding = `30px ${RECUO} 30px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: chapeu(rodape.nome, { cor: TINTA, espaco: 3 }),
      attrs: { fontSize: 12, color: TINTA, align: 'center', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `${rodape.endereco}<br>${rodape.area}`,
      attrs: {
        fontSize: 12,
        color: TINTA_SUAVE,
        align: 'center',
        padding: '0px 0px 18px 0px',
        lineHeight: 1.6,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: `Este boletim tem caráter meramente informativo e não constitui parecer jurídico.<br>${rodape.fontes}`,
      attrs: {
        fontSize: 11,
        color: TINTA_SUAVE,
        align: 'center',
        padding: '0px 0px 14px 0px',
        lineHeight: 1.6,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: `Você recebe este e-mail porque tem relacionamento com o escritório.<br>Não quer mais receber? <a href="{{url_descadastro}}" style="color:${TINTA_SUAVE};text-decoration:underline;">Descadastre-se aqui</a>.`,
      attrs: {
        fontSize: 11,
        color: TINTA_SUAVE,
        align: 'center',
        padding: '0px 0px',
        lineHeight: 1.6,
      },
    },
  ];
  return row;
}

/**
 * @deprecated O aviso legal passou a fazer parte do rodapé claro do boletim
 * (`criarLinhaRodapeBoletim`). Mantido para designs e chamadas antigas.
 */
export function criarLinhaAvisoLegal(aviso: { endereco: string; fontes: string }): Row {
  const row = createRow([100]);
  row.attrs.padding = `0px ${RECUO} 24px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '0px 0px 16px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: aviso.endereco,
      attrs: { fontSize: 12, color: TINTA_SUAVE, align: 'center', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `Este boletim tem caráter meramente informativo e não constitui parecer jurídico.<br>${aviso.fontes}`,
      attrs: { fontSize: 11, color: TINTA_SUAVE, align: 'center', padding: '0px 0px' },
    },
  ];
  return row;
}

/** A assinatura e o rodapé do escritório — iguais em toda edição. */
const ESCRITORIO = {
  mensagem:
    'Nosso escritório permanece à disposição para analisar o impacto dessas decisões na sua empresa.',
  nome: 'André Augusto de Araújo',
  registro: 'OAB/MG 142.853',
  razao: 'André Araújo Advogados',
  endereco: 'Rua João Vaz, nº 2, Salas 1 e 4 · Formiga/MG',
  area: 'Direito Tributário e Empresarial',
} as const;

/** Uma notícia vinda da coleta automática — texto NÃO confiável, será escapado. */
export interface NoticiaDaColeta {
  readonly titulo: string;
  readonly resumo: string;
  readonly url: string;
  readonly tag: string;
}

/**
 * O destaque da edição, como a IA editora o devolve — texto NÃO confiável.
 *
 * Quando a passada editorial falha, a automação não manda este objeto: a
 * primeira notícia vira o destaque com o próprio resumo como único parágrafo,
 * e o boletim sai no mesmo layout, só que mais curto.
 */
export interface DestaqueDaColeta {
  readonly noticia: NoticiaDaColeta;
  /** Fonte e data, ex.: "STJ, 03/09". Vazio = a etiqueta da notícia. */
  readonly chapeu: string;
  readonly paragrafos: readonly string[];
  /** "O que isso significa para você". Vazio = a seção não sai. */
  readonly significa: string;
}

/**
 * Que edição é esta.
 *
 * NOVIDADES é o boletim de sempre. RETROSPECTIVA sai quando as fontes não
 * trouxeram novidade no período: o boletim vai mesmo assim — decisão do
 * escritório —, avisa o leitor e traz o que há de mais relevante e mais lido
 * sobre os temas.
 */
export type EdicaoDoBoletim = 'NOVIDADES' | 'RETROSPECTIVA';

/**
 * Monta a edição do boletim a partir do conteúdo COLETADO — o caminho da
 * automação (§11, item 12). Mesma sequência de linhas da edição de referência;
 * o que muda é a origem do conteúdo, e isso muda uma coisa fundamental:
 *
 * **Tudo aqui é escapado.** As fábricas acima interpolam HTML porque servem
 * conteúdo escrito pelo editor no painel. O que chega da coleta atravessou uma
 * página de terceiros e uma IA — um título contendo `<script>` ou um `"` no
 * lugar certo não pode virar marcação. Os links dos títulos são o único HTML,
 * montados por nós com a URL escapada.
 */
export function criarBoletimColetado(edicao: {
  /** Chapéu acima do título — o nome do boletim (a rotina). */
  readonly chapeu?: string;
  readonly titulo: string;
  readonly periodo: string;
  /** Vazio = o parágrafo padrão da edição (novidades ou retrospectiva). */
  readonly introducao: string;
  readonly edicao?: EdicaoDoBoletim;
  /** Ausente = a primeira notícia, com o resumo como único parágrafo. */
  readonly destaque?: DestaqueDaColeta;
  /** As demais notícias ("Também nestas semanas"). Com `destaque` ausente, a primeira sobe para o card. */
  readonly noticias: readonly NoticiaDaColeta[];
  /** "No radar". Vazio ou ausente = a seção não sai. */
  readonly radar?: readonly { quando: string; texto: string }[];
  readonly fontes: readonly string[];
}): EmailDesign {
  const tipo = edicao.edicao ?? 'NOVIDADES';
  const fontes = escapar(listarFontes(edicao.fontes));

  const [primeira, ...restantes] = edicao.noticias;
  const destaque: DestaqueDaColeta | undefined =
    edicao.destaque ??
    (primeira === undefined
      ? undefined
      : { noticia: primeira, chapeu: '', paragrafos: [primeira.resumo], significa: '' });
  const demais = edicao.destaque === undefined ? restantes : edicao.noticias;

  const introducao = escapar(
    edicao.introducao !== ''
      ? edicao.introducao
      : tipo === 'RETROSPECTIVA'
        ? 'Olá {{contato.primeiroNome}}, esta edição reúne as leituras mais relevantes sobre os temas que acompanhamos para você.'
        : `Olá {{contato.primeiroNome}}, selecionamos os destaques do período a partir das publicações de ${listarFontes(edicao.fontes)}.`,
  );

  const avisoRetrospectiva =
    tipo === 'RETROSPECTIVA'
      ? [
          criarLinhaAvisoRetrospectiva({
            destaque: 'Sem novidades neste período.',
            texto:
              'As fontes que acompanhamos não publicaram nada novo sobre os temas deste boletim. ' +
              `Para você não ficar sem leitura, reunimos abaixo as matérias mais relevantes e mais lidas sobre o assunto, selecionadas de ${fontes}.`,
          }),
        ]
      : [];

  const linhasDestaque =
    destaque === undefined
      ? []
      : [
          criarLinhaDestaque({
            chapeu: escapar(destaque.chapeu !== '' ? destaque.chapeu : destaque.noticia.tag),
            titulo: escapar(destaque.noticia.titulo),
            url: escapar(destaque.noticia.url),
            paragrafos: (destaque.paragrafos.length > 0
              ? destaque.paragrafos
              : [destaque.noticia.resumo]
            ).map(escapar),
          }),
          ...(destaque.significa.trim() === ''
            ? []
            : [criarLinhaSignifica(escapar(destaque.significa))]),
        ];

  const linhasDemais =
    demais.length === 0
      ? []
      : [
          criarLinhaTituloDeSecao('Também nestas semanas'),
          ...demais.map((n) =>
            criarLinhaNoticia({
              categoria: escapar(n.tag),
              titulo: escapar(n.titulo),
              url: escapar(n.url),
              corpo: escapar(n.resumo),
            }),
          ),
        ];

  const radar = edicao.radar ?? [];
  const linhasRadar =
    radar.length === 0
      ? []
      : [
          criarLinhaTituloDeSecao('No radar'),
          criarLinhaRadar(
            radar.map((item) => ({ quando: escapar(item.quando), texto: escapar(item.texto) })),
          ),
        ];

  return {
    version: 1,
    settings: { ...BOLETIM_SETTINGS },
    rows: [
      criarLinhaCabecalhoBoletim(),
      criarLinhaAbertura({
        chapeu: escapar(edicao.chapeu ?? 'Boletim'),
        titulo: escapar(edicao.titulo),
        periodo: escapar(edicao.periodo),
        introducao,
      }),
      ...avisoRetrospectiva,
      ...linhasDestaque,
      ...linhasDemais,
      ...linhasRadar,
      criarLinhaEncerramento(ESCRITORIO),
      criarLinhaRodapeBoletim({
        nome: ESCRITORIO.razao,
        endereco: ESCRITORIO.endereco,
        area: ESCRITORIO.area,
        fontes: `Fontes: ${fontes}. Conteúdo selecionado automaticamente e revisado pelo escritório.`,
      }),
    ],
  };
}

/** "Migalhas, Conjur e Agência Brasil" — a enumeração como se escreve. */
function listarFontes(fontes: readonly string[]): string {
  if (fontes.length <= 1) return fontes[0] ?? 'nossas fontes';
  return `${fontes.slice(0, -1).join(', ')} e ${fontes[fontes.length - 1] ?? ''}`;
}

function escapar(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * O design completo do boletim, com o conteúdo da edição de referência como
 * exemplo — o template se demonstra sozinho, e quem edita vê o que cada pedaço
 * deve conter em vez de encarar caixas com "escreva aqui".
 *
 * A automação NÃO parte deste design pronto: ela chama as fábricas acima com o
 * conteúdo pesquisado (`criarBoletimColetado`) — a mesma sequência daqui.
 */
export function createBoletimDesign(): EmailDesign {
  const noticias: Noticia[] = [
    {
      categoria: 'STF · Holdings e planejamento patrimonial',
      titulo: 'ITBI na integralização de capital: julgamento começa e para sem nenhum voto',
      corpo:
        'Em 2 de setembro, o Plenário levou ao plenário físico o Tema 1.348, que define se a imunidade do ITBI na integralização de imóveis ao capital social alcança empresas de atividade preponderantemente imobiliária. A sessão foi inteiramente ocupada pelas sustentações orais e suspensa sem que um voto fosse proferido. Vale lembrar que o placar formado no ambiente virtual, favorável aos contribuintes, foi zerado pelo pedido de destaque do ministro Flávio Dino em março. Enquanto não houver tese, cada operação de holding patrimonial segue dependendo da prova concreta da atividade preponderante perante o município.',
    },
    {
      categoria: 'STF · Distribuição de lucros',
      titulo: 'Multa de 50% por distribuir lucros com débito federal aguarda proclamação',
      corpo:
        'A ADI 5.161 discute o art. 32 da Lei nº 4.357/1964, que proíbe a empresa com débito não garantido perante a União de distribuir lucros e bonificações, sob pena de multa de 50% sobre o valor distribuído, limitada a 50% do débito, alcançando também os sócios e administradores beneficiados. No plenário virtual prevalecia a tese de que a multa é desproporcional; o resultado ainda não foi proclamado. Enquanto não houver definição, esta é a regra que as empresas devem considerar nas distribuições.',
    },
    {
      categoria: 'STJ · Acórdãos publicados em 29/08',
      titulo: 'DIFAL fora do PIS/Cofins e proteção ao espólio na execução fiscal',
      corpo:
        'Saíram os acórdãos de dois repetitivos favoráveis ao contribuinte: o Tema 1.372, que excluiu o ICMS-DIFAL da base de cálculo do PIS e da Cofins, e o Tema 1.388, que protege o espólio da execução fiscal antes da habilitação dos herdeiros. Com a publicação, os precedentes ganham aplicabilidade prática imediata e abrem caminho para pedidos de restituição e para a revisão de execuções em curso.',
    },
    {
      categoria: 'STJ · Seguradoras',
      titulo: 'PIS e Cofins não incidem sobre aplicações das reservas técnicas',
      corpo:
        'Também em 2 de setembro, a Primeira Seção fixou o Tema 1.309, afastando a incidência de PIS e Cofins sobre as receitas de aplicações financeiras das reservas técnicas das seguradoras. A decisão vale como precedente qualificado e deve ser observada pelos contribuintes do setor e pelas instâncias inferiores.',
    },
    {
      categoria: 'Correção de rota',
      titulo: 'Voto de qualidade do CARF sai de pauta e é adiado pela quarta vez',
      corpo:
        'As ADIs 6.399, 6.403 e 6.415, sobre o critério de desempate no CARF, estavam previstas para 24 de setembro, mas foram retiradas do calendário em 21 de agosto e até agora não receberam nova data. O caso segue relevante menos pela regra atual, já que o voto de qualidade foi restabelecido pela Lei nº 14.689/2023, e mais pela validade dos julgamentos decididos por empate entre 2020 e 2023. Já a Funrural (ADI 4.395) foi adiada pela quarta vez, e o setor continua sem definição.',
    },
  ];

  return {
    version: 1,
    settings: { ...BOLETIM_SETTINGS },
    rows: [
      criarLinhaCabecalhoBoletim(),
      criarLinhaAbertura({
        chapeu: 'Boletim Tributário',
        titulo: 'Os tribunais superiores voltaram a decidir',
        periodo: '26 de agosto a 11 de setembro de 2026 · Edição quinzenal',
        introducao:
          'Depois de um semestre de adiamentos, pedidos de vista e destaques, STF e STJ retomaram o plenário físico e entregaram definições de peso nessas duas semanas. Uma delas é vinculante e fecha uma discussão que vinha desde a virada da década. Outras duas continuam abertas, mas já indicam o terreno. Reunimos abaixo o que mudou e o que ainda está em jogo.',
      }),
      criarLinhaDestaque({
        chapeu: 'STJ, 03/09',
        titulo: 'CPRB continua na base do PIS e da Cofins, agora com efeito vinculante',
        paragrafos: [
          'A Primeira Seção do STJ julgou o Tema 1.276 e fixou que a contribuição previdenciária sobre a receita bruta compõe a base de cálculo do PIS/Pasep e da Cofins, não podendo ser dela excluída. A tese foi firmada sob o rito dos repetitivos, o que vincula juízes e tribunais em todo o país.',
          'Os contribuintes sustentavam que a CPRB é valor destinado aos cofres públicos e, por isso, não representaria receita própria, em raciocínio análogo ao do Tema 69 do STF, que afastou o ICMS da base das contribuições. As empresas também procuravam distinguir o caso dos precedentes do Supremo que impediram a exclusão do ICMS, do ISS e do próprio PIS/Cofins da base da CPRB, por tratarem da composição da base da contribuição substitutiva, e não da receita sujeita às contribuições sociais. O argumento não prevaleceu.',
          'Julgamento nos REsps 2.123.906, 2.123.904 e 2.123.902, com a suspensão nacional dos processos sobre o tema agora liberada para aplicação da tese.',
        ],
      }),
      criarLinhaSignifica(
        'Empresas dos setores que optaram pela desoneração da folha e que mantinham ações ou provisão contábil discutindo essa tese precisam reavaliar a posição. Processos que estavam suspensos voltam a tramitar e tendem a ser decididos conforme o entendimento agora fixado, o que movimenta contingências ativas, depósitos judiciais e a estratégia de recolhimento de cada empresa. Para quem ainda não ingressou, a porta se fechou nesta via. O ponto positivo é que a definição traz previsibilidade e permite dimensionar o passivo com segurança.',
      ),
      criarLinhaTituloDeSecao('Também nestas semanas'),
      ...noticias.map(criarLinhaNoticia),
      criarLinhaTituloDeSecao('No radar'),
      criarLinhaRadar([
        {
          quando: '24/09',
          texto:
            'STF julga as ADIs 7.322, 7.333, 7.361 e 7.362, sobre benefícios fiscais de ICMS concedidos sem convênio do Confaz.',
        },
        {
          quando: '01/10',
          texto: 'Retomada do Tema 1.348 (ITBI na integralização de capital).',
        },
        {
          quando: '07/10',
          texto:
            'Voto de qualidade do CARF (ADIs 6.399, 6.403 e 6.415) e Funrural (ADI 4.395), se mantidos em pauta.',
        },
        {
          quando: 'Em curso',
          texto:
            'Tema 843: créditos presumidos de ICMS na base do PIS e da Cofins, com maioria favorável à exclusão.',
        },
      ]),
      criarLinhaEncerramento(ESCRITORIO),
      criarLinhaRodapeBoletim({
        nome: ESCRITORIO.razao,
        endereco: ESCRITORIO.endereco,
        area: ESCRITORIO.area,
        fontes: 'Fontes: STF, STJ, Migalhas e Conjur.',
      }),
    ],
  };
}
