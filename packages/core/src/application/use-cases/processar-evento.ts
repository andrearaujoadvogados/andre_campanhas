import { metricaDoEvento, statusAposEvento, type EventoEnvio } from '../../domain/send/envio.js';
import { motivoDeEventoBounce } from '../../domain/suppression/suppression.js';
import { EmailAddress } from '../../domain/shared/email-address.js';
import { aplicarHardBounce, aplicarReclamacao } from '../../domain/contact/contact.js';
import type {
  Clock,
  ContactRepository,
  EmailHasher,
  EventRepository,
  IdempotencyStore,
  MetricsRepository,
  SendRepository,
  SuppressionRepository,
} from '../ports/index.js';

export interface DepsEvento {
  readonly envios: SendRepository;
  readonly contatos: ContactRepository;
  readonly supressao: SuppressionRepository;
  readonly metricas: MetricsRepository;
  readonly eventos: EventRepository;
  readonly idempotencia: IdempotencyStore;
  readonly hasher: EmailHasher;
  readonly clock: Clock;
}

export type ResultadoEvento =
  | { readonly acao: 'PROCESSADO'; readonly suprimiu: boolean }
  | { readonly acao: 'DUPLICADO' }
  | { readonly acao: 'ORFAO'; readonly motivo: string };

/** 13 meses — mesma retenção dos eventos (§10.2), para a dedupe cobrir a janela toda. */
const TTL_DEDUPE_SEGUNDOS = 60 * 60 * 24 * 400;

/**
 * Processa um evento de envio do SES — §11, item 5 e 6.
 *
 * A primeira coisa é a guarda de deduplicação, e ela é o ponto do caso de uso
 * inteiro: SNS e SQS entregam *pelo menos uma vez*, então um mesmo `DELIVERY`
 * pode chegar duas vezes. Sem a guarda, os contadores da campanha inflariam e o
 * relatório mostraria mais entregas do que e-mails enviados — número que
 * ninguém consegue explicar depois.
 *
 * A chave combina messageId, tipo e instante. Só messageId + tipo seria errado:
 * um contato pode abrir o mesmo e-mail várias vezes, e cada abertura é um evento
 * legítimo, não uma duplicata.
 */
export async function processarEvento(
  deps: DepsEvento,
  evento: EventoEnvio,
): Promise<ResultadoEvento> {
  const chave = chaveDedupe(evento);

  if (!(await deps.idempotencia.registrarSeNovo(chave, TTL_DEDUPE_SEGUNDOS))) {
    return { acao: 'DUPLICADO' };
  }

  const envio = await deps.envios.buscarPorMessageId(evento.sesMessageId);
  if (envio === null) {
    // Evento sem envio correspondente. Acontece com mensagens enviadas fora do
    // sistema pela mesma identidade, ou se o evento chegou antes de a gravação
    // do envio concluir. Não é erro: descartar em silêncio seria pior, então
    // devolvemos ORFAO e quem chama decide se loga ou reprocessa.
    return { acao: 'ORFAO', motivo: `Envio não encontrado para ${evento.sesMessageId}.` };
  }

  /**
   * Persiste o evento individual — §6.1, §10.2.
   *
   * O contador agregado sozinho não basta: ele responde "quantos abriram", e a
   * portabilidade e o direito de acesso perguntam "quando *este* titular abriu".
   * Sem o registro individual, um pedido do art. 18 seria respondido com "não
   * temos essa informação" quando na verdade temos — só não guardamos.
   *
   * TTL de 13 meses, como documentado: permite comparação ano a ano e depois
   * some sozinho, que é minimização de verdade e não promessa em documento.
   */
  await deps.eventos.salvar(
    evento,
    envio.sendId,
    Math.floor(deps.clock.agora().getTime() / 1000) + TTL_DEDUPE_SEGUNDOS,
  );

  const campo = metricaDoEvento(evento);
  if (campo !== null) {
    await deps.metricas.incrementar(envio.tenantId, envio.campaignId, campo);
  }

  /**
   * Aberturas e cliques **únicos** — §11, item 8.
   *
   * O total é inflado por quem reabre a mensagem três vezes; a taxa que se
   * compara entre campanhas é a única. Contar exige saber se aquele destinatário
   * já abriu antes, e é a mesma primitiva da deduplicação que responde isso: uma
   * marca por envio, gravada condicionalmente.
   *
   * Note a diferença para a guarda do início do método: aquela é por *evento*
   * (messageId + tipo + instante); esta é por *envio* (sendId + tipo). É o que
   * separa "este evento já foi processado" de "esta pessoa já tinha aberto".
   */
  if (evento.tipo === 'OPEN' || evento.tipo === 'CLICK') {
    const chaveUnico = `unico:${evento.tipo}:${envio.sendId}`;
    if (await deps.idempotencia.registrarSeNovo(chaveUnico, TTL_DEDUPE_SEGUNDOS)) {
      await deps.metricas.incrementar(
        envio.tenantId,
        envio.campaignId,
        evento.tipo === 'OPEN' ? 'aberturasUnicas' : 'cliquesUnicos',
      );
    }
  }

  const novoStatus = statusAposEvento(evento);
  if (novoStatus !== null && novoStatus !== envio.status) {
    await deps.envios.salvar({ ...envio, status: novoStatus });
  }

  const suprimiu = await talvezSuprimir(deps, evento, envio.tenantId, envio.contactId);
  return { acao: 'PROCESSADO', suprimiu };
}

/**
 * Supressão automática — §11, item 6.
 *
 * Hard bounce e reclamação de spam suprimem; soft bounce não. A distinção é o
 * que separa "este endereço não existe" de "a caixa está cheia hoje" —
 * suprimir por soft bounce descartaria contatos válidos, e não suprimir por hard
 * bounce corrói a reputação da conta a cada campanha.
 */
async function talvezSuprimir(
  deps: DepsEvento,
  evento: EventoEnvio,
  tenantId: EventoEnvio['tenantId'],
  contactId: Parameters<ContactRepository['buscarPorId']>[1],
): Promise<boolean> {
  const motivo =
    evento.tipo === 'COMPLAINT'
      ? ('RECLAMACAO' as const)
      : evento.tipo === 'BOUNCE'
        ? motivoDeEventoBounce(evento.subtipoBounce === 'Permanent' ? 'Permanent' : 'Transient')
        : null;

  if (motivo === null) return false;

  const contato = await deps.contatos.buscarPorId(tenantId, contactId);
  const agora = deps.clock.agora();

  // O e-mail para hash vem do contato quando ele existe. Se foi excluído no
  // meio do caminho, caímos no endereço que o próprio evento carrega — não
  // suprimir por falta de contato deixaria a conta exposta ao próximo disparo.
  const email =
    contato?.email ??
    (evento.destinatario === undefined
      ? null
      : (() => {
          const e = EmailAddress.create(evento.destinatario);
          return e.ok ? e.value : null;
        })());

  if (email === null) return false;

  await deps.supressao.suprimir({
    tenantId,
    emailHash: deps.hasher.hash(email),
    motivo,
    suprimidoEm: agora,
    origem: `evento-ses:${evento.tipo}`,
  });

  if (contato !== null) {
    const atualizado =
      motivo === 'RECLAMACAO'
        ? aplicarReclamacao(contato, agora)
        : aplicarHardBounce(contato, agora);
    await deps.contatos.salvar(atualizado);
  }

  return true;
}

function chaveDedupe(evento: EventoEnvio): string {
  const partes = [
    evento.sesMessageId,
    evento.tipo,
    evento.ocorridoEm.toISOString(),
    // Dois cliques no mesmo instante em links diferentes são eventos distintos.
    evento.urlClicada ?? '',
  ];
  // Prefixo de comprimento: sem ele, campos com ':' produziriam a mesma chave
  // para combinações diferentes.
  return `evt:${partes.map((p) => `${p.length}:${p}`).join('')}`;
}
