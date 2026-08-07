import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { MensagemImportacao } from '@emailmkt/contracts';

/**
 * Enfileira o pedido de importação para o `csv-importer`.
 *
 * Mensagem única, não lote: cada importação é um arquivo, e o worker consome com
 * `batchSize: 1` justamente porque processar um CSV inteiro pode levar minutos.
 *
 * A API publica aqui em vez de importar direto por dois motivos. O primeiro é
 * tempo: uma Lambda de API tem segundos, um CSV de 200.000 linhas não cabe
 * nesse orçamento. O segundo é a retentativa — com a fila, uma falha no meio do
 * arquivo volta para a DLQ e fica visível no alarme, em vez de virar um 500 que
 * o operador vê e não sabe se gravou metade.
 */
export class SqsImportQueuePublisher {
  constructor(
    private readonly cliente: SQSClient,
    private readonly urlFila: string,
  ) {}

  async publicar(mensagem: MensagemImportacao): Promise<void> {
    await this.cliente.send(
      new SendMessageCommand({
        QueueUrl: this.urlFila,
        MessageBody: JSON.stringify(mensagem),
      }),
    );
  }
}
