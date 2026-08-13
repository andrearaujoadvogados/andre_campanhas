import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  fonteId as novoFonteId,
  tenantId as novoTenantId,
  userId as novoUserId,
  type FonteBoletim,
  type FonteBoletimRepository,
  type FonteId,
  type TenantId,
} from '@emailmkt/core';
import { chaveFonteBoletim } from '../keys.js';

/**
 * Fontes do boletim — mesmo desenho do catálogo de tipos: poucas por tenant,
 * listagem numa partição própria do GSI3, ordenada pelo nome.
 */
export class DynamoFonteBoletimRepository implements FonteBoletimRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(tenantId: TenantId, fonteId: FonteId): Promise<FonteBoletim | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveFonteBoletim(tenantId, fonteId) }),
    );
    return r.Item === undefined ? null : paraFonte(r.Item);
  }

  async listar(tenantId: TenantId): Promise<readonly FonteBoletim[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}#FONTES` },
        Limit: 100,
      }),
    );
    return (r.Items ?? []).map(paraFonte);
  }

  async salvar(fonte: FonteBoletim): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chaveFonteBoletim(fonte.tenantId, fonte.fonteId),
          tipo: 'FONTE_BOLETIM',
          tenantId: String(fonte.tenantId),
          fonteId: String(fonte.fonteId),
          nome: fonte.nome,
          url: fonte.url,
          instrucao: fonte.instrucao,
          ativa: fonte.ativa,
          criadoPor: String(fonte.criadoPor),
          criadoEm: fonte.criadoEm.toISOString(),
          atualizadoEm: fonte.atualizadoEm.toISOString(),
          gsi3pk: `TENANT#${fonte.tenantId}#FONTES`,
          gsi3sk: fonte.nome.toLowerCase(),
        },
      }),
    );
  }

  async excluir(tenantId: TenantId, fonteId: FonteId): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveFonteBoletim(tenantId, fonteId) }),
    );
  }
}

function paraFonte(item: Record<string, unknown>): FonteBoletim {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    fonteId: novoFonteId(String(item['fonteId'])),
    nome: String(item['nome']),
    url: String(item['url']),
    instrucao: String(item['instrucao']),
    ativa: item['ativa'] === true,
    criadoPor: novoUserId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
  };
}
