import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CampaignId,
  ContactId,
  ContentHasher,
  EmailAddress,
  EmailHasher,
  SendId,
  SendIdDeriver,
  TenantId,
  UnsubscribeTokenService,
} from '@emailmkt/core';
import { campaignId, contactId, sendId as novoSendId, tenantId } from '@emailmkt/core';

/**
 * Hash de e-mail para a lista de supressão — §6.2, nota 2.
 *
 * O sal é obrigatório e vem do Secrets Manager. Sem ele, SHA-256 de um e-mail é
 * reversível na prática: o espaço de endereços plausíveis é pequeno o bastante
 * para um dicionário. Um hash não salgado numa lista de supressão seria dado
 * pessoal disfarçado — o que anula a razão de usar hash.
 */
export class Sha256EmailHasher implements EmailHasher {
  constructor(private readonly sal: string) {
    if (sal.length < 32) {
      throw new Error('Sal do hash de e-mail muito curto: mínimo de 32 caracteres.');
    }
  }

  hash(email: EmailAddress): string {
    return createHash('sha256').update(`${this.sal}:${email.value}`, 'utf8').digest('base64url');
  }
}

/**
 * Hash do conteúdo aprovado da campanha — §5.8.
 *
 * Precisa ser estável: dois objetos com as mesmas chaves em ordem diferente têm
 * de produzir o mesmo hash, senão a aprovação seria invalidada por uma
 * reordenação irrelevante de campos. Daí a serialização canônica.
 */
export class CanonicalContentHasher implements ContentHasher {
  hash(conteudo: unknown): string {
    return createHash('sha256').update(canonicalizar(conteudo), 'utf8').digest('base64url');
  }
}

function canonicalizar(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonicalizar).join(',')}]`;

  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizar(v)}`).join(',')}}`;
}

/**
 * Token de descadastro — §11, item 7.
 *
 * Formato: `<payload em base64url>.<assinatura HMAC-SHA256>`.
 *
 * Decisões que importam:
 *
 * - **Sem expiração.** Um link de descadastro precisa funcionar para sempre: o
 *   e-mail pode ficar anos na caixa da pessoa, e ela tem direito de sair quando
 *   quiser. Token de descadastro que expira é barreira ilegal disfarçada de
 *   segurança.
 * - **Sem dado pessoal no payload.** Só identificadores opacos. O token viaja
 *   numa URL, que vai para log de servidor, histórico de navegador e referer.
 * - **Comparação em tempo constante.** Comparar assinatura com `===` vaza,
 *   byte a byte, o quanto o palpite está perto — é o caminho clássico para
 *   forjar token por tentativa e erro.
 */
export class HmacUnsubscribeTokenService implements UnsubscribeTokenService {
  constructor(private readonly segredo: string) {
    if (segredo.length < 32) {
      throw new Error('Segredo HMAC muito curto: mínimo de 32 caracteres.');
    }
  }

  emitir(input: { tenantId: TenantId; contactId: ContactId; campaignId: CampaignId }): string {
    const payload = Buffer.from(
      JSON.stringify({ t: input.tenantId, c: input.contactId, k: input.campaignId }),
      'utf8',
    ).toString('base64url');

    return `${payload}.${this.assinar(payload)}`;
  }

  verificar(
    token: string,
  ): { tenantId: TenantId; contactId: ContactId; campaignId: CampaignId } | null {
    const separador = token.lastIndexOf('.');
    if (separador <= 0) return null;

    const payload = token.slice(0, separador);
    const assinatura = token.slice(separador + 1);

    if (!this.conferirAssinatura(payload, assinatura)) return null;

    try {
      const dados: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof dados !== 'object' || dados === null) return null;

      const { t, c, k } = dados as Record<string, unknown>;
      if (typeof t !== 'string' || typeof c !== 'string' || typeof k !== 'string') return null;

      return { tenantId: tenantId(t), contactId: contactId(c), campaignId: campaignId(k) };
    } catch {
      return null;
    }
  }

  private assinar(payload: string): string {
    return createHmac('sha256', this.segredo).update(payload, 'utf8').digest('base64url');
  }

  private conferirAssinatura(payload: string, recebida: string): boolean {
    const esperada = Buffer.from(this.assinar(payload), 'utf8');
    const informada = Buffer.from(recebida, 'utf8');
    // timingSafeEqual exige mesmo comprimento; comparar antes já vaza o tamanho,
    // que aqui é constante e público — o risco real está no conteúdo.
    if (esperada.length !== informada.length) return false;
    return timingSafeEqual(esperada, informada);
  }
}

/**
 * sendId determinístico — a guarda de idempotência do envio (§5.4).
 *
 * O prefixo de comprimento não é firula. Concatenar com um separador simples
 * torna `("a", "b:c")` indistinguível de `("a:b", "c")`: dois pares diferentes
 * gerariam o mesmo sendId, e o segundo envio seria descartado como duplicata de
 * um envio que nunca aconteceu. Com o comprimento à frente, a decomposição é
 * única.
 */
export function calcularSendId(campanha: CampaignId, contato: ContactId): string {
  const material = `${String(campanha).length}:${campanha}:${String(contato).length}:${contato}`;
  return createHash('sha256').update(material, 'utf8').digest('base64url');
}

/**
 * O mesmo cálculo, como port — o registro de resposta faz o caminho de volta.
 *
 * O `campaign-launcher` chama `calcularSendId` direto porque é um serviço e já
 * conhece os adaptadores. O caso de uso de resposta vive no núcleo, que não pode
 * importar `node:crypto`; recebe esta classe injetada.
 */
export class Sha256SendIdDeriver implements SendIdDeriver {
  derivar(campaignId: CampaignId, contactId: ContactId): SendId {
    return novoSendId(calcularSendId(campaignId, contactId));
  }
}
