import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, FalhaApi } from '../lib/api.js';
import { dataHora } from '../lib/formato.js';
import {
  CHAVE_EXECUCOES,
  PainelExecucaoBoletim,
  duracaoCurta,
  useExecucoesBoletim,
  type ExecucaoBoletim as Execucao,
} from '../componentes/ExecucaoBoletim.tsx';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  ErroCaixa,
  Selo,
  TituloPagina,
  Vazio,
  classeEntrada,
} from '../componentes/base.tsx';

interface Fonte {
  fonteId: string;
  nome: string;
  url: string;
  instrucao: string;
  ativa: boolean;
  atualizadoEm: string;
}

const FORM_VAZIO = { nome: '', url: '', instrucao: '', ativa: true };

/**
 * Boletim automatizado — fontes e geração (§11, item 12).
 *
 * O operador cadastra os sites acompanhados e diz, em texto livre, o que
 * coletar de cada um. A coleta roda toda segunda de manhã (e sob demanda pelo
 * botão), e o resultado aparece como MODELO na categoria Boletim — o disparo
 * continua passando pelo assistente e pela revisão humana.
 */
export function Boletim() {
  const qc = useQueryClient();
  const [form, definirForm] = useState(FORM_VAZIO);
  const [editandoId, definirEditandoId] = useState<string | null>(null);
  const [confirmacao, definirConfirmacao] = useState('');

  const fontes = useQuery({
    queryKey: ['fontes-boletim'],
    queryFn: () => api.get<{ itens: Fonte[] }>('/boletim/fontes'),
  });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ['fontes-boletim'] });

  const salvar = useMutation({
    mutationFn: () =>
      editandoId === null
        ? api.post<Fonte>('/boletim/fontes', form)
        : api.patch<Fonte>(`/boletim/fontes/${editandoId}`, form),
    onSuccess: () => {
      definirForm(FORM_VAZIO);
      definirEditandoId(null);
      invalidar();
    },
  });

  const alternarAtiva = useMutation({
    mutationFn: (f: Fonte) =>
      api.patch<Fonte>(`/boletim/fontes/${f.fonteId}`, {
        nome: f.nome,
        url: f.url,
        instrucao: f.instrucao,
        ativa: !f.ativa,
      }),
    onSuccess: invalidar,
  });

  const excluir = useMutation({
    mutationFn: (id: string) => api.delete(`/boletim/fontes/${id}`),
    onSuccess: invalidar,
  });

  const execucoes = useExecucoesBoletim();

  /**
   * O 202 confirma que o pedido entrou; o painel abaixo é que conta o resto.
   *
   * A invalidação imediata é o que faz o painel aparecer no mesmo instante do
   * clique, em vez de só no próximo ciclo de consulta — três segundos de tela
   * inerte depois de apertar um botão é exatamente a lacuna que fazia parecer
   * que nada tinha acontecido.
   */
  const gerar = useMutation({
    mutationFn: () => api.post<{ message: string }>('/boletim/gerar', {}),
    onSuccess: (r) => {
      definirConfirmacao(r.message);
      void qc.invalidateQueries({ queryKey: CHAVE_EXECUCOES });
    },
    // 409 = já havia uma geração em curso. O painel passa a mostrá-la; a
    // mensagem de erro sozinha deixaria o operador sem saber qual é o estado.
    onError: () => void qc.invalidateQueries({ queryKey: CHAVE_EXECUCOES }),
  });

  const itensExecucao = execucoes.data?.itens ?? [];
  const atual = itensExecucao[0];
  const anteriores = itensExecucao.slice(1);
  const emAndamento = atual?.situacao === 'EXECUTANDO';

  function dispararGeracao(): void {
    definirConfirmacao('');
    gerar.mutate();
  }

  function editar(f: Fonte) {
    definirEditandoId(f.fonteId);
    definirForm({ nome: f.nome, url: f.url, instrucao: f.instrucao, ativa: f.ativa });
  }

  function submeter(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  const erros = salvar.error instanceof FalhaApi ? salvar.error.porCampo : {};
  const itens = fontes.data?.itens ?? [];
  const temAtiva = itens.some((f) => f.ativa);

  return (
    <div className="space-y-6">
      <TituloPagina
        acao={
          /**
           * Enquanto corre, o botão diz o que está acontecendo em vez de só
           * ficar apagado: rótulo apagado não explica se o sistema está
           * trabalhando ou se falta preencher alguma coisa.
           */
          <Botao
            carregando={gerar.isPending}
            disabled={!temAtiva || emAndamento}
            onClick={dispararGeracao}
          >
            {emAndamento ? 'Gerando…' : 'Gerar boletim agora'}
          </Botao>
        }
      >
        Boletim automático
      </TituloPagina>

      <p className="max-w-3xl text-sm text-ink-suave">
        Cadastre os sites que o escritório acompanha e o que coletar de cada um. Toda segunda-feira
        de manhã (ou pelo botão acima), o sistema lê as páginas, seleciona as notícias com IA e
        monta a edição — que aparece em{' '}
        <Link to="/templates" className="underline">
          Modelos
        </Link>
        , na categoria Boletim, pronta para revisão. Nada é enviado sem passar pelo assistente de
        campanha.
      </p>

      {!temAtiva && !fontes.isLoading && (
        <Aviso
          tom="alerta"
          texto="O botão de gerar só liga com pelo menos uma fonte ativa — sem fonte, não há de onde coletar. Cadastre uma abaixo."
        />
      )}

      {confirmacao !== '' && <Aviso tom="sucesso" texto={confirmacao} />}
      <ErroCaixa erro={gerar.error} />

      {/**
       * O painel de estado vem antes de tudo: é a resposta à única pergunta que
       * o operador tem depois de apertar o botão.
       */}
      {atual !== undefined && (
        <PainelExecucaoBoletim
          execucao={atual}
          aoTentarDeNovo={temAtiva ? dispararGeracao : undefined}
          tentandoDeNovo={gerar.isPending}
        />
      )}

      {atual === undefined && !execucoes.isLoading && (
        <Aviso texto="Nenhuma geração registrada ainda. Ao gerar, o andamento e o resultado aparecem aqui." />
      )}

      <ErroCaixa erro={execucoes.error} />

      <Cartao titulo={editandoId === null ? 'Nova fonte' : 'Editar fonte'}>
        <form onSubmit={submeter} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome" obrigatorio erro={erros['nome']}>
              <input
                value={form.nome}
                onChange={(e) => definirForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Migalhas — Tributário"
                className={classeEntrada}
              />
            </Campo>
            <Campo rotulo="Endereço (https)" obrigatorio erro={erros['url']}>
              <input
                value={form.url}
                onChange={(e) => definirForm({ ...form, url: e.target.value })}
                placeholder="https://…"
                className={classeEntrada}
              />
            </Campo>
          </div>

          <Campo
            rotulo="O que coletar desta fonte"
            obrigatorio
            erro={erros['instrucao']}
            ajuda="Escreva como instruiria um estagiário: o assunto que interessa, o que ignorar, o formato do resumo. A IA segue esta instrução ao ler a página."
          >
            <textarea
              value={form.instrucao}
              onChange={(e) => definirForm({ ...form, instrucao: e.target.value })}
              rows={3}
              placeholder="Ex.: Decisões do STJ e do STF sobre direito tributário. Ignore artigos de opinião. Resumo de duas frases explicando o impacto para empresas."
              className={classeEntrada}
            />
          </Campo>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.ativa}
                onChange={(e) => definirForm({ ...form, ativa: e.target.checked })}
              />
              Incluir na próxima coleta
            </label>
            <div className="flex gap-2">
              {editandoId !== null && (
                <Botao
                  variante="secundario"
                  onClick={() => {
                    definirEditandoId(null);
                    definirForm(FORM_VAZIO);
                  }}
                >
                  Cancelar edição
                </Botao>
              )}
              <Botao type="submit" carregando={salvar.isPending}>
                {editandoId === null ? 'Adicionar fonte' : 'Salvar fonte'}
              </Botao>
            </div>
          </div>
        </form>
      </Cartao>

      <Cartao titulo="Fontes cadastradas">
        {fontes.isLoading && <Carregando />}
        <ErroCaixa erro={fontes.error} />
        {itens.length === 0 && !fontes.isLoading && (
          <Vazio mensagem="Nenhuma fonte ainda. Cadastre o primeiro site acima para o boletim ter de onde coletar." />
        )}

        <ul className="divide-y divide-line">
          {itens.map((f) => (
            <li key={f.fonteId} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{f.nome}</span>
                  <Selo tom={f.ativa ? 'positivo' : 'neutro'}>
                    {f.ativa ? 'na coleta' : 'pausada'}
                  </Selo>
                </p>
                <p className="truncate text-xs text-ink-suave">{f.url}</p>
                <p className="mt-1 text-sm text-ink-suave">{f.instrucao}</p>
              </div>
              <div className="flex gap-2">
                <Botao variante="secundario" onClick={() => editar(f)}>
                  Editar
                </Botao>
                <Botao
                  variante="secundario"
                  carregando={alternarAtiva.isPending}
                  onClick={() => alternarAtiva.mutate(f)}
                >
                  {f.ativa ? 'Pausar' : 'Reativar'}
                </Botao>
                <Botao
                  variante="perigo"
                  carregando={excluir.isPending}
                  onClick={() => {
                    if (window.confirm(`Excluir a fonte "${f.nome}"?`)) excluir.mutate(f.fonteId);
                  }}
                >
                  Excluir
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      </Cartao>

      {/**
       * O histórico responde "isto costuma funcionar?" sem obrigar ninguém a
       * lembrar do que aconteceu na semana passada — e é onde uma fonte que
       * vive falhando fica evidente, linha após linha.
       */}
      {anteriores.length > 0 && (
        <Cartao titulo="Gerações anteriores">
          <ul className="divide-y divide-line">
            {anteriores.map((e) => (
              <LinhaHistorico key={e.execucaoId} execucao={e} />
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}

const RESUMO: Readonly<Record<Execucao['situacao'], string>> = {
  EXECUTANDO: 'em andamento',
  CONCLUIDA: 'modelo gerado',
  SEM_NOTICIAS: 'nenhuma notícia encontrada',
  FALHOU: 'falhou',
  TRAVADA: 'parou sem terminar',
};

function LinhaHistorico({ execucao }: { execucao: Execucao }) {
  const duracao =
    execucao.concluidaEm === null
      ? null
      : duracaoCurta(
          new Date(execucao.concluidaEm).getTime() - new Date(execucao.iniciadaEm).getTime(),
        );

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{dataHora(execucao.iniciadaEm)}</span>
          <Selo tom={execucao.situacao === 'CONCLUIDA' ? 'positivo' : 'neutro'}>
            {RESUMO[execucao.situacao]}
          </Selo>
          <span className="text-xs text-ink-suave">
            {execucao.origem === 'MANUAL' ? 'manual' : 'rotina de segunda'}
            {duracao === null ? '' : ` · ${duracao}`}
          </span>
        </p>
        {execucao.erro !== null && <p className="mt-1 text-sm text-ink-suave">{execucao.erro}</p>}
        {execucao.situacao === 'CONCLUIDA' && (
          <p className="mt-1 text-sm text-ink-suave">
            {execucao.totalNoticias} notícia(s) · {execucao.templateNome}
          </p>
        )}
      </div>
      {execucao.templateId !== null && (
        <Link
          to={`/templates/${execucao.templateId}`}
          className="inline-flex min-h-11 items-center text-sm text-ink-suave hover:text-ink hover:underline"
        >
          Abrir modelo
        </Link>
      )}
    </li>
  );
}
