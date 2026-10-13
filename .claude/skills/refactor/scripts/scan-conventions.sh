#!/usr/bin/env bash
# CLAUDE.md の「実装上の約束」から外れている箇所の候補を列挙する。
#   scripts/scan-conventions.sh
# 出力は候補。index.css のテーマ定義など、約束の正体そのものは除いてある。
set -u
cd "$(dirname "$0")/../../../.." || exit 1

section() { echo; echo "## $1"; echo "#  $2"; }
hits() { grep -rnE "$@" 2>/dev/null || true; }

section "日付: toISOString().slice / Date からの今日" "lib/dates の today() / nowFhirDateTime() / toFhirDateTime() / localDay() を使う"
hits 'toISOString\(\)\.slice\(0, ?10\)|toISOString\(\)\.substring\(0, ?10\)|new Date\(\)\.toISOString\(\)' frontend/src --include='*.ts' --include='*.tsx' | grep -v 'src/lib/dates.ts'

section "backend: Date.current / Date.today / Time.zone.today" "FacilityClock.today(日本時間)か、画面から渡した日付を使う"
hits '\bDate\.(current|today)\b|Time\.zone\.today|Time\.now\.to_date' backend/app backend/lib backend/db --include='*.rb' --include='*.rake' | grep -v facility_clock.rb

section "色の直書き(index.css 以外)" "テーマ変数(--color-* など)を使う"
hits '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b|rgba?\(|hsla?\(' frontend/src --include='*.tsx' --include='*.ts' --include='*.css' | grep -v 'src/index.css' | grep -vE 'data:image|url\(|canvas|fabric|penColors|schemaImage|SchemaPaint|captureViewport'

section "型チェックと lint の抑止" "抑止の理由が今も成り立つか見る"
hits '@ts-ignore|@ts-expect-error|as any\b|as unknown as|eslint-disable|oxlint-disable' frontend/src --include='*.ts' --include='*.tsx'

section "デバッグ出力の残り" "console.log / debugger / binding.irb / pp"
hits 'console\.log\(|\bdebugger\b' frontend/src --include='*.ts' --include='*.tsx'
hits 'binding\.irb|binding\.pry|^\s*pp\b|^\s*puts\b' backend/app backend/lib --include='*.rb'

section "ボタンの個別サイズ指定" "共通の button スタイル(--control-height)に任せ、height・padding・fontSize を個別に足さない"
hits '<button[^>]*style=\{\{[^}]*(height|padding|fontSize)' frontend/src --include='*.tsx'

section "削除ボタンの「×」" "フォーム内の行を消すボタンはゴミ箱アイコン(TrashIcon)。選択済み項目を外す×とモーダルを閉じる×は除く"
hits '>\s*×\s*<' frontend/src --include='*.tsx' | grep -vE 'modal|Modal|selected|chip|Chip|close|Close'

section "_count の大きな値" "上限は 500。全件は searchAllPages"
hits '_count["'"'"']?\s*[:=]\s*["'"'"']?[0-9]{3,}' frontend/src --include='*.ts' --include='*.tsx' | grep -vE '_count[^0-9]*([1-4][0-9]{2}|500)\b'

section "検索結果の手元フィルタ(上流に寄せられないか)" "search 直後の .filter は上流の検索パラメータで絞れないか確認(docs/server-improvement-backlog.md)"
hits -A3 'fhirClient\.search\(|searchAllPages\(' frontend/src/api --include='*.ts' | grep -E '\.filter\(' || true

section "単一ヘッダの transaction で fullUrl が無い entry" "オーダーヘッダを書く Bundle の entry には fullUrl を付ける(来歴とパス参照が付かない)"
for f in $(grep -rlE 'resource: *(header|serviceRequest),' frontend/src/fhir --include='*.ts'); do
  awk -v f="$f" '/resource: *(header|serviceRequest),/ { if ($0 !~ /fullUrl/ && p1 !~ /fullUrl/ && p2 !~ /fullUrl/) print f ":" NR ": " $0 } { p2 = p1; p1 = $0 }' "$f"
done

section "種別ごとの分岐の列挙" "オーダー種別の if/switch の連なりは orderKinds の対応表に寄せる"
hits '(kind|orderType|type) === "(rad|lab|physio|endoscopy|patho|micro|treatment|surgery|rehab|transfusion|meal|nursing|consult|injection|prescription|radiotherapy|nutrition)(-order)?"' frontend/src --include='*.ts' --include='*.tsx' | awk -F: '{c[$1]++} END {for (f in c) if (c[f] >= 4) print c[f] "\t" f}' | sort -rn
