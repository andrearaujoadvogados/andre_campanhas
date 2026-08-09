import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
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
 * O MFA é obrigatório no pool (decisão registrada na CoreStack), e contas são
 * criadas por administrador sem autocadastro. Isso torna as três primeiras
 * etapas o caminho **normal** do primeiro acesso de todo usuário, não caso de
 * borda: senha provisória → nova senha → cadastro do TOTP → código.
 *
 * Tratar só a primeira deixaria a equipe sem conseguir entrar.
 */
type Etapa =
  | { readonly nome: 'credenciais' }
  | { readonly nome: 'nova-senha' }
  | {
      readonly nome: 'cadastrar-totp';
      readonly segredo: string;
      readonly qr: string;
    }
  | { readonly nome: 'codigo-totp' }
  /** Recuperação: pedir o código, e depois trocar a senha com ele. */
  | { readonly nome: 'recuperar-pedir' }
  | { readonly nome: 'recuperar-confirmar'; readonly destino: string };

interface ProximaEtapa {
  signInStep: string;
  totpSetupDetails?: {
    sharedSecret: string;
    getSetupUri: (appName: string, accountName?: string) => URL;
  };
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

  async function avancar(proxima: ProximaEtapa): Promise<boolean> {
    switch (proxima.signInStep) {
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        definirEtapa({ nome: 'nova-senha' });
        return false;

      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP': {
        const detalhes = proxima.totpSetupDetails;
        if (detalhes === undefined) {
          definirErro(new Error('O Cognito não devolveu os dados de cadastro do aplicativo.'));
          return false;
        }
        const uri = detalhes.getSetupUri('Campanhas AAA', email).toString();
        // QR gerado no próprio navegador: a URI carrega o segredo do TOTP e não
        // deve sair da máquina do usuário para um serviço externo de imagem.
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
        definirEtapa({ nome: 'cadastrar-totp', segredo: detalhes.sharedSecret, qr });
        return false;
      }

      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        definirEtapa({ nome: 'codigo-totp' });
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
        // Volta para o login em vez de entrar sozinho: a senha mudou, e o
        // Cognito ainda vai exigir o código do autenticador.
        irPara({ nome: 'credenciais' });
        definirSenha('');
        definirAviso('Senha alterada. Entre com a senha nova e o código do aplicativo.');
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
      if (await avancar(r.nextStep as ProximaEtapa)) aoEntrar();
    } catch (e2) {
      definirErro(e2);
    } finally {
      definirEnviando(false);
    }
  }

  const ROTULO_BOTAO: Record<Etapa['nome'], string> = {
    credenciais: 'Entrar',
    'nova-senha': 'Salvar senha',
    'cadastrar-totp': 'Confirmar código',
    'codigo-totp': 'Confirmar código',
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
                {/**
                 * O aplicativo autenticador continua valendo, e dizer isso aqui
                 * evita a conclusão errada de que recuperar a senha zera o MFA —
                 * quem concluir isso vai achar que perdeu o acesso de vez.
                 */}
                <p className="text-xs text-ink-suave">
                  Seu aplicativo autenticador não muda. Depois de alterar a senha, o código de seis
                  dígitos continua sendo pedido.
                </p>
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

            {etapa.nome === 'cadastrar-totp' && (
              <div className="space-y-3">
                <Aviso texto="A verificação em duas etapas é obrigatória. Cadastre o acesso no seu aplicativo autenticador." />

                {/* O QR sai com 220px fixos. Sobra folga num celular de 320px, mas
                    não num dobrável fechado de 280px, onde as bordas do cartão já
                    comem 64px — daí o `max-w-full`. */}
                <img
                  src={etapa.qr}
                  alt="Código QR para cadastrar no aplicativo autenticador"
                  className="mx-auto h-auto max-w-full rounded-md border border-line"
                />

                {/**
                 * A chave em texto fica disponível junto do QR.
                 *
                 * Quem acessa pelo celular não consegue fotografar a própria tela —
                 * e é justamente essa pessoa que ficaria travada se o QR fosse a
                 * única opção.
                 */}
                <details className="text-sm text-ink-suave">
                  {/* O resumo é o que se toca para abrir: precisa dos 44px, e eles
                      vêm do respiro vertical. `flex` aqui tiraria o `display:
                      list-item` do navegador e, com ele, a setinha — a única pista
                      de que a linha abre, já que no toque não existe `hover`. */}
                  <summary className="min-h-11 cursor-pointer py-3">
                    Não consigo ler o código
                  </summary>
                  <p className="mt-1">Cadastre manualmente com esta chave:</p>
                  <code className="mt-1 block break-all rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink">
                    {etapa.segredo}
                  </code>
                </details>

                <Campo rotulo="Código de 6 dígitos do aplicativo" obrigatorio>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={resposta}
                    onChange={(ev) => definirResposta(ev.target.value.replace(/\D/g, ''))}
                    className={`${classeEntrada} text-center text-lg tracking-widest`}
                  />
                </Campo>
              </div>
            )}

            {etapa.nome === 'codigo-totp' && (
              <Campo
                rotulo="Código de 6 dígitos"
                ajuda="Abra seu aplicativo autenticador e informe o código atual."
                obrigatorio
              >
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={resposta}
                  onChange={(ev) => definirResposta(ev.target.value.replace(/\D/g, ''))}
                  className={`${classeEntrada} text-center text-lg tracking-widest`}
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
