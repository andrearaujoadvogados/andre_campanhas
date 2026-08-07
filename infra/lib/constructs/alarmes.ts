import { Duration } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

/**
 * Alarmes — §10.4.
 *
 * Os limiares são os mesmos que o domínio usa para classificar risco no
 * relatório (`LIMIAR_BOUNCE_*` em packages/core). Se divergissem, o painel
 * mostraria "tudo bem" enquanto o alarme dispara — ou o contrário, que é pior.
 *
 * `treatMissingData: NOT_BREACHING` em quase todos: este sistema fica dias sem
 * enviar nada, e ausência de dado não é problema. O padrão do CloudWatch é
 * tratar dado ausente como violação, o que encheria a caixa de alarme falso
 * todo fim de semana — e alarme que grita à toa é alarme que se ignora.
 */
export interface AlarmesProps {
  readonly cfg: AmbienteConfig;
  readonly filaEnvio: IQueue;
  readonly dlqs: readonly { readonly nome: string; readonly fila: IQueue }[];
  readonly fnSender: IFunction;
  readonly configurationSet: string;
}

export function criarAlarmes(escopo: Construct, props: AlarmesProps): Topic {
  const { cfg } = props;

  const topico = new Topic(escopo, 'TopicoAlarmes', {
    topicName: nome(cfg, 'alarmes'),
    displayName: 'Alarmes do sistema de campanhas',
    enforceSSL: true,
  });

  /**
   * Cada endereço recebe um e-mail de confirmação e **precisa clicar**.
   *
   * Até alguém confirmar, a inscrição fica pendente e o alarme dispara para o
   * vazio. É o pior estado possível — parece protegido e não está —, e por isso
   * está no checklist do primeiro deploy em docs/DEPLOY.md.
   */
  for (const email of cfg.emailsAlarmes) {
    topico.addSubscription(new EmailSubscription(email));
  }

  const acao = new SnsAction(topico);

  const alarme = (
    id: string,
    metrica: IMetric,
    limiar: number,
    descricao: string,
    opcoes: {
      periodos?: number;
      comparador?: ComparisonOperator;
      dadoAusente?: TreatMissingData;
    } = {},
  ): Alarm => {
    const a = new Alarm(escopo, id, {
      alarmName: `${nome(cfg, id)}`,
      alarmDescription: descricao,
      metric: metrica,
      threshold: limiar,
      evaluationPeriods: opcoes.periodos ?? 1,
      comparisonOperator: opcoes.comparador ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: opcoes.dadoAusente ?? TreatMissingData.NOT_BREACHING,
    });
    a.addAlarmAction(acao);
    return a;
  };

  /**
   * Reputação — os dois números que podem custar a conta.
   *
   * O SES publica `Reputation.BounceRate` e `Reputation.ComplaintRate` como
   * médias móveis por conta, na região de envio. Métricas cross-region no
   * CloudWatch não existem, então estes alarmes precisam ser criados na stack de
   * `us-east-2` — ver `criarAlarmesDeReputacao`.
   */

  // ── Fila de envio parada ───────────────────────────────────────────────────

  alarme(
    'fila-envio-parada',
    props.filaEnvio.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5) }),
    3600,
    'Mensagem parada na fila de envio há mais de 1 hora. Campanha travada, ou o worker parou. ' +
      'Ver docs/RUNBOOK.md, "Incidente: fila de envio parada".',
    { periodos: 2 },
  );

  // ── DLQ ────────────────────────────────────────────────────────────────────

  for (const { nome: nomeFila, fila } of props.dlqs) {
    alarme(
      `dlq-${nomeFila}`,
      fila.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      0,
      `Mensagem na fila de descarte "${nomeFila}". Qualquer item aqui exige inspeção humana — ` +
        'ver docs/RUNBOOK.md, "Incidente: mensagens na DLQ".',
    );
  }

  // ── Falha do worker de envio ───────────────────────────────────────────────

  alarme(
    'erros-sender',
    props.fnSender.metricErrors({ period: Duration.minutes(5) }),
    5,
    'Erros repetidos no worker de envio. Costuma ser credencial ou permissão do SES.',
  );

  /**
   * Campanha presa em ENVIANDO.
   *
   * Métrica publicada pelo próprio orquestrador não existe ainda; este alarme
   * usa a idade da mensagem mais antiga como aproximação. A verificação exata
   * está no domínio (`LIMITE_DISPARO_SEGUNDOS`), que finaliza com ressalva
   * depois de 24h — então o pior caso já tem tratamento, e este alarme serve
   * para avisar antes disso.
   */

  return topico;
}

/**
 * Alarmes de reputação — precisam viver em `us-east-2`.
 *
 * O SES publica as métricas de reputação na região de envio, e o CloudWatch não
 * consulta métrica de outra região. Criar estes alarmes em `sa-east-1` produziria
 * alarmes que nunca disparam — o modo de falha mais perigoso possível aqui,
 * porque tudo pareceria configurado.
 */
export function criarAlarmesDeReputacao(
  escopo: Construct,
  cfg: AmbienteConfig,
  emails: readonly string[],
): Topic {
  const topico = new Topic(escopo, 'TopicoAlarmesReputacao', {
    topicName: nome(cfg, 'alarmes-reputacao'),
    displayName: 'Alarmes de reputação do SES',
    enforceSSL: true,
  });

  for (const email of emails) {
    topico.addSubscription(new EmailSubscription(email));
  }

  const acao = new SnsAction(topico);

  const metrica = (nomeMetrica: string) =>
    new Metric({
      namespace: 'AWS/SES',
      metricName: nomeMetrica,
      statistic: 'Average',
      period: Duration.minutes(15),
    });

  /**
   * Limiares espelhados de `packages/core/src/domain/report/metricas.ts`.
   *
   * Não importados de lá de propósito: o CDK não deve depender do domínio, e
   * duplicar quatro números é melhor que criar essa dependência. O comentário é
   * o vínculo — se um mudar, o outro precisa mudar junto.
   */
  const bounce = new Alarm(escopo, 'taxa-bounce', {
    alarmName: nome(cfg, 'taxa-bounce'),
    alarmDescription:
      'Taxa de bounce acima de 5%. Acima de ~10% a AWS pode SUSPENDER A CONTA. ' +
      'Pare as campanhas e higienize a lista antes de retomar.',
    metric: metrica('Reputation.BounceRate'),
    threshold: 0.05,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  bounce.addAlarmAction(acao);

  const reclamacao = new Alarm(escopo, 'taxa-reclamacao', {
    alarmName: nome(cfg, 'taxa-reclamacao'),
    alarmDescription:
      'Reclamações de spam acima de 0,1%. O limite prático de Gmail e Yahoo é 0,3% — ' +
      'acima disso os e-mails passam a cair em spam para todos os destinatários.',
    metric: metrica('Reputation.ComplaintRate'),
    threshold: 0.001,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  reclamacao.addAlarmAction(acao);

  return topico;
}
