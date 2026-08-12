import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  ConfigurationSet,
  ConfigurationSetEventDestination,
  EmailSendingEvent,
  EventDestination,
  HttpsPolicy,
  ReceiptRuleSet,
  SuppressionReasons,
  TlsPolicy,
} from 'aws-cdk-lib/aws-ses';
import { Lambda as AcaoLambda, S3 as AcaoS3 } from 'aws-cdk-lib/aws-ses-actions';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
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

    this.montarRecebimentoDeRespostas(cfg, props);

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

  /**
   * Recebimento das respostas dos contatos — §1.4.
   *
   * **Só existe quando `caixaRespostas` está definida.** O SES aceita um único
   * conjunto de regras de recebimento ativo por região, e dev e prod dividem a
   * conta: dois conjuntos brigariam pelo mesmo lugar. Mais importante, ligar
   * isto muda o `Reply-To:` das campanhas — sem o MX publicado, as respostas
   * dos clientes iriam para um endereço que não recebe nada. A variável de
   * ambiente é o interruptor, e ele começa desligado.
   *
   * O conjunto de regras **não é ativado** pelo CDK: a API de ativação é global
   * na região e não tem recurso CloudFormation. Ativar exige um comando, que
   * fica documentado no output.
   */
  private montarRecebimentoDeRespostas(cfg: AmbienteConfig, props: SendingStackProps): void {
    const caixa = cfg.caixaRespostas;
    if (caixa === undefined) return;

    /**
     * Onde a mensagem crua é gravada.
     *
     * A regra de recebimento precisa de um destino que guarde o e-mail inteiro:
     * o evento que a Lambda recebe traz cabeçalhos, mas não o corpo nem os
     * anexos — e é o corpo que o escritório precisa ler.
     *
     * Expira em 30 dias. É correspondência de cliente: manter cópia
     * indefinidamente num bucket seria um acervo de dado pessoal sem
     * finalidade, já que a mensagem foi encaminhada para a caixa do escritório
     * no minuto em que chegou (§10.2).
     */
    const bucket = new Bucket(this, 'BucketRespostas', {
      bucketName: `${nome(cfg, 'respostas')}-${this.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: 'expirar-respostas', expiration: Duration.days(30) }],
    });

    const fnReceiver = funcaoNode(this, {
      cfg,
      nomeLogico: 'reply-receiver',
      entry: join(RAIZ, 'services', 'workers', 'reply-receiver', 'src', 'handler.ts'),
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        BUCKET_RESPOSTAS: bucket.bucketName,
        PREFIXO_RESPOSTAS: PREFIXO_RESPOSTAS,
        CAIXA_RESPOSTAS: caixa,
        REMETENTE_ENCAMINHAMENTO: cfg.remetenteRespostas,
        FILA_DESTINO_URL: props.filaEventosDestinoUrl,
        REGIAO_DADOS: cfg.regiaoDados,
      },
    });

    bucket.grantRead(fnReceiver);
    fnReceiver.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [props.filaEventosDestinoArn],
      }),
    );
    fnReceiver.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        // Só a identidade do encaminhamento. Sem restrição, esta função poderia
        // enviar em nome de qualquer identidade da conta — inclusive disparar
        // campanha, que é trabalho de outra função.
        resources: [`arn:aws:ses:${cfg.regiaoEnvio}:${this.account}:identity/*`],
      }),
    );

    const conjunto = new ReceiptRuleSet(this, 'ConjuntoRegrasRespostas', {
      receiptRuleSetName: nome(cfg, 'respostas'),
    });

    conjunto.addRule('RegraRespostas', {
      // Só o subdomínio de respostas. Sem o recipiente explícito, a regra
      // valeria para **todo** e-mail que chegasse a qualquer domínio verificado
      // da conta — e o encaminhamento passaria a repassar o que não é resposta.
      recipients: [cfg.dominioRespostas],
      enabled: true,
      scanEnabled: true,
      // Exige TLS na entrega. Resposta de cliente é comunicação privilegiada;
      // aceitar em texto claro seria uma escolha difícil de justificar.
      tlsPolicy: TlsPolicy.REQUIRE,
      actions: [
        // Ordem importa: o S3 grava primeiro, a Lambda lê depois. Invertido, a
        // função procuraria um objeto que ainda não existe.
        new AcaoS3({ bucket, objectKeyPrefix: PREFIXO_RESPOSTAS }),
        new AcaoLambda({ function: fnReceiver }),
      ],
    });

    new CfnOutput(this, 'AvisoMxRespostas', {
      value: `MX 10 inbound-smtp.${cfg.regiaoEnvio}.amazonaws.com em ${cfg.dominioRespostas}`,
      description: 'Registro DNS pendente para o recebimento de respostas (§1.4)',
    });
    new CfnOutput(this, 'AtivarConjuntoRegras', {
      value: `aws ses set-active-receipt-rule-set --rule-set-name ${nome(cfg, 'respostas')} --region ${cfg.regiaoEnvio}`,
      description: 'O CDK cria o conjunto de regras, mas ativar exige este comando (uma vez)',
    });
  }
}

/** Prefixo das chaves no bucket. O worker monta a chave com ele + o messageId. */
const PREFIXO_RESPOSTAS = 'respostas/';
