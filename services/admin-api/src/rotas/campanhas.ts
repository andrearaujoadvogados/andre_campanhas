import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  agendarCampanhaSchema,
  criarCampanhaSchema,
  editarCampanhaSchema,
  enviarTesteSchema,
  previaAudienciaSchema,
} from '@emailmkt/contracts';
import {
  agendar,
  cancelar,
  campaignId as novoCampaignId,
  EmailAddress,
  listId as novoListId,
  pausar,
  registrarDisparo,
  resolverAudiencia,
  retomar,
  templateId as novoTemplateId,
  tipoEmailId as novoTipoEmailId,
  todos,
  type Campaign,
  type Contact,
  type ConteudoCampanha,
  type FalhaEnvio,
  domainError,
  type DomainError,
  type Result,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias, type Dependencias } from '../container.js';
import { corpoDeErro, statusDeErro } from '../erros.js';
import { validarCorpo } from '../validacao.js';

/** Destino inócuo para o rodapé do e-mail de teste — não descadastra nada. */
const URL_DESCADASTRO_TESTE = 'https://campanhas.andrearaujoadvogados.com.br/teste-sem-efeito';

export const rotasCampanhas = new Hono<{ Variables: Variaveis }>();

const STATUS_VALIDOS: readonly Campaign['status'][] = [
  'RASCUNHO',
  'AGENDADA',
  'ENVIANDO',
  'PAUSADA',
  'CONCLUIDA',
  'CANCELADA',
  'FALHA',
];

/**
 * Versão vigente do modelo — o insumo de `templateVersao`.
 *
 * Existia um `templateVersao: 1` cravado aqui, e o efeito era grave: editar o
 * modelo cria a versão 2, 3…, mas a campanha continuava apontando para a 1.
 * O e-mail de teste mostrava o primeiro rascunho, e — pior — o `sender` lê o
 * mesmo campo, então o **disparo real** também sairia com a versão velha. Quem
 * montasse o e-mail, editasse e disparasse enviaria conteúdo que já havia
 * descartado, sem nenhum aviso.
 *
 * Cai para 1 quando o modelo não é encontrado: é o que a campanha tinha antes,
 * e recusar a criação por causa disso seria pior que seguir com o valor antigo.
 */
async function versaoVigente(
  deps: Dependencias,
  tenantId: Campaign['tenantId'],
  templateId: Campaign['templateId'],
): Promise<number> {
  const meta = await deps.templates.buscarMeta(tenantId, templateId);
  return meta?.versaoAtual ?? 1;
}

rotasCampanhas.post('/', validarCorpo(criarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const templateId = novoTemplateId(dados.templateId);

  const campanha: Campaign = {
    tenantId: usuario.tenantId,
    campaignId: novoCampaignId(deps.ids.gerar()),
    nome: dados.nome,
    ...(dados.tipoEmailId === undefined ? {} : { tipoEmailId: novoTipoEmailId(dados.tipoEmailId) }),
    templateId,
    // Acompanha o modelo enquanto é rascunho; congela no disparo (§6.2, nota 3),
    // que é onde `versaoVigente` é chamada de novo.
    templateVersao: await versaoVigente(deps, usuario.tenantId, templateId),
    listId: novoListId(dados.listId),
    status: 'RASCUNHO',
    remetenteNome: dados.remetenteNome,
    remetenteEmail: dados.remetenteEmail,
    ...(dados.replyTo === undefined ? {} : { replyTo: dados.replyTo }),
    ...(dados.assunto === undefined ? {} : { assunto: dados.assunto }),
    ...(dados.tagsFiltro.length === 0 ? {} : { tagsFiltro: dados.tagsFiltro }),
    ...(dados.incluirLeads ? { incluirLeads: true } : {}),
    ...(dados.destinatariosSelecionados === undefined
      ? {}
      : { destinatariosSelecionados: dados.destinatariosSelecionados }),
    criadoPor: usuario.userId,
    criadoEm: agora,
  };

  await deps.campanhas.salvar(campanha);
  await registrar(deps, c, 'CRIOU', campanha, undefined, { nome: campanha.nome });

  return c.json(paraResposta(campanha), 201);
});

/**
 * Duplicar — §7 do briefing.
 *
 * Cria um RASCUNHO novo a partir de uma campanha existente, copiando o conteúdo e
 * a segmentação (modelo, lista, remetente, assunto, filtro de tag). **Não** copia
 * o que é próprio de um disparo: agendamento, seleção individual e a auditoria do
 * envio nascem em branco — a cópia é um nova campanha, não um clone do que saiu.
 */
rotasCampanhas.post('/:id/duplicacao', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const original = await carregar(deps, c);
  if (original === null) return naoEncontrada(c);

  const agora = deps.clock.agora();
  const copia: Campaign = {
    tenantId: usuario.tenantId,
    campaignId: novoCampaignId(deps.ids.gerar()),
    nome: `${original.nome} (cópia)`,
    ...(original.tipoEmailId === undefined ? {} : { tipoEmailId: original.tipoEmailId }),
    templateId: original.templateId,
    templateVersao: original.templateVersao,
    listId: original.listId,
    status: 'RASCUNHO',
    remetenteNome: original.remetenteNome,
    remetenteEmail: original.remetenteEmail,
    ...(original.replyTo === undefined ? {} : { replyTo: original.replyTo }),
    ...(original.assunto === undefined ? {} : { assunto: original.assunto }),
    ...(original.tagsFiltro === undefined ? {} : { tagsFiltro: original.tagsFiltro }),
    ...(original.incluirLeads ? { incluirLeads: true } : {}),
    criadoPor: usuario.userId,
    criadoEm: agora,
  };

  await deps.campanhas.salvar(copia);
  await registrar(deps, c, 'CRIOU', copia, undefined, {
    nome: copia.nome,
    duplicadoDe: String(original.campaignId),
  });

  return c.json(paraResposta(copia), 201);
});

/**
 * Prévia de audiência — Etapa 3 do wizard (§8).
 *
 * Resolve a audiência da lista com os mesmos filtros do disparo (tag, leads),
 * usando o caso de uso do core, e devolve a contagem de elegíveis e a lista para
 * a seleção individual. Não cria nada: é só leitura para a tela mostrar "para
 * quantos vai" antes de disparar. Descadastrados e supressos já saem daqui.
 */
rotasCampanhas.post('/audiencia-previa', validarCorpo(previaAudienciaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const audiencia = await resolverAudiencia(
    { contatos: deps.contatos, supressao: deps.supressao, hasher: deps.hasher, clock: deps.clock },
    {
      tenantId: usuario.tenantId,
      listId: novoListId(dados.listId),
      segmento: todos<Contact>(),
      incluirLeads: dados.incluirLeads,
      tagsFiltro: dados.tagsFiltro,
    },
  );

  return c.json({
    total: audiencia.elegiveis.length,
    excluidos: audiencia.excluidos,
    destinatarios: audiencia.elegiveis.map((k) => ({
      contactId: k.contactId,
      nome: k.nome ?? null,
      email: k.email.value,
      empresa: k.empresa ?? null,
    })),
  });
});

/**
 * Edição — só enquanto a campanha não começou a sair.
 *
 * `ENVIANDO`, `PAUSADA`, `CONCLUIDA`, `CANCELADA` e `FALHA` ficam de fora: a
 * partir do disparo, cada mensagem entregue é um fato registrado, e mudar a
 * campanha depois faria o relatório descrever algo que não foi o que saiu.
 *
 * Sem revogação de aprovação: o portão foi removido. Uma campanha AGENDADA pode
 * ser editada e continua agendada — o launcher lê o conteúdo mais recente no
 * horário marcado.
 */
const EDITAVEIS = new Set<Campaign['status']>(['RASCUNHO', 'AGENDADA']);

rotasCampanhas.patch('/:id', validarCorpo(editarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
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

  const templateEditado =
    dados.templateId === undefined ? campanha.templateId : novoTemplateId(dados.templateId);

  const editada: Campaign = {
    ...campanha,
    ...(dados.nome === undefined ? {} : { nome: dados.nome }),
    ...(dados.tipoEmailId === undefined ? {} : { tipoEmailId: novoTipoEmailId(dados.tipoEmailId) }),
    templateId: templateEditado,
    /**
     * O rascunho acompanha o modelo.
     *
     * Toda gravação reamarra a versão vigente. Sem isto, editar o conteúdo no
     * assistente (que gera uma versão nova do modelo) deixava a campanha presa
     * na versão anterior — e o teste, e o disparo, sairiam com o conteúdo velho.
     * Congelar de vez só faz sentido no disparo, não aqui.
     */
    templateVersao: await versaoVigente(deps, campanha.tenantId, templateEditado),
    ...(dados.listId === undefined ? {} : { listId: novoListId(dados.listId) }),
    ...(dados.remetenteNome === undefined ? {} : { remetenteNome: dados.remetenteNome }),
    ...(dados.remetenteEmail === undefined ? {} : { remetenteEmail: dados.remetenteEmail }),
    ...(dados.replyTo === undefined ? {} : { replyTo: dados.replyTo }),
    ...(dados.assunto === undefined ? {} : { assunto: dados.assunto }),
    ...(dados.tagsFiltro === undefined ? {} : { tagsFiltro: dados.tagsFiltro }),
    ...(dados.incluirLeads === undefined ? {} : { incluirLeads: dados.incluirLeads }),
    ...(dados.destinatariosSelecionados === undefined
      ? {}
      : { destinatariosSelecionados: dados.destinatariosSelecionados }),
  };

  /**
   * Editou uma campanha agendada: o fingerprint tem de acompanhar.
   *
   * `hashConteudoEnviado` é gravado quando o operador agenda, e o launcher só
   * dispara horas ou dias depois, lendo o conteúdo mais recente. Sem recalcular
   * aqui, o hash descreveria o conteúdo do agendamento e não o que de fato saiu
   * — e um fingerprint que aponta para outra coisa é pior que nenhum: dá a um
   * registro errado a aparência de prova. Para um escritório de advocacia, é
   * justamente esse rastro que precisa se sustentar.
   *
   * Só recalcula quando já existe: campanha que nunca foi agendada nem disparada
   * não tem o que carimbar, e o hash nasce no disparo.
   */
  const comHash: Campaign =
    editada.hashConteudoEnviado === undefined
      ? editada
      : { ...editada, hashConteudoEnviado: deps.hasherConteudo.hash(conteudoParaHash(editada)) };

  await deps.campanhas.salvar(comHash);
  await registrar(deps, c, 'EDITOU', comHash, { nome: campanha.nome }, { nome: comHash.nome });

  return c.json(paraResposta(comHash));
});

/**
 * Exclusão — qualquer campanha que não tenha enviado nada. Só ADMIN.
 *
 * A trava é o envio, não o status: rascunho, cancelado e falho somem; o que
 * chegou a mandar mensagem fica. Ver o porquê no corpo da rota.
 */
rotasCampanhas.delete('/:id', async (c) => {
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  // Enviando é o único estado em que apagar é incoerente por si só: há mensagens
  // saindo agora, e o launcher continuaria trabalhando sobre uma campanha que
  // deixou de existir. Cancele primeiro; depois, se não houve envio, some.
  if (campanha.status === 'ENVIANDO') {
    return c.json(
      {
        code: 'CAMPANHA_NAO_EXCLUIVEL',
        message:
          'A campanha está enviando agora. Cancele primeiro — a exclusão fica disponível depois.',
      },
      409,
    );
  }

  /**
   * O que impede a exclusão é o envio, não o status.
   *
   * Antes só RASCUNHO podia ser excluído, e o efeito prático era ninguém
   * conseguir limpar a lista: uma campanha cancelado ou que falhou ficava para
   * sempre na tela, sem ter enviado nada a ninguém.
   *
   * O motivo real da restrição sempre foi outro — registros de envio apontam
   * para a campanha, e apagá-la deixaria auditoria e relatório sem referente,
   * além de tirar do titular a resposta a "o que vocês me mandaram?", que a LGPD
   * assegura. Então é isso que se verifica: existe envio registrado? Se não,
   * apagar não apaga prova nenhuma.
   */
  const envios = await deps.envios.contarPorCampanha(campanha.tenantId, campanha.campaignId);
  if (envios > 0) {
    return c.json(
      {
        code: 'CAMPANHA_NAO_EXCLUIVEL',
        message:
          `Esta campanha já enviou ${envios} mensagem(ns) e não pode ser excluído: os registros de ` +
          'envio e o relatório apontam para ele, e o destinatário tem direito de saber o que recebeu.',
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
 * partições e pode cortar; nesse caso a resposta traz `truncado: true` e um
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
    itens: r.itens.map((k) => paraResposta(k)),
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

  /**
   * Progresso ao vivo — quantos já têm registro de envio.
   *
   * Só conta para status que já dispararam: em rascunho não há o que contar, e
   * a consulta seria uma leitura à toa a cada abertura da tela. É o número que
   * transforma "ENVIANDO" de caixa-preta em "3 de 5".
   */
  const jaDisparou =
    campanha.status === 'ENVIANDO' ||
    campanha.status === 'PAUSADA' ||
    campanha.status === 'CONCLUIDA';

  const processados = jaDisparou
    ? await deps.envios.contarPorCampanha(campanha.tenantId, campanha.campaignId)
    : undefined;

  return c.json({
    ...paraResposta(campanha),
    ...(processados === undefined ? {} : { processados }),
  });
});

/**
 * Agenda o disparo — ADR-05.
 *
 * A ordem importa: valida a transição no domínio **antes** de criar o
 * agendamento na AWS. Invertido, uma campanha em estado inválido deixaria um
 * agendamento órfão que dispararia sozinho depois.
 *
 * Registra `enviadaPor` e o fingerprint do conteúdo: para uma campanha agendada,
 * quem agendou é quem responde pelo disparo (auditoria).
 */
rotasCampanhas.post('/:id/agendamento', validarCorpo(agendarCampanhaSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  const resultado = agendar(campanha, dados.agendadaPara, deps.clock.agora());
  if (!resultado.ok) return erroDominio(c, resultado.error);

  // Congela aqui a versão vigente do modelo (§6.2, nota 3): o que o teste
  // mostrou é o que fica marcado para sair no horário.
  const congelada: Campaign = {
    ...resultado.value,
    templateVersao: await versaoVigente(deps, campanha.tenantId, campanha.templateId),
  };
  const hash = deps.hasherConteudo.hash(conteudoParaHash(congelada));
  const agendada = registrarDisparo(congelada, usuario.userId, hash);

  await deps.agendador.agendar(campanha.tenantId, campanha.campaignId, dados.agendadaPara);
  await deps.campanhas.salvar(agendada);
  await registrar(
    deps,
    c,
    'EDITOU',
    agendada,
    { status: campanha.status },
    { status: agendada.status },
  );

  return c.json(paraResposta(agendada));
});

/**
 * Envio de teste — pré-visualização real na caixa de entrada do operador.
 *
 * Renderiza o modelo da campanha e manda para os endereços informados, com o
 * assunto marcado como teste. **Não** cria registro de envio, não passa por
 * supressão nem por elegibilidade, e não muda o status da campanha: é uma cópia
 * para conferência, não parte da audiência.
 *
 * A personalização usa um contato de exemplo, para o operador ver como
 * `{{contato.primeiroNome}}` fica no lugar em vez de um campo cru. O link de
 * descadastro aponta para um destino inócuo — o teste não deve permitir alguém
 * se descadastrar de uma campanha que ainda não existe.
 *
 * Disponível em qualquer status: o ponto do teste é ver antes de disparar. É a
 * Etapa 4 do assistente — resumo e teste, sem aprovação.
 */
rotasCampanhas.post('/:id/teste', validarCorpo(enviarTesteSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  /**
   * O teste renderiza o que sairia **agora**, não o que estava salvo.
   *
   * É o ponto do teste: avaliar conteúdo e estética do e-mail que vai ser
   * disparado. Usar a versão gravada na campanha faria o operador conferir um
   * rascunho anterior — montar o e-mail, ajustar e mandar o teste devolveria a
   * versão de antes do ajuste, e ele aprovaria algo diferente do que sai. Como
   * o disparo também congela a versão vigente no momento em que acontece, o que
   * o teste mostra é exatamente o que seria enviado.
   */
  const versao = await versaoVigente(deps, campanha.tenantId, campanha.templateId);
  const conteudo = await deps.templates.buscarVersao(
    campanha.tenantId,
    campanha.templateId,
    versao,
  );
  if (conteudo === null) {
    return c.json(
      { code: 'MODELO_AUSENTE', message: 'O modelo desta campanha não foi encontrado.' },
      409,
    );
  }

  const falhas: { email: string; motivo: string }[] = [];

  for (const email of dados.destinatarios) {
    const endereco = EmailAddress.create(email);
    if (!endereco.ok) {
      falhas.push({ email, motivo: endereco.error.message });
      continue;
    }

    /**
     * A supressão vale também para o teste.
     *
     * O teste pula audiência e elegibilidade de propósito — é uma cópia para
     * conferência, não parte do disparo. A supressão é outra coisa: quem se
     * descadastrou ou reclamou pediu para não receber mais nada deste remetente,
     * e "era só um teste" não é uma exceção que a pessoa concordou em abrir. É
     * também o registro que a ANPD leria como descumprimento.
     *
     * Três endereços digitados à mão erram com facilidade — basta colar o
     * endereço de um cliente para conferir como ficou.
     */
    if (await deps.supressao.estaSuprimido(campanha.tenantId, deps.hasher.hash(endereco.value))) {
      falhas.push({
        email,
        motivo: 'Endereço na lista de supressão (descadastro, bounce ou reclamação).',
      });
      continue;
    }

    const renderizado = await deps.renderer.renderizar(
      { assunto: `[TESTE] ${campanha.assunto ?? conteudo.assunto}`, corpoHtml: conteudo.corpoHtml },
      {
        // Contato de exemplo: mostra a personalização preenchida, sem tocar em
        // dado real de ninguém.
        contato: { nome: 'Maria Exemplo', email, camposCustomizados: {} },
        // Inócua de propósito: um teste não descadastra ninguém de verdade.
        urlDescadastro: URL_DESCADASTRO_TESTE,
      },
    );

    const resultado = await deps.provedorEmail.enviar({
      para: endereco.value,
      deNome: campanha.remetenteNome,
      deEmail: campanha.remetenteEmail,
      ...(campanha.replyTo === undefined ? {} : { replyTo: campanha.replyTo }),
      assunto: renderizado.assunto,
      corpoHtml: renderizado.corpoHtml,
      corpoTexto: renderizado.corpoTexto,
      listUnsubscribeUrl: URL_DESCADASTRO_TESTE,
      // Sem Configuration Set: o teste não deve poluir as métricas da campanha
      // com aberturas e cliques de quem só estava conferindo.
      configurationSet: '',
      tags: { tipo: 'teste' },
    });

    if (!resultado.ok) {
      falhas.push({ email, motivo: motivoFalhaEnvio(resultado.error) });
    }
  }

  await registrar(deps, c, 'ENVIOU', campanha, undefined, {
    teste: true,
    destinatarios: dados.destinatarios.length,
    falhas: falhas.length,
  });

  const enviados = dados.destinatarios.length - falhas.length;
  return c.json({
    enviados,
    falhas,
    aviso:
      enviados > 0
        ? `${enviados} e-mail(s) de teste enviado(s). Confira a caixa de entrada — o assunto começa com [TESTE].`
        : 'Nenhum e-mail de teste foi enviado. Veja os motivos abaixo.',
  });
});

/**
 * Dispara agora, sem agendar.
 *
 * Aceita RASCUNHO (disparo imediato de quem acabou de montar) e AGENDADA (soltar
 * antes do horário). Sem etapa de aprovação: quem monta é quem dispara. Grava
 * `enviadaPor` e o fingerprint do conteúdo antes de acionar o orquestrador — é a
 * auditoria do que saiu e por ordem de quem.
 */
rotasCampanhas.post('/:id/disparo', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const campanha = await carregar(deps, c);
  if (campanha === null) return naoEncontrada(c);

  if (campanha.status !== 'RASCUNHO' && campanha.status !== 'AGENDADA') {
    return erroDominio(
      c,
      domainError(
        'TRANSICAO_INVALIDA',
        `Só campanha RASCUNHO ou AGENDADA pode ser disparada. Status atual: ${campanha.status}.`,
      ),
    );
  }

  // Congela a versão vigente no instante do disparo (§6.2, nota 3) — é o que
  // faz o e-mail enviado ser o mesmo que o teste mostrou.
  const congelada: Campaign = {
    ...campanha,
    templateVersao: await versaoVigente(deps, campanha.tenantId, campanha.templateId),
  };
  const hash = deps.hasherConteudo.hash(conteudoParaHash(congelada));
  const marcada = registrarDisparo(congelada, usuario.userId, hash);
  await deps.campanhas.salvar(marcada);

  const execucao = await deps.agendador.dispararAgora(
    campanha.tenantId,
    campanha.campaignId,
    deps.clock.agora(),
  );

  await registrar(deps, c, 'ENVIOU', marcada, { status: campanha.status }, { execucao });

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
 * não volta atrás.
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
    ...paraResposta(resultado.value),
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

/** Mensagem legível a partir da falha de envio do provedor (§5.5). */
function motivoFalhaEnvio(falha: FalhaEnvio): string {
  return falha.tipo === 'THROTTLED'
    ? 'Envio limitado pela cota do provedor; tente novamente em instantes.'
    : falha.detalhe;
}

type AcaoAuditoria = 'CRIOU' | 'EDITOU' | 'PAUSOU' | 'CANCELOU' | 'ENVIOU' | 'EXCLUIU';

/** Persiste a transição e registra auditoria — o par que nunca deve se separar. */
async function aplicar(
  deps: Dependencias,
  c: Ctx,
  antes: Campaign,
  resultado: Result<Campaign, DomainError>,
  acao: AcaoAuditoria,
) {
  if (!resultado.ok) return erroDominio(c, resultado.error);

  await deps.campanhas.salvar(resultado.value);
  await registrar(
    deps,
    c,
    acao,
    resultado.value,
    { status: antes.status },
    { status: resultado.value.status },
  );

  return c.json(paraResposta(resultado.value));
}

async function registrar(
  deps: Dependencias,
  c: Ctx,
  acao: AcaoAuditoria,
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
 * O que compõe o fingerprint de conteúdo gravado como auditoria do disparo.
 *
 * Mantido explícito em vez de hashear a campanha inteira: campos como
 * `atualizadoEm` mudam a toda gravação e mudariam o fingerprint sem que nada
 * relevante tivesse mudado.
 *
 * O corpo do template ainda não entra aqui porque a junção com o repositório de
 * templates chega numa etapa seguinte; quando entrar, é só somar `assunto` e
 * `corpoHtml`.
 */
function conteudoParaHash(campanha: Campaign): Partial<ConteudoCampanha> {
  return {
    templateId: campanha.templateId,
    templateVersao: campanha.templateVersao,
    listId: campanha.listId,
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
  };
}

function paraResposta(campanha: Campaign): Record<string, unknown> {
  return {
    campaignId: campanha.campaignId,
    nome: campanha.nome,
    tipoEmailId: campanha.tipoEmailId ?? null,
    status: campanha.status,
    templateId: campanha.templateId,
    templateVersao: campanha.templateVersao,
    listId: campanha.listId,
    agendadaPara: campanha.agendadaPara?.toISOString(),
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
    assunto: campanha.assunto ?? null,
    tagsFiltro: campanha.tagsFiltro ?? [],
    incluirLeads: campanha.incluirLeads === true,
    destinatariosSelecionados: campanha.destinatariosSelecionados ?? null,
    criadoPor: campanha.criadoPor,
    criadoEm: campanha.criadoEm.toISOString(),
    totalDestinatarios: campanha.totalDestinatarios,
    // Auditoria do disparo: quem disparou/agendou, quando saiu e o fingerprint
    // do conteúdo enviado. Substitui a antiga `aprovacao`.
    enviadaPor: campanha.enviadaPor ?? null,
    disparadaEm: campanha.disparadaEm?.toISOString() ?? null,
    hashConteudoEnviado: campanha.hashConteudoEnviado ?? null,
  };
}
