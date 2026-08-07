import {
  ChangeMessageVisibilityCommand,
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { CampaignId, ContactId, SendId, SendQueuePublisher } from '@emailmkt/core';

const LIMITE_LOTE_SQS = 10;

export class SqsSendQueuePublisher implements SendQueuePublisher {
  constructor(
    private readonly cliente: SQSClient,
    private readonly urlFila: string,
  ) {}

  /**
   * Enfileira em lotes de 10 — o máximo do SQS.
   *
   * Como no BatchWrite do DynamoDB, `SendMessageBatch` pode falhar em parte sem
   * a chamada falhar. Ignorar `Failed` significaria uma campanha que reporta
   * "5.000 enfileirados" e envia 4.980, sem erro em lugar nenhum.
   */
  async publicarLote(
    mensagens: readonly {
      readonly sendId: SendId;
      readonly campaignId: CampaignId;
      readonly contactId: ContactId;
    }[],
  ): Promise<void> {
    for (let i = 0; i < mensagens.length; i += LIMITE_LOTE_SQS) {
      const fatia = mensagens.slice(i, i + LIMITE_LOTE_SQS);

      const r = await this.cliente.send(
        new SendMessageBatchCommand({
          QueueUrl: this.urlFila,
          Entries: fatia.map((m, indice) => ({
            // O Id só precisa ser único dentro do lote; usar o índice evita
            // estourar o limite de 80 caracteres com hashes longos.
            Id: `m${indice}`,
            MessageBody: JSON.stringify({
              sendId: m.sendId,
              campaignId: m.campaignId,
              contactId: m.contactId,
              tentativa: 0,
            }),
          })),
        }),
      );

      const falhas = r.Failed ?? [];
      if (falhas.length > 0) {
        const detalhe = falhas.map((f) => `${f.Id ?? '?'}:${f.Code ?? '?'}`).join(', ');
        throw new Error(`SQS recusou ${falhas.length} mensagens do lote: ${detalhe}`);
      }
    }
  }

  /**
   * Adia a reentrega — o mecanismo de pausa do ADR-05.
   *
   * `referenciaEntrega` é o receiptHandle do SQS, opaco para quem chama.
   *
   * Estender a visibilidade é melhor que reenviar a mensagem: reenviar criaria
   * uma segunda cópia na fila e zeraria o contador de recebimentos, o que
   * neutralizaria a proteção da DLQ numa campanha pausada por muito tempo.
   */
  async adiarEntrega(referenciaEntrega: string, atrasoSegundos: number): Promise<void> {
    await this.cliente.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.urlFila,
        ReceiptHandle: referenciaEntrega,
        // Teto do SQS é 12h; atraso maior que isso não é representável.
        VisibilityTimeout: Math.min(atrasoSegundos, 43_200),
      }),
    );
  }
}
