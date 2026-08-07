import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  ConfigurationSet,
  ConfigurationSetEventDestination,
  EmailSendingEvent,
  EventDestination,
  HttpsPolicy,
  SuppressionReasons,
} from 'aws-cdk-lib/aws-ses';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';
import { funcaoNode } from '../constructs/lambda-node.js';
import { criarAlarmesDeReputacao } from '../constructs/alarmes.js';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

export interface SendingStackProps extends StackProps {
  readonly cfg: AmbienteConfig;
  /** Fila de destino em sa-east-1 — para onde a ponte entrega (ADR-01). */
  readonly filaEventosDestinoArn: string;
  readonly filaEventosDestinoUrl: string;
}

/**
 * Envio em us-east-2 — onde a identidade já está verificada (§1.1).
 *
 * Esta stack **não cria** a identidade de domínio, o DKIM nem o MAIL FROM: eles
 * já existem e foram verificados fora do CDK. Recriá-los aqui geraria conflito e
 * colocaria em risco a reputação já construída, que é um ativo que não se
 * transfere entre regiões nem entre contas (ADR-01, §9.1.1).
 *
 * O que roda aqui é só o mínimo: o Configuration Set, o destino de evento e uma
 * ponte sem regra de negócio. Toda decisão sobre os dados acontece em sa-east-1.
 */
export class SendingStack extends Stack {
  constructor(escopo: Construct, id: string, props: SendingStackProps) {
    super(escopo, id, props);
    const { cfg } = props;

    const topico = new Topic(this, 'TopicoEventos', {
      topicName: nome(cfg, 'ses-events'),
      displayName: 'Eventos de envio do SES',
      // Recusa publicação fora de TLS. Os eventos carregam endereço de e-mail
      // do destinatário — é dado pessoal em trânsito (§10.1).
      enforceSSL: true,
    });

    const dlq = new Queue(this, 'EventInboxDlq', {
      queueName: nome(cfg, 'event-inbox-dlq'),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    // A fila entre SNS e Lambda é o ponto do ADR-03: sem ela, um incidente
    // prolongado no consumidor perderia eventos de bounce e reclamação — que são
    // exatamente os que não podem ser perdidos.
    const filaEntrada = new Queue(this, 'EventInbox', {
      queueName: nome(cfg, 'event-inbox'),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.minutes(2),
      retentionPeriod: Duration.days(14),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    topico.addSubscription(new SqsSubscription(filaEntrada, { rawMessageDelivery: true }));

    const configSet = new ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: nome(cfg, 'config-set'),
      // Domínio de rastreamento próprio: evita links awstrack.me visíveis no
      // e-mail de um escritório de advocacia (§9.1.2). Quem termina o TLS desse
      // subdomínio é a distribuição de rastreamento da WebStack.
      customTrackingRedirectDomain: cfg.dominioRastreamento,
      // O padrão do CDK aqui é OPTIONAL, que embrulha o pixel de abertura em
      // `http://`. Cliente de e-mail moderno bloqueia conteúdo HTTP dentro de
      // mensagem HTTPS, e a métrica de abertura vem subnotificada sem que nada
      // acuse erro. Com certificado próprio no subdomínio, não há motivo para
      // aceitar o downgrade.
      customTrackingHttpsPolicy: HttpsPolicy.REQUIRE,
      // Segunda camada de defesa. A fonte da verdade é a nossa lista de
      // supressão; esta é a rede de segurança da conta (§11, item 6).
      suppressionReasons: SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      sendingEnabled: true,
    });

    new ConfigurationSetEventDestination(this, 'DestinoEventos', {
      configurationSet: configSet,
      destination: EventDestination.snsTopic(topico),
      enabled: true,
      events: [
        EmailSendingEvent.SEND,
        EmailSendingEvent.DELIVERY,
        EmailSendingEvent.OPEN,
        EmailSendingEvent.CLICK,
        EmailSendingEvent.BOUNCE,
        EmailSendingEvent.COMPLAINT,
        EmailSendingEvent.REJECT,
        EmailSendingEvent.RENDERING_FAILURE,
        EmailSendingEvent.DELIVERY_DELAY,
      ],
    });

    /**
     * A ponte. Deliberadamente burra: repassa o payload íntegro e não interpreta
     * nada. Se ela tivesse regra de negócio, teríamos lógica de domínio rodando
     * fora de sa-east-1 — que é justamente o que o ADR-01 quis evitar.
     */
    const fnForwarder = funcaoNode(this, {
      cfg,
      nomeLogico: 'event-forwarder',
      entry: join(RAIZ, 'services', 'workers', 'event-forwarder', 'src', 'handler.ts'),
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: {
        FILA_DESTINO_URL: props.filaEventosDestinoUrl,
        REGIAO_DADOS: cfg.regiaoDados,
      },
    });

    filaEntrada.grantConsumeMessages(fnForwarder);
    fnForwarder.addEventSource(
      new SqsEventSource(filaEntrada, { batchSize: 10, reportBatchItemFailures: true }),
    );

    // Permissão explícita em vez de grant: a fila está em outra região e outra
    // stack — referenciá-la pelo construto criaria acoplamento cross-region
    // desnecessário só para gerar esta mesma política.
    fnForwarder.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
        resources: [props.filaEventosDestinoArn],
      }),
    );

    /**
     * Os alarmes de reputação vivem aqui, não no núcleo.
     *
     * O SES publica `Reputation.BounceRate` e `Reputation.ComplaintRate` na
     * região de envio, e o CloudWatch não consulta métrica de outra região.
     * Criá-los em sa-east-1 produziria alarmes que nunca disparam — a falha
     * mais perigosa possível, porque tudo pareceria configurado.
     */
    const topicoReputacao = criarAlarmesDeReputacao(this, cfg, cfg.emailsAlarmes);

    new CfnOutput(this, 'TopicoAlarmesReputacaoArn', { value: topicoReputacao.topicArn });
    new CfnOutput(this, 'ConfigurationSetName', { value: configSet.configurationSetName });
    new CfnOutput(this, 'TopicoEventosArn', { value: topico.topicArn });
    new CfnOutput(this, 'AvisoDns', {
      value: `Criar CNAME ${cfg.dominioRastreamento} conforme o console do SES nesta regiao`,
      description: 'Registro DNS pendente para o dominio de rastreamento (§9.1.2)',
    });
  }
}
