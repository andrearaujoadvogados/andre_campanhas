import {
  DynamoAuditLogger,
  DynamoContactRepository,
  DynamoSuppressionRepository,
  HmacUnsubscribeTokenService,
  SecretsProvider,
  Sha256EmailHasher,
  SystemClock,
  UuidGenerator,
  dynamoDoc,
  secrets,
} from '@emailmkt/adapters-aws';
import type {
  AuditLogger,
  Clock,
  ContactRepository,
  EmailHasher,
  SuppressionRepository,
  UnsubscribeTokenService,
} from '@emailmkt/core';

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

export interface DependenciasPublicas {
  readonly contatos: ContactRepository;
  readonly supressao: SuppressionRepository;
  readonly tokens: UnsubscribeTokenService;
  readonly hasher: EmailHasher;
  readonly clock: Clock;
  readonly auditoria: AuditLogger;
}

let cache: Promise<DependenciasPublicas> | undefined;

/**
 * Composition root do endpoint público.
 *
 * Este serviço é a **única superfície do sistema exposta sem autenticação**
 * (ADR-04), e o conjunto de dependências reflete isso: só o que é preciso para
 * verificar um token e mudar o status de um contato. Nada de fila, nada de SES,
 * nada de S3 — o que não está aqui não pode ser abusado a partir daqui.
 */
export function obterDependencias(): Promise<DependenciasPublicas> {
  cache ??= montar();
  return cache;
}

async function montar(): Promise<DependenciasPublicas> {
  const tabela = env('TABELA_PRINCIPAL');
  const doc = dynamoDoc();

  const segredo = await new SecretsProvider(secrets()).ler(env('SEGREDO_HMAC_ARN'));
  const hasher = new Sha256EmailHasher(segredo);

  return {
    contatos: new DynamoContactRepository(doc, tabela, hasher),
    supressao: new DynamoSuppressionRepository(doc, tabela),
    tokens: new HmacUnsubscribeTokenService(segredo),
    hasher,
    clock: new SystemClock(),
    auditoria: new DynamoAuditLogger(doc, tabela, new UuidGenerator()),
  };
}

/** Só para testes. */
export function definirDependenciasParaTeste(deps: DependenciasPublicas): void {
  cache = Promise.resolve(deps);
}

export const log = {
  info: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ nivel: 'INFO', servico: 'public-api', mensagem, ...dados })),
  error: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ nivel: 'ERROR', servico: 'public-api', mensagem, ...dados })),
};
