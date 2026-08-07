import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type {
  Contact,
  ContactId,
  ContactRepository,
  EmailAddress,
  EmailHasher,
  ListId,
  Pagina,
  TenantId,
} from '@emailmkt/core';
import {
  PREFIXO_MEMBRO,
  chaveContato,
  chaveMembroLista,
  codificarCursor,
  decodificarCursor,
  gsi1Email,
} from '../keys.js';
import { contatoParaItem, itemParaContato } from '../mappers/contact-mapper.js';

const LIMITE_BATCH_GET = 100;
const LIMITE_BATCH_WRITE = 25;

export class DynamoContactRepository implements ContactRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
    private readonly hasher: EmailHasher,
  ) {}

  async buscarPorId(tenantId: TenantId, id: ContactId): Promise<Contact | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveContato(tenantId, id) }),
    );
    return r.Item === undefined ? null : itemParaContato(r.Item);
  }

  async buscarPorEmail(tenantId: TenantId, email: EmailAddress): Promise<Contact | null> {
    const chave = gsi1Email(tenantId, this.hasher.hash(email));
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk = :sk',
        ExpressionAttributeValues: { ':pk': chave.pk, ':sk': chave.sk },
        Limit: 1,
      }),
    );
    const item = r.Items?.[0];
    return item === undefined ? null : itemParaContato(item);
  }

  async salvar(contato: Contact): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: contatoParaItem(contato, this.hasher.hash(contato.email)),
      }),
    );
  }

  async salvarEmLote(contatos: readonly Contact[]): Promise<void> {
    for (let i = 0; i < contatos.length; i += LIMITE_BATCH_WRITE) {
      const fatia = contatos.slice(i, i + LIMITE_BATCH_WRITE);
      let pendentes = fatia.map((c) => ({
        PutRequest: { Item: contatoParaItem(c, this.hasher.hash(c.email)) },
      }));

      // BatchWrite pode devolver itens não processados sem que a chamada falhe.
      // Ignorar UnprocessedItems é o erro clássico deste comando: a importação
      // reporta sucesso e alguns contatos simplesmente não estão lá.
      for (let tentativa = 0; tentativa < 5 && pendentes.length > 0; tentativa++) {
        const r = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [this.tabela]: pendentes } }),
        );
        const restantes = r.UnprocessedItems?.[this.tabela] ?? [];
        pendentes = restantes as typeof pendentes;
        if (pendentes.length > 0) await esperar(2 ** tentativa * 50);
      }

      if (pendentes.length > 0) {
        throw new Error(`BatchWrite não processou ${pendentes.length} contatos após 5 tentativas.`);
      }
    }
  }

  /**
   * Lista os contatos de uma lista.
   *
   * Duas idas ao banco por página, de propósito: a associação guarda só o
   * `contactId`, e os dados do contato vêm por BatchGet. A alternativa —
   * duplicar o contato dentro do item de associação — deixaria a leitura em uma
   * chamada só, mas criaria cópia que desatualiza. Num sistema onde o `status`
   * do contato decide se ele recebe ou não e-mail, ler uma cópia velha significa
   * enviar para quem se descadastrou.
   */
  async listarPorLista(
    tenantId: TenantId,
    listId: ListId,
    cursor?: string,
  ): Promise<Pagina<Contact>> {
    const chaveLista = chaveMembroLista(tenantId, listId, '' as ContactId);

    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefixo)',
        ExpressionAttributeValues: { ':pk': chaveLista.pk, ':prefixo': PREFIXO_MEMBRO },
        Limit: LIMITE_BATCH_GET,
        ExclusiveStartKey: decodificarCursor(cursor),
      }),
    );

    const ids = (r.Items ?? []).map((i) => String(i['contactId']) as ContactId);
    const contatos = ids.length === 0 ? [] : await this.buscarVarios(tenantId, ids);
    const proximo = codificarCursor(r.LastEvaluatedKey);

    return proximo === undefined ? { itens: contatos } : { itens: contatos, cursor: proximo };
  }

  private async buscarVarios(tenantId: TenantId, ids: readonly ContactId[]): Promise<Contact[]> {
    const encontrados: Contact[] = [];

    for (let i = 0; i < ids.length; i += LIMITE_BATCH_GET) {
      let chaves = ids.slice(i, i + LIMITE_BATCH_GET).map((id) => chaveContato(tenantId, id));

      for (let tentativa = 0; tentativa < 5 && chaves.length > 0; tentativa++) {
        const r = await this.doc.send(
          new BatchGetCommand({ RequestItems: { [this.tabela]: { Keys: chaves } } }),
        );
        for (const item of r.Responses?.[this.tabela] ?? []) {
          encontrados.push(itemParaContato(item));
        }
        chaves = (r.UnprocessedKeys?.[this.tabela]?.Keys ?? []) as typeof chaves;
        if (chaves.length > 0) await esperar(2 ** tentativa * 50);
      }

      if (chaves.length > 0) {
        // Silenciar aqui produziria uma audiência incompleta sem aviso: a
        // campanha sairia para menos gente e ninguém saberia por quê.
        throw new Error(`BatchGet não resolveu ${chaves.length} contatos após 5 tentativas.`);
      }
    }

    return encontrados;
  }

  async excluir(tenantId: TenantId, id: ContactId): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tabela, Key: chaveContato(tenantId, id) }),
    );
  }
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
