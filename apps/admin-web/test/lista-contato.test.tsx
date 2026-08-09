import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ListaDetalhe } from '../src/paginas/Listas.tsx';

const AVISO_REAPROVEITADO =
  'Já existia um contato com este e-mail. Ele foi reaproveitado e apenas acrescentado à lista: ' +
  'o vínculo e a base legal continuam os que ele já tinha, e o que você preencheu no formulário ' +
  'foi ignorado.';

const gets: string[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];
let resposta: () => Promise<Record<string, unknown>>;

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      gets.push(caminho);
      if (caminho.endsWith('/previa-audiencia')) {
        return { receberao: 3, naoReceberao: 0, explicacoes: [] };
      }
      return { itens: [] };
    },
    post: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return await resposta();
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/listas/l-1']}>
        <Routes>
          <Route path="/listas/:id" element={<ListaDetalhe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function adicionar(email: string) {
  await userEvent.type(screen.getByLabelText(/e-mail/i), email);
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar à lista' }));
}

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  resposta = () => Promise.resolve({ contactId: 'c-1', email: 'a@b.com', criado: true });
});

describe('adicionar contato pela tela da lista', () => {
  it('envia o formulário, limpa os campos e recarrega prévia e contatos', async () => {
    montar();
    await screen.findByText('vão receber');
    const getsIniciais = gets.length;

    await adicionar('novo@escritorio.com.br');

    expect(posts).toEqual([
      {
        caminho: '/listas/l-1/contatos/novo',
        corpo: { email: 'novo@escritorio.com.br', relacionamento: 'CLIENTE_ATIVO' },
      },
    ]);
    // O campo limpo é o sinal de que o envio terminou — sem isso, o operador
    // reenvia o mesmo endereço achando que o clique não pegou.
    await waitFor(() => expect(screen.getByLabelText(/e-mail/i)).toHaveValue(''));
    // Um contato a mais muda quem vai receber: a prévia recarrega junto com a
    // tabela, senão o número na tela passa a mentir.
    await waitFor(() => {
      expect(gets.filter((c) => c.endsWith('/previa-audiencia')).length).toBeGreaterThan(1);
      expect(gets.filter((c) => c.endsWith('/contatos')).length).toBeGreaterThan(1);
    });
    expect(gets.length).toBeGreaterThan(getsIniciais);
  });

  it('mostra o aviso quando o contato já existia e o vínculo digitado foi ignorado', async () => {
    // É a única pista de que a base legal daquela pessoa continua sendo a
    // antiga, e não a que acabou de ser escolhida no formulário.
    resposta = () =>
      Promise.resolve({
        contactId: 'c-9',
        email: 'antigo@escritorio.com.br',
        criado: false,
        aviso: AVISO_REAPROVEITADO,
      });
    montar();
    await screen.findByText('vão receber');

    await adicionar('antigo@escritorio.com.br');

    const aviso = await screen.findByText(/já existia um contato com este e-mail/i);
    expect(aviso.closest('[role="status"]')).not.toBeNull();
  });

  it('não deixa o aviso da adição anterior sobreviver a uma tentativa que falhou', async () => {
    // O aviso fala de vínculo ignorado. Repetido ao lado do erro da tentativa
    // seguinte, descreveria uma operação que não aconteceu.
    resposta = () =>
      Promise.resolve({
        contactId: 'c-9',
        email: 'antigo@escritorio.com.br',
        criado: false,
        aviso: AVISO_REAPROVEITADO,
      });
    montar();
    await screen.findByText('vão receber');
    await adicionar('antigo@escritorio.com.br');
    await screen.findByText(/já existia um contato com este e-mail/i);

    resposta = () => Promise.reject(new Error('Falha na requisição (500).'));
    await adicionar('outro@escritorio.com.br');

    expect(await screen.findByText('Falha na requisição (500).')).toBeInTheDocument();
    expect(screen.queryByText(/já existia um contato com este e-mail/i)).toBeNull();
  });
});
