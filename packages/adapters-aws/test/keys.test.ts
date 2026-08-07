import { describe, it, expect } from 'vitest';
import { campaignId, contactId, sendId, tenantId } from '@emailmkt/core';
import {
  chaveAuditoria,
  chaveCampanha,
  chaveContato,
  chaveEnvio,
  chaveMetricas,
  chaveSupressao,
  chaveTemplate,
  codificarCursor,
  decodificarCursor,
} from '../src/keys.js';

const T = tenantId('andrearaujo');

describe('chaves da tabela única', () => {
  it('prefixa toda chave com o tenant — ponto de extensão multi-cliente', () => {
    // §12, V3: sem isto, virar multi-cliente exigiria reescrever todas as
    // partition keys e migrar a tabela inteira.
    expect(chaveContato(T, contactId('c-1')).pk).toContain('TENANT#andrearaujo');
    expect(chaveCampanha(T, campaignId('k-1')).pk).toContain('TENANT#andrearaujo');
    expect(chaveSupressao(T, 'hash').pk).toContain('TENANT#andrearaujo');
  });

  it('põe campanha e métricas na mesma partição', () => {
    // Permite ler as duas coisas numa Query só — o acesso da tela de relatório.
    const campanha = chaveCampanha(T, campaignId('k-1'));
    const metricas = chaveMetricas(T, campaignId('k-1'));

    expect(metricas.pk).toBe(campanha.pk);
    expect(metricas.sk).not.toBe(campanha.sk);
  });

  it('ordena versões de template numericamente, não lexicograficamente', () => {
    // Sem zero-padding, "V#10" viria antes de "V#9" e a última versão do
    // template seria a errada.
    const v9 = chaveTemplate(T, 't-1', 9).sk;
    const v10 = chaveTemplate(T, 't-1', 10).sk;

    expect(v9 < v10).toBe(true);
  });

  it('particiona a auditoria por mês', () => {
    const agosto = chaveAuditoria(T, new Date('2026-08-06T12:00:00Z'), 'a1');
    const setembro = chaveAuditoria(T, new Date('2026-09-01T00:00:00Z'), 'a2');

    expect(agosto.pk).toContain('2026-08');
    expect(setembro.pk).toContain('2026-09');
    expect(agosto.pk).not.toBe(setembro.pk);
  });

  it('ordena a auditoria por instante dentro do mês', () => {
    const cedo = chaveAuditoria(T, new Date('2026-08-06T08:00:00Z'), 'a1').sk;
    const tarde = chaveAuditoria(T, new Date('2026-08-06T18:00:00Z'), 'a2').sk;

    expect(cedo < tarde).toBe(true);
  });

  it('não confunde contato com campanha de mesmo id', () => {
    expect(chaveContato(T, contactId('x')).pk).not.toBe(chaveCampanha(T, campaignId('x')).pk);
  });

  it('mantém sendId dentro da partição da campanha', () => {
    // Permite listar todos os envios de uma campanha por Query com begins_with.
    const envio = chaveEnvio(T, campaignId('k-1'), sendId('s-1'));
    expect(envio.pk).toBe(chaveCampanha(T, campaignId('k-1')).pk);
    expect(envio.sk.startsWith('SEND#')).toBe(true);
  });
});

describe('cursor de paginação', () => {
  it('faz ida e volta', () => {
    const chave = { pk: 'TENANT#andrearaujo#LIST#l-1', sk: 'MEMBER#c-42' };
    expect(decodificarCursor(codificarCursor(chave))).toEqual(chave);
  });

  it('devolve undefined quando não há próxima página', () => {
    expect(codificarCursor(undefined)).toBeUndefined();
    expect(decodificarCursor(undefined)).toBeUndefined();
  });

  it('trata cursor corrompido como início da lista, sem estourar', () => {
    // Recomeçar é melhor que erro 500 numa listagem, e não há risco: o cursor
    // carrega posição, não permissão.
    expect(decodificarCursor('%%%não-é-base64%%%')).toBeUndefined();
    expect(decodificarCursor('bm90LWpzb24')).toBeUndefined();
  });

  it('rejeita cursor que não decodifica para objeto', () => {
    const arrayCodificado = Buffer.from('[1,2,3]', 'utf8').toString('base64url');
    expect(decodificarCursor(arrayCodificado)).toBeUndefined();
  });

  it('produz string segura para URL', () => {
    const chave = { pk: 'TENANT#x#LIST#l+1/2', sk: 'MEMBER#c?3' };
    const cursor = codificarCursor(chave) ?? '';
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('não usa listagem de contatos como oráculo — cursor não carrega segredo', () => {
    const cursor = codificarCursor({ pk: 'a', sk: 'b' }) ?? '';
    expect(Buffer.from(cursor, 'base64url').toString('utf8')).not.toMatch(/@/);
  });
});
