import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AuditLogger, EventoAuditoria, IdGenerator } from '@emailmkt/core';
import { chaveAuditoria } from '../keys.js';

/**
 * Log de auditoria — §11, item 10.
 *
 * Append-only por construção: só existe `Put` com condição de chave inexistente,
 * e não há método de update nem de delete. A API não expõe caminho para alterar
 * um registro; a permissão IAM da Lambda também não concede `DeleteItem` sobre
 * estes itens no desenho final.
 *
 * O `ConditionExpression` protege contra sobrescrita acidental por colisão de
 * timestamp + id. Não é defesa contra adulteração deliberada por quem tem acesso
 * à conta AWS — para isso a resposta é CloudTrail e separação de contas, não
 * código de aplicação.
 */
export class DynamoAuditLogger implements AuditLogger {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
    private readonly ids: IdGenerator,
  ) {}

  async registrar(evento: EventoAuditoria): Promise<void> {
    const auditId = this.ids.gerar();
    const chave = chaveAuditoria(evento.tenantId, evento.ocorridoEm, auditId);

    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chave,
          tipo: 'AUDIT',
          auditId,
          tenantId: String(evento.tenantId),
          userId: String(evento.userId),
          acao: evento.acao,
          recursoTipo: evento.recursoTipo,
          recursoId: evento.recursoId,
          antes: evento.antes,
          depois: evento.depois,
          ipOrigem: evento.ipOrigem,
          ocorridoEm: evento.ocorridoEm.toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }
}
