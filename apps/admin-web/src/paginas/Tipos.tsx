import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  TituloPagina,
  Vazio,
  classeEntrada,
} from '../componentes/base.tsx';

interface TipoEmail {
  tipoEmailId: string;
  nome: string;
}

/**
 * Gestão dos tipos de e-mail — o catálogo que alimenta o seletor de tipo do
 * boletim e o filtro da listagem. "Boletim" é semeado pelo backend; daqui o
 * usuário cria, renomeia e remove os demais.
 */
export function Tipos() {
  const qc = useQueryClient();
  const [nome, definirNome] = useState('');
  const [editandoId, definirEditandoId] = useState<string | null>(null);
  const [nomeEdit, definirNomeEdit] = useState('');

  const tipos = useQuery({
    queryKey: ['tipos'],
    queryFn: () => api.get<{ itens: TipoEmail[] }>('/tipos'),
  });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ['tipos'] });

  const criar = useMutation({
    mutationFn: () => api.post<TipoEmail>('/tipos', { nome: nome.trim() }),
    onSuccess: () => {
      definirNome('');
      invalidar();
    },
  });

  const renomear = useMutation({
    mutationFn: (t: TipoEmail) =>
      api.patch<TipoEmail>(`/tipos/${t.tipoEmailId}`, { nome: nomeEdit.trim() }),
    onSuccess: () => {
      definirEditandoId(null);
      invalidar();
    },
  });

  const excluir = useMutation({
    mutationFn: (id: string) => api.delete(`/tipos/${id}`),
    onSuccess: invalidar,
  });

  return (
    <div className="space-y-6">
      <TituloPagina>Tipos de e-mail</TituloPagina>

      <Cartao titulo="Novo tipo">
        <p className="mb-3 text-sm text-ink-suave">
          Cada boletim escolhe um tipo (Boletim, Comunicado, Convite…). Serve para organizar e
          filtrar os envios.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <Campo rotulo="Nome do tipo" obrigatorio>
              <input
                value={nome}
                onChange={(e) => definirNome(e.target.value)}
                placeholder="ex.: Comunicado"
                className={classeEntrada}
              />
            </Campo>
          </div>
          <Botao
            carregando={criar.isPending}
            disabled={nome.trim() === ''}
            onClick={() => criar.mutate()}
          >
            Adicionar
          </Botao>
        </div>
        <div className="mt-2 empty:mt-0">
          <ErroCaixa erro={criar.error} />
        </div>
      </Cartao>

      <Cartao titulo="Tipos cadastrados">
        {tipos.isLoading && <Carregando />}
        <ErroCaixa erro={tipos.error} />
        {tipos.data?.itens.length === 0 && <Vazio mensagem="Nenhum tipo cadastrado." />}

        <ul className="divide-y divide-line">
          {tipos.data?.itens.map((t) => (
            <li key={t.tipoEmailId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
              {editandoId === t.tipoEmailId ? (
                <>
                  <input
                    value={nomeEdit}
                    onChange={(e) => definirNomeEdit(e.target.value)}
                    className={`${classeEntrada} max-w-xs`}
                  />
                  <Botao
                    carregando={renomear.isPending}
                    disabled={nomeEdit.trim() === ''}
                    onClick={() => renomear.mutate(t)}
                  >
                    Salvar
                  </Botao>
                  <Botao variante="secundario" onClick={() => definirEditandoId(null)}>
                    Cancelar
                  </Botao>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium text-ink">{t.nome}</span>
                  <Botao
                    variante="secundario"
                    onClick={() => {
                      definirNomeEdit(t.nome);
                      definirEditandoId(t.tipoEmailId);
                    }}
                  >
                    Renomear
                  </Botao>
                  <Botao
                    variante="perigo"
                    carregando={excluir.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Excluir o tipo "${t.nome}"? Os boletins que o usavam continuam existindo, sem tipo.`,
                        )
                      )
                        excluir.mutate(t.tipoEmailId);
                    }}
                  >
                    Excluir
                  </Botao>
                </>
              )}
            </li>
          ))}
        </ul>
        <ErroCaixa erro={renomear.error} />
        <ErroCaixa erro={excluir.error} />
      </Cartao>
    </div>
  );
}
