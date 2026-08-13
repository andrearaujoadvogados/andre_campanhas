import { describe, it, expect } from 'vitest';
import {
  createBoletimDesign,
  criarLinhaAbertura,
  criarLinhaAvisoLegal,
  criarLinhaEncerramento,
  criarLinhaNoticia,
  criarLinhaPrazos,
} from '../src/lib/criador/boletim.js';
import { compileDesignToMjml, isValidDesign } from '../src/lib/criador/compile.js';
import {
  createFooterModuleRow,
  createHeaderModuleRow,
  DEFAULT_SETTINGS,
} from '../src/lib/criador/presets.js';
import type { EmailDesign } from '../src/lib/criador/tipos.js';

describe('template do boletim de notícias', () => {
  it('o design pronto é válido e compila com a edição de exemplo', () => {
    const design = createBoletimDesign();

    expect(isValidDesign(design)).toBe(true);

    const mjml = compileDesignToMjml(design);
    expect(mjml).toContain('BOLETIM TRIBUTÁRIO');
    expect(mjml).toContain('REFORMA TRIBUTÁRIA');
    expect(mjml).toContain('PRAZOS DE AGOSTO');
    // O rodapé com descadastro vem junto — sem ele o envio seria ilegal.
    expect(mjml).toContain('{{url_descadastro}}');
    // E a saudação usa a variável real do Liquid, não um token inventado.
    expect(mjml).toContain('{{contato.primeiroNome}}');
  });

  it('cada notícia carrega o próprio separador — duplicar não perde o fio', () => {
    const linha = criarLinhaNoticia({ categoria: 'STF', titulo: 'T', corpo: 'C' });
    const tipos = linha.columns[0]?.blocks.map((b) => b.type);

    expect(tipos).toEqual(['text', 'text', 'text', 'divider']);
  });

  it('duas chamadas nunca compartilham id — inserir duas notícias não colide', () => {
    const a = criarLinhaNoticia({ categoria: 'X', titulo: 'T', corpo: 'C' });
    const b = criarLinhaNoticia({ categoria: 'X', titulo: 'T', corpo: 'C' });

    const idsA = new Set([a.id, ...(a.columns[0]?.blocks.map((x) => x.id) ?? [])]);
    expect(idsA.has(b.id)).toBe(false);
    for (const bloco of b.columns[0]?.blocks ?? []) {
      expect(idsA.has(bloco.id)).toBe(false);
    }
  });

  it('o caminho da automação: montar a edição inteira pelas fábricas', () => {
    // É exatamente o que a rotina futura fará com as notícias pesquisadas na
    // web: nada de manipular HTML — as fábricas produzem o design e o
    // compilador cuida do resto. Este teste é o contrato desse caminho.
    const noticias = [
      { categoria: 'STF', titulo: 'Notícia um', corpo: 'Corpo um.' },
      { categoria: 'STJ', titulo: 'Notícia dois', corpo: 'Corpo dois.' },
      { categoria: 'Receita Federal', titulo: 'Notícia três', corpo: 'Corpo três.' },
      { categoria: 'CARF', titulo: 'Notícia quatro', corpo: 'Corpo quatro.' },
    ];

    const design: EmailDesign = {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      rows: [
        createHeaderModuleRow(),
        criarLinhaAbertura({
          chapeu: 'Boletim Tributário',
          titulo: 'Edição gerada',
          periodo: '10 a 14 de agosto de 2026',
          introducao: 'Olá {{contato.primeiroNome}}, os destaques.',
        }),
        ...noticias.map(criarLinhaNoticia),
        criarLinhaPrazos('Prazos', [{ dia: '20/08', descricao: 'PGDAS-D' }]),
        criarLinhaEncerramento({ mensagem: 'À disposição.', nome: 'André', registro: 'OAB/MG 1' }),
        criarLinhaAvisoLegal({ endereco: 'Formiga/MG', fontes: 'Fontes: Conjur.' }),
        createFooterModuleRow(),
      ],
    };

    expect(isValidDesign(design)).toBe(true);
    const mjml = compileDesignToMjml(design);

    for (const n of noticias) {
      expect(mjml).toContain(n.titulo);
      expect(mjml).toContain(n.corpo);
    }
    expect(mjml).toContain('Notícia quatro');
    expect(mjml).toContain('PGDAS-D');
  });

  it('o chapéu sobe para maiúsculas sozinho — a automação não precisa saber disso', () => {
    const linha = criarLinhaNoticia({
      categoria: 'stf · pauta de 26/08',
      titulo: 'T',
      corpo: 'C',
    });
    const primeiro = linha.columns[0]?.blocks[0];

    expect(primeiro?.type === 'text' && primeiro.html).toContain('STF · PAUTA DE 26/08');
  });

  it('um prazo vira uma linha com a data em destaque', () => {
    const linha = criarLinhaPrazos('Prazos', [
      { dia: '17/08', descricao: 'EFD-Reinf' },
      { dia: '31/08', descricao: 'DCTFWeb' },
    ]);
    const html = linha.columns[0]?.blocks.map((b) => (b.type === 'text' ? b.html : '')).join(' ');

    expect(html).toContain('17/08');
    expect(html).toContain('EFD-Reinf');
    expect(html).toContain('31/08');
    expect(html).toContain('DCTFWeb');
  });
});
