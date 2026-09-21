import { useState, type FormEvent } from 'react';
import {
  confirmarDesafio,
  confirmarNovaSenha,
  entrar,
  pedirCodigoDeRecuperacao,
} from '../lib/auth.js';
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  ErroCaixa,
  TituloPagina,
  classeEntrada,
} from '../componentes/base.tsx';

/**
 * Etapas do login.
 *
 * Contas são criadas por administrador, sem autocadastro, e a senha do convite
 * é provisória. Trocar a senha no primeiro acesso é, por isso, o caminho
 * **normal** de todo usuário, não caso de borda — tratar só as credenciais
 * deixaria a equipe sem conseguir entrar.
 */
type Etapa =
  | { readonly nome: 'credenciais' }
  | { readonly nome: 'nova-senha' }
  /** Recuperação: pedir o código, e depois trocar a senha com ele. */
  | { readonly nome: 'recuperar-pedir' }
  | { readonly nome: 'recuperar-confirmar'; readonly destino: string };

interface ProximaEtapa {
  signInStep: string;
}

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [etapa, definirEtapa] = useState<Etapa>({ nome: 'credenciais' });
  const [email, definirEmail] = useState('');
  const [senha, definirSenha] = useState('');
  const [resposta, definirResposta] = useState('');
  const [codigo, definirCodigo] = useState('');
  const [erro, definirErro] = useState<unknown>(null);
  const [aviso, definirAviso] = useState('');
  const [enviando, definirEnviando] = useState(false);

  function irPara(nova: Etapa) {
    definirErro(null);
    definirResposta('');
    definirCodigo('');
    definirEtapa(nova);
  }

  function avancar(proxima: ProximaEtapa): boolean {
    switch (proxima.signInStep) {
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        definirEtapa({ nome: 'nova-senha' });
        return false;

      case 'DONE':
        return true;

      default:
        definirErro(
          new Error(
            `Etapa de autenticação não suportada nesta tela: ${proxima.signInStep}. Procure o responsável pelo sistema.`,
          ),
        );
        return false;
    }
  }

  async function submeter(e: FormEvent) {
    e.preventDefault();
    definirErro(null);
    definirEnviando(true);

    try {
      /**
       * Pedir o código.
       *
       * A mensagem de sucesso é a mesma para e-mail cadastrado e não cadastrado,
       * e o Cognito se comporta assim de propósito: uma resposta diferente para
       * cada caso transformaria esta tela — que é pública — num verificador de
       * quem tem conta no sistema.
       */
      if (etapa.nome === 'recuperar-pedir') {
        const r = await pedirCodigoDeRecuperacao({ username: email });
        const d = r.nextStep.codeDeliveryDetails;
        irPara({ nome: 'recuperar-confirmar', destino: d?.destination ?? 'seu e-mail' });
        definirAviso(
          `Se houver uma conta com este e-mail, um código foi enviado para ${d?.destination ?? 'ele'}.`,
        );
        return;
      }

      if (etapa.nome === 'recuperar-confirmar') {
        await confirmarNovaSenha({
          username: email,
          confirmationCode: codigo,
          newPassword: resposta,
        });
        // Volta para o login em vez de entrar sozinho: o Cognito não devolve
        // sessão aqui, e emendar um `entrar` automático esconderia uma falha de
        // senha atrás de uma tela que diz "pronto".
        irPara({ nome: 'credenciais' });
        definirSenha('');
        definirAviso('Senha alterada. Entre com a senha nova.');
        return;
      }

      const r =
        etapa.nome === 'credenciais'
          ? await entrar({ username: email, password: senha })
          : await confirmarDesafio({ challengeResponse: resposta });

      definirResposta('');

      if (r.isSignedIn) {
        aoEntrar();
        return;
      }
      if (avancar(r.nextStep as ProximaEtapa)) aoEntrar();
    } catch (e2) {
      definirErro(e2);
    } finally {
      definirEnviando(false);
    }
  }

  const ROTULO_BOTAO: Record<Etapa['nome'], string> = {
    credenciais: 'Entrar',
    'nova-senha': 'Salvar senha',
    'recuperar-pedir': 'Enviar código',
    'recuperar-confirmar': 'Alterar senha',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <Cartao>
          <form onSubmit={(e) => void submeter(e)} className="space-y-4">
            <div>
              <TituloPagina>Campanhas</TituloPagina>
              <p className="mt-1 text-sm text-ink-suave">André Araújo Advogados</p>
            </div>

            <Aviso texto={aviso} />
            <ErroCaixa erro={erro} />

            {etapa.nome === 'credenciais' && (
              <>
                <Campo rotulo="E-mail" obrigatorio>
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(ev) => definirEmail(ev.target.value)}
                    className={classeEntrada}
                  />
                </Campo>
                <Campo rotulo="Senha" obrigatorio>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={senha}
                    onChange={(ev) => definirSenha(ev.target.value)}
                    className={classeEntrada}
                  />
                </Campo>

                {/**
                 * Fora do fluxo de submissão, e por isso `type="button"`: dentro de
                 * um formulário, botão sem tipo é `submit` — este tentaria entrar
                 * com a senha errada antes de abrir a recuperação.
                 */}
                <button
                  type="button"
                  onClick={() => {
                    definirAviso('');
                    irPara({ nome: 'recuperar-pedir' });
                  }}
                  className="-mt-1 inline-flex min-h-11 items-center text-sm text-ink-suave underline hover:text-ink"
                >
                  Esqueci minha senha
                </button>
              </>
            )}

            {etapa.nome === 'recuperar-pedir' && (
              <>
                <p className="text-sm text-ink-suave">
                  Informe o e-mail da sua conta. Enviaremos um código para você definir uma senha
                  nova.
                </p>
                <Campo rotulo="E-mail" obrigatorio>
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(ev) => definirEmail(ev.target.value)}
                    className={classeEntrada}
                  />
                </Campo>
              </>
            )}

            {etapa.nome === 'recuperar-confirmar' && (
              <>
                <p className="text-sm text-ink-suave">
                  Código enviado para <strong className="text-ink">{etapa.destino}</strong>.
                </p>
                <Campo rotulo="Código recebido por e-mail" obrigatorio>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={codigo}
                    onChange={(ev) => definirCodigo(ev.target.value.replace(/\D/g, ''))}
                    className={`${classeEntrada} text-center text-lg tracking-widest`}
                  />
                </Campo>
                <Campo
                  rotulo="Nova senha"
                  ajuda="Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo."
                  obrigatorio
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={resposta}
                    onChange={(ev) => definirResposta(ev.target.value)}
                    className={classeEntrada}
                  />
                </Campo>
              </>
            )}

            {etapa.nome === 'nova-senha' && (
              <Campo
                rotulo="Defina uma nova senha"
                ajuda="Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo."
                obrigatorio
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={resposta}
                  onChange={(ev) => definirResposta(ev.target.value)}
                  className={classeEntrada}
                />
              </Campo>
            )}

            <Botao type="submit" carregando={enviando} className="w-full">
              {ROTULO_BOTAO[etapa.nome]}
            </Botao>

            {(etapa.nome === 'recuperar-pedir' || etapa.nome === 'recuperar-confirmar') && (
              <button
                type="button"
                onClick={() => {
                  definirAviso('');
                  irPara({ nome: 'credenciais' });
                }}
                className="inline-flex min-h-11 w-full items-center justify-center text-sm text-ink-suave underline hover:text-ink"
              >
                Voltar para o login
              </button>
            )}
          </form>
        </Cartao>
      </div>
    </div>
  );
}
