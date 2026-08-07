import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { mensagemEnvioSchema } from '@emailmkt/contracts';
import {
  TokenBucket,
  campaignId as novoCampaignId,
  contactId as novoContactId,
  enviarMensagem,
  sendId as novoSendId,
  tenantId as novoTenantId,
  type DesfechoEnvio,
} from '@emailmkt/core';
import { config, log, montarDependenciasEnvio, type DependenciasSender } from './container.js';

/**
 * Worker de envio — ADR-05, §5.5 e §5.6.
 *
 * Concorrência reservada em 1 (ver CoreStack): com cota de 1 msg/s, uma única
 * execução já satura o SES, e ter um só bucket ativo é o que faz o controle de
 * ritmo funcionar sem coordenação distribuída.
 *
 * Reporta falha **por item**. Sem isso, uma mensagem com throttling faria o lote
 * inteiro voltar para a fila — inclusive as já enviadas, que seriam
 * reprocessadas (e barradas pela idempotência, mas gastando tempo e leitura).
 */
export const handler = async (evento: SQSEvent): Promise<SQSBatchResponse> => {
  const deps = await montarDependenciasEnvio();
  const cfg = await config();
  const quota = await deps.configuracao.lerQuota();

  const bucket = new TokenBucket(quota.maxEnviosPorSegundo, Date.now());
  const falhas: { itemIdentifier: string }[] = [];

  for (const registro of evento.Records) {
    try {
      const desfecho = await processarRegistro(registro, deps, cfg, quota.cotaDiaria, bucket);

      if (desfecho.acao === 'ADIAR') {
        /**
         * Adiar não é falha: a mensagem continua válida e volta depois.
         *
         * Marcá-la como falha consumiria o orçamento de retentativa e a mandaria
         * para a DLQ por causa de uma pausa ou de throttling — que são fluxo
         * normal com a cota atual, não erro (§5.5).
         */
        await deps.fila.adiarEntrega(registro.receiptHandle, desfecho.segundos);
        continue;
      }

      if (desfecho.acao === 'FALHA_TRANSITORIA') {
        falhas.push({ itemIdentifier: registro.messageId });
      }
      // ENVIADO, IGNORADO e FALHA_PERMANENTE são desfechos finais: a mensagem
      // sai da fila. Retentar rejeição permanente só encheria a DLQ.
    } catch (erro) {
      log.error('falha inesperada ao processar envio', {
        messageId: registro.messageId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      falhas.push({ itemIdentifier: registro.messageId });
    }
  }

  return { batchItemFailures: falhas };
};

async function processarRegistro(
  registro: SQSRecord,
  deps: DependenciasSender,
  cfg: Awaited<ReturnType<typeof config>>,
  cotaDiaria: number,
  bucket: TokenBucket,
): Promise<DesfechoEnvio> {
  const dados = mensagemEnvioSchema.safeParse(analisar(registro.body));

  if (!dados.success) {
    // Mensagem malformada não vira falha: retentar não conserta o payload, só
    // atrasa a ida para a DLQ, que é onde ela precisa estar para inspeção.
    log.error('mensagem de envio inválida', { messageId: registro.messageId });
    return { acao: 'IGNORADO', motivo: 'Payload inválido.' };
  }

  // Espera o token ANTES de chamar o SES. Bloquear aqui é o comportamento certo:
  // a Lambda tem concorrência 1, então esperar não segura nenhum outro envio, e
  // é mais barato que levar throttling e reprocessar.
  const esperaMs = bucket.consumir(Date.now());
  if (esperaMs > 0) await dormir(esperaMs);

  const desfecho = await enviarMensagem(deps.envio, {
    tenantId: novoTenantId(dados.data.tenantId),
    campaignId: novoCampaignId(dados.data.campaignId),
    contactId: novoContactId(dados.data.contactId),
    sendId: novoSendId(dados.data.sendId),
    limiteDiario: cotaDiaria,
    baseUrlDescadastro: cfg.baseUrlDescadastro,
    configurationSet: cfg.configurationSet,
  });

  // Nenhum e-mail no log — §10.4.
  log.info('envio processado', {
    sendId: dados.data.sendId,
    campaignId: dados.data.campaignId,
    acao: desfecho.acao,
  });

  return desfecho;
}

function analisar(corpo: string): unknown {
  try {
    return JSON.parse(corpo);
  } catch {
    return null;
  }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
