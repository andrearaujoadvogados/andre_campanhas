import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  tenantId as novoTenantId,
  type EventRepository,
  type EventoEnvio,
  type SendId,
  type TenantId,
} from '@emailmkt/core';
import { chaveEvento } from '../keys.js';

/**
 * Eventos de envio persistidos — §6.1, §10.2.
 *
 * Particionados por envio (`SEND#sendId`), não por campanha: a consulta que
 * importa é "o histórico deste e-mail específico", tanto para o dossiê de
 * portabilidade quanto para investigar uma entrega. Por campanha, a partição
 * cresceria para dezenas de milhares de itens e a consulta do titular teria de
 * filtrar tudo isso na aplicação.
 */
export class DynamoEventRepository implements EventRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async salvar(evento: EventoEnvio, sendId: SendId, ttlEpochSegundos: number): Promise<void> {
    const chave = chaveEvento(evento.tenantId, sendId, evento.ocorridoEm, hashCurto(evento));

    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chave,
          tipo: 'SEND_EVENT',
          tenantId: String(evento.tenantId),
          sendId: String(sendId),
          sesMessageId: evento.sesMessageId,
          tipoEvento: evento.tipo,
          ocorridoEm: evento.ocorridoEm.toISOString(),
          subtipoBounce: evento.subtipoBounce,
          urlClicada: evento.urlClicada,
          diagnostico: evento.diagnostico,
          // O TTL apaga sozinho aos 13 meses. Retenção prometida em documento e
          // não implementada é retenção indefinida na prática.
          ttl: ttlEpochSegundos,
        },
      }),
    );
  }

  async listarPorEnvio(tenantId: TenantId, sendId: SendId): Promise<readonly EventoEnvio[]> {
    const chave = chaveEvento(tenantId, sendId, new Date(0), '');
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
        ExpressionAttributeValues: { ':pk': chave.pk, ':prefixo': 'EVT#' },
      }),
    );

    return (r.Items ?? []).map((item) => ({
      tenantId: novoTenantId(String(item['tenantId'])),
      sesMessageId: String(item['sesMessageId']),
      tipo: String(item['tipoEvento']) as EventoEnvio['tipo'],
      ocorridoEm: new Date(String(item['ocorridoEm'])),
      ...(item['subtipoBounce'] === undefined
        ? {}
        : {
            subtipoBounce: String(item['subtipoBounce']) as NonNullable<
              EventoEnvio['subtipoBounce']
            >,
          }),
      ...(item['urlClicada'] === undefined ? {} : { urlClicada: String(item['urlClicada']) }),
      ...(item['diagnostico'] === undefined ? {} : { diagnostico: String(item['diagnostico']) }),
    }));
  }
}

/**
 * Desempata eventos do mesmo tipo no mesmo instante — dois cliques simultâneos
 * em links diferentes, por exemplo. Sem isto, o segundo sobrescreveria o
 * primeiro em silêncio.
 */
function hashCurto(evento: EventoEnvio): string {
  const material = `${evento.tipo}|${evento.urlClicada ?? ''}`;
  let h = 0;
  for (let i = 0; i < material.length; i++) {
    h = (h * 31 + material.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).padStart(7, '0').slice(0, 7);
}
