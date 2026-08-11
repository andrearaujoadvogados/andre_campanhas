import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '../src/componentes/Layout.tsx';
import type { Usuario } from '../src/lib/auth.js';

vi.mock('../src/lib/auth.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  sair: vi.fn(),
}));

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

function montar(usuario: Usuario, rota = '/campanhas') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route element={<Layout usuario={usuario} />}>
          <Route path="/campanhas" element={<p>conteúdo das campanhas</p>} />
          <Route path="/contatos" element={<p>conteúdo dos contatos</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('logo do escritório', () => {
  it('aparece e leva para a tela inicial', () => {
    montar(ADMIN);

    // Há duas instâncias — barra lateral e topo do celular —, e as duas apontam
    // para a raiz. Qual delas está visível é decisão do CSS, não do teste.
    const links = screen.getAllByRole('link', { name: /andré araújo advogados/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/');
  });

  it('aponta para a raiz, não para /campanhas', () => {
    // A rota raiz é quem decide qual é a tela inicial. Se um dia deixar de ser a
    // lista de campanhas, o logo não precisa ser tocado.
    montar(ADMIN);

    for (const l of screen.getAllByRole('link', { name: /andré araújo advogados/i })) {
      expect(l.getAttribute('href')).not.toBe('/campanhas');
    }
  });

  it('é anunciado como imagem com o nome do escritório', () => {
    montar(ADMIN);
    expect(screen.getAllByRole('img', { name: 'André Araújo Advogados' }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('navegação lateral', () => {
  it('lista as seções do painel', () => {
    montar(ADMIN);
    const barras = screen.getAllByRole('navigation', { name: /seções do painel/i });

    for (const rotulo of ['Campanhas', 'Listas', 'Contatos', 'Modelos']) {
      expect(within(barras[0] as HTMLElement).getByRole('link', { name: rotulo })).toBeVisible();
    }
  });

  it('esconde Usuários de quem não é ADMIN', () => {
    // Esconder é conveniência, não segurança — quem barra é o `exigirPapel` da
    // API. Mas oferecer um link que devolve 403 é pior que não oferecer.
    montar(OPERADOR);
    expect(screen.queryByRole('link', { name: 'Usuários' })).toBeNull();
  });

  it('mostra Usuários para ADMIN', () => {
    montar(ADMIN);
    expect(screen.getAllByRole('link', { name: 'Usuários' }).length).toBeGreaterThan(0);
  });

  it('marca a seção atual para leitor de tela', () => {
    montar(ADMIN, '/contatos');
    const atuais = screen
      .getAllByRole('link', { name: 'Contatos' })
      .filter((l) => l.getAttribute('aria-current') === 'page');

    expect(atuais.length).toBeGreaterThan(0);
  });
});

describe('identidade e saída', () => {
  it('mostra e-mail e papel do usuário', () => {
    montar(ADMIN);
    expect(screen.getAllByText('admin@escritorio.com.br').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Administrador').length).toBeGreaterThan(0);
  });

  it('chama Operador quem não é ADMIN', () => {
    montar(OPERADOR);
    expect(screen.getAllByText('Operador').length).toBeGreaterThan(0);
  });
});

describe('menu do celular', () => {
  it('abre e fecha pelo botão', async () => {
    montar(ADMIN);
    const abrir = screen.getByRole('button', { name: /abrir menu/i });

    expect(abrir).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(abrir);

    const fechar = screen.getByRole('button', { name: /fechar menu/i });
    expect(fechar).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(fechar);
    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('fecha com Esc — o painel cobre a tela inteira', async () => {
    montar(ADMIN);
    await userEvent.click(screen.getByRole('button', { name: /abrir menu/i }));

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('fecha ao navegar — senão cobriria a tela recém-aberta', async () => {
    montar(ADMIN);
    await userEvent.click(screen.getByRole('button', { name: /abrir menu/i }));

    const links = screen.getAllByRole('link', { name: 'Contatos' });
    await userEvent.click(links[links.length - 1] as HTMLElement);

    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('acessibilidade da estrutura', () => {
  it('o primeiro elemento focável pula para o conteúdo', async () => {
    montar(ADMIN);
    await userEvent.tab();

    expect(screen.getByRole('link', { name: /ir para o conteúdo/i })).toHaveFocus();
  });
});
