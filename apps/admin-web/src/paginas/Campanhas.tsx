import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, type ComAviso } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, dataHora } from '../lib/formato.js';
import { temPapel, type Usuario } from '../lib/auth.js';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
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
  criadoPor: string;
  criadoEm: string;
  aprovacao: { aprovadoPor: string; aprovadoEm: string } | null;
  /** Devolvido pela API; reenviado na aprovação. Ver `Aprovar`. */
  hashConteudoAtual: string;
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

  const campanhas = useQuery({
    queryKey: ['campanhas', status],
    queryFn: () => api.get<Listagem>(`/campanhas${status === '' ? '' : `?status=${status}`}`),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Campanhas</h1>

      <div className="flex flex-wrap gap-1">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => definirStatus(f.valor)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              status === f.valor
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
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

        <ul className="divide-y divide-slate-100">
          {campanhas.data?.itens.map((c) => (
            <li key={c.campaignId} className="flex items-center justify-between py-3">
              <div>
                <Link
                  to={`/campanhas/${c.campaignId}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {c.nome}
                </Link>
                <p className="text-xs text-slate-500">
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

export function CampanhaDetalhe({ usuario }: { usuario: Usuario }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [avisoAtual, definirAviso] = useState<string | undefined>(undefined);
  const [quando, definirQuando] = useState('');

  const campanha = useQuery({
    queryKey: ['campanha', id],
    queryFn: () => api.get<Campanha>(`/campanhas/${id}`),
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
      <Link to="/campanhas" className="text-sm text-slate-500 hover:underline">
        ← Campanhas
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{c.nome}</h1>
        <Selo tom={tomDoStatusCampanha(c.status)}>
          {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
        </Selo>
      </div>

      <Aviso texto={avisoAtual} tom="alerta" />
      <ErroCaixa erro={acao.error} />

      <Cartao titulo="Situação">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Modelo</dt>
            <dd>
              {c.templateId} <span className="text-slate-500">versão {c.templateVersao}</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Lista</dt>
            <dd>
              <Link to={`/listas/${c.listId}`} className="hover:underline">
                {c.listId}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Agendada para</dt>
            <dd>{dataHora(c.agendadaPara)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Aprovação</dt>
            <dd>
              {c.aprovacao === null
                ? '—'
                : `${c.aprovacao.aprovadoPor} em ${dataHora(c.aprovacao.aprovadoEm)}`}
            </dd>
          </div>
        </dl>
      </Cartao>

      <Cartao titulo="Ações">
        <div className="flex flex-wrap gap-2">
          {c.status === 'RASCUNHO' && (
            <Botao carregando={executando} onClick={() => acao.mutate({ caminho: '/revisao' })}>
              Enviar para revisão
            </Botao>
          )}

          {c.status === 'EM_REVISAO' && (
            <Aprovar campanha={c} ehAdmin={ehAdmin} usuario={usuario} />
          )}

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
          <div className="mt-5 flex items-end gap-3 border-t border-slate-100 pt-4">
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

      <Link to={`/relatorios/${c.campaignId}`} className="inline-block text-sm hover:underline">
        Ver relatório desta campanha →
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
 * 2. **O autor não aprova a própria campanha.** O domínio recusa, mas avisar
 *    aqui evita o clique que só produziria um 409.
 */
function Aprovar({
  campanha,
  ehAdmin,
  usuario,
}: {
  campanha: Campanha;
  ehAdmin: boolean;
  usuario: Usuario;
}) {
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

  const ehAutor = campanha.criadoPor === usuario.email;

  return (
    <div className="w-full space-y-3">
      {ehAutor && (
        <Aviso
          tom="alerta"
          texto="Você criou esta campanha. Quem cria não pode aprovar — peça a outro administrador."
        />
      )}
      <div className="flex gap-2">
        <Botao disabled={ehAutor} carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>
          Aprovar conteúdo
        </Botao>
      </div>
      <ErroCaixa erro={aprovar.error} />
    </div>
  );
}
