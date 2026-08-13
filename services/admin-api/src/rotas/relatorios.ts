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
rotasRelatorios.get('/campanhas/:id', async (c) => {
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
rotasRelatorios.get('/campanhas/:id/destinatarios', async (c) => {
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
        respondidoEm: e.respondidoEm?.toISOString() ?? null,
        abertoEm: e.primeiraAberturaEm?.toISOString() ?? null,
        clicadoEm: e.primeiroCliqueEm?.toISOString() ?? null,
      };
    }),
  );

  return c.json({ itens, cursor: pagina.cursor });
});

/**
 * Série diária de engajamento de uma campanha — o gráfico do relatório.
 *
 * Pontos existem só para dias com atividade, e só a partir da implantação do
 * agregado (eventos antigos não são re-processados). A tela preenche os
 * buracos com zero — o servidor entrega o fato, não a estética.
 */
rotasRelatorios.get('/campanhas/:id/serie', async (c) => {
  const { metricas } = await obterDependencias();
  const usuario = c.get('usuario');

  const pontos = await metricas.lerSerie(usuario.tenantId, novoCampaignId(c.req.param('id')));
  return c.json({ pontos });
});

/**
 * Série diária agregada de várias campanhas — o gráfico do painel inicial.
 *
 * Soma os pontos por dia no servidor: a alternativa (a interface buscar a
 * série de cada campanha e somar) custaria N requisições para desenhar uma
 * curva. Ids explícitos, como todo agregado deste módulo.
 */
rotasRelatorios.get('/serie', async (c) => {
  const { metricas } = await obterDependencias();
  const usuario = c.get('usuario');

  const ids = (c.req.query('campanhas') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, 100);

  if (ids.length === 0) {
    return c.json(
      { code: 'CAMPO_OBRIGATORIO', message: 'Informe as campanhas em ?campanhas=id1,id2.' },
      400,
    );
  }

  const porDia = new Map<
    string,
    {
      dia: string;
      enviados: number;
      entregues: number;
      aberturas: number;
      cliques: number;
      bounces: number;
    }
  >();

  const series = await Promise.all(
    ids.map((id) => metricas.lerSerie(usuario.tenantId, novoCampaignId(id))),
  );
  for (const serie of series) {
    for (const p of serie) {
      const atual = porDia.get(p.dia) ?? {
        dia: p.dia,
        enviados: 0,
        entregues: 0,
        aberturas: 0,
        cliques: 0,
        bounces: 0,
      };
      porDia.set(p.dia, {
        dia: p.dia,
        enviados: atual.enviados + p.enviados,
        entregues: atual.entregues + p.entregues,
        aberturas: atual.aberturas + p.aberturas,
        cliques: atual.cliques + p.cliques,
        bounces: atual.bounces + p.bounces,
      });
    }
  }

  const pontos = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  return c.json({ pontos });
});

/**
 * Desempenho por campanha — a tabela do painel inicial.
 *
 * Uma linha por campanha com contadores E taxas, em uma chamada só: a
 * alternativa seria a interface buscar `/relatorios/campanhas/:id` uma vez por
 * linha, e uma tela inicial que dispara vinte requisições para montar uma
 * tabela envelhece mal. Ids explícitos como no `/resumo`, e pelo mesmo motivo
 * de custo: nada de Scan.
 */
rotasRelatorios.get('/desempenho', async (c) => {
  const { metricas, campanhas } = await obterDependencias();
  const usuario = c.get('usuario');

  const ids = (c.req.query('campanhas') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, 100);

  if (ids.length === 0) {
    return c.json(
      { code: 'CAMPO_OBRIGATORIO', message: 'Informe as campanhas em ?campanhas=id1,id2.' },
      400,
    );
  }

  const itens = await Promise.all(
    ids.map(async (id) => {
      const campaignId = novoCampaignId(id);
      const [campanha, brutos] = await Promise.all([
        campanhas.buscarPorId(usuario.tenantId, campaignId),
        metricas.ler(usuario.tenantId, campaignId),
      ]);
      const contadores = normalizarContadores(brutos);
      return {
        campaignId: id,
        nome: campanha?.nome ?? id,
        status: campanha?.status ?? null,
        disparadaEm: campanha?.disparadaEm?.toISOString() ?? null,
        contadores,
        taxas: calcularTaxas(contadores),
      };
    }),
  );

  return c.json({ itens });
});

/**
 * Quem respondeu ao e-mail — §11, item 9.
 *
 * Endpoint próprio, e não um filtro do anterior, por causa da paginação: a
 * resposta é rara, então filtrar a listagem por destinatário obrigaria a
 * interface a percorrer milhares de envios para montar uma lista de dezenas.
 * Aqui o filtro roda no servidor e cada página já vem enxuta.
 *
 * Uma página pode voltar **vazia com cursor** — é o comportamento do filtro do
 * DynamoDB, que examina um bloco e devolve o que passou. Quem consome segue o
 * cursor até ele sumir; parar na primeira página vazia esconderia respostas.
 */
rotasRelatorios.get('/campanhas/:id/respostas', async (c) => {
  const { envios, contatos } = await obterDependencias();
  const usuario = c.get('usuario');
  const campaignId = novoCampaignId(c.req.param('id'));

  const pagina = await envios.listarRespondentes(
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
        respondidoEm: e.respondidoEm?.toISOString() ?? null,
        enviadoEm: e.enviadoEm?.toISOString() ?? null,
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
      resposta: 'e-mails respondidos / entregues',
    },
  };
}
