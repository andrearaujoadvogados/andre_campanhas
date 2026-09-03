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

interface Rotina {
  rotinaId: string;
  nome: string;
  periodicidade: 'DIARIA' | 'SEMANAL' | 'MENSAL';
  horario: string;
  diaDaSemana: number | null;
  diaDoMes: number | null;
  tipoEmailId: string | null;
  temas: string[];
  fonteIds: string[];
  listIds: string[];
  ativa: boolean;
  atualizadoEm: string;
}

interface TipoEmail {
  tipoEmailId: string;
  nome: string;
}

interface Lista {
  listId: string;
  nome: string;
  totalContatosAproximado?: number;
}

const DIAS_SEMANA = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
] as const;

const ROTINA_VAZIA = {
  nome: '',
  periodicidade: 'SEMANAL' as Rotina['periodicidade'],
  horario: '08:00',
  diaDaSemana: 1,
  diaDoMes: 1,
  tipoEmailId: '',
  /** Separados por vírgula na digitação; viram lista ao salvar. */
  temas: '',
  fonteIds: [] as string[],
  listIds: [] as string[],
  ativa: true,
};

/** Marca ou desmarca um id numa lista de escolha (fontes, listas). */
function marcar(atual: string[], id: string, marcado: boolean): string[] {
  return marcado ? [...atual, id] : atual.filter((x) => x !== id);
}

/** "Toda segunda-feira às 08:00" — a frase que confirma o que foi cadastrado. */
function descreverRotina(
  r: Pick<Rotina, 'periodicidade' | 'horario' | 'diaDaSemana' | 'diaDoMes'>,
): string {
  if (r.periodicidade === 'DIARIA') return `Todos os dias às ${r.horario}`;
  if (r.periodicidade === 'SEMANAL')
    return `Toda ${DIAS_SEMANA[(r.diaDaSemana ?? 1) - 1]} às ${r.horario}`;
  return `Todo dia ${r.diaDoMes ?? 1} do mês às ${r.horario}`;
}

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

  const [confirmacaoFonte, definirConfirmacaoFonte] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      editandoId === null
        ? api.post<Fonte>('/boletim/fontes', form)
        : api.patch<Fonte>(`/boletim/fontes/${editandoId}`, form),
    onSuccess: (fonte) => {
      // O formulário limpa ao salvar; sem a frase, limpar é o único sinal — e
      // campo vazio também é a cara de um erro que descartou tudo.
      definirConfirmacaoFonte(
        editandoId === null ? `Fonte "${fonte.nome}" adicionada.` : `Fonte "${fonte.nome}" salva.`,
      );
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

  // ── Rotina de envio automático ─────────────────────────────────────────────

  const [formRotina, definirFormRotina] = useState(ROTINA_VAZIA);
  const [editandoRotinaId, definirEditandoRotinaId] = useState<string | null>(null);
  // O formulário cresceu (fontes, temas, listas): fechado por padrão, a lista
  // de rotinas — que é o que se consulta no dia a dia — fica à vista.
  const [formRotinaAberto, definirFormRotinaAberto] = useState(false);

  const rotinas = useQuery({
    queryKey: ['rotinas-boletim'],
    queryFn: () => api.get<{ itens: Rotina[] }>('/boletim/rotinas'),
  });
  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () => api.get<{ itens: Lista[] }>('/listas'),
  });
  const tipos = useQuery({
    queryKey: ['tipos'],
    queryFn: () => api.get<{ itens: TipoEmail[] }>('/tipos'),
  });
  const invalidarRotinas = () => void qc.invalidateQueries({ queryKey: ['rotinas-boletim'] });

  /** Só os campos da periodicidade escolhida viajam — o resto seria configuração dormente. */
  function corpoDaRotina(f: typeof ROTINA_VAZIA): Record<string, unknown> {
    return {
      nome: f.nome,
      periodicidade: f.periodicidade,
      horario: f.horario,
      ...(f.tipoEmailId === '' ? {} : { tipoEmailId: f.tipoEmailId }),
      temas: f.temas
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      fonteIds: f.fonteIds,
      listIds: f.listIds,
      ativa: f.ativa,
      ...(f.periodicidade === 'SEMANAL' ? { diaDaSemana: f.diaDaSemana } : {}),
      ...(f.periodicidade === 'MENSAL' ? { diaDoMes: f.diaDoMes } : {}),
    };
  }

  const [confirmacaoRotina, definirConfirmacaoRotina] = useState('');
  const salvarRotina = useMutation({
    mutationFn: () =>
      editandoRotinaId === null
        ? api.post<Rotina>('/boletim/rotinas', corpoDaRotina(formRotina))
        : api.patch<Rotina>(`/boletim/rotinas/${editandoRotinaId}`, corpoDaRotina(formRotina)),
    onSuccess: (rotina) => {
      // Confirmar com a recorrência por extenso é reler o que foi armado: quem
      // errou o dia percebe aqui, antes do primeiro disparo — não depois.
      definirConfirmacaoRotina(
        `${editandoRotinaId === null ? 'Rotina criada' : 'Rotina salva'}: ${descreverRotina(rotina).toLowerCase()}.`,
      );
      definirFormRotina(ROTINA_VAZIA);
      definirEditandoRotinaId(null);
      definirFormRotinaAberto(false);
      invalidarRotinas();
    },
  });

  const alternarRotina = useMutation({
    mutationFn: (r: Rotina) =>
      api.patch<Rotina>(`/boletim/rotinas/${r.rotinaId}`, {
        nome: r.nome,
        periodicidade: r.periodicidade,
        horario: r.horario,
        ...(r.tipoEmailId === null ? {} : { tipoEmailId: r.tipoEmailId }),
        temas: r.temas,
        fonteIds: r.fonteIds,
        listIds: r.listIds,
        ativa: !r.ativa,
        ...(r.periodicidade === 'SEMANAL' ? { diaDaSemana: r.diaDaSemana } : {}),
        ...(r.periodicidade === 'MENSAL' ? { diaDoMes: r.diaDoMes } : {}),
      }),
    onSuccess: invalidarRotinas,
  });

  const excluirRotina = useMutation({
    mutationFn: (id: string) => api.delete(`/boletim/rotinas/${id}`),
    onSuccess: invalidarRotinas,
  });

  function editarRotina(r: Rotina) {
    definirFormRotinaAberto(true);
    definirEditandoRotinaId(r.rotinaId);
    definirFormRotina({
      nome: r.nome,
      periodicidade: r.periodicidade,
      horario: r.horario,
      diaDaSemana: r.diaDaSemana ?? 1,
      diaDoMes: r.diaDoMes ?? 1,
      tipoEmailId: r.tipoEmailId ?? '',
      temas: r.temas.join(', '),
      fonteIds: r.fonteIds,
      listIds: r.listIds,
      ativa: r.ativa,
    });
  }

  function submeterRotina(e: FormEvent) {
    e.preventDefault();
    definirConfirmacaoRotina('');
    salvarRotina.mutate();
  }

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
    definirConfirmacaoFonte('');
    salvar.mutate();
  }

  const erros = salvar.error instanceof FalhaApi ? salvar.error.porCampo : {};
  const errosRotina = salvarRotina.error instanceof FalhaApi ? salvarRotina.error.porCampo : {};
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
        campanha — <strong className="font-medium text-ink">exceto</strong> pelas rotinas de envio
        automático abaixo, que disparam o boletim gerado direto para a lista escolhida.
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
        {confirmacaoFonte !== '' && !salvar.isPending && salvar.error === null && (
          <div className="mb-4">
            <Aviso tom="sucesso" texto={confirmacaoFonte} />
          </div>
        )}
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

      <Cartao
        titulo={editandoRotinaId === null ? 'Rotina de envio automático' : 'Editar rotina de envio'}
      >
        {/**
         * A frase de risco vem antes do formulário, não depois: quem cadastra
         * precisa saber O QUE está ligando antes de escolher horário e lista —
         * este é o único lugar do sistema onde um e-mail sai sem revisão.
         */}
        <p className="mb-4 max-w-3xl text-sm text-ink-suave">
          No período e horário escolhidos, o sistema gera o boletim e o{' '}
          <strong className="font-medium text-ink">envia sem revisão</strong> para a lista
          escolhida, com as guardas de sempre do disparo (descadastro, supressão, classificação de
          vínculo). O resultado de cada envio fica no histórico desta página e em Campanhas. Quando
          as fontes não trazem novidade, sai mesmo assim uma{' '}
          <strong className="font-medium text-ink">edição de retrospectiva</strong>, com as leituras
          mais relevantes sobre os temas — e o leitor é avisado disso no próprio e-mail.
        </p>

        {confirmacaoRotina !== '' && !salvarRotina.isPending && salvarRotina.error === null && (
          <div className="mb-4">
            <Aviso tom="sucesso" texto={confirmacaoRotina} />
          </div>
        )}
        {!formRotinaAberto && (
          <Botao
            variante="secundario"
            onClick={() => {
              definirEditandoRotinaId(null);
              definirFormRotina(ROTINA_VAZIA);
              definirFormRotinaAberto(true);
            }}
          >
            Nova rotina
          </Botao>
        )}

        {formRotinaAberto && (
          <form onSubmit={submeterRotina} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Nome da rotina"
                obrigatorio
                erro={errosRotina['nome']}
                ajuda="Vira o nome do modelo e das campanhas de cada edição."
              >
                <input
                  value={formRotina.nome}
                  onChange={(e) => definirFormRotina({ ...formRotina, nome: e.target.value })}
                  placeholder="Ex.: Boletim Tributário"
                  className={classeEntrada}
                />
              </Campo>
              <Campo
                rotulo="Tipo de campanha"
                erro={errosRotina['tipoEmailId']}
                ajuda="Dá a categoria do modelo e o tipo da campanha. Sem escolha, sai como Boletim."
              >
                <select
                  value={formRotina.tipoEmailId}
                  onChange={(e) =>
                    definirFormRotina({ ...formRotina, tipoEmailId: e.target.value })
                  }
                  className={classeEntrada}
                >
                  <option value="">Boletim (padrão)</option>
                  {(tipos.data?.itens ?? []).map((t) => (
                    <option key={t.tipoEmailId} value={t.tipoEmailId}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>

            <Campo
              rotulo="Temas"
              erro={errosRotina['temas']}
              ajuda="Separados por vírgula. A IA prioriza notícias destes temas e descarta o resto. Vazio = a instrução de cada fonte manda sozinha."
            >
              <input
                value={formRotina.temas}
                onChange={(e) => definirFormRotina({ ...formRotina, temas: e.target.value })}
                placeholder="Ex.: Reforma Tributária, STJ, contencioso"
                className={classeEntrada}
              />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="text-sm font-medium text-ink">Fontes desta rotina</legend>
                <p className="mt-0.5 text-xs text-ink-suave">
                  Nenhuma marcada = todas as fontes ativas.
                </p>
                <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {itens.length === 0 && (
                    <p className="text-sm text-ink-suave">Nenhuma fonte cadastrada ainda.</p>
                  )}
                  {itens.map((f) => (
                    <label key={f.fonteId} className="flex min-h-8 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={formRotina.fonteIds.includes(f.fonteId)}
                        onChange={(e) =>
                          definirFormRotina({
                            ...formRotina,
                            fonteIds: marcar(formRotina.fonteIds, f.fonteId, e.target.checked),
                          })
                        }
                      />
                      <span className="min-w-0 truncate">
                        {f.nome}
                        {!f.ativa && <span className="text-ink-suave"> (pausada)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-medium text-ink">Listas que recebem</legend>
                <p className="mt-0.5 text-xs text-ink-suave">
                  Uma campanha enviada por lista, sem revisão. Pelo menos uma.
                </p>
                <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                  {(listas.data?.itens.length ?? 0) === 0 && (
                    <p className="text-sm text-ink-suave">Nenhuma lista de contatos ainda.</p>
                  )}
                  {(listas.data?.itens ?? []).map((l) => (
                    <label key={l.listId} className="flex min-h-8 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={formRotina.listIds.includes(l.listId)}
                        onChange={(e) =>
                          definirFormRotina({
                            ...formRotina,
                            listIds: marcar(formRotina.listIds, l.listId, e.target.checked),
                          })
                        }
                      />
                      <span className="min-w-0 truncate">{l.nome}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Período" obrigatorio erro={errosRotina['periodicidade']}>
                <select
                  value={formRotina.periodicidade}
                  onChange={(e) =>
                    definirFormRotina({
                      ...formRotina,
                      periodicidade: e.target.value as Rotina['periodicidade'],
                    })
                  }
                  className={classeEntrada}
                >
                  <option value="DIARIA">Diário</option>
                  <option value="SEMANAL">Semanal</option>
                  <option value="MENSAL">Mensal</option>
                </select>
              </Campo>

              {formRotina.periodicidade === 'SEMANAL' && (
                <Campo rotulo="Dia da semana" obrigatorio erro={errosRotina['diaDaSemana']}>
                  <select
                    value={formRotina.diaDaSemana}
                    onChange={(e) =>
                      definirFormRotina({ ...formRotina, diaDaSemana: Number(e.target.value) })
                    }
                    className={classeEntrada}
                  >
                    {DIAS_SEMANA.map((d, i) => (
                      <option key={d} value={i + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}

              {formRotina.periodicidade === 'MENSAL' && (
                <Campo
                  rotulo="Dia do mês"
                  obrigatorio
                  erro={errosRotina['diaDoMes']}
                  ajuda="1 a 28 — dias 29 a 31 não existem em todos os meses"
                >
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={formRotina.diaDoMes}
                    onChange={(e) =>
                      definirFormRotina({ ...formRotina, diaDoMes: Number(e.target.value) })
                    }
                    className={classeEntrada}
                  />
                </Campo>
              )}

              <Campo
                rotulo="Horário"
                obrigatorio
                erro={errosRotina['horario']}
                ajuda="Horário de Brasília."
              >
                <input
                  type="time"
                  value={formRotina.horario}
                  onChange={(e) => definirFormRotina({ ...formRotina, horario: e.target.value })}
                  className={classeEntrada}
                />
              </Campo>
            </div>

            <ErroCaixa erro={salvarRotina.error} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={formRotina.ativa}
                  onChange={(e) => definirFormRotina({ ...formRotina, ativa: e.target.checked })}
                />
                Rotina ligada
              </label>
              <div className="flex gap-2">
                <Botao
                  variante="secundario"
                  onClick={() => {
                    definirEditandoRotinaId(null);
                    definirFormRotina(ROTINA_VAZIA);
                    definirFormRotinaAberto(false);
                  }}
                >
                  Cancelar
                </Botao>
                <Botao
                  type="submit"
                  carregando={salvarRotina.isPending}
                  disabled={formRotina.listIds.length === 0}
                >
                  {editandoRotinaId === null ? 'Criar rotina' : 'Salvar rotina'}
                </Botao>
              </div>
            </div>
          </form>
        )}

        <div className="mt-6">
          {rotinas.isLoading && <Carregando />}
          <ErroCaixa erro={rotinas.error} />
          {(rotinas.data?.itens.length ?? 0) === 0 && !rotinas.isLoading && (
            <Vazio mensagem="Nenhuma rotina de envio. Sem rotina, o boletim gerado espera revisão e disparo manual — que é o comportamento padrão." />
          )}

          <ul className="divide-y divide-line">
            {(rotinas.data?.itens ?? []).map((r) => {
              const nomesListas = r.listIds.map(
                (id) => (listas.data?.itens ?? []).find((l) => l.listId === id)?.nome ?? id,
              );
              const nomeTipo = (tipos.data?.itens ?? []).find(
                (t) => t.tipoEmailId === r.tipoEmailId,
              )?.nome;
              return (
                <li
                  key={r.rotinaId}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{r.nome}</span>
                      <Selo tom={r.ativa ? 'positivo' : 'neutro'}>
                        {r.ativa ? 'ligada' : 'desligada'}
                      </Selo>
                      {nomeTipo !== undefined && <Selo tom="neutro">{nomeTipo}</Selo>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-suave">{descreverRotina(r)}</p>
                    <p className="mt-1 text-sm text-ink-suave">
                      Envia para <span className="font-medium">{nomesListas.join(', ')}</span> sem
                      revisão.
                    </p>
                    <p className="text-xs text-ink-suave">
                      {r.fonteIds.length === 0
                        ? 'Todas as fontes ativas'
                        : `${r.fonteIds.length} fonte(s) escolhida(s)`}
                      {r.temas.length > 0 && ` · temas: ${r.temas.join(', ')}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Botao variante="secundario" onClick={() => editarRotina(r)}>
                      Editar
                    </Botao>
                    <Botao
                      variante="secundario"
                      carregando={alternarRotina.isPending}
                      onClick={() => alternarRotina.mutate(r)}
                    >
                      {r.ativa ? 'Desligar' : 'Ligar'}
                    </Botao>
                    <Botao
                      variante="perigo"
                      carregando={excluirRotina.isPending}
                      onClick={() => {
                        if (window.confirm('Excluir esta rotina de envio automático?'))
                          excluirRotina.mutate(r.rotinaId);
                      }}
                    >
                      Excluir
                    </Botao>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
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
            {execucao.origem === 'MANUAL'
              ? 'manual'
              : execucao.origem === 'ROTINA'
                ? 'rotina de envio'
                : 'agenda de segunda'}
            {duracao === null ? '' : ` · ${duracao}`}
            {execucao.edicao === 'RETROSPECTIVA' ? ' · retrospectiva' : ''}
          </span>
        </p>
        {execucao.erro !== null && <p className="mt-1 text-sm text-ink-suave">{execucao.erro}</p>}
        {execucao.situacao === 'CONCLUIDA' && (
          <p className="mt-1 text-sm text-ink-suave">
            {execucao.totalNoticias} notícia(s) · {execucao.templateNome}
            {(execucao.envioCampaignIds ?? []).length > 0 ? ' · enviado automaticamente' : ''}
          </p>
        )}
        {(execucao.envioErro ?? null) !== null && (
          <p className="mt-1 text-sm font-medium text-erro">
            O envio automático falhou: {execucao.envioErro}
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
