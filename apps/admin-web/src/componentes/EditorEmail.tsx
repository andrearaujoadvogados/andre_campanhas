import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Botao } from './base.tsx';

/**
 * Editor visual do corpo do e-mail.
 *
 * Escreve HTML semântico — `<p>`, `<strong>`, `<h2>`, `<ul>` — e não HTML de
 * tabelas. Funciona porque o `@emailmkt/email-render` já embute o CSS com o
 * `juice` antes do envio, que é o que Gmail e Outlook exigem; e porque cada tag
 * usada aqui sobrevive à sanitização daquele pacote. Um editor que emitisse tags
 * cortadas pelo sanitizador perderia formatação em silêncio: bonita na tela,
 * ausente na caixa de entrada.
 */

/** O que o `montarEscopo` do email-render expõe ao template. */
const CAMPOS = [
  { valor: '{{contato.primeiroNome}}', rotulo: 'Primeiro nome' },
  { valor: '{{contato.nome}}', rotulo: 'Nome completo' },
  { valor: '{{contato.email}}', rotulo: 'E-mail' },
] as const;

function Ferramenta({
  ativo,
  titulo,
  onClick,
  children,
}: {
  ativo?: boolean;
  titulo: string;
  onClick: () => void;
  children: ReactNode;
}) {
  // O alvo de 44px vale também aqui: são os botões mais clicados da tela, e "N"
  // e "I" são glifos estreitos — sem largura mínima, o alvo teria o tamanho da
  // letra. Quem não distingue o fundo escuro do claro tem o `aria-pressed`, que
  // fica de fora em quem não alterna estado — desfazer e refazer não são teclas
  // que ficam apertadas, e anunciá-las assim confunde o leitor de tela.
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      onMouseDown={(e) => {
        // Sem isto o editor perde o cursor ao clicar no botão, e a formatação
        // seria aplicada a lugar nenhum.
        e.preventDefault();
        onClick();
      }}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm transition-colors ${
        ativo === true ? 'bg-ink text-paper-light' : 'text-ink hover:bg-accent-mist'
      }`}
    >
      {children}
    </button>
  );
}

function Barra({ editor }: { editor: Editor }) {
  const inserir = (texto: string) => editor.chain().focus().insertContent(texto).run();

  const definirLink = () => {
    const atual = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Endereço do link', atual ?? 'https://');

    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const inserirImagem = () => {
    // Por URL, e não por upload: hospedar a imagem é problema à parte, e
    // imagem embutida em base64 é bloqueada pela maioria dos clientes de e-mail.
    const url = window.prompt('Endereço da imagem (https://…)');
    if (url === null || url.trim() === '') return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  return (
    // `flex-wrap` é o que faz a barra virar duas ou três linhas no celular em vez
    // de empurrar os últimos botões para fora do quadro.
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-paper px-2 py-1.5">
      <Ferramenta
        titulo="Negrito"
        ativo={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>N</strong>
      </Ferramenta>
      <Ferramenta
        titulo="Itálico"
        ativo={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </Ferramenta>
      <Ferramenta
        titulo="Sublinhado"
        ativo={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">S</span>
      </Ferramenta>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      <Ferramenta
        titulo="Título"
        ativo={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        T
      </Ferramenta>
      <Ferramenta
        titulo="Subtítulo"
        ativo={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        t
      </Ferramenta>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      <Ferramenta
        titulo="Lista com marcadores"
        ativo={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </Ferramenta>
      <Ferramenta
        titulo="Lista numerada"
        ativo={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </Ferramenta>
      <Ferramenta
        titulo="Citação"
        ativo={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </Ferramenta>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      <Ferramenta
        titulo="Alinhar à esquerda"
        ativo={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        ≡
      </Ferramenta>
      <Ferramenta
        titulo="Centralizar"
        ativo={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        ⋮
      </Ferramenta>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      <Ferramenta titulo="Link" ativo={editor.isActive('link')} onClick={definirLink}>
        🔗
      </Ferramenta>
      <Ferramenta titulo="Imagem por endereço" onClick={inserirImagem}>
        🖼
      </Ferramenta>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      {/**
       * Os campos são a diferença entre um e-mail e um e-mail personalizado.
       * Digitá-los à mão erra — `{{contato.primeironome}}` renderiza vazio, sem
       * erro nenhum, e só se percebe depois do envio.
       */}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value !== '') inserir(e.target.value);
        }}
        className="min-h-11 rounded-md border border-line bg-paper-light px-2 text-sm text-ink"
        aria-label="Inserir campo do contato"
      >
        <option value="">Inserir campo…</option>
        {CAMPOS.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.rotulo}
          </option>
        ))}
      </select>

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />

      <Ferramenta titulo="Desfazer" onClick={() => editor.chain().focus().undo().run()}>
        ↶
      </Ferramenta>
      <Ferramenta titulo="Refazer" onClick={() => editor.chain().focus().redo().run()}>
        ↷
      </Ferramenta>
    </div>
  );
}

/**
 * Desembrulha o `<p>` que o ProseMirror põe dentro de cada `<li>`.
 *
 * `<li><p>texto</p></li>` é HTML válido e sobrevive à sanitização, mas o corpo
 * do e-mail não carrega folha de estilo: o cliente aplica a margem padrão do
 * `<p>`, de cerca de 1em, e a lista sai frouxa, com os itens afastados como se
 * fossem parágrafos soltos.
 *
 * Só desembrulha quando o `<p>` é filho único — item com vários parágrafos é
 * intencional e fica como está. A transformação é idempotente: ao reabrir o
 * modelo, o editor volta a embrulhar, e salvar de novo desembrulha outra vez.
 */
/**
 * HTML de documento inteiro — `<html>`, `<body>` ou tabelas de layout.
 *
 * É o que sai do criador visual, de um boletim gerado ou de uma ferramenta
 * externa. O ProseMirror não tem tabela nem `<html>` no esquema: ao carregar,
 * ele descarta a estrutura e guarda só o texto — e ao PRIMEIRO toque grava
 * essa versão simplificada por cima do modelo. Bonito de ler, layout perdido.
 */
export function ehDocumentoCompleto(html: string): boolean {
  return /<\s*(html|body|table)\b/i.test(html);
}

function normalizarListas(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  for (const li of doc.querySelectorAll('li')) {
    const filhos = [...li.children];
    if (filhos.length === 1 && filhos[0]?.tagName === 'P') {
      li.innerHTML = filhos[0].innerHTML;
    }
  }

  return doc.body.innerHTML;
}

export function EditorEmail({
  valor,
  aoMudar,
  aoPedirVisual,
}: {
  valor: string;
  aoMudar: (html: string) => void;
  /** "Editar no criador visual": entrega o modelo ao criador, que edita o HTML no lugar. */
  aoPedirVisual?: () => void;
}) {
  const documento = ehDocumentoCompleto(valor);
  // Documento inteiro abre no código: no editor de texto ele já chegaria
  // desmontado, e a pessoa não teria como saber que foi o editor que fez isso.
  const [verHtml, definirVerHtml] = useState(documento);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Só dois níveis de título: num e-mail, a hierarquia raramente passa
        // disso, e h4 em diante os clientes renderizam menor que o corpo.
        heading: { levels: [2, 3] },
        // `<code>` e blocos de código não têm uso em comunicação de escritório e
        // renderizam mal em cliente de e-mail.
        code: false,
        codeBlock: false,
        // Link e Underline já vêm no StarterKit v3 — importá-los à parte
        // registra a extensão duas vezes, e o TipTap avisa que o comportamento
        // fica indefinido. Configurados aqui, no lugar certo.
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: 'Escreva a mensagem…' }),
    ],
    content: valor,
    onUpdate: ({ editor: e }) => aoMudar(normalizarListas(e.getHTML())),
    editorProps: {
      attributes: {
        // O anel de foco é desenhado para dentro (`-outline-offset-2`) porque o
        // quadro que envolve o editor tem `overflow-hidden` e cortaria um anel
        // por fora — e sem anel nenhum não se vê onde o cursor está.
        class:
          'prose-email min-h-[18rem] max-w-none bg-paper-light px-4 py-3 text-sm leading-relaxed text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
      },
    },
  });

  /**
   * Sincroniza quando o conteúdo vem de fora — o carregamento de um modelo
   * existente, por exemplo.
   *
   * O guard contra o próprio HTML é o que evita o laço: sem ele, cada tecla
   * digitada dispararia `setContent`, que reposiciona o cursor no fim do texto.
   */
  const ultimoRecebido = useRef(valor);
  useEffect(() => {
    if (editor === null || valor === ultimoRecebido.current) return;
    ultimoRecebido.current = valor;
    if (valor !== editor.getHTML()) editor.commands.setContent(valor, { emitUpdate: false });
  }, [valor, editor]);

  if (editor === null) return null;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper-light">
      {documento && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-alerta/30 bg-alerta-fundo px-4 py-3 text-sm text-alerta"
        >
          <span>
            Este modelo é um <strong>HTML completo</strong>, com layout próprio. O editor de texto
            simplificaria as tabelas ao primeiro toque — por isso ele abre no código. Para editar
            visualmente, use o criador de e-mail.
          </span>
          {aoPedirVisual !== undefined && (
            <Botao variante="secundario" onClick={aoPedirVisual} className="px-3">
              Editar no criador visual
            </Botao>
          )}
        </div>
      )}
      <Barra editor={editor} />

      {verHtml ? (
        <textarea
          value={valor}
          onChange={(e) => {
            ultimoRecebido.current = e.target.value;
            aoMudar(e.target.value);
          }}
          rows={16}
          spellCheck={false}
          className="w-full bg-paper-light px-4 py-3 font-mono text-xs text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
        />
      ) : (
        <EditorContent editor={editor} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper px-3 py-1.5">
        <span className="text-xs text-ink-suave">
          Campos como {'{{contato.primeiroNome}}'} são trocados pelos dados de cada destinatário no
          envio.
        </span>
        {/**
         * A saída para quem precisa de controle fino — colar um HTML pronto,
         * conferir o que o editor gerou. Sem isso, o editor visual seria uma
         * porta que tranca por dentro.
         */}
        <Botao
          variante="discreto"
          onClick={() => definirVerHtml((v) => !v)}
          aria-pressed={verHtml}
          className="px-2"
        >
          {verHtml ? 'Voltar ao editor' : 'Editar HTML'}
        </Botao>
      </div>
    </div>
  );
}
