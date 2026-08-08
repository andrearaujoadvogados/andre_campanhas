# Pendências — o que falta antes do primeiro envio

Retrato do estado operacional em 2026-08-07. Os procedimentos permanentes estão em [DEPLOY.md](DEPLOY.md) e [RUNBOOK.md](RUNBOOK.md); aqui fica só o que está aberto, na ordem em que importa.

Cada comando indica **onde roda**. Comandos `aws` rodam no CloudShell, no navegador — a máquina local não tem credenciais, deliberadamente.

## Situação

Retrato de 2026-08-08.

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **No ar**      | Seis stacks em três regiões, deploy automático, painel publicado pelo CDK |
| **Painel**     | https://campanhas.andrearaujoadvogados.com.br — funcionando               |
| **Links**      | `link.mail` servido com certificado próprio — resolvido                   |
| **Falta**      | Parte D: travas operacionais, nenhuma delas de infraestrutura             |
| **Aguardando** | SES ainda em sandbox; depende da AWS                                      |

Partes A, B e C concluídas. O que era procedimento virou histórico e está em [DEPLOY.md](DEPLOY.md); o que segue aberto é a Parte D.

### Registros de DNS em vigor

Publicados na zona da HostGator (`ns728`/`ns729`). Estão aqui porque, se alguém apagar um deles por engano, o sintoma não aponta para o DNS.

| Nome                  | Tipo  | Valor                           | Para quê                                 |
| --------------------- | ----- | ------------------------------- | ---------------------------------------- |
| `campanhas`           | CNAME | `d2buum95zy3wom.cloudfront.net` | Painel                                   |
| `link.mail`           | CNAME | `d2k61eafx1s5jq.cloudfront.net` | Rastreamento de abertura/clique          |
| `_838c4f0…campanhas`  | CNAME | `…acm-validations.aws`          | Renovação do certificado do painel       |
| `_51ba6b9d…link.mail` | CNAME | `…acm-validations.aws`          | Renovação do certificado do rastreamento |

Os dois registros com underline **não podem ser removidos**: o ACM os reconsulta para renovar os certificados automaticamente. Apagá-los não quebra nada hoje e quebra tudo na renovação, meses depois — que é o pior tipo de falha.

A HostGator leva ~2-3 minutos para um registro novo aparecer no autoritativo. Sumiço nesse intervalo é normal.

---

## Parte D — travas restantes

### Fechadas em 2026-08-08

- [x] **Conta raiz da AWS.** Existe o usuário IAM `fernando` com `AdministratorAccess` e MFA, login no console verificado. A raiz tem MFA e **nenhuma chave de acesso** (`AccountAccessKeysPresent: 0`) — era a exposição mais grave e não existia. A raiz fica reservada ao que só ela faz: encerrar conta, mudar plano de suporte, alterar dados de cobrança.
- [x] **Segundo usuário no Cognito.** Criado `contato@andrearaujoadvogados.com.br` no grupo `admin`.

### Abertas

- [ ] **Primeiro acesso do segundo admin.** Enquanto ele não trocar a senha provisória e cadastrar o MFA, o usuário existe e não consegue entrar — nenhuma campanha é aprovada. **A senha provisória expira em 7 dias**; depois disso, reenviar com `admin-create-user --message-action RESEND`.

  Duas características desta escolha, para decidir com os olhos abertos: `contato@` é caixa compartilhada, então quem tiver acesso a ela consegue recuperar a senha e assumir a conta; e o MFA fica vinculado ao celular de quem fizer o primeiro acesso — é essa pessoa, especificamente, que passa a aprovar campanhas. A regra que a aprovação por dois protege não é "duas credenciais", é que duas pessoas leiam o texto antes de ele sair em nome do escritório.

- [ ] **Trocar o segredo do MFA que apareceu numa captura de tela.** Segue aberta porque não se sabe **qual** MFA era: o da raiz da AWS ou o do usuário do Cognito. Quem tiver a imagem gera códigos válidos indefinidamente — um segredo TOTP não expira.

  Na dúvida, troque os dois; nenhum procedimento é destrutivo. Com o usuário IAM administrador funcionando, trocar o da raiz deixou de ter risco de trancar alguém para fora.

- [ ] **Confirmar as inscrições do SNS.** Quatro e-mails, dois endereços em duas regiões. Até alguém clicar, os alarmes de bounce disparam para o vazio — parece protegido e não está.

- [ ] **Importar os contatos com vínculo classificado.** Quem ficar como `DESCONHECIDO` não recebe campanha — é a trava de legítimo interesse (§6.2). A tela de importação está no ar em **Contatos → Importar CSV**, e lê o cabeçalho do arquivo para o mapeamento das colunas.

- [ ] **Aguardar a liberação de produção do SES.** Depende da AWS.
