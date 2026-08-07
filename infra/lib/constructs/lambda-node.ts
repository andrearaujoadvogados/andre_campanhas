import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

/**
 * Padrões que toda Lambda do projeto herda — ADR-04, §10.1, §10.4.
 *
 * Centralizar aqui não é preferência de estilo: retenção de log e tracing
 * configurados caso a caso viram inconsistência silenciosa, e o padrão do
 * CloudWatch é reter log para sempre — que é vazamento de custo e de dados
 * pessoais ao mesmo tempo (§10.1).
 */
export interface FuncaoNodeProps extends Omit<NodejsFunctionProps, 'runtime' | 'architecture'> {
  readonly cfg: AmbienteConfig;
  readonly nomeLogico: string;
}

export function funcaoNode(escopo: Construct, props: FuncaoNodeProps): NodejsFunction {
  const { cfg, nomeLogico, environment, ...resto } = props;
  const nomeFuncao = nome(cfg, nomeLogico);

  // LogGroup explícito em vez de `logRetention` (depreciado): sem isto o padrão
  // do CloudWatch é reter para sempre, que é vazamento de custo e de dados
  // pessoais ao mesmo tempo — §10.1, §13.
  const logGroup = new LogGroup(escopo, `${nomeLogico}Logs`, {
    logGroupName: `/aws/lambda/${nomeFuncao}`,
    retention: RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  return new NodejsFunction(escopo, nomeLogico, {
    functionName: nomeFuncao,
    // ARM64: ~20% mais barato com o mesmo desempenho para Node (ADR-04).
    architecture: Architecture.ARM_64,
    runtime: Runtime.NODEJS_22_X,
    memorySize: 512,
    timeout: Duration.seconds(30),
    logGroup,
    tracing: Tracing.ACTIVE,
    bundling: {
      minify: true,
      sourceMap: true,
      target: 'node22',
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      AMBIENTE: cfg.ambiente,
      TENANT_PADRAO: cfg.tenantPadrao,
      POWERTOOLS_SERVICE_NAME: nomeLogico,
      POWERTOOLS_LOG_LEVEL: cfg.ambiente === 'prod' ? 'INFO' : 'DEBUG',
      ...environment,
    },
    ...resto,
  });
}
