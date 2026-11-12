import { describe, it, expect } from 'vitest';
import {
  createBoletimDesign,
  criarLinhaAbertura,
  criarLinhaCabecalhoBoletim,
  criarLinhaDestaque,
  criarLinhaEncerramento,
  criarLinhaNoticia,
  criarLinhaPrazos,
  criarLinhaRadar,
  criarLinhaRodapeBoletim,
  criarLinhaSignifica,
  criarLinhaTituloDeSecao,
} from '@emailmkt/criador';
import { compileDesignToMjml, isValidDesign } from '@emailmkt/criador';
import {
  createHeaderModuleRow,
  DEFAULT_SETTINGS,
  LOGO_EMAIL,
  LOGO_EMAIL_CLARO,
  createDefaultDesign,
} from '@emailmkt/criador';
import type { EmailDesign } from '@emailmkt/criador';

describe('template do boletim de notícias', () => {
  it('o design pronto é válido e compila com a edição de referência', () => {
    const design = createBoletimDesign();

    expect(isValidDesign(design)).toBe(true);

    const mjml = compileDesignToMjml(design);
    expect(mjml).toContain('BOLETIM TRIBUTÁRIO');
    // As seções da edição de referência, na ordem em que o leitor as encontra.
    const posicoes = [
      'DESTAQUE · STJ, 03/09',
      'O QUE ISSO SIGNIFICA PARA VOCÊ',
      'TAMBÉM NESTAS SEMANAS',
      'NO RADAR',
      'André Augusto de Araújo',
      'ANDRÉ ARAÚJO ADVOGADOS',
    ].map((marca) => mjml.indexOf(marca));
    for (const [i, posicao] of posicoes.entries()) {
      expect(posicao, `seção ${String(i)}`).toBeGreaterThan(-1);
      if (i > 0) expect(posicao).toBeGreaterThan(posicoes[i - 1] ?? -1);
    }
    // O rodapé com descadastro vem junto — sem ele o envio seria ilegal.
    expect(mjml).toContain('{{url_descadastro}}');
    // Aviso legal: informativo não é parecer.
    expect(mjml).toContain('não constitui parecer jurídico');
  });

  it('cada notícia carrega o próprio separador — duplicar não perde o fio', () => {
    const linha = criarLinhaNoticia({ categoria: 'STF', titulo: 'T', corpo: 'C' });
    const tipos = linha.columns[0]?.blocks.map((b) => b.type);

    expect(tipos).toEqual(['text', 'text', 'text', 'divider']);
  });

  it('o título da notícia vira link discreto para a matéria quando há URL', () => {
    const comLink = criarLinhaNoticia({
      categoria: 'STF',
      titulo: 'T',
      corpo: 'C',
      url: 'https://x.com.br/m',
    });
    const semLink = criarLinhaNoticia({ categoria: 'STF', titulo: 'T', corpo: 'C' });
    const titulo = (linha: typeof comLink) => {
      const b = linha.columns[0]?.blocks[1];
      return b?.type === 'text' ? b.html : '';
    };

    expect(titulo(comLink)).toContain('href="https://x.com.br/m"');
    expect(titulo(comLink)).toContain('text-decoration:none');
    expect(titulo(semLink)).not.toContain('<a ');
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
    // É exatamente o que a rotina faz com as notícias pesquisadas na web:
    // nada de manipular HTML — as fábricas produzem o design e o compilador
    // cuida do resto. Este teste é o contrato desse caminho.
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
        criarLinhaCabecalhoBoletim(),
        criarLinhaAbertura({
          chapeu: 'Boletim Tributário',
          titulo: 'Edição gerada',
          periodo: '10 a 14 de agosto de 2026',
          introducao: 'Olá {{contato.primeiroNome}}, os destaques.',
        }),
        criarLinhaDestaque({
          chapeu: 'STJ, 12/08',
          titulo: 'Destaque da edição',
          paragrafos: ['Parágrafo um.', 'Parágrafo dois.'],
        }),
        criarLinhaSignifica('Leitura prática.'),
        criarLinhaTituloDeSecao('Também nestas semanas'),
        ...noticias.map(criarLinhaNoticia),
        criarLinhaTituloDeSecao('No radar'),
        criarLinhaRadar([{ quando: '20/08', texto: 'PGDAS-D' }]),
        criarLinhaEncerramento({ mensagem: 'À disposição.', nome: 'André', registro: 'OAB/MG 1' }),
        criarLinhaRodapeBoletim({
          nome: 'André Araújo Advogados',
          endereco: 'Formiga/MG',
          area: 'Tributário',
          fontes: 'Fontes: Conjur.',
        }),
      ],
    };

    expect(isValidDesign(design)).toBe(true);
    const mjml = compileDesignToMjml(design);

    for (const n of noticias) {
      expect(mjml).toContain(n.titulo);
      expect(mjml).toContain(n.corpo);
    }
    expect(mjml).toContain('DESTAQUE · STJ, 12/08');
    expect(mjml).toContain('Parágrafo dois.');
    expect(mjml).toContain('Leitura prática.');
    expect(mjml).toContain('PGDAS-D');
    expect(mjml).toContain('{{url_descadastro}}');
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

  it('o card de destaque é vinho na COLUNA, recuado das bordas, com o texto claro', () => {
    const linha = criarLinhaDestaque({ chapeu: 'STJ', titulo: 'T', paragrafos: ['P'] });
    const coluna = linha.columns[0];

    // O fundo vai na coluna (a linha continua branca) — é o que dá a margem.
    expect(linha.attrs.backgroundColor).toBe('');
    expect(coluna?.attrs?.backgroundColor).toBe('#721420');

    const mjml = compileDesignToMjml({
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      rows: [linha],
    });
    expect(mjml).toContain('<mj-column width="100%" background-color="#721420"');
    expect(mjml).toContain('color="#FFFFFF"');
  });

  it('um item do radar é uma linha com a data em destaque ao lado do texto', () => {
    const linha = criarLinhaRadar([
      { quando: '17/08', texto: 'EFD-Reinf' },
      { quando: 'Em curso', texto: 'DCTFWeb' },
    ]);
    const html = linha.columns[0]?.blocks.map((b) => (b.type === 'text' ? b.html : '')).join(' ');

    expect(html).toContain('17/08');
    expect(html).toContain('EFD-Reinf');
    expect(html).toContain('Em curso');
    expect(html).toContain('DCTFWeb');
    // Lado a lado por tabela inline — colunas do MJML empilhariam no celular.
    expect(html).toContain('<table role="presentation"');
    // Um fio entre os dois itens, nenhum depois do último.
    expect(linha.columns[0]?.blocks.filter((b) => b.type === 'divider')).toHaveLength(1);
  });

  it('o quadro de prazos antigo continua funcionando, agora no desenho do radar', () => {
    const linha = criarLinhaPrazos('Prazos', [{ dia: '31/08', descricao: 'DCTFWeb' }]);
    const html = linha.columns[0]?.blocks.map((b) => (b.type === 'text' ? b.html : '')).join(' ');

    expect(html).toContain('PRAZOS');
    expect(html).toContain('31/08');
    expect(html).toContain('DCTFWeb');
  });
});

describe('boletim montado da coleta — conteúdo não confiável', () => {
  it('escapa título, resumo, URL e o que a IA editora escreveu — nada vira marcação', async () => {
    const { criarBoletimColetado } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      titulo: 'Destaques <script>alert(1)</script>',
      periodo: '01 a 07/08',
      introducao: 'Abertura <b>editada</b>',
      destaque: {
        noticia: {
          titulo: 'Notícia com <img src=x onerror=alert(1)>',
          resumo: 'Resumo com "aspas" & <b>negrito</b>',
          url: 'https://site.com.br/materia?a=1&b=2',
          tag: '<STJ>',
        },
        chapeu: 'STJ, <03/09>',
        paragrafos: ['Parágrafo <i>um</i>'],
        significa: 'Significa <u>algo</u>',
      },
      noticias: [{ titulo: 'Outra', resumo: 'R.', url: 'https://x.com.br/m', tag: 'STF' }],
      radar: [{ quando: '<24/09>', texto: 'Radar <s>x</s>' }],
      fontes: ['Fonte <script>'],
    });

    const html = JSON.stringify(design);
    // Nenhuma tag sobrevive crua — tudo virou entidade.
    for (const cru of [
      '<script>',
      '<img src=x',
      '<b>',
      '<i>',
      '<u>',
      '<s>',
      '<03/09>',
      '<24/09>',
    ]) {
      expect(html, cru).not.toContain(cru);
    }
    expect(html).toContain('&lt;script&gt;');

    // O título do destaque aponta para a URL da matéria (o & escapado em
    // atributo é HTML correto).
    expect(html).toContain('https://site.com.br/materia?a=1&amp;b=2');
  });

  it('sem destaque editado, a primeira notícia sobe para o card e as outras seguem abaixo', async () => {
    const { criarBoletimColetado, compileDesignToMjml } = await import('@emailmkt/criador');
    const design = criarBoletimColetado({
      titulo: 'Edição da semana',
      periodo: '01 a 07/08',
      introducao: '',
      noticias: [
        {
          titulo: 'Primeira',
          resumo: 'Resumo da primeira.',
          url: 'https://x.com.br/1',
          tag: 'STJ',
        },
        { titulo: 'Segunda', resumo: 'Resumo da segunda.', url: 'https://x.com.br/2', tag: 'STF' },
      ],
      fontes: ['Migalhas'],
    });

    const mjml = compileDesignToMjml(design);
    expect(mjml).toContain('<mjml');
    expect(mjml).toContain('DESTAQUE · STJ');
    expect(mjml.indexOf('Primeira')).toBeLessThan(mjml.indexOf('TAMBÉM NESTAS SEMANAS'));
    expect(mjml.indexOf('TAMBÉM NESTAS SEMANAS')).toBeLessThan(mjml.indexOf('Segunda'));
    // Sem leitura prática nem radar, as seções não saem vazias.
    expect(mjml).not.toContain('O QUE ISSO SIGNIFICA');
    expect(mjml).not.toContain('NO RADAR');
  });

  it('com uma notícia só, sai o card e nenhuma seção "também"', async () => {
    const { criarBoletimColetado, compileDesignToMjml } = await import('@emailmkt/criador');
    const mjml = compileDesignToMjml(
      criarBoletimColetado({
        titulo: 'T',
        periodo: 'p',
        introducao: '',
        noticias: [{ titulo: 'Única', resumo: 'R.', url: 'https://x.com.br/m', tag: 'STJ' }],
        fontes: ['Migalhas'],
      }),
    );

    expect(mjml).toContain('Única');
    expect(mjml).not.toContain('TAMBÉM NESTAS SEMANAS');
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

  it('o boletim abre numa faixa vinho com a versão clara do logo', () => {
    const faixa = criarLinhaCabecalhoBoletim();
    const primeiro = faixa.columns[0]?.blocks[0];

    expect(faixa.attrs.backgroundColor).toBe('#721420');
    expect(primeiro?.type).toBe('image');
    if (primeiro?.type === 'image') {
      expect(primeiro.src).toBe(LOGO_EMAIL_CLARO.src);
      expect(primeiro.src).toMatch(/logo-email-claro-v\d+\.png$/);
      expect(primeiro.alt).toBe('André Araújo Advogados');
    }
  });

  it('o logo claro traz o próprio fundo vinho — legível mesmo onde a faixa for invertida', () => {
    // O Gmail do iPhone inverte a cor da faixa e nunca a de imagens: com fundo
    // transparente, o dourado ficava sobre rosa. A v2 traz o vinho no arquivo,
    // com respiro, e a faixa desconta esse respiro no recuo.
    const faixa = criarLinhaCabecalhoBoletim();
    const logo = faixa.columns[0]?.blocks[0];

    expect(LOGO_EMAIL_CLARO.src).toMatch(/logo-email-claro-v2\.png$/);
    expect(logo?.type === 'image' && logo.attrs.width).toBe(LOGO_EMAIL_CLARO.width);
    expect(LOGO_EMAIL_CLARO.width).toBe(266);
    expect(faixa.attrs.padding).toBe('12px 24px 8px 24px');
  });

  it('no boletim, a faixa e o card vinho ficam protegidos no Gmail — e só eles', () => {
    const mjml = compileDesignToMjml(createBoletimDesign());

    // A faixa é estrutura escura; o card é coluna escura dentro de linha branca.
    expect(mjml.match(/css-class="aa-secao-721420"/g)).toHaveLength(1);
    expect(mjml.match(/css-class="aa-coluna-721420"/g)).toHaveLength(1);
    // Camadas só nos textos do card: chapéu, título e os três parágrafos.
    expect(mjml.match(/<div class="gmail-blend-screen">/g)).toHaveLength(5);
    expect(mjml.indexOf('gmail-blend-screen">')).toBeGreaterThan(
      mjml.indexOf('css-class="aa-coluna-721420"'),
    );
    expect(mjml).toContain(
      'u + .body .aa-fundo-721420 { background-image: linear-gradient(#721420, #721420) !important; }',
    );
  });

  it('e-mail novo e boletim compilam com o logo no topo', () => {
    for (const [design, logo] of [
      [createDefaultDesign(), LOGO_EMAIL.src],
      [createBoletimDesign(), LOGO_EMAIL_CLARO.src],
    ] as const) {
      // Só o corpo interessa: o cabeçalho do MJML também tem um <mj-text> (o
      // padrão de tipografia), e ele não é conteúdo.
      const corpo = compileDesignToMjml(design).slice(
        compileDesignToMjml(design).indexOf('<mj-body'),
      );
      const posicaoLogo = corpo.indexOf(logo);
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
    expect(mjml).toContain('width="64px" align="center"');
    // Sem web font: título invisível enquanto a fonte remota não chega é pior
    // do que Georgia. A serifada é inline, com a de sistema logo atrás.
    expect(mjml).not.toContain('<mj-font');
    expect(mjml).toContain("font-family:Fraunces, Georgia, 'Times New Roman', serif");
  });
});
