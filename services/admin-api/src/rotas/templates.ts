import { Hono } from 'hono';
import type { Context } from 'hono';
import { salvarTemplateSchema } from '@emailmkt/contracts';
import {
  CONTATO_EXEMPLO,
  VARIAVEIS_DISPONIVEIS,
  arquivar,
  proximaVersao,
  templateId as novoTemplateId,
  tipoEfetivo,
  type Template,
  type VersaoTemplate,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

export const rotasTemplates = new Hono<{ Variables: Variaveis }>();

rotasTemplates.get('/', async (c) => {
  const { templates } = await obterDependencias();
  const usuario = c.get('usuario');

  const pagina = await templates.listar(usuario.tenantId, c.req.query('cursor'));
  return c.json({
    itens: pagina.itens.map(paraResumo),
    cursor: pagina.cursor,
    // A interface não precisa adivinhar o que o operador pode escrever.
    variaveisDisponiveis: VARIAVEIS_DISPONIVEIS,
  });
});

rotasTemplates.get('/:id', async (c) => {
  const { templates } = await obterDependencias();
  const usuario = c.get('usuario');
  const id = novoTemplateId(c.req.param('id'));

  const meta = await templates.buscarMeta(usuario.tenantId, id);
  if (meta === null) return naoEncontrado(c);

  const versao = await templates.buscarVersao(usuario.tenantId, id, meta.versaoAtual);
  return c.json({ ...paraResumo(meta), conteudo: versao });
});

/** Versão específica — o que uma campanha antiga realmente enviou (§6.2, nota 3). */
rotasTemplates.get('/:id/versoes/:versao', async (c) => {
  const { templates } = await obterDependencias();
  const usuario = c.get('usuario');

  const versao = Number(c.req.param('versao'));
  if (!Number.isInteger(versao) || versao < 1) {
    return c.json({ code: 'CAMPO_OBRIGATORIO', message: 'Versão inválida.' }, 400);
  }

  const conteudo = await templates.buscarVersao(
    usuario.tenantId,
    novoTemplateId(c.req.param('id')),
    versao,
  );
  return conteudo === null ? naoEncontrado(c) : c.json({ versao, ...conteudo });
});

rotasTemplates.post('/', validarCorpo(salvarTemplateSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const template: Template = {
    tenantId: usuario.tenantId,
    templateId: novoTemplateId(deps.ids.gerar()),
    nome: dados.nome,
    tipo: dados.tipo,
    ...(dados.categoria === undefined ? {} : { categoria: dados.categoria }),
    ...(dados.thumbnail === undefined ? {} : { thumbnail: dados.thumbnail }),
    versaoAtual: 1,
    arquivado: false,
    criadoPor: usuario.userId,
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await deps.templates.salvarComVersao(template, versaoDe(dados, 1, usuario.userId, agora));
  await auditar(deps, c, 'CRIOU', template.templateId, undefined, {
    nome: template.nome,
    versao: 1,
  });

  return c.json(paraResumo(template), 201);
});

/**
 * Editar cria a próxima versão — nunca altera a existente.
 *
 * §6.2, nota 3: a campanha congela `templateVersao` no disparo. Se a versão
 * pudesse mudar depois, o histórico diria que foi enviado um conteúdo que nunca
 * existiu naquela forma — e a aprovação do advogado responsável (§10.3) perderia
 * o valor probatório que é a razão de ela existir.
 */
rotasTemplates.put('/:id', validarCorpo(salvarTemplateSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const atual = await deps.templates.buscarMeta(
    usuario.tenantId,
    novoTemplateId(c.req.param('id')),
  );
  if (atual === null) return naoEncontrado(c);

  const versao = proximaVersao(atual.versaoAtual);
  const atualizado: Template = {
    ...atual,
    nome: dados.nome,
    tipo: dados.tipo,
    ...(dados.categoria === undefined ? {} : { categoria: dados.categoria }),
    ...(dados.thumbnail === undefined ? {} : { thumbnail: dados.thumbnail }),
    versaoAtual: versao,
    atualizadoEm: agora,
  };

  await deps.templates.salvarComVersao(atualizado, versaoDe(dados, versao, usuario.userId, agora));
  await auditar(
    deps,
    c,
    'EDITOU',
    atual.templateId,
    { versao: atual.versaoAtual },
    { versao, nome: dados.nome },
  );

  return c.json({
    ...paraResumo(atualizado),
    aviso:
      'Uma nova versão foi criada. Campanhas já aprovadas continuam apontando para a versão anterior e precisam ser revisadas novamente se você quiser usar esta.',
  });
});

/**
 * Prévia da renderização — §11, item 2.
 *
 * Usa um contato de exemplo explicitamente fictício. Pré-visualizar com um
 * contato real da base exporia dado pessoal numa tela que qualquer operador
 * abre, e normalizaria a prática.
 */
rotasTemplates.post('/previa', validarCorpo(salvarTemplateSchema), async (c) => {
  const dados = c.req.valid('json');
  const { renderer } = await obterDependencias();

  const renderizado = await renderer.renderizar(
    { assunto: dados.assunto, corpoHtml: dados.corpoHtml },
    {
      contato: {
        nome: CONTATO_EXEMPLO.nome,
        email: CONTATO_EXEMPLO.email,
        camposCustomizados: CONTATO_EXEMPLO.camposCustomizados,
      },
      urlDescadastro: 'https://exemplo.invalido/descadastro-de-teste',
    },
  );

  return c.json({
    ...renderizado,
    aviso: 'Prévia com dados fictícios. O link de descadastro acima não funciona.',
  });
});

/**
 * Arquiva em vez de excluir — restrito a ADMIN.
 *
 * O template pode ter sido usado por campanhas já enviadas. Apagá-lo quebraria a
 * trilha do que foi disparado, que é justamente o que sustenta a exigência de
 * aprovação da OAB (§10.3).
 */
rotasTemplates.delete('/:id', exigirPapel('ADMIN'), async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const atual = await deps.templates.buscarMeta(
    usuario.tenantId,
    novoTemplateId(c.req.param('id')),
  );
  if (atual === null) return naoEncontrado(c);

  const arquivado = arquivar(atual, deps.clock.agora());
  await deps.templates.salvarMeta(arquivado);
  await auditar(deps, c, 'EDITOU', atual.templateId, { arquivado: false }, { arquivado: true });

  return c.json({
    ...paraResumo(arquivado),
    aviso: 'Template arquivado, não excluído: as versões seguem disponíveis para auditoria.',
  });
});

// ── Auxiliares ───────────────────────────────────────────────────────────────

type Ctx = Context<{ Variables: Variaveis }>;

const naoEncontrado = (c: Ctx) =>
  c.json({ code: 'NAO_ENCONTRADO', message: 'Template inexistente.' }, 404);

async function auditar(
  deps: Awaited<ReturnType<typeof obterDependencias>>,
  c: Ctx,
  acao: 'CRIOU' | 'EDITOU',
  recursoId: string,
  antes: unknown,
  depois: unknown,
): Promise<void> {
  const usuario = c.get('usuario');
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao,
    recursoTipo: 'Template',
    recursoId,
    antes,
    depois,
    ocorridoEm: deps.clock.agora(),
  });
}

function versaoDe(
  dados: {
    assunto: string;
    corpoHtml: string;
    preheader?: string | undefined;
    estruturaVisual?: string | undefined;
  },
  versao: number,
  criadoPor: Template['criadoPor'],
  agora: Date,
): VersaoTemplate {
  return {
    versao,
    assunto: dados.assunto,
    corpoHtml: dados.corpoHtml,
    ...(dados.estruturaVisual === undefined ? {} : { estruturaVisual: dados.estruturaVisual }),
    ...(dados.preheader === undefined ? {} : { preheader: dados.preheader }),
    criadoPor,
    criadoEm: agora,
  };
}

function paraResumo(t: Template): Record<string, unknown> {
  return {
    templateId: t.templateId,
    nome: t.nome,
    tipo: tipoEfetivo(t),
    categoria: t.categoria ?? null,
    thumbnail: t.thumbnail ?? null,
    versaoAtual: t.versaoAtual,
    arquivado: t.arquivado,
    criadoEm: t.criadoEm.toISOString(),
    atualizadoEm: t.atualizadoEm.toISOString(),
  };
}
