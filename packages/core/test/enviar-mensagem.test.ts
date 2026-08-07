import { describe, it, expect, beforeEach } from 'vitest';
import {
  enviarMensagem,
  type DepsEnvio,
  type EntradaEnvio,
} from '../src/application/use-cases/enviar-mensagem.js';
import { EmailAddress } from '../src/domain/shared/email-address.js';
import { unwrap } from '../src/domain/shared/result.js';
import {
  campaignId,
  contactId,
  listId,
  sendId,
  templateId,
  TENANT_PADRAO,
  userId,
} from '../src/domain/shared/ids.js';
import type { Campaign } from '../src/domain/campaign/campaign.js';
import type { Contact } from '../src/domain/contact/contact.js';
import type { Envio } from '../src/domain/send/envio.js';
import type { FalhaEnvio } from '../src/application/ports/index.js';

const AGORA = new Date('2026-08-07T12:00:00Z');

const ENTRADA: EntradaEnvio = {
  tenantId: TENANT_PADRAO,
  campaignId: campaignId('k-1'),
  contactId: contactId('c-1'),
  sendId: sendId('s-1'),
  limiteDiario: 200,
  baseUrlDescadastro: 'https://exemplo.com/u',
  configurationSet: 'cs',
};

interface Estado {
  statusCampanha: Campaign['status'] | null;
  contato: Contact | null;
  suprimido: boolean;
  circuitoAberto: boolean;
  cotaDisponivel: boolean;
  templateExiste: boolean;
  marcas: Set<string>;
  liberadas: string[];
  falhaProvedor: FalhaEnvio | null;
  enviosSalvos: Envio[];
  enviados: number;
  circuitoAbertoPor: string | null;
}

let estado: Estado;

function campanha(): Campaign {
  return {
    tenantId: TENANT_PADRAO,
    campaignId: campaignId('k-1'),
    nome: 'Boletim',
    templateId: templateId('t-1'),
    templateVersao: 1,
    listId: listId('l-1'),
    status: 'ENVIANDO',
    remetenteNome: 'André Araújo Advogados',
    remetenteEmail: 'contato@mail.andrearaujoadvogados.com.br',
    criadoPor: userId('u-1'),
    criadoEm: AGORA,
  };
}

function contatoAtivo(): Contact {
  return {
    tenantId: TENANT_PADRAO,
    contactId: contactId('c-1'),
    email: unwrap(EmailAddress.create('titular@exemplo.com')),
    camposCustomizados: {},
    status: 'ATIVO',
    relacionamento: 'CLIENTE_ATIVO',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    origem: 'csv',
  };
}

function deps(): DepsEnvio {
  return {
    campanhas: {
      buscarPorId: async () => (estado.statusCampanha === null ? null : campanha()),
      salvar: async () => undefined,
      lerStatus: async () => estado.statusCampanha,
      listar: async () => ({ itens: [], truncado: false }),
    },
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
      salvar: async (e) => void estado.enviosSalvos.push(e),
      contarPorCampanha: async () => estado.enviosSalvos.length,
      listarPorContato: async () => estado.enviosSalvos,
    },
    templates: {
      buscarVersao: async () =>
        estado.templateExiste ? { assunto: 'Olá {{contato.nome}}', corpoHtml: '<p>oi</p>' } : null,
      buscarMeta: async () => null,
      listar: async () => ({ itens: [] }),
      salvarComVersao: async () => undefined,
      salvarMeta: async () => undefined,
    },
    supressao: {
      estaSuprimido: async () => estado.suprimido,
      filtrarSuprimidos: async () => new Set(),
      suprimir: async () => undefined,
      remover: async () => undefined,
    },
    provedor: {
      enviar: async () => {
        if (estado.falhaProvedor !== null)
          return { ok: false as const, error: estado.falhaProvedor };
        estado.enviados += 1;
        return { ok: true as const, value: { providerMessageId: 'ses-msg-1' } };
      },
    },
    renderer: {
      renderizar: async (t) => ({
        assunto: t.assunto,
        corpoHtml: t.corpoHtml,
        corpoTexto: 'oi',
      }),
    },
    tokens: {
      emitir: () => 'token-assinado',
      verificar: () => null,
    },
    hasher: { hash: (e) => `h:${e.value}` },
    idempotencia: {
      registrarSeNovo: async (chave) => {
        if (estado.marcas.has(chave)) return false;
        estado.marcas.add(chave);
        return true;
      },
      liberar: async (chave) => {
        estado.marcas.delete(chave);
        estado.liberadas.push(chave);
      },
    },
    cotaDiaria: { reservar: async () => estado.cotaDisponivel },
    circuito: {
      estaAberto: async () => estado.circuitoAberto,
      abrir: async (_c, _d, motivo) => void (estado.circuitoAbertoPor = motivo),
    },
    clock: { agora: () => AGORA },
  };
}

beforeEach(() => {
  estado = {
    statusCampanha: 'ENVIANDO',
    contato: contatoAtivo(),
    suprimido: false,
    circuitoAberto: false,
    cotaDisponivel: true,
    templateExiste: true,
    marcas: new Set(),
    liberadas: [],
    falhaProvedor: null,
    enviosSalvos: [],
    enviados: 0,
    circuitoAbertoPor: null,
  };
});

describe('enviarMensagem — caminho feliz', () => {
  it('envia e registra o messageId para correlacionar eventos futuros', async () => {
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toEqual({ acao: 'ENVIADO', sesMessageId: 'ses-msg-1' });
    expect(estado.enviosSalvos[0]).toMatchObject({ status: 'ENVIADO', sesMessageId: 'ses-msg-1' });
  });
});

describe('idempotência — §5.4', () => {
  it('não envia duas vezes para o mesmo sendId', async () => {
    const d = deps();
    await enviarMensagem(d, ENTRADA);
    const segunda = await enviarMensagem(d, ENTRADA);

    expect(segunda).toMatchObject({ acao: 'IGNORADO' });
    expect(estado.enviados).toBe(1);
  });

  it('grava a marca ANTES de chamar o provedor', async () => {
    // Se a marca viesse depois, duas reentregas concorrentes passariam pela
    // verificação ao mesmo tempo e a pessoa receberia em duplicata.
    estado.falhaProvedor = { tipo: 'REJEITADO_PERMANENTE', detalhe: 'endereço inválido' };
    await enviarMensagem(deps(), ENTRADA);

    expect(estado.marcas.has('send:s-1')).toBe(true);
  });
});

describe('throttling é fluxo normal, não erro — §5.5', () => {
  beforeEach(() => {
    estado.falhaProvedor = { tipo: 'THROTTLED', tentarNovamenteEmMs: 2000 };
  });

  it('manda adiar em vez de falhar', async () => {
    const r = await enviarMensagem(deps(), ENTRADA);
    expect(r).toEqual({ acao: 'ADIAR', segundos: 2, motivo: 'Throttling do SES.' });
  });

  it('LIBERA a marca de idempotência — senão o destinatário nunca receberia', async () => {
    const d = deps();
    await enviarMensagem(d, ENTRADA);

    expect(estado.liberadas).toContain('send:s-1');
    expect(estado.marcas.has('send:s-1')).toBe(false);

    // A retentativa precisa efetivamente enviar.
    estado.falhaProvedor = null;
    const retentativa = await enviarMensagem(d, ENTRADA);
    expect(retentativa).toMatchObject({ acao: 'ENVIADO' });
  });
});

describe('conta suspensa abre o circuito — §5.5', () => {
  it('abre o circuito e adia, em vez de queimar a fila na DLQ', async () => {
    estado.falhaProvedor = { tipo: 'CONTA_SUSPENSA', detalhe: 'AccountSuspended' };
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'ADIAR' });
    expect(estado.circuitoAbertoPor).toBe('AccountSuspended');
    expect(estado.liberadas).toContain('send:s-1');
  });

  it('com circuito aberto, nem consulta a campanha', async () => {
    estado.circuitoAberto = true;
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'ADIAR', motivo: 'Circuito do SES aberto.' });
    expect(estado.enviados).toBe(0);
    expect(estado.marcas.size).toBe(0);
  });
});

describe('pausa e cancelamento — ADR-05', () => {
  it('campanha pausada adia sem consumir a marca de idempotência', async () => {
    estado.statusCampanha = 'PAUSADA';
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'ADIAR', motivo: 'Campanha pausada.' });
    // Importante: sem marca, a mensagem é processável de novo ao retomar.
    expect(estado.marcas.size).toBe(0);
    expect(estado.enviados).toBe(0);
  });

  it.each(['CANCELADA', 'CONCLUIDA'] as const)('campanha %s descarta a mensagem', async (s) => {
    estado.statusCampanha = s;
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'IGNORADO' });
    expect(estado.enviados).toBe(0);
  });
});

describe('supressão é a última barreira', () => {
  it('não envia para quem se descadastrou depois de a audiência ser resolvida', async () => {
    estado.suprimido = true;
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'IGNORADO', motivo: 'Contato suprimido.' });
    expect(estado.enviados).toBe(0);
    expect(estado.enviosSalvos[0]).toMatchObject({ status: 'SUPRIMIDO' });
  });
});

describe('cota diária — §5.6', () => {
  it('adia até a próxima janela em vez de falhar', async () => {
    estado.cotaDisponivel = false;
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'ADIAR', motivo: 'Cota diária.' });
    if (r.acao === 'ADIAR') {
      // 12h de meio-dia até a virada; teto do SQS é 12h.
      expect(r.segundos).toBeGreaterThan(0);
      expect(r.segundos).toBeLessThanOrEqual(43_200);
    }
  });

  it('só reserva cota depois de passar por supressão e template', async () => {
    // Reservar antes desperdiçaria vagas da cota com mensagens que não sairiam.
    estado.suprimido = true;
    let reservou = false;
    const d = { ...deps(), cotaDiaria: { reservar: async () => ((reservou = true), true) } };
    await enviarMensagem(d, ENTRADA);

    expect(reservou).toBe(false);
  });
});

describe('falhas permanentes', () => {
  it('template inexistente não é retentado', async () => {
    estado.templateExiste = false;
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'FALHA_PERMANENTE' });
    expect(estado.enviosSalvos[0]).toMatchObject({ status: 'FALHOU' });
  });

  it('rejeição permanente do SES não libera a marca — não adianta retentar', async () => {
    estado.falhaProvedor = { tipo: 'REJEITADO_PERMANENTE', detalhe: 'MessageRejected' };
    await enviarMensagem(deps(), ENTRADA);

    expect(estado.liberadas).toHaveLength(0);
  });

  it('erro transitório libera a marca para nova tentativa', async () => {
    estado.falhaProvedor = { tipo: 'ERRO_TRANSITORIO', detalhe: 'timeout' };
    const r = await enviarMensagem(deps(), ENTRADA);

    expect(r).toMatchObject({ acao: 'FALHA_TRANSITORIA' });
    expect(estado.liberadas).toContain('send:s-1');
  });

  it('contato inexistente é ignorado, não retentado', async () => {
    estado.contato = null;
    const r = await enviarMensagem(deps(), ENTRADA);
    expect(r).toMatchObject({ acao: 'IGNORADO', motivo: 'Contato inexistente.' });
  });
});
