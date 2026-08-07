#!/usr/bin/env bash
#
# Publica o painel no bucket do site — o passo que o `cdk deploy` não faz.
#
# O CDK cria o bucket e a distribuição vazios. Este script compila a SPA e a
# envia. Vive num arquivo, e não embutido no workflow, porque é a única parte do
# pipeline que dá para ler e depurar sem abrir o YAML — e porque duplicá-lo
# entre os jobs de dev e produção seria pedir para os dois divergirem.
#
# Espera `AMBIENTE` como `Dev` ou `Prod`, e credenciais da AWS já no ambiente.

set -euo pipefail

: "${AMBIENTE:?defina AMBIENTE=Dev ou AMBIENTE=Prod}"

REGIAO_DADOS=sa-east-1
# A stack Web vive em us-east-1 por exigência do certificado do CloudFront.
REGIAO_WEB=us-east-1

saida () {
  local valor
  valor=$(aws cloudformation describe-stacks \
    --stack-name "$1" --region "$2" \
    --query "Stacks[0].Outputs[?OutputKey=='$3'].OutputValue" \
    --output text)

  # `describe-stacks` devolve string vazia, e não erro, quando a saída não
  # existe. Sem esta checagem o bundle seria compilado com configuração em
  # branco: ele sobe, carrega no navegador e falha no login, sem nada no log do
  # pipeline sugerindo o motivo.
  if [ -z "$valor" ] || [ "$valor" = "None" ]; then
    echo "Saída '$3' não encontrada na stack '$1' ($2)." >&2
    exit 1
  fi
  echo "$valor"
}

echo "→ Lendo a configuração das stacks"
VITE_API_URL=$(saida "EmailMktCore${AMBIENTE}" "$REGIAO_DADOS" ApiUrl)
VITE_USER_POOL_ID=$(saida "EmailMktCore${AMBIENTE}" "$REGIAO_DADOS" UserPoolId)
VITE_USER_POOL_CLIENT_ID=$(saida "EmailMktCore${AMBIENTE}" "$REGIAO_DADOS" UserPoolClientId)
export VITE_API_URL VITE_USER_POOL_ID VITE_USER_POOL_CLIENT_ID

BUCKET=$(saida "EmailMktWeb${AMBIENTE}" "$REGIAO_WEB" BucketSiteNome)
DISTRIBUICAO=$(saida "EmailMktWeb${AMBIENTE}" "$REGIAO_WEB" DistribuicaoId)

# O build acontece aqui, e não no job de verificação, porque estes três valores
# entram no bundle em tempo de compilação e só são conhecidos depois que a stack
# sobe. Compilar antes produz um bundle que sobe sem erro e não autentica.
echo "→ Compilando o painel contra ${VITE_API_URL}"
pnpm --filter @emailmkt/admin-web build

# Duas passadas, e a ordem entre elas importa.
#
# Os assets têm hash no nome: mudou o conteúdo, mudou o nome, então podem ficar
# em cache por um ano. O index.html não pode ficar em cache nenhum — ele é quem
# aponta para os assets, e uma cópia velha em cache manda o navegador buscar
# arquivos que o `--delete` já removeu. A tela fica branca, e só para quem já
# tinha visitado o painel antes.
echo "→ Enviando os assets"
aws s3 sync apps/admin-web/dist "s3://${BUCKET}" \
  --delete \
  --exclude index.html \
  --cache-control 'public,max-age=31536000,immutable'

echo "→ Enviando o index.html"
aws s3 cp apps/admin-web/dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control 'no-cache,no-store,must-revalidate' \
  --content-type 'text/html; charset=utf-8'

# Depois do upload, nunca antes: invalidar primeiro apenas esvaziaria o cache
# para repovoá-lo com o conteúdo antigo, que ainda estaria no bucket.
echo "→ Invalidando o cache da distribuição"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUICAO" \
  --paths '/*' \
  --query 'Invalidation.Id' --output text

echo "✓ Painel publicado em ${BUCKET}"
