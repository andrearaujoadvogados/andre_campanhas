/**
 * Configuração do painel — obtida em tempo de execução, não de compilação.
 *
 * A URL da API e os identificadores do Cognito são saídas das stacks: só
 * existem depois que a infraestrutura sobe. Embutir os três no bundle obrigaria
 * a compilar o painel **depois** do deploy, o que por sua vez obrigaria o
 * pipeline a ler saídas do CloudFormation — e essa permissão o papel do GitHub
 * não tem, de propósito.
 *
 * Lendo em tempo de execução, o bundle passa a ser o mesmo para qualquer
 * ambiente e o CDK publica tudo numa etapa só. O `config.json` é escrito pela
 * própria stack, com os valores reais, e por isso não tem como divergir.
 */
export interface Configuracao {
  readonly apiUrl: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
}

let atual: Configuracao | undefined;

/**
 * A configuração já carregada.
 *
 * Lança se chamada antes do carregamento — e é melhor assim: a alternativa
 * seria devolver strings vazias, que produzem um 401 do Cognito sem nenhuma
 * pista de que a causa foi ordem de inicialização.
 */
export function configuracao(): Configuracao {
  if (atual === undefined) {
    throw new Error('Configuração ainda não carregada.');
  }
  return atual;
}

const preenchida = (c: Configuracao): boolean =>
  c.apiUrl !== '' && c.userPoolId !== '' && c.userPoolClientId !== '';

export async function carregarConfiguracao(): Promise<Configuracao> {
  // Desenvolvimento local: o `.env.local` continua valendo, e evita depender de
  // um arquivo que o servidor do Vite não serve.
  const doAmbiente: Configuracao = {
    apiUrl: import.meta.env['VITE_API_URL'] ?? '',
    userPoolId: import.meta.env['VITE_USER_POOL_ID'] ?? '',
    userPoolClientId: import.meta.env['VITE_USER_POOL_CLIENT_ID'] ?? '',
  };

  if (preenchida(doAmbiente)) {
    atual = doAmbiente;
    return atual;
  }

  const r = await fetch('/config.json', { cache: 'no-store' });
  if (!r.ok) {
    throw new Error(`Não foi possível carregar a configuração (HTTP ${r.status}).`);
  }

  const lido = (await r.json()) as Partial<Configuracao>;
  const config: Configuracao = {
    apiUrl: lido.apiUrl ?? '',
    userPoolId: lido.userPoolId ?? '',
    userPoolClientId: lido.userPoolClientId ?? '',
  };

  if (!preenchida(config)) {
    throw new Error('A configuração carregada está incompleta.');
  }

  atual = config;
  return atual;
}

/** Só para os testes, que montam componentes sem passar pelo `main.tsx`. */
export function definirConfiguracaoParaTeste(c: Configuracao): void {
  atual = c;
}
