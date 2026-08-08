import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O módulo guarda a configuração em estado interno, então cada teste precisa de
 * uma instância limpa — daí o `resetModules` e o import dinâmico.
 */
async function novo() {
  vi.resetModules();
  return import('../src/lib/configuracao.js');
}

const COMPLETA = {
  apiUrl: 'https://api.exemplo.invalido',
  userPoolId: 'sa-east-1_abc',
  userPoolClientId: 'cliente123',
};

/**
 * Zera as três variáveis, simulando o bundle implantado.
 *
 * Não basta `unstubAllEnvs`: o `.env.local` de quem roda os testes é carregado
 * pelo Vite e apareceria aqui, fazendo os testes passarem ou falharem conforme
 * a máquina.
 */
function semAmbiente(): void {
  vi.stubEnv('VITE_API_URL', '');
  vi.stubEnv('VITE_USER_POOL_ID', '');
  vi.stubEnv('VITE_USER_POOL_CLIENT_ID', '');
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('carregamento da configuração', () => {
  it('usa o .env.local quando ele está completo, sem tocar na rede', async () => {
    vi.stubEnv('VITE_API_URL', COMPLETA.apiUrl);
    vi.stubEnv('VITE_USER_POOL_ID', COMPLETA.userPoolId);
    vi.stubEnv('VITE_USER_POOL_CLIENT_ID', COMPLETA.userPoolClientId);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const { carregarConfiguracao } = await novo();

    expect(await carregarConfiguracao()).toEqual(COMPLETA);
    // Desenvolvimento local não depende de um arquivo que o Vite não serve.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('busca o config.json quando o ambiente está vazio — o caso do painel implantado', async () => {
    semAmbiente();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => COMPLETA }));

    const { carregarConfiguracao } = await novo();

    expect(await carregarConfiguracao()).toEqual(COMPLETA);
  });

  it('recusa configuração incompleta em vez de seguir com campo vazio', async () => {
    semAmbiente();
    // Um campo vazio produziria 401 do Cognito sem pista da causa. Falhar aqui,
    // com mensagem, é o que torna o problema diagnosticável.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ apiUrl: COMPLETA.apiUrl }) }),
    );

    const { carregarConfiguracao } = await novo();

    await expect(carregarConfiguracao()).rejects.toThrow(/incompleta/i);
  });

  it('propaga falha de rede', async () => {
    semAmbiente();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const { carregarConfiguracao } = await novo();

    await expect(carregarConfiguracao()).rejects.toThrow(/404/);
  });

  it('lança se alguém usar a configuração antes de carregá-la', async () => {
    const { configuracao } = await novo();

    expect(() => configuracao()).toThrow(/não carregada/i);
  });
});
