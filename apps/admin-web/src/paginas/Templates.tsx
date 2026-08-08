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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Modelos de e-mail</h1>
        <Link
          to="/templates/novo"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Novo modelo
        </Link>
      </div>

      <Cartao>
        {lista.isLoading && <Carregando />}
        <ErroCaixa erro={lista.error} />
        {lista.data?.itens.length === 0 && <Vazio mensagem="Nenhum modelo criado ainda." />}

        <ul className="divide-y divide-slate-100">
          {lista.data?.itens.map((t) => (
            <li key={t.templateId} className="flex items-center justify-between py-3">
              <div>
                <Link
                  to={`/templates/${t.templateId}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {t.nome}
                </Link>
                <p className="text-xs text-slate-500">
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
          <ul className="space-y-1 text-sm">
            {lista.data.variaveisDisponiveis.map((v) => (
              <li key={v.chave}>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {`{{${v.chave}}}`}
                </code>
                <span className="ml-2 text-slate-600">{v.descricao}</span>
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
      <Link to="/templates" className="text-sm text-slate-500 hover:underline">
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
                  <div className="rounded-md border border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
                    Carregando o editor…
                  </div>
                }
              >
                <EditorEmail valor={corpoHtml} aoMudar={definirCorpo} />
              </Suspense>
            </Campo>

            <div className="flex gap-2">
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
                <span className="text-slate-500">Assunto: </span>
                <span className="font-medium">{previa.data.assunto}</span>
              </p>
              {/**
               * A prévia roda em iframe com sandbox.
               *
               * O HTML já vem sanitizado do backend, mas renderizá-lo direto na
               * página do painel colocaria conteúdo autoral no mesmo contexto de
               * origem da sessão do operador. O iframe isolado é a segunda
               * barreira (§10.1).
               */}
              <iframe
                title="Prévia do e-mail"
                sandbox=""
                srcDoc={previa.data.corpoHtml}
                className="h-[28rem] w-full rounded border border-slate-200 bg-white"
              />
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Versão em texto</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3">
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
