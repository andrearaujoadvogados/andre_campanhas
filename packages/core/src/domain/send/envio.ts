import type { CampaignId, ContactId, SendId, TenantId } from '../shared/ids.js';

/**
 * Envio — uma tentativa de entregar uma campanha a um contato.
 *
 * O `sendId` é determinístico (`hash(campaignId, contactId)`), e é isso que
 * torna o reprocessamento seguro: se a mesma mensagem voltar da fila, a chave é
 * a mesma e a guarda de idempotência reconhece (§5.4).
 */
export type StatusEnvio =
  'PENDENTE' | 'ENVIADO' | 'ENTREGUE' | 'FALHOU' | 'SUPRIMIDO' | 'CANCELADO';

export interface Envio {
  readonly tenantId: TenantId;
  readonly sendId: SendId;
  readonly campaignId: CampaignId;
  readonly contactId: ContactId;
  readonly status: StatusEnvio;
  /** MessageId do SES. É o que liga eventos futuros a este envio (§6.3, GSI4). */
  readonly sesMessageId?: string;
  readonly enviadoEm?: Date;
  readonly falhaMotivo?: string;
}

/**
 * Tipos de evento publicados pelo Configuration Set — §11, item 5.
 *
 * Espelham os nomes do SES de propósito: o tradutor da borda (§5.10) converte a
 * forma aninhada do payload, mas manter o vocabulário reconhecível evita uma
 * camada de tradução mental na hora de investigar um incidente.
 */
export type TipoEvento =
  | 'SEND'
  | 'DELIVERY'
  | 'OPEN'
  | 'CLICK'
  | 'BOUNCE'
  | 'COMPLAINT'
  | 'REJECT'
  | 'RENDERING_FAILURE'
  | 'DELIVERY_DELAY';

export type SubtipoBounce = 'Permanent' | 'Transient' | 'Undetermined';

export interface EventoEnvio {
  readonly tenantId: TenantId;
  readonly sesMessageId: string;
  readonly tipo: TipoEvento;
  readonly ocorridoEm: Date;
  readonly subtipoBounce?: SubtipoBounce;
  readonly urlClicada?: string;
  readonly destinatario?: string;
  readonly diagnostico?: string;
}

/**
 * Campos de métrica incrementados por evento — §5.7.
 *
 * Contadores pré-agregados em vez de varrer eventos a cada abertura de tela: um
 * relatório de campanha percorreria dezenas de milhares de itens toda vez.
 */
export type CampoMetrica =
  | 'enviados'
  | 'entregues'
  | 'aberturasTotais'
  | 'aberturasUnicas'
  | 'cliquesTotais'
  | 'cliquesUnicos'
  | 'bouncesHard'
  | 'bouncesSoft'
  | 'reclamacoes'
  | 'descadastros'
  | 'rejeitados'
  | 'falhasRenderizacao';

/**
 * Mapeia evento → contador.
 *
 * `null` significa "não conta": `DELIVERY_DELAY` é um aviso de que o servidor de
 * destino está lento e vai tentar de novo, não um desfecho. Contá-lo como falha
 * inflaria a taxa de bounce e dispararia o alarme (§10.4) sem que nada tenha
 * dado errado.
 *
 * Abertura e clique **únicos** não saem daqui: exigem saber se aquele contato já
 * abriu antes, o que é decisão de quem processa, não do mapa.
 */
export function metricaDoEvento(evento: EventoEnvio): CampoMetrica | null {
  switch (evento.tipo) {
    case 'SEND':
      return 'enviados';
    case 'DELIVERY':
      return 'entregues';
    case 'OPEN':
      return 'aberturasTotais';
    case 'CLICK':
      return 'cliquesTotais';
    case 'BOUNCE':
      // Soft bounce é condição temporária — caixa cheia, servidor fora do ar.
      // Separar dos hard é o que permite alarmar só no que indica lista suja.
      return evento.subtipoBounce === 'Permanent' ? 'bouncesHard' : 'bouncesSoft';
    case 'COMPLAINT':
      return 'reclamacoes';
    case 'REJECT':
      return 'rejeitados';
    case 'RENDERING_FAILURE':
      return 'falhasRenderizacao';
    case 'DELIVERY_DELAY':
      return null;
  }
}

/** Novo status do envio após um evento, ou `null` se o evento não muda o status. */
export function statusAposEvento(evento: EventoEnvio): StatusEnvio | null {
  switch (evento.tipo) {
    case 'DELIVERY':
      return 'ENTREGUE';
    case 'BOUNCE':
      return evento.subtipoBounce === 'Permanent' ? 'FALHOU' : null;
    case 'REJECT':
    case 'RENDERING_FAILURE':
      return 'FALHOU';
    default:
      return null;
  }
}
