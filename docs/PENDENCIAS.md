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

- [ ] **Confirmar as inscrições do SNS.** Quatro e-mails, dois endereços em duas regiões. Até alguém clicar, os alarmes de bounce disparam para o vazio — parece protegido e não está.
- [ ] **Criar um segundo usuário admin no Cognito.** Quem cria a campanha não pode aprová-la; com um único usuário, nenhuma campanha sai.
- [ ] **Trocar o segredo do MFA.** A chave apareceu numa captura de tela durante a configuração.
- [ ] **Parar de usar a conta raiz da AWS.** Criar um usuário IAM administrador e ativar MFA na raiz. É a exposição mais séria que resta, e piora agora que o acesso acontece de mais de um lugar.
- [ ] **Importar os contatos com vínculo classificado.** Quem ficar como `DESCONHECIDO` não recebe campanha — é a trava de legítimo interesse (§6.2).
- [ ] **Aguardar a liberação de produção do SES.** Depende da AWS.
