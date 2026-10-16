# 抗菌薬適正使用支援(AST)

`docs/functional-gap-backlog.md` §4 の「臨床判断支援」(2026-10-16 の追加候補)。
**状態: 設計のみ(2026-10-16)。実装は未着手。**
特定抗菌薬(カルバペネム・抗 MRSA 薬など)の使用開始の検知と届出、長期投与の警告、血液培養陽性患者の一覧、
AST チームの介入、AUD / DOT の集計。抗菌薬適正使用支援加算の体制要件に対応する。

- **［事実］** = 制度、このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 現状(実装済みの範囲)

- 抗菌薬かどうかの判定は薬効分類(薬価基準コードの上 4 桁 = `Medicine.yakko_code`)が 61 / 622 / 624 で始まるか
  (`hooks/useAntimicrobialSuggestions.ts` のローカル定数、`docs/micro-order-design.md`)。データ抽出も薬効分類 61・62 で絞る。
- 特定抗菌薬の区分・DDD(1 日規定用量)・YJ ↔ JANIS 抗菌薬の対応は無い。施設独自の薬剤の設定は
  `master_medicine_attributes.settings`(jsonb)で、項目は `Master::MedicineAttribute::ATTRIBUTES` に 1 行足すと検証・API・画面まで回る
  (`docs/lot-number-design.md`)。
- 注射は 1 施行日 1 ServiceRequest + MedicationRequest、連日は `requisition = injection-series|<uuid>` と `injection-series-start` で束ねる。
  実施は Procedure(ハブ)+ MedicationAdministration。病棟 × 日は `useWardInjectionOrders`、SR + MR + Task + Procedure + MA は
  `fetchOrdersWithPerforms`(`api/queries/encounter.ts`)の 1 本。内服の与薬は「処方 × 予定枠」の別経路(`docs/flowsheet-design.md` §9)。
- 薬剤安全性チェックは `buildMedicationWarnings`(`fhir/medicationSafetyHelpers.ts`)が `[RP][薬剤]` の `MedicationWarning[]` を返し、
  施設マスタのチェック(`fhir/drugCheckHelpers.ts`)と合わせて `components/MedicineWarnings.tsx` の `useMedicationWarnings` が
  処方・注射・レジメン・持参薬など 8 画面で束ねる。登録は止めない方針。`ActiveMedication` は `endDate` しか持たない(開始日が無い)。
- 細菌検査結果は DiagnosticReport(category `v2-0074|MB`)+ 培養 Observation(`micro-culture-result` positive / negative)+ 分離菌
  (`janis-organism`)+ 感受性(`janis-antimicrobial`、S / I / R)。検体は `Specimen.type`(JANIS 材料コード)で、材料マスタ
  `master_micro_specimen_types.category` に系統(血液・穿刺液 / 口腔・気道・呼吸器 / 泌尿器・生殖器 / 消化器 / その他)がある。
  静脈血 401・動脈血 402 は「血液・穿刺液」。抽出は `api/queries/microExtract.ts`(`DiagnosticReport?category=MB&date=…&_include=…`)。
- チーム医療(`docs/care-team-design.md`)の区分 `care-team-kind` は nst / ict / pressure-ulcer / palliative / dementia / rst / other。
  チーム依頼・回診記録・スクリーニング(チームの保存条件)が使える。
- ダッシュボードとデータ抽出は 1 つの表の中の件数・合計・割合だけで、表をまたぐ割り算(AUD / DOT)は表せない。
  専用画面で割る前例は褥瘡の発生率(`/pressure-ulcer`)。
- **［事実］** 上流は `MedicationRequest?code=<system>|<code>` を strict で受け付ける(2026-10-16 に確認)。`medication=` は未対応。

## 1. 第 1 段: マスタと警告

- **［設計］** `Master::MedicineAttribute::ATTRIBUTES` に 2 項目を足す(薬剤付加情報の画面に列が増える)。
  - `antimicrobial_category`: `none` / `notify`(届出制)/ `approve`(許可制)。既定は `none`。
    薬効分類が 61 / 622 / 624 以外の薬ではこの列を編集不可にする(`definitions` に `applicable` の条件を 1 つ足す)。
  - `ddd`: `{ value: number, unit: "g" | "mg" | "MU" }`。AUD の分母に使う。既定は空(未設定の薬は AUD の対象外として件数に出す)。
- **［設計］** `fhir/antimicrobialHelpers.ts`(純関数)に `isAntimicrobial(yakkoCode)` を置き、`useAntimicrobialSuggestions` と
  抽出の定数をここへ寄せる(挙動は変えない)。
- **［設計］** `buildAntimicrobialWarnings(rps, active, attributes)` を同じ `[RP][薬剤]` の形で返し、`MedicationWarningKind` に
  `antimicrobial` を足して `useMedicationWarnings` で合流させる。警告は 3 種。
  - 「特定抗菌薬(届出制)」「特定抗菌薬(許可制)」: 選んだ薬の `antimicrobial_category` が none 以外。`high` は approve のとき。
  - 「投与 7 日以上」「投与 14 日以上」: 同じ成分(`ingredientKey`)の投与開始日からの日数。
    `ActiveMedication` に `startDate`(注射は `injection-series-start`、処方は `authoredOn`)を足して渡す。
- 採らなかった案: `drug_checks`(施設の薬剤チェックマスタ)に種別を足す。薬ごとの区分なので薬剤付加情報のほうが置き場所として自然で、
  ロット管理と同じ画面で設定できる。

## 2. 第 2 段: 届出の通知・AST チーム・一覧

### 2.1 届出の通知

- **［設計］** 種別 `antimicrobial-notification`(特定抗菌薬の届出、注意)。特定抗菌薬を含む注射・処方のオーダー登録 transaction で、
  依頼医あてに 1 件作る(`focus` = ServiceRequest、`input` に薬剤名・区分・開始日)。
- **［設計］** 届出書はテンプレート `AST_NOTIFY_01`(Questionnaire。感染症名・推定起因菌・培養提出の有無・投与予定期間・
  血中濃度測定の予定)。右ペインの「テンプレート」から `basedOn` = オーダーで保存すると、同じ transaction で Task を対応済みにする
  (`document-due` が文書の確定で自動完了するのと同じ作り)。許可制は Task の `action` を「承認」にし、AST チームの医師が押す。
- **［事実］** 1 通知 = 1 宛先。チームあての通知は無いので、チームへの連絡は一覧(2.3)で行う。

### 2.2 AST チーム

- **［設計］** `care-team-kind` に `ast` を足す(`fhir/careTeamHelpers.ts`、マスタ画面の選択肢)。介入は既存の「チーム依頼」、
  回診記録は既定テンプレート(`care-team-round-template`)に `AST_ROUND_01`(抗菌薬・投与量・腎機能・培養・提案・de-escalation の可否)。
  スクリーニングはチームの保存条件に「特定抗菌薬の注射が直近 14 日にある患者」を 1 件 seed する。

### 2.3 一覧 `/ast-worklist`

- **［設計］** `pages/AstWorklistPage.tsx`。取得は `InsulinWorklistPage`(病棟 × 日の注射から薬剤で絞る)、タブ・フィルタ・行の導線は
  `TeamWorklistPage` に合わせる。メニューは「部門業務」、ホーム(`fhir/homeSections.ts`)に医師・薬剤師向けのセクション。
- タブ:

| タブ | 内容 | 取得 |
|---|---|---|
| 使用中 | 特定抗菌薬を投与中の患者(薬剤・開始日・日数・届出の有無・介入の有無) | `ServiceRequest?category=order-type\|injection&status=active&occurrence=ge{today-30}` + `_include` MR、画面側で区分で絞る。内服は `MedicationRequest?status=active&authoredon=ge{today-30}` |
| 長期投与 | 同じ成分が 7 日以上 / 14 日以上(抗菌薬全体) | 同上。開始日は series の開始日、処方は authoredOn |
| 血液培養陽性 | 直近 14 日に報告された血液培養の陽性(菌名・報告日・投与中の抗菌薬・介入の有無) | `DiagnosticReport?category=MB&date=ge{today-14}&_include=DiagnosticReport:result,specimen,subject`、画面側で材料の系統 = 血液・穿刺液 かつ 培養 positive |
| 届出未提出 | `antimicrobial-notification` が未対応のオーダー | `Task?code=antimicrobial-notification&status=requested&_include=Task:subject` |

  全件は `searchAllPages`、上限で欠けたら `TruncatedNotice`。行から「チーム依頼」「カルテ」「届出書(テンプレート)」。
  介入の有無は `ServiceRequest?category=team-request&performer=CareTeam/{ast}` を 1 本引いて患者で突き合わせる。
- **［要確認］** `MedicationRequest?code=` は使えるが、特定抗菌薬のコードが数十件になるとカンマ OR の URL 長が問題になりうる。
  第 2 段は `status` + 期間で引いて画面側で絞り、件数が問題になれば上流に「薬効分類での検索」を要望する(`server-improvement-backlog.md`)。

## 3. 第 3 段: 集計(AUD / DOT)と TDM

- **［事実］** AUD = 投与量の合計 ÷ DDD ÷ 在院患者日数 × 1000、DOT = 投与日数(患者 × 薬剤 × 日の重複を除く)÷ 在院患者日数 × 1000。
  分母の在院患者日数は月の範囲で切り詰めた入院日数の合計。
- **［設計］** `/ast-worklist` に「集計」タブ。病棟(全体 / 各病棟)× 月で、薬剤(または系統)ごとに DOT・AUD・投与患者数を表にし CSV に出す。
  分子は MedicationAdministration(status completed、`effectivePeriod.start` の月)から、分母は `Encounter?class=IMP&date=…` の period を
  月で切り詰めて数える(褥瘡の発生率と同じ画面側の集計)。DDD 未設定の薬は AUD を空欄にし、注記に数を出す。
- **［設計］** TDM は結果項目マスタに血中濃度(バンコマイシン・テイコプラニン・アミノグリコシドの LOINC)があるときだけ、
  「使用中」の行に直近の濃度と測定日を添える。投与設計の計算(AUC)は対象外。
- 採らなかった案: データ抽出の内訳に「表をまたぐ割り算」を足す。汎用化すると抽出の設計(1 表の中で閉じる)を崩す。
  AUD / DOT は定型なので専用画面のほうが短い。

## 4. 対象外・残課題

- JANIS 抗菌薬マスタ(感受性の薬剤)と医薬品コードの対応表。感受性結果と投与中の薬を突き合わせて「耐性の薬を投与中」を出すのに要る。
- 感染症の届出(発生届)、ICT のサーベイランス(JANIS 提出データは細菌検査側)。
- 内服抗菌薬の投与日数を与薬記録から数える(第 3 段の DOT は注射のみ)。
- 腎機能に応じた用量の提案は薬剤チェックマスタ(`docs/drug-check-master-design.md`)の用量規則で扱う。

## 5. 検証(実装時)

- 第 1 段: 薬剤付加情報でメロペネムを `approve` にし、注射オーダーで警告が出ること。腎臓太郎・テスト次郎の連日注射(09-29〜10-12)で
  「14 日以上」が出ること。`useAntimicrobialSuggestions` の候補が変わらないこと。
- 第 2 段: 届出の Task が依頼医に届き、`AST_NOTIFY_01` の保存で消えること。一覧の 4 タブ。血液培養陽性は細菌検査結果の
  検証データ(E. coli 2 回・MRSA 中間)で確認。
- 第 3 段: 開発環境の 1 か月分で DOT と在院患者日数を手計算と突き合わせる。
