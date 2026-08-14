import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Templates } from '../src/paginas/Templates.tsx';

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      if (caminho === '/templates') {
        return {
          itens: [
            {
              templateId: 't-1',
              nome: 'Boletim Tributário',
              tipo: 'VISUAL',
              categoria: 'Boletim',
              versaoAtual: 1,
              arquivado: false,
              criadoPor: 'sub-ana',
              criadoEm: '2026-08-13T13:18:00Z',
              atualizadoEm: '2026-08-13T13:18:00Z',
            },
            {
              templateId: 't-2',
              nome: 'Primeiro Teste',
              tipo: 'CODIGO',
              categoria: null,
              versaoAtual: 1,
              arquivado: false,
              criadoPor: 'sub-beto',
              criadoEm: '2026-08-09T15:03:00Z',
              atualizadoEm: '2026-08-09T15:03:00Z',
            },
          ],
          criadores: { 'sub-ana': 'ana@escritorio.adv.br', 'sub-beto': 'beto@escritorio.adv.br' },
          variaveisDisponiveis: [],
        };
      }
      // A tela também consulta a geração do boletim; sem execuções, sem faixa.
      if (caminho === '/boletim/execucoes') return { itens: [] };
      // Prévia dos cards — o conteúdo em si não interessa a estes testes.
      return { conteudo: { assunto: 'x', corpoHtml: '<p>x</p>' } };
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/templates']}>
        <Routes>
          <Route path="/templates" element={<Templates />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Este jsdom não expõe localStorage (origem opaca); a tela tolera, o teste também.
  try {
    window.localStorage.clear();
  } catch {
    // sem storage: nada a limpar
  }
});

describe('modelos — grade ou lista', () => {
  it('a grade é o padrão; a lista traz as colunas de gestão e a escolha persiste', async () => {
    montar();
    expect(await screen.findByText('Boletim Tributário')).toBeInTheDocument();
    // Grade: um card por modelo, cada um com o rótulo "selecionar".
    expect(screen.getAllByText('selecionar')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Lista' }));

    expect(screen.getByRole('columnheader', { name: 'Criado por' })).toBeInTheDocument();
    // Dentro da tabela: o mesmo e-mail também é opção do filtro "Criado por".
    expect(within(screen.getByRole('table')).getByText('ana@escritorio.adv.br')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('modelos — filtros', () => {
  it('o filtro por tipo recorta a lista', async () => {
    montar();
    await screen.findByText('Boletim Tributário');

    await userEvent.click(screen.getByRole('button', { name: 'Código' }));

    expect(screen.queryByText('Boletim Tributário')).toBeNull();
    expect(screen.getByText('Primeiro Teste')).toBeInTheDocument();
  });

  it('o filtro por criador usa o e-mail resolvido, não o sub', async () => {
    montar();
    await screen.findByText('Boletim Tributário');

    const select = screen.getByLabelText('Criado por:');
    expect(within(select).getByRole('option', { name: 'beto@escritorio.adv.br' })).toBeVisible();

    await userEvent.selectOptions(select, 'sub-beto');

    expect(screen.queryByText('Boletim Tributário')).toBeNull();
    expect(screen.getByText('Primeiro Teste')).toBeInTheDocument();
  });

  it('o filtro por categoria só oferece o que existe de fato', async () => {
    montar();
    await screen.findByText('Boletim Tributário');

    const select = screen.getByLabelText('Categoria:');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Todas', 'Boletim']);

    await userEvent.selectOptions(select, 'Boletim');
    expect(screen.queryByText('Primeiro Teste')).toBeNull();
  });

  it('a data de criação filtra, o vazio explica, e limpar restaura tudo', async () => {
    montar();
    await screen.findByText('Boletim Tributário');

    fireEvent.change(screen.getByLabelText('Criado de:'), { target: { value: '2026-08-12' } });
    expect(screen.queryByText('Primeiro Teste')).toBeNull();
    expect(screen.getByText('Boletim Tributário')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('até:'), { target: { value: '2026-08-12' } });
    expect(await screen.findByText(/nenhum modelo para este filtro/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('Primeiro Teste')).toBeInTheDocument();
    expect(screen.getByText('Boletim Tributário')).toBeInTheDocument();
  });
});
