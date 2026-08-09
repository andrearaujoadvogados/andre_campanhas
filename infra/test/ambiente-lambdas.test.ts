import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { carregarConfig } from '../lib/config.js';
import { CoreStack } from '../lib/stacks/core-stack.js';

/**
 * As variáveis que cada Lambda exige precisam estar no template.
 *
 * Existe porque faltou uma. A `admin-api` lê `SEGREDO_HMAC_ARN` para montar o
 * hasher de e-mail, a variável não estava declarada na stack, e o container
 * falhava ao inicializar. Como ele é construído uma vez e reaproveitado por
 * todas as rotas, **toda** requisição do painel virava 500 — não só as que
 * dependiam de contato.
 *
 * Nada acusava: o `cdk synth` passa, o `tsc` passa, os testes de cada pacote
 * passam. A ligação entre "o código chama `exigirEnv('X')`" e "a stack declara
 * X" não existia em lugar nenhum, e só aparecia em produção, com o painel
 * inteiro fora do ar e a mensagem "Erro inesperado".
 *
 * Este teste faz essa ligação: lê o que cada serviço exige, lê o que a stack
 * declara, e compara.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

/** As variáveis que o código do serviço exige, extraídas do próprio fonte. */
function exigidasPor(servico: string): string[] {
  const dir = join(RAIZ, 'services', servico, 'src');
  const nomes = new Set<string>();

  const varrer = (caminho: string): void => {
    for (const entrada of readdirSync(caminho, { withFileTypes: true })) {
      const alvo = join(caminho, entrada.name);
      if (entrada.isDirectory()) {
        varrer(alvo);
        continue;
      }
      if (!entrada.name.endsWith('.ts')) continue;
      const fonte = readFileSync(alvo, 'utf8');
      for (const m of fonte.matchAll(/exigirEnv\(\s*'([A-Z0-9_]+)'\s*\)/g)) {
        if (m[1] !== undefined) nomes.add(m[1]);
      }
    }
  };

  varrer(dir);
  return [...nomes].sort();
}

interface TemplateJson {
  Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
}

function declaradasNaLambda(template: TemplateJson, nomeLogico: string): string[] {
  const recurso = Object.values(template.Resources).find(
    (r) => r.Type === 'AWS::Lambda::Function' && JSON.stringify(r).includes(nomeLogico),
  );

  if (recurso === undefined) throw new Error(`Lambda não encontrada no template: ${nomeLogico}`);

  const ambiente = recurso.Properties['Environment'] as { Variables?: Record<string, unknown> };
  return Object.keys(ambiente.Variables ?? {}).sort();
}

/**
 * A stack é sintetizada aqui, em memória.
 *
 * Ler o `cdk.out` obrigaria o `synth` a rodar antes — e no `verificar` ele roda
 * **depois** dos testes. O teste passaria lendo um template velho, ou falharia
 * por arquivo ausente, e em nenhum dos dois casos estaria verificando a stack
 * que acabou de ser escrita.
 *
 * Os valores fictícios são os mesmos que o pipeline usa: sintetizar não toca a
 * AWS.
 */
process.env['AWS_ACCOUNT_DEV'] ??= '000000000000';
process.env['EMAIL_ALARMES'] ??= 'teste@exemplo.invalido';

const cfg = carregarConfig('dev');
const template = Template.fromStack(
  new CoreStack(new App(), 'EmailMktCoreDev', {
    cfg,
    env: { account: cfg.conta, region: cfg.regiaoDados },
  }),
).toJSON() as TemplateJson;

describe('variáveis de ambiente das Lambdas', () => {
  // O `nomeLogico` é o que aparece no nome do recurso; o diretório é onde mora
  // o código que declara as exigências.
  const SERVICOS = [
    { servico: 'admin-api', nomeLogico: 'admin-api' },
    { servico: 'public-api', nomeLogico: 'public-api' },
  ];

  for (const { servico, nomeLogico } of SERVICOS) {
    it(`${servico}: a stack declara tudo que o código exige`, () => {
      const exigidas = exigidasPor(servico);
      const declaradas = declaradasNaLambda(template, nomeLogico);

      // Falha com a lista do que falta, não com "esperado A recebido B" — o
      // ponto é dizer qual variável acrescentar na stack.
      const faltando = exigidas.filter((v) => !declaradas.includes(v));
      expect(faltando, `Faltam na stack, exigidas por ${servico}`).toEqual([]);
    });
  }

  it('encontra pelo menos uma exigência, senão o teste não está lendo nada', () => {
    // Sem isto, uma mudança no formato de `exigirEnv` deixaria a extração vazia
    // e os testes acima passariam sem verificar coisa alguma.
    expect(exigidasPor('admin-api').length).toBeGreaterThan(3);
  });
});
