# 特定生物由来製剤のロット番号と薬剤付加情報の設計

**状態: 実装済(2026-10-06)。** `functional.xlsx` の「ロット管理一覧」「ロット入力一覧」「ロット番号入力画面」
(1819-1835)に当たる。

特定生物由来製品は、使用した患者とロットの記録を 20 年保存する義務がある(医薬品医療機器等法)。回収や感染症の
報告があったとき、ロットから投与した患者を逆引きできなければならない。輸血は製剤番号を記録していたが、
それ以外の薬はロットをどこにも持っていなかった。

## 1. 薬剤付加情報マスタ

### 1.1 なぜ汎用の付加情報にするか

ロット管理の対象(特定生物由来製品)は、医薬品マスタ(レセプト電算)に区別する項目が無い。マスタの「生物学的
製剤」の印(`biological_product_flag`、開発 DB で 39 件)はワクチン・抗毒素で、アルブミン製剤や血漿分画製剤の
多くは付いていない。対象は施設が決める。

施設が薬ごとに持ちたい設定はロット管理のほかにも出てくる(採用区分・院内の注意など)ので、ロット管理専用の
テーブルではなく、**施設独自の薬剤の設定を 1 薬 1 行で持つ「薬剤付加情報」**にした。

### 1.2 テーブル

`master_medicine_attributes`:`medicine_code`(一意)、`settings`(jsonb)、`note`。

- 医薬品マスタは取込のたびに `delete_all` で入れ直すので、FK は持たず `medicine_code` の文字列で結ぶ
  (`master_medicine_dose_conversions` と同じ)。
- 項目は `settings` に入れる。**項目を足すときに書くのは `Master::MedicineAttribute::ATTRIBUTES` の 1 行だけ**で、
  migration は要らない。検証は `JsonShape`、API の `definitions` と画面の列もこの表から回る(施設設定
  `FacilitySettings::SETTINGS` と同じ作り)。
- 各項目は「行の値 → 無ければ既定」で実効値が決まる。既定は医薬品マスタの行を受け取るラムダで書く。
  ロット管理(`lot_required`)の既定は生物学的製剤の印。明示の false で既定を外せる。画面の「未設定」(null)は
  保存せず既定に戻す。

### 1.3 API(`/master/medicine_attributes`)

| | |
|---|---|
| `GET /` | 行と医薬品名・単位・実効値。`default=true` で、行が無くても既定で項目が真になる薬も並べる(`registered: false`) |
| `GET /definitions` | 項目の定義(key・表示名・型) |
| `GET /lookup?medicine_code=a,b` | コード → 実効値。実施入力が行ごとにロット欄を出すかを決める |
| `POST` / `PATCH /:id` / `DELETE /:id` | 行の登録・更新(`medicine_code` は変えない)・削除(既定に戻る) |

画面はマスタメンテ「医薬品」>「薬剤付加情報」(`/medicine-attributes`)。

## 2. ロット番号の持ち方

ローカル拡張 `http://fhir-client.local/StructureDefinition/medication-lot-number`(`valueString`)を
**MedicationAdministration に直接**付ける。

- FHIR の標準の置き場は `Medication.batch.lotNumber` だが、このコードベースはどの実施記録も
  `medicationCodeableConcept` で薬を持ち、contained Medication を使っていない。輸血の製剤番号
  (`transfusion-lot-number`)と同じ理由で拡張にした(`docs/transfusion-order-design.md` §2.6)。
- 読み書きは `fhir/lotNumberHelpers.ts`(`lotNumberOf` は輸血の拡張も読む。`withLotNumber` は拡張だけを付け替える)。
- 入力は全角を半角にそろえる(NFKC)。バーコードリーダーはキーボード入力として入るので、テキスト欄で受ける。
  GS1 の分解(期限・シリアルの切り出し)はしない。

## 3. 入力する画面

薬を記録する実施入力すべて:注射・処置・手術・内視鏡・放射線(造影剤)。輸血は製剤番号を従来どおり輸血の
実施入力で入れる。

- 対象の薬が 1 つでもあれば薬の表に「ロット番号」列を出し、対象の行にだけ欄を出す(`components/LotNumberCell.tsx`、
  対象判定は `useLotRequiredCodes`)。
- **ロットは必須にしない**。現場では施用後に箱から転記することがあるので、空の行があれば列見出しに「未入力」を
  添えて登録はさせ、ロット管理の未入力一覧で拾う。
- 同じ記録の同じ薬に同じロットが重なったら行のエラーにし、登録させない(2 本目に 1 本目のロットを読ませた
  取り違え)。
- 記録の表示(カルテのカードの実施履歴)では薬剤に「ロット ○○」を添える。

## 4. ロット管理画面(`/lot-management`)

部門業務 > 薬剤部門 >「ロット管理」。

- **ロット検索**:`MedicationAdministration?lot-number=…`(前方一致。「完全一致」で `:exact`)に
  `_include=…:subject` と `_include=…:part-of` を添え、実施日時・患者・種別(ハブの Procedure の
  order-type)・薬・量・ロットを並べる。CSV(BOM 付き UTF-8)で出せる。輸血の製剤番号も同じ検索で引ける。
- **ロット未入力**:期間(既定は直近 30 日)の実施記録(注射・処置・手術・内視鏡・放射線のハブ Procedure)を
  `_revinclude=MedicationAdministration:part-of` で薬ごと引き、ロットの無い投与を薬剤付加情報に照会して
  ロット管理の薬だけ残す。行の「ロット入力」で、読んだ版に拡張だけを足して PUT する(版違いは 412)。
  実施記録には編集が無いので、これが投与記録の唯一の書き換えになる。

## 5. 上流(fhir-server)

MedicationAdministration の検索に `lot-number`(string、列 `lot_number`)を足した。抽出は
`medication-lot-number` と `transfusion-lot-number` の両方の拡張から(Immunization の `lot-number` と同じ作り)。
migration `20261006000001_add_lot_number_to_medication_administrations.rb` が列を足し、既存の輸血の製剤番号を
backfill する。**本番は fhir-server を先にデプロイする**(上流の検索は未対応の条件を黙って無視するので、旧版だと
どのロットでも全件が返る)。

## 6. 残り

- 実装ガイド(`../fhir-ig`)に `medication-lot-number` 拡張の定義を足す(未反映)。
- 有効期限の記録と、GS1 バーコードからのロット・期限の切り出し。
- 薬剤付加情報の項目の追加(採用区分など)。
