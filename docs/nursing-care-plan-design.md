# 看護計画・看護サマリ・看護サマリ承認 設計

functional.xlsx の「看護計画」(3615〜3622)「看護サマリ」(3772〜3783)「看護サマリ承認」(3784〜3786)の第 1 段階。
看護プロファイル・看護仮診断・帳票印刷(PDF)・経過表タイトル連携・助産記録連携・承認権限(師長など)・NNN の配布データ取込は第 2 段階。

## 1. FHIR の持ち方

```
Condition(看護問題)  ← addresses ── CarePlan(看護計画: OP/TP/EP の行)── goal → Goal(目標)
     ↑ reasonReference                ↑ 拡張 nursing-care-plan-activity(plan + 行の id)
ServiceRequest(計画の行から展開した看護指示)
Observation(評価)── focus → Goal / Condition、basedOn → CarePlan
Composition(看護サマリ)── section.entry → Condition(病名)/ CarePlan(看護問題)
```

### 1.1 看護問題 = Condition

- category: `condition-category|problem-list-item`(標準)と `http://fhir-client.local/CodeSystem/condition-category|nursing-problem`。
  既往歴と同じく 2 つ並べる。`problem-list-item` を持つのでレセコン送信(`category:not=problem-list-item,past-history`)から外れる。
- code: マスタから選んだら `http://fhir-client.local/CodeSystem/nursing-diagnosis|{コード}` と text、自由記載は text だけ。
- 因子: `evidence[].code`。体系で種類を分ける(`nursing-defining-characteristic` / `nursing-related-factor` / `nursing-risk-factor`)。
- 優先度: ローカル拡張 `nursing-problem-priority`(valuePositiveInt)。継続中の問題を 1 から振る。
- clinicalStatus active / resolved、onsetDateTime = 立案日、abatementDateTime = 解決日、encounter = 入院、recorder = 立案者。
- 取消は verificationStatus = entered-in-error。
- 病名の検索には `category:not=…|nursing-problem` を付け、上流が条件を黙殺したときに備えて `splitConditions` でも落とす。

採らなかった案: 看護問題を CarePlan だけで持つ。看護指示の対象(`reasonReference`)も Goal.addresses も Condition を指すため、
問題の実体が無いと指示・目標と結べない。

### 1.2 看護計画 = CarePlan(看護問題 1 件に 1 本)

- category `http://fhir-client.local/CodeSystem/care-plan-type|nursing`(クリニカルパスと同じ体系)。
- intent plan、status active / completed(解決)/ entered-in-error(取消)、title = 問題名、period.start = 立案日。
- addresses = 看護問題、goal = 目標、instantiatesUri = `http://fhir-client.local/master/nursing-standard-plans/{コード}`。
- OP/TP/EP の行: `activity[]`。`activity.id` が行のキー、拡張 `nursing-plan-activity-type`(op / tp / ep)、
  `detail.code` に MEDIS 看護行為(16 桁と管理番号)・看護観察の coding と text、`detail.description` に文言、
  `detail.status` in-progress / stopped。看護介入マスタとの紐付けは拡張 `nursing-intervention`(valueCoding)。

採らなかった案: `activity.reference` で展開した指示を指す。R4 の cpl-3 で reference と detail は同時に持てず、
指示を出すたびに CarePlan を書き換えることにもなる。

### 1.3 看護指示との結び付き

指示(ServiceRequest)の側から片方向に結ぶ。`reasonReference` = 看護問題(既存の看護指示の対象と同じ)、
複合拡張 `nursing-care-plan-activity`(`plan` = CarePlan、`activity` = 行の id)。計画の読み込みでは
`ServiceRequest?category=order-type|nursing&reason-reference=Condition/a,b` の 1 回で引き、拡張で行に振り分ける。

採らなかった案: `basedOn` に CarePlan。`basedOn` を持つ ServiceRequest はオーダーのヘッダと見なされなくなり
(`provenanceHelpers.ts` の isHeaderEntry)、来歴が付かない。

看護計画から出す指示は看護師本人が依頼者で、出した時点で指示受け済み(Task accepted、owner = 本人)。入力者と依頼者が
同じなので代行入力の承認には乗らない。

### 1.4 目標 = Goal、評価 = Observation

- Goal: description(看護成果マスタの coding は任意)、category は計画と同じ、addresses = 看護問題、
  target.dueDate = 評価予定日、achievementStatus(HL7 goal-achievement)、lifecycleStatus、statusDate = 最終評価日。
  編集で外した目標は削除せず cancelled にし、計画の goal からも外す。
- 評価はクリニカルパスの評価と同じく「1 回の評価 = Observation」。
  - 目標ごと: code `http://fhir-client.local/CodeSystem/nursing-evaluation|goal`、focus = Goal、value = 達成度、note = 内容。
  - 問題単位: code `…|problem`、focus = Condition、value = 判定(`nursing-evaluation-decision` の continue / revise / resolve)。
  - どちらも basedOn = CarePlan、拡張 `observation-problem` = 看護問題、category は計画と同じ。
- 「解決」は同じ transaction で Condition を resolved、CarePlan を completed、継続中の Goal を completed、
  展開した看護指示に終了日(評価日)を書く。

### 1.5 看護サマリ = Composition

- type: `http://fhir-client.local/CodeSystem/document-type|nursing-summary`。種別に合う LOINC を確認できていないのでローカルだけ。
- category: `http://fhir-client.local/CodeSystem/nursing-summary-kind|interim / transfer / discharge`。
- encounter = 入院、event.period = 対象期間、拡張 `order-ward` = 作成時の病棟(退院済みなら最後の病棟)。
- セクション: 基本情報・看護経過・現在の状態・継続看護・病名・看護問題はローカルの `nursing-summary-section`、既往歴は LOINC 11348-0。
  病名を LOINC 11450-4 にすると診療記録の「対象プロブレム」と同じコードになり、カードがサマリを 1 つのプロブレムの記録として扱うため避けた。
- 状態:

| 状態 | status | attester | 補助 |
|---|---|---|---|
| 作成中 | preliminary | なし | – |
| 承認待ち | final(確定し直しは amended) | legal = 確定した人 | – |
| 承認済 | final / amended | legal + official = 承認者 | – |
| 差戻し | preliminary(署名を外す) | なし | 未対応の通知 Task `nursing-summary-returned`(宛先 = 作成者、input に理由) |
| 修正承認 | amended | legal を残し official を足す | 版履歴に残る |

- 承認依頼の Task は作らない。承認者を個人に決められず(師長の職種コードが無い)、病棟の一覧で承認する。
- 承認できるのは看護職で、作成者でも確定した人でもない人。
- 却下は Composition の PUT と差戻しの Task を 1 transaction で書く。確定し直すと同じ transaction で Task を completed にする。

### 1.6 看護記録

「看護職が書いた経過記録(LOINC 11506-3)」。Composition には職種が残らず、上流の連鎖検索も作成者の職種では引けないので、
保存時にログイン中の医療従事者の職種(PractitionerRole の nurse / public-health-nurse / midwife)を見て
`category` に `http://fhir-client.local/CodeSystem/clinical-note-category|nursing` を付ける。編集では保存済みの印を引き継ぐ。
この印より前の記録には付かない。

### 1.7 立案の入口

看護診断(NANDA-I など)の上に標準看護計画を載せる運用、看護診断を使わず施設の標準看護計画(OP/TP/EP)だけで立案する運用、
NNN(NANDA-I・NOC・NIC)で書く運用のどれがどれだけあるかは確かめていない。特定の施設を前提にしないので、入口(ボタン)を分けて
どれにも対応する。書式は入口で決まり、施設設定は持たない。

- 標準看護計画: 計画を選ぶ。計画に看護診断があればそれを看護問題(code に診断の coding)、無ければ計画名を看護問題名(text だけ)にする。
  行は OP/TP/EP(拡張 `nursing-plan-activity-type`)。
- 看護診断: 診断を選び、目標に看護成果(Goal.description の coding)、計画に看護介入を選ぶ。介入の行は OP/TP/EP の区分を持たず、
  拡張 `nursing-intervention`(code と display)で介入の下にまとめる。介入を足すとマスタの行動が行になる。
  その診断に結びついた標準看護計画を反映すると OP/TP/EP の行が加わる(1 つの計画に両方の行が混ざってよい)。
- 選択はモーダルで「領域 → 類 → 用語」を列でたどる。列ごとに 1 階層ぶんだけ引き(`/master/nursing_terms?level=&parent_code=`)、
  標準看護計画は類の用語のコードで引く(`diagnosis_code=a,b`)。看護診断に結びつかない計画は `diagnosis_code=none` で引いて
  「看護診断なし」の列にまとめる。名称検索は階層をまたぐ。
- 入口は CarePlan の拡張 `nursing-care-plan-entry`(valueCode standard_plan / diagnosis)に保存し、編集の画面と看護計画タブの
  区画をこれで決める。拡張の無い計画は中身で決める(看護介入の行があれば看護診断、OP/TP/EP の行か標準看護計画があれば標準看護計画)。

## 2. 上流

- `Composition.ward`(ローカル): 病棟単位の承認一覧。
- `CarePlan.condition`(R4 標準)と `_include=CarePlan:condition`: 計画・目標・問題を 1 回で読む。

## 3. マスタ

NANDA-I・NIC・NOC はライセンス物(医学書院・エルゼビアが契約病院に Excel で提供。列構成は非公開)なので同梱しない。
論理構造(領域 → 類 → 用語、用語のコード・名称・定義と付随項目)に合わせて持ち、取込は実物を入手してから作る。

- `master_nursing_terms`: taxonomy(diagnosis / outcome / intervention)× level(domain / class / term)。parent_code で辿る。
  用語は definition・guidance(看護診断)・diagnosis_type(問題焦点型・リスク型・ヘルスプロモーション型)と
  items(jsonb: 診断指標・関連因子・危険因子 / 指標 / 行動)を持つ。source は local / licensed。
- `master_nursing_standard_plans`: 看護診断 1 件に goals(文言と看護成果)と activities(op / tp / ep、文言、看護介入、
  MEDIS 看護行為・看護観察のコードと名称)を jsonb で持つ。
- seed は自作の用語(コードは `L` 始まり)と標準看護計画 3 件。MEDIS のコードは取込済みのときだけ紐付ける。
