import type { ExecucaoBoletim } from './execucao-boletim.js';
import { noticiaDeAlgumTema, type NoticiaColetada } from './fonte-boletim.js';

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
    /** Temas da rotina: presentes, só entram notícias deles, da mais recente para a mais antiga. */
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

  // Com temas, só entra o que é deles — o boletim da rotina não traz nada
  // além dos temas escolhidos, nem para completar a retrospectiva.
  const temas = (opcoes.temas ?? []).filter((t) => t.trim() !== '');
  return candidatas
    .filter((n) => temas.length === 0 || noticiaDeAlgumTema(n, temas))
    .slice(0, Math.max(0, opcoes.maximo));
}

/**
 * Completa uma edição curta com mais notícias, sem repetir e sem passar do
 * teto. A mesma matéria pode chegar pela coleta e pela retrospectiva (ou
 * pelo acervo); a chave junta URL e título pelo mesmo motivo de
 * `selecionarDoAcervo`.
 */
export function completarSemRepetir(
  base: readonly NoticiaColetada[],
  extras: readonly NoticiaColetada[],
  maximo: number,
): NoticiaColetada[] {
  const chave = (n: NoticiaColetada) => `${n.url.toLowerCase()}|${n.titulo.trim().toLowerCase()}`;
  const vistas = new Set(base.map(chave));
  const resultado = [...base];
  for (const extra of extras) {
    if (resultado.length >= maximo) break;
    const k = chave(extra);
    if (vistas.has(k)) continue;
    vistas.add(k);
    resultado.push(extra);
  }
  return resultado;
}
