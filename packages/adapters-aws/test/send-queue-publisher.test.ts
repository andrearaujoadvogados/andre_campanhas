import { describe, it, expect, vi } from 'vitest';
import { SendMessageBatchCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { mensagemEnvioSchema } from '@emailmkt/contracts';
import {
  campaignId,
  contactId,
  sendId,
  tenantId as novoTenantId,
  type CampaignId,
  type ContactId,
  type SendId,
  type TenantId,
} from '@emailmkt/core';
import { SqsSendQueuePublisher } from '../src/queue/sqs-send-queue-publisher.js';

/**
 * O contrato entre o launcher e o sender.
 *
 * O que o publicador coloca na fila precisa passar no `mensagemEnvioSchema`, que
 * é o que o sender usa para ler. As duas pontas viviam em pacotes diferentes,
 * sem nada verificando que concordavam — e não concordavam: faltava `tenantId`
 * no corpo. O sender rejeitava toda mensagem como IGNORADO, sem registro e sem
 * DLQ, e a campanha ficava eternamente em "ENVIANDO".
 *
 * Nenhum teste cobria isso porque nenhuma campanha havia sido disparada de
 * verdade. Este fecha a lacuna no ponto exato onde ela morava: o corpo da
 * mensagem, validado pelo mesmo schema das duas pontas.
 */
describe('contrato da fila de envio', () => {
  it('o corpo publicado passa no schema que o sender usa para ler', async () => {
    let corpoPublicado = '';
    const cliente = {
      send: vi.fn(async (comando: unknown) => {
        if (comando instanceof SendMessageBatchCommand) {
          corpoPublicado = comando.input.Entries?.[0]?.MessageBody ?? '';
        }
        return { Successful: [{ Id: 'm0' }], Failed: [] };
      }),
    } as unknown as SQSClient;

    const publicador = new SqsSendQueuePublisher(cliente, 'https://fila/exemplo');

    await publicador.publicarLote([
      {
        tenantId: novoTenantId('andrearaujo') as TenantId,
        sendId: sendId('s-1') as SendId,
        campaignId: campaignId('k-1') as CampaignId,
        contactId: contactId('c-1') as ContactId,
      },
    ]);

    const analise = mensagemEnvioSchema.safeParse(JSON.parse(corpoPublicado));

    // A mensagem de erro nomeia o campo que falta, para o próximo que quebrar
    // o contrato saber exatamente o quê acrescentar.
    expect(analise.success, analise.success ? '' : JSON.stringify(analise.error.issues)).toBe(true);
    if (analise.success) {
      expect(analise.data.tenantId).toBe('andrearaujo');
      expect(analise.data.campaignId).toBe('k-1');
    }
  });
});
