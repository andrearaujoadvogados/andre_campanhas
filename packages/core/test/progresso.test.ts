import { describe, it, expect } from 'vitest';
import {
  LIMITE_DISPARO_SEGUNDOS,
  decidirProgresso,
  intervaloVerificacao,
  type EstadoProgresso,
} from '../src/domain/campaign/progresso.js';

const estado = (over: Partial<EstadoProgresso> = {}): EstadoProgresso => ({
  statusCampanha: 'ENVIANDO',
  esperados: 100,
  processados: 0,
  decorridoSegundos: 60,
  ...over,
});

describe('decisão de progresso do disparo', () => {
  it('aguarda enquanto faltam destinatários', () => {
    const d = decidirProgresso(estado({ processados: 50 }));
    expect(d.acao).toBe('AGUARDAR');
  });

  it('finaliza quando todos foram processados', () => {
    expect(decidirProgresso(estado({ processados: 100 })).acao).toBe('FINALIZAR');
  });

  it('finaliza se o contador passou do esperado', () => {
    // Pode acontecer com reprocessamento; não é motivo para travar o laço.
    expect(decidirProgresso(estado({ processados: 105 })).acao).toBe('FINALIZAR');
  });

  it('finaliza imediatamente com audiência vazia', () => {
    // Comum na primeira importação, quando a lista inteira está inelegível.
    expect(decidirProgresso(estado({ esperados: 0 })).acao).toBe('FINALIZAR');
  });
});

describe('cancelamento tem precedência', () => {
  it('encerra mesmo com destinatários pendentes', () => {
    const d = decidirProgresso(estado({ statusCampanha: 'CANCELADA', processados: 10 }));

    expect(d.acao).toBe('ENCERRAR');
    if (d.acao === 'ENCERRAR') expect(d.motivo).toMatch(/cancelada/i);
  });

  it('encerra se a campanha sumiu', () => {
    expect(decidirProgresso(estado({ statusCampanha: null })).acao).toBe('ENCERRAR');
  });

  it('não refinaliza campanha já concluída', () => {
    const d = decidirProgresso(estado({ statusCampanha: 'CONCLUIDA', processados: 100 }));
    expect(d.acao).toBe('ENCERRAR');
  });
});

describe('pausa mantém o laço vivo', () => {
  it('campanha pausada continua aguardando, não encerra', () => {
    // Encerrar aqui abandonaria as mensagens que ainda estão na fila e que
    // voltam a ser processadas quando o operador retomar.
    const d = decidirProgresso(estado({ statusCampanha: 'PAUSADA', processados: 10 }));
    expect(d.acao).toBe('AGUARDAR');
  });
});

describe('teto de duração — evita campanha eternamente ENVIANDO', () => {
  it('finaliza com ressalva ao atingir o limite', () => {
    // O contador pode nunca alcançar o esperado: um contato excluído no meio do
    // disparo não gera registro de envio.
    const d = decidirProgresso(
      estado({ processados: 90, decorridoSegundos: LIMITE_DISPARO_SEGUNDOS }),
    );

    expect(d.acao).toBe('FINALIZAR_COM_RESSALVA');
    if (d.acao === 'FINALIZAR_COM_RESSALVA') {
      expect(d.motivo).toMatch(/10 de 100/);
      expect(d.motivo).toMatch(/DLQ/);
    }
  });

  it('conclusão normal vence a ressalva mesmo no limite', () => {
    const d = decidirProgresso(
      estado({ processados: 100, decorridoSegundos: LIMITE_DISPARO_SEGUNDOS + 1 }),
    );
    expect(d.acao).toBe('FINALIZAR');
  });

  it('cancelamento vence a ressalva', () => {
    const d = decidirProgresso(
      estado({ statusCampanha: 'CANCELADA', decorridoSegundos: LIMITE_DISPARO_SEGUNDOS + 1 }),
    );
    expect(d.acao).toBe('ENCERRAR');
  });
});

describe('intervalo de verificação cresce com o tempo', () => {
  it.each([
    [0, 30],
    [299, 30],
    [300, 120],
    [3599, 120],
    [3600, 300],
    [86_400, 300],
  ])('decorrido %is → espera %is', (decorrido, esperado) => {
    // Verificar de 30 em 30 segundos por 24h somaria 2.880 invocações e
    // transições de estado por campanha, para nada.
    expect(intervaloVerificacao(decorrido)).toBe(esperado);
  });
});
