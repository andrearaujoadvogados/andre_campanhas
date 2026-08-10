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
  TituloPagina,
  Vazio,
  tomDoStatusCampanha,
} from '../componentes/base.tsx';
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

interface Resumo {
  campanhasAgregadas: number;
  contadores: { enviados: number; entregues: number };
  taxas: { entrega: number; abertura: number; clique: number; bounceHard: number };
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
  const boletins = useQuery({
    queryKey: ['campanhas', ''],
    queryFn: () => api.get<Listagem>('/boletins'),
  });

  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () => api.get<{ itens: Lista[] }>('/listas'),
  });

  const itens = boletins.data?.itens ?? [];
  const comMetrica = itens.filter((c) => JA_DISPAROU.has(c.status));

  /**
   * A agregação recebe ids explícitos — a API não varre a base de propósito, para
   * não trocar um dashboard por uma conta de DynamoDB inesperada. Sem nenhum
   * boletim disparado não há o que somar, e chamar devolveria 400.
   */
  const ids = comMetrica.map((c) => c.campaignId);
  const resumo = useQuery({
    queryKey: ['resumo', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => api.get<Resumo>(`/relatorios/resumo?campanhas=${ids.join(',')}`),
  });

  if (boletins.isLoading) return <Carregando />;

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

      <ErroCaixa erro={boletins.error} />

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
                texto={`O boletim "${c.nome}" está enviando e ainda não processou ninguém. Pode estar travado.`}
              />
            ))}

            {contatos === 0 && (
              <Aviso
                tom="alerta"
                texto="Nenhuma lista tem contatos. Importe a base antes de montar um boletim — sem contatos não há para quem enviar."
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
              ? 'Desempenho — 1 boletim disparado'
              : `Desempenho — ${numero(ids.length)} boletins disparados`
          }
        >
          {resumo.isLoading && <Carregando />}
          <ErroCaixa erro={resumo.error} />
          {resumo.data !== undefined && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metrica
                rotulo="Entrega"
                valor={percentual(resumo.data.taxas.entrega)}
                detalhe={`${numero(resumo.data.contadores.entregues)} de ${numero(resumo.data.contadores.enviados)}`}
              />
              <Metrica rotulo="Abertura" valor={percentual(resumo.data.taxas.abertura)} />
              <Metrica rotulo="Clique" valor={percentual(resumo.data.taxas.clique)} />
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

      <Cartao titulo="Boletins recentes">
        {recentes.length === 0 && <Vazio mensagem="Nenhum boletim criado ainda." />}
        <ul className="divide-y divide-line">
          {recentes.map((c) => (
            <li
              key={c.campaignId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <Link
                  to={`/boletins/${c.campaignId}`}
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
