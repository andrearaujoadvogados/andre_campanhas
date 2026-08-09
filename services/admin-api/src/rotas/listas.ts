import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { criarContatoSchema } from '@emailmkt/contracts';
import {
  EmailAddress,
  contactId as novoContactId,
  listId as novoListId,
  resolverAudiencia,
  todos,
  verificarElegibilidade,
  type Contact,
  type Lista,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

export const rotasListas = new Hono<{ Variables: Variaveis }>();

const criarListaSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(1000).optional(),
});

const adicionarContatosSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(500),
});

rotasListas.get('/', async (c) => {
  const { listas } = await obterDependencias();
  const usuario = c.get('usuario');

  const pagina = await listas.listar(usuario.tenantId, c.req.query('cursor'));
  return c.json({ itens: pagina.itens.map(paraResposta), cursor: pagina.cursor });
});

rotasListas.get('/:id', async (c) => {
  const { listas } = await obterDependencias();
  const usuario = c.get('usuario');

  const lista = await listas.buscarPorId(usuario.tenantId, novoListId(c.req.param('id')));
  return lista === null ? naoEncontrada(c) : c.json(paraResposta(lista));
});

rotasListas.post('/', validarCorpo(criarListaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const lista: Lista = {
    tenantId: usuario.tenantId,
    listId: novoListId(deps.ids.gerar()),
    nome: dados.nome,
    ...(dados.descricao === undefined ? {} : { descricao: dados.descricao }),
    tipo: 'ESTATICA',
    totalContatos: 0,
    criadoPor: usuario.userId,
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await deps.listas.salvar(lista);
  await auditar(deps, c, 'CRIOU', lista.listId, undefined, { nome: lista.nome });

  return c.json(paraResposta(lista), 201);
});

rotasListas.get('/:id/contatos', async (c) => {
  const { contatos, clock } = await obterDependencias();
  const usuario = c.get('usuario');

  const pagina = await contatos.listarPorLista(
    usuario.tenantId,
    novoListId(c.req.param('id')),
    c.req.query('cursor'),
  );
  const agora = clock.agora();

  return c.json({
    itens: pagina.itens.map((contato) => ({
      contactId: contato.contactId,
      email: contato.email.value,
      nome: contato.nome,
      status: contato.status,
      relacionamento: contato.relacionamento,
      atualizadoEm: contato.atualizadoEm.toISOString(),
      ...elegibilidadeDe(contato, agora),
    })),
    cursor: pagina.cursor,
  });
});

/**
 * Cria um contato já dentro da lista — §11, item 1.
 *
 * Registrada **antes** de qualquer rota que trate o segmento seguinte a
 * `/contatos` como parâmetro (hoje `DELETE /:id/contatos/:contactId`). Sem essa
 * ordem, o dia em que existir um `POST /:id/contatos/:contactId` o `novo` seria
 * capturado como id de contato e esta rota nunca rodaria.
 *
 * E-mail já cadastrado **não** é erro aqui, ao contrário do `POST /contatos`.
 * Quem digita um endereço conhecido na tela de uma lista quer aquela pessoa na
 * lista; devolver 409 obrigaria a sair, procurar o contato e voltar — trabalho
 * manual para um pedido que já está claro.
 *
 * O contato existente é reaproveitado **como está**: vínculo e base legal
 * continuam os que já eram. O que veio no formulário é ignorado, e a resposta
 * diz isso em voz alta. Sobrescrever em silêncio o vínculo a partir da tela de
 * uma lista mudaria a base legal de uma pessoa sem que ninguém percebesse — e é
 * o vínculo que sustenta o legítimo interesse (§6.2).
 */
rotasListas.post('/:id/contatos/novo', validarCorpo(criarContatoSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const listId = novoListId(c.req.param('id'));
  const agora = deps.clock.agora();

  const lista = await deps.listas.buscarPorId(usuario.tenantId, listId);
  if (lista === null) return naoEncontrada(c);

  const email = EmailAddress.create(dados.email);
  if (!email.ok) return c.json({ code: email.error.code, message: email.error.message }, 400);

  const existente = await deps.contatos.buscarPorEmail(usuario.tenantId, email.value);
  const criado = existente === null;

  let contato: Contact;
  if (existente === null) {
    contato = {
      tenantId: usuario.tenantId,
      contactId: novoContactId(deps.ids.gerar()),
      email: email.value,
      ...(dados.nome === undefined ? {} : { nome: dados.nome }),
      camposCustomizados: dados.camposCustomizados,
      status: 'ATIVO',
      relacionamento: dados.relacionamento,
      ...(dados.relacionamentoDesde === undefined
        ? {}
        : { relacionamentoDesde: dados.relacionamentoDesde }),
      criadoEm: agora,
      atualizadoEm: agora,
      origem: 'manual',
    };
    await deps.contatos.salvar(contato);
    await auditar(
      deps,
      c,
      'CRIOU',
      contato.contactId,
      undefined,
      { email: contato.email.mascarado, relacionamento: contato.relacionamento },
      'Contact',
    );
  } else {
    contato = existente;
  }

  await deps.listas.adicionarContatos(usuario.tenantId, listId, [contato.contactId]);
  await auditar(deps, c, 'EDITOU', listId, undefined, {
    adicionados: 1,
    contactId: contato.contactId,
    contatoCriado: criado,
    // Fica registrado que o vínculo pedido foi descartado, e qual prevaleceu.
    ...(criado
      ? {}
      : {
          relacionamentoPedido: dados.relacionamento,
          relacionamentoMantido: contato.relacionamento,
        }),
  });

  return c.json(
    {
      contactId: contato.contactId,
      email: contato.email.value,
      criado,
      // O vínculo que de fato prevaleceu, não o que foi digitado. No
      // reaproveitamento os dois divergem, e sem este campo a única prova de
      // qual venceu é uma frase em português dentro do `aviso` — nem a
      // interface nem um teste conseguem verificar a regra a partir dela.
      relacionamento: contato.relacionamento,
      ...(criado
        ? {}
        : {
            aviso:
              'Já existia um contato com este e-mail. Ele foi reaproveitado e apenas acrescentado à lista: o vínculo e a base legal continuam os que ele já tinha, e o que você preencheu no formulário foi ignorado. Para mudar o vínculo, edite o contato — alterar a base legal de alguém é decisão consciente, não efeito colateral de adicionar à lista.',
          }),
    },
    201,
  );
});

rotasListas.post('/:id/contatos', validarCorpo(adicionarContatosSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const listId = novoListId(c.req.param('id'));

  const lista = await deps.listas.buscarPorId(usuario.tenantId, listId);
  if (lista === null) return naoEncontrada(c);

  const adicionados = await deps.listas.adicionarContatos(
    usuario.tenantId,
    listId,
    dados.contactIds.map(novoContactId),
  );
  await auditar(deps, c, 'EDITOU', listId, undefined, { adicionados });

  return c.json({ adicionados });
});

rotasListas.delete('/:id/contatos/:contactId', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const listId = novoListId(c.req.param('id'));

  await deps.listas.removerContato(
    usuario.tenantId,
    listId,
    novoContactId(c.req.param('contactId')),
  );
  await auditar(deps, c, 'EDITOU', listId, undefined, { removido: c.req.param('contactId') });

  return c.body(null, 204);
});

/**
 * Prévia da audiência — o número que o operador realmente precisa antes de
 * disparar.
 *
 * Sem isto, ele vê "5.000 contatos" na lista, dispara, e a campanha sai para
 * 1.200 sem explicação. O motivo mais provável na primeira importação é
 * `relacionamento: DESCONHECIDO` (§6.2), e descobrir isso **depois** do disparo
 * é tarde: a diferença já virou suspeita de bug.
 *
 * Usa exatamente o mesmo caso de uso do `campaign-launcher`. Reimplementar a
 * contagem aqui garantiria divergência entre a prévia e o disparo real.
 */
rotasListas.get('/:id/previa-audiencia', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const listId = novoListId(c.req.param('id'));

  const lista = await deps.listas.buscarPorId(usuario.tenantId, listId);
  if (lista === null) return naoEncontrada(c);

  const audiencia = await resolverAudiencia(
    {
      contatos: deps.contatos,
      supressao: deps.supressao,
      hasher: deps.hasher,
      clock: deps.clock,
    },
    { tenantId: usuario.tenantId, listId, segmento: todos<Contact>() },
  );

  return c.json({
    listId,
    nome: lista.nome,
    receberao: audiencia.elegiveis.length,
    naoReceberao: audiencia.excluidos.total,
    porMotivo: audiencia.excluidos.porMotivo,
    // A explicação em texto evita que a interface precise traduzir códigos.
    explicacoes: explicar(audiencia.excluidos.porMotivo),
  });
});

rotasListas.delete('/:id', exigirPapel('ADMIN'), async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const listId = novoListId(c.req.param('id'));

  const lista = await deps.listas.buscarPorId(usuario.tenantId, listId);
  if (lista === null) return naoEncontrada(c);

  await deps.listas.excluir(usuario.tenantId, listId);
  await auditar(deps, c, 'EXCLUIU', listId, { nome: lista.nome }, undefined);

  return c.json({
    aviso:
      'Lista removida. Os contatos continuam cadastrados — excluir uma lista nunca apaga contatos.',
  });
});

// ── Auxiliares ───────────────────────────────────────────────────────────────

type Ctx = Context<{ Variables: Variaveis }>;

const naoEncontrada = (c: Ctx) =>
  c.json({ code: 'NAO_ENCONTRADO', message: 'Lista inexistente.' }, 404);

const EXPLICACOES: Readonly<Record<string, string>> = {
  RELACIONAMENTO_DESCONHECIDO:
    'Contatos sem vínculo classificado. Sob legítimo interesse, não podem receber até serem classificados.',
  SEM_BASE_LEGAL: 'Contatos sem base legal registrada. Importe-os novamente declarando a origem.',
  VINCULO_EXPIRADO:
    'Vínculo antigo demais para sustentar o legítimo interesse. Revise ou recapte o consentimento.',
  SUPRIMIDO: 'Contatos que já pediram para sair ou tiveram bounce permanente. Não devem receber.',
  DUPLICADO_NA_LISTA: 'Mesmo e-mail repetido na lista — contado uma vez só.',
  FORA_DO_SEGMENTO: 'Contatos fora do critério do segmento.',
  STATUS_DESCADASTRADO: 'Contatos que se descadastraram.',
  STATUS_OPOSICAO: 'Contatos que se opuseram ao tratamento dos dados.',
  STATUS_BOUNCE: 'Contatos com bounce permanente — o endereço não existe.',
  STATUS_RECLAMACAO: 'Contatos que marcaram um e-mail como spam.',
  STATUS_SUPRIMIDO: 'Contatos suprimidos manualmente.',
};

function explicar(
  porMotivo: Readonly<Record<string, number>>,
): { motivo: string; quantidade: number; explicacao: string }[] {
  return Object.entries(porMotivo).map(([motivo, quantidade]) => ({
    motivo,
    quantidade,
    explicacao: EXPLICACOES[motivo] ?? 'Motivo não catalogado.',
  }));
}

/**
 * Usa a função do domínio, não uma cópia.
 *
 * Reimplementar a regra aqui garantiria que, mais cedo ou mais tarde, a lista
 * mostraria "elegível" para um contato que o disparo depois recusa — e ninguém
 * entenderia por quê.
 */
function elegibilidadeDe(contato: Contact, agora: Date): Record<string, unknown> {
  const r = verificarElegibilidade(contato, agora);
  return { elegivelParaCampanha: r.elegivel, motivosInelegibilidade: r.motivos };
}

async function auditar(
  deps: Awaited<ReturnType<typeof obterDependencias>>,
  c: Ctx,
  acao: 'CRIOU' | 'EDITOU' | 'EXCLUIU',
  recursoId: string,
  antes: unknown,
  depois: unknown,
  // Quase tudo aqui é sobre listas; criar contato pela tela da lista é a
  // exceção, e o registro precisa dizer o tipo certo do recurso.
  recursoTipo: 'List' | 'Contact' = 'List',
): Promise<void> {
  const usuario = c.get('usuario');
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao,
    recursoTipo,
    recursoId,
    antes,
    depois,
    ocorridoEm: deps.clock.agora(),
  });
}

function paraResposta(l: Lista): Record<string, unknown> {
  return {
    listId: l.listId,
    nome: l.nome,
    descricao: l.descricao,
    tipo: l.tipo,
    // Deixa explícito que é aproximado: a contagem exata sai da prévia de
    // audiência, que é a que decide quem recebe.
    totalContatosAproximado: l.totalContatos,
    criadoEm: l.criadoEm.toISOString(),
    atualizadoEm: l.atualizadoEm.toISOString(),
  };
}
