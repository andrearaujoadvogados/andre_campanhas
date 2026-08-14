import { Suspense, lazy, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { createBoletimDesign } from '@emailmkt/criador';

import { api, type ComAviso } from '../lib/api.js';
import { dataHora } from '../lib/formato.js';
import { FaixaExecucaoBoletim, useExecucoesBoletim } from '../componentes/ExecucaoBoletim.tsx';
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
  tipo?: 'VISUAL' | 'CODIGO';
  categoria?: string | null;
  thumbnail?: string | null;
  versaoAtual: number;
  arquivado: boolean;
  atualizadoEm: string;
  conteudo?: { assunto: string; corpoHtml: string; estruturaVisual?: string } | null;
}

const ROTULO_TIPO_TEMPLATE: Readonly<Record<string, string>> = {
  VISUAL: 'Criador',
  CODIGO: 'Código',
};

/** Seis horas — o turno em que ainda faz sentido explicar por que a lista não mudou. */
const JANELA_AVISO_MS = 6 * 60 * 60_000;

const recente = (iso: string): boolean => Date.now() - new Date(iso).getTime() < JANELA_AVISO_MS;

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

/**
 * Prévia visual do modelo no card.
 *
 * Renderiza o HTML do próprio modelo num iframe reduzido, em vez de depender de
 * uma imagem gravada: o `thumbnail` nunca é preenchido hoje, e gerar imagem
 * exigiria rasterizar o HTML em algum lugar. Assim a prévia vale para os modelos
 * que já existem, sem migração e sem backend novo.
 *
 * O conteúdo vem de `GET /templates/:id` — a listagem devolve só metadados. São
 * algumas dezenas de modelos no total, e o React Query cacheia; o custo é uma
 * requisição por card, uma vez.
 *
 * `sandbox=""` e `pointer-events-none`: o HTML é autoral e não deve executar
 * nada nem capturar o clique, que pertence ao link do card.
 */
function PreviaModelo({ id }: { id: string }) {
  const conteudo = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.get<Template>(`/templates/${id}`),
    staleTime: 5 * 60_000,
  });

  const html = conteudo.data?.conteudo?.corpoHtml;

  if (conteudo.isLoading) {
    return <span className="text-xs text-ink-suave">carregando prévia…</span>;
  }
  if (html === undefined || html === '') {
    return <span className="text-xs text-ink-suave">sem prévia</span>;
  }

  return (
    <iframe
      title=""
      aria-hidden="true"
      tabIndex={-1}
      sandbox=""
      srcDoc={html}
      // 640px é a largura típica de e-mail; a escala reduz para caber no card
      // sem reflow do conteúdo — encolher o iframe direto mudaria o layout do
      // e-mail e a prévia mostraria algo que ninguém vai receber.
      style={{
        width: '640px',
        height: '420px',
        transform: 'scale(0.42)',
        transformOrigin: 'top left',
      }}
      className="pointer-events-none border-0 bg-white"
    />
  );
}

export function Templates() {
  const qc = useQueryClient();
  const [selecionados, definirSelecionados] = useState<Set<string>>(new Set());
  const [mostrarArquivados, definirMostrarArquivados] = useState(false);

  const lista = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ itens: Template[]; variaveisDisponiveis: Variavel[] }>('/templates'),
  });

  /**
   * Esta é a tela onde se espera o boletim automático aparecer — por isso ela
   * também acompanha a geração, e não só a lista de modelos.
   */
  const execucoesBoletim = useExecucoesBoletim();
  const ultimaGeracao = execucoesBoletim.data?.itens[0];

  /**
   * Geração concluída = modelo novo no servidor que esta lista ainda não tem.
   *
   * Sem esta invalidação, o boletim ficaria pronto e a tela continuaria
   * mostrando a lista antiga até alguém recarregar a página — que é
   * exatamente a experiência de "pedi e não aconteceu nada".
   */
  const idConcluida = ultimaGeracao?.situacao === 'CONCLUIDA' ? ultimaGeracao.execucaoId : null;
  useEffect(() => {
    if (idConcluida !== null) void qc.invalidateQueries({ queryKey: ['templates'] });
  }, [idConcluida, qc]);

  /**
   * Arquivar em lote.
   *
   * `allSettled`, não `all`: um modelo que falhar não pode impedir os outros de
   * saírem da lista, e o operador precisa saber quantos foram — "erro" sozinho
   * esconderia que a maioria funcionou.
   */
  const arquivarSelecionados = useMutation({
    mutationFn: async () => {
      const ids = [...selecionados];
      const r = await Promise.allSettled(ids.map((id) => api.delete(`/templates/${id}`)));
      return { total: ids.length, falhas: r.filter((x) => x.status === 'rejected').length };
    },
    onSuccess: () => {
      definirSelecionados(new Set());
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const todos = lista.data?.itens ?? [];
  const itens = mostrarArquivados ? todos : todos.filter((t) => !t.arquivado);
  const arquivados = todos.length - todos.filter((t) => !t.arquivado).length;

  const alternar = (id: string) =>
    definirSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-6">
      <TituloPagina
        acao={
          <div className="flex flex-wrap gap-2">
            {/* O boletim é O e-mail periódico do escritório — merece o atalho
                que abre o criador já montado, notícia por notícia. */}
            <Link
              to="/templates/novo?inicio=boletim"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-gold px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-accent-mist"
            >
              Novo boletim
            </Link>
            <Link
              to="/templates/novo"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-light transition-colors hover:bg-ink/90"
            >
              Novo modelo
            </Link>
          </div>
        }
      >
        Modelos de e-mail
      </TituloPagina>

      {/**
       * A faixa some quando o desfecho envelhece: "não gerou nada" é notícia
       * por algumas horas, depois vira ruído fixo no topo da tela. Uma geração
       * em curso, essa aparece sempre — é o presente, não o histórico.
       */}
      {ultimaGeracao !== undefined &&
        (ultimaGeracao.situacao === 'EXECUTANDO' || recente(ultimaGeracao.iniciadaEm)) && (
          <FaixaExecucaoBoletim execucao={ultimaGeracao} />
        )}

      <Cartao>
        {lista.isLoading && <Carregando />}
        <ErroCaixa erro={lista.error} />
        {itens.length === 0 && !lista.isLoading && <Vazio mensagem="Nenhum modelo criado ainda." />}

        {itens.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={itens.length > 0 && itens.every((t) => selecionados.has(t.templateId))}
                  onChange={(e) =>
                    definirSelecionados(
                      e.target.checked ? new Set(itens.map((t) => t.templateId)) : new Set(),
                    )
                  }
                />
                Selecionar todos
              </label>
              {selecionados.size > 0 && (
                <>
                  <span className="text-sm text-ink-suave">{selecionados.size} selecionado(s)</span>
                  <Botao
                    variante="perigo"
                    carregando={arquivarSelecionados.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Arquivar ${selecionados.size} modelo(s)? Eles saem da lista; as versões continuam guardadas para auditoria das campanhas que já os usaram.`,
                        )
                      )
                        arquivarSelecionados.mutate();
                    }}
                  >
                    Arquivar selecionados
                  </Botao>
                </>
              )}
            </div>

            {arquivados > 0 && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-suave">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={mostrarArquivados}
                  onChange={(e) => definirMostrarArquivados(e.target.checked)}
                />
                Mostrar arquivados ({arquivados})
              </label>
            )}
          </div>
        )}

        <ErroCaixa erro={arquivarSelecionados.error} />
        {arquivarSelecionados.data !== undefined && arquivarSelecionados.data.falhas > 0 && (
          <Aviso
            tom="alerta"
            texto={`${arquivarSelecionados.data.falhas} de ${arquivarSelecionados.data.total} não puderam ser arquivados.`}
          />
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((t) => (
            <li
              key={t.templateId}
              className={`flex flex-col overflow-hidden rounded-lg border bg-paper-light ${
                selecionados.has(t.templateId) ? 'border-ink ring-1 ring-ink' : 'border-line'
              }`}
            >
              {/* Fora do link: marcar não pode navegar. */}
              <label className="flex min-h-11 items-center gap-2 border-b border-line px-3 text-sm text-ink-suave">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selecionados.has(t.templateId)}
                  onChange={() => alternar(t.templateId)}
                />
                selecionar
              </label>

              <Link to={`/templates/${t.templateId}`} className="flex flex-1 flex-col">
                {/* A prévia é o HTML real do modelo, reduzido. */}
                <div className="flex h-32 items-center justify-center overflow-hidden border-b border-line bg-paper">
                  <PreviaModelo id={t.templateId} />
                </div>
                <div className="min-w-0 flex-1 space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Selo tom={t.tipo === 'VISUAL' ? 'positivo' : 'neutro'}>
                      {ROTULO_TIPO_TEMPLATE[t.tipo ?? 'CODIGO']}
                    </Selo>
                    {t.categoria ? <Selo tom="neutro">{t.categoria}</Selo> : null}
                    {t.arquivado && <Selo tom="neutro">Arquivado</Selo>}
                  </div>
                  <p className="font-medium break-words text-ink">{t.nome}</p>
                  <p className="text-xs text-ink-suave">
                    versão {t.versaoAtual} · {dataHora(t.atualizadoEm)}
                  </p>
                </div>
              </Link>
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

/**
 * O criador visual (GrapesJS + MJML) é ainda mais pesado que o editor de texto —
 * só carrega quando o modelo é do tipo "Criador de e-mail".
 */
const EditorVisual = lazy(() =>
  import('../componentes/EditorVisual.tsx').then((m) => ({ default: m.EditorVisual })),
);

export function TemplateEditor() {
  const { id } = useParams();
  const ehNovo = id === undefined || id === 'novo';
  const navegar = useNavigate();
  const qc = useQueryClient();

  /**
   * Ponto de partida do modelo novo — `?inicio=boletim` abre o criador com o
   * boletim de notícias montado, em vez do e-mail em branco.
   *
   * O design é gerado AQUI, no clique, e não gravado em algum lugar: um
   * template pré-cadastrado no banco envelheceria a cada mudança de preset,
   * enquanto a fábrica produz sempre a versão atual do desenho.
   */
  const [busca] = useSearchParams();
  const inicioBoletim = ehNovo && busca.get('inicio') === 'boletim';

  const [nome, definirNome] = useState(inicioBoletim ? 'Boletim Tributário' : '');
  const [assunto, definirAssunto] = useState(
    inicioBoletim ? 'Boletim Tributário — os destaques da semana' : '',
  );
  const [tipo, definirTipo] = useState<'VISUAL' | 'CODIGO'>(inicioBoletim ? 'VISUAL' : 'CODIGO');
  const [categoria, definirCategoria] = useState(inicioBoletim ? 'Boletim' : '');
  const [estruturaVisual, definirEstrutura] = useState(() =>
    inicioBoletim ? JSON.stringify(createBoletimDesign()) : '',
  );
  const [corpoHtml, definirCorpo] = useState('<p>Olá {{contato.primeiroNome}},</p>\n<p></p>');
  const [carregado, definirCarregado] = useState(ehNovo);
  const [avisoSalvo, definirAvisoSalvo] = useState<
    { texto: string; tom: 'alerta' | 'sucesso' } | undefined
  >(undefined);

  useQuery({
    queryKey: ['template', id],
    enabled: !ehNovo,
    queryFn: async () => {
      const t = await api.get<Template>(`/templates/${id ?? ''}`);
      definirNome(t.nome);
      definirTipo(t.tipo ?? 'CODIGO');
      definirCategoria(t.categoria ?? '');
      definirEstrutura(t.conteudo?.estruturaVisual ?? '');
      definirAssunto(t.conteudo?.assunto ?? '');
      definirCorpo(t.conteudo?.corpoHtml ?? '');
      definirCarregado(true);
      return t;
    },
  });

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome,
        assunto,
        corpoHtml,
        tipo,
        ...(categoria.trim() === '' ? {} : { categoria: categoria.trim() }),
        ...(tipo === 'VISUAL' && estruturaVisual !== '' ? { estruturaVisual } : {}),
      };
      return ehNovo
        ? api.post<Template>('/templates', corpo)
        : api.put<Template>(`/templates/${id ?? ''}`, corpo);
    },
    onSuccess: (t) => {
      // O aviso "uma nova versão foi criada" precisa chegar ao operador: sem
      // ele, ninguém entende por que a campanha aprovada continua na versão
      // anterior (§6.2, nota 3). E salvar SEM confirmação visível viola a
      // primeira heurística de Nielsen (visibilidade do estado): quem não vê
      // resposta clica de novo — e criava um segundo modelo idêntico.
      definirAvisoSalvo(
        t.aviso !== undefined && t.aviso !== ''
          ? { texto: t.aviso, tom: 'alerta' }
          : { texto: ehNovo ? 'Modelo criado.' : 'Modelo salvo.', tom: 'sucesso' },
      );
      void qc.invalidateQueries({ queryKey: ['templates'] });
      if (ehNovo) {
        /**
         * Sai do estado "novo" imediatamente: a URL passa a ser a do modelo
         * criado, então o próximo "Salvar" é uma atualização, não um segundo
         * POST. É a correção estrutural do clique duplo — desabilitar o botão
         * só cobriria o duplo-clique rápido, não o "será que salvou?" de dez
         * segundos depois.
         */
        navegar(`/templates/${t.templateId}`, { replace: true });
      }
    },
  });

  const previa = useMutation({
    mutationFn: () => api.post<Previa>('/templates/previa', { nome, assunto, corpoHtml }),
  });

  if (!carregado) return <Carregando />;

  /**
   * No criador visual o editor toma a tela.
   *
   * Nome, categoria, assunto e salvar moram na barra do próprio editor — é o
   * layout da referência, e evita o que havia antes: um formulário à esquerda
   * disputando espaço com o canvas, num editor que precisa de largura para o
   * arrastar-e-soltar fazer sentido.
   */
  if (tipo === 'VISUAL') {
    return (
      <div className="space-y-4">
        <Aviso texto={avisoSalvo?.texto} tom={avisoSalvo?.tom ?? 'alerta'} />
        <ErroCaixa erro={salvar.error} />

        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-line bg-paper-light px-4 py-16 text-center text-sm text-ink-suave"
            >
              Carregando o editor…
            </div>
          }
        >
          <EditorVisual
            key={`visual-${estruturaVisual === '' ? 'novo' : 'salvo'}`}
            estruturaInicial={estruturaVisual}
            htmlInicial={corpoHtml}
            nome={nome}
            aoMudarNome={definirNome}
            categoria={categoria}
            aoMudarCategoria={definirCategoria}
            assunto={assunto}
            aoMudarAssunto={definirAssunto}
            aoSalvar={() => salvar.mutate()}
            salvando={salvar.isPending}
            rotuloSalvar={ehNovo ? 'Criar modelo' : 'Salvar modelo'}
            aoVoltar={() => navegar('/templates')}
            aoMudar={({ estruturaVisual: ev, corpoHtml: ch }) => {
              definirEstrutura(ev);
              definirCorpo(ch);
            }}
            aoPedirHtml={(html) => {
              definirCorpo(html);
              definirEstrutura('');
              definirTipo('CODIGO');
            }}
          />
        </Suspense>

        <p className="text-sm text-ink-suave">
          Prefere escrever o HTML?{' '}
          <button
            type="button"
            onClick={() => definirTipo('CODIGO')}
            className="font-medium text-ink underline"
          >
            Passar para HTML personalizado
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/templates"
        className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
      >
        ← Modelos
      </Link>

      <Aviso texto={avisoSalvo?.texto} tom={avisoSalvo?.tom ?? 'alerta'} />
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Tipo de modelo"
                ajuda="Criador de e-mail (arrastar e soltar) ou HTML personalizado."
              >
                <select
                  value={tipo}
                  onChange={(e) => definirTipo(e.target.value === 'VISUAL' ? 'VISUAL' : 'CODIGO')}
                  className={classeEntrada}
                >
                  <option value="VISUAL">Criador de e-mail</option>
                  <option value="CODIGO">HTML personalizado</option>
                </select>
              </Campo>
              <Campo rotulo="Categoria" ajuda="Opcional. Ex.: Novidade, Comunicado.">
                <input
                  value={categoria}
                  onChange={(e) => definirCategoria(e.target.value)}
                  className={classeEntrada}
                />
              </Campo>
            </div>
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
                {/* Só o modo código chega aqui: o visual ocupa a tela inteira
                    e sai antes, no `if (tipo === 'VISUAL')` acima. */}
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
