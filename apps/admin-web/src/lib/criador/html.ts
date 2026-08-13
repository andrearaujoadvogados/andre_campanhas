// Design → HTML final, no navegador.
//
// A referência compila no servidor; aqui o mjml-browser já era dependência do
// editor antigo e faz o mesmo trabalho sem uma rota nova. O HTML que sai daqui
// é o `corpoHtml` gravado no modelo — exatamente o que o envio usa.

import mjml2html from 'mjml-browser';
import { MARCA_FIM, MARCA_INICIO, compileDesignToMjml, type Marca } from '@emailmkt/criador';
import { pareceDocumentoHtml, recortarEntreMarcadores } from './codigo.js';
import type { EmailDesign } from '@emailmkt/criador';

export interface HtmlCompilado {
  readonly html: string;
  readonly avisos: string[];
}

/**
 * Compila o design inteiro para o HTML de envio.
 *
 * Override de documento passa reto: não é MJML, é o HTML final escrito à mão —
 * compilá-lo o destruiria. As variáveis Liquid continuam valendo nos dois
 * caminhos, porque quem as resolve é o renderizador do envio.
 */
export async function compilarParaHtml(design: EmailDesign): Promise<HtmlCompilado> {
  if (design.customHtml !== undefined && design.customHtml.trim() !== '') {
    return { html: design.customHtml, avisos: [] };
  }
  const r = await mjml2html(compileDesignToMjml(design), { validationLevel: 'soft' });
  // `errors` pode vir ausente dependendo da versão — avisos são opcionais.
  return { html: r.html, avisos: (r.errors ?? []).map((e) => e.formattedMessage) };
}

/**
 * HTML REAL de um pedaço (bloco ou linha), para o painel de código.
 *
 * Compila o documento inteiro com o pedaço entre marcadores e recorta — é o
 * único jeito de o código aberto ser o mesmo que o envio gera, com largura de
 * coluna, fundo da linha e tipografia global na conta. Um MJML montado só com
 * o bloco daria outro HTML, e a pessoa editaria um código que não existe.
 */
export async function gerarCodigoDoPedaco(
  design: EmailDesign,
  marca: Marca,
): Promise<HtmlCompilado> {
  // O recorte parte do design SEM override de documento: é o HTML gerado que
  // interessa como ponto de partida.
  const semOverride: EmailDesign = { ...design };
  delete semOverride.customHtml;

  const r = await mjml2html(compileDesignToMjml(semOverride, marca), { validationLevel: 'soft' });
  const recorte = recortarEntreMarcadores(r.html, marca?.tipo === 'bloco');
  return {
    html: recorte ?? r.html,
    avisos: (r.errors ?? []).map((e) => e.formattedMessage),
  };
}

/** HTML do documento inteiro, formatado para o painel de código. */
export function gerarCodigoDoDocumento(design: EmailDesign): Promise<HtmlCompilado> {
  return compilarParaHtml(design);
}

export { MARCA_FIM, MARCA_INICIO, pareceDocumentoHtml };
