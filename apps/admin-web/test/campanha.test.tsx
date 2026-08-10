import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    patch: async (caminho: string, corpo: unknown) => {
      chamadas.push({ caminho, corpo });
      return { ...campanhaAtual, ...respostaAcao };
    },
    delete: async (caminho: string) => {
      chamadas.push({ caminho, corpo: undefined });
      return undefined;
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
    remetenteNome: 'André Araújo Advogados',
    remetenteEmail: 'campanhas@mail.andrearaujoadvogados.com.br',
    listId: 'l-1',
    criadoPor: 'operador@escritorio.com.br',
    criadoEm: '2026-08-07T12:00:00Z',
    enviadaPor: null,
    disparadaEm: null,
    hashConteudoEnviado: null,
    ...over,
  };
}

const ADMIN: Usuario = {
  id: 'admin@escritorio.com.br',
  email: 'admin@escritorio.com.br',
  papeis: ['ADMIN'],
};
const OPERADOR: Usuario = {
  id: 'operador@escritorio.com.br',
  email: 'operador@escritorio.com.br',
  papeis: ['OPERADOR'],
};

function montar(usuario: Usuario) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/boletins/k-1']}>
        <Routes>
          <Route path="/boletins/:id" element={<CampanhaDetalhe usuario={usuario} />} />
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

describe('sem etapa de aprovação — quem monta dispara', () => {
  it('rascunho oferece disparar agora, sem passo de revisão nem aprovação', async () => {
    // O portão EM_REVISAO/APROVADA foi removido: a Etapa 4 é só resumo + teste,
    // e o disparo parte direto do rascunho. Este teste impede o portão de voltar.
    montar(ADMIN);

    expect(await screen.findByRole('button', { name: /disparar agora/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enviar para revisão/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /aprovar/i })).toBeNull();
  });

  it('mostra quem disparou quando a campanha já saiu', async () => {
    // Auditoria do disparo no lugar da aprovação: o rastro do que saiu e por
    // ordem de quem continua registrado, mesmo sem o portão.
    campanhaAtual = campanha({
      status: 'ENVIANDO',
      enviadaPor: 'advogado@escritorio.com.br',
      disparadaEm: '2026-08-08T13:00:00Z',
    });
    montar(ADMIN);

    expect(await screen.findByText(/advogado@escritorio.com.br/i)).toBeInTheDocument();
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
  it('rascunho oferece disparo e agendamento', async () => {
    montar(ADMIN);

    expect(await screen.findByRole('button', { name: /disparar agora/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^agendar$/i })).toBeInTheDocument();
  });

  it('agendada também oferece disparo imediato e reagendamento', async () => {
    campanhaAtual = campanha({ status: 'AGENDADA' });
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
    expect(screen.queryByRole('button', { name: /cancelar boletim/i })).toBeNull();
  });

  it('campanha concluída não oferece ação destrutiva', async () => {
    campanhaAtual = campanha({ status: 'CONCLUIDA' });
    montar(ADMIN);

    await screen.findByText(/concluída/i);
    expect(screen.queryByRole('button', { name: /cancelar boletim/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pausar/i })).toBeNull();
  });
});

describe('gestão da campanha na tela', () => {
  it('oferece editar enquanto a campanha não saiu', async () => {
    campanhaAtual = campanha({ status: 'RASCUNHO' });
    montar(ADMIN);

    expect(await screen.findByRole('button', { name: /editar boletim/i })).toBeInTheDocument();
  });

  it('não oferece editar depois do disparo', async () => {
    // A partir do envio, cada mensagem entregue é um fato registrado — mudar a
    // campanha faria o relatório descrever algo que não foi o que saiu.
    campanhaAtual = campanha({ status: 'ENVIANDO' });
    montar(ADMIN);

    await screen.findByText(/boletim tributário/i);
    expect(screen.queryByRole('button', { name: /editar boletim/i })).toBeNull();
  });

  it('só oferece excluir para rascunho', async () => {
    // AGENDADA ainda é editável (o launcher lê o conteúdo mais recente), mas não
    // é excluível — há um agendamento armado apontando para ela.
    campanhaAtual = campanha({ status: 'AGENDADA' });
    montar(ADMIN);

    await screen.findByRole('button', { name: /editar boletim/i });
    expect(screen.queryByRole('button', { name: /excluir/i })).toBeNull();
  });

  it('operador não vê o botão de excluir', async () => {
    campanhaAtual = campanha({ status: 'RASCUNHO' });
    montar(OPERADOR);

    await screen.findByText(/boletim tributário/i);
    expect(screen.queryByRole('button', { name: /excluir/i })).toBeNull();
  });
});

describe('progresso do envio', () => {
  it('mostra processados de total quando está enviando', async () => {
    campanhaAtual = campanha({ status: 'ENVIANDO', totalDestinatarios: 5, processados: 3 });
    montar(ADMIN);

    expect(await screen.findByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/de 5 processados/i)).toBeInTheDocument();
  });

  it('avisa quando o disparo está parado em zero', async () => {
    // O sintoma que ficou invisível hoje: ENVIANDO com nenhum processado. Sem
    // este aviso, "Enviando" não distingue "começando" de "travado".
    campanhaAtual = campanha({ status: 'ENVIANDO', totalDestinatarios: 2, processados: 0 });
    montar(ADMIN);

    expect(await screen.findByText(/pode estar travado/i)).toBeInTheDocument();
  });

  it('não mostra progresso para rascunho', async () => {
    campanhaAtual = campanha({ status: 'RASCUNHO' });
    montar(ADMIN);

    await screen.findByText(/boletim tributário/i);
    expect(screen.queryByText(/processados/i)).toBeNull();
  });
});
