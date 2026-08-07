# Pendências — o que falta antes do primeiro envio

Retrato do estado operacional em 2026-08-07. Os procedimentos permanentes estão em [DEPLOY.md](DEPLOY.md) e [RUNBOOK.md](RUNBOOK.md); aqui fica só o que está aberto, na ordem em que importa.

Cada comando indica **onde roda**. Comandos `aws` rodam no CloudShell, no navegador — a máquina local não tem credenciais, deliberadamente.

## Situação

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| **No ar**      | Seis stacks em três regiões, deploy automático pelo GitHub Actions |
| **Quebrado**   | Os links dos e-mails não funcionam — parte B                       |
| **Aguardando** | SES ainda em sandbox; depende da AWS                               |

---

## Parte A — máquina nova

Só um arquivo do projeto não viaja pelo git, e ele está reproduzido no passo A3.

### A1. Conferir Node e ativar o pnpm

> Terminal local

```bash
node --version && corepack enable && corepack prepare pnpm@11.20.0 --activate
```

Node 22 ou mais novo. O `corepack` já vem junto.

### A2. Clonar e instalar

> Terminal local

```bash
git clone https://github.com/andrearaujoadvogados/andre_campanhas.git && cd andre_campanhas && pnpm install
```

Repositório privado, na organização do escritório. Se pedir autenticação, `gh auth login`.

### A3. Recriar a configuração do painel

> Terminal local, dentro da pasta do projeto

```bash
cat > apps/admin-web/.env.local <<'EOF'
VITE_API_URL=https://js6vv6ec3i.execute-api.sa-east-1.amazonaws.com
VITE_USER_POOL_ID=sa-east-1_bDlD1KImH
VITE_USER_POOL_CLIENT_ID=70s7ev3ca55q6v5oslef1riuv5
EOF
```

Estes valores **não são segredo** — id de user pool e de client ficam embutidos no bundle de qualquer aplicação com Cognito. Ficam fora do git para não versionar configuração de ambiente.

### A4. Confirmar que o ambiente está igual

> Terminal local

```bash
AWS_ACCOUNT_DEV=000000000000 EMAIL_ALARMES=local@exemplo.invalido pnpm run verificar
```

As duas variáveis existem porque a última etapa do `verificar` é o `cdk synth`, e o [config.ts](../infra/lib/config.ts) se recusa a assumir valores padrão para conta e destinatário de alarme. Os valores acima são fictícios de propósito: `synth` não toca a AWS. São os mesmos que o pipeline usa — ver o passo _Synth + cdk-nag_ em [ci.yml](../.github/workflows/ci.yml).

---

## Parte B — rastreamento com certificado próprio (prioridade)

> **Os links dos e-mails estão mortos.**
>
> O Configuration Set foi implantado com domínio de rastreamento próprio (`link.mail.andrearaujoadvogados.com.br`, em [sending-stack.ts](../infra/lib/stacks/sending-stack.ts)). O SES **já reescreve todo link do e-mail** para esse endereço. Como ele não existe no DNS, quem clicar recebe erro. Nenhuma campanha deve sair antes disso.

### Por que um CNAME direto não serve

O destino natural seria o endpoint regional `r.us-east-2.awstrack.me`, que de fato existe e resolve para um ALB da AWS. Mas ele serve um certificado de `CN=r.us-east-2.awstrack.me`, que **não cobre** o domínio do escritório — verificado em 2026-08-07:

```
curl: (60) SSL: no alternative certificate subject name matches
      target hostname 'link.mail.andrearaujoadvogados.com.br'
```

Um CNAME cru, portanto, não conserta: troca "link que não abre" por "link com aviso de certificado inválido" — em e-mail de escritório de advocacia, indistinguível de phishing. É pior que o estado atual.

Por isso o `link.mail` é servido por uma **distribuição CloudFront própria**, em [web-stack.ts](../infra/lib/stacks/web-stack.ts): ela termina o TLS com certificado nosso e repassa para o endpoint do SES, que continua registrando o clique. Duas decisões dela não são ajuste de desempenho e sim correção:

- **Cache desligado.** Cada URL de rastreamento identifica um destinatário e uma mensagem. Resposta servida do cache não chega ao SES, e o clique não é contado.
- **`AllViewerExceptHostHeader`.** O SES roteia pelo host da origem; mandar o nosso faria o endpoint não reconhecer a requisição.

No mesmo movimento, o `HttpsPolicy` do Configuration Set passou de `OPTIONAL` para `REQUIRE`. O padrão embrulha o pixel de abertura em `http://`, que clientes de e-mail bloqueiam dentro de mensagem HTTPS — a métrica de abertura vinha subnotificada sem nada acusar erro.

### B1. Certificado ACM para o domínio de rastreamento

> CloudShell — em `us-east-1`, exigência do CloudFront

```bash
ARN_LINK=$(aws acm request-certificate --domain-name link.mail.andrearaujoadvogados.com.br --validation-method DNS --region us-east-1 --query CertificateArn --output text) && echo "$ARN_LINK"
```

```bash
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN_LINK" --query "Certificate.DomainValidationOptions[0].ResourceRecord" --output table
```

Publique o CNAME de validação e espere a emissão. **A distribuição só é criada se o certificado for informado** — sem ele a stack sobe sem o rastreamento, sem quebrar.

### B2. Registrar o ARN

> Terminal local — o `gh` não existe no CloudShell

```bash
gh variable set CERTIFICADO_RASTREAMENTO_ARN_PROD --repo andrearaujoadvogados/andre_campanhas --body "$ARN_LINK"
```

### B3. Implantar e apontar o DNS

Depois do deploy, a stack Web devolve a saída `RastreamentoDominio`. É esse o destino:

| Nome        | Tipo  | Valor                                      |
| ----------- | ----- | ------------------------------------------ |
| `link.mail` | CNAME | a saída `RastreamentoDominio` da stack Web |

Apontar antes do deploy não funciona: o CloudFront recusa host que não esteja na lista de aliases da distribuição.

### B4. Conferir a propagação

```bash
dig +short link.mail.andrearaujoadvogados.com.br
```

Na HostGator, o cluster de DNS leva ~2-3 minutos para o registro aparecer no autoritativo. Sumiço nesse intervalo é normal e não indica erro de publicação.

### Saída alternativa

Se for preciso destravar o envio antes de tudo isso: remova `customTrackingRedirectDomain` de [sending-stack.ts](../infra/lib/stacks/sending-stack.ts) e reimplante. Os links voltam a funcionar via `awstrack.me` — feios, mas com certificado válido. É uma escolha legítima, e a volta é a mesma linha.

---

## Parte C — domínio do painel (não é cosmético)

> **O painel não funciona de lugar nenhum hoje.**
>
> O `corsPreflight` da API aceita um único origin, `https://campanhas.andrearaujoadvogados.com.br` — ver [core-stack.ts](../infra/lib/stacks/core-stack.ts). O domínio padrão do CloudFront **não está na lista**, e o mesmo vale para o CORS do bucket de uploads.
>
> Servido pelo CloudFront, o painel carrega e o login até passa — o Amplify fala direto com o Cognito, que aceita qualquer origin. Mas toda chamada à API é barrada pelo navegador, e as telas ficam vazias com um erro de rede que não menciona CORS. Enquanto `campanhas` não apontar para a distribuição, não há de onde usar o painel.

A sequência completa de emissão do certificado está no passo 6.2 de [DEPLOY.md](DEPLOY.md).

### C1. Ver se o certificado já foi emitido

> CloudShell

```bash
aws acm list-certificates --region us-east-1 --certificate-statuses PENDING_VALIDATION ISSUED --query "CertificateSummaryList[?DomainName=='campanhas.andrearaujoadvogados.com.br'].[Status,CertificateArn]" --output table
```

| Resultado            | Significa                                                   |
| -------------------- | ----------------------------------------------------------- |
| `ISSUED`             | Pronto, siga para C2                                        |
| `PENDING_VALIDATION` | O ACM ainda não enxergou o CNAME de validação               |
| tabela vazia         | O certificado não chegou a ser criado; refaça a solicitação |

### C2. Registrar o ARN

> Terminal local — o `gh` não existe no CloudShell

```bash
gh variable set CERTIFICADO_ARN_PROD --repo andrearaujoadvogados/andre_campanhas --body 'ARN_AQUI'
```

Ou pelo site, em **Settings → Secrets and variables → Actions → Variables**.

### C3. Reimplantar

Qualquer push no `main` dispara o pipeline. Depois que a distribuição subir com o alias, aponte o registro do painel para a saída `DistribuicaoDominio` da stack Web.

---

## Parte D — travas restantes

- [ ] **Confirmar as inscrições do SNS.** Quatro e-mails, dois endereços em duas regiões. Até alguém clicar, os alarmes de bounce disparam para o vazio — parece protegido e não está.
- [ ] **Criar um segundo usuário admin no Cognito.** Quem cria a campanha não pode aprová-la; com um único usuário, nenhuma campanha sai.
- [ ] **Trocar o segredo do MFA.** A chave apareceu numa captura de tela durante a configuração.
- [ ] **Parar de usar a conta raiz da AWS.** Criar um usuário IAM administrador e ativar MFA na raiz. É a exposição mais séria que resta, e piora agora que o acesso acontece de mais de um lugar.
- [ ] **Importar os contatos com vínculo classificado.** Quem ficar como `DESCONHECIDO` não recebe campanha — é a trava de legítimo interesse (§6.2).
- [ ] **Aguardar a liberação de produção do SES.** Depende da AWS.
