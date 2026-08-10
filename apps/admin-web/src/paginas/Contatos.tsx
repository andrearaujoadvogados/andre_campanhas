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
  telefone?: string | null;
  empresa?: string | null;
  tags?: string[];
  isLead?: boolean;
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
  const [telefone, definirTelefone] = useState('');
  const [empresa, definirEmpresa] = useState('');
  const [tagsTexto, definirTagsTexto] = useState('');
  const [isLead, definirIsLead] = useState(false);
  const [relacionamento, definirRelacionamento] = useState('CLIENTE_ATIVO');

  // Tags entram como texto separado por vírgula e viram lista antes de enviar —
  // o backend guarda a lista; a UI é que fala "vírgula".
  const tags = tagsTexto
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');

  const criar = useMutation({
    mutationFn: () =>
      api.post<Contato>('/contatos', {
        email,
        ...(nome === '' ? {} : { nome }),
        ...(telefone.trim() === '' ? {} : { telefone: telefone.trim() }),
        ...(empresa.trim() === '' ? {} : { empresa: empresa.trim() }),
        tags,
        isLead,
        relacionamento,
      }),
    onSuccess: () => {
      definirEmail('');
      definirNome('');
      definirTelefone('');
      definirEmpresa('');
      definirTagsTexto('');
      definirIsLead(false);
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
          <Campo rotulo="Telefone" ajuda="Opcional. Guardado no cadastro; não vai no e-mail.">
            <input
              value={telefone}
              onChange={(e) => definirTelefone(e.target.value)}
              className={classeEntrada}
            />
          </Campo>
          <Campo rotulo="Empresa">
            <input
              value={empresa}
              onChange={(e) => definirEmpresa(e.target.value)}
              className={classeEntrada}
            />
          </Campo>
          <Campo rotulo="Tags" ajuda="Separadas por vírgula. Servem para segmentar as campanhas.">
            <input
              value={tagsTexto}
              onChange={(e) => definirTagsTexto(e.target.value)}
              placeholder="ex.: tributário, evento-2026"
              className={classeEntrada}
            />
          </Campo>
          {/**
           * O vínculo não bloqueia mais o envio — desde 2026-08-09, contato
           * recebe por padrão. Ele continua sendo pedido porque é a informação
           * que descreve a relação do escritório com aquela pessoa, e é dela que
           * sairá qualquer segmentação futura. A ajuda deixou de ameaçar.
           */}
          <Campo
            rotulo="Vínculo com o escritório"
            ajuda="Descreve a relação com o escritório. Ajuda a segmentar os boletins."
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

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isLead}
            onChange={(e) => definirIsLead(e.target.checked)}
            className="h-4 w-4"
          />
          É um lead (não recebe boletim por padrão — só quando o boletim marca “incluir leads”)
        </label>

        <div className="mt-4 space-y-3">
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
  const qcDetalhe = useQueryClient();
  const [exportacao, definirExportacao] = useState<{
    arquivos: { formato: string; descricao: string; url: string }[];
    validadeSegundos: number;
    aviso: string;
  } | null>(null);

  const contato = useQuery({
    queryKey: ['contato', id],
    queryFn: () => api.get<Contato>(`/contatos/${id}`),
  });

  /**
   * O contato recebe por padrão; este é o controle para dizer que não deve.
   *
   * Só alterna entre "recebe" e "marcado para não receber". Quem se descadastrou,
   * se opôs, deu bounce ou marcou como spam não volta por aqui — o backend
   * recusa, e a tela nem oferece o botão.
   */
  const alternarEnvio = useMutation({
    mutationFn: (receber: boolean) =>
      api.post<Contato>(`/contatos/${id}/${receber ? 'enviar' : 'nao-enviar'}`),
    onSuccess: () => void qcDetalhe.invalidateQueries({ queryKey: ['contato', id] }),
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
            <dt className="text-ink-suave">Telefone</dt>
            <dd className="text-ink">{c.telefone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-suave">Empresa</dt>
            <dd className="text-ink">{c.empresa ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-suave">Vínculo</dt>
            <dd className="text-ink">
              {ROTULO_RELACIONAMENTO[c.relacionamento] ?? c.relacionamento}
              {c.isLead === true && (
                <span className="ml-2 rounded bg-accent-mist px-1.5 py-0.5 text-xs text-ink-suave">
                  Lead
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-suave">Tags</dt>
            <dd className="text-ink">
              {c.tags !== undefined && c.tags.length > 0 ? c.tags.join(', ') : '—'}
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
      <Cartao titulo="Recebimento de boletins">
        {c.status === 'ATIVO' || c.status === 'SUPRIMIDO' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-suave">
              {c.status === 'SUPRIMIDO'
                ? 'Este contato está marcado para não receber boletins.'
                : 'Este contato recebe os boletins das listas de que participa.'}
            </p>
            <ErroCaixa erro={alternarEnvio.error} />
            <Botao
              variante={c.status === 'SUPRIMIDO' ? 'primario' : 'perigo'}
              carregando={alternarEnvio.isPending}
              onClick={() => alternarEnvio.mutate(c.status === 'SUPRIMIDO')}
            >
              {c.status === 'SUPRIMIDO' ? 'Voltar a enviar' : 'Não enviar para este contato'}
            </Botao>
          </div>
        ) : (
          /**
           * Sem botão: descadastro, oposição, bounce e reclamação não se
           * desfazem daqui. Os dois primeiros são direito do titular; os dois
           * últimos derrubam a reputação de envio da conta inteira se ignorados.
           */
          <p className="text-sm text-ink-suave">
            Este contato não recebe boletins, e isso não pode ser desfeito pelo painel — a situação
            partiu do próprio destinatário ou do provedor de e-mail dele.
          </p>
        )}
      </Cartao>

      {!c.elegivelParaCampanha && (
        <Cartao titulo="Por que este contato não recebe">
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
