# クリニカルパスの設計

**状態: 第 1 段階(施設パス定義マスタ)・第 2 段階(患者への適用・パスシート・日次評価・終了中止・予定外)実装済(2026-09-13)。ePath 形式の入出力(第 3 段階)は未実装(§8)。不足機能の洗い出しは `docs/clinical-pathway-backlog.md`。**
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
  path_step      パスステップ(既定 1。同じ病日を術前・術後などに分けたときの順番。§3.1)、path_step_name
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
  一意性の範囲は親の中(OAT ユニットは病日、観察項目・タスクは OAT ユニット)。同じキーを別の病日に置いたものが「続き」(§3.1)。
- ［決定］**タスクは OAT ユニット直下**に置き、観察項目への結びは任意(`assessment_id`)。パスシートは「アウトカム → 観察項目 / タスク」を
  横に並べて書くもので、タスクを観察項目の下にぶら下げると書けない。結んでいないタスクは ePath 出力時に空の観察項目
  (ZZZZZZZZZZ)で包む。リクエストでは `assessment_key`(uuid)で受け、コントローラがユニット内で新しい id に引き直す。
- ［決定］コードは `code_system`(bom / local)+ `code` で持ち、名称は自由入力。BOM は一部しか同梱されないので、
  観察項目分類も自由入力(IG に載っている 19 / 34 / 37 を候補に出す)。BOM 中分類と UnplannedKind は第 1 段階では持たない。
- ［決定］子の置換はレジメンと同じ「来た種別だけ置換」(`indications` / `events`)。`events` を送ると病日 → OAT ユニット →
  観察項目 → タスクを丸ごと作り直す。`order_values` は `params.permit` を通さず jsonb のまま保存する(permit すると中身が落ちる)。
- ［決定］承認時の検証(`approval_invalid_messages`): 適応基準・予定日数・病日 ≥ 1・各病日に OAT ユニット ≥ 1・雛形付きタスクの値が空でない・
  予定日数 ≥ 最大病日。下書きは病日(+ ステップ)の重複と、同じ親の中での識別子の重複(モデルの検証)だけ弾く。
  対象病名は求めない(ePath でも 0..*)。一覧・適用の選択肢の「N 日分」はステップを数えず病日で数える。
- ［決定］サンプルは CSV でなく **JSON 1 ファイル = 1 パス**(`db/seed_data/pathways/900001.json`、API の payload と同じ形)。
  4 階層と jsonb を CSV で表すのは無理がある。レジメンと同じく下書きで入れ、既存コードは上書きしない。

### 3.1 日をまたぐアウトカム・継続するタスク・同じ病日の分割

2026-09-13 に追加(`docs/clinical-pathway-backlog.md` §C)。

- ［事実］実運用の術後パスでは「疼痛が自制内である」「創部感染の徴候がない」のようなアウトカムを術後 1 日目から退院まで
  毎日評価し、紙のシートでは 1 行に書く。弾性ストッキング・離床介助のような看護指示や、食事・安静度も数日続く。
  手術当日は術前と術後に分けて書くのが標準。
- ［事実］ePath はユニットが複数日を跨ぐ概念を持たず、**病日ごとに同じアウトカムの OAT ユニットを置く**。手術当日の分割は
  パスステップ(`action.id = 病日-ステップ`、PathStep / PathStepName)で表す。
- ［決定］**続き = 同じ識別子を別の病日に置いたもの**。行は病日ごとに持ったまま(日によって適正値や置くタスクが変わるため)、
  `unit_key` / `assessment_key` / `task_key` を共有する。一意制約はパス内から親の中へ緩めた
  (migration `20260913100000`。`(event_id, unit_key)`、`(unit_id, assessment_key)`、`(unit_id, task_key)`)。
  適用後の識別子は病日の識別子の下に入るので重ならない(§7.1)。開始・終了の病日を持たせて展開する形は、日ごとの違いを
  表せないので採らなかった。
- ［決定］**続き全体で揃える項目**(`propagateSeries`): アウトカムの名前・区分・コード・重要、観察項目の名前・分類・コード・看護観察、
  タスクの名前・分類・コード・オーダー雛形。病日カードで直すと続きの他の日にも写る。**病日ごとに持てる項目**: 観察項目の適正値と
  備考、観察項目・タスクを置くかどうか。
- ［決定］**「この日を複製」は識別子を保つ**(複製した日は元の日の続きになる)。別のアウトカムにしたいときは新しく足す。
- ［決定］**同じ病日の分割**はケバブの「この日を分割」で、その病日の最後のステップの次に空のステップを足す(見出しは同じ、
  ステップ名で見分ける)。分けた病日のカードにだけ「ステップ名」の欄が出る。
- 概要表とパスシートは**行を識別子でまとめる**(名前が同じでも識別子が違えば別の行)。
- ［決定］続きの仕組みより前に作った定義や、病日ごとに手で同じアウトカムを入れた定義のために、概要表の見出しに
  **「同じ名前を続きにまとめる」**を出す(まとめられるものがあるときだけ。`linkSameNameSeries`)。アウトカムは名前が同じなら
  最初に現れた病日の識別子に揃え、観察項目はその続きの中で名前が同じもの、タスクは続きの中で大分類・名前・オーダー雛形が
  同じものを揃える(雛形が違うタスクは出るオーダーが変わるのでまとめない)。同じ病日に同じ名前が 2 つあれば後のものは残す。
  揃えた続きの名前・コード・重要などは最初に現れた病日の値になり、適正値は日ごとの値を保つ。保存するまでは draft だけの変更。
- 継続するタスクのオーダーのまとめ方は §5.1。

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
- 種別の既定はタスク分類から決める(`defaultOrderTypeOfTask`: 中分類 `DEFAULT_ORDER_TYPE_BY_LV2` = 処方 → prescription、
  注射 → injection、処置 → treatment-order、手術 → surgery-order、輸血 → transfusion-order、リハビリ → rehab-order、検体検査 → lab-order、
  細菌検査 → micro-order、生理検査 → physio-order、内視鏡検査 → endoscopy-order、画像診断 → rad-order、病理診断 → patho-order、
  朝/昼/夕 → meal-order、栄養指導 → nutrition-guidance-order、ケア項目(NC01〜)→ nursing-order。中分類が無ければ大分類で
  ケア項目 → 看護指示、食事 → 食事オーダー、それ以外は処方)。
- 雛形を持てる種別は `ORDER_SET_TYPES` の全 16 種(病名を除く。2026-09-12 に看護指示・食事・手術・輸血・リハビリ・栄養指導・
  他科依頼・細菌・病理・内視鏡を追加。`docs/order-set-design.md` §7 Phase 2)。透析・放射線治療・レジメン・指導・IC・安静度・
  医療文書はチェックリスト項目。このクライアントより新しい版の雛形は要約だけ出し、保存時にそのまま戻す。
- 看護指示・食事の雛形は入院 Encounter をオーダーに焼く(適用先に選んだ入院(予定)の id を `BuildBundleArgs.encounterId` で渡す)。
  食事は前の食事の終了・再開を扱わない、手術は手術室の重なり検査を通らない(同 §7 Phase 2 の決め事)。

### 5.1 適用時の展開(第 2 段階)

- 適用パネルの「オーダー」区画に、出すオーダーを病日順に積む(オーダーセットの適用と同じ器: 既存のオーダー登録
  フォームを `mode: "order"` で出し、`useStackedOrderForms` で外から submit する)。行の見出しは 種別 / 病日(続きなら範囲)と
  開始日〜終了日 / タスク名 / 雛形の要約。既定は閉じていて、除外はチェックを外す。
- ［決定］**続く病日のタスクをまとめるか**は種別で決める(`pathwayOrderPlan` / `orderContinuityOf`)。同じ `task_key` が並べた病日で
  隣り合って置かれていれば(ステップも 1 つの病日として数える)、継続する種別は 1 件のオーダーにし、先頭の病日の雛形で出す。
  | 区分 | 種別 | 終了日 |
  |---|---|---|
  | 病日ごと | 看護指示・食事以外(注射・検査・処方 など) | 各種別の入力どおり |
  | run | 看護指示(大分類が活動・安静度以外) | 続きの最終日 |
  | activity | 看護指示のうち大分類が活動・安静度 | 次の安静度の前日。次が同じ日の途中のステップから始まるならその日。次が無ければ決めない |
  | meal | 食事 | 次の食事の 1 つ前の食事(`previousMealPoint`)。次が無ければ決めない |
- ［決定］終了は**入力した開始**(食事は開始の区切りまで)から、適用ボタンを押した時点で決める(`pathwayOrderEnd`)。除外した
  オーダーは「次」に数えない。フォームで終了日を入れてあればそちらを優先し、空のときだけ入れる(`withPathwayOrderEnd`)。
  見出しの終了日は、病日の日付と雛形の開始の区切りから出した見込み。
- まとめたオーダーのヘッダは、受け持つ病日すべてのタスクの Procedure が `basedOn` で指す(キーは `病日[-ステップ]/task_key`、
  `pathwayTaskOrderKey`)。
- 開始日は **入院日 + (病日 − 1)** を `bulkStartDate` で入れる(`pathwayEventDate`)。入院日を変えると追随する。予約必須の
  項目は動かない(オーダーセットと同じ)。入外区分の初期値はパスの `setting`(DO と同じ正規化 `buildDoValues`)。
  ［導出］雛形が外来で作られていると処方区分が空になるので、その行を開いて選び直す(オーダーセット §4.1 と同じ挙動)。
- 検証に落ちた行があれば**何も登録しない**(その行を開いてスクロール)。
- 登録は**計画の木 + オーダー + 来歴 2 件を 1 つの transaction**にまとめる(`mergeTransactionBundles`)。オーダーの来歴
  (代行なら承認待ちの通知も)は `useWithOrderProvenance`、パスの来歴は適用の CarePlan を対象に 1 件。
- ［決定］**印はオーダーセットと同型**(`stampPathwayOrders`): ヘッダ ServiceRequest に identifier `pathway-instance`
  (値 = 適用 uuid)と拡張 `pathway-order`(valueCoding = パスコード・名前)、`requisition` は空いていれば同じ uuid。
- ［決定］印はカルテのカードに **「パス」のバッジ**として出す(`itemPathway` → `PathwayBadge`)。プロブレムのバッジと
  同じ形で、地色だけ敷いて見分ける。パス名は長くカードの見出しを押し出すのでツールチップに回し、どの適用・どの病日かは
  「パス」タブで見る。ヘッダ ServiceRequest を持たない種別は印が焼けないので出ない。
- ［決定］**タスクの Procedure が `basedOn` でオーダーのヘッダも指す**(観察項目の CarePlan に加えて)。参照の向きは
  タスク → オーダーの一方向で、オーダー側には印だけ。シートはタスクからオーダーの id を辿り(`PathwayTaskRecord.orderIds`)、
  オーダー側の DO・削除には影響しない。
- 病名(`condition`)の雛形はタスクに置けない(オーダーセット専用)。
- ［サンプル］`db/seed_data/pathways/900001.json`(腹腔鏡下胆嚢摘出術 4 泊 5 日)は 2026-09-13 に続きと分割の形へ作り直した。
  病日 6(手術当日を術前 / 術後に分割)・OAT ユニット 22・観察項目 46・タスク 58、雛形付きタスク 34 件(13 種別)から出るオーダーは 32 件。
  - 複数日に続くアウトカム: 呼吸・循環が安定している(術後〜4)、疼痛が自制内である(術後〜4。適正値は 3 以下 → 4 日目 2 以下)、
    創部の出血・感染の徴候がない(術後〜5)、離床できる(3〜4)、食事が摂れる(4〜5)。
- ［サンプル］2026-09-13 に 3 件を足した(どれも下書き。雛形の値は 900001 の同じ種別の値と開発 DB のマスタの行から作った)。
  - `900002.json` 内視鏡的大腸ポリープ切除術(1泊2日): 入院日を前処置 / 治療後に分割。病日 3・OAT ユニット 10・観察項目 21・タスク 21、
    雛形 9 件(処方・注射・検体検査・内視鏡・病理・食事・看護指示)。出血・穿孔の徴候がない(治療後〜2)が続く。
  - `900003.json` 鼠径ヘルニア根治術(2泊3日): 手術当日を術前 / 術後に分割。病日 4・OAT ユニット 14・観察項目 30・タスク 37、
    雛形 20 件(10 種別)。疼痛・創部(術後〜3)が続く。手術の雛形は左右を空けてあり、適用時に入れる。
  - `900004.json` 市中肺炎(抗菌薬点滴・7日間): 手術の無い内科系。病日 7・OAT ユニット 32・観察項目 47・タスク 46、雛形 19 件
    (細菌検査を含む 7 種別)。呼吸状態・解熱・抗菌薬治療・食事が 7 日間続き、酸素投与(1〜3)とセフトリアキソン点滴(1〜5)は続くタスク。
    適正値は 3 日目までと 4 日目からで変える。
  - 継続する看護指示: 弾性ストッキング着用(術後〜3)、離床介助・歩行(3〜4)。安静度: 病棟内フリー(1)→ ベッド上安静(術後)→
    病棟内歩行(3)。食事: 常食(1 夕)→ 絶飲食(2)→ 五分粥(3 昼から)→ 全粥(4)。
  - その日に行うもの: 病日 1 = 術前検査 / 胸部X線 / 心電図 / T&S / 麻酔科依頼、術前 = 術前点滴・抗菌薬 / 手術 / 摘出標本の病理、
    術後 = 術後点滴 / 疼痛時鎮痛薬、病日 3 = 術後採血 / 点滴 / 抗菌薬 / 内服鎮痛薬、病日 4 = ドレーン抜去 / 栄養指導、病日 5 = 退院処方。
    リハビリ・細菌検査・内視鏡はこの術式では使わないので入っていない。

## 6. 画面

- **一覧**(`pages/PathwayListPage.tsx`、`/pathways`): 名称・カナ / 診療科 / 入外 / 状態 / 有効期間内のみ で絞り込み、行クリックで編集へ。
  列はコード / 名称 / 診療科 / 入外 / 予定日数 / 病日(件数と最終病日)/ 版 / 状態 / 有効期間。メニューは「マスタメンテ > クリニカルパス > パス定義」。
- **編集**(`pages/PathwayEditorPage.tsx`、`/pathways/new`・`/pathways/:id`): 1 パス 1 ページ。本体と子をローカルの draft
  (`fhir/pathwayHelpers.ts` の `PathwayDraft`)に持ち、「保存」で 1 リクエスト。外側を `<form>` にしない(レジメンと同じ理由)。
  - 基本情報(コード・名称・略称・カナ・診療科・版・入外・予定日数・元ひな型)+ 適応基準・備考(textarea)
  - 対象病名(病名マスタの検索モーダル)
  - **病日カード**(`components/PathwayEventCard.tsx`)を病日順(同じ病日はステップ順)に並べる。病日の数値を変えて blur すると並び直る。
    ケバブに「この日を複製 / この日を分割 / 削除」(§3.1)。分けた病日のカードにだけ「ステップ名」の欄が出る。
    「＋ 病日」は最大病日 + 1、「＋ 入院前日」は最小病日 − 1(0 は飛ばす)。
  - 病日の中に **OAT ユニットカード**: 見出し行 = 番号 /(複数の病日に続くなら)載っている病日の印 / アウトカム名 / 区分(G/H)/
    重要 / コード体系 + コード / ↑↓ / 削除。本体は
    観察項目の表(名称 / 分類 / コード / 適正値 / 看護観察の選択)とタスクの表(大分類 / 中分類 / 名称 / 結ぶ観察項目 / オーダー雛形)の 2 列。
    タスク行の「＋ オーダー」で雛形モーダル、雛形があれば種別ラベル + 要約 + 編集 / 外す。
  - **概要表**(`components/PathwayOverviewTable.tsx`): 列 = 病日(分けた日はステップごと)、行 = アウトカム + 大分類ごとのタスク。
    行は識別子でまとめ(1 行 = 1 つの続き)、どの日に載るかを ● で示す。［決定］**セルを押すと続きを足す・外す**。足すときは
    足す先より前で最も近い日(無ければ後ろ)の内容を識別子ごと写す(アウトカムなら観察項目・タスク・雛形も)。タスクはそのアウトカムが
    載っている日にしか足せない(セルが押せない)。最後の 1 日を外すときだけ確かめる。凍結中は押せない。
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
    雛形を持つタスクは「オーダー」区画に積み、同じ transaction で通常のオーダーとして登録する(§5.1)。
- **パスタブ**(`components/KartePathwayTab.tsx`、カルテ左ペインの「パス」、`KARTE_TABS` の `pathway`): 適用したパスを
  **日めくり**(1 病日ずつ、`components/PathwayDayView.tsx`)と、紙のパスシートと同じ**オーバービュー**(病日 × OAT ユニットのシート)で見る。
  - 見出しの右に表示の切り替え「日めくり / オーバービュー」。［決定］既定は適用の状態によらずオーバービュー。
    日めくりは切り替えたときと、病日を指して開いたとき(指示簿の「パスのタスク」、カルテのパス評価のカードの「パスで開く」)だけ。
  - 見出し帯: パス名 / 入院日 / 今日が何病日目か(パスの期間外なら病日数)/ 状態(進行中・終了・中止と終了日)/
    進み具合の件数(未評価・バリアンス・未実施。オーバービューのときだけ)/ 右端の小さなケバブ。［決定］**操作はすべてケバブに畳む**(進行中なら
    「予定外を追加」§7.6・「日程の変更」§7.8・「終了・中止」§7.5・「適用の取り消し」§7.9、終わったパスは「終了の記録」)。
    件数を足したら左ペインで帯が 2 行に折り返したため、帯の行を増やさない決まりに合わせてボタンをやめた。
    適用が複数ある入院ではタブで切り替える(化学療法と同じ)。
  - ［決定］**進み具合の件数**(`sheetProgress`): 未評価 = 今日までの病日で達成状態が無いか「未評価」のアウトカムのセル、
    バリアンス = 「未達成」のセル(期間を問わない)、未実施 = 今日までの病日で実施していないタスクのセル。押すとオーバービューの
    その行だけに絞る(未評価・バリアンスはアウトカムと配下の行、未実施はタスクと属するアウトカム。`filterSheetRows`)。
    もう一度押すと解除。0 件の区分は押せない。絞り込みは URL に残さない。
    ［決定］**件数はオーバービューでだけ出す**(行を絞る道具なので、日めくりでは出さない。表示を切り替えると絞り込みも外す)。
    ［決定］**絞り込み中の件数は塗りつぶして「×」を添える**。押していない件数は枠線だけにする(グローバルのボタンの地色のままだと
    押した件数と見分けが付かなかった)。
  - タスクの実施(`pathwayTaskPerformedOn`): チェックリストはタスクの Procedure、看護指示はその日の実施記録、
    ［決定］**その他のオーダーを結んだタスクはオーダーが実施済みになれば実施**(部門が実施を記録する)。看護指示を結んだ・
    オーダーが実施済みのタスクは、評価パネルと日めくりのチェックを押せない(`isOrderDrivenTask`)。
    ［事実］部門が受ける種別(注射・検査・処置・手術・輸血・リハビリ・栄養指導・他科依頼)の進み具合は、ServiceRequest の
    `status` ではなく focus でオーダーを指す進捗の Task に持つ(実施してもオーダーは active のまま)。
    ［決定］**オーダーの実施済みと状態の名前は、カルテのカードと同じく種別ごとの Task で決める**(`orderProgressByOrderId`)。
    Task で進み具合を持たない種別(処方・食事・細菌検査・化学療法)と、取り下げ・誤登録のオーダーは ServiceRequest の `status`。
    件数(未実施)、日程の変更・取り消しの「実施済みのオーダー」の判定も同じ値を使う。
  - **日めくり**(`PathwayDayView`): 見出しに「‹ 前の日」/ 病日・見出し(分けた日はステップ名)・日付・「今日」/「次の日 ›」/
    (今日の病日が別にあれば)「今日」。分けた日はステップを 1 枚ずつめくる。既定の病日は今日の病日(分けた日は最初のステップ)、
    期間の前なら最初、後なら今日までの最後の病日(`defaultDayEventId`)。
    - その病日のアウトカムをカードで縦に並べる(重要は左に赤い線)。カードの見出しに達成状態の 3 択と「記載」(記載があれば
      「記載あり」)。本体は観察項目(名称 / 適正値 / 入力欄 / 候補)とタスク(チェック / 分類 / 名称 / オーダーの状態)。
      オーダーを結んだタスクの名称を押すと、オーバービューのセルと同じオーダー詳細(看護指示は実施入力)が開く。
    - ［決定］**達成状態・実績・タスクの実施は日めくりでまとめて入れ、記載(SOAP・自由記載)は評価モーダルで書く**。
      入力中の値はアウトカムごとに持ち、病日をめくっても残る。「記録(n 件)」で**変えたアウトカムの分だけ**を 1 transaction にまとめる
      (`buildPathwayEvaluationBundle` をアウトカムごとに組んで entry をつなぐ。記録日時はその時点)。
    - 変えたアウトカムの「記載」は押せない(評価モーダルは保存済みの値で開くので、入力中の値と食い違わないようにする。記録してから開く)。
    - 全画面でも 1100px で止めて中央に置く。
  - 列 = 病日(番号・定義の見出し・実日付)。同じ病日を分けたパスでは、病日の見出しをまとめ(colSpan)、その下にステップ名の段を足す。
    今日の列(分けた日はステップ全部)を強調し、過ぎた列は薄くする。行の見出し列と病日の見出し行は
    貼り付け(sticky)、列が多ければ表の中だけ横に送る。見出し帯の「病日 N 日分」はステップを数えない。
  - ［決定］**列幅は表の幅に合わせて広げる**: (表の幅 − 行の見出し列 − 右端の詰め物の余白)÷ 列の数 − セルの余白(16px)を
    96〜180px に収める。収まらなければ 96px のまま表の中だけ横に送り、広い画面でも 180px で止めて残りは詰め物にする。
    自動化のタブでは ResizeObserver が発火しないことがあるので、描画のたびと画面の大きさが変わったときに同期で測る。
  - ［決定］**開いたときの位置**: オーバービューを開いた(適用・表示・絞り込みを切り替えた)ときに、今日の列が行の見出し列のすぐ右に来るよう
    横に送り、今日まだ評価していない最初のアウトカムの行へ縦に送る。
  - 行 = OAT ユニットを見出し行(重要は ★)にして、その下に観察項目、次にタスク(分類のバッジ付き)。［決定］**同じ識別子**の
    アウトカム(続き)は 1 行にまとめ、その病日にだけ載るものは該当列だけにセルが入る(`fhir/pathwaySheetHelpers.ts`)。
    観察項目・タスクも識別子でまとめる。名前が同じでも識別子が違えば別の行(続きになる前に作った適用は、日ごとに別の行のまま)。
  - ［決定］**続いている行はセルの中に線と矢印を引く**(`SeriesLink`)。同じ行で隣の列(病日・ステップ)にもセルがあれば、中身の左右に
    線を置いてセルの余白まで伸ばし、隣のセルの線とつなげる。続きの最後のセルは中身の手前で右向きの矢じりにする(紙のパスシートで
    日をまたいで引く矢印)。アウトカムのチップ・観察項目の ○ / 実績値・タスクの ☐ / ☑ のどれにも同じ線を引き、線は本文色(`--text`)。
    間の列に載らない日があれば線は切れる。
  - タスクのセルの ☑: チェックリストはタスクの Procedure の状態。［決定］**看護指示を結んだタスクは、その日の実施記録があれば ☑**
    (`useNursingPerformsOf`、判定は `pathwayTaskPerformedOn`)。続く病日にまたがる 1 件の指示を日ごとに記録するため。
    評価パネルのタスクのチェックも同じ判定で、看護指示を結んだタスクは押せない(実施はセルから開く実施入力で記録する)。
    ［決定］**リハビリ・栄養指導を結んだタスクも、その日の実施記録があれば ☑**。1 つのオーダーの期間中に実施を積み上げ、
    進捗の Task は受付済のまま動かない(終了で completed)ため、Task では日ごとの実施が分からない(`OrderProgress.performedDates`)。
    日程の変更・取り消しは、実施記録が 1 件でもあれば「実施済みのオーダー」として止める(`orderHasPerformed`)。
    「観察項目なし」で包んだだけの観察項目は行にしない。
  - セル: アウトカム行は 達成 / 未達成 / 未評価、観察項目行は予定(○)、タスク行は ☐ / ☑ と、雛形から出したオーダーの
    状態(種別ごとの Task の名前。依頼済・受付済・実施済・中止 など)。
  - ［決定］**アウトカムの値は枠線付きのチップ**にする(カルテのバッジと同じ語彙)。押せると分かるのがホバーしたときだけだと
    観察項目のセルと区別が付かないため。枠は文字と同じ色にして達成 / 未達成 / 未評価の色分けをそのまま使う。
    列の地色は今日・過去の病日が使っているので、押せる印に地色は使わない。タスクは ☐ / ☑ 自体が押せる印になるので
    チップにしない。ホバーとキーボードのフォーカスではセルに地色を敷き、フォーカスのときは内側に枠も出す。
  - **全画面**: 経過表と同じ作法。見出し帯の「全画面」で患者情報の下からビューポートの下端まで広げ、Escape か
    「全画面を終了」で戻る。view は「適用の id[~day|~sheet][@病日の id][!]」(`parsePathwaySheetView`)で、表示の切り替え・
    日めくりで開いている病日・全画面も含めてリロード・共有で同じ状態が開く。適用を切り替えると表示と病日は既定に戻る。
    全画面では行の見出し列を広く取る(220px → 320px)。
  - 読みは `usePathwayApplicationTree`: `CarePlan?part-of=適用&_revinclude=Procedure:based-on&_include:iterate=Procedure:based-on`
    `&_revinclude:iterate=Task:focus,Procedure:based-on` の 1 回で木・タスク・オーダーのヘッダ・オーダーの進捗の Task・
    オーダーの実施記録まで揃える。［事実］上流は `_revinclude:iterate` を 2 つ並べると最後の 1 つしか効かない(カンマで 1 つにすると両方返る)。
    実施記録(オーダーを basedOn で指す Procedure)はパスのタスク(CarePlan を basedOn で指す Procedure)と分けて持つ。
    オーダーの詳細(実施入力を含む)と看護指示の実施入力は種別ごとの一覧だけを読み直すので、
    ［決定］パスタブから開いたそれらのモーダルを閉じたときに木を読み直す。
  - ［決定］定義の並び(display_order)を**ローカル拡張 `pathway-display-order`** で OAT ユニット・観察項目・タスクに持ち越す。
    CarePlan にも Procedure にも並びの要素が無く id は uuid なので、無いとシートの行が定義と違う順になる。EP12 出力では落とす。
  - **セルを押したときに開くものは行の種類で決まる**(2026-09-13 に変更)。［決定］**どれもモーダルで開く**(右ペインは使わない)。
    このタブだけが全画面を持つので、右ペインと使い分けると同じ操作で開く場所が変わってしまう。
    - アウトカムの行 → 評価入力(`PathwayEvaluatePanel`)。記録するとシートに達成 / 未達成(バリアンスは赤)、実績値、☑ が出る(§7.4)。
    - タスクの行 → そのタスクに結んだオーダーの詳細(`PathwayOrderModal`。中身はカルテのカードの「詳細表示」と同じ
      `KarteDetailModal`)。看護指示だけは詳細ではなく指示簿と同じ実施入力(`NursingPerformModal`、過去の病日から開いたときは
      その日の時刻で記録を始める)。オーダーを持たないタスクは `PathwayTaskPanel` で実施 / 未実施を 1 件だけ記録する
      (Procedure の PUT のみ。評価には触れない)。
    - 観察項目の行 → 押せない(実績値はアウトカムの評価の中で入れる)。
  - **適正値**: 観察項目の行見出しに、名前に続けて適正値を控えめな文字で添える(§7.7)。同じ観察項目でも病日によって
    適正値が違えば行見出しには出さず、各セルのツールチップ(「適正値: …」)で見る。行見出しのツールチップにも入る。
  - **オーダー詳細からの導線**: 下に「編集」と「実施入力」を添える(`KarteDetailModal` の `actions`)。
    - 編集 → そのオーダーの編集フォームを右ペインで開く(フォームは右ペインにしか無いので、全画面なら抜けてから開く)。
    - 実施入力 → 注射・輸血と、部門の一覧に実施入力がある種別(放射線・生理・内視鏡・処置・手術・リハビリ・栄養指導。2026-09-14 に拡大)。
      中止・誤登録のオーダーには出さない。部門の種別は実施済・中止、リハビリ・栄養指導は終了・中止なら出さない。
      ［決定］**部門の受付(手術は入室)を済ませていなくても実施できる**。パスの流れを部門の操作待ちで止めないため。
      モーダルと登録は部門の一覧と同じものを使う(`PathwayOrderModal` のローダーが、オーダーの実施日の部門一覧から同じ行を引いて渡す)。
      - 放射線・生理・内視鏡・処置: 項目マスタで実施入力が要らない項目だけなら、部門の一覧と同じく記録を作らず Task を実施済にする
        (パスからは「実施済にしますか？」で確かめてから)。Task は依頼済から実施済へ直接進み、executionPeriod は start = end = 押した時刻。
      - 手術: 手術一覧は予定手術日(occurrencePeriod)で引くので、日程未定の申込は開けない(その旨を出す)。
      - リハビリ・栄養指導: 1 回ぶんの実施を登録する。実施日の初期値は開いたセルの日付(先の日なら今日)。進捗の Task が依頼済
        (または無い)なら、同じ transaction で受付済にする(`acceptTask`。完了にはしない)。
      - 一覧にオーダーの行が見つからない(実施日が変わった・日付が無い)ときは、その旨を出して開かない。
  - Escape は重なりの外側から閉じる(実施入力 → オーダー詳細 → 全画面)。`Modal` 自体は Escape を見ないので、
    タブと `PathwayOrderModal` がそれぞれ自分の重なりを閉じる。
  - アウトカムの行は開閉できる(観察項目とタスクを畳む)。評価の済んだアウトカム(載っている病日すべてに評価がある)は
    畳んだ状態で開き、手で開け閉めした状態は適用を切り替えるまで残る。
  - モーダルに揃えたので、全画面でも通常でも同じ場所に開く。記録すればモーダルだけ閉じ、シートはそのままで次のセルへ進める。
    右ペインの `pathway-evaluate` / `pathway-task` は使わなくなったので消した(パスの適用は右ペインのボタンから始まるので残す)。
- **カルテのカード「パス評価」**(`fhir/pathwayKarteHelpers.ts`、`api/queries.ts` の `useKartePathwayEvaluations`、
  `fhir/karteTimeline.ts` の種別 `pathway-evaluation`、`components/KarteTimeline.tsx`): 記載のあるアウトカムの評価をカルテの
  タイムラインにカードで出す。
  - ［決定］**記載(S/O/A/P・自由記載・コメント)のある評価だけ**を出す。達成状態だけの評価は出さない(推移はパスタブで読み、
    カルテに 1 件ずつ並べると診療記録が埋もれる)。
  - ［決定］**カードは記録日時の日に置く**(他の記載と同じく「いつ書いたか」の軸)。どのパスのどの病日の評価かは本文の先頭に出す。
  - 見出し: 種別「パス評価」/ アウトカム名 / パスの印(ツールチップにパス名)/ 記録時刻・達成状態・記録者。本文: パス名・病日と日付
    (未達成なら「未達成(バリアンス)」を赤で添える)/ 書いた S/O/A/P / 自由記載 / コメント。
  - メニューは「FHIR JSON 表示」「パスで開く」だけ。［決定］**詳細表示・編集・削除は持たない**(カードに中身が全部出る。記載の書き直しは
    パスタブの評価で行い、評価はアウトカムの記録なのでカードからは消させない)。「パスで開く」はパスタブをその病日の日めくりで開く
    (分割表示なら下のペイン。履歴に積むので戻るでカルテに戻る)。
  - 左端のペインの種別に「パス評価」を足した(`PLAIN_KINDS`・URL の `card`)。
  - 読み(患者ぶん全部。1 人で数十件なのでページングしない): `Observation?patient&category=パスの印&code=判定` と、
    その basedOn の OAT ユニットを `CarePlan?_id=…&_include=CarePlan:part-of`(祖先の病日・適用も揃う)。Observation の
    based-on は上流で include できないので 2 回に分けた。全部読んであるので、タイムラインの表示範囲の計算(カットオフ)には
    加わらず、評価の日付は診療日ペインにも最初から並べる。プロブレムで絞り込んでいるときは出さない(評価はプロブレムを指さない)。
  - キーは評価の記録(`useRecordPathwayEvaluation`)が読み直す `["Observation", "search", "pathway"]` 配下に置き、記録すると
    カードも読み直される。
- **看護の指示簿の「パスのタスク」**(`components/PathwayWardTasks.tsx`、`pages/NursingWorklistPage.tsx` の看護指示の表の下):
  病棟と基準日で、その病棟に入院している患者の、基準日の病日に置かれた**オーダーを持たないタスク**(観察・説明・文書など)を
  患者ごとに並べ、その場で実施にする。
  - ［決定］**対象はオーダーを持たないタスクだけ**。雛形から出したタスクは、看護指示なら同じ画面の上の表に、その他は各部門の画面に
    出るので重ねない。進行中の適用だけを出す(`parsePathwayWardTasks`)。
  - 病棟の患者は、その日の入院(`useInpatientEncounters`)のベッドから病棟を引いて決める(`useBedWardIndex`。上の表と違い
    看護指示の ward 検索は使えない)。
  - 読み(`usePathwayWardTasks`)は 2 回: `CarePlan?category=病日&date=基準日&subject=患者(カンマ OR)&_include=CarePlan:part-of`
    で病日と適用の根、`CarePlan?part-of=病日(カンマ OR、10 件ずつ)&_revinclude=Procedure:based-on` で子孫とタスク。
  - 列は 実施(チェック)/ 分類 / タスク / アウトカム / 病日 / 実施者(実施済みなら氏名と時刻)。患者の見出し行に病室・氏名・パス名。
    氏名からカルテのパスタブをその病日の日めくりで開く。実施済みの行は薄くする。見出しに未実施の件数。
  - ［決定］**指示受けは要らないので「未指示受け」のビューでは出さない**。「実施予定」では未実施だけ、「全指示」ではすべて出す。
  - チェックで実施 / 未実施を切り替える(`buildPathwayTaskBundle`。パスタブのタスクの記録と同じ Procedure の PUT)。記録日時は
    基準日が今日なら今の時刻、別の日ならその日の今の時刻(指示簿の実施入力と同じ)、実施者はログイン本人。
- **入院患者一覧の「パス」列と患者ヘッダのパス**(`components/PathwayNameLinks.tsx`、`pages/InpatientListPage.tsx`、
  `components/PatientHeader.tsx`): 患者を開かずに、パス適用中かを見る。
  - ［決定］**進行中のパスの名前だけを出す**。病日・未評価件数・バリアンス・終了漏れの印まで並べると、患者帯も一覧も横に長くなり過ぎた。
    それらはパスタブで読む。長い名前は省略してホバーで全文、複数あれば間を空けて並べる。
  - 一覧は「パス」の 1 列(入院日と特記事項の間)。パスの無い患者は「-」。基準日によらず、いま進行中の適用を出す。
  - 名前からカルテのパスタブをその適用で開く(表示は既定のオーバービュー)。
  - 読み: 一覧は `useActivePathwaysByPatient`(`CarePlan?subject=患者(カンマ OR)&category=パスの印&part-of:missing=true&status=active`
    の 1 回。絞り込みで読み直さないよう病棟の床にいる患者全員で引く)。患者ヘッダはパスタブと同じ `usePathwayApplications` を
    進行中で絞る。キーはどちらも CarePlan 配下(終了・中止・取り消しで読み直される)。
- **評価パネル**(`components/PathwayEvaluatePanel.tsx`): 見出しにパス名・病日・日付・アウトカム名。区画は 観察項目(名称・適正値・実績値)/
  タスク(実施のチェックと雛形のオーダーの状態)/ アウトカム評価(達成 / 未達成(バリアンス)/ 未評価、S・O・A・P、コメント、記録日時)。
  保存済みの値は開いたときに復元され、「記録」で 1 transaction。

## 7. 適用の FHIR 構造(第 2 段階)

1 回の適用は **CarePlan の木**で表す。実装は `fhir/pathwayApplyHelpers.ts`。

```text
CarePlan(適用)                 partOf 無し = 木の根
  └ CarePlan(病日)             partOf = [適用]
      └ CarePlan(OAT ユニット)  partOf = [適用, 病日]
          └ CarePlan(観察項目)   partOf = [適用, 病日, OAT ユニット]、goal → Goal(適正値。§7.7)
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
- ［決定］**アウトカムの Goal と評価 Observation は適用時には作らない**(観察項目の適正値の Goal だけは計画の一部なので作る。§7.7)。アウトカムの達成・未達成は評価したときに生まれる記録で、
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
(CarePlan 76 + Procedure 50)になる。観察項目の適正値の Goal(§7.7)を足した 2026-09-13 以降は、43 件すべてに
適正値があるので **169 リソース**(雛形のオーダーは別)。続きと分割の形に作り直した後(§3.1)は 6 病日・OAT ユニット 22・
観察項目 46・タスク 58 で、**196 リソース**(CarePlan 92 + Goal 46 + Procedure 58)とオーダーのヘッダ 32 件。観察項目に結ばないタスクを包む空の観察項目が 13 件増えるため、
CarePlan は定義の 1 + 5 + 14 + 43 = 63 ではなく 76。上流の transaction に件数の上限は無い。

### 7.4 日次評価(1 病日 × 1 OAT ユニット)

実装は `fhir/pathwayEvaluationHelpers.ts`。シートのアウトカムのセルからモーダル(`components/PathwayEvaluatePanel.tsx`)を開き、
観察項目の実績値・タスクの実施・アウトカムの達成状態と記載を 1 回で記録する。記載は **SOAP と自由記載を選べ**、どちらも
テンプレートから書ける。

```text
Goal(アウトカム)             identifier outcome-goal-id = OAT ユニットの識別子、lifecycleStatus completed(評価済)/ active、
                            achievementStatus = EPathStateOfAchievementCS 1 達成 / 2 未達成(バリアンス) / 3 未評価、
                            description.text = アウトカム名、statusDate、outcomeReference → 評価の Observation
CarePlan(OAT ユニット).goal → Goal(初回の記録で PUT して足す)
Observation(評価)            identifier observation-evaluation-id、code = EPathEvaluationItemCS|judgement、
                            valueCodeableConcept = 達成状態、note = コメント、
                            component = S / O / A / P(SOAP)または comp-assessment(自由記載)の valueString、
                            component.extension pathway-evaluation-template → QuestionnaireResponse(テンプレートから書いたとき)、
                            basedOn → CarePlan(OAT ユニット)、effectiveDateTime、performer
QuestionnaireResponse       テンプレートの回答。評価と同じ transaction で書き、外れたら消す
Observation(観察項目の実績)   identifier observation-result-id、code = 観察項目のコード + text、value[x] は表現タイプで決まる、
                            basedOn → CarePlan(観察項目)
Procedure(タスク)            status completed(実施)/ preparation(未実施)、performedDateTime、performer.actor
```

- ［決定］評価・実績の Observation は **Goal に contained せず独立のリソース**にする。検索で読めて、シートは
  `Observation?patient=X&category=care-plan-type|clinical-pathway` の 1 回で全部引ける(category の先頭にパスの印を置く。
  上流は category の先頭しか索引しない)。EP12 出力で contained に畳む(第 3 段階)。
- ［決定］Goal は「評価したとき」に作る(適用時には作らない)。初回は Goal と評価 Observation を POST し、OAT ユニットの
  CarePlan に goal を足す PUT を同じ transaction に入れる。2 回目以降は同じ id へ PUT(識別子が同じなので二重にならない)。
- ［決定］観察項目の実績は**値が入っているものだけ**記録し、消したら DELETE。表現タイプは看護観察(MEDIS)に結んだ観察項目なら
  マスタの表現タイプ(数値 / 列挙 / 文字 / 2 数値 / 血圧)、それ以外は文字。入力欄は看護の実施入力と同じ `ObservationInput`。
  看護観察の管理番号は適用時に観察項目の CarePlan.category へ MEDIS の体系で写しておく。
- ［決定］タスクは状態が変わったものだけ PUT。実施にすると performedDateTime と performer が入り、戻すと消える。
- ［決定］**記載の形式は SOAP と自由記載の 2 つ**。ePath の評価項目区分(`EPathEvaluationItemCS`)は S / O / A / P と
  総合評価(`comp-assessment`)を持つので、自由記載は総合評価のコードに載せる。形式は保存した component から読み戻す
  (`comp-assessment` があれば自由記載)。形式を変えて記録し直すと、前の形式の component は消える。
- ［決定］**テンプレートは記載欄ごとに結ぶ**(SOAP なら S / O / A / P の 4 つを別々に、自由記載なら 1 つ)。差し込みは
  他のオーダーと同じ `TemplateEntryModal` + `TemplateTextField` で、平文が欄に入り、回答の QuestionnaireResponse を
  評価と同じ transaction に積む。参照は component の拡張 `pathway-evaluation-template` に置く。
- ［決定］**テンプレートを結んだ欄は読み取り専用**。書き換えは「テンプレート編集」から。「解除」すると平文だけが残って
  手で直せるようになり、外れた QuestionnaireResponse は記録時に DELETE する(記載を空にしたときも同じ)。
- ［決定］**実績値の候補**(`assessmentCandidate`): 看護観察に結んだ観察項目には、その病日の経過表の値のうち最後に記録したものを
  「37.1℃(09:30)」のボタンで出し、押すと入力欄に入る(評価モーダルと日めくりの両方)。バイタル(体温・脈拍・SpO2・呼吸数・身長・
  体重・血圧)は看護観察の管理番号から LOINC を引き(`nursingVitalCodeOf`)、手入力のバイタルと看護観察の記録のどちらからも読む。
  収縮期・拡張期の単独項目(31001848 / 31001849)は血圧の内訳から読む。それ以外の看護観察は同じ管理番号の記録から読む。
  読みは経過表と同じ `useVitalFlowsheet`(その日だけ)。候補は入力を助けるだけで、パスの実績は押して記録したときに作る。
- 記録者はログイン本人(`useCurrentPractitioner`)。ePath の Goal AssessmentExecution の達成状態(観察項目ごとの達成)は書かない
  (実績値から導ける。EP12 出力で必要なら組む)。

### 7.5 パスの終了・中止

実装は `fhir/pathwayCloseHelpers.ts` と `components/PathwayClosePanel.tsx`。シートの見出し帯の「終了・中止」から
モーダルで開く。ePath の「パス適用情報 目標・評価情報」(`EPath Goal EPathApply`)に倣う。

```text
CarePlan(適用)  status = completed(終了)/ revoked(中止)、period.end = 終了日
Goal(適用)      identifier apply-goal-id = 適用の識別子(施設コード.適用uuid)、lifecycleStatus = completed / cancelled、
                拡張 EPathGoalStatusReason = EPathPathClosingTypeCS(1 終了 / 2 中止)、statusDate = 終了日、
                description.text = 施設パス名、subject → 患者、note = 中止理由・総合評価
```

- ［事実］IG では終了区分の ValueSet(`EPathPathClosingTypeVS`)が拡張 `EPathGoalStatusReason`(名前は「パス中止理由」)に
  束縛されている。区分のコードはこの拡張に載せ、`lifecycleStatus` は FHIR 側の語(completed / cancelled)で同じことを表す。
- ［決定］**中止理由と総合評価はどちらも `Goal.note`**。ePath は理由をコードで持たせる作りではないので自由文にし、
  理由の側は「中止理由: 」で始めて見分ける(読み戻しも同じ規則)。
- ［決定］**未実施のタスクはそのまま残す**。その日に何をする予定だったかはパスシートの記録なので、終了で消さない。
- ［決定］**取り消し(進行中に戻す)は Goal を消す**。CarePlan を active に戻して period.end を落とす。「終わったことにした」
  記録は経過ではなく入力の訂正なので残さない。
- 終了・中止すると適用は `active` でなくなるので、同じ入院に同じパスを当て直せる(二重適用のガードは active だけを見る)。
- 読みは `Goal?identifier=apply-goal-id|{適用の識別子}` の 1 回(`usePathwayApplyGoal`)。木の検索には根が入らないので別に引く。

### 7.6 予定外の OAT ユニットの追加

実装は `fhir/pathwayApplyHelpers.ts` の `buildUnplannedUnitBundle` と `components/PathwayUnplannedPanel.tsx`。
シートの見出し帯の「予定外を追加」からモーダルで開き、病日を選んでアウトカムを 1 件足す(観察項目・タスクは任意)。

- ［決定］**予定どおりのアウトカムと同じ形**で作り、`EPathCarePlanUnplannedKind` だけを `Y` にする。シートは同じ行として
  扱え、日次評価(§7.4)の仕組みがそのまま効く(セルに「予定外」の印が出る)。
- 識別子は定義マスタを介さないので `unit_key` にその場の uuid を振る(`{病日の識別子}.{uuid}`)。観察項目・タスクも同じ。
- タスクは定義と同じく「観察項目なし」(`ZZZZZZZZZZ`)の観察項目で包む。入力した観察項目とタスクを結ぶ画面は持たない。
- ［決定］タスクには**適用パネルと同じ器でオーダーを付けられる**(`ORDER_SET_TYPES`。病名だけは外す)。種別を選ぶとその
  オーダー登録フォームがタスクの下に開き、「追加する」で計画の木とオーダーを **1 つの transaction** にまとめて登録する。
  違うのは雛形が無いことだけで、フォームは空の値(`emptyValues`)から始める。既定の種別はタスク分類から決まる
  (`defaultOrderTypeOfTask`)が、分類を変えて追随するのは既にオーダーを付けている行だけ。
- ［決定］オーダーの印は**適用のときと同じ**(`stampPathwayOrders`)。束ねる uuid も適用の識別子の後半をそのまま使うので、
  予定どおりのオーダーと同じ束に入る。タスクの Procedure は `basedOn` でそのオーダーのヘッダも指し、シートにオーダーの
  状態が出る。来歴(代行なら承認待ちの通知も)は通常のオーダーと同じ。
- ［事実］開始日は選んだ病日の日付を `bulkStartDate` で入れる。**フォームの中で後から足した明細**(処置・内視鏡の単独枠など、
  行ごとに日付を持つもの)はフォーム側の既定である当日になるので、必要なら病日を選び直すか行の日付を直す。
- 並び順はその病日の末尾(`pathway-display-order` = 既にあるアウトカムの数 + 1)。
- 終了・中止したパスには足せない(「予定外を追加」は進行中のときだけ出す)。
- ［決定］オーダーのフォームがテンプレート記入などのモーダルを重ねている間は、**Escape で予定外の入力を閉じない**
  (入力中の値を失わせない)。重ねたモーダルは自分で Escape を見ないので、そちらは × で閉じる。

### 7.7 観察項目の適正値

実装は `fhir/pathwayApplyHelpers.ts` の `buildAssessmentGoal`。定義の観察項目の適正値(`proper_value`)を適用後に持ち越し、
評価する人が判断の基準をシートと評価パネルで見られるようにする。

```text
CarePlan(観察項目).goal → Goal  identifier assessment-goal-id = 観察項目の識別子、lifecycleStatus active、
                               description.text = 観察項目名、subject → 患者、
                               target.measure = 観察項目のコード(BOM / ローカル)+ text、target.detailString = 適正値
```

- ［事実］ePath の CarePlan(観察項目)には適正値の要素が無い。IG が適正値を持たせているのは、定義側の
  `EPathPlanDefinitionAssessmentActionExtensions` の `ProperValue` と、適用後の `EPath Goal AssessmentExecution` の
  `target.detail[x]`(「観察項目の評価基準となる適正値」)だけ。
- ［決定］**適正値の Goal は適用の時点で作る**。アウトカムの Goal(§7.4)は評価で生まれる記録だが、適正値は計画の一部で、
  実績値からは導けない。適正値の無い観察項目には作らない。「観察項目なし」で包んだだけの観察項目にも作らない。
- ［決定］**この Goal には達成状態を書かない**。観察項目ごとの達成は実績値から導ける(EP12 出力で必要なら組む)。
- 参照は CarePlan → Goal の一方向で、同じ transaction の中で Goal を先に積む。読みはシートの木の検索に既にある
  `_include=CarePlan:goal` でアウトカムの Goal と一緒に届き、`parsePathwayApplication` が観察項目の `properValue` に入れる。
- 予定外の追加(§7.6)の観察項目は名称だけなので、適正値を持たない。
- 定義を直しても適用済みの Goal は変わらない(適用した時点の基準で評価する)。

### 7.8 日程の変更

実装は `fhir/pathwayScheduleHelpers.ts` の `planPathwayShift` / `buildPathwayShiftBundle` と `components/PathwaySchedulePanel.tsx`。
シートの見出し帯のケバブ(進行中のときだけ)から「日程の変更」をモーダルで開き、起点の病日と、その病日の新しい日付を選ぶ。
起点から後ろの病日をまとめて同じ日数だけずらす(入院日・手術日が動いたとき)。

- 書き換えるもの(1 transaction、`useShiftPathwaySchedule`): 起点から後ろの病日の CarePlan の `period`、その病日のタスクの
  Procedure の予定日の拡張、起点が最初の病日なら適用の CarePlan の `period.start`、看護指示・食事のオーダーの開始・終了。
  オーダーを書き換えるので、オーダーの来歴(UPDATE。代行なら承認待ちの通知も)を付ける。
- 既定の起点は、評価・実施の記録がある最後の病日の次(記録が無ければ最初の病日)。新しい日付の既定は起点の今の日付。
- ［決定］**記録のある病日はずらさない**。起点から後ろに評価(アウトカムの Goal・評価・観察項目の実績)、実施済みのタスク、
  看護指示の実施記録(起点の日付以降)、実施済みのオーダーがあれば、理由を並べて変更させない。記録の日付と病日が食い違うため。
  前の病日と同じか前の日付(同じ病日のステップどうしは前の日付)にもできない。
- ［決定］**オーダーは看護指示と食事だけ自動でずらす**(日付がヘッダの ServiceRequest 1 本で完結する)。適用の木全体の看護指示・食事の
  うち、開始日が起点の今の日付以降のものは開始をずらし、終了日は後ろへずらすときは起点の前日以降、前へずらすときは起点以降のものを
  ずらす(後ろへずらして空いた日は、前日までの食事・安静度・指示がそのまま続く)。前へずらして終了が開始より前になれば開始の日に揃える。
- ［決定］**その他の種別(注射・検査・手術・処置・栄養指導など)は自動では触らない**。明細・予約・部門の受付を伴い、日付の持ち方も
  種別ごとに違うため。モーダルに「日付を直すオーダー」として今の開始日 → 新しい病日の日付を並べ、変更後はシートのセルに
  **「日付違い」**(開始日をツールチップ)が出る。セルからオーダー詳細 →「編集」で直す。
- 「日付違い」は、そのオーダーが最初に載る病日の日付とオーダーの開始日(`occurrenceDateTime` / `occurrencePeriod.start` の日付)が
  違い、終わって(実施済・中止・誤登録)いないときに出す。予約で開始日が病日と違うオーダーにも出る。

### 7.9 適用の取り消し

実装は `planPathwayCancel` / `buildPathwayTreeDeleteBundle`(同じファイル)、`components/PathwayCancelPanel.tsx`、
`api/queries.ts` の `useCancelPathwayApplication`。見出し帯のケバブの「適用の取り消し」からモーダルで開く。

- ［決定］**取り消せるのは、何も記録していない進行中の適用だけ**。評価、実施済みのタスク、看護指示の実施記録、実施済みのオーダー、
  部門が受け付けた(Task が accepted / in-progress / on-hold / ready / completed)オーダーがあれば、理由を並べて取り消させない。
  記録のある適用は中止にする(記録を消さない)。
- 消すもの: 雛形から出したオーダー(予定外で付けたものも)、計画の木の CarePlan、タスクの Procedure、観察項目の Goal。
  適用とオーダーの来歴(Provenance)は残す(誰が適用したかの記録)。
- ［決定］**オーダーはカルテのカードの削除と同じ種別ごとの処理で消す**(明細・予約の取消と枠の解放・テンプレートの記入・
  回答済み他科依頼の拒否は各種別に任せる)。看護指示は普段は中止で残すが、ここでは指示と指示受けの Task を消す。
- ［決定］**種別ごとの削除の hook は使わず、その本体(`delete…Request`)を順に呼び、読み直しは最後に 1 回**。hook は 1 件ごとに一覧を
  読み直させるので、31 件を続けると開いているカルテの読み直しが積み重なり、上流の回数制限(`rack_attack.rb` の api/token、既定 300 件/分)
  に当たった。種別ごとの削除の hook は、この本体を呼んで読み直す形に切り出した(振る舞いは変わらない)。
- 途中で失敗したら計画の木は残す。もう一度開けば、残っているオーダーから続けられる(消えたオーダーは一覧に出ない)。
- 取り消した後は URL の view を外し、シートは残っている適用(無ければ「適用されていません」)を出す。

### 7.10 バリアンスの通知

実装は `fhir/pathwayVarianceHelpers.ts`(通知の組み立て)、`hooks/usePathwayVarianceNotice.ts`(宛先と既存の通知)、
`buildPathwayEvaluationBundle`(評価の transaction に積む)、`components/notifications/notificationRegistry.tsx`(一覧の種別)。
通知の器は他の通知と同じ Task(readme の「通知(Task)」)。

```
Task  code = task-code|pathway-variance、priority = urgent(注意)、status requested / completed / cancelled
      focus → 評価の Observation、for → 患者、owner → 入院の主治医、requester → 記録した人
      basedOn → OAT ユニットの CarePlan(アウトカムごとの通知を引き当てる)
      input: パス名 / 適用(CarePlan の id)/ 病日(CarePlan の id)/ 病日の表示 / 対象日 / アウトカム
```

- ［決定］**通知するのは重要アウトカム(★)を「未達成」と記録したときだけ**。重要でないアウトカムの未達成まで届けると数が多く、
  主治医が見るべきものが埋もれる(パスシートの「バリアンス」の件数では全部数える)。強度は注意(緊急異常値ほど急がない)。
- 評価モーダルと日めくりの記録で、評価と同じ transaction に積む。指示簿のタスクの実施など、達成状態に触れない記録では作らない。
- ［決定］**同じアウトカムを未達成のまま記録し直しても出し直さない**(記載を足すたびに届くと煩い)。達成・未評価から未達成に
  変わったときは、前の通知(対応済み・取り下げ)があれば書き換えて未対応に戻す。
- ［決定］**未達成でなくなったら未対応の通知を取り下げる**(cancelled)。対応済みの通知はそのまま残す。
- 宛先は入院の Encounter の主治医(participant ATND)。パスを当てた入院と今の入院が違う、または入院していないときは宛先なし
  (通知の一覧で「自分あてのみ」を外すと出る)。
- 既存の通知は `Task?patient&code=task-code|pathway-variance` で患者ぶんを引き、basedOn で OAT ユニットに突き合わせる
  (`usePathwayVarianceTasks`)。［決定］読めるまでは記録のボタンを押させない(読めていないと同じアウトカムに通知が重なる)。
- 通知の「カルテ」は、パスタブをその病日の日めくりで開く。「確認」で対応済み(note に「バリアンスを確認しました。」)。

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
  - **適用の FHIR 構造(§7)・右ペインの適用パネル(§6)・オーダー雛形の展開(§5.1)・パスタブ(§6)・日次評価(§7.4)は実装済み(2026-09-12)**。
    **パスの終了・中止(§7.5)と予定外 OAT ユニットの追加(§7.6)も実装済み(2026-09-13)**。第 2 段階は完了。
  - **上流の CarePlan / Goal は実装済み(2026-09-12、別リポジトリ `fhir-server`)**。JP Core にプロファイルが
    無い型なので HL7 基本定義 + 手書きバリデータで、`Goal.achievementStatus` は preferred 束縛のまま値を縛らない
    (ePath の 1 達成 / 2 未達成(バリアンス) / 3 未評価 がそのまま通る)。計画の木は `partOf` に**祖先すべて**を
    並べる約束にしてあり、`part-of:missing=true` で適用(根)だけ、`part-of=CarePlan/{適用の id}` で木全体が引ける。
    `_include=CarePlan:goal` で目標、`_revinclude=Procedure:based-on` で実施記録が同じ応答で揃う。
    backend の `FhirProxyController::ALLOWED_RESOURCE_TYPES` にも追加済み(2026-09-12)。
- **第 3 段階(提案)**: ePath 形式の出力(EP02 Bundle = 定義、EP12 Bundle = 適用後データ)。§4 の対応表の逆変換(§7 が書かない `activity.outcomeReference` もここで組み立てる)。
  ひな型パス(EP01)の取込(`protocol_base` に URL を残す)。許容経過日数条件・BOM 中分類の UI(パスステップの UI は §3.1 で実装済み)。

## 9. 実装したもの

- backend: `db/migrate/20260912100000〜100500`(6 テーブル)、`app/models/master/pathway*.rb`(6 モデル)、
  `app/controllers/master/pathways_controller.rb`(index / show / create / update / copy / destroy)、`config/routes.rb`、
  `db/seed_data/pathways/900001.json`(腹腔鏡下胆嚢摘出術 4 泊 5 日、病日 5・OAT ユニット 14・観察項目 43・タスク 50)と `db/seeds.rb` の節、
  `spec/requests/master/pathways_spec.rb`(19 件)
- 第 2 段階(適用): `frontend/src/fhir/pathwayApplyHelpers.ts`(§7)、`components/PathwayApplyPanel.tsx`、
  `components/KarteRightPane.tsx`(`pathway-apply` と「クリニカルパス」ボタン)、`api/queries.ts`(`usePathwayApplications` /
  `usePatientPlannedAdmissions` / `useApplyPathway`)、`api/masterQueries.ts`(`useApplicablePathways`)、
  `fhir/pathwayApplyHelpers.ts`(`stampPathwayOrders` / `pathwayOf` / `orderHeaderUrlsOf`)、
  パスタブ: `components/KartePathwayTab.tsx`、`fhir/pathwaySheetHelpers.ts`、`karteUrl.ts`(`pathway` タブ・`parsePathwaySheetView`)、
  `pages/KartePage.tsx`、`api/queries.ts`(`usePathwayApplicationTree`)、`App.css`(`.pathway-sheet*`)、
  日次評価: `fhir/pathwayEvaluationHelpers.ts`、`components/PathwayEvaluatePanel.tsx`、`components/KarteRightPane.tsx`(`pathway-evaluate`)、
  `api/queries.ts`(`usePathwayObservations` / `useRecordPathwayEvaluation`)、`components/NursingPerformModal.tsx`(`ObservationInput` を公開)、
  `fhir/provenanceHelpers.ts`(`buildPathwayApplyProvenanceEntry`)、`fhir/conditionHelpers.ts`(`conditionManagementNumber`)、`App.css`(`.pathway-apply__*`)、
  backend `app/controllers/fhir_proxy_controller.rb` の許可リストに CarePlan / Goal、
  上流(別リポジトリ `fhir-server`)に CarePlan / Goal リソース一式
- 続きと分割(§3.1、2026-09-13): backend `db/migrate/20260913100000_scope_pathway_keys_to_parent.rb`、モデル 3 つの一意性検証、
  `pathways_controller.rb`(日数の数え方)、spec 3 件、`db/seed_data/pathways/900001.json` の作り直し。frontend `fhir/pathwayHelpers.ts`
  (`splitEventDraft` / `propagateSeries` / 概要表の続きの操作)、`components/PathwayEventCard.tsx`、`components/PathwayOverviewTable.tsx`、
  `pages/PathwayEditorPage.tsx`、`fhir/pathwayApplyHelpers.ts`(`pathwayOrderPlan` / `pathwayOrderEnd` / `withPathwayOrderEnd`)、
  `components/PathwayApplyPanel.tsx`、`fhir/pathwaySheetHelpers.ts`・`components/KartePathwayTab.tsx`(識別子でまとめる行・ステップの段・
  実施記録の ☑)、評価・タスク・予定外パネルの病日表示
- frontend: `api/masterClient.ts` / `api/masterQueries.ts`(クリニカルパス節)、`fhir/pathwayHelpers.ts`(選択肢・draft ⇔ API・検証・概要表)、
  `pages/PathwayListPage.tsx`、`pages/PathwayEditorPage.tsx`、`components/PathwayEventCard.tsx`(病日 + OAT ユニット)、
  `components/PathwayOverviewTable.tsx`、`components/PathwayTaskTemplateModal.tsx`、`App.tsx`(マスタメンテ > クリニカルパス > パス定義、`/pathways` 3 ルート)、
  `App.css`(`.pathway-*`)

### 9.8 検証したこと(サンプルパスの雛形一式、2026-09-12、テスト次郎)

- 900001 の 32 タスクに雛形を入れ、テスト次郎の入院予定(2026-09-20)に適用。オーダー区画に 32 件が病日の日付で並び、
  すべてのフォームが保存値から復元される(医薬品・検査項目・術式・食種・製剤の名称まで)。
- 一括適用 → 上流に 32 のヘッダ(検体検査 2・放射線 1・生理 1・病理 1・処置 1・手術 1・輸血 1・注射 5・処方 3・食事 4・
  看護指示 10・他科依頼 1・栄養指導 1)、MedicationRequest 8、CarePlan 76、Procedure 53。日付は 09/20〜09/24 の 5 病日に分かれ、
  雛形を持つ 32 タスクの Procedure すべてが `basedOn` にオーダーを持つ。
- 輸血だけは適用の行を開いて同意書の確認を入れないと登録できない(検証で止まる。仕様どおり)。
- 検証データ(適用の木・オーダー・入院予定)はすべて削除済み。

### 9.7 検証したこと(オーダー雛形の 10 種別、2026-09-12、テスト太郎)

- 検証用のパス 900002(病日 1、OAT ユニット 1、タスク 2)を作り、雛形モーダルを開くと種別の既定が
  タスク分類から決まる(ケア項目 NC01 → 看護指示、食事 MLBR → 食事)。看護指示に指示内容、食事に食種を入れて「この内容にする」。
- 保存した `order_values` は `problem: null` で日付が空、`order_label` は「離床開始、初回歩行は2名で介助」「五分粥食1000kcal、朝から」。
- 承認してカルテから適用 → オーダー区画に 2 件が病日の日付(入院日 2026-08-22)で並び、適用すると上流に
  `nursing|inpatient` と `meal|inpatient` が 2026-08-22 で登録される。どちらもヘッダに `pathway-instance` の identifier と
  `pathway-order` 拡張(パス名)、入院 Encounter、来歴 1 件。タスクの Procedure は `basedOn` に 観察項目の CarePlan と
  ServiceRequest の両方を持つ。パスタブのシートでタスク行のセルが「依頼済」になる。
- 検証で作ったパス 900002・セット・上流のリソースはすべて削除済み(900001 の適用は残す)。

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

### 9.4 検証したこと(オーダー雛形の展開、2026-09-12、テスト太郎)

- 雛形付きの検証用パス 000009(1 泊 2 日: 病日 1 に検体検査「血算、HbA1c」とチェックリスト、病日 2 に処方「ガスター散２％」。
  雛形の値は感冒セットのエントリから写した)を作って承認し、同じ入院に適用した。
- 別のパスが進行中の注意が出て、通る。「オーダー」区画に 2 件が病日順に積まれ、開くと検体検査の検査日が 08-22、処方の投与開始日が
  08-23(入院日 + 1)で入っている。
- 雛形が外来で作られていたため処方区分が空で、「適用」→「「退院処方」のオーダーの入力を確認してください」で止まり、その行が開く。
  区分を「退院」にして「適用」→ ペインが閉じる。
- 上流: ヘッダ ServiceRequest 2 件に `pathway-instance` / `pathway-order`(000009)/ `requisition` が入り、occurrence が 08-22・08-23。
  タスクの Procedure 3 件のうち雛形付き 2 件は basedOn が [CarePlan, ServiceRequest]、チェックリストの 1 件は [CarePlan]。
  Provenance は適用の CarePlan に 1 件、オーダーに 1 件。カルテの 08-23 に退院処方のカードが出る。
- 検証データは上流で削除(木・オーダー・明細・来歴を参照で辿って `Fhir::Repository.delete`)し、000009 も消した。
  コンテナ内 `tsc -b` 成功。

### 9.5 検証したこと(パスタブ、2026-09-12、テスト太郎)

- 「パス」タブに 900001 の適用がシートで出る: 列は病日 1〜5(08/22〜08/26、今日は期間外なので強調なし)、行は OAT ユニット 14 と
  その観察項目・タスク(107 行)。長い行見出しは省略記号で切れる。
- 「全画面」で患者情報の下からビューポートの下端まで広がり、URL の view が「適用の id!」になる。Escape で戻り「!」が消える。
- 並び順の拡張を持たない古い適用は行が定義と違う順になったので、上流で削除して UI から適用し直した。適用が終わると
  シートが読み直され、定義どおりの順(身体的準備 → バイタル → 手術・麻酔 → 術前の準備)で並ぶ。

### 9.6 検証したこと(日次評価、2026-09-12、テスト太郎)

- 病日 1「身体的準備ができている」のセル → 右ペインに評価入力。観察項目 2 件(文字)、タスク 4 件(分類バッジ付き)、
  達成状態 3 択、S/O/A/P とコメント、記録日時(現在時刻)。
- 実績「なし」「中止済」、タスク 2 件を実施、未達成(バリアンス)、S/O/A/P とコメントを入れて「記録」→ ペインが閉じ、
  シートのセルに「未達成（バリアンス）」(赤)・実績値・☑ が出る。
- 上流: Goal 1 件(completed、achievementStatus 2、outcomeReference → 評価 Observation)、Observation 3 件(judgement に
  S/O/A/P の component と note、実績 2 件は basedOn → 観察項目の CarePlan、performer = 児玉 義憲)、OAT ユニットの CarePlan に
  goal、Procedure 2 件が completed(performedDateTime・performer)。
- 同じセルを開き直すと全部復元される。達成に変えて「記録」→ Goal と評価 Observation が版 2 に上がり(件数は増えない)、
  セルが「達成」になる。コンテナ内 `tsc -b` 成功。
- 全画面でセルを押すと、右ペインではなくモーダルで同じ評価入力が開く(右ペインは空のまま)。Escape はモーダル →
  全画面の順に閉じる。モーダルから「記録」するとモーダルだけ閉じ、全画面のシートのセルが「達成」に変わる。

### 9.26 検証したこと(バリアンスの通知、2026-09-14)

- 上流の `Task/$validate` に、focus = Observation・basedOn = CarePlan・input に valueDate を持つ `pathway-variance` の Task を送り、
  「valid」が返る(保存はしていない)。
- 型チェックまで。画面で未達成を記録して通知が届くこと・取り下げは確かめていない。

### 9.25 検証したこと(パスシートからの部門の実施入力、2026-09-14)

- 上流の検索(パス 一郎の適用、読むだけ): `_revinclude:iterate` を 2 つ並べると後ろの 1 つだけが効く(`Procedure:based-on` を後ろに
  すると実施記録 3 件だけで Task が返らず、`Task:focus` を後ろにすると Task 11 件だけ)。`Task:focus,Procedure:based-on` とカンマで
  1 つにすると Task 11 件と実施記録(オーダーを basedOn で指す Procedure)3 件が両方返る。
- 型チェックまで。画面での実施入力の登録は確かめていない。

### 9.24 検証したこと(入院患者一覧のパス列と患者ヘッダ、2026-09-13、東3階病棟)

- 上流の検索: `CarePlan?subject=4 人(カンマ OR)&category=パスの印&part-of:missing=true&status=active` で根 4 件。
- 先に病日・未評価件数・バリアンス・終了漏れの印まで出す形で入れたが、患者帯・一覧とも横に長くなり過ぎたため、進行中のパス名だけにした。
  名前だけの形は型チェックまで(画面での確認はしていない)。

### 9.23 検証したこと(オーダーの進み具合を Task で出す、2026-09-13、パス 一郎)

- 不具合: パスシートから注射「術前点滴(細胞外液)」を実施入力しても、セルが「☐ 依頼済」のまま。注射の Task は completed、
  ServiceRequest は active のままで、木の読みが Task を持っていなかった。
- 直した後(読むだけで確認): シートの術前点滴のセルが「☑ 実施済」、手術は「☐ 申込済」、看護指示は「☐ 指示受け待ち」
  (カルテのカードと同じ名前)。日めくりの病日 2 術前でも術前点滴が「実施済」。

### 9.22 検証したこと(カルテのパス評価のカード、2026-09-13、テスト太郎)

- 上流の検索: `Observation?patient&category=パスの印&code=…|judgement&_include=Observation:based-on` は 400(based-on は Observation で
  使えない)。評価の Observation だけを引き、`CarePlan?_id=OAT ユニット 2 件&_include=CarePlan:part-of` で OAT ユニット 2・病日 1・適用 1 が揃う。
  評価 2 件のうち記載があるのは「身体的準備ができている」(S/O/A/P 4 件・コメント 1 件)だけ。
- カルテを開くと 2026-09-12 の日の先頭に「パス評価 / 身体的準備ができている / パス / 15:30 | 達成 | 児玉 義憲」のカード。本文に
  「腹腔鏡下胆嚢摘出術(4泊5日) 病日 1 入院日(2026-08-22)」、S 鼻汁あり・O 体温37.6℃・A・P と「続きを表示」。記載の無い評価はカードにならない。
- メニューは「FHIR JSON 表示」「パスで開く」。「パスで開く」→ パスタブが日めくりの「病日 1 入院日 2026-08-22」で開き、戻るでカルテに戻る。
- 左端のペインの「種別」に「パス評価」が出て、押すとタイムラインがパス評価のカードだけになり URL が `card=pathway-evaluation`。
  最初は種別の一覧(`PLAIN_KINDS`)に足し忘れて出なかったので足した。
- 評価を記録したあとのカードの読み直しは画面では試していない(キーが記録の読み直しの範囲に入ることをコードで確かめた)。
- コンテナ内 `tsc -b` 成功。

### 9.21 検証したこと(指示簿のパスのタスク、2026-09-13、テスト太郎)

- 上流の検索の形を先に確かめた: `CarePlan?category=pathway-level|event&date=2026-08-24&subject=テスト太郎,テスト次郎&_include=CarePlan:part-of`
  で病日 1 件と適用の根、`CarePlan?part-of=その病日&_revinclude=Procedure:based-on` で OAT ユニット 3・観察項目 12・Procedure 11。
- 指示簿を 東3階病棟・2026-08-24・全指示 で開くと、看護指示の表(0 件)の下に「パスのタスク 未実施 11 件」、患者見出し
  「301号室 テスト 太郎(テスト タロウ)腹腔鏡下胆嚢摘出術(4泊5日)」と 11 行(分類・タスク・アウトカム・病日 3 術後1日目)。
  デモの適用は雛形前のものなので、注射・検査・処方も並ぶ。
- 「バイタルサイン測定」をチェック → 行が薄くなり実施者「児玉 義憲 18:50」、見出しが未実施 10 件。上流の Procedure が completed・
  performedDateTime 2026-08-24T18:50:00+09:00・performer 児玉 義憲。「実施予定」ではその行が消え、「未指示受け」では区画が出ない。
  チェックを外して未実施に戻した(デモの適用は元の状態)。
- 氏名 → カルテのパスタブが日めくりの「病日 3 術後1日目 2026-08-24」で開き、戻るボタンが出る。
- コンテナ内 `tsc -b` 成功。

### 9.20 検証したこと(日めくり・進み具合・列幅と位置・実績値の候補、2026-09-13、テスト次郎)

- 900001 の体温・脈拍数・収縮期血圧・SpO2(24 件)に看護観察の管理番号(31001368 / 31001390 / 31001848 / 31000001)を入れ、
  開発 DB の子テーブルを入れ替えた。計画の木だけを入院日 2026-09-12 でテスト次郎に登録し(今日 = 手術当日)、今日 09:30 の体温 37.1℃・
  血圧 124/72 を手入力のバイタルと同じ形で入れた。
- パスタブを開くと日めくりで「病日 2 手術当日 術前 2026-09-13 今日」。見出し帯は 1 行で「進行中 / 未評価 8 / バリアンス 0(押せない)/
  未実施 29 / ケバブ」。体温に「37.1℃(09:30)」、収縮期血圧に「124mmHg(09:30)」の候補、脈拍数・SpO2 は候補なし。
- 候補を押して値を入れ、達成を選び、チェックリスト 2 件を実施にすると「記録(1 件)」、変えたアウトカムの「記載」は押せない。
  「次の日 ›」で術後(URL の view が `~day@病日の id` に変わる)、呼吸・循環を達成にすると「記録(2 件)」。前の日に戻ると入力が残っている。
  「記録」→ 上流に評価 2 件(達成)と実績 2 件(体温 37.1・収縮期血圧 124)、件数が未評価 6・未実施 27 になる。
- 「未評価 6」→ オーバービューに切り替わり(当時。いまは件数をオーバービューでだけ出す)、アウトカム 6 件と配下の行だけに絞られ、今日まだ評価していない最初のアウトカム(疼痛)と今日の列へ寄る。
  左ペイン(表の幅 881px・6 列)では列幅 96px のまま横に送り、全画面(1820px)では 180px まで広がって表が詰め物込みで収まる。
  最初の計算はセルの余白を引いておらず、列が 16px ずつはみ出したので直した。
- 全画面の日めくりは 1100px で止まって中央に置かれ、中で縦に送れる。呼吸・循環の「記載」→ 評価モーダルが日めくりで記録した達成状態で開き、
  観察項目にも同じ候補が出る。Escape で閉じる。
- 表示の切り替えは、グローバルのボタンの地色のため選んでいない側も色付きになっていたので、選んでいない側を透明にした。
- コンテナ内 `tsc -b` 成功。登録した木(CarePlan 92・Procedure 58・Goal 48)、評価・実績の Observation 4 件、バイタル 2 件は削除した。
- 表示の名前を「全体」から「オーバービュー」に変え、件数を日めくりでは出さないようにした。オーバービューで「未実施 29」を押すと
  その件数だけが塗りつぶされて「×」が付き(行 94 → 37)、もう一度押すと枠線だけに戻って行も戻る。「未評価」を押したまま日めくりに
  切り替えると件数は消え、オーバービューに戻すと絞り込みは外れている。

### 9.19 検証したこと(日程の変更と適用の取り消し、2026-09-13、テスト次郎)

- 900001 をテスト次郎の入院予定(2026-09-20)に画面から当てた(輸血を除くオーダー 31 件)。適用直後の「日付違い」は 0 件。
- 日程の変更: 見出し帯のケバブ →「日程の変更」。起点を「2 手術当日 術前」、新しい日付を 09-22 にすると「1 日後ろ」、病日 2 術前〜5 の
  今の日付 → 新しい日付、看護指示・食事 14 件(臍処置 09-20〜09-20 → 09-20〜09-21、病棟内フリー 〜09-21 → 〜09-22、食止め
  09-21〜09-22 → 09-22〜09-23 など)、日付を直すオーダー 13 件(注射・手術・病理・検査・処方・処置・栄養指導)。「変更する」→
  病日 1 はそのまま、2〜5 の CarePlan が版 2 で 1 日後ろ、タスクの予定日も同じ、看護指示・食事 14 件が版 2、来歴 UPDATE が付く。
  シートの見出しが 09/20・09/22・09/23・09/24・09/25 になり、13 件のタスクのセルに「日付違い」(ツールチップは元の開始日)。
- 止める条件: 病日 3 のチェックリストを実施済みにすると、起点「術前」では「病日 3 に実施済みのタスクがあります」で変更できず、
  既定の起点が病日 4 になる。09-20 を選ぶと「病日 1(2026-09-20)と同じか前の日付にはできません」。取り消しも同じ理由で押せない。
- 適用の取り消し: 最初の作り(種別ごとの削除の hook を順に呼ぶ)では 17 件目で上流の「Rate limit exceeded」になった。
  本体を順に呼んで最後に 1 回読み直す作りに直し、開き直すと残り 14 件が一覧に出て、続きから取り消せた。改めて当て直し、
  31 件を通しで取り消すと 12 秒で完了し、シートは「クリニカルパスは適用されていません。」。テスト次郎の CarePlan・Goal・
  オーダー・明細・MedicationRequest・看護指示の Task・テンプレートの記入は 0 に戻り、検証前からあった Procedure 1・
  ServiceRequest 2・Appointment 1・Task は残った。検証用の入院予定は削除した。
- コンテナ内 `tsc -b` 成功。

### 9.18 検証したこと(続きの線と矢印、2026-09-13、テスト次郎)

- 900001 の計画の木だけ(オーダーなし、入院日 2026-09-12)をテスト次郎に登録してパスタブを全画面で開いた。
  「呼吸・循環が安定している」のチップと体温〜SpO2 の ○ が術後 → 術後 1 日目 → 術後 2 日目の 3 セルで線につながり、2 日目の手前に矢じり。
  弾性ストッキング着用は術後 → 術後 1 日目、バイタルサイン測定は 1 日目 → 2 日目、創部の出血・感染は術後 → 退院日の 4 セル。
  1 日だけのタスク(酸素投与・術後点滴など)には線が出ない。今日(手術当日)の列の強調の上でも線が見え、明るいテーマでも見える。
- 線を枠線(`border-top`)で引くと 0 幅になった(疑似要素の枠線が効かない)ので、1px の背景の帯と `clip-path` の三角形で描いた。
  また App.css の `--text-muted` は定義が無い(既存の 14 か所も親の色を受け継いでいるだけ)ので、線の色は `--text` にした。
- コンテナ内 `tsc -b` 成功。登録した木(CarePlan 92・Procedure 58・Goal 46)は削除した。

### 9.17 検証したこと(同じ名前の続きへのまとめと、評価パネルの看護指示、2026-09-13、テスト次郎)

- 同じ名前のまとめ: 病日 1〜3 に別々の識別子で「疼痛が自制内である」(観察項目「疼痛(NRS)」、適正値 3 以下 / 2 以下 / 1 以下、
  タスク「疼痛の評価」)を置き、病日 2 に同じ名前をもう 1 つ、病日 3 に雛形付きの同名タスクと重要・コードを持たせた下書きを API で作った。
  概要表に「同じ名前を続きにまとめる」が出て、押すとアウトカムが 1 行(●●●)になり、病日 2 の 2 つ目と雛形付きタスクは別の行のまま。
  ボタンは消え、カードに「病日 1・2・3」の印。病日 3 の重要・コードは病日 1 の値(なし)に揃う。保存 → API で 3 日分の unit_key・
  assessment_key・task_key が揃い、タスクの結ぶ観察項目も付け替わり、適正値は 3 以下 / 2 以下 / 1 以下のまま。下書きは削除した。
- 評価パネル: 900001 をテスト次郎の入院予定に当て、弾性ストッキング着用の術後 1 日目のセルから実施記録を入れた。
  呼吸・循環の評価を開くと、術後は弾性ストッキング・酸素投与・ベッド上安静が未チェックで押せず、術後 1 日目は弾性ストッキングが
  チェック済みで押せない。チェックリストと注射・検査のタスクは今までどおり押せる。
- コンテナ内 `tsc -b` 成功。検証で作った適用の木・オーダー・明細・来歴・実施記録・看護指示の Task・入院予定はすべて削除した。

### 9.16 検証したこと(続きと分割、2026-09-13、テスト次郎)

- backend: `RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec spec/requests/master/pathways_spec.rb`(コンテナ内)22 件成功。同じ識別子を
  別の病日に置ける(適正値は日ごとに保たれる)、同じ病日の中で重なれば 422、同じ病日を術前 / 術後に分けて `event_key` が `2` / `2-2`、
  日数は 1 日と数える。開発 DB に migration を当てて backend を再起動。
- 開発 DB の 900001 は承認済のまま、子テーブルを作り直した JSON で入れ替えた(病日 6・ユニット 22・観察項目 46・タスク 58)。
- 定義画面(900001 を API で複製した下書き、確認後に削除): 概要表に続きが 1 行で並び、手術当日の 2 列に「術前」「術後」。
  「経口摂取が再開できる」の病日 4 のセル → 病日 4 のカードにアウトカムがタスクごと足され、印「病日 3・4」。タスク「飲水開始」の行は
  アウトカムの無い日のセルが押せず、病日 4 のセルで外す / 足すが切り替わる。病日 3 のカードでアウトカム名を変えると病日 4 も変わり、
  疼痛の適正値だけを変えると他の日は変わらない。病日 3 のケバブ「この日を分割」→ ステップ 2 のカードができ、両方にステップ名の欄。
  ステップ 2 に疼痛の続きを置いて「夜間」と名付けて保存 → API で `3-2 夜間` に同じ unit_key、適正値は病日 3 から写った値。
- 適用(テスト次郎の入院予定 2026-09-20 を作って当て、確認後にすべて削除): オーダー区画に 32 件、見出しが「手術当日 術後〜術後1日目
  2026-09-21〜2026-09-22 / 弾性ストッキング着用」のように範囲と終了日を持つ。輸血を除外して適用 → 上流に CarePlan 92(根を含む)・
  Goal 46・Procedure 58・ヘッダ 31。看護指示・食事の終了: 臍処置 09-20、病棟内フリー 09-21(次のベッド上安静が術後から)、
  弾性ストッキング 09-21〜09-22(タスク 2 件が同じオーダーを指す)、ベッド上安静 09-21、離床介助 09-22〜09-23、病棟内歩行は終了なし、
  常食 09-20 夕のみ、絶飲食 09-21 朝〜09-22 朝、五分粥 09-22 昼〜夕、全粥は終了なし。
- パスタブ: 見出しの「2 / 手術当日 / 09/21」が 2 列にまたがり、その下に「術前」「術後」。呼吸・循環・疼痛・創部の行が術後から横に並び、
  弾性ストッキングは術後と術後 1 日目の 2 セルに「依頼済」。術後 1 日目のセルから実施記録(着用)を入れると、そのセルだけ ☑。
  疼痛(NRS)は適正値が日によって違うので行見出しに出ず、セルのツールチップが 3 以下 / 3 以下 / 2 以下。評価の見出しが
  「病日 2 手術当日 術後 2026-09-21」。見出し帯は「病日 5 日分」。
- コンテナ内 `tsc -b` 成功。検証で作った適用の木・オーダー・明細・来歴・実施記録・看護指示の Task・入院予定はすべて削除した。

### 9.15 検証したこと(観察項目の適正値、2026-09-13、テスト太郎)

- 開発サーバーのモジュールをブラウザから読み込み、900001 で `buildPathwayApplyBundle` を組むと 172 entry
  (CarePlan 76・Goal 43・Procedure 53)。観察項目の CarePlan 43 件すべての `goal` が同じ Bundle の Goal の fullUrl を指し、
  Goal が先に並ぶ。Goal は `assessment-goal-id`・`target.measure`(BOM コード)・`target.detailString`(例「なし」)を持つ。
- デモの適用(テスト太郎、入院 2026-08-22)は適正値の Goal を持たない時期のものなので、`buildAssessmentGoal` で
  同じ形の Goal 43 件を作り、観察項目の CarePlan に `goal` を足す PUT と組にして上流へ送った(11 件ずつ 4 transaction、
  すべて 201 / 200)。
- シートの木の検索(`_include=CarePlan:goal` 付き)で Goal 45 件(観察項目 43 + アウトカム 2)が届き、
  `parsePathwayApplication` で 43 件すべての `properValue` が読める。
- パスタブ: 観察項目の行見出しに「体温 37.5℃未満」「脈拍数 60〜100/分」のように適正値が控えめな文字で並び、
  セルのツールチップが「適正値: …」。評価のモーダルの観察項目が 名称 / 適正値 / 入力欄 の 3 列になる。
- 同じ観察項目で病日によって適正値が違う木(3 以下 / 3 以下 / 2 以下)を `buildPathwaySheet` に通すと、行の
  `properValue` は空で、セルごとに値を持つ。揃っている行は行に値が入る。
- コンテナ内 `tsc -b` 成功。

### 9.14 検証したこと(予定外のタスクのオーダー、2026-09-13、テスト太郎)

- 「予定外を追加」→ タスクを 1 行足すと、分類 2 つ・名称・オーダー種別(17 種から選ぶ)・外すが 1 行に並ぶ。
  種別は既定が「オーダーなし」で、選ぶとその登録フォームが下に開く。
- 病日 3(術後 1 日目 2026-08-24)に「創部感染の徴候がない」+ タスク「創部処置」(治療 / 処置)を置き、
  種別に処置を選んで「創傷処置(100cm2 未満)」を 1 件入れて「追加する(オーダー 1 件)」。
- 上流: オーダーのヘッダ ServiceRequest に拡張 `pathway-order`(900001・パス名)と identifier `pathway-instance`、
  `requisition` が入り、その値は適用の識別子の後半と一致。実施日は病日の日付(2026-08-24)。
  タスクの Procedure の `basedOn` は [観察項目の CarePlan, ServiceRequest] の 2 件。来歴(CREATE)も 1 件付く。
- シートに「★なし 創部感染の徴候がない 未評価 予定外」の行が出て、タスクのセルが「☐ 依頼済」。
  カルテのカードには「パス」のバッジが出る(ツールチップはパス名)。
- 病日を選び直すとフォームの実施日が追随する(2026-08-25 → 2026-08-24)。フォームの中で後から足した明細は当日のまま。
- 他科依頼を選んで「テンプレート」を開くと重なりが 2 枚になり、その間の Escape では予定外の入力が閉じない。
  テンプレートを × で閉じてから Escape を押すと閉じる。
- コンテナ内 `tsc -b` 成功。検証で作った 5 リソース(CarePlan 2・Procedure 1・ServiceRequest 2)と来歴は削除し、
  デモの適用は元の状態(CarePlan 76・Goal 2・ServiceRequest 263)に戻した。

### 9.13 検証したこと(カルテのカードのパスの印、2026-09-13、テスト太郎)

- 既存の検体検査オーダー 1 件に拡張 `pathway-order` だけを足して確かめた(適用を作り直さずに表示だけを見るため。
  確認後は `_history` の版 1 を PUT して戻した)。
- カルテのカードの見出しに「パス」のバッジが 1 つ出て、ツールチップが「クリニカルパス: 腹腔鏡下胆嚢摘出術 4泊5日」。
  印の無いカード 18 件には出ない。
- バッジはプロブレムのバッジと同じ形・大きさで、地色だけ敷いてある。見出しの幅を押し出さない。
- コンテナ内 `tsc -b` 成功。

### 9.12 検証したこと(SOAP・自由記載とテンプレート、2026-09-13、テスト太郎)

- 病日 1「手術・麻酔について理解できる」のセル → 評価のモーダル。記載の形式は SOAP が既定で、S/O/A/P の 4 欄それぞれに
  「テンプレート」が付く。自由記載に切り替えると記載欄が 1 つになる。
- 自由記載で「テンプレート」→ 「テンプレート記載」→ 「テスト１ (v1.0.0)」を選んで回答を入れ「記載を反映」→ 平文
  「ほげですか？: ほげ」が欄に入り読み取り専用になり、ボタンが「テンプレート編集」「解除」に変わる。回答を入れずに
  反映すると平文が空になる(テンプレートの回答が空なら平文も空、という当たり前の挙動)。
- 「記録」→ 評価 Observation の component が `comp-assessment` 1 件になり、拡張 `pathway-evaluation-template` が
  QuestionnaireResponse を指す。QR は status completed・subject = 患者で同じ transaction に入っている。
- 開き直すと形式(自由記載)・平文・テンプレートの結び付き(読み取り専用 +「テンプレート編集」「解除」)が復元される。
- 「解除」→ 欄が編集できるようになり平文は残る。手で書き換えて「記録」→ component から拡張が消え、外れた
  QuestionnaireResponse は 404(DELETE 済み)。
- SOAP に切り替えて S に手書き・O にテンプレートを入れて「記録」→ component は S(拡張なし)と O(拡張あり)の 2 件だけになり、
  `comp-assessment` は消える。新しい QR が 1 件できる。
- コンテナ内 `tsc -b` 成功。検証で作った評価(Observation・Goal・QR)は削除し、デモの適用は元の状態
  (アウトカムの Goal 2 件・CarePlan 76)に戻した。

### 9.11 検証したこと(予定外の OAT ユニット、2026-09-13、テスト太郎)

- 見出しの「予定外を追加」→ モーダル。既定の病日は今日の病日(パスの期間外なら先頭)。空のまま押すと
  「アウトカムを入力してください」で止まる。
- 病日 3(術後 1 日目 2026-08-24)に「創部感染の徴候がない」(重要)+ 観察項目「創部の発赤・腫脹」+
  タスク「創部の観察を 1 日 2 回」(ケア項目 / 清潔ケア)を追加 → 上流に CarePlan 3 件(アウトカム・観察項目・
  観察項目なしの包み)と Procedure 1 件。アウトカムの拡張は `CriticalIndicator=Y` `UnplannedKind=Y`、並び順 4。
  タスクの予定日は病日の日付(2026-08-24)、状態は未実施。
- シートに「★ 創部感染の徴候がない 未評価 予定外」の行が出て、観察項目とタスクがぶら下がる。セルを押すと
  日次評価がそのまま開き、観察項目とタスクが並ぶ。
- 検証で足した 4 リソースは削除済み(デモの適用は元の 76 CarePlan に戻した)。

### 9.10 検証したこと(パスの終了・中止、2026-09-13、テスト太郎)

- シートの見出しの「終了・中止」→ モーダル。中止を選ぶと理由の欄が出て、空のまま押すと「中止の理由を入力してください」で止まる。
- 理由と総合評価を入れて「中止にする」→ 適用の CarePlan が `revoked` + `period.end`、Goal が `cancelled` +
  `EPathGoalStatusReason = 2 中止` + `statusDate` + note 2 件(「中止理由: …」と総合評価)。見出しが「中止 2026-09-13」になる。
- 開き直すと区分・日付・理由・総合評価が復元され、ボタンが「記録し直す」「進行中に戻す」になる。
- 「終了にする」で日付を 2026-08-26 にすると `completed` + `EPathPathClosingTypeCS 1 終了`。終了したパスは同じ入院に
  当て直せる(適用パネルの二重適用の注意が出ない)。
- 「進行中に戻す」で `active` に戻り `period.end` が消え、適用の Goal が 0 件になる。アウトカムの Goal 2 件と
  評価の Observation 4 件はそのまま(デモデータを元の状態に戻した)。

### 9.9 検証したこと(セルの振り分けとモーダルへの統一、2026-09-13、テスト太郎・テスト次郎)

- テスト太郎(雛形なしの適用): オーダーを持たないタスクのセル → 「クリニカルパス(タスク)」のモーダル。「実施済にする」で
  セルが ☑ に変わり、開き直すと「実施済 2026-09-13 00:13」、「未実施に戻す」で ☐ に戻る。観察項目のセルは押せない。
  アウトカムのセル → 評価のモーダル(右ペインは空のまま)。Escape で閉じる。
- テスト次郎(雛形つきの適用を入院予定 2026-09-20 に当てて確認後に削除):
  - 検体検査のタスク → 「検体検査内容」のモーダル(操作は「編集」だけ)。注射・輸血 → 「注射内容」「輸血内容」に
    「編集」と「実施入力」。看護指示 → 実施記録のモーダルにその指示だけが並ぶ。
  - 注射の「実施入力」→ 詳細の上に「注射の実施入力」が重なり、RP とオーダー量が入った状態で開く。Escape は実施入力 →
    詳細の順に閉じる。
  - 「編集」→ モーダルが閉じて右ペインに「放射線検査編集」が開く。全画面から押したときは全画面を抜ける。
  - 全画面でも詳細・評価はモーダルで開き、Escape で閉じても全画面のまま。もう一度 Escape で全画面を抜ける。

## 10. 申し送り

- 予定外のアウトカムは後から名前を直せない(消す手段も無い)。誤りは上流のリソースを消して入れ直す。
- 日程の変更で自動でずらすのは看護指示・食事だけ。その他のオーダーは「日付違い」を見て 1 件ずつ編集で直す。
  看護指示・食事の終了は日付だけを見てずらすので、前日の夕で終わる食事も後ろへ延びる(空いた日は前日の食事が続く)。
- 適用の取り消しでは、適用とオーダーの来歴(Provenance)は残る(参照先のリソースは消えている)。
- パスの終了・中止は手で記録する。退院(Encounter の終了)や最終病日の到達で自動的に終わることはしていない。
- 中止理由は自由文。ePath にも理由のコード表は無いが、施設で定型化するならローカルの選択肢を足すことになる。
- パスシートのオーダー詳細から実施入力へ進めないのは、検体検査・病理・細菌検査・他科依頼(部門の一覧に実施入力が無い、または
  結果の登録で終わる種別)と、食事・処方(経過表で記録する)。
- 部門の実施入力はオーダーの実施日 1 日ぶんの部門一覧を引いて行を探すので、一覧の件数上限を超える日は見つからないことがある。

- BOM(Basic Outcome Master®)は日本クリニカルパス学会の知財で同梱しない。IG に載っている分類(G/H、19/34/37)と例示コードだけを候補に出す。
  施設が BOM の利用許諾を持つなら、コード体系 BOM でコードを手入力できる。
- 病日単位の入外区分・許容経過日数条件は列だけ持ち、UI には出していない(ePath 出力時は `setting` を各病日に写す)。
- 続き(§3.1)にする前に作った適用は、同じ名前のアウトカムでも識別子が日ごとに違うので、シートで別の行になる(当て直さない限りそのまま)。
  定義は概要表の「同じ名前を続きにまとめる」で揃えられる。
- 分けたステップを消しても残りのステップ番号は詰めない(`2-2` だけが残ることがある)。適用後の識別子に使うので動かさない。
- 継続するタスクのまとめ方は task_key が隣り合う病日に置かれているかで決まる。間の病日で外すと、その前後で別のオーダーになる。
- 食事・安静度の終了は「後に並ぶ同じ種類のオーダーの直前」なので、同じ病日に食事タスクを 2 つ置くと並び順で終了が決まる。
  経過表・指示簿で出した食事・安静度(パスの外のオーダー)は終わらせない。
- 看護指示以外のタスク(チェックリスト)の ☑ はタスク 1 件の状態なので、同じチェックリストを続く病日に置いても日ごとに記録する。
- 観察項目の「コード」欄はコード体系を選ぶまで disabled だが、ブラウザ自動化(`form_input`)では値が入る。手入力では起きない。
- 雛形モーダルの中で種別を切り替えると空のフォームになる(前の種別の入力は残らない)。
- 10 種別の雛形のうち、適用して上流に登録するところまで確かめたのは看護指示と食事(§9.7)。手術・輸血・細菌・病理・内視鏡・
  リハビリ・栄養指導・他科依頼は雛形モーダルでフォームが出て要約が入るところまで。
- 食事の雛形は、パスの外で既に出ている食事オーダーを終わらせない(パスの中の食事どうしは §5.1 の規則で終える)。
- 手術の雛形は手術室の重なり検査を通らないので、適用後に手術カレンダーで確かめる。輸血の雛形は適用の行を開いて同意書の確認を入れる。
- オーダー雛形の `order_values` はフォーム値そのものなので、医薬品マスタの行(価格・薬効分類など)が丸ごと入る(オーダーセットと同じ)。
  マスタ差し替え後はコードで引き直す(名前は自己修復するが廃止は分からない)。
- 概要表のタスクは大分類ごとに並べるので、同じ識別子のタスクの大分類を途中で変えると(続き全体で揃うので)行ごと別の区画へ移る。
- 削除の確認は `window.confirm`(他画面と同じ)。
- パスの適用そのものの来歴には承認待ちの通知を付けていない(雛形から出したオーダーには通常どおり付く)。
- オーダーセットから出したオーダーのカルテのカードには「セット名」のバッジを出していない(パスの印と同じ作りで足せる)。
- 日めくりは達成状態・実績・タスクの実施までで、記載(SOAP・自由記載)とコメント・記録日時の変更は評価モーダルで行う。
- 実績値の候補は看護観察に結んだ観察項目だけ(BOM・ローカルのコードからは引かない)。
- 指示簿の「パスのタスク」は、オーダー雛形を持たないタスクをすべて出す。観察系のタスク(バイタル測定など)を看護指示と同じ流れ
  (頻度・実施の入力・経過表)に載せたいときは、定義で看護指示の雛形にする(そのタスクは上の看護指示の表に出るようになる)。
  テスト太郎のデモの適用は雛形を入れる前のものなので、注射・検査なども「パスのタスク」に並ぶ。900001 は体温・脈拍数・収縮期血圧・SpO2 だけを結んである。
- 実績の Observation は経過表に出ない(category がパスの印だけで vital-signs を持たない。看護観察と同じ判断)。
- 適用が複数ある入院で view の id が古いと最初の適用に戻る(削除した適用の id が URL に残っていても壊れない)。
