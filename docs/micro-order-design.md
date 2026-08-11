# JANISをベースとした細菌検査（微生物検査）オーダーの設計

設計日: 2026-08-11。JANIS（厚生労働省 院内感染対策サーベイランス）検査部門のコード表
（https://janis.mhlw.go.jp/section/kensa.html）を主要マスタとして採用する。

**マスタ取込は実装済み（2026-08-11）**。実データで検証済み: 感染症病原体コード 554件
（Ver.6.1シート、スキップ0）、材料コード 50件（スキップ0）。設計から変えた点は
各節の「実装メモ」に記載。

本文中の区別:
- **［事実］** = 公式資料・リポジトリ内の実装で確認した内容
- **［導出］** = 仕様・既存実装から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計提案
- **［決定］** = 設計検討（2026-08-11）でユーザーと合意済みの内容

---

## 1. スコープ

- 細菌検査オーダーのマスタ（`master_micro_*`）と取込・メンテUI
- オーダー入力画面とFHIR表現（検体検査・放射線オーダーと同じカルテ導線）

スコープ外（［決定］）:

- **迅速抗原・毒素・PCR・核酸増幅系はすべて検体検査オーダー側**で扱う。
  TB-PCR / MAC-PCR、CDトキシン、尿中抗原（肺炎球菌・レジオネラ）等を含む。
  判断基準は「培養・鏡検のワークフローに乗るか」。結果が定性（陽性/陰性）中心のものは
  検体検査結果の仕組みで表現できるため。
- 細菌検査の**結果**（培養結果・菌の同定・薬剤感受性成績）は次フェーズ（§8）。
- JANISへの提出ファイル生成は将来課題（§8）。マスタをJANIS系で持つのはその布石。

---

## 2. 決定事項と経緯

［決定］設計検討で確定した主要判断:

| 論点 | 決定 | 理由 |
|---|---|---|
| オーダー構造 | **1オーダー＝1検体** | フォームが平坦でシンプル。オーダー＝検体＝依頼書1枚となり中止・変更・結果紐付けの単位が一致。データ構造だけは複数検体グループを持てる形を残す（§7.1） |
| 検体種別コード | **JANIS材料コードを主**とする。JLAC11材料コードは併記しない | 検体検査オーダーから切り出した独立機能とするため。JANIS提出を見据えると主はJANISが良い |
| 血液培養 | **特殊処理なし**。好気ボトル・嫌気ボトルを通常の検査項目として選択し、セットを分けたいときはオーダーを分ける | セット展開・ボトルペアのバリデーション等の専用機能は作らない。「前回コピー（DO）」で2セット目の入力の手間を緩和 |
| 抗酸菌検査 | 「抗酸菌塗抹」「抗酸菌培養」の**2項目**に分ける。核酸増幅は検体検査側 | 染色法・培地・算定とも一般細菌と別。同定・感受性は培養陽性後に検査室が進めるためオーダー項目にしない |
| 臨床情報 | 疑い病名・**前投与抗菌薬**・**検査目的区分（診断/監視培養）**・コメントを持つ | 前投与抗菌薬は培養結果の解釈に必須級。目的区分は感受性実施判断等に影響 |
| 前投与抗菌薬の入力 | 「処方から取り込み」＋自由テキスト。**JANIS抗菌薬コードへの構造化はしない** | YJ/レセ電算→JANIS抗菌薬コードの公的対応表が存在せず自動変換不可（§3.3）。検査室が読むのはテキストで十分 |
| テーブル接頭辞 | **`master_micro_*`**（`master_mic_*` にしない） | 微生物検査ドメインで MIC＝最小発育阻止濃度と衝突するため。`micro` が慣用略語 |

喀痰の抗酸菌検査で塗抹＋培養＋PCRを同時依頼する場合、医師は細菌検査と検体検査の
2画面をまたぐ。これは機能を切り出す方針のトレードオフとして許容する（［決定］）。

---

## 3. JANISコード表の要点

### 3.1 提供されているコード表

［事実］検査部門ページで配布されているコード表（Excel）:

| コード表 | 版 | 本設計での用途 |
|---|---|---|
| 感染症病原体コード（菌名コード） | Ver6.1（2023-01） | **目的菌**の選択肢 |
| 抗菌薬コード | Ver5.2（2023-01） | 初期は未使用。将来の前投与抗菌薬構造化・感受性結果で使用（§8） |
| 薬剤感受性測定方法コード | Ver4.0（2023-01） | 初期は未使用。感受性**結果**側で使用（§8） |
| 材料（検体種別）コード | Ver1.0（2007-07） | **検体種別**の選択肢 |
| 部門コード／疾患分類コード／治療部位コード／転帰コード | Ver1.0 | 未使用（検査部門以外の部門向け） |

### 3.2 JANISで賄えないもの（独自マスタが必要）

［事実］JANISは**結果報告用**のコード体系であり、オーダーに必要な以下の概念を持たない:

- 採取部位・左右（治療部位コードはICU部門等の報告用で用途が違う）
- 採取方法
- 検査項目の区分（塗抹/培養/感受性…という「何を依頼するか」）

これらは独自マスタとして持つ（§4）。

### 3.3 制約・注意

- ［事実］感染症病原体コードは数千件規模でウイルス等も含む。目的菌の選択肢は
  **頻用サブセット＋全件検索**の二段構えにする（§7.2）。
- ［事実］JANIS抗菌薬コードは成分単位の略号（ABPC、CEZ…）であり、処方の薬剤コード
  （YJ/レセ電算）との公的対応表は存在しない。前投与抗菌薬の自動コード化はできない。
- ［導出］抗菌薬の判定（処方からの取り込み候補の絞り込み）は薬効分類で行う。
  薬効分類は `master_medicines.yakka_code` の上4桁から導出でき（`medicines_controller.rb` 実装済み）、
  上位分類 61x（抗生物質製剤）・622（抗結核剤）・624（合成抗菌剤）を抗菌薬とみなす。

---

## 4. データモデル

［提案］既存規約を踏襲: `master_` 接頭辞・**FKなし（コードで疎結合）**・`Master::` 名前空間・
`Master::SearchNormalizer` による search_* 列・配布マスタは official のみ全置換（local温存）。

```text
master_micro_specimen_types        -- 検体種別（JANIS材料コード、取込）
--------------------------------
code                -- JANIS材料コード（3桁）。unique
name                -- 検査材料名
category            -- 系統（口腔・気道・呼吸器 / 泌尿器・生殖器 など）
source              -- official | local（施設追加分）
display_order
search_name         -- name + category

master_micro_organisms             -- 目的菌（JANIS感染症病原体コード、取込）
--------------------------------
code                -- JANIS病原体コード（4桁）。unique
name                -- 菌名（概ね学名。一部に和名・注記つき）
frequent            -- boolean。頻用菌（オーダー画面に直接表示するサブセット）
source              -- official | local
display_order
search_name

master_micro_collection_sites      -- 採取部位（独自、seed＋画面メンテ）
--------------------------------
code                -- 独自採番。unique
name
laterality_applicable   -- boolean。左右の入力を有効にするか
display_order
search_name

master_micro_collection_methods    -- 採取方法（独自、seed＋画面メンテ）
--------------------------------
code                -- 独自採番。unique
name
display_order

master_micro_order_items           -- 検査項目（独自、seed＋画面メンテ）
--------------------------------
item_code           -- 独自採番。unique
name
short_name
display_order
valid_from / valid_to   -- 有効期間（date、検体検査・放射線と同じ）
receipt_code        -- レセ電算コード（任意、将来の会計連携用）
note
search_name
```

初期の検査項目（seed。［決定］の項目構成）:

| item_code | name |
|---|---|
| 1 | 塗抹・鏡検 |
| 2 | 培養・同定 |
| 3 | 薬剤感受性 |
| 4 | 嫌気性菌培養 |
| 5 | 真菌培養 |
| 6 | 抗酸菌塗抹 |
| 7 | 抗酸菌培養 |
| 8 | 血液培養（好気ボトル） |
| 9 | 血液培養（嫌気ボトル） |

設計判断:

- **検査項目は9項目の固定的な小マスタ**なので、検体検査・放射線のような
  レイアウト（伝票）機能は作らない。オーダー画面にはチェックボックスを直接並べる。
- **セット/パネル機能も作らない**。血液培養を特殊処理なしとした（［決定］）ため、
  現時点でセットを要する項目がない。必要になったら `master_rad_set_items` と同型で足す。
- **検体種別×検査項目の組合せ制約は持たない**（血液培養ボトル項目を血液以外で選べてしまうが、
  バリデーションは作らない方針に含める）。運用で問題になったら警告表示から検討する。
- 抗菌薬マスタ（`master_micro_antimicrobials`）は**初期は作らない**。前投与抗菌薬を
  テキストで持つ決定（§2）のため。感受性結果・JANIS提出のフェーズで追加する（§8）。

---

## 5. インポート・seed設計

［提案］既存と同じ**HTTP upload方式**（`POST /master/<x>/import` + `MasterImport::*Importer.call(file)`、
`MasterImportPage` にMasterType追加）。rakeタスクは作らない。

| Importer | 入力 | 対象 | 方式 |
|---|---|---|---|
| `MasterImport::MicroSpecimenTypeImporter` | JANIS材料コード表（specimenentitytype_*.xls） | `master_micro_specimen_types` | source=official のみ全置換（local温存） |
| `MasterImport::MicroOrganismImporter` | JANIS感染症病原体コード表（infectiousagentcode_*.xls） | `master_micro_organisms` | 同上。**frequent 列は取込で上書きしない**（コードをキーに温存） |

- 配布ファイルは `.xls` → `roo-xls` はJJ1017取込で導入済み（［事実］）。
  `MasterImport::ExcelSource` を流用する。
- **列位置はヘッダ行から動的に特定する**（JJ1017別表Aと同じ対策）。コード欠落・
  名称欠落・重複の行はスキップし件数を報告する。

実装メモ（実ファイルで確認した構成）:

- 病原体コード表は**版ごとのシート**（"Ver.2.1"〜"Ver.6.1"。"Ver.3.0、3.1" のような
  相乗りもある）を持つ。シート名の版番号が最も新しいシートだけを読み、読んだ
  シート名を取込結果として画面に返す。列は「コード / 菌名」の2列
  （3列目は "2023.01追加" のような追加時期の注記のため読まない）。
- 材料コード表は1シートで、タイトル行・空行の後に「系統 / コ－ド番号 / 検査材料名」の
  ヘッダー行が来る。見出しの「コ－ド」は長音記号なので正規化後も揺れを許容して
  列を特定する。系統は結合セル風に先頭行にだけ入っているため、空欄行は直前の値を
  引き継ぐ。コードは数値セル（Float）なので文字列に畳む。
- 施設追加コード（local）と同じコードを配布ファイルが載せてきた場合は、どのコードが
  問題かを示して**取込ごと止める**（JJ1017部品コード取込と同じ判断。片側だけ
  入った状態を作らない）。
- 取込・検索APIは `POST/GET /master/micro_specimen_types(/import)` /
  `/master/micro_organisms(/import)`。編集UIが未実装のため当面 index + import のみ。
- 採取部位・採取方法・検査項目は `db/seeds.rb` + `db/seed_data/micro_*.csv` で初期投入し、
  以後は画面メンテ（§6）。**施設で直す前提の初期値なので、既存行は上書きしない**
  （採取管マスタと同じ判断）。投入済みの初期値: 検査項目9件（§4の表）、
  採取部位20件（咽頭・鼻腔・耳・眼・創部・肘正中皮静脈・中心静脈カテーテル等、
  左右あり8件）、採取方法11件（スワブ・穿刺・吸引・導尿等）。

---

## 6. マスタメンテUI（実装済み）

ナビ: 管理 → マスタメンテナンス → 細菌検査。

- `/micro-organisms` — 病原体コード一覧（検索・ページネーション、official/localバッジ）。
  **frequent フラグは一覧のチェックボックスで直接切り替える**（頻用菌の指定が主用途）。
  行クリックでの編集・削除は local 行のみ。標準行の update はサーバー側でも
  frequent 以外を受け付けない。
- `/micro-specimen-types` — 検体種別一覧（系統列つき）。local の追加・編集・削除。
- `/micro-order-items` — 検査項目・採取部位・採取方法の3小マスタをタブでまとめる
  （いずれも数十件規模のため専用ページを分けない。検査項目の編集モーダルに
  有効開始/終了日を持ち、廃止は削除ではなく有効終了日で行う）。
- マスタ取込（`MasterImportPage`）に「JANIS材料コード」「JANIS病原体コード」の2種別を追加。
  病原体コードの取込結果には読んだ版シート名（例: Ver.6.1）を表示する。

API: `resources :micro_specimen_types / :micro_organisms / :micro_order_items /
:micro_collection_sites / :micro_collection_methods`（index/create/update/destroy、
取込対象2つは collection に `import`）。削除時はオーダーがコード疎結合のため
アプリ層での使用中ガードは行わず、有効期間（検査項目）と表示順で運用する。

---

## 7. オーダー入力画面とFHIR表現

### 7.1 FHIRの構造

［提案］検体検査・放射線とまったく同じ親子関係にする。

```text
ヘッダ ServiceRequest（category に order-type=micro）
  ← basedOn ── 検体グループ明細（contained Specimen を持つ）
                 ← basedOn ── 検査項目明細
```

**UIは1オーダー＝1検体に制限するが、FHIR構造は検体グループ層を残す**（［決定］）。
後から複数検体UIに拡張してもデータ移行が発生しないようにするため。
タイムラインは `based-on:missing=true` + `_revinclude:iterate` の既存取得方式が
オーダー種別非依存のため、`karteTimeline.ts` に kind `"micro-order"` を足すだけで乗る（［事実］）。

ヘッダ ServiceRequest:

| FHIR要素 | 入れるもの |
|---|---|
| `category` | `.../CodeSystem/order-type` の `micro`（細菌検査） |
| `reasonReference[0]` | 対象プロブレム（Condition参照。既存オーダー共通） |
| `note` | 依頼コメント |
| `extension[micro-prior-antimicrobial]` | 前投与抗菌薬（valueString。「処方から取り込み」も最終的に文字列） |
| `extension[micro-exam-purpose]` | 検査目的区分（valueCode: `diagnostic` / `surveillance`） |
| 入外区分・至急区分・依頼日 | 既存オーダーと同じ表現 |

検体グループ明細 ServiceRequest:

| FHIR要素 | 入れるもの |
|---|---|
| `specimen` | contained Specimen（id=`"specimen"`）への内部参照。検体検査の方式を踏襲（［事実］`labOrderHelpers.ts` 実装済みパターン） |
| `occurrenceDateTime` | 採取予定日時 |
| `orderDetail` | **目的菌**（複数可）。coding は `.../CodeSystem/janis-organism` |
| `reasonReference` / `reasonCode` | 疑い病名。登録病名から選んだら Condition 参照、フリーテキストなら `reasonCode.text`（［事実］放射線の実装済みパターン） |

contained Specimen（JP_Specimen_Common）:

| FHIR要素 | 入れるもの |
|---|---|
| `type` | 検体種別。`.../CodeSystem/janis-specimen-type` |
| `collection.bodySite` | 採取部位（`.../CodeSystem/micro-collection-site`）＋左右（`.../CodeSystem/micro-laterality`）、`text` は「右 耳」形式（放射線bodySiteと同じ組み方） |
| `collection.method` | 採取方法（`.../CodeSystem/micro-collection-method`） |
| `status` | 付けない（未採取のため。検体検査と同じ判断） |

検査項目明細 ServiceRequest:

| FHIR要素 | 入れるもの |
|---|---|
| `code.coding` | 検査項目コード（`.../CodeSystem/micro-order-item`） |
| `code.text` | 項目名称 |

- ［導出］採取予定日時を `Specimen.collection.collectedDateTime` にしないのは、
  collectedは「実際に採取した日時」であり予定と意味が異なるため。予定は依頼側の
  `occurrenceDateTime` が該当する。
- ［提案］目的菌に `orderDetail` を使うのは「オーダーの追加指示」という定義そのもののため。
  放射線が `orderDetail` を使わなかったのは撮影条件が32桁コードに内包されていたからで、
  判断は矛盾しない。
- ［提案］検査目的区分は放射線の `rad-exam-purpose`（自由文字列）と異なり**2値コード**なので、
  同名でも valueString ではなく valueCode の別拡張として定義する。
- 明細は検体検査・放射線と同様「オーダー時点のマスタの写し」として保持し、
  マスタ変更が過去オーダーに波及しないようにする。

### 7.2 画面

［提案］`MicroOrderForm`。カルテ右ペインに「細菌検査」を追加し、
カードの DO / 編集 / 詳細表示 / FHIR JSON表示 / 削除は既存オーダーと同じ導線。

- **検査共通**: 対象プロブレム / 入外区分 / 至急区分 / 依頼日 / 依頼コメント
- **検体**: 検体種別（セレクト＋検索）/ 採取部位（セレクト。`laterality_applicable` の部位を
  選んだときだけ左右セレクトを活性化）/ 採取方法 / 採取予定日時
- **検査項目**: 9項目のチェックボックス（レイアウト機能なし、§4）
- **目的菌**: `frequent=true` の菌をチェックボックスで直接表示＋「その他の菌を検索」で
  全件検索モーダル（複数選択）
- **臨床情報**:
  - 疑い病名: 放射線と同じ `useConditionOptions`（プロブレム＋レセプト病名の候補）＋直接入力
  - 前投与抗菌薬: テキスト入力＋「処方から取り込み」ボタン。患者の処方・注射
    （ServiceRequest＋MedicationRequest）を取得し、薬剤コードで医薬品マスタを引いて
    薬効分類 61x/622/624 に該当するものを候補表示 →選択すると「薬品名（開始日〜）」を
    整形してテキストに挿入。**「現在投与中」の厳密判定はしない**
    （`MedicationRequest.status` が常に active のため。直近の抗菌薬オーダーを
    新しい順に出す程度の割り切り）
  - 検査目的区分: ラジオ（診断目的 / 監視培養）
- DO（前回コピー）は既存と同じ。血液培養の2セット目は「DOして採取部位を変える」運用（§2）

### 7.3 タイムライン・カード

- `karteTimeline.ts` に kind `"micro-order"` を追加、`KarteRightPane` / `KarteTimeline` /
  `KarteCardModals` / `karteUrl` / `KartePage` に既存オーダーと同じ分岐を追加。
- カード表示: 検体種別＋採取部位を見出しに、検査項目・目的菌・疑い病名を本文に出す。

---

## 8. 未決事項・次フェーズへの申し送り

1. **定量培養の指定**（尿・BALの菌数定量）: 初期実装では持たない。必要ならコメント欄で
   運用し、恒常化したら「培養・同定」のオプションまたは独立項目として追加する。
2. **感染対策情報**（耐性菌検出歴・保菌歴）の専用欄: 初期実装では持たない。コメント欄で運用。
3. **結果側**: 塗抹結果・培養/同定結果（菌名=JANIS病原体コードが使える）・薬剤感受性成績
   （抗菌薬コード・感受性測定方法コード・MIC値）は未設計。検体検査結果
   （Observation / DiagnosticReport / 独立Specimen）の構造をベースに、菌株（分離菌）を
   単位とする階層が必要になる見込み。
4. **抗菌薬マスタ**（JANIS抗菌薬コード）: 結果側・JANIS提出のフェーズで
   `master_micro_antimicrobials` として追加。前投与抗菌薬の構造化（YJ→JANIS対応列）も
   その時点で再検討する。
5. **JANIS提出ファイル生成**: 検査部門送信ファイルの生成は結果側実装後の課題。
6. **容器・ラベル**: 採取容器（滅菌容器・血培ボトル等）のマスタとラベル発行は未設計。
   検体検査の `master_lab_containers` と同型で追加できる。
7. **会計連携**: `receipt_code` 列のみ用意。対応付け運用は未設計（放射線と同じ状態）。
8. **JANISコード表の版管理**: 配布ファイルの改版（病原体コードVer6.1→…）への追従は
   全置換取込で対応するが、廃止コードが過去オーダーに残る問題は「オーダー時点の写し」
   方式で吸収される。

---

## 付録: 一次資料

- [JANIS 検査部門（一般向け）](https://janis.mhlw.go.jp/section/kensa.html) — 感染症病原体コード Ver6.1、
  抗菌薬コード Ver5.2、薬剤感受性測定方法コード Ver4.0、材料（検体種別）コード Ver1.0 ほか
- 検体検査側の先行設計: `docs/lab-order-master-design.md`、実装 `frontend/src/fhir/labOrderHelpers.ts`（contained Specimen方式）
- 放射線側の先行設計: `docs/rad-order-master-design.md`（マスタ取込・オーダー画面・GP単位の依頼病名の各パターン）
- 処方・注射の実装: `frontend/src/fhir/prescriptionHelpers.ts` / `injectionHelpers.ts`、
  薬効分類の導出 `backend/app/controllers/master/medicines_controller.rb`
