import type { CampaignStatus } from './campaign.js';

/**
 * Decide se um disparo acabou — a pergunta que o orquestrador faz em laço.
 *
 * Puro de propósito: é a lógica com mais chance de travar uma campanha para
 * sempre ou de encerrá-la cedo demais, e as duas falhas são silenciosas. Testar
 * isso com Step Functions de verdade seria caro e lento; aqui custa
 * microssegundos.
 */
export interface EstadoProgresso {
  readonly statusCampanha: CampaignStatus | null;
  /** Quantos destinatários o launcher enfileirou. */
  readonly esperados: number;
  /** Quantos já têm registro de envio — enviado, falhou ou suprimido. */
  readonly processados: number;
  readonly decorridoSegundos: number;
}

export type DecisaoProgresso =
  | { readonly acao: 'AGUARDAR'; readonly esperarSegundos: number }
  | { readonly acao: 'FINALIZAR' }
  | { readonly acao: 'FINALIZAR_COM_RESSALVA'; readonly motivo: string }
  | { readonly acao: 'ENCERRAR'; readonly motivo: string };

/**
 * Teto de duração de um disparo.
 *
 * Existe porque a contagem de processados pode **nunca** alcançar o esperado: um
 * contato excluído no meio do disparo não gera registro de envio, e o laço
 * ficaria rodando até o limite do Step Functions. Sem este teto, uma campanha
 * ficaria eternamente "ENVIANDO" no painel e ninguém saberia se foi enviada.
 *
 * 24h é folgado de sobra: com a cota atual de 200/dia, uma campanha de 5.000
 * contatos leva dias — mas nesse caso ela é limitada pela cota, não pelo laço, e
 * a ressalva no fim é o que comunica isso ao operador.
 */
export const LIMITE_DISPARO_SEGUNDOS = 24 * 60 * 60;

/** Intervalo entre verificações. Curto no começo, mais espaçado depois. */
export function intervaloVerificacao(decorridoSegundos: number): number {
  if (decorridoSegundos < 300) return 30;
  if (decorridoSegundos < 3600) return 120;
  return 300;
}

export function decidirProgresso(estado: EstadoProgresso): DecisaoProgresso {
  if (estado.statusCampanha === null) {
    return { acao: 'ENCERRAR', motivo: 'Campanha não existe mais.' };
  }

  // Cancelamento tem precedência sobre tudo: se o operador cancelou, não
  // importa quantos faltam.
  if (estado.statusCampanha === 'CANCELADA') {
    return { acao: 'ENCERRAR', motivo: 'Campanha cancelada durante o disparo.' };
  }

  if (estado.statusCampanha === 'CONCLUIDA') {
    // Já finalizada por outra execução. Encerrar sem refazer nada.
    return { acao: 'ENCERRAR', motivo: 'Campanha já estava concluída.' };
  }

  if (estado.esperados === 0) {
    // Audiência vazia — nada a esperar. Acontece quando a lista inteira está
    // inelegível, o que é comum na primeira importação (§6.2).
    return { acao: 'FINALIZAR' };
  }

  if (estado.processados >= estado.esperados) {
    return { acao: 'FINALIZAR' };
  }

  if (estado.decorridoSegundos >= LIMITE_DISPARO_SEGUNDOS) {
    const faltando = estado.esperados - estado.processados;
    return {
      acao: 'FINALIZAR_COM_RESSALVA',
      motivo:
        `Tempo limite de disparo atingido com ${faltando} de ${estado.esperados} destinatários ` +
        'sem registro. Causas comuns: cota diária do SES esgotada, ou contatos excluídos após o ' +
        'enfileiramento. Verifique a fila e a DLQ antes de reenviar.',
    };
  }

  // Pausada continua no laço: o operador pode retomar, e encerrar aqui
  // abandonaria as mensagens que ainda estão na fila.
  return { acao: 'AGUARDAR', esperarSegundos: intervaloVerificacao(estado.decorridoSegundos) };
}
