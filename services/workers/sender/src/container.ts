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
  /**
   * Domínio que recebe as respostas — §1.4. Opcional de propósito.
   *
   * Sem a variável, o `Reply-To:` continua sendo o da campanha e o
   * rastreamento de respostas simplesmente não existe. É o que permite subir o
   * código antes de o MX estar publicado: enquanto o DNS não aponta para o SES,
   * apontar o `Reply-To:` para lá mandaria as respostas dos clientes para um
   * endereço que não recebe nada.
   */
  readonly dominioRespostas: string | undefined;
}

let cacheConfig: ConfigSender | undefined;
export async function config(): Promise<ConfigSender> {
  cacheConfig ??= {
    baseUrlDescadastro: env('URL_DESCADASTRO'),
    configurationSet: env('CONFIGURATION_SET'),
    dominioRespostas: process.env['DOMINIO_RESPOSTAS'],
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
