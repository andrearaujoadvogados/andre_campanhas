import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dataHora } from '../lib/formato.js';
import { Selo } from './base.tsx';

/**
 * Estado da geração do boletim, compartilhado entre as telas.
 *
 * A geração roda em segundo plano por um a dois minutos — e por bem mais
 * quando a IA está sobrecarregada e o worker insiste. Quem aperta o botão
 * fica em Boletim; quem espera o resultado vai para Modelos — e as duas telas
 * precisam contar a mesma história, senão o operador conclui que não aconteceu
 * nada e aperta de novo.
 */

export type SituacaoBoletim = 'EXECUTANDO' | 'CONCLUIDA' | 'SEM_NOTICIAS' | 'FALHOU' | 'TRAVADA';

export type EtapaBoletim = 'INICIANDO' | 'LENDO_FONTES' | 'MONTANDO_EMAIL' | 'FINALIZADA';

export interface ExecucaoBoletim {
  execucaoId: string;
  situacao: SituacaoBoletim;
  etapa: EtapaBoletim;
  origem: 'MANUAL' | 'AGENDADA' | 'ROTINA';
  iniciadaEm: string;
  atualizadaEm: string;
  concluidaEm: string | null;
  fontesTotal: number;
  fontesConcluidas: number;
  fonteAtual: string | null;
  totalNoticias: number;
  templateId: string | null;
  templateNome: string | null;
  avisos: string[];
  erro: string | null;
  /** Campanha disparada pela rotina de envio automático, quando houve. */
  envioCampaignIds: string[] | null;
  /** Falha do envio automático — o modelo existe, mas o e-mail não saiu. */
  envioErro: string | null;
}

export const CHAVE_EXECUCOES = ['execucoes-boletim'];

/**
 * Consulta as execuções, acelerando enquanto há uma em curso.
 *
 * 3 segundos é o intervalo em que a barra anda de forma perceptível sem que a
 * tela pareça piscar; parado, a consulta só reage à navegação — não há por que
 * bater na API a cada 3s numa página em repouso.
 */
export function useExecucoesBoletim() {
  return useQuery({
    queryKey: CHAVE_EXECUCOES,
    queryFn: () => api.get<{ itens: ExecucaoBoletim[] }>('/boletim/execucoes'),
    refetchInterval: (q) =>
      (q.state.data?.itens[0]?.situacao ?? '') === 'EXECUTANDO' ? 3_000 : false,
    // A geração continua rodando com a aba em segundo plano; ao voltar, o
    // operador precisa do estado atual, não do que estava na tela quando saiu.
    refetchOnWindowFocus: true,
  });
}

/** Relógio que só corre quando há algo correndo — evita re-render eterno. */
function useAgora(ativo: boolean): number {
  const [agora, definirAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => definirAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [ativo]);

  return agora;
}

export function duracaoCurta(ms: number): string {
  const segundos = Math.max(0, Math.round(ms / 1000));
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos}min ${String(segundos % 60).padStart(2, '0')}s`;
}

const ROTULO_ETAPA: Readonly<Record<EtapaBoletim, string>> = {
  INICIANDO: 'Preparando a coleta',
  LENDO_FONTES: 'Lendo as fontes',
  MONTANDO_EMAIL: 'Montando o e-mail',
  FINALIZADA: 'Finalizando',
};

const ROTULO_SITUACAO: Readonly<Record<SituacaoBoletim, string>> = {
  EXECUTANDO: 'Gerando agora',
  CONCLUIDA: 'Boletim pronto',
  SEM_NOTICIAS: 'Nada foi encontrado',
  FALHOU: 'A geração falhou',
  TRAVADA: 'Sem resposta',
};

/**
 * Cores por desfecho.
 *
 * "Nada encontrado" fica em âmbar e não em vermelho de propósito: o sistema
 * funcionou, as fontes é que não tinham notícia — tratar isso como erro
 * mandaria o operador procurar defeito onde não há.
 */
const ESTILO: Readonly<Record<SituacaoBoletim, string>> = {
  EXECUTANDO: 'border-gold/30 bg-accent-mist',
  CONCLUIDA: 'border-sucesso/30 bg-sucesso-fundo',
  SEM_NOTICIAS: 'border-alerta/30 bg-alerta-fundo',
  FALHOU: 'border-erro/30 bg-erro-fundo',
  TRAVADA: 'border-erro/30 bg-erro-fundo',
};

function tomDoSelo(s: SituacaoBoletim): 'neutro' | 'positivo' | 'atencao' | 'critico' {
  if (s === 'CONCLUIDA') return 'positivo';
  if (s === 'EXECUTANDO') return 'atencao';
  if (s === 'SEM_NOTICIAS') return 'atencao';
  return 'critico';
}

/**
 * O painel principal — o que responde "o que o sistema está fazendo agora".
 *
 * `aria-live="polite"` porque o conteúdo muda sozinho: sem isso, quem usa
 * leitor de tela ficaria sem saber que a geração terminou.
 */
export function PainelExecucaoBoletim({
  execucao,
  aoTentarDeNovo,
  tentandoDeNovo = false,
}: {
  execucao: ExecucaoBoletim;
  aoTentarDeNovo?: () => void;
  tentandoDeNovo?: boolean;
}) {
  const executando = execucao.situacao === 'EXECUTANDO';
  // O relógio corre em tudo que não fechou — inclusive na travada, onde o
  // "sem sinal há X" precisa continuar crescendo enquanto ninguém age.
  const agora = useAgora(execucao.concluidaEm === null);

  const inicio = new Date(execucao.iniciadaEm).getTime();
  const fim = execucao.concluidaEm === null ? agora : new Date(execucao.concluidaEm).getTime();

  /**
   * A travada não "levou" tempo nenhum — ela parou.
   *
   * Dizer "levou 1min 32s" numa execução que morreu no meio é o tipo de meia
   * verdade que faz o operador concluir que terminou bem. O número que importa
   * ali é há quanto tempo ela está muda.
   */
  const tempo =
    execucao.situacao === 'TRAVADA'
      ? `sem sinal há ${duracaoCurta(agora - new Date(execucao.atualizadaEm).getTime())}`
      : `${executando ? 'há' : 'levou'} ${duracaoCurta(fim - inicio)}`;

  const total = execucao.fontesTotal;
  const feitas = execucao.fontesConcluidas;
  const fracao = total > 0 ? Math.min(1, feitas / total) : 0;
  // Este painel existe para nunca deixar o operador sem resposta; um campo
  // ausente na resposta não pode ser o que derruba a tela inteira.
  const avisos = execucao.avisos ?? [];
  // Mesma resiliência dos avisos: resposta sem os campos do envio automático
  // (versão anterior da API em cache) não pode inventar um desfecho.
  const envioCampaignIds = execucao.envioCampaignIds ?? [];
  const envioErro = execucao.envioErro ?? null;

  return (
    <section
      aria-live="polite"
      className={`rounded-md border p-4 sm:p-5 ${ESTILO[execucao.situacao]}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {executando && (
            <span
              aria-hidden="true"
              className="size-3.5 animate-spin rounded-full border-2 border-ink/40 border-t-transparent"
            />
          )}
          <span className="font-medium text-ink">{ROTULO_SITUACAO[execucao.situacao]}</span>
          <Selo tom={tomDoSelo(execucao.situacao)}>
            {execucao.origem === 'MANUAL'
              ? 'pedida por você'
              : execucao.origem === 'ROTINA'
                ? 'rotina de envio'
                : 'agenda de segunda'}
          </Selo>
        </div>
        <p className="text-xs text-ink-suave">
          {tempo}
          {' · início às '}
          {dataHora(execucao.iniciadaEm)}
        </p>
      </div>

      {executando && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink">
            {ROTULO_ETAPA[execucao.etapa]}
            {execucao.fonteAtual !== null && execucao.etapa === 'LENDO_FONTES' && (
              <>
                {' — '}
                <span className="font-medium">{execucao.fonteAtual}</span>
              </>
            )}
          </p>

          {/**
           * Barra determinada quando já se sabe quantas fontes existem; até lá,
           * só o texto. Uma barra que finge saber a porcentagem é pior do que
           * nenhuma — some a confiança na próxima vez que ela travar em 40%.
           */}
          {total > 0 && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={feitas}
              aria-label="Fontes lidas"
              className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
            >
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-500"
                style={{ width: `${Math.round(fracao * 100)}%` }}
              />
            </div>
          )}

          <p className="text-xs text-ink-suave">
            {total > 0
              ? `${feitas} de ${total} fontes lidas · ${execucao.totalNoticias} notícia(s) selecionada(s) até aqui`
              : 'Preparando…'}
          </p>
          <p className="text-xs text-ink-suave">
            Pode sair desta tela: a geração continua e o resultado fica registrado aqui.
          </p>
        </div>
      )}

      {execucao.situacao === 'CONCLUIDA' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink">
            {execucao.totalNoticias} notícia(s) de {execucao.fontesTotal} fonte(s) viraram o modelo{' '}
            <span className="font-medium">{execucao.templateNome}</span>.
            {envioCampaignIds.length > 0
              ? envioCampaignIds.length === 1
                ? ' A rotina de envio automático já disparou este boletim.'
                : ` A rotina de envio automático já disparou este boletim para ${envioCampaignIds.length} listas.`
              : envioErro !== null
                ? ''
                : ' Nada foi enviado — revise antes de disparar.'}
          </p>
          {/**
           * A falha do envio automático NÃO pode se disfarçar de sucesso: a
           * geração concluiu, mas o e-mail não saiu. Quem cadastrou a rotina
           * conta que ele sai sozinho — e só fica sabendo do contrário aqui.
           */}
          {envioErro !== null && (
            <p className="rounded-md border border-erro/30 bg-erro/5 p-3 text-sm font-medium text-erro">
              O envio automático da rotina falhou: {envioErro} O modelo está pronto — dá para
              disparar manualmente pelo assistente.
            </p>
          )}
          {envioCampaignIds.map((campaignId, indice) => (
            <Link
              key={campaignId}
              to={`/relatorios/${campaignId}`}
              className="mr-2 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-light transition-colors hover:bg-ink/90"
            >
              {envioCampaignIds.length === 1
                ? 'Acompanhar o envio'
                : `Acompanhar o envio ${indice + 1} de ${envioCampaignIds.length}`}
            </Link>
          ))}
          {execucao.templateId !== null && (
            <Link
              to={`/templates/${execucao.templateId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-light transition-colors hover:bg-ink/90"
            >
              Abrir o boletim gerado
            </Link>
          )}
        </div>
      )}

      {execucao.situacao === 'SEM_NOTICIAS' && (
        <p className="mt-3 text-sm text-ink">
          A coleta rodou até o fim, mas nenhuma fonte trouxe notícia que atendesse à instrução
          cadastrada. Nenhum modelo foi criado. Os motivos, fonte por fonte, estão abaixo.
        </p>
      )}

      {execucao.situacao === 'FALHOU' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink">{execucao.erro ?? 'A geração terminou com erro.'}</p>
          {aoTentarDeNovo !== undefined && (
            <BotaoTentarDeNovo aoClicar={aoTentarDeNovo} ocupado={tentandoDeNovo} />
          )}
        </div>
      )}

      {execucao.situacao === 'TRAVADA' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink">
            {/* O "há quanto tempo" já está no cabeçalho do cartão; repetir um
                prazo fixo aqui só cria chance de os dois se contradizerem. */}
            A geração começou às {dataHora(execucao.iniciadaEm)} e parou de responder antes de
            terminar — o processo provavelmente morreu no meio. Nenhum modelo foi criado. Gerar de
            novo é seguro.
          </p>
          {aoTentarDeNovo !== undefined && (
            <BotaoTentarDeNovo aoClicar={aoTentarDeNovo} ocupado={tentandoDeNovo} />
          )}
        </div>
      )}

      {/**
       * Os avisos por fonte são o diagnóstico: "Migalhas: não foi possível ler a
       * página (HTTP 403)" diz o que corrigir; "nada gerado" não diz nada.
       */}
      {avisos.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-ink-suave hover:text-ink">
            {avisos.length === 1
              ? '1 fonte não rendeu notícia — ver motivo'
              : `${avisos.length} fontes não renderam notícia — ver motivos`}
          </summary>
          <ul className="mt-2 space-y-1 pl-4 text-sm text-ink-suave">
            {avisos.map((a) => (
              <li key={a} className="list-disc">
                {a}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BotaoTentarDeNovo({ aoClicar, ocupado }: { aoClicar: () => void; ocupado: boolean }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={ocupado}
      aria-busy={ocupado}
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-ink px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {ocupado ? 'Aguarde…' : 'Gerar de novo'}
    </button>
  );
}

/**
 * Faixa compacta para a tela de Modelos.
 *
 * É onde o operador vai esperar o boletim aparecer, e uma lista que não muda
 * não distingue "ainda vem" de "não vem nunca". A faixa responde as duas coisas
 * sem tirá-lo da tela.
 */
export function FaixaExecucaoBoletim({ execucao }: { execucao: ExecucaoBoletim }) {
  const executando = execucao.situacao === 'EXECUTANDO';
  const agora = useAgora(executando);

  if (executando) {
    const decorrido = duracaoCurta(agora - new Date(execucao.iniciadaEm).getTime());
    const progresso =
      execucao.fontesTotal > 0
        ? ` (${execucao.fontesConcluidas} de ${execucao.fontesTotal} fontes)`
        : '';

    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2.5 rounded-md border border-gold/30 bg-accent-mist px-4 py-3 text-sm text-ink"
      >
        {/* `shrink-0` + texto em `flex-1`: sem isso a frase longa empurra o
            indicador para uma linha só dele, e a faixa perde a leitura de relance. */}
        <span
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-ink/40 border-t-transparent"
        />
        <p className="flex-1">
          Um boletim automático está sendo gerado há {decorrido}
          {progresso}. Ele aparece nesta lista quando ficar pronto.{' '}
          <Link to="/boletim" className="underline">
            Acompanhar
          </Link>
        </p>
      </div>
    );
  }

  // Terminado sem gerar modelo: a lista continua igual, e é justamente isso que
  // precisa de explicação — sem a faixa, a ausência parece um clique perdido.
  if (
    execucao.situacao === 'SEM_NOTICIAS' ||
    execucao.situacao === 'FALHOU' ||
    execucao.situacao === 'TRAVADA'
  ) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 rounded-md border border-alerta/30 bg-alerta-fundo px-4 py-3 text-sm text-ink"
      >
        <span>
          A última geração de boletim ({dataHora(execucao.iniciadaEm)}) não criou modelo:{' '}
          {execucao.situacao === 'SEM_NOTICIAS'
            ? 'nenhuma fonte trouxe notícia.'
            : (execucao.erro ?? 'a geração não chegou ao fim.')}
        </span>
        <Link to="/boletim" className="underline">
          Ver detalhes
        </Link>
      </div>
    );
  }

  return null;
}
