import type { ExecucaoBoletim } from './execucao-boletim.js';
import type { NoticiaColetada } from './fonte-boletim.js';

/**
 * O acervo: as notícias das edições anteriores, guardadas na própria execução.
 *
 * Serve à edição de retrospectiva quando nem as fontes nem a IA rendem nada —
 * sites fora do ar, IA sobrecarregada, ou simplesmente uma semana em que nada
 * novo saiu e a IA tampouco encontrou "mais lidas" na página. O boletim sai de
 * qualquer modo (decisão do escritório), e o que ele leva nesse caso é o que
 * já foi publicado: relembrar a leitura mais relevante é melhor do que não
 * mandar nada, desde que o leitor seja avisado — e é (ver
 * `criarLinhaAvisoRetrospectiva`).
 *
 * Só entram edições de NOVIDADES: reciclar uma retrospectiva empilharia
 * repetição sobre repetição.
 */
export function selecionarDoAcervo(
  execucoes: readonly ExecucaoBoletim[],
  opcoes: {
    readonly maximo: number;
    /** Temas da rotina: o que casa com eles vem primeiro; a recência desempata. */
    readonly temas?: readonly string[];
  },
): NoticiaColetada[] {
  const edicoes = execucoes
    .filter(
      (e) =>
        e.situacao === 'CONCLUIDA' &&
        e.edicao !== 'RETROSPECTIVA' &&
        e.noticias !== undefined &&
        e.noticias.length > 0,
    )
    .sort((a, b) => b.iniciadaEm.getTime() - a.iniciadaEm.getTime());

  // A mesma matéria aparece em edições seguidas quando a fonte a mantém em
  // destaque; a chave junta URL e título porque, sem link próprio, a notícia
  // carrega a URL da fonte — e duas matérias distintas dividiriam a chave.
  const vistas = new Set<string>();
  const candidatas: NoticiaColetada[] = [];
  for (const edicao of edicoes) {
    for (const noticia of edicao.noticias ?? []) {
      const chave = `${noticia.url.toLowerCase()}|${noticia.titulo.trim().toLowerCase()}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      candidatas.push(noticia);
    }
  }

  const temas = (opcoes.temas ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t !== '');
  const casaComTema = (n: NoticiaColetada): number =>
    temas.some((t) => `${n.tag} ${n.titulo} ${n.resumo}`.toLowerCase().includes(t)) ? 1 : 0;

  return candidatas
    .map((noticia, ordem) => ({ noticia, ordem, tema: casaComTema(noticia) }))
    .sort((a, b) => b.tema - a.tema || a.ordem - b.ordem)
    .slice(0, Math.max(0, opcoes.maximo))
    .map((x) => x.noticia);
}
