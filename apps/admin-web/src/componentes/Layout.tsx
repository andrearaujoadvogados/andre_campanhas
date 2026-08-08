import { NavLink, Outlet } from 'react-router-dom';
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

export function Layout({ usuario }: { usuario: Usuario }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold text-slate-900">
              Campanhas
              <span className="ml-2 font-normal text-slate-500">André Araújo Advogados</span>
            </span>
            <nav className="flex gap-1">
              {SECOES.filter(
                (s) => s.somenteAdmin !== true || usuario.papeis.includes('ADMIN'),
              ).map((s) => (
                <NavLink
                  key={s.para}
                  to={s.para}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  {s.rotulo}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{usuario.email}</span>
            {/* O papel fica visível: evita a dúvida "por que não vejo esse botão?" */}
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {usuario.papeis.includes('ADMIN') ? 'Administrador' : 'Operador'}
            </span>
            <button
              type="button"
              onClick={() => void sair()}
              className="text-slate-500 underline hover:text-slate-900"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
