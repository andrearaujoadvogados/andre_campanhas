import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './componentes/Layout.tsx';
import { Carregando } from './componentes/base.tsx';
import { useSessao } from './lib/auth.js';
import { Login } from './paginas/Login.tsx';
import { Contatos, ContatoDetalhe } from './paginas/Contatos.tsx';
import { ImportarContatos } from './paginas/ImportarContatos.tsx';
import { Usuarios } from './paginas/Usuarios.tsx';
import { Listas, ListaDetalhe } from './paginas/Listas.tsx';
import { Templates, TemplateEditor } from './paginas/Templates.tsx';
import { Campanhas, CampanhaDetalhe } from './paginas/Campanhas.tsx';
import { Relatorio } from './paginas/Relatorio.tsx';

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      // Uma requisição a menos por foco de janela. O painel não é tempo real —
      // quem precisa disso (o relatório) define o próprio intervalo.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  const { estado, recarregar } = useSessao();

  if (estado.situacao === 'carregando') return <Carregando />;
  if (estado.situacao === 'anonimo') return <Login aoEntrar={recarregar} />;

  const { usuario } = estado;

  return (
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout usuario={usuario} />}>
            <Route index element={<Navigate to="/boletins" replace />} />
            <Route path="/boletins" element={<Campanhas />} />
            <Route path="/boletins/:id" element={<CampanhaDetalhe usuario={usuario} />} />
            <Route path="/listas" element={<Listas />} />
            <Route path="/listas/:id" element={<ListaDetalhe />} />
            <Route path="/contatos" element={<Contatos usuario={usuario} />} />
            {/* Antes de `/:id`, que aceitaria "importar" como identificador. */}
            <Route path="/contatos/importar" element={<ImportarContatos />} />
            <Route path="/contatos/:id" element={<ContatoDetalhe usuario={usuario} />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/templates/:id" element={<TemplateEditor />} />
            <Route path="/relatorios/:id" element={<Relatorio />} />
            <Route path="/usuarios" element={<Usuarios usuario={usuario} />} />
            <Route path="*" element={<Navigate to="/boletins" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
