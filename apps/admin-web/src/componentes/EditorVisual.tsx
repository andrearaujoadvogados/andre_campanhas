import { useEffect, useRef, useState } from 'react';
import grapesjs, { type Editor } from 'grapesjs';
import pluginMjml from 'grapesjs-mjml';
import 'grapesjs/dist/css/grapes.min.css';
import './editor-visual.css';
import { BLOCOS, ESTRUTURAS, type DefinicaoBloco } from './editor-blocos.js';

/**
 * Criador de e-mails — arrastar e soltar, §8 do briefing.
 *
 * A moldura é toda nossa: os painéis do GrapesJS ficam desligados
 * (`panels.defaults: []`) e os gerenciadores são montados em contêineres que
 * este componente desenha. É o que permite reproduzir o layout de referência
 * (barra com nome/categoria/salvar, linha de desfazer-refazer-código, canvas à
 * esquerda e coluna de Conteúdo/Configurações à direita) com as cores do
 * escritório, em vez do tema escuro da biblioteca.
 *
 * O preset MJML continua responsável pelos componentes e pela compilação
 * MJML→HTML; a vitrine de estruturas e blocos é definida em `editor-blocos.ts`,
 * para os rótulos saírem em português e na ordem da referência.
 *
 * Pesado por natureza (GrapesJS + mjml-browser), então quem usa carrega com
 * `lazy()`.
 */
export interface SaidaEditorVisual {
  /** Project data do GrapesJS, em JSON — é o que permite reabrir e continuar. */
  readonly estruturaVisual: string;
  /** HTML final compilado do MJML — é o que a campanha envia. */
  readonly corpoHtml: string;
}

/**
 * Extrai o HTML compilado.
 *
 * O preset expõe `mjml-get-code`, que devolve `{ html, mjml }` já compilado. O
 * `getHtml()` é a rede de segurança: se uma versão futura do preset mudar o
 * nome do comando, o save continua gravando conteúdo em vez de gravar vazio em
 * silêncio — falha que só apareceria no disparo.
 */
function compilar(editor: Editor): string {
  try {
    const r = editor.Commands.run('mjml-get-code') as { html?: string } | undefined;
    if (r !== undefined && typeof r.html === 'string' && r.html !== '') return r.html;
  } catch {
    // cai para o getHtml abaixo
  }
  return editor.getHtml();
}

/** Estrutura mínima de um e-mail em branco — o "começar do zero". */
const MJML_EM_BRANCO = `<mjml><mj-body><mj-section><mj-column>
<mj-text>Olá {{contato.primeiroNome}},</mj-text>
</mj-column></mj-section></mj-body></mjml>`;

/** Módulo salvo: um trecho reutilizável, guardado no navegador do escritório. */
interface Modulo {
  readonly id: string;
  readonly nome: string;
  readonly mjml: string;
}

const CHAVE_MODULOS = 'emailmkt:modulos';

function lerModulos(): Modulo[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_MODULOS);
    return bruto === null ? [] : (JSON.parse(bruto) as Modulo[]);
  } catch {
    return [];
  }
}

function gravarModulos(modulos: readonly Modulo[]): void {
  try {
    window.localStorage.setItem(CHAVE_MODULOS, JSON.stringify(modulos));
  } catch {
    // Sem espaço ou modo privado: o editor continua funcionando sem módulos.
  }
}

type Aba = 'conteudo' | 'globais';

export function EditorVisual({
  estruturaInicial,
  htmlInicial,
  aoMudar,
  aoPedirHtml,
  nome,
  aoMudarNome,
  categoria,
  aoMudarCategoria,
  assunto,
  aoMudarAssunto,
  aoSalvar,
  salvando = false,
  rotuloSalvar = 'Salvar modelo',
  aoVoltar,
}: {
  estruturaInicial?: string;
  /** HTML de partida quando não há estrutura salva — ex.: veio do modo código. */
  htmlInicial?: string;
  aoMudar: (saida: SaidaEditorVisual) => void;
  /** "Editar como HTML": entrega o HTML atual a quem hospeda. */
  aoPedirHtml?: (html: string) => void;
  nome: string;
  aoMudarNome: (v: string) => void;
  categoria?: string;
  aoMudarCategoria?: (v: string) => void;
  assunto?: string;
  aoMudarAssunto?: (v: string) => void;
  aoSalvar?: () => void;
  salvando?: boolean;
  rotuloSalvar?: string;
  aoVoltar?: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocosRef = useRef<HTMLDivElement>(null);
  const estilosRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const [aba, definirAba] = useState<Aba>('conteudo');
  const [codigoAberto, definirCodigoAberto] = useState(false);
  const [codigo, definirCodigo] = useState('');
  const [modulos, definirModulos] = useState<Modulo[]>(() => lerModulos());
  const [buscaModulo, definirBuscaModulo] = useState('');

  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  useEffect(() => {
    const container = canvasRef.current;
    if (container === null) return;

    const editor = grapesjs.init({
      container,
      height: '100%',
      width: 'auto',
      fromElement: false,
      storageManager: false,
      plugins: [pluginMjml],
      panels: { defaults: [] },
      blockManager: { appendTo: blocosRef.current ?? undefined },
      styleManager: { appendTo: estilosRef.current ?? undefined },
      traitManager: { appendTo: traitsRef.current ?? undefined },
    });
    editorRef.current = editor;

    /**
     * A vitrine é substituída, não somada.
     *
     * O preset instala os próprios blocos, em inglês e noutra ordem. Limpar
     * antes de adicionar os nossos evita a lista duplicada — "Text" e "Texto"
     * lado a lado — que é o tipo de detalhe que denuncia ferramenta remendada.
     */
    editor.BlockManager.getAll().reset();
    for (const b of [...ESTRUTURAS, ...BLOCOS] as DefinicaoBloco[]) {
      editor.BlockManager.add(b.id, {
        label: b.label,
        category: { id: b.category, label: b.category, open: true },
        content: b.content,
        media: b.media,
        attributes: b.attributes,
      });
    }

    // Ponto de partida: estrutura salva > HTML herdado > e-mail em branco.
    if (estruturaInicial !== undefined && estruturaInicial !== '') {
      try {
        editor.loadProjectData(JSON.parse(estruturaInicial));
      } catch {
        editor.setComponents(MJML_EM_BRANCO);
      }
    } else if (htmlInicial !== undefined && htmlInicial !== '') {
      /**
       * Veio do modo código: o canvas só entende MJML, então o HTML entra
       * embrulhado num `mj-text`. Preserva o que já estava escrito em vez de
       * descartá-lo, e o operador remonta com os blocos.
       */
      editor.setComponents(
        `<mjml><mj-body><mj-section><mj-column><mj-text>${htmlInicial}</mj-text></mj-column></mj-section></mj-body></mjml>`,
      );
    } else {
      editor.setComponents(MJML_EM_BRANCO);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const emitir = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        aoMudarRef.current({
          estruturaVisual: JSON.stringify(editor.getProjectData()),
          corpoHtml: compilar(editor),
        });
      }, 400);
    };
    editor.on('update', emitir);
    // Emite no init: sem isto, um e-mail montado e salvo sem edição posterior
    // chegaria vazio ao formulário.
    emitir();

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      editor.destroy();
      editorRef.current = null;
    };
    // Init único, de propósito — o estado vive dentro do GrapesJS.
  }, []);

  const comando = (nome: string) => () => editorRef.current?.Commands.run(nome);

  const abrirCodigo = () => {
    const ed = editorRef.current;
    if (ed === null) return;
    definirCodigo(compilar(ed));
    definirCodigoAberto(true);
  };

  /** Guarda o bloco selecionado como módulo reutilizável. */
  const salvarModulo = () => {
    const ed = editorRef.current;
    const selecionado = ed?.getSelected();
    if (ed === undefined || ed === null || selecionado === undefined) return;

    const nomeModulo = window.prompt('Nome do módulo:');
    if (nomeModulo === null || nomeModulo.trim() === '') return;

    const novo: Modulo = {
      id: `m-${String(modulos.length + 1)}-${nomeModulo.trim().toLowerCase().replace(/\s+/g, '-')}`,
      nome: nomeModulo.trim(),
      mjml: selecionado.toHTML(),
    };
    const proximos = [...modulos, novo];
    definirModulos(proximos);
    gravarModulos(proximos);
  };

  const removerModulo = (id: string) => {
    const proximos = modulos.filter((m) => m.id !== id);
    definirModulos(proximos);
    gravarModulos(proximos);
  };

  const inserirModulo = (m: Modulo) => {
    const ed = editorRef.current;
    if (ed === null) return;
    // Acrescenta ao corpo: inserir "dentro do selecionado" quebraria quando o
    // selecionado não aceita filhos (um texto, por exemplo).
    ed.getWrapper()?.append(m.mjml);
  };

  const modulosFiltrados = modulos.filter((m) =>
    m.nome.toLowerCase().includes(buscaModulo.trim().toLowerCase()),
  );

  return (
    <div className="editor-visual flex min-h-[720px] flex-col rounded-md border border-line bg-paper">
      {/* ── Barra superior ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper-light px-4 py-3">
        {aoVoltar !== undefined && (
          <button
            type="button"
            onClick={aoVoltar}
            aria-label="Voltar"
            className="inline-flex size-11 items-center justify-center rounded-md text-ink-suave hover:bg-accent-mist hover:text-ink"
          >
            <span aria-hidden="true">←</span>
          </button>
        )}

        <input
          value={nome}
          onChange={(e) => aoMudarNome(e.target.value)}
          placeholder="Nome do modelo"
          aria-label="Nome do modelo"
          className="h-11 w-56 rounded-md border border-line bg-paper-light px-3 text-sm text-ink"
        />

        {aoMudarCategoria !== undefined && (
          <input
            value={categoria ?? ''}
            onChange={(e) => aoMudarCategoria(e.target.value)}
            placeholder="Categoria"
            aria-label="Categoria"
            className="h-11 w-40 rounded-md border border-line bg-paper-light px-3 text-sm text-ink"
          />
        )}

        {aoMudarAssunto !== undefined && (
          <input
            value={assunto ?? ''}
            onChange={(e) => aoMudarAssunto(e.target.value)}
            placeholder="Assunto do e-mail"
            aria-label="Assunto do e-mail"
            className="h-11 w-64 rounded-md border border-line bg-paper-light px-3 text-sm text-ink"
          />
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={comando('preview')}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gold px-4 text-sm font-medium text-gold transition-colors hover:bg-accent-mist"
          >
            Pré-visualizar
          </button>
          {aoSalvar !== undefined && (
            <button
              type="button"
              onClick={aoSalvar}
              disabled={salvando}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper-light transition-colors hover:bg-ink/90 disabled:opacity-60"
            >
              {salvando ? 'Salvando…' : rotuloSalvar}
            </button>
          )}
        </div>
      </div>

      {/* ── Desfazer / Refazer / Código ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line bg-paper-light px-4 py-2">
        <BotaoBarra onClick={comando('core:undo')}>↶ Desfazer</BotaoBarra>
        <BotaoBarra onClick={comando('core:redo')}>↷ Refazer</BotaoBarra>
        <BotaoBarra onClick={abrirCodigo}>{'</> Código do e-mail'}</BotaoBarra>
      </div>

      {/* ── Canvas + painel ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="min-h-[480px] flex-1 p-4">
          <div
            ref={canvasRef}
            className="h-full min-h-[440px] overflow-hidden rounded-lg border border-line bg-paper-light"
          />
        </div>

        <div className="flex w-full shrink-0 flex-col border-t border-line bg-paper-light lg:w-80 lg:border-t-0 lg:border-l">
          <div role="tablist" aria-label="Painel do editor" className="flex border-b border-line">
            {(
              [
                ['conteudo', 'Conteúdo'],
                ['globais', 'Configurações globais'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={aba === valor}
                onClick={() => definirAba(valor)}
                className={`min-h-11 flex-1 px-2 text-sm font-medium transition-colors ${
                  aba === valor
                    ? 'border-b-2 border-gold text-ink'
                    : 'text-ink-suave hover:text-ink'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {/* Os dois painéis ficam montados e só alternam visibilidade:
              desmontar arrancaria os contêineres em que o GrapesJS injetou os
              gerenciadores, e eles não voltariam. */}
          <div className="flex-1 overflow-y-auto">
            <div hidden={aba !== 'conteudo'}>
              {/* Estruturas e Blocos — vitrine do GrapesJS, categorias abertas. */}
              <div ref={blocosRef} />

              {/* Módulos */}
              <div className="border-t border-line">
                <p className="px-3 pt-3 text-sm font-semibold text-ink">Módulos</p>
                <div className="p-3">
                  <input
                    value={buscaModulo}
                    onChange={(e) => definirBuscaModulo(e.target.value)}
                    placeholder="Nome do módulo…"
                    aria-label="Buscar módulo"
                    className="h-10 w-full rounded-md border border-line bg-paper-light px-3 text-sm text-ink"
                  />
                  <button
                    type="button"
                    onClick={salvarModulo}
                    className="mt-2 min-h-11 w-full rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-accent-mist"
                  >
                    Salvar bloco selecionado como módulo
                  </button>

                  <ul className="mt-2 space-y-1">
                    {modulosFiltrados.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 rounded-md border border-line px-2 py-1"
                      >
                        <span className="flex-1 truncate text-sm text-ink">{m.nome}</span>
                        <button
                          type="button"
                          onClick={() => inserirModulo(m)}
                          aria-label={`Inserir ${m.nome}`}
                          className="size-9 rounded-md text-ink-suave hover:bg-accent-mist hover:text-ink"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => removerModulo(m.id)}
                          aria-label={`Remover ${m.nome}`}
                          className="size-9 rounded-md text-ink-suave hover:bg-erro-fundo hover:text-erro"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                    {modulos.length === 0 && (
                      <li className="px-1 py-2 text-xs text-ink-suave">
                        Nenhum módulo salvo. Selecione um bloco no e-mail e use o botão acima.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            <div hidden={aba !== 'globais'}>
              <div className="border-b border-line px-3 py-2 text-xs text-ink-suave">
                Selecione um bloco para editar. Sem seleção, os ajustes valem para a página.
              </div>
              <div ref={traitsRef} />
              <div ref={estilosRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Código do e-mail ────────────────────────────────────────────── */}
      {codigoAberto && (
        <div className="border-t border-line bg-paper-light p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink">Código do e-mail</p>
            <button
              type="button"
              onClick={() => definirCodigoAberto(false)}
              className="ml-auto min-h-11 text-sm text-ink-suave underline"
            >
              Fechar
            </button>
            {aoPedirHtml !== undefined && (
              <button
                type="button"
                onClick={() => aoPedirHtml(codigo)}
                className="min-h-11 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-accent-mist"
              >
                Editar como HTML
              </button>
            )}
          </div>
          <p className="mb-2 text-xs text-ink-suave">
            HTML compilado a partir dos blocos. Passar para “Editar como HTML” troca o modo: o
            criador visual deixa de mandar no que é enviado.
          </p>
          <textarea
            readOnly
            value={codigo}
            aria-label="HTML compilado"
            className="h-56 w-full rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink"
          />
        </div>
      )}
    </div>
  );
}

function BotaoBarra({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink"
    >
      {children}
    </button>
  );
}
