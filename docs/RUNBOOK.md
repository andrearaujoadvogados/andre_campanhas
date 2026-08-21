# Runbook operacional

**Escrito para quem não construiu o sistema.** Se algum procedimento aqui exigir conhecer o código, ele está mal escrito — abra uma issue.

> Status: esqueleto. Os procedimentos marcados 🚧 dependem de partes ainda não implementadas.

---

## Antes de tudo: os dois números que importam

| Métrica                    | Limite de alerta | Limite de perigo | Por quê                                                                                  |
| -------------------------- | ---------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Taxa de bounce             | 5%               | ~10%             | Acima disso a AWS pode **suspender a conta**. Não é multa, é parada total                |
| Taxa de reclamação de spam | 0,1%             | 0,3%             | Limite prático de Gmail e Yahoo. Acima, os e-mails passam a cair em spam para todo mundo |

Se qualquer um dos dois disparar, **pare as campanhas primeiro e investigue depois**. Reputação leva meses para reconstruir.

---

## Incidente: taxa de bounce acima de 5%

1. Pausar toda campanha em andamento pelo painel (ou, se ele estiver fora, ver "Parada de emergência").
2. Ver quais endereços deram bounce e de qual importação vieram.
3. Se concentrado em um lote de importação: a lista está velha ou suja. Não retomar até higienizar.
4. Se espalhado por toda a base: pode ser problema de autenticação (DKIM/SPF/DMARC) — checar o painel de reputação do SES antes de retomar.
5. Registrar o que aconteceu neste arquivo.

## Incidente: reclamações de spam acima de 0,1%

Reclamação é mais grave que bounce: significa que a pessoa **recebeu, leu e não queria**. Investigue o conteúdo e a origem da lista, não a infraestrutura.

Perguntas na ordem certa:

- Esses contatos tinham vínculo real com o escritório? (campo `relacionamento`)
- O link de descadastro estava visível? Se a pessoa não acha como sair, ela marca como spam.
- O assunto correspondia ao conteúdo?

## Incidente: fila de envio parada

Alarme: `ApproximateAgeOfOldestMessage > 1h` na `send-queue`.

Causas prováveis, em ordem de frequência:

1. Campanha pausada e ninguém retomou — as mensagens ficam reenfileirando com atraso, por desenho.
2. Circuit breaker aberto por falha de credencial do SES.
3. `sender` com erro em todas as invocações — ver log e DLQ.

## Incidente: mensagens na DLQ

Qualquer item em DLQ exige olho humano — é por isso que o alarme dispara em ≥ 1.

O que costuma cair em cada DLQ:

| Fila                     | Causa típica                                                                      | O que fazer                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `send-queue-dlq`         | Erro transitório persistente do SES, ou payload malformado                        | Ler a mensagem. Reprocessar é seguro: o `sendId` é determinístico e a idempotência barra duplicata |
| `event-queue-dlq`        | Evento do SES em formato não reconhecido, ou evento órfão que nunca achou o envio | Se for tipo de evento novo da AWS, atualizar o tradutor em `ses-event-parser.ts`                   |
| `event-inbox-dlq` (Ohio) | Falha ao repassar para São Paulo                                                  | Reprocessar; o repasse é idempotente na ponta de destino                                           |
| `import-queue-dlq`       | CSV inacessível no S3 ou mapeamento de colunas errado                             | Corrigir e reenviar a importação                                                                   |

> **Reprocessar envio é seguro.** A guarda de idempotência (`send:<sendId>`) tem TTL de 7 dias: dentro desse prazo, uma mensagem já enviada não sai de novo.

## Incidente: `AccountSendingPaused`

A AWS suspendeu o envio da conta. **Não tente contornar.** Abra caso no Support imediatamente e não reative nada até entender a causa.

---

## Parada de emergência (sem o painel)

Duas alavancas, da mais suave para a mais drástica:

1. **Pausar a campanha** pelo painel (`POST /campanhas/{id}/pausa`). O `sender` consulta o status uma vez por lote e passa a adiar as mensagens. Mensagens já entregues ao SES ainda saem — a pausa não é retroativa.
2. **Zerar a taxa no Parameter Store**: `/emailmkt/prod/ses/maxSendRate`. O `sender` recusa taxa ≤ 0 e para de enviar. Cuidado: o `quota-sync` sobrescreve esse valor na próxima execução diária.
3. **Desabilitar `sendingEnabled` no Configuration Set** (console do SES, região `us-east-2`). Interrompe o envio sem perder a fila — as mensagens ficam retidas e voltam quando reabilitar.

> A opção 3 é a mais forte e a única que não depende de nenhum código nosso estar funcionando.

---

## Procedimentos de rotina

### Antes da primeira campanha de uma lista nova

- [ ] Conferir a declaração de origem do lote importado.
- [ ] Conferir quantos contatos ficaram como `DESCONHECIDO` (não recebem — por desenho).
- [ ] Importar a lista de descadastros de qualquer ferramenta anterior. **Antes**, não depois. (Motivo de supressão: `IMPORTADA_FERRAMENTA_ANTERIOR`.)
- [ ] Aquecer: começar com poucas centenas antes de disparar para tudo.

### Solicitação de exclusão de dados (LGPD art. 18)

Duas portas, e ambas já funcionam:

- **Pelo próprio titular**, no link de descadastro de qualquer e-mail: o segundo botão registra _oposição ao tratamento_, não só o fim dos envios.
- **Pelo escritório**, via `DELETE /contatos/{id}` (exige papel `ADMIN`). Apaga o contato e mantém apenas o hash do e-mail na supressão, para que uma reimportação futura não traga a pessoa de volta (§6.2).

**Exportação de portabilidade e acesso** (art. 18, II e V): `POST /contatos/{id}/exportacao` pelo painel, com papel `ADMIN`.

1. Confirme a identidade do titular antes — o art. 18, §5º permite exigir isso, e é a razão de a rota não ser pública.
2. Baixe os dois arquivos dentro de 5 minutos (os links expiram).
3. Entregue por canal seguro. **Não por e-mail**: o arquivo reúne num só lugar tudo que se sabe sobre a pessoa.
4. Os arquivos somem do S3 em 7 dias, sozinhos.

### Ligar o boletim automático (uma vez)

O boletim coleta notícias com a API do Google Gemini, no nível gratuito. Sem a
chave configurada, a coleta roda, não gera nada e explica isso no log — nada
quebra, mas nada acontece.

1. Crie a chave em <https://aistudio.google.com/apikey> (conta Google comum;
   o nível gratuito cobre um boletim semanal com folga).
2. Grave no Secrets Manager, em `sa-east-1`:

```bash
aws secretsmanager put-secret-value --secret-id emailmkt-prod-gemini-api-key --secret-string 'A_CHAVE_AQUI' --region sa-east-1
```

3. No painel, em **Boletim**, cadastre as fontes e clique em **Gerar boletim
   agora** para testar. O modelo aparece em **Modelos**, categoria Boletim,
   em um ou dois minutos.

A coleta agendada roda toda segunda às 8h (gera só o modelo, sem enviar).
Além dela, as **rotinas de envio automático** na tela Boletim geram E enviam
sem revisão, no período e horário cadastrados — cada rotina com nome, fontes,
temas, tipo de campanha e listas de destino próprios (uma campanha por lista).
**Atenção ao nível gratuito**: os
dados enviados ao Gemini podem ser usados pelo Google para treinamento — por
isso o worker só envia texto de páginas públicas de notícia, nunca dados de
contatos. Se um dia isso mudar de figura, trocar para a versão paga é só
trocar a chave.

### Quando a produção do SES for liberada

Nada a implantar. O worker `quota-sync` lê a cota real do SES diariamente e atualiza o Parameter Store; o limitador de taxa passa a usar o novo valor sozinho (§1.3).

Confirmar depois de 24h que `/emailmkt/prod/ses/maxSendRate` mudou.

---

## Contatos

| Assunto                               | Quem                                  |
| ------------------------------------- | ------------------------------------- |
| Infraestrutura e código               | Responsável técnico do sistema        |
| Conteúdo e aprovação de campanha      | Advogado responsável pela comunicação |
| LGPD, base legal, direitos do titular | Encarregado de dados do escritório    |
| Conta AWS, faturamento                | Escritório (titular da conta)         |
