import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ComAviso } from '../lib/api.js';
import { dataHora } from '../lib/formato.js';
import type { Usuario } from '../lib/auth.js';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Carregando,
  ErroCaixa,
  Selo,
  TabelaRolavel,
  TituloPagina,
  Vazio,
  classeEntrada,
} from '../componentes/base.tsx';

interface UsuarioDoPainel {
  id: string;
  sub: string;
  email: string;
  papeis: string[];
  habilitado: boolean;
  aguardandoPrimeiroAcesso: boolean;
  criadoEm: string;
}

const ROTULO_PAPEL: Record<string, string> = {
  ADMIN: 'Administrador',
  OPERADOR: 'Operador',
};

export function Usuarios({ usuario }: { usuario: Usuario }) {
  const qc = useQueryClient();
  const [email, definirEmail] = useState('');
  const [papel, definirPapel] = useState('OPERADOR');
  const [aviso, definirAviso] = useState('');

  const lista = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get<{ usuarios: UsuarioDoPainel[] }>('/usuarios'),
  });

  const recarregar = () => void qc.invalidateQueries({ queryKey: ['usuarios'] });

  const criar = useMutation({
    mutationFn: () => api.post<ComAviso>('/usuarios', { email, papel }),
    onSuccess: (r) => {
      definirEmail('');
      definirAviso(r.aviso ?? '');
      recarregar();
    },
  });

  const trocarPapel = useMutation({
    mutationFn: (v: { id: string; papel: string }) =>
      api.put(`/usuarios/${v.id}/papel`, { papel: v.papel }),
    onSuccess: recarregar,
  });

  const reenviar = useMutation({
    mutationFn: (id: string) => api.post<ComAviso>(`/usuarios/${id}/convite`),
    onSuccess: (r) => definirAviso(r.aviso ?? ''),
  });

  const alternarAcesso = useMutation({
    mutationFn: (u: UsuarioDoPainel) =>
      u.habilitado ? api.delete(`/usuarios/${u.id}`) : api.post(`/usuarios/${u.id}/reativar`),
    onSuccess: recarregar,
  });

  const erroDeAcao = criar.error ?? trocarPapel.error ?? alternarAcesso.error ?? reenviar.error;

  return (
    <div className="space-y-6">
      <TituloPagina>Usuários</TituloPagina>

      <Cartao titulo="Convidar alguém">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Campo rotulo="E-mail" obrigatorio>
            <input
              type="email"
              value={email}
              onChange={(e) => definirEmail(e.target.value)}
              placeholder="nome@andrearaujoadvogados.com.br"
              className={classeEntrada}
            />
          </Campo>

          <Campo rotulo="Papel">
            <select
              value={papel}
              onChange={(e) => definirPapel(e.target.value)}
              className={classeEntrada}
            >
              <option value="OPERADOR">Operador — cria campanhas</option>
              <option value="ADMIN">Administrador — aprova e gerencia usuários</option>
            </select>
          </Campo>

          <Botao
            onClick={() => criar.mutate()}
            disabled={email.trim() === ''}
            carregando={criar.isPending}
          >
            Convidar
          </Botao>
        </div>

        {/**
         * Não há campo de senha, e é a pergunta que todo mundo faz ao ver esta
         * tela — por isso a resposta fica escrita nela.
         */}
        <p className="mt-4 text-xs text-ink-suave">
          A senha é criada pela própria pessoa. Ela recebe um e-mail com uma senha provisória, e no
          primeiro acesso define a definitiva e cadastra o aplicativo autenticador. Ninguém mais —
          nem quem convida — chega a ver essa senha.
        </p>
      </Cartao>

      <div className="space-y-3">
        <Aviso texto={aviso} />
        <ErroCaixa erro={erroDeAcao} />
      </div>

      {lista.isLoading && <Carregando />}
      <ErroCaixa erro={lista.error} />

      {lista.data !== undefined && (
        <Cartao>
          {lista.data.usuarios.length === 0 ? (
            <Vazio mensagem="Nenhum usuário." />
          ) : (
            <TabelaRolavel>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-suave">
                  <tr>
                    <th className="whitespace-nowrap pb-2 pr-4">E-mail</th>
                    <th className="whitespace-nowrap pb-2 pr-4">Papel</th>
                    <th className="whitespace-nowrap pb-2 pr-4">Situação</th>
                    <th className="whitespace-nowrap pb-2 pr-4">Desde</th>
                    {/* Coluna de ações: sem rótulo visível, mas o leitor de tela precisa de um. */}
                    <th className="pb-2">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {lista.data.usuarios.map((u) => {
                    const souEu = u.sub === usuario.id;
                    const papelAtual = u.papeis.includes('ADMIN') ? 'ADMIN' : 'OPERADOR';

                    return (
                      <tr key={u.id}>
                        <td className="py-3 pr-4 text-ink">
                          {u.email}
                          {souEu && <span className="ml-2 text-xs text-ink-suave">(você)</span>}
                        </td>
                        <td className="py-3 pr-4">
                          <select
                            value={papelAtual}
                            onChange={(e) =>
                              trocarPapel.mutate({ id: u.id, papel: e.target.value })
                            }
                            // Rebaixar a si mesmo trancaria a conta se não sobrasse
                            // outro admin. O backend recusa; aqui só evitamos
                            // oferecer o caminho.
                            disabled={souEu || !u.habilitado}
                            // Solto na tabela, o campo não tem rótulo visível — o
                            // e-mail é o que diz de quem é este papel.
                            aria-label={`Papel de ${u.email}`}
                            className="min-h-11 rounded-md border border-line bg-paper-light px-2 py-1 text-sm text-ink disabled:bg-paper disabled:text-ink-suave/60"
                          >
                            <option value="OPERADOR">{ROTULO_PAPEL['OPERADOR']}</option>
                            <option value="ADMIN">{ROTULO_PAPEL['ADMIN']}</option>
                          </select>
                        </td>
                        <td className="py-3 pr-4">
                          {!u.habilitado ? (
                            <Selo tom="critico">Sem acesso</Selo>
                          ) : u.aguardandoPrimeiroAcesso ? (
                            <Selo tom="atencao">Convite pendente</Selo>
                          ) : (
                            <Selo tom="positivo">Ativo</Selo>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-ink-suave">
                          {dataHora(u.criadoEm)}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {u.aguardandoPrimeiroAcesso && u.habilitado && (
                              <Botao
                                variante="secundario"
                                onClick={() => reenviar.mutate(u.id)}
                                carregando={reenviar.isPending}
                              >
                                Reenviar convite
                              </Botao>
                            )}
                            {!souEu && (
                              <Botao
                                variante={u.habilitado ? 'perigo' : 'secundario'}
                                onClick={() => alternarAcesso.mutate(u)}
                              >
                                {u.habilitado ? 'Remover acesso' : 'Devolver acesso'}
                              </Botao>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TabelaRolavel>
          )}
        </Cartao>
      )}

      {/**
       * Remover acesso desativa, não apaga. Quem lê a tela precisa saber disso,
       * senão procura um botão de excluir que não existe.
       */}
      <p className="text-xs text-ink-suave">
        Remover o acesso desativa a conta sem apagá-la — as campanhas guardam quem as criou e quem
        as aprovou, e esse registro deixaria de fazer sentido se a conta sumisse. Dá para devolver o
        acesso depois.
      </p>
    </div>
  );
}
