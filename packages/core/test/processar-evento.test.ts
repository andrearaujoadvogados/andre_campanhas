import { describe, it, expect, beforeEach } from 'vitest';
import { processarEvento, type DepsEvento } from '../src/application/use-cases/processar-evento.js';
import {
  metricaDoEvento,
  statusAposEvento,
  type EventoEnvio,
  type Envio,
} from '../src/domain/send/envio.js';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { unwrap } from '../src/domain/shared/result.js';
import { campaignId, contactId, sendId, TENANT_PADRAO } from '../src/domain/shared/ids.js';
import type { Contact } from '../src/domain/contact/contact.js';

const AGORA = new Date('2026-08-07T12:00:00Z');

function evento(over: Partial<EventoEnvio> = {}): EventoEnvio {
  return {
    tenantId: TENANT_PADRAO,
    sesMessageId: 'ses-msg-1',
    tipo: 'DELIVERY',
    ocorridoEm: AGORA,
    ...over,
  };
}

interface Estado {
  envio: Envio | null;
  contato: Contact | null;
  marcas: Set<string>;
  metricas: { campo: string; qtd: number }[];
  eventosSalvos: EventoEnvio[];
  suprimidos: { motivo: string; hash: string }[];
  enviosSalvos: Envio[];
  contatosSalvos: Contact[];
}

let estado: Estado;

function deps(): DepsEvento {
  return {
    envios: {
      buscarPorId: async () => estado.envio,
      buscarPorMessageId: async () => estado.envio,
      salvar: async (e) => void estado.enviosSalvos.push(e),
      contarPorCampanha: async () => estado.enviosSalvos.length,
      listarPorCampanha: async () => ({ itens: [] }),
      listarPorContato: async () => estado.enviosSalvos,
      listarRespondentes: async () => ({ itens: [] }),
    },
    contatos: {
      buscarPorId: async () => estado.contato,
      buscarPorEmail: async () => null,
      salvar: async (c) => void estado.contatosSalvos.push(c),
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: [] }),
      excluir: async () => undefined,
    },
    supressao: {
      estaSuprimido: async () => false,
      filtrarSuprimidos: async () => new Set(),
      suprimir: async (e) => void estado.suprimidos.push({ motivo: e.motivo, hash: e.emailHash }),
      remover: async () => undefined,
    },
    eventos: {
      salvar: async (e) => void estado.eventosSalvos.push(e),
      listarPorEnvio: async () => estado.eventosSalvos,
    },
    metricas: {
      incrementar: async (_t, _k, campo, qtd) =>
        void estado.metricas.push({ campo, qtd: qtd ?? 1 }),
      ler: async () => ({}),
    },
    idempotencia: {
      registrarSeNovo: async (chave) => {
        if (estado.marcas.has(chave)) return false;
        estado.marcas.add(chave);
        return true;
      },
      liberar: async (chave) => void estado.marcas.delete(chave),
    },
    hasher: { hash: (e) => `h:${e.value}` },
    clock: { agora: () => AGORA },
  };
}

beforeEach(() => {
  estado = {
    envio: {
      tenantId: TENANT_PADRAO,
      sendId: sendId('s-1'),
      campaignId: campaignId('k-1'),
      contactId: contactId('c-1'),
      status: 'ENVIADO',
      sesMessageId: 'ses-msg-1',
    },
    contato: {
      tenantId: TENANT_PADRAO,
      contactId: contactId('c-1'),
      email: unwrap(EmailAddress.create('titular@exemplo.com')),
      camposCustomizados: {},
      status: 'ATIVO',
      relacionamento: 'CLIENTE_ATIVO',
      criadoEm: AGORA,
      atualizadoEm: AGORA,
      origem: 'csv',
    },
    marcas: new Set(),
    metricas: [],
    eventosSalvos: [],
    suprimidos: [],
    enviosSalvos: [],
    contatosSalvos: [],
  };
});

describe('deduplicação — §5.4', () => {
  it('processa o primeiro evento e descarta a reentrega', async () => {
    const d = deps();
    expect(await processarEvento(d, evento())).toMatchObject({ acao: 'PROCESSADO' });
    expect(await processarEvento(d, evento())).toEqual({ acao: 'DUPLICADO' });

    // O contador não pode inflar: relatório com mais entregas que envios é
    // número que ninguém consegue explicar depois.
    expect(estado.metricas.filter((m) => m.campo === 'entregues')).toHaveLength(1);
  });

  it('duas aberturas em instantes diferentes são eventos legítimos, não duplicata', async () => {
    const d = deps();
    await processarEvento(
      d,
      evento({ tipo: 'OPEN', ocorridoEm: new Date('2026-08-07T12:00:00Z') }),
    );
    await processarEvento(
      d,
      evento({ tipo: 'OPEN', ocorridoEm: new Date('2026-08-07T14:00:00Z') }),
    );

    expect(estado.metricas.filter((m) => m.campo === 'aberturasTotais')).toHaveLength(2);
  });

  it('dois cliques no mesmo instante em links diferentes contam separado', async () => {
    const d = deps();
    await processarEvento(d, evento({ tipo: 'CLICK', urlClicada: 'https://a.com' }));
    await processarEvento(d, evento({ tipo: 'CLICK', urlClicada: 'https://b.com' }));

    expect(estado.metricas.filter((m) => m.campo === 'cliquesTotais')).toHaveLength(2);
  });
});

describe('supressão automática — §11, item 6', () => {
  it('hard bounce suprime o contato', async () => {
    const r = await processarEvento(deps(), evento({ tipo: 'BOUNCE', subtipoBounce: 'Permanent' }));

    expect(r).toEqual({ acao: 'PROCESSADO', suprimiu: true });
    expect(estado.suprimidos).toEqual([{ motivo: 'HARD_BOUNCE', hash: 'h:titular@exemplo.com' }]);
    expect(estado.contatosSalvos[0]?.status).toBe('BOUNCE');
  });

  it('soft bounce NÃO suprime — caixa cheia é condição temporária', async () => {
    const r = await processarEvento(deps(), evento({ tipo: 'BOUNCE', subtipoBounce: 'Transient' }));

    expect(r).toEqual({ acao: 'PROCESSADO', suprimiu: false });
    expect(estado.suprimidos).toHaveLength(0);
    expect(estado.metricas).toContainEqual({ campo: 'bouncesSoft', qtd: 1 });
  });

  it('reclamação de spam suprime', async () => {
    const r = await processarEvento(deps(), evento({ tipo: 'COMPLAINT' }));

    expect(r).toEqual({ acao: 'PROCESSADO', suprimiu: true });
    expect(estado.suprimidos[0]?.motivo).toBe('RECLAMACAO');
    expect(estado.contatosSalvos[0]?.status).toBe('RECLAMACAO');
  });

  it('suprime pelo endereço do evento quando o contato já foi excluído', async () => {
    // Sem isto, um hard bounce de contato apagado deixaria a conta exposta no
    // próximo disparo que reimportasse aquele endereço.
    estado.contato = null;
    const r = await processarEvento(
      deps(),
      evento({ tipo: 'BOUNCE', subtipoBounce: 'Permanent', destinatario: 'sumiu@exemplo.com' }),
    );

    expect(r).toEqual({ acao: 'PROCESSADO', suprimiu: true });
    expect(estado.suprimidos[0]?.hash).toBe('h:sumiu@exemplo.com');
  });
});

describe('status e métricas', () => {
  it('DELIVERY marca o envio como entregue', async () => {
    await processarEvento(deps(), evento({ tipo: 'DELIVERY' }));
    expect(estado.enviosSalvos[0]?.status).toBe('ENTREGUE');
  });

  it('DELIVERY_DELAY não conta métrica nem muda status', async () => {
    // É aviso de lentidão do destino, não desfecho. Contá-lo como falha
    // inflaria a taxa de bounce e dispararia alarme à toa.
    const r = await processarEvento(deps(), evento({ tipo: 'DELIVERY_DELAY' }));

    expect(r).toMatchObject({ acao: 'PROCESSADO' });
    expect(estado.metricas).toHaveLength(0);
    expect(estado.enviosSalvos).toHaveLength(0);
  });

  it('evento sem envio correspondente vira ORFAO, não erro', async () => {
    estado.envio = null;
    const r = await processarEvento(deps(), evento());
    expect(r).toMatchObject({ acao: 'ORFAO' });
  });
});

describe('mapa de evento para métrica', () => {
  it.each([
    ['SEND', 'enviados'],
    ['DELIVERY', 'entregues'],
    ['OPEN', 'aberturasTotais'],
    ['CLICK', 'cliquesTotais'],
    ['COMPLAINT', 'reclamacoes'],
    ['REJECT', 'rejeitados'],
    ['RENDERING_FAILURE', 'falhasRenderizacao'],
  ] as const)('%s → %s', (tipo, campo) => {
    expect(metricaDoEvento(evento({ tipo }))).toBe(campo);
  });

  it('separa bounce permanente de transitório', () => {
    expect(metricaDoEvento(evento({ tipo: 'BOUNCE', subtipoBounce: 'Permanent' }))).toBe(
      'bouncesHard',
    );
    expect(metricaDoEvento(evento({ tipo: 'BOUNCE', subtipoBounce: 'Transient' }))).toBe(
      'bouncesSoft',
    );
  });

  it('soft bounce não altera o status do envio', () => {
    expect(statusAposEvento(evento({ tipo: 'BOUNCE', subtipoBounce: 'Transient' }))).toBeNull();
    expect(statusAposEvento(evento({ tipo: 'BOUNCE', subtipoBounce: 'Permanent' }))).toBe('FALHOU');
  });
});
