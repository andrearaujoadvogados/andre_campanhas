import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, dataHora, numero, percentual } from '../lib/formato.js';
import {
  Botao,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TabelaRolavel,
  TituloPagina,
  Vazio,
  classeEntrada,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';

/** Rótulos de status de envio (StatusEnvio do domínio). */
const ROTULO_STATUS_ENVIO: Readonly<Record<string, string>> = {
  PENDENTE: 'Pendente',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  FALHOU: 'Falhou',
  SUPRIMIDO: 'Suprimido',
  CANCELADO: 'Cancelado',
};

interface DestinatarioRelatorio {
  contactId: string;
  nome: string | null;
  email: string | null;
  status: string;
  enviadoEm: string | null;
  falhaMotivo: string | null;
  respondidoEm: string | null;
}

interface RespostaRelatorio {
  contactId: string;
  nome: string | null;
  email: string | null;
  respondidoEm: string | null;
  enviadoEm: string | null;
}

interface Relatorio {
  campaignId: string;
  nome: string;
  status: string;
  contadores: Record<string, number>;
  taxas: Record<string, number>;
  risco: {
    nivel: 'OK' | 'ATENCAO' | 'CRITICO';
    bounce: 'OK' | 'ATENCAO' | 'CRITICO';
    reclamacao: 'OK' | 'ATENCAO' | 'CRITICO';
    avisos: string[];
  };
  baseDeCalculo: Record<string, string>;
}

const NIVEL_TOM = { OK: 'positivo', ATENCAO: 'atencao', CRITICO: 'critico' } as const;

const NIVEL_CAIXA = {
  OK: 'border-line bg-paper-light',
  ATENCAO: 'border-alerta/30 bg-alerta-fundo',
  CRITICO: 'border-erro/30 bg-erro-fundo',
} as const;

const NIVEL_TITULO = {
  OK: 'text-ink-suave',
  ATENCAO: 'text-alerta',
  CRITICO: 'text-erro',
} as const;

/** A gravidade vai escrita. O fundo âmbar e o fundo vermelho são parecidos demais
 *  para carregarem sozinhos a diferença entre "olhe isto" e "pare agora". */
const NIVEL_ROTULO = {
  OK: 'Observação',
  ATENCAO: 'Atenção',
  CRITICO: 'Risco crítico',
} as const;

export function Relatorio() {
  const { id = '' } = useParams();

  const relatorio = useQuery({
    queryKey: ['relatorio', id],
    queryFn: () => api.get<Relatorio>(`/relatorios/campanhas/${id}`),
    // Campanha em andamento muda a cada minuto; sem isso o operador ficaria
    // recarregando a página para saber se avançou.
    refetchInterval: 60_000,
  });

  if (relatorio.isLoading) return <Carregando />;
  if (relatorio.error !== null) return <ErroCaixa erro={relatorio.error} />;

  const r = relatorio.data;
  if (r === undefined) return null;

  return (
    <div className="space-y-6">
      <Link
        to={`/campanhas/${r.campaignId}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-suave hover:text-ink hover:underline"
      >
        <span aria-hidden="true">←</span>
        {/* Fora de contexto, "← Nome da campanha" não diz que é um caminho de volta. */}
        <span className="sr-only">Voltar para a campanha </span>
        {r.nome}
      </Link>

      <TituloPagina
        acao={
          <Selo tom={tomDoStatusCampanha(r.status)}>
            {ROTULO_STATUS_CAMPANHA[r.status] ?? r.status}
          </Selo>
        }
      >
        Relatório
      </TituloPagina>

      {/**
       * O alerta de risco vem primeiro e usa o nível que a **API** calculou.
       *
       * Recalcular aqui criaria duas réguas: a tela poderia dizer "tudo bem"
       * enquanto o alarme do CloudWatch dispara para a agência. Os limiares
       * moram no domínio justamente para que isso não aconteça (§10.4).
       */}
      {r.risco.avisos.length > 0 && (
        <div role="alert" className={`rounded-md border px-4 py-3 ${NIVEL_CAIXA[r.risco.nivel]}`}>
          <p
            className={`flex items-center gap-2 text-sm font-medium ${NIVEL_TITULO[r.risco.nivel]}`}
          >
            <span aria-hidden="true">!</span>
            {NIVEL_ROTULO[r.risco.nivel]}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {r.risco.avisos.map((a, i) => (
              <li key={i} className="text-ink">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Numero rotulo="Enviados" valor={numero(r.contadores['enviados'] ?? 0)} />
        <Numero
          rotulo="Entregues"
          valor={numero(r.contadores['entregues'] ?? 0)}
          detalhe={percentual(r.taxas['entrega'] ?? 0)}
        />
        <Numero
          rotulo="Aberturas únicas"
          valor={numero(r.contadores['aberturasUnicas'] ?? 0)}
          detalhe={percentual(r.taxas['abertura'] ?? 0)}
        />
        <Numero
          rotulo="Cliques únicos"
          valor={numero(r.contadores['cliquesUnicos'] ?? 0)}
          detalhe={percentual(r.taxas['clique'] ?? 0)}
        />
        {/* Conta e-mails respondidos, não mensagens recebidas: quem responde
            três vezes respondeu a um e-mail. */}
        <Numero
          rotulo="Respondidos"
          valor={numero(r.contadores['respostas'] ?? 0)}
          detalhe={percentual(r.taxas['resposta'] ?? 0)}
        />
      </div>

      <Cartao titulo="Saúde do envio">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Indicador
            rotulo="Endereços inválidos"
            valor={percentual(r.taxas['bounceHard'] ?? 0)}
            nivel={r.risco.bounce}
          />
          <Indicador
            rotulo="Marcados como spam"
            valor={percentual(r.taxas['reclamacao'] ?? 0)}
            nivel={r.risco.reclamacao}
          />
          <Indicador
            rotulo="Descadastros"
            valor={percentual(r.taxas['descadastro'] ?? 0)}
            nivel="OK"
          />
        </div>
      </Cartao>

      {/**
       * A base de cada taxa fica visível.
       *
       * "Abertura 42%" não diz se é sobre enviados ou entregues, e os dois
       * números contam histórias diferentes sobre a mesma campanha. A API
       * devolve a explicação; escondê-la seria desperdiçá-la.
       */}
      <Cartao titulo="Como cada taxa é calculada">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(r.baseDeCalculo).map(([chave, formula]) => (
            <div key={chave} className="flex justify-between gap-4">
              <dt className="text-ink-suave">{chave}</dt>
              <dd className="text-right text-ink">{formula}</dd>
            </div>
          ))}
        </dl>
      </Cartao>

      <Cartao titulo="Quem respondeu">
        <TabelaRespostas id={r.campaignId} />
      </Cartao>

      <Cartao titulo="Por destinatário">
        <TabelaDestinatarios id={r.campaignId} />
      </Cartao>
    </div>
  );
}

/**
 * Quem respondeu ao e-mail — §11, item 9.
 *
 * Sem busca nem filtro, ao contrário da tabela de destinatários: a lista de
 * quem respondeu é curta por natureza, e um campo de busca sobre cinco linhas é
 * ruído. Se um dia crescer a ponto de precisar, aí entra.
 */
function TabelaRespostas({ id }: { id: string }) {
  const q = useInfiniteQuery({
    queryKey: ['respostas', id],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.get<{ itens: RespostaRelatorio[]; cursor?: string }>(
        `/relatorios/campanhas/${id}/respostas${pageParam === '' ? '' : `?cursor=${encodeURIComponent(pageParam)}`}`,
      ),
    getNextPageParam: (ultima) => ultima.cursor,
  });

  const itens = (q.data?.pages ?? []).flatMap((p) => p.itens ?? []);

  /**
   * Puxa a próxima página sozinho enquanto nada apareceu.
   *
   * O filtro de resposta roda no servidor **depois** da leitura do bloco: uma
   * página pode voltar vazia e ainda haver respostas adiante. Sem isto, a tela
   * diria "ninguém respondeu" numa campanha que teve respostas — o pior
   * desfecho possível para esta tela em particular. Só continua enquanto está
   * vazio; assim que a primeira resposta aparece, o resto fica no botão.
   */
  useEffect(() => {
    if (itens.length === 0 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [itens.length, q.hasNextPage, q.isFetchingNextPage, q]);

  if (q.isLoading) return <Carregando />;
  if (q.error !== null) return <ErroCaixa erro={q.error} />;

  if (itens.length === 0) {
    return q.hasNextPage ? (
      <Carregando />
    ) : (
      <Vazio mensagem="Nenhum contato respondeu a este e-mail até agora." />
    );
  }

  return (
    <div className="space-y-3">
      <TabelaRolavel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-suave">
              <th className="py-2 pr-3 font-medium">Contato</th>
              <th className="py-2 pr-3 font-medium">Respondeu em</th>
              <th className="py-2 pr-3 font-medium">Recebeu em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {itens.map((d) => (
              <tr key={d.contactId}>
                <td className="py-2 pr-3">
                  <Link
                    to={`/contatos/${d.contactId}`}
                    className="text-ink hover:underline"
                    // A resposta em si está na caixa do escritório, não aqui: o
                    // sistema registra que houve, não o que foi dito.
                  >
                    {d.nome ?? d.email ?? d.contactId}
                  </Link>
                  {d.nome !== null && d.email !== null && (
                    <span className="block text-xs text-ink-suave">{d.email}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-ink">{dataHora(d.respondidoEm)}</td>
                <td className="py-2 pr-3 text-ink-suave">{dataHora(d.enviadoEm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabelaRolavel>

      <p className="text-xs text-ink-suave">
        O conteúdo das respostas não fica no sistema — cada uma é encaminhada para a caixa de e-mail
        do escritório assim que chega.
      </p>

      {q.hasNextPage && (
        <Botao
          variante="secundario"
          carregando={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Carregar mais
        </Botao>
      )}
    </div>
  );
}

/**
 * Tabela por destinatário — §10.
 *
 * O status é o de entrega (enviado/entregue/falhou); abertura e clique por
 * destinatário são eventos e ficam para o modelo de leitura de eventos (as taxas
 * agregadas de abertura/clique estão nos cartões acima). Busca e filtro rodam no
 * cliente sobre o que já foi carregado; "Carregar mais" traz a próxima página.
 */
function TabelaDestinatarios({ id }: { id: string }) {
  const [busca, definirBusca] = useState('');
  const [filtroStatus, definirFiltroStatus] = useState('');

  const q = useInfiniteQuery({
    queryKey: ['destinatarios', id],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.get<{ itens: DestinatarioRelatorio[]; cursor?: string }>(
        `/relatorios/campanhas/${id}/destinatarios${pageParam === '' ? '' : `?cursor=${encodeURIComponent(pageParam)}`}`,
      ),
    getNextPageParam: (ultima) => ultima.cursor,
  });

  if (q.isLoading) return <Carregando />;
  if (q.error !== null) return <ErroCaixa erro={q.error} />;

  const todos = (q.data?.pages ?? []).flatMap((p) => p.itens ?? []);
  const buscaNorm = busca.trim().toLowerCase();
  const itens = todos.filter(
    (d) =>
      (filtroStatus === '' || d.status === filtroStatus) &&
      (buscaNorm === '' ||
        (d.nome ?? '').toLowerCase().includes(buscaNorm) ||
        (d.email ?? '').toLowerCase().includes(buscaNorm)),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => definirBusca(e.target.value)}
          placeholder="Buscar por nome ou e-mail…"
          className={`${classeEntrada} sm:max-w-xs`}
        />
        <select
          value={filtroStatus}
          onChange={(e) => definirFiltroStatus(e.target.value)}
          className={`${classeEntrada} sm:max-w-xs`}
        >
          <option value="">Todos os status</option>
          {Object.entries(ROTULO_STATUS_ENVIO).map(([v, rotulo]) => (
            <option key={v} value={v}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>

      {itens.length === 0 ? (
        <Vazio mensagem="Nenhum registro de envio para este filtro." />
      ) : (
        <TabelaRolavel>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-suave">
                <th className="py-2 pr-3 font-medium">Contato</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Enviado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {itens.map((d) => (
                <tr key={d.contactId}>
                  <td className="py-2 pr-3">
                    <span className="text-ink">{d.nome ?? d.email ?? d.contactId}</span>
                    {d.nome !== null && d.email !== null && (
                      <span className="block text-xs text-ink-suave">{d.email}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-ink">{ROTULO_STATUS_ENVIO[d.status] ?? d.status}</span>
                    {d.falhaMotivo !== null && (
                      <span className="block text-xs text-ink-suave">{d.falhaMotivo}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-ink-suave">{dataHora(d.enviadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabelaRolavel>
      )}

      {q.hasNextPage === true && (
        <Botao
          variante="secundario"
          carregando={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Carregar mais
        </Botao>
      )}
    </div>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-md border border-line bg-paper-light p-4">
      <p className="text-xs text-ink-suave">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{valor}</p>
      {detalhe !== undefined && <p className="text-xs text-ink-suave">{detalhe}</p>}
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  nivel,
}: {
  rotulo: string;
  valor: string;
  nivel: 'OK' | 'ATENCAO' | 'CRITICO';
}) {
  return (
    <div>
      <p className="text-xs text-ink-suave">{rotulo}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-xl font-semibold text-ink">{valor}</span>
        <Selo tom={NIVEL_TOM[nivel]}>
          {nivel === 'OK' ? 'normal' : nivel === 'ATENCAO' ? 'atenção' : 'crítico'}
        </Selo>
      </div>
    </div>
  );
}
