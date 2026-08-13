import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TemplateEditor, Templates } from '../src/paginas/Templates.tsx';

vi.mock('../src/lib/api.js', () => ({
  api: { get: async () => ({ itens: [], variaveisDisponiveis: [] }) },
  FalhaApi: class extends Error {},
}));

// O mjml-browser não roda no jsdom; a compilação real é coberta pelos testes
// puros de `criador-boletim`. Aqui o que se protege é a FIAÇÃO: o parâmetro da
// URL virar o design montado dentro do criador.
vi.mock('../src/lib/criador/html.js', () => ({
  compilarParaHtml: () => Promise.resolve({ html: '<html>ok</html>', avisos: [] }),
  gerarCodigoDoDocumento: () => Promise.resolve({ html: '', avisos: [] }),
  gerarCodigoDoPedaco: () => Promise.resolve({ html: '', avisos: [] }),
}));

function montar(rota: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/:id" element={<TemplateEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('novo boletim — o atalho que abre o criador montado', () => {
  it('a listagem oferece o atalho ao lado do modelo em branco', async () => {
    montar('/templates');

    expect(await screen.findByRole('link', { name: /novo boletim/i })).toHaveAttribute(
      'href',
      '/templates/novo?inicio=boletim',
    );
    expect(screen.getByRole('link', { name: /novo modelo/i })).toBeInTheDocument();
  });

  it('?inicio=boletim abre o criador visual com a edição de exemplo no canvas', async () => {
    montar('/templates/novo?inicio=boletim');

    // O criador carrega com lazy(); as notícias de exemplo aparecem no canvas.
    expect(
      await screen.findByText(/NF-e sem IBS e CBS/i, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PRAZOS DE AGOSTO/i)).toBeInTheDocument();

    // Nome e assunto chegam preenchidos — editáveis, não vazios.
    expect(screen.getByLabelText(/nome do modelo/i)).toHaveValue('Boletim Tributário');
    expect(screen.getByLabelText(/assunto do e-mail/i)).toHaveValue(
      'Boletim Tributário — os destaques da semana',
    );
  });

  it('sem o parâmetro, o modelo novo continua nascendo em branco', async () => {
    montar('/templates/novo');

    // O fluxo padrão é o formulário de código — nada do boletim.
    expect(await screen.findByText(/nome interno/i)).toBeInTheDocument();
    expect(screen.queryByText(/NF-e sem IBS e CBS/i)).toBeNull();
  });
});
