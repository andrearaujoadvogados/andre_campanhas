import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Effect,
  FederatedPrincipal,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  type IOpenIdConnectProvider,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { nome, type AmbienteConfig } from '../config.js';

const EMISSOR = 'token.actions.githubusercontent.com';

/**
 * Qualificador padrão do bootstrap do CDK. Só muda se alguém rodar
 * `cdk bootstrap --qualifier` com outro valor — o que não é o caso aqui.
 */
const QUALIFICADOR_CDK = 'hnb659fds';

export interface GithubOidcStackProps extends StackProps {
  readonly cfg: AmbienteConfig;
  /** `organizacao/repositorio`. */
  readonly repositorio: string;
  /**
   * O provedor OIDC é um recurso **por conta**, não por stack.
   *
   * Se a conta já tiver um — de outro projeto, por exemplo —, criar de novo
   * falha. Nesse caso, passe `false` e a stack reaproveita o existente.
   */
  readonly criarProvedor: boolean;
}

/**
 * Papéis de deploy assumidos pelo GitHub Actions — §9.2.
 *
 * Implantada **uma única vez, à mão**, antes de o pipeline funcionar. É o
 * problema do ovo e da galinha do OIDC: o Actions precisa de um papel para
 * implantar, e alguém precisa criar esse papel com credenciais locais.
 *
 * Duas decisões que valem mais que o resto do arquivo:
 *
 * 1. **Sem chaves de acesso de longa duração.** O Actions troca um token de
 *    identidade assinado pelo GitHub por credenciais temporárias. Não há
 *    segredo de AWS guardado no repositório para vazar.
 *
 * 2. **Os papéis não têm permissão de administrador.** Eles só podem assumir os
 *    papéis que o `cdk bootstrap` criou. É a diferença entre "o pipeline pode
 *    implantar esta aplicação" e "o pipeline pode fazer qualquer coisa na
 *    conta" — e é o erro mais comum em configuração de OIDC.
 */
export class GithubOidcStack extends Stack {
  constructor(escopo: Construct, id: string, props: GithubOidcStackProps) {
    super(escopo, id, props);
    const { cfg, repositorio } = props;

    const provedor: IOpenIdConnectProvider = props.criarProvedor
      ? new OpenIdConnectProvider(this, 'ProvedorGithub', {
          url: `https://${EMISSOR}`,
          clientIds: ['sts.amazonaws.com'],
        })
      : OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'ProvedorGithub',
          `arn:aws:iam::${this.account}:oidc-provider/${EMISSOR}`,
        );

    /**
     * A condição `sub` é o que amarra o papel a este repositório.
     *
     * Sem ela — ou com um curinga frouxo como `repo:*` — qualquer repositório
     * do GitHub, de qualquer pessoa, poderia assumir o papel e implantar na
     * conta do escritório. É a falha clássica desta configuração.
     */
    const condicao = (sub: string) => ({
      StringEquals: {
        [`${EMISSOR}:aud`]: 'sts.amazonaws.com',
        [`${EMISSOR}:sub`]: sub,
      },
    });

    const papel = (idLogico: string, sufixo: string, sub: string, descricao: string): Role => {
      const r = new Role(this, idLogico, {
        roleName: nome(cfg, `github-deploy-${sufixo}`),
        description: descricao,
        assumedBy: new FederatedPrincipal(
          provedor.openIdConnectProviderArn,
          condicao(sub),
          'sts:AssumeRoleWithWebIdentity',
        ),
      });

      /**
       * Toda a permissão do papel: assumir os papéis do bootstrap do CDK.
       *
       * O `cdk deploy` assume três papéis — publicação de artefatos, consulta e
       * implantação —, e são eles que carregam as permissões de verdade. Dar
       * `AdministratorAccess` aqui seria conceder ao GitHub Actions controle
       * total da conta para fazer um trabalho que já tem papéis próprios.
       */
      r.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [
            `arn:aws:iam::${this.account}:role/cdk-${QUALIFICADOR_CDK}-deploy-role-${this.account}-*`,
            `arn:aws:iam::${this.account}:role/cdk-${QUALIFICADOR_CDK}-file-publishing-role-${this.account}-*`,
            `arn:aws:iam::${this.account}:role/cdk-${QUALIFICADOR_CDK}-image-publishing-role-${this.account}-*`,
            `arn:aws:iam::${this.account}:role/cdk-${QUALIFICADOR_CDK}-lookup-role-${this.account}-*`,
          ],
        }),
      );

      return r;
    };

    /**
     * Dev: restrito à branch `main`.
     *
     * Um pull request de terceiro não consegue assumir este papel — o `sub` de
     * um PR é `pull_request`, não `ref:refs/heads/main`. Sem essa distinção,
     * qualquer um que abrisse um PR poderia executar código com acesso à conta.
     */
    const papelDev = papel(
      'PapelDeployDev',
      'dev',
      `repo:${repositorio}:ref:refs/heads/main`,
      'Assumido pelo GitHub Actions para implantar em desenvolvimento.',
    );

    /**
     * Produção: restrito ao **GitHub Environment** `producao`.
     *
     * É a condição mais forte disponível aqui. O Environment tem aprovação
     * manual configurada no GitHub, então o papel só pode ser assumido depois
     * que alguém autorizou o deploy — a exigência de §9.2, que é inegociável
     * num sistema que envia e-mail em nome de um escritório de advocacia.
     *
     * Amarrar à branch, em vez do Environment, deixaria qualquer push na `main`
     * implantar em produção sem aprovação.
     */
    const papelProd = papel(
      'PapelDeployProd',
      'prod',
      `repo:${repositorio}:environment:producao`,
      'Assumido pelo GitHub Actions para implantar em produção, após aprovação manual.',
    );

    new CfnOutput(this, 'PapelDeployDevArn', {
      value: papelDev.roleArn,
      description: 'Secret AWS_DEPLOY_ROLE_DEV no GitHub',
    });
    new CfnOutput(this, 'PapelDeployProdArn', {
      value: papelProd.roleArn,
      description: 'Secret AWS_DEPLOY_ROLE_PROD no GitHub',
    });
    new CfnOutput(this, 'ContaAws', {
      value: this.account,
      description: 'Secret AWS_ACCOUNT_DEV ou AWS_ACCOUNT_PROD no GitHub',
    });
  }
}
