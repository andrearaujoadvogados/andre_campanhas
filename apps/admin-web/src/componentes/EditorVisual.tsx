import { useEffect, useRef, useState } from 'react';
import grapesjs, { type Editor } from 'grapesjs';
import pluginMjml from 'grapesjs-mjml';
import 'grapesjs/dist/css/grapes.min.css';
import './editor-visual.css';

/**
 * Criador de e-mails — arrastar e soltar, §8 do briefing.
 *
 * GrapesJS com o preset MJML (estruturas de coluna, texto, imagem, botão,
 * divisor, espaçador, social) e compilação MJML→HTML de e-mail. Tudo
 * self-hosted: nada do conteúdo sai para servidor de terceiro, o que é coerente
 * com a postura de dados do projeto.
 *
 * **A moldura é nossa.** Os painéis padrão do GrapesJS ficam desligados
 * (`panels.defaults: []`) e os gerenciadores são montados dentro de contêineres
 * que este componente desenha — é o que permite a barra superior e a coluna da
 * direita seguirem o design system do escritório em vez do tema escuro da
 * biblioteca. O CSS do tema mora em `editor-visual.css`.
 *
 * Pesado por natureza (GrapesJS + mjml-browser), então quem o usa carrega sob
 * demanda com `lazy()`.
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
 * silêncio — que é o tipo de falha que só aparece no disparo.
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

type Aba = 'conteudo' | 'configuracoes';

export function EditorVisual({
  estruturaInicial,
  htmlInicial,
  aoMudar,
  aoPedirHtml,
}: {
  estruturaInicial?: string;
  /** HTML de partida quando não há estrutura salva — ex.: veio do modo código. */
  htmlInicial?: string;
  aoMudar: (saida: SaidaEditorVisual) => void;
  /** Chamado por "Editar como HTML": entrega o HTML atual a quem hospeda. */
  aoPedirHtml?: (html: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocosRef = useRef<HTMLDivElement>(null);
  const estilosRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  const [aba, definirAba] = useState<Aba>('conteudo');
  const [codigoAberto, definirCodigoAberto] = useState(false);
  const [codigo, definirCodigo] = useState('');

  // As props mudam a cada render; guardá-las em ref evita reinicializar o
  // editor — o estado dele vive fora do ciclo do React.
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
      // Painéis padrão desligados: a moldura é a nossa (ver o doc do arquivo).
      panels: { defaults: [] },
      blockManager: { appendTo: blocosRef.current ?? undefined },
      styleManager: { appendTo: estilosRef.current ?? undefined },
      traitManager: { appendTo: traitsRef.current ?? undefined },
    });
    editorRef.current = editor;

    // Ponto de partida: estrutura salva > HTML herdado > e-mail em branco.
    if (estruturaInicial !== undefined && estruturaInicial !== '') {
      try {
        editor.loadProjectData(JSON.parse(estruturaInicial));
      } catch {
        // Estrutura corrompida não trava o editor: começa em branco.
        editor.setComponents(MJML_EM_BRANCO);
      }
    } else if (htmlInicial !== undefined && htmlInicial !== '') {
      /**
       * Veio do modo código.
       *
       * O canvas do preset só entende MJML; jogar HTML solto aqui produziria um
       * documento inválido. Embrulhamos num `mj-text`, que preserva o conteúdo
       * e deixa o operador remontá-lo com os blocos — melhor do que descartar o
       * que ele já tinha escrito.
       */
      editor.setComponents(
        `<mjml><mj-body><mj-section><mj-column><mj-text>${htmlInicial}</mj-text></mj-column></mj-section></mj-body></mjml>`,
      );
    } else {
      editor.setComponents(MJML_EM_BRANCO);
    }

    // Compilar a cada tecla seria caro; o debounce mantém o formulário em dia
    // sem recompilar MJML a cada letra.
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
    // Emite uma vez no init: sem isto, um e-mail montado e salvo sem nenhuma
    // edição posterior iria vazio para o formulário.
    emitir();

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      editor.destroy();
      editorRef.current = null;
    };
    // Init único, de propósito — ver o doc do arquivo.
  }, []);

  const comando = (nome: string) => () => editorRef.current?.Commands.run(nome);

  const abrirCodigo = () => {
    const ed = editorRef.current;
    if (ed === null) return;
    definirCodigo(compilar(ed));
    definirCodigoAberto(true);
  };

  return (
    <div className="editor-visual overflow-hidden rounded-md border border-line bg-paper-light">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <BotaoBarra onClick={comando('core:undo')} titulo="Desfazer">
          ↶ Desfazer
        </BotaoBarra>
        <BotaoBarra onClick={comando('core:redo')} titulo="Refazer">
          ↷ Refazer
        </BotaoBarra>
        <BotaoBarra onClick={comando('preview')} titulo="Ver sem as guias de edição">
          Pré-visualizar
        </BotaoBarra>
        <div className="ml-auto">
          <BotaoBarra onClick={abrirCodigo} titulo="Ver o HTML compilado">
            {'</> Código do e-mail'}
          </BotaoBarra>
        </div>
      </div>

      <div className="flex min-h-[640px] flex-col lg:flex-row">
        {/* Canvas */}
        <div ref={canvasRef} className="min-h-[420px] flex-1 lg:min-h-[640px]" />

        {/* Coluna da direita */}
        <div className="flex w-full shrink-0 flex-col border-t border-line lg:w-80 lg:border-t-0 lg:border-l">
          <div role="tablist" aria-label="Painel do editor" className="flex border-b border-line">
            {(
              [
                ['conteudo', 'Conteúdo'],
                ['configuracoes', 'Configurações'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={aba === valor}
                onClick={() => definirAba(valor)}
                className={`min-h-11 flex-1 px-3 text-sm font-medium transition-colors ${
                  aba === valor
                    ? 'border-b-2 border-gold text-ink'
                    : 'text-ink-suave hover:text-ink'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {/* Os dois painéis ficam montados o tempo todo e só alternam a
              visibilidade: desmontar arrancaria os contêineres em que o
              GrapesJS injetou os gerenciadores, e eles não voltariam. */}
          <div className="flex-1 overflow-y-auto">
            <div ref={blocosRef} hidden={aba !== 'conteudo'} />
            <div hidden={aba !== 'configuracoes'}>
              <div className="border-b border-line px-3 py-2 text-xs text-ink-suave">
                Selecione um bloco no e-mail para editar. Sem seleção, os ajustes valem para a
                página.
              </div>
              <div ref={traitsRef} />
              <div ref={estilosRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Código do e-mail */}
      {codigoAberto && (
        <div className="border-t border-line p-3">
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
            HTML compilado a partir dos blocos. Passar para “Editar como HTML” troca o modo do
            modelo: o criador visual deixa de mandar no que é enviado.
          </p>
          <textarea
            readOnly
            value={codigo}
            className="h-56 w-full rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink"
          />
        </div>
      )}
    </div>
  );
}

function BotaoBarra({
  onClick,
  titulo,
  children,
}: {
  onClick: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-medium text-ink transition-colors hover:bg-accent-mist"
    >
      {children}
    </button>
  );
}
