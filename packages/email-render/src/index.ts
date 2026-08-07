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
 *     head. Sem isso o e-mail chega sem formatação nenhuma.
 *  4. **Versão texto**, gerada do HTML já renderizado. Mensagem só-HTML pontua
 *     pior em filtro de spam e é ilegível em cliente que não renderiza HTML.
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
      corpoHtml: juice(htmlComRodape),
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
];

function sanitizar(html: string): string {
  return sanitizeHtml(html, {
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
      ],
      a: ['href', 'target', 'rel', 'style', 'class'],
      img: ['src', 'alt', 'width', 'height', 'style', 'class'],
      table: ['border', 'cellpadding', 'cellspacing', 'role', 'style', 'class', 'width'],
    },
    // `style` sobrevive porque o juice precisa dele; script e handlers inline,
    // não — são o vetor de XSS na prévia do painel (§10.1).
    allowedSchemes: ['http', 'https', 'mailto'],
    allowVulnerableTags: true,
  });
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
