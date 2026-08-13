import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrocarAutenticador } from '../src/componentes/TrocarAutenticador.tsx';

const iniciar = vi.fn();
const confirmar = vi.fn();

vi.mock('../src/lib/auth.js', () => ({
  iniciarTrocaDeAutenticador: (...args: unknown[]) => iniciar(...args) as Promise<unknown>,
  confirmarTrocaDeAutenticador: (...args: unknown[]) => confirmar(...args) as Promise<unknown>,
}));

// O qrcode desenha em canvas, que o jsdom não implementa. O que importa aqui é
// que a URI com o segredo NUNCA sai da máquina — vai para a lib local, não
// para um serviço de imagem.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (uri: string) => `data:image/png;qr-de-${uri.length}`) },
}));

beforeEach(() => {
  iniciar.mockReset().mockResolvedValue({ uri: 'otpauth://totp/x?secret=NOVO', segredo: 'NOVO' });
  confirmar.mockReset().mockResolvedValue(undefined);
});

describe('troca do aplicativo autenticador', () => {
  it('abre com QR e segredo manual, e só habilita confirmar com 6 dígitos', async () => {
    render(<TrocarAutenticador email="admin@escritorio.com.br" />);

    await userEvent.click(screen.getByRole('button', { name: /trocar autenticador/i }));

    expect(await screen.findByAltText(/qr code/i)).toBeInTheDocument();
    expect(screen.getByText('NOVO')).toBeInTheDocument();
    expect(iniciar).toHaveBeenCalledWith('admin@escritorio.com.br');

    const botao = screen.getByRole('button', { name: /confirmar troca/i });
    expect(botao).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/código de 6 dígitos/i), '123456');
    expect(botao).toBeEnabled();
  });

  it('confirmar com o código certo conclui e avisa que o antigo caducou', async () => {
    render(<TrocarAutenticador email="a@b.com" />);

    await userEvent.click(screen.getByRole('button', { name: /trocar autenticador/i }));
    await screen.findByAltText(/qr code/i);
    await userEvent.type(screen.getByLabelText(/código de 6 dígitos/i), '654321');
    await userEvent.click(screen.getByRole('button', { name: /confirmar troca/i }));

    expect(await screen.findByText(/autenticador trocado/i)).toBeInTheDocument();
    expect(screen.getByText(/código anterior não vale mais/i)).toBeInTheDocument();
    expect(confirmar).toHaveBeenCalledWith('654321');
  });

  it('código errado explica e deixa tentar de novo — sem invalidar o antigo', async () => {
    confirmar.mockRejectedValueOnce(new Error('Code mismatch'));
    render(<TrocarAutenticador email="a@b.com" />);

    await userEvent.click(screen.getByRole('button', { name: /trocar autenticador/i }));
    await screen.findByAltText(/qr code/i);
    await userEvent.type(screen.getByLabelText(/código de 6 dígitos/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /confirmar troca/i }));

    expect(await screen.findByText(/código não confere/i)).toBeInTheDocument();
    // O formulário continua aberto para a nova tentativa.
    expect(screen.getByRole('button', { name: /confirmar troca/i })).toBeInTheDocument();
  });

  it('falha ao iniciar aparece na tela em vez de travar em "gerando"', async () => {
    iniciar.mockRejectedValueOnce(new Error('sessão expirada'));
    render(<TrocarAutenticador email="a@b.com" />);

    await userEvent.click(screen.getByRole('button', { name: /trocar autenticador/i }));

    expect(await screen.findByText(/sessão expirada/i)).toBeInTheDocument();
  });
});
