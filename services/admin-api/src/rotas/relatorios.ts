import { Hono } from 'hono';
import {
  LIMIAR_BOUNCE_ATENCAO,
  LIMIAR_BOUNCE_CRITICO,
  LIMIAR_RECLAMACAO_ATENCAO,
  LIMIAR_RECLAMACAO_CRITICO,
  avaliarRisco,
  calcularTaxas,
  campaignId as novoCampaignId,
  normalizarContadores,
  somarContadores,
  type ContadoresCampanha,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { obterDependencias } from '../container.js';

export const rotasRelatorios = new Hono<{ Variables: Variaveis }>();

/**
 * Relatório de uma campanha — §11, item 8.
 *
 * Devolve contadores, taxas **e** a avaliação de risco. As três coisas juntas de
 * propósito: o número sozinho não comunica urgência. "4,8% de bounce" parece bom
 * para quem não sabe que a AWS suspende a conta perto de 10% — e é justamente
 * quem não sabe que vai olhar essa tela.
 */
rotasRelatorios.get('/boletins/:id', async (c) => {
  const { metricas, campanhas } = await obterDependencias();
  const usuario = c.get('usuario');
  const campaignId = novoCampaignId(c.req.param('id'));

  const campanha = await campanhas.buscarPorId(usuario.tenantId, campaignId);
  if (campanha === null) {
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Campanha inexistente.' }, 404);
  }

  const contadores = normalizarContadores(await metricas.ler(usuario.tenantId, campaignId));

  return c.json({
    campaignId,
    nome: campanha.nome,
    status: campanha.status,
    ...montarRelatorio(contadores),
  });
});

/**
 * Tabela por destinatário — §10, "Relatório individual da campanha".
 *
 * Uma página de registros de envio (contato, status de entrega, enviado em),
 * paginada pela partição da campanha. O status vem do `Envio` — reflete entrega
 * (ENTREGUE/FALHOU/…), não abertura/clique: essas são eventos individuais, e o
 * detalhe por destinatário de aberturas/cliques exige um modelo de leitura de
 * eventos (adiado, junto com a série temporal — analytics V2). As taxas
 * agregadas de abertura/clique já estão no relatório da campanha acima.
 */
rotasRelatorios.get('/boletins/:id/destinatarios', async (c) => {
  const { envios, contatos } = await obterDependencias();
  const usuario = c.get('usuario');
  const campaignId = novoCampaignId(c.req.param('id'));

  const pagina = await envios.listarPorCampanha(
    usuario.tenantId,
    campaignId,
    c.req.query('cursor'),
  );

  const itens = await Promise.all(
    pagina.itens.map(async (e) => {
      const contato = await contatos.buscarPorId(usuario.tenantId, e.contactId);
      return {
        contactId: String(e.contactId),
        nome: contato?.nome ?? null,
        email: contato?.email.value ?? null,
        status: e.status,
        enviadoEm: e.enviadoEm?.toISOString() ?? null,
        falhaMotivo: e.falhaMotivo ?? null,
      };
    }),
  );

  return c.json({ itens, cursor: pagina.cursor });
});

/**
 * Visão agregada.
 *
 * Recebe os ids das campanhas a somar. Não varre a base por decisão de custo: um
 * `Scan` para montar dashboard é o caminho mais rápido para uma conta de
 * DynamoDB inesperada, e a interface já tem a lista de campanhas em mãos.
 */
rotasRelatorios.get('/resumo', async (c) => {
  const { metricas } = await obterDependencias();
  const usuario = c.get('usuario');

  const ids = (c.req.query('campanhas') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, 100);

  if (ids.length === 0) {
    return c.json(
      {
        code: 'CAMPO_OBRIGATORIO',
        message: 'Informe as campanhas a agregar em ?campanhas=id1,id2.',
      },
      400,
    );
  }

  const porCampanha = await Promise.all(
    ids.map(async (id) =>
      normalizarContadores(await metricas.ler(usuario.tenantId, novoCampaignId(id))),
    ),
  );

  return c.json({
    campanhasAgregadas: ids.length,
    ...montarRelatorio(somarContadores(porCampanha)),
  });
});

/** Os limiares vêm da API para a interface não reimplementar a régua. */
rotasRelatorios.get('/limiares', (c) =>
  c.json({
    bounce: { atencao: LIMIAR_BOUNCE_ATENCAO, critico: LIMIAR_BOUNCE_CRITICO },
    reclamacao: { atencao: LIMIAR_RECLAMACAO_ATENCAO, critico: LIMIAR_RECLAMACAO_CRITICO },
    observacao:
      'São os mesmos limiares dos alarmes do CloudWatch. Se divergirem, o painel mostraria tudo verde enquanto a agência recebe alerta.',
  }),
);

function montarRelatorio(contadores: ContadoresCampanha): Record<string, unknown> {
  const taxas = calcularTaxas(contadores);
  const risco = avaliarRisco(contadores, taxas);

  return {
    contadores,
    taxas,
    risco,
    // A base de cada taxa vai junto: sem isso, quem lê "abertura 42%" não sabe
    // se é sobre enviados ou sobre entregues — e os dois números contam
    // histórias diferentes sobre a mesma campanha.
    baseDeCalculo: {
      entrega: 'entregues / enviados',
      abertura: 'aberturas únicas / entregues',
      clique: 'cliques únicos / entregues',
      cliquePorAbertura: 'cliques únicos / aberturas únicas',
      bounceHard: 'bounces permanentes / enviados',
      bounceTotal: 'bounces permanentes e temporários / enviados',
      reclamacao: 'reclamações / entregues',
      descadastro: 'descadastros / entregues',
    },
  };
}
