# 化学療法レジメンの設計

**状態: 第 1 段階(レジメンマスタの登録)実装済(2026-09-06)。レジメンオーダー(患者への適用)は未実装。**
本文中の区別は他の設計書と同じ(［事実］/［導出］/［決定］/［提案］)。

---

## 1. レジメンとは何か = マスタであってオーダーではない

| | オーダーセット | レジメンマスタ | レジメンオーダー(未実装) |
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

## 7. 未実装・今後

### A. レジメンオーダー(患者への適用)

- 適用日(= Day 1)を指定して、ステップの `days` を実日付に展開する。注射ステップは 1 日 1 オーダー(`ServiceRequest` + `MedicationRequest`、
  `InjectionRpValues` に写す)、内服ステップは処方 1 件。束ねは注射の `injection-series` と同じ `requisition` + 拡張で、
  レジメン印(`CodeSystem/regimen` の code / display)と クール番号 / Day を拡張に持つ。相対日の表示は `injectionSeriesDay` の流儀。
- **投与量の計算**: 直近の身長・体重(`bodyMeasureHelpers.ts`、LOINC 8302-2 / 29463-7)から体表面積(DuBois 式)を出し、
  mg/m² × BSA → mg → 製剤数(`master_hot_codes.standard_unit` を `Master::StandardUnitParser` で読んだ力価)。上限値で頭打ち。
  AUC はカルボプラチンの Calvert 式(eGFR は `calculateEgfr` がある)。丸め規則(バイアル単位・有効数字)はレジメンごとに要る。
- **投与前チェック**: `lab_criteria` を患者の直近の検査結果(`useRenalResults` と同じく分析物 5 桁で突き合わせ)と比べて警告。
  中止・減量基準は表示のみ。
- 承認済(`status = approved`)かつ有効期間内のレジメンだけを適用の候補にする。
- 化学療法の実施記録(投与開始・終了・実施量・副作用の Grade)と、クール進行の管理(何クール目か、休止・中止)。

### B. マスタ側

- CTCAE 用語マスタ(JCOG の CTCAE v5.0 日本語訳)の取込と、副作用の用語をそこから選ぶこと。
- 減量レベル表(レベル −1 / −2 × 薬剤 × %)。減量オーダーの自動計算に要る。
- 治療前検査セット(検体検査オーダー項目との紐付け)。
- 版管理・改訂履歴(いまは編集で上書き。承認済の改訂は複製 → 承認 → 旧版を廃止 の運用)。
- 併用注意薬、血管外漏出リスク分類(起壊死性 / 炎症性 / 非壊死性)、投与時の観察項目。
- 器材のマスタ化(いまは自由記述。注射側にも器材のマスタが無い)。
- エクスポート / インポート(他施設のレジメン集からの取込)。

## 8. 実装したもの(2026-09-06)

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

## 9. 申し送り

- 薬剤の種類・算出基準の既定は「注射容量 100 mL 以上の袋・瓶・キット → 補液」の推定なので、50 mL の制吐剤バッグなどは抗がん剤に
  なる。選び直せばよいが、種類の既定を薬効分類(YJ 上 4 桁 421〜429 = 抗悪性腫瘍薬)で決める改良は安い。
- 内服ステップの `days` は「開始相対日」で、期間は `dose_days`。Day 表はその範囲を塗る。Day 1〜14 と Day 22〜35 のような
  2 期間は days = [1, 22] + dose_days = 14 で表す。
- 承認済のレジメンも編集できる(状態は表示と絞り込みのみ)。オーダー化するときに「承認済だけ候補にする」「承認済の編集は複製に誘導する」を入れる。
- レジメン一覧の `medicine_code` 絞り込み(この薬剤を含むレジメン)は API だけで画面には出していない(薬剤マスタ側からの逆引きに使う想定)。
- `useValidationError` のバナーへのスクロールは自動化環境では動かない(既知)。
- 開発環境にはレジメン 2 件(000001 mFOLFOX6 / 000002 CapeOX)を投入済み。seed CSV は同梱していない(施設ごとに審査を通すもので、
  配布する性質のデータではない)。
