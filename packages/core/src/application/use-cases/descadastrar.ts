import { aplicarDescadastro, aplicarOposicao } from '../../domain/contact/contact.js';
import { type Result, type DomainError, ok, err, domainError } from '../../domain/shared/result.js';
import type {
  AuditLogger,
  Clock,
  ContactRepository,
  EmailHasher,
  SuppressionRepository,
  UnsubscribeTokenService,
} from '../ports/index.js';
import { userId } from '../../domain/shared/ids.js';

export type TipoSaida = 'DESCADASTRO' | 'OPOSICAO';

export interface ResultadoDescadastro {
  readonly jaEstavaFora: boolean;
  readonly tipo: TipoSaida;
}

/**
 * Descadastro sem login — requisito legal, §11 item 7.
 *
 * Três propriedades que o desenho garante e que não são negociáveis:
 *
 * 1. **Sem autenticação.** Exigir login para sair de uma lista é barreira
 *    ilegal e, na prática, empurra a pessoa a marcar como spam — que custa
 *    reputação da conta inteira.
 * 2. **Idempotente.** O cliente de e-mail do Gmail dispara o POST de
 *    `List-Unsubscribe` automaticamente e pode repetir. Descadastrar duas vezes
 *    tem de ser sucesso silencioso, nunca erro exibido ao titular.
 * 3. **Não vaza existência de contato.** Token inválido e contato inexistente
 *    devolvem a mesma resposta ao chamador; caso contrário o endpoint público
 *    vira oráculo para descobrir quem está na base do escritório.
 */
export async function descadastrar(
  deps: {
    contatos: ContactRepository;
    supressao: SuppressionRepository;
    tokens: UnsubscribeTokenService;
    hasher: EmailHasher;
    clock: Clock;
    auditoria: AuditLogger;
  },
  input: { token: string; tipo?: TipoSaida; ipOrigem?: string },
): Promise<Result<ResultadoDescadastro, DomainError>> {
  const tipo: TipoSaida = input.tipo ?? 'DESCADASTRO';
  const payload = deps.tokens.verificar(input.token);
  if (payload === null) {
    return err(domainError('TOKEN_INVALIDO', 'Link de descadastro inválido ou expirado.'));
  }

  const agora = deps.clock.agora();
  const contato = await deps.contatos.buscarPorId(payload.tenantId, payload.contactId);

  if (contato === null) {
    // Contato já excluído por direito de exclusão. Do ponto de vista do titular
    // o objetivo está atingido — ele não recebe mais. Responder sucesso.
    return ok({ jaEstavaFora: true, tipo });
  }

  const jaEstavaFora = contato.status === 'DESCADASTRADO' || contato.status === 'OPOSICAO';

  const atualizado =
    tipo === 'OPOSICAO' ? aplicarOposicao(contato, agora) : aplicarDescadastro(contato, agora);

  await deps.contatos.salvar(atualizado);

  // A supressão é o que realmente impede o reenvio: sobrevive a uma
  // reimportação do CSV, que o status do contato sozinho não faria (§6.2).
  await deps.supressao.suprimir({
    tenantId: payload.tenantId,
    emailHash: deps.hasher.hash(contato.email),
    motivo: tipo === 'OPOSICAO' ? 'OPOSICAO' : 'DESCADASTRO',
    suprimidoEm: agora,
    origem: `link:${payload.campaignId}`,
  });

  await deps.auditoria.registrar({
    tenantId: payload.tenantId,
    userId: userId('titular:auto'),
    acao: 'EDITOU',
    recursoTipo: 'Contact',
    recursoId: payload.contactId,
    antes: { status: contato.status },
    depois: { status: atualizado.status },
    ...(input.ipOrigem === undefined ? {} : { ipOrigem: input.ipOrigem }),
    ocorridoEm: agora,
  });

  return ok({ jaEstavaFora, tipo });
}
