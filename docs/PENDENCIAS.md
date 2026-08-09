# Pendências — o que falta antes do primeiro envio

Retrato do estado operacional em 2026-08-08. Os procedimentos permanentes estão em [DEPLOY.md](DEPLOY.md) e [RUNBOOK.md](RUNBOOK.md); aqui fica só o que está aberto, na ordem em que importa.

Cada comando indica **onde roda**. Comandos `aws` rodam no CloudShell, no navegador — a máquina local não tem credenciais, deliberadamente. Boa parte do que exigia CloudShell deixou de exigir: convidar usuário e trocar papel agora são telas.

## Situação

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

## Parte D — o que falta

### Resolvido em 2026-08-08

- [x] **Conta raiz da AWS.** Existe o usuário IAM `fernando` com `AdministratorAccess` e MFA, login no console verificado. A raiz tem MFA e **nenhuma chave de acesso** (`AccountAccessKeysPresent: 0`) — era a exposição mais grave, e o diagnóstico mostrou que não existia. A raiz fica reservada ao que só ela faz: encerrar conta, mudar plano de suporte, alterar dados de cobrança.

- [x] **Contas de acesso ao painel.** Criar conta deixou de passar pelo CloudShell: **Usuários** no painel convida por e-mail, troca papel, reenvia convite e remove acesso.

  Senha nenhuma trafega — não há campo no formulário, no contrato ou na permissão da Lambda, que exclui `AdminSetUserPassword` de propósito. Quem é convidado recebe a senha provisória por e-mail, define a definitiva e cadastra o MFA. Quem esquecer a senha usa o **Esqueci minha senha** da tela de login, que envia um código por e-mail; o MFA não é redefinido junto, e continua sendo pedido depois.

  Remover acesso **desativa**, não apaga: as campanhas guardam quem as criou e quem as aprovou, e esse registro perderia sentido se a conta sumisse.

  **Não existe exigência de um segundo aprovador.** Quantas contas existem é decisão de operação, não trava do sistema: quem escreve a campanha aprova a própria campanha.

- [x] **Aprovação destravada.** A exigência de que o aprovador fosse outra pessoa caiu, por decisão do escritório: quem escreve as campanhas é o advogado responsável por elas, e uma segunda pessoa não acrescentava revisão — acrescentava um passo que, com um usuário só, travou o sistema inteiro.

  A etapa continua, e não como formalidade: grava quem aprovou, quando, e o hash do conteúdo. Editar template, assunto ou audiência depois invalida a aprovação. É o último ponto de parada antes de um disparo que não volta atrás.

- [x] **Corpo do e-mail em editor visual.** Era caixa de texto com HTML cru. Agora tem formatação, listas, links e um seletor que insere campos como o primeiro nome do contato — digitá-los à mão rende texto vazio, sem erro nenhum, e só se percebe depois do envio. O botão **Editar HTML** continua disponível para colar um HTML pronto.

### Abertas

- [ ] **Importar os contatos com vínculo classificado.** É a última coisa entre o sistema e a primeira campanha: sem contatos não há para quem enviar, e quem entrar como `DESCONHECIDO` não recebe — é a trava de legítimo interesse (§6.2).

  A tela está em **Contatos → Importar CSV**. Ela lê o cabeçalho do arquivo e deixa mapear as colunas vendo os nomes reais, e avisa quando não há coluna de vínculo — nesse caso o vínculo padrão vale para o arquivo inteiro, que é como milhares de pessoas acabam classificadas por um chute só.

- [ ] **Pedir a liberação de produção do SES.** Depende da AWS e demora; adiar o pedido adia o go-live pelo mesmo tanto. Até lá, só é possível enviar para endereços verificados.

- [ ] **Confirmar as inscrições do SNS.** Quatro e-mails, dois endereços em duas regiões. Até alguém clicar, os alarmes de bounce e reclamação disparam para o vazio — parece protegido e não está, que é pior do que não ter alarme.

- [ ] **Trocar o segredo do MFA que apareceu numa captura de tela.** Aberta há três dias porque não se sabe **qual** MFA era: o da raiz da AWS ou o do usuário do Cognito.

  É o único item desta lista cujo risco não diminui com o tempo. Senha vazada envelhece, token é revogado, certificado vence — **segredo TOTP não expira**. Quem tiver aquela imagem gera códigos válidos hoje e daqui a dois anos, igual.

  Na dúvida, troque os dois; nenhum procedimento é destrutivo, e com o usuário IAM administrador funcionando não há mais risco de se trancar para fora da conta.

### Anotado, sem urgência

- [ ] **O endpoint `/saude` é inalcançável.** O authorizer do API Gateway cobre `/{proxy+}` inteiro, então ele responde 401 de fora. Não é falha de segurança — falha fechado —, mas é código que não faz o que foi escrito para fazer. Ou se exclui a rota do authorizer, ou se remove o endpoint.

- [ ] **Imagem no editor entra por endereço, não por upload.** Hospedar arquivo é outro problema — bucket, URL pública, ciclo de vida —, e imagem em base64 é bloqueada pela maioria dos clientes de e-mail. Se virar incômodo na prática, é uma tarefa própria.
