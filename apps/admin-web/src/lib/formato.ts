/** Formatação em pt-BR. Centralizada para não haver duas datas diferentes na tela. */

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const DATA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const NUMERO = new Intl.NumberFormat('pt-BR');

/**
 * Datas chegam da API em UTC (ISO). Exibir em UTC faria uma campanha agendada
 * para as 9h aparecer como 12h — e o operador concluiria que o agendamento
 * está errado.
 */
export const dataHora = (iso: string | undefined | null): string =>
  iso === undefined || iso === null ? '—' : DATA_HORA.format(new Date(iso));

export const data = (iso: string | undefined | null): string =>
  iso === undefined || iso === null ? '—' : DATA.format(new Date(iso));

export const numero = (n: number): string => NUMERO.format(n);

/**
 * Percentual com uma casa decimal.
 *
 * Uma casa importa: a taxa crítica de reclamação é 0,3%, e arredondar para
 * inteiro mostraria "0%" numa campanha que está prestes a derrubar a conta.
 */
export const percentual = (fracao: number): string =>
  `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

export const ROTULO_STATUS_CAMPANHA: Readonly<Record<string, string>> = {
  RASCUNHO: 'Rascunho',
  EM_REVISAO: 'Em revisão',
  APROVADA: 'Aprovada',
  AGENDADA: 'Agendada',
  ENVIANDO: 'Enviando',
  PAUSADA: 'Pausada',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

export const ROTULO_STATUS_CONTATO: Readonly<Record<string, string>> = {
  ATIVO: 'Ativo',
  DESCADASTRADO: 'Descadastrado',
  OPOSICAO: 'Oposição ao tratamento',
  BOUNCE: 'Endereço inválido',
  RECLAMACAO: 'Marcou como spam',
  SUPRIMIDO: 'Suprimido',
};

export const ROTULO_RELACIONAMENTO: Readonly<Record<string, string>> = {
  CLIENTE_ATIVO: 'Cliente ativo',
  EX_CLIENTE: 'Ex-cliente',
  PROSPECT_CONTATO: 'Contato/prospect',
  EVENTO: 'Conheceu em evento',
  INDICACAO: 'Indicação',
  DESCONHECIDO: 'Não classificado',
};

export const ROTULO_MOTIVO: Readonly<Record<string, string>> = {
  RELACIONAMENTO_DESCONHECIDO: 'Sem vínculo classificado',
  SEM_BASE_LEGAL: 'Sem base legal registrada',
  VINCULO_EXPIRADO: 'Vínculo antigo demais',
  STATUS: 'Situação do contato',
};
