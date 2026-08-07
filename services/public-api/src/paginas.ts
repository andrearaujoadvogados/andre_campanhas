/**
 * Páginas do descadastro — §11, item 7.
 *
 * É a única superfície do sistema que um cliente do escritório vê. Duas coisas
 * a governam:
 *
 * 1. **Nada de externo.** Sem fonte do Google, sem CDN, sem imagem remota. O
 *    token está na URL; qualquer requisição a terceiro o vazaria no cabeçalho
 *    Referer. Por isso o CSS é inline e a página é autossuficiente.
 * 2. **Sair tem de ser fácil.** Se a pessoa não encontra o botão, ela marca
 *    como spam — o que custa a reputação da conta inteira, não só aquele
 *    contato (§14).
 */

const ESTILO = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6; color: #1a1a1a; background: #f7f7f8;
    display: flex; align-items: center; justify-content: center; min-height: 100vh;
  }
  .cartao {
    background: #fff; border-radius: 12px; padding: 32px;
    max-width: 520px; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,.1);
  }
  h1 { font-size: 22px; margin: 0 0 16px; line-height: 1.3; }
  p { margin: 0 0 16px; }
  .rodape { font-size: 13px; color: #666; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; }
  button {
    font: inherit; font-weight: 600; cursor: pointer;
    background: #1a1a1a; color: #fff; border: 0;
    border-radius: 8px; padding: 12px 20px; width: 100%;
  }
  button:hover { background: #333; }
  button.secundario { background: transparent; color: #666; border: 1px solid #ddd; margin-top: 12px; }
  button.secundario:hover { background: #f0f0f0; }
  .sucesso { color: #0a7c42; font-weight: 600; }
  .erro { color: #b3261e; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { background: #18181b; color: #f4f4f5; }
    .cartao { background: #27272a; box-shadow: none; }
    .rodape { color: #a1a1aa; border-color: #3f3f46; }
    button { background: #f4f4f5; color: #18181b; }
    button:hover { background: #e4e4e7; }
    button.secundario { color: #a1a1aa; border-color: #52525b; }
    .sucesso { color: #4ade80; }
    .erro { color: #f87171; }
  }
`;

/**
 * Escapa antes de interpolar. Hoje nada do usuário chega ao HTML — mas essa
 * garantia depende de quem editar este arquivo no futuro lembrar disso, e é
 * exatamente o tipo de coisa que se esquece.
 */
export function escapar(bruto: string): string {
  return bruto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body>
<main class="cartao">
${corpo}
<div class="rodape">
  <p style="margin:0">André Araújo Advogados</p>
</div>
</main>
</body>
</html>`;
}

/**
 * Confirmação — o GET nunca descadastra.
 *
 * Isto não é cerimônia: scanners de segurança corporativa e proxies de e-mail
 * seguem os links das mensagens automaticamente. Se o GET executasse a ação,
 * pessoas seriam descadastradas sem nunca ter clicado em nada — e o escritório
 * perderia contatos sem entender por quê. A ação fica no POST, disparado por um
 * botão de verdade.
 */
export function paginaConfirmacao(token: string): string {
  const t = escapar(token);
  return moldura(
    'Descadastrar-se',
    `<h1>Deseja parar de receber estes e-mails?</h1>
<p>Você não receberá mais comunicações do escritório neste endereço.</p>
<form method="POST" action="/">
  <input type="hidden" name="t" value="${t}">
  <button type="submit" name="acao" value="descadastro">Sim, quero me descadastrar</button>
</form>
<form method="POST" action="/">
  <input type="hidden" name="t" value="${t}">
  <button type="submit" name="acao" value="oposicao" class="secundario">
    Descadastrar e solicitar a exclusão dos meus dados
  </button>
</form>
<div class="rodape">
  <p style="margin:0 0 8px">
    A segunda opção registra sua <strong>oposição ao tratamento</strong> dos seus dados
    (art. 18, §2º, da LGPD), e não apenas o fim dos envios.
  </p>
</div>`,
  );
}

export function paginaSucesso(tipo: 'DESCADASTRO' | 'OPOSICAO'): string {
  const corpo =
    tipo === 'OPOSICAO'
      ? `<h1 class="sucesso">Pronto. Sua solicitação foi registrada.</h1>
<p>Você não receberá mais e-mails neste endereço, e sua oposição ao tratamento dos seus dados foi registrada.</p>
<p>O escritório dará andamento à solicitação conforme a LGPD.</p>`
      : `<h1 class="sucesso">Pronto. Você foi descadastrado.</h1>
<p>Você não receberá mais e-mails do escritório neste endereço.</p>
<p>Se mudar de ideia, é só entrar em contato com o escritório.</p>`;

  return moldura('Descadastro concluído', corpo);
}

/**
 * Página de erro.
 *
 * Não diz se o token era inválido ou se o contato não existe — a resposta é a
 * mesma nos dois casos. Distinguir transformaria o endpoint público num oráculo
 * para descobrir quem está na base do escritório (§10.1).
 */
export function paginaErro(): string {
  return moldura(
    'Link inválido',
    `<h1 class="erro">Este link não é válido.</h1>
<p>O endereço pode ter sido copiado de forma incompleta.</p>
<p>Se você quer parar de receber os e-mails, responda a qualquer mensagem do escritório
pedindo o descadastro — a solicitação será atendida.</p>`,
  );
}
