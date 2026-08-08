import { Suspense, lazy, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api, type ComAviso } from '../lib/api.js';
import { dataHora } from '../lib/formato.js';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TituloPagina,
  Vazio,
  classeEntrada,
} from '../componentes/base.tsx';

interface Template extends ComAviso {
  templateId: string;
  nome: string;
  versaoAtual: number;
  arquivado: boolean;
  atualizadoEm: string;
  conteudo?: { assunto: string; corpoHtml: string } | null;
}

interface Variavel {
  chave: string;
  descricao: string;
}

interface Previa {
  assunto: string;
  corpoHtml: string;
  corpoTexto: string;
  aviso: string;
}

export function Templates() {
  const lista = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ itens: Template[]; variaveisDisponiveis: Variavel[] }>('/templates'),
  });

  return (
    <div className="space-y-6">
      <TituloPagina
        acao={
          <Link
            to="/templates/novo"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-light transition-colors hover:bg-ink/90"
          >
            Novo modelo
          </Link>
        }
      >
        Modelos de e-mail
      </TituloPagina>

      <Cartao>
        {lista.isLoading && <Carregando />}
        <ErroCaixa erro={lista.error} />
        {lista.data?.itens.length === 0 && <Vazio mensagem="Nenhum modelo criado ainda." />}

        <ul className="divide-y divide-line">
          {lista.data?.itens.map((t) => (
            <li
              key={t.templateId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
              {/* O nome interno é digitado pelo operador: sem `min-w-0` e quebra
                  de palavra, um nome longo empurra a página inteira para o lado
                  no celular. */}
              <div className="min-w-0">
                <Link
                  to={`/templates/${t.templateId}`}
                  className="inline-flex min-h-11 items-center font-medium break-words text-ink hover:underline"
                >
                  {t.nome}
                </Link>
                <p className="text-xs text-ink-suave">
                  versão {t.versaoAtual} · {dataHora(t.atualizadoEm)}
                </p>
              </div>
              {t.arquivado && <Selo tom="neutro">Arquivado</Selo>}
            </li>
          ))}
        </ul>
      </Cartao>

      {lista.data !== undefined && (
        <Cartao titulo="Variáveis disponíveis">
          <ul className="space-y-1.5 text-sm">
            {lista.data.variaveisDisponiveis.map((v) => (
              // Envolve no celular: chave e descrição param de brigar pela mesma linha.
              <li key={v.chave} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code className="rounded-md bg-accent-mist px-1.5 py-0.5 text-xs text-gold">
                  {`{{${v.chave}}}`}
                </code>
                <span className="text-ink-suave">{v.descricao}</span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}

/**
 * O editor carrega sob demanda.
 *
 * O TipTap e o ProseMirror somam ~400 KB — quase metade do painel. Quem abre
 * campanhas, listas ou contatos nunca toca no editor, e não faz sentido que
 * espere por ele no primeiro carregamento.
 */
const EditorEmail = lazy(() =>
  import('../componentes/EditorEmail.tsx').then((m) => ({ default: m.EditorEmail })),
);

export function TemplateEditor() {
  const { id } = useParams();
  const ehNovo = id === undefined || id === 'novo';
  const qc = useQueryClient();

  const [nome, definirNome] = useState('');
  const [assunto, definirAssunto] = useState('');
  const [corpoHtml, definirCorpo] = useState('<p>Olá {{contato.primeiroNome}},</p>\n<p></p>');
  const [carregado, definirCarregado] = useState(ehNovo);
  const [avisoSalvo, definirAvisoSalvo] = useState<string | undefined>(undefined);

  useQuery({
    queryKey: ['template', id],
    enabled: !ehNovo,
    queryFn: async () => {
      const t = await api.get<Template>(`/templates/${id ?? ''}`);
      definirNome(t.nome);
      definirAssunto(t.conteudo?.assunto ?? '');
      definirCorpo(t.conteudo?.corpoHtml ?? '');
      definirCarregado(true);
      return t;
    },
  });

  const salvar = useMutation({
    mutationFn: () =>
      ehNovo
        ? api.post<Template>('/templates', { nome, assunto, corpoHtml })
        : api.put<Template>(`/templates/${id ?? ''}`, { nome, assunto, corpoHtml }),
    onSuccess: (t) => {
      // O aviso "uma nova versão foi criada" precisa chegar ao operador: sem
      // ele, ninguém entende por que a campanha aprovada continua na versão
      // anterior (§6.2, nota 3).
      definirAvisoSalvo(t.aviso);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const previa = useMutation({
    mutationFn: () => api.post<Previa>('/templates/previa', { nome, assunto, corpoHtml }),
  });

  if (!carregado) return <Carregando />;

  return (
    <div className="space-y-6">
      <Link
        to="/templates"
        className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
      >
        ← Modelos
      </Link>

      <Aviso texto={avisoSalvo} tom="alerta" />
      <ErroCaixa erro={salvar.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Cartao titulo="Conteúdo">
          <div className="space-y-4">
            <Campo rotulo="Nome interno" ajuda="Só o escritório vê." obrigatorio>
              <input
                value={nome}
                onChange={(e) => definirNome(e.target.value)}
                className={classeEntrada}
              />
            </Campo>
            <Campo rotulo="Assunto do e-mail" obrigatorio>
              <input
                value={assunto}
                onChange={(e) => definirAssunto(e.target.value)}
                className={classeEntrada}
              />
            </Campo>
            <Campo
              rotulo="Corpo do e-mail"
              ajuda="O link de descadastro é acrescentado automaticamente no rodapé."
              obrigatorio
            >
              <Suspense
                fallback={
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-md border border-line bg-paper-light px-4 py-12 text-center text-sm text-ink-suave"
                  >
                    Carregando o editor…
                  </div>
                }
              >
                <EditorEmail valor={corpoHtml} aoMudar={definirCorpo} />
              </Suspense>
            </Campo>

            <div className="flex flex-wrap gap-2">
              <Botao
                carregando={salvar.isPending}
                disabled={nome === '' || assunto === '' || corpoHtml === ''}
                onClick={() => salvar.mutate()}
              >
                {ehNovo ? 'Criar modelo' : 'Salvar nova versão'}
              </Botao>
              <Botao
                variante="secundario"
                carregando={previa.isPending}
                onClick={() => previa.mutate()}
              >
                Ver prévia
              </Botao>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Prévia">
          <ErroCaixa erro={previa.error} />
          {previa.data === undefined ? (
            <Vazio mensagem="Clique em “Ver prévia” para renderizar com dados de exemplo." />
          ) : (
            <div className="space-y-3">
              <Aviso texto={previa.data.aviso} />
              <p className="text-sm">
                <span className="text-ink-suave">Assunto: </span>
                <span className="font-medium text-ink">{previa.data.assunto}</span>
              </p>
              {/**
               * A prévia roda em iframe com sandbox.
               *
               * O HTML já vem sanitizado do backend, mas renderizá-lo direto na
               * página do painel colocaria conteúdo autoral no mesmo contexto de
               * origem da sessão do operador. O iframe isolado é a segunda
               * barreira (§10.1).
               */}
              {/* Fundo branco de propósito: é como o e-mail vai aparecer na caixa
                  de entrada, não como o painel se pinta. */}
              <iframe
                title="Prévia do e-mail"
                sandbox=""
                srcDoc={previa.data.corpoHtml}
                className="h-[28rem] w-full rounded-md border border-line bg-white"
              />
              <details className="text-xs text-ink-suave">
                {/* O resumo é o que se toca para abrir: precisa dos 44px. */}
                <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">
                  Versão em texto
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-paper p-3">
                  {previa.data.corpoTexto}
                </pre>
              </details>
            </div>
          )}
        </Cartao>
      </div>
    </div>
  );
}
