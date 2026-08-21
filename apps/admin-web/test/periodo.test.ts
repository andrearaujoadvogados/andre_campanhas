import { describe, it, expect } from 'vitest';
import {
  dentroDaJanela,
  diasDaJanela,
  janelaAnterior,
  janelaPersonalizada,
  janelaRecente,
} from '../src/lib/periodo.js';

describe('janela recente', () => {
  it('cobre os últimos N dias corridos, terminando agora', () => {
    const agora = new Date('2026-08-20T15:00:00Z');
    const j = janelaRecente(7, agora);

    expect(j.desde.toISOString()).toBe('2026-08-13T15:00:00.000Z');
    expect(j.ate.toISOString()).toBe('2026-08-20T15:00:00.000Z');
    expect(diasDaJanela(j)).toBe(7);
  });
});

describe('janela escolhida no formulário', () => {
  it('inclui o dia final inteiro', () => {
    // Quem escolhe "até 31/08" espera o dia 31 inteiro dentro da conta. Fechar
    // a janela na meia-noite que abre o dia deixaria de fora tudo o que foi
    // disparado nele — e o total não bateria com o do relatório da campanha.
    const j = janelaPersonalizada('2026-08-01', '2026-08-31');

    expect(j?.desde.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(j?.ate.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('conta as datas no fuso de São Paulo, não em UTC', () => {
    // Um disparo às 22h de 31/07 no horário de Brasília é 01/08 em UTC. Lendo
    // as datas em UTC, ele cairia no período de agosto — um dia depois do que
    // quem operou o sistema viu na tela.
    const j = janelaPersonalizada('2026-08-01', '2026-08-01');

    expect(dentroDaJanela('2026-08-01T01:00:00Z', j!)).toBe(false); // 31/07, 22h em SP
    expect(dentroDaJanela('2026-08-01T03:00:00Z', j!)).toBe(true); // 01/08, 00h em SP
    expect(dentroDaJanela('2026-08-02T02:59:00Z', j!)).toBe(true); // 01/08, 23h59 em SP
    expect(dentroDaJanela('2026-08-02T03:00:00Z', j!)).toBe(false); // 02/08, 00h em SP
  });

  it('recusa intervalo incompleto, inválido ou de trás para frente', () => {
    expect(janelaPersonalizada('', '2026-08-31')).toBeNull();
    expect(janelaPersonalizada('2026-08-01', '')).toBeNull();
    expect(janelaPersonalizada('01/08/2026', '2026-08-31')).toBeNull();
    expect(janelaPersonalizada('2026-08-31', '2026-08-01')).toBeNull();
  });

  it('aceita um único dia', () => {
    expect(janelaPersonalizada('2026-08-10', '2026-08-10')).not.toBeNull();
  });
});

describe('janela anterior', () => {
  it('tem a mesma duração e termina onde a atual começa', () => {
    // Comparar 30 dias contra um intervalo de outro tamanho faria a variação
    // falar mais sobre o calendário do que sobre as campanhas.
    const atual = janelaRecente(30, new Date('2026-08-20T00:00:00Z'));
    const passada = janelaAnterior(atual);

    expect(passada.ate.toISOString()).toBe(atual.desde.toISOString());
    expect(passada.desde.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(diasDaJanela(passada)).toBe(diasDaJanela(atual));
  });
});

describe('pertencimento à janela', () => {
  const j = janelaRecente(7, new Date('2026-08-20T00:00:00Z'));

  it('é semiaberta: inclui o início e exclui o fim', () => {
    // Sem isso, um disparo exatamente na fronteira contaria nas duas janelas e
    // apareceria somado duas vezes na comparação.
    expect(dentroDaJanela('2026-08-13T00:00:00Z', j)).toBe(true);
    expect(dentroDaJanela('2026-08-20T00:00:00Z', j)).toBe(false);
  });

  it('data ausente ou inválida fica de fora', () => {
    expect(dentroDaJanela(null, j)).toBe(false);
    expect(dentroDaJanela(undefined, j)).toBe(false);
    expect(dentroDaJanela('', j)).toBe(false);
    expect(dentroDaJanela('nem data', j)).toBe(false);
  });
});
