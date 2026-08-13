import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_STATUS_CAMPANHA, dataHora, numero, percentual } from '../lib/formato.js';
import {
  Aviso,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TabelaRolavel,
  TituloPagina,
  Vazio,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';
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
   * A agregação recebe ids explícitos — a API não varre a base de propósito, para
   * não trocar um dashboard por uma conta de DynamoDB inesperada. Sem nenhum
   * campanha disparada não há o que somar, e chamar devolveria 400.
   */
  const ids = comMetrica.map((c) => c.campaignId);
  const resumo = useQuery({
    queryKey: ['resumo', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => api.get<Resumo>(`/relatorios/resumo?campanhas=${ids.join(',')}`),
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
      {(travados.length > 0 || (resumo.data?.risco.nivel ?? 'OK') !== 'OK' || contatos === 0) && (
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
            {(resumo.data?.risco.avisos ?? []).map((aviso) => (
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
              ? 'Desempenho — 1 campanha disparada'
              : `Desempenho — ${numero(ids.length)} campanhas disparadas`
          }
        >
          {resumo.isLoading && <Carregando />}
          <ErroCaixa erro={resumo.error} />
          {resumo.data !== undefined && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metrica
                rotulo="Entrega"
                valor={percentual(resumo.data.taxas.entrega)}
                detalhe={`${numero(resumo.data.contadores.entregues)} de ${numero(resumo.data.contadores.enviados)}`}
              />
              <Metrica rotulo="Abertura" valor={percentual(resumo.data.taxas.abertura)} />
              <Metrica rotulo="Clique" valor={percentual(resumo.data.taxas.clique)} />
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
              />
              <Metrica
                rotulo="Bounce permanente"
                valor={percentual(resumo.data.taxas.bounceHard)}
                // O bounce é o número que suspende a conta na AWS. Fica com o
                // mesmo destaque dos outros, mas com o nível de risco ao lado.
                detalhe={resumo.data.risco.bounce === 'OK' ? 'dentro do limiar' : 'acima do limiar'}
                alerta={resumo.data.risco.bounce !== 'OK'}
              />
            </div>
          )}
        </Cartao>
      )}

      {ids.length > 0 && (
        <Cartao titulo="Engajamento por dia — todas as campanhas">
          {serie.isLoading && <Carregando />}
          <ErroCaixa erro={serie.error} />
          {serie.data !== undefined && <GraficoEngajamento pontos={serie.data.pontos} />}
        </Cartao>
      )}

      {ids.length > 0 && (
        <Cartao titulo="Desempenho por campanha">
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
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
}): ReactNode {
  return (
    <div className="rounded-md border border-line bg-paper-light p-4">
      <p className="text-sm text-ink-suave">{rotulo}</p>
      <p className={`font-display text-2xl ${alerta ? 'text-erro' : 'text-ink'}`}>{valor}</p>
      {detalhe !== undefined && <p className="mt-1 text-xs text-ink-suave">{detalhe}</p>}
    </div>
  );
}
