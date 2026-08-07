import type { ReactNode } from 'react';
import { FalhaApi } from '../lib/api.js';

// ── Botão ────────────────────────────────────────────────────────────────────

type VarianteBotao = 'primario' | 'secundario' | 'perigo';

const ESTILO_BOTAO: Record<VarianteBotao, string> = {
  primario: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
  secundario:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  perigo: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
};

export function Botao({
  variante = 'primario',
  carregando = false,
  children,
  ...resto
}: {
  variante?: VarianteBotao;
  carregando?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      disabled={resto.disabled === true || carregando}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${ESTILO_BOTAO[variante]} ${resto.className ?? ''}`}
    >
      {carregando ? 'Aguarde…' : children}
    </button>
  );
}

// ── Campo de formulário ──────────────────────────────────────────────────────

export function Campo({
  rotulo,
  ajuda,
  erro,
  obrigatorio = false,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  erro?: string;
  obrigatorio?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-800">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-red-700">*</span>}
      </span>
      {ajuda !== undefined && <span className="mt-0.5 block text-xs text-slate-500">{ajuda}</span>}
      <div className="mt-1">{children}</div>
      {erro !== undefined && (
        <span role="alert" className="mt-1 block text-xs font-medium text-red-700">
          {erro}
        </span>
      )}
    </label>
  );
}

export const classeEntrada =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

// ── Aviso ────────────────────────────────────────────────────────────────────

/**
 * Exibe os campos `aviso` que a API devolve.
 *
 * A pausa que não é retroativa, a nova versão de template que invalida
 * aprovações, o link de exportação que expira em 5 minutos — cada um desses
 * avisos existe porque alguém decidiu que o operador precisa saber. Descartá-los
 * aqui anularia a decisão tomada no backend.
 */
export function Aviso({
  texto,
  tom = 'info',
}: {
  texto?: string | undefined;
  tom?: 'info' | 'alerta';
}) {
  if (texto === undefined || texto === '') return null;

  const estilo =
    tom === 'alerta'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <div role="status" className={`rounded-md border px-4 py-3 text-sm ${estilo}`}>
      {texto}
    </div>
  );
}

// ── Erro ─────────────────────────────────────────────────────────────────────

export function ErroCaixa({ erro }: { erro: unknown }) {
  if (erro === null || erro === undefined) return null;

  const falha = erro instanceof FalhaApi ? erro : null;
  const mensagem = falha?.message ?? (erro instanceof Error ? erro.message : String(erro));

  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm">
      <p className="font-medium text-red-900">{mensagem}</p>
      {falha?.erro.correlationId !== undefined && (
        <p className="mt-1 text-xs text-red-800">
          {/* Sem este código, um chamado de suporte vira adivinhação. */}
          Código para o suporte: <code>{falha.erro.correlationId}</code>
        </p>
      )}
    </div>
  );
}

// ── Selo ─────────────────────────────────────────────────────────────────────

type TomSelo = 'neutro' | 'positivo' | 'atencao' | 'critico';

const ESTILO_SELO: Record<TomSelo, string> = {
  neutro: 'bg-slate-100 text-slate-700',
  positivo: 'bg-emerald-100 text-emerald-800',
  atencao: 'bg-amber-100 text-amber-900',
  critico: 'bg-red-100 text-red-900',
};

export function Selo({ tom = 'neutro', children }: { tom?: TomSelo; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTILO_SELO[tom]}`}
    >
      {children}
    </span>
  );
}

export function tomDoStatusCampanha(status: string): TomSelo {
  if (status === 'CONCLUIDA') return 'positivo';
  if (status === 'ENVIANDO' || status === 'AGENDADA') return 'atencao';
  if (status === 'CANCELADA') return 'critico';
  return 'neutro';
}

export function tomDoStatusContato(status: string): TomSelo {
  if (status === 'ATIVO') return 'positivo';
  if (status === 'DESCADASTRADO' || status === 'OPOSICAO') return 'atencao';
  if (status === 'BOUNCE' || status === 'RECLAMACAO' || status === 'SUPRIMIDO') return 'critico';
  return 'neutro';
}

// ── Estruturais ──────────────────────────────────────────────────────────────

export function Cartao({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {titulo !== undefined && (
        <h2 className="mb-4 text-base font-semibold text-slate-900">{titulo}</h2>
      )}
      {children}
    </section>
  );
}

export function Vazio({ mensagem }: { mensagem: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{mensagem}</p>;
}

export function Carregando() {
  return <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>;
}
