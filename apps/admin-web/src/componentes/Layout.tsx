import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { sair, type Usuario } from '../lib/auth.js';
import { Logo } from './Logo.tsx';

const SECOES = [
  // `end` porque a raiz casaria com todas as rotas: sem isso, "Visão geral"
  // ficaria marcado como seção atual em qualquer tela do painel.
  { para: '/', rotulo: 'Visão geral', end: true },
  { para: '/boletins', rotulo: 'Boletins' },
  { para: '/listas', rotulo: 'Listas' },
  { para: '/contatos', rotulo: 'Contatos' },
  { para: '/templates', rotulo: 'Modelos' },
  { para: '/tipos', rotulo: 'Tipos' },
  // Só ADMIN. Esconder não é o controle — o controle é o `exigirPapel` da API —,
  // mas oferecer um link que devolve 403 é pior que não oferecer.
  { para: '/usuarios', rotulo: 'Usuários', somenteAdmin: true },
];

const classeLink = ({ isActive }: { isActive: boolean }): string =>
  `flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
    isActive ? 'bg-ink text-paper-light' : 'text-ink-suave hover:bg-accent-mist hover:text-ink'
  }`;

/**
 * O logo é o caminho de volta ao início — convenção que ninguém precisa aprender.
 *
 * Aponta para `/`, não para `/boletins`: a rota raiz decide qual é a tela
 * inicial, e se um dia ela deixar de ser a lista de boletins, este link não
 * precisa saber. O `aria-label` existe porque o conteúdo do link é uma imagem,
 * e "André Araújo Advogados" sozinho não diria a quem usa leitor de tela que
 * clicar leva para algum lugar.
 */
function LogoInicio({ aoNavegar, className }: { aoNavegar?: () => void; className: string }) {
  return (
    <Link
      to="/"
      onClick={aoNavegar}
      aria-label="André Araújo Advogados — ir para a tela inicial"
      className="flex items-center rounded-md text-wine transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <Logo className={className} />
    </Link>
  );
}

function Navegacao({ visiveis, aoNavegar }: { visiveis: typeof SECOES; aoNavegar?: () => void }) {
  return (
    <nav aria-label="Seções do painel" className="flex flex-col gap-1">
      {visiveis.map((s) => (
        <NavLink
          key={s.para}
          to={s.para}
          end={s.end === true}
          className={classeLink}
          onClick={aoNavegar}
        >
          {s.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}

function BlocoUsuario({ usuario, ehAdmin }: { usuario: Usuario; ehAdmin: boolean }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="truncate px-3 text-sm text-ink" title={usuario.email}>
        {usuario.email}
      </p>
      {/* O papel fica visível: evita a dúvida "por que não vejo esse botão?" */}
      <p className="px-3 text-xs text-ink-suave">{ehAdmin ? 'Administrador' : 'Operador'}</p>
      <button
        type="button"
        onClick={() => void sair()}
        className="mt-2 flex min-h-11 w-full items-center rounded-md px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink"
      >
        Sair
      </button>
    </div>
  );
}

export function Layout({ usuario }: { usuario: Usuario }) {
  const [menuAberto, definirMenuAberto] = useState(false);
  const local = useLocation();
  const ehAdmin = usuario.papeis.includes('ADMIN');
  const visiveis = SECOES.filter((s) => s.somenteAdmin !== true || ehAdmin);

  /**
   * Esc fecha o menu do celular.
   *
   * O painel cobre a tela inteira; sem isso, quem abriu sem querer só sai
   * acertando o botão de fechar — e quem navega por teclado não sai de jeito
   * nenhum.
   */
  useEffect(() => {
    if (!menuAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') definirMenuAberto(false);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [menuAberto]);

  return (
    <div className="min-h-screen bg-paper">
      {/**
       * Primeiro elemento focável da página.
       *
       * Sem ele, quem navega por teclado percorre o logo e os cinco itens da
       * barra lateral a cada troca de tela antes de chegar ao conteúdo. Fica
       * invisível até receber foco — exigência 2.4.1 do WCAG.
       */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper-light"
      >
        Ir para o conteúdo
      </a>

      {/**
       * Barra lateral fixa, a partir de `lg`.
       *
       * Fixa e não rolável junto do conteúdo: numa listagem longa de contatos, a
       * navegação sumiria da tela justamente quando se quer trocar de seção.
       */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-paper-light lg:flex">
        <div className="border-b border-line px-4 py-5">
          <LogoInicio className="h-9 w-auto" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Navegacao visiveis={visiveis} />
        </div>

        <div className="px-3 pb-4">
          <BlocoUsuario usuario={usuario} ehAdmin={ehAdmin} />
        </div>
      </aside>

      {/**
       * Barra superior do celular: o logo continua no canto esquerdo.
       *
       * O menu aberto fica **dentro** do header, e não posicionado por cima com
       * um deslocamento fixo. Assim ele encosta na barra sozinho — um `top`
       * cravado em pixels quebraria no dia em que a altura da barra mudasse, e
       * quebraria em silêncio. O `z-40` mantém a barra acima do fundo escurecido:
       * com o mesmo z-index, o fundo cobria o próprio logo.
       */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper-light lg:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <LogoInicio className="h-7 w-auto" aoNavegar={() => definirMenuAberto(false)} />

          <button
            type="button"
            onClick={() => definirMenuAberto((v) => !v)}
            aria-expanded={menuAberto}
            aria-controls="menu-lateral"
            className="inline-flex size-11 items-center justify-center rounded-md text-ink"
          >
            <span className="sr-only">{menuAberto ? 'Fechar menu' : 'Abrir menu'}</span>
            <span aria-hidden="true" className="text-lg">
              {menuAberto ? '✕' : '☰'}
            </span>
          </button>
        </div>

        {menuAberto && (
          <div id="menu-lateral" className="border-t border-line px-3 py-4 shadow-lg">
            <Navegacao visiveis={visiveis} aoNavegar={() => definirMenuAberto(false)} />
            <div className="mt-4">
              <BlocoUsuario usuario={usuario} ehAdmin={ehAdmin} />
            </div>
          </div>
        )}
      </header>

      {menuAberto && (
        /**
         * Clicar fora fecha — o gesto que todo mundo tenta primeiro.
         *
         * Invisível para leitor de tela e fora da ordem de tabulação de
         * propósito: é atalho de ponteiro, e anunciá-lo criaria um segundo
         * "fechar menu" competindo com o botão ✕. Quem não usa mouse fecha pelo
         * ✕ ou pelo Esc.
         */
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => definirMenuAberto(false)}
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
        />
      )}

      {/**
       * `key` no caminho faz o React remontar o conteúdo a cada navegação, o que
       * devolve o foco ao topo. Sem isso, quem usa leitor de tela troca de tela e
       * continua ouvindo a partir da posição da anterior.
       */}
      <main
        id="conteudo"
        key={local.pathname}
        tabIndex={-1}
        className="px-4 py-6 sm:px-6 sm:py-8 lg:pl-72"
      >
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
