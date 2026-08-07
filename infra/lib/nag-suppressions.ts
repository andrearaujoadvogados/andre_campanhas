import { NagSuppressions } from 'cdk-nag';
import type { Stack } from 'aws-cdk-lib';

/**
 * Supressões do cdk-nag — §9.2, §10.1.
 *
 * Toda supressão aqui é uma decisão de segurança registrada, não um jeito de
 * calar o linter. A regra de convivência é simples: se você não consegue
 * escrever a evidência em uma frase que se sustente numa auditoria, então não é
 * caso de supressão — é caso de corrigir o recurso.
 *
 * As supressões são declaradas no nível da stack e restritas por `appliesTo`
 * sempre que possível. Fixá-las por caminho de construto seria mais preciso, mas
 * quebra silenciosamente a cada renomeação — e uma supressão que deixou de valer
 * sem ninguém perceber é pior que uma supressão um pouco mais ampla e visível.
 *
 * Revisar esta lista quando a arquitetura mudar: o que se justifica no MVP pode
 * não se justificar na V2.
 */

const RUNTIME_FIXADO = {
  id: 'AwsSolutions-L1',
  reason:
    'Runtime fixado em NODEJS_22_X deliberadamente (§4.1). Atualizar runtime é decisão ' +
    'versionada no repositório e testada no pipeline, não algo que deva variar por deploy.',
};

const POLITICA_EXECUCAO_LAMBDA = {
  id: 'AwsSolutions-IAM4',
  reason:
    'AWSLambdaBasicExecutionRole é a política gerenciada mínima para escrever log. ' +
    'Substituí-la por política inline equivalente não reduz privilégio real.',
};

export function aplicarSupressoes(core: Stack, sending: Stack, web: Stack): void {
  // ── Núcleo — sa-east-1 ─────────────────────────────────────────────────────

  NagSuppressions.addStackSuppressions(
    core,
    [
      POLITICA_EXECUCAO_LAMBDA,
      RUNTIME_FIXADO,
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Três origens, todas verificadas: (1) grants do CDK sobre a tabela principal, que ' +
          'precisam de curinga nos índices secundários — `tabela/index/*` não é ampliação de ' +
          'privilégio, é a mesma tabela; (2) grants sobre o bucket de uploads, restritos ao ' +
          'bucket do ambiente e, no caso de exports, ao prefixo; (3) `Resource::*` em ' +
          'ses:GetAccount e nas ações do X-Ray, que não aceitam ARN específico por definição ' +
          'da API. Nenhuma política concede acesso a recurso fora desta stack.',
      },
      {
        id: 'AwsSolutions-DDB3',
        reason:
          'Aplicável apenas à tabela de idempotência, que contém somente chaves de ' +
          'deduplicação com TTL curto — nenhum dado pessoal e nenhum estado recuperável. ' +
          'Perder essas chaves só reabre uma janela de reprocessamento que já é idempotente. ' +
          'A tabela principal tem point-in-time recovery habilitado.',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Rotação automática está DESLIGADA de propósito, e a razão é de domínio: a chave ' +
          'HMAC assina os links de descadastro que já saíram nos e-mails entregues. Rotacionar ' +
          'sem mais nada invalidaria o link de descadastro de toda mensagem na caixa dos ' +
          'destinatários — quebrando um direito legal do titular para satisfazer uma boa ' +
          'prática. Ligar rotação exige antes suportar verificação com chave anterior ' +
          '(janela de duas chaves). Registrado como item de V2.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'O tier Plus do Cognito adiciona custo por usuário ativo. Com MFA obrigatório para ' +
          'todos os usuários e menos de 20 contas criadas manualmente por administrador ' +
          '(sem auto-cadastro), o vetor que o tier Plus cobre é pequeno. Decisão de custo a ' +
          'revisar com o cliente — é barato nesta escala.',
      },
      {
        id: 'AwsSolutions-S1',
        reason:
          'O bucket de uploads guarda CSV de contatos — dado pessoal — e por isso o acesso ' +
          'merece trilha. Ela existe por outra via: apenas duas Lambdas nomeadas têm permissão, ' +
          'toda leitura passa pela aplicação (que registra auditoria própria, §11 item 10) e o ' +
          'CloudTrail cobre as operações de gerenciamento. Habilitar eventos de dados do ' +
          'CloudTrail neste bucket é o próximo passo natural e está registrado como item de V2.',
      },
    ],
    true,
  );

  // ── Envio — us-east-2 ──────────────────────────────────────────────────────

  NagSuppressions.addStackSuppressions(
    sending,
    [
      POLITICA_EXECUCAO_LAMBDA,
      RUNTIME_FIXADO,
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'A ponte de eventos escreve numa única fila nomeada em sa-east-1, declarada por ARN ' +
          'explícito. Os curingas remanescentes vêm dos grants do CDK sobre a fila de entrada ' +
          'desta mesma região.',
      },
    ],
    true,
  );

  // ── Painel — us-east-1 ─────────────────────────────────────────────────────

  NagSuppressions.addStackSuppressions(
    web,
    [
      {
        id: 'AwsSolutions-CFR1',
        reason:
          'Restrição geográfica não se aplica: o painel é usado pela equipe do escritório e da ' +
          'agência, que viajam. O controle de acesso real é o Cognito, não a origem do IP.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'WAF descartado explicitamente no §7 do documento de arquitetura: US$ 6-10/mês para ' +
          'proteger um painel com menos de 20 usuários conhecidos e autenticados. A revisar se ' +
          'o sistema virar multi-cliente (V3).',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason:
          'O log de acesso do CloudFront registraria apenas requisições a arquivos estáticos ' +
          'do painel — JavaScript, CSS e imagens, sem dado pessoal. A trilha de auditoria que ' +
          'importa é a da aplicação (§11, item 10) e a do API Gateway, ambas ativas.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'Enquanto o domínio customizado está desabilitado, a distribuição usa o certificado ' +
          'padrão do CloudFront, que fixa a política mínima em TLSv1 independentemente do que ' +
          'se configure. Ao habilitar o domínio próprio (§9.1.2) passa a valer o TLS 1.2 de ' +
          '2021, já declarado no construto.',
      },
      {
        id: 'AwsSolutions-S1',
        reason:
          'Bucket de site estático servido exclusivamente via CloudFront com OAC, sem acesso ' +
          'direto. Log de acesso ao S3 duplicaria o do CloudFront sem ganho.',
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'A política do bucket exige SSL (enforceSSL); o acesso público está bloqueado.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'Papel gerenciado do custom resource de limpeza do bucket, criado pelo próprio CDK ' +
          'e ativo apenas em ambiente de desenvolvimento.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Custom resource de limpeza do bucket, gerado pelo CDK e restrito ao bucket do site ' +
          'deste ambiente.',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Runtime do custom resource de limpeza é definido pelo CDK, não por nós.',
      },
    ],
    true,
  );
}
