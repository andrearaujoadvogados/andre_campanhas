import { Hono } from 'hono';
import { criarUsuarioSchema, definirPapelSchema } from '@emailmkt/contracts';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

export const rotasUsuarios = new Hono<{ Variables: Variaveis }>();

/**
 * Contas de acesso ao painel — só `ADMIN`.
 *
 * Antes disso, criar um usuário exigia dois comandos no CloudShell e acertar o
 * nome do grupo em minúsculas. Não era segurança: era um obstáculo que fazia a
 * conta ser criada errado, ou não ser criada.
 */
rotasUsuarios.get('/', exigirPapel('ADMIN'), async (c) => {
  const { gestaoUsuarios } = await obterDependencias();
  const usuarios = await gestaoUsuarios.listar();

  return c.json({
    usuarios: usuarios
      .map((u) => ({
        id: u.id,
        sub: u.sub,
        email: u.email,
        papeis: u.papeis,
        habilitado: u.habilitado,
        aguardandoPrimeiroAcesso: u.aguardandoPrimeiroAcesso,
        criadoEm: u.criadoEm.toISOString(),
      }))
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-BR')),
  });
});

rotasUsuarios.post('/', exigirPapel('ADMIN'), validarCorpo(criarUsuarioSchema), async (c) => {
  const { gestaoUsuarios, auditoria, clock } = await obterDependencias();
  const dados = c.req.valid('json');
  const usuario = c.get('usuario');

  const criado = await gestaoUsuarios.criar(dados.email, dados.papel);

  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'CRIOU',
    recursoTipo: 'Usuario',
    recursoId: criado.id,
    depois: { email: dados.email, papel: dados.papel },
    ocorridoEm: clock.agora(),
  });

  return c.json(
    {
      id: criado.id,
      email: criado.email,
      papeis: criado.papeis,
      // A senha provisória vai por e-mail e expira em 7 dias. Quem cria a conta
      // precisa saber disso na hora, senão descobre quando o prazo já passou.
      aviso:
        `Convite enviado para ${criado.email}. A senha provisória expira em 7 dias — ` +
        'até lá a pessoa precisa entrar, definir a senha e cadastrar o MFA.',
    },
    201,
  );
});

rotasUsuarios.put(
  '/:id/papel',
  exigirPapel('ADMIN'),
  validarCorpo(definirPapelSchema),
  async (c) => {
    const { gestaoUsuarios, auditoria, clock } = await obterDependencias();
    const { papel } = c.req.valid('json');
    const usuario = c.get('usuario');
    const id = c.req.param('id');

    /**
     * Ninguém se rebaixa sozinho.
     *
     * Com poucos administradores, o último a se tornar operador tranca a conta
     * inteira: não sobraria quem promovesse alguém de volta, e o conserto seria
     * pelo CloudShell — exatamente o que esta tela existe para evitar.
     */
    // Compara pelo `sub`, que é o que o token carrega — o `id` da rota é o
    // `Username` do Cognito, e os dois só coincidem para parte das contas.
    const eleMesmo = (await gestaoUsuarios.listar()).find((u) => u.id === id)?.sub;

    if (eleMesmo === usuario.userId && papel !== 'ADMIN') {
      return c.json(
        {
          code: 'AUTO_REBAIXAMENTO',
          message: 'Você não pode remover o próprio acesso de administrador. Peça a outro admin.',
        },
        409,
      );
    }

    await gestaoUsuarios.definirPapel(id, papel);

    await auditoria.registrar({
      tenantId: usuario.tenantId,
      userId: usuario.userId,
      acao: 'EDITOU',
      recursoTipo: 'Usuario',
      recursoId: id,
      depois: { papel },
      ocorridoEm: clock.agora(),
    });

    return c.json({ id, papel });
  },
);

rotasUsuarios.post('/:id/convite', exigirPapel('ADMIN'), async (c) => {
  const { gestaoUsuarios } = await obterDependencias();
  const id = c.req.param('id');

  await gestaoUsuarios.reenviarConvite(id);

  return c.json({
    id,
    aviso: 'Convite reenviado com uma senha provisória nova. A anterior deixou de valer.',
  });
});

/**
 * Desabilitar, não excluir.
 *
 * O `criadoPor` e o `aprovadoPor` das campanhas guardam o id do usuário. Excluir
 * a conta deixaria o registro de quem aprovou o quê apontando para o nada — e é
 * esse registro que dá sentido à aprovação.
 */
rotasUsuarios.delete('/:id', exigirPapel('ADMIN'), async (c) => {
  const { gestaoUsuarios, auditoria, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const id = c.req.param('id');

  const eleMesmo = (await gestaoUsuarios.listar()).find((u) => u.id === id)?.sub;

  if (eleMesmo === usuario.userId) {
    return c.json(
      {
        code: 'AUTO_DESATIVACAO',
        message: 'Você não pode desativar a própria conta.',
      },
      409,
    );
  }

  await gestaoUsuarios.desabilitar(id);

  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'Usuario',
    recursoId: id,
    depois: { habilitado: false },
    ocorridoEm: clock.agora(),
  });

  return c.json({ id, habilitado: false });
});

rotasUsuarios.post('/:id/reativar', exigirPapel('ADMIN'), async (c) => {
  const { gestaoUsuarios, auditoria, clock } = await obterDependencias();
  const usuario = c.get('usuario');
  const id = c.req.param('id');

  await gestaoUsuarios.reabilitar(id);

  await auditoria.registrar({
    tenantId: usuario.tenantId,
    userId: usuario.userId,
    acao: 'EDITOU',
    recursoTipo: 'Usuario',
    recursoId: id,
    depois: { habilitado: true },
    ocorridoEm: clock.agora(),
  });

  return c.json({ id, habilitado: true });
});
