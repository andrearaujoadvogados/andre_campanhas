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
  'EM_REVISAO',
  'APROVADA',
  'AGENDADA',
  'ENVIANDO',
  'PAUSADA',
  'CONCLUIDA',
  'CANCELADA',
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

export const salvarTemplateSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  assunto: z.string().trim().min(1).max(200),
  preheader: z.string().trim().max(200).optional(),
  corpoHtml: z.string().min(1).max(500_000),
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
});
export type CriarCampanhaInput = z.infer<typeof criarCampanhaSchema>;

export const agendarCampanhaSchema = z.object({
  agendadaPara: z.coerce.date(),
});
export type AgendarCampanhaInput = z.infer<typeof agendarCampanhaSchema>;

export const aprovarCampanhaSchema = z.object({
  /** Hash do que o revisor viu. Se divergir do atual, a aprovação é recusada (§5.8). */
  hashConteudoRevisado: z.string().min(1),
  observacao: z.string().max(1000).optional(),
});
export type AprovarCampanhaInput = z.infer<typeof aprovarCampanhaSchema>;

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
