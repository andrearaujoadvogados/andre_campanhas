import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Campaign, ExecucaoBoletim, RotinaBoletim } from '@emailmkt/core';

/**
 * Bancada do worker inteiro, com a AWS dublada e o resto REAL.
 *
 * A coleta (core), o compilador MJML e as regras de domínio rodam de verdade;
 * só os adaptadores de infraestrutura (Dynamo, Secrets, Step Functions) e a
 * rede (página da fonte, Gemini) são dublês. É o mais perto do caminho de
 * produção que dá para chegar sem credenciais — e cobre exatamente o trecho
 * que nenhum teste cobria: da invocação da agenda ao StartExecution.
 */

interface Estado {
  rotina: RotinaBoletim | null;
  fontes: Record<string, unknown>[];
  listas: Record<string, unknown>[];
  tipos: Record<string, unknown>[];
  execucoes: Map<string, ExecucaoBoletim>;
  templatesSalvos: { template: Record<string, unknown>; versao: Record<string, unknown> }[];
  campanhasSalvas: Campaign[];
  sfnChamadas: { stateMachineArn?: string; name?: string; input?: string }[];
  /** Mensagem de erro para o SFN lançar — simula o orquestrador indisponível. */
  sfnFalha: string | null;
}

const estado = vi.hoisted((): Estado => ({
  rotina: null,
  fontes: [],
  listas: [],
  tipos: [],
  execucoes: new Map(),
  templatesSalvos: [],
  campanhasSalvas: [],
  sfnChamadas: [],
  sfnFalha: null,
}));

vi.mock('@emailmkt/adapters-aws', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    // CanonicalContentHasher continua real: o fingerprint da auditoria é parte
    // do que este teste garante, e um dublê o transformaria em tautologia.
    ...real,
    dynamoDoc: () => ({}),
    secrets: () => ({}),
    SecretsProvider: class {
      async ler(): Promise<string> {
        return 'chave-de-teste';
      }
    },
    DynamoExecucaoBoletimRepository: class {
      async salvar(e: ExecucaoBoletim): Promise<void> {
        estado.execucoes.set(String(e.execucaoId), e);
      }
      async buscarPorId(_t: unknown, id: unknown): Promise<ExecucaoBoletim | null> {
        return estado.execucoes.get(String(id)) ?? null;
      }
      async listarRecentes(): Promise<ExecucaoBoletim[]> {
        return [...estado.execucoes.values()];
      }
    },
    DynamoFonteBoletimRepository: class {
      async listar(): Promise<Record<string, unknown>[]> {
        return estado.fontes;
      }
      async buscarPorId(_t: unknown, id: unknown): Promise<Record<string, unknown> | null> {
        return estado.fontes.find((f) => String(f['fonteId']) === String(id)) ?? null;
      }
    },
    DynamoRotinaBoletimRepository: class {
      async buscarPorId(_t: unknown, id: unknown): Promise<RotinaBoletim | null> {
        return estado.rotina !== null && String(estado.rotina.rotinaId) === String(id)
          ? estado.rotina
          : null;
      }
    },
    DynamoTemplateRepository: class {
      async salvarComVersao(
        template: Record<string, unknown>,
        versao: Record<string, unknown>,
      ): Promise<void> {
        estado.templatesSalvos.push({ template, versao });
      }
    },
    DynamoCampaignRepository: class {
      async salvar(c: Campaign): Promise<void> {
        estado.campanhasSalvas.push(c);
      }
    },
    DynamoTipoEmailRepository: class {
      async buscarPorId(_t: unknown, id: unknown): Promise<Record<string, unknown> | null> {
        return estado.tipos.find((x) => String(x['tipoEmailId']) === String(id)) ?? null;
      }
      async listar(): Promise<Record<string, unknown>[]> {
        return estado.tipos;
      }
    },
    DynamoListRepository: class {
      async listar(): Promise<{ itens: Record<string, unknown>[] }> {
        return { itens: estado.listas };
      }
    },
  };
});

vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: class {
    async send(cmd: { entrada: Estado['sfnChamadas'][number] }): Promise<Record<string, never>> {
      if (estado.sfnFalha !== null) throw new Error(estado.sfnFalha);
      estado.sfnChamadas.push(cmd.entrada);
      return {};
    }
  },
  StartExecutionCommand: class {
    constructor(public entrada: Estado['sfnChamadas'][number]) {}
  },
}));

import { handler } from '../src/handler.js';

const AGORA = new Date('2026-08-21T11:00:00Z');

function fonteFalsa(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: 'andrearaujo',
    fonteId: 'f-1',
    nome: 'Migalhas',
    url: 'https://fonte.exemplo/noticias',
    instrucao: 'Decisões do STJ sobre direito tributário.',
    ativa: true,
    criadoPor: 'u-1',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...over,
  };
}

function rotinaFalsa(over: Partial<RotinaBoletim> = {}): RotinaBoletim {
  return {
    tenantId: 'andrearaujo',
    rotinaId: 'r-1',
    nome: 'Boletim Tributário',
    periodicidade: 'SEMANAL',
    horario: '08:00',
    diaDaSemana: 1,
    temas: [],
    fonteIds: [],
    listIds: ['l-1'],
    ativa: true,
    criadoPor: 'u-1',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...over,
  } as unknown as RotinaBoletim;
}

function listaFalsa(id: string, nome: string): Record<string, unknown> {
  return {
    tenantId: 'andrearaujo',
    listId: id,
    nome,
    tipo: 'ESTATICA',
    totalContatos: 10,
    criadoPor: 'u-1',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
  };
}

/** A execução única desta rodada, no estado em que o worker a deixou. */
function execucaoFinal(): ExecucaoBoletim {
  const todas = [...estado.execucoes.values()];
  expect(todas).toHaveLength(1);
  return todas[0] as ExecucaoBoletim;
}

beforeEach(() => {
  estado.rotina = rotinaFalsa();
  estado.fontes = [fonteFalsa()];
  estado.listas = [listaFalsa('l-1', 'Clientes')];
  estado.tipos = [
    {
      tenantId: 'andrearaujo',
      tipoEmailId: 't-boletim',
      nome: 'Boletim',
      criadoPor: 'u-1',
      criadoEm: AGORA,
      atualizadoEm: AGORA,
    },
  ];
  estado.execucoes.clear();
  estado.templatesSalvos = [];
  estado.campanhasSalvas = [];
  estado.sfnChamadas = [];
  estado.sfnFalha = null;

  vi.stubEnv('TABELA_PRINCIPAL', 'tabela-teste');
  vi.stubEnv('SEGREDO_GEMINI_ARN', 'arn:aws:secretsmanager:teste');
  vi.stubEnv('ORQUESTRADOR_ARN', 'arn:aws:states:sa-east-1:000000000000:stateMachine/disparo');

  // A rede inteira do worker: a página da fonte e a resposta da IA.
  vi.stubGlobal('fetch', async (url: unknown) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      const noticias = JSON.stringify([
        {
          titulo: 'STJ define tese sobre créditos de PIS/Cofins',
          resumo: 'A decisão afeta empresas do regime não cumulativo.',
          url: 'https://fonte.exemplo/materia',
          tag: 'STJ',
        },
      ]);
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: noticias }] } }] }),
        { status: 200 },
      );
    }
    return new Response(
      '<html><body><main><h1>Notícias</h1><p>Decisões recentes do STJ em matéria tributária.</p></main></body></html>',
      { status: 200 },
    );
  });
});

describe('rotina de envio automático — do gatilho ao orquestrador', () => {
  it('gera o modelo, cria a campanha com auditoria e aciona o orquestrador', async () => {
    const resultado = await handler({ origem: 'rotina', rotinaId: 'r-1' });

    expect(resultado.gerado).toBe(true);
    expect(estado.templatesSalvos).toHaveLength(1);

    // A campanha espelha o caminho do painel: rascunho disparável, remetente
    // fixo verificado no SES, tipo do catálogo e a auditoria de quem disparou.
    expect(estado.campanhasSalvas).toHaveLength(1);
    const campanha = estado.campanhasSalvas[0] as Campaign;
    expect(campanha.status).toBe('RASCUNHO');
    expect(String(campanha.listId)).toBe('l-1');
    expect(campanha.templateVersao).toBe(1);
    expect(campanha.remetenteEmail).toBe('campanhas@mail.andrearaujoadvogados.com.br');
    expect(String(campanha.tipoEmailId)).toBe('t-boletim');
    expect(String(campanha.enviadaPor)).toBe('rotina-boletim');
    // O fingerprint do conteúdo é o mesmo mecanismo do disparo manual — envio
    // automático não é um atalho com menos registro.
    expect(campanha.hashConteudoEnviado).toBeTruthy();

    // O orquestrador recebe exatamente a campanha criada.
    expect(estado.sfnChamadas).toHaveLength(1);
    const chamada = estado.sfnChamadas[0];
    expect(chamada?.stateMachineArn).toBe(
      'arn:aws:states:sa-east-1:000000000000:stateMachine/disparo',
    );
    const input = JSON.parse(chamada?.input ?? '{}') as Record<string, string>;
    expect(input['campaignId']).toBe(String(campanha.campaignId));

    // E a execução conta a história completa: concluída, origem rotina, com a
    // campanha disparada anotada para a tela.
    const execucao = execucaoFinal();
    expect(execucao.situacao).toBe('CONCLUIDA');
    expect(execucao.origem).toBe('ROTINA');
    expect(execucao.envioCampaignIds?.map(String)).toEqual([String(campanha.campaignId)]);
    expect(execucao.envioErro).toBeUndefined();
  });

  it('com várias listas, sai uma campanha por lista — nomes distinguíveis', async () => {
    estado.rotina = rotinaFalsa({ listIds: ['l-1', 'l-2'] } as Partial<RotinaBoletim>);
    estado.listas = [listaFalsa('l-1', 'Clientes'), listaFalsa('l-2', 'Parceiros')];

    await handler({ origem: 'rotina', rotinaId: 'r-1' });

    expect(estado.campanhasSalvas).toHaveLength(2);
    expect(estado.sfnChamadas).toHaveLength(2);
    const nomes = estado.campanhasSalvas.map((c) => c.nome);
    expect(nomes.some((n) => n.includes('Clientes'))).toBe(true);
    expect(nomes.some((n) => n.includes('Parceiros'))).toBe(true);
    expect(execucaoFinal().envioCampaignIds).toHaveLength(2);
  });

  it('lista que sumiu não segura as outras — a boa sai, a falha fica anotada', async () => {
    estado.rotina = rotinaFalsa({ listIds: ['l-1', 'l-fantasma'] } as Partial<RotinaBoletim>);

    await handler({ origem: 'rotina', rotinaId: 'r-1' });

    expect(estado.campanhasSalvas).toHaveLength(1);
    expect(String((estado.campanhasSalvas[0] as Campaign).listId)).toBe('l-1');

    const execucao = execucaoFinal();
    expect(execucao.envioCampaignIds).toHaveLength(1);
    expect(execucao.envioErro).toMatch(/l-fantasma/);
  });

  it('orquestrador fora do ar: o modelo sobrevive e a falha do envio fica visível', async () => {
    estado.sfnFalha = 'States is unavailable';

    await handler({ origem: 'rotina', rotinaId: 'r-1' });

    // A geração NÃO é rebaixada a falha — o modelo existe e o operador pode
    // disparar à mão. O que não pode é a falha do envio sumir.
    const execucao = execucaoFinal();
    expect(execucao.situacao).toBe('CONCLUIDA');
    expect(estado.templatesSalvos).toHaveLength(1);
    expect(execucao.envioCampaignIds).toBeUndefined();
    expect(execucao.envioErro).toMatch(/States is unavailable/);
  });

  it('agenda órfã falha cedo: nada é gerado nem enviado', async () => {
    estado.rotina = null;

    const resultado = await handler({ origem: 'rotina', rotinaId: 'r-sumida' });

    expect(resultado.gerado).toBe(false);
    expect(estado.templatesSalvos).toHaveLength(0);
    expect(estado.campanhasSalvas).toHaveLength(0);
    expect(estado.sfnChamadas).toHaveLength(0);
    const execucao = execucaoFinal();
    expect(execucao.situacao).toBe('FALHOU');
    expect(execucao.erro).toMatch(/não existe mais/);
  });

  it('rotina desligada entre o gatilho e a execução: gera o modelo, não envia', async () => {
    estado.rotina = rotinaFalsa({ ativa: false });

    await handler({ origem: 'rotina', rotinaId: 'r-1' });

    expect(estado.templatesSalvos).toHaveLength(1);
    expect(estado.campanhasSalvas).toHaveLength(0);
    expect(estado.sfnChamadas).toHaveLength(0);
    expect(execucaoFinal().situacao).toBe('CONCLUIDA');
  });

  it('fora da rotina o disparo continua humano: geração manual não cria campanha', async () => {
    const resultado = await handler({ origem: 'manual' });

    expect(resultado.gerado).toBe(true);
    expect(estado.templatesSalvos).toHaveLength(1);
    expect(estado.campanhasSalvas).toHaveLength(0);
    expect(estado.sfnChamadas).toHaveLength(0);
    expect(execucaoFinal().origem).toBe('MANUAL');
  });
});
