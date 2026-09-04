import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  templateId as novoTemplateId,
  tenantId as novoTenantId,
  userId as novoUserId,
  type Pagina,
  type Template,
  type TemplateCarregado,
  type TemplateId,
  type TemplateRepository,
  type TenantId,
  type VersaoTemplate,
} from '@emailmkt/core';
import { chaveTemplate, chaveTemplateMeta, codificarCursor, decodificarCursor } from '../keys.js';

export class DynamoTemplateRepository implements TemplateRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarVersao(
    tenantId: TenantId,
    templateId: TemplateId,
    versao: number,
  ): Promise<TemplateCarregado | null> {
    const r = await this.doc.send(
      new GetCommand({
        TableName: this.tabela,
        Key: chaveTemplate(tenantId, String(templateId), versao),
      }),
    );
    if (r.Item === undefined) return null;

    return {
      assunto: String(r.Item['assunto']),
      corpoHtml: String(r.Item['corpoHtml']),
      ...(r.Item['estruturaVisual'] === undefined
        ? {}
        : { estruturaVisual: String(r.Item['estruturaVisual']) }),
    };
  }

  async buscarMeta(tenantId: TenantId, templateId: TemplateId): Promise<Template | null> {
    const r = await this.doc.send(
      new GetCommand({
        TableName: this.tabela,
        Key: chaveTemplateMeta(tenantId, String(templateId)),
      }),
    );
    return r.Item === undefined ? null : paraTemplate(r.Item);
  }

  /**
   * Metadados e versão numa transação.
   *
   * Gravar em duas chamadas abriria uma janela: se a segunda falhasse, o
   * `versaoAtual` apontaria para uma versão inexistente e o `sender` quebraria
   * no meio de um disparo — bem longe daqui, com uma mensagem difícil de ligar
   * à causa. `TransactWrite` custa o dobro de uma escrita comum e resolve isso
   * por centavos.
   */
  async salvarComVersao(template: Template, versao: VersaoTemplate): Promise<void> {
    const meta = chaveTemplateMeta(template.tenantId, String(template.templateId));
    const chaveVersao = chaveTemplate(
      template.tenantId,
      String(template.templateId),
      versao.versao,
    );

    await this.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tabela, Item: { ...meta, ...itemMeta(template) } } },
          {
            Put: {
              TableName: this.tabela,
              Item: { ...chaveVersao, ...itemVersao(template, versao) },
              // Versões são imutáveis (§6.2, nota 3). Sobrescrever uma versão
              // já usada por campanha enviada apagaria a prova do que saiu.
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    );
  }

  async salvarMeta(template: Template): Promise<void> {
    const meta = chaveTemplateMeta(template.tenantId, String(template.templateId));
    await this.doc.send(
      new PutCommand({ TableName: this.tabela, Item: { ...meta, ...itemMeta(template) } }),
    );
  }

  /**
   * Listagem por GSI3, reaproveitando o índice de status.
   *
   * Templates são poucos — dezenas, não milhares —, então a partição única não
   * é problema aqui e evita mais um índice.
   *
   * Do mais recente para o mais antigo. A chave de ordenação é `atualizadoEm`,
   * e a ordem natural do índice (crescente) punha os modelos NOVOS no fim: com
   * mais de uma página, o modelo recém-criado — e cada boletim que a rotina
   * gera — ficava na página seguinte, que a escolha de modelo da campanha
   * nunca pedia. "Criei o modelo e ele não aparece" era isto.
   */
  async listar(tenantId: TenantId, cursor?: string): Promise<Pagina<Template>> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}#TEMPLATES` },
        ExclusiveStartKey: decodificarCursor(cursor),
        ScanIndexForward: false,
        Limit: 50,
      }),
    );

    const itens = (r.Items ?? []).map(paraTemplate);
    const proximo = codificarCursor(r.LastEvaluatedKey);
    return proximo === undefined ? { itens } : { itens, cursor: proximo };
  }
}

function itemMeta(t: Template): Record<string, unknown> {
  return {
    tipo: 'TEMPLATE',
    tenantId: String(t.tenantId),
    templateId: String(t.templateId),
    nome: t.nome,
    // `tipo` já é o discriminador do item; o formato do template vai em `tipoTemplate`.
    tipoTemplate: t.tipo ?? 'CODIGO',
    categoria: t.categoria,
    thumbnail: t.thumbnail,
    versaoAtual: t.versaoAtual,
    arquivado: t.arquivado,
    criadoPor: String(t.criadoPor),
    criadoEm: t.criadoEm.toISOString(),
    atualizadoEm: t.atualizadoEm.toISOString(),
    gsi3pk: `TENANT#${t.tenantId}#TEMPLATES`,
    gsi3sk: t.atualizadoEm.toISOString(),
  };
}

function itemVersao(t: Template, v: VersaoTemplate): Record<string, unknown> {
  return {
    tipo: 'TEMPLATE_VERSION',
    tenantId: String(t.tenantId),
    templateId: String(t.templateId),
    versao: v.versao,
    assunto: v.assunto,
    corpoHtml: v.corpoHtml,
    estruturaVisual: v.estruturaVisual,
    preheader: v.preheader,
    criadoPor: String(v.criadoPor),
    criadoEm: v.criadoEm.toISOString(),
  };
}

function paraTemplate(item: Record<string, unknown>): Template {
  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    templateId: novoTemplateId(String(item['templateId'])),
    nome: String(item['nome']),
    tipo: item['tipoTemplate'] === 'VISUAL' ? 'VISUAL' : 'CODIGO',
    ...(item['categoria'] === undefined ? {} : { categoria: String(item['categoria']) }),
    ...(item['thumbnail'] === undefined ? {} : { thumbnail: String(item['thumbnail']) }),
    versaoAtual: Number(item['versaoAtual']),
    arquivado: item['arquivado'] === true,
    criadoPor: novoUserId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
  };
}
