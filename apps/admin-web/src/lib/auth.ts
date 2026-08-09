import { Amplify } from 'aws-amplify';
import {
  fetchAuthSession,
  signIn,
  signOut,
  confirmSignIn,
  resetPassword,
  confirmResetPassword,
} from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { configuracao } from './configuracao.js';

export type Papel = 'ADMIN' | 'OPERADOR';

export interface Usuario {
  /** A claim `sub`. É por ela que a tela de usuários sabe qual linha é a sua. */
  readonly id: string;
  readonly email: string;
  readonly papeis: readonly Papel[];
}

export function configurarAuth(): void {
  const cfg = configuracao();
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.userPoolId,
        userPoolClientId: cfg.userPoolClientId,
      },
    },
  });
}

/**
 * Papéis lidos das claims, para adaptar a interface.
 *
 * **Isto não é controle de acesso.** Esconder um botão melhora a experiência —
 * ninguém clica no que não pode fazer — mas qualquer pessoa autenticada monta a
 * requisição à mão. Quem decide é o `exigirPapel` do backend (§10.1). Se algum
 * dia a checagem daqui divergir da de lá, é a de lá que vale.
 */
function lerPapeis(claims: Record<string, unknown>): readonly Papel[] {
  const bruto = claims['cognito:groups'];
  const nomes = Array.isArray(bruto) ? bruto.map(String) : [];
  const papeis = new Set<Papel>();
  for (const n of nomes) {
    const v = n.trim().toUpperCase();
    if (v === 'ADMIN') papeis.add('ADMIN');
    if (v === 'OPERADOR') papeis.add('OPERADOR');
  }
  return [...papeis];
}

export type EstadoSessao =
  | { readonly situacao: 'carregando' }
  | { readonly situacao: 'anonimo' }
  | { readonly situacao: 'autenticado'; readonly usuario: Usuario };

export function useSessao(): { estado: EstadoSessao; recarregar: () => void } {
  const [estado, definir] = useState<EstadoSessao>({ situacao: 'carregando' });
  const [gatilho, disparar] = useState(0);

  useEffect(() => {
    let ativo = true;

    void (async () => {
      try {
        const sessao = await fetchAuthSession();
        const claims = sessao.tokens?.idToken?.payload;
        if (claims === undefined) {
          if (ativo) definir({ situacao: 'anonimo' });
          return;
        }
        if (ativo) {
          definir({
            situacao: 'autenticado',
            usuario: {
              id: typeof claims['sub'] === 'string' ? claims['sub'] : '',
              email: typeof claims['email'] === 'string' ? claims['email'] : '',
              papeis: lerPapeis(claims as Record<string, unknown>),
            },
          });
        }
      } catch {
        if (ativo) definir({ situacao: 'anonimo' });
      }
    })();

    return () => {
      ativo = false;
    };
  }, [gatilho]);

  return { estado, recarregar: () => disparar((n) => n + 1) };
}

export const entrar = signIn;
export const confirmarDesafio = confirmSignIn;
export const sair = () => signOut();

/**
 * Recuperação de senha — o pool está configurado com `AccountRecovery.EMAIL_ONLY`.
 *
 * O Cognito envia um código para o e-mail cadastrado. O MFA **não** é
 * redefinido junto: quem recupera a senha continua precisando do aplicativo
 * autenticador para entrar, e é isso que faz a recuperação por e-mail não virar
 * um caminho para contornar o segundo fator.
 */
export const pedirCodigoDeRecuperacao = resetPassword;
export const confirmarNovaSenha = confirmResetPassword;

export const temPapel = (usuario: Usuario, ...aceitos: Papel[]): boolean =>
  usuario.papeis.some((p) => aceitos.includes(p));
