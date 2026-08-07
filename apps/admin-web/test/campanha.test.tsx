import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CampanhaDetalhe, type Campanha } from '../src/paginas/Campanhas.tsx';
import type { Usuario } from '../src/lib/auth.js';

const chamadas: { caminho: string; corpo: unknown }[] = [];
let campanhaAtual: Campanha;
let respostaAcao: Record<string, unknown> = {};

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async () => campanhaAtual,
    post: async (caminho: string, corpo: unknown) => {
      chamadas.push({ caminho, corpo });
      return { ...campanhaAtual, ...respostaAcao };
    },
  },
  FalhaApi: class extends Error {},
}));

function campanha(over: Partial<Campanha> = {}): Campanha {
  return {
    campaignId: 'k-1',
    nome: 'Boletim tributário',
    status: 'RASCUNHO',
    templateId: 't-1',
    templateVersao: 2,
    listId: 'l-1',
    criadoPor: 'operador@escritorio.com.br',
    criadoEm: '2026-08-07T12:00:00Z',
    aprovacao: null,
    hashConteudoAtual: 'hash-do-que-esta-na-tela',
    ...over,
  };
}

const ADMIN: Usuario = { email: 'admin@escritorio.com.br', papeis: ['ADMIN'] };
const OPERADOR: Usuario = { email: 'operador@escritorio.com.br', papeis: ['OPERADOR'] };

function montar(usuario: Usuario) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/campanhas/k-1']}>
        <Routes>
          <Route path="/campanhas/:id" element={<CampanhaDetalhe usuario={usuario} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chamadas.length = 0;
  respostaAcao = {};
  campanhaAtual = campanha();
});

describe('fluxo de aprovação — §5.8 e §10.3', () => {
  it('reenvia o hash do conteúdo ao aprovar', async () => {
    // Sem isto, TODA aprovação falharia: o backend compara o hash recebido com
    // o conteúdo atual para detectar edição entre a revisão e o clique.
    campanhaAtual = campanha({ status: 'EM_REVISAO' });
    montar(ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: /aprovar conteúdo/i }));

    await waitFor(() => {
      expect(chamadas).toContainEqual({
        caminho: '/campanhas/k-1/aprovacao',
        corpo: { hashConteudoRevisado: 'hash-do-que-esta-na-tela' },
      });
    });
  });

  it('impede o autor de aprovar a própria campanha e explica por quê', async () => {
    campanhaAtual = campanha({ status: 'EM_REVISAO', criadoPor: ADMIN.email });
    montar(ADMIN);

    expect(await screen.findByText(/quem cria não pode aprovar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aprovar conteúdo/i })).toBeDisabled();
  });

  it('operador vê que a campanha aguarda administrador, sem botão de aprovar', async () => {
    campanhaAtual = campanha({ status: 'EM_REVISAO' });
    montar(OPERADOR);

    expect(await screen.findByText(/aguarda aprovação de um administrador/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aprovar conteúdo/i })).toBeNull();
  });
});

describe('avisos do backend chegam à tela', () => {
  it('mostra que a pausa não é retroativa', async () => {
    // O aviso existe porque alguém decidiu que o operador precisa saber.
    // Descartá-lo aqui anularia a decisão.
    campanhaAtual = campanha({ status: 'ENVIANDO' });
    respostaAcao = {
      status: 'PAUSADA',
      aviso:
        'A pausa vale para os próximos envios. Mensagens já entregues ao servidor de e-mail ainda serão enviadas.',
    };
    montar(ADMIN);

    await userEvent.click(await screen.findByRole('button', { name: /pausar/i }));

    expect(await screen.findByText(/já entregues ao servidor/i)).toBeInTheDocument();
  });
});

describe('ações disponíveis por estado', () => {
  it('rascunho oferece enviar para revisão, não disparar', async () => {
    montar(ADMIN);

    expect(await screen.findByRole('button', { name: /enviar para revisão/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disparar agora/i })).toBeNull();
  });

  it('aprovada oferece disparo e agendamento', async () => {
    campanhaAtual = campanha({ status: 'APROVADA' });
    montar(ADMIN);

    expect(await screen.findByRole('button', { name: /disparar agora/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^agendar$/i })).toBeInTheDocument();
  });

  it('operador não vê o botão de cancelar — conveniência, não segurança', async () => {
    // Quem barra de fato é o `exigirPapel` do backend; esconder evita o clique
    // que só produziria um 403 sem explicação.
    campanhaAtual = campanha({ status: 'ENVIANDO' });
    montar(OPERADOR);

    await screen.findByRole('button', { name: /pausar/i });
    expect(screen.queryByRole('button', { name: /cancelar campanha/i })).toBeNull();
  });

  it('campanha concluída não oferece ação destrutiva', async () => {
    campanhaAtual = campanha({ status: 'CONCLUIDA' });
    montar(ADMIN);

    await screen.findByText(/concluída/i);
    expect(screen.queryByRole('button', { name: /cancelar campanha/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pausar/i })).toBeNull();
  });
});
