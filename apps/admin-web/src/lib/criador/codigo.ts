// Recorte e higiene do HTML editado à mão no Criador de email.

import { MARCA_INICIO, MARCA_FIM } from './compile.js';

/**
 * Recorta o pedaço do HTML compilado que está entre os marcadores.
 *
 * `desembrulharTr` tira o `<tr>` de fora quando o alvo é um bloco: o que o
 * usuário edita é o `<td>`, porque é ali que moram alinhamento, fundo e
 * espaçamento — e é a mesma unidade que ele vê nas outras ferramentas. O `<tr>`
 * volta na compilação, então ele nunca precisa saber que existe.
 */
export function recortarEntreMarcadores(html: string, desembrulharTr: boolean): string | null {
  const inicio = html.indexOf(MARCA_INICIO);
  const fim = html.indexOf(MARCA_FIM);
  if (inicio === -1 || fim === -1 || fim < inicio) return null;

  const trecho = html.slice(inicio + MARCA_INICIO.length, fim).trim();
  if (!desembrulharTr) return trecho;

  const casa = trecho.match(/^<tr\b[^>]*>([\s\S]*)<\/tr>$/i);
  return (casa?.[1] !== undefined ? casa[1] : trecho).trim();
}

/**
 * Tira do HTML o que não tem lugar num e-mail e é perigoso na tela do editor.
 *
 * O canvas mostra este HTML com `dangerouslySetInnerHTML`, então um `<script>`
 * colado de qualquer lugar rodaria dentro do sistema, com a sessão de quem está
 * editando. Nenhum cliente de e-mail executa script — remover não custa nada ao
 * resultado e fecha a porta.
 */
export function limparHtmlDoUsuario(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|background)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** Um HTML de documento inteiro precisa ao menos abrir corpo ou tabela. */
export function pareceDocumentoHtml(html: string): boolean {
  return /<\s*(html|body|table|div)\b/i.test(html);
}
