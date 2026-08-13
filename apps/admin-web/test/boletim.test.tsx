import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Boletim } from '../src/paginas/Boletim.tsx';

interface Chamada {
  metodo: string;
  caminho: string;
  corpo?: unknown;
}

let fontes: Record<string, unknown>[];
const chamadas: Chamada[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      return { itens: fontes };
    },
    post: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      if (caminho === '/boletim/gerar') {
        return { iniciado: true, message: 'Geração iniciada. O boletim aparece em Modelos.' };
      }
      return { fonteId: 'f-novo', ...(corpo as object) };
    },
    patch: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'PATCH', caminho, corpo });
      return corpo;
    },
    delete: async (caminho: string) => {
      chamadas.push({ metodo: 'DELETE', caminho });
      return {};
    },
  },
  FalhaApi: class extends Error {},
}));

function fonteMigalhas(): Record<string, unknown> {
  return {
    fonteId: 'f-1',
    nome: 'Migalhas',
    url: 'https://www.migalhas.com.br/quentes',
    instrucao: 'Decisões do STJ sobre tributário.',
    ativa: true,
    atualizadoEm: '2026-08-13T10:00:00Z',
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Boletim />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fontes = [];
  chamadas.length = 0;
});

describe('boletim automático — fontes', () => {
  it('cadastra uma fonte com nome, endereço e a instrução do que coletar', async () => {
    montar();

    await userEvent.type(screen.getByLabelText(/nome/i), 'Migalhas');
    await userEvent.type(screen.getByLabelText(/endereço/i), 'https://www.migalhas.com.br');
    await userEvent.type(
      screen.getByLabelText(/o que coletar/i),
      'Decisões do STJ sobre direito tributário.',
    );
    await userEvent.click(screen.getByRole('button', { name: /adicionar fonte/i }));

    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post?.caminho).toBe('/boletim/fontes');
    expect(post?.corpo).toMatchObject({
      nome: 'Migalhas',
      instrucao: 'Decisões do STJ sobre direito tributário.',
      ativa: true,
    });
  });

  it('lista as fontes com o estado de coleta e a instrução visível', async () => {
    fontes = [
      fonteMigalhas(),
      { ...fonteMigalhas(), fonteId: 'f-2', nome: 'Conjur', ativa: false },
    ];
    montar();

    expect(await screen.findByText('Migalhas')).toBeInTheDocument();
    expect(screen.getByText('na coleta')).toBeInTheDocument();
    expect(screen.getByText('pausada')).toBeInTheDocument();
    expect(screen.getAllByText(/decisões do stj/i).length).toBeGreaterThan(0);
  });

  it('pausar manda a fonte inteira com ativa invertida', async () => {
    fontes = [fonteMigalhas()];
    montar();

    await screen.findByText('Migalhas');
    await userEvent.click(screen.getByRole('button', { name: /pausar/i }));

    const patch = chamadas.find((c) => c.metodo === 'PATCH');
    expect(patch?.caminho).toBe('/boletim/fontes/f-1');
    expect(patch?.corpo).toMatchObject({ ativa: false, nome: 'Migalhas' });
  });

  it('sem fonte ativa, o botão de gerar fica desabilitado', async () => {
    fontes = [{ ...fonteMigalhas(), ativa: false }];
    montar();

    await screen.findByText('Migalhas');
    expect(screen.getByRole('button', { name: /gerar boletim agora/i })).toBeDisabled();
  });

  it('gerar dispara e repete ao usuário ONDE o resultado aparece', async () => {
    fontes = [fonteMigalhas()];
    montar();

    await screen.findByText('Migalhas');
    await userEvent.click(screen.getByRole('button', { name: /gerar boletim agora/i }));

    // A geração é assíncrona: sem esta mensagem, o operador clica e fica
    // olhando a tela esperando algo mudar nela.
    expect(await screen.findByText(/aparece em modelos/i)).toBeInTheDocument();
  });

  it('a página explica o fluxo e que nada é enviado sem revisão', () => {
    montar();

    expect(screen.getByText(/nada é enviado sem passar pelo assistente/i)).toBeInTheDocument();
  });
});
