import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Campanhas } from '../src/paginas/Campanhas.tsx';

const caminhos: string[] = [];
let resposta: Record<string, unknown>;

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      caminhos.push(caminho);
      return resposta;
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Campanhas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  caminhos.length = 0;
  resposta = {
    itens: [
      {
        campaignId: 'k-1',
        nome: 'Boletim de agosto',
        status: 'CONCLUIDA',
        criadoEm: '2026-08-01T12:00:00Z',
      },
    ],
    truncado: false,
  };
});

describe('listagem de campanhas', () => {
  it('lista sem filtro por padrão', async () => {
    montar();
    expect(await screen.findByText('Boletim de agosto')).toBeInTheDocument();
    expect(caminhos).toEqual(['/campanhas']);
  });

  it('filtrar por situação passa o status para a API', async () => {
    // Com filtro, a consulta cai numa partição só do GSI3 e pagina de verdade.
    montar();
    await screen.findByText('Boletim de agosto');

    await userEvent.click(screen.getByRole('button', { name: 'Enviando' }));

    expect(caminhos).toContain('/campanhas?status=ENVIANDO');
  });

  it('mostra o aviso de truncamento em vez de esconder campanhas', async () => {
    // Exibir 50 sem dizer que há mais faria o operador concluir que a lista
    // acabou — a omissão silenciosa que o backend foi escrito para evitar.
    resposta = {
      ...resposta,
      truncado: true,
      aviso: 'Há mais campanhas do que cabe nesta visão. Filtre por situação.',
    };
    montar();

    // Pelo texto, e não por `role=status`: o indicador de carregamento também
    // é anunciado, e buscar só pelo papel encontraria o primeiro dos dois.
    const aviso = await screen.findByText(/há mais campanhas/i);
    expect(aviso.closest('[role="status"]')).not.toBeNull();
  });

  it('sem truncamento, não mostra aviso', async () => {
    montar();
    await screen.findByText('Boletim de agosto');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('mensagem vazia distingue "nenhuma campanha" de "nenhuma nesta situação"', async () => {
    resposta = { itens: [], truncado: false };
    montar();

    expect(await screen.findByText(/nenhuma campanha criada ainda/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pausada' }));
    expect(await screen.findByText(/nenhuma campanha nesta situação/i)).toBeInTheDocument();
  });

  it('mostra a data de agendamento quando existe, em vez da criação', async () => {
    resposta = {
      itens: [
        {
          campaignId: 'k-2',
          nome: 'Agendada',
          status: 'AGENDADA',
          criadoEm: '2026-08-01T12:00:00Z',
          agendadaPara: '2026-09-15T12:00:00Z',
        },
      ],
      truncado: false,
    };
    montar();

    expect(await screen.findByText(/agendada para 15\/09\/2026/i)).toBeInTheDocument();
  });
});
