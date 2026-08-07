import {
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
  input: { tenantId: TenantId; listId: ListId; segmento: Specification<Contact> },
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

function rotuloMotivo(m: MotivoInelegibilidade): string {
  switch (m.motivo) {
    case 'STATUS':
      return `STATUS_${m.status}`;
    case 'RELACIONAMENTO_DESCONHECIDO':
      return 'RELACIONAMENTO_DESCONHECIDO';
    case 'SEM_BASE_LEGAL':
      return 'SEM_BASE_LEGAL';
    case 'VINCULO_EXPIRADO':
      return 'VINCULO_EXPIRADO';
  }
}
