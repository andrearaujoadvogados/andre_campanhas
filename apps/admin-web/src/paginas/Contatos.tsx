import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { FalhaApi, api, type ComAviso } from '../lib/api.js';
import {
  ROTULO_MOTIVO,
  ROTULO_RELACIONAMENTO,
  ROTULO_STATUS_CONTATO,
  dataHora,
} from '../lib/formato.js';
import { temPapel, type Usuario } from '../lib/auth.js';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  classeEntrada,
  tomDoStatusContato,
} from '../componentes/base.tsx';

interface Contato {
  contactId: string;
  email: string;
  nome?: string;
  status: string;
  relacionamento: string;
  relacionamentoDesde?: string;
  criadoEm: string;
  origem: string;
  elegivelParaCampanha: boolean;
  motivosInelegibilidade: { motivo: string; status?: string; mesesDesdeVinculo?: number }[];
}

const RELACIONAMENTOS = Object.keys(ROTULO_RELACIONAMENTO);

export function Contatos() {
  const qc = useQueryClient();
  const [email, definirEmail] = useState('');
  const [nome, definirNome] = useState('');
  const [relacionamento, definirRelacionamento] = useState('CLIENTE_ATIVO');

  const criar = useMutation({
    mutationFn: () =>
      api.post<Contato>('/contatos', {
        email,
        ...(nome === '' ? {} : { nome }),
        relacionamento,
      }),
    onSuccess: () => {
      definirEmail('');
      definirNome('');
      void qc.invalidateQueries({ queryKey: ['contatos'] });
    },
  });

  // Erros por campo vêm do backend com o caminho do campo — é o que permite
  // destacar a linha errada em vez de mostrar "dados inválidos" e deixar o
  // operador adivinhar qual dos campos está errado.
  const erros = criar.error instanceof FalhaApi ? criar.error.porCampo : {};

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Contatos</h1>

      <Cartao titulo="Novo contato">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="E-mail" obrigatorio erro={erros['email']}>
            <input
              type="email"
              value={email}
              onChange={(e) => definirEmail(e.target.value)}
              className={classeEntrada}
            />
          </Campo>
          <Campo rotulo="Nome">
            <input
              value={nome}
              onChange={(e) => definirNome(e.target.value)}
              className={classeEntrada}
            />
          </Campo>
          {/**
           * Vínculo é obrigatório, e a ajuda explica por quê.
           *
           * Sob legítimo interesse, é ele que prova a base legal (§6.2). Sem essa
           * explicação, o campo pareceria burocracia e alguém escolheria
           * "Não classificado" só para passar do formulário — deixando o contato
           * permanentemente inelegível sem entender o motivo.
           */}
          <Campo
            rotulo="Vínculo com o escritório"
            ajuda="Sustenta a base legal. Quem fica sem classificação não recebe campanhas."
            obrigatorio
          >
            <select
              value={relacionamento}
              onChange={(e) => definirRelacionamento(e.target.value)}
              className={classeEntrada}
            >
              {RELACIONAMENTOS.map((r) => (
                <option key={r} value={r}>
                  {ROTULO_RELACIONAMENTO[r]}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="mt-4 space-y-3">
          {relacionamento === 'DESCONHECIDO' && (
            <Aviso
              tom="alerta"
              texto="Contatos sem vínculo classificado ficam cadastrados, mas não recebem campanhas."
            />
          )}
          <ErroCaixa erro={criar.error} />
          <Botao
            onClick={() => criar.mutate()}
            disabled={email.trim() === ''}
            carregando={criar.isPending}
          >
            Cadastrar
          </Botao>
        </div>
      </Cartao>

      <Cartao>
        <p className="text-sm text-slate-500">
          Para ver os contatos de uma lista, abra a lista em{' '}
          <Link to="/listas" className="underline">
            Listas
          </Link>
          .
        </p>
      </Cartao>
    </div>
  );
}

export function ContatoDetalhe({ usuario }: { usuario: Usuario }) {
  const { id = '' } = useParams();
  const [exportacao, definirExportacao] = useState<{
    arquivos: { formato: string; descricao: string; url: string }[];
    validadeSegundos: number;
    aviso: string;
  } | null>(null);

  const contato = useQuery({
    queryKey: ['contato', id],
    queryFn: () => api.get<Contato>(`/contatos/${id}`),
  });

  const exportar = useMutation({
    mutationFn: () =>
      api.post<
        {
          arquivos: { formato: string; descricao: string; url: string }[];
          validadeSegundos: number;
          aviso: string;
        } & ComAviso
      >(`/contatos/${id}/exportacao`),
    onSuccess: (r) => definirExportacao(r),
  });

  if (contato.isLoading) return <Carregando />;
  if (contato.error !== null) return <ErroCaixa erro={contato.error} />;

  const c = contato.data;
  if (c === undefined) return null;

  return (
    <div className="space-y-6">
      <Link to="/listas" className="text-sm text-slate-500 hover:underline">
        ← Voltar
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{c.nome ?? c.email}</h1>
        <Selo tom={tomDoStatusContato(c.status)}>
          {ROTULO_STATUS_CONTATO[c.status] ?? c.status}
        </Selo>
      </div>

      <Cartao titulo="Dados">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">E-mail</dt>
            <dd>{c.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Vínculo</dt>
            <dd>{ROTULO_RELACIONAMENTO[c.relacionamento] ?? c.relacionamento}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Vínculo desde</dt>
            <dd>{dataHora(c.relacionamentoDesde)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Origem do cadastro</dt>
            <dd>{c.origem}</dd>
          </div>
        </dl>
      </Cartao>

      {/**
       * O motivo da inelegibilidade em destaque.
       *
       * Sem isto, o operador vê um contato "ativo" que nunca recebe campanha e
       * conclui que há um bug. O motivo mais provável — vínculo não classificado
       * — é resolvível em dois cliques, desde que ele saiba disso.
       */}
      {!c.elegivelParaCampanha && (
        <Cartao titulo="Este contato não recebe campanhas">
          <ul className="space-y-1 text-sm text-slate-700">
            {c.motivosInelegibilidade.map((m, i) => (
              <li key={i}>
                •{' '}
                {m.motivo === 'STATUS'
                  ? `Situação: ${ROTULO_STATUS_CONTATO[m.status ?? ''] ?? m.status}`
                  : (ROTULO_MOTIVO[m.motivo] ?? m.motivo)}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {temPapel(usuario, 'ADMIN') && (
        <Cartao titulo="Direitos do titular (LGPD)">
          <p className="mb-4 text-sm text-slate-600">
            Gere o dossiê com tudo que o sistema mantém sobre esta pessoa. Confirme a identidade do
            titular antes de entregar.
          </p>
          <Botao
            variante="secundario"
            carregando={exportar.isPending}
            onClick={() => exportar.mutate()}
          >
            Gerar exportação
          </Botao>
          <ErroCaixa erro={exportar.error} />

          {exportacao !== null && (
            <div className="mt-4 space-y-3">
              <Aviso tom="alerta" texto={exportacao.aviso} />
              <ul className="space-y-2">
                {exportacao.arquivos.map((a) => (
                  <li key={a.formato}>
                    <a
                      href={a.url}
                      className="text-sm font-medium text-slate-900 underline"
                      // O link é presignado e de vida curta; noreferrer evita
                      // que ele vaze no cabeçalho Referer.
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Baixar {a.formato.toUpperCase()}
                    </a>
                    <span className="ml-2 text-xs text-slate-500">{a.descricao}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Cartao>
      )}
    </div>
  );
}
