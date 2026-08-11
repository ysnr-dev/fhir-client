# JJ1017をベースとした放射線検査オーダーマスタの設計

調査日: 2026-08-09。JJ1017指針 Ver3.4（2024）本文および配布別表（Ver3.3 Excel）を一次資料として確認済み。

**実装済み（2026-08-09）**。設計から変えた点は各節の「実装メモ」に記載。取込は実データで検証済み:
部品コード 1,623件（スキップ17件＝別表側の欠番・予約行）、頻用コード 9,116件（スキップ181件＝
不正桁164・重複17）。頻用コード全9,116件について「32桁→要素分解→再合成」が元コードと完全一致することを確認。

本文中の区別:
- **［事実］** = 公式資料・配布ファイルの実データで確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計提案

---

## 1. スコープ

- JJ1017コード表のインポート（`master_rad_jj1017_xxx`）
- 拡張が許容されている要素への施設拡張コード登録UI
- 放射線オーダー項目マスタ（`master_rad_items`）とマスタメンテUI（セット対応・有効期間つき）
- 頻用コード表（別表F）からの初期データ一括作成
- 放射線オーダーレイアウト（検体検査レイアウトと同型）

- オーダー入力画面とFHIR表現（§9。マスタに続けて実装した）

会計連携・撮影実績（ImagingStudy）・読影レポートは未着手（§10）。

---

## 2. JJ1017の要点

### 2.1 コード構造（32桁）

［事実］JJ1017指針 Ver3.4 表5.1。HIS-RIS間はJJ1017-32（32バイト固定長）として一括伝達。DICOMは16バイト制限のため前半をJJ1017-16M、後半をJJ1017-16Sに分割して設定する。

| 桁 | 要素 | コード表 | 例 |
|---|---|---|---|
| 1 | 種別（モダリティ） | 本文 表5.2（別表1A） | `1`=Ｘ線単純撮影, `6`=CT, `8`=核医学 |
| 2–3 | 手技（大分類） | 別表1B（v3.3ファイル: 別表A1） | `00`=NOS, `J3`=核医学SPECT系 |
| 4–5 | 手技（小分類） | 別表1C（別表A2） | `00`=NOS, `01`=造影 |
| 6–7 | 手技（拡張） | 別表1D（別表A3） | `JR`=99mTc-HMDP（核医学薬剤） |
| 8–10 | 部位（小部位） | 別表2/3（別表B・C） | `100`=頭部, `200`=胸部 |
| 11 | 左右等 | 本文 表5.5 | `0`/`B`/`R`/`L`/`H`/`F`/`A`/`P`/`W`/`Q`/`S`/`K`/`M` |
| 12 | 姿勢体位 | 別表5A（別表D1） | `1`=立位, `2`=仰臥位 |
| 13–14 | 入射・撮影方向・撮影法 | 別表5B（別表D2） | `02`=正面(A→P) |
| 15–16 | 拡張(汎用) | —（16M側の共通拡張領域） | 通常 `00` |
| 17–18 | 詳細体位 | 別表6A（別表E1） | `28`=開口 |
| 19–20 | 特殊指示 | 別表6B（別表E2） | `81`=心電図同期収集 |
| 21–22 | 核種（線種） | 別表6C（別表E3） | `03`=Ｘ線6MV, `45`=99mTc系 |
| 23–26 | 超音波画像モード | 本文 表5.6（16進ビットフラグ、利用は任意） | `003B` |
| 27–32 | JJ1017委員会予約 | — | `000000` |

- ［事実］頻用コード9,133件（32桁）を上記割当てでデコードし、部位名称がコード意味と8,630件一致（残余は「頸/頚」等の字体差）、左右・体位・方向・詳細体位・特殊指示・核種も意味文字列と整合することを確認した。
- ［事実］種別コード（表5.2）: `0`利用法未定 `1`Ｘ線単純撮影 `2`Ｘ線透視・造影 `3`Ｘ線血管撮影 `4`Ｘ線断層撮影 `5`Ｘ線骨塩定量 `6`Ｘ線CT `7`MRI `8`核医学 `9`超音波 `A`体外照射 `B`密封小線源 `C`温熱療法 `D`血液照射 `E`内用療法 `F`乳房X線撮影(v3.4) `G`X線単純撮影ポータブル(v3.4) `H`歯科口腔内撮影(v3.4)。
- ［事実］部位はコード表上「大部位(2)+臓器系(1)+小部位(3)」の6桁構造を持つが、**32桁コードに乗るのは小部位3桁＋左右1桁のみ**。大部位・臓器系は意味理解と絞り込み用。

### 2.2 施設拡張が許容される要素と拡張範囲

［事実］本文 5.4.2 / 5.5.3 / 5.6.2 / 5.7.2 / 5.8.6 より:

| 要素 | 拡張可否 | 施設拡張範囲 | 備考 |
|---|---|---|---|
| 種別（モダリティ） | ○ | `P`〜`Y`（1桁） | |
| 手技（大分類） | ○ | `A0`以降 | `J0`以降=核医学・`P0`以降=放射線治療が標準割当済み（衝突注意） |
| 手技（小分類） | ○ | `A0`以降 | 同上 |
| 手技（拡張） | ○ | `01`以降を任意定義 | `J0`以降=核医学薬剤・`P0`以降=治療加算・`S0`以降=その他領域が標準割当済み |
| 部位（小部位） | ○ | `A00`以降 | 大部位・臓器系は「拡張不要」 |
| 左右等 | × | — | |
| 姿勢体位 | ○ | `A`〜`N` | `P`〜`Y`はユーザ拡張不可 |
| 入射・撮影方向 | ○ | `A0`以降 | |
| 詳細体位 | ○ | `A0`以降 | |
| 特殊指示 | ○ | `A0`以降 | |
| 核種 | ○ | `A0`以降 | |
| 超音波画像モード | × | — | 拡張を認めない（本文 5.8.6） |

- ［事実］英字は「IとOを除く英大文字」。拡張を行った場合の符号化系指定子は `JJ1017-16M/施設略称` のように表記する。

### 2.3 配布ファイルの実態（backend/tmp/master-data/jj1017）

［事実］手元のファイルはVer3.3（2018-06-24）。最新はVer3.4（2024-09-07）だが、**Ver3.4の別表はPDFのみ公開でExcel配布が見当たらない**。Ver3.3→3.4のコード差分は僅少（大分類 `3Y`気管支バルブ留置術・`4S`経皮的腎瘻造設術、手技拡張 `LL`18F-fluciclovine、種別 `F`/`G`/`H`）。

| ファイル | 形式 | シート | 内容・件数 |
|---|---|---|---|
| 別表A（手技）.xlsx | xlsx | A1/A2/A3 | 大分類471・小分類341・拡張82 |
| 別表BC（部位）.xls | xls | 別表B（部位）/ C部位 | B=大部位・臓器系・小部位・新規/一般/CT/MR/USフラグ・和名・英名（431件）。C=小部位のみの簡易版 |
| 別表D（姿勢等）.xls | xls | D1体位 / D2入射撮影方向 | 11件 / 89件 |
| 別表E（指示等）.xls | xls | E1詳細体位 / E2特殊指示 / E3核種 | 37 / 119 / 59件 |
| 別表F（頻用）.xls | xls | F1放射線検査 / F2超音波 / F3放射線治療 | 3,781 / 938 / 4,576件（32桁コード＋コード意味） |

データ品質の注意（インポータで対処）:
- ［事実］**F2に31桁の不正コードが162件**混在（32桁でない行）。取込時にエラー行として件数・内容を報告し、スキップする。
- ［事実］A1シートは補語列・結合セルにより列位置が一定でない行がある（コード意味が空になる行あり）。列位置をシートごとに固定せず、ヘッダ行（「整理番号」「コード値」）から列を特定し、名称空欄行はスキップ・報告する。
- ［事実］**種別（1桁）と左右等（1桁）のコード表はExcel別表に存在しない**（本文の表5.2・表5.5のみ）→ seedデータとして投入する（§4）。
- ［事実］4ファイル中4シート構成の3ファイルが旧 `.xls`。Roo単体では読めないため **`roo-xls` gem の追加が必要**（Gemfile変更＝backendイメージ再ビルド必要）。

---

## 3. データモデル

［提案］検体検査マスタの規約を踏襲する: テーブルは `master_` 接頭辞・**FKなし（コードで疎結合）**・`Master::` 名前空間モデル・`self.table_name` 明示・`Master::SearchNormalizer` による search_* 列・画面編集系はid参照可、配布マスタは全置換。

```text
master_rad_jj1017_codes            -- JJ1017部品コード統合表（全要素を1テーブルで管理）
--------------------------------
element             -- modality | procedure_major | procedure_minor | procedure_extension |
                    -- body_part | laterality | body_position | direction |
                    -- detail_position | special_instruction | nuclide
code                -- 要素ごとの桁数（1〜3桁）。unique index (element, code)
name                -- コード意味（和名）
name_english        -- コード意味（英語）※部位・一部手技のみ
common_name         -- 通称名称（別表A3の核医学頻用名）
jj_version          -- 収載Ver（"3.0"等、別表のVer列）
note                -- 備考
source              -- official | local   ※localが施設拡張コード
display_order       -- 別表の掲載順（整理番号）
-- 部位専用（element=body_part のみ、他はNULL）
major_part_code     -- 大部位コード(2桁)
organ_system_code   -- 臓器系部位コード(1桁)
use_general / use_ct / use_mr / use_us   -- 別表Bのモダリティ別使用可否フラグ(boolean)
search_name         -- 検索用正規化列（name+common_name）

master_rad_jj1017_frequent_codes   -- 頻用コード表（別表F、全置換）
--------------------------------
category            -- rad_exam | ultrasound | radiotherapy （F1/F2/F3）
jj1017_code         -- 32桁。unique index (category, jj1017_code) ※重複時は先勝ち
name                -- コード意味
display_order       -- 掲載順（整理番号）
search_name

master_rad_items                   -- 放射線オーダー項目マスタ（手動メンテ）
--------------------------------
item_code           -- 項目コード（独自採番、unique）
name / short_name / name_kana
kind                -- single | set（setは子項目をmaster_rad_set_itemsで管理）
-- JJ1017要素（すべてnullable。setは通常NULL）
modality_code       -- 1桁
procedure_major_code / procedure_minor_code / procedure_extension_code   -- 各2桁
body_part_code      -- 3桁
laterality_code     -- 1桁
body_position_code  -- 1桁
direction_code      -- 2桁
detail_position_code / special_instruction_code / nuclide_code           -- 各2桁
generic_extension_code  -- 15-16桁目の拡張(汎用)。既定 "00"
jj1017_code         -- 32桁の生成結果を保存（要素から自動合成、未指定要素は0埋め。
                    --  kind=set はNULL。非unique index）
valid_from / valid_to   -- 有効開始日・有効終了日（date）
receipt_code        -- レセ電算コード（任意、検体検査と同様の紐付け用）
-- オーダー画面の検査目的・特別指示を記入するテンプレート(Questionnaire)の canonical。
-- 撮影項目ごとの既定で、オーダー時に別のテンプレートも選べる（§9.2）。
purpose_template_canonical / remarks_template_canonical
display_order / note
search_name / search_short_name / search_kana

master_rad_set_items               -- セット親子（検体検査のmaster_lab_panel_itemsと同型）
--------------------------------
set_item_code       -- 親（master_rad_items.item_code, kind=set）
member_item_code    -- 子（同, kind=single）
display_order / note
unique index (set_item_code, member_item_code)  ※短縮名 index_rad_set_items_on_set_and_member

master_rad_item_layouts            -- レイアウト（検体検査のlayoutsと同型）
--------------------------------
name (unique) / row_count (default 10) / column_count (default 5)
display_order / active / note      -- MAX_SIZE=50

master_rad_item_layout_cells
--------------------------------
layout_id           -- id参照（レイアウトは全置換しないため。検体検査と同じ判断）
grid_row / grid_column             -- row/columnはPG予約語のためgrid_接頭辞
cell_type           -- item | label
item_code           -- cell_type=item時（master_rad_items.item_code）
display_name        -- 表示名上書き / ラベル文言
unique index (layout_id, grid_row, grid_column)
```

実装メモ:
- **セット構成に `member_type`（必須/任意/条件付き）を持たせなかった**。検体検査のパネルでこの列を
  置いたのは LOINC の R/O/C 区分を写すためで、JJ1017 側に対応する概念が無い。必要になってから足す。
- **32桁コードの桁割り当ては `Master::Jj1017Code` 1か所だけが持つ**（`ELEMENTS` に要素→offset/length）。
  組み立て(`compose`)・分解(`decompose`)・要素コードの桁数検証・拡張範囲の判定・画面が出す
  プレビューまで、すべてこの定義から導く。画面側は桁位置を一切持たない（後述の要素APIで受け取る）。
- 要素名と `master_rad_items` の列名は「要素名 + `_code`」の規則で対応させ、要素の追加を
  `Master::Jj1017Code` 側だけで完結させている。

設計判断:

- **部品コード表を要素別11テーブルではなく1テーブルに統合する**。全要素が同型（コード・名称・英名・備考・Ver）であり、分けると移行・モデル・API・UIが11本並ぶだけになる。統合により拡張コード登録UI／参照APIが「element指定の1エンドポイント」で済む。部位だけ列が多いのでnullable列として持つ（行数は全要素合計でも約1,700件と小さい）。
- **施設拡張コードは同テーブルに `source=local` で同居**させる。インポート（全置換）は `source=official` のみ削除・再投入し、拡張コードを温存する。オーダー項目編集時の要素選択肢はofficial+localを区別なく（バッジ表示のみ）出せる。
- `jj1017_code` を `master_rad_items` に**保存列として持つ**（保存時に要素から再合成）。頻用一括作成時の重複判定・一覧表示・将来のオーダー送出で毎回32桁合成をしなくて済む。
- 検体検査の `execution_type`（院内/外注）は放射線では不要のため持たない。検査分野に相当する分類は `modality_code` がその役割を果たす。
- 超音波画像モード（23–26桁）は列として持たない（利用任意・拡張不可・頻用コードでも全て0）。合成時は `0000` 固定。必要になった時点で列追加。

---

## 4. インポート・seed設計

［提案］検体検査と同じ**HTTP upload方式**（`POST /master/<x>/import` + `MasterImport::*Importer.call(file)`、`MasterImportPage` にMasterType追加）。rakeタスクは作らない。

| Importer | 入力 | 対象 | 方式 |
|---|---|---|---|
| `MasterImport::RadJj1017CodeImporter` | 別表A(.xlsx) / BC / D / E(.xls) の4ファイル | `master_rad_jj1017_codes` | ファイル名やシート名から要素を判定し、**含まれる要素だけ**を全置換（source=officialのみ）。1ファイルずつ4回アップロードで全要素が揃る |
| `MasterImport::RadFrequentCodeImporter` | 別表F(.xls) | `master_rad_jj1017_frequent_codes` | 全置換。32桁でない行はスキップし件数・行番号を戻り値で報告 |

- シート名→要素の対応: `別表A1*`→procedure_major、`別表A2*`→procedure_minor、`別表A3*`→procedure_extension、`別表B*`→body_part（B優先。Cシートは情報が少ない簡易版なので読まない）、`別表D1*`→body_position、`別表D2*`→direction、`別表E1*`→detail_position、`別表E2*`→special_instruction、`別表E3*`→nuclide、`別表F*`→頻用。シート名不一致は `MasterImport::ImportError`。
- 列位置はヘッダ行（「整理番号」〜「コード値」）から動的に特定する（A1の補語列ずれ対策）。コード値空欄行・名称空欄行はスキップ。
- `.xls` 対応のため **Gemfileに `roo-xls` を追加**（要イメージ再ビルド）。
- **種別（modality, 18件）と左右等（laterality, 13件）はExcelに無いため `db/seeds.rb` + `db/seed_data/rad_jj1017_codes.csv` で投入**（source=official扱い）。Ver3.4差分（大分類3Y/4S・拡張LL）も同じCSVに入れる。掲載順は要素ごとの現在の最大値の後ろに積むので、差分コードは取込済みの別表の末尾に付く。

---

## 5. 拡張コード登録UI

［提案］新ページ `/rad-jj1017-codes`（ナビ: 管理 → マスタメンテナンス → 放射線検査 → JJ1017コード）。

- 要素セレクタ（§2.2の表の11要素）＋一覧（コード・名称・英名・Ver・official/localバッジ・検索ボックス、ページネーション）。閲覧は全要素可。
- 「拡張コードを追加」は**拡張可の要素のみ**活性。フォームはコード・名称・（任意で英名・備考）。
- バリデーション（モデル `Master::RadJj1017Code` に実装）:
  - 桁数（要素ごとに1〜3桁）、使用可能文字（数字＋IとOを除く英大文字）
  - **要素ごとの拡張範囲チェック**（§2.2）: 範囲外は保存不可。手技3要素の `J*`/`P*`/`S*` 帯は標準割当領域として保存不可
  - (element, code) の一意性（officialとの衝突も検出される）
  - source=official の行は画面から編集・削除不可
- 削除時は `master_rad_items` の該当要素列を参照して**使用中なら削除不可**（コード疎結合なのでアプリ層でガード）。

API: `resources :rad_jj1017_codes, only: %i[index create update destroy]`（indexは `element` / `code` / `name` / `source` / `modality_use` フィルタ、`flexible_name_match` 利用）＋ collection に `import` / `elements` / `catalog`。

実装メモ: 拡張範囲の判定は「桁数・使用可能文字」「要素ごとの開始位置（§2.2）」「JJ1017 が
標準割当・予約済みの帯（`Z*` 全要素、手技3要素の `J*`/`P*`、手技拡張の `S*`）」の3段で行う。
別表の実データでは特殊指示に既に `A*` の標準コードがあるなど、指針が言う「A0以降が施設用」は
実態として侵食されているため、範囲外を弾くだけでなく **(element, code) の一意制約でも衝突を止める**
二重の作りにしている。取込時に配布ファイルが拡張コードと同じコードを載せてきた場合は、
どのコードが問題かを示して取込ごと止める（片側だけ入った状態を作らない）。

追加した2つの collection API:
- `GET .../elements` — 要素の一覧に **32桁コード内の位置(offset/length)** と拡張範囲・件数を添えて返す。
  画面はこれを使って要素セレクタ・入力の案内・オーダー項目編集画面の32桁プレビューを組み立てる。
- `GET .../catalog` — 全要素のコードを要素名でまとめて返す（ページングなし）。オーダー項目の
  編集画面は11要素すべての選択肢を同時に要するため。全要素あわせても2千件弱なので一括で返す。

---

## 6. 放射線オーダー項目マスタ メンテUI

［提案］`/rad-order-items`。`LabOrderItemPage`（一覧＋`ItemEditModal`）の構成を踏襲。

- 一覧フィルタ: 項目コード（カンマ区切り）・名称（`flexible_name_match`）・種別（modality）・kind・`active=true`（`valid_from <= today <= valid_to`、検体検査と同じ）。
- 編集モーダル:
  - 基本情報: 項目コード・名称・略称・カナ・kind・有効開始/終了日・表示順・備考・レセ電算コード
  - JJ1017要素: 各要素をセレクト/インクリメンタル検索で選択（選択肢は `master_rad_jj1017_codes` を element でフィルタ。部位はモダリティ選択済みなら use_ct 等のフラグで絞り込み候補を優先表示）
  - 32桁コードのリアルタイムプレビュー（未指定要素は0埋めで合成して表示）
  - 「頻用コード表から検索」ボタン → §7の検索モーダルで1件選択すると要素・名称を自動反映（JLACマスタから検索→自動反映と同じUX）
  - kind=set のとき `PanelItemsEditor` 同様の子項目エディタ（単項目をインクリメンタル検索で追加・並べ替え・削除）
- show APIは検体検査と同様に詳細を1リクエストで返す（要素コードに名称をJOINして添付、set_items含む）。destroyはセット行を手動カスケード削除。

API: `resources :rad_order_items, only: %i[index show create update destroy]`、`resources :rad_set_items, only: %i[index create update destroy]`。

---

## 7. 頻用コード表からの一括作成

［提案］`/rad-order-items` 上部に「頻用コード表から一括作成」ボタン → モーダル。

- フィルタ: カテゴリ（F1/F2/F3）・種別（コード1桁目）・キーワード（コード意味、`flexible_name_match`）・部位。一覧はチェックボックス付きページネーション（全ページ横断の選択保持）。
- 実行: 選択行をサーバへPOST → 各32桁コードを§2.1の割当てで**要素に分解**し、`master_rad_items` を kind=single で一括作成。
  - name=コード意味（50字超は切詰めず全文）、short_name=空、valid_from=当日
  - item_code は自動採番（数値連番。既存最大値+1から）
  - **既存 `jj1017_code` と一致する行はスキップ**し、結果（作成N件・スキップM件・エラー）を返す
  - 分解時に部品コード表に存在しないコードが混じっていた場合もスキップせず作成する（要素コード自体は保持し、警告として返す）——頻用表はVer3.3、部品表の取込漏れがあり得るため

API: `post :bulk_create_from_frequent`（`rad_order_items` の collection）、頻用検索は `resources :rad_frequent_codes, only: %i[index]`。

---

## 8. 放射線オーダーレイアウト

［提案］検体検査レイアウトの**同型移植**。`/rad-order-item-layouts`。

- テーブルは§3の2表（構造は `master_lab_order_item_layout*` と同一、参照コードが `item_code` になるのみ）。
- モデル制約も同一: MAX_SIZE=50、cell_typeごとの必須項目、layout範囲内チェック、行列縮小時の範囲外セル削除（`removed_cells` 返却）、セル移動時の占有セルswap。
- UI: `LabOrderItemLayoutPage`（レイアウト選択→`LayoutEditor`（グリッド＋ドラッグ&ドロップ）→`CellEditor`）を流用実装。
- オーダー入力画面での消費（activeなレイアウト→タブ表示、セット項目の事前展開）は§9。

API: `resources :rad_item_layouts, only: %i[index show create update destroy]`、`resources :rad_item_layout_cells, only: %i[create update destroy]`。

実装メモ: レイアウト編集の見た目は検体検査と共通なので、CSSクラスは `rad-layout__*` を新設せず
`lab-layout__*` → **`order-layout__*`** に改名して共用した（オーダー入力側も同様に
`lab-order-panel__*` → `order-select__*`）。

---

## 9. オーダー入力画面とFHIR表現（実装済み）

検体検査オーダーと同型。カルテ右ペインの「放射線検査」から登録し、カードの
DO / 編集 / 詳細表示 / FHIR JSON表示 / 削除も検体検査と同じ導線で動く。

### 9.1 FHIR の構造

［提案］ヘッダも明細も ServiceRequest。検体検査とまったく同じ親子関係にする。

```text
ヘッダ ServiceRequest（category に order-type=rad）
  ← basedOn ── 明細（単項目・セット）
                 ← basedOn ── セットの構成項目
```

明細1件の中身:

| FHIR要素 | 入れるもの |
|---|---|
| `code.coding` | 独自項目コード（`.../CodeSystem/rad-order-item`）、**JJ1017-32**、**JJ1017-16M**（前半16桁）、**JJ1017-16S**（後半16桁）、略称 |
| `code.text` | 項目名称 |
| `category` | 種別（モダリティ）。`.../CodeSystem/jj1017-modality` |
| `bodySite` | 部位（`.../CodeSystem/jj1017p`）＋左右（`.../CodeSystem/jj1017-laterality`）、`text` は「右 膝関節」 |
| `identifier` | 伝票で選んだ並び順（`.../IdSystem/rad-order-item-number`） |
| `reasonReference` / `reasonCode` | 依頼病名。登録病名から選んだなら Condition 参照、フリーテキストなら `reasonCode.text`（GP を表す明細のみ） |
| `extension[rad-exam-purpose]` | 検査目的（GP を表す明細のみ） |
| `note` | 特別指示（GP を表す明細のみ） |
| `extension[rad-exam-purpose-questionnaire-response]` / `[rad-remarks-questionnaire-response]` | テンプレートから記載した場合の記入内容（QuestionnaireResponse）への参照 |

- ［事実］**JJ1017 には FHIR 用の公式 system URI が無い**。JP Core の ImagingStudy Radiology Profile は
  `bodySite` に「JJ1017P の小部位コードの利用を許容する」、`laterality` に「JJ1017P の左右コードの利用を
  許容する」と書くだけで、URI は定義していない（`procedureCode` は RadLex にバインド）。
  そのため他のローカルコードと同じ `fhir-client.local` の URI を使い、末尾は JJ1017 指針が定める
  符号化系指定子（JJ1017-32 / JJ1017-16M / JJ1017-16S / JJ1017P）に合わせた。
- ［導出］**16M / 16S も併記する**のは、DICOM の符号値が16バイト上限で、受け手の RIS が前半を
  予約済みプロトコル符号シーケンス、後半をプロトコル コンテキスト シーケンスに載せ替えるため
  （指針 4.2 / 5.2）。復元は JJ1017-32 だけから行い、16M/16S は導出値として書くだけ。
- ［導出］**部位・左右を bodySite にも出す**のは、JP Core が同時に「JJ1017 は手技のほか部位・左右も
  含むので bodySite・laterality との整合に注意」と述べているため。32桁コードと同じ値をそのまま出す
  ことで、二重に持ちながら食い違わないようにしている。
- セット（kind=set）は撮影そのものではないので **JJ1017 コードを持たない**。構成項目がそれぞれ持つ。
- `orderDetail` は使わない。撮影条件（体位・方向・詳細体位・特殊指示・核種）は32桁コードに
  含まれており、要素を個別に並べても JJ1017 を解さない受け手には意味が伝わらないため。
- ［提案］**依頼病名・検査目的・特別指示は GP 単位**（単項目ならその項目、セットならセット親）
  の明細に載せる。構成項目には載せない。
  - 特別指示は `note`（Annotation は「その依頼へのコメント」そのもの）。
  - 検査目的は当てはまる標準要素が無い（`reason*` は依頼病名で使う）ので
    `.../StructureDefinition/rad-exam-purpose` のローカル拡張にした。

### 9.2 画面

［提案］`RadOrderForm`。検体検査の `LabOrderForm` と同じ構成だが、**まとめる単位が違う**。
検体検査は検体（採血管）ごとに GP をまとめるのに対し、放射線は **1 GP = 撮影項目 1 つ**、
ただし**セットは親を 1 GP とし、構成する撮影を GP の中身として並べる**。

- 検査共通: 対象プロブレム / 入外区分 / 至急区分 / 撮影日 / ＋依頼コメント（オーダー全体への申し送り）
- 項目選択: activeなレイアウトをタブに並べ（伝票のマスにチェックボックス）＋「撮影項目検索」タブ
- セットを選ぶと構成項目をマスタから引いて自動展開。伝票上のチェックも連動し、構成項目だけを
  外せばそのセットからその撮影を除いてオーダーできる（検体検査のパネルと同じ挙動）
- GP ごとに **依頼病名 / 検査目的 / 特別指示** を入力する
  - 依頼病名: 登録病名（プロブレム＋レセプト病名）のセレクトか直接入力。セレクトで選ぶと
    文字列も入り、手で書き換えると Condition との紐付けは外れる（別の文言になるため）
  - 検査目的・特別指示: 直接入力に加えて「テンプレート」ボタンで診療記録（SOAP）と同じ
    テンプレート記入モーダルを開ける。撮影項目マスタに既定テンプレートがあれば最初から選択済み。
    テンプレートから記載した欄は**直接編集不可**になり、直すときは「テンプレート編集」で
    記入内容を開き直す（SOAP のセクションと同じ扱い）。「解除」で紐付けを外すと、記載された
    文言を残したまま直接入力へ戻せる（SOAP には無い操作。放射線は欄単位なので、
    セクションごと消して作り直すという逃げ道が無いため用意した）
- 選んだ項目はマスタの写し（`RadOrderItemLine`）。マスタを直しても過去のオーダーは変わらない
- GP の種別（モダリティ）表示は、セット自身が種別を持たないので構成項目から採る

実装メモ: テンプレート記入の内容は **QuestionnaireResponse として保存**し、明細から拡張で参照する。
保存は診療記録と同じくオーダー本体と同じ transaction Bundle で行う（先に単独 POST しない
＝オーダーを保存しなかったときに回答だけ残る孤児を作らない）。参照が外れた回答は、元の参照との
差分で同じ transaction の中で DELETE する。オーダーを消すときも参照先の回答を一緒に消す。

DO（複写して新規登録）ではテンプレートの紐付けを外す。同じ回答を 2 つのオーダーが指すと、
片方を書き換えたときにもう片方まで変わってしまうため。記載された文言は残るので、DO 先では
フリーテキストとして直せる。

テンプレート記入モーダルは診療記録と共用するので、名前から領域名を外して
`ClinicalNoteTemplateModal` → **`TemplateEntryModal`**、記入内容の型も
`ClinicalNoteTemplateDraft` → **`TemplateDraft` / `TemplateBinding`**（`questionnaireResponseHelpers`）に移した。

マスタ側（`/rad-items` の編集モーダル「既定のテンプレート」）は撮影項目ごとに検査目的・特別指示の
既定テンプレートを持つ。値は Questionnaire の canonical（`master_rad_items.purpose_template_canonical` /
`remarks_template_canonical`）。id ではなく canonical にしたのは、テンプレートを作り直しても
指し先が変わらないようにするため（`QuestionnaireResponse.questionnaire` と同じ形）。

追加ファイル: `fhir/radOrderHelpers.ts`、`components/RadOrderForm.tsx` /
`RadOrderPanels.tsx` / `RadOrderDetailPanel.tsx`、`hooks/useRadOrderInitialValues.ts` /
`useConditionOptions.ts`、`api/queries.ts` に `useRadOrderDetail` / `useDeleteRadOrder`。
`TemplateEntryModal`（旧 `ClinicalNoteTemplateModal`）には既定テンプレートを最初から選ぶ
`defaultCanonical` を足した。
カルテ側は `karteTimeline.ts` に `rad-order` 種別を足し、`KarteRightPane` / `KarteTimeline` /
`KarteCardModals` / `karteUrl` / `KartePage` に検体検査と同じ分岐を追加。

タイムラインの取得は既存のまま。`based-on:missing=true` でヘッダだけを1ページの対象にし、
明細は `_revinclude:iterate=ServiceRequest:based-on` で同じ応答に添えてもらう作りが
オーダー種別に依存しないため、放射線オーダーはそのまま乗った。

### 9.3 検証したこと

開発環境で、セット＋CT の4項目を登録 → カード表示 → 詳細表示 → 編集（構成項目を1件外し、
CTを1件追加）→ DO → 削除、まで通した。編集では PUT / POST / DELETE が混在した transaction
になり、外した明細がサーバーから消え、親を失った明細（孤児）が残らないことを確認した。

---

## 10. 次フェーズへの申し送り

1. **実施・結果**: 撮影実績（ImagingStudy）と読影レポート（DiagnosticReport Radiology Profile）は未実装。
   検体検査でいう「検査結果」に相当し、カードの「検査結果表示」導線も放射線には無い。
   JP Core は ImagingStudy に `bodySite` / `laterality` / `procedureCode` を定義しているので、
   §9.1 と同じコードをそのまま渡せる想定。
2. **会計連携**: `receipt_code` 列は用意するが、レセ電算コードとの対応付け運用は未設計。
3. **Ver3.4別表の正式取込**: Excel配布が確認できず、当面Ver3.3＋差分seedで運用。JSRT（office@jsrt.or.jp）にVer3.4のExcel/CSV配布有無を確認する価値あり。
4. **放射線治療オーダー**: 頻用F3・治療系コードは取込対象に含めるが、照射指示（回数・線量分割等）のオーダー属性はJJ1017の範囲外であり別途設計が必要。
5. **JJ1017 の system URI**: 公式 URI が定義されたら `radOrderHelpers.ts` の定数を差し替える
   （読み出しは system 一致で引いているので、移行時は旧 URI も読む分岐が要る）。

---

## 11. 実装したもの（マスタ）

| 層 | 追加物 |
|---|---|
| migration | `20260809100000` JJ1017部品コード / `100100` 頻用コード / `100200` オーダー項目＋セット構成 / `100300` レイアウト＋セル |
| モデル | `Master::Jj1017Code`（桁割り当て・組立/分解・拡張範囲の定義）、`RadJj1017Code` / `RadJj1017FrequentCode` / `RadItem` / `RadSetItem` / `RadItemLayout` / `RadItemLayoutCell` |
| 取込 | `MasterImport::ExcelSource`（.xls/.xlsx 共通の入口）、`RadJj1017CodeImporter` / `RadFrequentCodeImporter`。Gemfile に `roo-xls`（**イメージ再ビルド必要**） |
| seed | `db/seed_data/rad_jj1017_codes.csv`（種別18・左右13・Ver3.4差分3）。**別表A を取り込み直したら `db:seed` を再実行する** |
| API | `rad_jj1017_codes`（+import/elements/catalog）、`rad_frequent_codes`（+import）、`rad_items`（+bulk_create_from_frequent）、`rad_set_items`、`rad_item_layouts`、`rad_item_layout_cells` |
| 画面(マスタ) | `/rad-jj1017-codes`、`/rad-items`、`/rad-item-layouts`、マスタ取込に2種別追加。ナビは 管理 → マスタメンテナンス → 放射線検査 |
| 画面(オーダー) | カルテ右ペインの「放射線検査」。§9 参照 |
| spec | 取込2本・リクエスト5本（backend 全546 examples green） |

ついでに直したもの: レイアウト編集の CSS クラスを `lab-layout__*` → `order-layout__*` に改名した
（検体検査・放射線で同じ見た目を使うため、クラス名から領域名を外した）。

運用手順（初回）:
1. マスタ取込で「JJ1017コードマスタ」に別表A・BC・D・E を**1ファイルずつ4回**取り込む
2. 同じく「JJ1017頻用コード集」に別表F を取り込む
3. `db:seed`（種別・左右・Ver3.4差分。手順1の後に実行する）
4. `/rad-items` の「頻用コード表から一括作成」で初期項目を作る → `/rad-item-layouts` で伝票を組む

---

## 付録: 一次資料

- [JSRT JJ1017ページ](https://www.jsrt.or.jp/97mi/content/jj1017.html)
- [JJ1017指針 Ver3.4（2024）本文PDF](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_guideline.pdf) — §5.2 コード構造（表5.1）、§5.4.2/5.5.3/5.6.2/5.7.2 拡張方法、表5.2 種別、表5.5 左右
- [JJ1017 Ver3.4 別表PDF](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_table.pdf) / [概要説明（3.3→3.4差分）](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_summary.pdf)
- 配布別表 Ver3.3 Excel（`backend/tmp/master-data/jj1017/`、2018-06-24）
- 検体検査側の先行設計: `docs/lab-order-master-design.md`、実装 `backend/db/schema.rb`（`master_lab_*`）
