/**
 * Token bucket para o controle de taxa do SES — §5.6.
 *
 * **Não dorme.** Devolve quantos milissegundos faltam para a próxima vaga e
 * deixa quem chama decidir o que fazer com isso. Manter o `setTimeout` fora do
 * domínio é o que permite testar "o que acontece quando a cota é 1 msg/s e
 * chegam 10 mensagens" em microssegundos, em vez de dez segundos reais.
 *
 * O escopo é uma invocação de Lambda. Com `reservedConcurrentExecutions: 1` no
 * `sender` (ver CoreStack), existe no máximo um bucket ativo por vez, então o
 * ritmo global é respeitado sem coordenação distribuída. Se um dia a
 * concorrência subir, este bucket sozinho deixa de bastar — e é por isso que a
 * cota **diária** é contada no DynamoDB, não aqui.
 */
export class TokenBucket {
  private tokens: number;
  private ultimaRecarga: number;

  constructor(
    private readonly taxaPorSegundo: number,
    agoraMs: number,
    /** Capacidade da rajada. Igual à taxa por padrão: sem rajada. */
    private readonly capacidade = taxaPorSegundo,
  ) {
    if (taxaPorSegundo <= 0) {
      throw new Error(`Taxa de envio inválida: ${taxaPorSegundo}. Deve ser maior que zero.`);
    }
    this.tokens = capacidade;
    this.ultimaRecarga = agoraMs;
  }

  /**
   * Tenta consumir um token.
   *
   * Devolve `0` se pode enviar agora, ou a espera em milissegundos. Nunca
   * devolve "não pode": com cota apertada, throttling é o fluxo normal e a
   * resposta certa é sempre "espere tanto", não "falhou" (§5.5).
   */
  consumir(agoraMs: number): number {
    this.recarregar(agoraMs);

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }

    const faltando = 1 - this.tokens;
    return Math.ceil((faltando / this.taxaPorSegundo) * 1000);
  }

  private recarregar(agoraMs: number): void {
    const decorridoMs = Math.max(0, agoraMs - this.ultimaRecarga);
    this.ultimaRecarga = agoraMs;
    this.tokens = Math.min(
      this.capacidade,
      this.tokens + (decorridoMs / 1000) * this.taxaPorSegundo,
    );
  }

  /** Exposto para observabilidade — quanto sobra da rajada. */
  get disponiveis(): number {
    return this.tokens;
  }
}
