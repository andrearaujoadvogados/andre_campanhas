import type { TemplateId, TenantId, UserId } from '../shared/ids.js';

/**
 * Template de e-mail — §11, item 2.
 *
 * **Versões são imutáveis.** Editar não altera a versão existente: cria a
 * próxima. A razão está em §6.2, nota 3 — a campanha congela `templateVersao` no
 * disparo, e se a versão pudesse mudar depois, o histórico diria que foi enviado
 * um conteúdo que nunca existiu naquela forma. Num escritório de advocacia, onde
 * a comunicação passa por aprovação de um responsável (§10.3), isso não é
 * detalhe de modelagem: é a diferença entre ter e não ter prova do que saiu.
 */
/**
 * Como o conteúdo foi montado — §6 do briefing.
 *
 * `VISUAL`: montado no editor arrastar-e-soltar; a estrutura de blocos fica em
 * `estruturaVisual` (JSON) e o `corpoHtml` é o resultado compilado.
 * `CODIGO`: HTML/MJML escrito à mão; só há `corpoHtml`.
 */
export type TipoTemplate = 'VISUAL' | 'CODIGO';

export interface VersaoTemplate {
  readonly versao: number;
  readonly assunto: string;
  /** HTML final (compilado, quando VISUAL). É o que a campanha envia. */
  readonly corpoHtml: string;
  /** JSON dos blocos do editor, presente quando o template é VISUAL. */
  readonly estruturaVisual?: string;
  readonly preheader?: string;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
}

export interface Template {
  readonly tenantId: TenantId;
  readonly templateId: TemplateId;
  readonly nome: string;
  /** Ausente em templates antigos — tratados como `CODIGO` (eram HTML puro). */
  readonly tipo?: TipoTemplate;
  /** Categoria/etiqueta livre, ex.: "Novidade", "Comunicado". */
  readonly categoria?: string;
  /** Miniatura para o card (data URL ou URL). Opcional. */
  readonly thumbnail?: string;
  readonly versaoAtual: number;
  readonly arquivado: boolean;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
}

/** Tipo efetivo: template sem `tipo` (legado) é tratado como HTML/código. */
export function tipoEfetivo(template: Pick<Template, 'tipo'>): TipoTemplate {
  return template.tipo ?? 'CODIGO';
}

/**
 * Contexto de exemplo para a prévia.
 *
 * Valores explicitamente fictícios e reconhecíveis como tais. Usar um contato
 * real da base para pré-visualizar seria expor dado pessoal numa tela que
 * qualquer operador abre — e, pior, normalizaria a prática.
 */
export const CONTATO_EXEMPLO = {
  nome: 'Maria Silva Souza',
  email: 'exemplo@destinatario.com.br',
  camposCustomizados: { processo: '0000000-00.0000.0.00.0000' },
} as const;

/**
 * Variáveis que o sistema garante. Serve para a interface listar o que o
 * operador pode usar sem precisar adivinhar.
 */
export const VARIAVEIS_DISPONIVEIS = [
  { chave: 'contato.nome', descricao: 'Nome completo do contato' },
  { chave: 'contato.primeiroNome', descricao: 'Primeiro nome, para saudação' },
  { chave: 'contato.email', descricao: 'E-mail do contato' },
  { chave: 'url_descadastro', descricao: 'Link de descadastro (incluído automaticamente)' },
] as const;

export function proximaVersao(atual: number): number {
  return atual + 1;
}

/**
 * Arquivar em vez de excluir.
 *
 * Um template pode ter sido usado por campanhas já enviadas. Apagá-lo quebraria
 * a trilha do que foi disparado — e é justamente essa trilha que sustenta a
 * exigência de aprovação da OAB (§10.3). Arquivar tira da lista de escolha sem
 * destruir a prova.
 */
export function arquivar(template: Template, agora: Date): Template {
  return { ...template, arquivado: true, atualizadoEm: agora };
}

export function desarquivar(template: Template, agora: Date): Template {
  return { ...template, arquivado: false, atualizadoEm: agora };
}
