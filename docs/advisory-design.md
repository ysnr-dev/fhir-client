# 警告(判断支援)の共通の器とガバナンス

`docs/functional-gap-backlog.md` §5.3 候補 #3(§2.1「警告を無視した理由」、§2.3「患者状態チェックの器」の一部を含む)。
**状態: 実装済み(2026-10-19)。止める(block)種別はまだ無い。**
フォームの中で出す警告(薬剤・放射線・レジメン・患者状態・外部の判断支援)を 1 つの型 `Advisory` と 1 つの表示部品に寄せ、
「確認を要する」警告を無視して登録するときは理由(マスタ)を必須にして来歴 `Provenance` と backend の台帳に残す。
管理画面「警告の集計と設定」で種別 × 月の発火数・無視率・主な理由を見て、種別ごとの重さを施設が下げられる(「表示のみ」「出さない」)。

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
| `regimen-conflict` | レジメンの重なり | レジメン | warning(同じレジメンが進行中)/ info(他のレジメン) | `applicationConflictAdvisories` |
| `regimen-date` | 開始日 | レジメン | info | `startDateAdvisories` |
| `regimen-availability` | 候補外のレジメン | レジメン | info | 下書き・廃止・有効期間外、適用後のマスタ変更 |
| `cds-critical` / `cds-warning` / `cds-info` | 判断支援(重要 / 注意 / 情報) | 外部 | warning / info / info | `cdsCardAdvisories` |

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
- 入口の `context`(台帳の列): `prescription` / `injection` / `rad-order` / `radiotherapy` / `physio` / `endoscopy` / `meal-order` / `regimen-apply` / `regimen-cycle`。
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
  セッションの unmount でも消す。
- **［事実］** 上流(fhir-server)は独自 system の `activity` と `reason` を受理した(2026-10-19 に処方で確認)。
- `summarizeOrderProvenance` はこの来歴を登録・編集の要約から外し、`advisoryOverridesOf` で別に返す。オーダー詳細(`EnteredByRow`)に
  「警告の確認」行(誰が・いつ・どの警告をどの理由で)。
- 来歴を書けない登録(`enterer` が無い administrator ログイン、Provenance を付けない Bundle)でも台帳には残る。

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

`{from, to, rows: [{kind, month, fired, overridden, reasons: {code: n}}]}`。月は日本時間で切る
(`occurred_at` は timestamp without time zone なので `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo'`)。既定は今月から 6 か月、
24 か月を超える期間と `from > to` は 400。管理 API(`Admin::BaseController`)。

### 3.4 施設設定 `advisory_severity`

`FacilitySettings::SETTINGS` に 1 項目(`{種別 => "default" | "info" | "off"}`、キーは `[a-z-]`)。migration 不要。
画面の `applySeverityOverrides` が下げる・消すだけを行い、backend は上げる値(`block`)を受け付けない。

### 3.5 パス

新しいトップレベルパスは足さない(vite / render の rewrite を増やさない): `/master/advisory_override_reasons`・`/master/advisory_events`・`/admin/advisory_stats`。

## 4. 画面

- **警告の集計と設定**(`/advisory-review`、管理メニュー、`AdminGate`): 期間(月 × 2、既定は直近 6 か月)、行 = レジストリの種別(グループでまとめる)、
  列 = 月ごとの「発火 / 無視(率)」、「主な理由」(上位 3 件、マスタの名称)、行末の select「既定 / 表示のみ / 出さない」(施設設定に即時保存。
  既定が表示のみの種別は「表示のみ」を選べない。`block` 種別は変えられない)。
- **警告の確認理由マスタ**(`/advisory-override-reasons`、マスタメンテ > 警告): `SimpleMasterPage`(放射線治療の 4 マスタと共用)。

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

## 7. 残課題

1. `block` 種別(死亡患者へのオーダー、外泊中・退院済の入院オーダー、伝票の締切超過。バックログ §2.3)。
2. 患者帯の patient-view のカードの無視は feedback だけで台帳に残らない(登録の場面ではない)。
3. 「既知のアレルギー無し」(NKDA、バックログ §5.3 #4)を `allergy` の器に乗せる(未確認のまま処方したときの表示のみ)。
4. `order_reference` の埋め戻し(登録の応答からオーダー id を取って台帳を更新する)。
5. 無視率の推移をダッシュボードのタイルに出す。
6. 注射・部門オーダーへの CDS(order-select / order-sign)の展開(`cds-hooks-design.md` §7)。

## 8. 主なファイル

| 場所 | ファイル | 役割 |
|---|---|---|
| frontend | `fhir/advisoryHelpers.ts` | 型・レジストリ・重さの調整 |
| frontend | `hooks/useAdvisorySession.ts`、`lib/advisoryOverrideStage.ts`、`api/advisoryClient.ts` | セッション・受け渡し・台帳の送信 |
| frontend | `components/AdvisoryNotice.tsx`、`components/AdvisoryConfirmModal.tsx` | 表示・登録前の確認 |
| frontend | `fhir/provenanceHelpers.ts`(`buildAdvisoryOverrideProvenanceEntry`、`advisoryOverridesOf`)、`api/queries/provenance.ts` | 来歴 |
| frontend | `fhir/medicationSafetyHelpers.ts`、`radSafetyHelpers.ts`、`regimenCheckHelpers.ts`、`regimenOrderHelpers.ts`、`pregnancyHelpers.ts`、`infectionHelpers.ts`、`cdsCardHelpers.ts` | アダプタ |
| frontend | `hooks/usePatientStateAdvisories.ts`、`hooks/useRadSafetyAdvisories.ts`、`components/RadiotherapyPreCheck.tsx`、`components/MealAllergyNotice.tsx` | 患者の記録から警告を組む hook |
| frontend | `pages/AdvisoryReviewPage.tsx`、`pages/AdvisoryMasterPages.tsx` | 管理画面・マスタ画面 |
| backend | `app/models/master/advisory_override_reason.rb`、`app/models/advisory_event.rb`、`app/models/facility_settings.rb` | マスタ・台帳・施設設定 |
| backend | `app/controllers/master/advisory_{override_reasons,events}_controller.rb`、`app/controllers/admin/advisory_stats_controller.rb` | API |
