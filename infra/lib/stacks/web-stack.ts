import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import {
  AllowedMethods,
  Distribution,
  HttpVersion,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

export interface WebStackProps extends StackProps {
  readonly cfg: AmbienteConfig;
  /**
   * Domínio customizado exige certificado ACM validado por DNS. Enquanto o CNAME
   * de validação não estiver publicado, o deploy trava esperando. Por isso é
   * opt-in: a primeira implantação sobe no domínio do CloudFront e o domínio
   * próprio entra quando o DNS estiver pronto (§9.1.2).
   */
  readonly habilitarDominioCustomizado: boolean;
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

    const certificado = props.habilitarDominioCustomizado
      ? new Certificate(this, 'Certificado', {
          domainName: cfg.dominioPainel,
          validation: CertificateValidation.fromDns(),
        })
      : undefined;

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

    new CfnOutput(this, 'BucketSiteNome', { value: bucketSite.bucketName });
    new CfnOutput(this, 'DistribuicaoId', { value: distribuicao.distributionId });
    new CfnOutput(this, 'DistribuicaoDominio', { value: distribuicao.distributionDomainName });
    new CfnOutput(this, 'DominioCustomizado', {
      value: props.habilitarDominioCustomizado
        ? cfg.dominioPainel
        : 'desabilitado — publicar o CNAME de validacao do ACM e reimplantar com -c dominioCustomizado=true',
    });
  }
}
