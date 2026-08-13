import type {
  CampaignId,
  ContactId,
  FonteId,
  ListId,
  SendId,
  TenantId,
  TipoEmailId,
} from '@emailmkt/core';

/**
 * Chaves da tabela única — §6.3.
 *
 * Todo acesso ao DynamoDB passa por aqui. Montar chave à mão espalhada pelos
 * repositórios é como se erra em single-table design: uma concatenação
 * ligeiramente diferente e o item some sem erro nenhum — a consulta
 * simplesmente não retorna nada, e isso parece "lista vazia", não "bug".
 *
 * `tenantId` prefixa **toda** chave desde o dia 1 (§12, V3). Hoje existe um só
 * tenant; a alternativa seria reescrever todas as partition keys depois.
 */

export interface Chave {
  readonly pk: string;
  readonly sk: string;
}

const t = (tenantId: TenantId): string => `TENANT#${tenantId}`;

// ── Contato ──────────────────────────────────────────────────────────────────

export const chaveContato = (tenantId: TenantId, contactId: ContactId): Chave => ({
  pk: `${t(tenantId)}#CONTACT#${contactId}`,
  sk: 'META',
});

/** GSI1 — busca por e-mail. Indexa o hash, nunca o endereço em claro (§6.2). */
export const gsi1Email = (tenantId: TenantId, emailHash: string): Chave => ({
  pk: `${t(tenantId)}#EMAIL#${emailHash}`,
  sk: 'CONTACT',
});

/** GSI3 — contatos por status, para as telas de triagem. */
export const gsi3StatusContato = (
  tenantId: TenantId,
  status: string,
  contactId: ContactId,
): Chave => ({
  pk: `${t(tenantId)}#CONTACT_STATUS#${status}`,
  sk: String(contactId),
});

// ── Lista e associação ───────────────────────────────────────────────────────

export const chaveLista = (tenantId: TenantId, listId: ListId): Chave => ({
  pk: `${t(tenantId)}#LIST#${listId}`,
  sk: 'META',
});

export const chaveTipoEmail = (tenantId: TenantId, tipoEmailId: TipoEmailId): Chave => ({
  pk: `${t(tenantId)}#TIPO#${tipoEmailId}`,
  sk: 'META',
});

export const chaveFonteBoletim = (tenantId: TenantId, fonteId: FonteId): Chave => ({
  pk: `${t(tenantId)}#FONTE#${fonteId}`,
  sk: 'META',
});

export const chaveMembroLista = (
  tenantId: TenantId,
  listId: ListId,
  contactId: ContactId,
): Chave => ({
  pk: `${t(tenantId)}#LIST#${listId}`,
  sk: `MEMBER#${contactId}`,
});

export const PREFIXO_MEMBRO = 'MEMBER#';

/** GSI2 — invertido: em quais listas está um contato. */
export const gsi2ListasDoContato = (
  tenantId: TenantId,
  contactId: ContactId,
  listId: ListId,
): Chave => ({
  pk: `${t(tenantId)}#CONTACT#${contactId}`,
  sk: `LIST#${listId}`,
});

/**
 * GSI2 reaproveitado para os envios de um contato.
 *
 * O mesmo índice que responde "em quais listas este contato está" responde
 * "quais e-mails ele recebeu" — a partition key é a mesma, só muda o prefixo da
 * sort key. Criar um GSI dedicado custaria uma cópia inteira da tabela para
 * responder a uma pergunta que aparece algumas vezes por ano, quando um titular
 * exerce o direito de acesso.
 */
export const gsi2EnviosDoContato = (
  tenantId: TenantId,
  contactId: ContactId,
  campaignId: CampaignId,
  sendId: SendId,
): Chave => ({
  pk: `${t(tenantId)}#CONTACT#${contactId}`,
  sk: `SEND#${campaignId}#${sendId}`,
});

export const PREFIXO_ENVIO_DO_CONTATO = 'SEND#';

// ── Campanha ─────────────────────────────────────────────────────────────────

export const chaveCampanha = (tenantId: TenantId, campaignId: CampaignId): Chave => ({
  pk: `${t(tenantId)}#CAMPAIGN#${campaignId}`,
  sk: 'META',
});

/**
 * Métricas moram no mesmo item group da campanha, sob outra sort key. Isso
 * permite ler campanha e métricas numa única Query, que é o acesso da tela de
 * relatório (§5.7).
 */
export const chaveMetricas = (tenantId: TenantId, campaignId: CampaignId): Chave => ({
  pk: `${t(tenantId)}#CAMPAIGN#${campaignId}`,
  sk: 'METRICS',
});

/**
 * Ponto diário da série de engajamento — mesmo item group da campanha, como as
 * métricas. `SERIE#<AAAA-MM-DD>` ordena lexicograficamente = cronologicamente,
 * então a leitura da série é uma Query por prefixo, já em ordem.
 */
export const chaveSerie = (tenantId: TenantId, campaignId: CampaignId, dia: string): Chave => ({
  pk: `${t(tenantId)}#CAMPAIGN#${campaignId}`,
  sk: `SERIE#${dia}`,
});

export const PREFIXO_SERIE = 'SERIE#';

export const chaveEnvio = (tenantId: TenantId, campaignId: CampaignId, sendId: SendId): Chave => ({
  pk: `${t(tenantId)}#CAMPAIGN#${campaignId}`,
  sk: `SEND#${sendId}`,
});

export const PREFIXO_ENVIO = 'SEND#';

/** GSI3 — campanhas por status e data, para a listagem do painel. */
export const gsi3StatusCampanha = (tenantId: TenantId, status: string, quando: Date): Chave => ({
  pk: `${t(tenantId)}#CAMPAIGN_STATUS#${status}`,
  sk: quando.toISOString(),
});

/**
 * GSI4 — correlação de evento. O SES devolve apenas o messageId dele; sem este
 * índice não há como ligar um bounce ao contato e à campanha que o gerou.
 */
export const gsi4PorMessageId = (sesMessageId: string): Chave => ({
  pk: `MSG#${sesMessageId}`,
  sk: 'SEND',
});

// ── Evento de envio ──────────────────────────────────────────────────────────

export const chaveEvento = (
  tenantId: TenantId,
  sendId: SendId,
  ocorridoEm: Date,
  hashDedup: string,
): Chave => ({
  pk: `${t(tenantId)}#SEND#${sendId}`,
  sk: `EVT#${ocorridoEm.toISOString()}#${hashDedup}`,
});

// ── Supressão ────────────────────────────────────────────────────────────────

/**
 * Item próprio, acessado por GetItem — é o caminho mais quente do launcher, que
 * consulta milhares por campanha (§6.3, padrão 11).
 */
export const chaveSupressao = (tenantId: TenantId, emailHash: string): Chave => ({
  pk: `${t(tenantId)}#SUPPRESS#${emailHash}`,
  sk: 'SUPPRESS',
});

// ── Template ─────────────────────────────────────────────────────────────────

export const chaveTemplate = (tenantId: TenantId, templateId: string, versao: number): Chave => ({
  pk: `${t(tenantId)}#TEMPLATE#${templateId}`,
  // Zero-pad para a ordenação lexicográfica do DynamoDB coincidir com a
  // numérica: sem isso, a versão 10 viria antes da 9.
  sk: `V#${String(versao).padStart(6, '0')}`,
});

export const chaveTemplateMeta = (tenantId: TenantId, templateId: string): Chave => ({
  pk: `${t(tenantId)}#TEMPLATE#${templateId}`,
  sk: 'META',
});

export const PREFIXO_VERSAO_TEMPLATE = 'V#';

// ── Auditoria ────────────────────────────────────────────────────────────────

/**
 * Particionada por mês: mantém a partição pequena e torna a consulta "o que
 * aconteceu em agosto" uma Query direta em vez de um Scan.
 */
export const chaveAuditoria = (tenantId: TenantId, ocorridoEm: Date, auditId: string): Chave => {
  const mes = ocorridoEm.toISOString().slice(0, 7); // YYYY-MM
  return {
    pk: `${t(tenantId)}#AUDIT#${mes}`,
    sk: `${ocorridoEm.toISOString()}#${auditId}`,
  };
};

// ── Cursor de paginação ──────────────────────────────────────────────────────

/**
 * O LastEvaluatedKey do DynamoDB é um objeto; a API precisa de uma string
 * opaca. Base64 de JSON, sem criptografia: a chave não carrega segredo, apenas
 * posição — e quem já pode paginar a lista já pode ver os itens.
 */
export const codificarCursor = (chave: Record<string, unknown> | undefined): string | undefined =>
  chave === undefined
    ? undefined
    : Buffer.from(JSON.stringify(chave), 'utf8').toString('base64url');

export function decodificarCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const valor: unknown = JSON.parse(json);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return undefined;
    return valor as Record<string, unknown>;
  } catch {
    // Cursor corrompido ou forjado: recomeçar do início é melhor que estourar
    // erro numa listagem. Não há risco — a chave não concede acesso a nada.
    return undefined;
  }
}
