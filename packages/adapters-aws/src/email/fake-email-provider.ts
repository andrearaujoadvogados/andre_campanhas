import type { EmailProvider, FalhaEnvio, MensagemEmail, ResultadoEnvio } from '@emailmkt/core';

type Retorno =
  | { readonly ok: true; readonly value: ResultadoEnvio }
  | { readonly ok: false; readonly error: FalhaEnvio };

/**
 * Provedor falso — §5.3 e §9.1.
 *
 * Não é só conveniência de teste: em desenvolvimento, é o que torna
 * **impossível** atingir um contato real por engano. O SES da conta `dev` já
 * fica em sandbox por desenho, mas sandbox ainda envia para endereços
 * verificados — e um endereço verificado da equipe recebendo uma campanha de
 * teste com dado de cliente real seria vazamento.
 *
 * Guarda as mensagens em memória para inspeção nos testes.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly enviadas: MensagemEmail[] = [];

  constructor(
    private readonly comportamento: {
      /** Falha a ser devolvida em vez do sucesso, para exercitar o backoff. */
      readonly falharCom?: FalhaEnvio;
      /** Falha só nas N primeiras chamadas — testa retentativa e recuperação. */
      readonly falharNasPrimeiras?: number;
    } = {},
  ) {}

  private chamadas = 0;

  async enviar(mensagem: MensagemEmail): Promise<Retorno> {
    this.chamadas += 1;

    const deveFalhar =
      this.comportamento.falharCom !== undefined &&
      (this.comportamento.falharNasPrimeiras === undefined ||
        this.chamadas <= this.comportamento.falharNasPrimeiras);

    if (deveFalhar && this.comportamento.falharCom !== undefined) {
      return { ok: false, error: this.comportamento.falharCom };
    }

    this.enviadas.push(mensagem);
    return {
      ok: true,
      value: { providerMessageId: `fake-${String(this.chamadas).padStart(6, '0')}` },
    };
  }

  limpar(): void {
    this.enviadas.length = 0;
    this.chamadas = 0;
  }
}
