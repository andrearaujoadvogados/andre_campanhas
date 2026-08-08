import type { ReactNode } from 'react';
import { FalhaApi } from '../lib/api.js';

/**
 * Componentes compartilhados do painel.
 *
 * Seguem o design system do site do escritório — as cores e a tipografia estão
 * em `index.css`, com os mesmos nomes que o site usa. O que **não** é herdado é
 * a densidade: o site respira porque é peça de comunicação; isto é ferramenta de
 * trabalho, usada por horas seguidas, e espaço demais vira rolagem demais.
 *
 * Três regras que valem para tudo aqui:
 *
 * 1. **Alvo de toque de 44px** em qualquer coisa clicável. É o mínimo que o
 *    WCAG 2.1 pede (2.5.5) e a diferença entre usável e frustrante no celular.
 * 2. **Cor nunca é o único sinal.** Selo tem texto, erro tem ícone e papel, campo
 *    obrigatório tem asterisco *e* `required`. Quem não distingue vermelho de
 *    verde — 8% dos homens — precisa da mesma informação.
 * 3. **O foco é visível.** O anel está declarado uma vez no `index.css`, e não
 *    se remove localmente.
 */

// ── Botão ────────────────────────────────────────────────────────────────────

type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'discreto';

const ESTILO_BOTAO: Record<VarianteBotao, string> = {
  primario: 'bg-ink text-paper-light hover:bg-ink/90 disabled:bg-ink/40',
  secundario:
    'bg-paper-light text-ink border border-line hover:bg-accent-mist disabled:text-ink-suave/50',
  // Vinho é a cor da marca e, aqui, a de ação sem volta. Não compete com o
  // vermelho de erro, que é outro tom e outro papel.
  perigo: 'bg-wine text-paper-light hover:bg-wine-escuro disabled:bg-wine/40',
  discreto: 'text-ink-suave hover:bg-accent-mist hover:text-ink',
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
  const desabilitado = resto.disabled === true || carregando;

  return (
    <button
      type="button"
      {...resto}
      disabled={desabilitado}
      // Anuncia a espera a quem usa leitor de tela — trocar o rótulo por
      // "Aguarde…" sozinho não informa que a ação está em andamento.
      aria-busy={carregando}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${ESTILO_BOTAO[variante]} ${resto.className ?? ''}`}
    >
      {carregando && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {carregando ? 'Aguarde…' : children}
    </button>
  );
}

// ── Campo de formulário ──────────────────────────────────────────────────────

/**
 * O `<label>` envolve o controle, o que já cria a associação exigida pelo WCAG
 * sem depender de `id` — e `id` gerado à mão é a fonte clássica de rótulo
 * apontando para o campo errado depois de um copiar e colar.
 */
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
      <span className="text-sm font-medium text-ink">
        {rotulo}
        {obrigatorio && (
          <>
            <span aria-hidden="true" className="ml-1 text-wine">
              *
            </span>
            <span className="sr-only"> (obrigatório)</span>
          </>
        )}
      </span>
      {ajuda !== undefined && <span className="mt-0.5 block text-xs text-ink-suave">{ajuda}</span>}
      <div className="mt-1.5">{children}</div>
      {erro !== undefined && (
        <span role="alert" className="mt-1.5 block text-xs font-medium text-erro">
          {erro}
        </span>
      )}
    </label>
  );
}

export const classeEntrada =
  'w-full min-h-11 rounded-md border border-line bg-paper-light px-3 py-2 text-sm text-ink placeholder:text-ink-suave/60 focus:border-gold focus:outline-none';

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
      ? 'border-alerta/30 bg-alerta-fundo text-alerta'
      : 'border-gold/30 bg-accent-mist text-gold';

  return (
    <div role="status" className={`flex gap-2.5 rounded-md border px-4 py-3 text-sm ${estilo}`}>
      <span aria-hidden="true" className="mt-px font-semibold">
        {tom === 'alerta' ? '!' : 'i'}
      </span>
      <p>{texto}</p>
    </div>
  );
}

// ── Erro ─────────────────────────────────────────────────────────────────────

export function ErroCaixa({ erro }: { erro: unknown }) {
  if (erro === null || erro === undefined) return null;

  const falha = erro instanceof FalhaApi ? erro : null;
  const mensagem = falha?.message ?? (erro instanceof Error ? erro.message : String(erro));

  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm"
    >
      <span aria-hidden="true" className="mt-px font-semibold text-erro">
        !
      </span>
      <div>
        <p className="font-medium text-erro">{mensagem}</p>
        {falha?.erro.correlationId !== undefined && (
          <p className="mt-1 text-xs text-erro/80">
            {/* Sem este código, um chamado de suporte vira adivinhação. */}
            Código para o suporte: <code className="font-mono">{falha.erro.correlationId}</code>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Selo ─────────────────────────────────────────────────────────────────────

type TomSelo = 'neutro' | 'positivo' | 'atencao' | 'critico';

const ESTILO_SELO: Record<TomSelo, string> = {
  neutro: 'bg-accent-mist text-gold',
  positivo: 'bg-sucesso-fundo text-sucesso',
  atencao: 'bg-alerta-fundo text-alerta',
  critico: 'bg-erro-fundo text-erro',
};

export function Selo({ tom = 'neutro', children }: { tom?: TomSelo; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ESTILO_SELO[tom]}`}
    >
      {/* O ponto reforça o estado sem depender de distinguir os tons. */}
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
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
    <section className="rounded-md border border-line bg-paper-light p-4 sm:p-5">
      {titulo !== undefined && (
        <h2 className="mb-4 font-display text-lg font-medium text-ink">{titulo}</h2>
      )}
      {children}
    </section>
  );
}

/** Título de página, com a serifada do escritório. */
export function TituloPagina({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-medium tracking-tight text-ink">{children}</h1>
      {acao}
    </div>
  );
}

/**
 * Tabela que não estoura no celular.
 *
 * A rolagem horizontal fica **dentro** deste contêiner, e não no corpo da
 * página: página que rola de lado torna toda a navegação escorregadia, e o
 * usuário perde a coluna da esquerda sem entender por quê.
 */
export function TabelaRolavel({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <div className="inline-block min-w-full px-4 align-middle sm:px-0">{children}</div>
    </div>
  );
}

export function Vazio({ mensagem }: { mensagem: string }) {
  return (
    <p className="py-10 text-center text-sm text-ink-suave" role="status">
      {mensagem}
    </p>
  );
}

export function Carregando() {
  return (
    <p className="py-10 text-center text-sm text-ink-suave" role="status" aria-live="polite">
      Carregando…
    </p>
  );
}
