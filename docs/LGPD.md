# LGPD — registro de tratamento

> **Este documento é responsabilidade do encarregado de dados do escritório.** O que está aqui é o esqueleto e o que o sistema já garante tecnicamente. As decisões jurídicas — em especial o LIA — precisam do encarregado de dados.

**Base legal adotada:** legítimo interesse (art. 7º, IX), decidida em 2026-08-06.

---

## O que a escolha de legítimo interesse exige

Com consentimento, a prova é o registro do aceite. Com legítimo interesse, **o ônus da prova é do controlador**: é preciso demonstrar que o tratamento era esperado, necessário e proporcional. Os itens abaixo não são boas práticas — são o que sustenta a base legal.

| #   | Item                                                           | Responsável               | Status                                                                            |
| --- | -------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| 1   | **LIA — teste de balanceamento documentado**                   | Encarregado do escritório | 🔴 Pendente                                                                       |
| 2   | Vínculo comprovável por contato                                | Sistema + operador        | 🟢 Campo `relacionamento` obrigatório; `DESCONHECIDO` não recebe campanha         |
| 3   | Direito de oposição destacado                                  | Sistema                   | 🟢 Status `OPOSICAO` distinto de `DESCADASTRADO`                                  |
| 4   | Transparência no rodapé (base legal, finalidade, como se opor) | Conteúdo                  | 🔴 Pendente — depende do template                                                 |
| 5   | Revisão periódica do vínculo                                   | Sistema                   | 🟡 Regra existe (24 meses, padrão conservador); **o prazo definitivo sai do LIA** |
| 6   | Descadastro em um clique, sem login                            | Sistema                   | 🟢 Implementado no domínio; endpoint na fase MVP                                  |

### Sobre o item 1 — o LIA

Sem ele, a base legal é uma alegação, não uma justificativa. O LIA precisa cobrir:

- **Finalidade legítima** — comunicação informativa a quem tem relação com o escritório.
- **Necessidade** — por que e-mail, e por que esses dados e não menos.
- **Expectativa legítima do titular** — a pessoa esperaria receber isso? É aqui que o prazo de validade do vínculo (item 5) é definido de fato.
- **Salvaguardas** — descadastro em um clique, oposição, minimização, dados em São Paulo.

O sistema referencia a **versão** do LIA em cada contato (`liaVersao`), para que uma revisão futura não apague o que valia antes.

---

## Dados tratados

| Dado                                         | Finalidade                 | Obrigatório                       |
| -------------------------------------------- | -------------------------- | --------------------------------- |
| E-mail                                       | Envio da comunicação       | Sim                               |
| Nome                                         | Personalização             | Não                               |
| Relacionamento e data de início              | **Prova da base legal**    | Sim                               |
| Campos customizados                          | Segmentação                | Não — exigem finalidade declarada |
| Eventos de envio (entrega, abertura, clique) | Métrica e higiene da lista | Gerado pelo sistema               |

**Minimização:** campos customizados não devem ser criados "por precaução". Cada um precisa de finalidade declarada.

---

## Retenção

| Dado                                  | Prazo                     | Justificativa                                                 |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Eventos de envio                      | 13 meses (TTL automático) | Comparação ano a ano; além disso não há utilidade             |
| Métricas agregadas por campanha       | Indefinido                | Não contêm dado pessoal                                       |
| Contatos inativos há mais de 24 meses | Revisão                   | Expectativa legítima decai                                    |
| Hash de e-mail na supressão           | Indefinido                | **Necessário para honrar o próprio descadastro** — ver abaixo |
| Log de auditoria                      | 5 anos                    | Prestação de contas                                           |
| Log de aplicação                      | 30 dias                   | Diagnóstico                                                   |
| CSV importado (S3)                    | 90 dias                   | Auditar a importação                                          |

### O ponto delicado: exclusão vs. supressão

Quando alguém exerce o direito de exclusão, apagamos o contato — mas mantemos o **hash SHA-256 salgado** do e-mail na lista de supressão.

A razão é um conflito real entre dois deveres: se apagássemos também o registro de supressão, uma reimportação futura do CSV traria a pessoa de volta e ela voltaria a receber o que pediu para não receber. O hash permite responder "este endereço está suprimido?" sem reter o dado pessoal identificável.

**Isso precisa constar na política de privacidade.**

---

## Direitos do titular

| Direito              | Como é atendido                                   | Status |
| -------------------- | ------------------------------------------------- | ------ |
| Confirmação e acesso | Centro de preferências por token assinado         | 🚧 MVP |
| Correção             | Centro de preferências                            | 🚧 MVP |
| Eliminação           | Exclusão + hash na supressão                      | 🚧 MVP |
| Portabilidade        | Export JSON/CSV por link presignado de vida curta | 🚧 MVP |
| Oposição             | Status `OPOSICAO`, link no rodapé                 | 🚧 MVP |
| Revogação            | Não se aplica (não é consentimento)               | —      |

---

## Localização dos dados e transferência internacional

- **Dados em repouso:** `sa-east-1` (São Paulo).
- **Transferência internacional:** o conteúdo do e-mail transita pelo SES em `us-east-2` (Ohio) no momento do envio, e os eventos de entrega retornam por lá. Base: art. 33 da LGPD, com as cláusulas contratuais do DPA da AWS.
- **Isto precisa constar na política de privacidade.**

---

## Como a exportação funciona

`POST /contatos/{id}/exportacao`, **restrito a ADMIN**. Gera dois arquivos e devolve links presignados de 5 minutos:

- `dados.json` — dossiê completo: identificação, situação, base legal com o vínculo que a sustenta, e o histórico de cada e-mail recebido com data de entrega, abertura e clique.
- `comunicacoes.csv` — o mesmo histórico em planilha, com BOM UTF-8 para abrir corretamente no Excel.

**Por que não é autoatendimento pelo link do e-mail.** Seria tentador reusar o token do descadastro, mas ele é permanente por desenho — precisa funcionar anos depois, num e-mail que pode ter sido encaminhado. Um link permanente que entrega o dossiê completo de uma pessoa é outra categoria de risco. O art. 18, §5º permite ao controlador exigir comprovação de identidade, e é isso que o escritório faz antes de acionar a rota.

Um portal de autoatendimento continua possível, mas exigiria um token com propósito próprio e validade curta — não o de descadastro.

**Entrega ao titular:** por canal seguro, **não por e-mail**. O arquivo reúne num só lugar tudo que se sabe sobre a pessoa.

**A exportação é auditada** como qualquer outro tratamento: fica registrado quem exportou o dossiê de quem, quando e de qual IP.

## Pendências

- [ ] LIA redigido e aprovado pelo encarregado
- [ ] Política de privacidade atualizada: base legal, transferência internacional, hash na supressão
- [ ] ROPA (registro de operações de tratamento) preenchido
- [ ] DPA da AWS revisado e arquivado
- [ ] Rodapé padrão dos e-mails: razão social, CNPJ, endereço físico, contato do encarregado
- [ ] Definir o prazo real de validade do vínculo (hoje: 24 meses, provisório)
- [ ] Origem da base atual do escritório documentada por lote
