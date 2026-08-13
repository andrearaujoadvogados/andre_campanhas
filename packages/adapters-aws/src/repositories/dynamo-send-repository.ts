import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  campaignId as novoCampaignId,
  contactId as novoContactId,
  sendId as novoSendId,
  tenantId as novoTenantId,
  type CampaignId,
  type CampoDaSerie,
  type CampoMetrica,
  type Envio,
  type MetricsRepository,
  type PontoDaSerie,
  type ContactId,
  type SendId,
  type SendRepository,
  type TenantId,
} from '@emailmkt/core';
import {
  PREFIXO_ENVIO,
  PREFIXO_ENVIO_DO_CONTATO,
  PREFIXO_SERIE,
  chaveEnvio,
  chaveMetricas,
  chaveSerie,
  codificarCursor,
  decodificarCursor,
  gsi2EnviosDoContato,
  gsi4PorMessageId,
} from '../keys.js';

export class DynamoSendRepository implements SendRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(
    tenantId: TenantId,
    campaignId: CampaignId,
    sendId: SendId,
  ): Promise<Envio | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveEnvio(tenantId, campaignId, sendId) }),
    );
    return r.Item === undefined ? null : paraEnvio(r.Item);
  }

  /**
   * Correlação de evento — §6.3, GSI4.
   *
   * O SES devolve só o messageId dele. Sem este índice, ligar um bounce ao
   * contato e à campanha exigiria varrer a tabela.
   */
  async buscarPorMessageId(sesMessageId: string): Promise<Envio | null> {
    const chave = gsi4PorMessageId(sesMessageId);
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi4',
        KeyConditionExpression: 'gsi4pk = :pk AND gsi4sk = :sk',
        ExpressionAttributeValues: { ':pk': chave.pk, ':sk': chave.sk },
        Limit: 1,
      }),
    );
    const item = r.Items?.[0];
    return item === undefined ? null : paraEnvio(item);
  }

  /**
   * Conta registros de envio da campanha.
   *
   * `Select: COUNT` não devolve os itens, só o número — a leitura é cobrada pelo
   * tamanho dos dados varridos, mas nada trafega. Numa campanha de 5.000
   * destinatários, trazer os itens a cada verificação do orquestrador seria
   * megabytes por minuto para descobrir um inteiro.
   *
   * Pagina porque o DynamoDB corta a Query em 1 MB de dados examinados, mesmo
   * contando: sem o laço, campanhas grandes devolveriam um número menor que o
   * real e o disparo pareceria travado para sempre.
   */
  async contarPorCampanha(tenantId: TenantId, campaignId: CampaignId): Promise<number> {
    const chave = chaveEnvio(tenantId, campaignId, '' as SendId);
    let total = 0;
    let cursor: Record<string, unknown> | undefined;

    do {
      const r: {
        Count?: number | undefined;
        LastEvaluatedKey?: Record<string, unknown> | undefined;
      } = await this.doc.send(
        new QueryCommand({
          TableName: this.tabela,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
          ExpressionAttributeValues: { ':pk': chave.pk, ':prefixo': PREFIXO_ENVIO },
          Select: 'COUNT',
          ExclusiveStartKey: cursor,
        }),
      );
      total += r.Count ?? 0;
      cursor = r.LastEvaluatedKey;
    } while (cursor !== undefined);

    return total;
  }

  /**
   * Página de envios da campanha — o relatório por destinatário.
   *
   * Mesma partição que o `contarPorCampanha`, mas trazendo os itens. Paginado (50
   * por vez) porque uma campanha pode ter milhares de destinatários e a tela os
   * mostra aos poucos, com busca e filtro no cliente.
   */
  async listarPorCampanha(
    tenantId: TenantId,
    campaignId: CampaignId,
    cursor?: string,
  ): Promise<{ itens: readonly Envio[]; cursor?: string }> {
    const chave = chaveEnvio(tenantId, campaignId, '' as SendId);
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
        ExpressionAttributeValues: { ':pk': chave.pk, ':prefixo': PREFIXO_ENVIO },
        Limit: 50,
        ExclusiveStartKey: decodificarCursor(cursor),
      }),
    );
    const itens = (r.Items ?? []).map(paraEnvio);
    const proximo = codificarCursor(r.LastEvaluatedKey);
    return proximo === undefined ? { itens } : { itens, cursor: proximo };
  }

  /**
   * Só os envios que receberam resposta — "quem respondeu" no relatório.
   *
   * Mesma partição da listagem por campanha, com `FilterExpression`. O filtro do
   * DynamoDB roda **depois** da leitura: não economiza capacidade, economiza
   * tráfego e paginação na interface. Como resposta é rara, o `Limit` aqui é
   * maior que o dos destinatários — o limite corta itens *lidos*, não itens
   * *retornados*, então um `Limit` baixo devolveria páginas quase sempre vazias
   * e a interface faria dezenas de idas ao servidor para montar uma lista curta.
   *
   * Uma página vazia com cursor é normal e não significa fim: quem chama segue
   * o cursor até ele desaparecer.
   */
  async listarRespondentes(
    tenantId: TenantId,
    campaignId: CampaignId,
    cursor?: string,
  ): Promise<{ itens: readonly Envio[]; cursor?: string }> {
    const chave = chaveEnvio(tenantId, campaignId, '' as SendId);
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
        FilterExpression: 'attribute_exists(respondidoEm)',
        ExpressionAttributeValues: { ':pk': chave.pk, ':prefixo': PREFIXO_ENVIO },
        Limit: 500,
        ExclusiveStartKey: decodificarCursor(cursor),
      }),
    );
    const itens = (r.Items ?? []).map(paraEnvio);
    const proximo = codificarCursor(r.LastEvaluatedKey);
    return proximo === undefined ? { itens } : { itens, cursor: proximo };
  }

  /**
   * Envios feitos a um contato — o insumo do dossiê de portabilidade.
   *
   * Usa o GSI2, o mesmo índice das listas do contato: a partition key já é
   * `CONTACT#id`, e o prefixo `SEND#` na sort key separa as duas coisas. Um GSI
   * dedicado custaria uma cópia da tabela para uma pergunta que aparece algumas
   * vezes por ano.
   */
  async listarPorContato(tenantId: TenantId, contactId: ContactId): Promise<readonly Envio[]> {
    const chave = gsi2EnviosDoContato(tenantId, contactId, '' as CampaignId, '' as SendId);
    const encontrados: Envio[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const r: {
        Items?: Record<string, unknown>[] | undefined;
        LastEvaluatedKey?: Record<string, unknown> | undefined;
      } = await this.doc.send(
        new QueryCommand({
          TableName: this.tabela,
          IndexName: 'gsi2',
          KeyConditionExpression: 'gsi2pk = :pk AND begins_with(gsi2sk, :prefixo)',
          ExpressionAttributeValues: {
            ':pk': chave.pk,
            ':prefixo': PREFIXO_ENVIO_DO_CONTATO,
          },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of r.Items ?? []) encontrados.push(paraEnvio(item));
      cursor = r.LastEvaluatedKey;
    } while (cursor !== undefined);

    return encontrados;
  }

  async salvar(envio: Envio): Promise<void> {
    const chave = chaveEnvio(envio.tenantId, envio.campaignId, envio.sendId);
    const g4 = envio.sesMessageId === undefined ? undefined : gsi4PorMessageId(envio.sesMessageId);
    const g2 = gsi2EnviosDoContato(envio.tenantId, envio.contactId, envio.campaignId, envio.sendId);

    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chave,
          tipo: 'SEND',
          tenantId: String(envio.tenantId),
          sendId: String(envio.sendId),
          campaignId: String(envio.campaignId),
          contactId: String(envio.contactId),
          status: envio.status,
          sesMessageId: envio.sesMessageId,
          enviadoEm: envio.enviadoEm?.toISOString(),
          falhaMotivo: envio.falhaMotivo,
          // `undefined` some no PutCommand, e é exatamente o que o filtro
          // `attribute_exists(respondidoEm)` precisa: só quem respondeu tem o
          // atributo. Gravar `null` faria o atributo existir para todo mundo e
          // a lista de respondentes viraria a lista inteira.
          respondidoEm: envio.respondidoEm?.toISOString(),
          primeiraAberturaEm: envio.primeiraAberturaEm?.toISOString(),
          primeiroCliqueEm: envio.primeiroCliqueEm?.toISOString(),
          gsi2pk: g2.pk,
          gsi2sk: g2.sk,
          gsi4pk: g4?.pk,
          gsi4sk: g4?.sk,
        },
      }),
    );
  }
}

function paraEnvio(item: Record<string, unknown>): Envio {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    sendId: novoSendId(String(item['sendId'])),
    campaignId: novoCampaignId(String(item['campaignId'])),
    contactId: novoContactId(String(item['contactId'])),
    status: String(item['status']) as Envio['status'],
    ...(item['sesMessageId'] === undefined ? {} : { sesMessageId: String(item['sesMessageId']) }),
    ...(item['enviadoEm'] === undefined ? {} : { enviadoEm: new Date(String(item['enviadoEm'])) }),
    ...(item['falhaMotivo'] === undefined ? {} : { falhaMotivo: String(item['falhaMotivo']) }),
    ...(item['respondidoEm'] === undefined
      ? {}
      : { respondidoEm: new Date(String(item['respondidoEm'])) }),
    ...(item['primeiraAberturaEm'] === undefined
      ? {}
      : { primeiraAberturaEm: new Date(String(item['primeiraAberturaEm'])) }),
    ...(item['primeiroCliqueEm'] === undefined
      ? {}
      : { primeiroCliqueEm: new Date(String(item['primeiroCliqueEm'])) }),
  };
}

/**
 * Contadores pré-agregados — §5.7.
 *
 * `ADD` do DynamoDB é atômico: dois eventos processados ao mesmo tempo não
 * perdem incremento. É o que permite ter métrica de campanha correta sem
 * transação nem varredura de eventos a cada abertura de tela.
 *
 * A atomicidade sozinha **não** garante contagem correta — ela protege contra
 * corrida, não contra reprocessamento. Quem garante que cada evento conta uma
 * vez só é a guarda de idempotência, antes desta chamada (§5.4).
 */
export class DynamoMetricsRepository implements MetricsRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async incrementar(
    tenantId: TenantId,
    campaignId: CampaignId,
    campo: CampoMetrica,
    quantidade = 1,
  ): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tabela,
        Key: chaveMetricas(tenantId, campaignId),
        UpdateExpression: 'ADD #campo :q SET #tipo = :tipo, #cid = :cid',
        ExpressionAttributeNames: { '#campo': campo, '#tipo': 'tipo', '#cid': 'campaignId' },
        ExpressionAttributeValues: {
          ':q': quantidade,
          ':tipo': 'METRICS',
          ':cid': String(campaignId),
        },
      }),
    );
  }

  async ler(tenantId: TenantId, campaignId: CampaignId): Promise<Readonly<Record<string, number>>> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveMetricas(tenantId, campaignId) }),
    );
    if (r.Item === undefined) return {};

    const saida: Record<string, number> = {};
    for (const [chave, valor] of Object.entries(r.Item)) {
      if (typeof valor === 'number') saida[chave] = valor;
    }
    return saida;
  }

  async incrementarSerie(
    tenantId: TenantId,
    campaignId: CampaignId,
    campo: CampoDaSerie,
    dia: string,
  ): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tabela,
        Key: chaveSerie(tenantId, campaignId, dia),
        UpdateExpression: 'ADD #campo :um SET #tipo = :tipo, #dia = :dia',
        ExpressionAttributeNames: { '#campo': campo, '#tipo': 'tipo', '#dia': 'dia' },
        ExpressionAttributeValues: { ':um': 1, ':tipo': 'SERIE', ':dia': dia },
      }),
    );
  }

  /**
   * Série completa, em ordem cronológica — a sort key `SERIE#<dia>` ordena
   * sozinha. Uma campanha acumula pontos apenas nos dias com atividade, então
   * a partição é pequena (semanas, não milhares); os buracos entre dias são
   * problema da tela, que conhece o intervalo que quer exibir.
   */
  async lerSerie(tenantId: TenantId, campaignId: CampaignId): Promise<readonly PontoDaSerie[]> {
    const chave = chaveSerie(tenantId, campaignId, '');
    const pontos: PontoDaSerie[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const r: {
        Items?: Record<string, unknown>[] | undefined;
        LastEvaluatedKey?: Record<string, unknown> | undefined;
      } = await this.doc.send(
        new QueryCommand({
          TableName: this.tabela,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
          ExpressionAttributeValues: { ':pk': chave.pk, ':prefixo': PREFIXO_SERIE },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of r.Items ?? []) {
        pontos.push({
          dia: String(item['dia'] ?? ''),
          enviados: numero(item['enviados']),
          entregues: numero(item['entregues']),
          aberturas: numero(item['aberturas']),
          cliques: numero(item['cliques']),
          bounces: numero(item['bounces']),
        });
      }
      cursor = r.LastEvaluatedKey;
    } while (cursor !== undefined);

    return pontos;
  }
}

function numero(v: unknown): number {
  return typeof v === 'number' && v > 0 ? v : 0;
}
