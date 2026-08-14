import { Hono } from 'hono';
import { salvarFonteBoletimSchema } from '@emailmkt/contracts';
import {
  LIMITE_SEM_SINAL_MS,
  encerrarExecucao,
  estaEmAndamento,
  execucaoBoletimId as novoExecucaoId,
  fonteId as novoFonteId,
  iniciarExecucao,
  situacaoVisivel,
  validarUrlDeFonte,
  type ExecucaoBoletim,
  type FonteBoletim,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

/**
 * Fontes do boletim automatizado — §11, item 12.
 *
 * O operador cadastra os sites acompanhados e, para cada um, a instrução do
 * que coletar. A coleta em si roda no worker `boletim-builder` (agendado e sob
 * demanda); estas rotas só administram a configuração e disparam a geração.
 */
export const rotasBoletim = new Hono<{ Variables: Variaveis }>();

rotasBoletim.get('/fontes', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const fontes = await deps.fontesBoletim.listar(usuario.tenantId);
  return c.json({ itens: fontes.map(paraResposta) });
});

rotasBoletim.post('/fontes', validarCorpo(salvarFonteBoletimSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  // A guarda de SSRF é do domínio e roda aqui, na entrada — não só no worker.
  // Recusar no cadastro dá o erro a quem digitou, com contexto para corrigir.
  const url = validarUrlDeFonte(dados.url);
  if (!url.ok) return c.json({ code: 'URL_INVALIDA', message: url.motivo }, 400);

  const agora = deps.clock.agora();
  const fonte: FonteBoletim = {
    tenantId: usuario.tenantId,
    fonteId: novoFonteId(deps.ids.gerar()),
    nome: dados.nome,
    url: dados.url,
    instrucao: dados.instrucao,
    ativa: dados.ativa,
    criadoPor: usuario.userId,
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await deps.fontesBoletim.salvar(fonte);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'CRIOU',
    recursoTipo: 'FonteBoletim',
    recursoId: fonte.fonteId,
    depois: { nome: fonte.nome, url: fonte.url },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(fonte), 201);
});

rotasBoletim.patch('/fontes/:id', validarCorpo(salvarFonteBoletimSchema), async (c) => {
  const dados = c.req.valid('json');
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const fonte = await deps.fontesBoletim.buscarPorId(
    usuario.tenantId,
    novoFonteId(c.req.param('id')),
  );
  if (fonte === null) return c.json({ code: 'NAO_ENCONTRADO', message: 'Fonte inexistente.' }, 404);

  const url = validarUrlDeFonte(dados.url);
  if (!url.ok) return c.json({ code: 'URL_INVALIDA', message: url.motivo }, 400);

  const atualizada: FonteBoletim = {
    ...fonte,
    nome: dados.nome,
    url: dados.url,
    instrucao: dados.instrucao,
    ativa: dados.ativa,
    atualizadoEm: deps.clock.agora(),
  };
  await deps.fontesBoletim.salvar(atualizada);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'FonteBoletim',
    recursoId: atualizada.fonteId,
    antes: { nome: fonte.nome, url: fonte.url, ativa: fonte.ativa },
    depois: { nome: atualizada.nome, url: atualizada.url, ativa: atualizada.ativa },
    ocorridoEm: atualizada.atualizadoEm,
  });

  return c.json(paraResposta(atualizada));
});

rotasBoletim.delete('/fontes/:id', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const id = novoFonteId(c.req.param('id'));

  const fonte = await deps.fontesBoletim.buscarPorId(usuario.tenantId, id);
  if (fonte === null) return c.json({ code: 'NAO_ENCONTRADO', message: 'Fonte inexistente.' }, 404);

  await deps.fontesBoletim.excluir(usuario.tenantId, id);
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EXCLUIU',
    recursoTipo: 'FonteBoletim',
    recursoId: id,
    antes: { nome: fonte.nome, url: fonte.url },
    ocorridoEm: deps.clock.agora(),
  });

  return c.json({ ok: true });
});

/**
 * Últimas execuções — a fonte de verdade do que a tela mostra.
 *
 * A tela consulta esta rota em rajada enquanto há geração em curso e devagar
 * quando não há. Poucos itens de propósito: o que interessa é a execução
 * corrente e um histórico curto que responda "e na semana passada, funcionou?".
 */
rotasBoletim.get('/execucoes', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');

  const execucoes = await deps.execucoesBoletim.listarRecentes(usuario.tenantId, 10);
  const agora = deps.clock.agora();

  return c.json({
    itens: execucoes.map((e) => paraRespostaExecucao(e, agora)),
    /** Segundos de silêncio após os quais uma execução é dada como travada — a tela explica a espera com este número. */
    limiteSemSinalSegundos: LIMITE_SEM_SINAL_MS / 1000,
  });
});

/**
 * Gera o boletim agora — invocação assíncrona do worker.
 *
 * 202, não 200: a coleta leva dezenas de segundos (páginas + IA) e roda em
 * segundo plano. A resposta devolve a EXECUÇÃO recém-criada, não uma frase de
 * consolo: é ela que a tela acompanha até o desfecho.
 *
 * O registro nasce aqui, antes da invocação, e não no worker. Se nascesse lá,
 * existiria uma janela — o tempo de partida da Lambda — em que o operador já
 * clicou e o sistema não tem nada a mostrar; e uma invocação que falhasse não
 * deixaria rastro nenhum.
 */
rotasBoletim.post('/gerar', async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = deps.clock.agora();

  const fontes = await deps.fontesBoletim.listar(usuario.tenantId);
  if (!fontes.some((f) => f.ativa)) {
    return c.json(
      { code: 'SEM_FONTES', message: 'Cadastre ao menos uma fonte ativa antes de gerar.' },
      400,
    );
  }

  /**
   * Um clique de cada vez.
   *
   * Sem esta guarda, o operador que não vê progresso clica de novo — e ganha
   * dois boletins quase idênticos e o dobro do consumo da cota gratuita da IA.
   * A resposta devolve a execução em curso para a tela grudar nela em vez de
   * só reclamar.
   */
  const recentes = await deps.execucoesBoletim.listarRecentes(usuario.tenantId, 5);
  const emCurso = recentes.find((e) => estaEmAndamento(e, agora));
  if (emCurso !== undefined) {
    return c.json(
      {
        code: 'JA_EXECUTANDO',
        message: 'Já existe uma geração em andamento. Acompanhe o progresso abaixo.',
        execucao: paraRespostaExecucao(emCurso, agora),
      },
      409,
    );
  }

  const execucao = iniciarExecucao({
    tenantId: usuario.tenantId,
    execucaoId: novoExecucaoId(deps.ids.gerar()),
    origem: 'MANUAL',
    agora,
    solicitadaPor: usuario.userId,
  });
  await deps.execucoesBoletim.salvar(execucao);

  try {
    await deps.geradorBoletim.gerarAgora(String(execucao.execucaoId));
  } catch (erro) {
    // A invocação falhou: o worker nunca vai rodar, e deixar o registro em
    // EXECUTANDO faria a tela esperar quatro minutos por um processo que não
    // existe. Fecha na hora, com o motivo.
    await deps.execucoesBoletim.salvar(
      encerrarExecucao(
        execucao,
        { situacao: 'FALHOU', erro: `Não foi possível iniciar a geração: ${mensagem(erro)}` },
        deps.clock.agora(),
      ),
    );
    return c.json(
      {
        code: 'FALHA_AO_INICIAR',
        message: 'Não foi possível iniciar a geração. Tente de novo em alguns instantes.',
      },
      502,
    );
  }

  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'CRIOU',
    recursoTipo: 'GeracaoBoletim',
    recursoId: String(execucao.execucaoId),
    ocorridoEm: agora,
  });

  return c.json(
    {
      iniciado: true,
      message:
        'Geração iniciada. Acompanhe o progresso aqui — leva de um a dois minutos, e você não precisa manter a tela aberta.',
      execucao: paraRespostaExecucao(execucao, agora),
    },
    202,
  );
});

function paraResposta(f: FonteBoletim): Record<string, unknown> {
  return {
    fonteId: String(f.fonteId),
    nome: f.nome,
    url: f.url,
    instrucao: f.instrucao,
    ativa: f.ativa,
    atualizadoEm: f.atualizadoEm.toISOString(),
  };
}

/**
 * `situacao` sai daqui já resolvida, incluindo TRAVADA.
 *
 * A regra do silêncio depende do relógio, e o relógio do servidor é o único
 * confiável: um navegador com a hora errada mostraria "travada" numa geração
 * saudável, ou o contrário.
 */
function paraRespostaExecucao(e: ExecucaoBoletim, agora: Date): Record<string, unknown> {
  return {
    execucaoId: String(e.execucaoId),
    situacao: situacaoVisivel(e, agora),
    etapa: e.etapa,
    origem: e.origem,
    iniciadaEm: e.iniciadaEm.toISOString(),
    atualizadaEm: e.atualizadaEm.toISOString(),
    concluidaEm: e.concluidaEm?.toISOString() ?? null,
    fontesTotal: e.fontesTotal,
    fontesConcluidas: e.fontesConcluidas,
    fonteAtual: e.fonteAtual ?? null,
    totalNoticias: e.totalNoticias,
    templateId: e.templateId === undefined ? null : String(e.templateId),
    templateNome: e.templateNome ?? null,
    avisos: [...e.avisos],
    erro: e.erro ?? null,
  };
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
