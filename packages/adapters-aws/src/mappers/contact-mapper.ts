import { EmailAddress, contactId, tenantId, type Contact } from '@emailmkt/core';
import { chaveContato, gsi1Email, gsi3StatusContato } from '../keys.js';

/**
 * Tradução entre o domínio e a forma armazenada.
 *
 * O domínio usa `EmailAddress` e `Date`; o DynamoDB guarda string. Sem um mapper
 * explícito essa conversão vaza para os repositórios e, mais cedo ou mais tarde,
 * alguém compara uma data que na verdade é string e o filtro para de funcionar
 * em silêncio.
 */

export interface ItemContato extends Record<string, unknown> {
  pk: string;
  sk: string;
  tipo: 'CONTACT';
  tenantId: string;
  contactId: string;
  email: string;
  emailHash: string;
  nome?: string | undefined;
  telefone?: string | undefined;
  empresa?: string | undefined;
  tags?: string[] | undefined;
  isLead?: boolean | undefined;
  camposCustomizados: Record<string, string>;
  status: string;
  relacionamento: string;
  relacionamentoDesde?: string | undefined;
  baseLegal?:
    | {
        base: string;
        liaVersao: string;
        finalidade: string;
        evidenciaRelacionamento: string;
        origemDeclarada: string;
        registradoEm: string;
      }
    | undefined;
  criadoEm: string;
  atualizadoEm: string;
  origem: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi3pk: string;
  gsi3sk: string;
}

export function contatoParaItem(contato: Contact, emailHash: string): ItemContato {
  const chave = chaveContato(contato.tenantId, contato.contactId);
  const g1 = gsi1Email(contato.tenantId, emailHash);
  const g3 = gsi3StatusContato(contato.tenantId, contato.status, contato.contactId);

  return {
    ...chave,
    tipo: 'CONTACT',
    tenantId: String(contato.tenantId),
    contactId: String(contato.contactId),
    email: contato.email.value,
    emailHash,
    nome: contato.nome,
    telefone: contato.telefone,
    empresa: contato.empresa,
    // Guarda só quando há algo: item enxuto, e ausência lida como [] / false.
    tags: contato.tags !== undefined && contato.tags.length > 0 ? [...contato.tags] : undefined,
    isLead: contato.isLead === true ? true : undefined,
    camposCustomizados: contato.camposCustomizados as Record<string, string>,
    status: contato.status,
    relacionamento: contato.relacionamento,
    relacionamentoDesde: contato.relacionamentoDesde?.toISOString(),
    baseLegal:
      contato.baseLegal === undefined
        ? undefined
        : {
            base: contato.baseLegal.base,
            liaVersao: contato.baseLegal.liaVersao,
            finalidade: contato.baseLegal.finalidade,
            evidenciaRelacionamento: contato.baseLegal.evidenciaRelacionamento,
            origemDeclarada: contato.baseLegal.origemDeclarada,
            registradoEm: contato.baseLegal.registradoEm.toISOString(),
          },
    criadoEm: contato.criadoEm.toISOString(),
    atualizadoEm: contato.atualizadoEm.toISOString(),
    origem: contato.origem,
    gsi1pk: g1.pk,
    gsi1sk: g1.sk,
    gsi3pk: g3.pk,
    gsi3sk: g3.sk,
  };
}

export function itemParaContato(item: Record<string, unknown>): Contact {
  const email = EmailAddress.create(String(item['email']));
  if (!email.ok) {
    // Corrupção de dados, não entrada inválida do usuário: um e-mail só chega ao
    // banco depois de validado. Falhar alto é o certo — mascarar produziria uma
    // lista silenciosamente incompleta na hora de disparar.
    throw new Error(
      `Item de contato com e-mail inválido no banco: contactId=${String(item['contactId'])}`,
    );
  }

  const baseLegalBruta = item['baseLegal'] as ItemContato['baseLegal'];

  return {
    tenantId: tenantId(String(item['tenantId'])),
    contactId: contactId(String(item['contactId'])),
    email: email.value,
    ...(item['nome'] === undefined ? {} : { nome: String(item['nome']) }),
    ...(item['telefone'] === undefined ? {} : { telefone: String(item['telefone']) }),
    ...(item['empresa'] === undefined ? {} : { empresa: String(item['empresa']) }),
    ...(Array.isArray(item['tags']) ? { tags: (item['tags'] as unknown[]).map(String) } : {}),
    ...(item['isLead'] === true ? { isLead: true } : {}),
    camposCustomizados: (item['camposCustomizados'] ?? {}) as Record<string, string>,
    status: String(item['status']) as Contact['status'],
    relacionamento: String(item['relacionamento']) as Contact['relacionamento'],
    ...(item['relacionamentoDesde'] === undefined
      ? {}
      : { relacionamentoDesde: new Date(String(item['relacionamentoDesde'])) }),
    ...(baseLegalBruta === undefined
      ? {}
      : {
          baseLegal: {
            base: baseLegalBruta.base as NonNullable<Contact['baseLegal']>['base'],
            liaVersao: baseLegalBruta.liaVersao,
            finalidade: baseLegalBruta.finalidade,
            evidenciaRelacionamento: baseLegalBruta.evidenciaRelacionamento,
            origemDeclarada: baseLegalBruta.origemDeclarada,
            registradoEm: new Date(baseLegalBruta.registradoEm),
          },
        }),
    criadoEm: new Date(String(item['criadoEm'])),
    atualizadoEm: new Date(String(item['atualizadoEm'])),
    origem: String(item['origem']),
  };
}
