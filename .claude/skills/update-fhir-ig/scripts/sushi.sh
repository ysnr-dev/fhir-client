#!/usr/bin/env bash
# fhir-ig の FSH だけを SUSHI でコンパイルする(約 1 分)。ホストに node が無いので IG Publisher のコンテナを使う。
# 終了コードは SUSHI のもの(エラーがあれば非 0)。出力の末尾に Errors / Warnings の件数が出る。
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
IG="${FHIR_IG_DIR:-$ROOT/../fhir-ig}"
cd "$IG"

# 公開レジストリに無い依存(JP Core / jpfhir-terminology)を ~/.fhir/packages に入れる(入っていれば何もしない)
./_installdeps.sh >/dev/null

docker run --rm \
  -v "$PWD":/src \
  -v "$HOME/.fhir":/home/publisher/.fhir \
  -w /src \
  "${IG_PUBLISHER_IMAGE:-hl7fhir/ig-publisher-base:latest}" sushi .
