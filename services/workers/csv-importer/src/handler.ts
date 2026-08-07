import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import {
  DynamoContactRepository,
  DynamoSuppressionRepository,
  SecretsProvider,
  Sha256EmailHasher,
  SystemClock,
  UuidGenerator,
  dynamoDoc,
  s3,
  secrets,
} from '@emailmkt/adapters-aws';
import {
  EmailAddress,
  TENANT_PADRAO,
  contactId as novoContactId,
  type Contact,
  type Relacionamento,
} from '@emailmkt/core';
import { mensagemImportacaoSchema, type MensagemImportacao } from '@emailmkt/contracts';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'csv-importer', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

/** Lotes de 500 para não segurar milhares de contatos em memória de uma vez. */
const TAMANHO_LOTE = 500;
const MAX_ERROS_REPORTADOS = 1000;

/**
 * Importa contatos de um CSV — §11, item 1.
 *
 * Lê em streaming direto do S3. Carregar o arquivo inteiro em memória
 * funcionaria para 5.000 contatos e quebraria em 200.000 — e o modo de falha
 * seria estouro de memória da Lambda no meio da importação, deixando metade dos
 * contatos gravados sem relatório nenhum.
 */
export const handler = async (evento: SQSEvent): Promise<SQSBatchResponse> => {
  const falhas: { itemIdentifier: string }[] = [];

  for (const registro of evento.Records) {
    try {
      const dados = mensagemImportacaoSchema.safeParse(JSON.parse(registro.body));
      if (!dados.success) {
        log('ERROR', 'mensagem de importação inválida', { messageId: registro.messageId });
        continue; // Payload quebrado não melhora com retentativa.
      }
      await importar(dados.data);
    } catch (erro) {
      log('ERROR', 'falha na importação', {
        messageId: registro.messageId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      falhas.push({ itemIdentifier: registro.messageId });
    }
  }

  return { batchItemFailures: falhas };
};

async function importar(msg: MensagemImportacao): Promise<void> {
  const tabela = env('TABELA_PRINCIPAL');
  const doc = dynamoDoc();
  const segredo = await new SecretsProvider(secrets()).ler(env('SEGREDO_HMAC_ARN'));
  const hasher = new Sha256EmailHasher(segredo);

  const contatos = new DynamoContactRepository(doc, tabela, hasher);
  const supressao = new DynamoSuppressionRepository(doc, tabela);
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const agora = clock.agora();

  const fluxo = await abrirCsv(s3(), env('BUCKET_UPLOADS'), msg.chaveS3);

  let totalLinhas = 0;
  let importados = 0;
  let duplicados = 0;
  let invalidos = 0;
  let suprimidosIgnorados = 0;
  const erros: { linha: number; motivo: string }[] = [];

  const vistosNoArquivo = new Set<string>();
  let lote: Contact[] = [];

  const descarregar = async (): Promise<void> => {
    if (lote.length === 0) return;

    // Verifica a supressão em lote ANTES de gravar. Reimportar um CSV antigo é
    // o cenário mais provável, e ele traz de volta quem já pediu para sair
    // (§6.2, nota 2).
    const hashes = lote.map((c) => hasher.hash(c.email));
    const suprimidos = await supressao.filtrarSuprimidos(TENANT_PADRAO, hashes);

    const aGravar = lote.filter((_c, i) => {
      const h = hashes[i];
      if (h !== undefined && suprimidos.has(h)) {
        suprimidosIgnorados += 1;
        return false;
      }
      return true;
    });

    if (aGravar.length > 0) await contatos.salvarEmLote(aGravar);
    importados += aGravar.length;
    lote = [];
  };

  for await (const linha of fluxo) {
    totalLinhas += 1;
    const numeroLinha = totalLinhas + 1; // +1 pelo cabeçalho.

    const bruto = linha[msg.mapeamentoColunas.email];
    const email = EmailAddress.create(String(bruto ?? ''));

    if (!email.ok) {
      invalidos += 1;
      if (erros.length < MAX_ERROS_REPORTADOS) {
        erros.push({ linha: numeroLinha, motivo: email.error.message });
      }
      continue;
    }

    if (vistosNoArquivo.has(email.value.value)) {
      duplicados += 1;
      continue;
    }
    vistosNoArquivo.add(email.value.value);

    const nomeColuna = msg.mapeamentoColunas.nome;
    const nome = nomeColuna === undefined ? undefined : texto(linha[nomeColuna]);
    // Numa variável: chamar duas vezes dentro do spread condicional impede o
    // TypeScript de estreitar o tipo entre a checagem e o uso.
    const desde = resolverDesde(linha, msg);

    lote.push({
      tenantId: TENANT_PADRAO,
      contactId: novoContactId(ids.gerar()),
      email: email.value,
      ...(nome === undefined ? {} : { nome }),
      camposCustomizados: {},
      status: 'ATIVO',
      relacionamento: resolverRelacionamento(linha, msg),
      ...(desde === undefined ? {} : { relacionamentoDesde: desde }),
      /**
       * A base legal é gravada por contato com a origem declarada do lote —
       * §10.2. É o que sustenta o legítimo interesse: sem isso, um CSV anônimo
       * entra na base e ninguém consegue dizer depois de onde vieram aqueles
       * contatos.
       */
      baseLegal: {
        base: 'LEGITIMO_INTERESSE',
        liaVersao: process.env['LIA_VERSAO'] ?? 'pendente',
        finalidade: 'Comunicação informativa a quem tem relacionamento com o escritório',
        evidenciaRelacionamento: msg.origemDeclarada,
        origemDeclarada: msg.origemDeclarada,
        registradoEm: agora,
      },
      criadoEm: agora,
      atualizadoEm: agora,
      origem: `csv:${msg.importacaoId}`,
    });

    if (lote.length >= TAMANHO_LOTE) await descarregar();
  }

  await descarregar();

  log('INFO', 'importação concluída', {
    importacaoId: msg.importacaoId,
    totalLinhas,
    importados,
    duplicados,
    invalidos,
    suprimidosIgnorados,
    // Contatos sem vínculo classificado não recebem campanha (§6.2). Destacar
    // aqui evita a surpresa de uma audiência muito menor que a lista.
    relacionamentoPadrao: msg.relacionamentoPadrao,
  });
}

async function abrirCsv(
  cliente: S3Client,
  bucket: string,
  chave: string,
): Promise<AsyncIterable<Record<string, string>>> {
  const r = await cliente.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
  const corpo = r.Body;
  if (corpo === undefined) throw new Error(`Objeto vazio no S3: ${chave}`);

  return (corpo as unknown as NodeJS.ReadableStream).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      // BOM é o que faz a primeira coluna de um CSV exportado do Excel vir com
      // um caractere invisível grudado no nome — e o mapeamento não bater.
      bom: true,
      relax_column_count: true,
    }),
  ) as unknown as AsyncIterable<Record<string, string>>;
}

const RELACIONAMENTOS: readonly Relacionamento[] = [
  'CLIENTE_ATIVO',
  'EX_CLIENTE',
  'PROSPECT_CONTATO',
  'EVENTO',
  'INDICACAO',
  'DESCONHECIDO',
];

function resolverRelacionamento(
  linha: Record<string, string>,
  msg: MensagemImportacao,
): Relacionamento {
  const coluna = msg.mapeamentoColunas.relacionamento;
  const bruto = coluna === undefined ? undefined : texto(linha[coluna])?.toUpperCase();

  // Valor não reconhecido vira DESCONHECIDO, não o padrão do lote: assumir um
  // vínculo que o arquivo não confirma é exatamente o que a base legal não
  // permite (§10.2).
  if (bruto !== undefined) {
    const encontrado = RELACIONAMENTOS.find((r) => r === bruto);
    return encontrado ?? 'DESCONHECIDO';
  }
  return msg.relacionamentoPadrao;
}

function resolverDesde(linha: Record<string, string>, msg: MensagemImportacao): Date | undefined {
  const coluna = msg.mapeamentoColunas.relacionamentoDesde;
  const bruto = coluna === undefined ? undefined : texto(linha[coluna]);
  if (bruto === undefined) return undefined;

  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

function texto(v: string | undefined): string | undefined {
  const limpo = v?.trim();
  return limpo === undefined || limpo === '' ? undefined : limpo;
}
