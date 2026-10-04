#!/usr/bin/env bash
# fhir-ig の最終コミット以降に fhir-client で変わった、FHIR の形に関わりうる箇所を一覧する。
# 使い方: app-changes.sh [<基準のコミットまたは日時>]
#   引数なし … fhir-ig の最終コミット日時より前の、fhir-client の最後のコミットを基準にする
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
IG="${FHIR_IG_DIR:-$ROOT/../fhir-ig}"
# FHIR リソースを組み立てる・書き込むコードと、同梱テンプレート(Questionnaire)の置き場
PATHS=(frontend/src/fhir backend/app/services docs/report-mappings)

if [ ! -d "$IG/.git" ]; then
  echo "fhir-ig が見つからない: $IG(FHIR_IG_DIR で指定する)" >&2
  exit 1
fi

echo "== fhir-ig =="
git -C "$IG" log -1 --format='最終コミット: %h %cd %s' --date=format:'%Y-%m-%d %H:%M'
IG_DIRTY="$(git -C "$IG" status --short)"
if [ -n "$IG_DIRTY" ]; then
  echo "未コミットの変更あり(前回の更新が途中の可能性。基準は目安として扱う):"
  echo "$IG_DIRTY" | sed 's/^/  /'
else
  echo "作業ツリー: clean"
fi

if [ $# -ge 1 ] && git -C "$ROOT" rev-parse --verify --quiet "$1^{commit}" >/dev/null; then
  BASE="$(git -C "$ROOT" rev-parse --short "$1")"
else
  SINCE="${1:-$(git -C "$IG" log -1 --format=%cI)}"
  BASE="$(git -C "$ROOT" rev-list -1 --abbrev-commit --before="$SINCE" HEAD)"
fi

cd "$ROOT"
echo
echo "== fhir-client(基準 $BASE: $(git log -1 --format='%cd %s' --date=format:'%Y-%m-%d %H:%M' "$BASE"))=="

echo "-- 追加・削除された canonical の URL の行(未コミットの変更を含む)--"
git diff -U0 "$BASE" -- frontend/src backend/app backend/lib ':!frontend/src/demo-seed' \
  | awk '/^\+\+\+ /{file=substr($2,3); next} /^--- /{next} /^[+-].*fhir-client\.local/{print "  " file ": " substr($0,1,200)}' \
  || true

echo
echo "-- 組み立て・書き込みのコードに触れたコミット --"
git log --format='%h %cd %s' --date=format:'%m-%d %H:%M' "$BASE"..HEAD -- "${PATHS[@]}"

echo
echo "-- 変更ファイル(未コミットの変更を含む)--"
git diff --stat=160 "$BASE" -- "${PATHS[@]}"

UNTRACKED="$(git ls-files --others --exclude-standard -- "${PATHS[@]}")"
if [ -n "$UNTRACKED" ]; then
  echo
  echo "-- 未追跡ファイル --"
  echo "$UNTRACKED" | sed 's/^/  /'
fi

echo
echo "差分の中身: git -C $ROOT diff $BASE -- <path>"
