import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  listId as novoListId,
  rotinaId as novoRotinaId,
  tenantId as novoTenantId,
  userId as novoUserId,
  type PeriodicidadeRotina,
  type RotinaBoletim,
  type RotinaBoletimRepository,
  type RotinaId,
  type TenantId,
} from '@emailmkt/core';
import { chaveRotinaBoletim } from '../keys.js';

/**
 * Rotinas de envio do boletim — mesmo desenho das fontes: poucas por tenant,
 * listagem numa partição própria do GSI3, ordenada pela criação.
 */
export class DynamoRotinaBoletimRepository implements RotinaBoletimRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(tenantId: TenantId, rotinaId: RotinaId): Promise<RotinaBoletim | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveRotinaBoletim(tenantId, rotinaId) }),
    );
    return r.Item === undefined ? null : paraRotina(r.Item);
  }

  async listar(tenantId: TenantId): Promise<readonly RotinaBoletim[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}#ROTINAS_BOLETIM` },
        Limit: 100,
      }),
    );
    return (r.Items ?? []).map(paraRotina);
  }

  async salvar(rotina: RotinaBoletim): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chaveRotinaBoletim(rotina.tenantId, rotina.rotinaId),
          tipo: 'ROTINA_BOLETIM',
          tenantId: String(rotina.tenantId),
          rotinaId: String(rotina.rotinaId),
          periodicidade: rotina.periodicidade,
          horario: rotina.horario,
          ...(rotina.diaDaSemana === undefined ? {} : { diaDaSemana: rotina.diaDaSemana }),
          ...(rotina.diaDoMes === undefined ? {} : { diaDoMes: rotina.diaDoMes }),
          listId: String(rotina.listId),
          ativa: rotina.ativa,
          criadoPor: String(rotina.criadoPor),
          criadoEm: rotina.criadoEm.toISOString(),
          atualizadoEm: rotina.atualizadoEm.toISOString(),
          gsi3pk: `TENANT#${rotina.tenantId}#ROTINAS_BOLETIM`,
          gsi3sk: rotina.criadoEm.toISOString(),
        },
      }),
    );
  }

  async excluir(tenantId: TenantId, rotinaId: RotinaId): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveRotinaBoletim(tenantId, rotinaId) }),
    );
  }
}

function paraRotina(item: Record<string, unknown>): RotinaBoletim {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    rotinaId: novoRotinaId(String(item['rotinaId'])),
    periodicidade: String(item['periodicidade']) as PeriodicidadeRotina,
    horario: String(item['horario']),
    ...(item['diaDaSemana'] === undefined ? {} : { diaDaSemana: Number(item['diaDaSemana']) }),
    ...(item['diaDoMes'] === undefined ? {} : { diaDoMes: Number(item['diaDoMes']) }),
    listId: novoListId(String(item['listId'])),
    ativa: item['ativa'] === true,
    criadoPor: novoUserId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
  };
}
