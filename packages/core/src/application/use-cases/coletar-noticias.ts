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
  /**
   * Instante (ms desde a época) a partir do qual nenhuma fonte nova é lida.
   *
   * O worker roda com teto de tempo; sem o prazo, uma IA lenta nas primeiras
   * fontes estourava esse teto em silêncio. Fonte pulada por falta de tempo é
   * falha técnica com aviso nomeado — não "sem notícia".
   */
  readonly prazoMs?: number;
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
  /**
   * Quantas fontes falharam por problema TÉCNICO — página fora do ar, extrator
   * indisponível, resposta ilegível.
   *
   * Existe para separar duas coisas que o total zerado confunde: "as fontes não
   * tinham nada esta semana" e "a coleta não conseguiu ler nada". A primeira
   * pede revisar as instruções das fontes; a segunda pede tentar de novo — e
   * mandar o operador revisar instrução por instrução quando a IA é que estava
   * fora do ar é o pior tipo de diagnóstico, o que parece certo e não é.
   */
  readonly fontesComFalha: number;
  /** Quantas fontes foram lidas até o fim e não trouxeram nada que atendesse à instrução. */
  readonly fontesSemNoticia: number;
}

/**
 * Recorte de uma rotina sobre o catálogo — fontes escolhidas e temas.
 *
 * `fonteIds` vazio ou ausente significa "todas as ativas": é o comportamento
 * que o boletim sempre teve, e a rotina que não escolher fontes o herda.
 */
export interface EscolhaColeta {
  readonly fonteIds?: readonly string[];
  readonly temas?: readonly string[];
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
  escolha: EscolhaColeta = {},
): Promise<ResultadoColeta> {
  const todas = await deps.fontes.listar(tenantId);
  const escolhidas =
    escolha.fonteIds === undefined || escolha.fonteIds.length === 0
      ? todas
      : todas.filter((f) => escolha.fonteIds?.includes(String(f.fonteId)));
  const ativas = escolhidas.filter((f) => f.ativa);

  const porFonte: NoticiasDaFonte[] = [];
  const avisos: string[] = [];
  let fontesComFalha = 0;
  let fontesSemNoticia = 0;

  for (const [indice, fonte] of ativas.entries()) {
    if (deps.prazoMs !== undefined && Date.now() >= deps.prazoMs) {
      avisos.push(
        `${fonte.nome}: não foi lida — a coleta ficou sem tempo (as fontes anteriores consumiram o prazo).`,
      );
      fontesComFalha += 1;
      continue;
    }

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
      fontesComFalha += 1;
      continue;
    }

    let pagina: string;
    try {
      pagina = await deps.paginas.buscarTexto(fonte.url);
    } catch (erro) {
      avisos.push(`${fonte.nome}: não foi possível ler a página (${mensagem(erro)}).`);
      fontesComFalha += 1;
      continue;
    }

    if (pagina.trim() === '') {
      avisos.push(`${fonte.nome}: a página veio vazia.`);
      fontesComFalha += 1;
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
          ...(escolha.temas === undefined || escolha.temas.length === 0
            ? {}
            : { temas: escolha.temas }),
        }),
      );
    } catch (erro) {
      avisos.push(`${fonte.nome}: o extrator falhou (${mensagem(erro)}).`);
      fontesComFalha += 1;
      continue;
    }

    const noticias = analisarNoticias(resposta, fonte.url);
    if (noticias === null) {
      avisos.push(`${fonte.nome}: a resposta do extrator não veio no formato esperado.`);
      fontesComFalha += 1;
      continue;
    }

    if (noticias.length > 0) {
      porFonte.push({ fonte, noticias });
    } else {
      fontesSemNoticia += 1;
      avisos.push(`${fonte.nome}: nada encontrado que atenda à instrução.`);
    }
  }

  return {
    porFonte,
    avisos,
    totalNoticias: porFonte.reduce((soma, f) => soma + f.noticias.length, 0),
    fontesComFalha,
    fontesSemNoticia,
  };
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
