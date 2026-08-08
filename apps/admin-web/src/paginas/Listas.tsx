import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ROTULO_RELACIONAMENTO, ROTULO_STATUS_CONTATO, dataHora, numero } from '../lib/formato.js';
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
  tomDoStatusContato,
} from '../componentes/base.tsx';

interface Lista {
  listId: string;
  nome: string;
  descricao?: string;
  totalContatosAproximado: number;
  atualizadoEm: string;
}

interface PreviaAudiencia {
  receberao: number;
  naoReceberao: number;
  explicacoes: { motivo: string; quantidade: number; explicacao: string }[];
}

interface ContatoDaLista {
  contactId: string;
  email: string;
  nome?: string;
  status: string;
  relacionamento: string;
  elegivelParaCampanha: boolean;
  motivosInelegibilidade: { motivo: string; status?: string }[];
}

export function Listas() {
  const qc = useQueryClient();
  const [nome, definirNome] = useState('');

  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () => api.get<{ itens: Lista[] }>('/listas'),
  });

  const criar = useMutation({
    mutationFn: () => api.post<Lista>('/listas', { nome }),
    onSuccess: () => {
      definirNome('');
      void qc.invalidateQueries({ queryKey: ['listas'] });
    },
  });

  return (
    <div className="space-y-6">
      <TituloPagina>Listas</TituloPagina>

      <Cartao titulo="Nova lista">
        {/* No celular o campo e o botão empilham: lado a lado, o "Criar" ficaria
            estreito demais para acertar com o dedo. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Campo rotulo="Nome" obrigatorio>
              <input
                value={nome}
                onChange={(e) => definirNome(e.target.value)}
                className={classeEntrada}
              />
            </Campo>
          </div>
          <Botao
            onClick={() => criar.mutate()}
            disabled={nome.trim() === ''}
            carregando={criar.isPending}
          >
            Criar
          </Botao>
        </div>
        <div className="mt-3">
          <ErroCaixa erro={criar.error} />
        </div>
      </Cartao>

      <Cartao>
        {listas.isLoading && <Carregando />}
        <ErroCaixa erro={listas.error} />
        {listas.data?.itens.length === 0 && <Vazio mensagem="Nenhuma lista criada ainda." />}

        <ul className="divide-y divide-line">
          {listas.data?.itens.map((l) => (
            <li
              key={l.listId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
            >
              {/* O nome da lista é digitado pelo operador: sem `min-w-0` e quebra
                  de palavra, um nome longo empurra a página inteira para o lado
                  no celular. */}
              <div className="min-w-0">
                <Link
                  to={`/listas/${l.listId}`}
                  className="inline-flex min-h-11 items-center font-medium break-words text-ink hover:underline"
                >
                  {l.nome}
                </Link>
                <p className="text-xs text-ink-suave">
                  {/* "Aproximado" não é modéstia: o número exato só existe depois
                      de aplicar supressão e elegibilidade. */}
                  ~{numero(l.totalContatosAproximado)} contatos · atualizada em{' '}
                  {dataHora(l.atualizadoEm)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

export function ListaDetalhe() {
  const { id = '' } = useParams();

  const previa = useQuery({
    queryKey: ['lista', id, 'previa'],
    queryFn: () => api.get<PreviaAudiencia>(`/listas/${id}/previa-audiencia`),
  });

  const contatos = useQuery({
    queryKey: ['lista', id, 'contatos'],
    queryFn: () => api.get<{ itens: ContatoDaLista[] }>(`/listas/${id}/contatos`),
  });

  return (
    <div className="space-y-6">
      <Link
        to="/listas"
        className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
      >
        ← Listas
      </Link>

      {/**
       * A prévia de audiência vem primeiro, antes da lista de contatos.
       *
       * É o número que decide se vale disparar. Enterrá-la abaixo de uma tabela
       * de 5.000 linhas seria esconder exatamente a informação que evita a
       * pergunta "por que só 1.200 receberam?" depois do envio.
       */}
      <Cartao titulo="Quem vai receber">
        {previa.isLoading && <Carregando />}
        <ErroCaixa erro={previa.error} />

        {previa.data !== undefined && (
          <>
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <p className="text-3xl font-semibold text-sucesso">
                  {numero(previa.data.receberao)}
                </p>
                <p className="text-sm text-ink-suave">vão receber</p>
              </div>
              <div>
                {/* Os dois números não se distinguem só pelo tom: cada um traz o
                    próprio rótulo embaixo. */}
                <p className="text-3xl font-semibold text-ink-suave">
                  {numero(previa.data.naoReceberao)}
                </p>
                <p className="text-sm text-ink-suave">não vão receber</p>
              </div>
            </div>

            {previa.data.explicacoes.length > 0 && (
              <ul className="mt-5 space-y-2 border-t border-line pt-4">
                {previa.data.explicacoes.map((e) => (
                  <li key={e.motivo} className="text-sm">
                    <span className="font-medium text-ink">{numero(e.quantidade)}</span>
                    <span className="text-ink-suave"> — {e.explicacao}</span>
                  </li>
                ))}
              </ul>
            )}

            {previa.data.receberao === 0 && (
              <div className="mt-4">
                <Aviso
                  tom="alerta"
                  texto="Nenhum contato desta lista está apto a receber. Classifique o vínculo dos contatos antes de criar a campanha."
                />
              </div>
            )}
          </>
        )}
      </Cartao>

      <Cartao titulo="Contatos da lista">
        {contatos.isLoading && <Carregando />}
        <ErroCaixa erro={contatos.error} />
        {/* A tabela só aparece quando há linhas. Um cabeçalho "Contato · Situação ·
            Vínculo · Recebe?" pairando sobre o vazio — ou sobre o "Carregando…" —
            promete um conteúdo que não existe, e o leitor de tela anuncia uma
            tabela de zero linhas. */}
        {contatos.data !== undefined &&
          (contatos.data.itens.length === 0 ? (
            <Vazio mensagem="Lista sem contatos." />
          ) : (
            <TabelaRolavel>
              <table className="w-full min-w-[34rem] text-sm">
                {/* Sem cabeçalho, o leitor de tela anuncia "Ativo" e "Cliente" sem
                    dizer de que coluna vieram. */}
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium text-ink-suave">
                    <th scope="col" className="py-2 pr-3">
                      Contato
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Situação
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Vínculo
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Recebe?
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {contatos.data.itens.map((c) => (
                    <tr key={c.contactId}>
                      <td className="py-2 pr-3">
                        <Link
                          to={`/contatos/${c.contactId}`}
                          className="inline-flex min-h-11 items-center text-ink hover:underline"
                        >
                          {c.nome ?? c.email}
                        </Link>
                        {c.nome !== undefined && (
                          <span className="ml-2 text-xs text-ink-suave">{c.email}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Selo tom={tomDoStatusContato(c.status)}>
                          {ROTULO_STATUS_CONTATO[c.status] ?? c.status}
                        </Selo>
                      </td>
                      <td className="py-2 pr-3 text-ink-suave">
                        {ROTULO_RELACIONAMENTO[c.relacionamento] ?? c.relacionamento}
                      </td>
                      <td className="py-2 text-right">
                        {c.elegivelParaCampanha ? (
                          <Selo tom="positivo">Apto</Selo>
                        ) : (
                          <Selo tom="atencao">Não recebe</Selo>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaRolavel>
          ))}
      </Cartao>
    </div>
  );
}
