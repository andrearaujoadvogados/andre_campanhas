import {
  CanonicalContentHasher,
  DynamoCampaignRepository,
  DynamoExecucaoBoletimRepository,
  DynamoFonteBoletimRepository,
  DynamoRotinaBoletimRepository,
  DynamoTemplateRepository,
  SecretsProvider,
  dynamoDoc,
  secrets,
} from '@emailmkt/adapters-aws';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  REMETENTE_ROTINA,
  TENANT_PADRAO,
  TIPO_EMAIL_PADRAO,
  coletarNoticias,
  encerrarExecucao,
  estaEmAndamento,
  iniciarExecucao,
  campaignId as novoCampaignId,
  execucaoBoletimId as novoExecucaoId,
  rotinaId as novoRotinaId,
  templateId as novoTemplateId,
  userId as novoUserId,
  registrarDisparo,
  registrarEnvioAutomatico,
  selecionarDoAcervo,
  type BuscadorDePagina,
  type Campaign,
  type EdicaoBoletim,
  type EscolhaColeta,
  type ExecucaoBoletim,
  type ExecucaoBoletimRepository,
  type OpcoesBuscaDePagina,
  type ProgressoColeta,
  type ResultadoColeta,
  type RotinaBoletim,
  type Template,
} from '@emailmkt/core';
import { DynamoListRepository, DynamoTipoEmailRepository } from '@emailmkt/adapters-aws';
import { compileDesignToMjml, criarBoletimColetado, type NoticiaDaColeta } from '@emailmkt/criador';
import { paginaParaTexto } from '@emailmkt/email-render';
import mjml2html from 'mjml';

import { TIMEOUT_CHAMADA_MS, criarExtratorGemini, lerCadeiaDoAmbiente } from './extrator-gemini.js';

/**
 * Monta o boletim automaticamente — §11, item 12.
 *
 * Pipeline: fontes cadastradas → texto de cada página → extrator de IA →
 * design do boletim (as MESMAS fábricas do painel, via @emailmkt/criador) →
 * MJML → HTML → **modelo novo** na categoria Boletim.
 *
 * Nos caminhos manual e agendado, termina no modelo: o disparo continua
 * humano, com revisão editorial antes de qualquer envio (§10.3). A exceção é a
 * **rotina de envio automático** (`origem: 'rotina'`): por decisão explícita
 * do escritório, o boletim gerado vira campanha e sai para a lista da rotina
 * sem revisão — a exceção é um cadastro consciente, nunca o padrão.
 */

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = {
  info: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ nivel: 'INFO', worker: 'boletim-builder', mensagem, ...dados })),
  error: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.error(
      JSON.stringify({ nivel: 'ERROR', worker: 'boletim-builder', mensagem, ...dados }),
    ),
};

/** Marca de segredo não configurado — o CDK cria o cofre; a chave é colada depois. */
const CHAVE_PENDENTE = 'configure-me';

/**
 * Busca a página com identidade e limites explícitos.
 *
 * O User-Agent se identifica de verdade: coletar notícia para um boletim
 * citando a fonte é uso legítimo, e sites bloqueiam agentes anônimos antes de
 * bloquearem agentes honestos. O timeout evita que uma fonte lenta consuma o
 * tempo da Lambda inteira.
 */
const buscador: BuscadorDePagina = {
  async buscarTexto(url: string, opcoes: OpcoesBuscaDePagina = {}): Promise<string> {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'BoletimAAA/1.0 (boletim informativo; contato@andrearaujoadvogados.com.br)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return paginaParaTexto(await r.text(), 30_000, opcoes);
  },
};

/**
 * Orçamento de tempo da rodada.
 *
 * O prazo da coleta vem do tempo que a Lambda ainda tem, menos uma margem:
 * uma chamada à IA já em curso pode terminar até TIMEOUT_CHAMADA_MS depois do
 * prazo, e montar o e-mail e gravar o desfecho leva alguns segundos. Sem o
 * prazo, uma IA lenta estourava o teto da Lambda em silêncio — o registro
 * ficava "executando" até a tela o dar como travado, e a repetição automática
 * da invocação reexecutava tudo por trás do operador.
 */
const MARGEM_FINAL_MS = TIMEOUT_CHAMADA_MS + 30_000;

/** Invocação sem contexto (testes, chamada direta): assume o teto antigo da Lambda. */
const ORCAMENTO_PADRAO_MS = 5 * 60_000;

export interface ResultadoBoletim {
  readonly gerado: boolean;
  readonly templateId?: string;
  readonly templateNome?: string;
  readonly totalNoticias: number;
  readonly avisos: readonly string[];
  /** Novidades ou retrospectiva — só quando houve modelo. */
  readonly edicao?: EdicaoBoletim;
}

export const handler = async (
  evento: { origem?: string; execucaoId?: string; rotinaId?: string } = {},
  contexto?: { getRemainingTimeInMillis?: () => number },
): Promise<ResultadoBoletim> => {
  const prazo =
    Date.now() + (contexto?.getRemainingTimeInMillis?.() ?? ORCAMENTO_PADRAO_MS) - MARGEM_FINAL_MS;
  const doc = dynamoDoc();
  const tabela = env('TABELA_PRINCIPAL');
  const execucoes = new DynamoExecucaoBoletimRepository(doc, tabela);

  /**
   * Uma rodada de cada vez — também para as agendadas.
   *
   * O botão já tinha esta trava na API; as rotinas não tinham, e em 31/08 a
   * agenda fixa de segunda e a rotina das 8h dispararam com 20 segundos de
   * diferença, disputando o mesmo modelo sobrecarregado. A rodada pulada fica
   * registrada como falha, com o motivo: silêncio aqui seria uma rotina que
   * "não rodou" sem ninguém saber por quê.
   */
  if (evento.origem !== 'manual') {
    const agora = new Date();
    const emCurso = (await execucoes.listarRecentes(TENANT_PADRAO, 5)).find((e) =>
      estaEmAndamento(e, agora),
    );
    if (emCurso !== undefined) {
      const motivo = `Outra geração já estava em andamento (iniciada às ${horaCurta(emCurso.iniciadaEm)}); esta rodada foi pulada para não disputar a cota da IA. Nada foi gerado nem enviado.`;
      log.info('rodada pulada: outra geração em andamento', {
        emCurso: String(emCurso.execucaoId),
        origem: evento.origem ?? 'agendado',
      });
      await execucoes.salvar(
        encerrarExecucao(
          iniciarExecucao({
            tenantId: TENANT_PADRAO,
            execucaoId: novoExecucaoId(evento.execucaoId ?? crypto.randomUUID()),
            origem: evento.origem === 'rotina' ? 'ROTINA' : 'AGENDADA',
            agora,
          }),
          { situacao: 'FALHOU', erro: motivo },
          agora,
        ),
      );
      return { gerado: false, totalNoticias: 0, avisos: [motivo] };
    }
  }

  /**
   * O registro que a tela acompanha.
   *
   * Vem pronto quando o operador clicou (a API o criou antes de invocar) e
   * nasce aqui quando é a rotina — a execução automática também precisa
   * aparecer no histórico, senão o modelo surge em Modelos sem que ninguém
   * saiba de onde veio.
   */
  let execucao = await obterExecucao(execucoes, evento);

  const relatar = async (mudanca: Partial<ExecucaoBoletim>): Promise<void> => {
    execucao = { ...execucao, ...mudanca, atualizadaEm: new Date() };
    await execucoes.salvar(execucao);
  };

  const falhar = async (motivo: string): Promise<ResultadoBoletim> => {
    log.error('geração falhou', { motivo, execucaoId: String(execucao.execucaoId) });
    await execucoes
      .salvar(encerrarExecucao(execucao, { situacao: 'FALHOU', erro: motivo }, new Date()))
      .catch((e: unknown) => log.error('não foi possível gravar a falha', { erro: String(e) }));
    return { gerado: false, totalNoticias: 0, avisos: [motivo] };
  };

  try {
    /**
     * A rotina é carregada ANTES da coleta: o recorte dela (fontes, temas,
     * tipo, nome) define o que esta rodada lê e como o modelo se chama. Agenda
     * órfã — rotina excluída com a agenda sobrevivendo — falha aqui, cedo:
     * gerar uma edição sem saber o recorte produziria conteúdo que ninguém
     * pediu, com o nome errado, e ainda tentaria enviar.
     */
    let rotina: RotinaBoletim | null = null;
    if (evento.origem === 'rotina') {
      if (evento.rotinaId === undefined || evento.rotinaId === '') {
        return await falhar('A invocação da rotina veio sem o identificador da rotina.');
      }
      rotina = await new DynamoRotinaBoletimRepository(doc, tabela).buscarPorId(
        TENANT_PADRAO,
        novoRotinaId(evento.rotinaId),
      );
      if (rotina === null) {
        return await falhar(
          'A rotina que originou este disparo não existe mais. Nada foi gerado nem enviado — remova a agenda órfã.',
        );
      }
    }

    const fontes = new DynamoFonteBoletimRepository(doc, tabela);
    const templates = new DynamoTemplateRepository(doc, tabela);

    const chave = await new SecretsProvider(secrets()).ler(env('SEGREDO_GEMINI_ARN'));
    if (chave === '' || chave === CHAVE_PENDENTE) {
      // Falta de configuração é FALHA, não "nada encontrado": a diferença é o
      // que o operador faz a seguir — aqui ele precisa de quem tenha acesso ao
      // Secrets Manager, e nenhuma revisão de fonte resolveria.
      return await falhar(
        'A chave do Gemini ainda não foi configurada. Crie uma em aistudio.google.com e grave no ' +
          'segredo do Secrets Manager indicado em docs/RUNBOOK.md.',
      );
    }

    const extrator = criarExtratorGemini({
      chave,
      modelos: lerCadeiaDoAmbiente(process.env['MODELOS_GEMINI']),
      prazoMs: prazo,
      // O batimento durante as retentativas: sem ele, uma fonte que insiste
      // por minutos pareceria morta para a tela. Gravar o pulso é acessório —
      // falhar aqui não pode derrubar a coleta.
      pulso: async () => {
        try {
          await relatar({});
        } catch {
          /* o batimento é acessório; a coleta é o trabalho */
        }
      },
      log: (mensagem, dados) => log.info(mensagem, dados),
    });

    await relatar({ etapa: 'LENDO_FONTES' });

    const escolha: EscolhaColeta =
      rotina === null ? {} : { fonteIds: rotina.fonteIds.map(String), temas: rotina.temas };

    // Um batimento por fonte. É o que sustenta a barra de progresso da tela e
    // o que distingue "demorando" de "morreu" (LIMITE_SEM_SINAL_MS). O rótulo
    // diz à tela em qual passada a fonte está sendo lida.
    const depsColeta = (rotulo: string) => ({
      fontes,
      paginas: buscador,
      extrator,
      prazoMs: prazo,
      aoProgredir: async (p: ProgressoColeta) => {
        await relatar({
          etapa: 'LENDO_FONTES',
          fontesTotal: p.totalFontes,
          fontesConcluidas: p.fontesConcluidas,
          fonteAtual: rotulo === '' ? p.fonteAtual : `${p.fonteAtual} (${rotulo})`,
          totalNoticias: p.noticiasAteAgora,
        });
      },
    });

    // O recorte da rotina: fontes escolhidas e temas que orientam a IA. A
    // geração avulsa segue como sempre — todas as ativas.
    const coleta = await coletarNoticias(depsColeta(''), TENANT_PADRAO, escolha);

    for (const aviso of coleta.avisos) log.info('aviso da coleta', { aviso });
    log.info('coleta terminou', {
      cadeia: extrator.cadeia(),
      noticias: coleta.totalNoticias,
      fontesComFalha: coleta.fontesComFalha,
      fontesSemNoticia: coleta.fontesSemNoticia,
    });

    let conteudo = conteudoDaColeta(coleta);
    let edicao: EdicaoBoletim = 'NOVIDADES';
    let avisos: readonly string[] = coleta.avisos;

    /**
     * O boletim sai de qualquer modo — decisão do escritório.
     *
     * Semana sem novidade não pode virar semana sem e-mail: quem assinou
     * espera o boletim, e silêncio parece descuido. Quando a coleta de
     * novidades não rende nada, a edição vira RETROSPECTIVA, avisada no
     * próprio e-mail, com o que há de mais relevante e mais lido — primeiro
     * pedindo isso à IA sobre as mesmas fontes (com as laterais de "mais
     * lidas", que a coleta normal ignora); depois, se a IA ou os sites
     * estiverem fora do ar, recorrendo ao acervo das edições anteriores.
     */
    if (conteudo.noticias.length === 0 && coleta.fontesSemNoticia > 0) {
      const segunda = await coletarNoticias(depsColeta('retrospectiva'), TENANT_PADRAO, {
        ...escolha,
        modo: 'RETROSPECTIVA',
      });
      for (const aviso of segunda.avisos) log.info('aviso da retrospectiva', { aviso });
      if (segunda.totalNoticias > 0) {
        conteudo = conteudoDaColeta(segunda);
        edicao = 'RETROSPECTIVA';
      } else {
        avisos = [...avisos, ...segunda.avisos.map((a) => `Retrospectiva — ${a}`)];
      }
    }

    if (conteudo.noticias.length === 0) {
      const acervo = selecionarDoAcervo(await execucoes.listarRecentes(TENANT_PADRAO, 20), {
        maximo: 6,
        temas: rotina?.temas ?? [],
      });
      if (acervo.length > 0) {
        conteudo = { noticias: acervo, fontes: ['edições anteriores deste boletim'] };
        edicao = 'RETROSPECTIVA';
        log.info('edição montada do acervo', { noticias: acervo.length });
      }
    }

    if (conteudo.noticias.length === 0) {
      /**
       * Nada em lugar nenhum — os desfechos de sempre.
       *
       * Nenhuma notícia por FALHA TÉCNICA não é "nada encontrado": SEM_NOTICIAS
       * aparece em âmbar e manda revisar as instruções das fontes; quando a
       * coleta inteira caiu porque a IA ou os sites estavam fora do ar, não há
       * instrução a revisar — o desfecho é falha, e a tela oferece "gerar de
       * novo", que é a ação que de fato resolve.
       */
      if (coleta.fontesSemNoticia === 0 && coleta.fontesComFalha > 0) {
        return await falhar(
          `Nenhuma fonte pôde ser lida: ${coleta.avisos.join(' ')} As fontes em si não foram descartadas — ` +
            'quando a causa é indisponibilidade temporária (da IA ou dos sites), gerar de novo em alguns minutos costuma resolver.',
        );
      }

      log.info('nada coletado — nenhum modelo gerado', {
        origem: evento.origem ?? 'agendado',
        avisos: avisos.length,
      });
      await execucoes.salvar(
        encerrarExecucao(
          { ...execucao, fontesConcluidas: execucao.fontesTotal },
          { situacao: 'SEM_NOTICIAS', avisos },
          new Date(),
        ),
      );
      return { gerado: false, totalNoticias: 0, avisos };
    }

    await relatar({
      etapa: 'MONTANDO_EMAIL',
      fontesConcluidas: execucao.fontesTotal,
      totalNoticias: conteudo.noticias.length,
    });

    const resultado = await montarModelo({
      conteudo,
      edicao,
      avisos,
      templates,
      execucoes,
      execucao,
      origem: evento.origem,
      rotina,
      doc,
      tabela,
    });

    /**
     * Rotina de envio automático: o modelo virou campanha e sai agora.
     *
     * Roda DEPOIS de a execução fechar como CONCLUIDA, e qualquer falha aqui
     * fica no campo `envioErro` da execução em vez de derrubar o resultado da
     * geração — o modelo existe e pode ser disparado à mão; o que o operador
     * precisa é saber que o automático não saiu, não perder o trabalho feito.
     */
    if (
      evento.origem === 'rotina' &&
      rotina !== null &&
      resultado.gerado &&
      resultado.templateId !== undefined
    ) {
      await enviarPelaRotina({
        doc,
        tabela,
        execucoes,
        execucaoId: execucao.execucaoId,
        rotina,
        templateId: resultado.templateId,
        templateNome: resultado.templateNome ?? 'Boletim automático',
      });
    }

    return resultado;
  } catch (erro) {
    /**
     * Falha inesperada vira registro, não exceção propagada — de propósito.
     *
     * Propagar faria a Lambda repetir a invocação duas vezes em silêncio, e as
     * falhas reais deste worker (chave, cota da IA, modelo aposentado, fonte
     * fora do ar) não se resolvem em trinta segundos. O operador vê o motivo na
     * tela e decide se tenta de novo — que é a escolha dele, não do repetidor
     * automático que ninguém observa.
     */
    return await falhar(erro instanceof Error ? erro.message : String(erro));
  }
};

/** Recupera a execução criada pela API, ou abre uma nova para a rodada agendada. */
async function obterExecucao(
  execucoes: ExecucaoBoletimRepository,
  evento: { origem?: string; execucaoId?: string },
): Promise<ExecucaoBoletim> {
  if (evento.execucaoId !== undefined && evento.execucaoId !== '') {
    const existente = await execucoes.buscarPorId(TENANT_PADRAO, novoExecucaoId(evento.execucaoId));
    if (existente !== null) return existente;
  }

  const nova = iniciarExecucao({
    tenantId: TENANT_PADRAO,
    execucaoId: novoExecucaoId(evento.execucaoId ?? crypto.randomUUID()),
    origem:
      evento.origem === 'manual' ? 'MANUAL' : evento.origem === 'rotina' ? 'ROTINA' : 'AGENDADA',
    agora: new Date(),
  });
  await execucoes.salvar(nova);
  return nova;
}

interface ConteudoEdicao {
  readonly noticias: readonly NoticiaDaColeta[];
  readonly fontes: readonly string[];
}

/** Das fontes lidas para o conteúdo da edição — sem tag da IA, o chapéu é o nome da fonte. */
function conteudoDaColeta(coleta: ResultadoColeta): ConteudoEdicao {
  return {
    noticias: coleta.porFonte.flatMap((f) =>
      f.noticias.map((n) => ({
        titulo: n.titulo,
        resumo: n.resumo,
        url: n.url,
        tag: n.tag === '' ? f.fonte.nome : n.tag,
      })),
    ),
    fontes: coleta.porFonte.map((f) => f.fonte.nome),
  };
}

async function montarModelo(ctx: {
  conteudo: ConteudoEdicao;
  edicao: EdicaoBoletim;
  avisos: readonly string[];
  templates: DynamoTemplateRepository;
  execucoes: ExecucaoBoletimRepository;
  execucao: ExecucaoBoletim;
  origem: string | undefined;
  rotina: RotinaBoletim | null;
  doc: ReturnType<typeof dynamoDoc>;
  tabela: string;
}): Promise<ResultadoBoletim> {
  const { conteudo, edicao, avisos, templates, execucoes, execucao, rotina } = ctx;
  const agora = new Date();
  const retrospectiva = edicao === 'RETROSPECTIVA';

  /**
   * Nome e categoria vêm da rotina, quando há uma: a categoria é o NOME do
   * tipo de e-mail escolhido — a ligação categoria ↔ tipo é por nome em todo o
   * sistema, e é ela que faz o modelo aparecer recomendado no assistente. O
   * caminho manual mantém os valores históricos.
   */
  const tipoNome =
    rotina?.tipoEmailId === undefined
      ? undefined
      : (
          await new DynamoTipoEmailRepository(ctx.doc, ctx.tabela).buscarPorId(
            TENANT_PADRAO,
            rotina.tipoEmailId,
          )
        )?.nome;
  const nomeBase = rotina?.nome ?? 'Boletim automático';

  const design = criarBoletimColetado({
    chapeu: rotina?.nome ?? 'Boletim',
    titulo: retrospectiva ? 'As leituras mais relevantes' : 'Destaques do período',
    periodo: periodoDaEdicao(rotina, agora),
    introducao: '',
    edicao,
    noticias: conteudo.noticias,
    fontes: conteudo.fontes,
  });

  /**
   * mjml (Node) e mjml-browser são o MESMO compilador na mesma major (5.x):
   * o modelo gerado aqui abre no criador do painel idêntico ao que o operador
   * teria montado à mão — e continua editável, porque a estrutura visual vai
   * junto na versão.
   */
  const compilado = await mjml2html(compileDesignToMjml(design), { validationLevel: 'soft' });

  const template: Template = {
    tenantId: TENANT_PADRAO,
    templateId: novoTemplateId(crypto.randomUUID()),
    nome: `${nomeBase} — ${dataCurta(agora)}${retrospectiva ? ' (retrospectiva)' : ''}`,
    tipo: 'VISUAL',
    categoria: tipoNome ?? 'Boletim',
    versaoAtual: 1,
    arquivado: false,
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
    atualizadoEm: agora,
  };

  // O assunto da retrospectiva diz o que ela é: quem recebe o boletim toda
  // semana não pode abrir "os destaques da semana" e encontrar matéria antiga.
  const assunto = retrospectiva
    ? `${nomeBase} — retrospectiva: as leituras mais relevantes`
    : rotina === null
      ? 'Boletim Tributário — os destaques da semana'
      : `${rotina.nome} — ${dataCurta(agora)}`;

  await templates.salvarComVersao(template, {
    versao: 1,
    assunto,
    corpoHtml: compilado.html,
    estruturaVisual: JSON.stringify(design),
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
  });

  // O desfecho é gravado DEPOIS do modelo existir. Marcar "concluída" antes
  // deixaria a tela oferecendo o link de um modelo que a gravação não salvou.
  // As notícias vão junto: são o acervo das retrospectivas futuras.
  await execucoes.salvar(
    encerrarExecucao(
      execucao,
      {
        situacao: 'CONCLUIDA',
        templateId: template.templateId,
        templateNome: template.nome,
        totalNoticias: conteudo.noticias.length,
        avisos,
        edicao,
        noticias: conteudo.noticias,
      },
      new Date(),
    ),
  );

  log.info('boletim gerado', {
    templateId: String(template.templateId),
    noticias: conteudo.noticias.length,
    fontes: conteudo.fontes.length,
    edicao,
    avisos: avisos.length,
    origem: ctx.origem ?? 'agendado',
    execucaoId: String(execucao.execucaoId),
  });

  return {
    gerado: true,
    templateId: String(template.templateId),
    templateNome: template.nome,
    totalNoticias: conteudo.noticias.length,
    avisos,
    edicao,
  };
}

/** "27/08/2026 a 03/09/2026 · Edição semanal" — o recorte que a rotina cobre. */
function periodoDaEdicao(rotina: RotinaBoletim | null, agora: Date): string {
  const periodicidade = rotina?.periodicidade;
  if (periodicidade === 'DIARIA') return `${dataCurta(agora)} · Edição diária`;
  const dias = periodicidade === 'MENSAL' ? 30 : 7;
  const rotulo =
    periodicidade === 'MENSAL'
      ? 'Edição mensal'
      : periodicidade === 'SEMANAL'
        ? 'Edição semanal'
        : 'Edição automática';
  return `${dataCurta(new Date(agora.getTime() - dias * 86_400_000))} a ${dataCurta(agora)} · ${rotulo}`;
}

/** Identidade do envio automático nos registros — não há pessoa apertando botão. */
const USUARIO_ROTINA = 'rotina-boletim';

/**
 * Cria as campanhas do boletim recém-gerado e dispara — uma por lista da rotina.
 *
 * Espelha o caminho do painel de ponta a ponta — mesma auditoria de disparo
 * (`registrarDisparo` com o fingerprint do conteúdo), mesmo orquestrador — para
 * o envio automático não ser um atalho com menos registro que o manual. O
 * `campaign-launcher` aceita RASCUNHO e resolve a audiência com todas as
 * guardas de sempre (supressão, classificação de vínculo, idempotência).
 *
 * Falha em uma lista não segura as outras — mesma regra da coleta por fonte:
 * o desfecho carrega as campanhas que saíram E as que não saíram, porque
 * esconder qualquer um dos lados mentiria ao operador.
 */
async function enviarPelaRotina(ctx: {
  doc: ReturnType<typeof dynamoDoc>;
  tabela: string;
  execucoes: ExecucaoBoletimRepository;
  execucaoId: ExecucaoBoletim['execucaoId'];
  rotina: RotinaBoletim;
  templateId: string;
  templateNome: string;
}): Promise<void> {
  const anotar = async (resultado: {
    campaignIds?: readonly Campaign['campaignId'][];
    erro?: string;
  }): Promise<void> => {
    // A execução já foi encerrada por `montarModelo`; recarrega para anotar o
    // desfecho do envio sobre o registro final, não sobre uma cópia velha.
    const atual = await ctx.execucoes.buscarPorId(TENANT_PADRAO, ctx.execucaoId);
    if (atual === null) return;
    await ctx.execucoes.salvar(registrarEnvioAutomatico(atual, resultado, new Date()));
  };

  try {
    const { rotina } = ctx;
    if (!rotina.ativa) {
      // Desligada entre o gatilho e agora — corrida rara, resultado correto.
      log.info('rotina inativa; envio não realizado', { rotinaId: String(rotina.rotinaId) });
      return;
    }

    const agora = new Date();
    const campanhas = new DynamoCampaignRepository(ctx.doc, ctx.tabela);
    const tipos = new DynamoTipoEmailRepository(ctx.doc, ctx.tabela);
    const sfn = new SFNClient({});
    const listas = await new DynamoListRepository(ctx.doc, ctx.tabela).listar(TENANT_PADRAO);

    // O tipo escolhido na rotina cataloga a campanha; rotina sem tipo cai no
    // "Boletim" de sempre — e se nem o catálogo foi semeado, a campanha sai
    // sem tipo: envio primeiro, taxonomia depois.
    const tipoDaRotina =
      rotina.tipoEmailId !== undefined
        ? await tipos.buscarPorId(TENANT_PADRAO, rotina.tipoEmailId)
        : ((await tipos.listar(TENANT_PADRAO)).find((t) => t.nome === TIPO_EMAIL_PADRAO) ?? null);

    const enviadas: Campaign['campaignId'][] = [];
    const falhas: string[] = [];

    for (const listId of rotina.listIds) {
      const lista = listas.itens.find((l) => String(l.listId) === String(listId));
      if (lista === undefined) {
        falhas.push(`A lista ${String(listId)} não existe mais — nada enviado para ela.`);
        continue;
      }

      try {
        const campanha: Campaign = {
          tenantId: TENANT_PADRAO,
          campaignId: novoCampaignId(crypto.randomUUID()),
          // Com uma lista só, o nome do modelo basta; com várias, a lista entra
          // no nome para os relatórios da mesma edição serem distinguíveis.
          nome:
            rotina.listIds.length === 1
              ? ctx.templateNome
              : `${ctx.templateNome} — ${lista.nome}`.slice(0, 200),
          ...(tipoDaRotina === null ? {} : { tipoEmailId: tipoDaRotina.tipoEmailId }),
          templateId: novoTemplateId(ctx.templateId),
          // Recém-criado pelo passo anterior: a versão vigente é a 1 por construção.
          templateVersao: 1,
          listId: lista.listId,
          status: 'RASCUNHO',
          remetenteNome: REMETENTE_ROTINA.nome,
          remetenteEmail: REMETENTE_ROTINA.email,
          criadoPor: novoUserId(USUARIO_ROTINA),
          criadoEm: agora,
        };

        const hash = new CanonicalContentHasher().hash({
          templateId: campanha.templateId,
          templateVersao: campanha.templateVersao,
          listId: campanha.listId,
          remetenteNome: campanha.remetenteNome,
          remetenteEmail: campanha.remetenteEmail,
          replyTo: undefined,
        });
        await campanhas.salvar(registrarDisparo(campanha, novoUserId(USUARIO_ROTINA), hash));

        /**
         * Mesmo orquestrador do botão "Disparar". O nome carrega o minuto: se a
         * Lambda for reexecutada dentro da janela, o Step Functions recusa o
         * nome repetido — e, atrás dessa guarda, o `sendId` determinístico
         * impediria o e-mail duplicado de qualquer forma (§5.4).
         */
        const janela = agora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
        await sfn.send(
          new StartExecutionCommand({
            stateMachineArn: env('ORQUESTRADOR_ARN'),
            name: `rotina-${String(campanha.campaignId)}-${janela}`.slice(0, 80),
            input: JSON.stringify({
              tenantId: String(TENANT_PADRAO),
              campaignId: String(campanha.campaignId),
              origem: 'rotina',
            }),
          }),
        );

        log.info('boletim disparado pela rotina', {
          rotinaId: String(rotina.rotinaId),
          campaignId: String(campanha.campaignId),
          listId: String(lista.listId),
        });
        enviadas.push(campanha.campaignId);
      } catch (erro) {
        falhas.push(`${lista.nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }

    await anotar({
      ...(enviadas.length === 0 ? {} : { campaignIds: enviadas }),
      ...(falhas.length === 0 ? {} : { erro: falhas.join(' ') }),
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    log.error('envio automático falhou', { rotinaId: String(ctx.rotina.rotinaId), motivo });
    await anotar({ erro: motivo });
  }
}

const dataCurta = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const horaCurta = (d: Date): string =>
  d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

export type { ResultadoColeta };
