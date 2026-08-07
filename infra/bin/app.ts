import { App, Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { carregarConfig, type Ambiente } from '../lib/config.js';
import { CoreStack } from '../lib/stacks/core-stack.js';
import { SendingStack } from '../lib/stacks/sending-stack.js';
import { WebStack } from '../lib/stacks/web-stack.js';
import { aplicarSupressoes } from '../lib/nag-suppressions.js';

const app = new App();

const ambiente = (app.node.tryGetContext('ambiente') ?? 'dev') as Ambiente;
if (ambiente !== 'dev' && ambiente !== 'prod') {
  throw new Error(`Ambiente inválido: "${ambiente}". Use dev ou prod.`);
}

const cfg = carregarConfig(ambiente);
const habilitarDominioCustomizado = app.node.tryGetContext('dominioCustomizado') === 'true';
const sufixo = ambiente === 'prod' ? 'Prod' : 'Dev';

/**
 * Três stacks, três regiões — ADR-01 e §9.1.2.
 *
 * `crossRegionReferences` permite que a stack de envio leia atributos da stack
 * de dados. É a única costura entre as regiões, e ela existe num ponto só: a
 * fila para onde a ponte de eventos entrega.
 */
const core = new CoreStack(app, `EmailMktCore${sufixo}`, {
  cfg,
  env: { account: cfg.conta, region: cfg.regiaoDados },
  crossRegionReferences: true,
  description: `Dados e regras de negócio — ${ambiente} (sa-east-1)`,
});

const sending = new SendingStack(app, `EmailMktSending${sufixo}`, {
  cfg,
  env: { account: cfg.conta, region: cfg.regiaoEnvio },
  crossRegionReferences: true,
  filaEventosDestinoArn: core.filaEventos.queueArn,
  filaEventosDestinoUrl: core.filaEventos.queueUrl,
  description: `SES e ingestão de eventos — ${ambiente} (us-east-2)`,
});
sending.addStackDependency(core);

const web = new WebStack(app, `EmailMktWeb${sufixo}`, {
  cfg,
  env: { account: cfg.conta, region: cfg.regiaoCertificado },
  habilitarDominioCustomizado,
  description: `Painel administrativo — ${ambiente} (CloudFront + ACM em us-east-1)`,
});

// Tags em tudo: rastreabilidade de custo por ambiente e por dono do recurso.
Tags.of(app).add('projeto', 'emailmkt');
Tags.of(app).add('ambiente', ambiente);
Tags.of(app).add('cliente', 'andrearaujoadvogados');
Tags.of(app).add('gerenciadoPor', 'cdk');

// cdk-nag no synth: regra de segurança que só roda no CI é regra que se descobre
// tarde. Aqui ela falha na máquina de quem escreveu (§9.2).
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
aplicarSupressoes(core, sending, web);
