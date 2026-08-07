import { Hono } from 'hono';
import {
  confirmarImportacaoSchema,
  solicitarUploadImportacaoSchema,
  type MensagemImportacao,
} from '@emailmkt/contracts';
import type { TenantId } from '@emailmkt/core';
import type { Variaveis } from '../auth.js';
import { exigirPapel } from '../auth.js';
import { obterDependencias } from '../container.js';
import { validarCorpo } from '../validacao.js';

export const rotasImportacoes = new Hono<{ Variables: Variaveis }>();

/** Tempo de sobra para subir um CSV grande, curto para uma URL vazada em log. */
const VALIDADE_UPLOAD_SEGUNDOS = 900;

/**
 * Chave derivada, nunca recebida.
 *
 * O nome original do arquivo entra só no registro de auditoria — não no caminho.
 * Nome de arquivo é entrada do usuário, e entrada do usuário dentro de uma chave
 * de objeto é como se constrói um caminho para fora do prefixo pretendido.
 */
const chaveDoCsv = (tenantId: TenantId, importacaoId: string): string =>
  `imports/${tenantId}/${importacaoId}/origem.csv`;

/**
 * Passo 1 — assina a URL de upload.
 *
 * Restrito a ADMIN, como a exclusão de contato e a exportação de dossiê. Importar
 * não é uma operação de rotina do dia a dia: quem importa declara a origem do
 * lote e, com ela, a base legal de todo mundo que entra (§10.2). É decisão do
 * controlador, não tarefa de operação.
 */
rotasImportacoes.post(
  '/',
  exigirPapel('ADMIN'),
  validarCorpo(solicitarUploadImportacaoSchema),
  async (c) => {
    const dados = c.req.valid('json');
    const { armazenamento, ids } = await obterDependencias();
    const usuario = c.get('usuario');

    const importacaoId = ids.gerar();
    const url = await armazenamento.urlUpload(
      chaveDoCsv(usuario.tenantId, importacaoId),
      'text/csv',
      dados.checksumSha256,
      VALIDADE_UPLOAD_SEGUNDOS,
    );

    return c.json(
      {
        importacaoId,
        nomeArquivo: dados.nomeArquivo,
        url,
        validadeSegundos: VALIDADE_UPLOAD_SEGUNDOS,
        // O digest está dentro da assinatura, mas o S3 também exige o cabeçalho
        // no PUT. Sem ele a resposta é um 400 que não diz qual é o problema.
        cabecalhosObrigatorios: {
          'content-type': 'text/csv',
          'x-amz-checksum-sha256': dados.checksumSha256,
        },
      },
      201,
    );
  },
);

/**
 * Passo 2 — o arquivo chegou; a importação pode começar.
 *
 * Nada é gravado aqui: a rota publica na fila e responde. Processar o CSV dentro
 * da requisição estouraria o tempo da API em qualquer arquivo grande, e uma
 * falha no meio deixaria metade dos contatos gravados sem relatório. Na fila, a
 * mesma falha vai para a DLQ e aparece no alarme.
 */
rotasImportacoes.post(
  '/:id/iniciar',
  exigirPapel('ADMIN'),
  validarCorpo(confirmarImportacaoSchema),
  async (c) => {
    const dados = c.req.valid('json');
    const { filaImportacao, auditoria, clock } = await obterDependencias();
    const usuario = c.get('usuario');
    const agora = clock.agora();

    /**
     * O id aparece na URL e no corpo, e os dois têm que bater.
     *
     * Divergirem significa que o corpo não é o do upload que acabou de ser
     * assinado — sinal de requisição remontada à mão. Recusar é mais barato que
     * decidir qual dos dois vale.
     */
    if (dados.importacaoId !== c.req.param('id')) {
      return c.json(
        {
          code: 'IMPORTACAO_INCONSISTENTE',
          message: 'O identificador da importação não confere com o do endereço.',
        },
        400,
      );
    }

    const mensagem: MensagemImportacao = {
      ...dados,
      chaveS3: chaveDoCsv(usuario.tenantId, dados.importacaoId),
      solicitadoPor: usuario.userId,
    };

    await filaImportacao.publicar(mensagem);

    /**
     * Auditado antes de qualquer contato existir, e de propósito.
     *
     * Este é o registro de quem declarou a origem daquele lote. Se meses depois
     * alguém perguntar de onde vieram 4.000 contatos — e essa é exatamente a
     * pergunta que a ANPD faz — a resposta está aqui, com autor e data.
     */
    await auditoria.registrar({
      tenantId: usuario.tenantId,
      userId: usuario.userId,
      acao: 'IMPORTOU',
      recursoTipo: 'Importacao',
      recursoId: dados.importacaoId,
      depois: {
        nomeArquivo: dados.nomeArquivo,
        origemDeclarada: dados.origemDeclarada,
        relacionamentoPadrao: dados.relacionamentoPadrao,
        mapeamentoColunas: dados.mapeamentoColunas,
      },
      ...(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() === undefined
        ? {}
        : { ipOrigem: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '' }),
      ocorridoEm: agora,
    });

    return c.json(
      {
        importacaoId: dados.importacaoId,
        estado: 'ENFILEIRADA',
        aviso:
          dados.mapeamentoColunas.relacionamento === undefined
            ? `Sem coluna de vínculo, todos os contatos entram como ${dados.relacionamentoPadrao}.`
            : 'Linhas com vínculo em branco ou não reconhecido entram como DESCONHECIDO e não recebem campanha.',
      },
      202,
    );
  },
);
