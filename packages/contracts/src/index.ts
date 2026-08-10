import { z } from 'zod';

/**
 * Contratos de dados entre frontend e backend — §4.1, §4.2.
 *
 * Schema único que serve como validação em runtime e como tipo em build. A razão
 * de existir como pacote próprio, em vez de viver no core, é que o domínio não
 * deve conhecer a forma dos dados que trafegam na borda: o core recebe tipos de
 * domínio já validados. Aqui é onde a entrada não confiável vira algo utilizável.
 *
 * Regra de uso: **toda** borda valida — API, fila e importador. Payload de fila
 * não é mais confiável que payload de HTTP; ele só foi validado por *outra*
 * versão do nosso código, que pode estar em deploy diferente.
 */

// ── Enums compartilhados ─────────────────────────────────────────────────────

export const contactStatusSchema = z.enum([
  'ATIVO',
  'DESCADASTRADO',
  'OPOSICAO',
  'BOUNCE',
  'RECLAMACAO',
  'SUPRIMIDO',
]);

export const relacionamentoSchema = z.enum([
  'CLIENTE_ATIVO',
  'EX_CLIENTE',
  'PROSPECT_CONTATO',
  'EVENTO',
  'INDICACAO',
  'DESCONHECIDO',
]);

export const baseLegalSchema = z.enum(['LEGITIMO_INTERESSE', 'CONSENTIMENTO', 'EXECUCAO_CONTRATO']);

export const campaignStatusSchema = z.enum([
  'RASCUNHO',
  'AGENDADA',
  'ENVIANDO',
  'PAUSADA',
  'CONCLUIDA',
  'CANCELADA',
  'FALHA',
]);

export const papelUsuarioSchema = z.enum(['ADMIN', 'OPERADOR']);

// ── Contato ──────────────────────────────────────────────────────────────────

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/, 'Formato de e-mail inválido');

export const criarContatoSchema = z.object({
  email: emailSchema,
  nome: z.string().trim().min(1).max(200).optional(),
  telefone: z.string().trim().max(40).optional(),
  empresa: z.string().trim().max(200).optional(),
  /**
   * Tags livres para segmentar (lógica OU no filtro da campanha). A UI manda como
   * texto separado por vírgula e converte para lista antes de enviar.
   */
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  /**
   * Lead — não recebe campanha por padrão (§5). Ausente = contato normal.
   * Mantido opcional para não quebrar chamadas existentes.
   */
  isLead: z.boolean().default(false),
  // Obrigatório: sob legítimo interesse, o vínculo é a prova da base legal (§6.2).
  relacionamento: relacionamentoSchema,
  relacionamentoDesde: z.coerce.date().optional(),
  camposCustomizados: z.record(z.string(), z.string().max(500)).default({}),
});
export type CriarContatoInput = z.infer<typeof criarContatoSchema>;

export const atualizarContatoSchema = criarContatoSchema.partial();
export type AtualizarContatoInput = z.infer<typeof atualizarContatoSchema>;

// ── Importação de CSV ────────────────────────────────────────────────────────

/**
 * A declaração de origem é obrigatória — §10.2.
 *
 * Não é campo de formulário por burocracia: é a evidência que sustenta o
 * legítimo interesse daquele lote inteiro. Sem ela, um CSV anônimo entra na base
 * e ninguém consegue dizer depois de onde vieram aqueles contatos.
 */
export const iniciarImportacaoSchema = z.object({
  nomeArquivo: z.string().min(1).max(255),
  origemDeclarada: z
    .string()
    .trim()
    .min(10, 'Descreva a origem dos contatos — é a prova da base legal.')
    .max(500),
  relacionamentoPadrao: relacionamentoSchema,
  confirmaSemListaComprada: z.literal(true, {
    errorMap: () => ({ message: 'É preciso confirmar que a lista não foi comprada de terceiros.' }),
  }),
  mapeamentoColunas: z.object({
    email: z.string().min(1),
    nome: z.string().optional(),
    relacionamento: z.string().optional(),
    relacionamentoDesde: z.string().optional(),
  }),
});
export type IniciarImportacaoInput = z.infer<typeof iniciarImportacaoSchema>;

/**
 * Pedido da URL de upload — o primeiro dos dois passos da importação.
 *
 * O arquivo vai do navegador direto para o S3, não pela API: o API Gateway tem
 * teto de 10 MB por requisição, e um CSV de 200.000 contatos passaria muito
 * disso. A API só assina a URL e, depois, é avisada de que o arquivo chegou.
 */
export const solicitarUploadImportacaoSchema = z.object({
  nomeArquivo: z.string().trim().min(1).max(255),
  /**
   * SHA-256 do arquivo, em base64 — 32 bytes, que em base64 dão 44 caracteres.
   *
   * Calculado no navegador antes de pedir a URL. Vai para dentro da assinatura,
   * de modo que a URL sirva para aquele arquivo e nenhum outro.
   */
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'Checksum SHA-256 em base64 inválido.'),
});
export type SolicitarUploadImportacaoInput = z.infer<typeof solicitarUploadImportacaoSchema>;

/**
 * Segundo passo: o arquivo já está no S3 e a importação pode começar.
 *
 * O `importacaoId` é o que amarra os dois passos. Ele vem da resposta do
 * primeiro e **não** carrega a chave do S3 — a chave é derivada dele no
 * servidor. Aceitar uma chave escolhida por quem chama deixaria qualquer
 * operador apontar o importador para outro objeto do mesmo bucket, inclusive os
 * dossiês de `exports/`, que são dado pessoal reunido num arquivo só.
 */
export const confirmarImportacaoSchema = iniciarImportacaoSchema.extend({
  importacaoId: z.string().uuid(),
});
export type ConfirmarImportacaoInput = z.infer<typeof confirmarImportacaoSchema>;

/**
 * O que trafega na fila entre a API e o `csv-importer`.
 *
 * Mora aqui, e não em cada ponta, pela mesma razão que os schemas de requisição:
 * duas definições da mesma mensagem divergem em silêncio, e o sintoma seria uma
 * importação que some na fila sem erro visível.
 */
export const mensagemImportacaoSchema = iniciarImportacaoSchema.extend({
  importacaoId: z.string().min(1),
  chaveS3: z.string().min(1),
  solicitadoPor: z.string().min(1),
});
export type MensagemImportacao = z.infer<typeof mensagemImportacaoSchema>;

export const resultadoImportacaoSchema = z.object({
  importacaoId: z.string(),
  totalLinhas: z.number().int().nonnegative(),
  importados: z.number().int().nonnegative(),
  duplicados: z.number().int().nonnegative(),
  invalidos: z.number().int().nonnegative(),
  suprimidosIgnorados: z.number().int().nonnegative(),
  erros: z.array(z.object({ linha: z.number().int(), motivo: z.string() })).max(1000),
});
export type ResultadoImportacao = z.infer<typeof resultadoImportacaoSchema>;

// ── Template ─────────────────────────────────────────────────────────────────

export const tipoTemplateSchema = z.enum(['VISUAL', 'CODIGO']);

export const salvarTemplateSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  assunto: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(200).optional(),
  corpoHtml: z.string().min(1).max(500_000),
  /** Como foi montado. Padrão CODIGO para compatibilidade com chamadas antigas. */
  tipo: tipoTemplateSchema.default('CODIGO'),
  categoria: z.string().trim().max(60).optional(),
  /** JSON dos blocos do editor visual (quando tipo = VISUAL). */
  estruturaVisual: z.string().max(2_000_000).optional(),
  /** Miniatura (data URL ou URL) para o card. */
  thumbnail: z.string().max(500_000).optional(),
});
export type SalvarTemplateInput = z.infer<typeof salvarTemplateSchema>;

// ── Campanha ─────────────────────────────────────────────────────────────────

export const criarCampanhaSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  templateId: z.string().min(1),
  listId: z.string().min(1),
  remetenteNome: z.string().trim().min(1).max(100),
  remetenteEmail: emailSchema,
  replyTo: emailSchema.optional(),
  /** Assunto próprio do boletim; ausente = usa o do modelo. */
  assunto: z.string().trim().max(200).optional(),
  /** Filtro por tag (lógica OU). Vazio = não filtra. */
  tagsFiltro: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  /** Leads só entram quando marcado (padrão falso). */
  incluirLeads: z.boolean().default(false),
  /**
   * Se presente, restringe o disparo a estes contatos (seleção individual).
   *
   * `.min(1)` de propósito: lista vazia é recusada em vez de aceita. Omitir o
   * campo significa "todos os elegíveis" — se vazio também fosse aceito, os dois
   * estados ficariam indistinguíveis no banco, e "não quero enviar para ninguém"
   * viraria "envie para a lista inteira".
   */
  destinatariosSelecionados: z
    .array(z.string().min(1))
    .min(1, 'Selecione ao menos um destinatário, ou remova o filtro para enviar a todos.')
    .max(100_000)
    .optional(),
});
export type CriarCampanhaInput = z.infer<typeof criarCampanhaSchema>;

/** Prévia de audiência — conta e lista os elegíveis para a Etapa 3 do wizard. */
export const previaAudienciaSchema = z.object({
  listId: z.string().min(1),
  tagsFiltro: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  incluirLeads: z.boolean().default(false),
});
export type PreviaAudienciaInput = z.infer<typeof previaAudienciaSchema>;

/**
 * Edição de campanha.
 *
 * Todos os campos opcionais: a tela manda só o que mudou. Editável só enquanto
 * a campanha não começou a sair (RASCUNHO ou AGENDADA); depois do disparo, o que
 * saiu é fato registrado e não muda.
 */
export const editarCampanhaSchema = criarCampanhaSchema.partial();
export type EditarCampanhaInput = z.infer<typeof editarCampanhaSchema>;

/**
 * Envio de teste — até 3 endereços.
 *
 * Teto baixo de propósito: teste é o operador conferir o resultado antes de
 * disparar, não um segundo canal de envio. Três cobre "eu, o André e a
 * secretária" sem virar uma campanha paralela sem audiência nem descadastro.
 */
export const enviarTesteSchema = z.object({
  destinatarios: z
    .array(emailSchema)
    .min(1, 'Informe ao menos um e-mail.')
    .max(3, 'No máximo 3 endereços de teste.'),
});
export type EnviarTesteInput = z.infer<typeof enviarTesteSchema>;

export const agendarCampanhaSchema = z.object({
  agendadaPara: z.coerce.date(),
});
export type AgendarCampanhaInput = z.infer<typeof agendarCampanhaSchema>;

// ── Descadastro (endpoint público) ───────────────────────────────────────────

export const descadastroSchema = z.object({
  token: z.string().min(1).max(2048),
  tipo: z.enum(['DESCADASTRO', 'OPOSICAO']).default('DESCADASTRO'),
});
export type DescadastroInput = z.infer<typeof descadastroSchema>;

// ── Mensagem interna da fila de envio ────────────────────────────────────────

export const mensagemEnvioSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
  contactId: z.string().min(1),
  /** Determinístico: sha256(campaignId + contactId). Guarda de idempotência (§5.4). */
  sendId: z.string().min(1),
  tentativa: z.number().int().nonnegative().default(0),
});
export type MensagemEnvio = z.infer<typeof mensagemEnvioSchema>;

// ── Relatórios ───────────────────────────────────────────────────────────────

export const metricasCampanhaSchema = z.object({
  campaignId: z.string(),
  enviados: z.number().int().nonnegative(),
  entregues: z.number().int().nonnegative(),
  aberturasUnicas: z.number().int().nonnegative(),
  aberturasTotais: z.number().int().nonnegative(),
  cliquesUnicos: z.number().int().nonnegative(),
  cliquesTotais: z.number().int().nonnegative(),
  bouncesHard: z.number().int().nonnegative(),
  bouncesSoft: z.number().int().nonnegative(),
  reclamacoes: z.number().int().nonnegative(),
  descadastros: z.number().int().nonnegative(),
});
export type MetricasCampanha = z.infer<typeof metricasCampanhaSchema>;

// ── Erro padronizado da API ──────────────────────────────────────────────────

export const erroApiSchema = z.object({
  code: z.string(),
  message: z.string(),
  detalhes: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().optional(),
});
export type ErroApi = z.infer<typeof erroApiSchema>;

// ── Usuários do painel ───────────────────────────────────────────────────────

/**
 * Criar conta de acesso ao painel.
 *
 * Só e-mail e papel. **Não existe campo de senha, e é de propósito**: o Cognito
 * gera a provisória e a envia direto para a pessoa. Um campo aqui colocaria uma
 * senha no corpo de uma requisição HTTP, no log de erro e na tela de quem cria.
 */
export const criarUsuarioSchema = z.object({
  email: emailSchema,
  papel: papelUsuarioSchema,
});
export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>;

export const definirPapelSchema = z.object({ papel: papelUsuarioSchema });
export type DefinirPapelInput = z.infer<typeof definirPapelSchema>;
