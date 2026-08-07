import type { EventoEnvio, SubtipoBounce, TenantId, TipoEvento } from '@emailmkt/core';

/**
 * Anti-corruption layer sobre a notificação do SES — §5.10.
 *
 * O payload do SES é aninhado, muda de forma conforme o tipo de evento e não
 * está sob nosso controle. Traduzir na borda impede que essa forma vaze para o
 * domínio e para o banco — se vazasse, uma mudança de contrato da AWS obrigaria
 * a mexer em regra de negócio.
 *
 * Nada aqui lança exceção por campo inesperado: um formato novo deve virar
 * `null` e ir para a DLQ para inspeção humana, não derrubar o processamento do
 * lote inteiro.
 */

const TIPOS: Readonly<Record<string, TipoEvento>> = {
  Send: 'SEND',
  Delivery: 'DELIVERY',
  Open: 'OPEN',
  Click: 'CLICK',
  Bounce: 'BOUNCE',
  Complaint: 'COMPLAINT',
  Reject: 'REJECT',
  'Rendering Failure': 'RENDERING_FAILURE',
  RenderingFailure: 'RENDERING_FAILURE',
  DeliveryDelay: 'DELIVERY_DELAY',
};

export function traduzirEventoSes(bruto: unknown, tenantId: TenantId): EventoEnvio | null {
  if (!ehObjeto(bruto)) return null;

  // O SES usa `eventType` nos Configuration Sets e `notificationType` nas
  // notificações antigas de identidade. Aceitar os dois evita quebrar se a
  // origem mudar.
  const nomeTipo = texto(bruto['eventType']) ?? texto(bruto['notificationType']);
  if (nomeTipo === null) return null;

  const tipo = TIPOS[nomeTipo];
  if (tipo === undefined) return null;

  const mail = ehObjeto(bruto['mail']) ? bruto['mail'] : null;
  const sesMessageId = mail === null ? null : texto(mail['messageId']);
  if (sesMessageId === null) return null;

  const ocorridoEm = extrairInstante(bruto, tipo, mail);
  const destinatario = extrairDestinatario(bruto, tipo, mail);

  const base: EventoEnvio = {
    tenantId,
    sesMessageId,
    tipo,
    ocorridoEm,
    ...(destinatario === null ? {} : { destinatario }),
  };

  if (tipo === 'BOUNCE') {
    const bounce = ehObjeto(bruto['bounce']) ? bruto['bounce'] : null;
    const subtipo = bounce === null ? null : texto(bounce['bounceType']);
    const diagnostico = extrairDiagnostico(bounce);

    return {
      ...base,
      subtipoBounce: normalizarBounce(subtipo),
      ...(diagnostico === null ? {} : { diagnostico }),
    };
  }

  if (tipo === 'CLICK') {
    const click = ehObjeto(bruto['click']) ? bruto['click'] : null;
    const link = click === null ? null : texto(click['link']);
    return { ...base, ...(link === null ? {} : { urlClicada: link }) };
  }

  return base;
}

/**
 * O nome do campo de instante muda por tipo — `bounce.timestamp`,
 * `delivery.timestamp`, `open.timestamp`… Sem esse cuidado, todo evento cairia
 * no `mail.timestamp`, que é o horário do **envio**, não do evento. O efeito
 * seria sutil e ruim: todas as aberturas de uma campanha teriam o mesmo
 * instante, e a chave de deduplicação as trataria como uma só (§5.4).
 */
function extrairInstante(
  bruto: Record<string, unknown>,
  tipo: TipoEvento,
  mail: Record<string, unknown> | null,
): Date {
  const secoes: Record<TipoEvento, string> = {
    SEND: 'send',
    DELIVERY: 'delivery',
    OPEN: 'open',
    CLICK: 'click',
    BOUNCE: 'bounce',
    COMPLAINT: 'complaint',
    REJECT: 'reject',
    RENDERING_FAILURE: 'failure',
    DELIVERY_DELAY: 'deliveryDelay',
  };

  const secao = bruto[secoes[tipo]];
  const carimbo = ehObjeto(secao) ? texto(secao['timestamp']) : null;
  const alternativa = mail === null ? null : texto(mail['timestamp']);

  const data = new Date(carimbo ?? alternativa ?? '');
  return Number.isNaN(data.getTime()) ? new Date() : data;
}

function extrairDestinatario(
  bruto: Record<string, unknown>,
  tipo: TipoEvento,
  mail: Record<string, unknown> | null,
): string | null {
  // Bounce e reclamação trazem o destinatário na própria seção, e é esse que
  // interessa: é dele que veio o problema.
  if (tipo === 'BOUNCE') {
    const bounce = ehObjeto(bruto['bounce']) ? bruto['bounce'] : null;
    const lista = bounce === null ? null : bounce['bouncedRecipients'];
    const primeiro = Array.isArray(lista) && ehObjeto(lista[0]) ? lista[0] : null;
    const email = primeiro === null ? null : texto(primeiro['emailAddress']);
    if (email !== null) return email;
  }

  if (tipo === 'COMPLAINT') {
    const complaint = ehObjeto(bruto['complaint']) ? bruto['complaint'] : null;
    const lista = complaint === null ? null : complaint['complainedRecipients'];
    const primeiro = Array.isArray(lista) && ehObjeto(lista[0]) ? lista[0] : null;
    const email = primeiro === null ? null : texto(primeiro['emailAddress']);
    if (email !== null) return email;
  }

  const destinos = mail === null ? null : mail['destination'];
  return Array.isArray(destinos) && typeof destinos[0] === 'string' ? destinos[0] : null;
}

function extrairDiagnostico(bounce: Record<string, unknown> | null): string | null {
  if (bounce === null) return null;
  const lista = bounce['bouncedRecipients'];
  const primeiro = Array.isArray(lista) && ehObjeto(lista[0]) ? lista[0] : null;
  return primeiro === null ? null : texto(primeiro['diagnosticCode']);
}

/**
 * `Undetermined` é tratado como transitório de propósito.
 *
 * Suprimir por bounce indeterminado descartaria contatos válidos por um erro
 * que o próprio servidor de destino não soube classificar. O custo de errar
 * para o lado da supressão é permanente; o de não suprimir é uma tentativa a
 * mais na próxima campanha.
 */
function normalizarBounce(bruto: string | null): SubtipoBounce {
  if (bruto === 'Permanent') return 'Permanent';
  if (bruto === 'Transient') return 'Transient';
  return 'Undetermined';
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * O corpo que chega do SQS pode ser o evento direto (entrega bruta do SNS) ou o
 * envelope do SNS com o evento serializado em `Message`. Aceitar os dois evita
 * que uma mudança de configuração do tópico quebre o processamento.
 */
export function desembrulharMensagem(corpo: string): unknown {
  try {
    const analisado: unknown = JSON.parse(corpo);
    if (ehObjeto(analisado) && typeof analisado['Message'] === 'string') {
      try {
        return JSON.parse(analisado['Message']);
      } catch {
        return null;
      }
    }
    return analisado;
  } catch {
    return null;
  }
}
