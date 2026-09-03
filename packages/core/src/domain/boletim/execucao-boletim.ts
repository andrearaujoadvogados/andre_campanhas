import type { CampaignId, ExecucaoBoletimId, TemplateId, TenantId, UserId } from '../shared/ids.js';
import type { NoticiaColetada } from './fonte-boletim.js';

/**
 * Que edição a execução produziu.
 *
 * RETROSPECTIVA é a edição que sai quando as fontes não trouxeram novidade: o
 * boletim vai de qualquer modo, avisa o leitor e leva o mais relevante — vindo
 * de uma segunda passada da IA sobre as fontes ou, se nem isso houver, do
 * acervo das edições anteriores.
 */
export type EdicaoBoletim = 'NOVIDADES' | 'RETROSPECTIVA';

/**
 * Execução do boletim automático — o registro que torna a geração visível.
 *
 * A geração roda em segundo plano (a coleta leva dezenas de segundos: páginas
 * + IA por fonte) e, sem este registro, o operador aperta "gerar" e não tem
 * como saber se o sistema está trabalhando, se terminou, ou se falhou em
 * silêncio três minutos atrás. O log da Lambda respondia isso para quem tem
 * acesso ao CloudWatch — ninguém no escritório tem.
 *
 * Por isso a execução é um item de domínio, não um detalhe do worker: quem
 * dispara grava `EXECUTANDO` antes de invocar, o worker atualiza a cada fonte
 * lida, e a tela pergunta o estado até o desfecho.
 */

export type SituacaoExecucaoBoletim =
  /** Em andamento agora. */
  | 'EXECUTANDO'
  /** Terminou e gerou o modelo — `templateId` preenchido. */
  | 'CONCLUIDA'
  /** Terminou sem notícia nenhuma. Não é erro do sistema; é resultado vazio, e os `avisos` dizem por quê. */
  | 'SEM_NOTICIAS'
  /** Morreu no meio — `erro` diz o quê. */
  | 'FALHOU';

/**
 * Etapa corrente, para a tela dizer o que está acontecendo AGORA.
 *
 * "Aguarde" não informa nada: as três etapas têm durações muito diferentes (a
 * leitura das fontes domina o tempo), e nomeá-las é o que transforma uma espera
 * opaca em progresso observável.
 */
export type EtapaExecucaoBoletim = 'INICIANDO' | 'LENDO_FONTES' | 'MONTANDO_EMAIL' | 'FINALIZADA';

/** ROTINA = rotina de envio automático: além de gerar o modelo, dispara para a lista da rotina. */
export type OrigemExecucaoBoletim = 'MANUAL' | 'AGENDADA' | 'ROTINA';

export interface ExecucaoBoletim {
  readonly tenantId: TenantId;
  readonly execucaoId: ExecucaoBoletimId;
  readonly situacao: SituacaoExecucaoBoletim;
  readonly etapa: EtapaExecucaoBoletim;
  readonly origem: OrigemExecucaoBoletim;
  readonly iniciadaEm: Date;
  /**
   * Batimento cardíaco da execução: o worker toca este campo a cada passo.
   *
   * É o que distingue "demorando" de "morreu" — ver `situacaoVisivel`.
   */
  readonly atualizadaEm: Date;
  readonly concluidaEm?: Date;
  /** Quantas fontes ativas entraram nesta execução (0 até o worker contar). */
  readonly fontesTotal: number;
  readonly fontesConcluidas: number;
  /** Nome da fonte sendo lida agora — some quando a etapa passa da coleta. */
  readonly fonteAtual?: string;
  readonly totalNoticias: number;
  /** Modelo gerado, quando houve. */
  readonly templateId?: TemplateId;
  readonly templateNome?: string;
  /** Novidades ou retrospectiva. Ausente nos registros antigos = novidades. */
  readonly edicao?: EdicaoBoletim;
  /**
   * As notícias que entraram na edição — o acervo de que a retrospectiva se
   * serve quando as fontes e a IA não rendem nada. Só nas concluídas.
   */
  readonly noticias?: readonly NoticiaColetada[];
  /** Um aviso por fonte que não rendeu — a coleta não para por causa de uma. */
  readonly avisos: readonly string[];
  /** Mensagem da falha, quando `situacao` é FALHOU. */
  readonly erro?: string;
  /** Quem apertou o botão. Ausente na execução agendada. */
  readonly solicitadaPor?: UserId;
  /** Campanhas criadas e disparadas pela rotina — uma por lista de destino. */
  readonly envioCampaignIds?: readonly CampaignId[];
  /** Forma antiga, de quando a rotina tinha uma lista só. Registros novos usam o plural. */
  readonly envioCampaignId?: CampaignId;
  /**
   * Falha do envio automático da rotina. Campo próprio, e não `erro`: o modelo
   * FOI gerado (`templateId` está aí para o disparo manual); o que não saiu foi
   * o e-mail — e a tela precisa contar as duas coisas, não uma média delas.
   * Com várias listas, agrega as que falharam; as que saíram estão no plural.
   */
  readonly envioErro?: string;
}

/**
 * Silêncio tolerado antes de presumir que a execução morreu.
 *
 * O worker toca o registro a cada fonte e, dentro de uma fonte, antes de cada
 * chamada à IA e de cada espera entre tentativas — o maior silêncio legítimo é
 * uma chamada inteira (60s) mais uma espera (30s). Quatro minutos sem um único
 * batimento não é lentidão — é processo morto (estouro de memória, timeout
 * duro, invocação que nunca chegou). Sem esta regra o registro ficaria
 * `EXECUTANDO` para sempre, e a tela mentiria "gerando…" indefinidamente, que
 * é pior do que não ter feedback nenhum.
 */
export const LIMITE_SEM_SINAL_MS = 4 * 60_000;

/** O que a tela mostra — inclui o estado derivado que não existe no banco. */
export type SituacaoVisivelBoletim = SituacaoExecucaoBoletim | 'TRAVADA';

export function situacaoVisivel(
  execucao: Pick<ExecucaoBoletim, 'situacao' | 'atualizadaEm'>,
  agora: Date,
): SituacaoVisivelBoletim {
  if (execucao.situacao !== 'EXECUTANDO') return execucao.situacao;
  const silencio = agora.getTime() - execucao.atualizadaEm.getTime();
  return silencio > LIMITE_SEM_SINAL_MS ? 'TRAVADA' : 'EXECUTANDO';
}

/**
 * Há uma geração de fato em curso?
 *
 * Usado para bloquear o segundo clique: duas execuções simultâneas gerariam
 * dois modelos quase idênticos e gastariam em dobro a cota gratuita da IA
 * (prevenção de erro, não só cosmética de botão). Uma execução travada NÃO
 * conta — do contrário um worker morto trancaria o botão para sempre.
 */
export function estaEmAndamento(
  execucao: Pick<ExecucaoBoletim, 'situacao' | 'atualizadaEm'>,
  agora: Date,
): boolean {
  return situacaoVisivel(execucao, agora) === 'EXECUTANDO';
}

/** Duração até agora (em andamento) ou até o desfecho (terminada). */
export function duracaoMs(
  execucao: Pick<ExecucaoBoletim, 'iniciadaEm' | 'concluidaEm'>,
  agora: Date,
): number {
  const fim = execucao.concluidaEm ?? agora;
  return Math.max(0, fim.getTime() - execucao.iniciadaEm.getTime());
}

/** Execução recém-criada, ainda sem nada coletado. */
export function iniciarExecucao(dados: {
  readonly tenantId: TenantId;
  readonly execucaoId: ExecucaoBoletimId;
  readonly origem: OrigemExecucaoBoletim;
  readonly agora: Date;
  readonly solicitadaPor?: UserId;
}): ExecucaoBoletim {
  return {
    tenantId: dados.tenantId,
    execucaoId: dados.execucaoId,
    situacao: 'EXECUTANDO',
    etapa: 'INICIANDO',
    origem: dados.origem,
    iniciadaEm: dados.agora,
    atualizadaEm: dados.agora,
    fontesTotal: 0,
    fontesConcluidas: 0,
    totalNoticias: 0,
    avisos: [],
    ...(dados.solicitadaPor === undefined ? {} : { solicitadaPor: dados.solicitadaPor }),
  };
}

/**
 * Fecha a execução.
 *
 * Concentrado numa função porque o desfecho tem uma regra que é fácil errar
 * espalhada pelo worker: sem notícia NÃO é falha. A distinção importa na tela —
 * "as fontes não trouxeram nada esta semana" pede revisar as instruções das
 * fontes; "o extrator caiu" pede tentar de novo.
 */
export function encerrarExecucao(
  execucao: ExecucaoBoletim,
  desfecho:
    | {
        readonly situacao: 'CONCLUIDA';
        readonly templateId: TemplateId;
        readonly templateNome: string;
        readonly totalNoticias: number;
        readonly avisos: readonly string[];
        readonly edicao?: EdicaoBoletim;
        readonly noticias?: readonly NoticiaColetada[];
      }
    | { readonly situacao: 'SEM_NOTICIAS'; readonly avisos: readonly string[] }
    | { readonly situacao: 'FALHOU'; readonly erro: string },
  agora: Date,
): ExecucaoBoletim {
  // A fonte corrente deixa de existir quando a execução termina; mantê-la faria
  // a tela dizer "lendo Migalhas" ao lado de "concluída". Sai por desestruturação
  // porque `exactOptionalPropertyTypes` recusa `fonteAtual: undefined`.
  const { fonteAtual: _ignorada, ...semFonte } = execucao;
  const base = {
    ...semFonte,
    etapa: 'FINALIZADA' as const,
    atualizadaEm: agora,
    concluidaEm: agora,
  };

  if (desfecho.situacao === 'CONCLUIDA') {
    return {
      ...base,
      situacao: 'CONCLUIDA',
      templateId: desfecho.templateId,
      templateNome: desfecho.templateNome,
      totalNoticias: desfecho.totalNoticias,
      avisos: desfecho.avisos,
      ...(desfecho.edicao === undefined ? {} : { edicao: desfecho.edicao }),
      ...(desfecho.noticias === undefined || desfecho.noticias.length === 0
        ? {}
        : { noticias: desfecho.noticias }),
    };
  }

  if (desfecho.situacao === 'SEM_NOTICIAS') {
    return { ...base, situacao: 'SEM_NOTICIAS', totalNoticias: 0, avisos: desfecho.avisos };
  }

  return { ...base, situacao: 'FALHOU', erro: desfecho.erro };
}

/**
 * Anota o desfecho do envio automático da rotina sobre a execução já encerrada.
 *
 * O envio acontece DEPOIS de o modelo existir e de a execução fechar como
 * CONCLUIDA; esta função só acrescenta o resultado dessa etapa extra. Falha no
 * envio não reabre nem muda a situação — a geração de fato terminou — mas fica
 * registrada onde o operador olha, com o modelo pronto para disparo manual.
 */
export function registrarEnvioAutomatico(
  execucao: ExecucaoBoletim,
  // Sucesso e falha podem coexistir: com várias listas, algumas campanhas
  // saem e outras não — e esconder qualquer um dos lados mentiria ao operador.
  resultado: { readonly campaignIds?: readonly CampaignId[]; readonly erro?: string },
  agora: Date,
): ExecucaoBoletim {
  return {
    ...execucao,
    atualizadaEm: agora,
    ...(resultado.campaignIds === undefined || resultado.campaignIds.length === 0
      ? {}
      : { envioCampaignIds: resultado.campaignIds }),
    ...(resultado.erro === undefined || resultado.erro === '' ? {} : { envioErro: resultado.erro }),
  };
}
