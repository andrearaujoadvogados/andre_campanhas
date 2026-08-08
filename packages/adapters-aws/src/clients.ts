import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * Clientes AWS criados uma vez por container de Lambda.
 *
 * Fora do handler de propósito: instanciar cliente por invocação recria o pool
 * de conexões e refaz a resolução de credenciais a cada chamada, o que aparece
 * como latência inexplicável sob carga.
 *
 * `maxAttempts: 5` com `adaptive`: o modo adaptativo do SDK aprende com as
 * respostas de throttling e desacelera sozinho — exatamente o comportamento que
 * queremos com a cota apertada do SES (§5.5).
 */
const RETRY = { maxAttempts: 5, retryMode: 'adaptive' as const };

const regiaoDados = (): string => process.env['AWS_REGION'] ?? 'sa-east-1';
const regiaoEnvio = (): string => process.env['REGIAO_ENVIO'] ?? 'us-east-2';

let _dynamo: DynamoDBDocumentClient | undefined;
export function dynamoDoc(): DynamoDBDocumentClient {
  _dynamo ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: regiaoDados(), ...RETRY }), {
    marshallOptions: {
      // Atributo com undefined vira ausência do atributo, não erro. Simplifica
      // os mappers de campos opcionais.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
  return _dynamo;
}

let _ses: SESv2Client | undefined;
export function ses(): SESv2Client {
  // Região do SES é diferente da região dos dados — ADR-01. Esta é a única
  // chamada cross-region do caminho de envio.
  _ses ??= new SESv2Client({ region: regiaoEnvio(), ...RETRY });
  return _ses;
}

let _sqs: SQSClient | undefined;
export function sqs(): SQSClient {
  _sqs ??= new SQSClient({ region: regiaoDados(), ...RETRY });
  return _sqs;
}

let _s3: S3Client | undefined;
export function s3(): S3Client {
  _s3 ??= new S3Client({ region: regiaoDados(), ...RETRY });
  return _s3;
}

let _ssm: SSMClient | undefined;
export function ssm(): SSMClient {
  _ssm ??= new SSMClient({ region: regiaoDados(), ...RETRY });
  return _ssm;
}

let _cognito: CognitoIdentityProviderClient | undefined;
export function cognito(): CognitoIdentityProviderClient {
  // O user pool vive junto dos dados, em sa-east-1 — ADR-01.
  _cognito ??= new CognitoIdentityProviderClient({ region: regiaoDados(), ...RETRY });
  return _cognito;
}

let _secrets: SecretsManagerClient | undefined;
export function secrets(): SecretsManagerClient {
  _secrets ??= new SecretsManagerClient({ region: regiaoDados(), ...RETRY });
  return _secrets;
}

/** Só para testes: descarta os singletons entre casos. */
export function resetarClientes(): void {
  _dynamo = undefined;
  _ses = undefined;
  _sqs = undefined;
  _s3 = undefined;
  _ssm = undefined;
  _secrets = undefined;
  _cognito = undefined;
}
