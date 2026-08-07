# Deploy — configuração inicial

Sequência única para habilitar o pipeline. Depois disso, todo deploy passa pelo GitHub Actions.

> **Nada aqui foi executado ainda.** Os comandos precisam de credenciais de administrador na conta AWS, o que só você tem.

---

## O problema do ovo e da galinha

O GitHub Actions precisa de um papel IAM para implantar. Esse papel precisa ser criado por alguém com credenciais. Então os passos 1 a 3 são **manuais, feitos uma vez**, da sua máquina. A partir do passo 4, tudo é automático.

---

## 1. Credenciais locais de administrador

```bash
aws sts get-caller-identity
```

Confirme que a conta devolvida é `874726179037`. Se não for, ajuste o perfil:

```bash
export AWS_PROFILE=nome-do-perfil
```

---

## 2. Bootstrap do CDK nas três regiões

O CDK precisa de um conjunto de recursos-base por conta **e por região**. Nosso sistema usa três (ADR-01), e esquecer uma faz o deploy falhar no meio, com metade da infraestrutura no ar.

```bash
npx cdk bootstrap aws://874726179037/sa-east-1 aws://874726179037/us-east-2 aws://874726179037/us-east-1
```

Isso cria os papéis `cdk-hnb659fds-*` que os papéis de deploy vão assumir. É a razão de o papel do GitHub **não** precisar de permissão de administrador.

---

## 3. Criar os papéis de deploy

```bash
cd infra
```

```bash
AWS_ACCOUNT_PROD=874726179037 EMAIL_ALARMES=seu@email.com npx cdk deploy EmailMktGithubOidcProd -c ambiente=prod
```

Se a conta já tiver um provedor OIDC do GitHub de outro projeto, acrescente `-c criarProvedorOidc=false` — o provedor é um recurso por conta, e criar o segundo falha.

Ao final, o CDK imprime os ARNs. Guarde-os: são os secrets do próximo passo.

> **Esta stack nunca é implantada pelo pipeline.** Ela é o que dá acesso ao pipeline — deixá-lo implantar a própria credencial é circular, e uma implantação malsucedida poderia derrubar o acesso. Por isso o workflow lista as stacks de aplicação explicitamente em vez de usar `--all`.

> **Os IDs numéricos importam.** O GitHub assina o token OIDC com o `sub` no formato `repo:org@<id>/repo@<id>:environment:<nome>` — com identificadores imutáveis, não só com nomes. Uma política de confiança escrita apenas com nomes **nunca casa**, e o erro é o genérico `Not authorized to perform sts:AssumeRoleWithWebIdentity`, que não indica a causa.
>
> Se algum dia o repositório mudar de organização, atualize os IDs em `infra/bin/app.ts`:
>
> ```bash
> gh api orgs/<org> --jq .id && gh api repos/<org>/<repo> --jq .id
> ```

### O que este passo cria

| Recurso                            | Restrição                              |
| ---------------------------------- | -------------------------------------- |
| Provedor OIDC do GitHub            | Um por conta                           |
| `emailmkt-prod-github-deploy-dev`  | Só a branch `main` deste repositório   |
| `emailmkt-prod-github-deploy-prod` | Só o **GitHub Environment `producao`** |

Os papéis não têm permissão de administrador. A única coisa que podem fazer é assumir os papéis do bootstrap do CDK — o que limita o estrago de um token vazado ao que a aplicação já faz.

---

## 4. Configurar o GitHub

Em **Settings → Secrets and variables → Actions**:

### Secrets

| Nome                   | Valor                                             |
| ---------------------- | ------------------------------------------------- |
| `AWS_DEPLOY_ROLE_DEV`  | ARN impresso no passo 3                           |
| `AWS_DEPLOY_ROLE_PROD` | ARN impresso no passo 3                           |
| `AWS_ACCOUNT_DEV`      | `874726179037`                                    |
| `AWS_ACCOUNT_PROD`     | `874726179037`                                    |
| `EMAIL_ALARMES`        | Endereço que recebe alarme de bounce e reclamação |

> **O `EMAIL_ALARMES` merece atenção.** É para onde vai o aviso de "taxa de bounce em nível crítico" — o alarme que evita a AWS suspender a conta.
>
> Aceita vários endereços separados por vírgula, e vale usar mais de um: quem opera o sistema e quem responde pelo escritório raramente são a mesma pessoa, e um alarme que chega só a um dos dois vira silêncio quando essa pessoa está de férias.
>
> **Cada endereço recebe um pedido de confirmação do SNS no primeiro deploy e precisa clicar nele.** Até alguém confirmar, a inscrição fica pendente e o alarme dispara para o vazio — o pior estado possível, porque parece protegido e não está.

### Environment

Em **Settings → Environments**, crie `producao` e marque **Required reviewers** com você mesmo.

Isso não é cerimônia: o papel de produção só pode ser assumido por um job rodando nesse Environment. Sem a aprovação, o deploy trava — que é a exigência de §9.2. Um deploy ruim não é revertível depois que o e-mail saiu.

### Variável

| Nome                | Valor  |
| ------------------- | ------ |
| `DEPLOY_HABILITADO` | `true` |

Enquanto não existir, os jobs de deploy são pulados e o pipeline segue verde. É o que permite configurar tudo com calma sem quebrar o CI.

---

## 5. Primeiro deploy

Um push na `main` dispara: verificação → deploy em dev → **aprovação manual** → deploy em produção.

### O que conferir depois

- [ ] As saídas do CDK: `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `UrlDescadastro`
- [ ] Publicar os registros DNS (passo 6)
- [ ] Preencher o `.env.local` do painel com as saídas
- [ ] Criar o primeiro usuário no Cognito e passar pelo fluxo de MFA
- [ ] **Confirmar a inscrição do SNS** em cada endereço de `EMAIL_ALARMES` (chega um e-mail com link)
- [ ] Verificar no console do CloudWatch que os 7 alarmes estão em `OK`, não em `INSUFFICIENT_DATA` sem inscrição confirmada

---

## 6. Registros DNS

Dois assuntos independentes, com urgências diferentes. O de rastreamento precisa existir **antes do primeiro envio**; o do painel pode esperar.

### 6.1 Domínio de rastreamento — antes de enviar

Sem ele, os links dentro dos e-mails aparecem para o destinatário como `awstrack.me`. Num e-mail de escritório de advocacia, um domínio desconhecido no link é motivo suficiente para o leitor marcar como spam — e reclamação é a métrica que custa a conta.

| Registro                  | Tipo  | Onde pegar o valor                               |
| ------------------------- | ----- | ------------------------------------------------ |
| `link.mail`               | CNAME | Console do SES em `us-east-2`, Configuration Set |
| validação do rastreamento | CNAME | Console do ACM em `us-east-2`                    |

### 6.2 Domínio do painel — obrigatório para o painel funcionar

Não é cosmético, ao contrário do que esta seção afirmava. O `corsPreflight` da API libera um único origin, `https://${cfg.dominioPainel}`, e o domínio padrão do CloudFront (`d111....cloudfront.net`) não está nele. Servido de lá, o painel carrega e o login passa — o Amplify fala direto com o Cognito —, mas toda chamada à API é barrada pelo navegador.

Sintoma: telas vazias, sem mensagem que mencione CORS. Antes de investigar o painel, confira de qual origin ele está sendo servido.

O certificado é emitido **fora do deploy, de propósito**. Um certificado validado por DNS criado pelo CloudFormation deixa a implantação **bloqueada** até alguém publicar o CNAME de validação — e o CNAME só é conhecido depois que o certificado é solicitado. O deploy fica pendurado por até uma hora e falha com a stack em estado intermediário. Separando, o passo lento acontece uma vez, manualmente, e o deploy segue rápido e previsível.

**Solicite o certificado** — em `us-east-1`, exigência do CloudFront. O ARN fica numa variável de shell para os comandos seguintes, evitando copiar e colar:

```bash
ARN=$(aws acm request-certificate --domain-name campanhas.andrearaujoadvogados.com.br --validation-method DNS --region us-east-1 --query CertificateArn --output text) && echo "$ARN"
```

**Pegue o CNAME de validação.** Se vier vazio, espere alguns segundos — o ACM leva um instante para gerar o registro:

```bash
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN" --query "Certificate.DomainValidationOptions[0].ResourceRecord" --output table
```

**Publique esse CNAME** no provedor de DNS e aguarde a emissão:

```bash
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$ARN" && echo "emitido"
```

> Se a sessão do CloudShell reiniciar, recupere o ARN com `aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='campanhas.andrearaujoadvogados.com.br'].CertificateArn" --output text`.

**Registre o ARN como variável do repositório.** É ela que o pipeline passa para a stack:

```bash
gh variable set CERTIFICADO_ARN_PROD --repo andrearaujoadvogados/andre_campanhas --body "$ARN"
```

**Reimplante** (qualquer push na `main`, ou disparo manual do workflow). Só depois que a distribuição subir com o alias, aponte o registro do painel para a saída `DistribuicaoDominio` da stack Web.

Enquanto `CERTIFICADO_ARN_PROD` não existir, a stack sobe sem domínio customizado — que é o estado atual e não quebra nada.

---

## Aumentar a cota de concorrência do Lambda

Contas novas da AWS vêm com **10 execuções concorrentes** de Lambda no total — um limite baixo o bastante para o sistema funcionar, mas apertado.

Peça o aumento em **Service Quotas → AWS Lambda → Concurrent executions**, para 1000 (o padrão histórico). É gratuito e costuma sair em algumas horas.

Enquanto não sair, o sistema opera com o teto de concorrência no event source do SQS. Funciona, mas com margem menor para picos.

## O que continua travado de propósito

O sistema **não envia e-mail para ninguém** até que:

1. O acesso a produção do SES seja liberado (em análise na AWS). Até lá, a conta está em sandbox: só endereços verificados recebem.
2. Contatos sejam importados com vínculo classificado. Quem fica como `DESCONHECIDO` não recebe campanha (§6.2).
3. Uma campanha seja aprovada por um administrador diferente de quem a criou (§10.3).

Nenhuma dessas travas é acidental. Todas continuam valendo depois do deploy.
