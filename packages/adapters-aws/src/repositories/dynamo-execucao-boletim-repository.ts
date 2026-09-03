import {
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  execucaoBoletimId as novoExecucaoId,
  templateId as novoTemplateId,
  campaignId as novoCampaignId,
  tenantId as novoTenantId,
  userId as novoUserId,
  type ExecucaoBoletim,
  type ExecucaoBoletimId,
  type EdicaoBoletim,
  type ExecucaoBoletimRepository,
  type EtapaExecucaoBoletim,
  type NoticiaColetada,
  type OrigemExecucaoBoletim,
  type SituacaoExecucaoBoletim,
  type TenantId,
} from '@emailmkt/core';
import { chaveExecucaoBoletim, gsi3ExecucaoBoletim } from '../keys.js';

/**
 * Execuções do boletim automático.
 *
 * O item é reescrito inteiro a cada passo (Put, não Update): a execução tem
 * uma dúzia de campos, vive por minutos e é escrita meia dúzia de vezes na
 * vida — a expressão de update economizaria bytes e custaria a garantia de que
 * o item gravado é exatamente o objeto de domínio.
 */
export class DynamoExecucaoBoletimRepository implements ExecucaoBoletimRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async buscarPorId(
    tenantId: TenantId,
    execucaoId: ExecucaoBoletimId,
  ): Promise<ExecucaoBoletim | null> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.tabela, Key: chaveExecucaoBoletim(tenantId, execucaoId) }),
    );
    return r.Item === undefined ? null : paraExecucao(r.Item);
  }

  async listarRecentes(tenantId: TenantId, limite: number): Promise<readonly ExecucaoBoletim[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tabela,
        IndexName: 'gsi3',
        KeyConditionExpression: 'gsi3pk = :pk',
        ExpressionAttributeValues: { ':pk': gsi3ExecucaoBoletim(tenantId, new Date()).pk },
        // A sort key é o instante ISO; ler ao contrário devolve a mais recente
        // primeiro, que é a única que a tela consulta em rajada.
        ScanIndexForward: false,
        Limit: limite,
      }),
    );
    return (r.Items ?? []).map(paraExecucao);
  }

  async salvar(execucao: ExecucaoBoletim): Promise<void> {
    const gsi3 = gsi3ExecucaoBoletim(execucao.tenantId, execucao.iniciadaEm);
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          ...chaveExecucaoBoletim(execucao.tenantId, execucao.execucaoId),
          tipo: 'EXECUCAO_BOLETIM',
          tenantId: String(execucao.tenantId),
          execucaoId: String(execucao.execucaoId),
          situacao: execucao.situacao,
          etapa: execucao.etapa,
          origem: execucao.origem,
          iniciadaEm: execucao.iniciadaEm.toISOString(),
          atualizadaEm: execucao.atualizadaEm.toISOString(),
          fontesTotal: execucao.fontesTotal,
          fontesConcluidas: execucao.fontesConcluidas,
          totalNoticias: execucao.totalNoticias,
          avisos: [...execucao.avisos],
          ...opcional('concluidaEm', execucao.concluidaEm?.toISOString()),
          ...opcional('fonteAtual', execucao.fonteAtual),
          ...opcional('templateId', execucao.templateId as string | undefined),
          ...opcional('templateNome', execucao.templateNome),
          ...opcional('erro', execucao.erro),
          ...opcional('solicitadaPor', execucao.solicitadaPor as string | undefined),
          ...opcional('envioCampaignId', execucao.envioCampaignId as string | undefined),
          ...opcional('envioErro', execucao.envioErro),
          ...opcional('edicao', execucao.edicao),
          // Lista de mapas: o acervo da retrospectiva. Só o que entrou na edição.
          ...(execucao.noticias === undefined || execucao.noticias.length === 0
            ? {}
            : {
                noticias: execucao.noticias.map((n) => ({
                  titulo: n.titulo,
                  resumo: n.resumo,
                  url: n.url,
                  tag: n.tag,
                })),
              }),
          gsi3pk: gsi3.pk,
          gsi3sk: gsi3.sk,
          /**
           * Seis meses de histórico e o item some sozinho. É registro
           * operacional — serve para o operador entender a semana passada, não
           * para auditoria (essa mora na trilha de auditoria, e não expira).
           */
          ttl: Math.floor(execucao.iniciadaEm.getTime() / 1000) + 180 * 24 * 60 * 60,
        },
      }),
    );
  }
}

/** Campo ausente não vira `undefined` no item: o DynamoDB rejeitaria. */
function opcional(chave: string, valor: string | undefined): Record<string, string> {
  return valor === undefined || valor === '' ? {} : { [chave]: valor };
}

function paraExecucao(item: Record<string, unknown>): ExecucaoBoletim {
  const concluidaEm = item['concluidaEm'];
  const fonteAtual = item['fonteAtual'];
  const templateId = item['templateId'];
  const templateNome = item['templateNome'];
  const erro = item['erro'];
  const solicitadaPor = item['solicitadaPor'];
  const envioCampaignId = item['envioCampaignId'];
  const envioErro = item['envioErro'];
  const edicao = item['edicao'];
  const noticias = Array.isArray(item['noticias'])
    ? item['noticias'].map(paraNoticia).filter((n): n is NoticiaColetada => n !== null)
    : [];

  return {
    tenantId: novoTenantId(String(item['tenantId'])),
    execucaoId: novoExecucaoId(String(item['execucaoId'])),
    situacao: String(item['situacao']) as SituacaoExecucaoBoletim,
    etapa: String(item['etapa']) as EtapaExecucaoBoletim,
    origem: String(item['origem']) as OrigemExecucaoBoletim,
    iniciadaEm: new Date(String(item['iniciadaEm'])),
    atualizadaEm: new Date(String(item['atualizadaEm'])),
    fontesTotal: Number(item['fontesTotal'] ?? 0),
    fontesConcluidas: Number(item['fontesConcluidas'] ?? 0),
    totalNoticias: Number(item['totalNoticias'] ?? 0),
    avisos: Array.isArray(item['avisos']) ? item['avisos'].map(String) : [],
    ...(concluidaEm === undefined ? {} : { concluidaEm: new Date(String(concluidaEm)) }),
    ...(fonteAtual === undefined ? {} : { fonteAtual: String(fonteAtual) }),
    ...(templateId === undefined ? {} : { templateId: novoTemplateId(String(templateId)) }),
    ...(templateNome === undefined ? {} : { templateNome: String(templateNome) }),
    ...(erro === undefined ? {} : { erro: String(erro) }),
    ...(envioCampaignId === undefined
      ? {}
      : { envioCampaignId: novoCampaignId(String(envioCampaignId)) }),
    ...(envioErro === undefined ? {} : { envioErro: String(envioErro) }),
    ...(solicitadaPor === undefined ? {} : { solicitadaPor: novoUserId(String(solicitadaPor)) }),
    ...(edicao === undefined ? {} : { edicao: String(edicao) as EdicaoBoletim }),
    ...(noticias.length === 0 ? {} : { noticias }),
  };
}

/** Item malformado não derruba a leitura da execução: vira notícia descartada. */
function paraNoticia(valor: unknown): NoticiaColetada | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const o = valor as Record<string, unknown>;
  if (typeof o['titulo'] !== 'string' || typeof o['resumo'] !== 'string') return null;
  return {
    titulo: o['titulo'],
    resumo: o['resumo'],
    url: typeof o['url'] === 'string' ? o['url'] : '',
    tag: typeof o['tag'] === 'string' ? o['tag'] : '',
  };
}
