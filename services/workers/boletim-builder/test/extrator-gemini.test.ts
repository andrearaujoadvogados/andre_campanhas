import { describe, it, expect, vi } from 'vitest';
import {
  MODELOS_PADRAO,
  configuracaoDeRaciocinio,
  criarExtratorGemini,
  lerCadeiaDoAmbiente,
  type OpcoesExtratorGemini,
} from '../src/extrator-gemini.js';

/**
 * A política de insistência, testada contra um Gemini de mentira.
 *
 * Cada cenário aqui é uma rodada real de agosto/setembro de 2026 que falhou:
 * o 503 em série, o 404 do modelo que sumiu, o timeout tratado como erro
 * definitivo, e a cadeia gasta uma vez por rodada. O dublê de rede responde
 * por modelo, e o teste confere a SEQUÊNCIA de chamadas — porque é a ordem, e
 * não só o resultado, que decide se a próxima fonte tem chance.
 */

interface Chamada {
  modelo: string;
  corpo: { generationConfig?: { thinkingConfig?: unknown } };
}

type Roteiro = (modelo: string, chamada: Chamada, indice: number) => Response | Error;

function ok(texto = '[]'): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), {
    status: 200,
  });
}

function erro(status: number): Response {
  return new Response(JSON.stringify({ error: { code: status } }), { status });
}

function armar(roteiro: Roteiro): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: { body?: unknown }) => {
    const modelo = /models\/([^:]+):generateContent/.exec(String(url))?.[1] ?? '?';
    const chamada: Chamada = { modelo, corpo: JSON.parse(String(init?.body)) as Chamada['corpo'] };
    chamadas.push(chamada);
    const r = roteiro(modelo, chamada, chamadas.length - 1);
    if (r instanceof Error) throw r;
    return r;
  });
  return chamadas;
}

function extrator(extra: Partial<OpcoesExtratorGemini> = {}) {
  return criarExtratorGemini({
    chave: 'chave-de-teste',
    modelos: ['a', 'b', 'c'],
    prazoMs: Number.MAX_SAFE_INTEGER,
    dormir: async () => undefined,
    ...extra,
  });
}

describe('cadeia de modelos do Gemini', () => {
  it('insiste no mesmo modelo, depois passa ao próximo — e quem respondeu vira o preferido', async () => {
    const chamadas = armar((modelo) => (modelo === 'a' ? erro(503) : ok('[1]')));
    const ex = extrator();

    await expect(ex.completar('p')).resolves.toBe('[1]');
    // Três tentativas em `a` (esperas de 10 e 30 s dubladas), então `b`.
    expect(chamadas.map((c) => c.modelo)).toEqual(['a', 'a', 'a', 'b']);

    // A fonte seguinte não repete a peregrinação: começa por quem respondeu.
    await ex.completar('p2');
    expect(chamadas.at(-1)?.modelo).toBe('b');
    expect(ex.cadeia()).toEqual(['b', 'c', 'a']);
  });

  it('404 tira o modelo da rodada inteira, sem esperar', async () => {
    const chamadas = armar((modelo) => (modelo === 'a' ? erro(404) : ok()));
    const ex = extrator();

    await ex.completar('p');
    await ex.completar('p2');

    expect(chamadas.map((c) => c.modelo)).toEqual(['a', 'b', 'b']);
    expect(ex.cadeia()).toEqual(['b', 'c']);
  });

  it('timeout e falha de rede são transitórios: tenta de novo em vez de descartar a fonte', async () => {
    const chamadas = armar((_modelo, _c, indice) =>
      indice === 0 ? Object.assign(new Error('aborted'), { name: 'TimeoutError' }) : ok('[2]'),
    );

    await expect(extrator().completar('p')).resolves.toBe('[2]');
    expect(chamadas.map((c) => c.modelo)).toEqual(['a', 'a']);
  });

  it('com o prazo vencido não chama a IA e diz por quê', async () => {
    const chamadas = armar(() => ok());

    await expect(extrator({ prazoMs: 0 }).completar('p')).rejects.toThrow(/sem tempo/);
    expect(chamadas).toHaveLength(0);
  });

  it('não começa uma espera que atravessaria o prazo — e não pula para outro modelo depois dele', async () => {
    let relogio = 1_000_000;
    const chamadas = armar(() => erro(503));

    const ex = extrator({
      agora: () => relogio,
      esperasMs: [10_000, 30_000],
      // 5 s de prazo: a espera de 10 s não cabe.
      prazoMs: 1_000_000 + 5_000,
      dormir: async (ms) => {
        relogio += ms;
      },
    });

    await expect(ex.completar('p')).rejects.toThrow(/sem tempo/);
    expect(chamadas).toHaveLength(1);
  });

  it('400 com configuração de raciocínio: repete sem o campo e lembra disso', async () => {
    const chamadas = armar((_m, chamada) =>
      chamada.corpo.generationConfig?.thinkingConfig === undefined ? ok('[3]') : erro(400),
    );
    const ex = extrator({ modelos: ['gemini-2.5-flash-lite'] });

    await expect(ex.completar('p')).resolves.toBe('[3]');
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]?.corpo.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(chamadas[1]?.corpo.generationConfig?.thinkingConfig).toBeUndefined();

    await ex.completar('p2');
    expect(chamadas).toHaveLength(3);
    expect(chamadas[2]?.corpo.generationConfig?.thinkingConfig).toBeUndefined();
  });

  it('400 sem raciocínio envolvido é definitivo: desiste na hora', async () => {
    const chamadas = armar(() => erro(400));

    // `a` não recebe configuração de raciocínio, então o 400 é da requisição.
    await expect(extrator().completar('p')).rejects.toThrow(/HTTP 400/);
    expect(chamadas).toHaveLength(1);
  });

  it('todos sobrecarregados: a mensagem lista os vivos e manda gerar de novo', async () => {
    const chamadas = armar(() => erro(503));

    await expect(extrator().completar('p')).rejects.toThrow(/Nenhum modelo respondeu \(a, b, c\)/);
    expect(chamadas).toHaveLength(9);
  });

  it('todos mortos: a mensagem aponta para a lista de modelos', async () => {
    armar(() => erro(404));

    await expect(extrator().completar('p')).rejects.toThrow(/MODELOS_GEMINI/);
  });

  it('as partes de raciocínio não entram no texto da resposta', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ thought: true, text: 'pensando…' }, { text: '[4]' }] } },
            ],
          }),
          { status: 200 },
        ),
    );

    await expect(extrator().completar('p')).resolves.toBe('[4]');
  });

  it('bate o pulso antes de cada chamada e de cada espera', async () => {
    armar((modelo) => (modelo === 'a' ? erro(503) : ok()));
    let pulsos = 0;

    await extrator({
      pulso: async () => {
        pulsos += 1;
      },
    }).completar('p');

    // 4 chamadas (a, a, a, b) + 2 esperas.
    expect(pulsos).toBe(6);
  });
});

describe('configuração da cadeia', () => {
  it('lê MODELOS_GEMINI como lista, tolerando espaços e vírgulas sobrando', () => {
    expect(lerCadeiaDoAmbiente(' x , y ,, ')).toEqual(['x', 'y']);
  });

  it('ausente ou vazio cai na cadeia padrão, que termina no alias', () => {
    expect(lerCadeiaDoAmbiente(undefined)).toBe(MODELOS_PADRAO);
    expect(lerCadeiaDoAmbiente('')).toBe(MODELOS_PADRAO);
    expect(MODELOS_PADRAO.at(-1)).toBe('gemini-flash-latest');
  });

  it('raciocínio: orçamento zero na família 2.5, nível baixo na 3, nada para o alias', () => {
    expect(configuracaoDeRaciocinio('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
    expect(configuracaoDeRaciocinio('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'low' });
    expect(configuracaoDeRaciocinio('gemini-flash-latest')).toBeNull();
  });
});
