import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AssistenteCampanha } from '../src/componentes/AssistenteCampanha.tsx';

const posts: { caminho: string; corpo: unknown }[] = [];

/** Mutáveis para os testes variarem o cenário sem duplicar o mock inteiro. */
let modelosLista: { templateId: string; nome: string; categoria?: string | null }[] = [];
let tiposLista: { tipoEmailId: string; nome: string }[] = [];

/**
 * Os editores entram simulados.
 *
 * O GrapesJS monta um iframe e mede layout de verdade; dentro do jsdom ele
 * trava o teste em vez de falhar. O que estas asserções verificam é o
 * assistente — qual editor ele oferece e quando libera o avanço —, não o
 * editor em si, que tem os próprios testes.
 */
vi.mock('../src/componentes/EditorVisual.tsx', () => ({
  EditorVisual: ({ aoMudar }: { aoMudar: (s: unknown) => void }) => (
    <button
      type="button"
      onClick={() => aoMudar({ estruturaVisual: '{}', corpoHtml: '<p>oi</p>' })}
    >
      simular edição visual
    </button>
  ),
}));

vi.mock('../src/componentes/EditorEmail.tsx', () => ({
  EditorEmail: ({ aoMudar }: { aoMudar: (v: string) => void }) => (
    <button type="button" onClick={() => aoMudar('<p>html na mão</p>')}>
      simular edição html
    </button>
  ),
}));

vi.mock('../src/lib/api.js', () => ({
  api: {
    get: async (caminho: string) =>
      caminho.startsWith('/templates')
        ? { itens: modelosLista }
        : caminho.startsWith('/tipos')
          ? { itens: tiposLista }
          : { itens: [{ listId: 'l-1', nome: 'Clientes', totalContatos: 42 }] },
    post: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      if (caminho.endsWith('/teste')) {
        return {
          enviados: 0,
          falhas: [
            { email: 'ferarte.fernando@gmail.com', motivo: 'Email address is not verified.' },
          ],
          aviso: 'Nenhum e-mail de teste foi enviado. Veja os motivos abaixo.',
        };
      }
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
      if (caminho === '/templates') return { templateId: 't-novo' };
      return { campaignId: 'k-9' };
    },
    patch: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { campaignId: 'k-9' };
    },
    put: async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { templateId: 't-novo' };
    },
  },
  FalhaApi: class extends Error {},
}));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssistenteCampanha aoCancelar={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posts.length = 0;
  modelosLista = [{ templateId: 't-1', nome: 'Campanha tributário', categoria: 'Novidade' }];
  tiposLista = [{ tipoEmailId: 'tp-boletim', nome: 'Boletim' }];
});

describe('assistente de campanha — wizard de 4 etapas', () => {
  it('não avança do passo 1 sem nome', async () => {
    montar();
    // "Avançar" começa desabilitado: falta o nome.
    expect(screen.getByRole('button', { name: /avançar/i })).toBeDisabled();
  });

  it('percorre configurar → e-mail → destinatários e habilita salvar rascunho', async () => {
    montar();

    // Passo 1 tem Nome e Assunto; mira o campo Nome pelo nome acessível.
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome da campanha/i }),
      'Campanha de agosto',
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
        caminho: '/campanhas',
        corpo: expect.objectContaining({
          nome: 'Campanha de agosto',
          templateId: 't-1',
          listId: 'l-1',
        }),
      });
    });
  });
});

describe('o tipo de campanha organiza a escolha do modelo', () => {
  it('com o tipo escolhido, os modelos da categoria vêm primeiro, como recomendação', async () => {
    modelosLista = [
      { templateId: 't-1', nome: 'Campanha tributário', categoria: 'Novidade' },
      { templateId: 't-2', nome: 'Boletim Tributário', categoria: 'Boletim' },
    ];
    montar();

    await userEvent.type(screen.getByRole('textbox', { name: /nome da campanha/i }), 'Edição 34');
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: /tipo de campanha/i }),
      'tp-boletim',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    // O grupo recomendado nomeia o tipo e traz o modelo da categoria certa.
    expect(await screen.findByText(/recomendados para boletim/i)).toBeInTheDocument();
    expect(screen.getByText(/outros modelos/i)).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    // O recomendado vem ANTES na ordem do documento — é a recomendação.
    const rotulos = radios.map((r) => r.closest('label')?.textContent ?? '');
    expect(rotulos[0]).toContain('Boletim Tributário');
    expect(rotulos[1]).toContain('Campanha tributário');
  });

  it('tipo sem modelo da categoria avisa e aponta o caminho', async () => {
    // A lista padrão só tem categoria "Novidade" — nada casa com Boletim.
    montar();

    await userEvent.type(screen.getByRole('textbox', { name: /nome da campanha/i }), 'Edição 35');
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: /tipo de campanha/i }),
      'tp-boletim',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    expect(await screen.findByText(/nenhum modelo da categoria "boletim"/i)).toBeInTheDocument();
    // Os demais modelos continuam disponíveis — o aviso orienta, não bloqueia.
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });

  it('sem tipo, a lista continua plana — sem grupo fantasma', async () => {
    montar();

    await userEvent.type(screen.getByRole('textbox', { name: /nome da campanha/i }), 'Edição 36');
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    await screen.findByRole('radio');
    expect(screen.queryByText(/recomendados para/i)).toBeNull();
    expect(screen.queryByText(/outros modelos/i)).toBeNull();
  });
});

describe('e-mail de teste — o motivo da falha aparece na tela', () => {
  it('mostra por que cada endereço não recebeu', async () => {
    // O aviso dizia "veja os motivos abaixo" e não havia nada abaixo: a API
    // devolvia `falhas` e a tela descartava. Quem tentava um teste que falhava
    // — endereço não verificado com o SES em sandbox é o caso comum — ficava sem
    // saber o que corrigir.
    montar();
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome da campanha/i }),
      'Campanha de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));
    await userEvent.click(await screen.findByRole('radio'));
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    await userEvent.type(
      screen.getByRole('textbox', { name: /enviar e-mail de teste/i }),
      'ferarte.fernando@gmail.com',
    );
    await userEvent.click(screen.getByRole('button', { name: /enviar teste/i }));

    expect(await screen.findByText(/is not verified/i)).toBeInTheDocument();
    expect(screen.getByText(/ferarte\.fernando@gmail\.com/)).toBeInTheDocument();
  });
});

describe('seleção vazia trava o disparo', () => {
  /** Leva o assistente até a Etapa 3 com lista escolhida e prévia carregada. */
  async function ateOsDestinatarios() {
    montar();
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome da campanha/i }),
      'Campanha de agosto',
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
      const criacao = posts.find((p) => p.caminho === '/campanhas');
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
      const criacao = posts.find((p) => p.caminho === '/campanhas');
      expect(criacao?.corpo).toMatchObject({ destinatariosSelecionados: ['c-2'] });
    });
  });
});

describe('criar o e-mail do zero na própria campanha', () => {
  /** Leva o assistente até a Etapa 2 com o nome preenchido. */
  async function ateOEmail() {
    montar();
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome da campanha/i }),
      'Campanha de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));
    await screen.findByRole('button', { name: /começar do zero/i });
  }

  it('oferece começar do zero ou usar um modelo salvo', async () => {
    await ateOEmail();

    expect(screen.getByRole('button', { name: /começar do zero/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /usar um modelo salvo/i })).toBeInTheDocument();
  });

  it('do zero, deixa escolher entre criador visual e HTML', async () => {
    await ateOEmail();
    await userEvent.click(screen.getByRole('button', { name: /começar do zero/i }));

    expect(screen.getByRole('button', { name: /criador visual/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /html personalizado/i })).toBeInTheDocument();
  });

  it('não avança do e-mail sem conteúdo montado', async () => {
    // Sem isto, a campanha seguiria para os destinatários com corpo vazio e o
    // problema só apareceria na gravação, longe da tela que o causou.
    await ateOEmail();
    await userEvent.click(screen.getByRole('button', { name: /começar do zero/i }));

    expect(screen.getByRole('button', { name: /avançar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /salvar rascunho/i })).toBeDisabled();
  });
});

describe('o e-mail montado na campanha vira um modelo próprio', () => {
  it('cria o modelo antes da campanha e amarra o id nela', async () => {
    // O envio lê de um modelo com versão congelada. Guardar HTML solto na
    // campanha criaria um segundo caminho de conteúdo, fora do versionamento e
    // da auditoria — por isso o conteúdo montado aqui vira modelo.
    montar();
    await userEvent.type(
      screen.getByRole('textbox', { name: /nome da campanha/i }),
      'Campanha de agosto',
    );
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    await userEvent.click(await screen.findByRole('button', { name: /começar do zero/i }));
    await userEvent.click(screen.getByRole('button', { name: /simular edição visual/i }));
    await userEvent.click(screen.getByRole('button', { name: /avançar/i }));

    await userEvent.selectOptions(await screen.findByRole('combobox'), 'l-1');
    await userEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }));

    await waitFor(() => {
      const modelo = posts.find((p) => p.caminho === '/templates');
      expect(modelo?.corpo).toMatchObject({
        nome: 'Campanha de agosto — e-mail',
        corpoHtml: '<p>oi</p>',
        tipo: 'VISUAL',
      });
    });

    // A campanha aponta para o modelo recém-criado, não para um id vazio.
    const campanha = posts.find((p) => p.caminho === '/campanhas');
    expect(campanha?.corpo).toMatchObject({ templateId: 't-novo' });
  });
});
