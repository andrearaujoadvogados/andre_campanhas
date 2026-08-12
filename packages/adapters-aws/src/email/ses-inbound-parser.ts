import {
  campanhaDoEnderecoDeResposta,
  extrairEndereco,
  messageIdDoSes,
  type RespostaRecebida,
  type TenantId,
} from '@emailmkt/core';

/**
 * Anti-corruption layer sobre a **regra de recebimento** do SES — §5.10, §1.4.
 *
 * Irmão do `ses-event-parser`, e separado dele de propósito: o payload de um
 * e-mail que chega não tem nada a ver com o de um evento de envio. Um traz
 * `eventType` e uma seção por tipo; o outro traz a mensagem inteira, com
 * cabeçalhos RFC 5322 crus. Juntar os dois num tradutor só produziria uma
 * função com dois modos que não compartilham uma linha.
 *
 * Como o `ses-event-parser`, nada aqui lança: formato inesperado vira `null` e
 * a mensagem vai para a DLQ, onde alguém olha.
 */

/** Marca que o `reply-receiver` põe no envelope antes de atravessar as regiões. */
export const MARCA_RESPOSTA = 'RESPOSTA_RECEBIDA';

export function traduzirRespostaRecebida(
  bruto: unknown,
  tenantId: TenantId,
): RespostaRecebida | null {
  if (!ehObjeto(bruto) || bruto['tipoInterno'] !== MARCA_RESPOSTA) return null;

  const ses = ehObjeto(bruto['ses']) ? bruto['ses'] : null;
  const mail = ses !== null && ehObjeto(ses['mail']) ? ses['mail'] : null;
  if (mail === null) return null;

  /**
   * `source` é o remetente do **envelope** (MAIL FROM), não o do cabeçalho.
   *
   * Os dois quase sempre coincidem, mas quando divergem o que identifica a
   * pessoa é o `From:` — o envelope pode ser o servidor de encaminhamento.
   * Preferir o cabeçalho e cair no envelope só na falta dele é o que faz a
   * busca por contato encontrar quem realmente escreveu.
   */
  const cabecalhos = lerCabecalhos(mail);
  const deEmail =
    primeiroEndereco(cabecalhos['from']) ?? texto(mail['source'])?.toLowerCase() ?? null;
  if (deEmail === null) return null;

  /**
   * O Message-ID da mensagem recebida é a chave de deduplicação.
   *
   * O SES entrega pelo menos uma vez, como todo o resto do caminho. Sem chave
   * estável, uma reentrega contaria como resposta nova — e o `messageId` que o
   * SES atribui ao recebimento serve de alternativa quando o remetente não
   * mandou Message-ID (raro, mas acontece com formulário automatizado).
   */
  const idMensagem = cabecalhos['message-id'] ?? texto(mail['messageId']);
  if (idMensagem === null) return null;

  const destinos = lista(mail['destination']);
  const recibo = ses !== null && ehObjeto(ses['receipt']) ? ses['receipt'] : null;
  const recebedores = recibo === null ? [] : lista(recibo['recipients']);
  const marca = campanhaDoEnderecoDeResposta([...destinos, ...recebedores]);

  // `References` acumula a thread inteira e sobrevive melhor a encaminhamento;
  // `In-Reply-To` é o mais direto. Tentar os dois cobre mais clientes.
  const thread = `${cabecalhos['in-reply-to'] ?? ''} ${cabecalhos['references'] ?? ''}`;
  const sesMessageIdOriginal = messageIdDoSes(thread);

  return {
    tenantId,
    deEmail,
    idMensagemRecebida: idMensagem,
    recebidoEm: instante(texto(mail['timestamp'])),
    ...(marca === null ? {} : { campaignIdMarcado: marca }),
    ...(sesMessageIdOriginal === null ? {} : { sesMessageIdOriginal }),
  };
}

/**
 * Achata `headers: [{name, value}]` num mapa de nome minúsculo → valor.
 *
 * Nomes de cabeçalho são insensíveis a caixa pela RFC 5322, e os clientes usam
 * de tudo: `In-Reply-To`, `In-reply-to`, `IN-REPLY-TO`. Comparar sem normalizar
 * faria a correlação depender de qual programa a pessoa usa para responder.
 *
 * Repetido fica o **primeiro**, que é o que o servidor de destino considera.
 */
function lerCabecalhos(mail: Record<string, unknown>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const entrada of itens(mail['headers'])) {
    if (!ehObjeto(entrada)) continue;
    const nome = texto(entrada['name'])?.toLowerCase();
    const valor = texto(entrada['value']);
    if (nome === undefined || nome === null || valor === null) continue;
    saida[nome] ??= valor;
  }
  return saida;
}

/** `"Fulano" <a@b>, c@d` → `a@b`. Só o primeiro: `From:` com dois é patológico. */
function primeiroEndereco(cabecalho: string | undefined): string | null {
  if (cabecalho === undefined) return null;
  const primeiro = cabecalho.split(',')[0];
  if (primeiro === undefined) return null;
  const endereco = extrairEndereco(primeiro);
  return endereco.includes('@') ? endereco : null;
}

function instante(bruto: string | null): Date {
  const data = new Date(bruto ?? '');
  return Number.isNaN(data.getTime()) ? new Date() : data;
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function itens(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
