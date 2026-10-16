# 早期警告スコア(NEWS2 / qSOFA)と院内迅速対応の呼び出し

`docs/functional-gap-backlog.md` §4 の「臨床判断支援」(2026-10-16 の追加候補)。
**状態: 実装済(2026-10-16)。** RRS の呼び出し先・看護観察の JCS からの算出・対応理由の選択は残り(§7)。
入院患者のバイタルから NEWS2(National Early Warning Score 2)と qSOFA を自動で算出し、悪化の兆しを主治医に通知し、
病棟の一覧・経過表・患者帯に出す。

- **［事実］** = スコアの定義、このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 現状(実装済みの範囲)

- バイタルは `fhir/vitalHelpers.ts` の `VITAL_MEASURES`(体温 8310-5・脈拍 8867-4・SpO2 2708-6・呼吸数 9279-1・身長・体重)で、
  1 項目 1 Observation(category `vital-signs`、LOINC、UCUM)。血圧は 85354-9 のパネル 1 件に収縮期 8480-6・拡張期 8462-4 を
  component で持つ。1 回の測定は identifier `http://fhir-client.local/vital-entry` で束ね、保存は `vitalSaveBundle`
  (前回分を DELETE して POST し直す transaction)。
- 異常値は保存せず表示時に判定する(`vitalInterpretationOf`、しきい値は施設設定 `vital_thresholds`)。
- 看護指示の観察(`fhir/nursingPerformHelpers.ts`)は MEDIS 看護観察の管理番号を第 1 coding、LOINC を第 2 coding に併記し
  (`NURSING_LOINC_MAP`)、経過表の同じ行に合流する。
- 意識レベルと酸素投与の項目は無かった。JCS は DPC 様式 1 の入力欄にだけあった(時系列の Observation ではない)。
- 通知(Task)は frontend の書き込み transaction で作る(`fhir/labPanicHelpers.ts` の `buildPanicTask`、出し直し・取り下げは
  `api/queries/labResult.ts` の既存 Task 読み直し)。backend に定期実行の仕組みは無い。
- 入院患者一覧(`pages/InpatientListPage.tsx`)の列は JSX 直書きで、任意列は `InpatientColumnsModal`(pathway / dpc)。
  患者帯の警告の見本は `ChemotherapyPictogram` + `PictogramPopover`(`components/PatientHeader.tsx`)。

## 1. スコアの定義

- **［事実］** NEWS2(RCP 2017)は 7 項目。呼吸数・SpO2(スケール 1 / 2)・酸素投与の有無・収縮期血圧・脈拍・意識(ACVPU)・体温を
  各 0〜3 点(酸素投与は 0 / 2 点)で足し、合計 0〜20 点。対応の目安は 0〜4 点 = 低、単項目 3 点 = 低〜中、5〜6 点 = 中(医師の評価)、
  7 点以上 = 高(迅速対応チーム)。SpO2 スケール 2 は高 CO2 血症性呼吸不全(COPD など)の患者にだけ使い、
  **医師が指定した患者にしか適用しない**。
- **［事実］** qSOFA は呼吸数 ≥ 22、収縮期血圧 ≤ 100、意識変容(GCS < 15)の 3 項目で各 1 点。2 点以上で敗血症を疑う。
- **［事実］** 意識は NEWS2 が ACVPU(Alert / new Confusion / Voice / Pain / Unresponsive)、qSOFA が GCS。国内の病棟記録は JCS が主流。
- **［設計］** 記録は **JCS** で取り、NEWS2 用に ACVPU へ写像する(純関数の表)。
  JCS 0 → A、I 桁(1・2・3)→ C(新規の見当識障害として 3 点)、II 桁(10・20・30)→ V、III 桁(100・200)→ P、300 → U。
  qSOFA の意識変容は JCS ≥ 1 を「あり」とする。GCS は手術・ICU 向けの別項目として MEDIS の E / V / M をそのまま使い、
  GCS があるときは qSOFA の判定に GCS(< 15)を優先する。
- **［設計］** 欠けている項目があるとき、合計は出すが **「暫定」** と表示し、欠けた項目名を添える(欠測を 0 点にしない)。
  通知の判定は暫定でも行う(測れた項目だけで中以上なら知らせる価値がある)。

## 2. 記録の項目を足す

- **［事実］** MEDIS 看護観察マスタ(開発 DB `master_nursing_observations`)に次の項目がある(2026-10-16 に確認)。

| 管理番号 | 名称 | 型 | 選択肢 / 単位 |
|---|---|---|---|
| 31001657 | 意識評価(JCS) | 列挙型 | 0 / 1 / 2 / 3 / 10 / 20 / 30 / 100 / 200 / 300 |
| 31001620〜22 | 意識評価(GCS-E / M / V) | 列挙型 | E 4〜1、M 6〜1、V 5〜1・T |
| 31001623 | 意識評価(GCS-合計) | 数値型 | 計 |
| 31006122 | 酸素流量 | 数値型 | L/分 |
| 31006123 | 吸気酸素濃度(FiO2) | 数値型 | 小数 |

- **［設計］** 2 項目を足した(`fhir/vitalHelpers.ts`)。
  - **酸素流量**: `VITAL_MEASURES` の 1 項目(`oxygenFlow`)。`valueQuantity` L/min、coding は LOINC 3151-8。0 = 室内気。
    `NURSING_LOINC_MAP` に MEDIS 31006122 を足し、看護指示の観察と同じ行に合流させる。FiO2 は持たない。
  - **意識レベル(JCS)**: `VITAL_MEASURES` は「LOINC + 数値」を前提に経過表・チャート・抽出・差し込みから使われるので、
    `CAPILLARY_GLUCOSE` と同じく**別の定数 `JCS_MEASURE`** にした。coding は MEDIS 31001657 とローカル
    `http://fhir-client.local/CodeSystem/vital-measure | jcs`(LOINC に JCS は無い)、値は `valueCodeableConcept` で
    ローカル `http://fhir-client.local/CodeSystem/jcs` の code 0〜300(表示は I-1・II-10 など)。MEDIS を持つので
    看護観察の JCS と経過表の同じ行に合流する。入力はセレクト。
- **［設計］** SpO2 スケール 2 の対象患者は **注意区分マスタ(`Flag`)に「SpO2 スケール2(高CO2血症リスク)」を 1 件足して**患者ごとに付ける
  (`docs/features/patient-profile.md`「診療上の注意」)。スコアの純関数は有効な Flag の有無を引数で受ける。
- 採らなかった案: 意識を ACVPU で直接記録する。国内の看護記録・DPC・救急の記録はすべて JCS なので、二重に書かせない。

## 3. 算出(純関数)と保存

- **［設計］** `fhir/earlyWarningHelpers.ts`(FHIR にも React にも依存しない):

```text
computeNews2({ respiration, spo2, oxygenFlow, systolic, pulse, jcs, temperature, spo2Scale2 })
  -> { total, items: { key, points }[], band: "low" | "low-medium" | "medium" | "high", missing: key[] }
computeQsofa({ respiration, systolic, jcs, ... })
  -> { score, items, missing }
jcsToAcvpu(jcs) -> "A" | "C" | "V" | "P" | "U"
```

- **［設計］** 測定セットの transaction に **派生 Observation を 1 件同梱**する(右ペインは `useSaveVitalEntry`、一括入力は
  `buildBulkVitalBundle`。組み立ては `earlyWarningEntries`(`fhir/earlyWarningTaskHelpers.ts`))。施設設定で無効なら何も足さない。
  POST する測定には `urn:uuid` の `fullUrl` を付け(`withFullUrls`)、NEWS2 の `derivedFrom` と通知の `focus` が同じ transaction の
  中を指せるようにした。測定値が 1 つも無い(拡張期・体重だけ等)ときは作らない。

```text
Observation
  status      = final
  category    = vital-signs(経過表・抽出で他のバイタルと同じ扱い)
  code        = http://fhir-client.local/CodeSystem/early-warning-score | news2(display "NEWS2")
  subject / encounter / effectiveDateTime = 元の測定と同じ
  identifier  = vital-entry の同じ値(セットと一緒に消える)
  valueInteger = 合計
  interpretation[0] = ローカル early-warning-band | low / low-medium / medium / high
  component[] = 項目ごとの点数(code は項目の LOINC、意識はローカルの jcs、valueInteger)。欠測の項目は dataAbsentReason=not-performed
  derivedFrom[] = 元の Observation
```

  qSOFA は保存せず、表示時に同じ入力から計算する(項目が NEWS2 の部分集合で、別に持つ意味が無い)。
- **［設計］** 編集は測定セットを作り直す(DELETE + POST)ので NEWS2 も作り直す。カルテのカードの検索は
  `derived-from:missing=true` で NEWS2 を含まないため、**カードからの削除は identifier で引き直して全件消し**、
  消える NEWS2 を `focus` にした未対応の通知を同じ transaction で取り下げる(`useDeleteVitalEntry`)。
- **［事実］** 上流は `Observation?code=<ローカル system>|<code>` を strict でも受け付ける(2026-10-16 に
  `micro-result-item|culture` で確認、`_summary=count` で 6 件)。病棟の患者ぶんの最新スコアは
  `Observation?code=early-warning-score|news2&patient=a,b,…&date=ge{3日前}&_sort=-date` で引ける
  (`api/queries/earlyWarning.ts`。患者は 10 人ずつの塊)。
- 採らなかった案: 保存せず表示のたびに計算する。病棟一覧の列を出すのに病棟全員のバイタルを引き直すことになり、
  一覧の読み込みが重くなる。派生 Observation はセットと同じ寿命(DELETE + POST)なので整合は崩れない。

## 4. 通知(Task)

- **［設計］** 種別 `ews-alert`(早期警告)。`components/notifications/notificationRegistry.tsx` に 1 要素、作る側は
  `fhir/earlyWarningTaskHelpers.ts`(`pathwayVarianceTaskEntries` と同じ作り)。
  - 条件: 進行中の入院(右ペインは `usePatientAdmission`、一括入力は行の Encounter)があり、band が施設設定の下限
    (既定 medium)以上。外来の測定でも NEWS2 は残すが通知しない。
  - `focus` = 同じ transaction の NEWS2、`for` = 患者、`encounter` = 入院、`owner` = 入院の主治医(`encounterAttendingId`)、
    `requester` = 一括入力では測定者。`input` に合計・区分・点数のある項目・欠測・測定日時。強度は high → アラート(stat)、
    それ以外 → 注意(urgent)。
  - 同じ入院に未対応の `ews-alert` があれば書き換えて出し直す(新しい Task は作らない。`focus` は新しい NEWS2 に付け替わる)。
    下限を下回る測定なら `cancelled`。保存前に `Task?code=ews-alert&encounter=…&status=requested` を引く
    (`fetchOpenEwsAlertTasks`。`for=` ではなく前例のある `encounter=` で引く)。
  - 一覧の対応は固定文言「早期警告を確認しました。」。対応の内容(医師診察 / RRS 要請 / 経過観察)を選ばせるのは残課題
    (レジストリの `action.noteText` が固定文字列で、選択式にすると一覧・一括対応の作りに手が入るため)。
- **［事実］** 1 通知 = 1 宛先。担当看護師には届けず、病棟一覧の列と患者帯で気付く前提にした。
- **［要確認］** RRS(院内迅速対応システム)の呼び出し先を通知にするか(RRS チームを CareTeam `rst` で持ち、宛先に加える)は施設の運用次第。

## 5. 画面

- **経過表**: NEWS2・意識(JCS)・酸素流量の行を足した(`FLOWSHEET_ORDER` の先頭が NEWS2)。`flowsheetCell` が `valueInteger` を
  読み、NEWS2 の行だけは `interpretation` の band から色を決める(高 → HH の反転、中 → H の赤字)。
- **`VitalForm` / 一括入力**: 右ペインは入力中の値から `computeNews2` を呼び、BMI の下に合計と区分(欠測は「暫定」、
  欠けた項目は title)、施設設定 `show_qsofa` なら qSOFA を出す。NEWS2 の行は施設設定が有効なら値が無くても出し、
  ラベル横の「?」を押すと NEWS2 の点数表・区分・qSOFA の基準をモーダルで出す(`components/EarlyWarningFormulaModal.tsx`)。一括入力は列を足すだけで点数は出さない。
- **入院患者一覧**: 任意列「NEWS2」(既定は非表示)。直近 3 日の最新の点数を区分の色で出し、暫定は「*」を添える。
- **患者帯**: 直近 3 日の最新が中以上のときピクトグラム(心拍の波形。中は `--warning`、高は `--danger`)。吹き出しに
  点数・測定日時・点数のある項目と、経過表タブへのリンク。一覧の行のピクトグラムには出さない。
- **チャート・データ抽出の記録タブ**: バイタルの項目に「NEWS2」を足した(`vitalChartItems`)。条件木の観察には出さない。
- **看護ワークシート**: 変更しない(時刻の格子に点数は馴染まない)。

## 6. 施設設定

- `facility_settings.early_warning`: `enabled`(既定 false)、`notify_band`(low-medium / medium / high、既定 medium)、
  `show_qsofa`(既定 true)。`FacilitySettings::SETTINGS` に 1 要素。画面は施設設定の「早期警告スコア(NEWS2)」区画。
- 経過表一括入力の列(`bulk_vital_entry.items`)の候補に `oxygen_flow`・`jcs` を足した(既定の列には入れない)。

## 7. 対象外・残課題

- 外来・救急は通知しない(入院 Encounter が無ければ通知しない)。救急の JTAS と並べる案は救急の設計に送る。
- 看護指示の観察から書かれた JCS・酸素流量はスコアの材料にしない(算出は右ペインと一括入力の測定セットの保存時だけ)。
- 通知の対応の内容(医師診察 / RRS 要請 / 経過観察)の選択、RRS チームへの通知。
- 小児(PEWS)・産科(MEOWS)の別スコア。行セットの切替(経過表の種別)と同じ考え方で足せる。
- 酸素投与の「有無」を処置(酸素吸入)の実施記録から自動で取る。GCS を qSOFA の判定に使う。
- データ抽出の条件木で NEWS2 の値で絞る。

## 8. 検証(2026-10-16、Docker 環境)

- テスト太郎(入院中、主治医 医師 一郎)に右ペインで JCS II-10・RR 24・SpO2 93・SBP 100・HR 110・体温 38.5 を入れ、
  酸素流量が空欄の間は「11 点(高)・暫定」、2 L/分を入れて 13 点(高)・qSOFA 3 点。保存で NEWS2(derivedFrom 7 件、項目別点)と
  主治医あての `ews-alert`(アラート)ができ、経過表の行・患者帯のピクトグラムと吹き出し・通知一覧・入院患者一覧の列に出た。
- 編集で正常値にすると NEWS2 は 0 点(低)で作り直され、通知は `cancelled`。JCS II-10・RR 24 で 5 点(中)にすると新しい通知(注意)、
  続けて体温 39.5 で 7 点(高)にすると同じ通知が版 2 で書き換わった(件数は増えない)。
- カルテのカードから削除すると identifier の Observation は 0 件、未対応の通知は `cancelled`。
- 一括入力(酸素流量・意識の列を一時的に追加)で入院 士郎に RR 26・JCS III-100 を入れ、6 点(中)・欠測 5 項目の通知が主治医あてにできた。
- `npx tsc -b`・`npm run lint`(警告数は変更前と同じ)・import 循環 0、backend の施設設定の spec。
