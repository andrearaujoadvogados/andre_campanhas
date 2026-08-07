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
