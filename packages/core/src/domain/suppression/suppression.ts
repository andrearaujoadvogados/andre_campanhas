import type { TenantId } from '../shared/ids.js';

/**
 * Lista de supressão — §6.2, nota 2.
 *
 * Guarda o **hash** do e-mail, nunca o endereço em claro. A razão é um conflito
 * real entre dois deveres: quando um titular exerce o direito de exclusão
 * (art. 18), precisamos apagar o contato; mas se apagássemos junto o registro de
 * descadastro, uma reimportação futura do CSV traria a pessoa de volta e ela
 * voltaria a receber e-mail que pediu para não receber.
 *
 * O hash resolve os dois: conseguimos responder "este endereço está suprimido?"
 * sem reter o dado pessoal identificável. É minimização de verdade, não teatro —
 * e precisa constar na política de privacidade.
 */
export type MotivoSupressao =
  | 'HARD_BOUNCE'
  | 'RECLAMACAO'
  | 'DESCADASTRO'
  | 'OPOSICAO'
  | 'MANUAL'
  | 'IMPORTADA_FERRAMENTA_ANTERIOR';

export interface SuppressionEntry {
  readonly tenantId: TenantId;
  /** SHA-256 salgado do e-mail normalizado. Ver port `EmailHasher`. */
  readonly emailHash: string;
  readonly motivo: MotivoSupressao;
  readonly suprimidoEm: Date;
  readonly origem: string;
}

/**
 * Supressão é irreversível por padrão — e essa assimetria é proposital.
 *
 * Hard bounce e reclamação de spam nunca devem ser desfeitos por operador: o
 * primeiro significa que o endereço não existe, o segundo que a pessoa marcou o
 * e-mail como spam. Reenviar em qualquer dos casos ataca a reputação da conta,
 * que é o ativo mais frágil do projeto (§14).
 *
 * Só descadastro e supressão manual admitem reversão, e ainda assim apenas por
 * ação explícita do próprio titular — nunca por decisão do escritório.
 */
export function admiteReinscricaoPeloTitular(motivo: MotivoSupressao): boolean {
  return motivo === 'DESCADASTRO' || motivo === 'MANUAL';
}

export function motivoDeEventoBounce(
  tipoBounce: 'Permanent' | 'Transient',
): MotivoSupressao | null {
  // Soft bounce (Transient) não suprime: caixa cheia ou servidor fora do ar são
  // condições temporárias. Suprimir por isso descartaria contatos válidos.
  return tipoBounce === 'Permanent' ? 'HARD_BOUNCE' : null;
}
