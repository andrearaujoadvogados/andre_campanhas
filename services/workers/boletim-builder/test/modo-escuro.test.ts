import { describe, it, expect } from 'vitest';
import mjml2html from 'mjml';
import {
  compileDesignToMjml,
  createBlock,
  createBoletimDesign,
  createRow,
  DEFAULT_SETTINGS,
} from '@emailmkt/criador';
import type { EmailDesign } from '@emailmkt/criador';
import { LiquidEmailRenderer } from '@emailmkt/email-render';

/**
 * O boletim como chega ao assinante: o design compilado pelo MJML (o mesmo
 * compilador do worker) e depois renderizado pelo caminho do envio — Liquid,
 * sanitização, CSS inline.
 *
 * Os testes do criador e do renderizador provam cada metade; este prova que a
 * blindagem de modo escuro e a do Outlook sobrevivem à passagem de uma para a
 * outra. Foi exatamente nessa costura que o doctype, as metas e as tabelas
 * fantasma do Outlook se perdiam sem ninguém ver.
 */
async function boletimEnviado(design: EmailDesign = createBoletimDesign()): Promise<string> {
  const compilado = await mjml2html(compileDesignToMjml(design), {
    validationLevel: 'soft',
  });
  const { corpoHtml } = await new LiquidEmailRenderer().renderizar(
    { assunto: 'Boletim', corpoHtml: compilado.html },
    {
      contato: { nome: 'Maria Souza', email: 'maria@exemplo.com', camposCustomizados: {} },
      urlDescadastro: 'https://exemplo.com/u?t=abc',
    },
  );
  return corpoHtml;
}

describe('boletim enviado diante dos clientes de e-mail', () => {
  it('chega com doctype, idioma e a declaração de modo claro', async () => {
    const html = await boletimEnviado();

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<html[^>]*lang="pt-BR"/);
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toMatch(/<style>:root \{ color-scheme: light only;/);
  });

  it('o Outlook para Windows recebe as tabelas fantasma que seguram os 600px', async () => {
    const html = await boletimEnviado();

    expect(html).toContain('<!--[if mso | IE]><table align="center"');
    expect(html).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
  });

  it('no Gmail, o gradiente de proteção cai exatamente nos dois elementos que pintam vinho', async () => {
    const html = await boletimEnviado();

    expect(html).toMatch(/<body[^>]*class="body"/);
    expect(html).toContain(
      'u + .body .aa-fundo-721420 { background-image: linear-gradient(#721420, #721420) !important; }',
    );
    // A tabela da faixa do logo e a célula do card — cada uma com o vinho no
    // próprio estilo, que é o que o gradiente cobre.
    const protegidos = html.match(/<(?:table|td)\b[^>]*class="aa-fundo-721420"[^>]*>/g) ?? [];
    expect(protegidos).toHaveLength(2);
    for (const tag of protegidos) expect(tag).toMatch(/background(?:-color)?:\s*#721420/i);
    // Nada de gradiente inline: sem as regras do Gmail, vale o desenho normal.
    expect(html).not.toMatch(/style="[^"]*gradient/);
    expect(html.match(/<div class="gmail-blend-screen">/g)).toHaveLength(5);
  });

  it('coluna escura sem recuo: o MJML pinta a tabela da coluna, e é nela que o gradiente cai', async () => {
    // Com recuo o fundo vai numa célula interna; sem recuo, na própria tabela.
    // Errar o alvo pintaria as células dos blocos e deixaria a moldura invertida.
    const linha = createRow([100]);
    const coluna = linha.columns[0] as (typeof linha.columns)[0];
    coluna.attrs = { backgroundColor: '#16222c' };
    coluna.blocks = [createBlock('text'), createBlock('text')];
    const html = await boletimEnviado({
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      rows: [linha],
    });

    const protegidos = html.match(/<(?:table|td)\b[^>]*class="aa-fundo-16222c"[^>]*>/g) ?? [];
    expect(protegidos).toHaveLength(1);
    expect(protegidos[0]).toMatch(/^<table\b[^>]*background-color:\s*#16222c/i);
    expect(html.match(/<div class="gmail-blend-screen">/g)).toHaveLength(2);
  });

  it('continua abaixo do corte do Gmail, que esconde o fim de e-mails com mais de 102 KB', async () => {
    const html = await boletimEnviado();
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(102 * 1024);
  });
});
