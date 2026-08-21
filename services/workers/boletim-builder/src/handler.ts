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
  iniciarExecucao,
  campaignId as novoCampaignId,
  execucaoBoletimId as novoExecucaoId,
  rotinaId as novoRotinaId,
  templateId as novoTemplateId,
  userId as novoUserId,
  registrarDisparo,
  registrarEnvioAutomatico,
  type BuscadorDePagina,
  type Campaign,
  type ExecucaoBoletim,
  type ExecucaoBoletimRepository,
  type ExtratorPorIa,
  type ResultadoColeta,
  type Template,
} from '@emailmkt/core';
import { DynamoTipoEmailRepository } from '@emailmkt/adapters-aws';
import { compileDesignToMjml, criarBoletimColetado } from '@emailmkt/criador';
import { paginaParaTexto } from '@emailmkt/email-render';
import mjml2html from 'mjml';

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
  async buscarTexto(url: string): Promise<string> {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'BoletimAAA/1.0 (boletim informativo; contato@andrearaujoadvogados.com.br)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return paginaParaTexto(await r.text());
  },
};

/**
 * Modelos tentados nesta ordem quando `MODELO_GEMINI` não está definido.
 *
 * O primeiro é um **alias** que o Google mantém apontando para o flash atual —
 * a lição veio de produção: o nome fixo `gemini-2.0-flash` devolveu 404 no
 * primeiro uso real, porque o Google aposenta modelos nomeados e o boletim
 * não pode quebrar a cada aposentadoria. Os demais são a rede para o caso de
 * o próprio alias mudar de forma.
 */
const MODELOS_CANDIDATOS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

/**
 * Gemini via REST — o único trecho que conhece o provedor.
 *
 * O nível gratuito do AI Studio cobre um boletim semanal com folga (o limite
 * diário é ordens de grandeza acima de meia dúzia de fontes). Trocar de
 * provedor é reescrever esta função e nada mais: o prompt e a interpretação
 * da resposta são regra de domínio e moram no core.
 */
function criarExtrator(chave: string, modelos: readonly string[]): ExtratorPorIa {
  // O modelo que respondeu fica valendo para as próximas fontes do mesmo
  // lote — sem isso, cada fonte repetiria os 404 dos candidatos anteriores.
  let indice = 0;

  return {
    async completar(prompt: string): Promise<string> {
      while (indice < modelos.length) {
        const modelo = modelos[indice] ?? '';
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(60_000),
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
            }),
          },
        );

        // 404 = este modelo não existe mais nesta API. Não é falha da fonte
        // nem da chave: passa ao próximo candidato.
        if (r.status === 404) {
          log.info('modelo indisponível, tentando o próximo', { modelo });
          indice += 1;
          continue;
        }

        if (!r.ok) {
          // 429 é o limite do nível gratuito — a mensagem diz isso em vez de
          // deixar um "HTTP 429" críptico no aviso da fonte.
          if (r.status === 429)
            throw new Error('limite do nível gratuito atingido; tente mais tarde');
          throw new Error(`Gemini HTTP ${r.status} (modelo ${modelo})`);
        }

        const corpo = (await r.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const texto = corpo.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
        if (texto === undefined || texto === '') throw new Error('resposta vazia do modelo');
        return texto;
      }

      throw new Error(
        `nenhum dos modelos respondeu (${modelos.join(', ')}) — defina MODELO_GEMINI com um modelo atual`,
      );
    },
  };
}

export interface ResultadoBoletim {
  readonly gerado: boolean;
  readonly templateId?: string;
  readonly templateNome?: string;
  readonly totalNoticias: number;
  readonly avisos: readonly string[];
}

export const handler = async (
  evento: { origem?: string; execucaoId?: string; rotinaId?: string } = {},
): Promise<ResultadoBoletim> => {
  const doc = dynamoDoc();
  const tabela = env('TABELA_PRINCIPAL');
  const execucoes = new DynamoExecucaoBoletimRepository(doc, tabela);

  /**
   * O registro que a tela acompanha.
   *
   * Vem pronto quando o operador clicou (a API o criou antes de invocar) e
   * nasce aqui quando é a rodada de segunda-feira — a execução agendada
   * também precisa aparecer no histórico, senão o modelo do dia surge em
   * Modelos sem que ninguém saiba de onde veio.
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

    const modeloFixo = process.env['MODELO_GEMINI'];
    const extrator = criarExtrator(
      chave,
      // MODELO_GEMINI definido vale sozinho — quem fixa um modelo não quer
      // fallback silencioso para outro.
      modeloFixo === undefined || modeloFixo === '' ? MODELOS_CANDIDATOS : [modeloFixo],
    );

    await relatar({ etapa: 'LENDO_FONTES' });

    const coleta = await coletarNoticias(
      {
        fontes,
        paginas: buscador,
        extrator,
        // Um batimento por fonte. É o que sustenta a barra de progresso da tela
        // e o que distingue "demorando" de "morreu" (LIMITE_SEM_SINAL_MS).
        aoProgredir: async (p) => {
          await relatar({
            etapa: 'LENDO_FONTES',
            fontesTotal: p.totalFontes,
            fontesConcluidas: p.fontesConcluidas,
            fonteAtual: p.fonteAtual,
            totalNoticias: p.noticiasAteAgora,
          });
        },
      },
      TENANT_PADRAO,
    );

    for (const aviso of coleta.avisos) log.info('aviso da coleta', { aviso });

    if (coleta.totalNoticias === 0) {
      log.info('nada coletado — nenhum modelo gerado', {
        origem: evento.origem ?? 'agendado',
        avisos: coleta.avisos.length,
      });
      await execucoes.salvar(
        encerrarExecucao(
          { ...execucao, fontesConcluidas: execucao.fontesTotal },
          { situacao: 'SEM_NOTICIAS', avisos: coleta.avisos },
          new Date(),
        ),
      );
      return { gerado: false, totalNoticias: 0, avisos: coleta.avisos };
    }

    await relatar({
      etapa: 'MONTANDO_EMAIL',
      fontesConcluidas: execucao.fontesTotal,
      totalNoticias: coleta.totalNoticias,
    });

    const resultado = await montarModelo({
      coleta,
      templates,
      execucoes,
      execucao,
      origem: evento.origem,
    });

    /**
     * Rotina de envio automático: o modelo virou campanha e sai agora.
     *
     * Roda DEPOIS de a execução fechar como CONCLUIDA, e qualquer falha aqui
     * fica no campo `envioErro` da execução em vez de derrubar o resultado da
     * geração — o modelo existe e pode ser disparado à mão; o que o operador
     * precisa é saber que o automático não saiu, não perder o trabalho feito.
     */
    if (evento.origem === 'rotina' && resultado.gerado && resultado.templateId !== undefined) {
      await enviarPelaRotina({
        doc,
        tabela,
        execucoes,
        execucaoId: execucao.execucaoId,
        rotinaId: evento.rotinaId,
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

async function montarModelo(ctx: {
  coleta: ResultadoColeta;
  templates: DynamoTemplateRepository;
  execucoes: ExecucaoBoletimRepository;
  execucao: ExecucaoBoletim;
  origem: string | undefined;
}): Promise<ResultadoBoletim> {
  const { coleta, templates, execucoes, execucao } = ctx;
  const agora = new Date();
  const design = criarBoletimColetado({
    titulo: 'Destaques da semana',
    periodo: `${dataCurta(new Date(agora.getTime() - 7 * 86_400_000))} a ${dataCurta(agora)} · Edição automática`,
    introducao: '',
    noticias: coleta.porFonte.flatMap((f) =>
      f.noticias.map((n) => ({
        titulo: n.titulo,
        resumo: n.resumo,
        url: n.url,
        // Sem tag da IA, o chapéu é o nome da fonte — nunca fica vazio.
        tag: n.tag === '' ? f.fonte.nome : n.tag,
      })),
    ),
    fontes: coleta.porFonte.map((f) => f.fonte.nome),
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
    nome: `Boletim automático — ${dataCurta(agora)}`,
    tipo: 'VISUAL',
    categoria: 'Boletim',
    versaoAtual: 1,
    arquivado: false,
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await templates.salvarComVersao(template, {
    versao: 1,
    assunto: 'Boletim Tributário — os destaques da semana',
    corpoHtml: compilado.html,
    estruturaVisual: JSON.stringify(design),
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
  });

  // O desfecho é gravado DEPOIS do modelo existir. Marcar "concluída" antes
  // deixaria a tela oferecendo o link de um modelo que a gravação não salvou.
  await execucoes.salvar(
    encerrarExecucao(
      execucao,
      {
        situacao: 'CONCLUIDA',
        templateId: template.templateId,
        templateNome: template.nome,
        totalNoticias: coleta.totalNoticias,
        avisos: coleta.avisos,
      },
      new Date(),
    ),
  );

  log.info('boletim gerado', {
    templateId: String(template.templateId),
    noticias: coleta.totalNoticias,
    fontes: coleta.porFonte.length,
    avisos: coleta.avisos.length,
    origem: ctx.origem ?? 'agendado',
    execucaoId: String(execucao.execucaoId),
  });

  return {
    gerado: true,
    templateId: String(template.templateId),
    templateNome: template.nome,
    totalNoticias: coleta.totalNoticias,
    avisos: coleta.avisos,
  };
}

/** Identidade do envio automático nos registros — não há pessoa apertando botão. */
const USUARIO_ROTINA = 'rotina-boletim';

/**
 * Cria a campanha do boletim recém-gerado e dispara para a lista da rotina.
 *
 * Espelha o caminho do painel de ponta a ponta — mesma auditoria de disparo
 * (`registrarDisparo` com o fingerprint do conteúdo), mesmo orquestrador — para
 * o envio automático não ser um atalho com menos registro que o manual. O
 * `campaign-launcher` aceita RASCUNHO e resolve a audiência com todas as
 * guardas de sempre (supressão, classificação de vínculo, idempotência).
 */
async function enviarPelaRotina(ctx: {
  doc: ReturnType<typeof dynamoDoc>;
  tabela: string;
  execucoes: ExecucaoBoletimRepository;
  execucaoId: ExecucaoBoletim['execucaoId'];
  rotinaId: string | undefined;
  templateId: string;
  templateNome: string;
}): Promise<void> {
  const anotar = async (
    resultado: { campaignId: Campaign['campaignId'] } | { erro: string },
  ): Promise<void> => {
    // A execução já foi encerrada por `montarModelo`; recarrega para anotar o
    // desfecho do envio sobre o registro final, não sobre uma cópia velha.
    const atual = await ctx.execucoes.buscarPorId(TENANT_PADRAO, ctx.execucaoId);
    if (atual === null) return;
    await ctx.execucoes.salvar(registrarEnvioAutomatico(atual, resultado, new Date()));
  };

  try {
    if (ctx.rotinaId === undefined || ctx.rotinaId === '') {
      throw new Error('A invocação da rotina veio sem o identificador da rotina.');
    }

    const rotinas = new DynamoRotinaBoletimRepository(ctx.doc, ctx.tabela);
    const rotina = await rotinas.buscarPorId(TENANT_PADRAO, novoRotinaId(ctx.rotinaId));
    if (rotina === null) {
      // Agenda órfã: a rotina foi excluída mas a agenda sobreviveu (falha na
      // remoção). Não envia — e o registro diz por quê, para alguém remover a
      // agenda em vez de conviver com um disparo fantasma.
      throw new Error('A rotina que originou este disparo não existe mais. Nada foi enviado.');
    }
    if (!rotina.ativa) {
      // Desligada entre o gatilho e agora — corrida rara, resultado correto.
      log.info('rotina inativa; envio não realizado', { rotinaId: ctx.rotinaId });
      return;
    }

    const agora = new Date();
    const campanhas = new DynamoCampaignRepository(ctx.doc, ctx.tabela);
    const tipos = new DynamoTipoEmailRepository(ctx.doc, ctx.tabela);

    // O tipo "Boletim" cataloga a campanha como as criadas pelo assistente;
    // se o catálogo ainda não foi semeado, a campanha sai sem tipo — envio
    // primeiro, taxonomia depois.
    const tipoBoletim = (await tipos.listar(TENANT_PADRAO)).find(
      (t) => t.nome === TIPO_EMAIL_PADRAO,
    );

    const campanha: Campaign = {
      tenantId: TENANT_PADRAO,
      campaignId: novoCampaignId(crypto.randomUUID()),
      nome: ctx.templateNome,
      ...(tipoBoletim === undefined ? {} : { tipoEmailId: tipoBoletim.tipoEmailId }),
      templateId: novoTemplateId(ctx.templateId),
      // Recém-criado pelo passo anterior: a versão vigente é a 1 por construção.
      templateVersao: 1,
      listId: rotina.listId,
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
     * Lambda for reexecutada dentro da janela, o Step Functions recusa o nome
     * repetido — e, atrás dessa guarda, o `sendId` determinístico impediria o
     * e-mail duplicado de qualquer forma (§5.4).
     */
    const janela = agora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await new SFNClient({}).send(
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
      rotinaId: ctx.rotinaId,
      campaignId: String(campanha.campaignId),
      listId: String(rotina.listId),
    });
    await anotar({ campaignId: campanha.campaignId });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    log.error('envio automático falhou', { rotinaId: ctx.rotinaId ?? '', motivo });
    await anotar({ erro: motivo });
  }
}

const dataCurta = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export type { ResultadoColeta };
