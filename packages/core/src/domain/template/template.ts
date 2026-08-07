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
export interface VersaoTemplate {
  readonly versao: number;
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly preheader?: string;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
}

export interface Template {
  readonly tenantId: TenantId;
  readonly templateId: TemplateId;
  readonly nome: string;
  readonly versaoAtual: number;
  readonly arquivado: boolean;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
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
