import {
  campaignId,
  listId,
  templateId,
  tenantId,
  tipoEmailId,
  userId,
  type Campaign,
} from '@emailmkt/core';
import { chaveCampanha, gsi3StatusCampanha } from '../keys.js';

export interface ItemCampanha extends Record<string, unknown> {
  pk: string;
  sk: string;
  tipo: 'CAMPAIGN';
  tenantId: string;
  campaignId: string;
  nome: string;
  tipoEmailId?: string | undefined;
  templateId: string;
  templateVersao: number;
  listId: string;
  status: string;
  agendadaPara?: string | undefined;
  remetenteNome: string;
  remetenteEmail: string;
  replyTo?: string | undefined;
  assunto?: string | undefined;
  tagsFiltro?: string[] | undefined;
  incluirLeads?: boolean | undefined;
  destinatariosSelecionados?: string[] | undefined;
  criadoPor: string;
  criadoEm: string;
  enviadaPor?: string | undefined;
  disparadaEm?: string | undefined;
  hashConteudoEnviado?: string | undefined;
  totalDestinatarios?: number | undefined;
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
    tipoEmailId: campanha.tipoEmailId === undefined ? undefined : String(campanha.tipoEmailId),
    templateId: String(campanha.templateId),
    templateVersao: campanha.templateVersao,
    listId: String(campanha.listId),
    status: campanha.status,
    agendadaPara: campanha.agendadaPara?.toISOString(),
    remetenteNome: campanha.remetenteNome,
    remetenteEmail: campanha.remetenteEmail,
    replyTo: campanha.replyTo,
    assunto: campanha.assunto,
    tagsFiltro:
      campanha.tagsFiltro !== undefined && campanha.tagsFiltro.length > 0
        ? [...campanha.tagsFiltro]
        : undefined,
    incluirLeads: campanha.incluirLeads === true ? true : undefined,
    destinatariosSelecionados:
      campanha.destinatariosSelecionados !== undefined
        ? [...campanha.destinatariosSelecionados]
        : undefined,
    criadoPor: String(campanha.criadoPor),
    criadoEm: campanha.criadoEm.toISOString(),
    enviadaPor: campanha.enviadaPor === undefined ? undefined : String(campanha.enviadaPor),
    disparadaEm: campanha.disparadaEm?.toISOString(),
    hashConteudoEnviado: campanha.hashConteudoEnviado,
    totalDestinatarios: campanha.totalDestinatarios,
    gsi3pk: g3.pk,
    gsi3sk: g3.sk,
  };
}

/**
 * Status gravados pelo fluxo com aprovação, que não existem mais no domínio.
 *
 * Campanhas criadas antes de 2026-08-10 podem estar no banco com um deles. Sem
 * esta tradução, o valor cru atravessaria o cast de `status` e chegaria ao
 * domínio como um estado que `TRANSICOES` não conhece — a campanha ficaria
 * inoperável, e a única pista seria um `TypeError` no CloudWatch.
 *
 * `RASCUNHO` é o destino certo para os dois: nenhum deles havia disparado, e o
 * rascunho é justamente o estado de quem ainda pode sair. A campanha volta a ser
 * editável e disparável, e na primeira gravação o item migra sozinho — o
 * `gsi3pk` é reescrito com o status novo.
 */
const STATUS_LEGADOS: Readonly<Record<string, Campaign['status']>> = {
  EM_REVISAO: 'RASCUNHO',
  APROVADA: 'RASCUNHO',
};

export function itemParaCampanha(item: Record<string, unknown>): Campaign {
  const statusBruto = String(item['status']);

  return {
    tenantId: tenantId(String(item['tenantId'])),
    campaignId: campaignId(String(item['campaignId'])),
    nome: String(item['nome']),
    ...(item['tipoEmailId'] === undefined
      ? {}
      : { tipoEmailId: tipoEmailId(String(item['tipoEmailId'])) }),
    templateId: templateId(String(item['templateId'])),
    templateVersao: Number(item['templateVersao']),
    listId: listId(String(item['listId'])),
    status: STATUS_LEGADOS[statusBruto] ?? (statusBruto as Campaign['status']),
    ...(item['agendadaPara'] === undefined
      ? {}
      : { agendadaPara: new Date(String(item['agendadaPara'])) }),
    remetenteNome: String(item['remetenteNome']),
    remetenteEmail: String(item['remetenteEmail']),
    ...(item['replyTo'] === undefined ? {} : { replyTo: String(item['replyTo']) }),
    criadoPor: userId(String(item['criadoPor'])),
    criadoEm: new Date(String(item['criadoEm'])),
    ...(item['totalDestinatarios'] === undefined
      ? {}
      : { totalDestinatarios: Number(item['totalDestinatarios']) }),
    ...(item['assunto'] === undefined ? {} : { assunto: String(item['assunto']) }),
    ...(Array.isArray(item['tagsFiltro'])
      ? { tagsFiltro: (item['tagsFiltro'] as unknown[]).map(String) }
      : {}),
    ...(item['incluirLeads'] === true ? { incluirLeads: true } : {}),
    ...(Array.isArray(item['destinatariosSelecionados'])
      ? { destinatariosSelecionados: (item['destinatariosSelecionados'] as unknown[]).map(String) }
      : {}),
    ...(item['enviadaPor'] === undefined ? {} : { enviadaPor: userId(String(item['enviadaPor'])) }),
    ...(item['disparadaEm'] === undefined
      ? {}
      : { disparadaEm: new Date(String(item['disparadaEm'])) }),
    ...(item['hashConteudoEnviado'] === undefined
      ? {}
      : { hashConteudoEnviado: String(item['hashConteudoEnviado']) }),
  };
}
