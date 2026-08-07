/**
 * Apoio ao upload de CSV — a parte que acontece fora da API.
 *
 * O arquivo vai do navegador direto para o S3, com URL presignada. Estas funções
 * são o que a API não pode fazer por nós: calcular o digest do arquivo antes de
 * pedir a assinatura, e enviar o corpo sem o cabeçalho `authorization` — que, no
 * S3, colide com a autenticação embutida na própria URL.
 */

/** SHA-256 em base64, o formato que o S3 espera em `x-amz-checksum-sha256`. */
export async function sha256Base64(arquivo: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * Envia o arquivo para a URL presignada.
 *
 * Sem `authorization`: a URL já carrega a assinatura, e mandar o token do
 * Cognito junto faz o S3 responder `InvalidArgument` — erro cujo texto não dá
 * nenhuma pista do motivo real.
 */
export async function enviarParaS3(
  url: string,
  arquivo: Blob,
  cabecalhos: Record<string, string>,
): Promise<void> {
  const r = await fetch(url, { method: 'PUT', body: arquivo, headers: cabecalhos });

  if (!r.ok) {
    // O S3 responde XML. Não vale a pena interpretá-lo: o que o operador precisa
    // saber é que o arquivo não subiu e que pode tentar de novo.
    throw new Error(`O S3 recusou o arquivo (HTTP ${r.status}). Tente enviar novamente.`);
  }
}

/**
 * Lê os nomes das colunas da primeira linha.
 *
 * Só o cabeçalho: o arquivo inteiro pode ter centenas de milhares de linhas, e
 * ler tudo em memória para mostrar um `select` seria desperdício. Quem processa
 * o CSV de verdade é o worker.
 *
 * O separador é detectado entre vírgula e ponto-e-vírgula — o Excel em português
 * exporta com ponto-e-vírgula, e é dele que vem a maioria dos arquivos aqui.
 */
export async function lerColunas(arquivo: Blob): Promise<string[]> {
  const inicio = await arquivo.slice(0, 64 * 1024).text();
  const primeiraLinha = inicio.split(/\r?\n/)[0] ?? '';

  // O BOM do Excel gruda um caractere invisível no nome da primeira coluna, e
  // o mapeamento deixa de bater sem que nada na tela pareça errado.
  const limpa = primeiraLinha.replace(/^\uFEFF/, '');
  const separador = (limpa.match(/;/g)?.length ?? 0) > (limpa.match(/,/g)?.length ?? 0) ? ';' : ',';

  return limpa
    .split(separador)
    .map((c) => c.trim().replace(/^"|"$/g, ''))
    .filter((c) => c !== '');
}
