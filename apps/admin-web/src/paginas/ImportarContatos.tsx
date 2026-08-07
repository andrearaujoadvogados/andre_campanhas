import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FalhaApi, api } from '../lib/api.js';
import { enviarParaS3, lerColunas, sha256Base64 } from '../lib/importacao.js';
import { ROTULO_RELACIONAMENTO } from '../lib/formato.js';
import { Aviso, Botao, Campo, Cartao, ErroCaixa, classeEntrada } from '../componentes/base.tsx';

interface RespostaUpload {
  importacaoId: string;
  url: string;
  cabecalhosObrigatorios: Record<string, string>;
}

interface RespostaInicio {
  importacaoId: string;
  estado: string;
  aviso: string;
}

const RELACIONAMENTOS = Object.keys(ROTULO_RELACIONAMENTO);

/** `undefined` quando o operador escolhe "não tenho esta coluna". */
const opcional = (v: string): string | undefined => (v === '' ? undefined : v);

export function ImportarContatos() {
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [colunas, definirColunas] = useState<string[]>([]);
  const [colunaEmail, definirColunaEmail] = useState('');
  const [colunaNome, definirColunaNome] = useState('');
  const [colunaVinculo, definirColunaVinculo] = useState('');
  const [colunaDesde, definirColunaDesde] = useState('');
  const [origemDeclarada, definirOrigem] = useState('');
  const [relacionamentoPadrao, definirRelacionamento] = useState('CLIENTE_ATIVO');
  const [confirmou, definirConfirmou] = useState(false);
  const [resultado, definirResultado] = useState<RespostaInicio | null>(null);

  async function escolherArquivo(f: File | null): Promise<void> {
    definirArquivo(f);
    definirResultado(null);
    const cabecalho = f === null ? [] : await lerColunas(f);
    definirColunas(cabecalho);

    // Palpite pelo nome da coluna. Erra sem custo — o operador vê o que foi
    // escolhido e troca —, e acerta na maioria dos arquivos exportados daqui.
    definirColunaEmail(cabecalho.find((c) => /e-?mail/i.test(c)) ?? '');
    definirColunaNome(cabecalho.find((c) => /nome/i.test(c)) ?? '');
    definirColunaVinculo(cabecalho.find((c) => /v[ií]nculo|relacionamento/i.test(c)) ?? '');
    definirColunaDesde('');
  }

  const importar = useMutation({
    mutationFn: async (): Promise<RespostaInicio> => {
      if (arquivo === null) throw new Error('Escolha um arquivo.');

      // 1. O digest entra na assinatura: a URL vale para este arquivo e só ele.
      const checksumSha256 = await sha256Base64(arquivo);

      // 2. A API assina; ela nunca vê o conteúdo do CSV.
      const upload = await api.post<RespostaUpload>('/contatos/importacoes', {
        nomeArquivo: arquivo.name,
        checksumSha256,
      });

      // 3. O arquivo sobe direto para o S3.
      await enviarParaS3(upload.url, arquivo, upload.cabecalhosObrigatorios);

      // 4. Só agora a importação entra na fila.
      return api.post<RespostaInicio>(`/contatos/importacoes/${upload.importacaoId}/iniciar`, {
        importacaoId: upload.importacaoId,
        nomeArquivo: arquivo.name,
        origemDeclarada,
        relacionamentoPadrao,
        confirmaSemListaComprada: confirmou,
        mapeamentoColunas: {
          email: colunaEmail,
          ...(opcional(colunaNome) === undefined ? {} : { nome: colunaNome }),
          ...(opcional(colunaVinculo) === undefined ? {} : { relacionamento: colunaVinculo }),
          ...(opcional(colunaDesde) === undefined ? {} : { relacionamentoDesde: colunaDesde }),
        },
      });
    },
    onSuccess: (r) => definirResultado(r),
  });

  const erros = importar.error instanceof FalhaApi ? importar.error.porCampo : {};
  const pronto =
    arquivo !== null && colunaEmail !== '' && origemDeclarada.trim() !== '' && confirmou;

  return (
    <div className="space-y-6">
      <Link to="/contatos" className="text-sm text-slate-500 hover:underline">
        ← Voltar
      </Link>

      <h1 className="text-xl font-semibold text-slate-900">Importar contatos</h1>

      <Cartao titulo="Arquivo">
        <Campo
          rotulo="CSV"
          ajuda="A primeira linha precisa ser o cabeçalho das colunas."
          obrigatorio
        >
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void escolherArquivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium"
          />
        </Campo>

        {arquivo !== null && colunas.length === 0 && (
          <div className="mt-4">
            <Aviso
              tom="alerta"
              texto="Não foi possível ler o cabeçalho deste arquivo. Confirme que ele é um CSV com os nomes das colunas na primeira linha."
            />
          </div>
        )}
      </Cartao>

      {colunas.length > 0 && (
        <Cartao titulo="De qual coluna vem cada campo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="E-mail" obrigatorio erro={erros['mapeamentoColunas.email']}>
              <select
                value={colunaEmail}
                onChange={(e) => definirColunaEmail(e.target.value)}
                className={classeEntrada}
              >
                <option value="">Escolha…</option>
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Nome">
              <select
                value={colunaNome}
                onChange={(e) => definirColunaNome(e.target.value)}
                className={classeEntrada}
              >
                <option value="">Não tenho esta coluna</option>
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>

            {/**
             * A coluna de vínculo é o que separa uma importação utilizável de
             * uma que classifica milhares de pessoas com um chute só (§6.2).
             */}
            <Campo
              rotulo="Vínculo com o escritório"
              ajuda="Sem esta coluna, todos os contatos do arquivo recebem o mesmo vínculo."
            >
              <select
                value={colunaVinculo}
                onChange={(e) => definirColunaVinculo(e.target.value)}
                className={classeEntrada}
              >
                <option value="">Não tenho esta coluna</option>
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Vínculo desde">
              <select
                value={colunaDesde}
                onChange={(e) => definirColunaDesde(e.target.value)}
                className={classeEntrada}
              >
                <option value="">Não tenho esta coluna</option>
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          {colunaVinculo !== '' && (
            <div className="mt-4">
              <Aviso texto="Linhas com o vínculo em branco ou com valor não reconhecido entram como Não classificado, e não recebem campanhas." />
            </div>
          )}
        </Cartao>
      )}

      <Cartao titulo="Base legal">
        <div className="space-y-4">
          {/**
           * A origem declarada não é burocracia de formulário: é a evidência que
           * sustenta o legítimo interesse do lote inteiro (§10.2). Ela fica
           * gravada em cada contato importado e no registro de auditoria.
           */}
          <Campo
            rotulo="De onde vieram estes contatos"
            ajuda="Fica gravado em cada contato. É o que responde, meses depois, de onde veio esta base."
            obrigatorio
            erro={erros['origemDeclarada']}
          >
            <textarea
              value={origemDeclarada}
              onChange={(e) => definirOrigem(e.target.value)}
              rows={3}
              placeholder="Ex.: cadastro de clientes do escritório, exportado do sistema interno em 2026"
              className={classeEntrada}
            />
          </Campo>

          <Campo
            rotulo="Vínculo padrão"
            ajuda={
              colunaVinculo === ''
                ? 'Aplicado a TODOS os contatos do arquivo, já que não há coluna de vínculo.'
                : 'Aplicado apenas às linhas em que a coluna de vínculo não puder ser lida.'
            }
            obrigatorio
          >
            <select
              value={relacionamentoPadrao}
              onChange={(e) => definirRelacionamento(e.target.value)}
              className={classeEntrada}
            >
              {RELACIONAMENTOS.map((r) => (
                <option key={r} value={r}>
                  {ROTULO_RELACIONAMENTO[r]}
                </option>
              ))}
            </select>
          </Campo>

          {colunaVinculo === '' && relacionamentoPadrao !== 'DESCONHECIDO' && (
            <Aviso
              tom="alerta"
              texto={`Sem coluna de vínculo, todos os contatos do arquivo entrarão como "${ROTULO_RELACIONAMENTO[relacionamentoPadrao] ?? relacionamentoPadrao}". Declare esse vínculo apenas se ele for verdadeiro para o arquivo inteiro.`}
            />
          )}

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmou}
              onChange={(e) => definirConfirmou(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Confirmo que esta lista não foi comprada nem obtida de terceiros, e que estas pessoas
              têm relacionamento com o escritório.
            </span>
          </label>
        </div>
      </Cartao>

      <div className="space-y-3">
        <ErroCaixa erro={importar.error} />

        <Botao onClick={() => importar.mutate()} disabled={!pronto} carregando={importar.isPending}>
          Importar
        </Botao>

        {resultado !== null && (
          <Cartao titulo="Importação enviada">
            <p className="text-sm text-slate-700">
              O arquivo entrou na fila de processamento. Contatos grandes levam alguns minutos, e os
              que já pediram descadastro são descartados automaticamente.
            </p>
            <div className="mt-3">
              <Aviso tom="alerta" texto={resultado.aviso} />
            </div>
          </Cartao>
        )}
      </div>
    </div>
  );
}
