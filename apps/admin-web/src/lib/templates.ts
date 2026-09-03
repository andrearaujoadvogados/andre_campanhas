import { api } from './api.js';

/**
 * Listagem de modelos — a lista INTEIRA, não a primeira página.
 *
 * A API pagina por cursor (50 por página). Quem lia só a primeira página —
 * a escolha de modelo da campanha, o assistente, a própria tela de modelos —
 * parava de ver modelos novos assim que passavam de 50: cada boletim que a
 * rotina gera é um modelo a mais, e o recém-criado era justamente o que
 * faltava na lista. São dezenas de itens, uma ou duas requisições; seguir o
 * cursor aqui, num lugar só, é mais barato que cada tela lembrar de fazê-lo.
 */
export interface ResumoTemplate {
  templateId: string;
  nome: string;
  tipo?: 'VISUAL' | 'CODIGO';
  categoria?: string | null;
  thumbnail?: string | null;
  versaoAtual: number;
  arquivado: boolean;
  criadoPor?: string;
  criadoEm?: string;
  atualizadoEm: string;
}

export interface VariavelTemplate {
  chave: string;
  descricao: string;
}

export interface ListagemTemplates {
  itens: ResumoTemplate[];
  criadores: Record<string, string>;
  variaveisDisponiveis: VariavelTemplate[];
}

interface PaginaTemplates {
  itens?: ResumoTemplate[];
  cursor?: string;
  criadores?: Record<string, string>;
  variaveisDisponiveis?: VariavelTemplate[];
}

/** Teto de páginas: uma API que devolvesse sempre cursor não pode virar laço infinito. */
const MAXIMO_PAGINAS = 20;

export async function listarTemplates(): Promise<ListagemTemplates> {
  const itens: ResumoTemplate[] = [];
  let criadores: Record<string, string> = {};
  let variaveisDisponiveis: VariavelTemplate[] = [];
  let cursor: string | undefined;

  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina += 1) {
    const r = await api.get<PaginaTemplates>(
      cursor === undefined ? '/templates' : `/templates?cursor=${encodeURIComponent(cursor)}`,
    );
    itens.push(...(r.itens ?? []));
    criadores = { ...criadores, ...(r.criadores ?? {}) };
    if (r.variaveisDisponiveis !== undefined) variaveisDisponiveis = r.variaveisDisponiveis;
    cursor = r.cursor;
    if (cursor === undefined || cursor === '') break;
  }

  return { itens, criadores, variaveisDisponiveis };
}

/**
 * Opções para escolher um modelo numa campanha.
 *
 * Arquivado fica de fora — arquivar é justamente tirar da escolha —, exceto o
 * que a campanha JÁ usa: editar uma campanha antiga precisa mostrar o modelo
 * dela, mesmo que tenha sido arquivado depois.
 */
export function modelosEscolhiveis<T extends ResumoTemplate>(
  itens: readonly T[],
  selecionadoId: string,
): T[] {
  return itens.filter((t) => !t.arquivado || t.templateId === selecionadoId);
}
