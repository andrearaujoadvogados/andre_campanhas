import { deveInterromperEnvio } from '../../domain/campaign/campaign.js';
import type { Envio } from '../../domain/send/envio.js';
import type { CampaignId, ContactId, SendId, TenantId } from '../../domain/shared/ids.js';
import type {
  CampaignRepository,
  CircuitBreaker,
  Clock,
  ContactRepository,
  DailyQuotaCounter,
  EmailHasher,
  EmailProvider,
  EmailRenderer,
  IdempotencyStore,
  SendRepository,
  SuppressionRepository,
  TemplateRepository,
  UnsubscribeTokenService,
} from '../ports/index.js';

/**
 * O que o worker deve fazer com a mensagem depois desta decisão.
 *
 * Modelar o desfecho como dado, em vez de o caso de uso mexer na fila
 * diretamente, mantém o domínio sem conhecer SQS — e deixa o worker responsável
 * por traduzir "adie" para o mecanismo que ele tiver.
 */
export type DesfechoEnvio =
  | { readonly acao: 'ENVIADO'; readonly sesMessageId: string }
  | { readonly acao: 'IGNORADO'; readonly motivo: string }
  | { readonly acao: 'ADIAR'; readonly segundos: number; readonly motivo: string }
  | { readonly acao: 'FALHA_PERMANENTE'; readonly motivo: string }
  | { readonly acao: 'FALHA_TRANSITORIA'; readonly motivo: string };

export interface DepsEnvio {
  readonly campanhas: CampaignRepository;
  readonly contatos: ContactRepository;
  readonly envios: SendRepository;
  readonly templates: TemplateRepository;
  readonly supressao: SuppressionRepository;
  readonly provedor: EmailProvider;
  readonly renderer: EmailRenderer;
  readonly tokens: UnsubscribeTokenService;
  readonly hasher: EmailHasher;
  readonly idempotencia: IdempotencyStore;
  readonly cotaDiaria: DailyQuotaCounter;
  readonly circuito: CircuitBreaker;
  readonly clock: Clock;
}

export interface EntradaEnvio {
  readonly tenantId: TenantId;
  readonly campaignId: CampaignId;
  readonly contactId: ContactId;
  readonly sendId: SendId;
  readonly limiteDiario: number;
  readonly baseUrlDescadastro: string;
  readonly configurationSet: string;
}

const TTL_IDEMPOTENCIA_SEGUNDOS = 60 * 60 * 24 * 7;
const CHAVE_CIRCUITO = 'ses:conta';

/**
 * Envia uma mensagem de campanha a um contato.
 *
 * A ordem das verificações é deliberada e vai da mais barata e mais grave para a
 * mais cara:
 *
 *  1. **Circuito aberto** — se a conta do SES está suspensa, nada mais importa.
 *  2. **Status da campanha** — pausada ou cancelada para tudo (ADR-05).
 *  3. **Idempotência** — antes de qualquer efeito, para não enviar duas vezes.
 *  4. **Elegibilidade e supressão** — a última chance de não atingir quem pediu
 *     para sair; a audiência foi resolvida antes, mas alguém pode ter se
 *     descadastrado no meio do disparo.
 *  5. **Cota diária** — só então gastamos uma vaga.
 *
 * Inverter 3 e 4 seria tentador (a checagem de supressão é mais barata), mas
 * criaria uma janela: sem a marca de idempotência gravada, uma reentrega
 * concorrente poderia passar pelas duas checagens ao mesmo tempo.
 */
export async function enviarMensagem(
  deps: DepsEnvio,
  entrada: EntradaEnvio,
): Promise<DesfechoEnvio> {
  const agora = deps.clock.agora();

  if (await deps.circuito.estaAberto(CHAVE_CIRCUITO)) {
    return { acao: 'ADIAR', segundos: 300, motivo: 'Circuito do SES aberto.' };
  }

  const status = await deps.campanhas.lerStatus(entrada.tenantId, entrada.campaignId);
  if (status === null) return { acao: 'IGNORADO', motivo: 'Campanha inexistente.' };

  if (status === 'PAUSADA') {
    return { acao: 'ADIAR', segundos: 60, motivo: 'Campanha pausada.' };
  }
  if (deveInterromperEnvio(status)) {
    return { acao: 'IGNORADO', motivo: `Campanha em status ${status}.` };
  }

  // Grava a marca ANTES de qualquer efeito externo. Se o processo morrer entre
  // isto e o envio, aquele destinatário não recebe — troca deliberada: melhor
  // um a menos numa falha rara do que a chance de enviar duas vezes (§5.4).
  const novo = await deps.idempotencia.registrarSeNovo(
    `send:${entrada.sendId}`,
    TTL_IDEMPOTENCIA_SEGUNDOS,
  );
  if (!novo) return { acao: 'IGNORADO', motivo: 'Envio já processado.' };

  const contato = await deps.contatos.buscarPorId(entrada.tenantId, entrada.contactId);
  if (contato === null) return { acao: 'IGNORADO', motivo: 'Contato inexistente.' };

  const emailHash = deps.hasher.hash(contato.email);
  if (await deps.supressao.estaSuprimido(entrada.tenantId, emailHash)) {
    // Pode ter se descadastrado depois que a audiência foi resolvida. Esta é a
    // última barreira antes de a mensagem sair.
    await registrar(deps, entrada, 'SUPRIMIDO', undefined, 'Suprimido antes do envio.');
    return { acao: 'IGNORADO', motivo: 'Contato suprimido.' };
  }

  const campanha = await deps.campanhas.buscarPorId(entrada.tenantId, entrada.campaignId);
  if (campanha === null) return { acao: 'IGNORADO', motivo: 'Campanha inexistente.' };

  const template = await deps.templates.buscarVersao(
    entrada.tenantId,
    campanha.templateId,
    campanha.templateVersao,
  );
  if (template === null) {
    await registrar(deps, entrada, 'FALHOU', undefined, 'Versão de template não encontrada.');
    return { acao: 'FALHA_PERMANENTE', motivo: 'Versão de template não encontrada.' };
  }

  const diaUtc = agora.toISOString().slice(0, 10);
  if (!(await deps.cotaDiaria.reservar(entrada.tenantId, diaUtc, entrada.limiteDiario))) {
    // Cota de 24h estourada. A mensagem é boa — só precisa da próxima janela.
    return { acao: 'ADIAR', segundos: segundosAteProximoDiaUtc(agora), motivo: 'Cota diária.' };
  }

  const token = deps.tokens.emitir({
    tenantId: entrada.tenantId,
    contactId: entrada.contactId,
    campaignId: entrada.campaignId,
  });
  const urlDescadastro = `${entrada.baseUrlDescadastro}?t=${encodeURIComponent(token)}`;

  const renderizado = await deps.renderer.renderizar(template, {
    contato: {
      ...(contato.nome === undefined ? {} : { nome: contato.nome }),
      email: contato.email.value,
      camposCustomizados: contato.camposCustomizados,
    },
    urlDescadastro,
  });

  const resultado = await deps.provedor.enviar({
    para: contato.email,
    deNome: campanha.remetenteNome,
    deEmail: campanha.remetenteEmail,
    ...(campanha.replyTo === undefined ? {} : { replyTo: campanha.replyTo }),
    assunto: renderizado.assunto,
    corpoHtml: renderizado.corpoHtml,
    corpoTexto: renderizado.corpoTexto,
    listUnsubscribeUrl: urlDescadastro,
    configurationSet: entrada.configurationSet,
    tags: {
      campanha: String(entrada.campaignId),
      tenant: String(entrada.tenantId),
    },
  });

  if (resultado.ok) {
    await registrar(deps, entrada, 'ENVIADO', resultado.value.providerMessageId);
    return { acao: 'ENVIADO', sesMessageId: resultado.value.providerMessageId };
  }

  const falha = resultado.error;
  switch (falha.tipo) {
    case 'THROTTLED':
      // Não é erro: é o fluxo normal com cota de 1 msg/s (§5.5). A marca de
      // idempotência precisa sair, senão a retentativa seria descartada como
      // duplicata e o destinatário nunca receberia.
      await liberarIdempotencia(deps, entrada);
      return {
        acao: 'ADIAR',
        segundos: Math.ceil(falha.tentarNovamenteEmMs / 1000),
        motivo: 'Throttling do SES.',
      };

    case 'CONTA_SUSPENSA':
      await deps.circuito.abrir(CHAVE_CIRCUITO, 900, falha.detalhe);
      await liberarIdempotencia(deps, entrada);
      return { acao: 'ADIAR', segundos: 300, motivo: `Conta suspensa: ${falha.detalhe}` };

    case 'REJEITADO_PERMANENTE':
      await registrar(deps, entrada, 'FALHOU', undefined, falha.detalhe);
      return { acao: 'FALHA_PERMANENTE', motivo: falha.detalhe };

    case 'ERRO_TRANSITORIO':
      await liberarIdempotencia(deps, entrada);
      return { acao: 'FALHA_TRANSITORIA', motivo: falha.detalhe };
  }
}

async function registrar(
  deps: DepsEnvio,
  entrada: EntradaEnvio,
  status: Envio['status'],
  sesMessageId?: string,
  falhaMotivo?: string,
): Promise<void> {
  await deps.envios.salvar({
    tenantId: entrada.tenantId,
    sendId: entrada.sendId,
    campaignId: entrada.campaignId,
    contactId: entrada.contactId,
    status,
    ...(sesMessageId === undefined ? {} : { sesMessageId }),
    ...(status === 'ENVIADO' ? { enviadoEm: deps.clock.agora() } : {}),
    ...(falhaMotivo === undefined ? {} : { falhaMotivo }),
  });
}

/**
 * Libera a marca para que a fila possa reentregar a mensagem.
 *
 * Só é chamado nos desfechos em que **nenhum e-mail saiu** — throttling, conta
 * suspensa e erro transitório. Nos casos em que o SES aceitou a mensagem, a
 * marca permanece: é justamente ela que impede o envio duplicado.
 */
async function liberarIdempotencia(deps: DepsEnvio, entrada: EntradaEnvio): Promise<void> {
  await deps.idempotencia.liberar(`send:${entrada.sendId}`);
}

function segundosAteProximoDiaUtc(agora: Date): number {
  const amanha = new Date(agora);
  amanha.setUTCHours(24, 0, 0, 0);
  // Teto de 12h: é o limite de adiamento do SQS. Além disso a mensagem volta
  // antes e simplesmente é adiada de novo.
  return Math.min(Math.ceil((amanha.getTime() - agora.getTime()) / 1000), 43_200);
}
