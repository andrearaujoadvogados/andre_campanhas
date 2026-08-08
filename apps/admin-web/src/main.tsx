import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { configurarAuth } from './lib/auth.js';
import { carregarConfiguracao } from './lib/configuracao.js';
import './index.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Elemento #raiz não encontrado.');

/**
 * A configuração vem antes de tudo.
 *
 * O Amplify precisa dela para se configurar, e a API para saber com quem
 * falar — montar a árvore antes deixaria o painel de pé sem conseguir
 * autenticar, que é uma falha mais confusa do que não subir.
 */
carregarConfiguracao()
  .then(() => {
    configurarAuth();
    createRoot(raiz).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((erro: unknown) => {
    // Sem configuração não há painel. Uma tela em branco faria o operador
    // recarregar por minutos; esta ao menos diz o que aconteceu.
    raiz.innerHTML =
      '<div style="font-family:system-ui;padding:2rem;color:#7f1d1d">' +
      '<strong>Não foi possível carregar a configuração do painel.</strong>' +
      '<p>Recarregue a página. Se persistir, avise quem administra o sistema.</p>' +
      '</div>';
    console.error(erro);
  });
