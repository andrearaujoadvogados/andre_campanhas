import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AssistenteBoletim } from '../src/componentes/AssistenteBoletim.tsx';

const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) =>
      caminho.startsWith('/templates')
        ? { itens: [{ templateId: 't-1', nome: 'Boletim tributário', categoria: 'Novidade' }] }
        : { itens: [{ listId: 'l-1', nome: 'Clientes', totalContatos: 42 }] },
    post: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      if (caminho.includes('audiencia-previa')) {
        return {
          total: 2,
          excluidos: { total: 0, porMotivo: {} },
          destinatarios: [
            { contactId: 'c-1', nome: 'Ana', email: 'ana@exemplo.com', empresa: null },
            { contactId: 'c-2', nome: 'Bruno', email: 'bruno@exemplo.com', empresa: null },
          ],
        };
      }
      return { campaignId: 'k-9' };
    },
    patch: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { campaignId: 'k-9' };
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssistenteBoletim aoCancelar={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posts.length = 0;
});

describe('assistente de boletim — wizard de 4 etapas', () => {
  it('não avança do passo 1 sem nome', async () => {
    montar();
    // "Avançar" começa desabilitado: falta o nome.
    expect(screen.getByRole('button', { name: /avançar/i })).toBeDisabled();
  });

  it('percorre configurar → e-mail → destinatários e habilita salvar rascunho', async () => {
    montar();

    // Passo 1 tem Nome e Assunto; mira o campo Nome pelo nome acessível.
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome do boletim/i }),
      'Boletim de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Passo 2: escolher modelo.
    const modelo = await screen.findByRole('radio');
    await userEvent.click(modelo);
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // Passo 3: escolher lista (obrigatória).
    const lista = await screen.findByRole('combobox');
    await userEvent.selectOptions(lista, 'l-1');

    // Com nome + modelo + lista, o rascunho pode ser salvo.
    const salvar = screen.getByRole('button', { name: /salvar rascunho/i });
    expect(salvar).toBeEnabled();
    await userEvent.click(salvar);

    await waitFor(() => {
      expect(posts).toContainEqual({
        caminho: '/boletins',
        corpo: expect.objectContaining({
          nome: 'Boletim de agosto',
          templateId: 't-1',
          listId: 'l-1',
        }),
      });
    });
  });
});

describe('seleção vazia trava o disparo', () => {
  /** Leva o assistente até a Etapa 3 com lista escolhida e prévia carregada. */
  async function ateOsDestinatarios() {
    montar();
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome do boletim/i }),
      'Boletim de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));
    await userEvent.click(await screen.findByRole('radio'));
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'l-1');
    await screen.findByText(/ana@exemplo\.com/i);
  }

  it('desmarcar todos não deixa disparar — e não vira "enviar para a lista inteira"', async () => {
    // A regressão: o disparo saía para todos os elegíveis quando a seleção
    // chegava vazia, com o resumo exibindo "0 destinatários". O erro que este
    // teste impede não é recuperável — e-mail enviado não volta.
    await ateOsDestinatarios();

    await userEvent.click(screen.getByRole('button', { name: /desmarcar todos/i }));
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    expect(screen.getByRole('button', { name: /disparar agora/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /salvar rascunho/i })).toBeDisabled();
    expect(screen.getByText(/nenhum destinatário selecionado/i)).toBeInTheDocument();
  });

  it('voltar a selecionar todos destrava, e o corpo não carrega a seleção', async () => {
    await ateOsDestinatarios();

    await userEvent.click(screen.getByRole('button', { name: /desmarcar todos/i }));
    await userEvent.click(screen.getByRole('button', { name: /selecionar todos/i }));

    const salvar = screen.getByRole('button', { name: /salvar rascunho/i });
    expect(salvar).toBeEnabled();
    await userEvent.click(salvar);

    // Ninguém desmarcado: o campo some do corpo, e ausente significa "todos".
    await waitFor(() => {
      const criacao = posts.find((p) => p.caminho === '/boletins');
      expect(criacao?.corpo).not.toHaveProperty('destinatariosSelecionados');
    });
  });

  it('desmarcar um só manda a seleção com quem sobrou', async () => {
    await ateOsDestinatarios();

    // Desmarca a Ana; sobra o Bruno.
    const caixas = screen.getAllByRole('checkbox');
    await userEvent.click(caixas[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }));

    await waitFor(() => {
      const criacao = posts.find((p) => p.caminho === '/boletins');
      expect(criacao?.corpo).toMatchObject({ destinatariosSelecionados: ['c-2'] });
    });
  });
});
