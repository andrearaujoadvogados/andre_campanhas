import { useEffect, useRef } from 'react';

/**
 * Diálogo modal mínimo para o criador — o design system do painel não tinha um.
 *
 * `<dialog>` nativo com `showModal()`: foco preso, Esc fechando e fundo inerte
 * vêm do navegador, sem reimplementar a parte difícil de um modal. O `onClose`
 * cobre o Esc; o clique no backdrop fecha porque o formulário interno ocupa o
 * conteúdo e o clique direto no `<dialog>` só acontece fora dele.
 */
export function Dialogo({
  titulo,
  descricao,
  aberto,
  aoFechar,
  largura = 'max-w-xl',
  children,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  aberto: boolean;
  aoFechar: () => void;
  largura?: string;
  children: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (aberto && !el.open) el.showModal();
    if (!aberto && el.open) el.close();
  }, [aberto]);

  if (!aberto) return null;

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === ref.current) aoFechar();
      }}
      className={`m-auto w-[calc(100vw-2rem)] ${largura} rounded-lg border border-line bg-paper-light p-0 shadow-xl backdrop:bg-ink/30`}
    >
      <div className="flex flex-col gap-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-display text-lg text-ink">{titulo}</h2>
          {descricao !== undefined && <p className="mt-1 text-sm text-ink-suave">{descricao}</p>}
        </div>
        {children}
        {acoes !== undefined && (
          <div className="flex flex-wrap items-center justify-end gap-2">{acoes}</div>
        )}
      </div>
    </dialog>
  );
}
