# 化学療法レジメンの設計

**状態: 第 1 段階(レジメンマスタの登録)、第 2 段階(レジメンオーダー = 患者への適用、§7)とも実装済(2026-09-06)。**
本文中の区別は他の設計書と同じ(［事実］/［導出］/［決定］/［提案］)。

---

## 1. レジメンとは何か = マスタであってオーダーではない

| | オーダーセット | レジメンマスタ | レジメンオーダー(§7) |
|---|---|---|---|
| 何を表すか | 医師が育てる「いつも出す組み合わせ」 | 審査委員会で承認した施設共通の治療計画の雛形 | 患者に対する化学療法の指示 |
| 保存先 | backend DB(jsonb のフォーム値) | backend DB(正規化テーブル) | 上流 FHIR(ServiceRequest / MedicationRequest ほか) |
| 持ち主 | 院内共通 / 診療科 / 医師 の 3 段階 | 院内共通のみ(診療科は分類属性) | 患者と依頼医師 |
| 中身の解釈 | backend は解釈しない | backend が解釈する(薬剤名の解決・薬剤での検索) | — |

- ［事実］レジメンは審査委員会の承認を経て運用する施設共通の参照表で、医師個人が勝手に作るものではない。
  オーダーセットの 3 段階の持ち主は要らない。診療科・がん種(適応疾患)は分類属性として持ち、承認状態と承認日・承認者を持つ。
- ［決定］オーダーセットのように既存フォームの値を jsonb で持つ方式は採らない。mg/m² のような算出基準・上限値・薬剤の種類・
  相対日はどの既存フォームにも無く、backend 側で「この薬剤を含むレジメン」を引けることにも価値があるため、化学療法専用の
  正規化テーブルを持つ(§2)。
- ［決定］薬剤は「投与ステップ → 薬剤」の 2 階層。ステップは注射オーダーの RP(同じルートから同時に投与する薬剤のまとまり = 混注)に
  相当し、順序・相対日・手技・経路・点滴時間・器材はステップが持つ。将来オーダー化するとき `InjectionRpValues`
  (`frontend/src/fhir/injectionHelpers.ts`)に 1 対 1 で写せる(§3)。

### 1.1 命名

- **レジメン**(`regimen`)… 本ドキュメントの主題。抗がん剤・補液・制吐剤などの薬剤と、スケジュール・適応基準・副作用の束。
- **投与ステップ**(`step`)… レジメンの中の 1 回の投与単位(1 ボトル・1 ワンショット・1 処方)。注射の RP と同じ概念。
- **1 クール**… 投与期間 + 休薬期間。`cycle_days` は保存せず和として導出する。
- **相対日(Day)**… 1 クールの中の何日目か(1 始まり)。ステップが配列で持つ。

---

## 2. 保存の構造

```text
master_regimens                  … 本体
  regimen_code   unique(空なら 6 桁数字で自動採番。他マスタと同じ)
  name / short_name / name_kana
  department_code / department_name   診療科(非正規化。surgery_room_blocks と同じ持ち方)
  purpose        neoadjuvant | adjuvant | curative | palliative | other   治療目的
  setting        outpatient | inpatient | both                            実施区分
  treatment_days / rest_days     投与期間・休薬期間(日)。1 クール = 和
  planned_cycles                 予定クール数(NULL = 継続)
  emetic_risk    high | moderate | low | minimal                          制吐リスク分類(JSCO の区分)
  status         draft | approved | retired、approved_on、approved_by
  indication_note / discontinuation_criteria / dose_reduction_criteria / references_note   自由記述
  valid_from / valid_to / display_order / note / search_*
master_regimen_indications       … 適応疾患。病名マスタの管理番号 + 表示用の名称・ICD10
master_regimen_steps             … 投与ステップ(注射 RP 相当)
  display_order(投与順序) / name(見出し)
  days           jsonb [1, 8, 15]     相対日の配列
  usage_type     drip | one-shot | oral
  route_code / method_code / line_code       注射(既存の ROUTE_OPTIONS / METHOD_OPTIONS / LINE_OPTIONS のコード)
  infusion_minutes / rate(mL/h) / device_note(器材)
  usage_code / dose_days                     内服(用法コード・投与日数)
  note                                       投与時注意
master_regimen_drugs             … ステップの中の薬剤(step_id で結ぶ。regimen_code は検索用の冗長列)
  drug_role      anticancer | fluid | antiemetic | premedication | supportive | other
  medicine_code  → master_medicines
  dose_basis     bsa(mg/m²) | weight(mg/kg) | auc | fixed(mg/body) | unit(製剤単位)
  dose_value(基準値) / dose_unit / dose_max(上限値)
master_regimen_lab_criteria      … 適応基準のうち検査結果値
  category       renal | hepatic | blood | other
  analyte_code   JLAC11 分析物 5 桁(空可。CCr など計算値は名称だけ)、item_name、unit、lower_limit、upper_limit
master_regimen_adverse_events    … 副作用(term = CTCAE 用語の自由記述、grade 1〜5)
```

- ［決定］外部キーは張らず、子は `regimen_code`(薬剤は `step_id`)で結ぶ。整合性はコントローラの transaction で守る(他マスタと同じ)。
- ［決定］子は **配列を丸ごと置換**する(`order_sets` の entries と同じ)。`create` / `update` は本体 + 子を 1 リクエストで受け、
  送られてきた種別だけ置換し、`display_order` は配列順で振り直す。子の検証に落ちたら本体も登録しない。
- ［決定］薬剤名・薬価算定単位・YJ コードは保存せず、詳細 API が薬剤マスタを LEFT JOIN して添える(`Master::RegimenDrug.with_names`、
  `rad_dataset_detail.rb` と同じ)。内服の用法名も用法マスタから添える。適応疾患の病名・ICD10 だけは表示用に写す
  (病名マスタは差し替えが前提で、管理番号だけでは一覧が出せなくなるため)。
- ［決定］1 クールの長さは投与期間と休薬期間で持ち、和は導出する。添付図の「インターバル = 投与期間 + 休薬期間」をそのまま表にした。
  投与日が 1 クールを超えるステップは画面で止める(backend は日数を知らないので検証しない)。

## 3. 投与ステップ = 注射 RP との対応

| ステップ | `InjectionRpValues` | 備考 |
|---|---|---|
| `usage_type` drip / one-shot | `usageType` | oral は処方(`RpValues`)へ |
| `route_code` / `method_code` / `line_code` | `routeCode` / `methodCode` / `lineCode` | コード表を共用(`injectionHelpers.ts`)。手技は `methodForRoute` で経路から自動 |
| `infusion_minutes` | `infusionHours` | 分 → 時間。総投与量から `infusionRate` で速度を出す |
| `rate` | `rate` | レジメンが速度を指定するときだけ入る(空なら総量 ÷ 時間) |
| `days` | — | オーダー化時に開始日 + (day − 1) で実日付に展開する。注射の連日展開(`injectionDates`)の相対日版 |
| drugs `dose_value` × 算出基準 | `medicines[].dose` | **単位が違う**。レジメンは mg/m² など、注射は薬価算定単位(瓶・管)。オーダー化には体表面積 → mg → 製剤数の換算が要る(§7) |
| `device_note` | — | 注射側に器材の入力が無い。オーダー化時は用法コメントに写す |

## 4. 投与量の算出基準と単位

- ［事実］化学療法の用量は体表面積あたり(mg/m²)が多く、体重あたり(mg/kg)、AUC(カルボプラチン、Calvert 式)、固定量(mg/body、
  分子標的薬など)、製剤単位(補液 1 袋)が混在する。基準の種類が無いと「基準値 85」を解釈できないので `dose_basis` を必須にした。
- 上限値(`dose_max`)は基準値と同じ単位で、ビンクリスチン 2 mg のような「体表面積で計算しても超えない量」。基準値以上でなければ登録できない。
- 画面では薬剤を選んだとき、注射容量 100 mL 以上の袋・瓶・キット(輸液)は「補液・溶解液 / 製剤単位 / 1 [薬価算定単位]」、
  それ以外は「抗がん剤 / 体表面積 / mg」を既定にする。名称の「点滴静注用」では判定しない(レボホリナート点滴静注用のような主薬が
  補液になるため)。種類も基準も後から直せる。

## 5. 適応基準

- ［決定］検査結果値の基準だけ構造化し(検査項目 + 下限 / 上限)、中止基準・減量基準・適応の補足は自由記述にした。
  第 1 段階では表示のみで、将来の投与前チェック(§7)がこの行を読む。
- 検査項目は JLAC11 の分析物 5 桁で持つ(材料・測定法の違いをまとめる。身長・体重と腎機能の読み取りと同じ流儀)。
  検査項目マスタの選択モーダル(`LabItemSearchModal`)から選ぶと `jlac11_code` の先頭 5 桁と名称・単位が入る。
  CCr のような計算値は分析物を空にして名称だけで持てる。
- 減量レベル表(レベル × 薬剤 × %)は第 1 段階では作らない(§7)。

## 6. 画面

- **一覧**(`pages/RegimenListPage.tsx`、`/regimens`): 名称・カナ / 診療科 / 状態 / 有効期間内のみ で絞り込み、行クリックで編集へ。
  メニューは「マスタメンテ > 化学療法 > レジメン」(承認制の施設マスタなので、医師が育てるオーダーセット(診療業務)とは置き場を分けた)。
- **編集**(`pages/RegimenEditorPage.tsx`、`/regimens/new`・`/regimens/:id`): 1 レジメン 1 ページ。本体と子をローカルの draft
  (`fhir/regimenHelpers.ts` の `RegimenDraft`)に持ち、「保存」で 1 リクエスト。
  - ［決定］外側を `<form>` にしない。薬剤・病名・用法・検査項目の検索モーダルは非ポータルの `Modal` で、フォームの中に開くと
    入れ子の form が外側の submit を誘発する(オーダーセット登録画面と同じ理由)。保存はボタンの onClick。
  - 検証は `validateRegimenDraft`(画面でしか分からないもの: 薬剤未選択・投与日の書式と重複・クール外の投与日・上限 < 基準値)に閉じ、
    `useValidationError` + `ErrorBanner` で出す。サーバーの検証(名称必須・有効期間の前後など)は `{errors}` をそのまま出す。
  - 読み込んだレジメンの id が変わったときだけ draft を作り直す(同じ id の再取得で入力中の値を上書きしない)。保存後は返ってきた
    詳細で draft を作り直す(採番されたコードと解決された名称を反映)。
  - ステップのカードは「見出し・投与日・用法種別」の行 + 用法(注射: 経路・手技・ライン・点滴時間・速度・器材 / 内服: 用法・投与日数)
    + 薬剤表。↑↓(ゴミ箱と同じ大きさのアイコンボタン)で順序、＋ 注射 / 内服のステップ で追加。見出し欄のラベルはステップ番号で、
    投与日・用法種別のラベルと同じ行に並べる。select はブラウザ既定の内部余白が input と違うので、画面の中だけ高さを実寸で
    固定して並んだ入力欄を揃えている(通常 30px、表の中 26px)。
  - ［決定］用法(注射: 経路・手技・ライン・点滴時間・速度・器材 / 内服: 用法マスタ・投与日数)は**医薬品の下**に置く。
    処方・注射のオーダー画面がどちらもその並び(医薬品の表 → 医薬品追加 → 用法)で、同じ順に読めた方が迷わない。
    内服の用法は処方と同じ「ラベル + 横 1 行(用法を選択 / 用法名 / 投与日数 N 日分)」にして、用法名が折り返さない幅を取る。
  - ［決定］薬剤 1 件は**表の 2 行**で表す(1 行目 = 医薬品名、2 行目 = 種類・算出基準・基準値・単位・上限値・コメント)。
    医薬品名は「オキサリプラチン１００ｍｇ２０ｍＬ注射液」のように長く、他の入力欄と同じ行に置くと必ず折り返して読みにくい。
    2 行の組は `tbody` で括り、名前行の下罫線を消して 1 件に見せる。
  - **Day 表**(読み取り専用): 列 = Day 1〜1 クール、行 = ステップ(見出しの名前だけ。薬剤名まで出すと横に長く、日の列が押し出される)。
    どの日に何が入るかを ● で示す。内服は開始相対日から投与日数ぶん連続で塗る。
  - 複製は保存済みの内容をサーバー側で写す(未保存の編集は写らない)。新しいコードで下書きになり、承認は引き継がない。

---

## 7. レジメンオーダー(患者への適用)

### 7.1 FHIR の構造

```text
ServiceRequest(ヘッダ = 適用 1 件)          intent = plan、status = active | revoked
  category      order-type|chemo-regimen、prescription-setting|inpatient/outpatient
  code          CodeSystem/regimen(code = レジメンコード、display = 名前)
  identifier    Identifier/regimen-instance = 適用 1 件の uuid
  instantiatesUri  http://fhir-client.local/regimen/{code}(マスタは backend。FHIR 上は URI で指すだけ)
  occurrenceDateTime  最初のクールの Day 1
  extension     StructureDefinition/regimen { cycleDays, treatmentDays, plannedCycles, bsa, height, weight }
  reasonReference / requester / order-department / order-ward / note  他のオーダーと同じ
ServiceRequest + MedicationRequest(日オーダー)  通常の注射・処方そのもの
  requisition   Identifier/regimen-instance = 上と同じ uuid
  extension     StructureDefinition/regimen-order { regimen(→ヘッダ), cycle, day, code, name }
```

- ［決定］日オーダーは**通常の注射・処方そのもの**にする。注射一覧・払出・実施入力・経過表・処方箋・承認は
  何も変えずに動く。どの適用の何クール目の何日目かは、ヘッダに焼く `regimen-order` 拡張と requisition で読む。
- ［決定］日オーダーはヘッダを `basedOn` で指さない。この codebase は「basedOn を持たない ServiceRequest = オーダーのヘッダ」を
  至る所で使っており(`isHeaderEntry`、カルテの `based-on:missing`、部門一覧の振り分け)、basedOn を付けると日オーダーが
  明細扱いになって全部の画面から消える。参照は拡張に置き、上流で検索できない分は患者 + 開始日以降のオーダーを読んで
  画面側で拡張を見る(`useRegimenDayOrders`。1 患者の化学療法は多くても数十件)。
- ［決定］注射の連日展開(`injection-series`)は使わない。Day 1, 8, 15 のような間引きは `InjectionSchedule` で表せず、
  `injectionSeriesDay` が「連日 8 日目」と誤読するため。日オーダーの requisition をレジメンの uuid に差し替え、series の
  拡張は落とす(`stampRegimenOrder`)。注射の編集・中止に出る「この日以降」はレジメンでは出ない(レジメン側が担う)。
- ［決定］ヘッダはカルテのカードにしない(看護指示と同じで、化学療法タブの暦で見る)。`karteTimeline` で外す。
  承認画面には「化学療法」として出る(`orderKindOf`)。
- ［決定］日オーダーのカードは、**種別バッジも「化学療法」**にする(`karteItemKindLabel`)。注射/処方であることより
  「化学療法の一部」であることが先に読めた方がよい。どちらのオーダーかは副題に「mFOLFOX6 C1 Day1 | 注射」と添える。
- ［決定］同じ日の注射ステップは 1 つの注射オーダー(RP = ステップ)、内服ステップは 1 つの処方にまとめる。ステップの
  見出し・器材・投与時注意は RP の用法コメントに写す(注射箋・ラベルに出る)。
- 来歴(Provenance)は `useCreatePrescription` が付ける(ヘッダ + 日オーダーの全ヘッダ + MedicationRequest が target)。

### 7.2 投与量の算出

- 体表面積は DuBois 式(`bodySurfaceArea`)。身長・体重の初期値は直近のバイタル(`useBodyMeasures`)で、画面で直せる。
  変えると全薬剤を出し直す(手で直した投与量も上書きされる)。
- 基準 × 体格 = 量(mg など)→ 上限値で頭打ち → 投与量換算マスタ(`master_medicine_dose_conversions` の `from_unit` = 基準の単位)で
  製剤数(薬価算定単位)に直す(`planDrugDose`)。製剤数は小数第 2 位までで、丸めは薬剤部の運用に任せる。
  ［決定］薬剤コメントに写すのは**力価だけ**(「148.75 mg」)。オーダーに載るのは製剤数(1.49 瓶)なので、
  指示の実体である力価を添える。算出の式は書かない — 体表面積・体重は適用のヘッダに、基準はレジメンマスタに
  残っており、カードや注射箋で毎回読ませるほどの情報ではない。
- ［決定］**入力は力価が基本**。抗がん剤も補液も、指示は「148.75 mg」「250 mL」の形で出すものなので、
  換算マスタで製剤数に直せる薬剤はすべて力価で入力し、製剤数は換算して下に併記する(「≒ 1.49 瓶(1 瓶 = 100 mg)」)。
  「1.49 瓶」だけでは何 mg か読めない。力価を直すと製剤数が追随する。
  - 製剤単位が基準のレジメン設定(補液の「1 袋」)でも、画面では容量・力価に直して入れる。単位は換算マスタにある
    ものから mL → mg → g … の順で選ぶ(`PACK_BASIS_UNITS`)。輸液は容量で指示するのが自然なため。
  - AUC(カルボプラチン)は Calvert 式に GFR が要るので自動では出さないが、力価(mg)を手で入れれば製剤数は出る。
  - 換算を持たない薬剤(規格が読めない粉末バイアルなど)だけ、製剤数を直接入れる(力価は目安として出す)。
- ［決定］**オーダーに保存するのは製剤数**(`doseQuantity` は瓶・錠・袋)。注射・処方の既存フォームは単位を
  `medicine.unit_name` で表示するので、mg で保存すると注射編集画面が「148.75 瓶」と出して破綻する。
  力価は入力と表示のためのもので、下流(カード・注射箋・払出・実施入力)は従来どおり製剤数 + コメントで読む。
- ［決定］**内服の基準値は 1 日量**(処方の用量が 1 日量なので揃える)。カペシタビン 1000 mg/m² なら 1 日 1750 mg → 錠数。
- AUC(カルボプラチン)は Calvert 式に GFR が要るので自動では出さず、手入力を促す(「AUC は手で入力してください」)。
- 換算行が無い薬剤(粉末バイアルで力価が読めないなど)も手入力。理由を行に出す。
- 使った身長・体重・体表面積はヘッダに残す(後から「どの体格で出したか」を辿れる)。

### 7.3 クール

- 適用は「開始日(Day 1)から N クール」を登録する(一度に 3 クールまで)。次のクールは詳細パネルの「第 n クールを登録」で、
  既定の Day 1 は前のクールの Day 1 + 1 クールの日数(移動していればそれに追随)。投与量はそのときの体格で出し直す。
- クールの Day 1 は保存せず、日オーダーの日付 − (Day − 1) から逆算する(`cycleStartDates`)。移動しても矛盾しない。
- 予定クール数に達すると登録ボタンを止める(継続なら止めない)。

### 7.4 中止・移動

- **中止**(日): 注射は注射の Task、処方は処方の Task を `cancelled` にする(既存の中止と同じ器)。「この日のみ / この日以降すべて」。
  実施済は止めない。中止取消は `requested` に戻す。
- **移動**(日): 内容は変えず日付だけ差し替えて同じ id へ PUT(`buildRegimenMoveBundle`。注射の時刻も注射日から決まるので一緒に動く)。
  「この日以降すべて」で後続の日も同じ日数ずらす(延期)。実施済は動かさない。
  - 入口は 2 つ。右ペインの投与日パネル(日付を入れて「移動」)と、**暦のドラッグ＆ドロップ**。
  - ［決定］暦の D&D は HTML5 の drag イベントで、投与日のマス(実施済だけの日は掴めない)を月内の別の日に
    落とすと確認モーダル(`RegimenMoveModal`)が開き、反映範囲(この日のみ / この日以降すべて)を選んで書き込む。
    落とし先は決まっているので、残る選択は範囲だけ。注射の中止と同じ 3 ボタンの形にした。
  - 「暦は表示に徹する」方針の例外。日を掴んで別の日に落とすのは暦でしかできない操作なので、
    ドラッグ状態と確認モーダルだけ暦が持ち、書き込みはモーダルが行う(暦自身は mutation を持たない)。
- **レジメンの中止**: ヘッダを `revoked` にし、未実施の日オーダーをすべて中止にする(1 transaction)。

### 7.5 画面

- **化学療法タブ**(`KarteChemoTab`): 食事と同じ月の暦。適用が複数あればヘッダのタブで切り替える(1 つの暦に重ねない)。
  - ［決定］マスに出すのは**ステップ名**(「前投薬」「オキサリプラチン＋レボホリナート」)で、薬剤名は出さない。
    マスの幅では薬剤名(「オキサリプラチン１００ｍｇ２０ｍＬ注射液」)が読めないため。ステップ名は適用時に
    用法コメントへ写してあるので、マスタを引き直さずに読める(`dayOrderStepNames`)。3 つまでで残りは件数。
  - ［決定］**休薬期間を地の色で示す**。登録済みクールの Day 1(`cycleStartDates`)から各日のクール内の位置を出し
    (`cyclePositionOf`)、投与期間(`treatmentDays`)を過ぎた日に「休薬」と薄い地を敷く。投与の無い日でも
    「C1 Day8」を控えめに出すので、クールの周期が面で読める。
  - 押すと右ペインにその日の操作が開く(オーダーのある日だけ)。掴んで別の日に落とすと移動(§7.4)。
- **右ペイン**: 「化学療法」ボタン → レジメン選択(承認済かつ有効期間内)→ 適用フォーム(`RegimenApplyPanel`)。
  投与内容の表は「種類 / 医薬品 / 基準 / 投与量(力価入力 + 製剤数の併記)」の 4 列(§7.2)。算出の式は画面に出さず
  (基準と投与量があれば読めるので冗長)、薬剤コメントにだけ残す。ステップごとに別のテーブルなので、
  `table-layout: fixed` と明示幅でどのステップでも列位置が揃うようにする(処方内容の表と同じ考え方)。
  暦の「詳細・操作」→ `RegimenDetailPanel`(クール一覧・次クール・レジメン中止)。暦のマス → `RegimenDayPanel`
  (その日のオーダー・編集(注射編集 / 処方編集へ)・移動・中止)。暦は表示に徹し、操作は右ペインに集める(食事と同じ)。
  ［決定］投与日パネルのオーダーの中身は、カルテのカードと同じ組み(`.karte-rp` で RP ごとに薬剤 → 用法)にする。
  同じオーダーを 2 か所で違う形に見せない。「反映範囲」の fieldset は素のままだと周りと揃わないので
  `.injection-scope` にスタイルを当て、注射の編集パネルと共用する。

### 7.6 未実装・今後

- 投与前チェック(`lab_criteria` と直近の検査結果の突き合わせ)。中止・減量基準は表示のみ。
- 減量オーダー(減量レベル表から投与量を出す)。いまは適用時に投与量を手で直す。
- 次クール登録の注射区分・処方区分の既定を前のクールから引き継ぐ(いまは選び直す)。
- クールの完了・レジメン全体の完了(`completed`)。実施記録からクール進行を自動で追う。
- 副作用(CTCAE Grade)の記録。実施入力に Grade を足すか、AdverseEvent を持つか。
- 暦から空いている日に直接オーダーを足す操作(いまはクール単位の登録だけ)。
- 暦の D&D で月をまたぐ移動(いまは表示中の月の中だけ。前後の月に落とすには月を送ってから掴み直す)。
- CTCAE 用語マスタ、治療前検査セット、版管理、併用注意薬、血管外漏出リスク、器材のマスタ化、エクスポート/インポート(第 1 段階からの積み残し)。

## 8. 実装したもの(2026-09-06)

### 8.0 レジメンオーダー(§7)

- backend: `regimens_controller.rb` の詳細で内服の用法をオブジェクト(`usage`)で返す(処方に写すため区分が要る)
- frontend: `fhir/regimenOrderHelpers.ts`(FHIR の構造・投与量の算出・Bundle の組み立て・移動・中止)、
  `fhir/injectionHelpers.ts`(`buildInjectionSingleDayEntries` を公開)、`api/queries.ts`(`useRegimenApplications` /
  `useRegimenDayOrders` / `useUpdateRegimenDayStatus` / `useRevokeRegimen`)、`api/masterQueries.ts`(`useMedicineDoseFactors` /
  `useApplicableRegimens`)、`components/RegimenApplyPanel.tsx`(選択・適用・次クール)、`components/RegimenPanels.tsx`
  (詳細・投与日)、`components/KarteChemoTab.tsx`(暦)、`KarteRightPane.tsx`(`regimen-apply` / `regimen-detail` / `regimen-day`
  と「化学療法」ボタン)、`KartePage.tsx` / `karteUrl.ts`(タブ)、`fhir/karteTimeline.ts`(ヘッダを外す・`orderKindOf`)、
  `KarteTimeline.tsx`(カードの印)、`OrderApprovalPage.tsx`(種別名)、`App.css`


- backend: `db/migrate/20260906100000〜100500`(6 テーブル)、`app/models/master/regimen*.rb`(6 モデル)、
  `app/controllers/master/regimens_controller.rb`(index / show / create / update / copy / destroy)、`config/routes.rb`、
  `spec/requests/master/regimens_spec.rb`(14 件)
- frontend: `api/masterClient.ts` / `api/masterQueries.ts`(レジメン節)、`fhir/regimenHelpers.ts`(選択肢・draft ⇔ API 変換・検証)、
  `pages/RegimenListPage.tsx`、`pages/RegimenEditorPage.tsx`、`App.tsx`(マスタメンテ > 化学療法 > レジメン、`/regimens` 3 ルート)、
  `App.css`(`.regimen-*`)

### 8.1 検証したこと(開発環境、ysnr-dev = 児玉 義憲でログイン)

- mFOLFOX6(内科・緩和・外来・中等度・承認済、適応疾患「結腸癌」、投与 3 日 + 休薬 11 日 = 14 日、12 クール)を画面から登録。
  ステップ 4 件(前投薬: 生食 100 mL + デキサート 6.6 mg + パロノセトロン 0.75 mg、15 分 / オキサリプラチン 85 mg/m² +
  レボホリナート 200 mg/m² in 5% 糖液 250 mL、120 分、投与時注意 / フルオロウラシル 400 mg/m² ワンショット /
  フルオロウラシル 2400 mg/m² 2760 分、器材「携帯型ディスポーザブル注入ポンプ」)、検査基準 3 件(血清クレアチニン ≤ 1.5 は
  検査項目マスタから選択 → 分析物 C3002・mg/dL が入る / 好中球数 ≥ 1500 / 血小板数 ≥ 100000)、副作用 2 件、中止・減量基準、参考文献。
  DB の内容と再読込後の画面が一致(薬剤名・単位は JOIN で復元、Day 表に 4 行)。
- CapeOX(投与 14 日 + 休薬 7 日、内服ステップ「1 日 2 回朝夕食後」× 14 日、カペシタビン 1000 mg/m²)を登録し、用法名が再読込で
  復元される。
- 検証エラー: 上限 50 < 基準値 85、投与日「1, 1」で保存が止まりバナーが出る。存在しない id は `not_found` のバナー。
- 複製 → コード 000002・下書き・承認日と承認者が空、子も全部写る。削除 → 一覧に戻り、子テーブルも消える。
- 一覧: 「ふぉるふぉっくす」(カナ)でヒット、状態 = 下書きで 0 件、承認済 + 内科 + 有効期間内で 1 件。
- `RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec` 1191 件成功、コンテナ内 `npx tsc -b` 成功。

### 8.2 検証したこと(レジメンオーダー、2026-09-06、テスト太郎)

- mFOLFOX6 を 9/8 開始・入院・定時で適用 → ヘッダ 1 + 注射 1 日(RP 4・薬剤 8)。体表面積 1.75 m²(170 cm / 64.4 kg)、
  オキサリプラチン 85 mg/m² → 148.75 mg → 1.49 瓶、レボホリナート 3.5 瓶、5-FU 0.7 / 4.2 瓶。薬剤コメントに計算根拠。
- 暦に「9 C1 Day1」と薬剤名、マスを押すと右ペインに投与日の操作。移動(9/8 → 9/9)で SR と MR 8 件が同じ id で PUT され、
  拡張・requisition が残る。Provenance は CREATE 10 target + UPDATE 9 target。中止 → 暦に打ち消し線と「中止」、中止取消で戻る。
- 詳細パネル: 第 1 クール Day 1 = 9/9(移動に追随)。「第 2 クールを登録」の既定 Day 1 = 9/23、登録すると暦に「C2 Day1」。
- カルテタブの注射カードに「mFOLFOX6 C2 Day1」。ヘッダはカードにならない。
- CapeOX(内服)を 9/10 開始で適用 → 処方 1 件(カペシタビン 6 錠、用法「1 日 2 回朝夕食後」、14 日分、コメントに 1750 mg の根拠)。
  暦のタブが CapeOX / mFOLFOX6 の 2 つになり切り替わる。
- `RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec spec/requests/master/regimens_spec.rb` 14 件、コンテナ内 `npx tsc -b` 成功。

## 9. 申し送り

- 開発環境のテスト太郎に mFOLFOX6(9/9・9/23 の 2 クール)と CapeOX(9/10)を適用済み。CapeOX は検証のため DB で承認済にした。
- 日オーダーの検索は「患者 + 最初の適用の開始日以降 + ヘッダのみ」を最大 10 ページ読んで画面側で拡張を見る。他のオーダーが
  非常に多い患者では読み切れない可能性がある(上流に拡張の検索パラメータを足すのが本筋。`docs/server-improvement-backlog.md`)。
- 移動は `parseInjectionForm` → `buildInjectionUpdateBundle` で組み直すので、フォームが持たない要素(オーダーセットの印など)は
  引き継がれない。レジメンから出た日オーダーは他の印を持たないので今は問題にならない。

- 薬剤の種類・算出基準の既定は「注射容量 100 mL 以上の袋・瓶・キット → 補液」の推定なので、50 mL の制吐剤バッグなどは抗がん剤に
  なる。選び直せばよいが、種類の既定を薬効分類(YJ 上 4 桁 421〜429 = 抗悪性腫瘍薬)で決める改良は安い。
- 内服ステップの `days` は「開始相対日」で、期間は `dose_days`。Day 表はその範囲を塗る。Day 1〜14 と Day 22〜35 のような
  2 期間は days = [1, 22] + dose_days = 14 で表す。
- 承認済のレジメンも編集できる(状態は表示と絞り込みのみ)。オーダー化するときに「承認済だけ候補にする」「承認済の編集は複製に誘導する」を入れる。
- レジメン一覧の `medicine_code` 絞り込み(この薬剤を含むレジメン)は API だけで画面には出していない(薬剤マスタ側からの逆引きに使う想定)。
- `useValidationError` のバナーへのスクロールは自動化環境では動かない(既知)。
- 開発環境にはレジメン 2 件(000001 mFOLFOX6 / 000002 CapeOX)を投入済み。seed CSV は同梱していない(施設ごとに審査を通すもので、
  配布する性質のデータではない)。
