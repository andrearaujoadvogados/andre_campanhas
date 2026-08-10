import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AssistenteBoletim } from '../src/componentes/AssistenteBoletim.tsx';

const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) =>
      caminho.startsWith('/templates')
        ? { itens: [{ templateId: 't-1', nome: 'Boletim tributário', categoria: 'Novidade' }] }
        : { itens: [{ listId: 'l-1', nome: 'Clientes', totalContatos: 42 }] },
    post: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { campaignId: 'k-9' };
    },
    patch: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { campaignId: 'k-9' };
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssistenteBoletim aoCancelar={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posts.length = 0;
});

describe('assistente de boletim — wizard de 4 etapas', () => {
  it('não avança do passo 1 sem nome', async () => {
    montar();
    // "Avançar" começa desabilitado: falta o nome.
    expect(screen.getByRole('button', { name: /avançar/i })).toBeDisabled();
  });

  it('percorre configurar → e-mail → destinatários e habilita salvar rascunho', async () => {
    montar();

    // Passo 1 tem Nome e Assunto; mira o campo Nome pelo nome acessível.
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome do boletim/i }),
      'Boletim de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Passo 2: escolher modelo.
    const modelo = await screen.findByRole('radio');
    await userEvent.click(modelo);
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Passo 3: escolher lista (obrigatória).
    const lista = await screen.findByRole('combobox');
    await userEvent.selectOptions(lista, 'l-1');

    // Com nome + modelo + lista, o rascunho pode ser salvo.
    const salvar = screen.getByRole('button', { name: /salvar rascunho/i });
    expect(salvar).toBeEnabled();
    await userEvent.click(salvar);

    await waitFor(() => {
      expect(posts).toContainEqual({
        caminho: '/boletins',
        corpo: expect.objectContaining({
          nome: 'Boletim de agosto',
          templateId: 't-1',
          listId: 'l-1',
        }),
      });
    });
  });
});
