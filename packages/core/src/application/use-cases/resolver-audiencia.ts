import {
  contatoTemAlgumaTag,
  ehLead,
  verificarElegibilidade,
  type Contact,
  type MotivoInelegibilidade,
} from '../../domain/contact/contact.js';
import type { Specification } from '../../domain/segment/specification.js';
import type { ListId, TenantId } from '../../domain/shared/ids.js';
import type {
  Clock,
  ContactRepository,
  EmailHasher,
  SuppressionRepository,
} from '../ports/index.js';

export interface ResumoExclusao {
  readonly total: number;
  readonly porMotivo: Readonly<Record<string, number>>;
}

export interface AudienciaResolvida {
  readonly elegiveis: readonly Contact[];
  readonly excluidos: ResumoExclusao;
}

/**
 * Aplica a seleção individual da Etapa 3 sobre os elegíveis já resolvidos.
 *
 * **Ausente e vazio não são a mesma coisa**, e é aqui que essa distinção vive.
 * Ausente significa "o operador não mexeu na seleção" — vai para todos os
 * elegíveis. Vazio significa "o operador desmarcou todo mundo" — não vai para
 * ninguém.
 *
 * Confundir os dois fazia o disparo sair para a lista inteira justamente quando
 * a tela dizia "0 destinatários selecionados". O chamador deve tratar o vazio
 * como estado inválido antes de chegar aqui; esta função apenas se recusa a
 * inventar uma audiência que ninguém pediu.
 */
export function aplicarSelecaoIndividual(
  elegiveis: readonly Contact[],
  selecionados: readonly string[] | undefined,
): readonly Contact[] {
  if (selecionados === undefined) return elegiveis;
  // Set, e não `includes`: a lista chega com milhares de ids e o filtro roda uma
  // vez por contato elegível.
  const escolhidos = new Set(selecionados);
  return elegiveis.filter((c) => escolhidos.has(String(c.contactId)));
}

/**
 * Resolve a audiência de uma campanha — o snapshot imutável de §6.2, nota 4.
 *
 * A ordem dos filtros importa e é deliberada:
 *   1. segmento — quem o operador quis atingir;
 *   2. elegibilidade — status, relacionamento, base legal, validade do vínculo;
 *   3. supressão — a última palavra, consultada em lote.
 *
 * A supressão fica por último de propósito: é a checagem mais cara (ida ao
 * repositório) e a que menos contatos remove depois dos filtros anteriores.
 *
 * O resumo de exclusões não é enfeite. Sem ele, o operador vê "1.200 de 5.000
 * destinatários" e não sabe se a lista está saudável ou se 3.800 contatos estão
 * travados por falta de classificação de relacionamento — que é a situação mais
 * provável na primeira importação (§14).
 */
export async function resolverAudiencia(
  deps: {
    contatos: ContactRepository;
    supressao: SuppressionRepository;
    hasher: EmailHasher;
    clock: Clock;
  },
  input: {
    tenantId: TenantId;
    listId: ListId;
    segmento: Specification<Contact>;
    /** Padrão falso: leads só entram quando a campanha marca "incluir leads". */
    incluirLeads?: boolean;
    /** Filtro por tag (lógica OU). Vazio ou ausente = não filtra por tag. */
    tagsFiltro?: readonly string[];
  },
): Promise<AudienciaResolvida> {
  const agora = deps.clock.agora();
  const contadores: Record<string, number> = {};
  const contar = (chave: string): void => {
    contadores[chave] = (contadores[chave] ?? 0) + 1;
  };

  const candidatos: Contact[] = [];
  let cursor: string | undefined;

  do {
    const pagina = await deps.contatos.listarPorLista(input.tenantId, input.listId, cursor);

    for (const contato of pagina.itens) {
      if (!input.segmento.isSatisfiedBy(contato)) {
        contar('FORA_DO_SEGMENTO');
        continue;
      }
      // Leads não recebem campanha, salvo opt-in explícito da campanha (§5).
      if (ehLead(contato) && input.incluirLeads !== true) {
        contar('LEAD');
        continue;
      }
      // Filtro por tag — lógica OU. Vazio não filtra.
      if (!contatoTemAlgumaTag(contato, input.tagsFiltro ?? [])) {
        contar('FORA_DO_FILTRO_DE_TAGS');
        continue;
      }
      const elegibilidade = verificarElegibilidade(contato, agora);
      if (!elegibilidade.elegivel) {
        for (const m of elegibilidade.motivos) contar(rotuloMotivo(m));
        continue;
      }
      candidatos.push(contato);
    }
    cursor = pagina.cursor;
  } while (cursor !== undefined);

  // Deduplicação por e-mail normalizado. O mesmo endereço pode entrar duas vezes
  // por importações distintas; enviar duplicado é dano de reputação e de imagem.
  const vistos = new Set<string>();
  const unicos: Contact[] = [];
  for (const c of candidatos) {
    if (vistos.has(c.email.value)) {
      contar('DUPLICADO_NA_LISTA');
      continue;
    }
    vistos.add(c.email.value);
    unicos.push(c);
  }

  const hashes = unicos.map((c) => deps.hasher.hash(c.email));
  const suprimidos = await deps.supressao.filtrarSuprimidos(input.tenantId, hashes);

  const elegiveis: Contact[] = [];
  unicos.forEach((contato, i) => {
    const hash = hashes[i];
    if (hash !== undefined && suprimidos.has(hash)) {
      contar('SUPRIMIDO');
      return;
    }
    elegiveis.push(contato);
  });

  const total = Object.values(contadores).reduce((a, b) => a + b, 0);
  return { elegiveis, excluidos: { total, porMotivo: contadores } };
}

/** Agrupa os excluídos por motivo, para o relatório de audiência da campanha. */
function rotuloMotivo(m: MotivoInelegibilidade): string {
  return `STATUS_${m.status}`;
}
