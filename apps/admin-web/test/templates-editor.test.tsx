import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TemplateEditor } from '../src/paginas/Templates.tsx';
import { listarTemplates, modelosEscolhiveis } from '../src/lib/templates.js';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];

const MODELO_CODIGO = {
  templateId: 't-1',
  nome: 'Comunicado',
  tipo: 'CODIGO',
  categoria: null,
  versaoAtual: 2,
  arquivado: false,
  atualizadoEm: '2026-08-13T12:00:00Z',
  conteudo: { assunto: 'Assunto salvo', corpoHtml: '<p>Corpo salvo</p>' },
};

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      if (caminho === '/templates/t-1') return MODELO_CODIGO;
      if (caminho === '/templates') {
        return {
          itens: [{ templateId: 'p1', nome: 'Página 1', arquivado: false }],
          cursor: 'c2',
          criadores: { a: 'ana@x.br' },
          variaveisDisponiveis: [{ chave: 'contato.nome', descricao: 'Nome' }],
        };
      }
      if (caminho === '/templates?cursor=c2') {
        return {
          itens: [{ templateId: 'p2', nome: 'Página 2', arquivado: false }],
          criadores: { b: 'beto@x.br' },
          variaveisDisponiveis: [{ chave: 'contato.nome', descricao: 'Nome' }],
        };
      }
      return { itens: [] };
    },
    post: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      return {
        enviados: 1,
        falhas: [],
        aviso:
          '1 e-mail(s) de teste enviado(s). Confira a caixa de entrada — o assunto começa com [TESTE].',
      };
    },
    put: async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'PUT', caminho, corpo });
      return { templateId: 't-1' };
    },
  },
  FalhaApi: class extends Error {},
}));

function montar(
  rota: string,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/templates/:id" element={<TemplateEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chamadas.length = 0;
});

describe('abrir um modelo existente', () => {
  it('abre mesmo com o conteúdo já fresco no cache (vindo da prévia do card)', async () => {
    // A listagem carrega o conteúdo de cada card sob a mesma chave. Com o dado
    // fresco, o React Query não chama o queryFn — e o editor antigo só saía do
    // "Carregando…" dentro dele: spinner para sempre até recarregar a página.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    qc.setQueryData(['template', 't-1'], MODELO_CODIGO);

    montar('/templates/t-1', qc);

    expect(await screen.findByDisplayValue('Comunicado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Assunto salvo')).toBeInTheDocument();
    expect(chamadas.filter((c) => c.caminho === '/templates/t-1')).toHaveLength(0);
  });
});

describe('e-mail de teste do modelo — fora da campanha', () => {
  it('envia o conteúdo que está na tela, sem salvar, e mostra a confirmação', async () => {
    montar('/templates/t-1');
    await screen.findByDisplayValue('Comunicado');

    // Altera o assunto sem salvar: o teste tem de levar o que está na tela.
    const assunto = screen.getByDisplayValue('Assunto salvo');
    await userEvent.clear(assunto);
    await userEvent.type(assunto, 'Assunto novo');

    await userEvent.type(
      screen.getByRole('textbox', { name: /enviar e-mail de teste/i }),
      'eu@exemplo.com, colega@exemplo.com',
    );
    await userEvent.click(screen.getByRole('button', { name: /enviar teste/i }));

    expect(await screen.findByText(/1 e-mail\(s\) de teste enviado/i)).toBeInTheDocument();

    const post = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/templates/teste');
    expect(post?.corpo).toEqual({
      assunto: 'Assunto novo',
      corpoHtml: '<p>Corpo salvo</p>',
      destinatarios: ['eu@exemplo.com', 'colega@exemplo.com'],
    });
    // Nada foi gravado para conseguir o teste.
    expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(0);
  });

  it('fica desabilitado enquanto não há destinatário', async () => {
    montar('/templates/t-1');
    await screen.findByDisplayValue('Comunicado');

    expect(screen.getByRole('button', { name: /enviar teste/i })).toBeDisabled();
  });
});

describe('listagem de modelos — todas as páginas', () => {
  it('segue o cursor até o fim e junta itens e criadores', async () => {
    const r = await listarTemplates();

    expect(r.itens.map((t) => t.templateId)).toEqual(['p1', 'p2']);
    expect(r.criadores).toEqual({ a: 'ana@x.br', b: 'beto@x.br' });
    expect(r.variaveisDisponiveis).toHaveLength(1);
    await waitFor(() =>
      expect(chamadas.map((c) => c.caminho)).toEqual(['/templates', '/templates?cursor=c2']),
    );
  });

  it('a escolha de modelo esconde os arquivados, exceto o que a campanha já usa', () => {
    const itens = [
      { templateId: 'a', nome: 'A', arquivado: false, versaoAtual: 1, atualizadoEm: '' },
      { templateId: 'b', nome: 'B', arquivado: true, versaoAtual: 1, atualizadoEm: '' },
      { templateId: 'c', nome: 'C', arquivado: true, versaoAtual: 1, atualizadoEm: '' },
    ];
    expect(modelosEscolhiveis(itens, '').map((t) => t.templateId)).toEqual(['a']);
    expect(modelosEscolhiveis(itens, 'c').map((t) => t.templateId)).toEqual(['a', 'c']);
  });
});
