import {
  DynamoFonteBoletimRepository,
  DynamoTemplateRepository,
  SecretsProvider,
  dynamoDoc,
  secrets,
} from '@emailmkt/adapters-aws';
import {
  TENANT_PADRAO,
  coletarNoticias,
  templateId as novoTemplateId,
  userId as novoUserId,
  type BuscadorDePagina,
  type ExtratorPorIa,
  type ResultadoColeta,
  type Template,
} from '@emailmkt/core';
import { compileDesignToMjml, criarBoletimColetado } from '@emailmkt/criador';
import { paginaParaTexto } from '@emailmkt/email-render';
import mjml2html from 'mjml';

/**
 * Monta o boletim automaticamente — §11, item 12.
 *
 * Pipeline: fontes cadastradas → texto de cada página → extrator de IA →
 * design do boletim (as MESMAS fábricas do painel, via @emailmkt/criador) →
 * MJML → HTML → **modelo novo** na categoria Boletim.
 *
 * Termina no modelo, deliberadamente: o disparo continua humano. O operador
 * abre o assistente, escolhe o tipo Boletim, e o modelo gerado aparece
 * recomendado — revisão editorial antes de qualquer envio, que é a regra do
 * sistema para tudo (§10.3). Automatizar o envio seria automatizar a parte
 * que o escritório mais precisa controlar.
 */

function env(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const log = {
  info: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ nivel: 'INFO', worker: 'boletim-builder', mensagem, ...dados })),
  error: (mensagem: string, dados: Record<string, unknown> = {}) =>
    console.error(
      JSON.stringify({ nivel: 'ERROR', worker: 'boletim-builder', mensagem, ...dados }),
    ),
};

/** Marca de segredo não configurado — o CDK cria o cofre; a chave é colada depois. */
const CHAVE_PENDENTE = 'configure-me';

/**
 * Busca a página com identidade e limites explícitos.
 *
 * O User-Agent se identifica de verdade: coletar notícia para um boletim
 * citando a fonte é uso legítimo, e sites bloqueiam agentes anônimos antes de
 * bloquearem agentes honestos. O timeout evita que uma fonte lenta consuma o
 * tempo da Lambda inteira.
 */
const buscador: BuscadorDePagina = {
  async buscarTexto(url: string): Promise<string> {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'BoletimAAA/1.0 (boletim informativo; contato@andrearaujoadvogados.com.br)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return paginaParaTexto(await r.text());
  },
};

/**
 * Gemini via REST — o único trecho que conhece o provedor.
 *
 * O nível gratuito do AI Studio cobre um boletim semanal com folga (o limite
 * diário é ordens de grandeza acima de meia dúzia de fontes). Trocar de
 * provedor é reescrever esta função e nada mais: o prompt e a interpretação
 * da resposta são regra de domínio e moram no core.
 */
function criarExtrator(chave: string, modelo: string): ExtratorPorIa {
  return {
    async completar(prompt: string): Promise<string> {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          }),
        },
      );

      if (!r.ok) {
        // 429 é o limite do nível gratuito — a mensagem diz isso em vez de
        // deixar um "HTTP 429" críptico no aviso da fonte.
        if (r.status === 429)
          throw new Error('limite do nível gratuito atingido; tente mais tarde');
        throw new Error(`Gemini HTTP ${r.status}`);
      }

      const corpo = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const texto = corpo.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
      if (texto === undefined || texto === '') throw new Error('resposta vazia do modelo');
      return texto;
    },
  };
}

export interface ResultadoBoletim {
  readonly gerado: boolean;
  readonly templateId?: string;
  readonly totalNoticias: number;
  readonly avisos: readonly string[];
}

export const handler = async (evento: { origem?: string } = {}): Promise<ResultadoBoletim> => {
  const doc = dynamoDoc();
  const tabela = env('TABELA_PRINCIPAL');
  const fontes = new DynamoFonteBoletimRepository(doc, tabela);
  const templates = new DynamoTemplateRepository(doc, tabela);

  const chave = await new SecretsProvider(secrets()).ler(env('SEGREDO_GEMINI_ARN'));
  if (chave === '' || chave === CHAVE_PENDENTE) {
    const aviso =
      'A chave do Gemini ainda não foi configurada. Crie uma em aistudio.google.com e grave no ' +
      'segredo do Secrets Manager indicado em docs/RUNBOOK.md.';
    log.error('chave do Gemini não configurada');
    return { gerado: false, totalNoticias: 0, avisos: [aviso] };
  }

  const extrator = criarExtrator(chave, process.env['MODELO_GEMINI'] ?? 'gemini-2.0-flash');

  const coleta = await coletarNoticias({ fontes, paginas: buscador, extrator }, TENANT_PADRAO);

  for (const aviso of coleta.avisos) log.info('aviso da coleta', { aviso });

  if (coleta.totalNoticias === 0) {
    log.info('nada coletado — nenhum modelo gerado', {
      origem: evento.origem ?? 'agendado',
      avisos: coleta.avisos.length,
    });
    return { gerado: false, totalNoticias: 0, avisos: coleta.avisos };
  }

  const agora = new Date();
  const design = criarBoletimColetado({
    titulo: 'Destaques da semana',
    periodo: `${dataCurta(new Date(agora.getTime() - 7 * 86_400_000))} a ${dataCurta(agora)} · Edição automática`,
    introducao: '',
    noticias: coleta.porFonte.flatMap((f) =>
      f.noticias.map((n) => ({
        titulo: n.titulo,
        resumo: n.resumo,
        url: n.url,
        // Sem tag da IA, o chapéu é o nome da fonte — nunca fica vazio.
        tag: n.tag === '' ? f.fonte.nome : n.tag,
      })),
    ),
    fontes: coleta.porFonte.map((f) => f.fonte.nome),
  });

  /**
   * mjml (Node) e mjml-browser são o MESMO compilador na mesma major (5.x):
   * o modelo gerado aqui abre no criador do painel idêntico ao que o operador
   * teria montado à mão — e continua editável, porque a estrutura visual vai
   * junto na versão.
   */
  const compilado = await mjml2html(compileDesignToMjml(design), { validationLevel: 'soft' });

  const template: Template = {
    tenantId: TENANT_PADRAO,
    templateId: novoTemplateId(crypto.randomUUID()),
    nome: `Boletim automático — ${dataCurta(agora)}`,
    tipo: 'VISUAL',
    categoria: 'Boletim',
    versaoAtual: 1,
    arquivado: false,
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
    atualizadoEm: agora,
  };

  await templates.salvarComVersao(template, {
    versao: 1,
    assunto: 'Boletim Tributário — os destaques da semana',
    corpoHtml: compilado.html,
    estruturaVisual: JSON.stringify(design),
    criadoPor: novoUserId('boletim-builder'),
    criadoEm: agora,
  });

  log.info('boletim gerado', {
    templateId: String(template.templateId),
    noticias: coleta.totalNoticias,
    fontes: coleta.porFonte.length,
    avisos: coleta.avisos.length,
    origem: evento.origem ?? 'agendado',
  });

  return {
    gerado: true,
    templateId: String(template.templateId),
    totalNoticias: coleta.totalNoticias,
    avisos: coleta.avisos,
  };
};

const dataCurta = (d: Date): string =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export type { ResultadoColeta };
