import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorEmail } from '../src/componentes/EditorEmail.tsx';

/**
 * O que estes testes protegem não é o TipTap — é a fronteira entre o editor e o
 * resto do sistema: o HTML que sai daqui precisa ser o que o `email-render`
 * consegue processar, e os campos de personalização precisam sair grafados
 * exatamente como o `montarEscopo` os expõe.
 */

describe('editor de e-mail', () => {
  it('mostra o conteúdo recebido', () => {
    render(<EditorEmail valor="<p>Prezado cliente</p>" aoMudar={vi.fn()} />);

    expect(screen.getByText('Prezado cliente')).toBeInTheDocument();
  });

  it('oferece exatamente os campos que o renderizador conhece', () => {
    // Um campo a mais aqui vira `{{contato.sobrenome}}` no e-mail, que o Liquid
    // resolve para string vazia sem erro nenhum — some no envio, e ninguém vê.
    render(<EditorEmail valor="<p></p>" aoMudar={vi.fn()} />);

    const seletor = screen.getByLabelText('Inserir campo do contato');
    const valores = [...seletor.querySelectorAll('option')]
      .map((o) => o.getAttribute('value'))
      .filter((v) => v !== '');

    expect(valores).toEqual(['{{contato.primeiroNome}}', '{{contato.nome}}', '{{contato.email}}']);
  });

  it('permite editar o HTML direto, para quem precisa colar um pronto', async () => {
    const aoMudar = vi.fn();
    render(<EditorEmail valor="<p>Original</p>" aoMudar={aoMudar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Editar HTML' }));

    const area = screen.getByRole('textbox');
    expect(area).toHaveValue('<p>Original</p>');

    await userEvent.clear(area);
    await userEvent.type(area, '<p>Colado</p>');

    expect(aoMudar).toHaveBeenCalled();
  });

  it('a barra oferece as ferramentas de formatação', () => {
    render(<EditorEmail valor="<p></p>" aoMudar={vi.fn()} />);

    for (const nome of ['Negrito', 'Itálico', 'Sublinhado', 'Lista com marcadores', 'Link']) {
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
    }
  });

  it('não oferece bloco de código, que renderiza mal em cliente de e-mail', () => {
    render(<EditorEmail valor="<p></p>" aoMudar={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /código/i })).not.toBeInTheDocument();
  });
});

describe('normalização do HTML de saída', () => {
  it('desembrulha o parágrafo que o editor põe dentro de cada item de lista', async () => {
    // Sem isto, o cliente de e-mail aplica a margem padrão do <p> e a lista sai
    // com os itens afastados como parágrafos soltos.
    const aoMudar = vi.fn();
    render(<EditorEmail valor="<ul><li>Primeiro</li></ul>" aoMudar={aoMudar} />);

    const editavel = document.querySelector('.ProseMirror') as HTMLElement;
    editavel.focus();
    await userEvent.type(editavel, ' e mais');

    const ultimo = aoMudar.mock.calls.at(-1)?.[0] as string;
    expect(ultimo).toContain('<li>');
    expect(ultimo).not.toMatch(/<li><p>/);
  });
});
