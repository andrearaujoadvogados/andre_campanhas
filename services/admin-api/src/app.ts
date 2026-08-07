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

  for (const prefixo of ['contatos', 'campanhas', 'templates', 'listas', 'relatorios']) {
    app.use(`/${prefixo}`, autenticar());
    app.use(`/${prefixo}/*`, autenticar());
  }

  // Antes das rotas de contato: `/:id/exportacao` precisa casar antes de `/:id`.
  app.route('/contatos', rotasExportacao);
  app.route('/contatos', rotasContatos);
  app.route('/campanhas', rotasCampanhas);
  app.route('/templates', rotasTemplates);
  app.route('/listas', rotasListas);
  app.route('/relatorios', rotasRelatorios);

  app.notFound((c) => c.json({ code: 'ROTA_NAO_ENCONTRADA', message: 'Rota inexistente.' }, 404));

  return app;
}
