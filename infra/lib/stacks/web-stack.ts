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
              // Repassa a query string e os cabeçalhos do visitante, menos o
              // Host: o SES roteia pelo host da origem, e mandar o nosso faria
              // o endpoint não reconhecer a requisição.
              originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
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
