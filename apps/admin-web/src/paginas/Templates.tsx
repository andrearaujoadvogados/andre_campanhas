import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutGrid, List } from 'lucide-react';

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
  TabelaRolavel,
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
  criadoPor?: string;
  criadoEm?: string;
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

const FILTROS_TIPO = [
  { valor: '', rotulo: 'Todos os tipos' },
  { valor: 'VISUAL', rotulo: 'Criador' },
  { valor: 'CODIGO', rotulo: 'Código' },
] as const;

/** Grade com prévias ou lista compacta — preferência de quem usa, não dado do sistema. */
const CHAVE_VISUALIZACAO = 'emailmkt:templates-visualizacao';

// try/catch como nos módulos do criador: jsdom de teste e modo privado não
// expõem o storage, e a tela funciona igual — a escolha só não sobrevive.
function lerVisualizacao(): 'grade' | 'lista' {
  try {
    return window.localStorage.getItem(CHAVE_VISUALIZACAO) === 'lista' ? 'lista' : 'grade';
  } catch {
    return 'grade';
  }
}

function gravarVisualizacao(modo: 'grade' | 'lista'): void {
  try {
    window.localStorage.setItem(CHAVE_VISUALIZACAO, modo);
  } catch {
    // Sem storage: a preferência vale só até sair da tela.
  }
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

/**
 * Prévia visual do modelo no card.
 *
 * Renderiza o HTML do próprio modelo num iframe reduzido, em vez de depender de
 * uma imagem gravada: o `thumbnail` nunca é preenchido hoje, e gerar imagem
 * exigiria rasterizar o HTML em algum lugar. Assim a prévia vale para os modelos
 * que já existem, sem migração e sem backend novo.
 *
 * O e-mail renderiza na largura canônica de 640px — encolher o iframe direto
 * mudaria o layout e a prévia mostraria algo que ninguém vai receber — e a
 * escala acompanha a largura real do card, medida aqui: o topo do e-mail
 * preenche o quadro inteiro, como na caixa de entrada. A versão anterior usava
 * escala fixa (0.42) num quadro menor e centrado, e a prévia saía deslocada e
 * cortada num ponto arbitrário — modelos diferentes ficavam iguais.
 *
 * O conteúdo vem de `GET /templates/:id` — a listagem devolve só metadados. São
 * algumas dezenas de modelos no total, e o React Query cacheia; o custo é uma
 * requisição por card, uma vez.
 *
 * `sandbox=""` e `pointer-events-none`: o HTML é autoral e não deve executar
 * nada nem capturar o clique, que pertence ao link do card.
 */
const LARGURA_EMAIL = 640;
/** Altura do quadro — o `h-40` do contêiner em pixels; muda um, muda o outro. */
const ALTURA_PREVIA = 160;

function PreviaModelo({ id }: { id: string }) {
  const quadroRef = useRef<HTMLDivElement | null>(null);
  const [largura, definirLargura] = useState(0);

  useLayoutEffect(() => {
    const el = quadroRef.current;
    if (el === null) return;
    definirLargura(el.clientWidth);
    // O jsdom dos testes não tem ResizeObserver; lá a medida única acima basta.
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => definirLargura(el.clientWidth));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const conteudo = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.get<Template>(`/templates/${id}`),
    staleTime: 5 * 60_000,
  });

  const html = conteudo.data?.conteudo?.corpoHtml;
  const escala = largura > 0 ? largura / LARGURA_EMAIL : 0;
  const aviso = conteudo.isLoading
    ? 'carregando prévia…'
    : html === undefined || html === ''
      ? 'sem prévia'
      : undefined;

  return (
    <div ref={quadroRef} className="relative h-40 overflow-hidden border-b border-line bg-paper">
      {aviso !== undefined ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-suave">
          {aviso}
        </span>
      ) : escala > 0 ? (
        <iframe
          title=""
          aria-hidden="true"
          tabIndex={-1}
          sandbox=""
          srcDoc={html}
          style={{
            width: `${LARGURA_EMAIL}px`,
            height: `${Math.ceil(ALTURA_PREVIA / escala)}px`,
            transform: `scale(${escala})`,
            transformOrigin: 'top left',
          }}
          className="pointer-events-none absolute top-0 left-0 border-0 bg-white"
        />
      ) : null}
    </div>
  );
}

export function Templates() {
  const qc = useQueryClient();
  const [selecionados, definirSelecionados] = useState<Set<string>>(new Set());
  const [mostrarArquivados, definirMostrarArquivados] = useState(false);

  const [modo, definirModo] = useState<'grade' | 'lista'>(lerVisualizacao);
  const trocarModo = (novo: 'grade' | 'lista') => {
    definirModo(novo);
    gravarVisualizacao(novo);
  };

  // Filtros — recortes no cliente sobre a página carregada, como em Campanhas:
  // a listagem já traz a partição inteira do tenant, e filtrar de novo no
  // servidor seria outra consulta para responder menos.
  const [filtroTipo, definirFiltroTipo] = useState('');
  const [filtroCategoria, definirFiltroCategoria] = useState('');
  const [filtroCriador, definirFiltroCriador] = useState('');
  const [criadoDe, definirCriadoDe] = useState('');
  const [criadoAte, definirCriadoAte] = useState('');

  const lista = useQuery({
    queryKey: ['templates'],
    queryFn: () =>
      api.get<{
        itens: Template[];
        criadores?: Record<string, string>;
        variaveisDisponiveis: Variavel[];
      }>('/templates'),
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
  const criadores = lista.data?.criadores ?? {};
  const arquivados = todos.filter((t) => t.arquivado).length;

  /** E-mail de quem criou; sem o mapa (Cognito indisponível), o identificador cru. */
  const nomeCriador = (t: Template) =>
    t.criadoPor === undefined ? undefined : (criadores[t.criadoPor] ?? t.criadoPor);

  const filtroAtivo =
    filtroTipo !== '' ||
    filtroCategoria !== '' ||
    filtroCriador !== '' ||
    criadoDe !== '' ||
    criadoAte !== '';

  const itens = todos.filter((t) => {
    if (!mostrarArquivados && t.arquivado) return false;
    if (filtroTipo !== '' && (t.tipo ?? 'CODIGO') !== filtroTipo) return false;
    if (filtroCategoria !== '' && (t.categoria ?? '') !== filtroCategoria) return false;
    if (filtroCriador !== '' && t.criadoPor !== filtroCriador) return false;
    if (t.criadoEm !== undefined) {
      // Limites no fuso de quem olha: "criado a partir de 13/08" quer dizer o
      // dia 13 do operador, não o dia 13 em UTC.
      if (criadoDe !== '' && new Date(t.criadoEm) < new Date(`${criadoDe}T00:00:00`)) return false;
      if (criadoAte !== '' && new Date(t.criadoEm) > new Date(`${criadoAte}T23:59:59.999`))
        return false;
    }
    return true;
  });

  // As opções saem do que existe de fato: categoria é texto livre e não há
  // catálogo a consultar — um filtro sem resultado possível não é opção.
  const categorias = [...new Set(todos.map((t) => t.categoria ?? '').filter((c) => c !== ''))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );
  const opcoesCriador = [
    ...new Set(todos.map((t) => t.criadoPor).filter((s): s is string => s !== undefined)),
  ]
    .map((sub) => ({ sub, rotulo: criadores[sub] ?? sub }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));

  const limparFiltros = () => {
    definirFiltroTipo('');
    definirFiltroCategoria('');
    definirFiltroCriador('');
    definirCriadoDe('');
    definirCriadoAte('');
  };

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
        {todos.length === 0 && !lista.isLoading && <Vazio mensagem="Nenhum modelo criado ainda." />}

        {/* Os controles dependem de haver modelos, não de o filtro achar algum:
            esconder o filtro que zerou a lista trancaria o usuário no vazio. */}
        {todos.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1.5">
                {FILTROS_TIPO.map((f) => (
                  <button
                    key={f.valor}
                    type="button"
                    aria-pressed={filtroTipo === f.valor}
                    onClick={() => definirFiltroTipo(f.valor)}
                    className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      filtroTipo === f.valor
                        ? 'border-ink bg-ink text-paper-light'
                        : 'border-line bg-paper-light text-ink-suave hover:bg-accent-mist hover:text-ink'
                    }`}
                  >
                    {f.rotulo}
                  </button>
                ))}
              </div>

              <div
                role="group"
                aria-label="Modo de visualização"
                className="inline-flex overflow-hidden rounded-md border border-line"
              >
                {(
                  [
                    { valor: 'grade', rotulo: 'Grade', Icone: LayoutGrid },
                    { valor: 'lista', rotulo: 'Lista', Icone: List },
                  ] as const
                ).map(({ valor, rotulo, Icone }) => (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={modo === valor}
                    onClick={() => trocarModo(valor)}
                    className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                      modo === valor
                        ? 'bg-ink text-paper-light'
                        : 'bg-paper-light text-ink-suave hover:bg-accent-mist hover:text-ink'
                    }`}
                  >
                    <Icone aria-hidden="true" className="size-4" />
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {categorias.length > 0 && (
                <div>
                  <label className="mr-2 text-sm text-ink-suave" htmlFor="filtro-categoria">
                    Categoria:
                  </label>
                  <select
                    id="filtro-categoria"
                    value={filtroCategoria}
                    onChange={(e) => definirFiltroCategoria(e.target.value)}
                    className={`${classeEntrada} inline-block w-auto`}
                  >
                    <option value="">Todas</option>
                    {categorias.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {opcoesCriador.length > 0 && (
                <div>
                  <label className="mr-2 text-sm text-ink-suave" htmlFor="filtro-criador">
                    Criado por:
                  </label>
                  <select
                    id="filtro-criador"
                    value={filtroCriador}
                    onChange={(e) => definirFiltroCriador(e.target.value)}
                    className={`${classeEntrada} inline-block w-auto`}
                  >
                    <option value="">Todos</option>
                    {opcoesCriador.map((o) => (
                      <option key={o.sub} value={o.sub}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mr-2 text-sm text-ink-suave" htmlFor="filtro-criado-de">
                  Criado de:
                </label>
                <input
                  id="filtro-criado-de"
                  type="date"
                  value={criadoDe}
                  onChange={(e) => definirCriadoDe(e.target.value)}
                  className={`${classeEntrada} inline-block w-auto`}
                />
              </div>
              <div>
                <label className="mr-2 text-sm text-ink-suave" htmlFor="filtro-criado-ate">
                  até:
                </label>
                <input
                  id="filtro-criado-ate"
                  type="date"
                  value={criadoAte}
                  onChange={(e) => definirCriadoAte(e.target.value)}
                  className={`${classeEntrada} inline-block w-auto`}
                />
              </div>

              {filtroAtivo && (
                <Botao variante="discreto" onClick={limparFiltros}>
                  Limpar filtros
                </Botao>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
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
                    <span className="text-sm text-ink-suave">
                      {selecionados.size} selecionado(s)
                    </span>
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
          </div>
        )}

        <ErroCaixa erro={arquivarSelecionados.error} />
        {arquivarSelecionados.data !== undefined && arquivarSelecionados.data.falhas > 0 && (
          <Aviso
            tom="alerta"
            texto={`${arquivarSelecionados.data.falhas} de ${arquivarSelecionados.data.total} não puderam ser arquivados.`}
          />
        )}

        {todos.length > 0 && itens.length === 0 && (
          <Vazio mensagem="Nenhum modelo para este filtro." />
        )}

        {itens.length > 0 && modo === 'grade' && (
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
                  {/* A prévia é o HTML real do modelo, reduzido até caber. */}
                  <PreviaModelo id={t.templateId} />
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
                    {nomeCriador(t) !== undefined && (
                      <p className="truncate text-xs text-ink-suave">criado por {nomeCriador(t)}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {itens.length > 0 && modo === 'lista' && (
          <TabelaRolavel>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-ink-suave">
                  <th scope="col" className="w-10 py-2 pr-3">
                    <span className="sr-only">Selecionar</span>
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Modelo
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Tipo
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Categoria
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Versão
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Criado por
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Criado em
                  </th>
                  <th scope="col" className="py-2">
                    Atualizado em
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {itens.map((t) => (
                  <tr key={t.templateId}>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`Selecionar ${t.nome}`}
                        checked={selecionados.has(t.templateId)}
                        onChange={() => alternar(t.templateId)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        to={`/templates/${t.templateId}`}
                        className="inline-flex min-h-11 items-center font-medium text-ink hover:underline"
                      >
                        {t.nome}
                      </Link>
                      {t.arquivado && (
                        <span className="ml-2">
                          <Selo tom="neutro">Arquivado</Selo>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Selo tom={t.tipo === 'VISUAL' ? 'positivo' : 'neutro'}>
                        {ROTULO_TIPO_TEMPLATE[t.tipo ?? 'CODIGO']}
                      </Selo>
                    </td>
                    <td className="py-2 pr-3 text-ink-suave">{t.categoria ?? '—'}</td>
                    <td className="py-2 pr-3 text-ink-suave">{t.versaoAtual}</td>
                    <td className="py-2 pr-3 text-ink-suave">{nomeCriador(t) ?? '—'}</td>
                    <td className="py-2 pr-3 text-ink-suave">
                      {t.criadoEm === undefined ? '—' : dataHora(t.criadoEm)}
                    </td>
                    <td className="py-2 text-ink-suave">{dataHora(t.atualizadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
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
