import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Contatos } from '../src/paginas/Contatos.tsx';
import type { Usuario } from '../src/lib/auth.js';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      return { itens: [] };
    },
    post: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      return { contactId: 'c-novo', ...(corpo as object) };
    },
  },
  FalhaApi: class extends Error {},
}));

const OPERADOR: Usuario = {
  email: 'op@escritorio.com.br',
  papeis: ['OPERADOR'],
} as unknown as Usuario;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Contatos usuario={OPERADOR} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chamadas.length = 0;
});

describe('novo contato', () => {
  it('cadastra e confirma nomeando o e-mail — o formulário limpo não é o único sinal', async () => {
    montar();

    await userEvent.type(screen.getByLabelText(/^e-mail/i), 'maria@exemplo.com');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Contato maria@exemplo.com cadastrado.')).toBeInTheDocument();
    // E o formulário limpou para o próximo cadastro.
    expect(screen.getByLabelText(/^e-mail/i)).toHaveValue('');
  });

  it('sem e-mail o botão não envia — é o único campo sem o qual nada faz sentido', async () => {
    montar();
    expect(screen.getByRole('button', { name: /cadastrar/i })).toBeDisabled();
  });
});
