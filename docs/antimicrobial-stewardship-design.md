# 抗菌薬適正使用支援(AST)

`docs/functional-gap-backlog.md` §4 の「臨床判断支援」(2026-10-16 の追加候補)。
**状態: 実装済(2026-10-16)。** 残課題は §4。
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

- **［設計］** `Master::MedicineAttribute::ATTRIBUTES`(`backend/app/models/master/medicine_attribute.rb`)に 2 項目を足した。
  項目は `type`(boolean / enum / quantity)と、その薬に設定できるかの `applicable` を持つ。
  - `antimicrobial_category`(特定抗菌薬): `none` / `notify`(届出制)/ `approve`(許可制)。既定 `none`。
  - `ddd`: `{ value, unit: g | mg | MU }`。既定は未設定。
  - どちらも抗菌薬(薬価基準コードの上 4 桁が 61・622・624)だけに設定でき、それ以外の薬に保存すると 422。
    API の行に `applicable`、`definitions` に `type`・`options`・`units` を返す。数値は文字列でも受ける(`JsonShape.coerce`)。
  - 画面(`/medicine-attributes`)は enum をセレクト、quantity を数値 + 単位で出し、設定できない薬は「-」。
- **［設計］** 抗菌薬の判定は `fhir/antimicrobialHelpers.ts` の `isAntimicrobialMedicine`。YJ コード・薬効分類の上 4 桁で決め、
  どちらも無い行(編集・DO で開いた行、保存済みのオーダー)は抗菌薬の医薬品コードの集合
  (`/master/medicines/codes?yakko_prefix=61,622,624`、`useAntimicrobialMedicineCodes`)で引く。
  細菌検査オーダーの「処方から取り込み」の判定も同じ関数(`isAntimicrobialYakko`)に寄せた。
- **［設計］** 警告(`buildAntimicrobialWarnings`)は `MedicationWarningKind` の `antimicrobial` で、`useMedicationWarnings` が
  3 本目として合流させる。**出るのは処方・注射のフォーム**(`useMedicationWarnings` を使う 2 画面)で、レジメン・オーダーセットの
  内容入力(患者が決まらない画面)では出さない。
  - 「特定抗菌薬(届出制)」は注意、「特定抗菌薬(許可制)」は強い警告。
  - 「投与 N 日目」: 同じ成分の連続投与が開始日に続いていて 7 日目以上(14 日目以上は強い警告)。
- **［設計］** 連続投与は `useAntimicrobialCourses`(`api/queries/antimicrobial.ts`)が集める。`useActiveMedications` は処方だけで
  開始日も持たないので使わず、注射(直近 30 日、施行日 1 日ずつ)と処方(直近 92 日、RP の開始〜終了)を別に引き、
  中止(注射・処方の Task が cancelled)を除いて、患者 × 成分ごとに「前の投与の終了日の翌日までに次が始まれば続き」でつなぐ
  (`antimicrobialCourses`)。成分は `ingredientKey`、取れなければ医薬品コード。

## 2. 第 2 段: 届出の通知・AST チーム・一覧

### 2.1 届出の通知 `antimicrobial-notification`

- **［設計］** オーダーの登録・編集(`useCreatePrescription` / `useUpdatePrescription`。処方・注射・オーダーセット・レジメンが通る)の
  `mutationFn` で、Bundle の処方・注射の薬剤を薬剤付加情報で引き(`withAntimicrobialNotifications`)、特定抗菌薬があれば
  依頼医あての通知を同じ transaction に積む(`fhir/antimicrobialNotificationHelpers.ts`)。薬剤が無い Bundle は何も引かない。
  - **連日の注射は束(requisition)で 1 件**(ユーザー決定)。初日のオーダーを `focus`、束の全オーダーを `basedOn` にし、
    `input` に区分・薬剤・種別(処方 / 注射)・開始日・束を持つ。処方は 1 オーダー 1 件。強度は注意。
  - 患者のこれまでの通知(状態を問わない、`Task?code=…&subject=Patient/…`)に同じ束・同じオーダーのものがあれば作らない。
    別の束で同じ薬を出し直した場合は新しく作る。
  - オーダー削除は既存の `postOrderDeleteBundle` が focus・basedOn の Task を消す。
- **［設計］** 届出書 `AST_NOTIFY_01`(`docs/report-mappings/ast-notify-01.questionnaire.json`)は `/ast-worklist` の「届出」タブから
  オーダーに `basedOn` で結んで書く。テンプレート回答の保存(`saveResponse`)に `extraEntries` を通し、同じ transaction で:
  届出制は通知を完了(note「届出書を提出しました。」)、許可制は通知の `input` に届出書の参照を足して「許可待ち」にする。
  許可は AST チームのメンバーだけが一覧の「許可」で行い、完了(note「特定抗菌薬の使用を許可しました。」)。
  通知一覧からは閉じない(`canAct: () => false`)。通知の「カルテ」は `/ast-worklist?tab=notify` を開く。
- **［事実］** 上流の Task は `subject` のカンマ OR を受け付ける(2026-10-16 に strict で確認)。

### 2.2 AST チーム

- **［設計］** `care-team-kind` に `ast`(抗菌薬適正使用(AST))を足した。介入は既存のチーム依頼、回診記録は既定テンプレートに
  `AST_ROUND_01`(`docs/report-mappings/ast-round-01.questionnaire.json`)を設定して使う。
- スクリーニング(チームの保存条件)の seed は作っていない。保存条件は「特定抗菌薬」で絞れず、チームの id が環境ごとに違うため。

### 2.3 一覧 `/ast-worklist`(`pages/AstWorklistPage.tsx`)

メニューは部門業務 > 薬剤部門 >「抗菌薬適正使用」。薬剤師のホームに「特定抗菌薬の届出」のカード(届出未提出・許可待ちの件数)。

| タブ | 内容 | 取得 |
|---|---|---|
| 使用中 | 入院中で特定抗菌薬を投与している患者(薬剤・区分・開始日・日数・届出の状態・血中濃度・AST の介入) | `useHospitalAntimicrobialCourses`: 注射(`occurrence` 直近 30 日、`fetchOrdersWithPerforms`)+ 処方(同期間)を院内全体で引き、患者 × 成分の連続投与のうち今日か昨日まで続くもの。入院中かは `useInpatientEncounters`(今日) |
| 長期投与 | 入院中で、抗菌薬(区分を問わない)を 7 日以上続けている患者 | 同上 |
| 血液培養 | 採取日が直近 14 日の血液培養(材料 401 静脈血・402 動脈血)の陽性(培養陽性か分離菌あり)。入院中の患者だけ | `DiagnosticReport?category=MB&date=ge…&_include=result,specimen` → `parseMicroResultForm`。系統「血液・穿刺液」は髄液・胸水を含むのでコードで判定 |
| 届出 | 未対応の届出の通知(届出未提出・許可待ち)。届出書・許可 | `Task?code=antimicrobial-notification&status=requested&_include=Task:subject` |
| 集計 | §3 | |

- 行の「チーム依頼」は区分 ast のチーム(有効なものの先頭)を選んだ状態で開く。介入中(`useTeamActiveRequestPatientIds`)の患者には出さない。
- 注射の取得は `fetchOrdersWithPerforms` の上限(2000 オーダー)があり、欠けたら `TruncatedNotice`。

## 3. 第 3 段: 集計(AUD / DOT)と TDM

- **［事実］** 注射の実施記録(MedicationAdministration)は `effectivePeriod` で書いており、上流の `effective-time` は
  `effectiveDateTime` だけを索引するので期間で引けない。ハブの Procedure(`performedPeriod`、上流の `date` に索引)なら引ける。
- **［設計］** 「集計」タブで月と病棟(全体 / 各病棟)を選ぶ。薬剤(成分)ごとに投与患者数・投与日数・DOT・DDD 数・AUD・換算できない投与、
  合計行、CSV(`lib/csv.ts`)。
  - 分子: `Procedure?category=order-type|injection&part-of:missing=true&date=…&_revinclude=MedicationAdministration:part-of`
    (`useAntimicrobialAdministrations`)の MA(completed / stopped)のうち抗菌薬。投与日は `effectivePeriod.start` の日。
  - DOT = 患者 × 成分 × 投与日の重複を除いた数 ÷ 在院患者延日数 × 1000。
  - AUD = 投与量を DDD の単位に換算(`convertDose` と医薬品の換算行、MU は「万単位」の 100 倍で換算)して DDD で割った合計 ÷ 在院患者延日数 × 1000。
    DDD 未設定・換算できない投与は「換算できない投与」に件数を出し、AUD に含めない。
  - 在院患者延日数: `useEncountersInRange` + `patientsByDayAtBeds` で、対象病棟(全体は全病棟)に日ごとに居た患者数を月の範囲
    (今月は今日まで)で足す(入院日・退院日を含む)。投与もその日・その患者が対象病棟に居たときだけ数える。
  - 純関数は `fhir/antimicrobialUsageHelpers.ts`(`summarizeAntimicrobialUsage`)。内服抗菌薬は数えない(注射のみ)。
- **［設計］** TDM: 結果項目マスタで LOINC が血中濃度(4092-3 バンコマイシン トラフ など `TDM_LOINC_CODES`)の項目があるときだけ、
  「使用中」「長期投与」に直近 30 日の最新値の列を出す。**開発・seed の結果項目マスタには該当が無く、列は出ない。**

## 4. 対象外・残課題

- JANIS 抗菌薬マスタ(感受性の薬剤)と医薬品コードの対応表。感受性結果と投与中の薬を突き合わせて「耐性の薬を投与中」を出すのに要る。
- 感染症の届出(発生届)、ICT のサーベイランス(JANIS 提出データは細菌検査側)。
- 内服抗菌薬の投与日数を与薬記録から数える(集計の DOT は注射のみ)。
- 腎機能に応じた用量の提案は薬剤チェックマスタ(`docs/drug-check-master-design.md`)の用量規則で扱う。
- 同じ薬を別の束で出し直したときの届出の重複(いまは束ごとに 1 件)。
- AST チームのスクリーニング条件の seed、許可制の薬の「許可前の払出を止める」運用。

## 5. 検証(2026-10-16、Docker 環境)

- backend: `spec/requests/master/medicine_attributes_spec.rb`(区分・DDD の保存、文字列の数値、非抗菌薬への設定 422、表に無い値 422、lookup の既定)。
- 開発環境に、セフトリアキソン点滴用 1g バッグ NP(620002955)= 届出制・DDD 2 g、セファゾリン 1g バッグ(621757001)= DDD 3 g、
  バンコマイシン点滴静注用 0.5g「NIG」(621897403)= 許可制・DDD 2 g を設定。CareTeam「抗菌薬適正使用支援チーム」(区分 ast、
  リーダー 児玉 義憲、回診記録 AST_ROUND_01)を作成し、`AST_NOTIFY_01`・`AST_ROUND_01` を登録した。
- テスト太郎にバンコマイシンを 10/08〜10/20(13 日分)で登録 → フォームに「特定抗菌薬(許可制)」、通知は 1 件(basedOn 13 件)。
  今日の日付でもう一度選ぶと「投与 9 日目」。一覧の使用中・長期投与に 9 日目・届出未提出で出た。届出書の保存で「許可待ち」、
  「許可」で完了(届出書の参照と note 付き)。セフトリアキソン(届出制)1 日分は届出書の保存だけで完了。
- 血液培養タブ: テスト太郎の 09-20 静脈血 E. coli は 14 日より前なので 0 件。遡る日数を一時的に 40 日にすると出た(入院中でない患者の静脈血は除外)。
- 集計(2026/10・全体): セフトリアキソン 7 日・7 g で DDD 数 3.50、在院患者延日数 160 で DOT 43.75・AUD 21.88(手計算と一致)。
- 検証で作ったオーダー・通知・届出書・来歴は削除した。薬剤付加情報・CareTeam・テンプレートは残してある。
