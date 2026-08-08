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
  TituloPagina,
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

export function Contatos({ usuario }: { usuario: Usuario }) {
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
      <TituloPagina
        acao={
          /**
           * Só para ADMIN, espelhando o `exigirPapel` da rota — quem importa
           * declara a origem do lote e, com ela, a base legal de todo mundo que
           * entra. Esconder o link não é o controle: o controle é o 403 da API.
           */
          temPapel(usuario, 'ADMIN') && (
            <Link
              to="/contatos/importar"
              // Link com aparência de botão secundário: como não é <Botao>, o
              // alvo de 44px precisa vir declarado aqui.
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-paper-light px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-mist"
            >
              Importar CSV
            </Link>
          )
        }
      >
        Contatos
      </TituloPagina>

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
        <p className="text-sm text-ink-suave">
          Para ver os contatos de uma lista, abra a lista em{' '}
          <Link to="/listas" className="font-medium text-ink underline">
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
      {/* Alvo de 44px: link solto de navegação, sem o <Botao> para garantir isso. */}
      <Link
        to="/listas"
        className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
      >
        ← Voltar
      </Link>

      <TituloPagina
        acao={
          <Selo tom={tomDoStatusContato(c.status)}>
            {ROTULO_STATUS_CONTATO[c.status] ?? c.status}
          </Selo>
        }
      >
        {c.nome ?? c.email}
      </TituloPagina>

      <Cartao titulo="Dados">
        {/* Empilha no celular: duas colunas de 160px cortam e-mail no meio. */}
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-suave">E-mail</dt>
            <dd className="break-words text-ink">{c.email}</dd>
          </div>
          <div>
            <dt className="text-ink-suave">Vínculo</dt>
            <dd className="text-ink">
              {ROTULO_RELACIONAMENTO[c.relacionamento] ?? c.relacionamento}
            </dd>
          </div>
          <div>
            <dt className="text-ink-suave">Vínculo desde</dt>
            <dd className="text-ink">{dataHora(c.relacionamentoDesde)}</dd>
          </div>
          <div>
            <dt className="text-ink-suave">Origem do cadastro</dt>
            <dd className="text-ink">{c.origem}</dd>
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
          <ul className="space-y-1 text-sm text-ink">
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
          <p className="mb-4 text-sm text-ink-suave">
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
          <div className="mt-3 empty:mt-0">
            <ErroCaixa erro={exportar.error} />
          </div>

          {exportacao !== null && (
            <div className="mt-4 space-y-3">
              <Aviso tom="alerta" texto={exportacao.aviso} />
              <ul className="space-y-1">
                {exportacao.arquivos.map((a) => (
                  <li key={a.formato} className="flex flex-wrap items-center gap-x-2">
                    <a
                      href={a.url}
                      // min-h-11: link de download é alvo de toque, e no celular
                      // ele fica encostado no da linha seguinte sem essa altura.
                      className="inline-flex min-h-11 items-center text-sm font-medium text-ink underline"
                      // O link é presignado e de vida curta; noreferrer evita
                      // que ele vaze no cabeçalho Referer.
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Baixar {a.formato.toUpperCase()}
                    </a>
                    <span className="text-xs text-ink-suave">{a.descricao}</span>
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
