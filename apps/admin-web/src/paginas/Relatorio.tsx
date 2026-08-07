import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, numero, percentual } from '../lib/formato.js';
import { Carregando, Cartao, ErroCaixa, Selo } from '../componentes/base.tsx';

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
      <Link to={`/campanhas/${r.campaignId}`} className="text-sm text-slate-500 hover:underline">
        ← {r.nome}
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Relatório</h1>
        <Selo>{ROTULO_STATUS_CAMPANHA[r.status] ?? r.status}</Selo>
      </div>

      {/**
       * O alerta de risco vem primeiro e usa o nível que a **API** calculou.
       *
       * Recalcular aqui criaria duas réguas: a tela poderia dizer "tudo bem"
       * enquanto o alarme do CloudWatch dispara para a agência. Os limiares
       * moram no domínio justamente para que isso não aconteça (§10.4).
       */}
      {r.risco.avisos.length > 0 && (
        <div
          role="alert"
          className={`rounded-md border px-4 py-3 ${
            r.risco.nivel === 'CRITICO'
              ? 'border-red-300 bg-red-50'
              : r.risco.nivel === 'ATENCAO'
                ? 'border-amber-300 bg-amber-50'
                : 'border-slate-200 bg-slate-50'
          }`}
        >
          <ul className="space-y-1 text-sm">
            {r.risco.avisos.map((a, i) => (
              <li key={i} className="text-slate-900">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
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
        <div className="grid gap-4 sm:grid-cols-3">
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
              <dt className="text-slate-500">{chave}</dt>
              <dd className="text-slate-700">{formula}</dd>
            </div>
          ))}
        </dl>
      </Cartao>
    </div>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{valor}</p>
      {detalhe !== undefined && <p className="text-xs text-slate-500">{detalhe}</p>}
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
      <p className="text-xs text-slate-500">{rotulo}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xl font-semibold text-slate-900">{valor}</span>
        <Selo tom={NIVEL_TOM[nivel]}>
          {nivel === 'OK' ? 'normal' : nivel === 'ATENCAO' ? 'atenção' : 'crítico'}
        </Selo>
      </div>
    </div>
  );
}
