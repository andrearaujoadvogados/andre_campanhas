import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { confirmarDesafio, entrar } from '../lib/auth.js';
import { Aviso, Botao, Campo, ErroCaixa, classeEntrada } from '../componentes/base.tsx';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={(e) => void submeter(e)}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Campanhas</h1>
          <p className="text-sm text-slate-500">André Araújo Advogados</p>
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

            <img
              src={etapa.qr}
              alt="Código QR para cadastrar no aplicativo autenticador"
              className="mx-auto rounded border border-slate-200"
            />

            {/**
             * A chave em texto fica disponível junto do QR.
             *
             * Quem acessa pelo celular não consegue fotografar a própria tela —
             * e é justamente essa pessoa que ficaria travada se o QR fosse a
             * única opção.
             */}
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Não consigo ler o código</summary>
              <p className="mt-2">Cadastre manualmente com esta chave:</p>
              <code className="mt-1 block break-all rounded bg-slate-50 p-2 font-mono">
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
    </div>
  );
}
