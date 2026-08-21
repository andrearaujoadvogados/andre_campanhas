import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../src/paginas/Dashboard.tsx';

const chamadas: string[] = [];
let campanhas: Record<string, unknown>[] = [];
let listas: Record<string, unknown>[] = [];
let resumo: Record<string, unknown> = {};
let resumoPorIds: Record<string, Record<string, unknown>> = {};
let serieGeral: Record<string, unknown>[] = [];
let desempenho: Record<string, unknown>[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push(caminho);
      if (caminho.startsWith('/campanhas')) return { itens: campanhas, truncado: false };
      if (caminho.startsWith('/listas')) return { itens: listas };
      if (caminho.startsWith('/relatorios/serie')) return { pontos: serieGeral };
      if (caminho.startsWith('/relatorios/desempenho')) return { itens: desempenho };
      const ids = new URLSearchParams(caminho.split('?')[1] ?? '').get('campanhas') ?? '';
      return resumoPorIds[ids] ?? resumo;
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
  resumoPorIds = {};
  campanhas = [];
  serieGeral = [];
  desempenho = [];
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

    await screen.findAllByText('Entrega');
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

describe('desempenho por campanha — a tabela do modelo de referência', () => {
  it('cada campanha vira uma linha com taxas e link para o relatório', async () => {
    campanhas = [campanha({ campaignId: 'k-2', status: 'CONCLUIDA' })];
    desempenho = [
      {
        campaignId: 'k-2',
        nome: 'Boletim de agosto',
        status: 'CONCLUIDA',
        disparadaEm: '2026-08-10T12:00:00Z',
        contadores: { enviados: 120, respostas: 4 },
        taxas: { entrega: 0.95, abertura: 0.4, clique: 0.05, bounceHard: 0.01 },
      },
    ];
    montar();

    expect(await screen.findByText(/Desempenho por campanha/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Boletim de agosto' })).toHaveAttribute(
      'href',
      '/relatorios/k-2',
    );
    expect(screen.getByText('40,0%')).toBeInTheDocument();
  });

  it('a série agregada aparece quando há campanha disparada', async () => {
    campanhas = [campanha({ campaignId: 'k-2', status: 'CONCLUIDA' })];
    serieGeral = [{ dia: '2026-08-10', aberturas: 5, cliques: 1 }];
    montar();

    expect(
      await screen.findByRole('img', { name: /aberturas e cliques por dia/i }),
    ).toBeInTheDocument();
  });

  it('sem campanha disparada, nem gráfico nem tabela — e nenhuma chamada à toa', async () => {
    campanhas = [campanha({ status: 'RASCUNHO' })];
    montar();

    await screen.findByText('Rascunhos');
    expect(screen.queryByText(/Desempenho por campanha/)).toBeNull();
    expect(chamadas.some((c) => c.startsWith('/relatorios/serie'))).toBe(false);
    expect(chamadas.some((c) => c.startsWith('/relatorios/desempenho'))).toBe(false);
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

describe('filtro de período', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const diasAtras = (n: number) => new Date(Date.now() - n * DIA).toISOString();

  it('não aparece enquanto nada foi disparado', async () => {
    // Filtrar o quê? O controle só existe quando há número para recortar.
    campanhas = [campanha({ status: 'RASCUNHO' })];
    montar();

    await screen.findByText('Rascunhos');
    expect(screen.queryByRole('group', { name: 'Período' })).toBeNull();
  });

  it('o padrão é "Tudo" — nenhuma campanha some sem alguém pedir', async () => {
    campanhas = [
      campanha({ campaignId: 'k-velho', status: 'CONCLUIDA', disparadaEm: diasAtras(300) }),
      campanha({ campaignId: 'k-novo', status: 'CONCLUIDA', disparadaEm: diasAtras(2) }),
    ];
    montar();

    await screen.findAllByText('Entrega');
    const pedido = chamadas.find((c) => c.startsWith('/relatorios/resumo'));
    expect(pedido).toContain('k-velho');
    expect(pedido).toContain('k-novo');
    expect(screen.getByRole('button', { name: 'Tudo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('escolher 7 dias agrega só quem foi disparado dentro da janela', async () => {
    campanhas = [
      campanha({ campaignId: 'k-velho', status: 'CONCLUIDA', disparadaEm: diasAtras(40) }),
      campanha({ campaignId: 'k-novo', status: 'CONCLUIDA', disparadaEm: diasAtras(2) }),
    ];
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    await screen.findByText(/nos últimos 7 dias/);
    const pedidos = chamadas.filter((c) => c.startsWith('/relatorios/resumo'));
    const ultimo = pedidos[pedidos.length - 1];
    expect(ultimo).toContain('k-novo');
    expect(ultimo).not.toContain('k-velho');
  });

  it('período sem disparo diz isso, em vez de sumir com os blocos', async () => {
    // A tela sem os blocos ficaria igual à de quem nunca disparou nada — e a
    // conclusão errada seria sobre o escritório, não sobre o filtro.
    campanhas = [campanha({ status: 'CONCLUIDA', disparadaEm: diasAtras(90) })];
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    expect(
      await screen.findByText(/nenhuma campanha foi disparada neste período/i),
    ).toBeInTheDocument();
  });

  it('compara com o período anterior em pontos percentuais', async () => {
    campanhas = [
      campanha({ campaignId: 'k-agora', status: 'CONCLUIDA', disparadaEm: diasAtras(3) }),
      campanha({ campaignId: 'k-antes', status: 'CONCLUIDA', disparadaEm: diasAtras(10) }),
    ];
    resumoPorIds = {
      'k-agora': {
        campanhasAgregadas: 1,
        contadores: { enviados: 100, entregues: 98, respostas: 7 },
        taxas: { entrega: 0.98, abertura: 0.48, clique: 0.12, bounceHard: 0.01, resposta: 0.07 },
        risco: { nivel: 'OK', bounce: 'OK', reclamacao: 'OK', avisos: [] },
      },
      'k-antes': {
        campanhasAgregadas: 1,
        contadores: { enviados: 100, entregues: 95, respostas: 4 },
        taxas: { entrega: 0.95, abertura: 0.4, clique: 0.12, bounceHard: 0.01, resposta: 0.04 },
        risco: { nivel: 'OK', bounce: 'OK', reclamacao: 'OK', avisos: [] },
      },
    };
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    // 40% → 48% é uma variação de 8 pontos percentuais. Dizer "+20%" (a
    // variação relativa) seria outro número e outra conversa.
    expect(await screen.findByText('+8,0 p.p. vs. 7 dias anteriores')).toBeInTheDocument();
    expect(screen.getByText('+3,0 p.p. vs. 7 dias anteriores')).toBeInTheDocument();
    // Respostas são poucas e contam em unidades: "+3" move alguém, "+75%" não.
    expect(screen.getByText('+3 vs. 7 dias anteriores')).toBeInTheDocument();
    // Taxa idêntica não vira "+0,0 p.p.", que se lê como mudança.
    expect(screen.getAllByText('sem mudança vs. 7 dias anteriores').length).toBeGreaterThan(0);
  });

  it('avisa quando o período anterior está vazio, em vez de comparar com zero', async () => {
    campanhas = [campanha({ campaignId: 'k-1', status: 'CONCLUIDA', disparadaEm: diasAtras(1) })];
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    expect(await screen.findByText(/não há base de comparação/i)).toBeInTheDocument();
    expect(screen.queryByText(/p\.p\. vs\./)).toBeNull();
  });

  it('o risco continua sendo o de todas as campanhas, não o do período', async () => {
    // Bounce alto é o que suspende a conta na AWS, e não deixa de existir
    // porque alguém filtrou a tela por sete dias.
    campanhas = [
      campanha({ campaignId: 'k-ruim', status: 'CONCLUIDA', disparadaEm: diasAtras(60) }),
      campanha({ campaignId: 'k-bom', status: 'CONCLUIDA', disparadaEm: diasAtras(1) }),
    ];
    resumoPorIds = {
      'k-ruim,k-bom': {
        ...resumo,
        risco: {
          nivel: 'CRITICO',
          bounce: 'CRITICO',
          reclamacao: 'OK',
          avisos: ['Bounce permanente em 12,0% — acima do limiar crítico.'],
        },
      },
    };
    montar();

    await screen.findByText(/acima do limiar crítico/i);
    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    await screen.findByText(/nos últimos 7 dias/);
    expect(screen.getByText(/acima do limiar crítico/i)).toBeInTheDocument();
  });

  it('datas escolhidas recortam pelo dia, com o dia final inteiro', async () => {
    campanhas = [
      campanha({
        campaignId: 'k-dentro',
        status: 'CONCLUIDA',
        disparadaEm: '2026-08-10T20:00:00Z',
      }),
      campanha({ campaignId: 'k-fora', status: 'CONCLUIDA', disparadaEm: '2026-08-12T20:00:00Z' }),
    ];
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: 'Escolher datas' }));

    // Enquanto o intervalo está pela metade, o painel não finge um recorte.
    expect(await screen.findByText(/escolha as duas datas/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^De$/), { target: { value: '2026-08-09' } });
    fireEvent.change(screen.getByLabelText(/^Até/), { target: { value: '2026-08-11' } });

    await screen.findByText(/de 09\/08\/2026 a 11\/08\/2026/);
    const pedidos = chamadas.filter((c) => c.startsWith('/relatorios/resumo'));
    const ultimo = pedidos[pedidos.length - 1];
    expect(ultimo).toContain('k-dentro');
    expect(ultimo).not.toContain('k-fora');
  });

  it('conta quantas campanhas ficam de fora por não ter data de disparo', async () => {
    campanhas = [
      campanha({ campaignId: 'k-sem', status: 'CONCLUIDA', disparadaEm: null }),
      campanha({ campaignId: 'k-com', status: 'CONCLUIDA', disparadaEm: diasAtras(1) }),
    ];
    montar();

    await screen.findAllByText('Entrega');
    await userEvent.click(screen.getByRole('button', { name: '30 dias' }));

    expect(
      await screen.findByText(/não tem data de disparo registrada e fica fora/i),
    ).toBeInTheDocument();
  });
});
