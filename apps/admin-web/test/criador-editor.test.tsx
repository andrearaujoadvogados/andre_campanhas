import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditorDesign } from '../src/componentes/criador/EditorDesign.tsx';
import { createDefaultDesign } from '../src/lib/criador/presets.js';
import type { EmailDesign } from '../src/lib/criador/tipos.js';

/**
 * O mjml-browser não roda no jsdom (e compilar de verdade não é o que estes
 * testes protegem). O painel de código recebe um HTML fixo; a geração real é
 * coberta pelos testes de `compile` + `codigo`, que são puros.
 */
vi.mock('../src/lib/criador/html.js', () => ({
  // Promises porque a compilação real (mjml-browser v5) é assíncrona — o
  // painel espera resolver antes de mostrar o editor.
  compilarParaHtml: () => Promise.resolve({ html: '<html>compilado</html>', avisos: [] }),
  gerarCodigoDoDocumento: () => Promise.resolve({ html: '<html>documento</html>', avisos: [] }),
  gerarCodigoDoPedaco: () => Promise.resolve({ html: '<td>pedaco gerado</td>', avisos: [] }),
}));

let designAtual: EmailDesign;

function Harness() {
  const [design, setDesign] = useState<EmailDesign>(() => createDefaultDesign());
  designAtual = design;
  return <EditorDesign value={design} onChange={setDesign} />;
}

beforeEach(() => {
  // Este jsdom não expõe localStorage (origem opaca). O criador já tolera —
  // módulos viram estado em memória — e o teste tolera junto.
  try {
    window.localStorage.clear();
  } catch {
    // sem storage: nada a limpar
  }
});

describe('criador de e-mails — paleta e canvas', () => {
  it('mostra o design padrão com o rodapé de descadastro', () => {
    render(<Harness />);

    expect(screen.getByText(/Olá \{\{contato.primeiroNome\}\},/)).toBeInTheDocument();
    expect(screen.getByText(/descadastre-se aqui/i)).toBeInTheDocument();
  });

  it('clicar numa estrutura da paleta acrescenta uma linha', async () => {
    render(<Harness />);
    const antes = designAtual.rows.length;

    await userEvent.click(screen.getByRole('button', { name: /2 colunas/i }));

    expect(designAtual.rows.length).toBe(antes + 1);
  });

  it('selecionar um bloco abre o inspetor dele no painel lateral', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText('Título do e-mail'));

    expect(screen.getByRole('button', { name: /bloco: texto/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/tamanho da fonte \(bloco todo\)/i)).toBeInTheDocument();
  });

  it('o inspetor do botão edita texto e link', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText('Leia a análise completa'));
    const campo = screen.getByLabelText(/texto do botão/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Fale conosco');

    expect(screen.getByText('Fale conosco')).toBeInTheDocument();
  });

  it('desfazer volta o passo — e o botão fica desabilitado sem histórico', async () => {
    render(<Harness />);
    const desfazer = screen.getByRole('button', { name: /desfazer/i });
    expect(desfazer).toBeDisabled();

    const antes = designAtual.rows.length;
    await userEvent.click(screen.getByRole('button', { name: /1 coluna/i }));
    expect(designAtual.rows.length).toBe(antes + 1);

    await userEvent.click(desfazer);
    expect(designAtual.rows.length).toBe(antes);
  });

  it('remover um bloco pela barra de ferramentas dele', async () => {
    render(<Harness />);
    const blocos = () => designAtual.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
    const antes = blocos().length;

    await userEvent.click(screen.getByText('Título do e-mail'));
    await userEvent.click(screen.getByRole('button', { name: /^remover$/i }));

    expect(blocos().length).toBe(antes - 1);
    expect(screen.queryByText('Título do e-mail')).toBeNull();
  });
});

describe('configurações globais', () => {
  it('a largura do conteúdo é editável e escreve no design', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('tab', { name: /configurações globais/i }));
    const campo = screen.getByLabelText(/largura do conteúdo/i);
    expect(campo).toHaveValue(600);

    await userEvent.clear(campo);
    await userEvent.type(campo, '720');

    expect(designAtual.settings.contentWidth).toBe(720);
  });
});

describe('código à mão — os três níveis', () => {
  it('sem seleção, o botão fala do e-mail inteiro', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /código do e-mail/i })).toBeInTheDocument();
  });

  it('com bloco selecionado, abre o código DAQUELE bloco', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText('Título do e-mail'));
    await userEvent.click(screen.getByRole('button', { name: /código do bloco/i }));

    // O código gerado abre no editor (mock devolve "pedaco gerado"), depois
    // do estado de "compilando" — a geração é assíncrona.
    expect(await screen.findByLabelText(/código do bloco: texto/i)).toHaveValue(
      '<td>pedaco gerado</td>',
    );
    // Bloco de texto ABSORVE em vez de virar override — a descrição avisa.
    expect(screen.getByText(/o bloco absorve o código/i)).toBeInTheDocument();
  });

  it('aplicar código num bloco de texto absorve — sem override, controles valendo', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText('Título do e-mail'));
    await userEvent.click(screen.getByRole('button', { name: /código do bloco/i }));

    const editor = await screen.findByLabelText(/código do bloco: texto/i);
    await userEvent.clear(editor);
    await userEvent.type(editor, '<td><div>Novo título</div></td>');
    await userEvent.click(screen.getByRole('button', { name: /aplicar código/i }));

    const blocos = designAtual.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
    const texto = blocos.find((b) => b.type === 'text' && b.html.includes('Novo título'));
    expect(texto).toBeDefined();
    expect(texto?.customHtml).toBeUndefined();
  });

  it('aplicar código no documento vira override, com aviso e caminho de volta', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: /código do e-mail/i }));
    await screen.findByLabelText(/código do e-mail/i);
    await userEvent.click(screen.getByRole('button', { name: /aplicar código/i }));

    expect(designAtual.customHtml).toBe('<html>documento</html>');
    expect(screen.getByText(/o criador visual continua guardando/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /voltar ao visual/i }));
    expect(designAtual.customHtml).toBeUndefined();
  });
});

describe('módulos — linha reutilizável no navegador', () => {
  it('salva a linha selecionada como módulo e insere de volta', async () => {
    render(<Harness />);
    const antes = designAtual.rows.length;

    // Seleciona a linha do título clicando no fundo dela (fora do bloco).
    await userEvent.click(screen.getByText('Título do e-mail'));
    // Sobe para a linha: o botão "Salvar como módulo" vive na barra da LINHA.
    const linha = designAtual.rows[1];
    expect(linha).toBeDefined();
    // Clica na área da linha (o elemento com a classe de grupo) — via bloco e
    // depois no pai não dá; seleciona pela ação de limpar e clicar de novo.
    // A barra da linha aparece quando só a linha está selecionada.
    await userEvent.click(screen.getByRole('button', { name: /bloco: texto/i }));
    // Sem seleção agora; clica na linha diretamente (padding dela).
    const blocoTitulo = screen.getByText('Título do e-mail');
    const rowEl = blocoTitulo.closest('[data-row-root]');
    expect(rowEl).not.toBeNull();
    await userEvent.click(rowEl as HTMLElement);

    await userEvent.click(screen.getByRole('button', { name: /salvar como módulo/i }));
    await userEvent.type(screen.getByLabelText(/nome do módulo/i), 'Meu cabeçalho');
    await userEvent.click(screen.getByRole('button', { name: /salvar módulo/i }));

    // A paleta de módulos vive na visão SEM seleção — igual à referência: com
    // uma linha selecionada o painel mostra o inspetor dela, não a vitrine.
    await userEvent.click(screen.getByRole('button', { name: /linha selecionada/i }));

    // Aparece na paleta e insere uma cópia com ids novos.
    await userEvent.click(screen.getByRole('button', { name: /inserir meu cabeçalho/i }));
    expect(designAtual.rows.length).toBe(antes + 1);
  });
});
