import { describe, it, expect } from 'vitest';
import {
  LIMITES_EDICAO,
  analisarEdicao,
  edicaoPadrao,
  montarPromptDeEdicao,
  type NoticiaColetada,
} from '../src/index.js';

const NOTICIAS: NoticiaColetada[] = [
  {
    titulo: 'CPRB continua na base do PIS e da Cofins',
    resumo: 'A Primeira Seção julgou o Tema 1.276 sob o rito dos repetitivos.',
    url: 'https://www.migalhas.com.br/cprb',
    tag: 'STJ',
  },
  {
    titulo: 'ITBI na integralização de capital: julgamento começa e para',
    resumo: 'Sessão de 2 de setembro foi ocupada pelas sustentações orais.',
    url: 'https://www.conjur.com.br/itbi',
    tag: 'STF',
  },
  {
    titulo: 'Voto de qualidade do CARF adiado pela quarta vez',
    resumo: 'Retirado da pauta de 24 de setembro sem nova data.',
    url: 'https://www.migalhas.com.br/carf',
    tag: 'CARF',
  },
];

const RESPOSTA = JSON.stringify({
  titulo: 'Os tribunais superiores voltaram a decidir',
  introducao: 'Depois de um semestre de adiamentos, STF e STJ entregaram definições de peso.',
  destaque: {
    indice: 0,
    chapeu: 'STJ, 03/09',
    paragrafos: ['A Primeira Seção do STJ julgou o Tema 1.276.', 'O argumento não prevaleceu.'],
    significa: 'Empresas que optaram pela desoneração da folha precisam reavaliar a posição.',
  },
  demais: [
    { indice: 2, chapeu: 'Correção de rota' },
    { indice: 1, chapeu: 'STF · Holdings e planejamento patrimonial' },
  ],
  radar: [{ quando: '24/09', texto: 'Pauta do STF.' }],
});

describe('prompt da passada editorial', () => {
  it('numera as notícias, pede índices de volta e delimita o material como não confiável', () => {
    const prompt = montarPromptDeEdicao({
      nomeDoBoletim: 'Boletim Tributário',
      periodo: '26 de agosto a 11 de setembro de 2026',
      noticias: NOTICIAS,
      temas: ['tributário'],
    });

    expect(prompt).toContain('[0] tag: STJ');
    expect(prompt).toContain('[2] tag: CARF');
    expect(prompt).toContain('"indice"');
    expect(prompt).toContain('Temas deste boletim: tributário');
    expect(prompt).toContain('SOMENTE desses temas');
    expect(prompt).toContain('IGNORE');
    expect(prompt).toContain('--- FIM DAS NOTÍCIAS ---');
    expect(prompt).not.toContain('TEXTO DA MATÉRIA');
    expect(prompt).not.toContain('RETROSPECTIVA');
  });

  it('a retrospectiva é anunciada, e a matéria do destaque entra quando o chamador a leu', () => {
    const prompt = montarPromptDeEdicao({
      nomeDoBoletim: 'B',
      periodo: 'p',
      noticias: NOTICIAS,
      retrospectiva: true,
      materiaDoDestaque: { indice: 0, texto: 'Texto integral da matéria sobre a CPRB.' },
    });

    expect(prompt).toContain('RETROSPECTIVA');
    expect(prompt).toContain('TEXTO DA MATÉRIA [0]');
    expect(prompt).toContain('Texto integral da matéria sobre a CPRB.');
  });
});

describe('interpretação da resposta editorial', () => {
  it('resolve os índices para as notícias validadas, na ordem que a IA escolheu', () => {
    const edicao = analisarEdicao(RESPOSTA, NOTICIAS);

    expect(edicao).not.toBeNull();
    expect(edicao?.titulo).toBe('Os tribunais superiores voltaram a decidir');
    expect(edicao?.destaque.noticia).toBe(NOTICIAS[0]);
    expect(edicao?.destaque.chapeu).toBe('STJ, 03/09');
    expect(edicao?.destaque.paragrafos).toHaveLength(2);
    expect(edicao?.destaque.significa).toContain('desoneração');
    expect(edicao?.demais.map((n) => n.titulo)).toEqual([NOTICIAS[2]?.titulo, NOTICIAS[1]?.titulo]);
    expect(edicao?.demais[0]?.chapeu).toBe('Correção de rota');
    expect(edicao?.radar).toEqual([{ quando: '24/09', texto: 'Pauta do STF.' }]);
  });

  it('aceita a cerca de código que os modelos costumam pôr em volta do JSON', () => {
    expect(analisarEdicao('```json\n' + RESPOSTA + '\n```', NOTICIAS)).not.toBeNull();
  });

  it('notícia que a IA esqueceu entra no fim de "demais" — nada coletado some', () => {
    const resposta = JSON.stringify({
      destaque: { indice: 1, paragrafos: ['P'] },
      demais: [],
    });
    const edicao = analisarEdicao(resposta, NOTICIAS);

    expect(edicao?.destaque.noticia).toBe(NOTICIAS[1]);
    expect(edicao?.demais.map((n) => n.titulo)).toEqual([NOTICIAS[0]?.titulo, NOTICIAS[2]?.titulo]);
    // Sem chapéu editado, fica a tag da coleta.
    expect(edicao?.demais[0]?.chapeu).toBe('STJ');
  });

  it('o destaque nunca se repete em "demais", e índices inválidos são ignorados', () => {
    const resposta = JSON.stringify({
      destaque: { indice: 0, paragrafos: ['P'] },
      demais: [{ indice: 0 }, { indice: 7 }, { indice: -1 }, { indice: 'x' }, { indice: '2' }],
    });
    const edicao = analisarEdicao(resposta, NOTICIAS);

    expect(edicao?.demais.map((n) => n.titulo)).toEqual([NOTICIAS[2]?.titulo, NOTICIAS[1]?.titulo]);
  });

  it('destaque sem parágrafos usa o resumo da notícia; radar sem data ou texto é descartado', () => {
    const resposta = JSON.stringify({
      destaque: { indice: 0 },
      radar: [{ quando: '24/09' }, { texto: 'sem data' }, { quando: '01/10', texto: 'ok' }],
    });
    const edicao = analisarEdicao(resposta, NOTICIAS);

    expect(edicao?.destaque.paragrafos).toEqual([NOTICIAS[0]?.resumo]);
    expect(edicao?.destaque.significa).toBe('');
    expect(edicao?.radar).toEqual([{ quando: '01/10', texto: 'ok' }]);
  });

  it('corta o que passa dos limites em vez de recusar a edição', () => {
    const resposta = JSON.stringify({
      titulo: 'T'.repeat(500),
      destaque: {
        indice: 0,
        paragrafos: Array.from({ length: 10 }, () => 'p'.repeat(2000)),
        significa: 's'.repeat(5000),
      },
      radar: Array.from({ length: 20 }, () => ({ quando: '1'.repeat(50), texto: 't'.repeat(999) })),
    });
    const edicao = analisarEdicao(resposta, NOTICIAS);

    expect(edicao?.titulo).toHaveLength(LIMITES_EDICAO.titulo);
    expect(edicao?.destaque.paragrafos).toHaveLength(LIMITES_EDICAO.paragrafos);
    expect(edicao?.destaque.paragrafos[0]).toHaveLength(LIMITES_EDICAO.paragrafo);
    expect(edicao?.destaque.significa).toHaveLength(LIMITES_EDICAO.significa);
    expect(edicao?.radar).toHaveLength(LIMITES_EDICAO.radar);
    expect(edicao?.radar[0]?.quando).toHaveLength(LIMITES_EDICAO.radarQuando);
  });

  it('estrutura que não serve devolve null: sem JSON, sem objeto, sem destaque válido', () => {
    expect(analisarEdicao('não é json', NOTICIAS)).toBeNull();
    expect(analisarEdicao('[]', NOTICIAS)).toBeNull();
    expect(analisarEdicao('{"titulo":"x"}', NOTICIAS)).toBeNull();
    expect(analisarEdicao('{"destaque":{"indice":9}}', NOTICIAS)).toBeNull();
    expect(analisarEdicao(RESPOSTA, [])).toBeNull();
  });
});

describe('edição padrão — o mesmo layout sem editor', () => {
  it('a primeira notícia vira o destaque com o próprio resumo; as outras seguem com a tag', () => {
    const edicao = edicaoPadrao(NOTICIAS);

    expect(edicao?.titulo).toBe('');
    expect(edicao?.destaque.noticia).toBe(NOTICIAS[0]);
    expect(edicao?.destaque.paragrafos).toEqual([NOTICIAS[0]?.resumo]);
    expect(edicao?.destaque.significa).toBe('');
    expect(edicao?.demais.map((n) => n.chapeu)).toEqual(['STF', 'CARF']);
    expect(edicao?.radar).toEqual([]);
  });

  it('sem notícia nenhuma não há edição', () => {
    expect(edicaoPadrao([])).toBeNull();
  });
});
