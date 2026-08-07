import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Relatorio } from '../src/paginas/Relatorio.tsx';

let relatorio: Record<string, unknown>;

vi.mock('../src/lib/api.js', () => ({
  api: { get: async () => relatorio },
  FalhaApi: class extends Error {},
}));

function base(over: Record<string, unknown> = {}) {
  return {
    campaignId: 'k-1',
    nome: 'Boletim',
    status: 'CONCLUIDA',
    contadores: { enviados: 1000, entregues: 950, aberturasUnicas: 380, cliquesUnicos: 40 },
    taxas: {
      entrega: 0.95,
      abertura: 0.4,
      clique: 0.042,
      bounceHard: 0.05,
      reclamacao: 0.0005,
      descadastro: 0.002,
    },
    risco: { nivel: 'ATENCAO', bounce: 'ATENCAO', reclamacao: 'OK', avisos: [] },
    baseDeCalculo: { abertura: 'aberturas únicas / entregues' },
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/k-1']}>
        <Routes>
          <Route path="/relatorios/:id" element={<Relatorio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  relatorio = base();
});

describe('relatório', () => {
  it('usa o nível de risco da API, não recalcula', async () => {
    // Recalcular criaria duas réguas: a tela diria "tudo bem" enquanto o alarme
    // do CloudWatch dispara para a agência (§10.4).
    relatorio = base({
      risco: {
        nivel: 'CRITICO',
        bounce: 'CRITICO',
        reclamacao: 'OK',
        avisos: ['Taxa de bounce em nível crítico. Pare as campanhas.'],
      },
    });
    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent(/pare as campanhas/i);
  });

  it('mostra percentual com casas decimais', async () => {
    // A taxa crítica de reclamação é 0,3%; arredondar para inteiro mostraria
    // "0%" numa campanha prestes a derrubar a conta.
    montar();
    expect(await screen.findByText('0,05%')).toBeInTheDocument();
    expect(screen.getByText('5,0%')).toBeInTheDocument();
  });

  it('exibe a base de cálculo de cada taxa', async () => {
    // "Abertura 42%" não diz se é sobre enviados ou entregues.
    montar();
    expect(await screen.findByText('aberturas únicas / entregues')).toBeInTheDocument();
  });

  it('sem avisos, não mostra alerta', async () => {
    montar();
    await screen.findByText('Relatório');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
