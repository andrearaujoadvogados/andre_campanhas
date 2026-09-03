import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EditorDesign } from '../src/componentes/criador/EditorDesign.tsx';
import { EditorEmail } from '../src/componentes/EditorEmail.tsx';
import { createDefaultDesign } from '@emailmkt/criador';
import type { EmailDesign } from '@emailmkt/criador';

vi.mock('../src/lib/criador/html.js', () => ({
  compilarParaHtml: () => Promise.resolve({ html: '<html>compilado</html>', avisos: [] }),
  gerarCodigoDoDocumento: () => Promise.resolve({ html: '<html>documento</html>', avisos: [] }),
  gerarCodigoDoPedaco: () => Promise.resolve({ html: '<td>pedaco gerado</td>', avisos: [] }),
}));

const HTML_LEGADO =
  '<!doctype html><html><head><style>.x{color:red}</style></head><body><table><tr><td class="x">Boletim antigo do GrapesJS</td></tr></table></body></html>';

let designAtual: EmailDesign;

function Harness() {
  // Modelo do editor antigo: design vazio, o e-mail inteiro no override.
  const [design, setDesign] = useState<EmailDesign>(() => ({
    ...createDefaultDesign(),
    rows: [],
    customHtml: HTML_LEGADO,
  }));
  designAtual = design;
  return <EditorDesign value={design} onChange={setDesign} />;
}

describe('e-mail inteiro com HTML próprio — edita-se no canvas, não só no código', () => {
  it('mostra o documento no canvas, editável, em vez de "e-mail vazio"', async () => {
    render(<Harness />);

    const quadro = screen.getByTitle('E-mail com HTML próprio') as HTMLIFrameElement;
    expect(quadro).toBeInTheDocument();
    expect(screen.queryByText(/e-mail vazio/i)).toBeNull();

    const doc = quadro.contentDocument;
    expect(doc).not.toBeNull();
    await waitFor(() => expect(doc?.body.textContent).toContain('Boletim antigo do GrapesJS'));
    // O documento inteiro é editável — o WYSIWYG do modelo antigo.
    expect(doc?.designMode).toBe('on');
    // O <style> do e-mail ficou dentro do iframe, não vazou para o painel.
    expect(document.querySelector('style')?.textContent ?? '').not.toContain('.x{color:red}');
  });

  it('o que se edita no documento volta para o HTML próprio ao sair do quadro', async () => {
    render(<Harness />);

    const quadro = screen.getByTitle('E-mail com HTML próprio') as HTMLIFrameElement;
    const doc = quadro.contentDocument as Document;
    await waitFor(() => expect(doc.body.textContent).toContain('Boletim antigo'));

    const celula = doc.querySelector('td') as HTMLTableCellElement;
    celula.textContent = 'Boletim revisado no canvas';
    quadro.contentWindow?.dispatchEvent(new Event('blur'));

    await waitFor(() => expect(designAtual.customHtml).toContain('Boletim revisado no canvas'));
    // Doctype e estrutura preservados: o e-mail continua um documento inteiro.
    expect(designAtual.customHtml?.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(designAtual.customHtml).toContain('.x{color:red}');
  });
});

describe('editor de texto com um HTML completo', () => {
  it('abre no código, avisa, e oferece o criador visual', async () => {
    const aoPedirVisual = vi.fn();
    render(
      <EditorEmail
        valor={'<html><body><table><tr><td>Layout em tabela</td></tr></table></body></html>'}
        aoMudar={() => undefined}
        aoPedirVisual={aoPedirVisual}
      />,
    );

    // Já chega no código: o <textarea> está na tela e o botão oferece voltar.
    expect(await screen.findByRole('textbox')).toHaveDisplayValue(/<table>/);
    expect(screen.getByRole('button', { name: /voltar ao editor/i })).toBeInTheDocument();
    expect(screen.getByText(/HTML completo/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /editar no criador visual/i }));
    expect(aoPedirVisual).toHaveBeenCalledTimes(1);
  });

  it('um corpo simples continua abrindo no editor de texto', async () => {
    render(<EditorEmail valor="<p>Olá</p>" aoMudar={() => undefined} />);

    expect(await screen.findByRole('button', { name: /editar html/i })).toBeInTheDocument();
    expect(screen.queryByText(/HTML completo/i)).toBeNull();
  });
});
