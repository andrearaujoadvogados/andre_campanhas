import { Hono } from 'hono';
import { criarContatoSchema, atualizarContatoSchema } from '@emailmkt/contracts';
import {
  EmailAddress,
  contactId as novoContactId,
  verificarElegibilidade,
  type Contact,
} from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

export const rotasContatos = new Hono<{ Variables: Variaveis }>();

rotasContatos.get('/:id', async (c) => {
  const { contatos, clock } = await obterDependencias();
  const usuario = c.get('usuario');

  const contato = await contatos.buscarPorId(usuario.tenantId, novoContactId(c.req.param('id')));
  if (contato === null)
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);

  return c.json(paraResposta(contato, clock.agora()));
});

rotasContatos.post('/', validarCorpo(criarContatoSchema), async (c) => {
  const dados = c.req.valid('json');
  const { contatos, auditoria, clock, ids } = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = clock.agora();

  const email = EmailAddress.create(dados.email);
  if (!email.ok) return c.json({ code: email.error.code, message: email.error.message }, 400);

  const existente = await contatos.buscarPorEmail(usuario.tenantId, email.value);
  if (existente !== null) {
    return c.json(
      {
        code: 'CONTATO_DUPLICADO',
        message: 'Já existe contato com este e-mail.',
        contactId: existente.contactId,
      },
      409,
    );
  }

  const contato: Contact = {
    tenantId: usuario.tenantId,
    contactId: novoContactId(ids.gerar()),
    email: email.value,
    ...(dados.nome === undefined ? {} : { nome: dados.nome }),
    ...(dados.telefone === undefined ? {} : { telefone: dados.telefone }),
    ...(dados.empresa === undefined ? {} : { empresa: dados.empresa }),
    ...(dados.tags.length === 0 ? {} : { tags: dados.tags }),
    ...(dados.isLead ? { isLead: true } : {}),
    camposCustomizados: dados.camposCustomizados,
    status: 'ATIVO',
    relacionamento: dados.relacionamento,
    ...(dados.relacionamentoDesde === undefined
      ? {}
      : { relacionamentoDesde: dados.relacionamentoDesde }),
    criadoEm: agora,
    atualizadoEm: agora,
    origem: 'manual',
  };

  await contatos.salvar(contato);
  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'CRIOU',
    recursoTipo: 'Contact',
    recursoId: contato.contactId,
    depois: { email: contato.email.mascarado, relacionamento: contato.relacionamento },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(contato, agora), 201);
});

rotasContatos.patch('/:id', validarCorpo(atualizarContatoSchema), async (c) => {
  const dados = c.req.valid('json');
  const { contatos, auditoria, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = clock.agora();

  const atual = await contatos.buscarPorId(usuario.tenantId, novoContactId(c.req.param('id')));
  if (atual === null)
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);

  /**
   * O e-mail não é editável por aqui, e isso é decisão, não omissão.
   *
   * Trocar o endereço de um contato existente burlaria a lista de supressão: a
   * pessoa que se descadastrou continuaria no cadastro, com endereço novo e
   * status ATIVO. Mudança de endereço é criar outro contato — e o antigo segue
   * suprimido.
   */
  const atualizado: Contact = {
    ...atual,
    ...(dados.nome === undefined ? {} : { nome: dados.nome }),
    ...(dados.telefone === undefined ? {} : { telefone: dados.telefone }),
    ...(dados.empresa === undefined ? {} : { empresa: dados.empresa }),
    ...(dados.tags === undefined ? {} : { tags: dados.tags }),
    ...(dados.isLead === undefined ? {} : { isLead: dados.isLead }),
    ...(dados.relacionamento === undefined ? {} : { relacionamento: dados.relacionamento }),
    ...(dados.relacionamentoDesde === undefined
      ? {}
      : { relacionamentoDesde: dados.relacionamentoDesde }),
    ...(dados.camposCustomizados === undefined
      ? {}
      : { camposCustomizados: dados.camposCustomizados }),
    atualizadoEm: agora,
  };

  await contatos.salvar(atualizado);
  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'Contact',
    recursoId: atual.contactId,
    antes: { relacionamento: atual.relacionamento, nome: atual.nome },
    depois: { relacionamento: atualizado.relacionamento, nome: atualizado.nome },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(atualizado, agora));
});

/**
 * Exclusão definitiva — direito de eliminação, art. 18 (§6.2, nota 2).
 *
 * Apaga o contato **e** grava o hash do e-mail na supressão. Sem a supressão,
 * uma reimportação futura do CSV traria a pessoa de volta e ela voltaria a
 * receber o que pediu para não receber.
 *
 * Restrito a ADMIN: é irreversível.
 */
/**
 * Marcar e desmarcar "não receber" — o controle do operador.
 *
 * Usa o status `SUPRIMIDO`, que já bloqueia o envio, em vez de um campo novo:
 * um segundo mecanismo de bloqueio seria um segundo lugar para esquecer de
 * consultar.
 *
 * **Só desfaz o que o operador fez.** Quem chegou a `DESCADASTRADO`, `OPOSICAO`,
 * `BOUNCE` ou `RECLAMACAO` não volta por aqui: descadastro é direito do titular,
 * e reativar quem marcou como spam derruba a reputação de envio da conta inteira
 * no SES. Reverter esses casos é decisão que não cabe num botão de tela.
 */
rotasContatos.post('/:id/nao-enviar', async (c) => {
  const { contatos, auditoria, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = clock.agora();

  const contato = await contatos.buscarPorId(usuario.tenantId, novoContactId(c.req.param('id')));
  if (contato === null) {
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);
  }

  const atualizado: Contact = { ...contato, status: 'SUPRIMIDO', atualizadoEm: agora };
  await contatos.salvar(atualizado);
  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'Contact',
    recursoId: contato.contactId,
    antes: { status: contato.status },
    depois: { status: 'SUPRIMIDO' },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(atualizado, agora));
});

rotasContatos.post('/:id/enviar', async (c) => {
  const { contatos, auditoria, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = clock.agora();

  const contato = await contatos.buscarPorId(usuario.tenantId, novoContactId(c.req.param('id')));
  if (contato === null) {
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);
  }

  if (contato.status !== 'SUPRIMIDO' && contato.status !== 'ATIVO') {
    return c.json(
      {
        code: 'REATIVACAO_NAO_PERMITIDA',
        message:
          'Este contato não pode voltar a receber pelo painel: ele se descadastrou, se opôs, ' +
          'marcou um e-mail como spam ou teve bounce permanente. Reverter isso é decisão do ' +
          'titular, não do escritório.',
      },
      409,
    );
  }

  const atualizado: Contact = { ...contato, status: 'ATIVO', atualizadoEm: agora };
  await contatos.salvar(atualizado);
  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'Contact',
    recursoId: contato.contactId,
    antes: { status: contato.status },
    depois: { status: 'ATIVO' },
    ocorridoEm: agora,
  });

  return c.json(paraResposta(atualizado, agora));
});

rotasContatos.delete('/:id', exigirPapel('ADMIN'), async (c) => {
  const { contatos, supressao, auditoria, hasher, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const agora = clock.agora();

  const contato = await contatos.buscarPorId(usuario.tenantId, novoContactId(c.req.param('id')));
  if (contato === null)
    return c.json({ code: 'NAO_ENCONTRADO', message: 'Contato inexistente.' }, 404);

  await supressao.suprimir({
    tenantId: usuario.tenantId,
    emailHash: hasher.hash(contato.email),
    motivo: 'MANUAL',
    suprimidoEm: agora,
    origem: `exclusao-lgpd:${usuario.userId}`,
  });
  await contatos.excluir(usuario.tenantId, contato.contactId);

  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EXCLUIU',
    recursoTipo: 'Contact',
    recursoId: contato.contactId,
    // Só o mascarado: o log de auditoria não pode reter o dado que acabou de
    // ser apagado a pedido do titular.
    antes: { email: contato.email.mascarado, status: contato.status },
    ocorridoEm: agora,
  });

  return c.body(null, 204);
});

/**
 * Expõe a elegibilidade junto com o contato.
 *
 * Sem isto, o operador vê um contato "ATIVO" que nunca recebe campanha e não
 * entende por quê — o caso mais provável é `relacionamento: DESCONHECIDO`
 * (§6.2). Mostrar o motivo transforma um mistério em tarefa.
 */
function paraResposta(contato: Contact, agora: Date): Record<string, unknown> {
  const elegibilidade = verificarElegibilidade(contato, agora);

  return {
    contactId: contato.contactId,
    email: contato.email.value,
    nome: contato.nome,
    telefone: contato.telefone ?? null,
    empresa: contato.empresa ?? null,
    tags: contato.tags ?? [],
    isLead: contato.isLead === true,
    status: contato.status,
    relacionamento: contato.relacionamento,
    relacionamentoDesde: contato.relacionamentoDesde?.toISOString(),
    camposCustomizados: contato.camposCustomizados,
    criadoEm: contato.criadoEm.toISOString(),
    atualizadoEm: contato.atualizadoEm.toISOString(),
    origem: contato.origem,
    elegivelParaCampanha: elegibilidade.elegivel,
    motivosInelegibilidade: elegibilidade.motivos,
  };
}
