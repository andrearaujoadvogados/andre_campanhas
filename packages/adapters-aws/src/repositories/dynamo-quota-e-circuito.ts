import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { CircuitBreaker, DailyQuotaCounter, TenantId } from '@emailmkt/core';

/**
 * Cota de 24h do SES — §5.6.
 *
 * O token bucket controla o ritmo dentro de uma invocação; esta contagem é
 * global e precisa sobreviver a Lambdas diferentes, então mora no banco.
 *
 * `ADD` com condição no mesmo comando é o que torna a reserva atômica: duas
 * invocações concorrentes não conseguem ambas passar do limite. Ler-e-depois-
 * escrever teria uma janela em que as duas leem 199 de 200 e as duas enviam.
 */
export class DynamoDailyQuotaCounter implements DailyQuotaCounter {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async reservar(tenantId: TenantId, diaUtc: string, limite: number): Promise<boolean> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tabela,
          Key: { id: `quota:${tenantId}:${diaUtc}` },
          UpdateExpression: 'ADD #usado :um SET #exp = :exp',
          // A condição roda ANTES do ADD: se já usou tudo, nada é incrementado.
          ConditionExpression: 'attribute_not_exists(#usado) OR #usado < :limite',
          ExpressionAttributeNames: { '#usado': 'usado', '#exp': 'expiration' },
          ExpressionAttributeValues: {
            ':um': 1,
            ':limite': limite,
            // TTL de 2 dias: o contador de ontem não serve para nada, e deixá-lo
            // acumular transformaria a tabela de idempotência num histórico.
            ':exp': Math.floor(Date.now() / 1000) + 172_800,
          },
        }),
      );
      return true;
    } catch (erro) {
      if (ehFalhaDeCondicao(erro)) return false;
      // Falha de infraestrutura não pode virar "cota disponível": enviar acima
      // do limite arrisca a reputação da conta (§14).
      throw erro;
    }
  }
}

/**
 * Circuit breaker — §5.5.
 *
 * Existe para um cenário específico: se o SES suspender a conta ou a credencial
 * quebrar, tentar as 5.000 mensagens da fila só serve para lotar a DLQ e
 * transformar um incidente de 5 minutos em uma tarde de reprocessamento.
 *
 * Só tem `abrir` e `estaAberto` — não há `fechar`. O fechamento é o TTL
 * expirando. Fechar manualmente exigiria saber que o problema acabou, e quem
 * sabe isso é a pessoa que investigou o alarme, não o código.
 */
export class DynamoCircuitBreaker implements CircuitBreaker {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabela: string,
  ) {}

  async estaAberto(chave: string): Promise<boolean> {
    const r = await this.doc.send(
      new GetCommand({
        TableName: this.tabela,
        Key: { id: `circuito:${chave}` },
        // Leitura consistente: o ponto do circuito é reagir depressa a uma
        // suspensão de conta. Leitura eventual continuaria disparando por
        // alguns segundos depois de o circuito abrir.
        ConsistentRead: true,
      }),
    );
    if (r.Item === undefined) return false;

    // O TTL do DynamoDB apaga em até 48h, não no instante exato. Conferir o
    // horário aqui evita que o circuito continue "aberto" muito depois do prazo.
    const expiration = Number(r.Item['expiration'] ?? 0);
    return expiration * 1000 > Date.now();
  }

  async abrir(chave: string, duracaoSegundos: number, motivo: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tabela,
        Item: {
          id: `circuito:${chave}`,
          expiration: Math.floor(Date.now() / 1000) + duracaoSegundos,
          motivo,
          abertoEm: new Date().toISOString(),
        },
      }),
    );
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
