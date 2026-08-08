import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { autenticar, type Variaveis } from './auth.js';
import { corpoDeErroInterno } from './erros.js';
import { rotasContatos } from './rotas/contatos.js';
import { rotasCampanhas } from './rotas/campanhas.js';
import { rotasTemplates } from './rotas/templates.js';
import { rotasListas } from './rotas/listas.js';
import { rotasRelatorios } from './rotas/relatorios.js';
import { rotasExportacao } from './rotas/exportacao.js';
import { rotasImportacoes } from './rotas/importacoes.js';
import { rotasUsuarios } from './rotas/usuarios.js';

export function criarApp() {
  const app = new Hono<{ Variables: Variaveis }>();

  /**
   * Correlação ponta a ponta — §10.4.
   *
   * O mesmo identificador aparece na resposta de erro, no log estruturado e (nas
   * próximas etapas) na mensagem que segue para a fila. É o que permite
   * reconstruir "o que aconteceu com aquela requisição das 14h32" atravessando
   * API, Step Functions, SQS e Lambda.
   */
  app.use('*', async (c, next) => {
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    c.set('correlationId', correlationId);
    c.header('x-correlation-id', correlationId);
    await next();
  });

  /**
   * Rede de segurança contra vazamento de detalhe interno.
   *
   * Mensagem de exceção costuma trazer nome de tabela, ARN ou trecho de
   * consulta. O cliente recebe um código genérico e o correlationId; o detalhe
   * fica no log, onde só quem tem acesso à conta enxerga.
   */
  app.onError((erro, c) => {
    const correlationId = c.get('correlationId') ?? 'sem-correlacao';
    console.error(
      JSON.stringify({
        nivel: 'ERROR',
        correlationId,
        rota: c.req.path,
        metodo: c.req.method,
        erro: erro instanceof Error ? erro.message : String(erro),
        stack: erro instanceof Error ? erro.stack : undefined,
      }),
    );
    return c.json(corpoDeErroInterno(correlationId), 500);
  });

  // Sem autenticação: usado pelo pipeline para verificação pós-deploy. Não
  // expõe nada — nem versão, que ajudaria a mapear vulnerabilidades conhecidas.
  app.get('/saude', (c) => c.json({ ok: true }));

  /**
   * Autentica tudo, menos o que estiver declarado como público.
   *
   * Era uma lista de prefixos a autenticar, e a lista falhava em aberto: a rota
   * de usuários entrou sem `autenticar()` porque ninguém lembrou de acrescentar
   * o prefixo. Não deu acesso indevido — o `exigirPapel` quebrou ao ler um
   * usuário inexistente e devolveu 500 —, mas quem depende de um 500 para não
   * expor uma rota administrativa está dependendo de sorte.
   *
   * Invertido, o esquecimento passa a ser barulhento em vez de silencioso: rota
   * nova nasce autenticada, e quem quiser abri-la precisa dizer isso aqui.
   */
  const PUBLICAS = new Set(['/saude']);

  app.use('*', async (c, next) => {
    if (PUBLICAS.has(c.req.path)) return next();
    return autenticar()(c, next);
  });

  // Antes das rotas de contato: `/:id/exportacao` e `/importacoes` precisam
  // casar antes de `/:id`, que aceitaria "importacoes" como identificador.
  app.route('/contatos/importacoes', rotasImportacoes);
  app.route('/contatos', rotasExportacao);
  app.route('/contatos', rotasContatos);
  app.route('/campanhas', rotasCampanhas);
  app.route('/templates', rotasTemplates);
  app.route('/listas', rotasListas);
  app.route('/relatorios', rotasRelatorios);
  app.route('/usuarios', rotasUsuarios);

  app.notFound((c) => c.json({ code: 'ROTA_NAO_ENCONTRADA', message: 'Rota inexistente.' }, 404));

  return app;
}
