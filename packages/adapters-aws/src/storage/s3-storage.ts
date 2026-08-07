import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Acesso ao S3 para importação de CSV e exportação LGPD.
 *
 * O upload é feito pelo navegador direto no S3 com URL presignada, não pela API.
 * Dois motivos: o API Gateway tem teto de 10 MB por requisição, e passar um CSV
 * de milhares de contatos por dentro de uma Lambda é gastar memória e tempo de
 * execução para nada.
 */
export class S3Storage {
  constructor(
    private readonly cliente: S3Client,
    private readonly bucket: string,
  ) {}

  /**
   * URL de upload com validade curta.
   *
   * 15 minutos: tempo de sobra para enviar um CSV, curto o bastante para que uma
   * URL vazada em log ou histórico não seja útil por muito tempo.
   *
   * O `checksumSha256` é o digest do arquivo, em base64, calculado por quem vai
   * enviá-lo. Ele entra na assinatura, então o S3 recusa qualquer corpo que não
   * seja exatamente aquele arquivo — a URL serve para um upload e só para ele.
   *
   * Precisa ser o valor real, e não `ChecksumAlgorithm: 'SHA256'`. Este segundo
   * parece equivalente e não é: sem corpo no momento de assinar, o SDK grava na
   * URL o digest da string vazia, e aí a única coisa que o S3 aceita é um
   * arquivo vazio.
   */
  async urlUpload(
    chave: string,
    contentType: string,
    checksumSha256: string,
    validadeSegundos = 900,
  ): Promise<string> {
    return getSignedUrl(
      this.cliente,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        ContentType: contentType,
        ChecksumSHA256: checksumSha256,
      }),
      { expiresIn: validadeSegundos },
    );
  }

  /**
   * URL de download do export de portabilidade (art. 18).
   *
   * Validade ainda menor: este arquivo contém os dados pessoais do titular
   * reunidos num só lugar, que é exatamente o que não deve ficar acessível por
   * link permanente.
   */
  async urlDownload(chave: string, validadeSegundos = 300): Promise<string> {
    return getSignedUrl(this.cliente, new GetObjectCommand({ Bucket: this.bucket, Key: chave }), {
      expiresIn: validadeSegundos,
    });
  }

  async gravar(chave: string, conteudo: string, contentType: string): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: conteudo,
        ContentType: contentType,
      }),
    );
  }
}
