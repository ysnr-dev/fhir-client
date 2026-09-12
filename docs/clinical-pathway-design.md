# クリニカルパスの設計

**状態: 第 1 段階(施設パス定義マスタの登録画面)実装済(2026-09-12)。患者への適用・日次評価(第 2 段階)、ePath 形式の出力(第 3 段階)は未実装(§8)。**
本文中の区別は他の設計書と同じ(［事実］/［導出］/［決定］/［提案］)。

基本仕様は JAMI・JSCP 合同委員会の ePath(ePath R4 実装ガイド v1.0.1、https://e-path.jp/fhir/ePath/260219/)の概念に準ずる。
本書の §2 に IG から読み取った概念モデルの要約を置き、§3 以降で本システムでの持ち方を決める。

---

## 1. クリニカルパスとは何か = レジメン・オーダーセットとの違い

| | オーダーセット | レジメンマスタ | クリニカルパス定義 |
|---|---|---|---|
| 何を表すか | 医師が育てる「いつも出す組み合わせ」 | 化学療法の治療計画の雛形 | 疾患・術式ごとの入院診療の標準計画(病日 × アウトカム・観察項目・タスク) |
| 保存先 | backend DB(jsonb のフォーム値) | backend DB(正規化テーブル) | backend DB(正規化テーブル + タスクのオーダー雛形は jsonb) |
| 持ち主 | 院内共通 / 診療科 / 医師 | 院内共通(承認制) | 院内共通(承認制) |
| 時間軸 | 無い(適用日だけ) | 相対日(Day 1, 8, 15) | **病日**(入院日 = 1、入院前日 = -1) |
| 評価 | 無い | 投与前チェック | **アウトカムの達成 / 未達成(バリアンス)**(第 2 段階) |

- ［事実］ePath は「パス = 病日・イベントの並び」「病日 = OAT ユニットの束」「OAT ユニット = 1 つのアウトカム(O)と、それを判定する
  観察項目(A)と、実施するタスク(T)」という 3 階層で定義される。適用後は病日ごとにアウトカムの達成・未達成(= バリアンス)を評価する。
- ［決定］定義はレジメンと同じ**承認制の施設共通マスタ**として backend に持つ。承認済は内容を凍結し、直すときは複製する(レジメン §8.17 と同じ)。
- ［決定］タスクには任意で**オーダーの雛形**(オーダーセットのエントリと同じ形)を持たせる。第 2 段階の適用で
  入院日 + (病日 − 1) の日付に展開して一括登録するため。雛形を持たないタスクはチェックリスト項目。
- ［決定］適用後のデータ(第 2 段階)は上流 FHIR に ePath 準拠の CarePlan / Goal / Observation / Procedure で置く方針。
  そのため定義側の識別子(OAT ユニット・観察項目・タスクの uuid、病日キー)を適用後まで持ち越せる構造にする(§3)。

### 1.1 命名

- **パス / パス定義**(`pathway`)… 本ドキュメントの主題。ePath の「施設パス」。画面表記はメニュー「クリニカルパス > パス定義」。
- **病日**(`event`、`elapsed_days`)… ePath の「病日・イベント」。入院日を 1、入院前日を -1 とし 0 は使わない。
- **OAT ユニット**(`oat_unit`)… アウトカム名を見出しに、観察項目とタスクを束ねる最小単位。
- **観察項目**(`assessment`)… アウトカムを判定するための観察・アセスメント。適正値(評価基準)を持つ。
- **タスク**(`task`)… その病日に行う処方・検査・処置・ケア・説明など。ePath のタスク分類(大 / 中)を持つ。
- **オーダー雛形**(`order_template`)… タスクに付ける `order_type` + フォーム値(`order_values`)。オーダーセットのエントリと同じ。
- **BOM**(Basic Outcome Master®)… 日本クリニカルパス学会のアウトカム・観察項目の標準マスタ。学会の知財で IG には一部しか載っていない。

---

## 2. ePath の概念モデル(IG から抽出)

### 2.1 三層のデータ

| 層 | 意味 | FHIR | Bundle |
|---|---|---|---|
| ひな型パス | 学会等が配布する疾患別ミニマム要件 | PlanDefinition(EP01)+ Event PlanDefinition | EP01 |
| 施設パス | ひな型を施設用に調整した、患者適用前の定義 | PlanDefinition(EP02)+ Event PlanDefinition + Questionnaire | EP02 |
| 適用後パスデータ | 患者に適用した後の実施・結果・評価 | CarePlan / Goal / Observation / Procedure | EP12(EP22 は患者入力フォーム回答) |

### 2.2 施設パス定義(PlanDefinition EP02)

```text
PlanDefinition EP02(施設パス)
  identifier: facility-path-id(施設パスコード), url: .../PlanDefinition/EP02.{施設コード}.{パスコード}
  title: 施設パス名称, version X.Y, status draft|active|retired
  ext: AdaptiveCriteriaText(1..1 適応基準), ScheduledDays(パス予定日数), ClinicalDepartment(0..*), ProtocolBase(元ひな型)
  goal.addresses: 対象病名(MEDIS 病名管理番号 / ICD10-2013-full)
  action[]: 病日・イベント  id = "病日[-パスステップ]"  title = 入院日 など  definitionCanonical → Event PlanDefinition
      └ PlanDefinition Event(EVT.{施設コード}.{パスコード}.{病日})
          ext: EventElapsedDays(入院日 = 1), PathStep / PathStepName, InpatientOutpatientType(I/O),
               AllowableElapsedDaysCondition{Type(1 前回イベント / 2 適用開始日 / 3 指定日付), Days, RangeLow, RangeHigh}
          action[] = OAT ユニット(id = OAT ユニット識別子)
              title = アウトカム名
              code: BOM 大分類(G 患者目標 / H 患者状態)・中分類・BOM アウトカムコード(O00470 …)or ローカル分類 / コード
              ext: OATUnitIdentifier, CriticalIndicator(Y/N 重要アウトカム), UnplannedKind
              action[] = 観察項目(id)
                  code: BOM 観察項目分類(19 バイタルサイン / 34 呼吸 / 37 出血 …)・BOM 観察項目コード(10 桁)or ローカル / 空コード ZZZZZZZZZZ(タスクのみ)
                  ext: ProperValue(適正値 = 評価基準)
                  relatedAction[] = タスク
                      ext TaskExtensions: Category(タスク分類 Lv1 / Lv2), Code(施設ローカルのタスクコード・名称)
```

- タスク分類 Lv1: TP 治療 / EX 検査 / ML 食事 / NO 観察項目 / NC ケア項目 / EG 教育・指導・説明 / AL 活動・安静度 / MD 医療文書
- タスク分類 Lv2: TPPR 処方 TPIN 注射 TPRE レジメン TPTR 処置 TPOP 手術 TPBT 輸血 TPRH リハビリ TPDI 透析 TPRT 放射線治療 TPCI 条件付き指示 /
  EXSP 検体 EXMB 細菌 EXPH 生理 EXEN 内視鏡 EXIM 画像 EXPA 病理 / MLBR 朝 MLLU 昼 MLSU 夕 / NC01〜NC17 ケア / EGNC 栄養指導 EGCS 指導 EGIC IC EGEP 看護 E プラン
- 「タスクのみ」の OAT ユニットも、空の観察項目(コード ZZZZZZZZZZ)で包む。
- BOM コードは学会の知財で IG には一部しか同梱されない。ローカルコード体系が正式に許容されている。

### 2.3 適用後パスデータ(EP12)の 5 階層(第 2 段階の対象)

| Lv | リソース | identifier | 内容 |
|---|---|---|---|
| 1 パス適用 | CarePlan EPathApply + Goal | apply-id | title, period, status active / completed / revoked, instantiatesCanonical → EP02, encounter, ext 適応基準確認区分・予定日数。Goal: パス終了区分(1 終了 / 2 中止)と中止理由、総合評価 |
| 2 病日 | CarePlan Event + Goal | event-id = 適用 ID.病日[-ステップ] | title, status, ext EventElapsedDays ほか。Goal: 病日の総合評価(自由文 / SOAP) |
| 3 OAT ユニット | CarePlan OATUnit + Goal Outcome | oat-unit-id = ….OAT 識別子[-リピート番号] | category = アウトカム分類 / コード、ext CriticalIndicator / UnplannedKind / RepeatNo。Goal: achievementStatus 1 達成 / 2 未達成(バリアンス) / 3 未評価、評価 Observation(判定・S/O/A/P) |
| 4 観察項目 | CarePlan Assessment + Goal | assessment-id | category = 観察項目分類 / コード、title、activity → Procedure Task。Goal: 達成状態、実施 Observation(測定値・日時・実施者) |
| 5 タスク | Procedure Task | task-id | category(タスク分類)、code(ローカルタスクコード + text)、status preparation(未実施)/ completed(実施)、performedDateTime、performer、ext PlannedDateTime |
| 付随 | Encounter Admission, Condition, Procedure MajorEvent(手術 / 入院 / 退院と病日) | | |

- ［事実］タスクは FHIR の Task ではなく **Procedure** で表す(ePath のタスクは複数ステップを含みうるため)。
- ［事実］バリアンス = アウトカム未達成(achievementStatus = 2)。理由・対応は評価 Observation の S/O/A/P と statusReason に書く。
- ［事実］予定外 OAT ユニット(UnplannedKind = Y)と繰り返し(RepeatNo)で、パス外の出来事やアウトカムの再評価を表す。

---

## 3. 保存の構造

すべて外部キーなし、`pathway_code` で結ぶ(レジメンと同じ)。子は 1 リクエストで丸ごと置換する。

```text
master_pathways                 … 本体(= ePath 施設パス PlanDefinition EP02)
  pathway_code   unique(空なら 6 桁数字で自動採番。サンプルは 9000xx)
  name / short_name / name_kana / version
  department_code / department_name   診療科(非正規化)
  setting        inpatient | outpatient    入外(第 1 段階の UI は入院を既定。Event の I/O に写す)
  scheduled_days パス予定日数
  adaptive_criteria  適応基準(承認時必須)
  protocol_base  元ひな型パスの URL(任意)
  status         draft | approved | retired、approved_on、approved_by、copied_from_code
  valid_from / valid_to / display_order / note / search_*
master_pathway_indications      … 対象病名(= goal.addresses)。病名管理番号 + 表示用の名称・ICD10
master_pathway_events           … 病日・イベント(= action + Event PlanDefinition)
  elapsed_days   病日(入院日 = 1、入院前日 = -1、0 は不可)。(pathway_code, elapsed_days, path_step) で一意
  path_step      パスステップ(既定 1。第 1 段階の UI には出さない)、path_step_name
  title          入院日 / 手術当日 / 退院日 …(空なら病日から導出して表示)
  allowable_condition_type / allowable_days / allowable_range_low / allowable_range_high   許容経過日数条件(列のみ)
master_pathway_oat_units        … OAT ユニット(event_id で結ぶ)
  unit_key       uuid。(pathway_code, unit_key) で一意
  name           アウトカム名
  category       G 患者目標 / H 患者状態
  code_system    bom | local、code   アウトカムコード
  critical       重要アウトカム
master_pathway_assessments      … 観察項目(unit_id で結ぶ)
  assessment_key uuid
  name / category_code / category_name / code_system / code / proper_value(適正値)
  nursing_observation_manage_no   MEDIS 看護観察の管理番号(任意)
master_pathway_tasks            … タスク(unit_id で結ぶ。assessment_id は任意)
  task_key       uuid
  name / category_lv1(必須)/ category_lv2(先頭 2 文字が lv1)/ code
  order_type / order_label / order_values jsonb / order_schema_version   オーダー雛形(order_type が NULL ならチェックリスト項目)
```

- ［決定］**uuid キーは画面が採り、置換で行を作り直しても変わらない**(`crypto.randomUUID()`)。適用後データ(CarePlan の identifier)
  がこの値を含むので、定義を直しても同じアウトカムを追える。複製(`copy`)でも uuid を写す(改訂の系列で同じアウトカムを同じ id で追う)。
  一意性の範囲はパス内(`(pathway_code, key)` の unique index)。画面の「この日を複製」は同じパス内で重なるので必ず採り直す。
- ［決定］**タスクは OAT ユニット直下**に置き、観察項目への結びは任意(`assessment_id`)。パスシートは「アウトカム → 観察項目 / タスク」を
  横に並べて書くもので、タスクを観察項目の下にぶら下げると書けない。結んでいないタスクは ePath 出力時に空の観察項目
  (ZZZZZZZZZZ)で包む。リクエストでは `assessment_key`(uuid)で受け、コントローラがユニット内で新しい id に引き直す。
- ［決定］コードは `code_system`(bom / local)+ `code` で持ち、名称は自由入力。BOM は一部しか同梱されないので、
  観察項目分類も自由入力(IG に載っている 19 / 34 / 37 を候補に出す)。BOM 中分類と UnplannedKind は第 1 段階では持たない。
- ［決定］子の置換はレジメンと同じ「来た種別だけ置換」(`indications` / `events`)。`events` を送ると病日 → OAT ユニット →
  観察項目 → タスクを丸ごと作り直す。`order_values` は `params.permit` を通さず jsonb のまま保存する(permit すると中身が落ちる)。
- ［決定］承認時の検証(`approval_invalid_messages`): 適応基準・予定日数・病日 ≥ 1・各病日に OAT ユニット ≥ 1・雛形付きタスクの値が空でない・
  予定日数 ≥ 最大病日。下書きは病日の重複と識別子の重複だけ弾く。対象病名は求めない(ePath でも 0..*)。
- ［決定］サンプルは CSV でなく **JSON 1 ファイル = 1 パス**(`db/seed_data/pathways/900001.json`、API の payload と同じ形)。
  4 階層と jsonb を CSV で表すのは無理がある。レジメンと同じく下書きで入れ、既存コードは上書きしない。

## 4. ePath への対応表

| 本システム | ePath(施設パス EP02 / Event) |
|---|---|
| `pathway_code` | PlanDefinition.identifier(facility-path-id)、url の末尾 |
| `name` / `version` | title / version |
| `status` draft / approved / retired | status draft / active / retired |
| `adaptive_criteria` | ext AdaptiveCriteriaText |
| `scheduled_days` | ext ScheduledDays |
| `department_code` / `department_name` | ext ClinicalDepartment |
| `protocol_base` | ext ProtocolBase |
| `indications`(管理番号 / ICD10) | goal.addresses(MEDIS master-disease-keyNumber / ICD10-2013-full) |
| `events.elapsed_days` / `path_step` | action.id = "病日[-ステップ]"、Event の ext EventElapsedDays / PathStep |
| `events.title` | action.title、Event の name |
| `setting` | Event の ext InpatientOutpatientType(I / O)に写す |
| `events.allowable_*` | Event の ext AllowableElapsedDaysCondition* |
| `oat_units.unit_key` / `name` | Event.action.id / title |
| `oat_units.category` / `code_system` / `code` | action.code(BOM 大分類 / BOM アウトカムコード or ローカル) |
| `oat_units.critical` | ext CriticalIndicator(Y / N) |
| `assessments.assessment_key` / `name` | action.action.id / title |
| `assessments.category_code` / `code` | action.action.code(BOM 観察分類 / BOM 観察項目コード or ローカル)。空 → ZZZZZZZZZZ |
| `assessments.proper_value` | ext ProperValue |
| `tasks.task_key` / `name` / `code` | relatedAction.actionId / ext TaskExtensions.Code |
| `tasks.category_lv1` / `category_lv2` | ext TaskExtensions.Category(TaskCategoryLv1CS / Lv2CS) |
| 観察項目に結ばないタスク | 空の観察項目(ZZZZZZZZZZ)を作って包む |
| `tasks.order_*` | ePath に無い(本システムの拡張。適用時にオーダーへ展開する材料) |
| `assessments.nursing_observation_manage_no` | ePath に無い(適用後の評価入力で MEDIS の表現タイプを借りる結び) |

## 5. オーダー雛形

- ［事実］オーダーセットのエントリ(`order_set_entries`)と同じ形: `order_type`(`OrderSetEntry::ORDER_TYPES`)+ `order_values`(フォーム値)+
  `order_schema_version`。保存前に `sanitizeValuesForSet` で患者への参照(プロブレム・明細 id・日付)を落とし、`summarizeOrderSetValues` の
  要約を `order_label` に持つ。
- ［決定］編集は **1 タスクずつモーダル**(`PathwayTaskTemplateModal`)で開く。オーダーセットの登録画面は既存フォームを縦に積むが、
  パスは病日 × タスクで数十件になり、常時マウントすると重く縦にも伸びすぎる。モーダルの中に `ORDER_SET_TYPES[type].renderForm`
  (set モード・患者なし)を出し、`useStackedOrderForms` の 1 キーで外から submit して値を受け取る。「この内容にする」で確定、
  閉じたら破棄。ページが `<form>` でないので、非ポータルの Modal でも入れ子の form は起きない。フォーム内の検索モーダル
  (医薬品・用法)は fixed の overlay なので、モーダルの上にそのまま重なる。
- 種別の既定はタスク分類(中)から決める(`DEFAULT_ORDER_TYPE_BY_LV2`: 処方 → prescription、注射 → injection、検体検査 → lab-order、
  画像診断 → rad-order、生理検査 → physio-order、処置 → treatment-order)。
- 雛形を持てる種別は `ORDER_SET_TYPES` の 6 種(処方・注射・検体検査・放射線検査・生理検査・処置)。食事・ケア・指導・安静度・
  手術・輸血・レジメンは第 1 段階ではチェックリスト項目。未対応の種別・新しい版の雛形は要約だけ出し、保存時にそのまま戻す。

## 6. 画面

- **一覧**(`pages/PathwayListPage.tsx`、`/pathways`): 名称・カナ / 診療科 / 入外 / 状態 / 有効期間内のみ で絞り込み、行クリックで編集へ。
  列はコード / 名称 / 診療科 / 入外 / 予定日数 / 病日(件数と最終病日)/ 版 / 状態 / 有効期間。メニューは「マスタメンテ > クリニカルパス > パス定義」。
- **編集**(`pages/PathwayEditorPage.tsx`、`/pathways/new`・`/pathways/:id`): 1 パス 1 ページ。本体と子をローカルの draft
  (`fhir/pathwayHelpers.ts` の `PathwayDraft`)に持ち、「保存」で 1 リクエスト。外側を `<form>` にしない(レジメンと同じ理由)。
  - 基本情報(コード・名称・略称・カナ・診療科・版・入外・予定日数・元ひな型)+ 適応基準・備考(textarea)
  - 対象病名(病名マスタの検索モーダル)
  - **病日カード**(`components/PathwayEventCard.tsx`)を病日順に並べる。病日の数値を変えて blur すると並び直る。ケバブに「この日を複製 / 削除」。
    「＋ 病日」は最大病日 + 1、「＋ 入院前日」は最小病日 − 1(0 は飛ばす)。
  - 病日の中に **OAT ユニットカード**: 見出し行 = アウトカム名 / 区分(G/H)/ 重要 / コード体系 + コード / ↑↓ / 削除。本体は
    観察項目の表(名称 / 分類 / コード / 適正値 / 看護観察の選択)とタスクの表(大分類 / 中分類 / 名称 / 結ぶ観察項目 / オーダー雛形)の 2 列。
    タスク行の「＋ オーダー」で雛形モーダル、雛形があれば種別ラベル + 要約 + 編集 / 外す。
  - **概要表**(`components/PathwayOverviewTable.tsx`、読み取り専用): 列 = 病日、行 = アウトカム(名前でまとめる)+ 大分類ごとのタスク。
    どの日に何が載るかを ● で示す。
  - 運用(状態 / 承認日・承認者 / 有効期間 / 表示順)は凍結中も動かせる。承認済・廃止では内容の fieldset を disabled にする。
  - 複製は保存済みの内容をサーバー側で写す(新しいコード・下書き・`copied_from_code`、uuid はそのまま)。削除は下書きだけ。
- **適用パネル**(`components/PathwayApplyPanel.tsx`、カルテ右ペインの「クリニカルパス」ボタン、`KartePaneState` の `pathway-apply`):
  承認済で有効期間内のパスを名前で探して選ぶ(レジメン適用と同じ picker)。
  - 適用先は入院中の Encounter か入院予定(`usePatientAdmission` / `usePatientPlannedAdmissions`)。既定は入院中、無ければ最初の
    入院予定で、入院日(病日 1)はその Encounter から入れる(予定で日付未定なら当日)。「指定しない」で日付だけの適用もできる。
  - 適応基準の文をそのまま出し、「適応基準を確認した」のチェックが無いと適用できない(ePath の適応基準確認区分 = 1 で記録)。
  - 対象病名は患者の継続中の病名から選ぶ。パスの対象病名(管理番号)と一致するものは既定でチェックし「対象病名」の印を付ける。
    `CarePlan.addresses` に入る。
  - 予定の要約(病日・OAT ユニット・タスクの数)と、病日 → 日付の表を出す(入院日を変えると追随)。
  - ［決定］**同じ入院に同じパスが進行中なら止める**(二重適用)。別のパスが進行中なら注意だけ出して通す(術後に別のパスへ
    移るなど、重なる運用はある)。
  - 登録は `useApplyPathway`(`api/queries.ts`)。来歴は適用の CarePlan を対象に 1 件(author = 依頼医師、enterer = ログイン本人)。
    オーダー雛形の展開(第 2 段階のタスク 5)はまだで、CarePlan の木と未実施の Procedure だけを登録する。

## 7. 適用の FHIR 構造(第 2 段階)

1 回の適用は **CarePlan の木**で表す。実装は `fhir/pathwayApplyHelpers.ts`。

```text
CarePlan(適用)                 partOf 無し = 木の根
  └ CarePlan(病日)             partOf = [適用]
      └ CarePlan(OAT ユニット)  partOf = [適用, 病日]
          └ CarePlan(観察項目)   partOf = [適用, 病日, OAT ユニット]
              └ Procedure(タスク) basedOn = [観察項目]
```

- ［決定］子孫は **partOf に祖先すべて**を並べる(ePath の identifier が祖先を連結するのと同じ考え方)。
  適用を指す 1 回の検索 `part-of=CarePlan/{適用の id}` で木全体が引け、根は `part-of:missing=true` で引ける。
- ［決定］参照は **Procedure → 観察項目の一方向だけ**書く。ePath は観察項目側にも `activity.outcomeReference` で
  タスクを持たせるが、同じ transaction の中で相互参照になる。読みは `_revinclude=Procedure:based-on` で足りるので、
  EP12 出力のときに `Procedure.basedOn` から組み立て直す(第 3 段階)。
- ［決定］**タスクは適用の時点で「未実施」(`status = preparation`)の Procedure として置く**。パスシートは「その日に
  何をする予定か」を出すものなので、予定が FHIR 側に無いと定義マスタを読み直さないとシートが描けない。
  実施したら `completed` にして `performedDateTime` を入れる。予定日は拡張 `EPathProcedureTaskPlannedDateTime`。
- ［決定］**Goal と評価 Observation は適用時には作らない**。アウトカムの達成・未達成は評価したときに生まれる記録で、
  計画の一部ではない(§8 の第 2 段階で実装)。
- ［決定］観察項目に結んでいないタスクは、ePath の規則どおり「観察項目なし」(コード `ZZZZZZZZZZ`)の観察項目 CarePlan で
  包む。識別子の観察項目部分にも `ZZZZZZZZZZ` を使う。
- ［決定］どの階層かを **category のローカルコード**で示す(`care-plan-type|clinical-pathway` と
  `pathway-level|apply|event|oat-unit|assessment`)。partOf の本数でも導けるが、木を全部読まないと分からない。
  階層コードがあれば「この患者のパス適用一覧」も「その日の OAT ユニット」も 1 回の検索で引ける。EP12 出力では落とす。

### 7.1 識別子(ePath)

`{保険医療機関番号}.{適用uuid}` を先頭に、階層ごとにピリオドで連ねる。

| 階層 | identifier.system | value |
|---|---|---|
| 適用 | `…/IdSystem/apply-id` | `{施設コード}.{適用uuid}` |
| 病日 | `…/IdSystem/event-id` | `….{病日[-パスステップ]}` |
| OAT ユニット | `…/IdSystem/oat-unit-id` | `….{unit_key}[-{リピート番号}]` |
| 観察項目 | `…/IdSystem/assessment-id` | `….{assessment_key}` |
| タスク | `…/IdSystem/task-id` | `….{task_key}` |

`unit_key` / `assessment_key` / `task_key` は定義マスタの uuid(§3)。定義を直しても同じアウトカムを追える。

### 7.2 病日 → 実日付

入院日を 1、入院前日を -1 とし 0 は使わないので、正の病日は `入院日 + (病日 − 1)`、負の病日は `入院日 + 病日`。
病日の CarePlan は `period.start = period.end = その日` にする(`date` 検索の包含で「その日」が引ける)。

### 7.3 規模

サンプルのパス(5 病日・OAT ユニット 14・観察項目 43・タスク 50)で **1 回の適用が 126 リソース**
(CarePlan 76 + Procedure 50)になる。観察項目に結ばないタスクを包む空の観察項目が 13 件増えるため、
CarePlan は定義の 1 + 5 + 14 + 43 = 63 ではなく 76。上流の transaction に件数の上限は無い。

---

## 8. 実装フェーズ

- **第 1 段階(実装済)**: 施設パス定義マスタ(backend・API・spec・seed・一覧・編集・雛形モーダル)。
- **第 2 段階(未実装)**: 患者への適用と日次評価。
  - 入院 Encounter に対してパスを適用し、上流に ePath 準拠の CarePlan(EPathApply / Event / OATUnit / Assessment)・Goal・Procedure Task を作る。
    識別子は `施設コード.適用uuid.病日[-ステップ].unit_key[.assessment_key][.task_key]`。
  - 適用時にオーダー雛形を 入院日 + (病日 − 1) で展開し、`ORDER_SET_TYPES[type].buildBundle` で通常のオーダーとして一括登録する
    (オーダーセットの適用パネルと同じ器)。パスの印はオーダーセットの `stampOrderSetInstance` と同型で焼く。
  - カルテに「パス」タブ(病日 × OAT ユニットのシート)を足し、病日ごとにアウトカムの達成 / 未達成(バリアンス)・観察項目の実績値・
    タスクの実施 / 未実施を記録する。看護観察に結んだ観察項目は `nursingObservationInputSpec` で入力欄を出す。
  - **適用の FHIR 構造(§7)と右ペインの適用パネル(§6)は実装済み(2026-09-12)**。残るのはオーダー雛形の展開、パスタブ、評価の記録。
  - **上流の CarePlan / Goal は実装済み(2026-09-12、別リポジトリ `fhir-server`)**。JP Core にプロファイルが
    無い型なので HL7 基本定義 + 手書きバリデータで、`Goal.achievementStatus` は preferred 束縛のまま値を縛らない
    (ePath の 1 達成 / 2 未達成(バリアンス) / 3 未評価 がそのまま通る)。計画の木は `partOf` に**祖先すべて**を
    並べる約束にしてあり、`part-of:missing=true` で適用(根)だけ、`part-of=CarePlan/{適用の id}` で木全体が引ける。
    `_include=CarePlan:goal` で目標、`_revinclude=Procedure:based-on` で実施記録が同じ応答で揃う。
    backend の `FhirProxyController::ALLOWED_RESOURCE_TYPES` にも追加済み(2026-09-12)。
- **第 3 段階(提案)**: ePath 形式の出力(EP02 Bundle = 定義、EP12 Bundle = 適用後データ)。§4 の対応表の逆変換(§7 が書かない `activity.outcomeReference` もここで組み立てる)。
  ひな型パス(EP01)の取込(`protocol_base` に URL を残す)。パスステップ・許容経過日数条件・BOM 中分類の UI。

## 9. 実装したもの

- backend: `db/migrate/20260912100000〜100500`(6 テーブル)、`app/models/master/pathway*.rb`(6 モデル)、
  `app/controllers/master/pathways_controller.rb`(index / show / create / update / copy / destroy)、`config/routes.rb`、
  `db/seed_data/pathways/900001.json`(腹腔鏡下胆嚢摘出術 4 泊 5 日、病日 5・OAT ユニット 14・観察項目 43・タスク 50)と `db/seeds.rb` の節、
  `spec/requests/master/pathways_spec.rb`(19 件)
- 第 2 段階(適用): `frontend/src/fhir/pathwayApplyHelpers.ts`(§7)、`components/PathwayApplyPanel.tsx`、
  `components/KarteRightPane.tsx`(`pathway-apply` と「クリニカルパス」ボタン)、`api/queries.ts`(`usePathwayApplications` /
  `usePatientPlannedAdmissions` / `useApplyPathway`)、`api/masterQueries.ts`(`useApplicablePathways`)、
  `fhir/provenanceHelpers.ts`(`buildPathwayApplyProvenanceEntry`)、`fhir/conditionHelpers.ts`(`conditionManagementNumber`)、`App.css`(`.pathway-apply__*`)、
  backend `app/controllers/fhir_proxy_controller.rb` の許可リストに CarePlan / Goal、
  上流(別リポジトリ `fhir-server`)に CarePlan / Goal リソース一式
- frontend: `api/masterClient.ts` / `api/masterQueries.ts`(クリニカルパス節)、`fhir/pathwayHelpers.ts`(選択肢・draft ⇔ API・検証・概要表)、
  `pages/PathwayListPage.tsx`、`pages/PathwayEditorPage.tsx`、`components/PathwayEventCard.tsx`(病日 + OAT ユニット)、
  `components/PathwayOverviewTable.tsx`、`components/PathwayTaskTemplateModal.tsx`、`App.tsx`(マスタメンテ > クリニカルパス > パス定義、`/pathways` 3 ルート)、
  `App.css`(`.pathway-*`)

### 9.1 検証したこと(2026-09-12、開発環境、児玉 義憲でログイン)

- `RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec spec/requests/master/pathways_spec.rb spec/requests/master/regimens_spec.rb`(コンテナ内)43 件成功、
  コンテナ内 `npx tsc -b` 成功。
- seed: 900001 が下書きで入り(病日 5・ユニット 14・観察項目 43・タスク 50)、一覧に「5 日分(〜5 日目)」と出て、編集画面で入れ子が復元される。
- 新規: 名称・予定日数 2・適応基準 → 「＋ 病日」→ 「＋ OAT ユニット」→ アウトカム「疼痛がコントロールできる」(重要)→ 観察項目「疼痛(NRS)」→
  タスク 治療 / 処方「術後鎮痛薬」(観察項目に結ぶ)→ 「＋ オーダー」→ 処方フォーム(種別は処方が既定)で医薬品検索モーダルから
  ロキソプロフェン錠 60mg、用法検索モーダルから 1 日 1 回朝食後、用量 3・3 日分・定期 → 「この内容にする」で行に「処方 ロキソプロフェン錠…」の
  要約 → 保存 → `/pathways/2`(コード 000001)。DB の `order_values` は sanitize 済(problem null)、`order_label` は薬剤名、`assessment_id` が結ばれている。
  リロードで全部復元。
- ケバブ「この日を複製」→ 病日 2 が別の uuid で増える。状態を承認済にして保存 → 承認日 2026-09-12 / 児玉 義憲、fieldset が disabled、
  凍結の注意が出る。「複製」→ `/pathways/3`(コード 000002、下書き、複製元 000001)。OAT ユニットの uuid が複製元と一致し、
  タスクの `assessment_id` は新しい観察項目を指す。検証データは片付けた(seed の 900001 だけ残る)。

### 9.2 検証したこと(適用の FHIR 構造、2026-09-12、テスト太郎)

画面がまだ無い段階なので、開発サーバーの Vite が配るモジュールをブラウザから直に読み込んで
`buildPathwayApplyBundle` を動かし、上流に流して確かめた。

- サンプルのパス 900001 を 2026-09-20 入院で組むと **126 entry**(適用 1 + 病日 5 + OAT ユニット 14 +
  観察項目 56 + タスク 50)。観察項目 56 は定義の 43 に、観察項目に結ばないタスクを包む空の観察項目 13 が足されたもの。
- `POST /fhir` で全 126 件が 201 Created。`urn:uuid` の参照(partOf / basedOn)は上流が解決する。
- 検索: `part-of:missing=true` + `category=clinical-pathway` で適用 1 件、`part-of=CarePlan/{適用}` で子孫 75 件、
  `category=oat-unit` で 14 件、`category=assessment` + `_revinclude=Procedure:based-on` で 106 件(観察項目 56 + タスク 50)。
- `parsePathwayApplication` に読み戻すと、病日 5 件が病日順に並び、各 OAT ユニットの重要フラグ・観察項目・タスクまで復元される。
- 検証データは 126 件すべて削除した(上流に残るのは削除済みの行だけ)。コンテナ内 `tsc -b` 成功。

### 9.3 検証したこと(適用パネル、2026-09-12、テスト太郎)

- seed の 900001 を承認済にした(開発環境ではこのパスだけが適用の候補)。
- カルテ右ペイン「クリニカルパス」→ 名前で検索して 900001 を選択 → 適用先に「入院中（2026-08-22 入院）」が既定で入り、入院日が
  2026-08-22 になる。適応基準の文、継続中の病名 5 件(対象病名に一致するものは無い)、病日 5 日分の日付表が出る。
- 未確認のまま「適用」→「適応基準を確認してください」。確認して「適用」→ ペインが閉じ、上流に適用 1 件 + 子孫 75 件、
  Provenance(CREATE、author = 児玉 義憲、enterer = 児玉 義憲)。もう一度同じパスを同じ入院に適用 →
  「このパスは同じ入院に適用済みです（2026-08-22 開始）」で止まる。
- この適用(テスト太郎、入院 2026-08-22、CarePlan 76 + Procedure 50)は次段階(パスタブ・評価)の検証データとして残してある。

## 10. 申し送り

- BOM(Basic Outcome Master®)は日本クリニカルパス学会の知財で同梱しない。IG に載っている分類(G/H、19/34/37)と例示コードだけを候補に出す。
  施設が BOM の利用許諾を持つなら、コード体系 BOM でコードを手入力できる。
- 病日単位の入外区分・パスステップ・許容経過日数条件は列だけ持ち、UI には出していない(ePath 出力時は `setting` を各病日に写す)。
- 観察項目の「コード」欄はコード体系を選ぶまで disabled だが、ブラウザ自動化(`form_input`)では値が入る。手入力では起きない。
- 雛形モーダルの中で種別を切り替えると空のフォームになる(前の種別の入力は残らない)。
- オーダー雛形の `order_values` はフォーム値そのものなので、医薬品マスタの行(価格・薬効分類など)が丸ごと入る(オーダーセットと同じ)。
  マスタ差し替え後はコードで引き直す(名前は自己修復するが廃止は分からない)。
- 概要表のタスクは(大分類, 名称)でまとめるので、同じ名前で中分類が違うタスクは 1 行になる。
- 削除の確認は `window.confirm`(他画面と同じ)。
