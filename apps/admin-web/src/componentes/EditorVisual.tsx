import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { isValidDesign, larguraDoConteudo } from '@emailmkt/criador';
import { compilarParaHtml } from '../lib/criador/html.js';
import { createDefaultDesign } from '@emailmkt/criador';
import type { EmailDesign } from '@emailmkt/criador';
import { Dialogo } from './criador/Dialogo.tsx';
import { EditorDesign } from './criador/EditorDesign.tsx';

/**
 * Criador de e-mails — arrastar e soltar, com o funcionamento do avante-mail
 * (a referência de usabilidade): design JSON como fonte da verdade, edição
 * inline no canvas, controles tipados no painel lateral e saída de emergência
 * para HTML em três níveis (bloco, estrutura e documento).
 *
 * O GrapesJS saiu. O que ele guardava em `estruturaVisual` (project data) não
 * abre aqui — e não precisa: um modelo antigo entra como design vazio com o
 * `corpoHtml` já compilado no override de documento. O e-mail continua saindo
 * byte a byte igual, e remontar no visual é uma escolha de quem edita.
 *
 * Pesado por natureza (mjml-browser), então quem usa carrega com `lazy()`.
 */
export interface SaidaEditorVisual {
  /** O design do criador, em JSON — é o que permite reabrir e continuar. */
  readonly estruturaVisual: string;
  /** HTML final compilado do MJML — é o que a campanha envia. */
  readonly corpoHtml: string;
}

/** Ponto de partida: design salvo > migração do HTML herdado > e-mail novo. */
function designInicial(estruturaInicial?: string, htmlInicial?: string): EmailDesign {
  if (estruturaInicial !== undefined && estruturaInicial !== '') {
    try {
      const bruto: unknown = JSON.parse(estruturaInicial);
      if (isValidDesign(bruto)) {
        // Design salvo antes de `contentWidth` existir: entra normalizado, para
        // o campo do painel não abrir vazio e a compilação não depender do
        // fallback para sempre.
        return {
          ...bruto,
          settings: { ...bruto.settings, contentWidth: larguraDoConteudo(bruto.settings) },
        };
      }
    } catch {
      // estrutura de outro formato — cai para a migração abaixo
    }
  }
  if (htmlInicial !== undefined && htmlInicial !== '') {
    // Modelo do editor antigo (ou do modo código): o HTML compilado vira o
    // override de documento. Nada se perde e nada muda no envio; o banner do
    // criador explica como voltar ao visual.
    return { ...createDefaultDesign(), rows: [], customHtml: htmlInicial };
  }
  return createDefaultDesign();
}

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
  const [design, definirDesign] = useState<EmailDesign>(() =>
    designInicial(estruturaInicial, htmlInicial),
  );

  const [previaAberta, definirPreviaAberta] = useState(false);
  const [previaHtml, definirPreviaHtml] = useState('');
  const [previaErro, definirPreviaErro] = useState('');
  const [previaCarregando, definirPreviaCarregando] = useState(false);

  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  /** Último HTML compilado — alimenta a prévia e o "Editar como HTML". */
  const [htmlAtual, definirHtmlAtual] = useState('');

  /**
   * Emite estrutura + HTML compilado a cada mudança, com debounce: compilar
   * MJML a cada tecla da edição inline seria trabalho jogado fora. Emite
   * também no primeiro render — um e-mail montado e salvo sem edição
   * posterior chegaria vazio ao formulário sem isto.
   *
   * O mjml-browser v5 compila de forma assíncrona; o flag `vivo` descarta o
   * resultado de uma compilação que terminou depois de o design já ter mudado
   * de novo — senão um HTML velho poderia atropelar um mais novo.
   */
  useEffect(() => {
    let vivo = true;
    const timer = setTimeout(() => {
      void compilarParaHtml(design).then(({ html }) => {
        if (!vivo) return;
        definirHtmlAtual(html);
        aoMudarRef.current({
          estruturaVisual: JSON.stringify(design),
          corpoHtml: html,
        });
      });
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [design]);

  /**
   * Prévia pelo pipeline REAL: o `/templates/previa` renderiza com o mesmo
   * Liquid do envio e um contato de exemplo — as variáveis aparecem
   * preenchidas, não cruas. Se a chamada falhar (ex.: assunto ainda vazio no
   * assistente), cai para o HTML compilado local: pior que o pipeline real,
   * melhor que nenhuma prévia.
   */
  async function abrirPrevia() {
    definirPreviaAberta(true);
    definirPreviaCarregando(true);
    definirPreviaErro('');
    try {
      const r = await api.post<{ corpoHtml: string }>('/templates/previa', {
        nome: nome.trim() !== '' ? nome : 'Prévia',
        assunto: assunto !== undefined && assunto.trim() !== '' ? assunto : 'Prévia',
        corpoHtml: htmlAtual,
      });
      definirPreviaHtml(r.corpoHtml);
    } catch {
      definirPreviaHtml(htmlAtual);
      definirPreviaErro(
        'A prévia com dados de exemplo falhou; este é o HTML compilado, com as variáveis cruas.',
      );
    } finally {
      definirPreviaCarregando(false);
    }
  }

  return (
    <div className="flex min-h-[720px] flex-col rounded-md border border-line bg-paper">
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
            onClick={() => void abrirPrevia()}
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

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      <div className="flex-1 p-4">
        <EditorDesign value={design} onChange={definirDesign} />
      </div>

      {/* "Editar como HTML" continua existindo para quem hospeda o editor:
          troca o modo do modelo para CODIGO com o HTML atual. */}
      {aoPedirHtml !== undefined && (
        <div className="border-t border-line bg-paper-light px-4 py-2 text-right">
          <button
            type="button"
            onClick={() => aoPedirHtml(htmlAtual)}
            className="min-h-11 text-sm text-ink-suave underline hover:text-ink"
          >
            Editar como HTML (sai do criador visual)
          </button>
        </div>
      )}

      {/* ── Prévia ─────────────────────────────────────────────────────── */}
      <Dialogo
        titulo="Pré-visualização"
        descricao="Renderizada pelo mesmo pipeline do envio real, com dados de exemplo."
        aberto={previaAberta}
        aoFechar={() => definirPreviaAberta(false)}
        largura="max-w-3xl"
      >
        {previaErro !== '' && <p className="text-xs text-alerta">{previaErro}</p>}
        {previaCarregando ? (
          <p className="py-16 text-center text-sm text-ink-suave">Gerando pré-visualização…</p>
        ) : (
          <iframe
            srcDoc={previaHtml}
            sandbox=""
            title="Pré-visualização do e-mail"
            className="h-[70vh] w-full rounded-md border border-line bg-white"
          />
        )}
      </Dialogo>
    </div>
  );
}
