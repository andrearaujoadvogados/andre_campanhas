import { describe, it, expect } from 'vitest';
import {
  createBoletimDesign,
  criarLinhaAbertura,
  criarLinhaAvisoLegal,
  criarLinhaEncerramento,
  criarLinhaNoticia,
  criarLinhaPrazos,
} from '@emailmkt/criador';
import { compileDesignToMjml, isValidDesign } from '@emailmkt/criador';
import {
  createFooterModuleRow,
  createHeaderModuleRow,
  DEFAULT_SETTINGS,
  LOGO_EMAIL,
  createDefaultDesign,
} from '@emailmkt/criador';
import type { EmailDesign } from '@emailmkt/criador';

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

describe('boletim montado da coleta — conteúdo não confiável', () => {
  it('escapa título, resumo e URL — HTML de página de terceiros não vira marcação', async () => {
    const { criarBoletimColetado } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      titulo: 'Destaques <script>alert(1)</script>',
      periodo: '01 a 07/08',
      introducao: '',
      noticias: [
        {
          titulo: 'Notícia com <img src=x onerror=alert(1)>',
          resumo: 'Resumo com "aspas" & <b>negrito</b>',
          url: 'https://site.com.br/materia?a=1&b=2',
          tag: '<STJ>',
        },
      ],
      fontes: ['Fonte <script>'],
    });

    const html = JSON.stringify(design);
    // Nenhuma tag sobrevive crua — tudo virou entidade.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>negrito');
    expect(html).toContain('&lt;script&gt;');

    // O link "Leia mais" existe e aponta para a URL da matéria (o & escapado
    // em atributo é HTML correto).
    expect(html).toContain('Ler a matéria completa');
    expect(html).toContain('https://site.com.br/materia?a=1&amp;b=2');
  });

  it('compila para MJML válido com o conteúdo escapado', async () => {
    const { criarBoletimColetado, compileDesignToMjml } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      titulo: 'Edição da semana',
      periodo: '01 a 07/08',
      introducao: '',
      noticias: [{ titulo: 'Título', resumo: 'Resumo.', url: 'https://x.com.br/m', tag: 'STJ' }],
      fontes: ['Migalhas'],
    });

    const mjml = compileDesignToMjml(design);
    expect(mjml).toContain('<mjml>');
    expect(mjml).toContain('STJ');
    expect(mjml).toContain('Ler a matéria completa');
  });
});

describe('logo do escritório no topo de todo e-mail', () => {
  it('o cabeçalho é uma imagem hospedada no painel, com texto alternativo e link para o site', () => {
    const header = createHeaderModuleRow();
    const primeiro = header.columns[0]?.blocks[0];

    expect(primeiro?.type).toBe('image');
    if (primeiro?.type === 'image') {
      expect(primeiro.src).toBe(LOGO_EMAIL.src);
      expect(primeiro.src).toMatch(/^https:\/\/campanhas\.andrearaujoadvogados\.com\.br\/marca\//);
      expect(primeiro.alt).toBe('André Araújo Advogados');
      expect(primeiro.href).toBe('https://andrearaujoadvogados.com.br');
    }
  });

  it('e-mail novo e boletim compilam com o logo no topo', () => {
    for (const design of [createDefaultDesign(), createBoletimDesign()]) {
      // Só o corpo interessa: o cabeçalho do MJML também tem um <mj-text> (o
      // padrão de tipografia), e ele não é conteúdo.
      const corpo = compileDesignToMjml(design).slice(
        compileDesignToMjml(design).indexOf('<mj-body'),
      );
      const posicaoLogo = corpo.indexOf(LOGO_EMAIL.src);
      expect(posicaoLogo).toBeGreaterThan(-1);
      // Antes de qualquer texto do corpo — o logo é a primeira coisa do e-mail.
      expect(posicaoLogo).toBeLessThan(corpo.indexOf('<mj-text'));
    }
  });
});

describe('edição de retrospectiva no e-mail', () => {
  it('avisa o leitor numa caixa antes das notícias, e diz de onde vieram', async () => {
    const { criarBoletimColetado } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      chapeu: 'Boletim Tributário',
      titulo: 'As leituras mais relevantes',
      periodo: '27/08 a 03/09',
      introducao: '',
      edicao: 'RETROSPECTIVA',
      noticias: [{ titulo: 'Tese mais lida', resumo: 'R.', url: 'https://x.com.br/m', tag: 'STJ' }],
      fontes: ['Migalhas', 'Conjur'],
    });

    const mjml = compileDesignToMjml(design);
    const aviso = mjml.indexOf('Sem novidades neste período');
    expect(aviso).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(mjml.indexOf('Tese mais lida'));
    expect(mjml).toContain('selecionadas de Migalhas e Conjur');
    expect(mjml).toContain('BOLETIM TRIBUTÁRIO');
  });

  it('a edição de novidades não carrega o aviso', async () => {
    const { criarBoletimColetado } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      titulo: 'Destaques',
      periodo: 'p',
      introducao: '',
      noticias: [{ titulo: 'T', resumo: 'R.', url: 'https://x.com.br/m', tag: 'STJ' }],
      fontes: ['Migalhas'],
    });

    expect(compileDesignToMjml(design)).not.toContain('Sem novidades neste período');
  });
});

describe('conforto de leitura', () => {
  it('títulos têm entrelinha própria, e o traço curto sai com largura em vez de recuo', () => {
    const mjml = compileDesignToMjml(createBoletimDesign());

    // Título da abertura e das notícias: entrelinha apertada, serifada inline.
    expect(mjml).toContain('line-height="1.25"');
    expect(mjml).toContain('line-height="1.3"');
    expect(mjml).toContain('font-family:Fraunces');
    // Corpo a 16px com entrelinha folgada.
    expect(mjml).toContain('font-size="16px"');
    expect(mjml).toContain('line-height="1.65"');
    // Traço curto dourado: largura fixa centralizada, que não quebra no celular.
    expect(mjml).toContain('width="96px" align="center"');
    // Sem web font: título invisível enquanto a fonte remota não chega é pior
    // do que Georgia. A serifada é inline, com a de sistema logo atrás.
    expect(mjml).not.toContain('<mj-font');
    expect(mjml).toContain("font-family:Fraunces, Georgia, 'Times New Roman', serif");
  });
});
