import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  CAMPANHA_VAZIA,
  FormularioCampanha,
  type DadosCampanha,
} from '../componentes/FormularioCampanha.tsx';
import { AssistenteCampanha } from '../componentes/AssistenteCampanha.tsx';
import { Link, useParams } from 'react-router-dom';
import { api, type ComAviso } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, dataHora, numero } from '../lib/formato.js';
import { temPapel, type Usuario } from '../lib/auth.js';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TituloPagina,
  Vazio,
  classeEntrada,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';

export interface Campanha extends ComAviso {
  campaignId: string;
  nome: string;
  tipoEmailId?: string | null;
  status: string;
  templateId: string;
  templateVersao: number;
  listId: string;
  agendadaPara?: string;
  // A API sempre devolveu estes três; o tipo é que não os declarava, e por isso
  // a tela nunca conseguiu mostrar nem editar o remetente.
  remetenteNome: string;
  remetenteEmail: string;
  replyTo?: string;
  criadoPor: string;
  criadoEm: string;
  // Auditoria do disparo — substitui a antiga `aprovacao`.
  enviadaPor: string | null;
  disparadaEm: string | null;
  hashConteudoEnviado: string | null;
  totalDestinatarios?: number;
  /** Quantos já têm registro de envio. Só vem para status que já dispararam. */
  processados?: number;
}

const FILTROS = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'RASCUNHO', rotulo: 'Rascunho' },
  { valor: 'AGENDADA', rotulo: 'Agendada' },
  { valor: 'ENVIANDO', rotulo: 'Enviando' },
  { valor: 'PAUSADA', rotulo: 'Pausada' },
  { valor: 'CONCLUIDA', rotulo: 'Concluída' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
  { valor: 'FALHA', rotulo: 'Falha' },
] as const;

interface Listagem {
  itens: Campanha[];
  cursor?: string;
  truncado: boolean;
  aviso?: string;
}

export function Campanhas() {
  const [status, definirStatus] = useState('');
  const [filtroTipo, definirFiltroTipo] = useState('');
  const [criando, definirCriando] = useState(false);
  const [selecionadas, definirSelecionadas] = useState<Set<string>>(new Set());
  const qcLista = useQueryClient();

  const campanhas = useQuery({
    queryKey: ['campanhas', status],
    queryFn: () => api.get<Listagem>(`/campanhas${status === '' ? '' : `?status=${status}`}`),
  });
  const tipos = useQuery({
    queryKey: ['tipos'],
    queryFn: () => api.get<{ itens: { tipoEmailId: string; nome: string }[] }>('/tipos'),
  });

  const nomeTipo = (id: string | null | undefined): string | undefined =>
    id === null || id === undefined
      ? undefined
      : tipos.data?.itens.find((t) => t.tipoEmailId === id)?.nome;

  // Filtro por tipo roda no cliente sobre a página carregada — o índice do
  // backend é por situação; o tipo é um recorte a mais sobre o que já veio.
  const itens = (campanhas.data?.itens ?? []).filter(
    (c) => filtroTipo === '' || c.tipoEmailId === filtroTipo,
  );

  /**
   * Exclusão em lote.
   *
   * O backend recusa campanha que já enviou (auditoria e relatório apontam para
   * ela) e a que está enviando agora. Isso torna a falha parcial o caso normal,
   * não a exceção: o resultado guarda o nome e o motivo de cada recusa, porque
   * "3 de 5 excluídas" sem dizer quais deixaria o operador tentando de novo às
   * cegas.
   */
  const excluirSelecionadas = useMutation({
    mutationFn: async () => {
      const alvos = itens.filter((c) => selecionadas.has(c.campaignId));
      const resultados = await Promise.allSettled(
        alvos.map((c) => api.delete(`/campanhas/${c.campaignId}`)),
      );
      const recusadas = resultados.flatMap((r, i) =>
        r.status === 'rejected'
          ? [
              {
                nome: alvos[i]?.nome ?? '—',
                motivo: r.reason instanceof Error ? r.reason.message : 'Falha desconhecida.',
              },
            ]
          : [],
      );
      return { total: alvos.length, recusadas };
    },
    onSuccess: () => {
      definirSelecionadas(new Set());
      void qcLista.invalidateQueries({ queryKey: ['campanhas'] });
    },
  });

  const alternarSelecao = (id: string) =>
    definirSelecionadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-6">
      <TituloPagina
        acao={!criando && <Botao onClick={() => definirCriando(true)}>Nova campanha</Botao>}
      >
        Campanhas
      </TituloPagina>

      {criando && (
        <Cartao titulo="Nova campanha">
          <AssistenteCampanha aoCancelar={() => definirCriando(false)} />
        </Cartao>
      )}

      <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            // Qual filtro está ativo não pode ser só o contraste do fundo:
            // `aria-pressed` diz o mesmo a quem usa leitor de tela.
            aria-pressed={status === f.valor}
            onClick={() => definirStatus(f.valor)}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              status === f.valor
                ? 'border-ink bg-ink text-paper-light'
                : 'border-line bg-paper-light text-ink-suave hover:bg-accent-mist hover:text-ink'
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {(tipos.data?.itens.length ?? 0) > 0 && (
        <div>
          <label className="mr-2 text-sm text-ink-suave" htmlFor="filtro-tipo">
            Tipo:
          </label>
          <select
            id="filtro-tipo"
            value={filtroTipo}
            onChange={(e) => definirFiltroTipo(e.target.value)}
            className={`${classeEntrada} inline-block w-auto`}
          >
            <option value="">Todos os tipos</option>
            {tipos.data?.itens.map((t) => (
              <option key={t.tipoEmailId} value={t.tipoEmailId}>
                {t.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {/**
       * O aviso de truncamento vem da API e é exibido, não escondido.
       *
       * A listagem sem filtro mescla oito partições do índice e pode cortar.
       * Mostrar 50 campanhas sem dizer que há mais faria o operador concluir que
       * a lista acabou — que é exatamente o tipo de omissão silenciosa que o
       * backend foi escrito para evitar.
       */}
      <Aviso texto={campanhas.data?.aviso} tom="alerta" />

      <Cartao>
        {campanhas.isLoading && <Carregando />}
        <ErroCaixa erro={campanhas.error} />
        {itens.length === 0 && (
          <Vazio
            mensagem={
              status === '' && filtroTipo === ''
                ? 'Nenhuma campanha criada ainda.'
                : 'Nenhuma campanha para este filtro.'
            }
          />
        )}

        {itens.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={itens.length > 0 && itens.every((c) => selecionadas.has(c.campaignId))}
                onChange={(e) =>
                  definirSelecionadas(
                    e.target.checked ? new Set(itens.map((c) => c.campaignId)) : new Set(),
                  )
                }
              />
              Selecionar todas
            </label>
            {selecionadas.size > 0 && (
              <>
                <span className="text-sm text-ink-suave">{selecionadas.size} selecionada(s)</span>
                <Botao
                  variante="perigo"
                  carregando={excluirSelecionadas.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Excluir ${selecionadas.size} campanha(s)? Isso não pode ser desfeito. As que já enviaram mensagens são mantidas — o relatório e a auditoria apontam para elas.`,
                      )
                    )
                      excluirSelecionadas.mutate();
                  }}
                >
                  Excluir selecionadas
                </Botao>
              </>
            )}
          </div>
        )}

        <ErroCaixa erro={excluirSelecionadas.error} />
        {excluirSelecionadas.data !== undefined &&
          excluirSelecionadas.data.recusadas.length > 0 && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-alerta/30 bg-alerta-fundo px-4 py-3"
            >
              <p className="text-sm font-medium text-alerta">
                {excluirSelecionadas.data.recusadas.length} de {excluirSelecionadas.data.total} não
                foram excluídas:
              </p>
              <ul className="mt-1 space-y-1 text-sm text-ink">
                {excluirSelecionadas.data.recusadas.map((r, i) => (
                  <li key={i}>
                    <strong>{r.nome}</strong> — {r.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

        <ul className="divide-y divide-line">
          {itens.map((c) => (
            <li
              key={c.campaignId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={selecionadas.has(c.campaignId)}
                  onChange={() => alternarSelecao(c.campaignId)}
                  aria-label={`Selecionar ${c.nome}`}
                />
                <div className="min-w-0">
                  <Link
                    to={`/campanhas/${c.campaignId}`}
                    className="inline-flex min-h-11 items-center font-medium break-words text-ink hover:underline"
                  >
                    {c.nome}
                  </Link>
                  <p className="text-xs text-ink-suave">
                    {c.agendadaPara === undefined
                      ? `criada em ${dataHora(c.criadoEm)}`
                      : `agendada para ${dataHora(c.agendadaPara)}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {nomeTipo(c.tipoEmailId) !== undefined && (
                  <Selo tom="neutro">{nomeTipo(c.tipoEmailId)}</Selo>
                )}
                <Selo tom={tomDoStatusCampanha(c.status)}>
                  {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
                </Selo>
              </div>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

/** Espelha o `EDITAVEIS` da API. A recusa de verdade é lá; aqui é ergonomia. */
const EDITAVEIS = new Set(['RASCUNHO', 'AGENDADA']);

export function CampanhaDetalhe({ usuario }: { usuario: Usuario }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [avisoAtual, definirAviso] = useState<string | undefined>(undefined);
  const [quando, definirQuando] = useState('');
  const [editando, definirEditando] = useState(false);
  const [rascunho, definirRascunho] = useState<DadosCampanha>(CAMPANHA_VAZIA);
  const navegar = useNavigate();

  const editar = useMutation({
    mutationFn: () =>
      api.patch<Campanha & ComAviso>(`/campanhas/${id}`, {
        ...rascunho,
        ...(rascunho.replyTo.trim() === '' ? { replyTo: undefined } : {}),
      }),
    onSuccess: (k) => {
      definirEditando(false);
      definirAviso(k.aviso);
      void qc.invalidateQueries({ queryKey: ['campanha', id] });
    },
  });

  const excluir = useMutation({
    mutationFn: () => api.delete(`/campanhas/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campanhas'] });
      navegar('/campanhas');
    },
  });

  const duplicar = useMutation({
    mutationFn: () => api.post<Campanha>(`/campanhas/${id}/duplicacao`),
    onSuccess: (k) => {
      void qc.invalidateQueries({ queryKey: ['campanhas'] });
      // Vai direto para o rascunho novo: é lá que se ajusta e dispara.
      navegar(`/campanhas/${k.campaignId}`);
    },
  });

  const campanha = useQuery({
    queryKey: ['campanha', id],
    queryFn: () => api.get<Campanha>(`/campanhas/${id}`),
    refetchInterval: (q) => {
      const c = q.state.data as Campanha | undefined;
      // Enquanto está enviando, o progresso muda sozinho — recarrega a cada 5s
      // para a barra andar sem o operador precisar atualizar a página.
      if (c?.status === 'ENVIANDO') return 5000;
      /**
       * Disparo acionado, status ainda não virado: recarrega até virar.
       *
       * O disparo é assíncrono em duas etapas. A rota carimba `enviadaPor` e
       * aciona o orquestrador; quem transiciona para ENVIANDO é o launcher,
       * segundos depois. Nessa janela a tela mostrava "Rascunho" com "Disparada
       * por" preenchido e não recarregava — parecia que o clique não tinha
       * funcionado, e o operador disparava de novo. O segundo disparo batia num
       * 409 "Status atual: ENVIANDO", que é a única pista de que o primeiro
       * havia dado certo.
       */
      if (c?.enviadaPor !== null && (c?.status === 'RASCUNHO' || c?.status === 'AGENDADA')) {
        return 3000;
      }
      return false;
    },
  });

  const acao = useMutation({
    mutationFn: (entrada: { caminho: string; corpo?: unknown }) =>
      api.post<Campanha & ComAviso>(`/campanhas/${id}${entrada.caminho}`, entrada.corpo),
    onSuccess: (r) => {
      // O aviso do backend vai para a tela. Ver `Aviso` em componentes/base.
      definirAviso(r.aviso);
      void qc.invalidateQueries({ queryKey: ['campanha', id] });
    },
  });

  if (campanha.isLoading) return <Carregando />;
  if (campanha.error !== null) return <ErroCaixa erro={campanha.error} />;

  const c = campanha.data;
  if (c === undefined) return null;

  const ehAdmin = temPapel(usuario, 'ADMIN');
  const executando = acao.isPending;

  /**
   * O disparo já foi acionado e o launcher ainda não transicionou.
   *
   * `enviadaPor` é carimbado pela rota de disparo (e pela de agendamento); o
   * status só vira ENVIANDO quando o launcher roda. Entre uma coisa e outra, a
   * campanha continua RASCUNHO com o disparo a caminho — oferecer "Disparar
   * agora" aí convida ao clique duplo, que devolve um 409 confuso e faz parecer
   * que nada funcionou.
   *
   * AGENDADA fica de fora: ali `enviadaPor` significa "quem agendou", e soltar o
   * disparo antes do horário é uma ação legítima.
   */
  const disparoEmCurso = c.status === 'RASCUNHO' && c.enviadaPor !== null;

  /**
   * Excluir vale para qualquer campanha que não esteja saindo agora.
   *
   * Não exige mais ADMIN: quem monta gerencia o própria campanha. A trava real é
   * ter registro de envio, e esse número mora no backend — ele recusa e explica
   * (uma campanha já enviada tem auditoria e relatório apontando para ele). Aqui só
   * fica de fora a campanha em pleno envio, que é o que a tela sabe sozinha.
   */
  const podeExcluir = c.status !== 'ENVIANDO';

  return (
    <div className="space-y-6">
      <Link
        to="/campanhas"
        className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
      >
        <span aria-hidden="true" className="mr-1">
          ←
        </span>
        Campanhas
      </Link>

      <TituloPagina
        acao={
          <Selo tom={tomDoStatusCampanha(c.status)}>
            {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
          </Selo>
        }
      >
        {c.nome}
      </TituloPagina>

      <Aviso texto={avisoAtual} tom="alerta" />
      <ErroCaixa erro={acao.error} />
      <ErroCaixa erro={excluir.error} />

      {editando ? (
        <Cartao titulo="Editar campanha">
          <FormularioCampanha
            valor={rascunho}
            aoMudar={definirRascunho}
            aoSalvar={() => editar.mutate()}
            salvando={editar.isPending}
            erro={editar.error}
            rotuloSalvar="Salvar alterações"
            aoCancelar={() => definirEditando(false)}
          />
        </Cartao>
      ) : null}

      {(c.status === 'ENVIANDO' || c.status === 'PAUSADA' || c.status === 'CONCLUIDA') && (
        <Cartao titulo="Progresso do envio">
          <ProgressoEnvio campanha={c} />
        </Cartao>
      )}

      <Cartao titulo="Situação">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-suave">Modelo</dt>
            <dd className="text-ink">
              {c.templateId} <span className="text-ink-suave">versão {c.templateVersao}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-suave">Lista</dt>
            <dd>
              <Link
                to={`/listas/${c.listId}`}
                className="inline-flex min-h-11 items-center text-ink hover:underline"
              >
                {c.listId}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-ink-suave">Agendada para</dt>
            <dd className="text-ink">{dataHora(c.agendadaPara)}</dd>
          </div>
          <div>
            <dt className="text-ink-suave">Disparada por</dt>
            <dd className="text-ink">
              {c.enviadaPor === null
                ? '—'
                : `${c.enviadaPor}${c.disparadaEm === null ? '' : ` em ${dataHora(c.disparadaEm)}`}`}
            </dd>
          </div>
        </dl>
      </Cartao>

      {/**
       * Editar e excluir ficam separados das transições de estado.
       *
       * Misturá-los com "aprovar" e "disparar" convidaria ao clique errado numa
       * fileira de botões — e um deles não tem volta.
       */}
      {!editando && (
        <Cartao titulo={EDITAVEIS.has(c.status) ? 'Editar' : 'Gerenciar'}>
          <div className="flex flex-wrap gap-2">
            {EDITAVEIS.has(c.status) && (
              <Botao
                variante="secundario"
                onClick={() => {
                  definirRascunho({
                    nome: c.nome,
                    templateId: c.templateId,
                    listId: c.listId,
                    remetenteNome: c.remetenteNome,
                    remetenteEmail: c.remetenteEmail,
                    replyTo: c.replyTo ?? '',
                  });
                  definirEditando(true);
                }}
              >
                Editar campanha
              </Botao>
            )}

            {/**
             * Duplicar está sempre disponível, inclusive para campanha já enviada:
             * o caso mais comum é partir do último para montar o próximo. Cria um
             * rascunho novo e leva para ele.
             */}
            <Botao
              variante="secundario"
              carregando={duplicar.isPending}
              onClick={() => duplicar.mutate()}
            >
              Duplicar
            </Botao>

            {/**
             * Excluir qualquer campanha que não esteja enviando.
             *
             * Quem decide de verdade é o backend, que recusa se houver registro
             * de envio — a tela não tem esse número. Oferecer o botão e deixar a
             * recusa explicar o motivo é melhor que esconder a ação: escondida,
             * a impressão é de que campanha antiga nunca sai da lista.
             */}
            {podeExcluir && (
              <Botao
                variante="perigo"
                carregando={excluir.isPending}
                onClick={() => {
                  if (window.confirm(`Excluir a campanha "${c.nome}"? Isso não pode ser desfeito.`))
                    excluir.mutate();
                }}
              >
                Excluir campanha
              </Botao>
            )}
          </div>
          {c.status === 'AGENDADA' && (
            <p className="mt-3 text-sm text-ink-suave">
              A campanha está agendada. Editar aqui atualiza o conteúdo — o disparo continua marcado
              para o horário definido.
            </p>
          )}
        </Cartao>
      )}

      <Cartao titulo="Ações">
        {disparoEmCurso && (
          <p className="mb-3 rounded-md border border-line bg-fundo-suave p-3 text-sm text-ink">
            Disparo acionado — preparando os envios. A tela se atualiza sozinha quando começar a
            sair. <span className="text-ink-suave">Não é preciso disparar de novo.</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(c.status === 'RASCUNHO' || c.status === 'AGENDADA') && !disparoEmCurso && (
            <Botao
              carregando={executando}
              onClick={() => {
                if (
                  window.confirm(
                    `Disparar a campanha "${c.nome}" agora? O envio começa imediatamente e não pode ser desfeito.`,
                  )
                )
                  acao.mutate({ caminho: '/disparo' });
              }}
            >
              Disparar agora
            </Botao>
          )}

          {c.status === 'ENVIANDO' && (
            <Botao
              variante="secundario"
              carregando={executando}
              onClick={() => acao.mutate({ caminho: '/pausa' })}
            >
              Pausar
            </Botao>
          )}

          {c.status === 'PAUSADA' && (
            <Botao carregando={executando} onClick={() => acao.mutate({ caminho: '/retomada' })}>
              Retomar
            </Botao>
          )}

          {/**
           * Botões escondidos por papel são conveniência, não segurança.
           *
           * Qualquer pessoa autenticada monta a requisição à mão; quem barra é o
           * `exigirPapel` do backend. Esconder aqui evita o clique que resultaria
           * num 403 sem explicação.
           */}
          {ehAdmin && c.status !== 'CONCLUIDA' && c.status !== 'CANCELADA' && (
            <Botao
              variante="perigo"
              carregando={executando}
              onClick={() => acao.mutate({ caminho: '/cancelamento' })}
            >
              Cancelar campanha
            </Botao>
          )}
        </div>

        {(c.status === 'RASCUNHO' || c.status === 'AGENDADA') && (
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Campo rotulo="Agendar para" ajuda="Horário de Brasília.">
                <input
                  type="datetime-local"
                  value={quando}
                  onChange={(e) => definirQuando(e.target.value)}
                  className={classeEntrada}
                />
              </Campo>
            </div>
            <Botao
              variante="secundario"
              disabled={quando === ''}
              carregando={executando}
              onClick={() =>
                acao.mutate({
                  caminho: '/agendamento',
                  corpo: { agendadaPara: new Date(quando).toISOString() },
                })
              }
            >
              Agendar
            </Botao>
          </div>
        )}
      </Cartao>

      <Link
        to={`/relatorios/${c.campaignId}`}
        className="inline-flex min-h-11 items-center text-sm text-ink hover:underline"
      >
        Ver relatório desta campanha
        <span aria-hidden="true" className="ml-1">
          →
        </span>
      </Link>
    </div>
  );
}

/**
 * Progresso do disparo — "processados de N".
 *
 * Existe por um motivo concreto: uma campanha ficou presa em "ENVIANDO" e a
 * tela não dizia nada além do status. O operador não tinha como saber se o
 * envio estava a meio caminho ou parado em zero, e o diagnóstico exigiu abrir o
 * CloudShell. Com este número na tela, um disparo travado se denuncia sozinho.
 *
 * Enquanto está ENVIANDO, a query se atualiza sozinha a cada 5s — sem isso, o
 * operador ficaria recarregando a página para ver a barra andar.
 */
function ProgressoEnvio({ campanha }: { campanha: Campanha }) {
  const total = campanha.totalDestinatarios ?? 0;
  const feitos = campanha.processados ?? 0;
  const fracao = total > 0 ? Math.min(1, feitos / total) : 0;
  const parado = campanha.status === 'ENVIANDO' && total > 0 && feitos === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink">
          <span className="text-lg font-semibold">{numero(feitos)}</span>
          <span className="text-ink-suave"> de {numero(total)} processados</span>
        </p>
        {total > 0 && <p className="text-sm text-ink-suave">{Math.round(fracao * 100)}%</p>}
      </div>

      {/* Barra decorativa: o número acima é a informação; a barra é reforço
          visual, por isso aria-hidden. */}
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${Math.round(fracao * 100)}%` }}
        />
      </div>

      {parado && (
        <div role="alert" className="rounded-md border border-alerta/30 bg-alerta-fundo px-4 py-3">
          <p className="text-sm text-alerta">
            Nenhum destinatário foi processado ainda. Se isto persistir por alguns minutos, o
            disparo pode estar travado — cancele a campanha para encerrá-lo e crie um novo.
          </p>
        </div>
      )}

      {campanha.status === 'CONCLUIDA' && (
        <p className="text-sm text-ink-suave">
          Disparo concluído. As taxas de entrega, abertura e clique estão no relatório.
        </p>
      )}
    </div>
  );
}
