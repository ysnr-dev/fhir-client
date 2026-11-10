# 透析(血液浄化)オーダーと透析部門の設計

**状態: 第 1 段(オーダー・カルテ・上流・シフト設定)を実装済み(2026-11-09)、第 2 段(透析室の設定・ベッド枠・一括展開・部門一覧)と第 3 段(実施記録・会計・退院連動)を実装済み(2026-11-10)。残りは §9 の申し送り。** 運用の流れは `docs/order-flows/dialysis.md`。 `docs/functional-gap-backlog.md` §2.7 の「透析(血液浄化)」。

維持透析(週 3 回を何か月も続ける)と急性血液浄化(ICU などのベッドサイドで行う CHDF・血漿交換)を、
部門オーダーの 1 種別として足す。雛形はリハビリ(`docs/rehab-order-design.md`。期間継続型・Task は部門の受け入れ状態・
部門が都度予約)と処置(`docs/treatment-order-design.md`。実施記録 = ハブ Procedure + partOf の子)。
**同じところはそちらを参照し、違うところだけをここに書く。**

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

決めたこと(2026-11-09):

- 第 1 段階は **オーダー + 透析室のベッド予約 + 各回の実施記録 + 部門一覧**。透析中の時間軸の記録(透析中バイタル)は後の段階(§9)。
- 予約は **ベッド × シフトの枠(Schedule / Slot)**。曜日パターンから各回の予約を一括展開する。
- 浄化方法は維持透析(HD / HDF / I-HDF)と急性血液浄化(CHDF / CHD / PE / DFPP / DHP)。**腹膜透析は対象外**(外来管理の構造が別物)。
- 透析支援システム(別システム)が入る施設も多いが、**このアプリで透析室の業務が回る形**にし、連携は実施記録を境界として §8 に書くだけにする。

---

## 0. 現状(実装済みの範囲)

- ［事実］透析に当たる機能は無い。処置オーダーの項目マスタに「人工透析は単独・予約必須・枠表の紐づけ」の入口がある
  (`pages/TreatmentItemPage.tsx`)が、紐づけられる枠表は検査予約(`exam`)だけで、1 オーダー 1 回。
  週 3 回を続ける維持透析では毎回オーダー(または DO)を出すことになり、期間・曜日・透析条件・ベッド・各回の体重と除水を持つ場所が無い。
- ［事実］診療科コード(`fhir/departmentCodes.ts`)に血液透析科はある。クリニカルパスのタスク分類 Lv2 に `TPDI 透析` はある
  (`fhir/pathwayHelpers.ts`)が、既定のオーダー種別の対応表(`DEFAULT_ORDER_TYPE_BY_LV2`)には無い。
- ［事実］職種に臨床工学技士(`clinical-engineer`。`fhir/practitionerRoleHelpers.ts`)はあるが、ホームのカードは無い。

---

## 1. 他の部門オーダーとの違い = リハビリ型 + ベッドの時間割

| 項目 | リハビリ | 透析 |
|---|---|---|
| オーダーの単位 | 期間(開始日〜終了日) | 同じ |
| 1 回の内容 | 療法・単位数(オーダーが決める) | 浄化方法と透析条件(オーダーが決める)+ 各回の体重・除水・薬剤・器材(実施が決める) |
| 予約 | リハ室の枠に部門が都度 1 件ずつ | **ベッド × シフトの枠に、曜日パターンから N 週ぶんを一括展開**(§5) |
| 枠の定員 | 1 枠に複数の患者 | **1 ベッド 1 患者**(定員 1) |
| 実施の形 | Procedure 1 件(単位数・担当) | **ハブ Procedure + 子**(測定値 Observation・薬剤 MedicationAdministration・器材。処置と同型。§6) |
| 実施の進み | 1 操作で完了 | 入室 → 開始 → 終了の 3 段(ハブの status) |
| 急性(ベッドサイド) | 無い | ベッドの枠を取らず、予約なしで実施できる(§2.3) |
| 退院での打ち切り | 全件 | **入院のオーダーだけ**(§4.2) |

### 1.1 命名

［提案］英語識別子は **`dialysis`**。血液浄化全体を指す `blood-purification` は長く、既存の命名は直訳の 1 語(`rehab` / `meal` / `consult`)で
揃っている。急性血液浄化も同じ種別で扱うので、画面表記は「透析」とし、浄化方法で区別する。

オーダー種別 `order-type|dialysis`、カルテの種別 `dialysis-order`、Task コード `task-code|dialysis`、枠の種別 `schedule-service-type|dialysis`、
ファイル・関数の接頭辞 `dialysis` / `Dialysis`、部門一覧のルート `/dialysis-worklist`、透析室の設定 `/dialysis-unit`。

---

## 2. FHIR の構造

```text
ヘッダ ServiceRequest  (category[0] = order-type|dialysis, category[1] = prescription-setting|inpatient / outpatient)
  status = active / intent = order
  code               = 浄化方法 (CodeSystem/dialysis-modality)
  subject            = Patient
  authoredOn         = 登録日時(全種別共通、features/orders-common.md「オーダーの日付」)
  occurrenceDateTime = 開始日(日付のみ)
  reasonReference    = 原疾患(Condition。他種別と同じ orderProblem)
  note               = コメント
  extension[dialysis-order-end]         = 終了日 valueDate(無ければ継続中)
  extension[dialysis-bedside]           = valueBoolean(ベッドサイドで行う。透析室のベッドを取らない)
  extension[dialysis-schedule-pattern]  ×N 複合 { dayOfWeek valueCode(mon〜sun), shift valueCoding(施設設定のシフトコード + 登録時の名前) }
  extension[dialysis-prescription]      複合(透析条件。§2.2)
  ←focus──── Task (task-code|dialysis。requested / accepted / completed / cancelled = 部門の受け入れ状態)
  ←basedOn── Appointment ×N (serviceType = schedule-service-type|dialysis、participant = Patient + ベッド Location、
  │            slot = ベッドの枠、extension[dialysis-shift] = シフトコード。1 回 = 1 件。§5)
  └basedOn── Procedure ハブ ×N (1 回 = 1 件。§6)
               category = order-type|dialysis、code = 浄化方法(dialysis-modality)
               status = preparation(入室) → in-progress(開始) → completed(終了)
               performedPeriod = 開始〜終了、performer = 担当(臨床工学技士・看護師)
               usedCode = 器材(血液浄化器は施設マスタの製品、その他は特定保険医療材料)+ extension[dialysis-material-quantity]
               extension[dialysis-appointment] = 対応する予約(Appointment/…。ベッドサイドは無し)
                 ├ partOf ← Observation (CodeSystem/dialysis-measurement。透析前体重・透析後体重・除水量・
                 │            実透析時間・血流量・透析液流量。category = order-type|dialysis)
                 ├ partOf ← Observation 血圧(LOINC 85354-9、category = vital-signs + order-type|dialysis。
                 │            透析前・後は extension[dialysis-measurement-timing] = pre / post)
                 ├ partOf ← MedicationAdministration (ESA・鉄・ヘパリンなど。ロット番号は medication-lot-number。
                 │            所定点数に含まれる薬剤は extension[dialysis-bundled-medication] = true)
                 └ partOf ← Procedure (追加の手技。code = CodeSystem/dialysis-procedure-code)

患者単位 Observation ドライウェイト(CodeSystem/dialysis-measurement|dry-weight、category = order-type|dialysis、partOf 無し。
  直近値を実施画面・詳細・患者帯で参照し、実施の終了で値を変えたときだけ 1 件足す)

Location 透析室 (type = CodeSystem/location-type|dialysis-unit、physicalType = ro)
  └ partOf ← Location ベッド ×N (type 同上、physicalType = bd)
       ← actor ── Schedule (serviceType = dialysis、名前 = ベッド名) ← Slot (日 × シフトで 1 件。定員 1)
```

### 2.1 新規に定義するローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `dialysis` | ヘッダの `category[0]`、ハブ Procedure と測定値 Observation の `category` |
| `CodeSystem/task-code` の値 `dialysis` | 進捗 Task の `code` |
| `CodeSystem/schedule-service-type` の値 `dialysis` | ベッドの枠表と予約の `serviceType` |
| `CodeSystem/dialysis-modality` | 浄化方法。`hd` 血液透析 / `hdf` 血液透析濾過 / `i-hdf` 間歇補充型 HDF / `chdf` 持続的血液濾過透析 / `chd` 持続的血液透析 / `pe` 血漿交換 / `dfpp` 二重膜濾過血漿交換 / `dhp` 血液吸着 |
| `CodeSystem/dialysis-measurement` | 各回の測定値。`pre-weight` / `post-weight` / `ultrafiltration` / `actual-minutes` / `qb` / `qd` |
| `CodeSystem/dialysis-procedure-code` | 追加の手技(レセ電算 診療行為コード)。処置の `treatment-procedure-code` と同じ役 |
| `CodeSystem/dialysis-shift` | シフト。コードは施設設定 `dialysis_shifts` のもの、`display` に登録時の名前を焼き付ける |
| `CodeSystem/blood-purifier` | 血液浄化器。コードは施設マスタ `master_blood_purifiers` のもの(§3.1) |
| `CodeSystem/location-type` の値 `dialysis-unit` | 透析室とそのベッドの `Location.type`(§5.1) |
| `StructureDefinition/dialysis-order-end` | 終了日(リハビリの `rehab-order-end` と同じ判断。上流の `order-period` が見る) |
| `StructureDefinition/dialysis-bedside` | ベッドサイド実施(急性血液浄化) |
| `StructureDefinition/dialysis-schedule-pattern` | 曜日 × シフト(複合、繰り返し) |
| `StructureDefinition/dialysis-prescription` | 透析条件(複合) |
| `StructureDefinition/dialysis-shift` | 予約のシフト(valueCoding。ボードの列の振り分けに使う) |
| `StructureDefinition/dialysis-appointment` | ハブ Procedure から対応する予約への参照 |
| `StructureDefinition/dialysis-material-quantity` | `usedCode` に数量を添える(処置の `treatment-material-quantity` と同じ) |
| `StructureDefinition/dialysis-bundled-medication` | 実施の薬剤のうち人工腎臓の所定点数に含まれるもの(valueBoolean)。会計に送らない(§7) |
| `StructureDefinition/dialysis-measurement-timing` | 実施の血圧が透析前か後か(valueCode `pre` / `post`)。血圧は LOINC のパネル 1 つなので拡張で分ける |

［事実］`OrderCatalog::Definition`(会計)は `#{order_type}-procedure-code`・`#{order_type}-material-quantity`・`#{order_type}-bundled-medication` を規約で組む
(`integrations/receipt_computer/order_catalog.rb`)ので、上の 2 つはこの名前でなければならない。

再利用: `CodeSystem/prescription-setting`(入外区分)、`CodeSystem/medicine-code` / YJ、`CodeSystem/medical-material`、
JP Core `route-codes`、`StructureDefinition/medication-lot-number`、依頼科・病棟の拡張(`orderHeader.ts`)。

### 2.2 透析条件(`dialysis-prescription`)

［事実］透析条件は「処方」に当たるもので、医師が決め、部門が各回それに沿って行う。項目は施設・浄化方法で増減するが、
算定と安全確認に効く核は決まっている。

| 子 extension | 型 | 内容 |
|---|---|---|
| `duration-minutes` | valueInteger | 透析時間(分)。算定の時間区分(4 時間未満 / 4〜5 時間 / 5 時間以上)はここから決まるが、**算定は実施の実時間で行う**(§7) |
| `qb` | valueQuantity(mL/min) | 血流量 |
| `qd` | valueQuantity(mL/min) | 透析液流量 |
| `purifier` ×N | valueCodeableConcept | 血液浄化器。施設マスタ(§3.1)の製品の coding(`CodeSystem/blood-purifier`)か、マスタに無ければ `text` だけ。`text` に膜素材と膜面積を含めて焼き付ける。DFPP は 2 件 |
| `anticoagulant` | valueCodeableConcept | 抗凝固薬(医薬品マスタ。ヘパリン・低分子ヘパリン・ナファモスタット) |
| `anticoagulant-initial-dose` | valueQuantity | 初回量 |
| `anticoagulant-continuous-dose` | valueQuantity(/h) | 持続量 |
| `dialysate` | valueCodeableConcept | 透析液(HD・HDF・I-HDF・CHDF・CHD)。§3.2 |
| `substitution-fluid` | valueCodeableConcept | 補充液(HDF・I-HDF・CHDF)。§3.2 |
| `substitution-volume` | valueQuantity(L) | 補充液量(HDF・I-HDF・CHDF) |
| `replacement-fluid` | valueCodeableConcept | 置換液(PE・DFPP)。§3.2 |
| `replacement-volume` | valueQuantity(mL) | 置換液量(PE・DFPP) |
| `access-type` | valueCode | バスキュラーアクセス: `avf` 自己血管内シャント / `avg` 人工血管 / `catheter` カテーテル / `other` |
| `access-site` | valueString | 部位(左前腕など) |
| `needle` | valueString | 穿刺針(ゲージ・種類) |

［導出］**明細 ServiceRequest にしない**。処置・生理検査の明細は「項目ごとに算定される独立した行為」だが、透析条件は 1 回の透析を
形づくる属性で、条件ごとに実施・算定が分かれない。放射線治療の Phase・標的(`radiotherapy-order-design.md`)と同じ複合拡張で持つ。

［導出］**ドライウェイトはオーダーに持たない**。DW は週単位で見直される患者の状態値で、オーダーの編集で追いかけるのは重い。
患者単位の Observation(直近値)にし、実施画面・オーダーの詳細・患者帯の吹き出しに直近値と設定日を出し、実施の終了時に更新できるようにする。
コードは LOINC にせずローカルの `dialysis-measurement|dry-weight` にした(DW に当たる LOINC を確かめられず、vital-signs にすると
経過表の体重の行に「目標値」が実測と並んでしまうため)。
目標除水量は実施時に「透析前体重 − DW」で出す(入力の初期値。手で直せる)。

### 2.3 ベッドサイド実施(急性血液浄化)

［事実］CHDF や血漿交換は ICU・病棟のベッドサイドで行い、透析室のベッドを取らない。回数・時刻も不規則(CHDF は連日 24 時間)。

［提案］浄化方法が急性系(chdf / chd / pe / dfpp / dhp)のときは `dialysis-bedside = true` を既定にし(維持系でも選べる。
入院中の臨時 HD をベッドサイドで行う場合)、ベッドサイドのオーダーは

- 曜日 × シフトのパターンを持たず、予約(Appointment)を作らない。
- 部門一覧の当日ボードでは格子(ベッド × シフト)の下の別表に出し、そこから直接「実施」を開く(予約なしで実施できる唯一の経路)。
- 実施のハブに `dialysis-appointment` は付かない。

### 2.4 期間と曜日パターン

- ［事実］上流は `occurrenceDateTime` しか索引せず、終了は `order-period` 検索が見るローカル拡張で表す
  (`rehab-order-design.md` §2.2)。上流の `ORDER_END_EXTENSION_URLS`(`../fhir-server/app/lib/fhir/extraction_definitions/service_request.rb`)は
  nursing / meal / rehab / nutrition-guidance の 4 つに固定なので、**上流に `dialysis-order-end` を 1 行足す**(§10)。
- ［導出］曜日 × シフトは `occurrenceTiming` にしない(choice で開始日と併用できない。`rehab-order-design.md` §2.3)。
  `Timing.repeat.dayOfWeek` だけでは「月曜は午前・金曜は午後」が表せないので、曜日とシフトの組を複合拡張の繰り返しで持つ。
  曜日コードは FHIR `days-of-week`(mon〜sun。看護指示・注射と同じ)。
- ［導出］パターンは**予約を展開するときの材料**で、予約の正本は Appointment。パターンを変えても既に展開した予約は動かない
  (展開し直すか、個別に変更する)。

### 2.5 条件変更は同じオーダーの編集

［事実］食事は「変更 = 新規登録 + 前オーダーの終了」(`meal-order-design.md` §2.6)で履歴を担保している。

［導出］透析では採らない。予約(Appointment)が `basedOn` でオーダーを指しており、オーダーを作り直すと N 週ぶんの予約の
`basedOn` を付け直すことになる。**同じオーダーを編集**(`withVersionLock`、編集フォームは `useEditSnapshot` で版を固定)し、
各回の実施記録に実際の条件(実透析時間・QB・QD・使った血液浄化器・抗凝固薬)を写すことで「いつどの条件で行ったか」の履歴を担保する。
条件の変更履歴そのものは `_history`(カルテ印刷の差分と同じ)で読める。

---

## 3. マスタと施設設定

### 3.1 血液浄化器の施設マスタ `master_blood_purifiers`

［事実］レセプト電算の特定器材マスタ(`master_medical_materials`)のダイアライザーは「ダイアライザー(1a型)」のような機能区分で、
同じ区分に「(在宅)」のコードも並ぶ。製品・膜素材・膜面積を持たないので指示に使えない。一方、ダイアライザーは人工腎臓の包括項目に無く、
材料価格基準(040)の機能区分で算定する。

［導出］**オーダーと実施は製品を選び、算定は製品に紐付いた機能区分を使う**。放射線の器材(`master_rad_materials`)と同じ形で、
製品 N 件 : 特定器材コード 1 件。画面は `pages/BloodPurifierPage.tsx`。

| 列 | 内容 |
|---|---|
| `purifier_code` | 施設内のコード(自動採番)。オーダーの coding に入る |
| `kind` | 種別(ダイアライザ / ヘモダイアフィルタ / ヘモフィルタ / 持続緩徐式血液濾過器 / 血漿分離器 / 血漿成分分離器 / 吸着器) |
| `name` `name_kana` `maker` `model_number` | 製品 |
| `membrane_material` `membrane_area` | 膜素材・膜面積(㎡)。記録と表示だけで、不適合歴や ACE 阻害薬との照合はしない(§9) |
| `receipt_material_code` | 算定に使う特定器材コード。未紐付けは一覧に印を出す |
| `valid_from` `valid_to` | 採用期間。選択肢は採用中の製品だけ |

［提案］浄化方法ごとに使う種別は `fhir/bloodPurifierHelpers.ts` の `KINDS_BY_MODALITY`。フォームの項目名と検索の初期種別を決めるだけで、
別の種別も選べる。HD = ダイアライザ、HDF・I-HDF = ヘモダイアフィルタ、CHDF・CHD = 持続緩徐式血液濾過器、PE = 血漿分離器、
DFPP = 血漿分離器 + 血漿成分分離器、DHP = 吸着器。［要確認］この対応は運用前に臨床工学技士に確認する。

### 3.2 透析液・補充液・置換液は医薬品マスタ

［事実］血液浄化器と違い、医薬品マスタ(`master_medicines`)は透析液を製品ごとに持つ。薬効分類 3410(人工腎臓透析用剤)に
透析液(キンダリー・カーボスター・リンパック・D ドライなど)と血液ろ過用補充液(サブラッド・サブパック)が載り、製品の違いが
Ca・K 濃度や酢酸の有無といった組成の違いになっている。置換液はアルブミン(6343 血漿分画製剤)と FFP(6342 血液成分製剤)。

［導出］**施設マスタを作らず医薬品マスタを直接選ぶ**。coding は抗凝固薬と同じ `CodeSystem/medicine-code` + YJ コードで、
`text` に名称を焼き付ける。マスタに無い名称(多人数用透析液供給装置の「セントラル」など)は手入力で `text` だけ。
Na・K の調整は製品で表せないので透析部門への指示に書く。マスタは包装単位なので同じ組成が包装違いで並ぶが、指示としては同じ意味で、
施設が使っている 1 つを選べばよい。

［提案］選択モーダルは薬効分類を初期値にして開く(`DIALYSATE_YAKKO_CODE` / `REPLACEMENT_YAKKO_CODE`)。置換液はアルブミンから始め、
FFP を選ぶときは薬効分類を 6342 に切り替える。FFP の払い出しは輸血オーダーで行い、透析オーダーの置換液は指示として持つだけ。
液の欄は浄化方法で出し分け、使わない浄化方法の値は保存しない(透析液は PE・DFPP・DHP で、置換液は PE・DFPP 以外で落とす)。

### 3.3 定数に置くもの

［提案］浄化方法・アクセス種別・測定項目は固定の分類で施設ごとに増減しないため、フロントの定数(`dialysisOrderHelpers.ts`)に置く
(リハビリ §3 と同じ)。抗凝固薬・ESA は既存の医薬品マスタを直接選ぶ。
施設の「よく使う組み合わせ」はオーダーセットで持てる。

### 3.4 施設設定(`backend/app/models/facility_settings.rb` の `SETTINGS`)

**シフト `dialysis_shifts`**。透析室の 1 日の区切り。ベッドの枠(Slot)の生成と、オーダーの曜日 × シフト、ボードの列に使う。

```ruby
DEFAULT_DIALYSIS_SHIFTS = {
  "shifts" => [
    { "code" => "am", "label" => "午前", "start" => "09:00", "end" => "13:30" },
    { "code" => "pm", "label" => "午後", "start" => "14:00", "end" => "18:30" }
  ]
}.freeze
"dialysis_shifts" => {
  default: DEFAULT_DIALYSIS_SHIFTS,
  shape: { fields: { "shifts" => { list: { fields: { "code" => …, "label" => :text, "start" => :time, "end" => :time },
                                           required: %w[code label start end] },
                                   min: 1, unique: "code" } } },
  check: ->(value) { … start < end、時間帯が重ならない … }
}
```

［導出］コードをキーにした `map` にしない。`JsonShape` の `map` は既定値の上に保存値を重ねるので、既定の `pm` を消して保存しても
読み出しで戻ってしまう。jsonb はキーの順も保たない。**並び(`list`)で持ち、`JsonShape.fill` はオブジェクトの並びをそのまま返す**
(文字列に寄せるのは葉の並びだけ)。

［導出］シフトの名前はオーダーのパターンと予約に **valueCoding の `display` として焼き付ける**。施設設定の共通の決まり
(`facility_settings.rb` 冒頭「登録済みのリソースは動かさない」)どおりで、カルテカード・転記・印刷などの純粋関数が設定を読まずに
表示でき、名前を変えても過去の表示が動かない。コードは画面から入力させず自動で付け(`s-` + 乱数)、消したコードを使い回さない。

［導出］シフトを施設設定に置き、枠表(Schedule)の `SlotPattern` に置かない理由: `SlotPattern`(`fhir/scheduleHelpers.ts`)は
1 枠の長さが 1 つで、午前 4.5 時間・夜間 4 時間のように長さの違う枠を同じ枠表に作れない。透析のベッドの枠は
**シフトから日 × シフトで 1 Slot ずつ作る専用の生成**(§5.2)にし、Schedule に `schedule-slot-pattern` 拡張を付けない
(枠表の編集画面から再生成されないようにする)。

シフトを消しても、既存オーダーのパターンと予約は登録時の名前のまま読める。設定画面で「オーダーで使われているシフトは消せない」
まではしない(使用中かの判定にオーダー全件の検索が要るため)。編集フォームの格子は、設定に無いシフトの行も残して出す(黙って外さない)。

**会計コード `receipt_codes.dialysis`**(§7)。`DEFAULT_RECEIPT_CODES` / `RECEIPT_CODES_SHAPE` にキーを足す。

```ruby
DIALYSIS_MAINTENANCE = %w[hd hdf i-hdf].freeze
DIALYSIS_DURATIONS = %w[under4 from4to5 over5].freeze       # 人工腎臓(J038)の時間区分
DIALYSIS_ACUTE = %w[chdf chd pe dfpp dhp].freeze             # 1 コードずつ
"dialysis" => DIALYSIS_MAINTENANCE.index_with { DIALYSIS_DURATIONS.index_with("") }
              .merge(DIALYSIS_ACUTE.index_with { { "single" => "" } })
```

frontend は `fhir/receiptCodeSettingsHelpers.ts` と `pages/FacilitySettingsPage.tsx`。シフトの設定画面は施設設定の「透析室のシフト」。

---

## 4. Task と終了・中止・退院

### 4.1 Task は部門の受け入れ状態

リハビリ §4 と同じ逸脱(requested 依頼済 → accepted 実施中 → completed 終了 / cancelled 中止)。日々の実施は Task を動かさず
ハブ Procedure を積むだけ。ヘルパー(`dialysisResultHelpers.ts`)の先頭にこの逸脱を書く。

- 終了は **`dialysis-order-end` に終了日を必ず書く**(リハビリ §6.1。書かないと `order-period` に永久にヒットする)。
  終了日の翌日以降の予約は同じ transaction で取り消す(中止は今日以降)。過ぎた予約は通院の記録なので残す。
- 終了取消・中止取消で予約は戻さない(リハビリ §7.3)。
- 実施記録が付いたオーダーは削除を止める(`docs/order-common-backlog.md` §5)。削除では有効な予約の取消を同梱する。

### 4.2 退院での打ち切りは入院のオーダーだけ

［事実］維持透析患者が他疾患で入院・退院しても外来の透析は続く。リハビリは退院で全件を打ち切る(`useDischargePatient`)。

［導出］透析は `prescription-setting|inpatient` のオーダー(急性血液浄化・入院中の臨時 HD)だけを退院の対象にし、
外来のオーダーは触らない。退院ダイアログの対象選択では入外区分を見せる。入院中に外来の維持透析を院内で続ける場合は、
入院時に入院のオーダーを別に出す運用(外来のオーダーを一時中断する仕組みは持たない。§9)。

---

## 5. 透析室・ベッド・予約

### 5.1 透析室とベッド(Location)

```text
Location 透析室  type = location-type|dialysis-unit, physicalType = ro, partOf = 自院 Organization の Location(あれば)
  └ Location ベッド  type = location-type|dialysis-unit, physicalType = bd, partOf = 透析室, name = "1" / "A-3" など
```

［事実］病棟・病室・ベッドは `type=HU` 起点の 3 階層(`features/ward.md`)、診察室・撮影室は `LOCATION_TYPE_OPTIONS`
(v3-RoleCode)の OR 検索(`/locations`)、病床の集計は Encounter の location 由来(`bedScheduleHelpers.ts`)。
上流の Location 検索は `type` と `partof` のみ(`physical-type` は索引なし)。

［導出］透析室とベッドに**ローカルの `location-type|dialysis-unit`** を与えれば、どの既存画面・集計にも混ざらない。
`LOCATION_TYPE_OPTIONS` には足さない(足すと診察室のセレクトに出る)。透析ベッドは病床ではないので入院の Encounter の
location にはならない(入院患者が透析室に来ても入院の所在は病棟のベッドのまま)。

**透析室の設定画面 `/dialysis-unit`**(部門業務メニュー)。ベッド 20 台を手で登録させないための画面。

- 透析室 Location(無ければ作る。複数の透析室も可)、ベッドの一覧(名前・有効 / 無効)。
- 「ベッドを N 台追加」: ベッド Location と、そのベッドを actor にする Schedule(serviceType dialysis、名前 = 透析室名 + ベッド名。
  枠表の一覧でどの透析室のベッドか分かるように)を `urn:uuid` で結んで 1 transaction。ベッド名は既存の数字の名前の続き。
- 「枠を生成」: 開始日と月数(上限 6)を指定して有効なベッドの Slot を日 × シフトで作る(§5.2)。既に同じ日 × シフトの開始に枠があればスキップ
  (シフトを足したときは足したシフトの枠だけが増える)。
- 透析室の名前を変えると、配下の枠表の名前も同じ transaction で揃える。
- 無効にしたベッドは枠を作らず、ボードにも出さない(Location.status = inactive。Schedule も `active = false`)。

### 5.2 ベッドの枠(Slot)

```text
Schedule (actor = ベッド Location, serviceType = dialysis, active)  ← Slot (start = その日のシフト開始, end = 終了, status = free)
```

- 1 日 × シフト × ベッドで 1 Slot(定員 1)。枠は休日も作る(透析は祝日も行う施設が多い。休診日は施設の運用で埋めない)。
- 生成は `generateDialysisSlots(schedule, shifts, from, to)`(`scheduleHelpers.ts` の `buildSlotsAt` を写す)。
  100 件ずつ `postBundle`(`useGenerateSlots` と同じ)。
- 枠表の一覧 `/schedules` には種別「透析」として出る。ケバブの「編集」と枠カレンダーの「枠一括生成」「枠表編集」は出さない
  (ScheduleForm で保存すると `schedule-slot-pattern` が付いてしまうため。名前・有効と枠の生成は透析室の設定で行う)。
  枠カレンダーの停止・再開・個別追加はそのまま使える。ScheduleForm の種別の選択肢にも出さない。

### 5.3 予約(Appointment)の一括展開

［事実］既存の予約は 1 件ずつ(`buildBookBundle`: Appointment POST + Slot PUT busy を 1 transaction)。

［提案］部門一覧のオーダーの行から「展開」を開き、**N 週ぶん(上限 40 件)を 1 transaction** で作る。

1. プレビュー: 曜日 × シフトのパターンから開始日(既に展開済みなら最後の予約の翌日)以降の日付を起こす。
   ベッドは**前回と同じベッドを初期値**にし、曜日ごとに変えられる。ベッドごとに
   `Slot?schedule=…&status=free&start=ge…&start=lt…` を引き、`Appointment?based-on=…&date=ge…` で既予約の日を除外して、
   行ごとに「枠あり / 枠なし(空きが無い・枠未生成) / 既に予約あり(除外)」を表にする。
   上限を超える指定は黙って打ち切らず止める(注射 §2.3 と同じ)。
2. 送信: `[POST Appointment(basedOn = ヘッダ, participant = Patient + ベッド Location, slot, serviceType dialysis,
   extension dialysis-shift), PUT Slot(status busy)] × 件数` を 1 Bundle(`buildDialysisAppointmentBatchBundle`)。
3. 排他: ［事実］`postBundle` は PUT エントリのリソースが `meta.versionId` を持てば `ifMatch` に添える(`api/fhirClient.ts`)。
   検索で読んだ Slot をそのまま busy にして送るので、別の患者が先に取った枠は 412 で transaction 全体が落ちる。
   「別の患者が取った枠があります」と出してプレビューを読み直す。**部分成功は作らない**。
4. 臨時の 1 件(スポット)・個別の変更・取消は 1 件ずつ(`RehabBookModal` を写した `DialysisBookModal`。日付を固定して
   その日のベッドの空きだけを出す)。

［導出］レート制限(本番 1500 件/分)に対して 1 transaction = 1 リクエスト。プレビューの Slot 検索はベッド数ぶん並ぶので、
ベッドが多い透析室では `Slot?schedule=a,b,c&…`(カンマ OR)でまとめて 1〜2 本にする。

### 5.4 予約の判定の順序

［事実］リハビリ・栄養指導の予約も `basedOn` を持つため、`isExamAppointment` より先に種別で判定している(`appointmentHelpers.ts`)。

［導出］`isDialysisAppointment`(serviceType = dialysis。`appointmentHelpers.ts` の `isRehabAppointment` の隣)を足し、`isRehabAppointment` を参照している箇所(予約タブの操作の出し分け、
外来一覧の除外、`useOrderAppointment`)の全部に同じ分岐を足す。`scheduleTypeOf` の if 連鎖にも `dialysis` を足す
(足し忘れると透析の枠表が診察予約として読まれる)。カルテの予約タブでは「透析」バッジを出し、取消・変更を許す(リハビリと同じ理由)。
外来一覧は `basedOn` を持つ予約を除いているので、透析の予約は足さなくても出ない。

［導出］予約タブの汎用の日時変更は participant の場所と `dialysis-shift` を書き換えない。ボードは**ベッドを押さえた枠の枠表から、
シフトを開始時刻から**引き(`dialysisAppointmentShift`)、拡張と participant は枠が読めないときの代わりにする。透析一覧の「予約変更」
(`DialysisBookModal`)は participant・`description`・`dialysis-shift` も書き換える。

---

## 6. 実施記録

処置の実施(`treatmentResultHelpers.ts`。ハブ Procedure + partOf の子)に、入室 → 開始 → 終了の段階を足した形。

| 段階 | 操作 | 書くもの |
|---|---|---|
| 入室 | ボードのセルの「入室」 | ハブ Procedure POST(status = preparation、`dialysis-appointment`、performer)。予約は `arrived` |
| 開始 | 「開始」 | ハブ PUT(status = in-progress、performedPeriod.start)。透析前体重・透析前血圧の Observation、目標除水(= 透析前体重 − DW)を控える |
| 終了 | 「終了」 | ハブ PUT(status = completed、performedPeriod.end)+ 子(透析後体重・除水量・実透析時間・QB・QD・透析後血圧、薬剤 MedicationAdministration、器材 usedCode + 数量、追加手技)。予約は `fulfilled`。DW を更新した場合は患者単位の Observation を 1 件 POST |
| 取消 | ケバブ「実施取消」 | ハブと子を DELETE(処置の実施取消と同じ)。予約は `booked` に戻す |

- 途中の段階を飛ばせる(入室せず終了まで一度に入力。後から記録する運用のため)。ボードのケバブ「一括記録」。
- 入室はボタンだけで記録する(入室時刻は持たない。予約の arrived だけ)。入室のハブは `performed[x]` を持たず日付で引けないので、
  ボードは「期間に始めた回」と「`status=preparation,in-progress` の回」を別に引いて束ねる(`fetchDialysisSessions`)。
- 開始・終了の時刻の初期値: 開始は記録済みの開始、無ければ別の日の枠を後から記録するときは枠の開始、その日なら今。
  終了は「開始 + 指示の透析時間」と今の早いほう。実透析時間(`actual-minutes`)は開始〜終了から出して記録する。
- 透析前の体重・血圧は開始で記録し、終了では書き直さない(開始で入れていなければ終了で入れる)。除水量は前後の体重の差が初期値。
- 実施の取消では予約を `booked` に戻す。ボードの予約変更・予約取消は実施の無い予約にだけ出す。
- 子の Observation は ハブの `partOf` で束ね、測定値は `CodeSystem/dialysis-measurement`、血圧だけ LOINC 85354-9 + `vital-signs`
  にする。［導出］血圧を vital-signs にするのは経過表(`flowsheet-design.md`)が `vital-signs` を読むからで、透析前後の血圧が
  入院患者の温度板にそのまま出る。体重も LOINC 29463-7 + vital-signs にして経過表に流す案があるが、透析前後の 2 値が
  同日に並んで体重の行が騙し絵になるので、**体重は dialysis-measurement 側**に置く。
- 実施記録と予約の突合は「同じオーダー × 同じ日」を基本にし(リハビリの `fetchRehabPerformsOn` と同じ)、
  ハブの `dialysis-appointment` があれば優先する(同日 2 回の臨時に備える)。
- 薬剤の投与経路は注射と同じ `route-codes`。ESA・鉄は回路から(IV)、ヘパリンは持続。ロット番号は `withLotNumber`。
- 血液浄化器は施設マスタ(§3.1)から選び、オーダーの製品を初期値にする。その他の器材は特定保険医療材料マスタを直接指す(処置と同じ)。マスタに無い名称は手入力。
- カルテのカードは開始日に 1 枚(リハビリ §5 と同じ)。本文は「浄化方法 / 入外 / 期間 / 曜日 × シフト / 主要条件(時間・QB・QD・血液浄化器・抗凝固薬)」
  + 直近の実施数件(日付・体重・除水)。実施情報は**受付済以降は常に出す**(リハビリと同じ条件。`karteTimeline.ts` にコメント)。
- 患者帯に「透析中」のピクトグラム(化学療法の `chemotherapy` と同じ作り。`NON_MASTER_KEYS`、色は紫系)。有効な透析オーダー
  (`order-period` に今日が入るもの)があるときに出し、吹き出しに浄化方法・曜日 × シフト・アクセス・DW を出す。

---

## 7. 医事会計

- `OrderCatalog::ALL` に `Definition.new(order_type: "dialysis", label: "透析", source: :procedure, resolver: Resolvers::Dialysis, continuous: true)`。
  `continuous` なので記録の無い日のヘッダは報告しない(リハビリと同じ)。
- `Resolvers::Dialysis`(リハビリの resolver を写す): 浄化方法 = ハブの `code`、時間区分 = `performedPeriod` の分数
  (4 時間未満 / 4〜5 時間 / 5 時間以上)で `receipt_codes.dialysis` のコードを引く。急性系は 1 コード。
  コードが無ければ「施設設定に透析(hd / from4to5)のレセプト電算コードがありません」で skip。
- 薬剤(MedicationAdministration)・器材(usedCode + 数量)・追加手技は処置型の送り方に乗る。
  血液浄化器は製品の `receipt_material_code` で算定する(放射線器材と同じ解決を `coding.rb` に足す)。手入力の製品は特定器材コードが無いので算定に載らず、医事側で補う。
  透析液は人工腎臓(J038)の所定点数に含まれるので送らない。［要確認］持続緩徐式血液濾過(J038-2)の透析液・補充液と、血漿交換(J039)の置換液は
  薬剤料として送る扱いと見ているので、実施記録には実際に使った液を医薬品コードと数量で残す(オーダーの液を初期値にする)。
  ［事実］resolver を持つ種別では `PerformedItemBuilder` が手技を resolver に任せ、子 Procedure の手技は拾わない。薬剤・器材・コメントは
  種別を問わず載る。そこで `Resolvers::Dialysis` が子 Procedure(`dialysis-procedure-code`)の行を自分で並べる。
- 所定点数に含まれる薬剤(透析液・抗凝固薬・ESA など)は、実施の薬剤の行の「算定」を外して `dialysis-bundled-medication` を付け、
  `PerformedItemBuilder` が送らない。初期値は、維持透析ではオーダーの抗凝固薬を外し、透析液は行に出さない(記録しても送らないため)。
  急性血液浄化ではオーダーの透析液・補充液・置換液を算定する行として置く。［要確認］ESA などを足したときに外すのは人の判断に任せている。
- `orca/medical_message.rb` の `MEDICAL_CLASS` に `dialysis: "400"`(J 章)。`BillingSendModal.tsx` に種別名。
- **対象外にするもの**(理由を書いておく): 慢性維持透析患者外来医学管理料(B001-15。月 1 回・検査の包括判定が要る月次の算定で、
  実施記録 1 件から出せない)、導入期加算・障害者等加算・時間外加算(患者属性と来院時刻の判定が要る)。医事側で付ける。

---

## 8. 透析支援システムとの境界

［事実］透析支援システム(装置と繋がる部門システム)を持つ施設では、各回の記録はそちらが正本になる。

［提案］境界は **ハブ Procedure とその子**。外部システムが 1 回ごとに §6 の形(category、`basedOn` = ヘッダ、子の Observation /
MedicationAdministration)で書けば、画面側は手入力と同じデータとして扱う(部門一覧・カルテ・会計のいずれも Procedure だけを読む)。
オーダー(ServiceRequest)と予約(Appointment)はこのアプリが正本のままにし、外部からの取込口は作らない。
透析中の時間軸(装置が出す分単位のバイタル・QB・除水速度)は §9 の透析経過表の器に入れる。

---

## 9. 未実装・今後(申し送り)

- **透析経過表**(透析中のバイタル・血流量・除水の時間軸)。麻酔チャート(`anesthesia-chart-design.md`)の器(ハブ + 時刻つき Observation)を
  流用し、経過表の 24 時間表示に出すなら `api/queries/karte.ts` の経過表の category に `order-type|dialysis` を足す
  (行は Observation のコードから自動で立つ)。
- 看護向けの患者メモ(消毒液・止血方法・導入年月日・シャントのシェーマ)。看護プロファイルの区画で持てる。
- 透析患者一覧(DW の推移・直近の採血・アクセスの状態)、月間統計(回数・浄化方法別・ベッド稼働)。
- ボードのドラッグによるベッドの入れ替え、週ビューからの直接予約、入院中の外来オーダーの一時中断。
- B001-15 の月次算定、導入期加算など(§7)。
- シフトの削除時の使用中判定と注意表示(§3.4)。
- 膜素材の照合(膜の不適合歴、AN69 膜と ACE 阻害薬の併用禁忌など。§3.1)。
- 腹膜透析(PD)の処方と外来管理。
- SS-MIX2 への出力(処置・リハビリも出していないので同じ扱い)。

---

## 10. 実装の段階と触る場所

**第 1 段: オーダー・カルテ・上流・施設設定(シフト)** — 実装済み(2026-11-09)。

次は使う画面と一緒に足すので第 1 段には入れていない: 曜日 × シフト → 日付の展開と上限(第 2 段)、Task の遷移と終了・打ち切りのエントリ(第 2 段・第 3 段)、
カード・詳細の実施表示とドライウェイトの表示(第 3 段)。

- 新規: `fhir/dialysisOrderHelpers.ts`(← `rehabOrderHelpers.ts`)、`fhir/dialysisTaskHelpers.ts`(← `rehabTaskHelpers.ts`)、
  `fhir/dialysisShiftHelpers.ts`(施設設定のシフトの型・検証)、
  `components/DialysisOrderForm.tsx` / `DialysisOrderPanels.tsx` / `DialysisOrderDetailPanel.tsx` / `karteCardBodies/DialysisOrderCardBody.tsx`
  (← Rehab 同名。薬剤の選択は `MedicineSearchModal`、血液浄化器の選択は `BloodPurifierSearchModal`)、
  `pages/BloodPurifierPage.tsx` と backend の `Master::BloodPurifier`(← 放射線器材)、
  `api/queries/dialysis.ts`(← `rehab.ts` の detail / update / delete / patient orders)、患者帯のピクトグラム。
- 既存に 1 行ずつ: `fhir/orderKinds.ts`、`components/orderKindRegistry.tsx`、`KarteCardModals.tsx`、`KarteRightPane.tsx`、
  `fhir/orderTransferLines.ts`、`fhir/karteTimeline.ts`、`karteMenu.ts`、`orderProgressHelpers.ts`、`outpatientOrderProgressHelpers.ts`(略号「透」)、
  `orderSetHelpers.ts` / `orderSetRegistry.tsx`、`extractKinds.ts`、`pathwayHelpers.ts`(`TPDI: "dialysis-order"`)、
  backend `order_set_entry.rb` / `extract_query.rb`、`facility_settings.rb`(`dialysis_shifts`)。
- 上流: `ORDER_END_EXTENSION_URLS` に `dialysis-order-end`(spec も)。再索引は不要(透析オーダーは新規にしか無い)。本番は fhir-server を先に。

**第 2 段: 透析室の設定・ベッド枠・一括展開・部門一覧** — 実装済み(2026-11-10)。

実装で決めたこと:
- 透析一覧のビューはボード(1 日)・週(7 日)・オーダー。ボードと週は同じ `DialysisBoard`(列 = 日 × シフト、行 = 有効なベッド)。
  予約の無いセルは枠の状態(空き・停止・枠なし)を出し、ベッドやシフトに当てはまらない予約(無効にしたベッド・消したシフト)は格子の下に別に並べる。
  セルの操作は表示・予約変更・予約取消。入室・開始・終了は第 3 段で足す。
- ベッドサイドのオーダーは、ボードの格子の下に「ベッドサイド」として依頼済・実施中のものを並べる(実施の入口は第 3 段)。
- オーダーのビューの操作: 依頼済 → 受付、実施中 → 展開・臨時(ベッドサイドは出さない)、ケバブに終了・受付取消・中止。
  「予約」列は基準日以降の有効な予約の件数と最後の日(展開し忘れに気づけるように)。
- 展開: 開始日の初期値は、オーダーの開始日と今日の遅いほう、予約があればその最後(有効・実施済)の翌日。週数は 1〜12、終了日があればそこで止める。
  ベッドの初期値は同じ曜日 × シフトの直近の予約のベッド、無ければ直近の予約のベッド、無ければ未選択(黙って割り当てない)。
- 臨時予約・予約変更は日付とシフトを選び、その日 × シフトの全ベッドの空きをラジオで出す(変更前の枠は「現在」)。
- ホームの部門ワークリストに「透析」(臨床工学技士の既定。当日に効いているオーダーの進捗と本日予約の件数)。
- 予約一覧の Procedure(実施)の読み込みは第 3 段で足す(第 2 段ではボードに実施を出さない)。


- 新規: `fhir/dialysisShiftHelpers.ts` に曜日 × シフト → 日付の展開(`dialysisPatternOccurrences`。曜日は `injectionHelpers.ts` の `dayOfWeekCode`)、`fhir/dialysisUnitHelpers.ts`(Location ← `wardHelpers.ts`、Schedule ← `scheduleHelpers.ts` の `buildSchedule`、`generateDialysisSlots`)、
  `pages/DialysisUnitPage.tsx`、`fhir/dialysisAppointmentHelpers.ts`(`buildDialysisAppointmentBatchBundle`、`isDialysisAppointment`)、
  `pages/DialysisWorklistPage.tsx`(← `RehabWorklistPage.tsx`。ビュー: 当日ボード / オーダー一覧 / 週)、`components/DialysisBoard.tsx`
  (ベッド × シフトの格子。`RadiotherapyCalendar.tsx` を単純化)、`DialysisExpandModal.tsx`、`DialysisBookModal.tsx`(← `RehabBookModal.tsx`)。
- `api/queries/dialysis.ts` 追記: 一覧(`order-period`)、展開プレビュー、当日ボード
  (`Appointment?service-type=schedule-service-type|dialysis&date=ge{d}&date=lt{d+1}&status=booked,arrived,checked-in,fulfilled&_include=Appointment:patient&_include=Appointment:based-on&_include=Appointment:location`。
  `setActiveAppointmentStatus` は fulfilled を除くので使わない)、実施(`Procedure?category=order-type|dialysis&date={d}`)、
  ベッドサイド(`ServiceRequest?category=…&order-period=…` から `dialysis-bedside` を画面側で抜く)、`useUpdateDialysisTaskStatus`。
- 既存: `scheduleHelpers.ts`(`ScheduleType` / `SCHEDULE_TYPE_OPTIONS` / `scheduleTypeOf`)、`appointmentHelpers.ts`(§5.4)、`App.tsx`、`appMenu.ts`、
  `homeSections.ts`(臨床工学技士の件数カード)。

**第 3 段: 実施記録・会計・退院連動** — 実装済み(2026-11-10)。

実装で決めたこと: §6 の箇条書き、§7 の所定点数に含まれる薬剤、ドライウェイトのコード(§2.2)。カルテの詳細は実施の子まで
`_revinclude:iterate` で読み(`useDialysisOrderDetail`)、実施履歴を表にする。患者帯の吹き出しに直近の DW。
クリニカルパスの `TPDI` からの実施入力と、ベッドサイドの急性血液浄化の検証データ(開発環境にベッドサイドのオーダーが無い)は未着手。
デモ投入のシナリオ `dialysis`(`frontend/src/demo-seed/dialysis.ts`、`docs/demo-seed.md`)は実装済み。

- 新規: `fhir/dialysisResultHelpers.ts`(← `treatmentResultHelpers.ts` + `rehabResultHelpers.ts`)、`components/DialysisPerformModal.tsx`
  (← `TreatmentPerformModal.tsx` + `RehabPerformModal.tsx`)。
- backend: `order_catalog.rb`、`resolvers.rb`(`Dialysis`)、`receipt_codes.rb`、`facility_settings.rb`(`receipt_codes.dialysis`)、`orca/medical_message.rb`、
  `components/BillingSendModal.tsx`、`fhir/receiptCodeSettingsHelpers.ts`、`pages/FacilitySettingsPage.tsx`。
- `api/queries/encounter.ts` の `useDischargePatient` に入院の透析オーダーの打ち切り(§4.2)。
- ドキュメント: `docs/order-flows/dialysis.md`(← `order-flows/rehab.md` の構成)と `order-flows/readme.md`、`features/orders-common.md` の種別列挙、
  `features/ward.md`「診察室・撮影室との分け方」に透析室、`features/facility.md` の施設設定、`features/home.md` の既定カード、
  `features/admin-integration.md` のレセコン種別表、`functional-gap-backlog.md` の対応済みの印、`server-improvement-backlog.md` に上流の拡張追加。

### 検証の手順(開発環境)

1. `docker compose exec frontend npx tsc -b`、`npm run lint`、backend は `-e RAILS_ENV=test -e ADMIN_TOKEN=` で rspec
   (施設設定・OrderCatalog・resolver の spec を足す)。上流は `../fhir-server` のコンテナで rspec。
2. ブラウザ(ichiro): 施設設定にシフト 2 本 → 透析室の設定でベッド 3 台 + 枠 1 か月 → カルテ右ペインから HD 月水金午前のオーダー →
   透析一覧で受付 → 4 週展開(プレビュー 12 件) → 当日ボードで入室 → 開始 → 終了(体重・除水・ESA のロット・血液浄化器) →
   カードに実施 1 件・患者帯に紫のピクトグラム → 終了で翌日以降の予約が消える → 会計送信モーダルに「透析」の剤。
   別患者で同じ枠を先に取ってから展開し、412 のメッセージが出ることも見る。ライト・ダークの両方で見る。
3. 開発データ: `frontend/src/demo-seed/` に透析導入の患者シナリオ(ベッド・Schedule・Slot も同じヘルパーで作る)を足し、`docs/demo-seed.md` に 1 行。
