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
      <h1 className="text-xl font-semibold text-slate-900">Listas</h1>

      <Cartao titulo="Nova lista">
        <div className="flex items-end gap-3">
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

        <ul className="divide-y divide-slate-100">
          {listas.data?.itens.map((l) => (
            <li key={l.listId} className="flex items-center justify-between py-3">
              <div>
                <Link
                  to={`/listas/${l.listId}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  {l.nome}
                </Link>
                <p className="text-xs text-slate-500">
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
      <Link to="/listas" className="text-sm text-slate-500 hover:underline">
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
            <div className="flex gap-8">
              <div>
                <p className="text-3xl font-semibold text-emerald-700">
                  {numero(previa.data.receberao)}
                </p>
                <p className="text-sm text-slate-600">vão receber</p>
              </div>
              <div>
                <p className="text-3xl font-semibold text-slate-400">
                  {numero(previa.data.naoReceberao)}
                </p>
                <p className="text-sm text-slate-600">não vão receber</p>
              </div>
            </div>

            {previa.data.explicacoes.length > 0 && (
              <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4">
                {previa.data.explicacoes.map((e) => (
                  <li key={e.motivo} className="text-sm">
                    <span className="font-medium text-slate-900">{numero(e.quantidade)}</span>
                    <span className="text-slate-600"> — {e.explicacao}</span>
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
        {contatos.data?.itens.length === 0 && <Vazio mensagem="Lista sem contatos." />}

        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {contatos.data?.itens.map((c) => (
              <tr key={c.contactId}>
                <td className="py-2">
                  <Link to={`/contatos/${c.contactId}`} className="hover:underline">
                    {c.nome ?? c.email}
                  </Link>
                  {c.nome !== undefined && (
                    <span className="ml-2 text-xs text-slate-500">{c.email}</span>
                  )}
                </td>
                <td className="py-2">
                  <Selo tom={tomDoStatusContato(c.status)}>
                    {ROTULO_STATUS_CONTATO[c.status] ?? c.status}
                  </Selo>
                </td>
                <td className="py-2 text-slate-600">
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
      </Cartao>
    </div>
  );
}
