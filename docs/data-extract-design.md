# データ抽出の設計

**状態: 第 1 段を実装済(2026-10-06)。** 患者を条件で抜き出して、一覧・内訳・CSV にする汎用の検索。
医師の患者抽出(コホート)、事務・経営の統計、質管理の定点観測、二次利用向けの CSV 出力を 1 つの画面でまかなう。
`functional.xlsx` の部門統計(放射線・生理・内視鏡・手術・リハ・輸血・パス)の土台にもなる。

画面はメニュー「データ > データ抽出」(`/data-extract`)。

## 1. 方針

- **データ源は上流 FHIR をその場で検索する。** backend に DWH のテーブルは作らない(同期の仕組みと二重管理を
  持ち込まない)。件数が増えて遅くなったら、評価の層(`api/queries/extractQuery.ts`)だけを backend / DWH に
  差し替えられるように層を分ける。条件のモデル・結果の行・画面は `fhir/extractQueryHelpers.ts` の形にしか
  依存しない。
- 上流は集計の operation を持たない(`$distinct-dates?count=true` だけ)。患者の集合は条件ごとに上流を引いて
  作り、組み合わせ(AND / OR / 除外)と集計(内訳)は画面で行う。
- **検索はすべて strict**(`Prefer: handling=strict`)。上流は既定で未知の条件を黙って読み飛ばして全件を返すので、
  条件が落ちると結果が嘘になる。本番の proxy は lenient 既定なので、frontend が明示して送る
  (`searchResource(type, params, { strict: true })`)。
- **読み切れない条件があれば結果を出さない。** 欠けた集合で AND・除外を計算すると該当者が嘘になる。

## 2. 条件のモデル

保存は backend の `extract_queries.definition`(jsonb、`schema_version: 1`)。形の検証は
`ExtractQuery::DEFINITION_SHAPE`(JsonShape)と画面の `validateExtractQuery` の両方で行う。

```json
{ "schema_version": 1,
  "root": { "op": "and", "children": [
    { "key": "dm", "kind": "condition", "label": "2型糖尿病",
      "codes": [{ "system": "…ICD10-2013-full", "code": "E11" }], "clinical_status": ["active"] },
    { "key": "a1c", "kind": "observation", "not": true,
      "codes": [{ "system": "…lab-result-item", "code": "160010010", "display": "HbA1c" }],
      "period": { "mode": "relative", "days": 90 } },
    { "op": "or", "children": [ … ] } ] } }
```

- グループ `{op, children}` と条件(`kind`)の入れ子。深さは 3 まで(ルート > グループ > 条件)、条件は 20 個まで、
  1 条件のコードは 200 件まで。
- 条件の種類:

  | kind | 入力 | 意味 |
  |---|---|---|
  | patient | 性別・年齢(以上 / 以下) | 患者の属性 |
  | condition | 病名(病名管理番号 or ICD10)・状態・日付(登録日 / 発症日)と期間 | その病名がある |
  | observation | 検査結果項目 / バイタル・値の範囲・期間 | 期間内にその記録がある(値の範囲に入る) |
  | medication | 薬剤(レセ電コード)・期間 | 期間内に処方・注射のオーダーがある |
  | admission | 期間・見方(期間中に入院していた / 入院した / 退院した)・診療科 | 入院がある |
  | outpatient | 期間 | 外来受診がある |

- 期間は日付(`absolute`、片側だけでもよい)か直近 N 日(`relative`。定点観測で日付を直さずに済む)。保存には
  絶対日を書かず、実行時に今日で解決する。
- `min_count`(期間内に N 件以上)はモデルだけ持つ(画面は第 2 段)。
- **除外**(`not`)は AND グループの直下で、除外でない兄弟が 1 つ以上あるときだけ置ける。兄弟の積集合から差を
  取るため(OR の下や除外だけの AND は「全患者」の集合が要る)。
- ICD10 の入力は上流の token が完全一致なので、3 桁(E11)を 4 桁の細分類(E110〜E119)まで広げて送る
  (`expandIcd10`)。病名マスタの ICD10 はピリオド無し。

## 3. 評価

`useExtractRun`(`api/queries/extractQuery.ts`)。条件ごとの検索は `leafSearch`(純粋関数)が組み立てる。

| 条件 | 検索 |
|---|---|
| condition | `Condition?code=…&clinical-status=…&verification-status:not=entered-in-error,refuted&category:not=<看護問題>&recorded-date(onset-date)=ge/le&_elements=subject,code,recordedDate,onsetDateTime` |
| observation | `Observation?code=…&date=ge/le&value-quantity=ge8&status:not=entered-in-error,cancelled&_elements=subject,code,effectiveDateTime,valueQuantity` |
| medication | `MedicationRequest?code=…&authoredon=ge/le&status:not=entered-in-error,cancelled&_elements=subject,authoredOn,medicationCodeableConcept` |
| admission | `Encounter?class=IMP&status=in-progress,finished&date=…[&service-provider=Organization/x]`。入院した = `date=sa{from-1}&date=le{to}`、退院した = `date=ge{from}&date=eb{to+1}` |
| outpatient | `Encounter?class=AMB&status:not=cancelled,entered-in-error&date=ge/le` |
| patient | `Patient?gender=…&birthdate=le/gt&active:not=false`(AND の下では引かない。下記) |

- 共通: `_count=500`、`_offset` でページング、`_total=none`、strict。1 検索 20 ページ(1 万件)まで、1 回の実行で
  検索 120 回まで、該当者 5000 人まで。超えたら `ExtractLimitError` で止めて結果を出さない。
- コードが 100 件を超える条件は分けて引き、患者の和集合を取る(URL の長さ)。
- 絞り込みの条件が 1 つも無い検索は送らない(`isUnfiltered`。lenient の事故の二重の防止)。
- 条件は 2 つずつ並列に引く(レート制限は全利用者の合計で 300 件/分)。429 は 20 秒待って 1 回だけやり直す。
- 同じ検索(条件を 1 つ直して再実行したときの他の条件)は 5 分覚えておき引き直さない。「再読込」で捨てる。
- **AND の下の患者属性**(除外でなく、患者属性以外の兄弟がある)は上流を引かない。兄弟で絞った患者を読んで
  手元で当てる(`patientFilterLeaves` / `patientMatches`)。「75 歳以上」のように該当が多い条件を全件読まずに済む。
- 組み合わせは `combineSets`: AND は積(小さい集合から)、OR は和、除外は差。

## 4. 結果

- **一覧**: 患者番号・氏名(カルテへのリンク)・年齢・性別と、条件ごとに「件数・最初〜最後の日付・最新の中身」
  (検査は値、病名は病名、薬は薬剤名、入院は期間)。除外の条件と患者属性は列にしない。
- **内訳**: 性別 × 年齢階級(10 歳刻み)の人数と、条件ごとの「条件だけの該当」と「結果のうち」。
- **CSV**: 一覧と同じ列(条件ごとに件数・最初・最後・最新の 4 列)を BOM 付き UTF-8 で(`lib/csv.ts`)。

## 5. 保存と権限

- `extract_queries`(列はチャート定義と同じ)。持ち主は院内共通 / 診療科 / 自分の 3 段階。
- backend の登録・参照はチャート定義と共通の concern `Master::ScopedDefinitions`。院内共通・診療科に書けるのは
  医師だけ(画面で絞る。backend が守るのは「自分の条件の持ち主はログイン本人」だけ)。持ち主の選択肢は
  `hooks/useDefinitionOwners.ts`(マルチチャートと共通)。
- 初期値(院内共通)5 件は `db/seed_data/extract_query_presets.json`(seed と migration
  `20261006130100_seed_extract_query_presets.rb` が投入)。同じ名前があれば触らない。

## 6. 上流(fhir-server)

Observation に `value-quantity`(数値の比較。prefix eq ne ge le gt lt、単位は読み捨て)を足した。検索型
`:quantity`、列 `value_quantity`(decimal)、migration `20261007000001_add_value_quantity_to_observations.rb` が既存の
測定値を backfill する。**本番は fhir-server を先にデプロイする**(旧版だと strict で 400 になり、値の条件を
含む抽出が動かない)。

## 7. 制限と第 2 段

- 処方と注射を分けられない(MedicationRequest に区別の索引が無い。ヘッダ ServiceRequest の category を
  `based-on.category` のチェーンで引けるが、上流の作りでは件数が多いと遅い)。
- 外来の診療科で絞れない(外来の Encounter は serviceProvider を持たない)。入院の病棟は未対応。
- 病名の ICD10 は前方一致できない(上記の展開で 3 桁だけ吸収する)。
- 時間関係の条件(診断から 90 日以内の測定、30 日以内の再入院)、薬効分類での薬剤の指定、`min_count` の画面、
  明細 CSV(条件に該当した記録を 1 行 1 件)、内訳の拡充(診療科別・月別)、上流の集計 operation、
  定点観測の履歴(件数のスナップショット)は第 2 段。
