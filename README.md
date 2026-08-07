# Sistema de E-mail Marketing — André Araújo Advogados

Sistema de campanhas de e-mail do escritório André Araújo Advogados.

A arquitetura completa está em **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)** — leia antes de mexer em qualquer coisa. As decisões estão registradas como ADRs na seção 3, e nenhuma delas é acidental.

## Estado atual

**Scaffolding.** A estrutura, o domínio e as stacks existem; os adaptadores AWS e a interface ainda não. Nada foi implantado na AWS.

## Começando

```bash
pnpm install
```

```bash
pnpm verificar
```

O comando acima roda lint, formatação, typecheck, testes e `cdk synth` — o mesmo que o pipeline executa. (O nome não é `ci` porque o pnpm já tem um comando embutido com esse nome.)

## Estrutura

| Caminho                 | O que é                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `packages/core`         | Domínio e casos de uso. **Não conhece AWS.** Testável em milissegundos |
| `packages/contracts`    | Schemas Zod compartilhados entre frontend e backend                    |
| `packages/adapters-aws` | Implementações dos ports do core (DynamoDB, SES, SQS, S3)              |
| `packages/email-render` | Renderização Liquid, CSS inline, versão texto                          |
| `services/`             | Handlers Lambda — camada fina sobre os casos de uso                    |
| `infra/`                | CDK v2, três stacks regionais                                          |
| `apps/admin-web`        | Painel administrativo (React)                                          |

## A regra que não se negocia

`packages/core` não importa AWS, não importa HTTP, não importa Zod. O ESLint quebra o build se alguém tentar — ver `eslint.config.mjs`. Se você precisa de infraestrutura dentro do domínio, o que falta é um _port_, não uma exceção.

## Rodando o painel localmente

Copie `apps/admin-web/.env.example` para `.env.local` e preencha com as saídas do CDK (`ApiUrl`, `UserPoolId`, `UserPoolClientId`). Depois:

```bash
pnpm --filter @emailmkt/admin-web dev
```

O painel usa o **ID token** do Cognito, não o access token — o authorizer do HTTP API valida `aud`, e só o ID token o carrega.

## Regiões

| Região      | O que roda                                           |
| ----------- | ---------------------------------------------------- |
| `sa-east-1` | Dados e regras de negócio                            |
| `us-east-2` | SES e ingestão de eventos (identidade já verificada) |
| `us-east-1` | Apenas o certificado ACM do CloudFront               |

## Segurança

- Nenhum segredo no repositório. Configuração em SSM Parameter Store, segredos em Secrets Manager.
- Nenhum arquivo de contatos versionado — `.gitignore` bloqueia `*.csv` por padrão.
- Deploy só por pipeline, com aprovação manual antes de produção.
