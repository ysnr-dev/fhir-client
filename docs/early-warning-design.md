# 早期警告スコア(NEWS2 / qSOFA)と院内迅速対応の呼び出し

`docs/functional-gap-backlog.md` §4 の「臨床判断支援」(2026-10-16 の追加候補)。
**状態: 設計のみ(2026-10-16)。実装は未着手。**
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
- **意識レベルと酸素投与の項目は無い。** JCS は DPC 様式 1 の入力欄にだけある(時系列の Observation ではない)。
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

- **［設計］** `VITAL_MEASURES` に 2 項目を足す。
  - **意識レベル(JCS)**: `valueCodeableConcept`。項目の coding は MEDIS 31001657 とローカル CodeSystem
    `http://fhir-client.local/CodeSystem/vital-measure | jcs`(LOINC に JCS は無いので付けない)。値はローカル CodeSystem
    `http://fhir-client.local/CodeSystem/jcs` の code 0〜300。`VitalMeasure` の型に `kind: "quantity" | "choice"` を足し、
    choice の選択肢は `VitalForm` でセレクトにする。経過表では値をそのまま文字で出す。
  - **酸素流量**: `valueQuantity` L/min(UCUM `L/min`)。coding は LOINC 3151-8(Inhaled oxygen flow rate)+ MEDIS 31006122。
    0 = 室内気。FiO2(3150-0 + MEDIS 31006123)は任意の 3 項目目として同じ形で足せるが、第 1 段では流量だけ。
  - `NURSING_LOINC_MAP` に 31001657・31006122 を足し、看護指示の観察からも同じ行に合流させる。
- **［設計］** SpO2 スケール 2 の対象患者は **注意区分マスタ(`Flag`)に「SpO2 スケール2(高CO2血症リスク)」を 1 件足して**患者ごとに付ける
  (`docs/features/patient-profile.md`「診療上の注意」)。スコアの純関数は有効な Flag の有無を引数で受ける。
- 採らなかった案: 意識を ACVPU で直接記録する。国内の看護記録・DPC・救急の記録はすべて JCS なので、二重に書かせない。

## 3. 算出(純関数)と保存

- **［設計］** `fhir/earlyWarningHelpers.ts`(FHIR にも React にも依存しない):

```text
computeNews2({ respiration, spo2, oxygenFlow, systolic, pulse, jcs, gcs?, temperature, spo2Scale2 })
  -> { total, items: { key, value, points }[], anyThree, band: "low" | "lowMedium" | "medium" | "high", missing: key[] }
computeQsofa({ respiration, systolic, jcs, gcs? })
  -> { score, items, missing }
jcsToAcvpu(jcs) -> "A" | "C" | "V" | "P" | "U"
```

- **［設計］** 測定セットの transaction に **派生 Observation を 1 件同梱**する(`vitalSaveBundle`・一括入力 `bulkVitalHelpers` の両方)。

```text
Observation
  status      = final
  category    = vital-signs(経過表・抽出で他のバイタルと同じ扱い)
  code        = http://fhir-client.local/CodeSystem/early-warning-score | news2(display "NEWS2")
  subject / encounter / effectiveDateTime = 元の測定と同じ
  identifier  = vital-entry の同じ値(セットと一緒に消える)
  valueInteger = 合計
  interpretation[0] = ローカル early-warning-band | low / low-medium / medium / high
  component[] = 項目ごとの点数(code は項目の LOINC、valueInteger)。暫定なら component に欠測の項目を dataAbsentReason=not-performed で並べる
  derivedFrom[] = 元の Observation
```

  qSOFA は保存せず、表示時に同じ入力から計算する(項目が NEWS2 の部分集合で、別に持つ意味が無い)。
- **［事実］** 上流は `Observation?code=<ローカル system>|<code>` を strict でも受け付ける(2026-10-16 に
  `micro-result-item|culture` で確認、`_summary=count` で 6 件)。病棟の患者ぶんの最新スコアは
  `Observation?code=early-warning-score|news2&patient=a,b,…&_sort=-date&_count=500` の 1 本で引ける。
- 採らなかった案: 保存せず表示のたびに計算する。病棟一覧の列を出すのに病棟全員のバイタルを引き直すことになり、
  一覧の読み込みが重くなる。派生 Observation はセットと同じ寿命(DELETE + POST)なので整合は崩れない。

## 4. 通知(Task)

- **［設計］** 種別 `ews-alert`(早期警告)。`components/notifications/notificationRegistry.tsx` に 1 要素、作る側は
  `fhir/earlyWarningTaskHelpers.ts`(`buildPanicTask` と同じ作り)。
  - 条件: 患者に進行中の入院(Encounter in-progress)があり、band が施設設定の下限(既定 medium)以上。
  - `focus` = 派生 Observation、`for` = 患者、`owner` = 入院の主治医(`Encounter.participant` の attender)、
    `input` に合計・band・項目別点・測定時刻・暫定かどうか。強度は high → アラート(stat)、medium → 注意(urgent)。
  - 同じ入院に未対応の `ews-alert` があれば `input` を更新して出し直す(新しい Task は作らない)。band が下限を下回れば `cancelled`。
    保存前に `Task?code=ews-alert&for=&status=requested` を 1 本引く(パニック値の出し直しと同じ経路)。
  - 対応済みにするとき `note` に「医師診察 / RRS 要請 / 経過観察 / 誤入力」を選ぶ(`action.noteText` に選択肢を足す。
    レジストリの `action` は今は固定文言なので、選択式を 1 つ増やす)。
- **［事実］** 1 通知 = 1 宛先。担当看護師にも届けるなら Task を 2 件にするが、看護師は病棟一覧の列と患者帯で気付く前提にして、
  第 1 段では主治医だけ。
- **［要確認］** RRS(院内迅速対応システム)の呼び出し先を通知にするか(RRS チームを CareTeam `rst` で持ち、宛先に加える)は施設の運用次第。

## 5. 画面

- **経過表**: 派生 Observation がそのまま「NEWS2」行になる(`buildVitalFlowsheet` が code で行を作る)。band の色は
  `vitalInterpretationOf` と同じ場所で interpretation から決める。
- **`VitalForm` / 一括入力**: 入力中の値から `computeNews2` を呼び、フォーム下部に合計と band、欠測項目を即時表示する。
  qSOFA は施設設定で on のときだけ併記。
- **入院患者一覧**: 任意列 `ews`(`InpatientColumnsModal` の `COLUMN_LABELS` に 1 行、見出し・行・空床行の colSpan を合わせる)。
  最新の合計を band の色で出し、暫定は「*」を添える。並べ替えはしない。
- **患者帯**: band が medium 以上のときピクトグラム(`PictogramPopover` に項目別点と測定時刻)。
- **看護ワークシート**: 変更しない(時刻の格子に点数は馴染まない)。

## 6. 施設設定

- `facility_settings.early_warning`: `enabled`(既定 false)、`notify_band`(既定 "medium")、`show_qsofa`(既定 true)。
  `FacilitySettings::SETTINGS` に 1 要素。画面は `FacilitySettingsPage` に区画を 1 つ。

## 7. 対象外・残課題

- 外来・救急は対象外(入院 Encounter が無ければ通知しない)。救急の JTAS と並べる案は救急の設計に送る。
- 小児(PEWS)・産科(MEOWS)の別スコア。行セットの切替(経過表の種別)と同じ考え方で足せる。
- 酸素投与の「有無」を処置(酸素吸入)の実施記録から自動で取る。
- データ抽出の記録タブで NEWS2 の推移・帯域別の患者数を出す(派生 Observation があれば抽出の既存の器に乗る)。

## 8. 検証(実装時)

- 開発環境のテスト太郎(入院中)にバイタルを入れ、JCS と酸素流量を含めた 7 項目で合計と band が定義どおりか、欠測で「暫定」になるか。
- 中以上で `ews-alert` が主治医に届き、再測定で下がると取り下がること。再測定で上がると出し直しになること(新規 Task が増えない)。
- 入院患者一覧の列・患者帯・経過表の行。`npx tsc -b`、`npm run lint`、backend の施設設定は rspec。
