// Boletim de notícias — o template periódico do escritório.
//
// Reproduz no criador o boletim que o escritório já manda (a referência é o
// "Boletim Tributário" em PDF): cabeçalho da marca, abertura com título da
// edição, uma sequência de NOTÍCIAS, o quadro de prazos e o encerramento
// assinado.
//
// **Cada notícia é uma LINHA do design, saída de uma fábrica.** Essa é a
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
import { DEFAULT_SETTINGS, createFooterModuleRow, createHeaderModuleRow } from './presets.js';

// Mesmos hex de `presets.ts` e do site — e-mail não tem CSS custom properties.
const VINHO = '#721420';
const TINTA = '#16222c';
const TINTA_SUAVE = '#4a5560';
/** Dourado escurecido, o único da paleta com contraste AA para texto pequeno. */
const BRONZE = '#7d5e2c';
const OURO = '#d5bc80';
const LINHA = '#e5dfd3';
const NEVOA_VINHO = '#f1e7e4';

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

export interface Noticia {
  /** Chapéu da notícia — ex.: "STF · PAUTA DE 26/08". Vai em maiúsculas bronze. */
  categoria: string;
  titulo: string;
  corpo: string;
}

export interface Prazo {
  /** Ex.: "17/08". */
  dia: string;
  descricao: string;
}

/**
 * Uma notícia do boletim: chapéu bronze, título serifado escuro, corpo, e o
 * fio que a separa da próxima.
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
      html: `<span style="color:${BRONZE};font-weight:bold;letter-spacing:2px;">${noticia.categoria.toUpperCase()}</span>`,
      attrs: { fontSize: 11, color: BRONZE, align: 'left', padding: '0px 0px 8px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-family:${SERIF};font-weight:700;color:${TINTA};">${noticia.titulo}</span>`,
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
 * Abertura da edição: chapéu do boletim, título grande, linha de período e o
 * parágrafo de contexto. O título é o que muda a cada edição — a automação
 * escreve aqui o resumo da semana.
 */
export function criarLinhaAbertura(edicao: {
  chapeu: string;
  titulo: string;
  periodo: string;
  introducao: string;
}): Row {
  const row = createRow([100]);
  row.attrs.padding = `16px ${RECUO} 4px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${BRONZE};font-weight:bold;letter-spacing:3px;">${edicao.chapeu.toUpperCase()}</span>`,
      attrs: { fontSize: 12, color: BRONZE, align: 'center', padding: '0px 0px 12px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-family:${SERIF};font-weight:700;color:${VINHO};">${edicao.titulo}</span>`,
      attrs: {
        fontSize: 28,
        color: VINHO,
        align: 'center',
        padding: '0px 0px 10px 0px',
        lineHeight: 1.25,
      },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="letter-spacing:1px;color:${TINTA_SUAVE};">${edicao.periodo}</span>`,
      attrs: { fontSize: 13, color: TINTA_SUAVE, align: 'center', padding: '0px 0px 22px 0px' },
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
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '12px 0px 0px 0px' },
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
 * Quadro de prazos: título centrado com o traço dourado e uma linha por prazo,
 * com a data em destaque vinho.
 *
 * Cada prazo é um bloco de texto, não uma tabela HTML: continua editável
 * inline no canvas, e a automação monta a lista passando o array.
 */
export function criarLinhaPrazos(titulo: string, prazos: readonly Prazo[]): Row {
  const row = createRow([100]);
  row.attrs.padding = `20px ${RECUO} 8px ${RECUO}`;
  const blocos: Row['columns'][0]['blocks'] = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${BRONZE};font-weight:bold;letter-spacing:3px;">${titulo.toUpperCase()}</span>`,
      attrs: { fontSize: 12, color: BRONZE, align: 'center', padding: '0px 0px 4px 0px' },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: OURO, borderWidth: 2, padding: '4px 0px 12px 0px', width: '96px' },
    },
  ];
  for (const prazo of prazos) {
    blocos.push(
      {
        id: uid(),
        type: 'text',
        html: `<span style="font-family:${SERIF};font-weight:bold;color:${VINHO};font-size:19px;">${prazo.dia}</span>&nbsp;&nbsp;${prazo.descricao}`,
        attrs: { fontSize: 16, color: '', align: 'left', padding: '6px 0px 6px 0px' },
      },
      {
        id: uid(),
        type: 'divider',
        attrs: { borderColor: LINHA, borderWidth: 1, padding: '2px 0px 2px 0px' },
      },
    );
  }
  (row.columns[0] as Row['columns'][0]).blocks = blocos;
  return row;
}

/** Encerramento: a frase de disponibilidade em itálico e a assinatura. */
export function criarLinhaEncerramento(assinatura: {
  mensagem: string;
  nome: string;
  registro: string;
}): Row {
  const row = createRow([100]);
  row.attrs.padding = `24px ${RECUO} 28px ${RECUO}`;
  (row.columns[0] as Row['columns'][0]).blocks = [
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
 * Aviso legal antes do rodapé — obrigatório num boletim de escritório de
 * advocacia: informativo não é parecer, e as fontes vão citadas.
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

/** Uma notícia vinda da coleta automática — texto NÃO confiável, será escapado. */
export interface NoticiaDaColeta {
  readonly titulo: string;
  readonly resumo: string;
  readonly url: string;
  readonly tag: string;
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
 * lugar certo não pode virar marcação. O link para a matéria é o único HTML, e
 * é montado por nós com a URL escapada.
 */
export function criarBoletimColetado(edicao: {
  /** Chapéu acima do título — o nome do boletim (a rotina). */
  readonly chapeu?: string;
  readonly titulo: string;
  readonly periodo: string;
  /** Vazio = o parágrafo padrão da edição (novidades ou retrospectiva). */
  readonly introducao: string;
  readonly edicao?: EdicaoDoBoletim;
  readonly noticias: readonly NoticiaDaColeta[];
  readonly fontes: readonly string[];
}): EmailDesign {
  const tipo = edicao.edicao ?? 'NOVIDADES';
  const fontes = escapar(listarFontes(edicao.fontes));

  const noticias = edicao.noticias.map((n) =>
    criarLinhaNoticia({
      categoria: escapar(n.tag),
      titulo: escapar(n.titulo),
      corpo:
        `${escapar(n.resumo)}<br>` +
        `<a href="${escapar(n.url)}" style="color:${VINHO};font-weight:bold;text-decoration:none;">Ler a matéria completa &rarr;</a>`,
    }),
  );

  const introducao =
    edicao.introducao !== ''
      ? edicao.introducao
      : tipo === 'RETROSPECTIVA'
        ? 'Olá {{contato.primeiroNome}}, esta edição reúne as leituras mais relevantes sobre os temas que acompanhamos para você.'
        : `Olá {{contato.primeiroNome}}, selecionamos os destaques do período a partir das publicações de ${fontes}.`;

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

  return {
    version: 1,
    settings: { ...BOLETIM_SETTINGS },
    rows: [
      createHeaderModuleRow(),
      criarLinhaAbertura({
        chapeu: escapar(edicao.chapeu ?? 'Boletim'),
        titulo: escapar(edicao.titulo),
        periodo: escapar(edicao.periodo),
        introducao,
      }),
      ...avisoRetrospectiva,
      ...noticias,
      criarLinhaEncerramento({
        mensagem:
          'Nosso escritório permanece à disposição para analisar os impactos dessas mudanças na sua empresa.',
        nome: 'André Augusto de Araújo',
        registro: 'OAB/MG 142.853',
      }),
      criarLinhaAvisoLegal({
        endereco: 'Rua João Vaz, nº 2, Salas 1 e 4 · Formiga/MG · Direito Tributário e Empresarial',
        fontes: `Fontes: ${fontes}. Conteúdo selecionado automaticamente e revisado pelo escritório.`,
      }),
      createFooterModuleRow(),
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
      categoria: 'Reforma Tributária',
      titulo: 'NF-e sem IBS e CBS passou a ser rejeitada desde 3 de agosto',
      corpo:
        'Encerrou-se o período de flexibilização. Empresas do regime regular não conseguem mais emitir NF-e, NFC-e ou NFS-e no padrão nacional sem o preenchimento correto dos campos de IBS e CBS: o documento é rejeitado automaticamente. A revisão da parametrização do ERP e do cadastro de produtos deixou de ser planejamento: virou urgência.',
    },
    {
      categoria: 'STF · Pauta de 26/08',
      titulo: 'Voto de qualidade do CARF chega ao Supremo com placar desfavorável ao Fisco',
      corpo:
        'O Plenário do STF julga, no dia 26, as ADIs 6.399, 6.403 e 6.415, que discutem o desempate pró-Fazenda nos julgamentos do CARF. Uma decisão favorável ao contribuinte pode alterar o desfecho de milhares de processos administrativos.',
    },
    {
      categoria: 'STJ · Execução Fiscal',
      titulo: 'Baixa da empresa sem quitar débitos autoriza redirecionamento aos sócios',
      corpo:
        'O STJ firmou que a baixa da pessoa jurídica sem o pagamento do passivo tributário configura presunção de dissolução irregular, permitindo o redirecionamento da execução fiscal aos sócios-administradores. Encerrar empresa com passivo fiscal exige planejamento e regularização prévia.',
    },
  ];

  return {
    version: 1,
    settings: { ...BOLETIM_SETTINGS },
    rows: [
      createHeaderModuleRow(),
      criarLinhaAbertura({
        chapeu: 'Boletim Tributário',
        titulo: 'A semana em que a Reforma Tributária saiu do papel',
        periodo: '03 a 07 de agosto de 2026 · Edição semanal',
        introducao:
          'Olá {{contato.primeiroNome}}, a semana marcou uma virada prática no sistema tributário. Selecionamos os destaques a partir das publicações de Migalhas, Conjur e Valor Econômico.',
      }),
      ...noticias.map(criarLinhaNoticia),
      criarLinhaPrazos('Prazos de agosto', [
        { dia: '17/08', descricao: 'EFD-Reinf, competência julho' },
        { dia: '20/08', descricao: 'Dirbi (junho) e PGDAS-D (julho)' },
        { dia: '31/08', descricao: 'DCTFWeb, DME, DOI e DeCripto' },
      ]),
      criarLinhaEncerramento({
        mensagem:
          'Nosso escritório permanece à disposição para analisar os impactos dessas mudanças na sua empresa.',
        nome: 'André Augusto de Araújo',
        registro: 'OAB/MG 142.853',
      }),
      criarLinhaAvisoLegal({
        endereco: 'Rua João Vaz, nº 2, Salas 1 e 4 · Formiga/MG · Direito Tributário e Empresarial',
        fontes: 'Fontes: Migalhas, Conjur e Valor Econômico.',
      }),
      createFooterModuleRow(),
    ],
  };
}
