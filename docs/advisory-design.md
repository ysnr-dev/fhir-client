# 警告(判断支援)の共通の器とガバナンス

`docs/functional-gap-backlog.md` §5.3 候補 #3(§2.1「警告を無視した理由」、§2.3「患者状態チェックの器」の一部を含む)。
**状態: 実装済み(2026-10-19)。施設が条件式で足す規則(§2.9)と定期検査・検診(§2.10)は 2026-11-03。止める(block)種別はまだ無い。**
フォームの中で出す警告(薬剤・放射線・レジメン・患者状態・外部の判断支援)を 1 つの型 `Advisory` と 1 つの表示部品に寄せ、
「確認を要する」警告を無視して登録するときは理由(マスタ)を必須にして来歴 `Provenance` と backend の台帳に残す。
管理画面「警告の集計と設定」で種別 × 月の発火数・無視率・主な理由を見て、種別ごとの重さを施設が下げられる(「表示のみ」「出さない」)。
施設は条件式(FHIRPath と % 変数)で警告の規則を足せ、登録フォームとカルテを開いたときに出る(§2.9)。

- **［事実］** = 既存の実装・上流で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 実装時・運用で確かめること

ユーザー決定(2026-10-18): (1) 確認を要する警告を無視して登録するときは理由の選択を必須にする(自由記述は任意)、
(2) 理由の候補は backend の小マスタに持つ、(3) 種別ごとの重さの調整(下げる・出さない)も第 1 段に含める、
(4) 第 1 段でフォーム内の警告すべてを寄せる。患者帯のピクトグラム・早期警告(NEWS2)・手術室の重なり・パスの適応基準チェック・
ロット番号の重複・輸血の同意は対象外(登録の操作そのものに組み込まれているか、警告ではなく状態の表示)。

## 0. 実装前の状態(設計時の前提)

- 警告は機能ごとに別々の型で、重さは boolean(`MedicationWarning.high`、`RadSafetyNote.high`、`LabCheckStatus.out`)。
  CDS Hooks のカードだけ `info / warning / critical` の 3 段階。表示も `.pregnancy-notice`・`.rad-safety-notice`・`.medicine-warning`・
  `.regimen-check__summary--out`・`.cds-card` と機能ごとの CSS。
- 無視して登録しても何も残らなかった。例外は CDS の重要カード(order-sign の確認モーダルで理由を選ぶ)で、理由はサービスへの
  feedback に送るだけで院内には残らない(`cds-hooks-design.md` §4)。
- 発火数・無視率を数える表は無く、月次の集計を返す管理 API も無かった。
- `Provenance.reason` はどこでも使っていない。`Provenance.activity` は v3-DataOperation(CREATE/UPDATE/…)だけ。

## 1. 全体の流れ

1. **［設計］** 各ドメインのヘルパーは今まで通りに判定し、結果を `Advisory` に写す(アダプタ)。判定の中身は変えない。
2. **［設計］** フォームは `useAdvisorySession(advisories, context)` に通す。施設設定(§3.4)で重さを下げた・消したあとの警告が返り、
   `AdvisoryNotice`(フォームの先頭)と `AdvisoryInlineMarks`(薬剤行の下)で描く。
3. **［設計］** 登録ボタンで、止める警告があれば登録しない(検証エラーと同じ赤帯)。確認を要する警告があれば `AdvisoryConfirmModal` を
   挟み、1 件ずつ理由(マスタ)を選ばせる。無ければそのまま登録。
4. **［設計］** 登録の直前に `session.confirm(overrides)`。無視した警告を来歴に載せる準備(§2.8)をし、セッション中に出た警告の
   発火と無視を台帳(§3.2)に 1 回で送る。登録せずに閉じたときは発火だけを送る。
5. **［設計］** 管理画面「警告の集計と設定」(§4)が台帳を種別 × 月で集計して見せ、行ごとに重さを下げる・出さないを施設設定に書く。

## 2. frontend

### 2.1 `Advisory` 型とレジストリ(`fhir/advisoryHelpers.ts`)

```ts
type AdvisorySeverity = "info" | "warning" | "block";   // 表示のみ / 確認を要する / 止める
interface Advisory {
  key: string;        // セッション内の同一性。添字を入れず、種別・対象(薬剤コードなど)・文言から作る(advisoryKey)
  kind: AdvisoryKind; // レジストリの種別
  severity: AdvisorySeverity;
  message: string;
  detail?: string;    // title 属性に出す補足
  source?: { label: string; url?: string };  // 外部の判断支援の出どころ
  scope?: { rp: number; line: number };       // 薬剤行に出す警告の位置。無いものはフォームの先頭
}
```

種別は `ADVISORY_KINDS`(`as const` 配列)と `ADVISORY_KIND_DEFS`(表示名・集計のグループ・既定の重さ)で持つ。
**種別を足すときはここに 1 要素足し、アダプタで `severityOf(kind, high)` を呼ぶだけ**(種別ごとの if を画面に書かない)。

| 種別 | 表示名 | グループ | 既定(上限) | 出どころ |
|---|---|---|---|---|
| `allergy` | 薬剤アレルギー | 薬剤 | warning(重篤度に関係なく常に) | `medicationAdvisories`、レジメン適用の薬剤行 |
| `duplicate` | 重複投与 | 薬剤 | info | `medicationAdvisories` |
| `interaction` | 相互作用 | 薬剤 | warning(禁忌)/ info(注意) | 同上(`drugCheckHelpers`) |
| `dose` | 用量・患者条件 | 薬剤 | warning(上限超過・禁忌)/ info(確認できない) | 同上 |
| `antimicrobial` | 抗菌薬 | 薬剤 | warning(許可制・14 日以上)/ info | 同上(`antimicrobialHelpers`) |
| `days-limit` | 投与日数の上限 | 薬剤 | warning | 同上(`drugCheckHelpers` の規則・`prescriptionCheckHelpers` の処方区分) |
| `crush-split` | 粉砕・分割 | 薬剤 | warning | 同上(`prescriptionCheckHelpers`) |
| `usage-form` | 剤形と用法 | 薬剤 | info | 同上 |
| `disease` | 病名禁忌 | 薬剤 | warning(禁忌)/ info(注意) | 同上(`drugCheckHelpers`) |
| `adoption` | 採用区分 | 薬剤 | warning(採用外・院外専用)/ info(仮採用) | 同上(`prescriptionCheckHelpers`) |
| `restricted-department` | 処方できる診療科 | 薬剤 | warning | 同上 |
| `contrast-flag` | 造影の注意区分 | 放射線 | warning | `radSafetyAdvisories` |
| `contrast-allergy` | 造影剤アレルギー | 放射線 | warning(常に) | 同上 |
| `egfr` | 腎機能 | 放射線 | warning(30 未満)/ info(45 未満・算出不能) | 同上 |
| `biguanide` | ビグアナイド内服 | 放射線 | info | 同上 |
| `implant` | 体内金属 | 放射線 | warning(MRI)/ info(放射線治療) | 同上、`useRadiotherapyAdvisories` |
| `reirradiation` | 同一部位の照射歴 | 放射線 | info | `useRadiotherapyAdvisories` |
| `pregnancy` | 妊娠・授乳 | 患者状態 | info | `pregnancyAdvisory` |
| `infection` | 感染症 | 患者状態 | info | `infectionAdvisory` |
| `meal-allergy` | 食物アレルギーの反映 | 食事 | info | `useMealAllergyAdvisories`、食事オーダーの編集 |
| `regimen-lab` | 適応基準 | レジメン | warning(基準外)/ info(未検・古い) | `regimenLabAdvisory` |
| `regimen-weight` | 体重の変化 | レジメン | warning | `regimenWeightAdvisory` |
| `regimen-cumulative` | 累積投与量 | レジメン | warning(上限超過)/ info(確認できない) | `regimenCumulativeAdvisories` |
| `regimen-conflict` | レジメンの重なり | レジメン | warning(同じレジメンが進行中)/ info(他のレジメン) | `applicationConflictAdvisories` |
| `regimen-date` | 開始日 | レジメン | info | `startDateAdvisories` |
| `regimen-availability` | 候補外のレジメン | レジメン | info | 下書き・廃止・有効期間外、適用後のマスタ変更 |
| `transfusion-refusal` | 輸血拒否 | 輸血 | warning | `transfusionRefusalAdvisory` |
| `blood-type-unconfirmed` | 血液型の未確定 | 輸血 | warning | `bloodTypeUnconfirmedAdvisory` |
| `antibody-screen` | 不規則抗体の検査 | 輸血 | warning | `antibodyScreenAdvisory` |
| `blood-type-different` | 異型適合血 | 輸血 | info | `differentBloodTypeAdvisories` |
| `transfusion-reaction-history` | 輸血副作用歴 | 輸血 | info | `reactionHistoryAdvisory` |
| `dispense-blood-type` / `dispense-requested-type` / `dispense-product` / `dispense-expiry` / `dispense-irradiation` / `dispense-crossmatch` | 出庫: 患者の型との適合 / 依頼の型との一致 / 依頼の製剤との一致 / 有効期限 / 照射 / 交差適合試験 | 輸血 | warning | `dispenseAdvisories`(出庫入力) |
| `antibody-positive` | 不規則抗体陽性 | 輸血 | warning | `dispenseAdvisories` |
| `perform-not-dispensed` / `perform-missing-bag` | 実施: 出庫記録に無いバッグ / 入力に無い出庫バッグ | 輸血 | warning | `TransfusionPerformModal`(実施入力) |
| `transplant-blood-type` | 移植後の血液型 | 輸血 | info | `transplantAdvisory` |
| `autologous-mismatch` / `autologous-expiry` | 自己血: 本人の血かの確認 / 有効期限 | 輸血 | warning | `dispenseAdvisories` / `autologousExpiryAdvisory` / `firstCollectionExpiryAdvisory`(採血予定) |
| `autologous-hb` | 自己血: 採血前の Hb | 輸血 | warning | `autologousHbAdvisory`(採血入力。施設設定 `transfusion.autologous_hb_min`) |
| `cds-critical` / `cds-warning` / `cds-info` | 判断支援(重要 / 注意 / 情報) | 外部 | warning / info / info | `cdsCardAdvisories` |
| `facility-rule` | 施設の規則 | 施設 | warning | `evaluateAdvisoryRules`(§2.9。規則ごとの重さはマスタ) |

### 2.2 既存の判定との対応

- **［設計］** `high: true → 種別の既定の重さ`、`high: false → info`(`severityOf`)。既定は**上限**で、アダプタは上限より高くは出せない。
- **［設計］** 薬剤アレルギー・造影剤アレルギーの一致は重篤度に関係なく確認を要する(アレルゲンの処方は常に上書き)。
- **［設計］** CDS は `critical → warning`(理由必須。今までと同じ)、`warning / info → info`(今まで理由は任意だったものを「表示のみ」に揃える)。
- **［設計］** 第 1 段で `block` になる既存の判定は無い。止めるべきもの(死亡患者へのオーダー、外泊中の入院オーダーなど。
  バックログ §2.3)は型と流れだけ用意してある。

### 2.3 重さの調整(施設設定 `advisory_severity`)

- **［設計］** 種別 → `default`(実装の既定)/ `info`(表示のみに下げる)/ `off`(出さない)。`applySeverityOverrides` が
  セッションの入口で当てる。**下げる・消すだけで上げない**。`block` 種別は変えられない。`off` の種別は表示されず発火にも数えない。
- **［設計］** 設定は管理画面「警告の集計と設定」の行から書く(§4)。backend は値(`default/info/off`)とキーの形だけ検証し、種別の一覧は知らない。

### 2.4 表示(`components/AdvisoryNotice.tsx`)

- `AdvisoryNotice` … フォームの先頭に 1 件 1 行(`ul.advisory-notice`)。重いものから並べ、`info` は注意の橙、`warning`・`block` は危険色。
  `scope` を持つ警告は含めない(`unscopedAdvisories`)。
- `AdvisoryInlineMarks` … 薬剤行の下の印(`.medicine-warning`、`warning`・`block` に `--high`)。`advisoriesOfScope(advisories, rp, line)` で引く。
- **［設計］** 旧 `PregnancyNotice`・`InfectionNotice`・`RadSafetyNotice`・`MedicineWarnings`(部品)と `.pregnancy-notice`・`.rad-safety-notice`・
  `.regimen-apply__allergy*` は削除。`MealAllergyNotice`(食事タブ)は `AdvisoryNotice` を描くだけの薄い部品として残す(登録の場面ではないので台帳には残さない)。

### 2.5 セッションと発火・無視の定義(`hooks/useAdvisorySession.ts`)

- **発火(fired)** = フォームを開いてから閉じるまで(`session_id` = uuid)に、その `key` が一度でも表示されたこと。初めて表示した日時を持つ。
- **無視(overridden)** = 登録時点で `warning` が残っていて、理由を選んで登録したこと。
- **無視率** = overridden ÷ fired。`info` は fired だけ数える。
- **［設計］** 送信はセッションにつき最大 2 回: 登録時(fired + overridden)と、登録せずに閉じたとき(unmount の cleanup で fired)。
  サーバーは `(session_id, advisory_key, outcome)` の一意制約で重複を捨てるので、再送・StrictMode の二重 unmount は数を増やさない。
  送信は `keepalive` で投げ、失敗は握りつぶす(統計で診療を止めない)。
- **［設計］** `enabled = false`(オーダーセットの内容入力など患者が決まらない画面)では警告を出さず、何も送らない。
- 入口の `context`(台帳の列。一覧と表示名は `ADVISORY_CONTEXTS` / `ADVISORY_CONTEXT_LABELS`): `prescription` / `injection` / `rad-order` / `radiotherapy` /
  `physio` / `endoscopy` / `meal-order` / `transfusion-order` / `transfusion-dispense` / `transfusion-perform` / `autologous-collection` /
  `medical-management` / `regimen-apply` / `regimen-cycle`、およびカルテを開いたときの `patient-view`(§2.9。確認は無く発火だけ)。
  処方の order-select のカード(登録を止めない、閉じたときに記録)は `PrescriptionOrderSelectCards` が自前の `session_id` で送る。

### 2.6 登録前の確認(`components/AdvisoryConfirmModal.tsx`)

- **［設計］** 理由はフォーム内のインライン select ではなく、登録ボタンを押したあとのモーダルで選ぶ(フォームが長い。CDS の order-sign と同じ流れ)。
  `warning`・`block` の行に理由の select(マスタ、有効な行を表示順)と補足の text。理由が揃うまで「登録」は無効。「戻る」でフォームへ。
- `Modal` はポータルではないのでボタンは `type="button"`。レジメン適用パネルは `<form>` を持たないのでそのまま置ける。
- 理由の候補は警告ごとに差し替えられる(`reasonOptions`)。CDS のカードはサービスが `overrideReasons` を返せばそれ、無ければマスタ。
  リンクなどの追加表示は `renderExtra`(CDS のカードは `CdsCardLinks`)。
- フォーム側の形は共通: `handleSubmit` で検証 → `session.blocked` があれば赤帯 → `session.pending` があればモーダル →
  `session.confirm(overrides)` → 今まで通りの `onSubmit`。放射線は `onSubmit` の引数が多いので、登録処理を閉包にして state に持ち、
  モーダルの「登録」で呼ぶ。表示のみの警告しか出さないフォーム(生理・内視鏡・放射線治療・食事)はモーダルを持たず `confirm([])` だけ呼ぶ。

### 2.7 CDS Hooks との統合

- **［設計］** order-sign のカードは `cdsCardAdvisories` で `Advisory` にし、`session.pending` と合わせて同じモーダルに並べる
  (`PrescriptionOrderSignModal` は削除)。重要のカードの無視は、サービスへの feedback(今まで通り)に加えて来歴と台帳にも残る。
- **［設計］** 患者帯の吹き出しと order-select の既定の無視理由はマスタ(§3.1)から出す(`overrideReasonsOf(card, masterReasons)`)。
  マスタが空なら従来の 4 つ(対応済み / 該当しない / 臨床判断で不要 / その他)。

### 2.8 来歴(`Provenance`)

- **［設計］** 無視して登録したときは、登録の来歴(`useWithOrderProvenance`)とは別に `Provenance` を 1 件、同じ transaction に足す。
  - `activity` = `{system: http://fhir-client.local/CodeSystem/provenance-activity, code: override}`
  - `target` = 登録の来歴と同じ(ヘッダ全部と MedicationRequest。`orderProvenanceTargets`)
  - `agent` = 無視した本人(`enterer`)だけ。指示医師を `author` に入れると代行の活動と見分けがつかず承認待ちに並ぶので入れない
  - `reason[]` = 無視 1 件につき `{coding: [{system: http://fhir-client.local/CodeSystem/advisory-override-reason, code, display}], text: "<種別>: <文言>（<補足>）"}`
- **［設計］** 無視をフォームから親の Bundle 組み立てへ渡す経路は `lib/advisoryOverrideStage.ts`(置いて取り出す受け渡し場所)。
  フォームは `onSubmit(values)` しか呼ばず、Bundle と来歴は親(16 種別)にあるので、`onSubmit` の型を変えずに済ませる。
  `session.confirm` で置き、`useWithOrderProvenance` が Bundle を包むときに取り出して消す(来歴を付けない登録でも捨てる)。
  置いたセッションが unmount したときも消す(確認の無い患者帯のセッションが外れても、開いているフォームの準備は消さない)。
- **［事実］** 上流(fhir-server)は独自 system の `activity` と `reason` を受理した(2026-10-19 に処方で確認)。
- `summarizeOrderProvenance` はこの来歴を登録・編集の要約から外し、`advisoryOverridesOf` で別に返す。オーダー詳細(`EnteredByRow`)に
  「警告の確認」行(誰が・いつ・どの警告をどの理由で)。
- 来歴を書けない登録(`enterer` が無い administrator ログイン、Provenance を付けない Bundle)でも台帳には残る。

### 2.9 施設の規則(`fhir/advisoryRuleHelpers.ts`、`hooks/useAdvisoryRuleAdvisories.ts`)

海外 EMR(InterSystems TrakCare の Active Decision Support)にある、施設がコードを書かずに足す警告。
ユーザー決定(2026-11-03): (1) 汎用の「条件式 → 警告」の表にし、Health Maintenance(バックログ §5.3)は後でこの表の規則のプリセットと
専用画面として載せる、(2) 出す場所は登録フォームとカルテを開いたとき、(3) 処方・注射では入力中の薬剤を式で参照できる、
(4) 重さは表示のみ / 確認だけ(止めるは付けられない)。

- **条件式**: FHIRPath(fhirpath.js、R4 モデル)。base は患者の `Patient`、環境はテンプレートの初期値式と同じ % 変数(`buildPopulateContext`)に
  `%orderItems`(下記)を足したもの。**結果に `true` が含まれるときだけ発火**し、偽・空・真偽値でない結果・評価の失敗はどれも出さない
  (失敗は `console.warn`。式の誤りで診療を止めない)。例:
  - `%egfr < 30 and %orderItems.exists(code.startsWith('3962'))`(eGFR 30 未満でビグアナイド)
  - `%diagnosisIcd10.exists($this.startsWith('E11')) and (%labs.where(code='160010010').empty() or %labs.where(code='160010010').daysAgo > 180)`
    (2 型糖尿病で HbA1c が 180 日以上無い)
- **読む元データ**: 式が参照する変数の分だけ(`usePopulateSources` の遅延読み込み。`%labs` は参照したコードごとに最新 1 件、
  `%egfr` / `%ccr` は処方のチェックと同じ直近 200 件の検体検査)。**その場面の規則が無ければ何も読まない。**
- **規則のための変数**:
  - `%orderItems` … 処方・注射で入力中の薬剤 `{code(YJ), name, ingredient(成分 7 桁)}` の配列。他の場面では空配列(無い変数は FHIRPath が例外にするので必ず置く)。
    規則の編集画面の変数一覧だけに出す(`ADVISORY_RULE_EXTRA_OPTIONS`)。
  - `%labs.….daysAgo`(採取日から今日までの日数)と `%egfr` / `%ccr` はテンプレートでも使える変数として足した(`docs/features/templates.md`)。
  - `%devices` … 留置中の留置物(ライン・ドレーン・カテーテル) `{code, name, kind, bodySite, insertedAt, daysInserted}` の配列
    (`docs/line-drain-design.md` §4.8。種別マスタの警告日数は持たせず、閾値は式に書く。seed の記入例 `cvc-over-14` / `foley-over-7`)。
- **警告**: `{key: "facility-rule|<コード>", kind: "facility-rule", severity: severityOf(kind, 規則の重さ === warning), message: 文言,
  detail: 補足, source: 規則の名前(根拠が URL ならリンク、文なら名前に添える)}`。施設設定 `advisory_severity` の `facility-rule` で、
  施設の規則全体を「表示のみ」「出さない」に下げられる(個別の重さはマスタ)。
- **出す場所**: 14 のフォームは既存の警告と同じ配列に足すだけ(確認モーダル・来歴・台帳はそのまま)。
  カルテを開いたときは患者帯のピクトグラム「施設の規則 n 件」(`components/AdvisoryRulePictogram.tsx`、色は最大の重さ。吹き出しに `AdvisoryNotice`)。
  患者帯の評価はカルテだけ(`PatientHeader` の `cds` と同じ。一覧の患者ドロワーでは患者ごとに走らせない)。
  患者帯は `useAdvisorySession(…, "patient-view")` で施設設定を当て、カルテを離れたときに発火を台帳に送る(確認は無いので無視は記録しない)。
- **試す**: 規則の編集モーダルで患者番号を入れると、その患者で式を評価して「該当 / 該当なし / 式の誤り(メッセージ)」を出す(`%orderItems` は空)。
  定期項目を持つ規則は「該当(期限超過、最終 2026-09-05)」のように期限の状態も添える。

### 2.10 定期検査・検診(`fhir/healthMaintenanceHelpers.ts`、`api/queries/healthMaintenance.ts`、`components/HealthMaintenanceSection.tsx`)

バックログ §5.3 の Health Maintenance。ユーザー決定(2026-11-03): 施設の規則の表にプリセットとして載せ、期限の専用画面と延期を足す。

- **規則**: 施設の規則に任意の **定期項目** `maintenance = {kind, code, name, interval_days}` を持たせる。持つ規則では **条件式は対象の患者を選ぶ式**
  (「ワルファリン内服中」「2 型糖尿病」)で、期限の判定は式に書かない。`kind` は最終実施日を引くリソース:
  `lab`(Observation、結果項目マスタの施設コード。`%labs` と同じ引き方)/ `procedure`(Procedure、`code=` の token。「体系|コード」も可)/
  `immunization`(Immunization、`vaccine-code=`)。どれも `patient` + `_sort=-date` + `_count=1` で 1 件だけ引く(`fetchLastMaintenanceDate`)。
- **状態**(`maintenanceStatusOf`): 有効な延期・対象外の Flag があれば、終了日なし → `exempt`(対象外)、終了日が今日以降 → `deferred`(延期中)。
  終了日を過ぎた延期は無いものとして扱う。Flag が無ければ、記録なし → `never`、最終実施日 + 間隔 < 今日 → `overdue`、それ以外 → `ok`。
- **警告**: `evaluateAdvisoryRules` は定期項目を持つ規則について、式が真で状態が `never` / `overdue` のときだけ警告にする。補足の先頭に
  「<項目> の最終実施 <日>(期限 <日>)」か「<項目> の記録がありません」を足す。key・種別・台帳は他の施設の規則と同じ(`facility-rule|<コード>`)。
  材料(`useMaintenanceRecords`)が揃うまでは評価しない(`useAdvisoryRuleEvaluation` の env が null)。
- **延期・対象外**: `Flag {status: active, category: flag-category|health-maintenance, code: advisory-rule|<規則コード>(display 規則名、text 理由),
  period: {start 今日, end 延期の期限(対象外は無し)}, author}`(`buildMaintenanceFlag`)。解除は Flag を終了(`endFlag`、読み直した版で PUT)。
  **診療上の注意の一覧・患者帯・`%cautions` からはこの区分を除く**(`excludeHealthMaintenanceFlags` が `category:not=health-maintenance` を足す。
  上流の Flag は `category` の token 検索と `:not` に対応)。
- **区画**: カルテのプロファイルタブ「定期検査」。有効で定期項目を持つ規則(出す場所は問わない)のうち式がこの患者で真になるものを並べ、
  状態・項目と間隔・最終実施日・期限・延期の期限と理由を出す。延期(期限日の初期値は今日 + 間隔)・対象外は理由任意のモーダル、
  延期中・対象外の行は「解除」。督促 Task は作らない(受信箱を自動生成の通知で埋めない)。
- **変数**: 対象の式のために `%activeMedicationCodes`(投与中の処方薬の成分コード = YJ 上 7 桁の配列、持参薬を含まない)をテンプレートの変数に足した。
- seed の記入例: 糖尿病の HbA1c(180 日)、ワルファリン内服中の PT-INR(90 日)、ビグアナイド内服中のクレアチニン(180 日)、糖尿病の尿アルブミン/クレアチニン比(365 日)。
  予防接種・実施記録の例はコード体系が施設ごとなので入れない。

## 3. backend

### 3.1 マスタ `master_advisory_override_reasons`

| 列 | 型 | 内容 |
|---|---|---|
| `code` | string(unique、`[a-z0-9-]`) | 来歴・台帳に残るコード |
| `name` | string | 表示名 |
| `enabled` | boolean | 無効にすると候補に出ない(過去の記録は残る) |
| `display_order` | integer | 並び順 |

`Master::AdvisoryOverrideReasonsController`(`/master/advisory_override_reasons`、放射線治療の中止理由と同じ単純編集型)。
seed(`db/seed_data/advisory_override_reasons.csv`): 対応済み / 該当しない / 臨床判断で不要 / 患者に説明済み / モニタリングしながら使用 /
前回も同じ処方で問題なし / 有益性が危険性を上回る / その他。既存行は上書きしない。

### 3.2 台帳 `advisory_events`

| 列 | 内容 |
|---|---|
| `session_id` / `advisory_key` / `outcome` | 一意。`outcome` = `fired` / `overridden` |
| `kind` / `severity` | 種別と、施設設定を当てたあとの重さ |
| `context` | どのフォームか(§2.5) |
| `reason_code` / `reason_text` | 無視のとき。`reason_text` は来歴の `reason.text` と同じ文 |
| `practitioner_fhir_id` / `user_login_id` | サーバーがログイン中の本人で固定(送られた値は使わない) |
| `order_reference` | 任意(登録時点ではオーダーの id が無いので今は空) |
| `occurred_at` | 発火は初めて表示した日時、無視は登録した日時 |

`POST /master/advisory_events {context, session_id, events: [...]}`(利用者認証 + CSRF、1 回 200 件まで)。`insert_all(unique_by:)` で
重複を捨てて 204。不正な行があれば 422 で何も書かない。**［設計］** 保持期限は設けない(行は小さく、年単位の推移を見たい)。

### 3.3 集計 `GET /admin/advisory_stats?from=YYYY-MM&to=YYYY-MM`

`{from, to, rows: [{kind, month, fired, overridden, reasons: {code: n}}], rule_rows: [{rule_code, month, …}]}`。`rule_rows` は
`facility-rule` の行を key の 2 つ目(`split_part(advisory_key, '|', 2)` = 規則のコード)で分けた内訳。月は日本時間で切る
(`occurred_at` は timestamp without time zone なので `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo'`)。既定は今月から 6 か月、
24 か月を超える期間と `from > to` は 400。管理 API(`Admin::BaseController`)。

### 3.4 施設設定 `advisory_severity`

`FacilitySettings::SETTINGS` に 1 項目(`{種別 => "default" | "info" | "off"}`、キーは `[a-z-]`)。migration 不要。
画面の `applySeverityOverrides` が下げる・消すだけを行い、backend は上げる値(`block`)を受け付けない。

### 3.6 マスタ `master_advisory_rules`(§2.9)

| 列 | 型 | 内容 |
|---|---|---|
| `code` | string(unique、`[a-z0-9-]`) | 警告の key と台帳の集計に使う。作成後は変えられない |
| `name` | string | 名称(警告の出典に出す) |
| `enabled` / `display_order` | boolean / integer | 無効は評価しない / 並び順 |
| `severity` | string | `info`(表示のみ)/ `warning`(確認)。`block` は受け付けない |
| `contexts` | jsonb(文字列の配列) | 出す場所。1 つ以上、`Master::AdvisoryRule::CONTEXTS`(frontend の `ADVISORY_CONTEXTS` の写し)の値 |
| `expression` | text | 条件式 |
| `message` / `detail` | string / text | 文言 / 補足 |
| `basis` | string | 根拠(ガイドライン名か URL) |
| `maintenance` | jsonb(任意) | 定期項目 `{kind, code, name, interval_days}`(§2.10)。`kind` は `MAINTENANCE_KINDS`、`code` 必須、`interval_days` は 1 以上の整数。null で外す |

`Master::AdvisoryRulesController`(`/master/advisory_rules`、`?enabled=true`・`?context=`・`?maintenance=true` で絞れる。コードは更新で変えない)。
seed(`db/seed_data/advisory_rules.csv`、出す場所は「|」区切り)に記入例 7 件(ビグアナイドと腎機能、糖尿病の HbA1c 未検査、NSAIDs と腎機能、高齢者のベンゾジアゼピン系、ワルファリンと NSAIDs、高カリウムとスピロノラクトン、造影検査と腎機能)を**無効**で入れる。

### 3.5 パス

新しいトップレベルパスは足さない(vite / render の rewrite を増やさない): `/master/advisory_override_reasons`・`/master/advisory_events`・`/master/advisory_rules`・`/admin/advisory_stats`。

## 4. 画面

- **警告の集計と設定**(`/advisory-review`、管理メニュー、`AdminGate`): 期間(月 × 2、既定は直近 6 か月)、行 = レジストリの種別(グループでまとめる)、
  列 = 月ごとの「発火 / 無視(率)」、「主な理由」(上位 3 件、マスタの名称)、行末の select「既定 / 表示のみ / 出さない」(施設設定に即時保存。
  既定が表示のみの種別は「表示のみ」を選べない。`block` 種別は変えられない)。
  種別「施設の規則」の下に規則ごとの行(既定の列は規則の重さ、重さの列は規則マスタへのリンク。台帳にだけ残る削除済みの規則は「(削除済み)」)。
- **警告の確認理由マスタ**(`/advisory-override-reasons`、マスタメンテ > 警告): `SimpleMasterPage`(放射線治療の 4 マスタと共用)。
- **警告の規則マスタ**(`/advisory-rules`、マスタメンテ > 警告): 一覧(コード・名称・重さ・出す場所・有効・表示順)と編集モーダル
  (出す場所はチェックボックス、条件式は「変数」で変数一覧のモーダル(条件の組み立て)を開いて ` and ` でつなぐ、定期項目(種類・項目または
  コードと項目名・間隔)、「試す」)。検査項目は結果項目の検索モーダルから選ぶ。

## 5. 運用

- 集計は管理者だけが見る。台帳には患者 id を持たず、誰が無視したか(医療従事者 id)と自由記述の補足だけが個人に紐づく。
- 無視率の高い種別は、まず「表示のみ」に下げて様子を見る(発火は数え続ける)。それでも効かなければ「出さない」。
  受信箱型の通知を足す前に、ここで無視率を見て削る(バックログ §5.6)。

## 6. 検証

- backend: `spec/requests/master/advisory_override_reasons_spec.rb`、`master/advisory_events_spec.rb`(冪等・CSRF・不正値)、
  `admin/advisory_stats_spec.rb`(日本時間の月境界)、`facility_settings_spec.rb`(advisory_severity)。
- frontend: `tsc -b`、lint、`import-cycles`。ブラウザ(テスト太郎、2026-10-19): 処方でロキソニン錠 60mg 4 錠 → 重複・併用注意(表示のみ)と
  上限超過 2 件(確認)が行の下に出て、登録で確認モーダル → 理由を選んで登録 → 台帳に fired 4 件・overridden 2 件、上流に override の来歴 1 件
  (reason 2 件、agent = 入力者)。管理画面で件数・理由・重さの select(保存と復元)、マスタ画面の一覧を確認。
- 施設の規則(2026-11-03): `master/advisory_rules_spec.rb`(絞り込み・コードを変えない更新・block / 未知の場所 / 空の場所の 422)、
  `admin/advisory_stats_spec.rb`(規則ごとの内訳)。ブラウザ(糖尿 太郎): 「試す」で該当 / 該当なし / 式の誤り、カルテの患者帯に
  「施設の規則 1 件」、処方の DO で確認(ビグアナイド)と表示のみ(HbA1c)が並び、理由を選んで登録 → 来歴 override(医師ログイン時)、
  台帳に prescription と patient-view の行、集計の `rule_rows` に規則ごとの件数。検証の処方・台帳の行は片付け、seed の 2 件は無効に戻した。
- 定期検査・検診(2026-11-03): `master/advisory_rules_spec.rb`(定期項目の保存・`?maintenance=true`・null で外す・不正な定期項目の 422)。
  ブラウザ(糖尿 太郎・テスト 太郎、医師ログイン): 区画に HbA1c の行(期限内、最終 2026-09-07・期限 2027-03-06)、延期 → 「延期中 〜2027-05-02 理由」と
  Flag(category health-maintenance、author 医師)、`category:not` で注意の一覧から除かれること、解除 → 期限内。間隔を 30 日に下げて期限超過 →
  患者帯に「施設の規則 1 件」(補足に最終実施日と期限)、対象外 → 帯から消える、解除。規則マスタの定期項目の欄と「試す」。間隔は 180 日に戻した。

## 7. 残課題

1. `block` 種別(死亡患者へのオーダー、外泊中・退院済の入院オーダー、伝票の締切超過。バックログ §2.3)。
2. 患者帯の patient-view のカードの無視は feedback だけで台帳に残らない(登録の場面ではない)。
3. 「既知のアレルギー無し」(NKDA、バックログ §5.3 #4)を `allergy` の器に乗せる(未確認のまま処方したときの表示のみ)。
4. `order_reference` の埋め戻し(登録の応答からオーダー id を取って台帳を更新する)。
5. 無視率の推移をダッシュボードのタイルに出す。
6. 注射・部門オーダーへの CDS(order-select / order-sign)の展開(`cds-hooks-design.md` §7)。
7. 施設の規則: 止める重さ(block)は付けられない(1 の block 種別と合わせて考える)。患者帯の規則の吹き出しに「確認した」の記録は無い。
   部門オーダーの項目(撮影項目・検査項目)を式で参照する変数は無い(処方・注射の薬剤だけ)。
8. 定期検査・検診: 期限が近い(未超過)項目の予告、患者をまたいだ期限超過の一覧(データ抽出)、延期の期限切れの自動終了は無い。
   予防接種の既定のコード体系を決めていない(施設がコードを書く)。

## 8. 主なファイル

| 場所 | ファイル | 役割 |
|---|---|---|
| frontend | `fhir/advisoryHelpers.ts` | 型・レジストリ・重さの調整 |
| frontend | `hooks/useAdvisorySession.ts`、`lib/advisoryOverrideStage.ts`、`api/advisoryClient.ts` | セッション・受け渡し・台帳の送信 |
| frontend | `components/AdvisoryNotice.tsx`、`components/AdvisoryConfirmModal.tsx` | 表示・登録前の確認 |
| frontend | `fhir/provenanceHelpers.ts`(`buildAdvisoryOverrideProvenanceEntry`、`advisoryOverridesOf`)、`api/queries/provenance.ts` | 来歴 |
| frontend | `fhir/medicationSafetyHelpers.ts`、`radSafetyHelpers.ts`、`regimenCheckHelpers.ts`、`regimenOrderHelpers.ts`、`pregnancyHelpers.ts`、`infectionHelpers.ts`、`cdsCardHelpers.ts` | アダプタ |
| frontend | `hooks/usePatientStateAdvisories.ts`、`hooks/useRadSafetyAdvisories.ts`、`components/RadiotherapyPreCheck.tsx`、`components/MealAllergyNotice.tsx` | 患者の記録から警告を組む hook |
| frontend | `pages/AdvisoryReviewPage.tsx`、`pages/AdvisoryMasterPages.tsx`、`pages/AdvisoryRulePage.tsx` | 管理画面・マスタ画面 |
| frontend | `fhir/advisoryRuleHelpers.ts`、`hooks/useAdvisoryRuleAdvisories.ts`、`components/AdvisoryRulePictogram.tsx` | 施設の規則の評価・患者帯 |
| frontend | `fhir/healthMaintenanceHelpers.ts`、`api/queries/healthMaintenance.ts`、`components/HealthMaintenanceSection.tsx` | 定期検査・検診の状態・材料・区画 |
| backend | `app/models/master/advisory_override_reason.rb`、`app/models/advisory_event.rb`、`app/models/facility_settings.rb` | マスタ・台帳・施設設定 |
| backend | `app/controllers/master/advisory_{override_reasons,events,rules}_controller.rb`、`app/controllers/admin/advisory_stats_controller.rb` | API |
| backend | `app/models/master/advisory_rule.rb`、`db/seed_data/advisory_rules.csv` | 施設の規則のマスタ |
