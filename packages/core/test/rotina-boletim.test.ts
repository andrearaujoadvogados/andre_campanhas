import { describe, expect, it } from 'vitest';
import {
  campaignId,
  execucaoBoletimId,
  expressaoCronDaRotina,
  iniciarExecucao,
  registrarEnvioAutomatico,
  TENANT_PADRAO,
  validarRecorrencia,
} from '../src/index.js';

describe('validação da recorrência', () => {
  it('aceita diária com horário válido', () => {
    expect(validarRecorrencia({ periodicidade: 'DIARIA', horario: '08:00' }).ok).toBe(true);
  });

  it('recusa horário fora do formato ou inexistente', () => {
    expect(validarRecorrencia({ periodicidade: 'DIARIA', horario: '8h' }).ok).toBe(false);
    expect(validarRecorrencia({ periodicidade: 'DIARIA', horario: '25:00' }).ok).toBe(false);
    expect(validarRecorrencia({ periodicidade: 'DIARIA', horario: '10:75' }).ok).toBe(false);
  });

  it('semanal exige o dia da semana — nenhum padrão silencioso decide por quem cadastrou', () => {
    expect(validarRecorrencia({ periodicidade: 'SEMANAL', horario: '08:00' }).ok).toBe(false);
    expect(
      validarRecorrencia({ periodicidade: 'SEMANAL', horario: '08:00', diaDaSemana: 8 }).ok,
    ).toBe(false);
    expect(
      validarRecorrencia({ periodicidade: 'SEMANAL', horario: '08:00', diaDaSemana: 7 }).ok,
    ).toBe(true);
  });

  it('mensal exige dia 1 a 28 — 29 a 31 pulariam meses em silêncio', () => {
    expect(validarRecorrencia({ periodicidade: 'MENSAL', horario: '08:00' }).ok).toBe(false);
    expect(validarRecorrencia({ periodicidade: 'MENSAL', horario: '08:00', diaDoMes: 31 }).ok).toBe(
      false,
    );
    expect(validarRecorrencia({ periodicidade: 'MENSAL', horario: '08:00', diaDoMes: 28 }).ok).toBe(
      true,
    );
  });
});

describe('expressão cron do EventBridge', () => {
  // O fuso NÃO entra na expressão: vai em ScheduleExpressionTimezone. Por isso
  // o horário local aparece literal no cron.
  it('diária', () => {
    expect(expressaoCronDaRotina({ periodicidade: 'DIARIA', horario: '08:30' })).toBe(
      'cron(30 8 * * ? *)',
    );
  });

  it('semanal usa o nome do dia — 1 (ISO, segunda) vira MON', () => {
    expect(
      expressaoCronDaRotina({ periodicidade: 'SEMANAL', horario: '07:00', diaDaSemana: 1 }),
    ).toBe('cron(0 7 ? * MON *)');
    expect(
      expressaoCronDaRotina({ periodicidade: 'SEMANAL', horario: '07:00', diaDaSemana: 7 }),
    ).toBe('cron(0 7 ? * SUN *)');
  });

  it('mensal fixa o dia do mês e deixa o dia da semana como ?', () => {
    expect(expressaoCronDaRotina({ periodicidade: 'MENSAL', horario: '09:15', diaDoMes: 15 })).toBe(
      'cron(15 9 15 * ? *)',
    );
  });

  it('recusa recorrência inválida em vez de gerar um cron errado', () => {
    expect(() => expressaoCronDaRotina({ periodicidade: 'SEMANAL', horario: '08:00' })).toThrow(
      /dia da semana/,
    );
  });
});

describe('desfecho do envio automático na execução', () => {
  const base = iniciarExecucao({
    tenantId: TENANT_PADRAO,
    execucaoId: execucaoBoletimId('e-1'),
    origem: 'ROTINA',
    agora: new Date('2026-08-20T11:00:00Z'),
  });

  it('sucesso guarda a campanha disparada', () => {
    const depois = registrarEnvioAutomatico(
      base,
      { campaignId: campaignId('k-1') },
      new Date('2026-08-20T11:02:00Z'),
    );
    expect(depois.envioCampaignId).toBe('k-1');
    expect(depois.envioErro).toBeUndefined();
  });

  it('falha guarda o motivo sem mudar a situação da geração', () => {
    // O modelo FOI gerado; o que não saiu foi o e-mail. Rebaixar a execução a
    // FALHOU apagaria o trabalho feito e o link do modelo pronto para disparo.
    const depois = registrarEnvioAutomatico(
      base,
      { erro: 'lista inexistente' },
      new Date('2026-08-20T11:02:00Z'),
    );
    expect(depois.envioErro).toBe('lista inexistente');
    expect(depois.situacao).toBe(base.situacao);
    expect(depois.envioCampaignId).toBeUndefined();
  });
});
