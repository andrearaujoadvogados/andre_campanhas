import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  FunctionUrlAuthType,
  StartingPosition,
  HttpMethod as LambdaHttpMethod,
} from 'aws-cdk-lib/aws-lambda';
import {
  AccountRecovery,
  Mfa,
  UserPool,
  UserPoolClient,
  CfnUserPoolGroup,
} from 'aws-cdk-lib/aws-cognito';
import type { CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement, Effect, ServicePrincipal, Role } from 'aws-cdk-lib/aws-iam';
import { CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';
import { funcaoNode } from '../constructs/lambda-node.js';
import { criarOrquestrador } from '../constructs/orquestrador-campanha.js';
import { criarAlarmes } from '../constructs/alarmes.js';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const svc = (...p: string[]): string => join(RAIZ, 'services', ...p, 'src', 'handler.ts');

export interface CoreStackProps extends StackProps {
  readonly cfg: AmbienteConfig;
}

/**
 * Núcleo em sa-east-1 — dados e regras de negócio (ADR-01).
 *
 * Nenhum recurso aqui vive em VPC, e isso é deliberado: DynamoDB e SQS são
 * acessados pela API pública com IAM, o que dispensa NAT Gateway (~US$ 35/mês,
 * mais caro que todo o resto da arquitetura somada — §13).
 */
export class CoreStack extends Stack {
  readonly tabelaPrincipal: Table;
  readonly filaEventos: Queue;
  /** Lidos pela stack do painel para montar o `config.json` — ver bin/app.ts. */
  readonly apiUrl: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;

  constructor(escopo: Construct, id: string, props: CoreStackProps) {
    super(escopo, id, props);
    const { cfg } = props;
    const destruirComStack = cfg.ambiente === 'dev';

    // ── Persistência ─────────────────────────────────────────────────────────

    this.tabelaPrincipal = new Table(this, 'TabelaPrincipal', {
      tableName: nome(cfg, 'main'),
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      // Sob demanda: custo ocioso zero, critério dominante do projeto (ADR-02).
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      // O Stream é o outbox — evita escrita dupla sem transação distribuída (§5.11).
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      removalPolicy: destruirComStack ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // GSIs conforme os padrões de acesso da §6.3.
    for (const [indice, comentario] of [
      ['gsi1', 'contato por e-mail'],
      ['gsi2', 'listas de um contato (invertido)'],
      ['gsi3', 'contatos e campanhas por status'],
      ['gsi4', 'envio por sesMessageId — correlação de evento'],
    ] as const) {
      this.tabelaPrincipal.addGlobalSecondaryIndex({
        indexName: indice,
        partitionKey: { name: `${indice}pk`, type: AttributeType.STRING },
        sortKey: { name: `${indice}sk`, type: AttributeType.STRING },
        projectionType: ProjectionType.ALL,
      });
      void comentario;
    }

    const tabelaIdempotencia = new Table(this, 'TabelaIdempotencia', {
      tableName: nome(cfg, 'idempotency'),
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiration',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── Armazenamento ────────────────────────────────────────────────────────

    const bucketUploads = new Bucket(this, 'BucketUploads', {
      bucketName: `${nome(cfg, 'uploads')}-${this.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: destruirComStack ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // CSV importado é dado pessoal bruto. Não guardar além do necessário
          // para auditar a importação — minimização, §10.2.
          id: 'expirar-csv-importado',
          prefix: 'imports/',
          expiration: Duration.days(90),
        },
        {
          // Export de portabilidade tem link presignado de vida curta.
          id: 'expirar-exports-lgpd',
          prefix: 'exports/',
          expiration: Duration.days(7),
        },
      ],
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: [`https://${cfg.dominioPainel}`],
          allowedHeaders: ['*'],
          maxAge: 300,
        },
      ],
    });

    // ── Filas ────────────────────────────────────────────────────────────────

    const criarFila = (nomeLogico: string, visibilidade: Duration): { fila: Queue; dlq: Queue } => {
      const dlq = new Queue(this, `${nomeLogico}Dlq`, {
        queueName: nome(cfg, `${nomeLogico}-dlq`),
        encryption: QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        retentionPeriod: Duration.days(14),
      });
      const fila = new Queue(this, nomeLogico, {
        queueName: nome(cfg, nomeLogico),
        encryption: QueueEncryption.SQS_MANAGED,
        enforceSSL: true,
        visibilityTimeout: visibilidade,
        retentionPeriod: Duration.days(14),
        // 5 tentativas antes da DLQ: com cota de 1 msg/s, throttling é o fluxo
        // normal e não deve consumir o orçamento de retentativa (§5.5).
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });
      return { fila, dlq };
    };

    const { fila: filaEnvio, dlq: dlqEnvio } = criarFila('send-queue', Duration.minutes(6));
    const { fila: filaEventos, dlq: dlqEventos } = criarFila('event-queue', Duration.minutes(3));
    const { fila: filaImport, dlq: dlqImport } = criarFila('import-queue', Duration.minutes(16));
    this.filaEventos = filaEventos;

    // ── Configuração e segredos ──────────────────────────────────────────────

    // Parameter Store Standard é gratuito — usar aqui e não no Secrets Manager
    // economiza US$ 0,40/mês por parâmetro (§13).
    const paramTaxa = new StringParameter(this, 'ParamTaxaEnvio', {
      parameterName: `/emailmkt/${cfg.ambiente}/ses/maxSendRate`,
      stringValue: String(cfg.envioPorSegundoInicial),
      description: 'Envios por segundo. Sincronizado do SES pelo worker quota-sync.',
    });
    const paramCota = new StringParameter(this, 'ParamCotaDiaria', {
      parameterName: `/emailmkt/${cfg.ambiente}/ses/dailyQuota`,
      stringValue: String(cfg.cotaDiariaInicial),
      description: 'Cota de 24h. Sincronizada do SES pelo worker quota-sync.',
    });

    // Único segredo do sistema — o resto é configuração (§13).
    const segredoHmac = new Secret(this, 'SegredoUnsubscribe', {
      secretName: nome(cfg, 'unsubscribe-hmac'),
      description: 'Chave HMAC dos tokens de descadastro. Rotacionável.',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: destruirComStack ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // ── Autenticação ─────────────────────────────────────────────────────────

    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: nome(cfg, 'usuarios'),
      selfSignUpEnabled: false, // Equipe fechada: contas criadas por admin.
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      /**
       * MFA obrigatório para todos — desvio deliberado do §10.1.
       *
       * O documento pedia MFA obrigatório só para ADMIN. O Cognito não faz MFA
       * por grupo nativamente: exigiria fluxo de autenticação customizado. Como
       * são menos de 20 usuários e o sistema envia e-mail em nome de um
       * escritório de advocacia, exigir de todos é ao mesmo tempo mais seguro e
       * mais simples que a alternativa. Registrado para revisão.
       */
      mfa: Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: destruirComStack ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    for (const papel of ['admin', 'operador']) {
      new CfnUserPoolGroup(this, `Grupo${papel}`, {
        userPoolId: userPool.userPoolId,
        groupName: papel,
        description: `Papel ${papel} — autorização verificada no backend, nunca só na UI.`,
      });
    }

    const clienteUserPool = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
      preventUserExistenceErrors: true,
    });

    // ── Lambdas ──────────────────────────────────────────────────────────────

    const ambienteComum = {
      TABELA_PRINCIPAL: this.tabelaPrincipal.tableName,
      TABELA_IDEMPOTENCIA: tabelaIdempotencia.tableName,
      REGIAO_ENVIO: cfg.regiaoEnvio,
      DOMINIO_PAINEL: cfg.dominioPainel,
    };

    const fnAdminApi = funcaoNode(this, {
      cfg,
      nomeLogico: 'admin-api',
      entry: svc('admin-api'),
      timeout: Duration.seconds(29), // Limite do API Gateway.
      environment: {
        ...ambienteComum,
        BUCKET_UPLOADS: bucketUploads.bucketName,
        FILA_IMPORT: filaImport.queueUrl,
        USER_POOL_ID: userPool.userPoolId,
        // O repositório de contatos busca por e-mail pelo hash, e o hash usa
        // este sal. Sem a variável, o container falha ao inicializar — e como
        // ele é montado uma vez para todas as rotas, o painel inteiro passa a
        // devolver 500, não só a tela que precisa de contato.
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
      },
    });

    // Endpoint público: superfície exposta sem autenticação, por isso isolada
    // com permissão mínima (ADR-04).
    const fnPublicApi = funcaoNode(this, {
      cfg,
      nomeLogico: 'public-api',
      entry: svc('public-api'),
      environment: {
        ...ambienteComum,
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
      },
    });

    const fnLauncher = funcaoNode(this, {
      cfg,
      nomeLogico: 'campaign-launcher',
      entry: svc('workers', 'campaign-launcher'),
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...ambienteComum,
        FILA_ENVIO: filaEnvio.queueUrl,
        // O launcher calcula o hash do e-mail para consultar a supressão.
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
      },
    });

    const fnSender = funcaoNode(this, {
      cfg,
      nomeLogico: 'sender',
      entry: svc('workers', 'sender'),
      timeout: Duration.minutes(5),
      /**
       * Sem `reservedConcurrentExecutions` — o limite de concorrência vem do
       * event source, mais abaixo.
       *
       * Reservar concorrência subtrai da cota da conta, e a AWS exige que ao
       * menos 10 execuções fiquem sem reserva. Numa conta nova, cuja cota total
       * é exatamente 10, reservar uma única execução é rejeitado com
       * `UnreservedConcurrentExecution below its minimum value of [10]`.
       *
       * `maxConcurrency` no event source do SQS limita a concorrência **sem**
       * consumir cota — é a ferramenta certa para o que queríamos aqui.
       */
      environment: {
        ...ambienteComum,
        PARAM_TAXA: paramTaxa.parameterName,
        PARAM_COTA: paramCota.parameterName,
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
        CONFIGURATION_SET: nome(cfg, 'config-set'),
        DOMINIO_ENVIO: cfg.dominioEnvio,
        /**
         * Só entra quando o recebimento de respostas está ligado — §1.4.
         *
         * Presente, o `Reply-To:` das campanhas passa a ser o endereço marcado
         * com a campanha. Definir antes de o MX existir mandaria as respostas
         * dos clientes para um endereço que não recebe: é a mesma chave que
         * governa a regra de recebimento, e as duas pontas ligam juntas.
         */
        ...(cfg.caixaRespostas === undefined ? {} : { DOMINIO_RESPOSTAS: cfg.dominioRespostas }),
        // Necessária para adiar a entrega quando a campanha está pausada ou o
        // SES devolve throttling (ADR-05).
        FILA_ENVIO: filaEnvio.queueUrl,
      },
    });

    const ambienteMonitor = { ...ambienteComum };

    const fnVerificarProgresso = funcaoNode(this, {
      cfg,
      nomeLogico: 'campaign-monitor-verificar',
      entry: svc('workers', 'campaign-monitor'),
      handler: 'verificar',
      environment: ambienteMonitor,
    });

    const fnFinalizarCampanha = funcaoNode(this, {
      cfg,
      nomeLogico: 'campaign-monitor-finalizar',
      entry: svc('workers', 'campaign-monitor'),
      handler: 'finalizar',
      environment: ambienteMonitor,
    });

    const fnEventProcessor = funcaoNode(this, {
      cfg,
      nomeLogico: 'event-processor',
      entry: svc('workers', 'event-processor'),
      environment: {
        ...ambienteComum,
        // Suprime por hash do e-mail ao processar hard bounce e reclamação.
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
      },
    });

    const fnCsvImporter = funcaoNode(this, {
      cfg,
      nomeLogico: 'csv-importer',
      entry: svc('workers', 'csv-importer'),
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...ambienteComum,
        BUCKET_UPLOADS: bucketUploads.bucketName,
        SEGREDO_HMAC_ARN: segredoHmac.secretArn,
      },
    });

    const fnQuotaSync = funcaoNode(this, {
      cfg,
      nomeLogico: 'quota-sync',
      entry: svc('workers', 'quota-sync'),
      environment: {
        ...ambienteComum,
        PARAM_TAXA: paramTaxa.parameterName,
        PARAM_COTA: paramCota.parameterName,
      },
    });

    /**
     * O cron que faz o quota-sync existir de fato.
     *
     * O worker sempre prometeu "a liberação de produção vale sem deploy — este
     * cron percebe em até 24h", mas o cron nunca foi criado: a Lambda ficou
     * publicada, com permissões, e nunca invocada. Descoberto em 2026-08-21,
     * quando o SES saiu do sandbox e o envio continuou na cota velha (1/s,
     * 200/dia) até uma invocação manual pelo CloudShell.
     *
     * A cada 6 horas, não 24: custa quatro invocações gratuitas por dia e
     * encurta a janela em que uma mudança de cota da AWS — para mais ou para
     * menos — passa despercebida. Para menos importa mais: enviar acima da
     * cota real degrada a reputação da conta (§14).
     */
    new Rule(this, 'AgendaQuotaSync', {
      ruleName: nome(cfg, 'quota-sync'),
      schedule: Schedule.rate(Duration.hours(6)),
      targets: [new LambdaFunction(fnQuotaSync)],
    });

    /**
     * Chave do Gemini para a coleta do boletim — §11, item 12.
     *
     * Nasce com um marcador, não com valor: a chave é criada pelo usuário no
     * AI Studio e colada aqui depois (RUNBOOK). O worker reconhece o marcador
     * e explica o que falta em vez de falhar com um erro de autenticação
     * críptico. Não é o Secrets Manager gerando segredo porque este segredo
     * não é nosso — é uma credencial de serviço externo.
     */
    const segredoGemini = new Secret(this, 'SegredoGemini', {
      secretName: nome(cfg, 'gemini-api-key'),
      description: 'Chave da API do Google Gemini (AI Studio) para a coleta do boletim.',
      secretStringValue: SecretValue.unsafePlainText('configure-me'),
    });

    const fnBoletimBuilder = funcaoNode(this, {
      cfg,
      nomeLogico: 'boletim-builder',
      entry: svc('workers', 'boletim-builder'),
      /**
       * Dez minutos, não cinco. O tempo é dominado pela IA do nível gratuito,
       * que responde 503 em rajadas de minutos, e o worker agora insiste com
       * esperas de 10 e 30 segundos por modelo. Ele mesmo se dá um prazo
       * interno menor que este teto e grava o desfecho antes de estourar —
       * o teto é a rede de segurança, não o plano.
       */
      timeout: Duration.minutes(10),
      memorySize: 1024,
      /**
       * Sem repetição automática da invocação assíncrona. O padrão da Lambda
       * (duas repetições) reexecutava uma rodada que estourasse o tempo — em
       * silêncio, disputando a cota da IA com a geração que o operador já
       * tinha pedido de novo ao ver "sem resposta". Falha aqui vira registro
       * na execução, não segunda rodada.
       */
      retryAttempts: 0,
      environment: {
        ...ambienteComum,
        SEGREDO_GEMINI_ARN: segredoGemini.secretArn,
        /**
         * Cadeia de modelos, em ordem de preferência — nomes estáveis na
         * frente, alias por último. `gemini-flash-latest` muda de modelo a
         * cada lançamento do Google e foi o que quebrou o boletim em
         * agosto/2026, com os dois reservas já mortos (404). Um nome que a
         * chave não alcança custa um 404 instantâneo, não a edição: a lista
         * pode ser generosa. Trocar aqui não exige mexer no worker.
         */
        MODELOS_GEMINI:
          'gemini-3.5-flash-lite,gemini-3.6-flash,gemini-2.5-flash-lite,gemini-flash-latest',
      },
    });

    /**
     * Não há mais agenda fixa de segunda às 8h.
     *
     * Ela nasceu antes das rotinas de envio automático, para um rascunho
     * semanal aparecer em Modelos. Com as rotinas no ar, em 31/08/2026 ela
     * disparou 20 segundos antes da rotina das 8h e as duas disputaram o
     * mesmo modelo sobrecarregado. Quem quer um boletim toda segunda cadastra
     * uma rotina semanal; quem quer só o rascunho usa o botão.
     */

    // ── Permissões — menor privilégio, §10.1 ─────────────────────────────────

    this.tabelaPrincipal.grantReadWriteData(fnAdminApi);
    this.tabelaPrincipal.grantReadWriteData(fnLauncher);
    this.tabelaPrincipal.grantReadWriteData(fnSender);
    this.tabelaPrincipal.grantReadWriteData(fnEventProcessor);
    this.tabelaPrincipal.grantReadWriteData(fnCsvImporter);
    // O endpoint público só mexe em status de contato e supressão — não recebe
    // permissão de leitura ampla da tabela.
    this.tabelaPrincipal.grantReadWriteData(fnPublicApi);

    this.tabelaPrincipal.grantReadData(fnVerificarProgresso);
    this.tabelaPrincipal.grantReadWriteData(fnFinalizarCampanha);

    tabelaIdempotencia.grantReadWriteData(fnSender);
    tabelaIdempotencia.grantReadWriteData(fnEventProcessor);

    /**
     * Gestão de contas do painel — §10.1.
     *
     * Enumerada ação por ação, e restrita a este user pool. Faltam de propósito
     * `AdminSetUserPassword` e `AdminDeleteUser`: a primeira permitiria definir
     * a senha de outra pessoa a partir da aplicação, e a segunda apagaria a
     * conta cujo id as campanhas guardam em `criadoPor` e `aprovadoPor` — o
     * registro de quem aprovou o quê passaria a apontar para o nada. Desativar
     * resolve o caso real, que é tirar o acesso de alguém.
     */
    fnAdminApi.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    bucketUploads.grantPut(fnAdminApi);
    bucketUploads.grantRead(fnCsvImporter);
    bucketUploads.grantReadWrite(fnAdminApi, 'exports/*');

    filaEnvio.grantSendMessages(fnLauncher);
    filaEnvio.grantConsumeMessages(fnSender);
    filaEnvio.grantSendMessages(fnSender); // Reenfileirar com atraso quando pausada.
    filaImport.grantSendMessages(fnAdminApi);
    filaImport.grantConsumeMessages(fnCsvImporter);
    filaEventos.grantConsumeMessages(fnEventProcessor);

    // Todos que calculam hash de e-mail ou emitem token precisam do segredo.
    // A `admin-api` entra aqui porque busca contato por e-mail, o que passa pelo
    // hash — a variável de ambiente sozinha não bastaria, faltaria a permissão.
    for (const fn of [
      fnAdminApi,
      fnSender,
      fnPublicApi,
      fnLauncher,
      fnEventProcessor,
      fnCsvImporter,
    ]) {
      segredoHmac.grantRead(fn);
    }
    paramTaxa.grantRead(fnSender);
    paramCota.grantRead(fnSender);
    paramTaxa.grantWrite(fnQuotaSync);
    paramCota.grantWrite(fnQuotaSync);

    // O construtor do boletim lê as fontes e grava o modelo gerado; a chave da
    // IA é só dele. A API pode invocá-lo (o botão "Gerar agora"), nada além.
    this.tabelaPrincipal.grantReadWriteData(fnBoletimBuilder);
    segredoGemini.grantRead(fnBoletimBuilder);
    fnBoletimBuilder.grantInvoke(fnAdminApi);
    fnAdminApi.addEnvironment('FN_BOLETIM_BUILDER', fnBoletimBuilder.functionName);

    /**
     * SES vive em us-east-2 (ADR-01): a permissão atravessa a região, o recurso não.
     *
     * `identity/*` cobre remetente **e destinatário**, e o segundo é o que não
     * era óbvio: enquanto a conta está em sandbox, cada destinatário precisa ser
     * uma identidade verificada, e o SES avalia `ses:SendEmail` sobre ela
     * também. Com apenas a identidade do domínio na lista, todo envio morria com
     *
     *   AccessDeniedException: ... not authorized to perform `ses:SendEmail'
     *   on resource `.../identity/ferarte.fernando@gmail.com'
     *
     * apontando para quem recebe, não para quem envia. Custou caro: o mesmo erro
     * derrubava o e-mail de teste e o disparo do boletim, e no `sender` ele se
     * disfarçava de `FALHA_TRANSITORIA` — `AccessDeniedException` não está no
     * `switch` do classificador e cai no `default`.
     *
     * O curinga fica restrito à conta e à região de envio, e vale só para
     * `ses:SendEmail`. Sair do sandbox tornaria a permissão sobre o destinatário
     * desnecessária, mas não é o que se pode assumir hoje — e uma policy que só
     * funciona depois da liberação da AWS é uma armadilha silenciosa.
     */
    const recursosSes = [
      `arn:aws:ses:${cfg.regiaoEnvio}:${this.account}:identity/*`,
      `arn:aws:ses:${cfg.regiaoEnvio}:${this.account}:configuration-set/${nome(cfg, 'config-set')}`,
    ];

    fnSender.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendEmail'],
        resources: recursosSes,
      }),
    );

    /**
     * A admin-api também envia e-mail: é ela que manda o teste do painel.
     *
     * Faltava, e o sintoma não apontava para cá. O painel dizia "Nenhum e-mail
     * de teste foi enviado" sem motivo visível, o SES registrava zero envios nas
     * últimas 24h, e as identidades estavam todas verificadas — três pistas que
     * levam a procurar no SES, quando o `AccessDenied` acontecia antes de sair
     * da conta.
     *
     * Mesmos recursos do sender: quem envia o teste é o mesmo remetente, e a
     * rota de teste dispensa o Configuration Set de propósito (não deve
     * contaminar as métricas da campanha).
     */
    fnAdminApi.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendEmail'],
        resources: recursosSes,
      }),
    );
    fnQuotaSync.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:GetAccount'],
        resources: ['*'], // GetAccount não admite recurso específico.
      }),
    );

    // ── Gatilhos ─────────────────────────────────────────────────────────────

    fnSender.addEventSource(
      new SqsEventSource(filaEnvio, {
        batchSize: 10,
        // Falha parcial: uma mensagem com throttling não invalida o lote inteiro (§5.5).
        reportBatchItemFailures: true,
        /**
         * Teto de concorrência do envio — §5.6.
         *
         * O mínimo que o SQS aceita é 2, então o pior caso é dois `sender`
         * simultâneos, cada um com seu próprio token bucket: até o dobro da
         * taxa configurada. Com a cota de 1 msg/s do sandbox isso rende algum
         * throttling do SES — que o `sender` trata como fluxo normal, adiando a
         * mensagem em vez de falhar (§5.5). Degrada com desperdício, não com
         * perda.
         *
         * A guarda que **não** depende disso é a cota diária, contada no
         * DynamoDB com incremento condicional: essa é global e atômica,
         * independente de quantos workers rodem.
         */
        maxConcurrency: 2,
      }),
    );
    fnEventProcessor.addEventSource(
      new SqsEventSource(filaEventos, { batchSize: 10, reportBatchItemFailures: true }),
    );
    fnCsvImporter.addEventSource(
      new SqsEventSource(filaImport, { batchSize: 1, reportBatchItemFailures: true }),
    );
    void StartingPosition; // Stream do DynamoDB será consumido na fase MVP (§5.11).

    // ── API ──────────────────────────────────────────────────────────────────

    const autorizador = new HttpJwtAuthorizer(
      'AutorizadorCognito',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [clienteUserPool.userPoolClientId] },
    );

    const api = new HttpApi(this, 'AdminApi', {
      apiName: nome(cfg, 'admin-api'),
      corsPreflight: {
        allowOrigins: [`https://${cfg.dominioPainel}`],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          // A rota de edição de contato é PATCH. O painel ainda não a chama, e
          // faltando aqui ela falharia no dia em que passasse a chamar — com um
          // erro de CORS, que não menciona método nenhum.
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    /**
     * Métodos enumerados, e **não** `HttpMethod.ANY`.
     *
     * `ANY` inclui `OPTIONS`, e uma rota explícita de `OPTIONS` tem precedência
     * sobre o tratamento automático de CORS do HTTP API. O resultado é que o
     * preflight passa a cair no authorizer do Cognito — e o preflight, por
     * definição do CORS, é enviado **sem** o cabeçalho `authorization`.
     *
     * O authorizer devolve 401, o navegador considera o preflight recusado e a
     * requisição real nunca chega a sair. Na tela isso aparece como
     * "Failed to fetch", sem nenhuma menção a CORS, a preflight ou a 401 — o
     * painel inteiro fica inutilizável para quem está autenticado.
     *
     * Enumerando os métodos, `OPTIONS` volta a ser respondido pelo próprio
     * API Gateway, com os cabeçalhos do `corsPreflight` acima e sem autorização.
     */
    api.addRoutes({
      path: '/{proxy+}',
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
        HttpMethod.PATCH,
        HttpMethod.DELETE,
      ],
      integration: new HttpLambdaIntegration('AdminIntegration', fnAdminApi),
      authorizer: autorizador,
    });

    /**
     * Log de acesso da API — §10.4 e §11, item 10.
     *
     * A auditoria da aplicação registra o que mudou; este log registra quem
     * bateu na porta, inclusive nas tentativas que falharam na autorização. Uma
     * sem a outra deixa buraco: sem o log de acesso não há como investigar uma
     * enxurrada de 401, que é o sinal de credencial vazada.
     *
     * Feito por escape hatch porque o L2 do HTTP API ainda não expõe
     * accessLogSettings.
     */
    const logApi = new LogGroup(this, 'LogAcessoApi', {
      logGroupName: `/aws/apigateway/${nome(cfg, 'admin-api')}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const estagioPadrao = api.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (estagioPadrao !== undefined) {
      estagioPadrao.accessLogSettings = {
        destinationArn: logApi.logGroupArn,
        // Sem corpo de requisição: o payload traz dado pessoal de contato e não
        // pode ir para o log (§10.4).
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          usuario: '$context.authorizer.claims.sub',
          metodo: '$context.httpMethod',
          rota: '$context.routeKey',
          status: '$context.status',
          latenciaMs: '$context.responseLatency',
          erroIntegracao: '$context.integrationErrorMessage',
        }),
      };
    }

    // Descadastro em Function URL, não em API Gateway: menos uma cobrança por
    // requisição e menos superfície. A proteção é o token HMAC (ADR-04).
    const urlPublica = fnPublicApi.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        // GET abre a página de confirmação para quem clicou; POST é o
        // descadastro em um clique do RFC 8058, que o Gmail dispara sozinho
        // sem interação do titular (§1.3).
        allowedMethods: [LambdaHttpMethod.GET, LambdaHttpMethod.POST],
        allowedHeaders: ['content-type'],
      },
    });

    /**
     * A URL de descadastro só existe depois que a Function URL é criada, e o
     * `sender` precisa dela para montar o link de cada e-mail. Injetada aqui, e
     * não no bloco de ambiente acima, porque lá o recurso ainda não existia.
     *
     * Sem isto o `sender` falha na inicialização — o que é o comportamento
     * desejado (§11, item 7): melhor não subir do que enviar e-mail sem link de
     * descadastro.
     */
    fnSender.addEnvironment('URL_DESCADASTRO', urlPublica.url);

    // ── Orquestração e agendamento — ADR-05 ──────────────────────────────────

    const orquestrador = criarOrquestrador(this, {
      cfg,
      fnLauncher,
      fnVerificar: fnVerificarProgresso,
      fnFinalizar: fnFinalizarCampanha,
    });

    const grupoAgendamentos = new CfnScheduleGroup(this, 'GrupoAgendamentos', {
      name: nome(cfg, 'campanhas'),
    });

    /**
     * Papel assumido pelo EventBridge Scheduler para iniciar o disparo.
     *
     * Só `StartExecution` nesta máquina de estados: o Scheduler não precisa
     * invocar Lambda nem ler dado nenhum (§10.1).
     */
    const papelScheduler = new Role(this, 'PapelScheduler', {
      roleName: nome(cfg, 'scheduler'),
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Assumido pelo EventBridge Scheduler para iniciar campanhas.',
    });
    orquestrador.grantStartExecution(papelScheduler);

    /**
     * A API cria e apaga agendamentos, e dispara imediatamente.
     *
     * `iam:PassRole` restrito ao papel do Scheduler: sem essa condição, quem
     * controlasse a API poderia mandar o Scheduler assumir qualquer papel da
     * conta — que é a escalação de privilégio clássica desse serviço.
     */
    fnAdminApi.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${nome(cfg, 'campanhas')}/*`,
        ],
      }),
    );
    fnAdminApi.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [papelScheduler.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    );
    orquestrador.grantStartExecution(fnAdminApi);

    fnAdminApi.addEnvironment('ORQUESTRADOR_ARN', orquestrador.stateMachineArn);
    fnAdminApi.addEnvironment(
      'GRUPO_AGENDAMENTOS',
      grupoAgendamentos.name ?? nome(cfg, 'campanhas'),
    );
    fnAdminApi.addEnvironment('PAPEL_SCHEDULER_ARN', papelScheduler.roleArn);

    /**
     * Rotina de envio automático do boletim.
     *
     * A API cadastra agendas recorrentes (mesmo grupo, mesmo papel) apontando
     * para o construtor do boletim; o papel do Scheduler ganha permissão de
     * invocá-lo. No horário, o construtor gera o modelo e — só neste caminho —
     * dispara a campanha pelo mesmo orquestrador do painel, e por isso recebe
     * o ARN e o `StartExecution`.
     */
    fnBoletimBuilder.grantInvoke(papelScheduler);
    fnAdminApi.addEnvironment('FN_BOLETIM_BUILDER_ARN', fnBoletimBuilder.functionArn);
    orquestrador.grantStartExecution(fnBoletimBuilder);
    fnBoletimBuilder.addEnvironment('ORQUESTRADOR_ARN', orquestrador.stateMachineArn);

    // ── Alarmes — §10.4 ──────────────────────────────────────────────────────

    const topicoAlarmes = criarAlarmes(this, {
      cfg,
      filaEnvio,
      dlqs: [
        { nome: 'envio', fila: dlqEnvio },
        { nome: 'eventos', fila: dlqEventos },
        { nome: 'importacao', fila: dlqImport },
      ],
      fnSender,
      configurationSet: nome(cfg, 'config-set'),
    });

    // ── Saídas ───────────────────────────────────────────────────────────────

    new CfnOutput(this, 'FilaEventosUrl', { value: filaEventos.queueUrl });
    new CfnOutput(this, 'FilaEventosArn', { value: filaEventos.queueArn });
    this.apiUrl = api.apiEndpoint;
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = clienteUserPool.userPoolClientId;

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'UrlDescadastro', { value: urlPublica.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: clienteUserPool.userPoolClientId });
    new CfnOutput(this, 'BucketUploadsNome', { value: bucketUploads.bucketName });
    new CfnOutput(this, 'OrquestradorArn', { value: orquestrador.stateMachineArn });
    new CfnOutput(this, 'TopicoAlarmesArn', {
      value: topicoAlarmes.topicArn,
      description: 'Confirme a inscrição no e-mail antes de considerar os alarmes ativos',
    });
  }
}
