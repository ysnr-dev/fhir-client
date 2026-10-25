# 感染症の発生届(届出対象の一覧・発生届の記録)の設計

`docs/functional-gap-backlog.md` §4.1「提出データの生成」のうち、感染症法の発生届の部分。院内がん登録
(`docs/cancer-registry-design.md`)と同じ骨組み(病名 1 件 ↔ テンプレートの回答 1 件)で作り、共通部分は
`fhir/conditionTemplateHelpers.ts` に置く。

- **［事実］** = 感染症法(第 12 条)・届出基準、FHIR R4・上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 配布資料で確かめていない読み

## 1. 背景とスコープ

医師は届出対象の感染症を診断したとき保健所へ届け出る義務がある(一類〜四類・新型インフルエンザ等は直ちに、
五類の全数把握は 7 日以内)。届出漏れ・遅れは行政指導の対象で、診断した医師が気づける仕組みが要る。

含めるもの:

- 届出対象(全数把握)の感染症に当たる病名を見つけ、届出の状況と期限を横断して見る一覧(診療業務 > 感染症発生届、
  `/infectious-disease-reports`)と、ホームのカード(医師の既定)
- 一覧の行からカルテの右ペインで発生届(テンプレート回答)を書き始める。病名を紐付ける
- 発生届の共通項目のテンプレートと、初期値変数「発生届」

含めないもの(§7):

- 感染症サーベイランスシステム(NESID)への送信・届出様式(別記様式)の PDF、定点把握の週報・月報、耐性菌(ICD-10 で表せない)、
  検査結果(細菌検査・感染症 Observation)からの検知、病名登録時の通知

## 2. データの持ち方

### 2.1 発生届(QuestionnaireResponse)

［設計］新しいリソースは作らない。発生届は施設設定「感染症発生届」のテンプレート(既定 `IDSC_NOTIFY_01`)への
QuestionnaireResponse 1 件 = 届出 1 件。対象の病名は回答の対象プロブレムの拡張(院内がん登録と同じ)。

| 要素 | 値 |
|---|---|
| `questionnaire` | テンプレートの canonical |
| `subject` | 患者 |
| `status` | `in-progress`(記入中)/ `completed` `amended`(記入済・届出済) |
| 拡張 `questionnaire-response-problem` | 届出対象の病名(Condition) |
| item `idn_status` | 届出状況(`unreported` 未届出 / `reported` 届出済)。一覧の「届出済」はこの値で決める |
| item `idn_notify-date` | 届出年月日 |

- ［設計］回答が確定していても届出状況が「届出済」でなければ一覧は「記入済」にする。発生届は書いてから
  FAX・オンラインで届け出るので、確定 = 届出済とは限らない。
- ［設計］共通項目のテンプレート 1 本で始める。感染症ごとの届出様式(別記様式)の固有項目(症状・検査方法の選択肢)は
  自由文の「症状」「診断方法」に書く。施設が疾患別のテンプレートを作ったときは施設設定で差し替える。

### 2.2 届出対象の病名

［設計］`fhir/infectiousDiseaseReportHelpers.ts` の `NOTIFIABLE_DISEASES`(感染症名・類型・届出期限・ICD-10 の前方一致)。
一類 7・二類 5・三類 5・四類 41・五類全数把握 19。

- ［事実］届出期限は一類〜四類・新型インフルエンザ等が「直ちに」、五類全数把握が「7 日以内」。五類のうち麻しん・風しん・
  侵襲性髄膜炎菌感染症は直ちに。
- ［要確認］ICD-10 の対応は届出基準から置いたもので、配布の対応表と突き合わせていない(SARS の U04.9、急性脳炎の
  A86 / G04.0、劇症型溶血性レンサ球菌感染症の A40 / A48.3 など)。新型インフルエンザ等感染症と指定感染症は、
  発生時に厚生労働省が定めるので表に無い。耐性菌(CRE・VRE・VRSA・MDRA)は ICD-10 で表せないので入れていない。
- ［事実］上流の token 検索は完全一致で前方一致が無い。3 桁を 4 桁の細分類まで広げて 100 件ずつ `code=` に並べる
  (院内がん登録と同じ)。
- ［設計］疑い・否定・誤記は除く。疑似症患者の届出(一類など)は確定病名で登録してから行う。期間は病名の開始日(診断日)。

### 2.3 施設設定

［設計］`facility_settings.infectious_disease_report = { "template": "<url>" }`(既定は同梱テンプレートの url)。

## 3. 初期値変数「発生届」(`fhir/populateContext.ts`)

| 変数 | 内容 |
|---|---|
| `%notifiableDiseaseName` | 届出基準の感染症名 |
| `%notifiableDiseaseClass` | 類型(一類〜五類・新型インフルエンザ等) |
| `%notifiableDiseaseDeadline` | 「直ちに」/「7 日以内」 |
| `%notifiableDueDate` | 届出期限(診断日 + 期限の日数) |
| `%notifiableDiagnosisDate` | 診断日(病名の開始日) |

- ［設計］対象の病名は、記入を始めたときの対象プロブレム(一覧から渡した病名)が届出対象ならそれ、そうでなければ
  届出対象の病名のうち開始日が最も新しいもの。がん登録と同じ規則で、対象プロブレムの id は `usePopulateSources` の
  `focusConditionId` として両方が読む。
- ［設計］元データは患者の病名(既に読んでいる)だけなので、余計な読み込みは無い。患者・自院・作成者の既存の変数と
  組み合わせて様式の共通項目を埋める(`docs/report-mappings/idsc-notify-01.md`)。

## 4. 一覧(診療業務 > 感染症発生届、`/infectious-disease-reports`)

［設計］`pages/InfectiousDiseaseReportPage.tsx`。院内がん登録と同じ作り。

- **絞り込み**: 診断日の期間(既定は今日までの 90 日)、類型、状態(未届出 / 記入中 / 記入済 / 届出済)、期限超過。
- **行** = 届出対象の病名 1 件。患者・性別・年齢・病名・届出対象の感染症名・類型・診断日・届出期限(「直ちに」/「7 日以内」)・期限日・
  届出(状態)・届出日・記入者・操作(「届出」/「開く」)。届出が済まないまま期限を過ぎた行は赤。
- **届出を始める**: 「届出」でカルテを `?open=condition-template:<Condition id>@<テンプレートの url>` で開き、右ペインの
  「テンプレート登録」にテンプレートと対象プロブレムを選んだ状態で入る(院内がん登録の `cancer-registry` を汎用にした
  `condition-template`)。「開く」はその回答の詳細。
- **ホームのカード**「感染症発生届」(`components/homeCards/InfectiousReportsCard.tsx`): 直近 90 日の未届出の件数と期限超過の件数。
  医師の既定のカードに入れる。

## 5. 実装したもの

- `fhir/conditionTemplateHelpers.ts`: 病名と回答の突き合わせ(院内がん登録と共用)
- `fhir/infectiousDiseaseReportHelpers.ts`: 届出対象の表・判定・期限・行・初期値変数
- `api/queries/cancerRegistry.ts` の `fetchConditionCandidates` / `fetchTemplateResponses`(共用)、`api/queries/infectiousDiseaseReport.ts`
- `pages/InfectiousDiseaseReportPage.tsx`、`appMenu.ts`(診療業務 > 感染症発生届)、`App.tsx`、`fhir/homeCards.ts` + `InfectiousReportsCard`
- `karteUrl.ts` / `KartePage.tsx`: `open=condition-template:<Condition id>@<url>`(院内がん登録も同じ)
- backend `FacilitySettings::SETTINGS` の `infectious_disease_report`、spec、`FacilitySettingsPage`
- `docs/report-mappings/idsc-notify-01.questionnaire.json`(`IDSC_NOTIFY_01`)

## 6. 検証(開発環境、2026-10-25)

- テスト太郎に腸管出血性大腸菌感染症(三類、診断日 2 日前)、糖尿 太郎に百日咳(五類、診断日 今日)の病名を登録し、
  一覧に 2 行(前者は期限超過の赤、後者は期限 7 日後)が出ること。
- 「届出」からカルテの右ペインで発生届が開き、感染症名・類型・期限・診断日・患者・医療機関・医師が入ること。
  届出状況を「届出済」にして確定すると一覧が「届出済」になること。ホームのカードの件数が合うこと。
- `tsc -b`、lint、backend rspec。

## 7. 申し送り

1. **感染症サーベイランスシステムへの送信・様式の PDF**: いまは画面で書いて保健所へは別途届け出る。届出様式(別記様式)は
   疾患ごとに違うので、PDF を出すなら疾患別のテンプレートと帳票レイアウトが要る。
2. **検査結果からの検知**: 細菌検査(耐性菌 CRE・VRE・VRSA・MDRA、腸管出血性大腸菌の分離)と感染症 Observation(梅毒・HIV の陽性)を
   届出対象の候補に足す。病名が付く前に結果が出ることが多い。
3. **病名登録時の通知**: 届出対象の病名を登録した時点で診断医あてに通知(Task)を作る。病名の登録経路が複数あるので、
   共通の保存口を決めてから。
4. **届出対象の表の確認**: §2.2 の ICD-10 対応と、新型インフルエンザ等・指定感染症の追加。表を施設設定かマスタに移すかは
   改定の頻度を見て決める。
5. **疾患別の様式**: 届出基準の別記様式の項目(症状・検査方法の選択肢)をテンプレートにする。共通テンプレートから分岐させる形。
6. **定点把握**: 五類定点の週報・月報は対象外のまま。
