#!/usr/bin/env node
/**
 * Gera um template CloudFormation autônomo dos papéis OIDC.
 *
 * Por que existe: implantar os papéis de deploy é o primeiro passo da
 * configuração, e o `cdk deploy` exige credenciais na máquina de quem roda. O
 * CloudShell já tem credenciais — mas não tem o repositório. Este script produz
 * um único arquivo JSON que pode ser enviado ao CloudShell e implantado com
 * `aws cloudformation deploy`, sem clonar nada e sem chave na máquina local.
 *
 * A stack não usa assets (é só IAM), então a checagem de bootstrap que o CDK
 * insere em todo template é dispensável aqui — e é justamente ela que impediria
 * o deploy antes do bootstrap. Removê-la é seguro **apenas** porque não há
 * nenhum artefato para publicar.
 *
 * Gerado a partir do cdk.out, não escrito à mão: a fonte da verdade continua
 * sendo `lib/stacks/github-oidc-stack.ts`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const raiz = join(import.meta.dirname, '..');
const ambiente = process.argv[2] ?? 'prod';
const sufixo = ambiente === 'prod' ? 'Prod' : 'Dev';

const entrada = join(raiz, 'cdk.out', `EmailMktGithubOidc${sufixo}.template.json`);
const saida = join(raiz, 'cloudformation', `github-oidc-${ambiente}.json`);

let template;
try {
  template = JSON.parse(readFileSync(entrada, 'utf8'));
} catch {
  console.error(
    `Template não encontrado: ${entrada}\n` +
      `Rode antes:  pnpm --filter @emailmkt/infra exec cdk synth EmailMktGithubOidc${sufixo} -c ambiente=${ambiente}`,
  );
  process.exit(1);
}

// Guarda: se algum dia a stack ganhar um asset, este script deixa de ser
// seguro — e falhar aqui é melhor que gerar um template que não implanta.
const texto = JSON.stringify(template);
if (texto.includes('AssetParameters') || texto.includes('S3Bucket')) {
  console.error(
    'A stack passou a depender de assets. O template autônomo não é mais possível —\n' +
      'implante com `cdk deploy` depois do bootstrap.',
  );
  process.exit(1);
}

delete template.Parameters?.BootstrapVersion;
delete template.Rules;
delete template.Resources?.CDKMetadata;
if (Object.keys(template.Parameters ?? {}).length === 0) delete template.Parameters;

template.Description =
  'Papeis de deploy assumidos pelo GitHub Actions via OIDC. ' +
  'Gerado de infra/lib/stacks/github-oidc-stack.ts — nao editar a mao.';

mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, JSON.stringify(template, null, 2) + '\n');

const recursos = Object.entries(template.Resources).map(([, r]) => r.Type);
console.log(`Gerado: ${saida}`);
console.log(`Recursos: ${recursos.join(', ')}`);
