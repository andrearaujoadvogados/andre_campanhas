import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { confirmarDesafio, entrar } from '../lib/auth.js';
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
  | { readonly nome: 'codigo-totp' };

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
  const [erro, definirErro] = useState<unknown>(null);
  const [enviando, definirEnviando] = useState(false);

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

  const rotuloBotao =
    etapa.nome === 'credenciais'
      ? 'Entrar'
      : etapa.nome === 'nova-senha'
        ? 'Salvar senha'
        : 'Confirmar código';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <Cartao>
          <form onSubmit={(e) => void submeter(e)} className="space-y-4">
            <div>
              <TituloPagina>Campanhas</TituloPagina>
              <p className="mt-1 text-sm text-ink-suave">André Araújo Advogados</p>
            </div>

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
              {rotuloBotao}
            </Botao>
          </form>
        </Cartao>
      </div>
    </div>
  );
}
