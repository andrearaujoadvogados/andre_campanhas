import {
  analisarNoticias,
  montarPromptDeExtracao,
  validarUrlDeFonte,
  type FonteBoletim,
  type NoticiaColetada,
} from '../../domain/boletim/fonte-boletim.js';
import type { TenantId } from '../../domain/shared/ids.js';
import type { BuscadorDePagina, ExtratorPorIa, FonteBoletimRepository } from '../ports/index.js';

/**
 * Progresso da coleta, emitido antes de cada fonte.
 *
 * Existe para a execução ser observável enquanto acontece: a leitura das
 * fontes é a etapa longa (página + IA, em sequência), e sem este sinal a tela
 * só saberia do resultado no fim — que é justamente quando o feedback deixa de
 * ter valor. É opcional porque a coleta não depende de quem escuta.
 */
export interface ProgressoColeta {
  readonly totalFontes: number;
  /** Quantas já foram processadas (com sucesso ou aviso) antes desta. */
  readonly fontesConcluidas: number;
  readonly fonteAtual: string;
  readonly noticiasAteAgora: number;
}

export interface DepsColeta {
  readonly fontes: FonteBoletimRepository;
  readonly paginas: BuscadorDePagina;
  readonly extrator: ExtratorPorIa;
  readonly aoProgredir?: (progresso: ProgressoColeta) => Promise<void>;
}

export interface NoticiasDaFonte {
  readonly fonte: FonteBoletim;
  readonly noticias: readonly NoticiaColetada[];
}

export interface ResultadoColeta {
  readonly porFonte: readonly NoticiasDaFonte[];
  /** Um aviso por fonte que falhou — a coleta das demais não para por causa de uma. */
  readonly avisos: readonly string[];
  readonly totalNoticias: number;
}

/**
 * Coleta as notícias de todas as fontes ativas — §11, item 12.
 *
 * **Falha por fonte, nunca do lote**: um site fora do ar não pode derrubar o
 * boletim inteiro. A fonte que falhar vira um aviso nomeado, e o chamador
 * decide se um boletim parcial vale a pena (vale: o operador revisa antes de
 * enviar de qualquer forma).
 *
 * As fontes são consultadas em sequência, não em paralelo — de propósito. O
 * extrator gratuito tem limite de requisições por minuto, e um boletim tem
 * meia dúzia de fontes: paralelizar economizaria segundos por semana ao custo
 * de esbarrar no limite exatamente quando a lista crescer.
 */
export async function coletarNoticias(
  deps: DepsColeta,
  tenantId: TenantId,
): Promise<ResultadoColeta> {
  const todas = await deps.fontes.listar(tenantId);
  const ativas = todas.filter((f) => f.ativa);

  const porFonte: NoticiasDaFonte[] = [];
  const avisos: string[] = [];

  for (const [indice, fonte] of ativas.entries()) {
    // O relato de progresso não pode derrubar a coleta: se gravar o estado
    // falhar, o boletim ainda vale mais do que o indicador de progresso.
    try {
      await deps.aoProgredir?.({
        totalFontes: ativas.length,
        fontesConcluidas: indice,
        fonteAtual: fonte.nome,
        noticiasAteAgora: porFonte.reduce((soma, f) => soma + f.noticias.length, 0),
      });
    } catch {
      /* estado é acessório; a coleta é o trabalho */
    }

    // Revalida na leitura, não só no cadastro: uma fonte gravada antes de a
    // regra existir (ou por outra versão do código) não ganha passe livre.
    const url = validarUrlDeFonte(fonte.url);
    if (!url.ok) {
      avisos.push(`${fonte.nome}: URL recusada — ${url.motivo}`);
      continue;
    }

    let pagina: string;
    try {
      pagina = await deps.paginas.buscarTexto(fonte.url);
    } catch (erro) {
      avisos.push(`${fonte.nome}: não foi possível ler a página (${mensagem(erro)}).`);
      continue;
    }

    if (pagina.trim() === '') {
      avisos.push(`${fonte.nome}: a página veio vazia.`);
      continue;
    }

    let resposta: string;
    try {
      resposta = await deps.extrator.completar(
        montarPromptDeExtracao({
          nome: fonte.nome,
          url: fonte.url,
          instrucao: fonte.instrucao,
          textoDaPagina: pagina,
        }),
      );
    } catch (erro) {
      avisos.push(`${fonte.nome}: o extrator falhou (${mensagem(erro)}).`);
      continue;
    }

    const noticias = analisarNoticias(resposta, fonte.url);
    if (noticias === null) {
      avisos.push(`${fonte.nome}: a resposta do extrator não veio no formato esperado.`);
      continue;
    }

    if (noticias.length > 0) porFonte.push({ fonte, noticias });
    else avisos.push(`${fonte.nome}: nada encontrado que atenda à instrução.`);
  }

  return {
    porFonte,
    avisos,
    totalNoticias: porFonte.reduce((soma, f) => soma + f.noticias.length, 0),
  };
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
