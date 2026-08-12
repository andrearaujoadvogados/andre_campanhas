/**
 * Configuração por ambiente — §9.1.
 *
 * O ID da conta NÃO fica hardcoded aqui (§9.1.1). Ele vem de variável de
 * ambiente, preenchida pelo GitHub Actions a partir de um secret. Não é
 * segredo, mas também não precisa estar em código versionado.
 */
export type Ambiente = 'dev' | 'prod';

export interface AmbienteConfig {
  readonly ambiente: Ambiente;
  readonly conta: string;
  /** Dados e regras de negócio — ADR-01. */
  readonly regiaoDados: string;
  /** SES e ingestão de eventos: onde a identidade já está verificada. */
  readonly regiaoEnvio: string;
  /** Exigência do CloudFront: o certificado precisa viver aqui. */
  readonly regiaoCertificado: string;
  readonly dominioPainel: string;
  readonly dominioRastreamento: string;
  readonly dominioEnvio: string;
  readonly mailFrom: string;
  /** Tenant único hoje; a chave existe desde o dia 1 — §12, V3. */
  readonly tenantPadrao: string;
  /** Cota inicial. Em runtime vale o SSM, sincronizado do SES (§1.3). */
  readonly envioPorSegundoInicial: number;
  readonly cotaDiariaInicial: number;
  /**
   * Destinatários dos alarmes, separados por vírgula.
   *
   * Plural de propósito: quem opera o sistema e quem responde pelo escritório
   * raramente são a mesma pessoa, e um alarme que chega só a um dos dois vira
   * silêncio quando essa pessoa está de férias.
   */
  readonly emailsAlarmes: readonly string[];
  /**
   * Caixa do escritório que recebe as respostas dos contatos — §1.4.
   *
   * **Ausente desliga o recurso inteiro**, e isso é o mecanismo de implantação,
   * não um descuido. Ligar o rastreamento troca o `Reply-To:` das campanhas por
   * um endereço nosso; se o MX ainda não apontar para o SES, as respostas dos
   * clientes iriam para um endereço que não recebe nada. Com a variável
   * ausente, o código sobe e fica dormente até o DNS estar pronto.
   *
   * Também é o que evita conflito entre ambientes: o SES admite **um** conjunto
   * de regras de recebimento ativo por região, e dev e prod dividem a mesma
   * conta. Só um dos dois define a variável.
   */
  readonly caixaRespostas: string | undefined;
  /** Subdomínio com MX apontando para o SES. Só vale com `caixaRespostas`. */
  readonly dominioRespostas: string;
  /** Identidade verificada que assina o encaminhamento das respostas. */
  readonly remetenteRespostas: string;
}

const BASE = {
  regiaoDados: 'sa-east-1',
  regiaoEnvio: 'us-east-2',
  regiaoCertificado: 'us-east-1',
  dominioEnvio: 'mail.andrearaujoadvogados.com.br',
  mailFrom: 'bounce.mail.andrearaujoadvogados.com.br',
  // Subdomínio próprio, e não o domínio de envio: o MX vai nele, e assim o
  // recebimento não encosta no e-mail que o escritório já usa (§1.4).
  dominioRespostas: 'respostas.mail.andrearaujoadvogados.com.br',
  // Coberto pela identidade de domínio já verificada — nada novo a verificar.
  remetenteRespostas: 'respostas@mail.andrearaujoadvogados.com.br',
  tenantPadrao: 'andrearaujo',
} as const;

function exigirEnv(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  }
  return v;
}

export function carregarConfig(ambiente: Ambiente): AmbienteConfig {
  const varConta = ambiente === 'prod' ? 'AWS_ACCOUNT_PROD' : 'AWS_ACCOUNT_DEV';
  const conta = process.env[varConta] ?? process.env['CDK_DEFAULT_ACCOUNT'];

  if (conta === undefined || conta === '') {
    throw new Error(
      `Conta AWS não definida para o ambiente "${ambiente}". ` +
        `Defina ${varConta} (ou CDK_DEFAULT_ACCOUNT para uso local).`,
    );
  }

  const comuns = {
    ...BASE,
    ambiente,
    conta,
    // Sem valor padrão de propósito: um endereço errado faria os alarmes de
    // bounce e reclamação irem para uma caixa que ninguém lê — que é pior que
    // não ter alarme, porque dá falsa sensação de cobertura (§10.4).
    emailsAlarmes: exigirEnv('EMAIL_ALARMES')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e !== ''),
    // Sem `exigirEnv`: a ausência é um estado válido e significa "recebimento
    // de respostas desligado".
    caixaRespostas: process.env['EMAIL_RESPOSTAS']?.trim() || undefined,
  };

  if (ambiente === 'prod') {
    return {
      ...comuns,
      ambiente: 'prod',
      dominioPainel: 'campanhas.andrearaujoadvogados.com.br',
      dominioRastreamento: 'link.mail.andrearaujoadvogados.com.br',
      // Cota de sandbox. Sobe sozinho quando a produção for liberada — o valor
      // real vem do SSM em runtime, este é só o ponto de partida.
      envioPorSegundoInicial: 1,
      cotaDiariaInicial: 200,
    };
  }

  return {
    ...comuns,
    ambiente: 'dev',
    dominioPainel: 'dev-campanhas.andrearaujoadvogados.com.br',
    dominioRastreamento: 'dev-link.mail.andrearaujoadvogados.com.br',
    envioPorSegundoInicial: 1,
    cotaDiariaInicial: 200,
  };
}

/** Prefixo de nome de recurso. Mantém dev e prod distinguíveis no console. */
export const nome = (cfg: AmbienteConfig, recurso: string): string =>
  `emailmkt-${cfg.ambiente}-${recurso}`;
