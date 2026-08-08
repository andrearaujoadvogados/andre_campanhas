import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorEmail } from './componentes/EditorEmail.tsx';
import './index.css';

function Prova() {
  const [html, definirHtml] = useState(
    '<h2>Comunicado do escritório</h2><p>Prezado(a) {{contato.primeiroNome}},</p><p>Informamos as <strong>alterações recentes</strong> na legislação:</p><ul><li>Primeiro ponto</li><li>Segundo ponto</li></ul><p><a href="https://andrearaujoadvogados.com.br">Leia a análise completa</a></p>',
  );
  return (
    <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <EditorEmail valor={html} aoMudar={definirHtml} />
      <pre
        style={{
          marginTop: 16,
          fontSize: 11,
          background: '#f1f5f9',
          padding: 12,
          whiteSpace: 'pre-wrap',
        }}
      >
        {html}
      </pre>
    </div>
  );
}
const raiz = document.getElementById('raiz');
if (raiz !== null)
  createRoot(raiz).render(
    <StrictMode>
      <Prova />
    </StrictMode>,
  );
