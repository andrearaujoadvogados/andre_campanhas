// Boletim de notícias — o template periódico do escritório.
//
// Reproduz no criador o boletim que o escritório já manda (a referência é o
// "Boletim Tributário" em PDF): cabeçalho da marca, abertura com título da
// edição, uma sequência de NOTÍCIAS, o quadro de prazos e o encerramento
// assinado.
//
// **Cada notícia é uma LINHA do design, saída de uma fábrica.** Essa é a
// decisão que importa aqui: o operador acrescenta uma notícia duplicando a
// linha no canvas, e a automação futura (a rotina que vai buscar as notícias na
// web e disparar a campanha) monta o e-mail inteiro chamando estas mesmas
// funções com o conteúdo pesquisado — em vez de manipular HTML ou clonar JSON
// às cegas. Por isso tudo aqui é objeto puro, sem DOM: precisa rodar igual no
// navegador e num worker.

import { createRow, uid } from './ops.js';
import type { EmailDesign, Row } from './tipos.js';
import { DEFAULT_SETTINGS, createFooterModuleRow, createHeaderModuleRow } from './presets.js';

// Mesmos hex de `presets.ts` — e-mail não tem CSS custom properties.
const VINHO = '#721420';
const TINTA = '#16222c';
const TINTA_SUAVE = '#4a5560';
const OURO = '#7d5e2c';
const LINHA = '#e5dfd3';

export interface Noticia {
  /** Chapéu da notícia — ex.: "STF · PAUTA DE 26/08". Vai em maiúsculas douradas. */
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
 * Uma notícia do boletim: chapéu dourado, título serifado escuro, corpo, e o
 * fio que a separa da próxima.
 *
 * O fio vive DENTRO da linha da notícia, e não como linha própria, de
 * propósito: duplicar a notícia no canvas (ou a automação concatenar várias)
 * carrega o separador junto, sem ninguém precisar lembrar dele.
 */
export function criarLinhaNoticia(noticia: Noticia): Row {
  const row = createRow([100]);
  row.attrs.padding = '20px 24px 4px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${OURO};font-weight:bold;letter-spacing:3px;">${noticia.categoria.toUpperCase()}</span>`,
      attrs: { fontSize: 11, color: OURO, align: 'left', padding: '0px 0px 8px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-weight:bold;color:${TINTA};">${noticia.titulo}</span>`,
      attrs: { fontSize: 21, color: TINTA, align: 'left', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: noticia.corpo,
      attrs: { fontSize: 14, color: '', align: 'left', padding: '0px 0px 16px 0px' },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: LINHA, borderWidth: 1, padding: '8px 0px 0px 0px' },
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
  row.attrs.padding = '12px 24px 4px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${VINHO};font-weight:bold;letter-spacing:4px;">${edicao.chapeu.toUpperCase()}</span>`,
      attrs: { fontSize: 12, color: VINHO, align: 'center', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-weight:bold;color:${VINHO};">${edicao.titulo}</span>`,
      attrs: { fontSize: 26, color: VINHO, align: 'center', padding: '0px 0px 10px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="letter-spacing:1px;color:${TINTA_SUAVE};">${edicao.periodo}</span>`,
      attrs: { fontSize: 12, color: TINTA_SUAVE, align: 'center', padding: '0px 0px 18px 0px' },
    },
    {
      id: uid(),
      type: 'text',
      html: edicao.introducao,
      attrs: { fontSize: 14, color: '', align: 'left', padding: '0px 0px 8px 0px' },
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
 * Quadro de prazos: título centrado com o traço dourado e uma linha por prazo,
 * com a data em destaque vinho.
 *
 * Cada prazo é um bloco de texto, não uma tabela HTML: continua editável
 * inline no canvas, e a automação monta a lista passando o array.
 */
export function criarLinhaPrazos(titulo: string, prazos: readonly Prazo[]): Row {
  const row = createRow([100]);
  row.attrs.padding = '20px 24px 8px 24px';
  const blocos: Row['columns'][0]['blocks'] = [
    {
      id: uid(),
      type: 'text',
      html: `<span style="color:${OURO};font-weight:bold;letter-spacing:3px;">${titulo.toUpperCase()}</span>`,
      attrs: { fontSize: 12, color: OURO, align: 'center', padding: '0px 0px 4px 0px' },
    },
    {
      id: uid(),
      type: 'divider',
      attrs: { borderColor: OURO, borderWidth: 2, padding: '4px 260px 12px 260px' },
    },
  ];
  for (const prazo of prazos) {
    blocos.push(
      {
        id: uid(),
        type: 'text',
        html: `<span style="font-weight:bold;color:${VINHO};font-size:18px;">${prazo.dia}</span>&nbsp;&nbsp;${prazo.descricao}`,
        attrs: { fontSize: 14, color: '', align: 'left', padding: '6px 0px 6px 0px' },
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
  row.attrs.padding = '20px 24px 28px 24px';
  (row.columns[0] as Row['columns'][0]).blocks = [
    {
      id: uid(),
      type: 'text',
      html: `<em>${assinatura.mensagem}</em>`,
      attrs: { fontSize: 14, color: '', align: 'center', padding: '0px 30px 16px 30px' },
    },
    {
      id: uid(),
      type: 'text',
      html: `<span style="font-weight:bold;color:${TINTA};">${assinatura.nome}</span>`,
      attrs: { fontSize: 15, color: TINTA, align: 'center', padding: '0px 0px 4px 0px' },
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
  row.attrs.padding = '0px 24px 24px 24px';
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

/**
 * O design completo do boletim, com o conteúdo da edição de referência como
 * exemplo — o template se demonstra sozinho, e quem edita vê o que cada pedaço
 * deve conter em vez de encarar caixas com "escreva aqui".
 *
 * A automação futura NÃO parte deste design pronto: ela chama as fábricas
 * acima com o conteúdo pesquisado e monta `{ header, abertura, ...notícias,
 * prazos, encerramento, avisoLegal, footer }` — a mesma sequência daqui.
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
    settings: { ...DEFAULT_SETTINGS },
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
