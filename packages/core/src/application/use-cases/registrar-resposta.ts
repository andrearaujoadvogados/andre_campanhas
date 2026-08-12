import type { EventoEnvio, Envio } from '../../domain/send/envio.js';
import { EmailAddress } from '../../domain/shared/email-address.js';
import { campaignId as novoCampaignId } from '../../domain/shared/ids.js';
import type { CampaignId, SendId, TenantId } from '../../domain/shared/ids.js';
import type {
  Clock,
  ContactRepository,
  EventRepository,
  IdempotencyStore,
  MetricsRepository,
  SendIdDeriver,
  SendRepository,
} from '../ports/index.js';

export interface DepsResposta {
  readonly envios: SendRepository;
  readonly contatos: ContactRepository;
  readonly metricas: MetricsRepository;
  readonly eventos: EventRepository;
  readonly idempotencia: IdempotencyStore;
  readonly sendIds: SendIdDeriver;
  readonly clock: Clock;
}

/**
 * Uma resposta que chegou pela regra de recebimento, já reduzida ao que importa.
 *
 * O e-mail inteiro não entra no domínio: corpo, anexos e cabeçalhos de trânsito
 * são problema da borda. Aqui chegam só os quatro fatos que permitem dizer
 * *quem* respondeu *a quê*.
 */
export interface RespostaRecebida {
  readonly tenantId: TenantId;
  /** Campanha marcada no `To:` da resposta (`resposta+<campaignId>@…`). */
  readonly campaignIdMarcado?: string | undefined;
  /** Quem respondeu — o `From:` da mensagem recebida. */
  readonly deEmail: string;
  /** MessageId do SES extraído de `In-Reply-To`/`References`, quando veio. */
  readonly sesMessageIdOriginal?: string | undefined;
  readonly recebidoEm: Date;
  /** Message-ID da mensagem **recebida** — a chave de deduplicação. */
  readonly idMensagemRecebida: string;
}

export type ResultadoResposta =
  | { readonly acao: 'REGISTRADA'; readonly sendId: SendId; readonly primeira: boolean }
  | { readonly acao: 'DUPLICADA' }
  | { readonly acao: 'NAO_CORRELACIONADA'; readonly motivo: string };

/** 13 meses — a mesma retenção dos eventos de envio (§10.2). */
const TTL_SEGUNDOS = 60 * 60 * 24 * 400;

/**
 * Registra que um contato respondeu a um e-mail da campanha — §11, item 9.
 *
 * **Não passa pelo `processarEvento`** de propósito, apesar de gravar um evento
 * do mesmo tipo. Aquele caso de uso começa resolvendo o envio pelo messageId do
 * SES, que é justamente o que uma resposta pode não trazer; e termina na
 * supressão automática, que aqui seria um erro grave — responder é o oposto de
 * reclamar, e suprimir quem respondeu tiraria da lista exatamente o contato mais
 * engajado.
 */
export async function registrarResposta(
  deps: DepsResposta,
  resposta: RespostaRecebida,
): Promise<ResultadoResposta> {
  const chaveDedupe = `resp:${resposta.idMensagemRecebida}`;

  if (!(await deps.idempotencia.registrarSeNovo(chaveDedupe, TTL_SEGUNDOS))) {
    return { acao: 'DUPLICADA' };
  }

  const envio = await resolverEnvio(deps, resposta);

  if (envio === null) {
    /**
     * Libera a marca antes de devolver.
     *
     * Sem isso, a corrida perde a resposta para sempre: se o e-mail chegou
     * antes de o registro de envio terminar de gravar, a reentrega da fila
     * encontraria a marca já posta e descartaria a mensagem como duplicata —
     * quando na verdade ela nunca foi processada. Nada externo aconteceu até
     * aqui, então liberar é seguro.
     */
    await deps.idempotencia.liberar(chaveDedupe);
    return {
      acao: 'NAO_CORRELACIONADA',
      motivo: `Sem envio correspondente para ${resposta.deEmail}.`,
    };
  }

  const evento: EventoEnvio = {
    tenantId: envio.tenantId,
    // O envio já entregue sempre tem messageId; a alternativa vazia existe só
    // para o tipo, e o evento continua útil porque a chave real é o sendId.
    sesMessageId: envio.sesMessageId ?? '',
    tipo: 'RESPOSTA',
    ocorridoEm: resposta.recebidoEm,
    destinatario: resposta.deEmail,
  };

  await deps.eventos.salvar(
    evento,
    envio.sendId,
    Math.floor(deps.clock.agora().getTime() / 1000) + TTL_SEGUNDOS,
  );

  /**
   * O contador é de **e-mails respondidos**, não de mensagens recebidas.
   *
   * Quem responde, lê a resposta do advogado e responde de novo gerou três
   * mensagens e respondeu a um e-mail. Contar mensagens daria 300% de taxa de
   * resposta numa campanha de uma pessoa — a mesma guarda por envio que
   * resolve abertura única resolve isto (§11, item 8).
   */
  const chaveUnica = `unico:RESPOSTA:${envio.sendId}`;
  const primeira = await deps.idempotencia.registrarSeNovo(chaveUnica, TTL_SEGUNDOS);

  if (primeira) {
    await deps.metricas.incrementar(envio.tenantId, envio.campaignId, 'respostas');
    // Carimba no envio: é daqui que sai a lista de quem respondeu. Só a
    // primeira resposta carimba, para a data ser a do primeiro retorno.
    await deps.envios.salvar({ ...envio, respondidoEm: resposta.recebidoEm });
  }

  return { acao: 'REGISTRADA', sendId: envio.sendId, primeira };
}

/**
 * Os dois caminhos de correlação, nesta ordem.
 *
 * O endereço vem primeiro porque é o mais confiável: o `To:` da resposta é
 * literalmente o `Reply-To:` que escrevemos, e sobrevive a encaminhamento e a
 * cliente que não preenche cabeçalho de thread. O `In-Reply-To` é a rede de
 * segurança para o caso de o contato responder de um endereço que não é o dele
 * na nossa base — aí o remetente não encontra contato, mas o cabeçalho ainda
 * aponta para o envio certo.
 */
async function resolverEnvio(
  deps: DepsResposta,
  resposta: RespostaRecebida,
): Promise<Envio | null> {
  const porEndereco = await porCampanhaERemetente(deps, resposta);
  if (porEndereco !== null) return porEndereco;

  if (resposta.sesMessageIdOriginal !== undefined && resposta.sesMessageIdOriginal !== '') {
    return deps.envios.buscarPorMessageId(resposta.sesMessageIdOriginal);
  }

  return null;
}

async function porCampanhaERemetente(
  deps: DepsResposta,
  resposta: RespostaRecebida,
): Promise<Envio | null> {
  const marca = resposta.campaignIdMarcado;
  if (marca === undefined || marca === '') return null;

  const email = EmailAddress.create(resposta.deEmail);
  if (!email.ok) return null;

  const contato = await deps.contatos.buscarPorEmail(resposta.tenantId, email.value);
  if (contato === null) return null;

  const campaignId: CampaignId = novoCampaignId(marca);
  const sendId = deps.sendIds.derivar(campaignId, contato.contactId);

  return deps.envios.buscarPorId(resposta.tenantId, campaignId, sendId);
}
