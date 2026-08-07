import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import {
  CfnOIDCProvider,
  Effect,
  FederatedPrincipal,
  PolicyStatement,
  Role,
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
   * Identificadores numéricos da organização e do repositório no GitHub.
   *
   * O GitHub emite o `sub` do token OIDC no formato
   * `repo:org@<idOrg>/repo@<idRepo>:environment:<nome>` — com os IDs, não só
   * com os nomes. É deliberado: renomear o repositório passa a **não**
   * transferir a confiança, e ninguém herda acesso ocupando um nome liberado.
   *
   * Consequência prática: a política precisa dos IDs. Uma condição escrita só
   * com nomes nunca casa, e o erro que aparece é o genérico
   * `Not authorized to perform sts:AssumeRoleWithWebIdentity` — que não dá
   * nenhuma pista da causa.
   *
   * Obtenha com:
   *   gh api orgs/<org> --jq .id
   *   gh api repos/<org>/<repo> --jq .id
   */
  readonly idOrganizacao: string;
  readonly idRepositorio: string;
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

    // `org/repo` → `org@idOrg/repo@idRepo`, que é a forma que o GitHub assina.
    const [organizacao = '', nomeRepo = ''] = repositorio.split('/');
    const repositorioComIds = `${organizacao}@${props.idOrganizacao}/${nomeRepo}@${props.idRepositorio}`;

    /**
     * Recurso nativo do CloudFormation, não o construto L2 do CDK.
     *
     * O `OpenIdConnectProvider` do CDK cria uma Lambda de custom resource só
     * para registrar o provedor — o que deixa uma função órfã na conta para
     * sempre e faz esta stack depender do bootstrap. `AWS::IAM::OIDCProvider` é
     * nativo desde 2023 e torna o template autocontido: dá para implantá-lo
     * antes de qualquer outra coisa, inclusive do CloudShell.
     */
    const arnProvedor = props.criarProvedor
      ? new CfnOIDCProvider(this, 'ProvedorGithub', {
          url: `https://${EMISSOR}`,
          clientIdList: ['sts.amazonaws.com'],
          // A AWS valida o certificado do GitHub por conta própria desde 2023 e
          // ignora este valor. Mantido porque o recurso ainda o aceita e porque
          // omiti-lo tem comportamento menos previsível entre regiões.
          thumbprintList: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
        }).attrArn
      : `arn:aws:iam::${this.account}:oidc-provider/${EMISSOR}`;

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
          arnProvedor,
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

      /**
       * Publicar o painel no bucket do site — a única coisa que o pipeline faz
       * fora do `cdk deploy`.
       *
       * O CDK cria o bucket e a distribuição, mas não põe os arquivos dentro:
       * o bundle da SPA só pode ser compilado **depois** da implantação, porque
       * a URL da API e os identificadores do Cognito entram nele em tempo de
       * compilação e são saídas das stacks. Por isso este passo existe, e por
       * isso precisa de permissão própria.
       *
       * Enumerada ação por ação, e não `s3:*`: o mesmo pipeline não deve poder
       * tocar o bucket de uploads, que guarda CSV de contatos.
       */
      r.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cloudformation:DescribeStacks'],
          resources: [`arn:aws:cloudformation:*:${this.account}:stack/EmailMkt*/*`],
        }),
      );

      const bucketSite = `arn:aws:s3:::${nome(cfg, 'site')}-${this.account}`;
      r.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [bucketSite],
        }),
      );
      r.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:PutObject', 's3:DeleteObject'],
          resources: [`${bucketSite}/*`],
        }),
      );

      /**
       * A invalidação não aceita ARN de distribuição específica em política
       * baseada em identidade sem que se conheça o id — que só existe depois do
       * primeiro deploy. O escopo real vem de outro lado: a conta só tem as
       * distribuições deste projeto, e criar invalidação não lê nem altera
       * conteúdo, apenas descarta cache.
       */
      r.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cloudfront:CreateInvalidation'],
          resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
        }),
      );

      return r;
    };

    /**
     * Dev: restrito ao GitHub Environment `dev`.
     *
     * **O `sub` precisa espelhar o que o workflow declara.** Quando um job roda
     * dentro de um Environment, o token do GitHub troca o `sub` de
     * `ref:refs/heads/main` para `environment:<nome>` — e uma condição amarrada
     * à branch nunca casa. Foi exatamente esse descompasso que derrubou o
     * primeiro deploy: a condição dizia `ref`, o workflow declarava
     * `environment: dev`.
     *
     * Ambos os papéis usam Environment agora. Misturar os dois critérios é
     * convite para o mesmo bug voltar.
     */
    const papelDev = papel(
      'PapelDeployDev',
      'dev',
      `repo:${repositorioComIds}:environment:dev`,
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
     * implantar em produção sem aprovação — e, do jeito que o workflow está
     * escrito, nem funcionaria: o `sub` de um job com Environment nunca traz o
     * `ref`.
     */
    const papelProd = papel(
      'PapelDeployProd',
      'prod',
      `repo:${repositorioComIds}:environment:producao`,
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
