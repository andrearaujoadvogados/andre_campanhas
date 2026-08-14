import type { ExecucaoBoletimId, TemplateId, TenantId, UserId } from '../shared/ids.js';

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

export type OrigemExecucaoBoletim = 'MANUAL' | 'AGENDADA';

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
  /** Um aviso por fonte que não rendeu — a coleta não para por causa de uma. */
  readonly avisos: readonly string[];
  /** Mensagem da falha, quando `situacao` é FALHOU. */
  readonly erro?: string;
  /** Quem apertou o botão. Ausente na execução agendada. */
  readonly solicitadaPor?: UserId;
}

/**
 * Silêncio tolerado antes de presumir que a execução morreu.
 *
 * A Lambda tem 5 minutos de teto e trabalha em sequência: por fonte, no pior
 * caso, 20s de página + 60s de IA. Quatro minutos sem um único batimento não
 * é lentidão — é processo morto (estouro de memória, timeout duro, invocação
 * que nunca chegou). Sem esta regra o registro ficaria `EXECUTANDO` para
 * sempre, e a tela mentiria "gerando…" indefinidamente, que é pior do que não
 * ter feedback nenhum.
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
    };
  }

  if (desfecho.situacao === 'SEM_NOTICIAS') {
    return { ...base, situacao: 'SEM_NOTICIAS', totalNoticias: 0, avisos: desfecho.avisos };
  }

  return { ...base, situacao: 'FALHOU', erro: desfecho.erro };
}
