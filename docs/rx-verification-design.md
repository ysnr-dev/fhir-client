# 処方監査(監査キュー)と薬剤師介入記録の設計

`docs/functional-gap-backlog.md` §5.4「薬剤師の処方監査キューと介入記録」(§5.2 #12、海外 EHR との照合)。

**実装済み(2026-10-25)**。開発環境で §7 の検証を通した。

- **［事実］** = FHIR R4・上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと

ユーザー決定(2026-10-25): (1) キューは専用の「処方監査」一覧に置き、処方一覧・注射一覧の行にも監査の印と「監査」を出す、
(2) 対象は院内の処方と注射(院外処方・持参の処方は対象外)、(3) 監査前の調剤登録・払出登録を止めるかは施設設定で選び、既定は止めない、
(4) 介入の記録は種別(小マスタから複数)・内容(自由記述)・処方医の対応(処方変更 / 変更なし / 中止)。

## 1. 背景とスコープ

確定した処方・注射は、そのまま処方一覧・注射一覧に出て調剤・払出へ進む。薬剤師が内容を確かめたかどうかは残らず、
日付をまたいで「まだ誰も見ていない処方」を並べる場所も無かった。疑義照会(`docs/features/medication.md`「疑義照会」)は
処方医とのやり取りとしては残るが、薬剤師が何を防いだか(用量・相互作用・腎機能…)の分類と月次の件数は出せなかった。
海外の EHR では処方の確定から調剤までの間に薬剤師の確認(Verification)を挟むのが標準で、国内でも介入の記録
(日本病院薬剤師会のプレアボイド報告)が病棟薬剤業務の実績として求められる。

含めるもの:

- 院内の処方・注射を確定したときに監査 Task を作り、薬剤師が監査して「監査済」にする
- 処方監査一覧(部門業務 > 薬剤部門 > 処方監査)と、処方一覧・注射一覧の印・「監査」
- 監査の画面に処方・注射の内容、患者の状態(アレルギー・腎機能)、登録時と同じ薬剤の警告を並べる
- 介入の記録(種別・内容・処方医の対応)と、データ抽出の「薬剤師介入」タブでの集計
- 施設設定「処方監査」(監査済まで調剤登録・払出登録を出さない)

含めないもの(§8): 監査できる人を職種で縛ること、介入率(分母で割った率)の指標、注射の実施入力を止めること。

## 2. データの持ち方

### 2.1 監査 Task

［設計］`fhir/rxVerificationHelpers.ts`。通知の Task の組み立て(`fhir/notificationHelpers.ts`)を使い、種別だけ新しくする
(検査結果フォローの台帳 `fhir/followUpHelpers.ts` と同じ作法)。

| 要素 | 値 |
|---|---|
| `code` | `task-code|rx-verification`(処方監査) |
| `status` | `requested`(未監査)/ `completed`(監査済) |
| `priority` | オーダーの至急区分を写す(至急の処方を一覧の上に出す) |
| `focus` / `basedOn` | 起点のオーダー(`ServiceRequest`)。連日の注射は束ねの最初の日 |
| `for` / `requester` | 患者 / 処方医 |
| `performerType` | `practitioner-role|pharmacist`(薬剤師)。宛先は個人ではなく職種 |
| `owner` | 未監査の間は無し。監査済にしたときに監査した薬剤師 |
| `groupIdentifier` | 注射の束ね(`requisition` の uuid、`.../Identifier/injection-series`)。処方には無い |
| `description` | 一覧の要約(「処方(外来・院内) ガスター散2% ほか 1 剤」) |
| `input` | 種別(`prescription` / `injection`)・処方日・入外区分・区分・薬剤(複数)・期間(連日のみ)・診療科(`valueReference`) |
| `output` | 監査結果(§2.2) |
| `note` | 監査した人・日時(「監査しました。」)、再監査に戻したときは「処方が変更されたため再監査」 |

- ［設計］**通知の対応表には載せない**。件数が多く宛先が個人ではないので、ベル・通知一覧には出さず「処方監査」一覧で追う
  (フォロー推奨と同じ扱い。`docs/features/notifications.md`)。
- ［設計］**連日の注射は束ねに 1 件**。薬剤師は束ね(同じ内容の数日分)を 1 回で監査する。束ねの各日は `groupIdentifier` で引く。
- ［設計］**対象外**(`isRxVerificationTarget`): 院外処方(保険薬局が監査する)、持参の処方(持参薬鑑別が確かめる)、
  化学療法の日オーダー(レジメンの適用で監査する。`regimenOrderOf` が値を返す注射)。
- ［事実］上流の Task 検索は `code` / `status` / `focus` / `group-identifier` / `subject` / `modified`(`lastModified`)に対応している
  (`../fhir-server/app/lib/fhir/search_definitions/task.rb`)。`focus` と `group-identifier` はカンマの OR が効く。

### 2.2 監査結果(`Task.output`)

| `type.text` | 型 | 値 |
|---|---|---|
| 監査結果 | `valueCodeableConcept` | `.../CodeSystem/rx-verification-result`: `no-issue`(問題なし)/ `intervened`(介入あり) |
| 介入種別 | `valueCodeableConcept`(種別ごとに 1 行) | `.../CodeSystem/pharmacist-intervention-type`。コードは小マスタ(§4.1)の code |
| 介入内容 | `valueString` | 自由記述 |
| 処方医の対応 | `valueCodeableConcept` | `.../CodeSystem/rx-intervention-outcome`: `order-changed`(処方変更)/ `unchanged`(変更なし)/ `cancelled`(中止) |

疑義照会の回答(`fhir/rxInquiryHelpers.ts`)・フォロー推奨の対応と同じ形。問題なしのときは監査結果の 1 行だけ。

### 2.3 作る・未監査に戻す・消す

［設計］`api/queries/rxVerification.ts` の `withRxVerificationTasks(bundle)` を、オーダーの登録・更新の共通の mutation
(`useCreatePrescription` / `useUpdatePrescription`、`api/queries/labResult.ts`)で特定抗菌薬の届出の通知と並べて通す。
Bundle の中の対象の `ServiceRequest` を処方はオーダーごと、注射は束ねごとにまとめ、既存の監査 Task(未監査・監査済)を
`focus`(処方)と `group-identifier`(注射)で引いて突き合わせる(検索は最大 2 本。登録だけの処方なら引かない)。

- **登録**: 未監査の Task を同じ transaction で POST(`focus` は Bundle の `urn:uuid`)。
- **編集・継続**: 監査済なら未監査に戻し、`output` と監査者を外して note に再監査の理由を残す。未監査なら要約・期間を書き直す。
  Task が無ければ作る(機能を入れる前に登録したオーダーの編集)。PUT には読んだ版を `ifMatch` に添える。
- **削除**: オーダーの削除(`api/queries/orderDelete.ts`)はオーダーを指す Task をまとめて消すので、処方の監査 Task も一緒に消える。
  連日の注射で起点の日だけを消すときは、束ねに残る日を `ServiceRequest?requisition=` で引き、残りの最初の日へ `focus` と
  `basedOn` を付け替える(`rxVerificationDeleteEntries`)。残る日が無ければ消える。
- **中止**(進捗 Task の中止)では監査 Task を動かさない。一覧の進捗の列に「中止」が出るので、薬剤師が監査済にして閉じる。

### 2.4 施設設定 `rx_verification`

［設計］`backend/app/models/facility_settings.rb` の `SETTINGS` に 1 要素(`{ "block_dispense_before_verified" => false }`)。
true にすると、未監査の行では処方一覧の「調剤登録」・注射一覧の「払出登録」を出さない。登録済みのリソースは動かさない
(表示時の判定だけ)。施設設定の画面は「処方監査」の区画にチェックボックス 1 つ。

## 3. 画面

### 3.1 処方監査一覧(`/rx-verification`、`pages/RxVerificationPage.tsx`)

- 部門業務 > 薬剤部門 >「処方監査」。ホームの部門カード「処方監査」(薬剤師の既定。未監査の件数と至急の件数)。
- **未監査**タブ: `Task?code=…|rx-verification&status=requested&_include=Task:subject&_include=Task:focus&_sort=authored-on`。
  日付を問わず全件、届いた順で至急を先に並べる。進捗・疑義照会の Task は起点のオーダーの id で `Task?focus=` を引き直す。
- **監査済**タブ: 監査日(`lastModified`。`executionPeriod` は未監査の間も含むので重なりで拾いすぎる)を 1 日ずつ。
  「表示」で監査の画面を開き直し、結果を上書きできる。
- 列: 患者・処方日・種別と区分(至急の印)・薬剤(連日の期間、再監査の印)・病棟・依頼科と処方医・進捗(未監査)/ 監査結果と監査者(監査済)。
- 絞り込み: 種別(処方・注射)・入外区分・至急のみ。行を押すと患者プロファイルのドロワー。

### 3.2 監査の画面(`components/RxVerificationModal.tsx`)

- 患者の状態(アレルギー、年齢・体重・eGFR・CCr。`usePatientFactors` は処方フォームの用量規則と同じ値)。
- 登録時と同じ薬剤の警告: 保存済みのオーダーをフォームの値に戻し(`parsePrescriptionForm` / `parseInjectionForm`)、
  `useMedicationAdvisories` に通して `AdvisoryNotice` で出す。台帳(advisory_events)には送らない(無視の理由を問う場面ではない)。
  患者ごとの検索が積み上がらないよう、一覧の行ごとには回さず画面を開いたときだけ回す。
- オーダーの内容(処方は `PrescriptionDetailPanel`、注射は `InjectionDetailPanel`)と疑義照会の履歴。
- 監査結果: 問題なし / 介入あり。介入ありで介入種別(チェックボックス、複数)・介入内容・処方医の対応。種別が無いと保存しない。
- ボタン: 「監査済」「疑義照会」(監査を閉じて照会を開く)「閉じる」。Task は開いたときに詳細で読み直した版を `ifMatch` 付きで PUT する。

### 3.3 処方一覧・注射一覧

- ステータスの隣に「未監査」(橙)/「監査済」の印。監査 Task の無い行(対象外・機能を入れる前の登録)には出さない。
- 未監査の行に「監査」。施設設定が「止める」なら未監査の行の「調剤登録」「払出登録」を出さない。
- 処方一覧は `_revinclude=Task:focus` で既に引いている Task から拾う。注射一覧は束ねの 2 日目以降に監査 Task が付かないので、
  その日の注射の束ねを `group-identifier` で 1 本引き直す(`fetchRxVerificationByGroups`)。

### 3.4 カルテ

処方・注射の詳細に「処方監査」の区画(未監査 / 監査者・日時・結果・介入内容・処方医の対応)。注射は束ねで引く
(`useOrderRxVerification`)。カードには印を出さない(タイムラインを混ませない)。

## 4. backend

### 4.1 介入種別のマスタ `master_pharmacist_intervention_types`

［設計］警告の確認理由マスタ(`docs/advisory-design.md` §3.1)と同じ単純編集型。列は `code`(unique)/ `name` / `enabled` /
`display_order`。`GET /master/pharmacist_intervention_types`(`enabled=true` で有効な行だけ)。マスタメンテ > 医薬品 >
「薬剤師介入種別」。seed は `db/seed_data/pharmacist_intervention_types.csv` の 10 件(用量・相互作用・重複投与・腎機能・肝機能・
アレルギー・禁忌・用法・投与経路・投与期間・日数・配合変化・その他)。プレアボイドの報告様式に寄せて施設が足し引きする。
本番の既存 DB には db:seed が流れないので、migration `20261025090100` でも同じ CSV を入れる(同じ code があれば触らない)。

### 4.2 データ抽出の「薬剤師介入」タブ

［設計］`docs/data-extract-design.md` の記録タブに 1 種類(`tab = intervention`)。

- 取得(`api/queries/interventionExtract.ts`): `Task?code=…|rx-verification&status=completed&modified=ge…&modified=lt…`
  (患者の絞り込みは他のタブと同じく `subject=` に 100 人ずつ)。
- 絞り込み: 監査結果(既定は介入ありだけ、「すべて」で問題なしも)・種別・介入種別(どれかを含む)・依頼科。
  上流は Task の `output` / `input` を検索できないので、読んだ監査に対して画面側で絞る。
- 列(`fhir/interventionExtractHelpers.ts`): 監査日時・種別・処方日・入外・依頼科・処方医・監査者・監査結果・介入種別・
  処方医の対応・介入内容・薬剤。1 監査 = 1 行で、介入種別が複数なら 1 つのセルに「、」で並べる(内訳の「分割」で種別ごとに数える)。
- backend は `ExtractRecordDefinition::TAB_FIELDS` に形だけを足す(`result` / `order_kind` / `types` / 依頼科)。
- 院内共通のプリセット「薬剤師介入 月×種別」(期間は直近 365 日、内訳は行=監査日時の月・列=介入種別・分割あり)を
  `db/seed_data/extract_query_presets.json` に足し、migration `20261025090100` で投入する。

## 5. 主なファイル

| 層 | ファイル |
|---|---|
| Task の組み立て・判定・結果の読み書き | `frontend/src/fhir/rxVerificationHelpers.ts` |
| 登録・編集への同梱、一覧・カルテの読み込み、監査済の書き込み | `frontend/src/api/queries/rxVerification.ts` |
| 削除時の付け替え | `frontend/src/api/queries/orderDelete.ts` |
| 一覧 | `frontend/src/pages/RxVerificationPage.tsx` |
| 監査の画面・一覧の印・カルテの区画 | `frontend/src/components/RxVerificationModal.tsx` |
| 処方一覧・注射一覧 | `frontend/src/pages/RxWorklistPage.tsx`、`frontend/src/pages/InjectionWorklistPage.tsx` |
| 抽出 | `frontend/src/api/queries/interventionExtract.ts`、`frontend/src/fhir/interventionExtractHelpers.ts`、`frontend/src/components/extract/InterventionExtractPanel.tsx` |
| マスタ | `backend/app/models/master/pharmacist_intervention_type.rb`、`backend/app/controllers/master/pharmacist_intervention_types_controller.rb`、`frontend/src/pages/PharmacistInterventionTypePage.tsx` |
| 施設設定 | `backend/app/models/facility_settings.rb`(`rx_verification`)、`frontend/src/pages/FacilitySettingsPage.tsx` |

## 6. 採らなかった案

- **監査を進捗 Task(`rx-dispense` / `injection`)の状態にする**: 監査と調剤・払出は直交する(受付済でも未監査、監査済でも依頼済がある)。
  進捗の状態遷移表と疑義照会の on-hold に監査を混ぜると組み合わせが増えるので、別の Task にした。
- **監査したときに Task を作る**: 日付をまたいだ「未監査」を引けない。確定と同時に作れば `status=requested` の 1 本で全件が並ぶ。
- **宛先を薬剤部の `Organization` や `CareTeam` にする**: 薬剤部の Organization は無く、CareTeam はチーム医療のための器。
  誰が処理できるかは職種(`performerType`)で表せば足り、AST の許可と同じく画面が決める。
- **通知の対応表に載せる**: 件数が多く、宛先が個人でないので既定の「自分あて」の一覧にもベルにも出ない。専用の一覧で追う。
- **連日の注射を日ごとに監査する**: 同じ内容の数日分を薬剤師が何度も監査することになる。束ねに 1 件にし、編集・継続で未監査に戻す。

## 7. 検証(2026-10-25、開発環境・児玉 義憲でログイン)

- テスト太郎に院内処方(外来・院内、ガスター散)を登録 → 監査 Task が 1 件でき、処方監査一覧に出る。院外処方の Bundle には Task が付かない。
- 監査の画面でアレルギー・年齢・体重・eGFR・CCr が出る。介入あり(用量・腎機能、内容、処方変更)で監査済 → output・監査者が入り、
  監査済タブに「介入あり(用量・腎機能) 処方変更」で出る。
- 監査済の処方を編集 → 同じ Task が未監査に戻り、output と監査者が外れ、再監査の note が付く。
- 連日の注射(3 日)を登録 → 監査 Task は束ねに 1 件(期間 10/26〜10/28)。初日だけ削除 → 2 日目に付け替わる。残りを削除 → Task も消える。
- 施設設定を「止める」にすると、受付済で未監査の処方の「調剤登録」が消え、処方一覧の「監査」から問題なしで監査済にすると戻る(設定は既定に戻した)。
- カルテの処方の詳細に「処方監査」の区画(監査者・日時・結果)。
- データ抽出「薬剤師介入」で監査結果「すべて」を実行 → 1 件。院内共通のプリセットが入る。

## 8. 残課題

- 監査できる人を職種(薬剤師)で縛るか。いまはログインできれば誰でも監査できる。権限機能(`functional-gap-backlog.md` §1 #1)と一緒に決める。
- 介入率(介入の件数 ÷ 監査の件数)。指標タブは患者数の割合しか出せない(`data-extract-design.md` §23)。いまは監査結果「すべて」の内訳で割合を出す。
- 注射の実施入力(`components/InjectionDayModal.tsx`)を監査前に止めるか。第 1 段は調剤登録・払出登録だけ。
- 監査済の処方が中止されたときの扱い(監査 Task は動かさない)。
- CDS Hooks の `order-sign` を監査の画面でも呼ぶか。
- 処方監査のための薬剤師の監査ルール(処方区分ごとに監査を省く、定期処方の Do は省く等)。
