import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/paginas/Login.tsx';

const respostas: unknown[] = [];
const desafiosEnviados: string[] = [];

vi.mock('../src/lib/auth.js', () => ({
  entrar: vi.fn(async () => respostas.shift()),
  confirmarDesafio: vi.fn(async ({ challengeResponse }: { challengeResponse: string }) => {
    desafiosEnviados.push(challengeResponse);
    return respostas.shift();
  }),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') },
}));

const SETUP_TOTP = {
  isSignedIn: false,
  nextStep: {
    signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP',
    totpSetupDetails: {
      sharedSecret: 'CHAVE-SECRETA-BASE32',
      getSetupUri: () => new URL('otpauth://totp/Campanhas?secret=X'),
    },
  },
};

async function credenciais() {
  await userEvent.type(screen.getByLabelText(/e-mail/i), 'ana@escritorio.com.br');
  await userEvent.type(screen.getByLabelText(/^senha/i), 'ProvisoriA123!');
  await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
}

beforeEach(() => {
  respostas.length = 0;
  desafiosEnviados.length = 0;
});

describe('primeiro acesso — o caminho normal, não caso de borda', () => {
  it('percorre senha provisória, nova senha, cadastro do TOTP e código', async () => {
    // Contas são criadas por administrador e o MFA é obrigatório no pool: toda
    // primeira entrada passa por estas três etapas. Tratar só a primeira
    // deixaria a equipe inteira sem conseguir entrar.
    const aoEntrar = vi.fn();
    respostas.push(
      { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } },
      SETUP_TOTP,
      { isSignedIn: true, nextStep: { signInStep: 'DONE' } },
    );

    render(<Login aoEntrar={aoEntrar} />);
    await credenciais();

    // 1. Nova senha
    const campoSenha = await screen.findByLabelText(/defina uma nova senha/i);
    await userEvent.type(campoSenha, 'NovaSenhaForte123!');
    await userEvent.click(screen.getByRole('button', { name: /salvar senha/i }));

    // 2. Cadastro do autenticador
    expect(await screen.findByAltText(/código qr/i)).toHaveAttribute(
      'src',
      'data:image/png;base64,QR',
    );

    await userEvent.type(screen.getByLabelText(/código de 6 dígitos/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /confirmar código/i }));

    await waitFor(() => expect(aoEntrar).toHaveBeenCalled());
    expect(desafiosEnviados).toEqual(['NovaSenhaForte123!', '123456']);
  });

  it('oferece a chave em texto para quem não consegue ler o QR', async () => {
    // Quem acessa pelo celular não fotografa a própria tela — e é essa pessoa
    // que ficaria travada se o QR fosse a única opção.
    respostas.push(SETUP_TOTP);
    render(<Login aoEntrar={vi.fn()} />);
    await credenciais();

    await screen.findByAltText(/código qr/i);
    await userEvent.click(screen.getByText(/não consigo ler o código/i));

    expect(screen.getByText('CHAVE-SECRETA-BASE32')).toBeInTheDocument();
  });
});

describe('acessos seguintes', () => {
  it('pede só o código do autenticador', async () => {
    const aoEntrar = vi.fn();
    respostas.push(
      { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } },
      { isSignedIn: true, nextStep: { signInStep: 'DONE' } },
    );

    render(<Login aoEntrar={aoEntrar} />);
    await credenciais();

    await userEvent.type(await screen.findByLabelText(/código de 6 dígitos/i), '654321');
    await userEvent.click(screen.getByRole('button', { name: /confirmar código/i }));

    await waitFor(() => expect(aoEntrar).toHaveBeenCalled());
  });

  it('entra direto quando o Cognito já devolve a sessão', async () => {
    const aoEntrar = vi.fn();
    respostas.push({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });

    render(<Login aoEntrar={aoEntrar} />);
    await credenciais();

    await waitFor(() => expect(aoEntrar).toHaveBeenCalled());
  });

  it('aceita só dígitos no campo de código', async () => {
    respostas.push({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
    });
    render(<Login aoEntrar={vi.fn()} />);
    await credenciais();

    const campo = await screen.findByLabelText(/código de 6 dígitos/i);
    await userEvent.type(campo, 'a1b2c3');

    expect(campo).toHaveValue('123');
  });
});

describe('etapas não suportadas', () => {
  it('explica o que fazer em vez de travar em silêncio', async () => {
    respostas.push({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' },
    });

    render(<Login aoEntrar={vi.fn()} />);
    await credenciais();

    expect(await screen.findByRole('alert')).toHaveTextContent(/procure a avante/i);
  });

  it('avisa quando o Cognito não devolve os dados do TOTP', async () => {
    respostas.push({
      isSignedIn: false,
      nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP' },
    });

    render(<Login aoEntrar={vi.fn()} />);
    await credenciais();

    expect(await screen.findByRole('alert')).toHaveTextContent(/dados de cadastro/i);
  });
});
