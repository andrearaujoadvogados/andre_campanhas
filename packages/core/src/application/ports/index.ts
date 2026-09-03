import type { Contact } from '../../domain/contact/contact.js';
import type { Campaign } from '../../domain/campaign/campaign.js';
import type {
  CampoDaSerie,
  CampoMetrica,
  Envio,
  EventoEnvio,
  PontoDaSerie,
} from '../../domain/send/envio.js';
import type { Template, VersaoTemplate } from '../../domain/template/template.js';
import type { Lista } from '../../domain/list/lista.js';
import type { TipoEmail } from '../../domain/tipo-email/tipo-email.js';
import type { FonteBoletim } from '../../domain/boletim/fonte-boletim.js';
import type { ExecucaoBoletim } from '../../domain/boletim/execucao-boletim.js';
import type { RotinaBoletim } from '../../domain/boletim/rotina-boletim.js';
import type { SuppressionEntry } from '../../domain/suppression/suppression.js';
import type { EmailAddress } from '../../domain/shared/email-address.js';
import type {
  CampaignId,
  ContactId,
  ExecucaoBoletimId,
  FonteId,
  ListId,
  RotinaId,
  SendId,
  TemplateId,
  TenantId,
  TipoEmailId,
  UserId,
} from '../../domain/shared/ids.js';

/**
 * Ports — §5.1. O domínio declara do que precisa; `packages/adapters-aws`
 * implementa. Nenhum tipo aqui menciona DynamoDB, SES ou HTTP: se mencionasse,
 * a fronteira não existiria de fato.
 */

// ── Infraestrutura básica ────────────────────────────────────────────────────

/** Tempo como dependência: sem isto, testar "vínculo expirado" exige esperar. */
export interface Clock {
  agora(): Date;
}

export interface IdGenerator {
  gerar(): string;
}

/** Hash do e-mail para a lista de supressão — salgado, fora do domínio. */
export interface EmailHasher {
  hash(email: EmailAddress): string;
}

/** Hash do conteúdo aprovado da campanha — §5.8. */
export interface ContentHasher {
  hash(conteudo: unknown): string;
}

/**
 * Deriva o `sendId` a partir do par campanha+contato.
 *
 * O domínio já **declara** que o sendId é determinístico (ver `Envio`), mas
 * quem calcula é o adaptador — é sha256, e criptografia não entra no núcleo.
 * Existe como port porque o registro de resposta precisa fazer o caminho de
 * volta: sabendo a campanha (vem do endereço de resposta) e o contato (vem do
 * remetente), o envio é encontrado por GetItem direto, sem índice novo.
 */
export interface SendIdDeriver {
  derivar(campaignId: CampaignId, contactId: ContactId): SendId;
}

/** Token assinado do link de descadastro — HMAC, segredo no Secrets Manager. */
export interface UnsubscribeTokenService {
  emitir(input: { tenantId: TenantId; contactId: ContactId; campaignId: CampaignId }): string;
  verificar(
    token: string,
  ): { tenantId: TenantId; contactId: ContactId; campaignId: CampaignId } | null;
}

// ── Repositórios ─────────────────────────────────────────────────────────────

export interface Pagina<T> {
  readonly itens: readonly T[];
  readonly cursor?: string;
}

export interface ContactRepository {
  buscarPorId(tenantId: TenantId, id: ContactId): Promise<Contact | null>;
  buscarPorEmail(tenantId: TenantId, email: EmailAddress): Promise<Contact | null>;
  salvar(contato: Contact): Promise<void>;
  salvarEmLote(contatos: readonly Contact[]): Promise<void>;
  listarPorLista(tenantId: TenantId, listId: ListId, cursor?: string): Promise<Pagina<Contact>>;
  excluir(tenantId: TenantId, id: ContactId): Promise<void>;
}

export interface CampaignRepository {
  buscarPorId(tenantId: TenantId, id: CampaignId): Promise<Campaign | null>;
  salvar(campanha: Campaign): Promise<void>;
  /** Leitura barata do status — o `sender` consulta uma vez por lote (ADR-05). */
  lerStatus(tenantId: TenantId, id: CampaignId): Promise<Campaign['status'] | null>;
  listar(tenantId: TenantId, filtro: FiltroCampanhas): Promise<ListagemCampanhas>;
  /**
   * Só rascunho chega aqui.
   *
   * A regra vive na rota, e não neste port, porque depende do status — e um
   * repositório que decidисse isso viraria um segundo lugar onde a política de
   * exclusão mora.
   */
  excluir(tenantId: TenantId, id: CampaignId): Promise<void>;
}

export interface FiltroCampanhas {
  /** Sem status, varre todos — ver `ListagemCampanhas.truncado`. */
  readonly status?: Campaign['status'] | undefined;
  readonly limite: number;
  readonly cursor?: string | undefined;
}

export interface ListagemCampanhas {
  readonly itens: readonly Campaign[];
  /** Só existe quando há filtro por status — ver abaixo. */
  readonly cursor?: string | undefined;
  /**
   * Sinaliza que a listagem sem filtro foi cortada.
   *
   * No GSI3 as campanhas são particionadas **por status** (§6.3, padrão 7), o
   * que torna "o que está enviando agora" uma consulta barata e constante. O
   * preço é que "todas as campanhas" precisa varrer uma partição por status e
   * mesclar — e paginar através de oito partições ordenadas exigiria um cursor
   * composto que erraria a ordem nas bordas.
   *
   * Em vez de fingir uma paginação que perderia campanhas em silêncio, a
   * listagem sem filtro devolve as mais recentes e **avisa** que cortou. Quem
   * precisa de tudo filtra por status, e aí a paginação é real.
   */
  readonly truncado: boolean;
}

export interface SuppressionRepository {
  estaSuprimido(tenantId: TenantId, emailHash: string): Promise<boolean>;
  /** Consulta em lote — o launcher filtra milhares de contatos de uma vez. */
  filtrarSuprimidos(
    tenantId: TenantId,
    emailHashes: readonly string[],
  ): Promise<ReadonlySet<string>>;
  suprimir(entrada: SuppressionEntry): Promise<void>;
  remover(tenantId: TenantId, emailHash: string): Promise<void>;
}

// ── Envio ────────────────────────────────────────────────────────────────────

export interface MensagemEmail {
  readonly para: EmailAddress;
  readonly deNome: string;
  readonly deEmail: string;
  readonly replyTo?: string;
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly corpoTexto: string;
  /** Cabeçalhos RFC 8058 — descadastro em um clique. Obrigatório (§1.3). */
  readonly listUnsubscribeUrl: string;
  readonly configurationSet: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface ResultadoEnvio {
  readonly providerMessageId: string;
}

export type FalhaEnvio =
  | { readonly tipo: 'THROTTLED'; readonly tentarNovamenteEmMs: number }
  | { readonly tipo: 'REJEITADO_PERMANENTE'; readonly detalhe: string }
  | { readonly tipo: 'CONTA_SUSPENSA'; readonly detalhe: string }
  | { readonly tipo: 'ERRO_TRANSITORIO'; readonly detalhe: string };

/**
 * Strategy — §5.3. Única implementação hoje é o SES, mas a interface permite o
 * `FakeEmailProvider` em dev (impossível disparar para contato real por engano)
 * e um provedor em lote se o volume crescer (ADR-07).
 */
export interface EmailProvider {
  enviar(
    mensagem: MensagemEmail,
  ): Promise<
    | { readonly ok: true; readonly value: ResultadoEnvio }
    | { readonly ok: false; readonly error: FalhaEnvio }
  >;
}

// ── Fila e idempotência ──────────────────────────────────────────────────────

export interface SendQueuePublisher {
  publicarLote(
    mensagens: readonly {
      readonly sendId: SendId;
      readonly campaignId: CampaignId;
      readonly contactId: ContactId;
    }[],
  ): Promise<void>;
  /**
   * Adia a reentrega de uma mensagem em processamento — o mecanismo de pausa do
   * ADR-05.
   *
   * `referenciaEntrega` é um identificador **opaco** que o consumidor recebe
   * junto com a mensagem e devolve sem interpretar. No SQS é o receiptHandle;
   * em outro backend seria outra coisa. O domínio não precisa saber qual — e
   * modelar isso como `sendId` seria mentira, porque o sendId não identifica a
   * *entrega* que está sendo adiada.
   */
  adiarEntrega(referenciaEntrega: string, atrasoSegundos: number): Promise<void>;
}

/**
 * Consumidor idempotente — §5.4. Retorna `false` se a chave já foi vista, e é
 * essa resposta que impede e-mail duplicado quando o SQS reentrega a mensagem.
 */
export interface IdempotencyStore {
  registrarSeNovo(chave: string, ttlSegundos: number): Promise<boolean>;
  /**
   * Libera a marca para que a operação possa ser retentada.
   *
   * Existe por um motivo específico e não deve ser usado fora dele: quando o
   * SES devolve throttling, a mensagem volta para a fila e **precisa** ser
   * processada de novo. Sem liberar, a marca gravada antes da tentativa faria a
   * reentrega ser descartada como duplicata — e o destinatário nunca receberia.
   *
   * Só chame quando tiver certeza de que nenhum efeito externo aconteceu.
   */
  liberar(chave: string): Promise<void>;
}

// ── Configuração e auditoria ─────────────────────────────────────────────────

export interface QuotaConfig {
  /** Lido do SSM, sincronizado diariamente do SES — §1.3, §5.6. */
  readonly maxEnviosPorSegundo: number;
  readonly cotaDiaria: number;
}

export interface ConfigProvider {
  lerQuota(): Promise<QuotaConfig>;
}

export interface EventoAuditoria {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly acao:
    | 'CRIOU'
    | 'EDITOU'
    | 'APROVOU'
    | 'ENVIOU'
    | 'PAUSOU'
    | 'CANCELOU'
    | 'EXCLUIU'
    | 'IMPORTOU'
    | 'EXPORTOU';
  readonly recursoTipo: string;
  readonly recursoId: string;
  readonly antes?: unknown;
  readonly depois?: unknown;
  readonly ipOrigem?: string;
  readonly ocorridoEm: Date;
}

export interface AuditLogger {
  registrar(evento: EventoAuditoria): Promise<void>;
}

// ── Caminho de envio ─────────────────────────────────────────────────────────

export interface SendRepository {
  buscarPorId(tenantId: TenantId, campaignId: CampaignId, sendId: SendId): Promise<Envio | null>;
  buscarPorMessageId(sesMessageId: string): Promise<Envio | null>;
  salvar(envio: Envio): Promise<void>;
  /**
   * Quantos registros de envio existem para a campanha.
   *
   * É como o orquestrador sabe que o disparo terminou. Conta registros, não
   * mensagens na fila: a fila é assíncrona e sua profundidade oscila, enquanto
   * o registro de envio é o fato consumado.
   */
  contarPorCampanha(tenantId: TenantId, campaignId: CampaignId): Promise<number>;
  /**
   * Página de registros de envio de uma campanha — insumo do relatório por
   * destinatário (§10). Consulta a partição da campanha (`SEND#`), então é uma
   * Query paginada, não um Scan.
   */
  listarPorCampanha(
    tenantId: TenantId,
    campaignId: CampaignId,
    cursor?: string,
  ): Promise<Pagina<Envio>>;
  /**
   * Todos os envios feitos a um contato — o insumo do dossiê de portabilidade.
   *
   * Consulta por contato, não por campanha: a pergunta do titular é "quais
   * e-mails vocês me mandaram", e responder isso varrendo campanha por campanha
   * não escalaria nem seria confiável.
   */
  listarPorContato(tenantId: TenantId, contactId: ContactId): Promise<readonly Envio[]>;
  /**
   * Só os envios que receberam resposta — a lista de "quem respondeu" do
   * relatório de campanha.
   *
   * Mesma partição de `listarPorCampanha`, com filtro no servidor. O filtro do
   * DynamoDB é aplicado **depois** da leitura, então não economiza capacidade —
   * economiza tráfego e, principalmente, evita que a interface pagine milhares
   * de envios para achar as poucas dezenas que interessam. Como resposta é rara
   * por natureza, uma página pode voltar vazia com cursor: quem chama precisa
   * seguir o cursor até ele sumir, não parar na primeira página vazia.
   */
  listarRespondentes(
    tenantId: TenantId,
    campaignId: CampaignId,
    cursor?: string,
  ): Promise<Pagina<Envio>>;
}

/**
 * Eventos de envio persistidos — §6.1 e §10.2.
 *
 * Separado das métricas de propósito: o contador agregado responde "quantos
 * abriram"; o evento individual responde "quando *este* titular abriu", que é o
 * que a portabilidade e o direito de acesso exigem. Um não substitui o outro.
 */
export interface EventRepository {
  salvar(evento: EventoEnvio, sendId: SendId, ttlEpochSegundos: number): Promise<void>;
  listarPorEnvio(tenantId: TenantId, sendId: SendId): Promise<readonly EventoEnvio[]>;
}

/**
 * Agendamento e disparo de campanha — ADR-05.
 *
 * O domínio não conhece EventBridge nem Step Functions: declara que precisa
 * marcar, desmarcar e disparar, e o adaptador resolve como.
 */
export interface CampaignScheduler {
  /** Marca o disparo para uma data futura. Substitui um agendamento anterior. */
  agendar(tenantId: TenantId, campaignId: CampaignId, quando: Date): Promise<void>;
  cancelarAgendamento(tenantId: TenantId, campaignId: CampaignId): Promise<void>;
  /**
   * Dispara agora.
   *
   * Idempotente por janela: dois cliques seguidos no mesmo minuto não iniciam
   * dois disparos.
   */
  dispararAgora(tenantId: TenantId, campaignId: CampaignId, agora: Date): Promise<string>;
}

export interface MetricsRepository {
  /** Incremento atômico. Chamado uma vez por evento, sempre atrás da guarda de idempotência. */
  incrementar(
    tenantId: TenantId,
    campaignId: CampaignId,
    campo: CampoMetrica,
    quantidade?: number,
  ): Promise<void>;
  ler(tenantId: TenantId, campaignId: CampaignId): Promise<Readonly<Record<string, number>>>;
  /**
   * Incremento do ponto diário da série de engajamento — o insumo do gráfico.
   *
   * Mora no mesmo repositório dos contadores porque É o mesmo modelo de
   * leitura: agregado gravado no processamento do evento, atrás da mesma
   * guarda de idempotência, lido pela tela sem varrer eventos.
   */
  incrementarSerie(
    tenantId: TenantId,
    campaignId: CampaignId,
    campo: CampoDaSerie,
    dia: string,
  ): Promise<void>;
  /** Série completa da campanha, em ordem de dia. Vazia se nada foi agregado. */
  lerSerie(tenantId: TenantId, campaignId: CampaignId): Promise<readonly PontoDaSerie[]>;
}

/**
 * Cota de 24h — §5.6.
 *
 * Separada do token bucket de propósito: o bucket controla o *ritmo* dentro de
 * uma invocação; esta contagem é global e precisa sobreviver a Lambdas
 * diferentes, então mora no banco com incremento condicional.
 */
export interface DailyQuotaCounter {
  /** Devolve `false` se o envio estouraria a cota do dia — sem consumir nada. */
  reservar(tenantId: TenantId, diaUtc: string, limite: number): Promise<boolean>;
}

/**
 * Circuit breaker para falhas de conta — §5.5.
 *
 * Existe para um cenário específico: se o SES suspender a conta ou a credencial
 * quebrar, tentar as 5.000 mensagens da fila só serve para lotar a DLQ. O
 * circuito aberto faz o worker parar e o alarme disparar.
 */
export interface CircuitBreaker {
  estaAberto(chave: string): Promise<boolean>;
  abrir(chave: string, duracaoSegundos: number, motivo: string): Promise<void>;
}

export interface ContextoRenderizacao {
  readonly contato: {
    readonly nome?: string;
    readonly email: string;
    readonly camposCustomizados: Readonly<Record<string, string>>;
  };
  readonly urlDescadastro: string;
}

export interface EmailRenderizado {
  readonly assunto: string;
  readonly corpoHtml: string;
  readonly corpoTexto: string;
}

export interface EmailRenderer {
  renderizar(
    template: { readonly assunto: string; readonly corpoHtml: string },
    contexto: ContextoRenderizacao,
  ): Promise<EmailRenderizado>;
}

export interface TemplateCarregado {
  readonly assunto: string;
  readonly corpoHtml: string;
  /** JSON dos blocos, quando o template é VISUAL — o editor recarrega a partir daqui. */
  readonly estruturaVisual?: string;
}

export interface TemplateRepository {
  buscarVersao(
    tenantId: TenantId,
    templateId: TemplateId,
    versao: number,
  ): Promise<TemplateCarregado | null>;
  buscarMeta(tenantId: TenantId, templateId: TemplateId): Promise<Template | null>;
  listar(tenantId: TenantId, cursor?: string): Promise<Pagina<Template>>;
  /**
   * Grava metadados e versão numa única operação.
   *
   * Juntos de propósito: se a versão fosse gravada sem o `versaoAtual`
   * correspondente, o template apontaria para uma versão que não existe — e o
   * `sender` falharia no meio de um disparo, não na hora de salvar.
   */
  salvarComVersao(template: Template, versao: VersaoTemplate): Promise<void>;
  salvarMeta(template: Template): Promise<void>;
}

export interface TipoEmailRepository {
  buscarPorId(tenantId: TenantId, tipoEmailId: TipoEmailId): Promise<TipoEmail | null>;
  listar(tenantId: TenantId): Promise<readonly TipoEmail[]>;
  salvar(tipo: TipoEmail): Promise<void>;
  excluir(tenantId: TenantId, tipoEmailId: TipoEmailId): Promise<void>;
}

// ── Boletim automatizado — §11, item 12 ──────────────────────────────────────

export interface FonteBoletimRepository {
  buscarPorId(tenantId: TenantId, fonteId: FonteId): Promise<FonteBoletim | null>;
  listar(tenantId: TenantId): Promise<readonly FonteBoletim[]>;
  salvar(fonte: FonteBoletim): Promise<void>;
  excluir(tenantId: TenantId, fonteId: FonteId): Promise<void>;
}

/**
 * Execuções da geração do boletim — o histórico que a tela consulta.
 *
 * `listarRecentes` vem da mais nova para a mais antiga: a pergunta que a tela
 * faz a cada poucos segundos é "o que está acontecendo agora", e a resposta é
 * sempre o primeiro item.
 */
export interface ExecucaoBoletimRepository {
  salvar(execucao: ExecucaoBoletim): Promise<void>;
  buscarPorId(tenantId: TenantId, execucaoId: ExecucaoBoletimId): Promise<ExecucaoBoletim | null>;
  listarRecentes(tenantId: TenantId, limite: number): Promise<readonly ExecucaoBoletim[]>;
}

export interface RotinaBoletimRepository {
  buscarPorId(tenantId: TenantId, rotinaId: RotinaId): Promise<RotinaBoletim | null>;
  listar(tenantId: TenantId): Promise<readonly RotinaBoletim[]>;
  salvar(rotina: RotinaBoletim): Promise<void>;
  excluir(tenantId: TenantId, rotinaId: RotinaId): Promise<void>;
}

/**
 * Agenda recorrente da rotina de envio na infraestrutura.
 *
 * `sincronizar` é deliberadamente idempotente e absoluto: recebe a rotina e
 * deixa a agenda no estado que ela pede — cria, atualiza ou (se inativa)
 * remove. A alternativa (criar/atualizar/remover como operações distintas)
 * empurraria para cada rota o raciocínio de qual chamada fazer, e uma rota que
 * errasse deixaria uma agenda fantasma disparando envio de verdade.
 */
export interface RotinaBoletimScheduler {
  sincronizar(rotina: RotinaBoletim): Promise<void>;
  remover(tenantId: TenantId, rotinaId: RotinaId): Promise<void>;
}

/** Busca uma página e devolve o TEXTO dela — sem tags, sem script, já podado. */
export interface OpcoesBuscaDePagina {
  /** Traz também as laterais da página ("mais lidas", destaques) — a retrospectiva precisa delas. */
  readonly completo?: boolean;
}

export interface BuscadorDePagina {
  buscarTexto(url: string, opcoes?: OpcoesBuscaDePagina): Promise<string>;
}

/**
 * O extrator de IA, reduzido a uma função: prompt entra, texto sai.
 *
 * A interface não menciona Gemini, modelo nem chave — o prompt e a
 * interpretação da resposta são regra de negócio e moram no domínio; o
 * adaptador só carrega a chamada HTTP. Trocar de provedor de IA é trocar esta
 * implementação, e nada mais.
 */
export interface ExtratorPorIa {
  completar(prompt: string): Promise<string>;
}

export interface ListRepository {
  buscarPorId(tenantId: TenantId, listId: ListId): Promise<Lista | null>;
  listar(tenantId: TenantId, cursor?: string): Promise<Pagina<Lista>>;
  salvar(lista: Lista): Promise<void>;
  adicionarContatos(
    tenantId: TenantId,
    listId: ListId,
    contactIds: readonly ContactId[],
  ): Promise<number>;
  removerContato(tenantId: TenantId, listId: ListId, contactId: ContactId): Promise<void>;
  excluir(tenantId: TenantId, listId: ListId): Promise<void>;
}

/**
 * Contas de acesso ao painel.
 *
 * Não há domínio aqui — nenhuma regra de negócio do escritório decide quem pode
 * entrar no sistema, só quem administra. Mesmo assim o port existe, e pela razão
 * de sempre: o dia em que o Cognito for trocado, ou em que houver um segundo
 * cliente com diretório próprio, o que muda é o adaptador.
 *
 * Senha nenhuma trafega por aqui. Quem cria um usuário informa o e-mail; o
 * provedor gera a senha provisória e a envia direto para a pessoa. Um método que
 * aceitasse senha seria um método que a coloca em log, em rastro de erro e no
 * corpo de uma requisição HTTP.
 */
export interface UsuarioDoPainel {
  /**
   * O identificador das operações administrativas — o `Username` do Cognito.
   *
   * **Não é o mesmo que `sub`.** Conta criada pelo console ganha username UUID;
   * conta criada com o e-mail como username guarda o e-mail. As duas convivem no
   * mesmo pool, e usar um no lugar do outro falha só para metade dos usuários —
   * que é o tipo de bug que passa em teste e aparece em produção.
   */
  readonly id: string;
  /** A identidade que aparece na claim `sub` do token. É por ela que se compara. */
  readonly sub: string;
  readonly email: string;
  readonly papeis: readonly ('ADMIN' | 'OPERADOR')[];
  readonly habilitado: boolean;
  /** `true` enquanto a pessoa não concluiu o primeiro acesso. */
  readonly aguardandoPrimeiroAcesso: boolean;
  readonly criadoEm: Date;
}

export interface GestaoUsuarios {
  listar(): Promise<readonly UsuarioDoPainel[]>;
  criar(email: string, papel: 'ADMIN' | 'OPERADOR'): Promise<UsuarioDoPainel>;
  definirPapel(id: string, papel: 'ADMIN' | 'OPERADOR'): Promise<void>;
  /** Reenvia o convite quando a senha provisória expira — 7 dias, por padrão. */
  reenviarConvite(id: string): Promise<void>;
  /**
   * Desabilita em vez de excluir.
   *
   * O `criadoPor` e o `aprovadoPor` das campanhas guardam o id do usuário. Se a
   * conta desaparecesse, o registro de quem aprovou o quê ficaria apontando para
   * o nada — e é justamente esse registro que dá sentido à aprovação.
   */
  desabilitar(id: string): Promise<void>;
  reabilitar(id: string): Promise<void>;
}
