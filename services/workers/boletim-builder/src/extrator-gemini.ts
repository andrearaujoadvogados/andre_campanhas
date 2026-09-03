import {
  decidirPelaFalhaDeRedeDoExtrator,
  decidirPelaRespostaDoExtrator,
  type DecisaoDoExtrator,
  type ExtratorPorIa,
} from '@emailmkt/core';

/**
 * Gemini via REST — o único trecho que conhece o provedor.
 *
 * O prompt e a interpretação da resposta são regra de domínio e moram no
 * core; aqui fica só o transporte e a POLÍTICA DE INSISTÊNCIA, que é o que
 * esta versão reescreve. A lição veio de produção, entre 27/08 e 03/09/2026:
 * 13 de 15 rodadas falharam porque a cadeia de modelos inteira estava morta
 * — o alias `gemini-flash-latest` passou a apontar para um modelo que
 * respondia 503 em sete de cada nove chamadas, `gemini-2.5-flash` devolvia
 * 404 para a chave do escritório e `gemini-2.0-flash` fora desligado pelo
 * Google em 1º/06. Pior: a cadeia era gasta UMA vez por rodada — quando a
 * primeira fonte esgotava os três nomes, as outras falhavam na hora, sem
 * nenhuma chamada.
 *
 * Quatro decisões corrigem isso:
 *
 * 1. A cadeia é por FONTE, e se adapta: quem respondeu vira o preferido das
 *    fontes seguintes; quem esgotou as tentativas vai para o fim da fila;
 *    quem devolveu 404 sai da rodada. Um nome que essa chave não alcança
 *    custa um 404 de um quarto de segundo, não a edição.
 * 2. As esperas entre tentativas são de 10 e 30 segundos — 2 e 5 eram menos
 *    do que uma sobrecarga do nível gratuito costuma durar.
 * 3. Timeout e falha de rede são transitórios como o 503, não falha seca.
 * 4. Existe um PRAZO: nenhuma chamada nova começa depois dele, e o chamador
 *    sempre tem tempo de gravar o desfecho antes de a Lambda estourar.
 */

/**
 * Cadeia padrão, em ordem de preferência — nomes estáveis na frente, alias
 * por último. `gemini-flash-latest` é trocado pelo Google a cada lançamento e
 * pode apontar para uma prévia com limites mais apertados; serve de última
 * rede, não de primeira escolha. `MODELOS_GEMINI` no ambiente substitui esta
 * lista sem mexer em código.
 */
export const MODELOS_PADRAO: readonly string[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];

/** Esperas entre tentativas no MESMO modelo, em ordem. */
export const ESPERAS_PADRAO_MS: readonly number[] = [10_000, 30_000];

/**
 * Teto de uma chamada. Acima disso, conta como transitório e a próxima
 * tentativa começa — em 29/08 as três fontes morreram em timeouts que o código
 * tratava como erro definitivo.
 */
export const TIMEOUT_CHAMADA_MS = 60_000;

export interface OpcoesExtratorGemini {
  readonly chave: string;
  readonly modelos: readonly string[];
  /** Instante (ms desde a época) a partir do qual nenhuma chamada nova começa. */
  readonly prazoMs: number;
  readonly esperasMs?: readonly number[];
  readonly timeoutMs?: number;
  /**
   * Batimento da execução: chamado antes de cada chamada e de cada espera.
   *
   * Sem ele, uma fonte que insiste por minutos pareceria morta para a tela,
   * que dá a execução como travada após quatro minutos de silêncio.
   */
  readonly pulso?: () => Promise<void>;
  readonly dormir?: (ms: number) => Promise<void>;
  readonly agora?: () => number;
  readonly log?: (mensagem: string, dados?: Record<string, unknown>) => void;
}

export interface ExtratorGemini extends ExtratorPorIa {
  /** Ordem corrente da cadeia: o primeiro é o preferido; os mortos já saíram. */
  cadeia(): readonly string[];
}

/** `MODELOS_GEMINI="a, b, c"` — ausente ou vazio cai na cadeia padrão. */
export function lerCadeiaDoAmbiente(valor: string | undefined): readonly string[] {
  const nomes = (valor ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  return nomes.length === 0 ? MODELOS_PADRAO : nomes;
}

/**
 * Raciocínio ("thinking") no mínimo.
 *
 * Extrair cinco notícias de um texto não precisa dele, e ligado por padrão ele
 * alonga a resposta — é parte do que estourava os 60 segundos. A família 2.5
 * aceita orçamento zero; a família 3 trabalha por níveis. Um modelo que
 * recusar o campo (400) é chamado de novo sem ele, uma vez, e fica assim pelo
 * resto da rodada. O alias e nomes desconhecidos não recebem nada: não se
 * adivinha o formato de um modelo que não se sabe qual é.
 */
export function configuracaoDeRaciocinio(modelo: string): Record<string, unknown> | null {
  if (modelo.startsWith('gemini-2.5-')) return { thinkingBudget: 0 };
  if (modelo.startsWith('gemini-3')) return { thinkingLevel: 'low' };
  return null;
}

type Desfecho =
  | { readonly tipo: 'TEXTO'; readonly texto: string }
  /** 404: o nome não existe para esta chave — fora da rodada. */
  | { readonly tipo: 'MORTO'; readonly motivo: string }
  /** Tentativas esgotadas neste modelo — próximo da fila. */
  | { readonly tipo: 'ESGOTADO'; readonly motivo: string }
  /** O prazo da coleta chegou — nada mais é chamado, em modelo nenhum. */
  | { readonly tipo: 'SEM_TEMPO'; readonly motivo: string }
  /** Erro que insistir não resolve (chave, requisição recusada). */
  | { readonly tipo: 'DESISTIR'; readonly motivo: string };

export function criarExtratorGemini(opcoes: OpcoesExtratorGemini): ExtratorGemini {
  const esperas = opcoes.esperasMs ?? ESPERAS_PADRAO_MS;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_CHAMADA_MS;
  const agora = opcoes.agora ?? Date.now;
  const dormir =
    opcoes.dormir ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = opcoes.log ?? (() => undefined);
  const pulso = opcoes.pulso ?? (async () => undefined);

  // Estado da rodada: a ordem se adapta ao que respondeu, os mortos saem, e
  // quem recusou a configuração de raciocínio é chamado sem ela dali em diante.
  const ordem = [...opcoes.modelos];
  const mortos = new Set<string>();
  const semRaciocinio = new Set<string>();
  const anunciados = new Set<string>();

  function chamar(modelo: string, prompt: string): Promise<Response> {
    const raciocinio = semRaciocinio.has(modelo) ? null : configuracaoDeRaciocinio(modelo);
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opcoes.chave },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            ...(raciocinio === null ? {} : { thinkingConfig: raciocinio }),
          },
        }),
      },
    );
  }

  async function tentarNoModelo(modelo: string, prompt: string): Promise<Desfecho> {
    let ultimo = `o modelo ${modelo} não respondeu`;
    let tentativa = 0;

    while (tentativa <= esperas.length) {
      if (agora() >= opcoes.prazoMs) return { tipo: 'SEM_TEMPO', motivo: ultimo };
      await pulso();

      let decisao: DecisaoDoExtrator;
      let status: number | null = null;
      let texto: string | null = null;
      try {
        const resposta = await chamar(modelo, prompt);
        status = resposta.status;
        decisao = decidirPelaRespostaDoExtrator(status, modelo);
        if (decisao.acao === 'USAR') texto = await extrairTexto(resposta);
      } catch (erro) {
        decisao = decidirPelaFalhaDeRedeDoExtrator(erro, modelo);
      }

      if (decisao.acao === 'USAR') {
        if (texto !== null) {
          if (!anunciados.has(modelo)) {
            anunciados.add(modelo);
            log('modelo da IA respondeu', { modelo });
          }
          return { tipo: 'TEXTO', texto };
        }
        // Corpo sem texto é tão transitório quanto um 503 — e tão barato de repetir.
        ultimo = `o modelo ${modelo} devolveu resposta vazia`;
      } else if (decisao.acao === 'PROXIMO_MODELO') {
        return { tipo: 'MORTO', motivo: decisao.motivo };
      } else if (decisao.acao === 'DESISTIR') {
        // 400 com configuração de raciocínio pode ser o modelo recusando o
        // campo, não a requisição: repete sem ela, sem gastar uma tentativa.
        if (status === 400 && !semRaciocinio.has(modelo) && configuracaoDeRaciocinio(modelo)) {
          semRaciocinio.add(modelo);
          log('modelo recusou a configuração de raciocínio; repetindo sem ela', { modelo });
          continue;
        }
        return { tipo: 'DESISTIR', motivo: decisao.motivo };
      } else {
        ultimo = decisao.motivo;
      }

      const espera = esperas[tentativa];
      tentativa += 1;
      if (espera === undefined) break;
      if (agora() + espera >= opcoes.prazoMs) return { tipo: 'SEM_TEMPO', motivo: ultimo };

      log('resposta transitória da IA; nova tentativa', {
        modelo,
        motivo: ultimo,
        esperaMs: espera,
      });
      await pulso();
      await dormir(espera);
    }

    return { tipo: 'ESGOTADO', motivo: ultimo };
  }

  return {
    cadeia: () => ordem.filter((m) => !mortos.has(m)),

    async completar(prompt: string): Promise<string> {
      const falhas: string[] = [];

      for (const modelo of [...ordem]) {
        if (mortos.has(modelo)) continue;

        const desfecho = await tentarNoModelo(modelo, prompt);

        if (desfecho.tipo === 'TEXTO') {
          promover(ordem, modelo);
          return desfecho.texto;
        }
        if (desfecho.tipo === 'MORTO') {
          mortos.add(modelo);
          log('modelo indisponível, tentando o próximo', { modelo, motivo: desfecho.motivo });
          falhas.push(desfecho.motivo);
          continue;
        }
        if (desfecho.tipo === 'ESGOTADO') {
          rebaixar(ordem, modelo);
          falhas.push(desfecho.motivo);
          continue;
        }
        if (desfecho.tipo === 'SEM_TEMPO') {
          throw new Error(`${desfecho.motivo}; a coleta ficou sem tempo para insistir`);
        }
        throw new Error(desfecho.motivo);
      }

      const vivos = ordem.filter((m) => !mortos.has(m));
      if (vivos.length === 0) {
        throw new Error(
          `nenhum modelo da lista existe mais para esta chave (${opcoes.modelos.join(', ')}) — atualize MODELOS_GEMINI`,
        );
      }
      throw new Error(
        `${falhas.join('; ')}. Nenhum modelo respondeu (${vivos.join(', ')}); é indisponibilidade temporária da IA, não das fontes — gerar de novo em alguns minutos costuma resolver.`,
      );
    },
  };
}

/** O texto da resposta, sem as partes de raciocínio; null quando não veio nada. */
async function extrairTexto(resposta: Response): Promise<string | null> {
  const corpo = (await resposta.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const texto =
    corpo.candidates?.[0]?.content?.parts
      ?.filter((parte) => parte.thought !== true)
      .map((parte) => parte.text ?? '')
      .join('') ?? '';
  return texto === '' ? null : texto;
}

/** Quem respondeu passa à frente: é a melhor aposta para a próxima fonte. */
function promover(ordem: string[], modelo: string): void {
  const indice = ordem.indexOf(modelo);
  if (indice > 0) {
    ordem.splice(indice, 1);
    ordem.unshift(modelo);
  }
}

/** Quem esgotou as tentativas vai para o fim — continua na rodada, mas por último. */
function rebaixar(ordem: string[], modelo: string): void {
  const indice = ordem.indexOf(modelo);
  if (indice !== -1 && indice < ordem.length - 1) {
    ordem.splice(indice, 1);
    ordem.push(modelo);
  }
}
