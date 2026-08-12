/**
 * Monta o encaminhamento de uma resposta para a caixa do escritório — §1.4.
 *
 * **Por que encaminhar.** Ligar o rastreamento de respostas troca o `Reply-To:`
 * das campanhas por um endereço nosso. Sem encaminhar, o que o cliente escreve
 * chegaria a uma caixa que ninguém abre — trocaríamos uma métrica por
 * comunicação perdida com cliente, que para um escritório de advocacia é um
 * estrago que nenhum número compensa. O encaminhamento é a condição para o
 * resto do desenho ser aceitável.
 *
 * **Por que não repassar a mensagem original crua.** Seria o mais simples, e
 * está errado: o `From:` continuaria sendo o do cliente, e nós enviaríamos em
 * nome de um domínio que não é nosso. SPF e DMARC do domínio dele reprovariam,
 * e o encaminhamento cairia em spam ou seria recusado — justamente a mensagem
 * que mais precisa chegar. Reescrever só o `From:` resolveria o DMARC e
 * invalidaria a assinatura DKIM original, deixando a mensagem adulterada sem
 * aviso.
 *
 * **O desenho.** Uma mensagem nova, nossa, assinada por nós, com a original
 * **anexada intacta** em `message/rfc822`. Nada é reescrito: o anexo abre no
 * cliente de e-mail como a mensagem que o cliente mandou, com cabeçalhos,
 * assinatura e anexos dele. O `Reply-To:` aponta para quem escreveu, então
 * responder no encaminhamento fala com o cliente, e não conosco.
 */

export interface DadosEncaminhamento {
  /** Identidade verificada que assina o encaminhamento. */
  readonly de: string;
  /** Caixa do escritório que recebe. */
  readonly para: string;
  /** `From:` original, como veio — com nome de exibição, se houver. */
  readonly deOriginal: string;
  readonly assuntoOriginal: string;
  /** A mensagem recebida, byte a byte, como o SES gravou no S3. */
  readonly mensagemOriginal: Uint8Array;
  /** Campanha identificada no endereço de resposta, quando houve. */
  readonly campanha?: string | undefined;
  /**
   * Se a mensagem traz alguma marca que permita correlacionar — o endereço com
   * a campanha ou a referência de thread do SES.
   *
   * Não é "foi correlacionada": quem encaminha roda em us-east-2 e não consulta
   * o banco, que vive em sa-east-1 (ADR-01). Afirmar no aviso que a resposta
   * *entrou* no relatório seria uma promessa que este código não tem como
   * cumprir. Sem marca nenhuma, porém, é certeza de que não entrou — e é isso
   * que o aviso diz.
   */
  readonly identificavel: boolean;
}

export function montarEncaminhamento(dados: DadosEncaminhamento): string {
  /**
   * A fronteira precisa ser impossível de aparecer no conteúdo, e curta.
   *
   * Impossível porque `_` não pertence ao alfabeto do base64, e as duas partes
   * vão codificadas: nenhum corpo pode produzir esta sequência, por mais que a
   * mensagem original contenha. É o que torna a montagem segura sem precisar
   * inspecionar o que chegou.
   *
   * Curta porque ela entra no `Content-Type` do cabeçalho, e a RFC 5322 pede
   * linha de no máximo 78 caracteres. Uma fronteira longa estoura o limite
   * sozinha — e servidor rígido dobra ou recusa a linha.
   */
  const fronteira = '=_resposta_encaminhada_';

  const aviso = [
    'Resposta recebida por uma campanha do sistema de e-mail marketing.',
    '',
    `De: ${dados.deOriginal}`,
    `Assunto: ${dados.assuntoOriginal}`,
    dados.campanha === undefined ? null : `Campanha: ${dados.campanha}`,
    '',
    dados.identificavel
      ? 'A resposta foi encaminhada para registro no relatório da campanha.'
      : 'ATENÇÃO: esta mensagem não traz nenhuma marca da campanha, então NÃO vai ' +
        'aparecer no relatório. A mensagem em si está anexada e íntegra.',
    '',
    'A mensagem original vai em anexo. Responder a este e-mail fala com quem escreveu.',
    '',
  ].filter((l): l is string => l !== null);

  const cabecalhos = [
    `From: ${codificarPalavra('Respostas de campanha')} <${dados.de}>`,
    `To: ${dados.para}`,
    `Reply-To: ${dados.deOriginal}`,
    `Subject: ${codificarPalavra(`Resposta: ${dados.assuntoOriginal}`)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${fronteira}"`,
  ];

  return [
    ...cabecalhos,
    '',
    `--${fronteira}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    emLinhas(Buffer.from(aviso.join('\r\n'), 'utf8').toString('base64')),
    `--${fronteira}`,
    'Content-Type: message/rfc822',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="resposta-original.eml"',
    '',
    emLinhas(Buffer.from(dados.mensagemOriginal).toString('base64')),
    `--${fronteira}--`,
    '',
  ].join('\r\n');
}

/**
 * RFC 2047 — cabeçalho só aceita ASCII.
 *
 * "Resposta: Ação de indenização" com acento cru vira caracteres corrompidos no
 * assunto, ou faz o servidor recusar a mensagem. Base64 do UTF-8 inteiro em vez
 * de escapar caractere a caractere: é mais simples e sempre correto. ASCII puro
 * passa reto, para o assunto continuar legível no log.
 */
function codificarPalavra(texto: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(texto)) return texto;
  return `=?UTF-8?B?${Buffer.from(texto, 'utf8').toString('base64')}?=`;
}

/** RFC 2045 limita a linha a 76 caracteres; servidor rígido recusa acima disso. */
function emLinhas(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join('\r\n');
}
