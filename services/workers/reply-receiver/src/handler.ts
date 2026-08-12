import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { MARCA_RESPOSTA, montarEncaminhamento } from '@emailmkt/adapters-aws';
import { campanhaDoEnderecoDeResposta, messageIdDoSes } from '@emailmkt/core';
import type { SESEvent, SESMail, SESReceipt } from 'aws-lambda';

/**
 * Recebe as respostas dos contatos — §1.4.
 *
 * Faz duas coisas, nesta ordem, e nenhuma regra de negócio: empurra o e-mail
 * para sa-east-1, onde ele é correlacionado ao envio, e **encaminha a mensagem
 * para a caixa do escritório**. A segunda é a que justifica a primeira existir:
 * ligar o rastreamento troca o `Reply-To:` das campanhas por um endereço nosso,
 * e sem o encaminhamento o que o cliente escreve morreria aqui.
 *
 * Roda em us-east-2 porque a regra de recebimento do SES é regional e o domínio
 * já está verificado lá — mesma razão do `event-forwarder`, e com a mesma
 * disciplina: nada aqui decide nada sobre os dados (ADR-01).
 */

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const s3 = new S3Client({ maxAttempts: 5, retryMode: 'adaptive' });
const ses = new SESv2Client({ maxAttempts: 5, retryMode: 'adaptive' });
const sqs = new SQSClient({
  region: process.env['REGIAO_DADOS'] ?? 'sa-east-1',
  maxAttempts: 5,
  retryMode: 'adaptive',
});

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'reply-receiver', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

export const handler = async (evento: SESEvent): Promise<void> => {
  for (const registro of evento.Records) {
    const { mail, receipt } = registro.ses;

    const descarte = motivoParaDescartar(mail, receipt);
    if (descarte !== null) {
      log('INFO', 'mensagem descartada', { messageId: mail.messageId, motivo: descarte });
      continue;
    }

    /**
     * Enfileirar **antes** de encaminhar.
     *
     * A regra de recebimento invoca esta função de forma assíncrona, e a AWS
     * repete a invocação quando ela falha. Se o encaminhamento estourar depois
     * do enfileiramento, a repetição enfileira de novo — e a deduplicação por
     * Message-ID do outro lado absorve. Na ordem inversa, uma falha no
     * enfileiramento faria o escritório receber a mesma resposta várias vezes.
     */
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: env('FILA_DESTINO_URL'),
        MessageBody: JSON.stringify({ tipoInterno: MARCA_RESPOSTA, ses: registro.ses }),
      }),
    );

    await encaminhar(mail);

    log('INFO', 'resposta recebida', {
      messageId: mail.messageId,
      de: mail.source,
    });
  }
};

/**
 * Motivos para não repassar nada.
 *
 * **Spam e vírus primeiro.** O encaminhamento entrega o anexo íntegro na caixa
 * de quem opera o escritório. Repassar o que o próprio SES marcou como vírus
 * seria usar a nossa infraestrutura para entregar malware num lugar onde a
 * mensagem chega com a nossa assinatura e, por isso, com a nossa credibilidade.
 *
 * **Depois o laço.** O encaminhamento sai de um endereço nosso e chega a uma
 * caixa que pode ter resposta automática. Se essa resposta voltar para o
 * endereço de respostas, encaminhamos de novo, e de novo. Um "estou de férias"
 * viraria milhares de mensagens em uma noite. As duas guardas — remetente igual
 * ao nosso e cabeçalho de automação — cortam o ciclo na primeira volta.
 */
function motivoParaDescartar(mail: SESMail, receipt: SESReceipt): string | null {
  if (receipt.virusVerdict?.status === 'FAIL') return 'vírus';
  if (receipt.spamVerdict?.status === 'FAIL') return 'spam';

  const remetente = (mail.source ?? '').toLowerCase();
  if (remetente === '') return 'sem remetente de envelope';
  // Bounce da nossa própria mensagem: MAIL FROM vazio vira `<>` no envelope.
  if (remetente === '<>') return 'notificação de erro de entrega';
  if (remetente === env('REMETENTE_ENCAMINHAMENTO').toLowerCase()) return 'laço de encaminhamento';

  const cabecalhos = mapaDeCabecalhos(mail);
  const automatico = cabecalhos['auto-submitted'];
  if (automatico !== undefined && automatico.toLowerCase() !== 'no') return 'mensagem automática';
  if ((cabecalhos['precedence'] ?? '').toLowerCase() === 'bulk') return 'mensagem em massa';
  if (cabecalhos['x-autoreply'] !== undefined) return 'resposta automática';

  return null;
}

async function encaminhar(mail: SESMail): Promise<void> {
  const bucket = env('BUCKET_RESPOSTAS');
  const chave = `${process.env['PREFIXO_RESPOSTAS'] ?? ''}${mail.messageId}`;

  const objeto = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
  const original = await objeto.Body?.transformToByteArray();

  if (original === undefined) {
    throw new Error(`Mensagem ${mail.messageId} não encontrada em s3://${bucket}/${chave}`);
  }

  const cabecalhos = mapaDeCabecalhos(mail);
  const campanha = campanhaDoEnderecoDeResposta([
    ...(mail.destination ?? []),
    ...(cabecalhos['to'] === undefined ? [] : [cabecalhos['to']]),
  ]);
  const thread = `${cabecalhos['in-reply-to'] ?? ''} ${cabecalhos['references'] ?? ''}`;

  const bruto = montarEncaminhamento({
    de: env('REMETENTE_ENCAMINHAMENTO'),
    para: env('CAIXA_RESPOSTAS'),
    deOriginal: cabecalhos['from'] ?? mail.source,
    assuntoOriginal: cabecalhos['subject'] ?? '(sem assunto)',
    mensagemOriginal: original,
    ...(campanha === null ? {} : { campanha }),
    identificavel: campanha !== null || messageIdDoSes(thread) !== null,
  });

  await ses.send(
    new SendEmailCommand({
      // Sem Configuration Set de propósito: o encaminhamento é correspondência
      // interna, não campanha. Contá-lo nas métricas de reputação misturaria
      // e-mail transacional com marketing na mesma taxa de bounce.
      Content: { Raw: { Data: Buffer.from(bruto, 'utf8') } },
    }),
  );
}

/** Cabeçalhos por nome minúsculo — a RFC 5322 não distingue caixa; clientes usam de tudo. */
function mapaDeCabecalhos(mail: SESMail): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const { name, value } of mail.headers ?? []) {
    if (typeof name !== 'string' || typeof value !== 'string') continue;
    saida[name.toLowerCase()] ??= value;
  }
  return saida;
}
