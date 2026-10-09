import { Liquid } from 'liquidjs';
import juice from 'juice';
import { convert } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';
import type { ContextoRenderizacao, EmailRenderer, EmailRenderizado } from '@emailmkt/core';

/**
 * Renderização de e-mail — ADR-07, §4.1.
 *
 * Quatro passos, cada um resolvendo um problema concreto de entregabilidade ou
 * de segurança:
 *
 *  1. **Liquid** substitui as variáveis. Escolhido por ser sandboxed (não
 *     executa código arbitrário) e por falhar de forma previsível com variável
 *     ausente — o operador escreve o template, e um erro dele não pode derrubar
 *     o disparo inteiro.
 *  2. **Sanitização** remove script e handlers inline. Templates são escritos
 *     por gente de confiança, mas HTML colado de um editor externo traz coisas
 *     que ninguém revisou.
 *  3. **CSS inline** (`juice`), porque Gmail e Outlook descartam `<style>` no
 *     head. Sem isso o e-mail chega sem formatação nenhuma. A exceção é o
 *     `<style data-embed>`: regras que só valem DENTRO de um cliente (o modo
 *     escuro do Gmail, por exemplo) não têm onde ser aplicadas aqui, e o juice
 *     as deixa no head como estão.
 *  4. **Versão texto**, gerada do HTML já renderizado. Mensagem só-HTML pontua
 *     pior em filtro de spam e é ilegível em cliente que não renderiza HTML.
 *
 * A sanitização não pode levar junto o que o e-mail precisa para aparecer
 * igual em todo cliente: o doctype (o Gmail só marca o documento para os
 * ajustes de modo escuro quando ele existe), as metas de codificação, largura
 * e esquema de cor, e os comentários condicionais que seguram o layout no
 * Outlook para Windows. Esses voltam por caminhos estreitos, ver `sanitizar`.
 */
export class LiquidEmailRenderer implements EmailRenderer {
  private readonly liquid: Liquid;

  constructor() {
    this.liquid = new Liquid({
      // Variável inexistente vira string vazia em vez de derrubar a
      // renderização. Um `{{contato.sobrenome}}` esquecido no template não pode
      // custar a campanha inteira — o pior caso aceitável é um espaço a mais.
      strictVariables: false,
      strictFilters: false,
      // Sem acesso ao sistema de arquivos: `{% include %}` não deve existir num
      // template que veio do banco.
      root: [],
      extname: '',
    });
  }

  async renderizar(
    template: { readonly assunto: string; readonly corpoHtml: string },
    contexto: ContextoRenderizacao,
  ): Promise<EmailRenderizado> {
    const escopo = montarEscopo(contexto);

    const assunto = limparAssunto(await this.liquid.parseAndRender(template.assunto, escopo));
    const htmlBruto = await this.liquid.parseAndRender(template.corpoHtml, escopo);

    const htmlSeguro = sanitizar(htmlBruto);
    const htmlComRodape = acrescentarRodape(htmlSeguro, contexto.urlDescadastro);

    return {
      assunto,
      corpoHtml: `${doctypeDe(htmlBruto)}${juice(htmlComRodape)}`,
      corpoTexto: paraTexto(htmlComRodape),
    };
  }
}

/**
 * O escopo é montado explicitamente, e não espalhando o contato inteiro.
 *
 * Passar o objeto de domínio direto exporia campos internos a quem escreve o
 * template — e um `{{contato.tenantId}}` num e-mail seria vazamento silencioso.
 */
function montarEscopo(contexto: ContextoRenderizacao): Record<string, unknown> {
  return {
    contato: {
      nome: contexto.contato.nome ?? '',
      // Primeiro nome é o que se usa em saudação; deixar pronto evita que cada
      // template invente sua própria gambiarra de split.
      primeiroNome: (contexto.contato.nome ?? '').trim().split(/\s+/)[0] ?? '',
      email: contexto.contato.email,
      ...contexto.contato.camposCustomizados,
    },
    url_descadastro: contexto.urlDescadastro,
  };
}

/**
 * Assunto é texto puro: quebra de linha permitiria injeção de cabeçalho.
 * O corte em 200 caracteres evita truncamento feio no cliente de e-mail.
 */
function limparAssunto(bruto: string): string {
  return bruto
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
}

const TAGS_PERMITIDAS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img',
  'style',
  'head',
  'body',
  'html',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'center',
  'font',
  'meta',
  'title',
];

/**
 * As metas que um e-mail usa — e só elas. Uma `http-equiv="refresh"` levaria
 * a prévia do painel para outro endereço; nenhum cliente sente falta de uma
 * meta fora desta lista.
 */
const METAS_POR_NOME = new Set([
  'viewport',
  'color-scheme',
  'supported-color-schemes',
  'x-apple-disable-message-reformatting',
  'format-detection',
]);
const METAS_HTTP_EQUIV = new Set(['content-type', 'x-ua-compatible']);

function metaPermitida(atributos: Record<string, string>): boolean {
  const nome = atributos['name']?.toLowerCase();
  const equivalente = atributos['http-equiv']?.toLowerCase();
  if (nome !== undefined) return equivalente === undefined && METAS_POR_NOME.has(nome);
  if (equivalente !== undefined) return METAS_HTTP_EQUIV.has(equivalente);
  return atributos['charset'] !== undefined;
}

function sanitizar(html: string): string {
  const { semCondicionais, devolverCondicionais } = guardarCondicionaisDoOutlook(html);
  const limpo = sanitizeHtml(semCondicionais, {
    allowedTags: TAGS_PERMITIDAS,
    allowedAttributes: {
      '*': [
        'style',
        'class',
        'align',
        'valign',
        'width',
        'height',
        'bgcolor',
        'colspan',
        'rowspan',
        // Idioma e papel do contêiner: é o que faz o leitor de tela anunciar
        // o e-mail em português e como um artigo, e não como tabelas soltas.
        'lang',
        'dir',
        'role',
        'aria-*',
      ],
      a: ['href', 'target', 'rel', 'style', 'class'],
      img: ['src', 'alt', 'width', 'height', 'style', 'class'],
      table: ['border', 'cellpadding', 'cellspacing', 'role', 'style', 'class', 'width'],
      // Os namespaces valem para o Outlook ler o `<o:OfficeDocumentSettings>`
      // do head (PNG e 96 dpi); sem eles o e-mail escala errado no Windows.
      html: ['xmlns', 'xmlns:v', 'xmlns:o'],
      meta: ['name', 'content', 'http-equiv', 'charset'],
      style: ['type', 'data-embed'],
    },
    exclusiveFilter: (frame) => frame.tag === 'meta' && !metaPermitida(frame.attribs),
    // `style` sobrevive porque o juice precisa dele; script e handlers inline,
    // não — são o vetor de XSS na prévia do painel (§10.1).
    allowedSchemes: ['http', 'https', 'mailto'],
    allowVulnerableTags: true,
  });
  return devolverCondicionais(limpo);
}

/** O único doctype devolvido é o do HTML5, e só a quem já o trazia. */
function doctypeDe(html: string): string {
  return /^\s*<!doctype html>/i.test(html) ? '<!doctype html>\n' : '';
}

/**
 * Tira do caminho do sanitizador os comentários condicionais do Outlook e os
 * devolve depois, intactos.
 *
 * O MJML põe neles as "tabelas fantasma" que seguram a largura de 600px no
 * Outlook para Windows — sem elas o e-mail estica na janela inteira — e as
 * configurações de PNG e dpi do head. O sanitize-html descarta TODO
 * comentário, então cada um vira um marcador de texto (que ele não toca) e
 * volta no fim.
 *
 * A segurança vem de duas regras, e nenhuma depende de adivinhar o que é
 * perigoso no miolo:
 *  - o miolo não pode ter `--`: é o que garante que o comentário só termina no
 *    `<![endif]-->` dele, e não antes (`-->` ou `--!>` no meio soltariam o
 *    resto como HTML vivo na prévia do painel);
 *  - o marcador só volta se, no HTML JÁ sanitizado, estiver em posição de
 *    texto — fora de tag e fora de `<style>`/`<title>`. Ali o navegador lê
 *    `<!--` sempre como comentário. Um condicional plantado dentro de um valor
 *    de atributo (para fechar as aspas e injetar outro atributo) simplesmente
 *    não volta.
 * Comentário fora desse molde continua descartado, como sempre foi.
 */
function guardarCondicionaisDoOutlook(html: string): {
  semCondicionais: string;
  devolverCondicionais: (html: string) => string;
} {
  const guardados: string[] = [];
  // Marcador imprevisível: um texto do template não consegue se passar por ele.
  const prefixo = `c${crypto.randomUUID().replaceAll('-', '')}`;
  const guardar = (trecho: string): string => {
    guardados.push(trecho);
    return `${prefixo}x${String(guardados.length - 1)}x`;
  };

  const semCondicionais = html
    // Primeiro o par "revelado" (`<!--[if !mso]><!-->` … `<!--<![endif]-->`):
    // o que fica entre os dois é HTML comum e passa pela sanitização. Precisa
    // vir antes, senão a expressão de baixo o engoliria como um comentário só.
    .replaceAll('<!--[if !mso]><!-->', guardar)
    .replaceAll('<!--<![endif]-->', guardar)
    .replace(/<!--\[if ([a-z0-9 !|&()]{1,40})\]>([\s\S]*?)<!\[endif\]-->/gi, (trecho, _c, miolo) =>
      String(miolo).includes('--') ? '' : guardar(trecho),
    );

  const marcador = new RegExp(`${prefixo}x(\\d+)x`, 'g');
  return {
    semCondicionais,
    devolverCondicionais: (limpo) => {
      // Uma cópia em minúsculas para o documento todo, e não uma por marcador:
      // isto roda a cada destinatário, e o boletim tem dezenas de condicionais.
      const minusculo = limpo.toLowerCase();
      return limpo.replace(marcador, (_, indice: string, posicao: number) =>
        emPosicaoDeTexto(minusculo, posicao) ? (guardados[Number(indice)] ?? '') : '',
      );
    },
  };
}

/**
 * No HTML que sai do sanitize-html, `<` e `>` crus só existem como limites de
 * tag (texto e valores de atributo saem escapados) — ou dentro de `<style>`,
 * que ele repassa como está. Por isso bastam três contas, olhando para trás a
 * partir do marcador.
 */
function emPosicaoDeTexto(minusculo: string, posicao: number): boolean {
  const ultimo = (trecho: string): number => minusculo.lastIndexOf(trecho, posicao - 1);
  const dentroDe = (tag: string): boolean => ultimo(`<${tag}`) > ultimo(`</${tag}`);
  if (dentroDe('style') || dentroDe('title')) return false;
  return ultimo('<') < ultimo('>') || ultimo('<') === -1;
}

/**
 * Rodapé com o link de descadastro.
 *
 * Acrescentado pelo sistema, não deixado a cargo do template: se depender de o
 * operador lembrar de incluir `{{url_descadastro}}`, mais cedo ou mais tarde sai
 * uma campanha sem link de saída — o que é descumprimento legal e o caminho mais
 * rápido para a pessoa marcar como spam (§11, item 7).
 *
 * Se o template já usa a variável, não duplicamos.
 */
function acrescentarRodape(html: string, urlDescadastro: string): string {
  if (html.includes(urlDescadastro)) return html;

  const rodape =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;` +
    `font-size:12px;color:#666;font-family:Arial,Helvetica,sans-serif;">` +
    `<p style="margin:0 0 8px 0;">Você recebeu este e-mail porque tem relacionamento com o escritório.</p>` +
    `<p style="margin:0;"><a href="${urlDescadastro}" style="color:#666;">Descadastrar-se destes e-mails</a></p>` +
    `</div>`;

  // Antes do </body> quando existe; senão, no fim.
  return html.includes('</body>')
    ? html.replace('</body>', `${rodape}</body>`)
    : `${html}${rodape}`;
}

function paraTexto(html: string): string {
  return convert(html, {
    wordwrap: 78,
    selectors: [
      // Imagem sem texto alternativo vira ruído na versão texto.
      { selector: 'img', format: 'skip' },
      // Mantém a URL visível: na versão texto, "clique aqui" não clica.
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      // O padrão do html-to-text é converter títulos para CAIXA ALTA. Excesso
      // de maiúsculas é sinal clássico de spam — desligar aqui evita que a
      // versão texto, criada para *melhorar* a entregabilidade, piore a nota.
      ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
    ],
  }).trim();
}

/**
 * Reduz uma página da web ao texto que interessa a um leitor — o insumo do
 * extrator de notícias do boletim (§11, item 12).
 *
 * Mora aqui, e não no worker, porque este pacote já carrega o html-to-text
 * para a versão texto dos e-mails; o worker reusa a dependência em vez de
 * duplicá-la. Script, estilo, navegação e rodapé caem fora: são o grosso do
 * peso de uma página e zero do conteúdo — e o extrator de IA paga por token.
 *
 * O corte em `limite` é proteção dupla: contra página patológica (um portal
 * com feed infinito renderizado no servidor) e contra o custo da chamada de
 * IA. 30 mil caracteres cobrem qualquer página de notícias razoável.
 */
export function paginaParaTexto(
  html: string,
  limite = 30_000,
  opcoes: {
    /**
     * Mantém as laterais (`aside`). Na coleta de novidades elas só atrapalham;
     * na retrospectiva são o que interessa: é onde os sites põem "mais lidas".
     */
    readonly completo?: boolean;
  } = {},
): string {
  const laterais = opcoes.completo === true ? [] : [{ selector: 'aside', format: 'skip' }];
  const texto = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      ...laterais,
      // O href fica: é dele que o extrator tira o link da matéria.
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return texto.length > limite ? texto.slice(0, limite) : texto;
}
