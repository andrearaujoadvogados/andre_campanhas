import type { SchedulerClient } from '@aws-sdk/client-scheduler';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { SFNClient } from '@aws-sdk/client-sfn';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { CampaignId, CampaignScheduler, TenantId } from '@emailmkt/core';

export interface OpcoesScheduler {
  readonly grupo: string;
  readonly stateMachineArn: string;
  readonly papelArn: string;
}

/**
 * Agendamento por EventBridge Scheduler, disparo por Step Functions — ADR-05.
 *
 * Um agendamento descartável por campanha, em vez de um cron único varrendo a
 * base atrás do que está na hora. A varredura pareceria mais simples, mas
 * significaria consultar todas as campanhas a cada minuto para, quase sempre,
 * não achar nada — e ainda assim errar o horário por até um minuto.
 */
export class EventBridgeCampaignScheduler implements CampaignScheduler {
  constructor(
    private readonly scheduler: SchedulerClient,
    private readonly sfn: SFNClient,
    private readonly opcoes: OpcoesScheduler,
  ) {}

  async agendar(tenantId: TenantId, campaignId: CampaignId, quando: Date): Promise<void> {
    const nome = nomeAgendamento(campaignId);
    const entrada = {
      Name: nome,
      GroupName: this.opcoes.grupo,
      // `at()` exige o instante sem sufixo de fuso, em UTC.
      ScheduleExpression: `at(${quando.toISOString().slice(0, 19)})`,
      ScheduleExpressionTimezone: 'UTC',
      // Sem janela flexível: campanha agendada para 9h deve sair às 9h, não em
      // algum momento da hora seguinte.
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: this.opcoes.stateMachineArn,
        RoleArn: this.opcoes.papelArn,
        Input: JSON.stringify({
          tenantId: String(tenantId),
          campaignId: String(campaignId),
          origem: 'agendamento',
        }),
      },
      /**
       * Apaga-se sozinho depois de disparar.
       *
       * Sem isto, o grupo acumularia um agendamento morto por campanha para
       * sempre — e o EventBridge Scheduler tem cota de agendamentos por conta.
       */
      ActionAfterCompletion: 'DELETE' as const,
      Description: `Disparo da campanha ${String(campaignId)}`,
    };

    try {
      await this.scheduler.send(new CreateScheduleCommand(entrada));
    } catch (erro) {
      // Reagendar é operação normal: o operador muda a data antes de disparar.
      if (ehErroDoServico(erro, 'ConflictException')) {
        await this.scheduler.send(new UpdateScheduleCommand(entrada));
        return;
      }
      throw erro;
    }
  }

  async cancelarAgendamento(_tenantId: TenantId, campaignId: CampaignId): Promise<void> {
    try {
      await this.scheduler.send(
        new DeleteScheduleCommand({
          Name: nomeAgendamento(campaignId),
          GroupName: this.opcoes.grupo,
        }),
      );
    } catch (erro) {
      // Já disparou e se autoapagou, ou nunca existiu. Nos dois casos o
      // resultado desejado — não haver agendamento — já é o vigente.
      if (ehErroDoServico(erro, 'ResourceNotFoundException')) return;
      throw erro;
    }
  }

  /**
   * Dispara agora.
   *
   * O nome da execução carrega o minuto corrente. O Step Functions recusa nomes
   * repetidos, então dois cliques no botão dentro do mesmo minuto resultam numa
   * execução só — sem precisar de trava no banco.
   *
   * Vale notar que essa é a segunda linha de defesa, não a única: mesmo que duas
   * execuções começassem, o `sendId` determinístico e a guarda de idempotência
   * impediriam o envio duplicado (§5.4).
   */
  async dispararAgora(tenantId: TenantId, campaignId: CampaignId, agora: Date): Promise<string> {
    const janela = agora.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const nome = `${sanitizar(String(campaignId))}-${janela}`.slice(0, 80);

    try {
      const r = await this.sfn.send(
        new StartExecutionCommand({
          stateMachineArn: this.opcoes.stateMachineArn,
          name: nome,
          input: JSON.stringify({
            tenantId: String(tenantId),
            campaignId: String(campaignId),
            origem: 'imediato',
          }),
        }),
      );
      return r.executionArn ?? nome;
    } catch (erro) {
      // O clique duplo já foi atendido.
      if (ehErroDoServico(erro, 'ExecutionAlreadyExists')) return nome;
      throw erro;
    }
  }
}

/**
 * Identifica o erro pelo `name`, não por `instanceof`.
 *
 * `instanceof` falha silenciosamente quando existem duas cópias do mesmo pacote
 * do SDK na árvore de dependências — a classe é outra, ainda que o erro seja o
 * mesmo. O efeito aqui seria grave e difícil de achar: reagendar passaria a
 * lançar em vez de atualizar, e cancelar um agendamento inexistente viraria erro
 * 500. A própria AWS recomenda comparar pelo nome.
 */
function ehErroDoServico(erro: unknown, nomeEsperado: string): boolean {
  return typeof erro === 'object' && erro !== null && 'name' in erro && erro.name === nomeEsperado;
}

/** Nomes do Scheduler aceitam apenas `[0-9a-zA-Z-_.]`, até 64 caracteres. */
const nomeAgendamento = (campaignId: CampaignId): string =>
  `camp-${sanitizar(String(campaignId))}`.slice(0, 64);

const sanitizar = (bruto: string): string => bruto.replace(/[^0-9a-zA-Z\-_.]/g, '-');
