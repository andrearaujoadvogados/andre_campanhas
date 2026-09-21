import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../src/paginas/Login.tsx';
import { confirmarNovaSenha, entrar, pedirCodigoDeRecuperacao } from '../src/lib/auth.js';

const respostas: unknown[] = [];
const desafiosEnviados: string[] = [];

vi.mock('../src/lib/auth.js', () => ({
  entrar: vi.fn(async () => respostas.shift()),
  confirmarDesafio: vi.fn(async ({ challengeResponse }: { challengeResponse: string }) => {
    desafiosEnviados.push(challengeResponse);
    return respostas.shift();
  }),
  pedirCodigoDeRecuperacao: vi.fn(),
  confirmarNovaSenha: vi.fn(),
}));

async function credenciais() {
  await userEvent.type(screen.getByLabelText(/e-mail/i), 'ana@escritorio.com.br');
  await userEvent.type(screen.getByLabelText(/^senha/i), 'ProvisoriA123!');
  await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
}

beforeEach(() => {
  // Sem isto, a contagem de chamadas acumula entre os testes e uma asserção de
  // "não foi chamado" passa a medir o histórico do arquivo, não o do caso.
  vi.clearAllMocks();
  respostas.length = 0;
  desafiosEnviados.length = 0;
});

describe('primeiro acesso — o caminho normal, não caso de borda', () => {
  it('troca a senha provisória e entra', async () => {
    // Contas são criadas por administrador com senha provisória: toda primeira
    // entrada passa por esta etapa. Tratar só as credenciais deixaria a equipe
    // inteira sem conseguir entrar.
    const aoEntrar = vi.fn();
    respostas.push(
      { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } },
      { isSignedIn: true, nextStep: { signInStep: 'DONE' } },
    );

    render(<Login aoEntrar={aoEntrar} />);
    await credenciais();

    const campoSenha = await screen.findByLabelText(/defina uma nova senha/i);
    await userEvent.type(campoSenha, 'NovaSenhaForte123!');
    await userEvent.click(screen.getByRole('button', { name: /salvar senha/i }));

    await waitFor(() => expect(aoEntrar).toHaveBeenCalled());
    expect(desafiosEnviados).toEqual(['NovaSenhaForte123!']);
  });
});

describe('acessos seguintes', () => {
  it('entra direto quando o Cognito já devolve a sessão', async () => {
    const aoEntrar = vi.fn();
    respostas.push({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });

    render(<Login aoEntrar={aoEntrar} />);
    await credenciais();

    await waitFor(() => expect(aoEntrar).toHaveBeenCalled());
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/procure o responsável/i);
  });

  it('não trata mais desafio de segundo fator', async () => {
    // O pool não pede mais TOTP. Se voltar a pedir — alguém religou o MFA no
    // console sem mexer nesta tela —, a pessoa recebe instrução, não uma tela
    // travada sem explicação.
    respostas.push({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
    });

    render(<Login aoEntrar={vi.fn()} />);
    await credenciais();

    expect(await screen.findByRole('alert')).toHaveTextContent(/procure o responsável/i);
  });
});

describe('recuperação de senha', () => {
  it('abre a recuperação sem tentar entrar', async () => {
    // O link fica dentro do formulário. Botão sem `type="button"` seria submit,
    // e a tela tentaria autenticar com a senha errada antes de abrir a recuperação.
    render(<Login aoEntrar={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /esqueci minha senha/i }));

    expect(entrar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /enviar código/i })).toBeInTheDocument();
  });

  it('não revela se o e-mail tem conta', async () => {
    // Esta tela é pública. Mensagem diferente para e-mail cadastrado e não
    // cadastrado a transformaria num verificador de quem trabalha no escritório.
    vi.mocked(pedirCodigoDeRecuperacao).mockResolvedValue({
      nextStep: { codeDeliveryDetails: { destination: 'f***@g***.com' } },
    } as never);

    render(<Login aoEntrar={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'qualquer@exemplo.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar código/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/se houver uma conta/i);
  });

  it('troca a senha e volta ao login, sem entrar sozinho', async () => {
    // O Cognito não devolve sessão aqui. Emendar um `entrar` automático
    // esconderia uma falha de senha atrás de uma tela que diz "pronto".
    vi.mocked(pedirCodigoDeRecuperacao).mockResolvedValue({
      nextStep: { codeDeliveryDetails: { destination: 'f***@g***.com' } },
    } as never);
    vi.mocked(confirmarNovaSenha).mockResolvedValue(undefined as never);

    render(<Login aoEntrar={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'alguem@exemplo.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar código/i }));

    await userEvent.type(await screen.findByLabelText(/código recebido/i), '123456');
    await userEvent.type(screen.getByLabelText(/nova senha/i), 'SenhaNova!2026');
    await userEvent.click(screen.getByRole('button', { name: /alterar senha/i }));

    expect(vi.mocked(confirmarNovaSenha)).toHaveBeenCalledWith({
      username: 'alguem@exemplo.com',
      confirmationCode: '123456',
      newPassword: 'SenhaNova!2026',
    });
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('descarta o código ao voltar para o login', async () => {
    // Sem isso, o código digitado sobreviveria à navegação e reapareceria numa
    // etapa em que ele não vale mais.
    vi.mocked(pedirCodigoDeRecuperacao).mockResolvedValue({
      nextStep: { codeDeliveryDetails: { destination: 'f***@g***.com' } },
    } as never);

    render(<Login aoEntrar={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'alguem@exemplo.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar código/i }));
    await userEvent.type(await screen.findByLabelText(/código recebido/i), '999');

    await userEvent.click(screen.getByRole('button', { name: /voltar para o login/i }));
    await userEvent.click(screen.getByRole('button', { name: /esqueci minha senha/i }));
    await userEvent.type(screen.getByLabelText(/e-mail/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /enviar código/i }));

    expect(await screen.findByLabelText(/código recebido/i)).toHaveValue('');
  });
});
