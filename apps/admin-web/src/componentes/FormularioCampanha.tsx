import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FalhaApi, api } from '../lib/api.js';
import { Botao, Campo, ErroCaixa, classeEntrada } from './base.tsx';

/**
 * Os campos de uma campanha — usado para criar e para editar.
 *
 * Um formulário só, e não dois: criar e editar pedem exatamente os mesmos
 * dados, e duas cópias divergiriam no primeiro campo novo que alguém
 * acrescentasse a apenas uma delas.
 */

export interface DadosCampanha {
  nome: string;
  templateId: string;
  listId: string;
  remetenteNome: string;
  remetenteEmail: string;
  replyTo: string;
}

export const CAMPANHA_VAZIA: DadosCampanha = {
  nome: '',
  templateId: '',
  listId: '',
  remetenteNome: 'André Araújo Advogados',
  remetenteEmail: '',
  replyTo: '',
};

interface Opcao {
  id: string;
  nome: string;
}

export function FormularioCampanha({
  valor,
  aoMudar,
  aoSalvar,
  salvando,
  erro,
  rotuloSalvar,
  aoCancelar,
}: {
  valor: DadosCampanha;
  aoMudar: (v: DadosCampanha) => void;
  aoSalvar: () => void;
  salvando: boolean;
  erro: unknown;
  rotuloSalvar: string;
  aoCancelar?: () => void;
}) {
  const [tocouRemetente, definirTocouRemetente] = useState(false);

  const modelos = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ itens: { templateId: string; nome: string }[] }>('/templates'),
  });
  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () => api.get<{ itens: { listId: string; nome: string }[] }>('/listas'),
  });

  const opcoesModelo: Opcao[] =
    modelos.data?.itens.map((t) => ({ id: t.templateId, nome: t.nome })) ?? [];
  const opcoesLista: Opcao[] =
    listas.data?.itens.map((l) => ({ id: l.listId, nome: l.nome })) ?? [];

  const erros = erro instanceof FalhaApi ? erro.porCampo : {};
  const definir = <K extends keyof DadosCampanha>(chave: K, v: DadosCampanha[K]) =>
    aoMudar({ ...valor, [chave]: v });

  /**
   * O remetente precisa estar no domínio verificado no SES.
   *
   * `andrearaujoadvogados.com.br` — sem o `mail.` — é o endereço natural de se
   * digitar, e é justamente o que o SES recusa. O erro dele é `MessageRejected`,
   * que não menciona domínio nenhum e aparece só no disparo, quando a campanha
   * já foi escrita e aprovada.
   */
  const remetenteSuspeito =
    tocouRemetente &&
    valor.remetenteEmail !== '' &&
    valor.remetenteEmail.includes('@') &&
    !valor.remetenteEmail.endsWith('@mail.andrearaujoadvogados.com.br');

  const completo =
    valor.nome.trim() !== '' &&
    valor.templateId !== '' &&
    valor.listId !== '' &&
    valor.remetenteNome.trim() !== '' &&
    valor.remetenteEmail.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome da campanha"
          ajuda="Só o escritório vê. Serve para achá-la depois."
          obrigatorio
          erro={erros['nome']}
        >
          <input
            value={valor.nome}
            onChange={(e) => definir('nome', e.target.value)}
            className={classeEntrada}
          />
        </Campo>

        <Campo rotulo="Modelo de e-mail" obrigatorio erro={erros['templateId']}>
          <select
            value={valor.templateId}
            onChange={(e) => definir('templateId', e.target.value)}
            className={classeEntrada}
          >
            <option value="">{modelos.isLoading ? 'Carregando…' : 'Escolha um modelo…'}</option>
            {opcoesModelo.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Lista de contatos" obrigatorio erro={erros['listId']}>
          <select
            value={valor.listId}
            onChange={(e) => definir('listId', e.target.value)}
            className={classeEntrada}
          >
            <option value="">{listas.isLoading ? 'Carregando…' : 'Escolha uma lista…'}</option>
            {opcoesLista.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Nome do remetente" obrigatorio erro={erros['remetenteNome']}>
          <input
            value={valor.remetenteNome}
            onChange={(e) => definir('remetenteNome', e.target.value)}
            className={classeEntrada}
          />
        </Campo>

        <Campo
          rotulo="E-mail do remetente"
          ajuda="Precisa terminar em @mail.andrearaujoadvogados.com.br — é o domínio verificado."
          obrigatorio
          erro={erros['remetenteEmail']}
        >
          <input
            type="email"
            value={valor.remetenteEmail}
            onChange={(e) => definir('remetenteEmail', e.target.value)}
            onBlur={() => definirTocouRemetente(true)}
            placeholder="campanhas@mail.andrearaujoadvogados.com.br"
            className={classeEntrada}
          />
        </Campo>

        <Campo
          rotulo="Responder para"
          ajuda="Para onde vão as respostas. Pode ser o e-mail normal do escritório."
        >
          <input
            type="email"
            value={valor.replyTo}
            onChange={(e) => definir('replyTo', e.target.value)}
            className={classeEntrada}
          />
        </Campo>
      </div>

      {remetenteSuspeito && (
        <div role="alert" className="rounded-md border border-alerta/30 bg-alerta-fundo px-4 py-3">
          <p className="text-sm text-alerta">
            Este remetente provavelmente será recusado. Só o domínio{' '}
            <strong>mail.andrearaujoadvogados.com.br</strong> está verificado no SES — repare no{' '}
            <strong>mail.</strong> no meio. Sem ele, o envio falha no disparo com uma mensagem que
            não explica o motivo.
          </p>
        </div>
      )}

      <ErroCaixa erro={erro} />

      <div className="flex flex-wrap gap-2">
        <Botao onClick={aoSalvar} disabled={!completo} carregando={salvando}>
          {rotuloSalvar}
        </Botao>
        {aoCancelar !== undefined && (
          <Botao variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
      </div>

      {opcoesModelo.length === 0 && !modelos.isLoading && (
        <p className="text-sm text-ink-suave">
          Nenhum modelo cadastrado ainda. Crie um em <strong>Modelos</strong> antes de montar a
          campanha.
        </p>
      )}
      {opcoesLista.length === 0 && !listas.isLoading && (
        <p className="text-sm text-ink-suave">
          Nenhuma lista cadastrada ainda. Crie uma em <strong>Listas</strong> antes de montar a
          campanha.
        </p>
      )}
    </div>
  );
}
