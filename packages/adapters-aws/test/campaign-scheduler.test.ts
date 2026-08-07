import { describe, it, expect, vi } from 'vitest';
import type { SchedulerClient } from '@aws-sdk/client-scheduler';
import type { SFNClient } from '@aws-sdk/client-sfn';
import { campaignId, TENANT_PADRAO } from '@emailmkt/core';
import { EventBridgeCampaignScheduler } from '../src/scheduler/eventbridge-campaign-scheduler.js';

const OPCOES = {
  grupo: 'emailmkt-dev-campanhas',
  stateMachineArn: 'arn:aws:states:sa-east-1:1:stateMachine:campanha',
  papelArn: 'arn:aws:iam::1:role/scheduler',
};

function clientes(respostas: { scheduler?: unknown; sfn?: unknown } = {}) {
  const scheduler = {
    send: vi.fn().mockImplementation(() => {
      if (respostas.scheduler instanceof Error) return Promise.reject(respostas.scheduler);
      return Promise.resolve({});
    }),
  } as unknown as SchedulerClient;

  const sfn = {
    send: vi.fn().mockImplementation(() => {
      if (respostas.sfn instanceof Error) return Promise.reject(respostas.sfn);
      return Promise.resolve({ executionArn: 'arn:exec:1' });
    }),
  } as unknown as SFNClient;

  return { scheduler, sfn, agendador: new EventBridgeCampaignScheduler(scheduler, sfn, OPCOES) };
}

/** O SDK identifica erro de serviço pelo `name` — ver `ehErroDoServico`. */
function erroNomeado(name: string): Error {
  const e = new Error(`simulado: ${name}`);
  e.name = name;
  return e;
}

const entrada = (cliente: { send: ReturnType<typeof vi.fn> }, chamada = 0) =>
  (cliente.send.mock.calls[chamada]?.[0] as { input: Record<string, unknown> }).input;

describe('agendamento', () => {
  it('cria agendamento pontual em UTC', async () => {
    const { scheduler, agendador } = clientes();
    await agendador.agendar(TENANT_PADRAO, campaignId('k-1'), new Date('2026-09-01T09:00:00Z'));

    const i = entrada(scheduler as unknown as { send: ReturnType<typeof vi.fn> });
    expect(i['ScheduleExpression']).toBe('at(2026-09-01T09:00:00)');
    expect(i['ScheduleExpressionTimezone']).toBe('UTC');
  });

  it('sem janela flexível — 9h significa 9h', async () => {
    const { scheduler, agendador } = clientes();
    await agendador.agendar(TENANT_PADRAO, campaignId('k-1'), new Date('2026-09-01T09:00:00Z'));

    const i = entrada(scheduler as unknown as { send: ReturnType<typeof vi.fn> });
    expect(i['FlexibleTimeWindow']).toEqual({ Mode: 'OFF' });
  });

  it('o agendamento se apaga depois de disparar', async () => {
    // Sem isto, o grupo acumularia um agendamento morto por campanha para
    // sempre, contra a cota da conta.
    const { scheduler, agendador } = clientes();
    await agendador.agendar(TENANT_PADRAO, campaignId('k-1'), new Date('2026-09-01T09:00:00Z'));

    const i = entrada(scheduler as unknown as { send: ReturnType<typeof vi.fn> });
    expect(i['ActionAfterCompletion']).toBe('DELETE');
  });

  it('aponta para a máquina de estados, não para uma Lambda', async () => {
    const { scheduler, agendador } = clientes();
    await agendador.agendar(TENANT_PADRAO, campaignId('k-1'), new Date('2026-09-01T09:00:00Z'));

    const alvo = entrada(scheduler as unknown as { send: ReturnType<typeof vi.fn> })[
      'Target'
    ] as Record<string, unknown>;
    expect(alvo['Arn']).toBe(OPCOES.stateMachineArn);
    expect(JSON.parse(String(alvo['Input']))).toMatchObject({ campaignId: 'k-1' });
  });

  it('reagendar atualiza em vez de falhar', async () => {
    // Mudar a data antes de disparar é operação normal do operador.
    const conflito = erroNomeado('ConflictException');
    const { agendador, scheduler } = clientes({ scheduler: conflito });
    const cliente = scheduler as unknown as { send: ReturnType<typeof vi.fn> };

    cliente.send.mockRejectedValueOnce(conflito).mockResolvedValueOnce({});

    await expect(
      agendador.agendar(TENANT_PADRAO, campaignId('k-1'), new Date('2026-09-01T09:00:00Z')),
    ).resolves.toBeUndefined();
    expect(cliente.send).toHaveBeenCalledTimes(2);
  });

  it('sanitiza o id no nome do agendamento', async () => {
    const { scheduler, agendador } = clientes();
    await agendador.agendar(
      TENANT_PADRAO,
      campaignId('k/1 com espaço'),
      new Date('2026-09-01T09:00:00Z'),
    );

    const nome = String(
      entrada(scheduler as unknown as { send: ReturnType<typeof vi.fn> })['Name'],
    );
    expect(nome).toMatch(/^[0-9a-zA-Z\-_.]+$/);
  });
});

describe('cancelamento de agendamento', () => {
  it('ignora agendamento inexistente', async () => {
    // Já disparou e se autoapagou, ou nunca existiu: nos dois casos o resultado
    // desejado já é o vigente.
    const naoExiste = erroNomeado('ResourceNotFoundException');
    const { agendador } = clientes({ scheduler: naoExiste });

    await expect(
      agendador.cancelarAgendamento(TENANT_PADRAO, campaignId('k-1')),
    ).resolves.toBeUndefined();
  });

  it('propaga erro que não é "não encontrado"', async () => {
    const { agendador } = clientes({ scheduler: new Error('acesso negado') });
    await expect(agendador.cancelarAgendamento(TENANT_PADRAO, campaignId('k-1'))).rejects.toThrow();
  });
});

describe('disparo imediato', () => {
  it('inicia a execução e devolve o ARN', async () => {
    const { agendador } = clientes();
    const r = await agendador.dispararAgora(
      TENANT_PADRAO,
      campaignId('k-1'),
      new Date('2026-08-07T12:34:56Z'),
    );
    expect(r).toBe('arn:exec:1');
  });

  it('o nome da execução carrega o minuto — clique duplo não dispara duas vezes', async () => {
    const { sfn, agendador } = clientes();
    await agendador.dispararAgora(
      TENANT_PADRAO,
      campaignId('k-1'),
      new Date('2026-08-07T12:34:56Z'),
    );

    const nome = String(entrada(sfn as unknown as { send: ReturnType<typeof vi.fn> })['name']);
    expect(nome).toBe('k-1-202608071234');
  });

  it('execução já existente é tratada como sucesso', async () => {
    const jaExiste = new Error('já iniciada');
    jaExiste.name = 'ExecutionAlreadyExists';
    const { agendador } = clientes({ sfn: jaExiste });

    const r = await agendador.dispararAgora(
      TENANT_PADRAO,
      campaignId('k-1'),
      new Date('2026-08-07T12:34:56Z'),
    );
    expect(r).toBe('k-1-202608071234');
  });

  it('propaga outros erros do Step Functions', async () => {
    const { agendador } = clientes({ sfn: new Error('acesso negado') });
    await expect(
      agendador.dispararAgora(TENANT_PADRAO, campaignId('k-1'), new Date()),
    ).rejects.toThrow(/acesso negado/);
  });
});
