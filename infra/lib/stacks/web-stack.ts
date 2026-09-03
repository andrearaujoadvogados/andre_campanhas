import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

export interface WebStackProps extends StackProps {
  readonly cfg: AmbienteConfig;
  /**
   * ARN de um certificado ACM **já validado**, em `us-east-1`.
   *
   * Passar um certificado pronto, em vez de deixar a stack criar um, evita o
   * pior comportamento operacional possível aqui: um certificado validado por
   * DNS criado pelo CloudFormation deixa o deploy **bloqueado** até alguém
   * publicar o CNAME de validação — e o CNAME só é conhecido depois que o
   * certificado é solicitado. O deploy fica pendurado por até uma hora e então
   * falha, com a stack em estado intermediário.
   *
   * Separando as duas coisas, a emissão do certificado vira um passo manual e
   * demorado feito uma vez, e o deploy segue rápido e previsível.
   *
   * Sem ARN, a distribuição sobe no domínio do próprio CloudFront — mas o painel
   * **não funciona** assim: o `corsPreflight` da API libera um único origin, o
   * domínio customizado. Ver a seção 6.2 de docs/DEPLOY.md.
   */
  readonly certificadoArn?: string | undefined;
  /**
   * ARN de um certificado ACM **já validado** para o domínio de rastreamento,
   * também em `us-east-1`. Mesma razão de ser passado pronto que o anterior.
   *
   * Sem ele, a distribuição de rastreamento não é criada — uma distribuição sem
   * domínio próprio não teria função nenhuma aqui, já que existir para servir
   * `link.mail.…` com certificado válido é o motivo inteiro dela.
   */
  readonly certificadoRastreamentoArn?: string | undefined;
  /**
   * O que o painel precisa saber para falar com o resto do sistema.
   *
   * Vem da stack de dados, em sa-east-1, e é escrito num `config.json` que o
   * painel lê ao abrir. Poderia entrar no bundle em tempo de compilação, e a
   * consequência seria pior: obrigaria a compilar depois do deploy e a ler
   * saídas do CloudFormation no pipeline — permissão que o papel do GitHub
   * deliberadamente não tem.
   */
  readonly configPainel: {
    readonly apiUrl: string;
    readonly userPoolId: string;
    readonly userPoolClientId: string;
  };
}

/**
 * Painel administrativo — us-east-1.
 *
 * A stack inteira vive em us-east-1 porque o certificado do CloudFront precisa
 * estar lá (exigência do serviço). Não conflita com o ADR-01: este bucket guarda
 * apenas os arquivos estáticos do painel — JavaScript, CSS e imagens. Nenhum
 * dado pessoal transita ou repousa aqui; os dados continuam em sa-east-1.
 */
export class WebStack extends Stack {
  constructor(escopo: Construct, id: string, props: WebStackProps) {
    super(escopo, id, props);
    const { cfg } = props;

    const bucketSite = new Bucket(this, 'BucketSite', {
      bucketName: `${nome(cfg, 'site')}-${this.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      // Privado: quem serve é o CloudFront via OAC (§10.1).
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cfg.ambiente === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: cfg.ambiente === 'dev',
    });

    const certificado =
      props.certificadoArn === undefined
        ? undefined
        : Certificate.fromCertificateArn(this, 'Certificado', props.certificadoArn);

    const distribuicao = new Distribution(this, 'Distribuicao', {
      comment: `Painel ${cfg.ambiente} — ${cfg.dominioPainel}`,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      // Menor faixa de preço cobre Brasil e EUA. O painel tem menos de 20
      // usuários; pagar por presença global seria desperdício (§13).
      priceClass: PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucketSite),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
      },
      // SPA: rotas do lado do cliente precisam cair no index.html em vez de 404.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
      ...(certificado === undefined
        ? {}
        : { certificate: certificado, domainNames: [cfg.dominioPainel] }),
    });

    /**
     * O painel em si — os arquivos, não só o lugar onde eles moram.
     *
     * Publicar aqui, e não por um comando no pipeline, é o que mantém o deploy
     * numa etapa só: o `cdk deploy` já tem as permissões necessárias através
     * dos papéis do bootstrap, enquanto um `aws s3 sync` exigiria conceder
     * acesso ao bucket ao papel do GitHub.
     *
     * Duas implantações porque as políticas de cache são opostas. Os arquivos
     * de `assets/` têm hash no nome — mudou o conteúdo, mudou o nome —, então
     * podem ficar em cache por um ano. O `index.html` e o `config.json` não
     * podem ficar em cache nenhum: o primeiro aponta para os assets, e uma
     * cópia velha manda o navegador buscar arquivos que o `prune` já removeu;
     * o segundo mudaria sem que ninguém percebesse.
     */
    const publicarPainel = (): void => {
      const origem = resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        '../../../apps/admin-web/dist',
      );

      new BucketDeployment(this, 'PainelAssets', {
        sources: [Source.asset(origem, { exclude: ['index.html'] })],
        destinationBucket: bucketSite,
        distribution: distribuicao,
        distributionPaths: ['/*'],
        cacheControl: [CacheControl.fromString('public,max-age=31536000,immutable')],
        prune: false,
      });

      new BucketDeployment(this, 'PainelIndice', {
        sources: [
          Source.asset(origem, { exclude: ['*', '!index.html'] }),
          Source.jsonData('config.json', props.configPainel),
        ],
        destinationBucket: bucketSite,
        cacheControl: [CacheControl.fromString('no-cache,no-store,must-revalidate')],
        prune: false,
      });
    };

    // Sem o painel compilado não há o que publicar. Acontece em `cdk synth`
    // solto, sem build antes — e falhar aqui, com esta mensagem, é melhor que
    // falhar dentro do CDK dizendo que um diretório não existe.
    if (existsSync(fileURLToPath(new URL('../../../apps/admin-web/dist', import.meta.url)))) {
      publicarPainel();
    } else if (process.env['CI'] === 'true') {
      throw new Error(
        'apps/admin-web/dist não existe. O painel precisa ser compilado antes do synth — ver o passo "Build do painel" em .github/workflows/ci.yml.',
      );
    }

    /**
     * Rastreamento de aberturas e cliques — o subdomínio próprio do escritório.
     *
     * O SES reescreve todo link do e-mail para `cfg.dominioRastreamento`. Um
     * CNAME direto para `r.<regiao>.awstrack.me` **não** basta: aquele endpoint
     * serve certificado de `CN=r.<regiao>.awstrack.me`, que não cobre o domínio
     * do escritório, e o clique vira aviso de certificado inválido no navegador
     * — em e-mail de escritório de advocacia, indistinguível de phishing.
     *
     * Daí esta distribuição: ela termina o TLS com certificado nosso e repassa
     * para o endpoint do SES, que continua fazendo o registro do clique.
     */
    const distribuicaoRastreamento =
      props.certificadoRastreamentoArn === undefined
        ? undefined
        : new Distribution(this, 'DistribuicaoRastreamento', {
            comment: `Rastreamento ${cfg.ambiente} — ${cfg.dominioRastreamento}`,
            httpVersion: HttpVersion.HTTP2_AND_3,
            // Diferente do painel: quem clica são os destinatários, no Brasil, e
            // o edge de São Paulo só entra na faixa completa. A resposta é um
            // redirecionamento de poucos bytes, então a diferença de custo é
            // desprezível e a de latência, não.
            priceClass: PriceClass.PRICE_CLASS_ALL,
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            certificate: Certificate.fromCertificateArn(
              this,
              'CertificadoRastreamento',
              props.certificadoRastreamentoArn,
            ),
            domainNames: [cfg.dominioRastreamento],
            defaultBehavior: {
              origin: new HttpOrigin(`r.${cfg.regiaoEnvio}.awstrack.me`, {
                // O endpoint tem certificado válido para o próprio nome, e é o
                // CloudFront quem manda o SNI — então aqui a verificação passa.
                protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
              }),
              viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
              // Cache desligado, e isto é correção e não ajuste de desempenho:
              // cada URL de rastreamento identifica um destinatário e uma
              // mensagem. Uma resposta servida do cache não chega ao SES, e o
              // clique simplesmente não é contado.
              cachePolicy: CachePolicy.CACHING_DISABLED,
              /**
               * Repassa a query string e TODOS os cabeçalhos do visitante,
               * inclusive o Host. A versão anterior tirava o Host de propósito,
               * supondo que o SES roteava pelo host da origem — e todo clique
               * voltava HTTP 400 (03/09/2026, primeiro boletim real). A
               * documentação do SES é explícita: para domínio HTTPS atrás de
               * CDN, "o CDN deve repassar o cabeçalho Host do solicitante para
               * a origem" — é pelo Host que o endpoint reconhece o domínio de
               * rastreamento cadastrado no configuration set. Teste que a AWS
               * sugere: `curl --head https://<dominio>/favicon.ico` deve
               * devolver 200 com `x-amz-ses-region`.
               */
              originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
            },
          });

    new CfnOutput(this, 'BucketSiteNome', { value: bucketSite.bucketName });
    new CfnOutput(this, 'DistribuicaoId', { value: distribuicao.distributionId });
    new CfnOutput(this, 'DistribuicaoDominio', { value: distribuicao.distributionDomainName });
    new CfnOutput(this, 'DominioCustomizado', {
      value:
        props.certificadoArn === undefined
          ? 'nao configurado — ver docs/DEPLOY.md, secao de DNS'
          : cfg.dominioPainel,
    });

    // O destino do CNAME de `link.mail`. Sem ele os links dos e-mails não abrem.
    new CfnOutput(this, 'RastreamentoDominio', {
      value:
        distribuicaoRastreamento === undefined
          ? 'nao configurado — links de e-mail quebrados, ver docs/PENDENCIAS.md parte B'
          : distribuicaoRastreamento.distributionDomainName,
    });
  }
}
