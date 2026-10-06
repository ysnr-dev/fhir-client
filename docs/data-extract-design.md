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
  | condition | 病名(病名管理番号 or ICD10)・状態・日付(開始日 / 登録日)と期間 | その病名がある |
  | observation | 検査結果項目 / バイタル・値の範囲・期間 | 期間内にその記録がある(値の範囲に入る) |
  | medication | 薬剤(レセ電コード)・薬効分類(YJ コードの先頭 2〜4 桁)・区分(処方 / 注射 / 両方)・期間 | 期間内に処方・注射のオーダーがある |
  | admission | 期間・見方(期間中に入院していた / 入院した / 退院した)・診療科・病棟 | 入院がある |
  | outpatient | 期間 | 外来受診がある |

- 病名の日付の既定は**開始日**(`onsetDateTime`)。この画面の病名登録は開始日を onsetDateTime に書き、
  recordedDate を書かないため(登録日は他のシステムから来た病名のための選択肢)。
- **時間関係**(`relation`): 条件を同じ AND グループの別の条件(基準)に結び、「基準の記録の日から X〜Y 日」の
  記録だけを数える(負の日数は前)。基準の記録のどれか 1 つに対して窓に入れば数える。基準の日は開始日、
  入院・外来は終了日も選べる。上流では表せないので、両方の記録を読んでから手元で突き合わせる(`applyRelation`)。
  基準は除外でも患者属性でもなく、自分も時間関係を持たない兄弟だけ(連鎖させない)。除外と組み合わせると
  「開始から 90 日以内に HbA1c の測定が無い」、入院どうしなら「退院の翌日〜30 日の再入院」が書ける。
  明細 CSV にも同じ絞り込みをかける。
- 期間は日付(`absolute`、片側だけでもよい)か直近 N 日(`relative`。定点観測で日付を直さずに済む)。保存には
  絶対日を書かず、実行時に今日で解決する。
- 患者属性以外の条件は「件数(以上)」(`min_count`、既定 1)を持つ。期間内にその件数以上の記録がある患者だけが当たる
  (「抗菌薬の注射が 30 日に 2 回以上」など)。判定は患者ごとに畳んだ件数で手元で行う。
- 薬効分類(`drug_classes`)は保存した条件にはコードを持たず、**実行のたびに**医薬品マスタで医薬品コードに展開する
  (`GET /master/medicines/codes?yakko_prefix=61,62`。廃止された薬も含む)。条件を保存した後に採用された薬も拾える。
  薬剤と薬効分類の両方を指定したら和をとる。
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
| medication | `MedicationRequest?code=…&authoredon=ge/le[&based-on.category=order-type\|prescription]&status:not=entered-in-error,cancelled&_elements=subject,authoredOn,medicationCodeableConcept`。処方 / 注射の区別はヘッダ ServiceRequest の order-type なので based-on のチェーンで引く |
| admission | `Encounter?class=IMP&status=in-progress,finished&date=…[&service-provider=Organization/x][&location.partof.partof=Location/<病棟>]`。病棟はベッド → 病室 → 病棟のチェーン(転棟前のベッドも location に残るので、期間中にその病棟にいたことがある入院が当たる)。入院した = `date=sa{from-1}&date=le{to}`、退院した = `date=ge{from}&date=eb{to+1}` |
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
- **内訳**: 性別 × 年齢階級(10 歳刻み)の人数、条件を 1 つ選んでの月別・診療科別の件数と患者数
  (結果の患者の記録だけ。`leafBreakdown`)、条件ごとの「条件だけの該当」と「結果のうち」。
  - 月別・診療科別のために、抽出のときに記録 1 件ずつの日と診療科を要約して持つ(`leafRecordsOf`)。診療科は
    処方・注射・検査・病名はオーダーの依頼科(order-department 拡張。`_elements` に extension を含める)、入院・
    外来は serviceProvider。持たない記録は「不明」。
- **CSV**: 一覧と同じ列(条件ごとに件数・最初・最後・最新の 4 列)を BOM 付き UTF-8 で(`lib/csv.ts`)。
- **明細CSV**: 条件に当たった記録を 1 件 1 行で(`extractDetailCsv`)。抽出では列に要る項目だけを読んでいるので、
  書き出すときに**結果の患者に絞って**記録を丸ごと引き直す(`subject=` に患者を 100 人ずつ、検索の条件は抽出と同じ。
  書き出し 1 回で検索 200 回まで)。除外の条件と患者属性は記録が無いので出さない。
  - 列: 患者番号・氏名・年齢・性別・患者ID・条件・種類・日付・終了日・コード・名称・値・単位・判定・基準値・状態・
    発症日・用量・用法・日数・診療科・記録ID。種類ごとに使わない列は空にして 1 つの表にそろえる(Excel で絞れるように)。
  - 種類ごとの中身: 検査結果は測定日時・項目・値・単位・判定(interpretation)・基準値(referenceRange.text)。
    病名は登録日・転帰日・状態・発症日。処方・注射はオーダー日時・薬剤・用量(doseQuantity)・用法(dosage.text)・
    日数(expectedSupplyDuration)・依頼科。入院・外来は開始日・終了日・状態・診療科(serviceProvider)。
  - 並びは患者番号 → 条件の順 → 日付の順。状態は日本語の表示名(表に無い値はコードのまま)。

- **推移**: 保存した条件を**直さずに**実行したときだけ、該当人数と条件ごとの人数を `extract_query_runs` に残す
  (実行日時・実行者つき。患者は持たない)。結果の「推移」タブに、推移のグラフ(該当人数と、一覧の列になる条件
  ごとの人数をパネルで縦に並べる。1 日に何度実行しても点が重ならないよう、日ごとに最後の実行を 1 点にする。
  目盛りは整数だけ)と、すべての実行の表(新しい順)を出す(条件を直していると出さない)。グラフは検査結果の
  時系列と同じ `LabTimelineChart`。
  定点観測の推移を見るため。条件を消すと記録も消える。

## 5. 保存と権限

- `extract_queries`(列はチャート定義と同じ)。持ち主は院内共通 / 診療科 / 自分の 3 段階。
- backend の登録・参照はチャート定義と共通の concern `Master::ScopedDefinitions`。院内共通・診療科に書けるのは
  医師だけ(画面で絞る。backend が守るのは「自分の条件の持ち主はログイン本人」だけ)。持ち主の選択肢は
  `hooks/useDefinitionOwners.ts`(マルチチャートと共通)。
- 初期値(院内共通)8 件は `db/seed_data/extract_query_presets.json`(seed と migration
  `20261006130100_seed_extract_query_presets.rb`・`20261006130200_seed_extract_query_antibiotic_preset.rb` が投入)。
  同じ名前があれば触らない。「抗菌薬の注射が30日に2回以上」は薬効分類 61・62、区分「注射」、件数 2 以上。
  時間関係の例として「退院後30日以内の再入院」「2型糖尿病の開始から90日以内にHbA1c未測定」
  (migration `20261006130300_seed_extract_query_relation_presets.rb`)。

## 6. 上流(fhir-server)

Observation に `value-quantity`(数値の比較。prefix eq ne ge le gt lt、単位は読み捨て)を足した。検索型
`:quantity`、列 `value_quantity`(decimal)、migration `20261007000001_add_value_quantity_to_observations.rb` が既存の
測定値を backfill する。**本番は fhir-server を先にデプロイする**(旧版だと strict で 400 になり、値の条件を
含む抽出が動かない)。

## 7. 制限と第 2 段

- 処方 / 注射の区別は `based-on.category` のチェーンで引いている。上流は 0..* 参照のチェーンで内側の id を Ruby に
  取り出すので、オーダーの多い施設では遅くなりうる(開発データでは 0.1〜0.2 秒。遅ければ上流の C-23)。
- 外来の診療科で絞れない(外来の Encounter は serviceProvider を持たない)。
- 病名の ICD10 は前方一致できない(上記の展開で 3 桁だけ吸収する)。
- 上流の集計 operation(C-25)は未対応。定点観測は画面で実行したときだけ記録する(決まった間隔での自動実行は無い)。
