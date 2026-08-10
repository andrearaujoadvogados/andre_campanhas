import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FalhaApi, api, type ComAviso } from '../lib/api.js';
import { Aviso, Botao, Campo, ErroCaixa, classeEntrada } from './base.tsx';

/**
 * Assistente de criação de boletim — §8 do briefing, versão desburocratizada.
 *
 * Quatro passos: Configurar → E-mail → Destinatários → Revisar. Sem etapa de
 * aprovação: quem monta é quem dispara; o último passo é só resumo + teste.
 *
 * Decisões de produto (2026-08-09): a seleção de **lista é obrigatória** e o
 * **remetente vem fixo** (padrão do escritório), oculto atrás de "opções
 * avançadas" — um campo a menos por boletim. O conteúdo em si é o do Modelo
 * escolhido (o Criador de e-mails vive lá); assunto/preheader próprios do
 * boletim entram numa etapa seguinte de backend.
 */

const REMETENTE_PADRAO_NOME = 'André Araújo Advogados';
const REMETENTE_PADRAO_EMAIL = 'boletins@mail.andrearaujoadvogados.com.br';

interface DadosBoletim {
  nome: string;
  assunto: string;
  templateId: string;
  listId: string;
  remetenteNome: string;
  remetenteEmail: string;
  replyTo: string;
  agendarPara: string;
}

const INICIAL: DadosBoletim = {
  nome: '',
  assunto: '',
  templateId: '',
  listId: '',
  remetenteNome: REMETENTE_PADRAO_NOME,
  remetenteEmail: REMETENTE_PADRAO_EMAIL,
  replyTo: '',
  agendarPara: '',
};

interface DestinatarioPrevia {
  contactId: string;
  nome: string | null;
  email: string;
  empresa: string | null;
}

const PASSOS = ['Configurar', 'E-mail', 'Destinatários', 'Revisar'] as const;

interface RespostaBoletim extends ComAviso {
  campaignId: string;
}

export function AssistenteBoletim({ aoCancelar }: { aoCancelar: () => void }) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [passo, definirPasso] = useState(0);
  const [dados, definirDados] = useState<DadosBoletim>(INICIAL);
  const [campaignId, definirCampaignId] = useState<string | null>(null);
  const [avancado, definirAvancado] = useState(false);
  const [testeTexto, definirTesteTexto] = useState('');
  const [avisoTeste, definirAvisoTeste] = useState<string | undefined>(undefined);
  const [tagsFiltroTexto, definirTagsFiltro] = useState('');
  // Ids destravados da seleção (desmarcados). Vazio = todos os elegíveis entram.
  const [desmarcados, definirDesmarcados] = useState<Set<string>>(new Set());
  const [buscaDest, definirBuscaDest] = useState('');

  const modelos = useQuery({
    queryKey: ['templates'],
    queryFn: () =>
      api.get<{ itens: { templateId: string; nome: string; categoria?: string | null }[] }>(
        '/templates',
      ),
  });
  const listas = useQuery({
    queryKey: ['listas'],
    queryFn: () =>
      api.get<{ itens: { listId: string; nome: string; totalContatos?: number }[] }>('/listas'),
  });

  const tagsFiltro = tagsFiltroTexto
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');

  // Prévia da audiência — Etapa 3. Recarrega quando a lista ou as tags mudam.
  const previa = useQuery({
    queryKey: ['audiencia-previa', dados.listId, tagsFiltroTexto],
    enabled: passo === 2 && dados.listId !== '',
    queryFn: () =>
      api.post<{ total: number; destinatarios: DestinatarioPrevia[] }>(
        '/boletins/audiencia-previa',
        {
          listId: dados.listId,
          tagsFiltro,
          incluirLeads: false,
        },
      ),
  });

  const idsPrevia = (previa.data?.destinatarios ?? []).map((d) => d.contactId);
  const selecionadosIds = idsPrevia.filter((id) => !desmarcados.has(id));

  const buscaNorm = buscaDest.trim().toLowerCase();
  const destinatariosFiltrados = (previa.data?.destinatarios ?? []).filter(
    (d) =>
      buscaNorm === '' ||
      (d.nome ?? '').toLowerCase().includes(buscaNorm) ||
      d.email.toLowerCase().includes(buscaNorm) ||
      (d.empresa ?? '').toLowerCase().includes(buscaNorm),
  );

  const definir = <K extends keyof DadosBoletim>(chave: K, v: DadosBoletim[K]) =>
    definirDados((d) => ({ ...d, [chave]: v }));

  const corpoParaSalvar = () => ({
    nome: dados.nome.trim(),
    templateId: dados.templateId,
    listId: dados.listId,
    remetenteNome: dados.remetenteNome.trim(),
    remetenteEmail: dados.remetenteEmail.trim(),
    ...(dados.replyTo.trim() === '' ? {} : { replyTo: dados.replyTo.trim() }),
    ...(dados.assunto.trim() === '' ? {} : { assunto: dados.assunto.trim() }),
    tagsFiltro,
    // Só manda a seleção quando o operador desmarcou alguém; senão, "todos".
    ...(desmarcados.size > 0 ? { destinatariosSelecionados: selecionadosIds } : {}),
  });

  /** Cria (ou atualiza) o rascunho e devolve o id — base para testar e disparar. */
  const salvarRascunho = useMutation({
    mutationFn: async (): Promise<string> => {
      if (campaignId === null) {
        const r = await api.post<RespostaBoletim>('/boletins', corpoParaSalvar());
        definirCampaignId(r.campaignId);
        return r.campaignId;
      }
      await api.patch<RespostaBoletim>(`/boletins/${campaignId}`, corpoParaSalvar());
      return campaignId;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campanhas'] }),
  });

  const teste = useMutation({
    mutationFn: async () => {
      const id = await salvarRascunho.mutateAsync();
      const destinatarios = testeTexto
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e !== '');
      return api.post<{ enviados: number; falhas: { email: string; motivo: string }[] } & ComAviso>(
        `/boletins/${id}/teste`,
        { destinatarios },
      );
    },
    onSuccess: (r) => definirAvisoTeste(r.aviso),
  });

  const disparar = useMutation({
    mutationFn: async () => {
      const id = await salvarRascunho.mutateAsync();
      if (dados.agendarPara !== '') {
        return api.post<RespostaBoletim>(`/boletins/${id}/agendamento`, {
          agendadaPara: new Date(dados.agendarPara).toISOString(),
        });
      }
      return api.post<RespostaBoletim>(`/boletins/${id}/disparo`);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['campanhas'] });
      navegar(`/boletins/${r.campaignId}`);
    },
  });

  const podeSalvar = dados.nome.trim() !== '' && dados.templateId !== '' && dados.listId !== '';

  /**
   * Desmarcou todo mundo — estado inválido, e não "envie para todos".
   *
   * Trava aqui em vez de deixar o backend recusar: o operador precisa ver o
   * problema na tela que o criou, e não como erro de validação depois do clique
   * em disparar. O contrato e o launcher recusam a mesma coisa, cada um por sua
   * conta — esta é a barreira que explica, as outras são as que garantem.
   */
  const semDestinatarios = desmarcados.size > 0 && selecionadosIds.length === 0;

  const validoNoPasso = (p: number): boolean => {
    if (p === 0) return dados.nome.trim() !== '' && dados.remetenteEmail.trim() !== '';
    if (p === 1) return dados.templateId !== '';
    if (p === 2) return dados.listId !== '';
    return true;
  };

  const erros = salvarRascunho.error instanceof FalhaApi ? salvarRascunho.error.porCampo : {};

  const modeloEscolhido = modelos.data?.itens.find((m) => m.templateId === dados.templateId);
  const listaEscolhida = listas.data?.itens.find((l) => l.listId === dados.listId);

  return (
    <div className="space-y-6">
      {/* Trilha dos passos */}
      <ol className="flex flex-wrap gap-1.5" aria-label="Etapas">
        {PASSOS.map((rotulo, i) => (
          <li key={rotulo}>
            <button
              type="button"
              // Só deixa pular para trás ou para o passo seguinte já válido.
              disabled={i > passo && !validoNoPasso(passo)}
              aria-current={i === passo ? 'step' : undefined}
              onClick={() => definirPasso(i)}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm font-medium ${
                i === passo
                  ? 'border-ink bg-ink text-paper-light'
                  : 'border-line bg-paper-light text-ink-suave hover:bg-accent-mist'
              }`}
            >
              {i + 1}. {rotulo}
            </button>
          </li>
        ))}
      </ol>

      {passo === 0 && (
        <div className="space-y-4">
          <Campo
            rotulo="Nome do boletim"
            ajuda="Só o escritório vê. Serve para achá-lo depois."
            obrigatorio
            erro={erros['nome']}
          >
            <input
              value={dados.nome}
              onChange={(e) => definir('nome', e.target.value)}
              className={classeEntrada}
            />
          </Campo>

          <Campo
            rotulo="Assunto do e-mail"
            ajuda="Vazio = usa o assunto do modelo. Preencha para dar a este boletim um assunto próprio."
            erro={erros['assunto']}
          >
            <input
              value={dados.assunto}
              onChange={(e) => definir('assunto', e.target.value)}
              className={classeEntrada}
            />
          </Campo>

          <Campo
            rotulo="Agendar para"
            ajuda="Opcional. Vazio = disparar assim que você concluir. Horário de Brasília."
          >
            <input
              type="datetime-local"
              value={dados.agendarPara}
              onChange={(e) => definir('agendarPara', e.target.value)}
              className={classeEntrada}
            />
          </Campo>

          <button
            type="button"
            onClick={() => definirAvancado((v) => !v)}
            className="text-sm text-ink-suave underline"
          >
            {avancado ? 'Ocultar opções avançadas' : 'Opções avançadas (remetente)'}
          </button>

          {avancado && (
            <div className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
              <Campo rotulo="Nome do remetente" erro={erros['remetenteNome']}>
                <input
                  value={dados.remetenteNome}
                  onChange={(e) => definir('remetenteNome', e.target.value)}
                  className={classeEntrada}
                />
              </Campo>
              <Campo
                rotulo="E-mail do remetente"
                ajuda="Precisa terminar em @mail.andrearaujoadvogados.com.br."
                erro={erros['remetenteEmail']}
              >
                <input
                  type="email"
                  value={dados.remetenteEmail}
                  onChange={(e) => definir('remetenteEmail', e.target.value)}
                  className={classeEntrada}
                />
              </Campo>
              <Campo rotulo="Responder para" ajuda="Para onde vão as respostas.">
                <input
                  type="email"
                  value={dados.replyTo}
                  onChange={(e) => definir('replyTo', e.target.value)}
                  className={classeEntrada}
                />
              </Campo>
            </div>
          )}

          <Aviso texto="O conteúdo do e-mail é o do modelo escolhido no próximo passo — monte-o no Criador de e-mails, em Modelos." />
        </div>
      )}

      {passo === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-ink-suave">Escolha o modelo que este boletim vai usar.</p>
          <ErroCaixa erro={modelos.error} />
          <ul className="space-y-2">
            {modelos.data?.itens.map((m) => (
              <li key={m.templateId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2">
                  <input
                    type="radio"
                    name="modelo"
                    checked={dados.templateId === m.templateId}
                    onChange={() => definir('templateId', m.templateId)}
                  />
                  <span className="font-medium text-ink">{m.nome}</span>
                  {m.categoria ? (
                    <span className="text-xs text-ink-suave">· {m.categoria}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          {modelos.data?.itens.length === 0 && (
            <Aviso tom="alerta" texto="Nenhum modelo cadastrado. Crie um em Modelos primeiro." />
          )}
        </div>
      )}

      {passo === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Lista de contatos" obrigatorio>
              <select
                value={dados.listId}
                onChange={(e) => definir('listId', e.target.value)}
                className={classeEntrada}
              >
                <option value="">{listas.isLoading ? 'Carregando…' : 'Escolha uma lista…'}</option>
                {listas.data?.itens.map((l) => (
                  <option key={l.listId} value={l.listId}>
                    {l.nome}
                    {l.totalContatos === undefined ? '' : ` (${l.totalContatos})`}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              rotulo="Filtrar por tags"
              ajuda="Opcional, separadas por vírgula. O contato entra se tiver qualquer uma delas."
            >
              <input
                value={tagsFiltroTexto}
                onChange={(e) => definirTagsFiltro(e.target.value)}
                placeholder="ex.: tributário, evento-2026"
                className={classeEntrada}
              />
            </Campo>
          </div>

          {dados.listId === '' ? (
            <Aviso texto="Escolha uma lista para ver quem vai receber." />
          ) : previa.isLoading ? (
            <p className="text-sm text-ink-suave">Calculando destinatários…</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{selecionadosIds.length}</span> de{' '}
                  {previa.data?.total ?? 0} destinatários selecionados
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => definirDesmarcados(new Set())}
                    className="text-sm text-ink underline"
                  >
                    Selecionar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => definirDesmarcados(new Set(idsPrevia))}
                    className="text-sm text-ink-suave underline"
                  >
                    Desmarcar todos
                  </button>
                </div>
              </div>

              <input
                value={buscaDest}
                onChange={(e) => definirBuscaDest(e.target.value)}
                placeholder="Buscar por nome, e-mail ou empresa…"
                className={classeEntrada}
              />

              <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {destinatariosFiltrados.map((d) => (
                  <li key={d.contactId}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!desmarcados.has(d.contactId)}
                        onChange={() =>
                          definirDesmarcados((s) => {
                            const n = new Set(s);
                            if (n.has(d.contactId)) n.delete(d.contactId);
                            else n.add(d.contactId);
                            return n;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="text-ink">{d.nome ?? d.email}</span>{' '}
                        <span className="text-xs text-ink-suave">
                          {d.email}
                          {d.empresa ? ` · ${d.empresa}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
                {destinatariosFiltrados.length === 0 && (
                  <li className="px-3 py-2 text-sm text-ink-suave">
                    Nenhum destinatário elegível.
                  </li>
                )}
              </ul>
              <ErroCaixa erro={previa.error} />
            </div>
          )}
        </div>
      )}

      {passo === 3 && (
        <div className="space-y-4">
          <div className="rounded-md border border-line p-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Resumo rotulo="Nome" valor={dados.nome} />
              <Resumo
                rotulo="Assunto"
                valor={dados.assunto.trim() === '' ? '(do modelo)' : dados.assunto}
              />
              <Resumo rotulo="Modelo" valor={modeloEscolhido?.nome ?? '—'} />
              <Resumo rotulo="Lista" valor={listaEscolhida?.nome ?? '—'} />
              <Resumo
                rotulo="Filtro por tags"
                valor={tagsFiltro.length === 0 ? '—' : tagsFiltro.join(', ')}
              />
              <Resumo
                rotulo="Destinatários"
                valor={
                  dados.listId === ''
                    ? '—'
                    : `${selecionadosIds.length}${desmarcados.size > 0 ? ` (de ${previa.data?.total ?? 0})` : ''}`
                }
              />
              <Resumo
                rotulo="Remetente"
                valor={`${dados.remetenteNome} <${dados.remetenteEmail}>`}
              />
              <Resumo
                rotulo="Disparo"
                valor={dados.agendarPara === '' ? 'Imediato' : `Agendado: ${dados.agendarPara}`}
              />
            </dl>
          </div>

          <div className="space-y-2 rounded-md border border-line p-4">
            <Campo
              rotulo="Enviar e-mail de teste"
              ajuda="Até 3 endereços separados por vírgula. Chega com [TESTE] no assunto e não conta na campanha."
            >
              <input
                value={testeTexto}
                onChange={(e) => definirTesteTexto(e.target.value)}
                placeholder="voce@exemplo.com, colega@exemplo.com"
                className={classeEntrada}
              />
            </Campo>
            <Botao
              variante="secundario"
              carregando={teste.isPending}
              disabled={testeTexto.trim() === '' || !podeSalvar}
              onClick={() => teste.mutate()}
            >
              Enviar teste
            </Botao>
            <Aviso texto={avisoTeste} />
            <ErroCaixa erro={teste.error} />
          </div>

          {semDestinatarios && (
            <Aviso
              tom="alerta"
              texto="Nenhum destinatário selecionado. Volte para a Etapa 3 e escolha ao menos um contato — ou clique em “Selecionar todos” para enviar à lista inteira."
            />
          )}
          <ErroCaixa erro={disparar.error} />
          <Botao
            carregando={disparar.isPending}
            disabled={!podeSalvar || semDestinatarios}
            onClick={() => {
              const rotulo = dados.agendarPara === '' ? 'Disparar agora' : 'Agendar';
              if (
                window.confirm(`${rotulo} o boletim "${dados.nome}"? Isso não pode ser desfeito.`)
              )
                disparar.mutate();
            }}
          >
            {dados.agendarPara === '' ? 'Disparar agora' : 'Agendar disparo'}
          </Botao>
        </div>
      )}

      <ErroCaixa erro={salvarRascunho.error} />

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {passo > 0 && (
          <Botao variante="secundario" onClick={() => definirPasso((p) => p - 1)}>
            Voltar
          </Botao>
        )}
        {passo < PASSOS.length - 1 && (
          <Botao disabled={!validoNoPasso(passo)} onClick={() => definirPasso((p) => p + 1)}>
            Avançar
          </Botao>
        )}
        <Botao
          variante="secundario"
          carregando={salvarRascunho.isPending}
          disabled={!podeSalvar || semDestinatarios}
          onClick={() => salvarRascunho.mutate()}
        >
          Salvar rascunho
        </Botao>
        <Botao variante="secundario" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-ink-suave">{rotulo}</dt>
      <dd className="break-words text-ink">{valor}</dd>
    </div>
  );
}
