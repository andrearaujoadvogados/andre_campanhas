import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createBoletimDesign } from '@emailmkt/criador';
import { TemplateEditor, Templates } from '../src/paginas/Templates.tsx';

const chamadas: { metodo: string; caminho: string }[] = [];

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      if (caminho === '/templates/t-9') {
        return {
          templateId: 't-9',
          nome: 'Boletim Tributário',
          tipo: 'VISUAL',
          categoria: 'Boletim',
          versaoAtual: 1,
          arquivado: false,
          atualizadoEm: '2026-08-13T12:00:00Z',
          conteudo: {
            assunto: 'Boletim',
            corpoHtml: '<html>x</html>',
            // Presente como no backend real: sem ela a key do EditorVisual
            // flip-a para "novo" e o teste clicaria num botão desmontado.
            estruturaVisual: JSON.stringify(createBoletimDesign()),
          },
        };
      }
      return { itens: [], variaveisDisponiveis: [] };
    },
    post: async (caminho: string) => {
      chamadas.push({ metodo: 'POST', caminho });
      return { templateId: 't-9' };
    },
    put: async (caminho: string) => {
      chamadas.push({ metodo: 'PUT', caminho });
      return { templateId: 't-9' };
    },
  },
  FalhaApi: class extends Error {},
}));

// O mjml-browser não roda no jsdom; a compilação real é coberta pelos testes
// puros de `criador-boletim`. Aqui o que se protege é a FIAÇÃO: o parâmetro da
// URL virar o design montado dentro do criador.
vi.mock('../src/lib/criador/html.js', () => ({
  compilarParaHtml: () => Promise.resolve({ html: '<html>ok</html>', avisos: [] }),
  gerarCodigoDoDocumento: () => Promise.resolve({ html: '', avisos: [] }),
  gerarCodigoDoPedaco: () => Promise.resolve({ html: '', avisos: [] }),
}));

function montar(rota: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/:id" element={<TemplateEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('novo boletim — o atalho que abre o criador montado', () => {
  it('a listagem oferece o atalho ao lado do modelo em branco', async () => {
    montar('/templates');

    expect(await screen.findByRole('link', { name: /novo boletim/i })).toHaveAttribute(
      'href',
      '/templates/novo?inicio=boletim',
    );
    expect(screen.getByRole('link', { name: /novo modelo/i })).toBeInTheDocument();
  });

  it('?inicio=boletim abre o criador visual com a edição de exemplo no canvas', async () => {
    montar('/templates/novo?inicio=boletim');

    // O criador carrega com lazy(); as notícias de exemplo aparecem no canvas.
    expect(
      await screen.findByText(/NF-e sem IBS e CBS/i, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PRAZOS DE AGOSTO/i)).toBeInTheDocument();

    // Nome e assunto chegam preenchidos — editáveis, não vazios.
    expect(screen.getByLabelText(/nome do modelo/i)).toHaveValue('Boletim Tributário');
    expect(screen.getByLabelText(/assunto do e-mail/i)).toHaveValue(
      'Boletim Tributário — os destaques da semana',
    );
  });

  it('criar confirma na tela e sai do estado "novo" — clicar de novo NÃO duplica', async () => {
    // Heurística 1 de Nielsen (visibilidade do estado): sem confirmação, o
    // usuário clica de novo "para garantir" — e antes desta correção cada
    // clique era um POST criando um modelo idêntico.
    chamadas.length = 0;
    montar('/templates/novo?inicio=boletim');

    await screen.findByText(/NF-e sem IBS e CBS/i, undefined, { timeout: 5000 });
    // O HTML compilado chega por debounce; espera o botão e clica.
    await userEvent.click(screen.getByRole('button', { name: /criar modelo/i }));

    // Confirmação visível, com tom de sucesso (não de alerta).
    expect(await screen.findByText('Modelo criado.')).toBeInTheDocument();

    // A URL passou a ser a do modelo criado: o botão agora fala em salvar.
    const salvar = await screen.findByRole('button', { name: /salvar modelo/i });
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1);

    // O clique repetido vira ATUALIZAÇÃO do modelo existente, nunca um segundo.
    await userEvent.click(salvar);
    await screen.findByText('Modelo salvo.');
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1);
    expect(
      chamadas.filter((c) => c.metodo === 'PUT' && c.caminho === '/templates/t-9'),
    ).toHaveLength(1);
  });

  it('sem o parâmetro, o modelo novo continua nascendo em branco', async () => {
    montar('/templates/novo');

    // O fluxo padrão é o formulário de código — nada do boletim.
    expect(await screen.findByText(/nome interno/i)).toBeInTheDocument();
    expect(screen.queryByText(/NF-e sem IBS e CBS/i)).toBeNull();
  });
});
