import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type {
  Campaign,
  CampaignId,
  CampaignRepository,
  FiltroCampanhas,
  ListagemCampanhas,
  TenantId,
} from '@emailmkt/core';
import { chaveCampanha, codificarCursor, decodificarCursor, gsi3StatusCampanha } from '../keys.js';
import { campanhaParaItem, itemParaCampanha } from '../mappers/campaign-mapper.js';

const STATUS_TODOS: readonly Campaign['status'][] = [
  'RASCUNHO',
  'EM_REVISAO',
  'APROVADA',
  'AGENDADA',
  'ENVIANDO',
  'PAUSADA',
  'CONCLUIDA',
  'CANCELADA',
];

const ordenacao = (c: Campaign): number => (c.agendadaPara ?? c.criadoEm).getTime();

export class DynamoCampaignRepository implements CampaignRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(tenantId: TenantId, id: CampaignId): Promise<Campaign | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveCampanha(tenantId, id) }),
    );
    return r.Item === undefined ? null : itemParaCampanha(r.Item);
  }

  async salvar(campanha: Campaign): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.tabela, Item: campanhaParaItem(campanha) }),
    );
  }

  /**
   * Lista campanhas.
   *
   * Com filtro de status, é uma Query numa partição só, com cursor real. Sem
   * filtro, varre as oito partições em paralelo e mescla — ver
   * `ListagemCampanhas.truncado` para o porquê de não haver cursor nesse caso.
   */
  async listar(tenantId: TenantId, filtro: FiltroCampanhas): Promise<ListagemCampanhas> {
    if (filtro.status !== undefined) {
      const r = await this.consultarStatus(tenantId, filtro.status, filtro.limite, filtro.cursor);
      const proximo = codificarCursor(r.LastEvaluatedKey);
      return {
        itens: (r.Items ?? []).map(itemParaCampanha),
        ...(proximo === undefined ? {} : { cursor: proximo }),
        truncado: false,
      };
    }

    const paginas = await Promise.all(
      STATUS_TODOS.map((status) => this.consultarStatus(tenantId, status, filtro.limite)),
    );

    const itens = paginas
      .flatMap((p) => (p.Items ?? []).map(itemParaCampanha))
      // Mais recentes primeiro. A data usada é a mesma da sort key do índice:
      // agendamento quando existe, criação caso contrário.
      .sort((a, b) => ordenacao(b) - ordenacao(a));

    // Se alguma partição encheu, há campanhas fora do resultado.
    const truncado = paginas.some((p) => p.LastEvaluatedKey !== undefined);

    return { itens: itens.slice(0, filtro.limite), truncado };
  }

  private async consultarStatus(
    tenantId: TenantId,
    status: Campaign['status'],
    limite: number,
    cursor?: string,
  ) {
    const chave = gsi3StatusCampanha(tenantId, status, new Date(0));
    return this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': chave.pk },
        // Sort key é a data em ISO; descendente traz as mais recentes primeiro
        // sem ordenar nada na aplicação.
        ScanIndexForward: false,
        Limit: limite,
        ExclusiveStartKey: decodificarCursor(cursor),
      }),
    );
  }

  /**
   * Leitura enxuta do status — o `sender` consulta uma vez por lote (ADR-05).
   *
   * `ProjectionExpression` reduz a unidade de leitura consumida e, mais
   * importante, evita trazer o item inteiro milhares de vezes durante um
   * disparo. `ConsistentRead` porque o ponto todo desta consulta é reagir a uma
   * pausa que o operador acabou de acionar: leitura eventual poderia continuar
   * disparando por alguns segundos depois do clique.
   */
  async lerStatus(tenantId: TenantId, id: CampaignId): Promise<Campaign['status'] | null> {
    const r = await this.doc.send(
      new GetCommand({
        TableName: this.tabela,
        Key: chaveCampanha(tenantId, id),
        ProjectionExpression: '#s',
        ExpressionAttributeNames: { '#s': 'status' },
        ConsistentRead: true,
      }),
    );
    return r.Item === undefined ? null : (String(r.Item['status']) as Campaign['status']);
  }
}
