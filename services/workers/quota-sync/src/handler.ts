import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Sincroniza a cota real do SES com o Parameter Store — §1.3 e §5.6.
 *
 * É o que faz a liberação do acesso a produção valer **sem deploy**. Hoje a
 * conta está em sandbox (1 msg/s, 200/dia); quando a AWS aprovar, este cron
 * percebe em até 24h e o `sender` passa a usar o valor novo sozinho.
 *
 * Cota fixada em variável de ambiente exigiria republicar as Lambdas num dia em
 * que ninguém vai lembrar disso.
 */

const log = (nivel: 'INFO' | 'ERROR', mensagem: string, dados: Record<string, unknown> = {}) => {
  const linha = JSON.stringify({ nivel, worker: 'quota-sync', mensagem, ...dados });
  if (nivel === 'ERROR') console.error(linha);
  else console.warn(linha);
};

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

export interface SaidaQuotaSync {
  readonly maxEnviosPorSegundo: number;
  readonly cotaDiaria: number;
  readonly emProducao: boolean;
  readonly alterado: boolean;
}

export const handler = async (): Promise<SaidaQuotaSync> => {
  const ses = new SESv2Client({ region: env('REGIAO_ENVIO'), maxAttempts: 5 });
  const ssm = new SSMClient({ maxAttempts: 5 });

  const conta = await ses.send(new GetAccountCommand({}));

  const taxa = conta.SendQuota?.MaxSendRate;
  const diaria = conta.SendQuota?.Max24HourSend;

  if (taxa === undefined || diaria === undefined) {
    // Sem cota conhecida, não sobrescrevemos o que está lá. Gravar um valor
    // otimista faria o `sender` disparar acima do limite e arriscar a reputação
    // da conta (§14).
    throw new Error('SES não devolveu SendQuota. Parâmetros mantidos como estavam.');
  }

  /**
   * `Max24HourSend: -1` significa cota ilimitada — acontece em contas de
   * produção sem limite diário. Tratar o -1 literalmente faria toda reserva de
   * cota falhar e o envio parar completamente.
   */
  const cotaDiaria = diaria < 0 ? Number.MAX_SAFE_INTEGER : Math.floor(diaria);
  const emProducao = conta.ProductionAccessEnabled === true;

  // Sem `||`: o curto-circuito faria a cota diária nunca ser gravada quando a
  // taxa mudasse. Os dois parâmetros são independentes e ambos precisam ser
  // avaliados sempre.
  const taxaAlterada = await gravarSeMudou(ssm, env('PARAM_TAXA'), String(taxa));
  const cotaAlterada = await gravarSeMudou(ssm, env('PARAM_COTA'), String(cotaDiaria));
  const alterado = taxaAlterada || cotaAlterada;

  log('INFO', 'cota sincronizada', {
    maxEnviosPorSegundo: taxa,
    cotaDiaria,
    emProducao,
    alterado,
  });

  if (emProducao && alterado) {
    // Vale destacar no log: é o marco que o runbook manda conferir depois de a
    // AWS aprovar o acesso a produção.
    log('INFO', 'ACESSO A PRODUÇÃO ATIVO — cota atualizada sem deploy', {
      maxEnviosPorSegundo: taxa,
      cotaDiaria,
    });
  }

  return { maxEnviosPorSegundo: taxa, cotaDiaria, emProducao, alterado };
};

/**
 * Grava só quando o valor mudou.
 *
 * Cada `PutParameter` cria uma versão nova no histórico do SSM. Reescrever o
 * mesmo número todo dia encheria o histórico de ruído e esconderia a única
 * mudança que importa: o dia em que a produção foi liberada.
 */
async function gravarSeMudou(ssm: SSMClient, nome: string, valor: string): Promise<boolean> {
  const atual = await ssm
    .send(new GetParameterCommand({ Name: nome }))
    .then((r) => r.Parameter?.Value)
    .catch(() => undefined); // Parâmetro ainda não existe — segue e cria.

  if (atual === valor) return false;

  await ssm.send(
    new PutParameterCommand({ Name: nome, Value: valor, Type: 'String', Overwrite: true }),
  );
  return true;
}
