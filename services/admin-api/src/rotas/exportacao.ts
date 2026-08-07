import { Hono } from 'hono';
import { contactId as novoContactId, dossieParaCsv, montarDossieTitular } from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';

export const rotasExportacao = new Hono<{ Variables: Variaveis }>();

/** Vida curta: o arquivo reúne, num só lugar, tudo que se sabe sobre a pessoa. */
const VALIDADE_LINK_SEGUNDOS = 300;

/**
 * Exportação de portabilidade — LGPD, art. 18, II e V.
 *
 * **Restrito a ADMIN, e não exposto publicamente.** A decisão merece explicação,
 * porque a alternativa é tentadora: bastaria reusar o token do link de
 * descadastro e o titular baixaria sozinho.
 *
 * O problema é que aquele token é, por desenho, permanente e de baixo risco —
 * ele precisa funcionar anos depois, num e-mail que pode ter sido encaminhado a
 * terceiros (§ do serviço público). Um link permanente que entrega o dossiê
 * completo de uma pessoa é outra categoria de risco. O art. 18, §5º permite ao
 * controlador exigir comprovação de identidade, e é isso que o escritório faz
 * antes de acionar esta rota.
 *
 * Um portal de autoatendimento é possível depois — mas exigiria um token com
 * propósito próprio e validade curta, não o de descadastro.
 */
rotasExportacao.post('/:id/exportacao', exigirPapel('ADMIN'), async (c) => {
  const deps = await obterDependencias();
  const usuario = c.get('usuario');
  const contactId = novoContactId(c.req.param('id'));

  const dossie = await montarDossieTitular(
    { contatos: deps.contatos, envios: deps.envios, eventos: deps.eventos, clock: deps.clock },
    { tenantId: usuario.tenantId, contactId },
  );

  if (dossie === null) {
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);
  }

  const agora = deps.clock.agora();
  const carimbo = agora.toISOString().replace(/[:.]/g, '-');
  const base = `exports/${usuario.tenantId}/${contactId}/${carimbo}`;

  await deps.armazenamento.gravar(
    `${base}/dados.json`,
    JSON.stringify(dossie, null, 2),
    'application/json; charset=utf-8',
  );
  await deps.armazenamento.gravar(
    `${base}/comunicacoes.csv`,
    dossieParaCsv(dossie),
    'text/csv; charset=utf-8',
  );

  const [urlJson, urlCsv] = await Promise.all([
    deps.armazenamento.urlDownload(`${base}/dados.json`, VALIDADE_LINK_SEGUNDOS),
    deps.armazenamento.urlDownload(`${base}/comunicacoes.csv`, VALIDADE_LINK_SEGUNDOS),
  ]);

  /**
   * Exportar dado pessoal é, ele próprio, tratamento de dado pessoal — e dos
   * mais sensíveis, porque reúne tudo num arquivo. Sem este registro, ninguém
   * conseguiria responder depois quem baixou o dossiê de quem.
   */
  await deps.auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EXPORTOU',
    recursoTipo: 'Contact',
    recursoId: contactId,
    depois: {
      arquivos: [`${base}/dados.json`, `${base}/comunicacoes.csv`],
      comunicacoesIncluidas: dossie.comunicacoesRecebidas.length,
    },
    ...(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() === undefined
      ? {}
      : { ipOrigem: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '' }),
    ocorridoEm: agora,
  });

  return c.json({
    contactId,
    geradoEm: dossie.geradoEm,
    comunicacoesIncluidas: dossie.comunicacoesRecebidas.length,
    arquivos: [
      { formato: 'json', descricao: 'Dados completos, leitura automática', url: urlJson },
      { formato: 'csv', descricao: 'Histórico de comunicações, abre em planilha', url: urlCsv },
    ],
    validadeSegundos: VALIDADE_LINK_SEGUNDOS,
    aviso:
      'Os links expiram em 5 minutos e os arquivos são apagados em 7 dias. Entregue-os ao titular por canal seguro — não por e-mail.',
  });
});
