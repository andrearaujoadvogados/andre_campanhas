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
let execucoes: Record<string, unknown>[];
const chamadas: Chamada[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      if (caminho === '/boletim/execucoes') return { itens: execucoes };
      return { itens: fontes };
    },
    post: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      if (caminho === '/boletim/gerar') {
        // O servidor grava a execução ANTES de invocar; o dublê faz o mesmo,
        // senão o teste não exercita o caminho que o operador de fato vê.
        execucoes = [execucaoFalsa({ situacao: 'EXECUTANDO', etapa: 'INICIANDO' })];
        return {
          iniciado: true,
          message: 'Geração iniciada. Acompanhe o progresso aqui.',
          execucao: execucoes[0],
        };
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

function execucaoFalsa(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    execucaoId: 'e-1',
    situacao: 'CONCLUIDA',
    etapa: 'FINALIZADA',
    origem: 'MANUAL',
    iniciadaEm: new Date().toISOString(),
    atualizadaEm: new Date().toISOString(),
    concluidaEm: new Date().toISOString(),
    fontesTotal: 2,
    fontesConcluidas: 2,
    fonteAtual: null,
    totalNoticias: 5,
    templateId: 't-9',
    templateNome: 'Boletim automático — 13/08/2026',
    avisos: [],
    erro: null,
    ...over,
  };
}

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
  execucoes = [];
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

  it('a página explica o fluxo e que nada é enviado sem revisão', () => {
    montar();

    expect(screen.getByText(/nada é enviado sem passar pelo assistente/i)).toBeInTheDocument();
  });
});

/**
 * O que o operador vê depois de clicar — a lacuna que motivou tudo isto.
 *
 * Antes, o clique devolvia uma frase otimista e nada mais: o sistema podia ter
 * falhado três minutos depois e a tela continuaria dizendo que estava tudo
 * bem. Cada teste abaixo fixa um estado que precisa ser visível.
 */
describe('boletim automático — visibilidade da geração', () => {
  it('clicar em gerar troca a frase de consolo por um painel de andamento', async () => {
    fontes = [fonteMigalhas()];
    montar();

    await screen.findByText('Migalhas');
    await userEvent.click(screen.getByRole('button', { name: /gerar boletim agora/i }));

    expect(await screen.findByText(/gerando agora/i)).toBeInTheDocument();
    // E o botão sai de circulação: um segundo clique geraria dois boletins.
    expect(await screen.findByRole('button', { name: /gerando…/i })).toBeDisabled();
  });

  it('em andamento, mostra a etapa, a fonte sendo lida e o progresso', async () => {
    fontes = [fonteMigalhas()];
    execucoes = [
      execucaoFalsa({
        situacao: 'EXECUTANDO',
        etapa: 'LENDO_FONTES',
        concluidaEm: null,
        fonteAtual: 'Migalhas',
        fontesTotal: 4,
        fontesConcluidas: 1,
        totalNoticias: 2,
        templateId: null,
        templateNome: null,
      }),
    ];
    montar();

    expect(await screen.findByText(/lendo as fontes/i)).toBeInTheDocument();
    expect(screen.getByText(/1 de 4 fontes lidas/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    // Sair da tela não pode custar o acompanhamento.
    expect(screen.getByText(/pode sair desta tela/i)).toBeInTheDocument();
  });

  it('concluída, aponta o modelo gerado em vez de mandar procurar', async () => {
    execucoes = [execucaoFalsa()];
    montar();

    expect(await screen.findByText(/boletim pronto/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir o boletim gerado/i })).toHaveAttribute(
      'href',
      '/templates/t-9',
    );
  });

  it('falha mostra o motivo e oferece tentar de novo', async () => {
    fontes = [fonteMigalhas()];
    execucoes = [
      execucaoFalsa({
        situacao: 'FALHOU',
        erro: 'limite do nível gratuito atingido; tente mais tarde',
        templateId: null,
        templateNome: null,
      }),
    ];
    montar();

    expect(await screen.findByText(/a geração falhou/i)).toBeInTheDocument();
    expect(screen.getByText(/limite do nível gratuito/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gerar de novo/i })).toBeEnabled();
  });

  it('sem notícias não é erro, e os motivos por fonte ficam à mão', async () => {
    execucoes = [
      execucaoFalsa({
        situacao: 'SEM_NOTICIAS',
        totalNoticias: 0,
        templateId: null,
        templateNome: null,
        avisos: ['Migalhas: não foi possível ler a página (HTTP 403).'],
      }),
    ];
    montar();

    expect(await screen.findByText(/nada foi encontrado/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum modelo foi criado/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/1 fonte não rendeu notícia/i));
    expect(screen.getByText(/http 403/i)).toBeInTheDocument();
  });

  it('processo morto vira "sem resposta", não uma espera eterna', async () => {
    fontes = [fonteMigalhas()];
    execucoes = [
      execucaoFalsa({
        situacao: 'TRAVADA',
        concluidaEm: null,
        templateId: null,
        templateNome: null,
      }),
    ];
    montar();

    expect(await screen.findByText(/sem resposta/i)).toBeInTheDocument();
    expect(screen.getByText(/gerar de novo é seguro/i)).toBeInTheDocument();
    // Travada não tranca o botão — senão um worker morto congelaria a função.
    expect(screen.getByRole('button', { name: /gerar boletim agora/i })).toBeEnabled();
  });

  it('sem nenhuma geração, diz isso em vez de deixar a área em branco', async () => {
    montar();

    expect(await screen.findByText(/nenhuma geração registrada ainda/i)).toBeInTheDocument();
  });
});
