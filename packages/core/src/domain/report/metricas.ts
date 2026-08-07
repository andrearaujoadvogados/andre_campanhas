/**
 * Cálculo de taxas de campanha — §11, item 8.
 *
 * Puro e sem dependência: é a parte dos relatórios que precisa estar certa, e a
 * única forma de garantir isso é poder testá-la sem banco.
 *
 * **Os denominadores não são arbitrários.** Cada taxa usa a base que a indústria
 * de e-mail e a própria AWS usam para julgar reputação; trocar a base muda o
 * número e, pior, muda a decisão que o operador toma olhando para ele.
 */

export interface ContadoresCampanha {
  readonly enviados: number;
  readonly entregues: number;
  readonly aberturasUnicas: number;
  readonly aberturasTotais: number;
  readonly cliquesUnicos: number;
  readonly cliquesTotais: number;
  readonly bouncesHard: number;
  readonly bouncesSoft: number;
  readonly reclamacoes: number;
  readonly descadastros: number;
  readonly rejeitados: number;
  readonly falhasRenderizacao: number;
}

export type NivelRisco = 'OK' | 'ATENCAO' | 'CRITICO';

export interface TaxasCampanha {
  readonly entrega: number;
  /** Aberturas únicas sobre **entregues** — abrir o que não chegou é impossível. */
  readonly abertura: number;
  /** Cliques únicos sobre entregues. */
  readonly clique: number;
  /** Cliques sobre aberturas — mede o conteúdo, não a linha de assunto. */
  readonly cliquePorAbertura: number;
  readonly bounceHard: number;
  readonly bounceTotal: number;
  readonly reclamacao: number;
  readonly descadastro: number;
}

export interface AvaliacaoRisco {
  readonly nivel: NivelRisco;
  readonly bounce: NivelRisco;
  readonly reclamacao: NivelRisco;
  readonly avisos: readonly string[];
}

/**
 * Limiares — §10.4.
 *
 * São os mesmos dos alarmes do CloudWatch, e isso é intencional: se o relatório
 * usasse números diferentes dos alarmes, o operador veria "tudo verde" na tela
 * enquanto a agência recebia alerta por e-mail.
 */
export const LIMIAR_BOUNCE_ATENCAO = 0.05;
export const LIMIAR_BOUNCE_CRITICO = 0.1;
export const LIMIAR_RECLAMACAO_ATENCAO = 0.001;
export const LIMIAR_RECLAMACAO_CRITICO = 0.003;

/** Abaixo disso, percentual não significa nada — 1 bounce em 3 envios não é 33%. */
const MINIMO_PARA_AVALIAR_RISCO = 50;

const dividir = (numerador: number, denominador: number): number =>
  denominador <= 0 ? 0 : numerador / denominador;

export const CONTADORES_ZERADOS: ContadoresCampanha = {
  enviados: 0,
  entregues: 0,
  aberturasUnicas: 0,
  aberturasTotais: 0,
  cliquesUnicos: 0,
  cliquesTotais: 0,
  bouncesHard: 0,
  bouncesSoft: 0,
  reclamacoes: 0,
  descadastros: 0,
  rejeitados: 0,
  falhasRenderizacao: 0,
};

export function normalizarContadores(bruto: Readonly<Record<string, number>>): ContadoresCampanha {
  const saida: Record<string, number> = { ...CONTADORES_ZERADOS };
  for (const chave of Object.keys(CONTADORES_ZERADOS)) {
    const valor = bruto[chave];
    // Contador negativo é dado corrompido; tratar como zero evita taxa negativa
    // na tela, que só confundiria quem está lendo.
    saida[chave] = typeof valor === 'number' && valor > 0 ? valor : 0;
  }
  return saida as unknown as ContadoresCampanha;
}

export function calcularTaxas(c: ContadoresCampanha): TaxasCampanha {
  return {
    entrega: dividir(c.entregues, c.enviados),
    abertura: dividir(c.aberturasUnicas, c.entregues),
    clique: dividir(c.cliquesUnicos, c.entregues),
    cliquePorAbertura: dividir(c.cliquesUnicos, c.aberturasUnicas),
    // Bounce sobre **enviados**: é a base que a AWS usa para julgar a conta.
    // Sobre entregues seria sempre menor e daria falsa sensação de segurança.
    bounceHard: dividir(c.bouncesHard, c.enviados),
    bounceTotal: dividir(c.bouncesHard + c.bouncesSoft, c.enviados),
    // Reclamação sobre entregues: só quem recebeu pode reclamar.
    reclamacao: dividir(c.reclamacoes, c.entregues),
    descadastro: dividir(c.descadastros, c.entregues),
  };
}

/**
 * Classifica o risco de reputação.
 *
 * Existe porque o número sozinho não comunica urgência: "4,8% de bounce" parece
 * bom para quem não sabe que a AWS suspende a conta perto de 10%. O nível vai
 * junto do número para que a interface não precise reimplementar essa regra — e
 * não possa esquecer dela.
 */
export function avaliarRisco(c: ContadoresCampanha, t: TaxasCampanha): AvaliacaoRisco {
  const avisos: string[] = [];

  if (c.enviados < MINIMO_PARA_AVALIAR_RISCO) {
    return {
      nivel: 'OK',
      bounce: 'OK',
      reclamacao: 'OK',
      avisos: [`Volume baixo (${c.enviados} envios): os percentuais ainda não são significativos.`],
    };
  }

  const bounce = classificar(t.bounceHard, LIMIAR_BOUNCE_ATENCAO, LIMIAR_BOUNCE_CRITICO);
  const reclamacao = classificar(
    t.reclamacao,
    LIMIAR_RECLAMACAO_ATENCAO,
    LIMIAR_RECLAMACAO_CRITICO,
  );

  if (bounce === 'CRITICO') {
    avisos.push(
      'Taxa de bounce em nível crítico. Pare as campanhas: acima deste patamar a AWS pode suspender a conta.',
    );
  } else if (bounce === 'ATENCAO') {
    avisos.push(
      'Taxa de bounce acima do normal. Indica lista desatualizada — higienize antes do próximo disparo.',
    );
  }

  if (reclamacao === 'CRITICO') {
    avisos.push(
      'Reclamações de spam em nível crítico. Pare as campanhas e revise a origem da lista e o conteúdo.',
    );
  } else if (reclamacao === 'ATENCAO') {
    avisos.push(
      'Reclamações de spam acima do normal. Verifique se o link de descadastro está visível e se os contatos têm vínculo real.',
    );
  }

  if (t.entrega > 0 && t.abertura === 0 && c.entregues > MINIMO_PARA_AVALIAR_RISCO) {
    // Zero aberturas com entregas confirmadas costuma ser rastreamento
    // quebrado, não campanha ruim — vale investigar antes de culpar o conteúdo.
    avisos.push(
      'Nenhuma abertura registrada apesar das entregas. Verifique o domínio de rastreamento.',
    );
  }

  return { nivel: pior(bounce, reclamacao), bounce, reclamacao, avisos };
}

function classificar(valor: number, atencao: number, critico: number): NivelRisco {
  if (valor >= critico) return 'CRITICO';
  if (valor >= atencao) return 'ATENCAO';
  return 'OK';
}

function pior(a: NivelRisco, b: NivelRisco): NivelRisco {
  const ordem: Record<NivelRisco, number> = { OK: 0, ATENCAO: 1, CRITICO: 2 };
  return ordem[a] >= ordem[b] ? a : b;
}

/** Soma contadores de várias campanhas para a visão agregada. */
export function somarContadores(lista: readonly ContadoresCampanha[]): ContadoresCampanha {
  return lista.reduce<ContadoresCampanha>((acc, c) => {
    const saida: Record<string, number> = {};
    for (const chave of Object.keys(CONTADORES_ZERADOS)) {
      saida[chave] =
        (acc[chave as keyof ContadoresCampanha] ?? 0) + (c[chave as keyof ContadoresCampanha] ?? 0);
    }
    return saida as unknown as ContadoresCampanha;
  }, CONTADORES_ZERADOS);
}
