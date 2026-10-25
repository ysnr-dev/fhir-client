# NCD 症例登録(登録対象の一覧・実施記録からの初期値)の設計

`docs/functional-gap-backlog.md` §4.1「提出データの生成」のうち、NCD(National Clinical Database)の部分。
院内がん登録(`docs/cancer-registry-design.md`)と同じ骨組みで、対象が病名ではなく手術の実施記録になる。

- **［事実］** = NCD の症例登録の公開情報、FHIR R4・上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = NCD の登録画面・取込形式で確かめていない読み

## 1. 背景とスコープ

外科系の専門医制度と連動して、参加施設は手術症例を NCD に登録する(基本項目 + 領域ごとの詳細項目)。
登録は NCD の Web 画面への入力で、術後 30 日の合併症・死亡まで追って登録する。院内では「どの手術が未登録か」
「術後 30 日が過ぎた症例はどれか」を追う手段が無く、実施記録に散らばる値を登録画面へ転記し直している。

含めるもの:

- 手術の実施記録(ハブ Procedure)を手術日の期間で並べ、症例登録の状況と術後日数を見る一覧(データ > NCD症例登録、
  `/ncd-registrations`)
- 一覧の行からカルテの右ペインで症例登録(テンプレート回答)を書き始める。回答は `partOf` で実施記録を指す
- 基本項目のテンプレートと、初期値変数「NCD」(実施記録・申込・入院から)。術後合併症は NCD の区分と Clavien-Dindo 分類の選択肢
- 登録済みの回答の項目順 CSV

含めないもの(§7):

- NCD への送信・取込形式、領域別(消化器外科・心臓血管外科・呼吸器外科…)の詳細項目とリスク計算、手術の実施記録側への合併症コードの追加

## 2. データの持ち方

### 2.1 症例登録(QuestionnaireResponse)

［設計］新しいリソースは作らない。症例登録は施設設定「NCD症例登録」のテンプレート(既定 `NCD_CASE_01`)への
QuestionnaireResponse 1 件 = 手術 1 件。

| 要素 | 値 |
|---|---|
| `questionnaire` | テンプレートの canonical |
| `subject` | 患者 |
| `partOf` | **手術の実施記録(ハブ Procedure)**。`QuestionnaireResponse.partOf` は Reference(Observation \| Procedure)なので標準要素で指せる |
| `status` | `in-progress`(記入中)/ `completed` `amended`(記入済・登録済) |
| item `ncd_status` | NCD への登録状況(`unregistered` / `registered`)。一覧の「登録済」はこの値で決める |
| item `ncd_registered-on` | 登録日 |

- ［事実］院内がん登録・発生届は病名を対象プロブレムの拡張で指したが、手術は Procedure なので `partOf` を使う。
  `buildQuestionnaireResponse` に `partOf` を足し、更新では保存済みの値を引き継ぐ。
- ［設計］**合併症のコード化は回答側で行う**。NCD の合併症は術後 30 日以内のもので、実施入力の時点では分からない。
  実施記録の `complication` は術中の自由記載のまま残し、症例登録のテンプレートで種類(NCD の区分)と Clavien-Dindo 分類を
  選ぶ。実施記録に合併症のコードを足すのは、術後の経過を実施記録に書き戻す運用が決まってから(§7)。
- ［設計］一覧は確定していても登録状況が「登録済」でなければ「記入済」(発生届と同じ)。NCD の画面に入力してから登録済にする。

### 2.2 対象の手術

［設計］手術の実施記録のハブ(`category = order-type|surgery`、`partOf` 無し、`entered-in-error` と `not-done` を除く)。
取得は手術実績の抽出(`api/queries/surgeryExtract.ts` の `fetchSurgeryExtract`)と同じ検索で、子の Procedure・測定値の
Observation・申込を 1 検索で揃える。依頼科で絞れる(`based-on.department`)。

- ［要確認］NCD の登録対象は外科系学会の専門医制度の対象手術で、施設の参加領域による。一覧は全手術を出し、
  依頼科で絞る前提。対象外の手術(内科の処置など)が混ざる施設は、申込の依頼科で分ける。

### 2.3 施設設定

［設計］`facility_settings.ncd_registration = { "template": "<url>" }`(既定は同梱テンプレートの url)。

## 3. 初期値変数「NCD」(`fhir/populateContext.ts`、`fhir/ncdHelpers.ts`)

テンプレートの式がこれらの変数を参照するときだけ、対象の手術(ハブ + 子 + 測定値 + 申込)と患者の入院を読む
(`usePopulateSources` の `ncd`)。対象の手術は一覧から渡した `partOf` の Procedure、無ければ患者の最新の手術。

| 変数 | 元 |
|---|---|
| `%ncdSurgeryDate` | ハブの `performedPeriod.start`(入室日) |
| `%ncdProcedureName` `%ncdProcedureCode` `%ncdProcedures` | ハブと子の `code`(主術式はハブ) |
| `%ncdPriority` `%ncdDepartment` `%ncdSurgicalDepartment` `%ncdAnesthesia` `%ncdAnesthesiaManagement` | 申込(ServiceRequest)の予定区分・依頼科・執刀科・麻酔方法・麻酔管理 |
| `%ncdSurgeon` `%ncdAssistants` `%ncdAnesthesiologist` | ハブの `performer`(役割) |
| `%ncdRoomMinutes` `%ncdAnesthesiaMinutes` `%ncdOperationMinutes` | 入室〜退室、麻酔開始〜終了、執刀開始〜終了(拡張の時刻) |
| `%ncdBloodLoss` `%ncdTransfusionVolume` `%ncdTransfused` | 測定値の Observation(出血量・輸血量)。輸血は 1 mL 以上で yes |
| `%ncdWoundClass` `%ncdComplicationNote` `%ncdOutcome` | ハブの拡張(創分類)・`complication`・`outcome` |
| `%ncdAdmissionDate` `%ncdDischargeDate` `%ncdPostoperativeDays` | 手術日を含む入院(class = IMP)。退院していなければ退院日・術後在院日数は空 |
| `%ncdDeathDate` `%ncdDiedWithin30Days` | `Patient.deceasedDateTime`。手術日から 30 日以内なら yes |

- ［設計］有無の項目(輸血・30 日死亡)は実施記録があるときだけ yes / no を入れる。記録が無いときは空。
- ［設計］身長・体重・年齢は既存の変数(`%bodyHeight` `%bodyWeight` `%age`)を使う。手術時の値ではなく最新の値なので、
  テンプレートの項目名を「手術時年齢」としつつ記入者が直す前提。

## 4. 一覧(データ > NCD症例登録、`/ncd-registrations`)

［設計］`pages/NcdRegistrationPage.tsx`。院内がん登録と同じ作り。

- **絞り込み**: 手術日の期間(既定は今日までの 90 日)、依頼科、状態(未登録 / 記入中 / 記入済 / 登録済)。
- **行** = 手術の実施記録 1 件。患者・性別・年齢・手術日・術式・依頼科・予定区分・執刀医・術後日数(30 日を過ぎて未登録なら赤)・
  登録(状態)・登録日・記入者・操作(「登録」/「開く」)。
- **登録を始める**: 「登録」でカルテを `?open=procedure-template:<Procedure id>@<テンプレートの url>` で開き、右ペインの
  「テンプレート登録」にテンプレートを選択済み・`partOf` に手術を入れた状態で入る(`karteUrl.ts`、`KartePage`)。
- **CSV**: 表示中の行のうち登録済の回答を項目順に出す(院内がん登録の `cancerRegistryCsv` を共用)。
  ［要確認］NCD の一括取込の形式には合わせていない。

## 5. 実装したもの

- `fhir/ncdHelpers.ts`: 設定・状態・行・初期値変数
- `fhir/questionnaireResponseHelpers.ts`(`partOf`)、`components/QuestionnaireResponsePanels.tsx`(`partOf` と NCD の変数の検知)、
  `components/KarteRightPane.tsx`(`qr-create` の `partOf`)、`karteUrl.ts` / `pages/KartePage.tsx`(`procedure-template`)
- `api/queries/populate.ts`(手術と入院の読み込み)、`fhir/populateContext.ts`(変数「NCD」)
- `api/queries/ncd.ts`、`pages/NcdRegistrationPage.tsx`、`appMenu.ts`(データ > NCD症例登録)、`App.tsx`
- backend `FacilitySettings::SETTINGS` の `ncd_registration`、spec、`FacilitySettingsPage`
- `docs/report-mappings/ncd-case-01.questionnaire.json`(`NCD_CASE_01`)

## 6. 検証(開発環境、2026-10-25)

- 一覧にテスト太郎(2026-08-28 腹腔鏡下胆嚢摘出術)などの手術が出ること。「登録」で開いた症例登録に手術日・術式・コード・
  執刀医・麻酔・手術時間・出血量・輸血の有無・創分類・入院日が入ること。登録状況を「登録済」にして確定すると一覧が
  「登録済」になり、回答の `partOf` がハブを指すこと。
- `tsc -b`、lint、backend rspec。

## 7. 申し送り

1. **NCD への送信**: NCD は Web 画面への入力が基本で、一括取込の形式は領域ごとに違う。CSV は項目順の控えにとどめる。
2. **領域別の詳細項目**: 消化器外科(8 術式のリスクモデル)、心臓血管外科(JCVSD)、呼吸器外科などの項目と、リスク計算
   (予測死亡率)は含めていない。テンプレートを複製して領域ごとに足す形。
3. **実施記録への合併症コード**: 術後の合併症を実施記録(Procedure.complication)にも書き戻すなら、NCD の区分と
   Clavien-Dindo を `complication` の coding に写す。実施入力の時点では分からないので、症例登録から書き戻す導線になる。
4. **ASA-PS**: 麻酔科の術前診察(`docs/surgery-order-design.md` §B-2)ができたら、そこから初期値を入れる。
5. **手術時の身長・体重**: 最新値を入れているので、手術日時点の測定値を引くようにする。
6. **登録対象の判定**: 施設の参加領域と術式(NCD 術式マスタ)で対象を自動判定する。いまは依頼科での絞り込み。
