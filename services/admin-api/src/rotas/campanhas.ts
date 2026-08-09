import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  agendarCampanhaSchema,
  aprovarCampanhaSchema,
  criarCampanhaSchema,
  editarCampanhaSchema,
} from '@emailmkt/contracts';
import {
  agendar,
  aprovar,
  cancelar,
  campaignId as novoCampaignId,
  enviarParaRevisao,
  listId as novoListId,
  pausar,
  retomar,
  revogarAprovacaoPorEdicao,
  templateId as novoTemplateId,
  type Campaign,
  type ConteudoAprovavel,
  domainError,
  type DomainError,
  type Result,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias, type Dependencias } from '../container.js';
import { corpoDeErro, statusDeErro } from '../erros.js';
import { validarCorpo } from '../validacao.js';

export const rotasCampanhas = new Hono<{ Variables: Variaveis }>();

const STATUS_VALIDOS: readonly Campaign['status'][] = [
  'RASCUNHO',
  'EM_REVISAO',
  'APROVADA',
  'AGENDADA',
  'ENVIANDO',
  'PAUSADA',
  'CONCLUIDA',
  'CANCELADA',
];

rotasCampanhas.post('/', validarCorpo(criarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const campanha: Campaign = {
    tenantId: usuario.tenantId,
    campaignId: novoCampaignId(deps.ids.gerar()),
    nome: dados.nome,
    templateId: novoTemplateId(dados.templateId),
    // Congelada no disparo (§6.2, nota 3): editar o template não pode alterar
    // retroativamente o que já foi enviado.
    templateVersao: 1,
    listId: novoListId(dados.listId),
    status: 'RASCUNHO',
    remetenteNome: dados.remetenteNome,
    remetenteEmail: dados.remetenteEmail,
    ...(dados.replyTo === undefined ? {} : { replyTo: dados.replyTo }),
    criadoPor: usuario.userId,
    criadoEm: agora,
  };

  await deps.campanhas.salvar(campanha);
  await registrar(deps, c, 'CRIOU', campanha, undefined, { nome: campanha.nome });

  return c.json(paraResposta(campanha, deps), 201);
});

/**
 * Edição — só enquanto a campanha não começou a sair.
 *
 * `ENVIANDO`, `PAUSADA`, `CONCLUIDA` e `CANCELADA` ficam de fora: a partir do
 * disparo, cada mensagem entregue é um fato registrado, e mudar a campanha
 * depois faria o relatório descrever algo que não foi o que saiu.
 *
 * Editar campanha já aprovada revoga a aprovação e devolve para rascunho. Quem
 * revisou aprovou *aquele* conteúdo — é a mesma razão do hash em
 * `verificarAprovacaoVigente`, aplicada à edição em vez do disparo.
 */
const EDITAVEIS = new Set(['RASCUNHO', 'EM_REVISAO', 'APROVADA', 'AGENDADA']);

rotasCampanhas.patch('/:id', validarCorpo(editarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  if (!EDITAVEIS.has(campanha.status)) {
    return c.json(
      {
        code: 'CAMPANHA_NAO_EDITAVEL',
        message: `Campanha em ${campanha.status} não pode ser editada. Depois do disparo, o que saiu não muda.`,
      },
      409,
    );
  }

  const editada: Campaign = {
    ...campanha,
    ...(dados.nome === undefined ? {} : { nome: dados.nome }),
    ...(dados.templateId === undefined ? {} : { templateId: novoTemplateId(dados.templateId) }),
    ...(dados.listId === undefined ? {} : { listId: novoListId(dados.listId) }),
    ...(dados.remetenteNome === undefined ? {} : { remetenteNome: dados.remetenteNome }),
    ...(dados.remetenteEmail === undefined ? {} : { remetenteEmail: dados.remetenteEmail }),
    ...(dados.replyTo === undefined ? {} : { replyTo: dados.replyTo }),
  };

  const aprovacaoRevogada = campanha.status === 'APROVADA' || campanha.status === 'AGENDADA';
  const final = revogarAprovacaoPorEdicao(editada);

  await deps.campanhas.salvar(final);
  await registrar(deps, c, 'EDITOU', final, { nome: campanha.nome }, { nome: final.nome });
  void usuario;

  return c.json({
    ...paraResposta(final, deps),
    ...(aprovacaoRevogada
      ? {
          aviso:
            'A campanha estava aprovada e voltou para rascunho: a aprovação valia para o conteúdo anterior. Revise e aprove de novo antes de disparar.',
        }
      : {}),
  });
});

/**
 * Exclusão — só rascunho.
 *
 * Campanha que passou por revisão já tem rastro de quem a leu, e campanha
 * disparada tem registros de envio apontando para ela. Apagar qualquer uma das
 * duas deixaria auditoria e relatório sem referente. Para as demais existe o
 * cancelamento, que preserva o histórico.
 */
rotasCampanhas.delete('/:id', exigirPapel('ADMIN'), async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  if (campanha.status !== 'RASCUNHO') {
    return c.json(
      {
        code: 'CAMPANHA_NAO_EXCLUIVEL',
        message:
          'Só rascunho pode ser excluído. Campanha que já foi revisada ou disparada deixa rastro de auditoria e de envio — use o cancelamento.',
      },
      409,
    );
  }

  await deps.campanhas.excluir(campanha.tenantId, campanha.campaignId);
  await registrar(deps, c, 'EXCLUIU', campanha, { nome: campanha.nome }, undefined);

  return c.body(null, 204);
});

/**
 * Listagem — §6.3, padrão 7.
 *
 * `?status=` filtra numa partição só e pagina de verdade. Sem filtro, mescla as
 * oito partições e pode cortar; nesse caso a resposta traz `truncado: true` e um
 * aviso, em vez de silenciosamente esconder campanhas de quem está olhando.
 */
rotasCampanhas.get('/', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const statusBruto = c.req.query('status');
  const status = STATUS_VALIDOS.find((s) => s === statusBruto);

  if (statusBruto !== undefined && status === undefined) {
    return c.json({ code: 'CAMPO_OBRIGATORIO', message: `Status inválido: ${statusBruto}.` }, 400);
  }

  const limiteBruto = Number(c.req.query('limite') ?? 50);
  const limite = Number.isFinite(limiteBruto) ? Math.min(Math.max(limiteBruto, 1), 100) : 50;

  const r = await deps.campanhas.listar(usuario.tenantId, {
    ...(status === undefined ? {} : { status }),
    limite,
    ...(c.req.query('cursor') === undefined ? {} : { cursor: c.req.query('cursor') }),
  });

  return c.json({
    itens: r.itens.map((k) => paraResposta(k, deps)),
    cursor: r.cursor,
    truncado: r.truncado,
    ...(r.truncado
      ? {
          aviso:
            'Há mais campanhas do que cabe nesta visão. Filtre por situação para percorrer a lista completa.',
        }
      : {}),
  });
});

rotasCampanhas.get('/:id', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  return c.json(paraResposta(campanha, deps));
});

/** RASCUNHO → EM_REVISAO. Qualquer operador pode submeter. */
rotasCampanhas.post('/:id/revisao', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  return aplicar(deps, c, campanha, enviarParaRevisao(campanha), 'EDITOU');
});

/**
 * EM_REVISAO → APROVADA — a exigência de §10.3.
 *
 * Só ADMIN aprova, e o domínio ainda recusa se o aprovador for o autor. São duas
 * barreiras diferentes de propósito: o papel diz *quem pode revisar*; a regra de
 * segregação diz que ninguém revisa a si mesmo. Um ADMIN que cria a própria
 * campanha continua precisando de um segundo par de olhos.
 *
 * O `hashConteudoRevisado` vem do cliente e é comparado com o conteúdo atual: se
 * alguém editou o template entre a tela de revisão e o clique em aprovar, a
 * aprovação vale para outra coisa e precisa ser refeita.
 */
rotasCampanhas.post(
  '/:id/aprovacao',
  exigirPapel('ADMIN'),
  validarCorpo(aprovarCampanhaSchema),
  async (c) => {
    const dados = c.req.valid('json');
    const deps = await obterDependencias();
    const campanha = await carregar(deps, c);
    if (campanha === null) return naoEncontrada(c);

    const hashAtual = deps.hasherConteudo.hash(conteudoAprovavel(campanha));
    if (hashAtual !== dados.hashConteudoRevisado) {
      return c.json(
        {
          code: 'CONTEUDO_ALTERADO_APOS_APROVACAO',
          message:
            'O conteúdo mudou desde que a tela de revisão foi aberta. Revise novamente antes de aprovar.',
          correlationId: c.get('correlationId'),
        },
        409,
      );
    }

    const usuario = c.get('usuario');
    const resultado = aprovar(campanha, usuario.userId, hashAtual, deps.clock.agora());
    return aplicar(deps, c, campanha, resultado, 'APROVOU');
  },
);

/**
 * Agenda o disparo — ADR-05.
 *
 * A ordem importa: valida a transição no domínio **antes** de criar o
 * agendamento na AWS. Invertido, uma campanha em estado inválido deixaria um
 * agendamento órfão que dispararia sozinho depois.
 */
rotasCampanhas.post('/:id/agendamento', validarCorpo(agendarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  const resultado = agendar(campanha, dados.agendadaPara, deps.clock.agora());
  if (!resultado.ok) return erroDominio(c, resultado.error);

  await deps.agendador.agendar(campanha.tenantId, campanha.campaignId, dados.agendadaPara);

  return aplicar(deps, c, campanha, resultado, 'EDITOU');
});

/**
 * Dispara agora, sem agendar.
 *
 * A campanha precisa estar APROVADA — a verificação está no domínio e é
 * repetida pelo `campaign-launcher`. Duas barreiras de propósito: esta rota não
 * é o único caminho para o orquestrador, e um disparo sem o aval do advogado
 * responsável seria descumprimento da exigência de §10.3.
 */
rotasCampanhas.post('/:id/disparo', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  if (campanha.status !== 'APROVADA' && campanha.status !== 'AGENDADA') {
    return erroDominio(
      c,
      domainError(
        'TRANSICAO_INVALIDA',
        `Só campanha APROVADA ou AGENDADA pode ser disparada. Status atual: ${campanha.status}.`,
      ),
    );
  }

  const execucao = await deps.agendador.dispararAgora(
    campanha.tenantId,
    campanha.campaignId,
    deps.clock.agora(),
  );

  await registrar(deps, c, 'ENVIOU', campanha, { status: campanha.status }, { execucao });

  return c.json({
    campaignId: campanha.campaignId,
    execucao,
    aviso:
      'Disparo iniciado. O envio respeita a cota do SES, então campanhas grandes levam horas para concluir.',
  });
});

/**
 * Pausa — ADR-05.
 *
 * A resposta diz explicitamente que mensagens já em voo ainda saem. O `sender`
 * consulta o status uma vez por lote; o punhado de e-mails já entregue ao SES
 * não volta atrás. Esconder isso faria o operador achar que a pausa é
 * instantânea e reportar como bug o que é limite físico.
 */
rotasCampanhas.post('/:id/pausa', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  const resultado = pausar(campanha);
  if (!resultado.ok) return erroDominio(c, resultado.error);

  await deps.campanhas.salvar(resultado.value);
  await registrar(deps, c, 'PAUSOU', campanha, { status: campanha.status }, { status: 'PAUSADA' });

  return c.json({
    ...paraResposta(resultado.value, deps),
    aviso:
      'A pausa vale para os próximos envios. Mensagens já entregues ao servidor de e-mail ainda serão enviadas.',
  });
});

rotasCampanhas.post('/:id/retomada', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  return aplicar(deps, c, campanha, retomar(campanha), 'EDITOU');
});

rotasCampanhas.post('/:id/cancelamento', exigirPapel('ADMIN'), async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  const resultado = cancelar(campanha);
  if (!resultado.ok) return erroDominio(c, resultado.error);

  // Remove o agendamento junto. Sem isto, uma campanha cancelada continuaria
  // com o gatilho armado e o orquestrador seria iniciado no horário marcado —
  // ele encerraria sozinho ao ver o status, mas a execução falsa apareceria no
  // histórico e confundiria quem investigasse.
  await deps.agendador.cancelarAgendamento(campanha.tenantId, campanha.campaignId);

  return aplicar(deps, c, campanha, resultado, 'CANCELOU');
});

// ── Auxiliares ───────────────────────────────────────────────────────────────

/**
 * Contexto compartilhado pelos auxiliares. Declarado explicitamente em vez de
 * derivado das assinaturas de rota: a derivação por `Parameters<...>` colapsa
 * para `never` quando há sobrecargas, e o erro resultante não diz isso.
 */
type Ctx = Context<{ Variables: Variaveis }>;

async function carregar(deps: Dependencias, c: Ctx): Promise<Campaign | null> {
  const usuario = c.get('usuario');
  return deps.campanhas.buscarPorId(usuario.tenantId, novoCampaignId(c.req.param('id') ?? ''));
}

const naoEncontrada = (c: Ctx) =>
  c.json({ code: 'NAO_ENCONTRADO', message: 'Campanha inexistente.' }, 404);

const erroDominio = (c: Ctx, erro: DomainError) =>
  c.json(corpoDeErro(erro, c.get('correlationId')), statusDeErro(erro));

/** Persiste a transição e registra auditoria — o par que nunca deve se separar. */
async function aplicar(
  deps: Dependencias,
  c: Ctx,
  antes: Campaign,
  resultado: Result<Campaign, DomainError>,
  acao: 'CRIOU' | 'EDITOU' | 'APROVOU' | 'PAUSOU' | 'CANCELOU',
) {
  if (!resultado.ok) return erroDominio(c, resultado.error);

  await deps.campanhas.salvar(resultado.value);
  await registrar(
    deps,
    c,
    acao,
    resultado.value,
    { status: antes.status },
    {
      status: resultado.value.status,
    },
  );

  return c.json(paraResposta(resultado.value, deps));
}

async function registrar(
  deps: Dependencias,
  c: Ctx,
  acao: 'CRIOU' | 'EDITOU' | 'APROVOU' | 'PAUSOU' | 'CANCELOU' | 'ENVIOU' | 'EXCLUIU',
  campanha: Campaign,
  antes: unknown,
  depois: unknown,
): Promise<void> {
  const usuario = c.get('usuario');
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao,
    recursoTipo: 'Campaign',
    recursoId: campanha.campaignId,
    antes,
    depois,
    ocorridoEm: deps.clock.agora(),
  });
}

/**
 * O que, se mudar, invalida uma aprovação — §5.8.
 *
 * Mantido explícito em vez de hashear a campanha inteira: campos como
 * `atualizadoEm` mudam a toda gravação e invalidariam aprovações sem que nada
 * relevante tivesse mudado.
 *
 * O corpo do template ainda não entra aqui porque o repositório de templates
 * chega na próxima etapa; quando entrar, é só somar `assunto` e `corpoHtml`.
 */
function conteudoAprovavel(campanha: Campaign): Partial<ConteudoAprovavel> {
  return {
    templateId: campanha.templateId,
    templateVersao: campanha.templateVersao,
    listId: campanha.listId,
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
  };
}

function paraResposta(campanha: Campaign, deps: Dependencias): Record<string, unknown> {
  return {
    campaignId: campanha.campaignId,
    nome: campanha.nome,
    status: campanha.status,
    templateId: campanha.templateId,
    templateVersao: campanha.templateVersao,
    listId: campanha.listId,
    agendadaPara: campanha.agendadaPara?.toISOString(),
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
    criadoPor: campanha.criadoPor,
    criadoEm: campanha.criadoEm.toISOString(),
    aprovacao:
      campanha.aprovacao === undefined
        ? null
        : {
            aprovadoPor: campanha.aprovacao.aprovadoPor,
            aprovadoEm: campanha.aprovacao.aprovadoEm.toISOString(),
          },
    /**
     * A interface devolve este valor ao aprovar. É como o backend detecta que o
     * conteúdo mudou entre a tela de revisão e o clique — sem ele, "aprovado"
     * seria um carimbo sem valor probatório (§5.8, §10.3).
     */
    hashConteudoAtual: deps.hasherConteudo.hash(conteudoAprovavel(campanha)),
  };
}
