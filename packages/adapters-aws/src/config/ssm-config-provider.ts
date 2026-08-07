import { GetParametersCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { ConfigProvider, QuotaConfig } from '@emailmkt/core';

/**
 * Cota do SES lida do Parameter Store — §1.3, §5.6.
 *
 * O ponto desta indireção: a conta está em sandbox (1 msg/s, 200/dia) e o acesso
 * a produção está em análise. Quando for liberado, o worker `quota-sync`
 * atualiza estes parâmetros e o limitador passa a usar o valor novo **sem
 * deploy**. Cota fixada em variável de ambiente exigiria republicar as Lambdas
 * num dia em que ninguém vai lembrar disso.
 *
 * O cache de 60s existe porque o `sender` roda em lote e leria o parâmetro
 * milhares de vezes por campanha. Um minuto de defasagem é irrelevante para uma
 * cota que muda uma vez por trimestre.
 */
export class SsmConfigProvider implements ConfigProvider {
  private cache: { valor: QuotaConfig; expiraEm: number } | undefined;

  constructor(
    private readonly cliente: SSMClient,
    private readonly nomes: { readonly taxa: string; readonly cota: string },
    private readonly ttlMs = 60_000,
  ) {}

  async lerQuota(): Promise<QuotaConfig> {
    const agora = Date.now();
    if (this.cache !== undefined && this.cache.expiraEm > agora) return this.cache.valor;

    const r = await this.cliente.send(
      new GetParametersCommand({ Names: [this.nomes.taxa, this.nomes.cota] }),
    );

    const porNome = new Map((r.Parameters ?? []).map((p) => [p.Name, p.Value]));
    const taxa = numero(porNome.get(this.nomes.taxa));
    const cota = numero(porNome.get(this.nomes.cota));

    if (taxa === undefined || cota === undefined) {
      // Sem cota conhecida, o certo é parar. Assumir um padrão otimista faria o
      // sistema disparar acima do limite e arriscar a reputação da conta — o
      // ativo mais frágil do projeto (§14).
      throw new Error(
        `Parâmetros de cota do SES ausentes ou inválidos: ${this.nomes.taxa}, ${this.nomes.cota}.`,
      );
    }

    const valor: QuotaConfig = { maxEnviosPorSegundo: taxa, cotaDiaria: cota };
    this.cache = { valor, expiraEm: agora + this.ttlMs };
    return valor;
  }
}

function numero(bruto: string | undefined): number | undefined {
  if (bruto === undefined) return undefined;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Leitura de segredo do Secrets Manager, com cache no container.
 *
 * O segredo HMAC assina os links de descadastro. Buscá-lo a cada invocação
 * somaria uma chamada de rede — e um custo por chamada — a cada e-mail enviado.
 */
export class SecretsProvider {
  private readonly cache = new Map<string, { valor: string; expiraEm: number }>();

  constructor(
    private readonly cliente: SecretsManagerClient,
    private readonly ttlMs = 300_000,
  ) {}

  async ler(secretId: string): Promise<string> {
    const agora = Date.now();
    const emCache = this.cache.get(secretId);
    if (emCache !== undefined && emCache.expiraEm > agora) return emCache.valor;

    const r = await this.cliente.send(new GetSecretValueCommand({ SecretId: secretId }));
    const valor = r.SecretString;
    if (valor === undefined || valor === '') {
      throw new Error(`Segredo ${secretId} vazio ou inacessível.`);
    }

    this.cache.set(secretId, { valor, expiraEm: agora + this.ttlMs });
    return valor;
  }
}
