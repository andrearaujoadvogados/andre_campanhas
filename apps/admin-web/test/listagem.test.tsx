import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Campanhas } from '../src/paginas/Campanhas.tsx';

const caminhos: string[] = [];
const excluidos: string[] = [];
let resposta: Record<string, unknown>;
/** Ids cuja exclusão o backend recusa — campanha que já enviou, por exemplo. */
let recusaExclusao: Record<string, string> = {};

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      caminhos.push(caminho);
      // A lista também busca o catálogo de tipos; vazio aqui mantém os testes
      // focados na listagem de campanhas.
      if (caminho.startsWith('/tipos')) return { itens: [] };
      return resposta;
    },
    delete: async (caminho: string) => {
      const id = caminho.split('/').pop() ?? '';
      const motivo = recusaExclusao[id];
      if (motivo !== undefined) throw new Error(motivo);
      excluidos.push(id);
      return undefined;
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
  excluidos.length = 0;
  recusaExclusao = {};
  resposta = {
    itens: [
      {
        campaignId: 'k-1',
        nome: 'Campanha de agosto',
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
    expect(await screen.findByText('Campanha de agosto')).toBeInTheDocument();
    // Sem filtro por padrão: a chamada de campanhas não leva `?status=`.
    expect(caminhos.filter((c) => c.startsWith('/campanhas'))).toEqual(['/campanhas']);
  });

  it('filtrar por situação passa o status para a API', async () => {
    // Com filtro, a consulta cai numa partição só do GSI3 e pagina de verdade.
    montar();
    await screen.findByText('Campanha de agosto');

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
    await screen.findByText('Campanha de agosto');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('mensagem vazia distingue "nenhuma campanha" de "nenhuma nesta situação"', async () => {
    resposta = { itens: [], truncado: false };
    montar();

    expect(await screen.findByText(/nenhuma campanha criada ainda/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pausada' }));
    expect(await screen.findByText(/nenhuma campanha para este filtro/i)).toBeInTheDocument();
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

describe('exclusão em lote', () => {
  const DUAS = {
    itens: [
      {
        campaignId: 'k-1',
        nome: 'Rascunho velho',
        status: 'RASCUNHO',
        criadoEm: '2026-08-01T12:00:00Z',
      },
      {
        campaignId: 'k-2',
        nome: 'Já enviada',
        status: 'CONCLUIDA',
        criadoEm: '2026-08-02T12:00:00Z',
      },
    ],
    truncado: false,
  };

  beforeEach(() => {
    resposta = DUAS;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('só oferece a ação depois de selecionar algo', async () => {
    montar();
    await screen.findByText('Rascunho velho');

    expect(screen.queryByRole('button', { name: /excluir selecionadas/i })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: /selecionar rascunho velho/i }));

    expect(screen.getByRole('button', { name: /excluir selecionadas/i })).toBeInTheDocument();
  });

  it('"selecionar todas" exclui cada uma das campanhas marcadas', async () => {
    montar();
    await screen.findByText('Rascunho velho');

    await userEvent.click(screen.getByRole('checkbox', { name: /selecionar todas/i }));
    await userEvent.click(screen.getByRole('button', { name: /excluir selecionadas/i }));

    await waitFor(() => expect(excluidos).toEqual(['k-1', 'k-2']));
  });

  it('falha parcial diz QUAIS não saíram e por quê', async () => {
    // O caso normal, não a exceção: o backend recusa campanha que já enviou,
    // porque relatório e auditoria apontam para ela. Sem o nome e o motivo na
    // tela, o operador tentaria de novo às cegas.
    recusaExclusao = { 'k-2': 'Esta campanha já enviou 3 mensagem(ns) e não pode ser excluída.' };
    montar();
    await screen.findByText('Já enviada');

    await userEvent.click(screen.getByRole('checkbox', { name: /selecionar todas/i }));
    await userEvent.click(screen.getByRole('button', { name: /excluir selecionadas/i }));

    await screen.findByText(/já enviou 3 mensagem/i);

    // Dentro do alerta: o nome também aparece na lista, e procurar na página
    // inteira acharia os dois sem provar que a recusa foi nomeada.
    const alerta = within(screen.getByRole('alert'));
    expect(alerta.getByText('Já enviada')).toBeInTheDocument();
    expect(alerta.getByText(/já enviou 3 mensagem/i)).toBeInTheDocument();

    // A que podia sair, saiu: uma recusa não bloqueia as demais.
    expect(excluidos).toEqual(['k-1']);
  });
});
