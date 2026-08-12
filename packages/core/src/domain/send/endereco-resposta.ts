import type { CampaignId } from '../shared/ids.js';

/**
 * O endereço de resposta das campanhas — §1.4.
 *
 * **Por que existe.** O SES não emite evento de resposta: os destinos de evento
 * do Configuration Set cobrem só o que acontece com a mensagem que sai. Para
 * saber que alguém respondeu é preciso *receber* o e-mail de volta, e para saber
 * a **qual** envio ele responde é preciso carregar essa informação em algum
 * lugar que sobreviva à viagem de ida e volta.
 *
 * **Por que no endereço, e não só no cabeçalho.** O caminho óbvio seria
 * correlacionar por `In-Reply-To`, que carrega o Message-ID original. Funciona
 * na maioria dos clientes — mas não em todos, e quem encaminha a mensagem para
 * um colega antes de responder perde o cabeçalho pelo caminho. O `To:` da
 * resposta, ao contrário, é literalmente o `Reply-To:` que nós escrevemos: ele
 * sobrevive a encaminhamento, a cliente exótico e a resposta escrita do zero.
 * Os dois caminhos convivem — o endereço é o primeiro, o cabeçalho é a rede.
 *
 * **Por que só a campanha, e não o envio.** A parte local de um endereço tem 64
 * caracteres (RFC 5321). `campanha.envio` passaria disso — o sendId sozinho já
 * são 43. Mas o sendId é `hash(campanha, contato)`, determinístico: sabendo a
 * campanha (daqui) e o contato (do remetente da resposta), ele se **recalcula**.
 * O endereço carrega o mínimo e o resto se deduz.
 */

const PREFIXO = 'resposta';

/** `resposta+<campaignId>@respostas.mail.exemplo.com.br` */
export function enderecoDeResposta(campaignId: CampaignId, dominio: string): string {
  return `${PREFIXO}+${String(campaignId)}@${dominio}`;
}

/**
 * Extrai a campanha de um endereço de resposta, ou `null` se não for um.
 *
 * Aceita a lista inteira de destinatários porque a resposta pode ter ido para
 * várias pessoas em cópia: o endereço que interessa é o nosso, e ele pode não
 * ser o primeiro.
 */
export function campanhaDoEnderecoDeResposta(enderecos: readonly string[]): string | null {
  for (const bruto of enderecos) {
    const endereco = extrairEndereco(bruto);
    const arroba = endereco.lastIndexOf('@');
    if (arroba <= 0) continue;

    const local = endereco.slice(0, arroba);
    const mais = local.indexOf('+');
    if (mais < 0) continue;
    // Comparação sem caixa: a parte local é sensível a maiúsculas pela RFC, mas
    // nenhum servidor real trata assim, e um cliente que normalizar o endereço
    // não pode fazer a correlação sumir.
    if (local.slice(0, mais).toLowerCase() !== PREFIXO) continue;

    const marca = local.slice(mais + 1);
    if (marca !== '') return marca;
  }
  return null;
}

/**
 * Extrai o `messageId` do SES de um cabeçalho `In-Reply-To`/`References`.
 *
 * O SES monta o Message-ID como `<id@região.amazonses.com>`, e é esse `id` que
 * o GSI4 indexa. `References` acumula a thread inteira, então a busca é pelo
 * **último** que casa — o mais recente é o e-mail que está sendo respondido.
 */
export function messageIdDoSes(cabecalho: string): string | null {
  const padrao = /<([^<>@\s]+)@[^<>\s]*amazonses\.com>/gi;
  let ultimo: string | null = null;
  for (const achado of cabecalho.matchAll(padrao)) {
    const id = achado[1];
    if (id !== undefined && id !== '') ultimo = id;
  }
  return ultimo;
}

/** `"Fulano" <a@b.com>` → `a@b.com`; um endereço nu passa reto. */
export function extrairEndereco(bruto: string): string {
  const abre = bruto.lastIndexOf('<');
  const fecha = bruto.lastIndexOf('>');
  const endereco = abre >= 0 && fecha > abre ? bruto.slice(abre + 1, fecha) : bruto;
  return endereco.trim().toLowerCase();
}
