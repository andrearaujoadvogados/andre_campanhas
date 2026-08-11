// Domínio
export * from './domain/shared/result.js';
export * from './domain/shared/ids.js';
export { EmailAddress } from './domain/shared/email-address.js';
export * from './domain/contact/contact.js';
export * from './domain/campaign/campaign.js';
export * from './domain/campaign/progresso.js';
export * from './domain/suppression/suppression.js';
export * from './domain/segment/specification.js';
export * from './domain/send/envio.js';
export * from './domain/send/rate-limiter.js';
export * from './domain/template/template.js';
export * from './domain/list/lista.js';
export * from './domain/tipo-email/tipo-email.js';
export * from './domain/report/metricas.js';

// Aplicação
export * from './application/ports/index.js';
export * from './application/use-cases/resolver-audiencia.js';
export * from './application/use-cases/descadastrar.js';
export * from './application/use-cases/enviar-mensagem.js';
export * from './application/use-cases/processar-evento.js';
export * from './application/use-cases/exportar-dados-titular.js';
