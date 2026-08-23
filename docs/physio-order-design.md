# 生理検査オーダーの設計

放射線検査オーダー(`docs/rad-order-master-design.md` / `docs/rad-result-design.md`)を
雛形にした生理検査(心電図・超音波検査・呼吸機能検査 など)のオーダー。マスタ →
オーダー入力 → カルテカード → 部門一覧 → 実施入力 → 予約枠連携 まで放射線と同じ形で、
違うところだけをここに書く。同じところは放射線の設計書を参照。

実装日: 2026-08-23。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 放射線検査との違い

生理検査を別種別として起こした理由は 2 つある。

- **［事実］JJ1017 に生理検査は収載されていない**。放射線検査項目マスタの中核である
  JJ1017 32 桁コード(11 要素の合成・分解・施設拡張・部品コード表・頻用コード表)は
  生理検査では意味を持たないので、まるごと持たない。
- **［事実］モダリティに当たる標準コードが無い**。放射線では JJ1017 の
  「種別(モダリティ)」が検査分野の分類軸を兼ねていた
  (`docs/rad-order-master-design.md` §3「検査分野に相当する分類は modality_code が
  その役割を果たす」)。生理検査にはこれに当たる標準コード体系が無いので、施設が
  自由に定義できる**検査種別マスタ**を新設し、モダリティが占めていた位置
  (項目マスタの分類軸・明細 ServiceRequest の `category`・部門一覧の絞り込み軸)に据えた。

放射線側のコードは触っていない。共通化はせず写して独立させた
(［提案］rad と physio で運用要件が割れたときに互いを壊さないため。CSS クラスだけは
既に領域名を外してある `order-layout__*` / `order-select__*` と、他領域からも使われて
いる `lab-order-item__*` / `rad-item__*` などをそのまま共用している)。

### 1.1 落としたもの・変えたもの

| 論点 | 生理検査での扱い | 理由 |
|---|---|---|
| JJ1017 一式 | 持たない。要素列・32 桁コード・部品コード表・頻用コード表・一括作成・マスタ取込がすべて無い | 対象外 |
| 検査種別 | `master_physio_exam_types` を新設。`/physio-exam-types` から施設が登録する。コードは独自採番 2 桁 | 標準コードが無く、粒度が施設で変わる。件数は 10 件前後なので他マスタの 6 桁採番は過剰 |
| 部位・左右(`bodySite`) | 持たない | ［提案］「腹部超音波」「下肢静脈エコー」のように項目名が部位を含み、JJ1017P に代わる標準の部位コード体系も無い。`bodySite.text` だけを載せても検索にも表示にも使い道がない。必要になったら JP Core の BodyStructure / SNOMED CT で別途設計する |
| 被曝線量(`Observation`) | 持たない。実施入力に線量欄が無い | 生理検査に電離放射線はない |
| 器材マスタ | 施設内の器材マスタ(`master_rad_materials` 相当)を作らない。器材は算定コードである `master_medical_materials`(特定保険医療材料)を直接指す。マスタ未整備でも入れられるよう名称の手入力も許す | ［提案］生理検査で個別算定できる特定器材はほとんど無く(電極・プローブカバーは技術料に包括)、施設内コードを別に持つ動機が無い |
| 薬剤 | 造影剤に限らないので `contrasts` → `medicines` に改め、医薬品の絞り込み(放射線は造影剤区分)を外した。投与経路も `PHYSIO_ROUTE_OPTIONS` を独自に持つ | 負荷心電図の薬剤負荷・超音波造影剤・気道可逆性試験の気管支拡張薬など。放射線の経路にある注腸・膀胱内・髄腔内は生理検査では使わないので外し、**吸入**(`IH`)を足した |
| レセ電算コード | 項目マスタの `receipt_code` は放射線と同じテキスト入力。加えて `MedicalProcedureSearchModal` から選べるようにし、API が `receipt_procedure_name` を添えて返す | ［提案］生理検査には頻用コード表のような初期データ源が無く項目は 1 件ずつ手入力になるので、打ち間違いを減らす |
| 初期データ | 検査種別のみ seed(8 件)。項目マスタは画面から手入力 | 配布マスタが存在しない |

放射線からそのまま持ち込んだもの: セット(親子)、伝票レイアウト(グリッド)、
`groupable`(単独オーダー)、`requires_perform_input`、`requires_appointment` +
`duration_minutes` + `appointment_schedule_id`、実施入力データセット、
検査目的・特別指示の既定テンプレート(Questionnaire canonical)、即実施、
実施の取消で実施記録を消す扱い。

---

## 2. FHIR の構造

放射線と同型。ヘッダも明細も ServiceRequest。

```text
ヘッダ ServiceRequest  (category: order-type|physio)
  ←basedOn── 明細 ServiceRequest（単項目 or セット親）= GP
                ←basedOn── セットの構成項目 ServiceRequest
  ←focus──── Task           (進捗: physio-exam)
  ←basedOn── Procedure      (実施記録) ←partOf── Procedure / MedicationAdministration
  ←basedOn── Appointment    (予約必須項目)
```

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `physio` | ヘッダの `category[0]`。`isPhysioServiceRequest` の判定軸 |
| `CodeSystem/physio-order-item` | 明細 `code.coding`。項目マスタの独自コード |
| `CodeSystem/physio-exam-type` | 明細 `category`。検査種別(モダリティの位置) |
| `CodeSystem/task-code` の値 `physio-exam` | 進捗 Task の `code` |
| `CodeSystem/physio-procedure-code` | `Procedure.code`(レセ電算 診療行為コード) |
| `IdSystem/physio-order-item-number` | 明細 `identifier`。伝票で選んだ並び順 |
| `StructureDefinition/physio-exam-purpose` | 検査目的(標準要素に該当なし) |
| `StructureDefinition/physio-exam-purpose-questionnaire-response` | 検査目的のテンプレート回答参照 |
| `StructureDefinition/physio-remarks-questionnaire-response` | 特別指示のテンプレート回答参照 |
| `StructureDefinition/physio-material-quantity` | `usedCode` に数量を添える(CodeableConcept は数量を持てない) |

再利用: `CodeSystem/prescription-setting`(入外区分)、
`CodeSystem/lab-item-abbreviation`(略称。放射線も共用)、
`CodeSystem/medicine-code` / YJ コード、`CodeSystem/medical-material`、
JP Core `route-codes`、JP_Procedure プロファイル、依頼科・病棟の拡張。

### 2.2 明細 1 件の中身(放射線との差分)

| FHIR要素 | 入れるもの |
|---|---|
| `code.coding` | 独自項目コード(`physio-order-item`)、略称。**JJ1017-32 / 16M / 16S は無し** |
| `category` | 検査種別(`physio-exam-type`) |
| `bodySite` | **出さない** |
| `identifier` / `reason*` / `extension[physio-exam-purpose]` / `note` | 放射線と同じ(GP を表す明細のみ) |

`Procedure` は `category` に `order-type|physio` を持つ。`usedCode` の coding は
`medical-material` の 1 本だけ(放射線の施設内コードの段が無い)。`Observation` は作らない。

---

## 3. マスタ

```text
master_physio_exam_types        -- 検査種別。exam_type_code(2桁, unique) / name / short_name /
                                   name_kana / 有効期間 / display_order / note / search_*
master_physio_items             -- 生理検査オーダー項目。master_rad_items から JJ1017 の
                                   11要素と jj1017_code を落とし、modality_code を
                                   exam_type_code に置き換えたもの
master_physio_set_items         -- セット親子(master_rad_set_items と同型)
master_physio_item_layouts      -- 伝票レイアウト(同上)
master_physio_item_layout_cells
master_physio_datasets          -- 実施入力データセット(同上)
master_physio_dataset_details   -- detail_type = procedure | medicine | material
                                   ※ material の参照先が master_medical_materials
```

既存規約どおり FK は張らずコードで疎結合。`Master::` 名前空間・`self.table_name` 明示・
`Master::SearchNormalizer` による `search_*` 列。

［実装］**検査種別を消しても検査項目は消さない**。参照している項目の `exam_type_code` を
NULL に戻して未分類にする(種別を消しただけで項目が消えると事故になる)。
データセットを消したときに項目の `dataset_code` を外すのと同じ扱い。

seed は `db/seed_data/physio_exam_types.csv`(心電図 / 超音波検査 / 呼吸機能検査 / 脳波 /
筋電図・神経伝導検査 / 血圧脈波検査 / 聴力・平衡機能検査 / その他)。既存行は上書きしない
(施設で直した名称を消さない)。「その他」を `90` にしてあるのは、自動採番が
`max + 1` なので `99` を使うと次が 3 桁になるため。

---

## 4. 上流 fhir-server の追加

**不要**。必要な検索パラメータはいずれも値に依存しない汎用実装だった
(`app/lib/fhir/search.rb` の `token_fragment` は `_id` を除いて `resource_tokens` の
`(param_name, system, code)` 行に対する照合で、コード値のホワイトリストを持たない)。

- `ServiceRequest`: `category`(token) / `occurrence` / `based-on`(`:missing` 対応)
- `Task`: `focus`
- `Procedure`: `category`(token) / `based-on` / `part-of`
- `MedicationAdministration`: `part-of`

`FhirProxyController::ALLOWED_RESOURCE_TYPES` にも `Procedure` /
`MedicationAdministration` は既にある。

---

## 5. 画面

| 画面 | パス | 元 |
|---|---|---|
| 生理検査オーダー項目マスタ | `/physio-items` | `RadItemPage`(JJ1017 要素・32桁プレビュー・頻用一括作成を削除) |
| 検査種別 | `/physio-exam-types` | 新規(素朴な CRUD) |
| 生理検査オーダーレイアウト | `/physio-item-layouts` | `RadItemLayoutPage` |
| 実施入力データセット | `/physio-datasets` | `RadDatasetPage`(器材の参照先を差し替え) |
| 生理検査一覧(部門業務) | `/physio-worklist` | `RadWorklistPage`(モダリティ → 検査種別) |
| オーダー入力 | カルテ右ペイン「生理検査」 | `RadOrderForm` ほか |

文言は「撮影」の語彙を検査の語彙に置き換えた(撮影項目→検査項目、撮影日/撮影時刻→
実施日/実施時刻、撮影内容→検査内容、モダリティ→検査種別)。

［実装］予約タブの検査予約行の文言は「日時変更・取消は放射線オーダーから」→
**「検査オーダーから」**に汎用化した。`isExamAppointment` は `basedOn` の有無だけを
見るので生理検査の予約も自動的に検査扱いになり、文言だけが放射線に固定されていた。

---

## 6. 実装したもの

| 層 | 追加物 |
|---|---|
| migration | `20260824000000` 検査種別 / `000100` 項目＋セット / `000200` レイアウト＋セル / `000300` データセット＋明細 |
| モデル | `Master::PhysioExamType` / `PhysioItem` / `PhysioSetItem` / `PhysioItemLayout` / `PhysioItemLayoutCell` / `PhysioDataset` / `PhysioDatasetDetail` |
| API | `physio_exam_types` / `physio_items` / `physio_set_items` / `physio_item_layouts` / `physio_item_layout_cells` / `physio_datasets` / `physio_dataset_details` |
| seed | `db/seed_data/physio_exam_types.csv`(8 件) |
| spec | リクエスト 6 本(73 examples)。backend 全 836 examples green |
| FHIR 変換 | `fhir/physioOrderHelpers.ts` / `physioTaskHelpers.ts` / `physioResultHelpers.ts` |
| 画面 | 上表の 6 画面と `PhysioOrderForm` / `Panels` / `DetailPanel` / `PhysioItemSearchModal` / `PhysioPerformModal` / `physioItemOptions` |
| カルテ | `karteTimeline` に `physio-order` 種別、`KarteRightPane` の起動ボタン、`KarteTimeline` のカード・実施情報、`KarteCardModals` の詳細/JSON、`KarteCategoryList` / `karteUrl` / `KartePage` の分岐 |

### 6.1 検証したこと

開発環境で以下を通した。

1. マスタ: 検査種別 8 件 seed → 項目 6 件(単独・予約必須・実施入力なし・セット)→
   セット構成 → 伝票レイアウト 9 マス → データセット(手技・薬剤・器材)。
   矛盾バリデーション(単独オーダー ⇄ セット構成項目、予約必須 ⇄ グループ化)が
   双方向で効くこと
2. オーダー: セット＋単項目を登録 → カード表示 → 詳細表示 → 編集(構成項目を 1 件外し
   別項目を追加。PUT/POST/DELETE が混在した transaction になり、外した明細が消えて
   孤児が残らない)→ DO → 削除(ヘッダ＋明細がまとめて消える)
3. 部門一覧: 受付 → 実施(実施入力にデータセットの初期明細が展開され、**線量欄が出ない**、
   初期値でない明細は出ない)→ カルテカードに実施情報 → 取消(実施記録が DELETE され、
   Task が受付済に戻り、カードから実施情報が消える)
4. 予約: 予約必須項目で枠を選んで登録 → Appointment 作成と Slot の busy 化が同じ
   transaction で成立 → 予約タブに「検査」バッジと「日時変更・取消は検査オーダーから」
5. 即実施: オーダー・実施記録・実施済 Task が 1 transaction
6. 回帰: 放射線検査のカード・部門一覧が不変。`Procedure?category=…|rad` と
   `…|physio` が互いに混ざらない

---

## 7. 申し送り

1. **結果**: 検査結果(波形・計測値・所見レポート)は未実装。カードの「検査結果表示」
   導線も生理検査には無い。心電図所見や心エコーの計測値をどう持つか(Observation の
   パネル / DiagnosticReport)は別途設計する。
2. **会計連携**: 放射線と同じく、オーダー明細の `receipt_code` と Procedure の
   `usedCode` / MedicationAdministration の使用量から会計システムへ渡す前提。
   `ChargeItem` / `Claim` は上流に未実装。
3. **接頭辞 `physio` の重複**: `fhir/practitionerRoleHelpers.ts` に
   `{ code: "physio", label: "理学療法士" }` がある。別の CodeSystem(職種コード)なので
   FHIR 上の衝突は無いが、生理検査側は必ず `physio-order` / `physio-exam-type` /
   `PhysioOrder*` のような複合語で使い、`physio` 単体の識別子は作らない。
4. **放射線との共通化**: 今回は写して独立させた。セット・レイアウト・データセット・
   即実施・Task の扱いは 2 領域でほぼ同一なので、3 つ目の同型オーダーを作るときは
   共通化を検討する価値がある(逆に言えば 2 つでは早すぎるという判断)。
