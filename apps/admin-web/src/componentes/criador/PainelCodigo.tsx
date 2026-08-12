import { useEffect, useState } from 'react';
import { Code2, RotateCcw } from 'lucide-react';

import { limparHtmlDoUsuario } from '../../lib/criador/codigo.js';
import { gerarCodigoDoDocumento, gerarCodigoDoPedaco } from '../../lib/criador/html.js';
import type { BlockType, EmailDesign } from '../../lib/criador/tipos.js';
import { Dialogo } from './Dialogo.tsx';
import { EditorCodigo } from './EditorCodigo.tsx';

export type AlvoDoCodigo =
  | { tipo: 'documento' }
  | { tipo: 'linha'; id: string }
  | { tipo: 'bloco'; id: string; rotulo: string; blockType: BlockType };

const TITULOS = {
  documento: 'Código do e-mail',
  linha: 'Código da estrutura',
  bloco: 'Código do bloco',
} as const;

/**
 * Editor do HTML de um pedaço do e-mail — ou do e-mail inteiro.
 *
 * O texto que abre é sempre o HTML REAL, compilado pelo mesmo mjml-browser que
 * gera o `corpoHtml` gravado. Mostrar um HTML aproximado seria pior que não
 * mostrar: a pessoa ajustaria um código que não é o que chega na caixa de
 * entrada.
 *
 * Enquanto houver HTML próprio, os controles visuais daquele pedaço não valem
 * mais — e é isso que o aviso diz, no lugar onde a escolha é feita. Voltar é
 * apagar o campo, e o visual assume de novo; por isso o botão de voltar fica
 * aqui do lado, e não escondido.
 */
export function PainelCodigo({
  alvo,
  design,
  htmlProprio,
  onAplicar,
  onVoltarAoGerado,
  onFechar,
}: {
  alvo: AlvoDoCodigo | null;
  design: EmailDesign;
  /** HTML já salvo para este alvo, se houver. */
  htmlProprio: string | null;
  onAplicar: (html: string) => void;
  onVoltarAoGerado: () => void;
  onFechar: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);

  useEffect(() => {
    if (alvo === null) return;
    // Com HTML próprio salvo, é ELE que abre — senão a tela ofereceria o código
    // gerado para quem já escreveu o seu, e salvar apagaria o trabalho.
    if (htmlProprio !== null && htmlProprio !== '') {
      setCodigo(htmlProprio);
      setAvisos([]);
      return;
    }
    // A compilação (mjml-browser v5) é assíncrona; `vivo` descarta o resultado
    // se o painel fechou ou trocou de alvo antes de ela terminar.
    let vivo = true;
    setCarregando(true);
    const gerar =
      alvo.tipo === 'documento'
        ? gerarCodigoDoDocumento(design)
        : gerarCodigoDoPedaco(design, {
            tipo: alvo.tipo === 'linha' ? 'linha' : 'bloco',
            id: alvo.id,
          });
    void gerar.then((r) => {
      if (!vivo) return;
      setCodigo(r.html);
      setAvisos(r.avisos);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
    // `design` de fora não entra nas dependências: reabrir o painel a cada
    // tecla digitada no canvas jogaria fora o código que está sendo escrito
    // aqui dentro. (Este projeto não usa a regra exhaustive-deps.)
  }, [alvo, htmlProprio]);

  if (alvo === null) return null;

  const titulo = alvo.tipo === 'bloco' ? `${TITULOS.bloco}: ${alvo.rotulo}` : TITULOS[alvo.tipo];

  // Bloco de TEXTO absorve o código aplicado (conteúdo + moldura viram o
  // próprio bloco) — os controles seguem valendo. Os demais alvos viram
  // override: o código passa a mandar e os controles daquele pedaço param.
  const absorve = alvo.tipo === 'bloco' && alvo.blockType === 'text';

  const descricao =
    alvo.tipo === 'documento'
      ? 'O e-mail inteiro, como sai do compilador. Editar aqui faz o criador visual parar de mandar no que é enviado.'
      : alvo.tipo === 'linha'
        ? 'A tabela desta estrutura. Editar aqui faz os blocos dentro dela pararem de valer.'
        : absorve
          ? 'O <td> deste bloco. Ao aplicar, o bloco absorve o código — o conteúdo vira o texto do bloco e os controles visuais continuam valendo.'
          : 'O <td> deste bloco. Editar aqui faz os controles do bloco pararem de valer.';

  return (
    <Dialogo
      titulo={titulo}
      descricao={descricao}
      aberto
      aoFechar={onFechar}
      largura="max-w-4xl"
      acoes={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {htmlProprio !== null && htmlProprio !== '' ? (
              <button
                type="button"
                onClick={onVoltarAoGerado}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line px-4 text-sm font-medium text-erro hover:bg-erro-fundo"
              >
                <RotateCcw className="size-4" />
                Voltar ao gerado
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-medium text-ink-suave hover:bg-accent-mist hover:text-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onAplicar(limparHtmlDoUsuario(codigo))}
              disabled={carregando || codigo.trim() === ''}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper-light hover:bg-ink/90 disabled:opacity-60"
            >
              <Code2 className="size-4" />
              Aplicar código
            </button>
          </div>
        </div>
      }
    >
      {htmlProprio !== null && htmlProprio !== '' ? (
        <p className="rounded-md border border-alerta/30 bg-alerta-fundo px-3 py-2 text-xs text-alerta">
          {absorve
            ? 'Este bloco está com HTML próprio de uma versão antiga. Ao aplicar, ele volta a ser um bloco comum, com o código absorvido.'
            : 'Este pedaço já está com HTML próprio. Os controles visuais dele estão desligados até você voltar ao gerado.'}
        </p>
      ) : null}

      {carregando ? (
        <p className="py-24 text-center text-sm text-ink-suave">Compilando o código…</p>
      ) : (
        <EditorCodigo
          value={codigo}
          onChange={setCodigo}
          className="h-[52vh]"
          aria-label={titulo}
        />
      )}

      {avisos.length > 0 ? (
        <p className="text-xs text-ink-suave">Avisos do compilador: {avisos.join(' · ')}</p>
      ) : null}
    </Dialogo>
  );
}
