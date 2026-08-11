import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  tenantId as novoTenantId,
  tipoEmailId as novoTipoEmailId,
  userId as novoUserId,
  type TenantId,
  type TipoEmail,
  type TipoEmailId,
  type TipoEmailRepository,
} from '@emailmkt/core';
import { chaveTipoEmail } from '../keys.js';

/**
 * Catálogo de tipos de e-mail — poucos por tenant, então listar é uma Query
 * numa partição só do GSI3 (o mesmo índice das listas e templates).
 */
export class DynamoTipoEmailRepository implements TipoEmailRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(tenantId: TenantId, tipoEmailId: TipoEmailId): Promise<TipoEmail | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveTipoEmail(tenantId, tipoEmailId) }),
    );
    return r.Item === undefined ? null : paraTipo(r.Item);
  }

  async listar(tenantId: TenantId): Promise<readonly TipoEmail[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}#TIPOS` },
        Limit: 100,
      }),
    );
    return (r.Items ?? []).map(paraTipo);
  }

  async salvar(tipo: TipoEmail): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chaveTipoEmail(tipo.tenantId, tipo.tipoEmailId),
          tipo: 'TIPO_EMAIL',
          tenantId: String(tipo.tenantId),
          tipoEmailId: String(tipo.tipoEmailId),
          nome: tipo.nome,
          criadoPor: String(tipo.criadoPor),
          criadoEm: tipo.criadoEm.toISOString(),
          atualizadoEm: tipo.atualizadoEm.toISOString(),
          gsi3pk: `TENANT#${tipo.tenantId}#TIPOS`,
          gsi3sk: tipo.nome.toLowerCase(),
        },
      }),
    );
  }

  async excluir(tenantId: TenantId, tipoEmailId: TipoEmailId): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveTipoEmail(tenantId, tipoEmailId) }),
    );
  }
}

function paraTipo(item: Record<string, unknown>): TipoEmail {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    tipoEmailId: novoTipoEmailId(String(item['tipoEmailId'])),
    nome: String(item['nome']),
    criadoPor: novoUserId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
  };
}
