/**
 * Identificadores tipados. `string` para tudo convida a passar um campaignId
 * onde se espera um contactId — o compilador não reclama e o bug aparece em
 * produção. O custo aqui é uma linha por tipo.
 */
declare const marca: unique symbol;
type Marcado<T, M extends string> = T & { readonly [marca]: M };

export type TenantId = Marcado<string, 'TenantId'>;
export type ContactId = Marcado<string, 'ContactId'>;
export type CampaignId = Marcado<string, 'CampaignId'>;
export type TemplateId = Marcado<string, 'TemplateId'>;
export type ListId = Marcado<string, 'ListId'>;
export type UserId = Marcado<string, 'UserId'>;
export type SendId = Marcado<string, 'SendId'>;
export type TipoEmailId = Marcado<string, 'TipoEmailId'>;
export type FonteId = Marcado<string, 'FonteId'>;
export type ExecucaoBoletimId = Marcado<string, 'ExecucaoBoletimId'>;
export type RotinaId = Marcado<string, 'RotinaId'>;

export const tenantId = (v: string): TenantId => v as TenantId;
export const contactId = (v: string): ContactId => v as ContactId;
export const campaignId = (v: string): CampaignId => v as CampaignId;
export const templateId = (v: string): TemplateId => v as TemplateId;
export const listId = (v: string): ListId => v as ListId;
export const userId = (v: string): UserId => v as UserId;
export const sendId = (v: string): SendId => v as SendId;
export const tipoEmailId = (v: string): TipoEmailId => v as TipoEmailId;
export const fonteId = (v: string): FonteId => v as FonteId;
export const execucaoBoletimId = (v: string): ExecucaoBoletimId => v as ExecucaoBoletimId;
export const rotinaId = (v: string): RotinaId => v as RotinaId;

/**
 * Tenant único hoje — §12, V3. O campo existe em toda chave desde o dia 1
 * porque adicioná-lo depois significaria reescrever todas as partition keys.
 */
export const TENANT_PADRAO: TenantId = tenantId('andrearaujo');
