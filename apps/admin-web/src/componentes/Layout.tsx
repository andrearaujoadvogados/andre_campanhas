import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { sair, type Usuario } from '../lib/auth.js';

const SECOES = [
  { para: '/campanhas', rotulo: 'Campanhas' },
  { para: '/listas', rotulo: 'Listas' },
  { para: '/contatos', rotulo: 'Contatos' },
  { para: '/templates', rotulo: 'Modelos' },
  // Só ADMIN. Esconder não é o controle — o controle é o `exigirPapel` da API —,
  // mas oferecer um link que devolve 403 é pior que não oferecer.
  { para: '/usuarios', rotulo: 'Usuários', somenteAdmin: true },
];

const classeLink = ({ isActive }: { isActive: boolean }): string =>
  `flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
    isActive ? 'bg-ink text-paper-light' : 'text-ink-suave hover:bg-accent-mist hover:text-ink'
  }`;

export function Layout({ usuario }: { usuario: Usuario }) {
  const [menuAberto, definirMenuAberto] = useState(false);
  const local = useLocation();
  const ehAdmin = usuario.papeis.includes('ADMIN');
  const visiveis = SECOES.filter((s) => s.somenteAdmin !== true || ehAdmin);

  return (
    <div className="min-h-screen bg-paper">
      {/**
       * Primeiro elemento focável da página.
       *
       * Sem ele, quem navega por teclado percorre os cinco links do menu a cada
       * troca de tela antes de chegar ao conteúdo. Fica invisível até receber
       * foco — exigência 2.4.1 do WCAG.
       */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper-light"
      >
        Ir para o conteúdo
      </a>

      <header className="border-b border-line bg-paper-light">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6 lg:gap-8">
            <span className="font-display text-base font-medium text-ink">
              Campanhas
              <span className="ml-2 hidden font-sans text-sm font-normal text-ink-suave sm:inline">
                André Araújo Advogados
              </span>
            </span>

            <nav aria-label="Seções do painel" className="hidden gap-1 md:flex">
              {visiveis.map((s) => (
                <NavLink key={s.para} to={s.para} className={classeLink}>
                  {s.rotulo}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm text-ink">{usuario.email}</p>
              {/* O papel fica visível: evita a dúvida "por que não vejo esse botão?" */}
              <p className="text-xs text-ink-suave">{ehAdmin ? 'Administrador' : 'Operador'}</p>
            </div>

            <button
              type="button"
              onClick={() => void sair()}
              className="hidden min-h-11 items-center rounded-md border border-line px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink sm:inline-flex"
            >
              Sair
            </button>

            <button
              type="button"
              onClick={() => definirMenuAberto((v) => !v)}
              aria-expanded={menuAberto}
              aria-controls="menu-movel"
              className="inline-flex size-11 items-center justify-center rounded-md text-ink md:hidden"
            >
              <span className="sr-only">{menuAberto ? 'Fechar menu' : 'Abrir menu'}</span>
              <span aria-hidden="true" className="text-lg">
                {menuAberto ? '✕' : '☰'}
              </span>
            </button>
          </div>
        </div>

        {menuAberto && (
          <nav
            id="menu-movel"
            aria-label="Seções do painel"
            className="border-t border-line px-4 py-2 md:hidden"
          >
            <div className="flex flex-col gap-1">
              {visiveis.map((s) => (
                <NavLink
                  key={s.para}
                  to={s.para}
                  className={classeLink}
                  // Fecha ao navegar: no celular o menu cobriria a tela recém-aberta.
                  onClick={() => definirMenuAberto(false)}
                >
                  {s.rotulo}
                </NavLink>
              ))}
            </div>
            <div className="mt-2 border-t border-line pt-2">
              <p className="px-3 text-sm text-ink">{usuario.email}</p>
              <p className="px-3 text-xs text-ink-suave">
                {ehAdmin ? 'Administrador' : 'Operador'}
              </p>
              <button
                type="button"
                onClick={() => void sair()}
                className="mt-1 flex min-h-11 w-full items-center rounded-md px-3 text-sm font-medium text-ink-suave hover:bg-accent-mist hover:text-ink"
              >
                Sair
              </button>
            </div>
          </nav>
        )}
      </header>

      {/**
       * `key` no caminho faz o React remontar o conteúdo a cada navegação, o que
       * devolve o foco ao topo. Sem isso, quem usa leitor de tela troca de tela e
       * continua ouvindo a partir da posição da anterior.
       */}
      <main
        id="conteudo"
        key={local.pathname}
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
