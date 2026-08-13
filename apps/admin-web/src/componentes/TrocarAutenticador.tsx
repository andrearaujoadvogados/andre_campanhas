import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';

import { confirmarTrocaDeAutenticador, iniciarTrocaDeAutenticador } from '../lib/auth.js';
import { Botao, classeEntrada } from './base.tsx';
import { Dialogo } from './criador/Dialogo.tsx';

/**
 * Troca do aplicativo autenticador (rotação do TOTP) — autosserviço.
 *
 * O fluxo espelha o cadastro do primeiro login: QR + segredo manual, e o
 * código de seis dígitos confirmando que o aplicativo novo funciona ANTES de
 * o antigo parar de valer. A ordem importa — invalidar o antigo primeiro
 * trancaria o usuário para fora se o celular novo falhasse no meio.
 */
export function TrocarAutenticador({ email }: { email: string }) {
  const [aberto, definirAberto] = useState(false);
  const [dados, definirDados] = useState<{ qr: string; segredo: string } | null>(null);
  const [codigo, definirCodigo] = useState('');
  const [erro, definirErro] = useState('');
  const [ocupado, definirOcupado] = useState(false);
  const [concluido, definirConcluido] = useState(false);

  async function abrir() {
    definirAberto(true);
    definirErro('');
    definirConcluido(false);
    definirCodigo('');
    definirOcupado(true);
    try {
      const { uri, segredo } = await iniciarTrocaDeAutenticador(email);
      // QR gerado no próprio navegador: a URI carrega o segredo do TOTP e não
      // deve sair da máquina do usuário para um serviço externo de imagem.
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      definirDados({ qr, segredo });
    } catch (e) {
      definirErro(e instanceof Error ? e.message : 'Não foi possível iniciar a troca.');
      definirDados(null);
    } finally {
      definirOcupado(false);
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    definirErro('');
    definirOcupado(true);
    try {
      await confirmarTrocaDeAutenticador(codigo.trim());
      definirConcluido(true);
    } catch {
      definirErro('Código não confere. Confira no aplicativo novo e tente de novo.');
    } finally {
      definirOcupado(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        className="flex min-h-11 w-full items-center rounded-md px-3 text-sm font-medium text-ink-suave transition-colors hover:bg-accent-mist hover:text-ink"
      >
        Trocar autenticador
      </button>

      <Dialogo
        titulo="Trocar aplicativo autenticador"
        descricao="Cadastre o código em um aplicativo novo. O código antigo só deixa de valer quando o novo for confirmado."
        aberto={aberto}
        aoFechar={() => definirAberto(false)}
      >
        {concluido ? (
          <div className="space-y-4">
            <p className="text-sm text-ink">
              <span className="font-medium text-sucesso">Autenticador trocado.</span> O código
              anterior não vale mais — pode apagar a conta antiga do aplicativo. Guarde o novo: é
              ele que entra no próximo login.
            </p>
            <div className="text-right">
              <Botao onClick={() => definirAberto(false)}>Fechar</Botao>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void confirmar(e)} className="space-y-4">
            {dados === null ? (
              <p className="py-8 text-center text-sm text-ink-suave">
                {erro === '' ? 'Gerando o código…' : erro}
              </p>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2">
                  <img src={dados.qr} alt="QR code para o aplicativo autenticador" />
                  <p className="max-w-xs text-center text-xs text-ink-suave">
                    Não consegue ler o QR? Digite o segredo no aplicativo:
                    <code className="mt-1 block rounded-md bg-accent-mist px-2 py-1 break-all text-gold">
                      {dados.segredo}
                    </code>
                  </p>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-ink">
                    Código de 6 dígitos do aplicativo novo
                  </span>
                  <input
                    value={codigo}
                    onChange={(e) => definirCodigo(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className={`${classeEntrada} mt-1`}
                  />
                </label>

                {erro !== '' && <p className="text-sm text-erro">{erro}</p>}

                <div className="flex justify-end gap-2">
                  <Botao variante="secundario" onClick={() => definirAberto(false)}>
                    Cancelar
                  </Botao>
                  <Botao type="submit" carregando={ocupado} disabled={codigo.trim().length !== 6}>
                    Confirmar troca
                  </Botao>
                </div>
              </>
            )}
          </form>
        )}
      </Dialogo>
    </>
  );
}
