import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import {
  DynamoContactRepository,
  DynamoEventRepository,
  DynamoIdempotencyStore,
  DynamoMetricsRepository,
  DynamoSendRepository,
  DynamoSuppressionRepository,
  SecretsProvider,
  Sha256EmailHasher,
  SystemClock,
  desembrulharMensagem,
  dynamoDoc,
  secrets,
  traduzirEventoSes,
} from '@emailmkt/adapters-aws';
import { TENANT_PADRAO, processarEvento, type DepsEvento } from '@emailmkt/core';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = {
  info: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ nivel: 'INFO', worker: 'event-processor', mensagem, ...dados })),
  error: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.error(
      JSON.stringify({ nivel: 'ERROR', worker: 'event-processor', mensagem, ...dados }),
    ),
};

let cache: Promise<DepsEvento> | undefined;

function deps(): Promise<DepsEvento> {
  cache ??= (async (): Promise<DepsEvento> => {
    const tabela = env('TABELA_PRINCIPAL');
    const doc = dynamoDoc();
    const segredo = await new SecretsProvider(secrets()).ler(env('SEGREDO_HMAC_ARN'));
    const hasher = new Sha256EmailHasher(segredo);

    return {
      envios: new DynamoSendRepository(doc, tabela),
      contatos: new DynamoContactRepository(doc, tabela, hasher),
      supressao: new DynamoSuppressionRepository(doc, tabela),
      metricas: new DynamoMetricsRepository(doc, tabela),
      eventos: new DynamoEventRepository(doc, tabela),
      idempotencia: new DynamoIdempotencyStore(doc, env('TABELA_IDEMPOTENCIA')),
      hasher,
      clock: new SystemClock(),
    };
  })();
  return cache;
}

/**
 * Processa eventos de entrega do SES — §11, itens 5 e 6.
 *
 * Aqui acontece a supressão automática de hard bounce e reclamação de spam, que
 * é a defesa da reputação da conta — o ativo mais frágil do projeto (§14).
 *
 * Falha por item: um evento com formato inesperado não pode impedir o
 * processamento dos outros nove do lote. Ele vai sozinho para a DLQ.
 */
export const handler = async (evento: SQSEvent): Promise<SQSBatchResponse> => {
  const d = await deps();
  const falhas: { itemIdentifier: string }[] = [];

  for (const registro of evento.Records) {
    try {
      const bruto = desembrulharMensagem(registro.body);
      const traduzido = traduzirEventoSes(bruto, TENANT_PADRAO);

      if (traduzido === null) {
        // Formato desconhecido. Retentar não conserta — vai para a DLQ, onde
        // alguém olha e decide se é um tipo de evento novo da AWS.
        log.error('evento do SES não reconhecido', { messageId: registro.messageId });
        falhas.push({ itemIdentifier: registro.messageId });
        continue;
      }

      const r = await processarEvento(d, traduzido);

      if (r.acao === 'ORFAO') {
        /**
         * Evento sem envio correspondente.
         *
         * Acontece quando o evento chega antes de a gravação do envio concluir —
         * a corrida é real, o SES é rápido. Devolver como falha faz a fila
         * reentregar com backoff, o que costuma resolver na segunda tentativa;
         * se persistir, a DLQ registra para inspeção.
         */
        log.info('evento órfão, será reentregue', {
          messageId: registro.messageId,
          sesMessageId: traduzido.sesMessageId,
        });
        falhas.push({ itemIdentifier: registro.messageId });
        continue;
      }

      log.info('evento processado', {
        tipo: traduzido.tipo,
        acao: r.acao,
        suprimiu: r.acao === 'PROCESSADO' ? r.suprimiu : false,
      });
    } catch (erro) {
      log.error('falha ao processar evento', {
        messageId: registro.messageId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      falhas.push({ itemIdentifier: registro.messageId });
    }
  }

  return { batchItemFailures: falhas };
};
