import { describe, it, expect, beforeEach } from 'vitest';
import {
  dossieParaCsv,
  montarDossieTitular,
  type DepsExportacao,
} from '../src/application/use-cases/exportar-dados-titular.js';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { unwrap } from '../src/domain/shared/result.js';
import { campaignId, contactId, sendId, TENANT_PADRAO } from '../src/domain/shared/ids.js';
import type { Contact } from '../src/domain/contact/contact.js';
import type { Envio, EventoEnvio } from '../src/domain/send/envio.js';

const AGORA = new Date('2026-08-07T12:00:00Z');

interface Estado {
  contato: Contact | null;
  envios: Envio[];
  eventos: EventoEnvio[];
}

let estado: Estado;

function contatoCompleto(over: Partial<Contact> = {}): Contact {
  return {
    tenantId: TENANT_PADRAO,
    contactId: contactId('c-1'),
    email: unwrap(EmailAddress.create('maria@exemplo.com')),
    nome: 'Maria Silva',
    camposCustomizados: { processo: '0001234-56' },
    status: 'ATIVO',
    relacionamento: 'CLIENTE_ATIVO',
    relacionamentoDesde: new Date('2025-03-01T00:00:00Z'),
    baseLegal: {
      base: 'LEGITIMO_INTERESSE',
      liaVersao: 'lia-2026-08',
      finalidade: 'Comunicação informativa a clientes',
      evidenciaRelacionamento: 'Contrato de prestação de serviços ativo',
      origemDeclarada: 'Base do escritório, migração de agosto/2026',
      registradoEm: AGORA,
    },
    criadoEm: new Date('2026-08-01T00:00:00Z'),
    atualizadoEm: AGORA,
    origem: 'csv:imp-1',
    ...over,
  };
}

function deps(): DepsExportacao {
  return {
    contatos: {
      buscarPorId: async () => estado.contato,
      buscarPorEmail: async () => null,
      salvar: async () => undefined,
      salvarEmLote: async () => undefined,
      listarPorLista: async () => ({ itens: [] }),
      excluir: async () => undefined,
    },
    envios: {
      buscarPorId: async () => null,
      buscarPorMessageId: async () => null,
      salvar: async () => undefined,
      contarPorCampanha: async () => estado.envios.length,
      listarPorCampanha: async () => ({ itens: [] }),
      listarPorContato: async () => estado.envios,
      listarRespondentes: async () => ({ itens: [] }),
    },
    eventos: {
      salvar: async () => undefined,
      listarPorEnvio: async () => estado.eventos,
    },
    clock: { agora: () => AGORA },
  };
}

beforeEach(() => {
  estado = { contato: contatoCompleto(), envios: [], eventos: [] };
});

const montar = () =>
  montarDossieTitular(deps(), { tenantId: TENANT_PADRAO, contactId: contactId('c-1') });

describe('dossiê do titular — art. 18, II e V', () => {
  it('inclui identificação e campos adicionais', async () => {
    const d = await montar();

    expect(d?.identificacao).toMatchObject({
      email: 'maria@exemplo.com',
      nome: 'Maria Silva',
      camposAdicionais: { processo: '0001234-56' },
    });
  });

  it('explica o status em português, não só o código', async () => {
    // O titular não sabe o que "OPOSICAO" significa; o dossiê precisa dizer.
    estado.contato = contatoCompleto({ status: 'OPOSICAO' });
    const d = await montar();

    expect(d?.situacao.status).toBe('OPOSICAO');
    expect(d?.situacao.significado).toMatch(/opôs ao tratamento/i);
  });

  it('explica a base legal e o vínculo que a sustenta', async () => {
    const d = await montar();

    expect(d?.baseLegalDoTratamento).toMatchObject({
      base: 'LEGITIMO_INTERESSE',
      vinculoDeclarado: 'CLIENTE_ATIVO',
      evidencia: 'Contrato de prestação de serviços ativo',
      versaoDoTesteDeBalanceamento: 'lia-2026-08',
    });
    expect(d?.baseLegalDoTratamento?.significado).toMatch(/art\. 7º, IX/);
  });

  it('base legal ausente vira null, não erro', async () => {
    const { baseLegal: _b, ...semBase } = contatoCompleto();
    estado.contato = semBase as Contact;

    expect((await montar())?.baseLegalDoTratamento).toBeNull();
  });

  it('lista as comunicações recebidas em ordem cronológica', async () => {
    estado.envios = [
      {
        tenantId: TENANT_PADRAO,
        sendId: sendId('s-1'),
        campaignId: campaignId('k-1'),
        contactId: contactId('c-1'),
        status: 'ENTREGUE',
        enviadoEm: new Date('2026-08-05T09:00:00Z'),
      },
    ];
    estado.eventos = [
      {
        tenantId: TENANT_PADRAO,
        sesMessageId: 'm1',
        tipo: 'OPEN',
        ocorridoEm: new Date('2026-08-05T11:00:00Z'),
      },
      {
        tenantId: TENANT_PADRAO,
        sesMessageId: 'm1',
        tipo: 'DELIVERY',
        ocorridoEm: new Date('2026-08-05T09:00:05Z'),
      },
    ];

    const d = await montar();
    const historico = d?.comunicacoesRecebidas[0]?.historico ?? [];

    expect(historico.map((h) => h.evento)).toEqual(['Entregue', 'Aberto']);
  });

  it('traduz o tipo de evento para linguagem comum', async () => {
    estado.envios = [
      {
        tenantId: TENANT_PADRAO,
        sendId: sendId('s-1'),
        campaignId: campaignId('k-1'),
        contactId: contactId('c-1'),
        status: 'ENTREGUE',
      },
    ];
    estado.eventos = [
      {
        tenantId: TENANT_PADRAO,
        sesMessageId: 'm1',
        tipo: 'CLICK',
        ocorridoEm: AGORA,
        urlClicada: 'https://exemplo.com/artigo',
      },
    ];

    const h = (await montar())?.comunicacoesRecebidas[0]?.historico[0];
    expect(h).toMatchObject({ evento: 'Link clicado', detalhe: 'https://exemplo.com/artigo' });
  });

  it('informa como exercer cada direito', async () => {
    const d = await montar();
    const texto = (d?.comoExercerSeusDireitos ?? []).join(' ');

    expect(texto).toMatch(/art\. 18, §2º/);
    expect(texto).toMatch(/eliminação/i);
    // Explica o hash que sobrevive à exclusão — §6.2, nota 2.
    expect(texto).toMatch(/código irreversível/i);
  });

  it('avisa que o dossiê cobre só este sistema', async () => {
    // Sem isso, o titular concluiria que o escritório não tem mais nada sobre
    // ele — quando processos e contratos vivem em outros sistemas.
    expect((await montar())?.aviso).toMatch(/não inclui informações de processos/i);
  });

  it('contato inexistente devolve null', async () => {
    estado.contato = null;
    expect(await montar()).toBeNull();
  });

  it('não vaza dado de terceiros nem identificador interno de outro contato', async () => {
    const serializado = JSON.stringify(await montar());

    expect(serializado).not.toMatch(/emailHash/);
    expect(serializado).not.toMatch(/supress/i);
    expect(serializado).not.toMatch(/tenantId/);
  });
});

describe('CSV — formato de uso comum (art. 19)', () => {
  beforeEach(() => {
    estado.envios = [
      {
        tenantId: TENANT_PADRAO,
        sendId: sendId('s-1'),
        campaignId: campaignId('k-1'),
        contactId: contactId('c-1'),
        status: 'ENTREGUE',
        enviadoEm: new Date('2026-08-05T09:00:00Z'),
      },
    ];
  });

  it('usa ponto e vírgula — o que o Excel em português espera', async () => {
    const csv = dossieParaCsv((await montar())!);
    expect(csv.split('\r\n')[0]).toContain('campanha;situacao');
  });

  it('começa com BOM para o Excel reconhecer UTF-8', async () => {
    // Sem o BOM, a acentuação vira lixo na planilha de quem abre no Windows — e
    // o CSV perde justamente a utilidade que motivou gerá-lo.
    const csv = dossieParaCsv((await montar())!);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('inclui a comunicação mesmo sem eventos registrados', async () => {
    const linhas = dossieParaCsv((await montar())!)
      .trim()
      .split('\r\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toContain('k-1');
  });

  it('neutraliza injeção de fórmula', async () => {
    // Campo começando com "=" seria executado como fórmula ao abrir a planilha —
    // o vetor clássico de exportação de dados.
    estado.eventos = [
      {
        tenantId: TENANT_PADRAO,
        sesMessageId: 'm1',
        tipo: 'CLICK',
        ocorridoEm: AGORA,
        urlClicada: '=HYPERLINK("http://malicioso","clique")',
      },
    ];

    const csv = dossieParaCsv((await montar())!);
    expect(csv).toContain('"=HYPERLINK(""http://malicioso"",""clique"")"');
  });

  it('escapa ponto e vírgula dentro do campo', async () => {
    estado.eventos = [
      {
        tenantId: TENANT_PADRAO,
        sesMessageId: 'm1',
        tipo: 'CLICK',
        ocorridoEm: AGORA,
        urlClicada: 'https://exemplo.com/a;b',
      },
    ];

    const csv = dossieParaCsv((await montar())!);
    expect(csv).toContain('"https://exemplo.com/a;b"');
  });
});
