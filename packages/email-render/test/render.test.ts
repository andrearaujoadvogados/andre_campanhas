import { describe, it, expect } from 'vitest';
import { LiquidEmailRenderer } from '../src/index.js';

const renderer = new LiquidEmailRenderer();

const contexto = {
  contato: {
    nome: 'Maria Silva Souza',
    email: 'maria@exemplo.com',
    camposCustomizados: { processo: '0001234-56' },
  },
  urlDescadastro: 'https://exemplo.com/u?t=abc123',
};

describe('substituição de variáveis', () => {
  it('substitui nome e e-mail', async () => {
    const r = await renderer.renderizar(
      { assunto: 'Olá {{contato.nome}}', corpoHtml: '<p>{{contato.email}}</p>' },
      contexto,
    );

    expect(r.assunto).toBe('Olá Maria Silva Souza');
    expect(r.corpoHtml).toContain('maria@exemplo.com');
  });

  it('oferece primeiroNome pronto — saudação é o uso mais comum', async () => {
    const r = await renderer.renderizar(
      { assunto: 'Oi, {{contato.primeiroNome}}', corpoHtml: '<p>x</p>' },
      contexto,
    );
    expect(r.assunto).toBe('Oi, Maria');
  });

  it('expõe campos customizados', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<p>Processo {{contato.processo}}</p>' },
      contexto,
    );
    expect(r.corpoHtml).toContain('0001234-56');
  });

  it('variável inexistente vira vazio, não derruba o disparo', async () => {
    // Um `{{contato.sobrenome}}` esquecido não pode custar a campanha inteira.
    const r = await renderer.renderizar(
      { assunto: 'Olá {{contato.sobrenome}}', corpoHtml: '<p>ok</p>' },
      contexto,
    );
    expect(r.assunto).toBe('Olá');
  });

  it('não expõe campos internos do domínio ao template', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<p>[{{contato.tenantId}}][{{contato.contactId}}]</p>' },
      contexto,
    );
    expect(r.corpoHtml).toContain('[][]');
  });
});

describe('segurança do HTML', () => {
  it('remove script do template', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<p>ok</p><script>alert(1)</script>' },
      contexto,
    );
    expect(r.corpoHtml).not.toContain('<script');
    expect(r.corpoHtml).not.toContain('alert(1)');
  });

  it('remove handler inline', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<p onclick="roubar()">ok</p>' },
      contexto,
    );
    expect(r.corpoHtml).not.toContain('onclick');
  });

  it('bloqueia link javascript:', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<a href="javascript:alert(1)">clique</a>' },
      contexto,
    );
    expect(r.corpoHtml).not.toContain('javascript:');
  });

  it('quebra de linha no assunto vira espaço — evita injeção de cabeçalho', async () => {
    const r = await renderer.renderizar(
      { assunto: 'Boletim\r\nBcc: invasor@exemplo.com', corpoHtml: '<p>x</p>' },
      contexto,
    );
    expect(r.assunto).not.toMatch(/[\r\n]/);
  });

  it('preserva tags de tabela — layout de e-mail depende delas', async () => {
    const html = '<table><tr><td>coluna</td></tr></table>';
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).toContain('<table');
    expect(r.corpoHtml).toContain('<td');
  });
});

describe('o que o e-mail precisa para aparecer igual em todo cliente', () => {
  const documento = (head: string, corpo: string): string =>
    `<!doctype html><html lang="pt-BR"><head><title></title>${head}</head><body class="body">${corpo}</body></html>`;

  it('devolve o doctype, o idioma e as metas de codificação, largura e esquema de cor', async () => {
    // Sem doctype o Gmail não marca o documento para os ajustes de modo escuro;
    // sem viewport o iPhone encolhe o e-mail; sem color-scheme o Apple Mail
    // escurece um desenho que foi feito para o claro.
    const html = documento(
      '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta name="color-scheme" content="light only">',
      '<p>oi</p>',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml.startsWith('<!doctype html>')).toBe(true);
    expect(r.corpoHtml).toContain('<meta name="color-scheme" content="light only">');
    expect(r.corpoHtml).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(r.corpoHtml).toContain('charset=UTF-8');
    expect(r.corpoHtml).toMatch(/<html[^>]*lang="pt-BR"/);
    expect(r.corpoHtml).toMatch(/<body[^>]*class="body"/);
  });

  it('não inventa doctype para quem não trazia', async () => {
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: '<p>oi</p>' }, contexto);
    expect(r.corpoHtml.toLowerCase()).not.toContain('<!doctype');
  });

  it('meta que redireciona ou não serve a e-mail não passa', async () => {
    const html = documento(
      '<meta http-equiv="refresh" content="0;url=https://golpe.example">' +
        '<meta name="referrer" content="unsafe-url">',
      '<p>oi</p>',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).not.toContain('refresh');
    expect(r.corpoHtml).not.toContain('golpe.example');
    expect(r.corpoHtml).not.toContain('referrer');
  });

  it('os comentários condicionais do Outlook voltam intactos', async () => {
    // São as "tabelas fantasma" do MJML: sem elas o Outlook para Windows estica
    // o e-mail na janela inteira.
    const fantasmaAbre =
      '<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" style="width:600px;" width="600"><tr><td><![endif]-->';
    const fantasmaFecha = '<!--[if mso | IE]></td></tr></table><![endif]-->';
    const configuracao =
      '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->';
    const html = documento(
      configuracao,
      `${fantasmaAbre}<div style="max-width:600px">conteúdo</div>${fantasmaFecha}` +
        '<!--[if !mso]><!--><p>fora do Outlook</p><!--<![endif]-->',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).toContain(fantasmaAbre);
    expect(r.corpoHtml).toContain(fantasmaFecha);
    expect(r.corpoHtml).toContain(configuracao);
    expect(r.corpoHtml).toContain('<!--[if !mso]><!--><p>fora do Outlook</p><!--<![endif]-->');
  });

  it('condicional que fecha o comentário antes da hora é descartado inteiro', async () => {
    const html = documento(
      '',
      '<!--[if mso]> --><img src="x" onerror="alert(1)"><!-- <![endif]-->',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).not.toContain('onerror');
    expect(r.corpoHtml).not.toContain('[if mso]');
  });

  // Devolvido dentro de um valor de atributo, o miolo fecharia as aspas e
  // injetaria um handler; dentro de <title>/<style>, fecharia o elemento.
  it.each([
    [
      'valor de atributo',
      '',
      `<a href="https://exemplo.com" class='<!--[if mso]>"/onmouseover="alert(1)<![endif]-->'>link</a>`,
    ],
    ['<title>', '<title><!--[if mso]></title><img src=x onerror=alert(2)><![endif]--></title>', ''],
    ['<style>', '<style><!--[if mso]></style><img src=x onerror=alert(3)><![endif]--></style>', ''],
  ])('condicional plantado em %s não volta — nada vira marcação viva', async (_, head, corpo) => {
    const html = documento(head, `${corpo}<p>fim</p>`);
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).not.toMatch(/onerror|onmouseover|alert\(/);
    expect(r.corpoHtml).not.toContain('[if mso]');
    expect(r.corpoHtml).toContain('fim');
  });

  it('<style data-embed> fica no head como está; os demais continuam indo para o inline', async () => {
    // As regras do modo escuro do Gmail só casam dentro dele (`u + .body`): aqui
    // não há onde aplicá-las, e o juice as jogaria fora junto com o <style>.
    const regraDoGmail = 'u + .body .x { background:#000; mix-blend-mode:screen; }';
    const html = documento(
      `<style data-embed>${regraDoGmail}</style><style>p { color: red; }</style>`,
      '<p class="x">oi</p>',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).toContain(regraDoGmail);
    expect(r.corpoHtml).not.toContain('data-embed');
    expect(r.corpoHtml).toMatch(/<p[^>]*style="[^"]*color:\s*red/i);
    expect(r.corpoHtml).not.toMatch(/<p[^>]*style="[^"]*mix-blend-mode/i);
  });

  it('a versão texto não carrega comentário nem marcador interno', async () => {
    const html = documento(
      '',
      '<!--[if mso | IE]><table><tr><td><![endif]--><p>texto</p><!--[if mso | IE]></td></tr></table><![endif]-->',
    );
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoTexto).toContain('texto');
    expect(r.corpoTexto).not.toContain('[if');
    expect(r.corpoTexto).not.toMatch(/c[0-9a-f]{32}x\d+x/);
    expect(r.corpoHtml).not.toMatch(/c[0-9a-f]{32}x\d+x/);
  });
});

describe('rodapé de descadastro — §11, item 7', () => {
  it('acrescenta o link mesmo quando o template não o inclui', async () => {
    // Depender de o operador lembrar significa que um dia sai campanha sem
    // link de saída — descumprimento legal e caminho direto para o spam.
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: '<p>só isso</p>' }, contexto);
    expect(r.corpoHtml).toContain('https://exemplo.com/u?t=abc123');
  });

  it('não duplica quando o template já usa a variável', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<p><a href="{{url_descadastro}}">sair</a></p>' },
      contexto,
    );
    const ocorrencias = r.corpoHtml.split('https://exemplo.com/u?t=abc123').length - 1;
    expect(ocorrencias).toBe(1);
  });

  it('insere antes de </body> quando o documento é completo', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<html><body><p>oi</p></body></html>' },
      contexto,
    );
    expect(r.corpoHtml.indexOf('Descadastrar-se')).toBeLessThan(r.corpoHtml.indexOf('</body>'));
  });
});

describe('CSS inline e versão texto', () => {
  it('move o CSS do <style> para atributo inline — Gmail descarta o head', async () => {
    const html = '<html><head><style>p { color: red; }</style></head><body><p>oi</p></body></html>';
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: html }, contexto);

    expect(r.corpoHtml).toMatch(/<p[^>]*style="[^"]*color:\s*red/i);
  });

  it('gera versão texto legível', async () => {
    const r = await renderer.renderizar(
      { assunto: 'a', corpoHtml: '<h1>Título</h1><p>Parágrafo com <b>negrito</b>.</p>' },
      contexto,
    );

    expect(r.corpoTexto).toContain('Título');
    expect(r.corpoTexto).toContain('negrito');
    expect(r.corpoTexto).not.toContain('<');
  });

  it('a versão texto também traz o link de descadastro', async () => {
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: '<p>oi</p>' }, contexto);
    expect(r.corpoTexto).toContain('exemplo.com/u');
  });

  it('nunca devolve corpo de texto vazio — só-HTML pontua pior em filtro de spam', async () => {
    const r = await renderer.renderizar({ assunto: 'a', corpoHtml: '<p>conteúdo</p>' }, contexto);
    expect(r.corpoTexto.length).toBeGreaterThan(0);
  });
});
