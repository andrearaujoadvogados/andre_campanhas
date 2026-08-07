import type { ListId, TenantId, UserId } from '../shared/ids.js';

/**
 * Lista de contatos — §11, item 1.
 *
 * No MVP só existe lista estática: o operador escolhe quem entra. A lista
 * dinâmica (§12, V2) reaproveita a mesma entidade guardando as regras de
 * segmento — por isso o campo já existe no tipo, mesmo sem uso hoje.
 *
 * `totalContatos` é um contador mantido junto da lista, não um `COUNT`. Contar
 * membros a cada abertura de tela significaria varrer a partição inteira; com
 * milhares de contatos, a listagem de listas ficaria lenta por um número que só
 * serve de referência.
 */
export type TipoLista = 'ESTATICA' | 'DINAMICA';

export interface Lista {
  readonly tenantId: TenantId;
  readonly listId: ListId;
  readonly nome: string;
  readonly descricao?: string;
  readonly tipo: TipoLista;
  /** Aproximado por desenho — ver acima. */
  readonly totalContatos: number;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
}
