import type { SchedulerClient } from '@aws-sdk/client-scheduler';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  FUSO_ROTINA,
  expressaoCronDaRotina,
  type RotinaBoletim,
  type RotinaBoletimScheduler,
  type RotinaId,
  type TenantId,
} from '@emailmkt/core';

export interface OpcoesRotinaScheduler {
  readonly grupo: string;
  /** ARN da Lambda `boletim-builder` — o alvo de cada disparo da rotina. */
  readonly alvoArn: string;
  readonly papelArn: string;
}

/**
 * Agenda recorrente da rotina de envio — EventBridge Scheduler com cron.
 *
 * Difere do agendamento de campanha (`at()`, um disparo, autoapaga) no que a
 * rotina exige: expressão `cron` que se repete e fuso aplicado pelo serviço
 * (`ScheduleExpressionTimezone`), para "08:00" valer no relógio de São Paulo
 * sem conversão nossa. O alvo é a Lambda do construtor do boletim, que ao ver
 * `origem: 'rotina'` gera o modelo E dispara para a lista da rotina.
 */
export class EventBridgeRotinaScheduler implements RotinaBoletimScheduler {
  constructor(
    private readonly scheduler: SchedulerClient,
    private readonly opcoes: OpcoesRotinaScheduler,
  ) {}

  async sincronizar(rotina: RotinaBoletim): Promise<void> {
    // Inativa = sem agenda. Manter uma agenda DISABLED seria equivalente na
    // prática, mas deixaria dois lugares dizendo se a rotina vale — o banco e
    // o Scheduler — e um dia eles divergiriam.
    if (!rotina.ativa) {
      await this.remover(rotina.tenantId, rotina.rotinaId);
      return;
    }

    const entrada = {
      Name: nomeAgenda(rotina.rotinaId),
      GroupName: this.opcoes.grupo,
      ScheduleExpression: expressaoCronDaRotina(rotina),
      ScheduleExpressionTimezone: FUSO_ROTINA,
      // Sem janela flexível: boletim das 8h sai às 8h — o horário foi escolhido
      // por alguém pensando em quando o cliente abre o e-mail.
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: this.opcoes.alvoArn,
        RoleArn: this.opcoes.papelArn,
        // Só identificadores. A lista, o horário e o resto são lidos do banco
        // na hora do disparo — editar a rotina vale já na próxima execução,
        // sem depender de reescrever esta agenda.
        Input: JSON.stringify({
          origem: 'rotina',
          tenantId: String(rotina.tenantId),
          rotinaId: String(rotina.rotinaId),
        }),
      },
      Description: `Rotina de envio automático do boletim ${String(rotina.rotinaId)}`,
    };

    try {
      await this.scheduler.send(new CreateScheduleCommand(entrada));
    } catch (erro) {
      // Editar a recorrência é operação normal; a agenda existente é atualizada.
      if (ehErroDoServico(erro, 'ConflictException')) {
        await this.scheduler.send(new UpdateScheduleCommand(entrada));
        return;
      }
      throw erro;
    }
  }

  async remover(_tenantId: TenantId, rotinaId: RotinaId): Promise<void> {
    try {
      await this.scheduler.send(
        new DeleteScheduleCommand({ Name: nomeAgenda(rotinaId), GroupName: this.opcoes.grupo }),
      );
    } catch (erro) {
      // Nunca existiu (rotina criada já inativa): o estado desejado já vale.
      if (ehErroDoServico(erro, 'ResourceNotFoundException')) return;
      throw erro;
    }
  }
}

/** Mesma razão do agendador de campanha: `instanceof` falha com SDK duplicado na árvore. */
function ehErroDoServico(erro: unknown, nomeEsperado: string): boolean {
  return typeof erro === 'object' && erro !== null && 'name' in erro && erro.name === nomeEsperado;
}

const nomeAgenda = (rotinaId: RotinaId): string =>
  `rotina-${String(rotinaId).replace(/[^0-9a-zA-Z\-_.]/g, '-')}`.slice(0, 64);
