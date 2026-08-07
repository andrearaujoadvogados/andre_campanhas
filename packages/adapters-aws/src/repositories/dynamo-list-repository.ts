import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  listId as novoListId,
  tenantId as novoTenantId,
  userId as novoUserId,
  type ContactId,
  type ListId,
  type ListRepository,
  type Lista,
  type Pagina,
  type TenantId,
} from '@emailmkt/core';
import {
  chaveLista,
  chaveMembroLista,
  codificarCursor,
  decodificarCursor,
  gsi2ListasDoContato,
} from '../keys.js';

const LIMITE_BATCH_WRITE = 25;

export class DynamoListRepository implements ListRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(tenantId: TenantId, listId: ListId): Promise<Lista | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveLista(tenantId, listId) }),
    );
    return r.Item === undefined ? null : paraLista(r.Item);
  }

  async listar(tenantId: TenantId, cursor?: string): Promise<Pagina<Lista>> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}#LISTS` },
        ExclusiveStartKey: decodificarCursor(cursor),
        Limit: 50,
      }),
    );

    const itens = (r.Items ?? []).map(paraLista);
    const proximo = codificarCursor(r.LastEvaluatedKey);
    return proximo === undefined ? { itens } : { itens, cursor: proximo };
  }

  async salvar(lista: Lista): Promise<void> {
    const chave = chaveLista(lista.tenantId, lista.listId);
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chave,
          tipo: 'LIST',
          tenantId: String(lista.tenantId),
          listId: String(lista.listId),
          nome: lista.nome,
          descricao: lista.descricao,
          tipoLista: lista.tipo,
          totalContatos: lista.totalContatos,
          criadoPor: String(lista.criadoPor),
          criadoEm: lista.criadoEm.toISOString(),
          atualizadoEm: lista.atualizadoEm.toISOString(),
          gsi3pk: `TENANT#${lista.tenantId}#LISTS`,
          gsi3sk: lista.atualizadoEm.toISOString(),
        },
      }),
    );
  }

  /**
   * Adiciona contatos à lista.
   *
   * Grava dois itens por contato: a associação (para listar quem está na lista)
   * e o índice invertido do GSI2 (para saber em quais listas um contato está).
   * Sem o segundo, responder "de quais listas devo remover este contato ao
   * excluí-lo?" exigiria varrer todas as listas.
   *
   * Devolve quantos foram efetivamente escritos — não presume que todos eram
   * novos, porque o contador da lista depende desse número.
   */
  async adicionarContatos(
    tenantId: TenantId,
    listId: ListId,
    contactIds: readonly ContactId[],
  ): Promise<number> {
    const unicos = [...new Set(contactIds)];
    if (unicos.length === 0) return 0;

    const requisicoes = unicos.flatMap((contactId) => {
      const membro = chaveMembroLista(tenantId, listId, contactId);
      const invertido = gsi2ListasDoContato(tenantId, contactId, listId);
      return [
        {
          PutRequest: {
            Item: {
              ...membro,
              tipo: 'LIST_MEMBER',
              tenantId: String(tenantId),
              listId: String(listId),
              contactId: String(contactId),
              gsi2pk: invertido.pk,
              gsi2sk: invertido.sk,
            },
          },
        },
      ];
    });

    for (let i = 0; i < requisicoes.length; i += LIMITE_BATCH_WRITE) {
      let pendentes = requisicoes.slice(i, i + LIMITE_BATCH_WRITE);

      for (let tentativa = 0; tentativa < 5 && pendentes.length > 0; tentativa++) {
        const r = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [this.tabela]: pendentes } }),
        );
        pendentes = (r.UnprocessedItems?.[this.tabela] ?? []) as typeof pendentes;
        if (pendentes.length > 0) await esperar(2 ** tentativa * 50);
      }

      if (pendentes.length > 0) {
        throw new Error(`BatchWrite não processou ${pendentes.length} associações de lista.`);
      }
    }

    await this.ajustarContador(tenantId, listId, unicos.length);
    return unicos.length;
  }

  async removerContato(tenantId: TenantId, listId: ListId, contactId: ContactId): Promise<void> {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.tabela,
        Key: chaveMembroLista(tenantId, listId, contactId),
      }),
    );
    await this.ajustarContador(tenantId, listId, -1);
  }

  async excluir(tenantId: TenantId, listId: ListId): Promise<void> {
    // Apaga só os metadados. As associações são apagadas pelo chamador, que
    // pagina — uma lista com 5.000 membros não cabe numa única operação, e
    // esconder essa paginação aqui daria a impressão de que é barato.
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveLista(tenantId, listId) }),
    );
  }

  /**
   * Contador aproximado, com `ADD` atômico.
   *
   * Aproximado de propósito (ver `Lista.totalContatos`): reinserir um contato já
   * presente incrementa de novo. O número serve de referência na tela; quem
   * decide quem recebe a campanha é a resolução de audiência, que conta de
   * verdade e ainda aplica supressão e elegibilidade.
   */
  private async ajustarContador(tenantId: TenantId, listId: ListId, delta: number): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tabela,
        Key: chaveLista(tenantId, listId),
        UpdateExpression: 'ADD totalContatos :d',
        ExpressionAttributeValues: { ':d': delta },
        // Só ajusta se a lista existe: sem isto, remover contato de uma lista
        // apagada criaria um item fantasma com contador negativo.
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
  }
}

function paraLista(item: Record<string, unknown>): Lista {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    listId: novoListId(String(item['listId'])),
    nome: String(item['nome']),
    ...(item['descricao'] === undefined ? {} : { descricao: String(item['descricao']) }),
    tipo: (item['tipoLista'] === 'DINAMICA' ? 'DINAMICA' : 'ESTATICA') as Lista['tipo'],
    totalContatos: Math.max(0, Number(item['totalContatos'] ?? 0)),
    criadoPor: novoUserId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
  };
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
