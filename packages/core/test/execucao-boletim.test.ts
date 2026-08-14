import { describe, it, expect } from 'vitest';
import {
  LIMITE_SEM_SINAL_MS,
  TENANT_PADRAO,
  encerrarExecucao,
  estaEmAndamento,
  execucaoBoletimId,
  iniciarExecucao,
  situacaoVisivel,
  templateId,
  userId,
} from '../src/index.js';

const AGORA = new Date('2026-08-13T16:00:00Z');

const nova = () =>
  iniciarExecucao({
    tenantId: TENANT_PADRAO,
    execucaoId: execucaoBoletimId('e-1'),
    origem: 'MANUAL',
    agora: AGORA,
    solicitadaPor: userId('u-1'),
  });

describe('execução do boletim — o registro que torna a geração visível', () => {
  it('nasce executando, na etapa inicial e sem nada coletado', () => {
    const e = nova();

    expect(e.situacao).toBe('EXECUTANDO');
    expect(e.etapa).toBe('INICIANDO');
    expect(e.totalNoticias).toBe(0);
    expect(e.concluidaEm).toBeUndefined();
  });

  it('continua "executando" enquanto dá sinal de vida', () => {
    const e = nova();
    const daquiUmMinuto = new Date(AGORA.getTime() + 60_000);

    expect(situacaoVisivel(e, daquiUmMinuto)).toBe('EXECUTANDO');
    expect(estaEmAndamento(e, daquiUmMinuto)).toBe(true);
  });

  it('vira TRAVADA depois do limite de silêncio — a tela não pode prometer para sempre', () => {
    const e = nova();
    const depoisDoLimite = new Date(AGORA.getTime() + LIMITE_SEM_SINAL_MS + 1_000);

    expect(situacaoVisivel(e, depoisDoLimite)).toBe('TRAVADA');
    // E travada NÃO bloqueia uma nova geração: um worker morto não pode
    // trancar o botão até alguém mexer no banco.
    expect(estaEmAndamento(e, depoisDoLimite)).toBe(false);
  });

  it('o batimento reinicia a contagem do silêncio', () => {
    const e = { ...nova(), atualizadaEm: new Date(AGORA.getTime() + 3 * 60_000) };
    const quatroMinutosDepoisDoInicio = new Date(AGORA.getTime() + 4 * 60_000 + 1_000);

    // Passou do limite contado do início, mas não do último sinal.
    expect(situacaoVisivel(e, quatroMinutosDepoisDoInicio)).toBe('EXECUTANDO');
  });

  it('concluir guarda o modelo gerado e limpa a fonte corrente', () => {
    const emCurso = { ...nova(), fonteAtual: 'Migalhas', fontesTotal: 2, fontesConcluidas: 2 };
    const fim = new Date(AGORA.getTime() + 90_000);

    const e = encerrarExecucao(
      emCurso,
      {
        situacao: 'CONCLUIDA',
        templateId: templateId('t-9'),
        templateNome: 'Boletim automático — 13/08/2026',
        totalNoticias: 7,
        avisos: ['Conjur: a página veio vazia.'],
      },
      fim,
    );

    expect(e.situacao).toBe('CONCLUIDA');
    expect(String(e.templateId)).toBe('t-9');
    expect(e.totalNoticias).toBe(7);
    expect(e.concluidaEm).toEqual(fim);
    // Sem isto a tela diria "lendo Migalhas" ao lado de "concluída".
    expect(e.fonteAtual).toBeUndefined();
    expect(situacaoVisivel(e, new Date(AGORA.getTime() + 86_400_000))).toBe('CONCLUIDA');
  });

  it('nada encontrado NÃO é falha — e carrega o motivo de cada fonte', () => {
    const e = encerrarExecucao(
      nova(),
      { situacao: 'SEM_NOTICIAS', avisos: ['Migalhas: nada encontrado que atenda à instrução.'] },
      AGORA,
    );

    // A distinção guia o que o operador faz a seguir: revisar a instrução da
    // fonte, e não caçar defeito no sistema.
    expect(e.situacao).toBe('SEM_NOTICIAS');
    expect(e.totalNoticias).toBe(0);
    expect(e.avisos).toHaveLength(1);
    expect(e.erro).toBeUndefined();
  });

  it('falhar guarda a mensagem que a tela vai mostrar', () => {
    const e = encerrarExecucao(
      nova(),
      { situacao: 'FALHOU', erro: 'limite gratuito atingido' },
      AGORA,
    );

    expect(e.situacao).toBe('FALHOU');
    expect(e.erro).toBe('limite gratuito atingido');
    expect(e.templateId).toBeUndefined();
  });
});
