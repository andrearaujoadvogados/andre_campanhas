import { DeleteCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { IdempotencyStore } from '@emailmkt/core';

/**
 * Consumidor idempotente — §5.4.
 *
 * `attribute_not_exists(id)` é a primitiva: a escrita condicional do DynamoDB é
 * atômica, então duas invocações concorrentes com a mesma chave não podem ambas
 * ter sucesso. A que falhar recebe `ConditionalCheckFailedException` e sabe que
 * a mensagem já foi processada.
 *
 * Por que isso importa aqui e não é preciosismo: SNS e SQS padrão entregam
 * *pelo menos uma vez*. Sem esta guarda, uma reentrega gera e-mail duplicado
 * (dano de reputação) ou contador de campanha inflado (relatório mentiroso).
 *
 * Limitação conhecida e aceita: a marca é gravada **antes** do efeito. Se o
 * processo morrer entre gravar a chave e concluir o trabalho, aquele item não
 * será reprocessado. Para o envio essa é a troca certa — é preferível um
 * destinatário a menos numa falha rara do que a chance de enviar duas vezes.
 */
export class DynamoIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async registrarSeNovo(chave: string, ttlSegundos: number): Promise<boolean> {
    const expiration = Math.floor(Date.now() / 1000) + ttlSegundos;

    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tabela,
          Item: { id: chave, expiration, registradoEm: new Date().toISOString() },
          ConditionExpression: 'attribute_not_exists(id)',
        }),
      );
      return true;
    } catch (erro) {
      if (ehFalhaDeCondicao(erro)) return false;
      // Qualquer outro erro sobe: tratar falha de infraestrutura como "já
      // processado" descartaria a mensagem silenciosamente.
      throw erro;
    }
  }

  /**
   * Apaga a marca para permitir a retentativa.
   *
   * Chamado apenas quando nenhum efeito externo aconteceu — throttling do SES,
   * conta suspensa, erro transitório. Sem isto, a mensagem voltaria da fila e
   * seria descartada como duplicata de uma tentativa que nunca enviou nada, e o
   * destinatário jamais receberia.
   */
  async liberar(chave: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tabela, Key: { id: chave } }));
  }
}

function ehFalhaDeCondicao(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'name' in erro &&
    erro.name === 'ConditionalCheckFailedException'
  );
}
