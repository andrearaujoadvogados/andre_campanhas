import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  CAMPANHA_VAZIA,
  FormularioCampanha,
  type DadosCampanha,
} from '../componentes/FormularioCampanha.tsx';
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
  aprovacao: { aprovadoPor: string; aprovadoEm: string } | null;
  /** Devolvido pela API; reenviado na aprovação. Ver `Aprovar`. */
  hashConteudoAtual: string;
  totalDestinatarios?: number;
  /** Quantos já têm registro de envio. Só vem para status que já dispararam. */
  processados?: number;
}

const FILTROS = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'RASCUNHO', rotulo: 'Rascunho' },
  { valor: 'EM_REVISAO', rotulo: 'Em revisão' },
  { valor: 'APROVADA', rotulo: 'Aprovada' },
  { valor: 'AGENDADA', rotulo: 'Agendada' },
  { valor: 'ENVIANDO', rotulo: 'Enviando' },
  { valor: 'PAUSADA', rotulo: 'Pausada' },
  { valor: 'CONCLUIDA', rotulo: 'Concluída' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
] as const;

interface Listagem {
  itens: Campanha[];
  cursor?: string;
  truncado: boolean;
  aviso?: string;
}

export function Campanhas() {
  const [status, definirStatus] = useState('');
  const [criando, definirCriando] = useState(false);
  const [novaCampanha, definirNovaCampanha] = useState<DadosCampanha>(CAMPANHA_VAZIA);
  const qc = useQueryClient();
  const navegar = useNavigate();

  const criar = useMutation({
    mutationFn: () =>
      api.post<Campanha>('/campanhas', {
        ...novaCampanha,
        // Campo opcional: mandar string vazia faria o schema recusar por
        // formato de e-mail inválido.
        ...(novaCampanha.replyTo.trim() === '' ? { replyTo: undefined } : {}),
      }),
    onSuccess: (k) => {
      definirCriando(false);
      definirNovaCampanha(CAMPANHA_VAZIA);
      void qc.invalidateQueries({ queryKey: ['campanhas'] });
      // Vai direto para o detalhe: é lá que se revisa, aprova e dispara.
      navegar(`/campanhas/${k.campaignId}`);
    },
  });

  const campanhas = useQuery({
    queryKey: ['campanhas', status],
    queryFn: () => api.get<Listagem>(`/campanhas${status === '' ? '' : `?status=${status}`}`),
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
          <FormularioCampanha
            valor={novaCampanha}
            aoMudar={definirNovaCampanha}
            aoSalvar={() => criar.mutate()}
            salvando={criar.isPending}
            erro={criar.error}
            rotuloSalvar="Criar campanha"
            aoCancelar={() => {
              definirCriando(false);
              definirNovaCampanha(CAMPANHA_VAZIA);
            }}
          />
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
        {campanhas.data?.itens.length === 0 && (
          <Vazio
            mensagem={
              status === '' ? 'Nenhuma campanha criada ainda.' : 'Nenhuma campanha nesta situação.'
            }
          />
        )}

        <ul className="divide-y divide-line">
          {campanhas.data?.itens.map((c) => (
            <li
              key={c.campaignId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
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
              <Selo tom={tomDoStatusCampanha(c.status)}>
                {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
              </Selo>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

/** Espelha o `EDITAVEIS` da API. A recusa de verdade é lá; aqui é ergonomia. */
const EDITAVEIS = new Set(['RASCUNHO', 'EM_REVISAO', 'APROVADA', 'AGENDADA']);

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

  const campanha = useQuery({
    queryKey: ['campanha', id],
    queryFn: () => api.get<Campanha>(`/campanhas/${id}`),
    // Enquanto está enviando, o progresso muda sozinho — recarrega a cada 5s
    // para a barra andar sem o operador precisar atualizar a página.
    refetchInterval: (q) =>
      (q.state.data as Campanha | undefined)?.status === 'ENVIANDO' ? 5000 : false,
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
            <dt className="text-ink-suave">Aprovação</dt>
            <dd className="text-ink">
              {c.aprovacao === null
                ? '—'
                : `${c.aprovacao.aprovadoPor} em ${dataHora(c.aprovacao.aprovadoEm)}`}
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
      {EDITAVEIS.has(c.status) && !editando && (
        <Cartao titulo="Editar">
          <div className="flex flex-wrap gap-2">
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

            {/**
             * Excluir só rascunho, e só ADMIN. A partir da revisão existe rastro
             * de quem leu; a partir do disparo, registros de envio apontando
             * para a campanha. O backend recusa; aqui nem oferecemos.
             */}
            {c.status === 'RASCUNHO' && ehAdmin && (
              <Botao
                variante="perigo"
                carregando={excluir.isPending}
                onClick={() => {
                  if (window.confirm(`Excluir a campanha "${c.nome}"? Isso não pode ser desfeito.`))
                    excluir.mutate();
                }}
              >
                Excluir rascunho
              </Botao>
            )}
          </div>
          {c.status !== 'RASCUNHO' && (
            <p className="mt-3 text-sm text-ink-suave">
              Editar uma campanha aprovada devolve ela para rascunho: a aprovação valia para o
              conteúdo anterior.
            </p>
          )}
        </Cartao>
      )}

      <Cartao titulo="Ações">
        <div className="flex flex-wrap gap-2">
          {c.status === 'RASCUNHO' && (
            <Botao carregando={executando} onClick={() => acao.mutate({ caminho: '/revisao' })}>
              Enviar para revisão
            </Botao>
          )}

          {c.status === 'EM_REVISAO' && <Aprovar campanha={c} ehAdmin={ehAdmin} />}

          {(c.status === 'APROVADA' || c.status === 'AGENDADA') && (
            <Botao carregando={executando} onClick={() => acao.mutate({ caminho: '/disparo' })}>
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

        {(c.status === 'APROVADA' || c.status === 'AGENDADA') && (
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
 * Aprovação — §5.8 e §10.3.
 *
 * Dois detalhes que, se faltarem, quebram o fluxo inteiro:
 *
 * 1. **Reenviar `hashConteudoAtual`.** O backend compara com o conteúdo no
 *    momento do clique; se alguém editou o modelo entre abrir esta tela e
 *    aprovar, a aprovação é recusada com `CONTEUDO_ALTERADO_APOS_APROVACAO`. Sem
 *    mandar o hash, *toda* aprovação falharia.
 * 2. **Só ADMIN aprova.** Esconder o botão de quem é operador evita o clique
 *    que só produziria um 403 — o controle de verdade é o `exigirPapel` da API.
 */
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
            disparo pode estar travado — cancele a campanha para encerrá-lo e crie uma nova.
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

function Aprovar({ campanha, ehAdmin }: { campanha: Campanha; ehAdmin: boolean }) {
  const qc = useQueryClient();
  const aprovar = useMutation({
    mutationFn: () =>
      api.post<Campanha>(`/campanhas/${campanha.campaignId}/aprovacao`, {
        hashConteudoRevisado: campanha.hashConteudoAtual,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campanha', campanha.campaignId] }),
  });

  if (!ehAdmin) {
    return (
      <Aviso texto="Esta campanha aguarda aprovação de um administrador antes de poder ser disparada." />
    );
  }

  return (
    <div className="w-full space-y-3">
      {/**
       * O autor aprova a própria campanha desde 2026-08-08. A etapa continua
       * existindo, e o que ela protege não é "duas pessoas" — é o conteúdo:
       * a aprovação grava o hash do que foi revisado, e editar template,
       * assunto ou audiência depois a invalida.
       */}
      <p className="text-sm text-ink-suave">
        Aprovar registra o conteúdo exato que será enviado. Se algo mudar depois, a aprovação cai e
        a campanha volta para revisão.
      </p>
      <div className="flex gap-2">
        <Botao carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>
          Aprovar conteúdo
        </Botao>
      </div>
      <ErroCaixa erro={aprovar.error} />
    </div>
  );
}
