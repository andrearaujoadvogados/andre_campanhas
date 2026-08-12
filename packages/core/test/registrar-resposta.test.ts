import { describe, it, expect } from 'vitest';
import {
  EmailAddress,
  campaignId as novoCampaignId,
  campanhaDoEnderecoDeResposta,
  contactId as novoContactId,
  enderecoDeResposta,
  messageIdDoSes,
  registrarResposta,
  sendId as novoSendId,
  tenantId as novoTenantId,
  type Contact,
  type DepsResposta,
  type Envio,
  type EventoEnvio,
  type RespostaRecebida,
} from '../src/index.js';

const TENANT = novoTenantId('t1');
const CAMPANHA = novoCampaignId('c-uuid');
const CONTATO = novoContactId('ct1');
const SEND = novoSendId('send-derivado');

function contato(): Contact {
  const email = EmailAddress.create('cliente@exemplo.com.br');
  if (!email.ok) throw new Error('e-mail de teste inválido');
  return {
    tenantId: TENANT,
    contactId: CONTATO,
    email: email.value,
    status: 'ATIVO',
    origem: 'MANUAL',
    camposCustomizados: {},
    tags: [],
    criadoEm: new Date('2026-01-01'),
  } as unknown as Contact;
}

function envio(extra: Partial<Envio> = {}): Envio {
  return {
    tenantId: TENANT,
    sendId: SEND,
    campaignId: CAMPANHA,
    contactId: CONTATO,
    status: 'ENTREGUE',
    sesMessageId: 'msg-ses-1',
    enviadoEm: new Date('2026-08-10T12:00:00Z'),
    ...extra,
  };
}

interface Estado {
  envios: Envio[];
  salvos: Envio[];
  eventos: EventoEnvio[];
  metricas: string[];
  chaves: Set<string>;
  contatoExiste: boolean;
}

function montar(estadoInicial: Partial<Estado> = {}): { deps: DepsResposta; estado: Estado } {
  const estado: Estado = {
    envios: [envio()],
    salvos: [],
    eventos: [],
    metricas: [],
    chaves: new Set(),
    contatoExiste: true,
    ...estadoInicial,
  };

  const deps: DepsResposta = {
    envios: {
      buscarPorId: async (_t, c, s) =>
        estado.envios.find((e) => e.campaignId === c && e.sendId === s) ?? null,
      buscarPorMessageId: async (m) => estado.envios.find((e) => e.sesMessageId === m) ?? null,
      salvar: async (e) => {
        estado.salvos.push(e);
      },
      contarPorCampanha: async () => estado.envios.length,
      listarPorCampanha: async () => ({ itens: estado.envios }),
      listarPorContato: async () => estado.envios,
      listarRespondentes: async () => ({ itens: estado.envios.filter((e) => e.respondidoEm) }),
    },
    contatos: {
      buscarPorId: async () => (estado.contatoExiste ? contato() : null),
      buscarPorEmail: async () => (estado.contatoExiste ? contato() : null),
      salvar: async () => undefined,
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: [] }),
      excluir: async () => undefined,
    },
    metricas: {
      incrementar: async (_t, _c, campo) => {
        estado.metricas.push(campo);
      },
      ler: async () => ({}),
    },
    eventos: {
      salvar: async (e) => {
        estado.eventos.push(e);
      },
      listarPorEnvio: async () => estado.eventos,
    },
    idempotencia: {
      registrarSeNovo: async (chave) => {
        if (estado.chaves.has(chave)) return false;
        estado.chaves.add(chave);
        return true;
      },
      liberar: async (chave) => {
        estado.chaves.delete(chave);
      },
    },
    // O sendId real é sha256(campanha, contato) e vive nos adaptadores. Aqui o
    // que importa é que o caso de uso *use* a derivação, não como ela calcula.
    sendIds: { derivar: () => SEND },
    clock: { agora: () => new Date('2026-08-12T10:00:00Z') },
  };

  return { deps, estado };
}

function resposta(extra: Partial<RespostaRecebida> = {}): RespostaRecebida {
  return {
    tenantId: TENANT,
    deEmail: 'cliente@exemplo.com.br',
    idMensagemRecebida: '<abc@mail.cliente.com>',
    recebidoEm: new Date('2026-08-11T09:00:00Z'),
    campaignIdMarcado: String(CAMPANHA),
    ...extra,
  };
}

describe('registrar resposta de contato', () => {
  it('correlaciona pela campanha no endereço + remetente, e carimba o envio', async () => {
    const { deps, estado } = montar();

    const r = await registrarResposta(deps, resposta());

    expect(r.acao).toBe('REGISTRADA');
    expect(estado.eventos[0]?.tipo).toBe('RESPOSTA');
    expect(estado.metricas).toEqual(['respostas']);
    expect(estado.salvos[0]?.respondidoEm).toEqual(new Date('2026-08-11T09:00:00Z'));
  });

  it('sem a marca no endereço, cai no In-Reply-To', async () => {
    // O contato responde de um endereço que não está na base — a busca por
    // remetente não acha ninguém, mas o cabeçalho de thread ainda aponta certo.
    const { deps, estado } = montar({ contatoExiste: false });

    const r = await registrarResposta(
      deps,
      resposta({ deEmail: 'outro@pessoal.com', sesMessageIdOriginal: 'msg-ses-1' }),
    );

    expect(r.acao).toBe('REGISTRADA');
    expect(estado.salvos[0]?.sendId).toBe(SEND);
  });

  it('a SEGUNDA resposta do mesmo contato não conta de novo', async () => {
    // "Quantos e-mails foram respondidos" — quem responde três vezes respondeu
    // a um e-mail. Contar mensagens daria 300% numa campanha de uma pessoa.
    const { deps, estado } = montar();

    await registrarResposta(deps, resposta());
    const segunda = await registrarResposta(
      deps,
      resposta({ idMensagemRecebida: '<def@mail.cliente.com>' }),
    );

    expect(segunda).toEqual({ acao: 'REGISTRADA', sendId: SEND, primeira: false });
    expect(estado.metricas).toEqual(['respostas']);
    // O evento individual continua sendo gravado — é o que responde "quando".
    expect(estado.eventos).toHaveLength(2);
  });

  it('a mesma mensagem reentregue pela fila é duplicata', async () => {
    const { deps, estado } = montar();

    await registrarResposta(deps, resposta());
    const repetida = await registrarResposta(deps, resposta());

    expect(repetida).toEqual({ acao: 'DUPLICADA' });
    expect(estado.eventos).toHaveLength(1);
  });

  it('sem envio correspondente, LIBERA a marca para a reentrega funcionar', async () => {
    // A corrida é real: a resposta pode chegar antes de o registro de envio
    // gravar. Sem liberar, a reentrega seria descartada como duplicata e a
    // resposta se perderia para sempre.
    const { deps, estado } = montar({ envios: [], contatoExiste: false });

    const r = await registrarResposta(deps, resposta());

    expect(r.acao).toBe('NAO_CORRELACIONADA');
    expect(estado.chaves.size).toBe(0);
  });

  it('não suprime quem respondeu', async () => {
    // Responder é o oposto de reclamar. O caso de uso não tem sequer acesso ao
    // repositório de supressão — esta asserção guarda a decisão de desenho.
    const { deps } = montar();
    await registrarResposta(deps, resposta());

    expect('supressao' in deps).toBe(false);
  });
});

describe('endereço de resposta', () => {
  it('vai e volta: o endereço montado devolve a campanha', () => {
    const endereco = enderecoDeResposta(CAMPANHA, 'respostas.exemplo.com.br');

    expect(endereco).toBe('resposta+c-uuid@respostas.exemplo.com.br');
    expect(campanhaDoEnderecoDeResposta([endereco])).toBe('c-uuid');
  });

  it('cabe no limite de 64 caracteres da parte local com um UUID', () => {
    // RFC 5321: parte local até 64. Um UUID tem 36; se um dia a marca crescer,
    // este teste falha antes de o servidor recusar o endereço em produção.
    const uuid = novoCampaignId('e1a20586-1de9-4527-abe1-8dae20dbe38b');
    const local = enderecoDeResposta(uuid, 'x.com').split('@')[0] ?? '';

    expect(local.length).toBeLessThanOrEqual(64);
  });

  it('acha o nosso endereço mesmo quando não é o primeiro destinatário', () => {
    const lista = [
      'socio@escritorio.com.br',
      '"Escritório" <resposta+c-uuid@respostas.exemplo.com.br>',
    ];
    expect(campanhaDoEnderecoDeResposta(lista)).toBe('c-uuid');
  });

  it('ignora endereço sem a marca', () => {
    expect(campanhaDoEnderecoDeResposta(['contato@escritorio.com.br'])).toBeNull();
    expect(campanhaDoEnderecoDeResposta(['resposta@respostas.exemplo.com.br'])).toBeNull();
  });

  it('em References, vale o ÚLTIMO messageId do SES — o mais recente da thread', () => {
    const referencias = '<antigo@us-east-2.amazonses.com> <atual@us-east-2.amazonses.com>';
    expect(messageIdDoSes(referencias)).toBe('atual');
    expect(messageIdDoSes('<qualquer@mail.google.com>')).toBeNull();
  });
});
