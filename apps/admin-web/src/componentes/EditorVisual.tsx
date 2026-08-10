import { useEffect, useRef } from 'react';
import grapesjs, { type Editor } from 'grapesjs';
import pluginMjml from 'grapesjs-mjml';
import 'grapesjs/dist/css/grapes.min.css';

/**
 * Editor visual arrastar-e-soltar de e-mail — §8 do briefing.
 *
 * GrapesJS com o preset MJML: estruturas de coluna, blocos (texto, imagem,
 * botão, divisor, espaçador, social), configurações e edição por bloco, tudo
 * self-hosted (nada sai para servidor externo — coerente com a postura de dados
 * do projeto). O preset compila o MJML para HTML responsável por e-mail.
 *
 * O componente é pesado (GrapesJS + mjml-browser somam bastante), por isso é
 * carregado sob demanda pelo `TemplateEditor` — quem não abre o criador não paga
 * o custo no primeiro carregamento.
 */
export interface SaidaEditorVisual {
  /** Estrutura dos blocos (project data do GrapesJS), em JSON — para recarregar. */
  readonly estruturaVisual: string;
  /** HTML final compilado a partir do MJML — é o que a campanha envia. */
  readonly corpoHtml: string;
}

/**
 * Extrai HTML compilado + MJML do editor.
 *
 * O preset MJML expõe o comando `mjml-get-code`, que devolve `{ html, mjml }`
 * com o HTML já compilado. Se por algum motivo o comando não responder, cai para
 * `getHtml()` — assim uma mudança de versão do preset não deixa o save sem
 * conteúdo, em silêncio.
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

export function EditorVisual({
  estruturaInicial,
  aoMudar,
}: {
  estruturaInicial?: string;
  aoMudar: (saida: SaidaEditorVisual) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A prop pode mudar a cada render; guardamos numa ref para o handler do editor
  // sempre chamar a versão atual sem reinicializar o GrapesJS.
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const editor = grapesjs.init({
      container,
      height: '640px',
      fromElement: false,
      storageManager: false,
      // Preset MJML: traz estruturas, blocos e a compilação MJML→HTML.
      plugins: [pluginMjml],
    });

    if (estruturaInicial !== undefined && estruturaInicial !== '') {
      try {
        editor.loadProjectData(JSON.parse(estruturaInicial));
      } catch {
        // Estrutura corrompida não deve travar o editor — começa em branco.
      }
    }

    // Compilar MJML a cada tecla seria caro; um debounce curto mantém a prévia
    // e o estado do formulário em dia sem recompilar a toda letra digitada.
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

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      editor.destroy();
    };
    // Init único: as mudanças de conteúdo vivem dentro do próprio GrapesJS, não
    // no ciclo de render do React. Recriar o editor a cada render perderia o
    // estado e piscaria a tela. `estruturaInicial` é lida só no init, de
    // propósito — recarregar a estrutura a cada tecla sobrescreveria a edição.
  }, []);

  return <div ref={containerRef} />;
}
