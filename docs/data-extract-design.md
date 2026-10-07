# データ抽出の設計

**状態: 第 1 段を実装済(2026-10-06)。** 患者を条件で抜き出して、一覧・内訳・CSV にする汎用の検索。
医師の患者抽出(コホート)、事務・経営の統計、質管理の定点観測、二次利用向けの CSV 出力を 1 つの画面でまかなう。
`functional.xlsx` の部門統計(放射線・生理・内視鏡・手術・リハ・輸血・パス)の土台にもなる。

画面はメニュー「データ > データ抽出」(`/data-extract`)。見出しの「?」で利用者向けの使い方(`components/extract/DataExtractGuide.tsx`)を
モーダルで開く。機能を足したらここも直す。

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
  | order | 部門オーダーの種別(`order_kind`。order-type のコード)・区分(`stage`: 依頼 / 実施)・項目(依頼のときだけ。任意)・期間・診療科 | 期間内にその部門オーダーの依頼(実施)がある |
  | admission | 期間・見方(期間中に入院していた / 入院した / 退院した)・診療科・病棟 | 入院がある |
  | outpatient | 期間 | 外来受診がある |

- 条件の種類ごとの定義(初期値・表示名・検証・検索・記録の日付と中身・明細の列)は `fhir/extractKinds.ts` の
  `EXTRACT_KIND_DEFS`(`Record<ExtractKind, …>`)に、入力欄は `components/extract/ExtractLeafFields.tsx` の
  `KIND_FIELDS` にまとめる。種類を足すときは `fhir/extractQueryModel.ts` の `EXTRACT_KINDS` に 1 行足し、型エラーに
  なった 2 つの表と backend の `ExtractQuery`(`KINDS`・`LEAF_FIELDS`・`LEAF_CHECK`)を埋める。
- **部門オーダー**(`order`)の種別は `fhir/orderKinds.ts` の 15 種別(処方・注射は `medication`)。
  - 依頼は 1 件 = オーダーのヘッダ 1 件。日付は実施予定日(occurrence)。中止・誤登録・下書きは数えない。
    実施済みかどうかは Task が持つので区分では分けない。「依頼したが実施していない」は依頼と実施の除外で書く(患者単位)。
  - 項目で絞れるのは、明細の ServiceRequest が項目マスタのコードを持ち、項目の検索画面がある検体検査・放射線・生理・
    内視鏡・処置・手術。明細は日付・状態・依頼科を確かに持たない(ヘッダを取り消しても明細は active のまま)ので、
    ヘッダを引いて明細の code を `_has` で当てる。セットの構成項目(セット親の下)は当たらない。
  - 実施は 1 件 = 実施のハブの Procedure 1 件(`part-of:missing=true`、`status=completed`)。実施の Procedure を書く
    放射線・生理・内視鏡・処置・手術・輸血・リハビリ・栄養指導・服薬指導だけ。放射線治療は照射ごとの Procedure と
    治療終了サマリーが同じ category に載り、上流の category の索引(先頭の coding だけ)で分けられないので外す。
    実施では項目を選べない。手術・輸血の実施は終了日を持つので、時間関係の基準に「終了日」を選べる(術後の再入院など)。
- 病名の日付の既定は**開始日**(`onsetDateTime`)。この画面の病名登録は開始日を onsetDateTime に書き、
  recordedDate を書かないため(登録日は他のシステムから来た病名のための選択肢)。
- **時間関係**(`relation`): 条件を同じ AND グループの別の条件(基準)に結び、「基準の記録の日から X〜Y 日」の
  記録だけを数える(負の日数は前)。基準の記録のどれか 1 つに対して窓に入れば数える。基準の日は開始日、
  入院・外来・部門オーダーの実施は終了日も選べる。上流では表せないので、両方の記録を読んでから手元で突き合わせる(`applyRelation`)。
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
| order(依頼) | `ServiceRequest?category=order-type\|<種別>&based-on:missing=true&status:not=revoked,entered-in-error,draft&occurrence=ge/le[&department=Organization/x][&_has:ServiceRequest:based-on:code=<項目>]` |
| order(実施) | `Procedure?category=order-type\|<種別>&status=completed&part-of:missing=true&date=ge/le[&based-on.department=Organization/x]`。依頼科は実施の元のヘッダが持つのでチェーンで引く |
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

- **出力項目**: 条件と一緒に保存する(`definition.output.patient_columns` と条件ごとの `output_fields`)。
  - 患者の列: カナ・年齢・性別・生年月日・郵便番号・住所・電話・患者ID から選ぶ。患者番号・氏名はいつも出す。
    選んでいなければ年齢・性別・生年月日(一覧・CSV・明細CSV で同じ列)。電話は固定電話、無ければ携帯。
  - 条件ごとの列: 件数・最初・最後・最新から選ぶ(既定はすべて。最後の 1 つは外せない)。
  - 出力項目は**実行し直さなくても**今の結果に反映する(画面は今の条件の出力項目で列を組み直す)。条件の一部
    なので、変えると「未保存」になる。
- **一覧**: 患者番号・氏名(カルテへのリンク)・患者の列と、条件ごとに選んだ項目をまとめた 1 セル
  (「6件 2026-04-13〜2026-08-31 ネスプ…」。最新の中身は検査は値、病名は病名、薬は薬剤名、入院は期間、
  部門オーダーは実施の手技名か種別名)。
  除外の条件と患者属性は列にしない。
- **内訳**: 性別 × 年齢階級(10 歳刻み)の人数、条件を 1 つ選んでの月別・診療科別の件数と患者数
  (結果の患者の記録だけ。`leafBreakdown`)、条件ごとの「条件だけの該当」と「結果のうち」。
  - 月別・診療科別のために、抽出のときに記録 1 件ずつの日と診療科を要約して持つ(`leafRecordsOf`)。診療科は
    処方・注射・検査・病名・部門オーダーの依頼はオーダーの依頼科(order-department 拡張。`_elements` に extension を
    含める)、入院・外来は serviceProvider。持たない記録(部門オーダーの実施など)は「不明」。
- **CSV**: 一覧と同じ列(条件ごとに選んだ項目を 1 列ずつ)を BOM 付き UTF-8 で(`lib/csv.ts`)。
- **明細CSV**: 条件に当たった記録を 1 件 1 行で(`extractDetailCsv`)。抽出では列に要る項目だけを読んでいるので、
  書き出すときに**結果の患者に絞って**記録を丸ごと引き直す(`subject=` に患者を 100 人ずつ、検索の条件は抽出と同じ。
  書き出し 1 回で検索 200 回まで)。除外の条件と患者属性は記録が無いので出さない。
  - 列: 患者番号・氏名・(選んだ患者の列)・条件・種類・日付・終了日・コード・名称・値・単位・判定・基準値・状態・
    登録日・用量・用法・日数・診療科・記録ID。種類ごとに使わない列は空にして 1 つの表にそろえる(Excel で絞れるように)。
  - 種類ごとの中身: 検査結果は測定日時・項目・値・単位・判定(interpretation)・基準値(referenceRange.text)。
    病名は開始日(日付)・転帰日・状態・登録日。処方・注射はオーダー日時・薬剤・用量(doseQuantity)・用法(dosage.text)・
    日数(expectedSupplyDuration)・依頼科。入院・外来は開始日・終了日・状態・診療科(serviceProvider)。部門オーダーの依頼は実施予定日・状態・登録日・依頼科、
    実施は実施日時・終了日・手技(code)・状態。種類は「放射線検査 依頼」のように種別と区分。
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
- 初期値(院内共通)11 件は `db/seed_data/extract_query_presets.json`(seed と migration
  `20261006130100_seed_extract_query_presets.rb`・`20261006130200_seed_extract_query_antibiotic_preset.rb` が投入)。
  同じ名前があれば触らない。「抗菌薬の注射が30日に2回以上」は薬効分類 61・62、区分「注射」、件数 2 以上。
  時間関係の例として「退院後30日以内の再入院」「2型糖尿病の開始から90日以内にHbA1c未測定」
  (migration `20261006130300_seed_extract_query_relation_presets.rb`)。部門オーダーの例として「直近30日の放射線検査の
  実施」「内視鏡の依頼があり実施のない患者(90日)」「手術後30日以内の再入院」(手術の実施の終了日が基準。
  migration `20261007120000_seed_extract_query_order_presets.rb`)。

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
- 部門オーダーの実施は依頼科の内訳を持たない(Procedure は依頼科を持たず、絞り込みはチェーンで行える)。
  実施は項目で絞れない(実施の code はレセ電の手技で、項目マスタのコードではない)。
- 今後の候補:
  - 上流の変更が要らないもの: 有害事象(CTCAE・Grade)、アレルギー、注意フラグ・感染症(Flag)、救急受診
    (`Encounter?class=EMER`)、クリニカルパスの適用とバリアンス(CarePlan / Task)。
  - 上流の変更が要るもの: 血圧(component の値の検索)、ICD10 の前方一致(C-24)、「最新値が〜」の条件(C-15 の `$lastn`)。
  - 出力: テンプレートの回答値での絞り込み(テンプレートタブの中で手元で絞る)。
  - 記録を表にするタブの追加: 細菌検査(分離菌 1 件 = 1 行、抗菌薬 = 列)、手術実績(手術 1 件 = 1 行)、有害事象。

## 8. テンプレートの抽出

「テンプレート」タブ(`?tab=template`、`components/extract/TemplateExtractPanel.tsx`)は、テンプレート 1 つの回答を
「回答 1 件 = 1 行、項目 = 列」の表と CSV にする。設定は保存しない。

- **患者の条件**: 「患者」タブに保存した条件を 1 つ選べる(選択肢は「患者」タブと同じく持ち主ごと。
  `components/extract/ExtractQuerySelect.tsx`)。選んだら実行のたびに先に `useExtractRun` でその条件の患者を抽出し
  (上限・エラーは患者の抽出と同じ。定点観測の記録は残さない)、該当した患者を `subject=` に 100 人ずつ並べて
  下の検索を患者の塊ごとに行う。該当 0 人なら回答は読まない。結果の上に「『条件名』に該当 N 人」を出す。
- **患者フォルダ**: 患者フォルダ(`docs/patient-folder-design.md`)を 1 つ選べる(選択肢は持ち主ごと、階層は字下げ。
  `components/extract/PatientFolderSelect.tsx`)。実行のたびに `/master/patient_folder_members?include_descendants=true`
  で下位フォルダを含めた患者を読み、その患者の回答だけを読む。患者の条件と両方選んだら、両方に入る患者に絞る。
  結果の上に「フォルダ『研究 / 大腸がん』に N 人」を出す。

- **取得**(`api/queries/templateExtract.ts`): `Questionnaire?url=<url>` で全版を引き、
  `QuestionnaireResponse?questionnaire=<url|版>,<url|版>…&authored=ge…&authored=le…&status=in-progress,completed,amended`
  (`&department=` は任意)`&_include=QuestionnaireResponse:subject&_sort=-authored` を strict で `searchAllPages`
  (500 件 × 20 ページ)。上流の questionnaire 検索は版込みの完全一致なので、版はカンマ OR で並べる。患者は
  include 行から取り、添わなかった患者だけ `_id` で補う。上限で切れたら新しい回答から読んだ分だけを出し、
  `TruncatedNotice` を出す(並べるだけの読み込みなので欠けても使える)。
- **列**(`fhir/templateExtractHelpers.ts`): 新しい版の項目の木を土台に、古い版にだけある項目を linkId で
  足した木から作る(group・display は列にしない)。見出しは項目名と単位、同じ見出しが重なるときは親グループ名を前に
  付ける。繰り返しグループは回答に現れた最大の件数まで「項目名_2」「項目名_3」… と列を増やす(入れ子は `_2_1`)。
  choice の下の条件付き項目は `item.item` と `answer.item` の両方を辿る。複数回答は「、」でつなぐ。
- **固定列**: 患者番号・氏名・患者の列(患者の抽出と同じ選択肢)・記入日時・記入者(contained の氏名)・診療科・版・状態。
- **患者ごとに最新**: 読んだ回答のうち患者ごとに記入日時が最新の 1 件だけを出す(期間内での最新)。
- 画面には先頭 500 行を出し、CSV にはすべて出す。

## 9. 検査結果の抽出

「検査結果」タブ(`?tab=lab`、`components/extract/LabExtractPanel.tsx`)は、選んだ検査・バイタルの Observation を
「行 = 測定日時 / 日 / 患者、列 = 項目」の表と CSV にする。設定は保存しない。記録を表にするタブは種類ごとに
タブを分ける(1 つのタブで種類を切り替えると入力欄が種類ごとに変わり、タブ名も付けにくいため)。

- **項目**: チャートの項目(`ChartItem`)と同じ形で持つ。「検査項目」(結果項目マスタ → `labChartItem`)、「バイタル」
  (`vitalChartItems` を `VitalItemSelectModal` で選ぶ。血圧は収縮期・拡張期の 2 列)。どちらもモーダルで 1 件ずつ選ぶ。50 項目まで。
- **患者の絞り込み**: テンプレートの抽出(§8)と同じ。患者の条件・患者フォルダの解決は `hooks/useExtractPatientScope.ts`、
  subject= の分割と _include の患者は `api/queries/extractRecords.ts` をテンプレートと共有する。
- **取得**(`api/queries/labExtract.ts`): `Observation?code=<項目の coding>&date=ge…&date=le…&status:not=entered-in-error,cancelled`
  (`&department=` は任意)`&_include=Observation:subject&_sort=-date` を strict で `searchAllPages`(500 件 × 20 ページ)。
  コードは 100 件ずつに分けて引き、記録を合わせる。
- **突き合わせ**(`fhir/labExtractHelpers.ts`): 施設の結果項目コードを持つ結果はそのコードだけで項目に当てる(JLAC11 が同じ
  別の結果項目、定量と定性などに入らないように)。持たない結果は coding のどれかで当てる。
- **行**:
  - 測定日時ごと: 患者 × 測定日時(分まで)。同じ行に同じ項目が 2 件あれば後から書かれた方(訂正)。
  - 日ごと: 患者 × 日。同じ日に複数あれば遅い時刻の値。
  - 患者ごと: 項目ごとに最初・最新・最大・最小・平均・件数から選んだ集計を列にする。最初・最新には日時の列を添える。
    最大・最小・平均は数値の結果だけ。**読み切れなかった(truncated)ときは表を出さない**(最初・件数などが嘘になるため)。
    測定日時ごと・日ごとは新しいものから読んだ分を出し、`TruncatedNotice` を出す。
- **H/L**: 「H/L」を選ぶと値の隣に列を出す。検査は結果の interpretation(N は空)、バイタルは施設のしきい値
  (`vitalInterpretationOf`)。選択肢の項目には出さない。
- **単位**: 項目の結果の単位が 1 つなら見出しに付け、ばらつくなら単位の列を出す(患者ごとの行は使った単位を「、」で)。
  バイタルとテンプレートは項目の単位にそろえる。
- **固定列**: 患者番号・氏名・患者の列(患者の抽出と同じ選択肢)・測定日時 / 日付。画面は先頭 500 行、CSV はすべて。
