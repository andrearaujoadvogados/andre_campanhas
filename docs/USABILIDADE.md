# Usabilidade — avaliação heurística e decisões de interface

Avaliação do painel pelas 10 heurísticas de Nielsen, feita em 2026-08-21 sobre o
código das telas (Visão geral, Campanhas/assistente, Listas, Contatos, Modelos,
Boletim, Tipos, Usuários, Login). Registra o que já estava resolvido — para
ninguém "corrigir" de volta —, o que foi corrigido nesta rodada e o que ficou
anotado. Uma rodada anterior (2026-08) já havia tratado CRUD incompleto e
fluxos sem saída; esta é a segunda passada.

## Princípios que o painel já segue (não regredir)

- **Alvo de toque de 44px** em tudo que é clicável (WCAG 2.5.5) — inclusive
  links soltos, que declaram `min-h-11` por não passarem pelo `<Botao>`.
- **Cor nunca é o único sinal**: selo tem texto, erro tem ícone e caixa, campo
  obrigatório tem asterisco _e_ anúncio para leitor de tela.
- **Foco visível global** (`:focus-visible` no `index.css`), skip link para o
  conteúdo, `aria-busy` em botão ocupado, `aria-pressed` em filtro ativo,
  `role="alert"` em erro de campo, Esc fecha o menu do celular.
- **Rótulos envolvem os controles** (`<label>` wrapping) — associação sem `id`
  manual, que é a fonte clássica de rótulo apontando para o campo errado.
- **Texto de risco vem do domínio**, não da tela (avisos de bounce, limiares).

## As 10 heurísticas — achados e desfechos

### 1. Visibilidade do estado do sistema

**Já resolvido antes:** botão em espera mostra spinner + "Aguarde…"; a geração
do boletim tem painel de progresso com batimento (distingue "demorando" de
"morreu"); disparo mostra processados/total; campanha travada é denunciada na
Visão geral.

**Corrigido nesta rodada:** formulários que limpavam os campos como único
sinal de sucesso agora confirmam com frase específica — Contatos ("Contato
fulano@… cadastrado."), fonte do boletim ("Fonte 'Migalhas' adicionada.") e
rotina de envio ("Rotina criada: toda segunda-feira às 08:00."). Campo vazio
também é a cara de um erro que descartou tudo; a frase tira a ambiguidade. A
confirmação da rotina repete a recorrência por extenso de propósito: é a
releitura do que foi armado, antes do primeiro disparo automático.

### 2. Correspondência entre o sistema e o mundo real

**Já resolvido:** datas em pt-BR no fuso de São Paulo; "Vínculo com o
escritório" em vez de jargão; recorrência descrita como frase ("Toda
segunda-feira às 08:00") e não como cron; instrução de fonte "como instruiria
um estagiário".

**Sem achados novos.**

### 3. Controle e liberdade do usuário

**Já resolvido:** cancelar edição em todo formulário de edição; pausar/retomar
disparo; rotina desliga sem perder a configuração; Esc fecha o menu.

**Anotado, sem mudança:** ações destrutivas usam `window.confirm` — feio, mas
acessível e consistente; um diálogo próprio entraria como melhoria visual, não
funcional. Não há "desfazer" pós-exclusão; o custo (soft delete geral) não se
paga para o volume de uso atual.

### 4. Consistência e padrões

**Corrigido nesta rodada — o achado que motivou a rodada:** campos com texto
de ajuda desalinhavam dos vizinhos na mesma linha, porque a ajuda ficava entre
o rótulo e o controle e empurrava o controle para baixo (visível em Contatos:
Telefone e Vínculo mais baixos que os pares). A ajuda passou para **baixo do
controle**, no componente `Campo` — uma mudança, todos os ~30 usos alinhados.
Ordem final: rótulo → controle → erro → ajuda (o erro cola no controle que o
causou). Também normalizadas ajudas fora do padrão de frase ("horário de
Brasília" → "Horário de Brasília.") e o alvo de 44px nos checkboxes de lead.

### 5. Prevenção de erros

**Já resolvido:** seleção vazia não vira "enviar para todos"; dia do mês
limitado a 28 (29–31 pulariam meses em silêncio); semanal exige o dia (nenhum
padrão decide escondido); lista validada no cadastro da rotina, não no
primeiro disparo; campos de variável inseridos por seletor (digitar à mão
rende texto vazio); datas do dashboard com `min`/`max` cruzados.

**Sem achados novos.**

### 6. Reconhecimento em vez de memorização

**Já resolvido:** selects mostram nomes, nunca ids; o modelo recomendado
aparece marcado no assistente; a lista de destino da rotina aparece pelo nome
na listagem ("Envia para Clientes").

**Corrigido nesta rodada (arquitetura da informação):** a navegação lateral
deixou de ser oito itens soltos e ganhou grupos nomeados — **Envio**
(Campanhas, Boletim), **Público** (Listas, Contatos), **Conteúdo** (Modelos,
Tipos), **Administração** (Usuários), com Visão geral no topo. O olho pula
direto ao grupo certo, e os rótulos dão nome ao modelo do sistema (a distinção
Campanhas × Boletim só fica clara quando os dois aparecem sob "Envio"). Para
leitor de tela, cada grupo é `role="group"` com `aria-label` — o mesmo
agrupamento que o olho recebe, sem virar heading falso.

### 7. Flexibilidade e eficiência de uso

**Já resolvido:** Enter submete os formulários (são `<form>` de verdade);
filtros por chip com um clique; duplicar campanha; "Gerar boletim agora" ao
lado da rotina agendada.

**Anotado, sem mudança:** não há atalhos de teclado nem ações em lote além da
seleção de destinatários — o volume de uso (um escritório) não os pede ainda.

### 8. Design estético e minimalista

**Já resolvido:** o bloco "Precisa da sua atenção" só existe quando há motivo
(painel verde todo dia treina a ignorá-lo); taxas só aparecem depois que algo
saiu (quatro zeros parecem fracasso); densidade de ferramenta, não de peça de
comunicação.

**Corrigido nesta rodada:** o alinhamento (heurística 4) é também o principal
ganho estético — a linha do formulário volta a ser uma linha.

### 9. Ajudar a reconhecer e recuperar erros

**Já resolvido:** erros por campo vindos do backend destacam o campo certo
(`FalhaApi.porCampo`); a falha do envio automático aparece em destaque sem
apagar o modelo gerado; avisos por fonte dizem o que corrigir ("HTTP 403"),
não só "falhou"; e-mail de teste lista o motivo por endereço.

**Corrigido nesta rodada:** o formulário da rotina de envio só mostrava o erro
na caixa geral; agora os erros por campo chegam ao campo (horário, dia, lista)
como nos demais formulários.

### 10. Ajuda e documentação

**Já resolvido:** cada campo não óbvio tem ajuda curta no lugar do uso; textos
explicam consequência, não mecânica ("não vai no e-mail", "o dia escolhido
entra inteiro"); a tela do boletim explica o fluxo inteiro em um parágrafo.

**Sem achados novos** — com a ressalva de que ajuda em tela substitui manual
para este porte de sistema; documentação formal continua nos `docs/`.

## Anotado para depois (fora desta rodada)

- Diálogo de confirmação próprio no lugar de `window.confirm` (heurística 3) —
  ganho visual; o comportamento atual é acessível.
- Duração dos avisos de sucesso: hoje persistem até a próxima ação; um
  auto-dismiss pediria pausa configurável para leitores lentos (WCAG 2.2.1) —
  persistir é o comportamento seguro, ficou como está por escolha.
- Listagem global de contatos com busca (depende de GSI novo — pendência de
  infra já registrada em PENDENCIAS.md).
