import { type Result, type DomainError, ok, err, domainError } from './result.js';

/**
 * EmailAddress — §5.12 do documento de arquitetura.
 *
 * Existe para eliminar a classe de bug mais comum em e-mail marketing: o mesmo
 * endereço tratado como duas pessoas por diferença de caixa ou espaço em branco.
 * Um CSV do mundo real traz " Joao@Exemplo.COM " e "joao@exemplo.com" na mesma
 * planilha. Se os dois virarem contatos distintos, a pessoa recebe a campanha em
 * duplicata e, pior, um descadastro num deles não vale para o outro — o que
 * transforma um detalhe de normalização em descumprimento de direito do titular.
 */
export class EmailAddress {
  private constructor(readonly value: string) {}

  /**
   * Deliberadamente permissivo. Validar e-mail por regex estrita rejeita
   * endereços válidos e não garante entregabilidade — quem diz se o endereço
   * existe é o bounce. Aqui só barramos o que é inequivocamente inválido.
   */
  private static readonly FORMATO = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

  static create(raw: string): Result<EmailAddress, DomainError> {
    const normalizado = EmailAddress.normalizar(raw);

    if (normalizado.length === 0) {
      return err(domainError('EMAIL_INVALIDO', 'E-mail vazio.'));
    }
    if (normalizado.length > 254) {
      return err(domainError('EMAIL_INVALIDO', 'E-mail excede 254 caracteres.', { raw }));
    }
    if (!EmailAddress.FORMATO.test(normalizado)) {
      return err(domainError('EMAIL_INVALIDO', `Formato de e-mail inválido: "${raw}".`));
    }
    return ok(new EmailAddress(normalizado));
  }

  /**
   * Minúsculas e sem espaços nas pontas. Note o que NÃO fazemos: remover pontos
   * do Gmail ou cortar sufixos "+tag". São endereços diferentes para o servidor
   * de destino, e "normalizar" isso significaria decidir que duas inscrições
   * distintas são a mesma pessoa — o que não nos cabe.
   */
  private static normalizar(raw: string): string {
    return raw.trim().toLowerCase();
  }

  get dominio(): string {
    return this.value.slice(this.value.lastIndexOf('@') + 1);
  }

  equals(outro: EmailAddress): boolean {
    return this.value === outro.value;
  }

  /**
   * Mascarado para log — §10.4: nenhum PII em log estruturado.
   *
   * Largura fixa de propósito. Repetir um asterisco por caractere vazaria o
   * tamanho da parte local, que é informação gratuita para quem lê o log e
   * inútil para quem depura.
   */
  get mascarado(): string {
    const [local = '', dominio = ''] = this.value.split('@');
    return `${local.slice(0, 1)}***@${dominio}`;
  }

  toString(): string {
    return this.value;
  }
}
