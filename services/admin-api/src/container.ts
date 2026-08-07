import {
  CanonicalContentHasher,
  DynamoAuditLogger,
  DynamoListRepository,
  DynamoMetricsRepository,
  DynamoTemplateRepository,
  EventBridgeCampaignScheduler,
  DynamoCampaignRepository,
  DynamoContactRepository,
  DynamoEventRepository,
  DynamoSendRepository,
  DynamoSuppressionRepository,
  S3Storage,
  SecretsProvider,
  Sha256EmailHasher,
  SystemClock,
  UuidGenerator,
  dynamoDoc,
  s3,
  secrets,
} from '@emailmkt/adapters-aws';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { SFNClient } from '@aws-sdk/client-sfn';
import { LiquidEmailRenderer } from '@emailmkt/email-render';
import type {
  AuditLogger,
  CampaignRepository,
  CampaignScheduler,
  EmailRenderer,
  EventRepository,
  ListRepository,
  SendRepository,
  MetricsRepository,
  TemplateRepository,
  Clock,
  ContactRepository,
  ContentHasher,
  EmailHasher,
  IdGenerator,
  SuppressionRepository,
} from '@emailmkt/core';

/**
 * Composition root — o único lugar do serviço que sabe quais implementações
 * concretas existem.
 *
 * Tudo abaixo daqui recebe as dependências por parâmetro e não importa nada de
 * `adapters-aws`. É o que torna os casos de uso testáveis com dublês (§5.1).
 */
export interface Dependencias {
  readonly contatos: ContactRepository;
  readonly campanhas: CampaignRepository;
  readonly agendador: CampaignScheduler;
  readonly templates: TemplateRepository;
  readonly listas: ListRepository;
  readonly metricas: MetricsRepository;
  readonly envios: SendRepository;
  readonly eventos: EventRepository;
  readonly renderer: EmailRenderer;
  readonly supressao: SuppressionRepository;
  readonly auditoria: AuditLogger;
  readonly armazenamento: S3Storage;
  readonly hasher: EmailHasher;
  readonly hasherConteudo: ContentHasher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

function exigirEnv(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') {
    // Falhar na inicialização, não na primeira requisição: uma variável faltando
    // vira erro no primeiro deploy em vez de um 500 intermitente semanas depois.
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }
  return valor;
}

let cache: Promise<Dependencias> | undefined;

/**
 * Montado uma vez por container de Lambda e reaproveitado entre invocações.
 *
 * O `await` existe porque o sal do hash de e-mail vem do Secrets Manager — não
 * pode estar em variável de ambiente em texto claro (§10.1). Buscá-lo a cada
 * requisição somaria uma chamada de rede a toda operação.
 */
export function obterDependencias(): Promise<Dependencias> {
  cache ??= montar();
  return cache;
}

async function montar(): Promise<Dependencias> {
  const tabela = exigirEnv('TABELA_PRINCIPAL');
  const doc = dynamoDoc();
  const ids = new UuidGenerator();

  const provedorSegredos = new SecretsProvider(secrets());
  const sal = await provedorSegredos.ler(exigirEnv('SEGREDO_HMAC_ARN'));
  const hasher = new Sha256EmailHasher(sal);

  return {
    contatos: new DynamoContactRepository(doc, tabela, hasher),
    campanhas: new DynamoCampaignRepository(doc, tabela),
    agendador: new EventBridgeCampaignScheduler(new SchedulerClient({}), new SFNClient({}), {
      grupo: exigirEnv('GRUPO_AGENDAMENTOS'),
      stateMachineArn: exigirEnv('ORQUESTRADOR_ARN'),
      papelArn: exigirEnv('PAPEL_SCHEDULER_ARN'),
    }),
    templates: new DynamoTemplateRepository(doc, tabela),
    listas: new DynamoListRepository(doc, tabela),
    metricas: new DynamoMetricsRepository(doc, tabela),
    envios: new DynamoSendRepository(doc, tabela),
    eventos: new DynamoEventRepository(doc, tabela),
    renderer: new LiquidEmailRenderer(),
    supressao: new DynamoSuppressionRepository(doc, tabela),
    auditoria: new DynamoAuditLogger(doc, tabela, ids),
    armazenamento: new S3Storage(s3(), exigirEnv('BUCKET_UPLOADS')),
    hasher,
    hasherConteudo: new CanonicalContentHasher(),
    clock: new SystemClock(),
    ids,
  };
}

/** Só para testes: injeta dublês no lugar dos adaptadores reais. */
export function definirDependenciasParaTeste(deps: Dependencias): void {
  cache = Promise.resolve(deps);
}
