import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, dataHora, numero, percentual } from '../lib/formato.js';
import {
  Aviso,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TabelaRolavel,
  TituloPagina,
  Vazio,
  classeEntrada,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';
import {
  PERIODOS,
  dentroDaJanela,
  diasDaJanela,
  janelaAnterior,
  janelaPersonalizada,
  janelaRecente,
  type ValorPeriodo,
} from '../lib/periodo.js';
import { GraficoEngajamento } from '../componentes/GraficoEngajamento.tsx';
import type { Campanha } from './Campanhas.tsx';

interface Listagem {
  itens: Campanha[];
  truncado: boolean;
}

interface Lista {
  listId: string;
  nome: string;
  totalContatosAproximado?: number;
}

interface Risco {
  nivel: 'OK' | 'ATENCAO' | 'CRITICO';
  bounce: 'OK' | 'ATENCAO' | 'CRITICO';
  reclamacao: 'OK' | 'ATENCAO' | 'CRITICO';
  avisos: string[];
}

interface DesempenhoCampanha {
  campaignId: string;
  nome: string;
  status: string | null;
  disparadaEm: string | null;
  contadores: Record<string, number>;
  taxas: Record<string, number>;
}

interface Resumo {
  campanhasAgregadas: number;
  contadores: { enviados: number; entregues: number; respostas: number };
  taxas: {
    entrega: number;
    abertura: number;
    clique: number;
    bounceHard: number;
    resposta: number;
  };
  risco: Risco;
}

/**
 * Estados em que a campanha já produziu métrica.
 *
 * Rascunho e agendada não entram na agregação: somá-las só acrescentaria zeros
 * ao denominador e faria a taxa de entrega despencar sem que nada tivesse
 * acontecido.
 */
const JA_DISPAROU = new Set(['ENVIANDO', 'PAUSADA', 'CONCLUIDA', 'FALHA']);

export function Dashboard() {
  /**
   * O padrão é "Tudo", e não os últimos 30 dias.
   *
   * Um recorte pré-aplicado esconderia campanhas de quem abriu a tela sem pedir
   * nada — e quem não reparou no filtro leria "nenhuma campanha disparada" como
   * um fato sobre o escritório, não sobre a seleção.
   */
  const [periodo, definirPeriodo] = useState<ValorPeriodo>('tudo');
  const [desde, definirDesde] = useState('');
  const [ate, definirAte] = useState('');

  /**
   * "Agora" é congelado na montagem da tela. Um `new Date()` a cada render
   * moveria a janela alguns milissegundos por vez, trocando a chave de cache
   * das consultas e refazendo as requisições sozinho.
   */
  const agora = useMemo(() => new Date(), []);

  const janela = useMemo(() => {
    if (periodo === 'personalizado') return janelaPersonalizada(desde, ate);
    const dias = PERIODOS.find((p) => p.valor === periodo)?.dias ?? null;
    return dias === null ? null : janelaRecente(dias, agora);
  }, [periodo, desde, ate, agora]);

  const campanhas = useQuery({
    queryKey: ['campanhas', ''],
    queryFn: () => api.get<Listagem>('/campanhas'),
  });

  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () => api.get<{ itens: Lista[] }>('/listas'),
  });

  const itens = campanhas.data?.itens ?? [];
  const comMetrica = itens.filter((c) => JA_DISPAROU.has(c.status));

  /**
   * O período recorta pela **data de disparo**, e o que entra vem inteiro: os
   * contadores são totais acumulados por campanha, então uma campanha disparada
   * dentro da janela conta também as aberturas que chegaram depois dela. Fatiar
   * esse total por dia daria um número que o modelo não guarda.
   */
  const noPeriodo =
    janela === null ? comMetrica : comMetrica.filter((c) => dentroDaJanela(c.disparadaEm, janela));

  /**
   * Campanha disparada sem `disparadaEm` gravado não cabe em janela nenhuma.
   * São poucas e antigas, mas some-las em silêncio faria a soma do período não
   * bater com a de "Tudo" sem explicação à vista.
   */
  const semDataDeDisparo =
    janela === null ? 0 : comMetrica.filter((c) => c.disparadaEm === null).length;

  /**
   * A agregação recebe ids explícitos — a API não varre a base de propósito, para
   * não trocar um dashboard por uma conta de DynamoDB inesperada. Sem nenhum
   * campanha disparada não há o que somar, e chamar devolveria 400.
   */
  const ids = noPeriodo.map((c) => c.campaignId);
  const resumo = useQuery({
    queryKey: ['resumo', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => api.get<Resumo>(`/relatorios/resumo?campanhas=${ids.join(',')}`),
  });

  /**
   * O risco é apurado sobre **todas** as campanhas disparadas, não sobre o
   * período escolhido.
   *
   * Bounce alto é o número que suspende a conta na AWS, e ele não deixa de
   * existir porque alguém filtrou a tela por sete dias. Quando o período é
   * "Tudo" a chave é a mesma da consulta acima e o react-query reaproveita a
   * resposta — não custa uma requisição a mais.
   */
  const idsTodos = comMetrica.map((c) => c.campaignId);
  const resumoGeral = useQuery({
    queryKey: ['resumo', idsTodos.join(',')],
    enabled: idsTodos.length > 0,
    queryFn: () => api.get<Resumo>(`/relatorios/resumo?campanhas=${idsTodos.join(',')}`),
  });

  /**
   * Comparação: a janela de mesma duração imediatamente anterior. Sem campanha
   * lá atrás não há o que comparar, e a tela diz isso em vez de exibir uma
   * variação inventada a partir de zero.
   */
  const janelaPassada = janela === null ? null : janelaAnterior(janela);
  const idsAnteriores =
    janelaPassada === null
      ? []
      : comMetrica
          .filter((c) => dentroDaJanela(c.disparadaEm, janelaPassada))
          .map((c) => c.campaignId);
  const resumoAnterior = useQuery({
    queryKey: ['resumo', idsAnteriores.join(',')],
    enabled: idsAnteriores.length > 0,
    queryFn: () => api.get<Resumo>(`/relatorios/resumo?campanhas=${idsAnteriores.join(',')}`),
  });

  // Série agregada e desempenho por campanha — as duas seções que fazem a
  // visão geral responder "como estamos indo" sem abrir campanha por campanha.
  const serie = useQuery({
    queryKey: ['serie-geral', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () =>
      api.get<{ pontos: { dia: string; aberturas: number; cliques: number }[] }>(
        `/relatorios/serie?campanhas=${ids.join(',')}`,
      ),
  });
  const desempenho = useQuery({
    queryKey: ['desempenho', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () =>
      api.get<{ itens: DesempenhoCampanha[] }>(`/relatorios/desempenho?campanhas=${ids.join(',')}`),
  });

  if (campanhas.isLoading) return <Carregando />;

  const porEstado = (estado: string) => itens.filter((c) => c.status === estado).length;
  const contatos = (listas.data?.itens ?? []).reduce(
    (soma, l) => soma + (l.totalContatosAproximado ?? 0),
    0,
  );

  const enviando = itens.filter((c) => c.status === 'ENVIANDO');
  const agendados = itens
    .filter((c) => c.status === 'AGENDADA' && c.agendadaPara !== undefined)
    .sort((a, b) => (a.agendadaPara ?? '').localeCompare(b.agendadaPara ?? ''));

  // Um disparo que entrou em ENVIANDO e não processou ninguém está travado — foi
  // o sintoma que custou caro em agosto, e é o tipo de coisa que só se descobre
  // olhando. Aqui ele aparece sozinho.
  const travados = enviando.filter((c) => (c.processados ?? 0) === 0);

  const recentes = [...itens]
    .sort((a, b) => (b.criadoEm ?? '').localeCompare(a.criadoEm ?? ''))
    .slice(0, 5);

  /**
   * Duas formas do mesmo período: a curta serve de aposto depois do travessão
   * ("Desempenho por campanha — últimos 7 dias") e a longa completa a frase
   * ("3 campanhas disparadas nos últimos 7 dias"). Uma só das duas deixaria um
   * dos títulos torto.
   */
  const rotuloPeriodo =
    janela === null
      ? 'todo o período'
      : periodo === 'personalizado'
        ? `${dataDoCampo(desde)} a ${dataDoCampo(ate)}`
        : `últimos ${numero(diasDaJanela(janela))} dias`;

  const descricaoPeriodo =
    janela === null
      ? 'em todo o período'
      : periodo === 'personalizado'
        ? `de ${rotuloPeriodo}`
        : `nos ${rotuloPeriodo}`;

  // Sem janela não há período anterior; com janela e sem campanha lá atrás, a
  // comparação some e o cartão explica por quê.
  const rotuloComparacao =
    janela === null ? null : `vs. ${numero(diasDaJanela(janela))} dias anteriores`;
  const anterior = idsAnteriores.length === 0 ? undefined : resumoAnterior.data;

  const avisoPersonalizado =
    periodo !== 'personalizado' || janela !== null
      ? undefined
      : desde === '' || ate === ''
        ? 'Escolha as duas datas. Enquanto isso, o painel mostra todo o período.'
        : 'A data inicial precisa vir antes da final. Enquanto isso, o painel mostra todo o período.';

  return (
    <div className="space-y-6">
      <TituloPagina>Visão geral</TituloPagina>

      <ErroCaixa erro={campanhas.error} />

      {/**
       * O que precisa de ação vem primeiro, e some quando não há nada.
       *
       * Um painel que mostra "tudo certo" em verde todo dia treina quem olha a
       * ignorá-lo. Este bloco só existe quando existe motivo.
       */}
      {(travados.length > 0 ||
        (resumoGeral.data?.risco.nivel ?? 'OK') !== 'OK' ||
        contatos === 0) && (
        <Cartao titulo="Precisa da sua atenção">
          <div className="space-y-3">
            {travados.map((c) => (
              <Aviso
                key={c.campaignId}
                tom="alerta"
                texto={`A campanha "${c.nome}" está enviando e ainda não processou ninguém. Pode estar travado.`}
              />
            ))}

            {contatos === 0 && (
              <Aviso
                tom="alerta"
                texto="Nenhuma lista tem contatos. Importe a base antes de montar uma campanha — sem contatos não há para quem enviar."
              />
            )}

            {/**
             * O texto do aviso vem do domínio, não daqui.
             *
             * `avaliarRisco` já escreve a frase inteira — inclusive a que explica
             * que o volume ainda é baixo demais para o percentual significar algo.
             * Reescrever aqui seria manter duas réguas, e um dia elas divergiriam.
             */}
            {(resumoGeral.data?.risco.avisos ?? []).map((aviso) => (
              <Aviso key={aviso} tom="alerta" texto={aviso} />
            ))}
          </div>
        </Cartao>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Rascunhos" valor={numero(porEstado('RASCUNHO'))} />
        <Metrica
          rotulo="Agendados"
          valor={numero(porEstado('AGENDADA'))}
          detalhe={
            agendados[0]?.agendadaPara === undefined
              ? undefined
              : `próximo em ${dataHora(agendados[0].agendadaPara)}`
          }
        />
        <Metrica rotulo="Enviando agora" valor={numero(enviando.length)} />
        <Metrica
          rotulo="Contatos na base"
          valor={numero(contatos)}
          detalhe="soma aproximada das listas"
        />
      </div>

      {comMetrica.length > 0 && (
        <div className="rounded-md border border-line bg-paper-light p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium text-ink">Período</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
              {PERIODOS.map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  // Qual período está ativo não pode ser só o contraste do
                  // fundo: `aria-pressed` diz o mesmo a quem usa leitor de tela.
                  aria-pressed={periodo === p.valor}
                  onClick={() => definirPeriodo(p.valor)}
                  className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    periodo === p.valor
                      ? 'border-ink bg-ink text-paper-light'
                      : 'border-line bg-paper-light text-ink-suave hover:bg-accent-mist hover:text-ink'
                  }`}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
          </div>

          {periodo === 'personalizado' && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="w-44">
                <Campo rotulo="De">
                  <input
                    type="date"
                    value={desde}
                    max={ate === '' ? undefined : ate}
                    onChange={(e) => definirDesde(e.target.value)}
                    className={classeEntrada}
                  />
                </Campo>
              </div>
              <div className="w-44">
                <Campo rotulo="Até" ajuda="O dia escolhido entra inteiro.">
                  <input
                    type="date"
                    value={ate}
                    min={desde === '' ? undefined : desde}
                    onChange={(e) => definirAte(e.target.value)}
                    className={classeEntrada}
                  />
                </Campo>
              </div>
            </div>
          )}

          {/**
           * Dizer o alcance do filtro na própria tela.
           *
           * O período recorta os três blocos seguintes e não toca nas contagens
           * do topo — sem essa frase, "Rascunhos: 4" ao lado de "7 dias" parece
           * quatro rascunhos da semana, e não é isso que o número conta.
           */}
          <p className="mt-3 text-xs text-ink-suave">
            Recorta os blocos abaixo pela data de disparo. Rascunhos, agendados e contatos são a
            situação de hoje e não mudam com o período.
          </p>

          {avisoPersonalizado !== undefined && (
            <p className="mt-2 text-xs font-medium text-ink">{avisoPersonalizado}</p>
          )}

          {semDataDeDisparo > 0 && (
            <p className="mt-2 text-xs text-ink-suave">
              {semDataDeDisparo === 1
                ? '1 campanha disparada não tem data de disparo registrada e fica fora de qualquer período.'
                : `${numero(semDataDeDisparo)} campanhas disparadas não têm data de disparo registrada e ficam fora de qualquer período.`}
            </p>
          )}
        </div>
      )}

      {/**
       * Filtrou e não sobrou nada: o vazio precisa ser dito.
       *
       * Sumir com os três blocos deixaria a tela igual à de quem nunca disparou
       * campanha nenhuma — e a conclusão errada, nesse caso, é sobre o
       * escritório, não sobre o filtro.
       */}
      {comMetrica.length > 0 && ids.length === 0 && (
        <Cartao titulo={`Desempenho — ${rotuloPeriodo}`}>
          <Vazio mensagem="Nenhuma campanha foi disparada neste período." />
        </Cartao>
      )}

      {/**
       * As taxas só aparecem depois que algo saiu.
       *
       * Antes disso seriam quatro zeros com aparência de fracasso, quando o que
       * houve foi simplesmente nenhum envio ainda.
       */}
      {ids.length > 0 && (
        <Cartao
          titulo={
            ids.length === 1
              ? `Desempenho — 1 campanha disparada ${descricaoPeriodo}`
              : `Desempenho — ${numero(ids.length)} campanhas disparadas ${descricaoPeriodo}`
          }
        >
          {resumo.isLoading && <Carregando />}
          <ErroCaixa erro={resumo.error} />

          {janela !== null && idsAnteriores.length === 0 && (
            <p className="mb-3 text-xs text-ink-suave">
              Nenhuma campanha foi disparada nos {numero(diasDaJanela(janela))} dias anteriores —
              não há base de comparação.
            </p>
          )}

          {resumo.data !== undefined && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metrica
                rotulo="Entrega"
                valor={percentual(resumo.data.taxas.entrega)}
                detalhe={`${numero(resumo.data.contadores.entregues)} de ${numero(resumo.data.contadores.enviados)}`}
                comparacao={variacaoEmPontos(
                  resumo.data.taxas.entrega,
                  anterior?.taxas.entrega,
                  rotuloComparacao,
                )}
              />
              <Metrica
                rotulo="Abertura"
                valor={percentual(resumo.data.taxas.abertura)}
                comparacao={variacaoEmPontos(
                  resumo.data.taxas.abertura,
                  anterior?.taxas.abertura,
                  rotuloComparacao,
                )}
              />
              <Metrica
                rotulo="Clique"
                valor={percentual(resumo.data.taxas.clique)}
                comparacao={variacaoEmPontos(
                  resumo.data.taxas.clique,
                  anterior?.taxas.clique,
                  rotuloComparacao,
                )}
              />
              {/**
               * Respondidos vem em número absoluto no detalhe, não só em
               * percentual. Para um escritório de advocacia, "3 pessoas
               * responderam" é a informação que move alguém a agir; "0,4%"
               * é a mesma coisa dita de um jeito que ninguém age.
               */}
              <Metrica
                rotulo="Respondidos"
                valor={numero(resumo.data.contadores.respostas)}
                detalhe={`${percentual(resumo.data.taxas.resposta)} de quem recebeu`}
                comparacao={variacaoAbsoluta(
                  resumo.data.contadores.respostas,
                  anterior?.contadores.respostas,
                  rotuloComparacao,
                )}
              />
              <Metrica
                rotulo="Bounce permanente"
                valor={percentual(resumo.data.taxas.bounceHard)}
                // O bounce é o número que suspende a conta na AWS. Fica com o
                // mesmo destaque dos outros, mas com o nível de risco ao lado.
                detalhe={resumo.data.risco.bounce === 'OK' ? 'dentro do limiar' : 'acima do limiar'}
                alerta={resumo.data.risco.bounce !== 'OK'}
                comparacao={variacaoEmPontos(
                  resumo.data.taxas.bounceHard,
                  anterior?.taxas.bounceHard,
                  rotuloComparacao,
                )}
              />
            </div>
          )}
        </Cartao>
      )}

      {ids.length > 0 && (
        <Cartao
          titulo={
            janela === null
              ? 'Engajamento por dia — todas as campanhas'
              : 'Engajamento por dia — campanhas disparadas no período'
          }
        >
          {serie.isLoading && <Carregando />}
          <ErroCaixa erro={serie.error} />
          {serie.data !== undefined && <GraficoEngajamento pontos={serie.data.pontos} />}
        </Cartao>
      )}

      {ids.length > 0 && (
        <Cartao titulo={`Desempenho por campanha — ${rotuloPeriodo}`}>
          {desempenho.isLoading && <Carregando />}
          <ErroCaixa erro={desempenho.error} />
          {desempenho.data !== undefined && (
            <TabelaRolavel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-suave">
                    <th className="py-2 pr-3 font-medium">Campanha</th>
                    <th className="py-2 pr-3 font-medium">Disparada em</th>
                    <th className="py-2 pr-3 text-right font-medium">Enviados</th>
                    <th className="py-2 pr-3 text-right font-medium">Entrega</th>
                    <th className="py-2 pr-3 text-right font-medium">Abertura</th>
                    <th className="py-2 pr-3 text-right font-medium">Clique</th>
                    <th className="py-2 pr-3 text-right font-medium">Respostas</th>
                    <th className="py-2 pr-3 text-right font-medium">Bounce</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...desempenho.data.itens]
                    .sort((a, b) => (b.disparadaEm ?? '').localeCompare(a.disparadaEm ?? ''))
                    .map((d) => (
                      <tr key={d.campaignId}>
                        <td className="py-2 pr-3">
                          <Link
                            to={`/relatorios/${d.campaignId}`}
                            className="font-medium text-ink hover:underline"
                          >
                            {d.nome}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-ink-suave">
                          {d.disparadaEm === null ? '—' : dataHora(d.disparadaEm)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {numero(d.contadores['enviados'] ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {percentual(d.taxas['entrega'] ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {percentual(d.taxas['abertura'] ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {percentual(d.taxas['clique'] ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {numero(d.contadores['respostas'] ?? 0)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink">
                          {percentual(d.taxas['bounceHard'] ?? 0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TabelaRolavel>
          )}
        </Cartao>
      )}

      <Cartao titulo="Campanhas recentes">
        {recentes.length === 0 && <Vazio mensagem="Nenhuma campanha criada ainda." />}
        <ul className="divide-y divide-line">
          {recentes.map((c) => (
            <li
              key={c.campaignId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <Link
                  to={`/campanhas/${c.campaignId}`}
                  className="inline-flex min-h-11 items-center font-medium break-words text-ink hover:underline"
                >
                  {c.nome}
                </Link>
                <p className="text-xs text-ink-suave">
                  {c.agendadaPara === undefined
                    ? `criada em ${dataHora(c.criadoEm)}`
                    : `agendada para ${dataHora(c.agendadaPara)}`}
                  {c.status === 'ENVIANDO' && c.totalDestinatarios !== undefined
                    ? ` · ${numero(c.processados ?? 0)} de ${numero(c.totalDestinatarios)} processados`
                    : ''}
                </p>
              </div>
              <Selo tom={tomDoStatusCampanha(c.status)}>
                {ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}
              </Selo>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

function Metrica({
  rotulo,
  valor,
  detalhe,
  comparacao,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string | undefined;
  comparacao?: string | undefined;
  alerta?: boolean;
}): ReactNode {
  return (
    <div className="rounded-md border border-line bg-paper-light p-4">
      <p className="text-sm text-ink-suave">{rotulo}</p>
      <p className={`font-display text-2xl ${alerta ? 'text-erro' : 'text-ink'}`}>{valor}</p>
      {detalhe !== undefined && <p className="mt-1 text-xs text-ink-suave">{detalhe}</p>}
      {comparacao !== undefined && (
        <p className="mt-1 text-xs text-ink-suave tabular-nums">{comparacao}</p>
      )}
    </div>
  );
}

/**
 * `2026-08-01` → `01/08/2026`.
 *
 * À mão de propósito: o valor do `<input type="date">` não tem hora, e passá-lo
 * por `new Date()` o lê como meia-noite em UTC — que no fuso de São Paulo cai na
 * véspera. O rótulo mostraria um dia a menos do que o filtro está aplicando.
 */
function dataDoCampo(valor: string): string {
  const [ano = '', mes = '', dia = ''] = valor.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Variação sem cor.
 *
 * Verde para "subiu" e vermelho para "desceu" mentiria no bounce, onde subir é
 * a pior notícia da tela — e cor sozinha já não serve como único sinal. O sinal
 * explícito diz a direção; se é bom ou ruim, quem lê a métrica sabe.
 *
 * Taxas variam em **pontos percentuais**: dizer que a abertura "subiu 20%"
 * quando foi de 40% para 48% confunde a variação relativa com a absoluta.
 */
function variacaoEmPontos(
  atual: number,
  anterior: number | undefined,
  rotulo: string | null,
): string | undefined {
  if (anterior === undefined || rotulo === null) return undefined;

  const delta = (atual - anterior) * 100;
  // Abaixo de 0,05 p.p. o arredondamento imprimiria "+0,0 p.p.", que lê como
  // mudança onde não houve nenhuma digna de nota.
  if (Math.abs(delta) < 0.05) return `sem mudança ${rotulo}`;

  const valor = Math.abs(delta).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${delta > 0 ? '+' : '−'}${valor} p.p. ${rotulo}`;
}

function variacaoAbsoluta(
  atual: number,
  anterior: number | undefined,
  rotulo: string | null,
): string | undefined {
  if (anterior === undefined || rotulo === null) return undefined;

  const delta = atual - anterior;
  if (delta === 0) return `sem mudança ${rotulo}`;
  return `${delta > 0 ? '+' : '−'}${numero(Math.abs(delta))} ${rotulo}`;
}
