import { campaignId, listId, templateId, tenantId, userId, type Campaign } from '@emailmkt/core';
import { chaveCampanha, gsi3StatusCampanha } from '../keys.js';

export interface ItemCampanha extends Record<string, unknown> {
  pk: string;
  sk: string;
  tipo: 'CAMPAIGN';
  tenantId: string;
  campaignId: string;
  nome: string;
  templateId: string;
  templateVersao: number;
  listId: string;
  status: string;
  agendadaPara?: string | undefined;
  remetenteNome: string;
  remetenteEmail: string;
  replyTo?: string | undefined;
  criadoPor: string;
  criadoEm: string;
  aprovacao?:
    | {
        aprovadoPor: string;
        aprovadoEm: string;
        hashConteudoAprovado: string;
      }
    | undefined;
  gsi3pk: string;
  gsi3sk: string;
}

export function campanhaParaItem(campanha: Campaign): ItemCampanha {
  const chave = chaveCampanha(campanha.tenantId, campanha.campaignId);
  // Ordena pela data que importa naquele estado: agendada pela data marcada,
  // as demais pela criação. Assim a listagem do painel sai ordenada do índice,
  // sem ordenar em memória.
  const g3 = gsi3StatusCampanha(
    campanha.tenantId,
    campanha.status,
    campanha.agendadaPara ?? campanha.criadoEm,
  );

  return {
    ...chave,
    tipo: 'CAMPAIGN',
    tenantId: String(campanha.tenantId),
    campaignId: String(campanha.campaignId),
    nome: campanha.nome,
    templateId: String(campanha.templateId),
    templateVersao: campanha.templateVersao,
    listId: String(campanha.listId),
    status: campanha.status,
    agendadaPara: campanha.agendadaPara?.toISOString(),
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
    criadoPor: String(campanha.criadoPor),
    criadoEm: campanha.criadoEm.toISOString(),
    aprovacao:
      campanha.aprovacao === undefined
        ? undefined
        : {
            aprovadoPor: String(campanha.aprovacao.aprovadoPor),
            aprovadoEm: campanha.aprovacao.aprovadoEm.toISOString(),
            hashConteudoAprovado: campanha.aprovacao.hashConteudoAprovado,
          },
    gsi3pk: g3.pk,
    gsi3sk: g3.sk,
  };
}

export function itemParaCampanha(item: Record<string, unknown>): Campaign {
  const aprovacaoBruta = item['aprovacao'] as ItemCampanha['aprovacao'];

  return {
    tenantId: tenantId(String(item['tenantId'])),
    campaignId: campaignId(String(item['campaignId'])),
    nome: String(item['nome']),
    templateId: templateId(String(item['templateId'])),
    templateVersao: Number(item['templateVersao']),
    listId: listId(String(item['listId'])),
    status: String(item['status']) as Campaign['status'],
    ...(item['agendadaPara'] === undefined
      ? {}
      : { agendadaPara: new Date(String(item['agendadaPara'])) }),
    remetenteNome: String(item['remetenteNome']),
    remetenteEmail: String(item['remetenteEmail']),
    ...(item['replyTo'] === undefined ? {} : { replyTo: String(item['replyTo']) }),
    criadoPor: userId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    ...(aprovacaoBruta === undefined
      ? {}
      : {
          aprovacao: {
            aprovadoPor: userId(aprovacaoBruta.aprovadoPor),
            aprovadoEm: new Date(aprovacaoBruta.aprovadoEm),
            hashConteudoAprovado: aprovacaoBruta.hashConteudoAprovado,
          },
        }),
  };
}
