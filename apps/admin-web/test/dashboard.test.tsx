import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../src/paginas/Dashboard.tsx';

const chamadas: string[] = [];
let campanhas: Record<string, unknown>[] = [];
let listas: Record<string, unknown>[] = [];
let resumo: Record<string, unknown> = {};

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push(caminho);
      if (caminho.startsWith('/campanhas')) return { itens: campanhas, truncado: false };
      if (caminho.startsWith('/listas')) return { itens: listas };
      return resumo;
    },
  },
  FalhaApi: class extends Error {},
}));

function campanha(over: Record<string, unknown> = {}) {
  return {
    campaignId: 'k-1',
    nome: 'Campanha de agosto',
    status: 'RASCUNHO',
    criadoEm: '2026-08-10T12:00:00Z',
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chamadas.length = 0;
  campanhas = [];
  listas = [{ listId: 'l-1', nome: 'Clientes', totalContatosAproximado: 42 }];
  resumo = {
    campanhasAgregadas: 1,
    contadores: { enviados: 100, entregues: 98 },
    taxas: { entrega: 0.98, abertura: 0.42, clique: 0.12, bounceHard: 0.01 },
    risco: { nivel: 'OK', bounce: 'OK', reclamacao: 'OK', avisos: [] },
  };
});

describe('contagens por estado', () => {
  it('conta rascunhos, agendados e enviando', async () => {
    campanhas = [
      campanha({ campaignId: 'k-1', status: 'RASCUNHO' }),
      campanha({ campaignId: 'k-2', status: 'RASCUNHO' }),
      campanha({ campaignId: 'k-3', status: 'AGENDADA', agendadaPara: '2026-09-01T09:00:00Z' }),
      campanha({ campaignId: 'k-4', status: 'ENVIANDO', processados: 3, totalDestinatarios: 5 }),
    ];
    montar();

    expect(await screen.findByText('Rascunhos')).toBeInTheDocument();
    const rascunhos = screen.getByText('Rascunhos').parentElement as HTMLElement;
    expect(rascunhos).toHaveTextContent('2');
  });

  it('soma os contatos das listas e diz que é aproximado', async () => {
    listas = [
      { listId: 'l-1', nome: 'Clientes', totalContatosAproximado: 42 },
      { listId: 'l-2', nome: 'Ex-clientes', totalContatosAproximado: 8 },
    ];
    montar();

    expect(await screen.findByText('50')).toBeInTheDocument();
    expect(screen.getByText(/soma aproximada das listas/i)).toBeInTheDocument();
  });
});

describe('o bloco de atenção só aparece quando há motivo', () => {
  it('fica fora da tela quando está tudo em ordem', async () => {
    campanhas = [campanha({ status: 'RASCUNHO' })];
    montar();

    await screen.findByText('Rascunhos');
    expect(screen.queryByText(/precisa da sua atenção/i)).toBeNull();
  });

  it('avisa quando nenhuma lista tem contatos', async () => {
    // Sem contatos não há para quem enviar — é a trava real antes da primeira
    // campanha, e não adianta descobrir isso na Etapa 3 do assistente.
    listas = [{ listId: 'l-1', nome: 'Clientes', totalContatosAproximado: 0 }];
    montar();

    expect(await screen.findByText(/nenhuma lista tem contatos/i)).toBeInTheDocument();
  });

  it('denuncia disparo travado — enviando sem ninguém processado', async () => {
    campanhas = [
      campanha({
        status: 'ENVIANDO',
        nome: 'Campanha travada',
        processados: 0,
        totalDestinatarios: 2,
      }),
    ];
    montar();

    expect(await screen.findByText(/está enviando e ainda não processou ninguém/i)).toBeVisible();
  });

  it('não denuncia quando o envio está andando', async () => {
    campanhas = [campanha({ status: 'ENVIANDO', processados: 2, totalDestinatarios: 5 })];
    montar();

    await screen.findByText('Rascunhos');
    expect(screen.queryByText(/pode estar travado/i)).toBeNull();
  });

  it('mostra o aviso de risco que vem do domínio', async () => {
    campanhas = [campanha({ status: 'CONCLUIDA' })];
    resumo = {
      ...resumo,
      risco: {
        nivel: 'CRITICO',
        bounce: 'CRITICO',
        reclamacao: 'OK',
        avisos: ['Bounce permanente em 12,0% — acima do limiar crítico.'],
      },
    };
    montar();

    expect(await screen.findByText(/acima do limiar crítico/i)).toBeInTheDocument();
  });
});

describe('desempenho agregado', () => {
  it('não pede o resumo quando nada foi disparado', async () => {
    // A rota exige ids e devolveria 400 com a lista vazia. Além disso, quatro
    // zeros pareceriam fracasso onde houve apenas nenhum envio.
    campanhas = [
      campanha({ status: 'RASCUNHO' }),
      campanha({ campaignId: 'k-2', status: 'AGENDADA' }),
    ];
    montar();

    await screen.findByText('Rascunhos');
    expect(chamadas.some((c) => c.startsWith('/relatorios/resumo'))).toBe(false);
    expect(screen.queryByText(/^Entrega$/)).toBeNull();
  });

  it('agrega só as campanhas que já produziram métrica', async () => {
    campanhas = [
      campanha({ campaignId: 'k-1', status: 'RASCUNHO' }),
      campanha({ campaignId: 'k-2', status: 'CONCLUIDA' }),
      campanha({ campaignId: 'k-3', status: 'ENVIANDO' }),
    ];
    montar();

    await screen.findByText('Entrega');
    const pedido = chamadas.find((c) => c.startsWith('/relatorios/resumo'));
    expect(pedido).toContain('k-2');
    expect(pedido).toContain('k-3');
    expect(pedido).not.toContain('k-1');
  });

  it('mostra as taxas com a base de cálculo ao lado', async () => {
    campanhas = [campanha({ status: 'CONCLUIDA' })];
    montar();

    // Uma casa decimal e vírgula: o formatador é pt-BR de propósito, porque
    // arredondar para inteiro mostraria "0%" numa reclamação de 0,3% — que é a
    // taxa que derruba a conta.
    expect(await screen.findByText('98,0%')).toBeInTheDocument();
    expect(screen.getByText('98 de 100')).toBeInTheDocument();
  });

  it('marca o bounce quando passa do limiar', async () => {
    campanhas = [campanha({ status: 'CONCLUIDA' })];
    resumo = {
      ...resumo,
      taxas: { entrega: 0.8, abertura: 0.1, clique: 0.01, bounceHard: 0.12 },
      risco: { nivel: 'CRITICO', bounce: 'CRITICO', reclamacao: 'OK', avisos: [] },
    };
    montar();

    expect(await screen.findByText(/acima do limiar/i)).toBeInTheDocument();
  });
});

describe('campanhas recentes', () => {
  it('lista os mais novos primeiro, com link para o detalhe', async () => {
    campanhas = [
      campanha({ campaignId: 'k-antigo', nome: 'Antigo', criadoEm: '2026-08-01T12:00:00Z' }),
      campanha({ campaignId: 'k-novo', nome: 'Novo', criadoEm: '2026-08-10T12:00:00Z' }),
    ];
    montar();

    const links = await screen.findAllByRole('link');
    const nomes = links.map((l) => l.textContent);
    expect(nomes.indexOf('Novo')).toBeLessThan(nomes.indexOf('Antigo'));
    expect(screen.getByRole('link', { name: 'Novo' })).toHaveAttribute('href', '/campanhas/k-novo');
  });

  it('diz quando não há nenhum', async () => {
    campanhas = [];
    montar();
    expect(await screen.findByText(/nenhuma campanha criada ainda/i)).toBeInTheDocument();
  });
});
