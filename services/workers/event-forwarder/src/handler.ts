import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

/**
 * A ponte entre us-east-2 e sa-east-1 — ADR-01.
 *
 * Deliberadamente burra: repassa o payload íntegro e **não interpreta nada**. Se
 * tivesse regra de negócio, teríamos lógica de domínio rodando fora de
 * sa-east-1, que é justamente o que o ADR-01 quis evitar. Toda decisão sobre os
 * dados acontece no `event-processor`, do outro lado.
 *
 * Roda em us-east-2 porque destinos de evento do SES são regionais e a
 * identidade já está verificada lá (§1.1).
 */

const REGIAO_DESTINO = process.env['REGIAO_DADOS'] ?? 'sa-east-1';
const FILA_DESTINO = process.env['FILA_DESTINO_URL'] ?? '';

const cliente = new SQSClient({
  region: REGIAO_DESTINO,
  maxAttempts: 5,
  retryMode: 'adaptive',
});

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'event-forwarder', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

export const handler = async (evento: SQSEvent): Promise<SQSBatchResponse> => {
  if (FILA_DESTINO === '') throw new Error('Variável de ambiente ausente: FILA_DESTINO_URL');

  const falhas: { itemIdentifier: string }[] = [];

  // Lotes de 10 — máximo do SQS. O event source já entrega no máximo 10, mas o
  // fatiamento mantém o worker correto se o batchSize mudar no CDK.
  for (let i = 0; i < evento.Records.length; i += 10) {
    const fatia = evento.Records.slice(i, i + 10);

    try {
      const r = await cliente.send(
        new SendMessageBatchCommand({
          QueueUrl: FILA_DESTINO,
          Entries: fatia.map((registro, indice) => ({
            Id: `m${indice}`,
            MessageBody: registro.body,
          })),
        }),
      );

      // `Failed` não faz a chamada lançar. Ignorá-lo perderia eventos de bounce
      // e reclamação em silêncio — exatamente os que não podem ser perdidos.
      for (const falha of r.Failed ?? []) {
        const indice = Number(falha.Id?.slice(1) ?? -1);
        const registro = fatia[indice];
        if (registro !== undefined) {
          log('ERROR', 'SQS recusou a mensagem no repasse', {
            messageId: registro.messageId,
            codigo: falha.Code,
          });
          falhas.push({ itemIdentifier: registro.messageId });
        }
      }
    } catch (erro) {
      // Falha do lote inteiro: devolve todos para reentrega.
      log('ERROR', 'falha ao repassar lote', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      for (const registro of fatia) falhas.push({ itemIdentifier: registro.messageId });
    }
  }

  log('INFO', 'repasse concluído', {
    recebidos: evento.Records.length,
    falhas: falhas.length,
  });

  return { batchItemFailures: falhas };
};
