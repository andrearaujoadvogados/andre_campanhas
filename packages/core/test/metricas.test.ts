import { describe, it, expect } from 'vitest';
import {
  CONTADORES_ZERADOS,
  avaliarRisco,
  calcularTaxas,
  normalizarContadores,
  somarContadores,
  type ContadoresCampanha,
} from '../src/domain/report/metricas.js';

const contadores = (over: Partial<ContadoresCampanha> = {}): ContadoresCampanha => ({
  ...CONTADORES_ZERADOS,
  ...over,
});

describe('denominadores das taxas', () => {
  it('abertura é sobre ENTREGUES, não sobre enviados', () => {
    // Abrir o que não chegou é impossível. Sobre enviados, uma campanha com
    // muitos bounces pareceria ter engajamento pior do que teve.
    const t = calcularTaxas(contadores({ enviados: 1000, entregues: 500, aberturasUnicas: 250 }));
    expect(t.abertura).toBe(0.5);
  });

  it('bounce é sobre ENVIADOS — é a base que a AWS usa para julgar a conta', () => {
    // Sobre entregues seria sempre menor e daria falsa sensação de segurança.
    const t = calcularTaxas(contadores({ enviados: 1000, entregues: 900, bouncesHard: 100 }));
    expect(t.bounceHard).toBe(0.1);
  });

  it('reclamação é sobre entregues — só quem recebeu pode reclamar', () => {
    const t = calcularTaxas(contadores({ enviados: 1000, entregues: 500, reclamacoes: 5 }));
    expect(t.reclamacao).toBe(0.01);
  });

  it('clique por abertura mede o conteúdo, não a linha de assunto', () => {
    const t = calcularTaxas(
      contadores({ entregues: 1000, aberturasUnicas: 200, cliquesUnicos: 50 }),
    );
    expect(t.cliquePorAbertura).toBe(0.25);
  });

  it('separa bounce hard de total', () => {
    const t = calcularTaxas(contadores({ enviados: 100, bouncesHard: 5, bouncesSoft: 10 }));
    expect(t.bounceHard).toBe(0.05);
    expect(t.bounceTotal).toBe(0.15);
  });

  it('nunca divide por zero', () => {
    const t = calcularTaxas(CONTADORES_ZERADOS);
    for (const valor of Object.values(t)) {
      expect(Number.isFinite(valor)).toBe(true);
      expect(valor).toBe(0);
    }
  });
});

describe('avaliação de risco — mesmos limiares dos alarmes (§10.4)', () => {
  const comVolume = (over: Partial<ContadoresCampanha>) =>
    contadores({ enviados: 1000, entregues: 1000, ...over });

  it('bounce em 4% é OK', () => {
    const c = comVolume({ bouncesHard: 40 });
    expect(avaliarRisco(c, calcularTaxas(c)).bounce).toBe('OK');
  });

  it('bounce em 5% já é atenção', () => {
    const c = comVolume({ bouncesHard: 50 });
    expect(avaliarRisco(c, calcularTaxas(c)).bounce).toBe('ATENCAO');
  });

  it('bounce em 10% é crítico — a AWS pode suspender a conta', () => {
    const c = comVolume({ bouncesHard: 100 });
    const r = avaliarRisco(c, calcularTaxas(c));

    expect(r.bounce).toBe('CRITICO');
    expect(r.avisos.join(' ')).toMatch(/suspender a conta/i);
  });

  it('reclamação em 0,1% já é atenção', () => {
    const c = comVolume({ reclamacoes: 1 });
    expect(avaliarRisco(c, calcularTaxas(c)).reclamacao).toBe('ATENCAO');
  });

  it('reclamação em 0,3% é crítico — limite prático de Gmail e Yahoo', () => {
    const c = comVolume({ reclamacoes: 3 });
    expect(avaliarRisco(c, calcularTaxas(c)).reclamacao).toBe('CRITICO');
  });

  it('o nível geral é o pior dos dois', () => {
    const c = comVolume({ bouncesHard: 10, reclamacoes: 3 });
    expect(avaliarRisco(c, calcularTaxas(c)).nivel).toBe('CRITICO');
  });

  it('não classifica risco com volume baixo — 1 bounce em 3 envios não é 33%', () => {
    const c = contadores({ enviados: 3, entregues: 2, bouncesHard: 1 });
    const r = avaliarRisco(c, calcularTaxas(c));

    expect(r.nivel).toBe('OK');
    expect(r.avisos.join(' ')).toMatch(/não são significativos/i);
  });

  it('zero aberturas com entregas confirmadas sugere rastreamento quebrado', () => {
    // Costuma ser DNS do domínio de rastreamento, não campanha ruim.
    const c = comVolume({ aberturasUnicas: 0 });
    const r = avaliarRisco(c, calcularTaxas(c));

    expect(r.avisos.join(' ')).toMatch(/domínio de rastreamento/i);
  });

  it('campanha saudável não gera aviso nenhum', () => {
    const c = comVolume({ bouncesHard: 5, reclamacoes: 0, aberturasUnicas: 300 });
    const r = avaliarRisco(c, calcularTaxas(c));

    expect(r.nivel).toBe('OK');
    expect(r.avisos).toHaveLength(0);
  });
});

describe('normalização de contadores', () => {
  it('preenche campos ausentes com zero', () => {
    expect(normalizarContadores({ enviados: 10 })).toMatchObject({ enviados: 10, entregues: 0 });
  });

  it('ignora contador negativo — dado corrompido não vira taxa negativa', () => {
    expect(normalizarContadores({ enviados: -5 }).enviados).toBe(0);
  });

  it('descarta chaves que não são contadores conhecidos', () => {
    const r = normalizarContadores({ enviados: 1, coisaEstranha: 99 });
    expect(Object.keys(r)).not.toContain('coisaEstranha');
  });
});

describe('agregação', () => {
  it('soma campanhas para a visão consolidada', () => {
    const r = somarContadores([
      contadores({ enviados: 100, entregues: 90, bouncesHard: 10 }),
      contadores({ enviados: 200, entregues: 195, bouncesHard: 5 }),
    ]);

    expect(r.enviados).toBe(300);
    expect(r.entregues).toBe(285);
    expect(r.bouncesHard).toBe(15);
  });

  it('lista vazia devolve tudo zerado', () => {
    expect(somarContadores([])).toEqual(CONTADORES_ZERADOS);
  });
});
