# JJ1017をベースとした放射線検査オーダーマスタの設計

調査日: 2026-08-09。JJ1017指針 Ver3.4（2024）本文および配布別表（Ver3.3 Excel）を一次資料として確認済み。

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

オーダー発行（ServiceRequest化）・会計連携・FHIA表現は次フェーズ（§9）。

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
display_order / note
search_name / search_short_name / search_kana

master_rad_set_items               -- セット親子（検体検査のmaster_lab_panel_itemsと同型）
--------------------------------
set_item_code       -- 親（master_rad_items.item_code, kind=set）
member_item_code    -- 子（同, kind=single）
display_order
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
- **種別（modality, 18件）と左右等（laterality, 13件）はExcelに無いため `db/seeds.rb` + `db/seed_data/rad_jj1017_modalities.csv` / `rad_jj1017_lateralities.csv` で投入**（source=official扱い、既存行は上書きしない検体採取管と同方式）。Ver3.4差分（大分類3Y/4S・拡張LL）も同様に差分seed CSVで補う。

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

API: `resources :rad_jj1017_codes, only: %i[index create update destroy]`（indexは `element` / `name` / `source` フィルタ、`flexible_name_match` 利用）。

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
- UI: `LabOrderItemLayoutPage`（レイアウト選択→`LayoutEditor`（グリッド＋ドラッグ&ドロップ）→`CellEditor`）を流用実装。CSSクラスは `rad-layout__*`。
- オーダー入力画面での消費（activeなレイアウト→タブ表示、セット項目の事前展開）は放射線オーダー入力フェーズで検体検査の `LabOrderForm` パターンを踏襲予定。

API: `resources :rad_item_layouts, only: %i[index show create update destroy]`、`resources :rad_item_layout_cells, only: %i[create update destroy]`。

---

## 9. 次フェーズへの申し送り（本設計のスコープ外）

1. **オーダー発行のFHIR表現**: ServiceRequest.code に 独自項目コード（`http://fhir-client.local/CodeSystem/rad-order-item`）＋JJ1017-32 の並記を想定。JJ1017の標準system URI（JP Core / JAHIS放射線データ交換規約での定義有無）は要調査。セットは検体検査同様 basedOn 連鎖で表現できる見込み。
2. **会計連携**: `receipt_code` 列は用意するが、レセ電算コードとの対応付け運用は未設計。
3. **Ver3.4別表の正式取込**: Excel配布が確認できず、当面Ver3.3＋差分seedで運用。JSRT（office@jsrt.or.jp）にVer3.4のExcel/CSV配布有無を確認する価値あり。
4. **放射線治療オーダー**: 頻用F3・治療系コードは取込対象に含めるが、照射指示（回数・線量分割等）のオーダー属性はJJ1017の範囲外であり別途設計が必要。

---

## 10. 実装ステップ（PR分割案）

1. **PR1: JJ1017取込基盤** — migration（`master_rad_jj1017_codes` / `master_rad_jj1017_frequent_codes`）、`roo-xls` 追加（イメージ再ビルド）、Importer 2本＋spec（fixture: 各別表の縮小版xls/xlsx）、seed（種別・左右・Ver3.4差分）、MasterImportPageへの追加
2. **PR2: 拡張コードUI** — `Master::RadJj1017Code` の拡張バリデーション、`rad_jj1017_codes` API＋spec、`/rad-jj1017-codes` ページ
3. **PR3: オーダー項目マスタ** — migration（`master_rad_items` / `master_rad_set_items`）、モデル（32桁合成・有効期間バリデーション）、API＋spec、`/rad-order-items` ページ（編集モーダル・セットエディタ・頻用検索モーダル）
4. **PR4: 頻用一括作成** — `bulk_create_from_frequent` API＋spec、一括作成モーダル
5. **PR5: レイアウト** — migration（layouts/cells）、API＋spec、`/rad-order-item-layouts` ページ

---

## 付録: 一次資料

- [JSRT JJ1017ページ](https://www.jsrt.or.jp/97mi/content/jj1017.html)
- [JJ1017指針 Ver3.4（2024）本文PDF](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_guideline.pdf) — §5.2 コード構造（表5.1）、§5.4.2/5.5.3/5.6.2/5.7.2 拡張方法、表5.2 種別、表5.5 左右
- [JJ1017 Ver3.4 別表PDF](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_table.pdf) / [概要説明（3.3→3.4差分）](https://www.jsrt.or.jp/97mi/content/jj1017/v3_4_2024/jj1017_v3_4_2024_summary.pdf)
- 配布別表 Ver3.3 Excel（`backend/tmp/master-data/jj1017/`、2018-06-24）
- 検体検査側の先行設計: `docs/lab-order-master-design.md`、実装 `backend/db/schema.rb`（`master_lab_*`）
