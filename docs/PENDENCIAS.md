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
pnpm run verificar
```

---

## Parte B — CNAME de rastreamento (prioridade)

> **Os links dos e-mails estão mortos.**
>
> O Configuration Set já foi implantado com domínio de rastreamento próprio (`link.mail.andrearaujoadvogados.com.br`, em [sending-stack.ts](../infra/lib/stacks/sending-stack.ts)). O SES **já reescreve todo link do e-mail** para esse endereço. Como ele não existe no DNS, quem clicar recebe erro — não é um link feio, é um link quebrado. Nenhuma campanha deve sair antes disso.

### B1. Ver o que está configurado

> CloudShell

```bash
aws sesv2 get-configuration-set --configuration-set-name emailmkt-prod-config-set --region us-east-2 --query TrackingOptions
```

### B2. Pegar o valor do CNAME

> Navegador

**SES → Configuration sets → `emailmkt-prod-config-set`**, região **Ohio (us-east-2)**.

O destino esperado é o endpoint regional `r.us-east-2.awstrack.me`, mas **use o que o console mostrar** — isto não foi verificado. Se o SES pedir algum passo extra de certificado para servir HTTPS nesse subdomínio, ele aparece nessa mesma tela.

### B3. Criar o registro

> Painel do provedor de DNS

| Nome        | Tipo  | Valor                          |
| ----------- | ----- | ------------------------------ |
| `link.mail` | CNAME | o que o console do SES mostrar |

Alguns provedores exigem o nome completo em vez do prefixo. Se não funcionar, é o primeiro palpite.

### B4. Conferir a propagação

> CloudShell

```bash
dig +short link.mail.andrearaujoadvogados.com.br
```

### Saída alternativa

Se o DNS demorar e você quiser destravar o envio antes: remova `customTrackingRedirectDomain` de `infra/lib/stacks/sending-stack.ts` e reimplante. Os links voltam a funcionar via `awstrack.me` — feios, mas vivos. É uma escolha legítima.

---

## Parte C — domínio do painel (opcional)

Cosmético. Sem isso o painel responde no domínio do CloudFront, que funciona. A sequência completa de emissão do certificado está no passo 6.2 de [DEPLOY.md](DEPLOY.md).

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
