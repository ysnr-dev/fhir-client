# 放射線検査 実施入力の設計メモ

放射線検査の実施情報(造影剤・特定器材・手技料・被曝線量・コメント)の登録と表示。
オーダー側は `docs/rad-order-master-design.md`、進捗管理(Task)は
`frontend/src/fhir/radTaskHelpers.ts` と放射線検査一覧(`/rad-worklist`)を参照。

調査日: 2026-08-13。上流 fhir-server の実装状況は同日のソースで確認済み。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流の実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計提案

---

## 1. スコープ

- 放射線検査一覧の「実施」から開く実施入力(造影剤・特定器材・追加手技・被曝線量・コメント)
- 実施情報の表示(カルテの放射線オーダーカードから参照)
- 実施登録に伴う Task の完了(`accepted` → `completed`)

含めないもの:

- **ImagingStudy(撮影実績)** … §7-1
- **読影レポート(DiagnosticReport)** … 実施とは別工程。別途設計する
- **会計システムへの連携** … §7-2。ここで作るのは会計が必要とする「材料」まで

---

## 2. リソース構造

［提案］検体検査結果・細菌検査結果と同型の 1 本の transaction Bundle(`POST /fhir`)。
新規は `urn:uuid` fullUrl + POST、更新は PUT + 外れたリソースを同 Bundle 内で DELETE。
Task の完了も同じ Bundle に積み、実施情報だけ保存されて進捗が止まる状態を作らない。

```
ServiceRequest (放射線オーダー ヘッダ)                        ※既存
 ├ basedOn ← ServiceRequest (明細 = GP・撮影項目)             ※既存
 ├ focus   ← Task (依頼済 → 受付済 → 実施済 / 中止)           ※実装済み
 └ basedOn ← Procedure (実施記録)                            ← 今回の中心
      │        code      = 主たる手技(レセ電算 診療行為コード)
      │        usedCode  = 特定器材(特定保険医療材料コード) 0..*
      │        note      = 実施コメント
      │        performer = 実施者(診療放射線技師)
      │        performedDateTime = 実施時刻
      ├ partOf ← MedicationAdministration (造影剤 0..*)
      │        medicationCodeableConcept = 医薬品マスタの写し
      │        dosage.dose = 使用量(mL)、dosage.route = 経路
      └ partOf ← Observation (被曝線量 0..*)
               code = CTDIvol / DLP / DAP / 透視時間
               valueQuantity = 実測値(UCUM 単位)
```

設計判断:

- **Procedure をハブにする**。当初 ImagingStudy を実施結果の中心に想定したが、
  造影剤・器材・手技料を持たせるなら Procedure が受け皿になる。ImagingStudy には
  造影剤も器材も手技料も載せる場所が無い(DICOM のスタディ記述に徹したリソース)。

- **Procedure はオーダー(ヘッダ)単位で 1 件**。実施は「一度の来室で一度撮る」という
  1 つの事実で、造影剤・線量・コメントもその単位でしか発生しない。
  ［導出］「オーダー単位」が撮影の単位として成立するのは、時間を要するモダリティを
  1 オーダー 1 撮影項目に制限する `master_rad_items.groupable`(オーダー単位)を
  先に入れたため。複数項目が同居するのは同時に撮る単純撮影に限られる。

- **手技料の内訳は実施入力で入力させない**。撮影項目マスタが
  `master_rad_items.receipt_code`(レセ電算コード)を持っており、何を撮る依頼かは
  オーダー明細(GP の ServiceRequest)に確定している。実施入力で足すのは
  **オーダー時点で確定していないぶんだけ**(造影剤・器材・実測線量・コメント)。
  会計連携はオーダー明細 + Procedure から組み立てる(§7-2)。

- **造影剤は `Procedure.usedCode` に混ぜず MedicationAdministration にする**。
  ［事実］`usedCode` は CodeableConcept で**数量を持てない**。造影剤は mL が薬剤料の
  算定根拠になるため分ける。既存の医薬品マスタと `MedicineSearchModal` を流用でき、
  コードは処方・注射と同じ `medicine-code` / YJ コードで揃う。

- **特定器材は `Procedure.usedCode`**。［事実］R4 の `Procedure.usedCode` は
  「手技中に使用した物品」そのもの。`DeviceUseStatement` は患者が継続使用する機器
  (植込み・車椅子)を表すリソースで、手技で消費する器材の記録には合わない。

- **被曝線量は Observation にする(ローカル拡張にしない)**。［事実］2020 年の医療法
  施行規則改正で CT・血管撮影・IVR の被曝線量の記録と管理が義務化されており、
  経時的な集計・照会の要件が出る。拡張に埋めると必ず作り直しになる。
  `Observation.partOf` は［事実］R4 で Procedure / ImagingStudy を参照できる。

- **中止は Procedure を作らない**。中止は Task の `cancelled` で表す。撮影しなかった
  ものに実施記録を残すと、会計・線量集計の両方で除外条件が増える。
  途中で止めた(造影剤だけ入れて撮影中止)場合のみ `Procedure.status = not-done` +
  `statusReason` で残す。

- **profile**: Procedure は JP Core の `JP_Procedure`(上流の登録先)。
  ［事実］JP_Procedure の必須は `status` 1..1 / `subject` 1..1、performer を置くなら
  `performer.actor` 1..1。上流の `ProcedureValidator` は status の値セットと
  subject が実在する Patient かを見る。

---

## 3. コードシステム

既存を再利用するもの:

| URI | 用途 |
|---|---|
| `http://fhir-client.local/CodeSystem/order-type` | `Procedure.category` = `rad`。処方・検体検査の Procedure と振り分ける。［事実］上流の Procedure は `category` のトークン検索に対応済みなので、`Procedure?category=...|rad&date=<撮影日>` で日次の実施一覧が引ける |
| `http://fhir-client.local/CodeSystem/medicine-code` | 造影剤のレセ電算コード(処方・注射と共通) |
| `http://capstandard.jp/iyaku.info/CodeSystem/YJ-code` | 造影剤の YJ コード(同上) |
| `http://unitsofmeasure.org` | 使用量・線量の単位(UCUM) |

新規に定義するもの(すべて `http://fhir-client.local/CodeSystem/`):

| URI 末尾 | 用途 |
|---|---|
| `rad-procedure-code` | `Procedure.code`。レセ電算 診療行為コードの写し(撮影項目マスタの `receipt_code`) |
| `rad-material` | `Procedure.usedCode`。施設内の器材コード(放射線器材マスタ) |
| `medical-material` | `Procedure.usedCode`。算定に使う特定保険医療材料コード(§4.2) |
| `rad-dose` | 被曝線量の測定項目。`ctdivol` / `dlp` / `dap` / `fluoroscopy-time` |

［実装］器材の `usedCode` には**施設内コードと算定用コードの 2 つの coding を並べる**。
技師が選ぶのは棚にある製品(施設コード)で、算定に要るのはレセ電算の特定器材コード。
同じ物品の別表現なので 1 つの CodeableConcept に並べてよい。未紐付けの器材
(算定対象でないもの)は施設コードだけになる。

［実装］**器材の数量はローカル拡張**
`http://fhir-client.local/StructureDefinition/rad-material-quantity`(valueQuantity)を
`usedCode` に付ける。［事実］`usedCode` は CodeableConcept で数量を持てないが、
行を数量ぶん繰り返す形にすると小数(mL 単位の器材)を表せず、同じ器材の 2 行目が
別物なのか数量なのか読めなくなる。

［提案］線量の測定項目は当面ローカルコードにする。DICOM RDSR(線量レポート)の
標準コードへ寄せるのは PACS 連携で RDSR を取り込む段階(§7-1)。その時点で
`Observation.code.coding` に DICOM コードを**追加**すれば、既存データは
ローカルコード側で引き続き読める。

単位(UCUM):

| 項目 | 単位 | UCUM |
|---|---|---|
| CTDIvol | mGy | `mGy` |
| DLP | mGy·cm | `mGy.cm` |
| DAP(面積線量) | Gy·cm² | `Gy.cm2` |
| 透視時間 | 秒 | `s` |
| 造影剤 使用量 | mL | `mL` |

---

## 4. マスタ

### 4.1 実施入力用データセット(実装済み)

［提案→実装］実施入力で毎回登録することになる**手技料・造影剤・器材の組み合わせ**に
名前を付けてまとめ、撮影項目マスタに紐付ける。実施入力モーダルは、オーダーに載って
いる全撮影項目のデータセットの明細をマージして初期表示する。

```text
master_rad_datasets                 -- 親。dataset_code / name / 運用期間
master_rad_dataset_details          -- 明細(3種を縦持ち)
  dataset_code                      -- 親
  detail_type                       -- procedure / medicine / material
  code                              -- 参照先マスタのコード
  default_quantity                  -- 造影剤=使用量(mL) / 器材=数量 / 手技=NULL
  route_code                        -- 造影剤の既定経路(JP Core route-codes)
master_rad_items.dataset_code       -- 撮影項目 → データセット(1項目1つ)
```

設計判断:

- **明細は 3 種を 1 テーブルに縦持ち**。3 種とも「参照先マスタのコード + 既定数量 +
  表示順」で同じ形をしており、実施入力は 3 種をまとめて 1 回で引きたい。参照先が
  別マスタになるぶんは `detail_type` つきの LEFT JOIN で名称を解決する
  (`Master::RadDatasetDetail.with_names`)。
- **撮影項目からは 1 対 1 で参照する**(`master_rad_items.dataset_code`)。同じ組み合わせ
  (造影 CT の標準セット)を複数の撮影項目から使い回せる点は変わらない。当初は
  「手技セット × 造影剤セット × 器材セット」を軸ごとに組み合わせられるよう多対多
  (`master_rad_item_datasets`)にしていたが、データセットは `detail_type` で 3 種を
  1 つに持てるため組み合わせの必要が薄く、実施入力側でマージすると同一コードの明細が
  先勝ちで潰れる(どのデータセット由来かも画面に出ない)曖昧さだけが残っていたため畳んだ。
- **造影剤の専用マスタは作らない**。既存の医薬品マスタを、レセ電算の
  **造影剤区分**(`master_medicines.contrast_medium_category`、0 以外が造影剤と
  その補助剤)で絞って選ぶ。剤形では絞れない(経口造影剤は内用薬のため)。

### 4.2 特定保険医療材料

［提案］**`master_medical_materials`(特定保険医療材料)を新規に作る**。現状この
マスタが無く、カテーテル等をコードで選べない。会計連携を見据えるとコード化が前提。

```text
master_medical_materials
--------------------------------
material_code       -- 特定保険医療材料コード(unique)
name / name_kana
category            -- 分類(カテーテル・ガイドワイヤ・造影剤注入器具 等)
unit                -- 数量の単位(本・個・組)
price               -- 材料価格(円)。会計連携の基礎
valid_from / valid_to
display_order / note
search_name / search_kana
```

既存マスタの規約を踏襲する(`master_` 接頭辞・FK なし・`Master::` 名前空間・
`Master::SearchNormalizer` による search_* 列)。取込は厚生労働省の特定保険医療材料
告示から。当面は画面からの手動登録でも運用できる(件数が少ないため)。

［提案］初期実装では**フリーテキスト + コード手入力**でも動くようにする。マスタが
未整備でも実施入力自体は使えるようにし、`usedCode.text` に入力値を残す。

---

## 5. 上流 fhir-server の追加(実装済み 2026-08-15)

［事実］いずれも定義の追加だけで、マイグレーションは不要だった。ServiceRequest に
`category` を足した 2026-08-13 の変更と同じ手順(検索定義 + `_include`/`_revinclude`
許可リスト。参照は `content` の jsonb containment で引くのでトークン再作成も不要)。

| リソース | 追加した検索パラメータ | 用途 |
|---|---|---|
| `Procedure` | `based-on`(jsonb containment) | オーダーから実施記録を引く。`_revinclude=Procedure:based-on` でカルテカードと同時取得 |
| `Procedure` | `part-of`(同上) | ハブから 2 件目以降の手技を引く。`part-of:missing=true` でハブだけを絞れる |
| `Observation` | `part-of` | Procedure から被曝線量を引く |
| `MedicationAdministration` | `part-of` | Procedure から造影剤を引く |

［導出］日次の実施一覧は `Procedure?category=...|rad&date=` で引けるため、
`based-on` が要るのは「このオーダーの実施情報」を出す画面だけ。

［実装］参照先はいずれも実際に束ねている型だけに絞った(`Observation.partOf` は
R4 では投薬・撮影も指せるが `Procedure` のみ)。許可していない型は
`_include`/`_revinclude` の解決対象にならないので、広げるのは必要になってからでよい。

fhir-client backend:

- `FhirProxyController::ALLOWED_RESOURCE_TYPES` に `Procedure` と
  `MedicationAdministration` を追加(`Observation` は既にある)

---

## 6. 画面

### 6.1 実施入力

放射線検査一覧(`/rad-worklist`)の行の「実施」を、ステータスを進めるだけの動作から
**実施入力モーダルを開く**動作に変える。登録すると Procedure 一式の保存と
Task の `completed` 化が 1 つの transaction で走る。

入力項目:

| 欄 | 既定値 |
|---|---|
| 実施時刻 | 現在時刻 |
| 実施者 | ログイン中の医療従事者 |
| 造影剤(0..*) | なし。医薬品検索から選び、使用量(mL)と経路を入れる |
| 特定器材(0..*) | なし。材料マスタ検索(未整備ならフリーテキスト) |
| 被曝線量 | モダリティで出し分ける(CT: CTDIvol・DLP / 血管撮影: DAP・透視時間 / 単純撮影: なし) |
| コメント | 空 |

［提案］**線量欄はモダリティで出し分ける**。単純撮影で CTDIvol を求められると
毎回空欄を飛ばすことになり、入力が形骸化する。モダリティは明細の
`category`(JJ1017 種別)から判る。

［提案］**造影剤・器材が無ければ何も入力せず登録できる**ようにする。単純撮影が
件数の大半を占めるため、既定のまま「登録」で終わるのが望ましい。

### 6.2 実施情報の表示(カルテカードは実装済み 2026-08-15)

［実装］**カルテの放射線オーダーカードは、モーダルではなくカードの下部に直接出す**。
当初は細菌検査の「検査結果表示」と同じくメニューからモーダルで開く案だったが、
実施情報は「造影剤・器材・線量・コメント」の数行で、カードに収まる量しかない。
オーダーを読むときに必ず一緒に見るものなので、開かせるより先に出す。

- カード上部(メタデータ部): 進捗(依頼済 / 受付済 / 実施済 / 中止)を、撮影時刻・
  依頼元と同じ並びに文字で添える。Task は `_revinclude=Task:focus` で同時取得する
  (放射線検査一覧と同じ引き方)。［実装］バッジや枠線は付けない。進捗を追うのは
  放射線検査一覧の仕事で、カルテでは読むだけの情報であり、カード上端には既に
  種別バッジとプロブレムのバッジがある。ただし中止だけは読み落とすと困るので
  文字色で分ける
- カード下部: 「実施情報」として、実施時刻・実施者・手技・造影剤・器材・被曝線量・
  コメントを、依頼内容とは別の地(`.karte-perform`)に入れて出す。オーダーが
  「依頼した内容」、実施情報が「部門が実際に行ったこと」で別の事実だから
- **実施情報を出すのは進捗が実施済のときだけ**。実施の取消は Task を受付済へ戻す
  だけで実施記録を消していない(§7-6)ため、取り消した検査の実施記録がそのまま
  残っている。カルテに出す「実施したこと」は進捗と食い違ってはならない
- 取得は `_revinclude=Procedure:based-on` +
  `_revinclude:iterate=MedicationAdministration:part-of` /
  `Observation:part-of` の 1 リクエスト(カルテのオーダー検索に相乗り)
- 読み解きは `radPerformsByOrderId`(`frontend/src/fhir/radResultHelpers.ts`)。
  ハブ 1 件 = 1 回の実施として、子の手技・造影剤・線量をまとめる

未了:

- 放射線検査一覧: 実施済の行に実施時刻を出し、行から実施情報を開ける

---

## 7. 未決事項・申し送り

1. **ImagingStudy(撮影実績)は今回作らない**。［事実］JP_ImagingStudy_Radiology は
   `series` を持つなら `series.uid` と `series.modality` が 1..1 で、DICOM の
   Study/Series UID が要る。モダリティや PACS と繋がっていない段階で UID を
   捏造すると、後で実機の UID と突き合わせられない偽データが残る。
   PACS 連携(MPPS / RDSR 取り込み)を行う時点で導入し、`procedureReference` で
   ここで作る Procedure を指す。［事実］R4 で Procedure と ImagingStudy を直接
   つなぐ経路はこれだけ(`Procedure.report` は DiagnosticReport 用)。

2. **会計連携**。［事実］上流に `ChargeItem` / `Claim` / `Invoice` は未実装。
   FHIR 上で会計を完結させず、オーダー明細(`receipt_code`)+ Procedure の
   `usedCode` + MedicationAdministration の使用量から会計システムへ渡す前提で
   設計する。造影加算のような加算は「造影剤を使ったか」から導出できるため、
   実施入力では入力させない。

3. **複数手技の表し方(決定済み)**。`Procedure.code` は 0..1 なので、実施入力で
   手技を 2 件以上足したときは **1 件目をハブの `code` に、2 件目以降を `partOf` で
   子 Procedure にぶら下げる**(この節が予告したフォールバックをそのまま採った)。
   異なる手技を 1 つの CodeableConcept の複数 coding に混ぜる案は、coding が
   「同一概念の別表現」を並べるものである以上、意味が違うので採らない。
   子にも `basedOn`(オーダー)を張ってあるので、`Procedure?based-on=` が上流に
   入れば 1 回の検索で全手技を引ける。

4. **線量の自動取得**。手入力を前提にしているが、実際の運用では RDSR から自動で
   入るべき値。手入力欄は残しつつ、取り込み時に上書きできる形にしておく。

5. **読影レポート**。DiagnosticReport(`basedOn` = オーダー、`imagingStudy` =
   ImagingStudy)で別途設計する。［事実］上流の DiagnosticReport は `based-on`
   検索に対応済み(検体検査で使用中)なので、リソース側の追加は不要。

6. **実施の取消で実施記録も片付ける(実装済み 2026-08-15)**。実施済の行の「取消」は、
   Task を受付済へ戻す更新と同じ transaction で、そのオーダーの実施記録
   (Procedure・造影剤・被曝線量)を **DELETE** する。
   - `status = entered-in-error` で残さないのは、撮らなかったものに実施記録が残ると
     会計連携・線量集計の双方で除外条件が増えるため(中止で Procedure を作らない
     §2 の判断と同じ理由)。取り消した内容は上流のバージョン履歴(`_history`)から
     追える(削除は論理削除で、読むと 410 Gone)。
   - 消す対象は取消の時点で `Procedure?based-on=` + `_revinclude=…:part-of` で
     引き直す。一覧を開いた後に別の端末で登録された実施記録も残さないため。
   - 子(造影剤・被曝線量・2 件目以降の手技)を先に、ハブを後に消す。
   ［保険］カルテカードは進捗が実施済のときだけ実施情報を出す(§6.2)。この対応より
   前に取り消したオーダーには実施記録が残っており、また再実施でハブが複数になった
   場合も丸めずに並べるため。

7. **実施情報の表示**。カルテの放射線オーダーカードは実装済み(§6.2)。
   放射線検査一覧の行から実施情報を開くところは未実装。
