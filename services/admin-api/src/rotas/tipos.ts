import { Hono } from 'hono';
import { salvarTipoEmailSchema } from '@emailmkt/contracts';
import { TIPO_EMAIL_PADRAO, tipoEmailId as novoTipoEmailId, type TipoEmail } from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

/**
 * Tipos de e-mail — o catálogo gerenciável (Boletim, Comunicado, Convite…).
 *
 * CRUD completo. "Boletim" é semeado na primeira listagem, para o catálogo nunca
 * nascer vazio e o usuário sempre ter ao menos um tipo para escolher.
 */
export const rotasTipos = new Hono<{ Variables: Variaveis }>();

rotasTipos.get('/', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  let tipos = await deps.tiposEmail.listar(usuario.tenantId);
  if (tipos.length === 0) {
    const agora = deps.clock.agora();
    const padrao: TipoEmail = {
      tenantId: usuario.tenantId,
      tipoEmailId: novoTipoEmailId(deps.ids.gerar()),
      nome: TIPO_EMAIL_PADRAO,
      criadoPor: usuario.userId,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    await deps.tiposEmail.salvar(padrao);
    tipos = [padrao];
  }

  return c.json({ itens: tipos.map(paraResposta) });
});

rotasTipos.post('/', validarCorpo(salvarTipoEmailSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const tipo: TipoEmail = {
    tenantId: usuario.tenantId,
    tipoEmailId: novoTipoEmailId(deps.ids.gerar()),
    nome: dados.nome,
    criadoPor: usuario.userId,
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await deps.tiposEmail.salvar(tipo);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'CRIOU',
    recursoTipo: 'TipoEmail',
    recursoId: tipo.tipoEmailId,
    depois: { nome: tipo.nome },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(tipo), 201);
});

rotasTipos.patch('/:id', validarCorpo(salvarTipoEmailSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const tipo = await deps.tiposEmail.buscarPorId(
    usuario.tenantId,
    novoTipoEmailId(c.req.param('id')),
  );
  if (tipo === null) return c.json({ code: 'NAO_ENCONTRADO', message: 'Tipo inexistente.' }, 404);

  const atualizado: TipoEmail = { ...tipo, nome: dados.nome, atualizadoEm: deps.clock.agora() };
  await deps.tiposEmail.salvar(atualizado);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'TipoEmail',
    recursoId: atualizado.tipoEmailId,
    antes: { nome: tipo.nome },
    depois: { nome: atualizado.nome },
    ocorridoEm: deps.clock.agora(),
  });

  return c.json(paraResposta(atualizado));
});

/**
 * Excluir um tipo não toca nos boletins que o usavam: eles guardam o
 * `tipoEmailId`, e a interface passa a mostrá-los como "sem tipo". Apagar o
 * catálogo nunca apaga histórico.
 */
rotasTipos.delete('/:id', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const id = novoTipoEmailId(c.req.param('id'));

  await deps.tiposEmail.excluir(usuario.tenantId, id);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EXCLUIU',
    recursoTipo: 'TipoEmail',
    recursoId: id,
    ocorridoEm: deps.clock.agora(),
  });

  return c.body(null, 204);
});

function paraResposta(t: TipoEmail): Record<string, unknown> {
  return {
    tipoEmailId: t.tipoEmailId,
    nome: t.nome,
    criadoEm: t.criadoEm.toISOString(),
  };
}
