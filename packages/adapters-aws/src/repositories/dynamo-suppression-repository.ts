import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { SuppressionEntry, SuppressionRepository, TenantId } from '@emailmkt/core';
import { chaveSupressao } from '../keys.js';

const LIMITE_BATCH_GET = 100;

export class DynamoSuppressionRepository implements SuppressionRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async estaSuprimido(tenantId: TenantId, emailHash: string): Promise<boolean> {
    const r = await this.doc.send(
      new GetCommand({
        TableName: this.tabela,
        Key: chaveSupressao(tenantId, emailHash),
        ProjectionExpression: 'pk',
      }),
    );
    return r.Item !== undefined;
  }

  /**
   * Consulta em lote — o caminho quente do launcher (§6.3, padrão 11).
   *
   * Um GetItem por contato numa lista de 5.000 seriam 5.000 idas ao banco. Em
   * lotes de 100 são 50. A diferença aparece no tempo de preparar a campanha.
   *
   * Falha aqui **não** pode ser tratada como "não está suprimido": isso mandaria
   * e-mail para quem pediu para sair. Por isso o erro sobe em vez de degradar.
   */
  async filtrarSuprimidos(
    tenantId: TenantId,
    emailHashes: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const suprimidos = new Set<string>();
    const unicos = [...new Set(emailHashes)];

    for (let i = 0; i < unicos.length; i += LIMITE_BATCH_GET) {
      let chaves = unicos.slice(i, i + LIMITE_BATCH_GET).map((h) => chaveSupressao(tenantId, h));

      for (let tentativa = 0; tentativa < 5 && chaves.length > 0; tentativa++) {
        const r = await this.doc.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tabela]: { Keys: chaves, ProjectionExpression: 'emailHash' },
            },
          }),
        );
        for (const item of r.Responses?.[this.tabela] ?? []) {
          suprimidos.add(String(item['emailHash']));
        }
        chaves = (r.UnprocessedKeys?.[this.tabela]?.Keys ?? []) as typeof chaves;
        if (chaves.length > 0) await esperar(2 ** tentativa * 50);
      }

      if (chaves.length > 0) {
        throw new Error(
          `Não foi possível verificar a supressão de ${chaves.length} contatos. ` +
            'Abortando: enviar sem essa verificação atingiria quem pediu para sair.',
        );
      }
    }

    return suprimidos;
  }

  async suprimir(entrada: SuppressionEntry): Promise<void> {
    const chave = chaveSupressao(entrada.tenantId, entrada.emailHash);
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chave,
          tipo: 'SUPPRESSION',
          tenantId: String(entrada.tenantId),
          emailHash: entrada.emailHash,
          motivo: entrada.motivo,
          suprimidoEm: entrada.suprimidoEm.toISOString(),
          origem: entrada.origem,
        },
        // Sem condição de "só se não existir": suprimir de novo é idempotente e
        // o motivo mais recente é o que interessa. Um hard bounce depois de um
        // descadastro não deve falhar.
      }),
    );
  }

  async remover(tenantId: TenantId, emailHash: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveSupressao(tenantId, emailHash) }),
    );
  }
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
