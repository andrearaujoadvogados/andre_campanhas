import {
  analisarEdicao,
  edicaoPadrao,
  montarPromptDeEdicao,
  type BuscadorDePagina,
  type EdicaoEditorial,
  type ExtratorPorIa,
  type NoticiaColetada,
} from '@emailmkt/core';

/**
 * A passada editorial, orquestrada: de notícias soltas para a edição.
 *
 * Duas chamadas à IA, e nenhuma é obrigatória:
 *
 * 1. **Editar.** Com as notícias numeradas, a IA escolhe o destaque, ordena o
 *    resto, escreve título, abertura, chapéus e o radar.
 * 2. **Aprofundar o destaque.** A matéria escolhida é lida por inteiro (a
 *    coleta só viu a chamada dela na página da fonte) e a IA reescreve os
 *    parágrafos do card e a leitura prática com o texto real na mão. É o que
 *    separa um "destaque" de um resumo em negrito.
 *
 * Qualquer falha — IA fora do ar, resposta ilegível, matéria inacessível,
 * prazo esgotado — degrada um degrau, nunca derruba a edição: a segunda
 * chamada falhando fica a primeira; a primeira falhando fica a edição padrão
 * (`edicaoPadrao`), no mesmo layout. O boletim sai de qualquer modo, e o
 * aviso diz ao operador o que faltou.
 */
export interface EntradaDoEditor {
  readonly nomeDoBoletim: string;
  readonly periodo: string;
  readonly noticias: readonly NoticiaColetada[];
  readonly temas?: readonly string[];
  readonly retrospectiva: boolean;
  /** URLs das páginas das fontes: uma notícia com esse link não tem matéria própria para ler. */
  readonly urlsDasFontes: readonly string[];
  readonly extrator: ExtratorPorIa;
  readonly paginas: BuscadorDePagina;
  /** Instante (ms) a partir do qual nenhuma chamada nova começa. */
  readonly prazoMs: number;
  readonly agora?: () => number;
  readonly log?: (mensagem: string, dados?: Record<string, unknown>) => void;
}

export interface ResultadoDoEditor {
  readonly edicao: EdicaoEditorial | null;
  /** Se a edição saiu da IA (com ou sem a matéria lida) ou do padrão. */
  readonly origem: 'IA_COM_MATERIA' | 'IA' | 'PADRAO';
  readonly avisos: readonly string[];
}

/** Teto do texto da matéria enviado à IA — o que interessa está no começo. */
const LIMITE_TEXTO_MATERIA = 12_000;

export async function editarEdicao(entrada: EntradaDoEditor): Promise<ResultadoDoEditor> {
  const agora = entrada.agora ?? Date.now;
  const log = entrada.log ?? (() => undefined);
  const avisos: string[] = [];
  const padrao = edicaoPadrao(entrada.noticias);

  if (padrao === null) return { edicao: null, origem: 'PADRAO', avisos };

  if (agora() >= entrada.prazoMs) {
    avisos.push(
      'A edição saiu no formato padrão: não sobrou tempo para a passada editorial da IA.',
    );
    return { edicao: padrao, origem: 'PADRAO', avisos };
  }

  const base = {
    nomeDoBoletim: entrada.nomeDoBoletim,
    periodo: entrada.periodo,
    noticias: entrada.noticias,
    retrospectiva: entrada.retrospectiva,
    ...(entrada.temas === undefined || entrada.temas.length === 0 ? {} : { temas: entrada.temas }),
  };

  let edicao: EdicaoEditorial;
  try {
    const resposta = await entrada.extrator.completar(montarPromptDeEdicao(base));
    const analisada = analisarEdicao(resposta, entrada.noticias);
    if (analisada === null) {
      avisos.push(
        'A edição saiu no formato padrão: a resposta editorial da IA não veio no formato esperado.',
      );
      return { edicao: padrao, origem: 'PADRAO', avisos };
    }
    edicao = analisada;
  } catch (erro) {
    avisos.push(`A edição saiu no formato padrão: a passada editorial falhou (${mensagem(erro)}).`);
    return { edicao: padrao, origem: 'PADRAO', avisos };
  }

  // Segunda chamada: só se há matéria própria para ler e tempo para lê-la.
  const url = edicao.destaque.noticia.url;
  const temMateria = !entrada.urlsDasFontes.some((u) => mesmaPagina(u, url));
  if (!temMateria || agora() >= entrada.prazoMs) {
    return { edicao, origem: 'IA', avisos };
  }

  let texto: string;
  try {
    texto = (await entrada.paginas.buscarTexto(url)).slice(0, LIMITE_TEXTO_MATERIA);
  } catch (erro) {
    log('matéria do destaque não pôde ser lida; o card usa o resumo', {
      url,
      motivo: mensagem(erro),
    });
    return { edicao, origem: 'IA', avisos };
  }
  if (texto.trim() === '') return { edicao, origem: 'IA', avisos };

  const indice = entrada.noticias.indexOf(edicao.destaque.noticia);
  try {
    const resposta = await entrada.extrator.completar(
      montarPromptDeEdicao({ ...base, materiaDoDestaque: { indice, texto } }),
    );
    const aprofundada = analisarEdicao(resposta, entrada.noticias);
    // A matéria lida é a do destaque da primeira passada; se a IA mudou de
    // destaque na segunda, os parágrafos novos falariam de outra notícia.
    if (aprofundada === null || aprofundada.destaque.noticia !== edicao.destaque.noticia) {
      return { edicao, origem: 'IA', avisos };
    }
    return { edicao: aprofundada, origem: 'IA_COM_MATERIA', avisos };
  } catch (erro) {
    log('aprofundamento do destaque falhou; fica a primeira passada', { motivo: mensagem(erro) });
    return { edicao, origem: 'IA', avisos };
  }
}

/** Mesma página, ignorando barra final e fragmento — a coleta grava a URL como a fonte foi cadastrada. */
function mesmaPagina(a: string, b: string): boolean {
  const normalizar = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  return normalizar(a) === normalizar(b);
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
