import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, numero, percentual } from '../lib/formato.js';
import {
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TituloPagina,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';

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
    queryFn: () => api.get<Relatorio>(`/relatorios/boletins/${id}`),
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
        to={`/boletins/${r.campaignId}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-suave hover:text-ink hover:underline"
      >
        <span aria-hidden="true">←</span>
        {/* Fora de contexto, "← Nome da campanha" não diz que é um caminho de volta. */}
        <span className="sr-only">Voltar para o boletim </span>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
