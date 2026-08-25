# 処置オーダーの設計

生理検査オーダー(`docs/physio-order-design.md`)を雛形にした処置(創傷処置・胃管挿入・
中心静脈カテーテル挿入 など)のオーダー。マスタ → オーダー入力 → カルテカード →
部門一覧 → 実施入力 → 予約枠連携 まで生理検査と同じ形で、違うところだけをここに書く。
同じところは生理検査の設計書(とその参照先の放射線の設計書)を参照。

実装日: 2026-08-25。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 生理検査との違い = 「検査の作法」を落とすこと

処置は 4 例目の同型オーダーで、生理検査からの差分は**足したものが無く、落としたものだけ**
という点に尽きる。落としたのは次の 4 つ。

| 落としたもの | 生理検査での役割 | 処置で落とす理由 |
|---|---|---|
| 検査種別(`master_physio_exam_types`) | 項目マスタの分類軸・明細 `category`・部門一覧の絞り込み軸 | ［提案］処置は「創傷処置(100cm2未満)」のように項目名そのものが内容を表し、検査室・装置に当たる部門内の分類軸が無い。空の分類軸を作ってもマスタ登録の手数が増えるだけ |
| 検査目的・特別指示の既定テンプレート(`purpose_template_canonical` / `remarks_template_canonical`) | オーダー画面のテンプレート記入の初期選択 | オーダー画面に両欄が無いので置き場所が無い |
| 至急区分(`ServiceRequest.priority`) | オーダー枠ごとの至急/通常。至急は当日実施に倒し予約を取らない | ［提案］指示どおり画面から外した。全オーダーが `routine` 相当になるので、値を書かず要素ごと出さない |
| 依頼病名・検査目的・特別指示(GP 単位の記入) | 明細の `reasonCode`/`reasonReference`・`extension[physio-exam-purpose]`・`note` | 同上。オーダー画面の「選択中」枠から外した |

対象プロブレム(ヘッダの `reasonReference`)は他のオーダーと同じく持つ。**依頼病名を
落としても「何の問題に対する処置か」はプロブレムで辿れる**ので、POMR 側の紐付けは
落としていない。

生理検査からそのまま持ち込んだもの: セット(親子)、伝票レイアウト、`groupable`
(単独オーダー)、`requires_perform_input`、`requires_appointment` + `duration_minutes` +
`appointment_schedule_id`、実施入力データセット、即実施、実施の取消で実施記録を消す
扱い、bodySite を持たない判断(項目名が対象を含む)。

### 1.1 命名

［提案］英語識別子は `treatment`。`procedure` は FHIR の `Procedure`(実施記録)と、
`medical_procedure` は既存の医科診療行為マスタ(`master_medical_procedures`)と衝突する
ので使わない。画面・カード・メニューの表記は「処置」。

---

## 2. FHIR の構造

生理検査と同型。ヘッダも明細も ServiceRequest。

```text
ヘッダ ServiceRequest  (category: order-type|treatment)
  ←basedOn── 明細 ServiceRequest（単項目 or セット親）= GP
                ←basedOn── セットの構成項目 ServiceRequest
  ←focus──── Task           (進捗: treatment)
  ←basedOn── Procedure      (実施記録) ←partOf── Procedure / MedicationAdministration
  ←basedOn── Appointment    (予約必須項目)
```

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。生理検査の physio-* と 1 対 1 で対応するものは
説明を省く。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `treatment` | ヘッダの `category[0]`。`isTreatmentServiceRequest` の判定軸 |
| `CodeSystem/treatment-order-item` | 明細 `code.coding`。項目マスタの独自コード |
| `CodeSystem/task-code` の値 `treatment` | 進捗 Task の `code` |
| `CodeSystem/treatment-procedure-code` | `Procedure.code`(レセ電算 診療行為コード) |
| `IdSystem/treatment-order-item-number` | 明細 `identifier`。伝票で選んだ並び順 |
| `StructureDefinition/treatment-material-quantity` | `usedCode` に数量を添える |

再利用: `CodeSystem/prescription-setting`、`CodeSystem/lab-item-abbreviation`、
`CodeSystem/medicine-code` / YJ、`CodeSystem/medical-material`、JP Core `route-codes`、
JP_Procedure、依頼科・病棟の拡張。

**生理検査にあって処置に無い URI**: `physio-exam-type`(検査種別)、
`physio-exam-purpose`(検査目的)、`physio-exam-purpose-questionnaire-response` /
`physio-remarks-questionnaire-response`(テンプレート回答参照)。

### 2.2 明細 1 件の中身

| FHIR要素 | 入れるもの |
|---|---|
| `code.coding` | 独自項目コード(`treatment-order-item`)、略称 |
| `identifier` | 伝票で選んだ並び順 |
| `basedOn` | 親(ヘッダ、またはセット親) |
| `category` / `reason*` / `note` / `extension` | **出さない** |

［実装］結果として明細は `code` / `identifier` / `basedOn` / `subject` / `authoredOn` /
`status` / `intent` だけになる。テンプレート回答(QuestionnaireResponse)を参照しないので、
更新・削除で孤児の回答を片付ける処理も要らない
(`buildTreatmentOrderUpdateBundle` / `buildTreatmentOrderDeleteBundle` の引数が
生理検査より 1 つ少ないのはこのため)。

`Procedure` は `category` に `order-type|treatment` を持つ。`Observation` は作らない。

### 2.3 薬剤の投与経路

`TREATMENT_ROUTE_OPTIONS`: 外用(TOP)・静脈内(IV)・筋肉内(IM)・皮下(SC)・経口(PO)・
吸入(IH)・直腸内(PR)。［提案］局所麻酔と外用薬(消毒・軟膏)が処置の主役なので **TOP を
先頭**に置き、生理検査にある動注(IA)は外した。コード表は JP Core `route-codes` のまま。

---

## 3. マスタ

```text
master_treatment_items          -- 処置オーダー項目。master_physio_items から
                                   exam_type_code と *_template_canonical を落としたもの
master_treatment_set_items      -- セット親子(同型)
master_treatment_item_layouts   -- 伝票レイアウト(同型)
master_treatment_item_layout_cells
master_treatment_datasets       -- 実施入力データセット(同型)
master_treatment_dataset_details
```

検査種別のテーブルは作らない。既存規約どおり FK は張らずコードで疎結合、`Master::`
名前空間・`self.table_name` 明示・`Master::SearchNormalizer` による `search_*` 列。

**seed は無い**。［提案］生理検査は検査種別 8 件を seed したが、処置には配布マスタも
標準の分類軸も無く、項目は施設が 1 件ずつ登録する。

［実装］項目検索の `keyword`(その場で項目を足す検索欄用)は、生理検査では名称に加えて
検査種別名にも当てていた。処置には分類軸が無いので `flexible_name_match` に寄せ、
名称・略称・カナだけを見る(`name` パラメータと同じ挙動になる)。

---

## 4. 上流 fhir-server の追加

**不要**。生理検査(physio-order-design.md §4)で確認したとおり、使う検索パラメータは
すべて値に依存しない汎用実装で、`order-type|treatment` も同じ仕組みに乗るだけ。

---

## 5. 画面

| 画面 | パス | 元 |
|---|---|---|
| 処置オーダー項目マスタ | `/treatment-items` | `PhysioItemPage`(検査種別・既定テンプレートを削除) |
| 処置オーダーレイアウト | `/treatment-item-layouts` | `PhysioItemLayoutPage` |
| 実施入力データセット | `/treatment-datasets` | `PhysioDatasetPage` |
| 処置一覧(部門業務) | `/treatment-worklist` | `PhysioWorklistPage`(検査種別フィルタ・至急バッジを削除) |
| オーダー入力 | カルテ右ペイン「処置」 | `PhysioOrderForm`(下記の差分) |

オーダー画面の「選択中」枠は、生理検査から**至急区分**(オーダー枠の見出し)と
**依頼病名・検査目的・特別指示**(GP 単位の記入欄)を外した。残るのは枠見出しの
実施日・実施時刻(予約必須項目では予約の操作)・即実施と、GP の項目名だけ。
テンプレート記入モーダル・病名選択モーダルもフォームから消えている。

［実装］至急を落としたことで、生理検査にあった「至急なら当日実施に倒す / 予約を取らない /
予約必須でも即実施できる」という分岐がまるごと消え、登録前の検証は
「まとめ枠に実施日がある」「単独枠に実施日がある」「予約必須の枠は予約済み」の 3 つになった。

［実装］医科診療行為(手技料)の検索モーダルは点数表の章 E(画像診断)を既定にしていた。
処置では当たらないので `defaultSection` を足し、処置側は **J(処置)** を渡す。
既存の呼び出し(放射線・生理検査・内視鏡)は既定の E のまま。

---

## 6. 実装したもの

| 層 | 追加物 |
|---|---|
| migration | `20260825000000` 項目+セット / `000100` レイアウト+セル / `000200` データセット+明細 |
| モデル | `Master::Treatment{Item,SetItem,ItemLayout,ItemLayoutCell,Dataset,DatasetDetail}` |
| API | `treatment_items` ほか 6 resources |
| spec | リクエスト 5 本(61 examples)。backend 全 972 examples green |
| FHIR 変換 | `fhir/treatmentOrderHelpers.ts` / `treatmentTaskHelpers.ts` / `treatmentResultHelpers.ts` |
| 画面 | §5 の 5 画面と `TreatmentOrderForm` / `Panels` / `DetailPanel` / `TreatmentItemSearchModal` / `TreatmentPerformModal` / `treatmentItemOptions` |
| カルテ | `karteTimeline` に `treatment-order` 種別、`KarteRightPane` の起動ボタン、`KarteTimeline` のカード・実施情報、`KarteCardModals` の詳細/JSON、`KarteCategoryList` / `karteUrl` / `KartePage` の分岐 |

### 6.1 検証したこと

開発環境で以下を通した。

1. マスタ: 項目 2 件登録(自動採番 000001 / 000002)→ 伝票レイアウト「一般処置」に 2 マス配置。
   項目マスタ・検索モーダルに検査種別の欄が無く、編集モーダルに既定テンプレートの節が無いこと
2. オーダー: カルテ右ペイン「処置」→ 伝票から 2 項目選択 → 登録。「選択中」枠に至急区分が無く、
   GP に依頼病名・検査目的・特別指示が無いこと。FHIR 上でヘッダ(`order-type|treatment`・
   入外区分・依頼科・病棟拡張、`priority` 無し)と明細(項目コード・略称・並び順のみ、
   `category`/`reason*`/`note`/`extension` 無し)を確認
3. 部門一覧: 処置一覧に表示(検査種別フィルタ無し)→ 受付 → 実施(手技料に J 章から
   「創傷処置(100cm2未満)」を選択)→ 実施済 → カルテカードに実施情報が出ること
4. 編集: 保存値からのフォーム復元 → 構成項目を 1 件外して更新 → 明細が消えること
5. DO: 項目を引き継いだ登録フォームが開くこと
6. 詳細: カルテの詳細モーダルが「処置共通(至急区分なし)」と GP ごとの処置項目表を出すこと
7. 回帰: 既存の生理検査・内視鏡・検体検査カードが不変。backend 全 972 examples green・
   `tsc -b` clean・`oxlint` 既存 1 warning のみ

セット展開・実施入力データセット・予約枠連携・削除・即実施・実施取消は生理検査の写し
(コードパスも同一)で、request spec では通しているが画面からは通していない。運用に載せる
前に生理検査 §6.1 と同じ手順で一巡すること。

---

## 7. 申し送り

1. **削除の画面確認**: オーダー削除は `window.confirm` を挟むため、今回の自動操作では
   通していない。ヘッダ + 明細 + 予約の一括削除は生理検査と同じ形(テンプレート回答の
   後始末だけが無い)
2. **会計連携**: 生理検査 §7-2 と同じ。処置は特定保険医療材料(ドレッシング材・カテーテル)を
   実際に算定するので、`usedCode` の数量が会計側で効いてくる
3. **至急区分**: 今回は指示により画面から外した。処置でも「今すぐ」の運用が要ると分かった
   ときは、生理検査の `priority` の扱い(オーダー枠ごとの入力 → 当日実施に倒す)をそのまま
   戻せる。FHIR 側は `ServiceRequest.priority` を書き足すだけ
4. **共通化**: rad / physio / endoscopy / treatment で 4 例目の同型オーダーになった。
   内視鏡の申し送り §8-6 が「4 つ目を作るなら共通化を先に検討」と書いていたが、今回は
   工期を優先して写しで作った。5 つ目が出る前に、backend は concern + generic controller、
   frontend は `createOrderHelpers` のようなファクトリへの巻き取りを検討する価値がある。
   今回の差分(分類軸なし・GP 記入欄なし・至急なし)は、そのファクトリのオプションの
   良い試金石になる
5. **処置の記録**: 処置報告書(創部の所見・写真)は未実装。実施入力のコメント欄に平文で
   書くしかない。テンプレート(Questionnaire)機構に乗せる形は、レポート機能を設計する
   ときに扱う
