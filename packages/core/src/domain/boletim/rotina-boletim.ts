import type { FonteId, ListId, RotinaId, TenantId, TipoEmailId, UserId } from '../shared/ids.js';

/**
 * Rotina de envio automático do boletim — geração E disparo, sem clique.
 *
 * É a decisão que o resto do módulo evitou de propósito: o construtor do
 * boletim sempre parou no modelo, deixando o disparo para uma pessoa. A rotina
 * inverte isso por escolha explícita do escritório — quem a cadastra está
 * dizendo "o que a IA montar neste horário sai para estas listas, sem revisão".
 * Por isso a entidade carrega as listas de destino consigo: o alcance do envio
 * automático fica escrito no cadastro, não decidido na hora por um padrão
 * qualquer.
 *
 * Cada rotina também escolhe o RECORTE editorial da edição: as fontes lidas,
 * os temas que orientam a IA e o tipo de e-mail (Boletim, Notícias…) — o que
 * permite rotinas diferentes com linhas editoriais diferentes no mesmo
 * catálogo de fontes.
 */
export type PeriodicidadeRotina = 'DIARIA' | 'SEMANAL' | 'MENSAL';

export interface RotinaBoletim {
  readonly tenantId: TenantId;
  readonly rotinaId: RotinaId;
  /** Nome da rotina — vira o nome do modelo e das campanhas de cada edição. */
  readonly nome: string;
  readonly periodicidade: PeriodicidadeRotina;
  /** Horário local de São Paulo, "HH:mm" — quem agenda pensa no relógio da parede. */
  readonly horario: string;
  /** 1 = segunda … 7 = domingo (ISO 8601). Obrigatório quando SEMANAL. */
  readonly diaDaSemana?: number;
  /** 1 a 28 — teto em 28 para o boletim sair TODO mês, fevereiro incluído. Obrigatório quando MENSAL. */
  readonly diaDoMes?: number;
  /** Tipo de e-mail do catálogo — dá a categoria do modelo e o tipo da campanha. */
  readonly tipoEmailId?: TipoEmailId;
  /** Temas que orientam a seleção da IA. Vazio = a instrução de cada fonte manda sozinha. */
  readonly temas: readonly string[];
  /** Fontes desta rotina. Vazio = todas as fontes ativas do catálogo. */
  readonly fonteIds: readonly FonteId[];
  /** Listas que recebem o boletim gerado — uma campanha disparada por lista. */
  readonly listIds: readonly ListId[];
  /** Desligada fica cadastrada, mas nada gera nem envia — pausa sem perder a configuração. */
  readonly ativa: boolean;
  readonly criadoPor: UserId;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
}

/**
 * Fuso da rotina, fixo no do escritório.
 *
 * O EventBridge Scheduler aplica o fuso por nome (com regras de calendário),
 * então "08:00" cadastrado é 08:00 na parede de São Paulo em qualquer época do
 * ano — sem a conversão manual para UTC que quebraria se o horário de verão
 * voltasse.
 */
export const FUSO_ROTINA = 'America/Sao_Paulo';

/**
 * Valida o que o schema de forma não alcança: os campos cruzados.
 *
 * Semanal sem dia da semana dispararia... quando? Qualquer padrão silencioso
 * (segunda? o dia do cadastro?) seria uma decisão escondida de quem cadastrou.
 * O erro devolve a pergunta a quem pode respondê-la.
 */
export function validarRecorrencia(dados: {
  readonly periodicidade: PeriodicidadeRotina;
  readonly horario: string;
  readonly diaDaSemana?: number | undefined;
  readonly diaDoMes?: number | undefined;
}): { ok: true } | { ok: false; motivo: string } {
  const m = /^(\d{2}):(\d{2})$/.exec(dados.horario);
  if (m === null) return { ok: false, motivo: 'Horário deve estar no formato HH:mm.' };
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) return { ok: false, motivo: 'Horário inexistente.' };

  if (dados.periodicidade === 'SEMANAL') {
    const dia = dados.diaDaSemana;
    if (dia === undefined || !Number.isInteger(dia) || dia < 1 || dia > 7) {
      return {
        ok: false,
        motivo: 'Rotina semanal precisa do dia da semana (1=segunda a 7=domingo).',
      };
    }
  }

  if (dados.periodicidade === 'MENSAL') {
    const dia = dados.diaDoMes;
    if (dia === undefined || !Number.isInteger(dia) || dia < 1 || dia > 28) {
      return {
        ok: false,
        // 29 a 31 não existem em todo mês; o EventBridge simplesmente pularia
        // esses meses, e um boletim mensal que falta em fevereiro é o tipo de
        // silêncio que ninguém percebe até o cliente perguntar.
        motivo: 'Rotina mensal aceita dia 1 a 28 — dias 29 a 31 não existem em todos os meses.',
      };
    }
  }

  return { ok: true };
}

/** Nomes que o cron do EventBridge aceita, indexados pelo dia ISO (1=segunda). */
const DIA_CRON = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/**
 * A expressão cron do EventBridge Scheduler para esta rotina.
 *
 * Formato de seis campos: `cron(minuto hora dia-do-mês mês dia-da-semana ano)`,
 * onde dia-do-mês e dia-da-semana não podem ser ambos definidos — o campo não
 * usado leva `?`. O fuso NÃO entra aqui: vai em `ScheduleExpressionTimezone`
 * (ver FUSO_ROTINA), e é por isso que o horário local basta.
 *
 * Pressupõe recorrência válida — chame `validarRecorrencia` antes; entrada
 * inválida aqui é bug de quem chamou, e lançar é o comportamento certo.
 */
export function expressaoCronDaRotina(
  rotina: Pick<RotinaBoletim, 'periodicidade' | 'horario' | 'diaDaSemana' | 'diaDoMes'>,
): string {
  const valida = validarRecorrencia(rotina);
  if (!valida.ok) throw new Error(`Recorrência inválida: ${valida.motivo}`);

  const [hora, minuto] = rotina.horario.split(':').map(Number);

  switch (rotina.periodicidade) {
    case 'DIARIA':
      return `cron(${minuto} ${hora} * * ? *)`;
    case 'SEMANAL':
      return `cron(${minuto} ${hora} ? * ${DIA_CRON[(rotina.diaDaSemana ?? 1) - 1]} *)`;
    case 'MENSAL':
      return `cron(${minuto} ${hora} ${rotina.diaDoMes} * ? *)`;
  }
}

/**
 * Remetente do envio automático — o mesmo padrão fixo do assistente de
 * campanha (o e-mail é a identidade verificada no SES; outro qualquer seria
 * recusado no envio). Se o padrão do assistente mudar, este muda junto.
 */
export const REMETENTE_ROTINA = {
  nome: 'André Araújo Advogados',
  email: 'campanhas@mail.andrearaujoadvogados.com.br',
} as const;
