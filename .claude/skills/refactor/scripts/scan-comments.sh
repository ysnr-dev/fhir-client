#!/usr/bin/env bash
# 修正経緯・過去との比較・コードをなぞるだけ、といった「残さない」コメントの候補を列挙する。
#   scripts/scan-comments.sh [path ...]
# 省略時は frontend/src backend/app backend/lib と、隣に ../fhir-server があればその app lib も見る。
# 出力は候補にすぎない(「変更前の担当医」のように業務上の意味で使う語も混じる)。1 件ずつ読んで判断する。
set -u
cd "$(dirname "$0")/../../../.." || exit 1

if [ $# -gt 0 ]; then
  paths=("$@")
else
  paths=(frontend/src backend/app backend/lib)
  for d in ../fhir-server/app ../fhir-server/lib; do [ -d "$d" ] && paths+=("$d"); done
fi

# 経緯・比較(過去の形を引き合いに出す語)
history='以前は|以前の(実装|形|版|仕様|コード)|従来|元々は|もともとは|当初は|昔は|過去には|かつて|変更前は|に変更した|に変更済|後方互換|互換のため|互換性のため|レガシー|legacy|deprecated|obsolete|もう使わ|使われなくなった|今は使|現在は使|不要になった|とりあえず|仮実装|していたが|だったが|であったが|していたもの|renamed|was moved|moved to|moved from|previously|formerly|no longer|used to be|replaced by'
# 作業メモ(課題の置き場は docs/*-backlog.md)
todo='\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b|\bWIP\b|要確認|要検討|要修正|検討中'
# 修正・バグの言及(直した結果だけ残し、直した事実は git に任せる)
fix='バグ|不具合|修正した|\bfix\b|bugfix|hotfix|workaround|ワークアラウンド|回避策'

print_hits() {
  # $1: ラベル  $2: 正規表現  残り: grep の対象と --include
  local label=$1 re=$2; shift 2
  local out
  out=$(grep -rnE "$re" "$@" 2>/dev/null)
  # コメントアウトされたコードは、日本語を含む行(リソース構造の図・説明文)を除く
  case $label in *コード*) out=$(printf '%s\n' "$out" | LC_ALL=C grep -v $'[\x80-\xff]' | grep -v '^$');; esac
  [ -n "$out" ] || return 0
  echo "## $label"
  echo "$out"
  echo
}

for p in "${paths[@]}"; do
  [ -e "$p" ] || continue
  echo "==== $p"
  # TypeScript / CSS: 行コメントとブロックコメント
  print_hits "経緯・比較" "(//|/\*|^\s*\*).*($history)" "$p" --include='*.ts' --include='*.tsx' --include='*.css'
  print_hits "作業メモ" "(//|/\*|^\s*\*).*($todo)" "$p" --include='*.ts' --include='*.tsx' --include='*.css'
  print_hits "修正・バグの言及" "(//|/\*|^\s*\*).*($fix)" "$p" --include='*.ts' --include='*.tsx' --include='*.css'
  # Ruby: # コメント(文字列中の #{...} も拾うので読み飛ばす)
  print_hits "経緯・比較" "#.*($history)" "$p" --include='*.rb' --include='*.rake'
  print_hits "作業メモ" "#.*($todo)" "$p" --include='*.rb' --include='*.rake'
  print_hits "修正・バグの言及" "#.*($fix)" "$p" --include='*.rb' --include='*.rake'
  # コメントアウトされたコード(行頭 // や # の直後にコードらしき記号)
  print_hits "コメントアウトされたコード" '^\s*//\s*(const |let |return |if \(|\}|import |export |[A-Za-z_]+\(.*\);?\s*$)' "$p" --include='*.ts' --include='*.tsx'
  print_hits "コメントアウトされたコード" '^\s*#\s*([a-z_]+\.[a-z_]+\(|end\s*$|def |if |return )' "$p" --include='*.rb'
done
