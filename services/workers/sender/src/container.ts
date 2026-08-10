import {
  CanonicalContentHasher,
  DynamoCampaignRepository,
  DynamoCircuitBreaker,
  DynamoContactRepository,
  DynamoDailyQuotaCounter,
  DynamoIdempotencyStore,
  DynamoSendRepository,
  DynamoSuppressionRepository,
  FakeEmailProvider,
  HmacUnsubscribeTokenService,
  SecretsProvider,
  SesEmailProvider,
  Sha256EmailHasher,
  SqsSendQueuePublisher,
  DynamoTemplateRepository,
  SsmConfigProvider,
  SystemClock,
  dynamoDoc,
  secrets,
  ses,
  sqs,
  ssm,
} from '@emailmkt/adapters-aws';
import { LiquidEmailRenderer } from '@emailmkt/email-render';
import type { ConfigProvider, DepsEnvio, SendQueuePublisher } from '@emailmkt/core';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

/** Log estruturado — §10.4. Sem PII: e-mails nunca aparecem em claro. */
export const log = {
  info: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ nivel: 'INFO', worker: 'sender', mensagem, ...dados })),
  error: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ nivel: 'ERROR', worker: 'sender', mensagem, ...dados })),
};

export interface ConfigSender {
  readonly baseUrlDescadastro: string;
  readonly configurationSet: string;
}

let cacheConfig: ConfigSender | undefined;
export async function config(): Promise<ConfigSender> {
  cacheConfig ??= {
    baseUrlDescadastro: env('URL_DESCADASTRO'),
    configurationSet: env('CONFIGURATION_SET'),
  };
  return cacheConfig;
}

export interface DependenciasSender {
  readonly envio: DepsEnvio;
  readonly fila: SendQueuePublisher;
  readonly configuracao: ConfigProvider;
}

let cache: Promise<DependenciasSender> | undefined;

export function montarDependenciasEnvio(): Promise<DependenciasSender> {
  cache ??= montar();
  return cache;
}

async function montar(): Promise<DependenciasSender> {
  const tabela = env('TABELA_PRINCIPAL');
  const tabelaIdem = env('TABELA_IDEMPOTENCIA');
  const doc = dynamoDoc();

  const segredos = new SecretsProvider(secrets());
  const segredo = await segredos.ler(env('SEGREDO_HMAC_ARN'));

  const hasher = new Sha256EmailHasher(segredo);

  /**
   * Em desenvolvimento, o provedor falso.
   *
   * A conta `dev` já fica em sandbox do SES por desenho, mas sandbox ainda envia
   * para endereços verificados — e um endereço da equipe recebendo uma campanha
   * de teste com dado de cliente real seria vazamento (§9.1).
   */
  const provedor =
    process.env['AMBIENTE'] === 'dev' && process.env['USAR_SES_EM_DEV'] !== 'true'
      ? new FakeEmailProvider()
      : new SesEmailProvider(ses());

  return {
    envio: {
      campanhas: new DynamoCampaignRepository(doc, tabela),
      contatos: new DynamoContactRepository(doc, tabela, hasher),
      envios: new DynamoSendRepository(doc, tabela),
      templates: new DynamoTemplateRepository(doc, tabela),
      supressao: new DynamoSuppressionRepository(doc, tabela),
      provedor,
      renderer: new LiquidEmailRenderer(),
      tokens: new HmacUnsubscribeTokenService(segredo),
      hasher,
      idempotencia: new DynamoIdempotencyStore(doc, tabelaIdem),
      cotaDiaria: new DynamoDailyQuotaCounter(doc, tabelaIdem),
      circuito: new DynamoCircuitBreaker(doc, tabelaIdem),
      clock: new SystemClock(),
    },
    fila: new SqsSendQueuePublisher(sqs(), env('FILA_ENVIO')),
    configuracao: new SsmConfigProvider(ssm(), {
      taxa: env('PARAM_TAXA'),
      cota: env('PARAM_COTA'),
    }),
  };
}

export { CanonicalContentHasher };
