import type { TenantId, TipoEmailId, UserId } from '../shared/ids.js';

/**
 * Tipo de e-mail — a taxonomia que o escritório gerencia (Boletim, Comunicado,
 * Convite…). "Boletim" é um dos tipos, não o nome do item.
 *
 * É um catálogo por tenant, com CRUD próprio. A campanha guarda o `tipoEmailId`;
 * a interface resolve o nome pelo catálogo, então renomear um tipo reflete em
 * todos os e-mails que o usam, sem tocar em cada um.
 */
export interface TipoEmail {
  readonly tenantId: TenantId;
  readonly tipoEmailId: TipoEmailId;
  readonly nome: string;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
}

/** Nome do tipo semeado quando o catálogo está vazio. */
export const TIPO_EMAIL_PADRAO = 'Boletim';
