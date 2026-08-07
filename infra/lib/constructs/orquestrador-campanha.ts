import { Duration } from 'aws-cdk-lib';
import {
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
  Wait,
  WaitTime,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

export interface OrquestradorProps {
  readonly cfg: AmbienteConfig;
  readonly fnLauncher: IFunction;
  readonly fnVerificar: IFunction;
  readonly fnFinalizar: IFunction;
}

/**
 * Máquina de estados do disparo — ADR-05.
 *
 * O Step Functions **orquestra**; quem executa o envio é a fila com o `sender`.
 * A divisão é deliberada: a Distributed Map cobraria transição de estado por
 * destinatário e não oferece pausa nativa, enquanto o SQS dá controle de taxa,
 * retentativa e pausa lógica por centavos.
 *
 * O que se ganha em troca é o que o SQS não dá: histórico de execução — dá para
 * abrir uma campanha de três semanas atrás e ver exatamente onde ela parou — e
 * retomada sem código de checkpoint próprio.
 *
 * Fluxo:
 *
 *   Enfileirar → Aguardar ⇄ Verificar → Finalizar → Concluída
 *                              ├→ Encerrada (cancelada)
 *                              └→ Falha
 */
export function criarOrquestrador(escopo: Construct, props: OrquestradorProps): StateMachine {
  const { cfg } = props;

  const falha = new Fail(escopo, 'FalhaNoDisparo', {
    causePath: JsonPath.stringAt('$.erro.Cause'),
    errorPath: JsonPath.stringAt('$.erro.Error'),
  });

  const enfileirar = new LambdaInvoke(escopo, 'Enfileirar', {
    lambdaFunction: props.fnLauncher,
    payload: TaskInput.fromObject({
      tenantId: JsonPath.stringAt('$.tenantId'),
      campaignId: JsonPath.stringAt('$.campaignId'),
    }),
    // Só a carga útil segue adiante; o envelope do Lambda não interessa ao
    // próximo passo.
    payloadResponseOnly: true,
    resultPath: '$.resultadoEnfileiramento',
    // O launcher resolve milhares de contatos e consulta supressão em lote.
    taskTimeout: { seconds: 900 } as never,
  });

  enfileirar.addRetry({
    errors: ['States.TaskFailed', 'Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
    interval: Duration.seconds(5),
    maxAttempts: 3,
    backoffRate: 2,
  });

  /**
   * Só o enfileiramento tem `catch` para falha.
   *
   * Se a resolução da audiência falhar, nada foi enviado e a execução deve parar
   * ruidosamente. Depois desse ponto, mensagens já estão na fila e serão
   * processadas mesmo que o orquestrador morra — encerrar em erro ali daria a
   * impressão falsa de que nada saiu.
   */
  enfileirar.addCatch(falha, { errors: ['States.ALL'], resultPath: '$.erro' });

  const prepararLaco = new Pass(escopo, 'PrepararAcompanhamento', {
    parameters: {
      tenantId: JsonPath.stringAt('$.tenantId'),
      campaignId: JsonPath.stringAt('$.campaignId'),
      enfileirados: JsonPath.numberAt('$.resultadoEnfileiramento.enfileirados'),
      // Carimbado uma vez, no início. O passo de verificação calcula o decorrido
      // a partir daqui em vez de confiar no próprio relógio a cada volta.
      iniciadoEm: JsonPath.stringAt('$$.State.EnteredTime'),
    },
  });

  const aguardar = new Wait(escopo, 'Aguardar', {
    // Intervalo decidido pelo domínio, não fixo aqui: começa em 30s e vai a
    // 5min conforme o disparo se estende (ver `intervaloVerificacao`).
    time: WaitTime.secondsPath('$.esperarSegundos'),
  });

  const verificar = new LambdaInvoke(escopo, 'VerificarProgresso', {
    lambdaFunction: props.fnVerificar,
    payloadResponseOnly: true,
  });
  verificar.addRetry({
    errors: ['States.TaskFailed', 'Lambda.ServiceException'],
    interval: Duration.seconds(10),
    maxAttempts: 5,
    backoffRate: 2,
  });

  const finalizar = new LambdaInvoke(escopo, 'Finalizar', {
    lambdaFunction: props.fnFinalizar,
    payloadResponseOnly: true,
  });
  finalizar.addRetry({
    errors: ['States.TaskFailed', 'Lambda.ServiceException'],
    interval: Duration.seconds(10),
    maxAttempts: 5,
    backoffRate: 2,
  });

  const concluida = new Succeed(escopo, 'Concluida');
  const encerrada = new Succeed(escopo, 'Encerrada', {
    comment: 'Campanha cancelada ou já finalizada — nada a fazer.',
  });

  /**
   * A primeira verificação acontece **antes** da primeira espera.
   *
   * Uma campanha com audiência vazia — cenário comum na primeira importação,
   * quando a lista inteira está inelegível (§6.2) — seria concluída na hora, sem
   * o operador olhar para uma tela "enviando" por 30 segundos à toa.
   */
  const primeiraVerificacao = new Pass(escopo, 'PrimeiraVerificacao', {
    parameters: {
      tenantId: JsonPath.stringAt('$.tenantId'),
      campaignId: JsonPath.stringAt('$.campaignId'),
      enfileirados: JsonPath.numberAt('$.enfileirados'),
      iniciadoEm: JsonPath.stringAt('$.iniciadoEm'),
      esperarSegundos: 0,
    },
  });

  const decidir = new Choice(escopo, 'DecidirProximoPasso')
    .when(Condition.stringEquals('$.decisao', 'FINALIZAR'), finalizar)
    .when(Condition.stringEquals('$.decisao', 'FINALIZAR_COM_RESSALVA'), finalizar)
    .when(Condition.stringEquals('$.decisao', 'ENCERRAR'), encerrada)
    .otherwise(aguardar);

  aguardar.next(verificar);
  verificar.next(decidir);
  finalizar.next(concluida);

  const definicao = enfileirar.next(prepararLaco).next(primeiraVerificacao).next(verificar);

  const logs = new LogGroup(escopo, 'LogOrquestrador', {
    logGroupName: `/aws/vendedlogs/states/${nome(cfg, 'campanha')}`,
    retention: RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  return new StateMachine(escopo, 'OrquestradorCampanha', {
    stateMachineName: nome(cfg, 'campanha'),
    // Standard, não Express: o disparo dura horas e precisa de histórico
    // consultável. Express expira em 5 minutos e só guarda log.
    stateMachineType: StateMachineType.STANDARD,
    definitionBody: DefinitionBody.fromChainable(definicao),
    // Teto de segurança acima do limite de disparo do domínio (24h).
    timeout: Duration.hours(30),
    tracingEnabled: true,
    /**
     * Todos os eventos, sem os dados de execução.
     *
     * `ALL` porque o volume é irrisório — algumas campanhas por mês, algumas
     * centenas de transições cada — e porque investigar "por que a campanha de
     * três semanas atrás parou" com log parcial é adivinhação.
     *
     * `includeExecutionData: false` porque o payload carrega identificadores de
     * campanha e de tenant. Não é dado pessoal, mas log é o lugar onde dado
     * desnecessário se acumula por 30 dias sem que ninguém decida por isso
     * (§10.4).
     */
    logs: { destination: logs, level: LogLevel.ALL, includeExecutionData: false },
  });
}
