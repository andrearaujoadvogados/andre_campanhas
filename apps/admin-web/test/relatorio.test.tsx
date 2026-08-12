import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Relatorio } from '../src/paginas/Relatorio.tsx';

let relatorio: Record<string, unknown>;
/** Páginas de `/respostas`, na ordem em que a tela as pedir. */
let paginasDeResposta: { itens: unknown[]; cursor?: string }[];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (url: string) => {
      if (url.includes('/respostas')) return paginasDeResposta.shift() ?? { itens: [] };
      if (url.includes('/destinatarios')) return { itens: [] };
      return relatorio;
    },
  },
  FalhaApi: class extends Error {},
}));

function base(over: Record<string, unknown> = {}) {
  return {
    campaignId: 'k-1',
    nome: 'Campanha',
    status: 'CONCLUIDA',
    contadores: {
      enviados: 1000,
      entregues: 950,
      aberturasUnicas: 380,
      cliquesUnicos: 40,
      respostas: 19,
    },
    taxas: {
      entrega: 0.95,
      abertura: 0.4,
      clique: 0.042,
      bounceHard: 0.05,
      reclamacao: 0.0005,
      descadastro: 0.002,
      resposta: 0.02,
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
  paginasDeResposta = [{ itens: [] }];
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

describe('quem respondeu', () => {
  it('mostra quantos e-mails foram respondidos, com a taxa sobre entregues', async () => {
    montar();

    expect(await screen.findByText('Respondidos')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('2,0%')).toBeInTheDocument();
  });

  it('lista os contatos que responderam, com a data', async () => {
    paginasDeResposta = [
      {
        itens: [
          {
            contactId: 'c-2',
            nome: 'Maria Silva',
            email: 'maria@cliente.com.br',
            respondidoEm: '2026-08-09T14:30:00.000Z',
            enviadoEm: '2026-08-08T10:00:00.000Z',
          },
        ],
      },
    ];
    montar();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('maria@cliente.com.br')).toBeInTheDocument();
  });

  it('página vazia COM cursor não vira "ninguém respondeu" — segue buscando', async () => {
    // O filtro do DynamoDB roda depois da leitura do bloco: uma página pode
    // voltar vazia e ainda haver respostas adiante. Parar na primeira diria
    // "ninguém respondeu" numa campanha que teve respostas — o pior desfecho
    // possível para esta tela.
    paginasDeResposta = [
      { itens: [], cursor: 'p2' },
      { itens: [], cursor: 'p3' },
      {
        itens: [
          {
            contactId: 'c-9',
            nome: 'João Souza',
            email: 'joao@cliente.com.br',
            respondidoEm: '2026-08-09T14:30:00.000Z',
            enviadoEm: null,
          },
        ],
      },
    ];
    montar();

    expect(await screen.findByText('João Souza')).toBeInTheDocument();
  });

  it('sem respostas e sem cursor, diz que ninguém respondeu', async () => {
    montar();

    expect(await screen.findByText(/nenhum contato respondeu/i)).toBeInTheDocument();
  });

  it('avisa que o conteúdo da resposta não fica no sistema', async () => {
    // A tela registra que houve resposta, não o que foi dito. Sem o aviso,
    // alguém procuraria aqui uma mensagem que está na caixa do escritório.
    paginasDeResposta = [
      {
        itens: [
          {
            contactId: 'c-2',
            nome: null,
            email: 'maria@cliente.com.br',
            respondidoEm: '2026-08-09T14:30:00.000Z',
            enviadoEm: null,
          },
        ],
      },
    ];
    montar();

    expect(
      await screen.findByText(/encaminhada para a caixa de e-mail do escritório/i),
    ).toBeInTheDocument();
  });
});
