import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
  type CognitoIdentityProviderClient,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { GestaoUsuarios, UsuarioDoPainel } from '@emailmkt/core';

/** Os grupos do pool são minúsculos; os papéis do domínio, maiúsculos. */
const GRUPO: Record<'ADMIN' | 'OPERADOR', string> = {
  ADMIN: 'admin',
  OPERADOR: 'operador',
};

const papelDoGrupo = (nome: string): 'ADMIN' | 'OPERADOR' | null => {
  const v = nome.trim().toUpperCase();
  return v === 'ADMIN' ? 'ADMIN' : v === 'OPERADOR' ? 'OPERADOR' : null;
};

const atributo = (u: UserType, nome: string): string =>
  u.Attributes?.find((a) => a.Name === nome)?.Value ?? '';

/**
 * Contas do painel, sobre o Cognito.
 *
 * O pool usa e-mail como alias de login. O `Username` de uma conta varia conforme
 * como ela foi criada — UUID pelo console, o próprio e-mail pelo `AdminCreateUser`
 * —, e nunca é igual ao `sub` do token. Daí os dois campos: `id` para operar, `sub`
 * para saber de quem é.
 */
export class CognitoGestaoUsuarios implements GestaoUsuarios {
  constructor(
    private readonly cliente: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
  ) {}

  async listar(): Promise<readonly UsuarioDoPainel[]> {
    const usuarios: UsuarioDoPainel[] = [];
    let token: string | undefined;

    // Pagina porque o `ListUsers` devolve no máximo 60 por vez. São menos de 20
    // contas hoje, mas um laço que ignora o cursor é o tipo de coisa que
    // funciona por dois anos e some com um usuário depois.
    do {
      const r = await this.cliente.send(
        new ListUsersCommand({
          UserPoolId: this.userPoolId,
          ...(token === undefined ? {} : { PaginationToken: token }),
        }),
      );

      for (const u of r.Users ?? []) {
        if (u.Username === undefined) continue;
        usuarios.push({
          id: u.Username,
          sub: atributo(u, 'sub'),
          email: atributo(u, 'email'),
          papeis: await this.papeis(u.Username),
          habilitado: u.Enabled ?? false,
          aguardandoPrimeiroAcesso: u.UserStatus === 'FORCE_CHANGE_PASSWORD',
          criadoEm: u.UserCreateDate ?? new Date(0),
        });
      }

      token = r.PaginationToken;
    } while (token !== undefined);

    return usuarios;
  }

  private async papeis(id: string): Promise<readonly ('ADMIN' | 'OPERADOR')[]> {
    const r = await this.cliente.send(
      new AdminListGroupsForUserCommand({ UserPoolId: this.userPoolId, Username: id }),
    );

    const papeis = new Set<'ADMIN' | 'OPERADOR'>();
    for (const g of r.Groups ?? []) {
      const p = g.GroupName === undefined ? null : papelDoGrupo(g.GroupName);
      if (p !== null) papeis.add(p);
    }
    return [...papeis];
  }

  async criar(email: string, papel: 'ADMIN' | 'OPERADOR'): Promise<UsuarioDoPainel> {
    /**
     * Sem `TemporaryPassword`: o Cognito gera a senha e a envia por e-mail
     * direto para a pessoa. Ela não passa por esta API, nem pelo log, nem pelo
     * navegador de quem criou a conta.
     */
    const r = await this.cliente.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          // Marcado como verificado porque quem cria a conta é um administrador
          // que conhece o endereço — e sem isso a recuperação de senha, que é
          // por e-mail, não funcionaria.
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );

    const id = r.User?.Username;
    if (id === undefined) {
      throw new Error('Cognito criou o usuário sem devolver o identificador.');
    }

    await this.definirPapel(id, papel);

    return {
      id,
      sub: r.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? '',
      email,
      papeis: [papel],
      habilitado: r.User?.Enabled ?? true,
      aguardandoPrimeiroAcesso: true,
      criadoEm: r.User?.UserCreateDate ?? new Date(),
    };
  }

  /**
   * Um papel por vez, e não acumulativo.
   *
   * `ADMIN` e `OPERADOR` são níveis, não capacidades independentes: quem é
   * administrador já pode tudo que o operador pode. Deixar os dois grupos
   * marcados não daria mais permissão, só tornaria a tela ambígua sobre o que a
   * pessoa é.
   */
  async definirPapel(id: string, papel: 'ADMIN' | 'OPERADOR'): Promise<void> {
    const atuais = await this.papeis(id);

    for (const p of atuais) {
      if (p === papel) continue;
      await this.cliente.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: this.userPoolId,
          Username: id,
          GroupName: GRUPO[p],
        }),
      );
    }

    if (!atuais.includes(papel)) {
      await this.cliente.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.userPoolId,
          Username: id,
          GroupName: GRUPO[papel],
        }),
      );
    }
  }

  async reenviarConvite(id: string): Promise<void> {
    await this.cliente.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: id,
        MessageAction: 'RESEND',
      }),
    );
  }

  async desabilitar(id: string): Promise<void> {
    await this.cliente.send(
      new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: id }),
    );
  }

  async reabilitar(id: string): Promise<void> {
    await this.cliente.send(
      new AdminEnableUserCommand({ UserPoolId: this.userPoolId, Username: id }),
    );
  }
}
