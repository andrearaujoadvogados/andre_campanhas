import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import type { EmailProvider, FalhaEnvio, MensagemEmail, ResultadoEnvio } from '@emailmkt/core';

type Retorno =
  | { readonly ok: true; readonly value: ResultadoEnvio }
  | { readonly ok: false; readonly error: FalhaEnvio };

/**
 * Envio via Amazon SES — ADR-07.
 *
 * Renderizamos o HTML antes de chegar aqui e mandamos um destinatário por
 * chamada. `SendBulkEmail` mandaria 50 por vez, mas exigiria manter os templates
 * sincronizados como recursos do SES; em 20 mil e-mails/mês a economia de
 * chamadas não paga esse acoplamento. Se o volume mudar, a troca é uma nova
 * implementação desta mesma interface (§5.3), não uma refatoração.
 */
export class SesEmailProvider implements EmailProvider {
  constructor(
    private readonly cliente: SESv2Client,
    private readonly opcoes: { readonly configurationSet: string },
  ) {}

  async enviar(mensagem: MensagemEmail): Promise<Retorno> {
    try {
      const r = await this.cliente.send(
        new SendEmailCommand({
          FromEmailAddress: `${mensagem.deNome} <${mensagem.deEmail}>`,
          Destination: { ToAddresses: [mensagem.para.value] },
          ...(mensagem.replyTo === undefined ? {} : { ReplyToAddresses: [mensagem.replyTo] }),
          ConfigurationSetName: this.opcoes.configurationSet,
          // Tags viram dimensões nos eventos: é o que permite atribuir um bounce
          // à campanha certa sem consultar o banco (§5.7).
          EmailTags: Object.entries(mensagem.tags).map(([Name, Value]) => ({
            Name,
            Value: sanitizarTag(Value),
          })),
          Content: {
            Simple: {
              Subject: { Data: mensagem.assunto, Charset: 'UTF-8' },
              Body: {
                Html: { Data: mensagem.corpoHtml, Charset: 'UTF-8' },
                // A parte texto não é opcional na prática: mensagem só-HTML
                // pontua pior em filtro de spam e é ilegível em cliente que não
                // renderiza HTML.
                Text: { Data: mensagem.corpoTexto, Charset: 'UTF-8' },
              },
              // RFC 8058 — descadastro em um clique. Requisito de
              // entregabilidade do Gmail e do Yahoo desde 2024, não enfeite
              // (§1.3). Precisa ficar DENTRO de `Simple`: como irmão dele, o
              // SES ignora silenciosamente e o e-mail sai sem o cabeçalho.
              Headers: [
                { Name: 'List-Unsubscribe', Value: `<${mensagem.listUnsubscribeUrl}>` },
                { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
              ],
            },
          },
        }),
      );

      const providerMessageId = r.MessageId;
      if (providerMessageId === undefined) {
        // Sem messageId não há como correlacionar eventos futuros a este envio.
        // Tratar como erro transitório é mais seguro que registrar um envio órfão.
        return {
          ok: false,
          error: { tipo: 'ERRO_TRANSITORIO', detalhe: 'SES respondeu sem MessageId.' },
        };
      }
      return { ok: true, value: { providerMessageId } };
    } catch (erro) {
      return { ok: false, error: classificar(erro) };
    }
  }
}

/**
 * Anti-corruption layer sobre os erros do SES — §5.10.
 *
 * A classificação decide o comportamento do `sender`, e cada categoria leva a
 * uma ação diferente:
 *
 * - `THROTTLED`     → devolver à fila; **não** é erro, é o fluxo normal com a
 *                     cota de 1 msg/s (§5.5).
 * - `CONTA_SUSPENSA`→ abrir o circuit breaker e alarmar. Continuar tentando
 *                     queimaria a fila inteira em DLQ sem enviar nada.
 * - `REJEITADO_PERMANENTE` → não retentar; o endereço ou o conteúdo é inválido.
 * - `ERRO_TRANSITORIO`     → retentar com backoff.
 *
 * Colapsar tudo em "erro" faria o sistema tratar throttling como falha e
 * descartar mensagens boas na DLQ.
 */
function classificar(erro: unknown): FalhaEnvio {
  const nome = obterNome(erro);
  const detalhe = obterMensagem(erro);

  switch (nome) {
    case 'TooManyRequestsException':
    case 'ThrottlingException':
    case 'Throttling':
      return { tipo: 'THROTTLED', tentarNovamenteEmMs: 1000 };

    case 'AccountSuspendedException':
    case 'SendingPausedException':
    case 'AccountSendingPausedException':
      return { tipo: 'CONTA_SUSPENSA', detalhe };

    case 'MessageRejected':
    case 'MailFromDomainNotVerifiedException':
    case 'BadRequestException':
      return { tipo: 'REJEITADO_PERMANENTE', detalhe };

    case 'LimitExceededException':
      // Cota diária estourada. Não é rejeição do destinatário: reenfileirar com
      // atraso maior é o certo, e o `sender` já sabe esperar a próxima janela.
      return { tipo: 'THROTTLED', tentarNovamenteEmMs: 60_000 };

    default:
      return { tipo: 'ERRO_TRANSITORIO', detalhe: `${nome}: ${detalhe}` };
  }
}

function obterNome(erro: unknown): string {
  if (typeof erro === 'object' && erro !== null && 'name' in erro) return String(erro.name);
  return 'DesconhecidoErro';
}

function obterMensagem(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

/** Tags do SES aceitam apenas letras, dígitos, sublinhado e hífen. */
function sanitizarTag(valor: string): string {
  return valor.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}
