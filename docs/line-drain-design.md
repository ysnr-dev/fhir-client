# ライン・ドレーン・カテーテル管理(留置台帳)

`docs/functional-gap-backlog.md` §6.0 #2・§6.1「ライン・ドレーン・カテーテル管理(LDA)」。
**状態: 実装済(2026-11-07)。**
患者の体に入っている管(中心静脈カテーテル・末梢ライン・尿道カテーテル・胃管・ドレーン・気管チューブなど)を
1 本ずつ台帳で持ち、挿入・刺入部観察・抜去を記録して「留置 n 日目」を病棟の画面に出す。
デバイス日数(CLABSI / CAUTI の分母)を病棟 × 月で数える。

- **［事実］** = FHIR 仕様、このリポジトリ・上流(`../fhir-server`)の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 現状

- ［事実］ドレーン排液は経過表の水分出納で部位別に数えられる(`docs/flowsheet-design.md` §7。施設設定の MEDIS 観察項目 +
  看護指示の実施 Observation)。挿入日・部位・サイズ・抜去を持つ台帳は無く、留置期間も、留置中の管の一覧も出せない。
- ［事実］上流は `Device` を実装済み(JP_Device、`patient` / `status` / `type` / `identifier` 検索、患者コンパートメント入り)。
  client の中継 `fhir_proxy_controller.rb` の `ALLOWED_RESOURCE_TYPES` に無いだけで使っていない。
- ［事実］上流の `Procedure.date` は `performedPeriod` を `[start, end)` として索引し、`end` 無しを「進行中」と扱う。
  `ge` / `le` の併用は期間の重なり判定になる。`Observation.part-of`(→ Procedure)の検索と `_revinclude=Observation:part-of` がある。
- ［事実］上流に `Procedure.focalDevice` を辿る検索・`_include` は無い。`Observation.device` / `focus` の検索も無い。

## 1. リソースの構造

### 1.1 留置 1 件 = 挿入の `Procedure` 1 件

- ［設計］留置の正体は **挿入の Procedure** にする。`performedPeriod.start` が挿入、`end` が抜去で、留置中は `end` を持たない。
  上流の `date` 検索がそのまま「期間と重なる留置」「進行中の留置」を引け、観察は `Observation.partOf` で結べる。
  Device を正体にすると挿入日・抜去日の置き場が無く、Procedure ⇄ Device を辿る検索が上流に無いので一覧が組めない。
- ［設計］`category` はオーダー由来の実施記録(`order-type`)と混ざらないよう、オーダーに属さない Procedure の体系
  `http://fhir-client.local/CodeSystem/procedure-category`(輸血の出庫 `transfusion-dispense` と同じ体系)に `line-drain` を足す。
  SS-MIX2 の `RasO17` / `OmiZ23` は `order-type` が処方・注射・放射線・内視鏡でなければ `nil` を返すので、留置の Procedure はメッセージにならない。

```text
Procedure
  meta.profile          = JP_Procedure
  status                = in-progress(留置中)/ completed(抜去)/ entered-in-error(誤登録)
  category              = procedure-category | line-drain 「ライン・ドレーン」
  code.coding[0]        = http://fhir-client.local/CodeSystem/line-drain-type | <種別マスタの code>(display = 登録時点の名称の写し)
  code.coding[1]        = http://fhir-client.local/CodeSystem/line-drain-kind | <区分(§3)>(マスタを引かずに系統を分けるための写し)
  subject               = Patient
  encounter             = 入院中なら今の入院(useOrderContext().encounterId。バイタルと同じ)
  performedPeriod.start = 挿入日時(toFhirDateTime)
  performedPeriod.end   = 抜去日時(留置中は無し)
  bodySite[0].text      = 部位(自由記載。「右内頸」「左前腕」「右胸腔」)
  focalDevice[0].action = http://hl7.org/fhir/CodeSystem/device-action | implanted
  focalDevice[0].manipulated = { reference: Device, display: 「製品名 サイズ」の 1 行 }
  performer[0].actor    = 挿入者(Practitioner)
  reasonCode[0].text    = 目的(任意。「輸液」「術後ドレナージ」)
  outcome               = http://fhir-client.local/CodeSystem/line-drain-removal | 抜去の区分(抜去時のみ。§2)
  note[0].text          = 挿入時のコメント、note[1].text = 抜去時のコメント
  extension[order-department] = 登録した診療科(departmentExtension。バイタルと同じ)
```

- ［設計］Device の内容(製品名・サイズ)は `focalDevice.manipulated.display` に写す。上流に `focal-device` の include が無いので、
  一覧・カード・経過表・患者帯は Device を引き直さず Procedure だけで描く。Device 本体を読むのは編集フォームだけ(`Device/{id}` を 1 件 read)。
- ［設計］抜去の区分は標準要素 `outcome`(留置の結末)に置き、拡張は足さない。計画外抜去(自己・事故)の集計は `outcome` を見る。
- ［設計］「留置 n 日目」= `localDay(today) - localDay(start) + 1`(挿入当日が 1 日目)。抜去済は「n 日間」。
- ［事実］上流の `procedure_validator.rb` が必須にするのは `status` と `subject` だけ。JP_Procedure の検証は warn。

### 1.2 管の実体 = `Device`(同じ transaction で POST)

```text
Device
  meta.profile  = http://jpfhir.jp/fhir/core/StructureDefinition/JP_Device
  status        = active(抜去後も変えない。留置の状態は Procedure が持つ)
  type          = line-drain-type | <種別マスタの code>(Procedure.code.coding[0] と同じ)
  deviceName[0] = { name: 製品名, type: "user-friendly-name" }(任意)
  lotNumber     = ロット(任意)
  property[0]   = { type: { text: "サイズ" }, valueCode: [{ text: "7Fr" }] }(任意。Fr / G / mm が混ざるので文字列)
  patient       = Patient
```

- ［設計］Device は管の属性(種別・製品・サイズ・ロット)の置き場で、挿入ごとに 1 件作る(同じ製品を 2 本入れても別の Device)。
  将来の植込みデバイスの UDI 台帳(`functional-gap-backlog.md` §6.1)と同じ型を使うため Device を省かない。
- ［事実］`device_validator.rb` に必須項目は無い。`status` の値セットと `patient` が Patient を指すことだけを見る。

### 1.3 刺入部観察 = `Observation`(台帳から直接書く)

```text
Observation
  status            = final
  category          = http://fhir-client.local/CodeSystem/observation-category | line-drain-site 「刺入部観察」(有害事象と同じ体系)
  code              = http://fhir-client.local/CodeSystem/line-drain-site-finding | site-check 「刺入部観察」
  subject           = Patient、encounter = 入院(あれば)
  partOf[0]         = Procedure/{留置の id}
  effectiveDateTime = 観察日時
  performer[0]      = 観察者(Practitioner)
  component[]       (code は line-drain-site-finding 体系)
    redness   発赤         valueCodeableConcept: none / mild / marked
    swelling  腫脹         同上
    pain      疼痛         同上
    exudate   滲出液       同上
    fixation  固定         ok / loose / detached
    patency   開通性       ok / sluggish / occluded(血管・ドレーン・消化管の区分だけ表示)
    dressing  ドレッシング交換 valueBoolean
  note[0].text      = 所見・処置
```

- ［設計］観察は**台帳の行から直接書く**。看護指示(ServiceRequest)は作らない。頻度の管理は施設の運用に任せ、
  指示の終了・変更を留置と同期させる仕組みを持たない。
- ［設計］項目は**自前の固定項目**にする。刺入部の観察は数段階の有無を数項目まとめて入れる定型で、MEDIS 看護観察マスタには
  刺入部に特化した段階値の定義が無い。固定項目なら履歴表の列が安定し、マスタの有無・版に依存しない。
- ［設計］1 回の観察 = 1 Observation(component で項目を持つ)。履歴表で行が揃い、削除が 1 件で済む。
- ［設計］留置との結びは `partOf` だけ(上流で検索・`_revinclude` が効く唯一の参照)。`focus` / `device` は使わない。
- ［事実］JP_Observation_Common は `category` 1..* だが warn。手書きバリデータの必須は `status` / `code` / `subject`。

### 1.4 検索

| 用途 | 式 |
|---|---|
| 患者の台帳(プロファイル区画・カード・患者帯・警告) | `Procedure?patient=&category=procedure-category\|line-drain&status:not=entered-in-error&_revinclude=Observation:part-of&_sort=-date&_count=500` |
| 患者の留置中 | 上の結果を `status === "in-progress"` で絞る(1 患者で有限。別クエリを足さない) |
| 病棟横断・留置中 | `searchExtractRecords("Procedure", params, patientIds)`(患者 100 人ずつ `subject=`、`_include=Procedure:subject` 自動)に `category=…\|line-drain&status=in-progress&_revinclude=Observation:part-of`(最終観察を出す) |
| デバイス日数(病棟 × 月) | 同関数に `category=…\|line-drain&status:not=entered-in-error&date=ge{月初}&date=le{月末}`(期間と重なる留置。`end` 無しは進行中として重なる) |
| 経過表の帯 | `Procedure?patient=&category=…\|line-drain&status:not=entered-in-error&date=ge{表示開始}&date=le{表示終了}&_count=500` |
| 観察の履歴 | 台帳の `_revinclude` で届いた Observation を `partOf` で束ねる(別クエリ無し) |

- ［設計］病棟横断は `searchAllPages` 経由で `truncated` を `TruncatedNotice` に出す。デバイス日数は欠けると分母が狂うので、
  `truncated` のときは表を出さず「読み切れていない」と表示する(黙って切らない)。

## 2. 状態

| 画面の状態 | `status` | `performedPeriod.end` | `outcome` |
|---|---|---|---|
| 留置中 | in-progress | 無し | 無し |
| 抜去済 | completed | 抜去日時 | 抜去の区分 |
| 誤登録 | entered-in-error | 変えない | 変えない |

抜去の区分(`line-drain-removal`): `planned` 計画抜去 / `self` 自己抜去 / `accidental` 事故抜去 / `infection` 感染疑い /
`occlusion` 閉塞・不良 / `other` その他。

- ［設計］抜去は読んだ Procedure を書き換えて `postBundle`(版が `ifMatch` に付く)。412 は Flag と同じ文言で読み直しを促す。
- ［設計］抜去取消は「抜去済 → 留置中」(`end`・`outcome`・`note[1]` を落として in-progress)。ケバブに畳む。
- ［設計］編集(種別・部位・サイズ・ロット・挿入日時・挿入者・目的)はフォームから組み直すので
  `withVersionLock(bundle, 元の Procedure, 元の Device)`、元データは `useEditSnapshot` で開いた版に固定する。
- ［設計］誤登録は確認して `entered-in-error` にし、DELETE しない(`FhirDeleteProvenance` の対象に Device を足す必要が無い)。
  観察 Observation は残るが台帳から見えなくなる。
- ［設計］交換(抜去 + 新規挿入を 1 操作で)は持たない(§6)。抜去して新しく登録する。

### 2.1 記録者

- ［設計］挿入者・観察者は `performer`。既定はログイン中の医療従事者(`useOrderEnterer()`)で、挿入者は選び直せる(代行入力)。
  管理者ログイン(Practitioner 無し)でも登録でき、`performer` 無しで保存する(有害事象と同じ扱い)。
- ［設計］Provenance は付けない。オーダーではなく観察・処置の記録で、誰が行ったかは記録そのものの属性(有害事象の決定を踏襲)。

## 3. 種別マスタ(`master_line_drain_types`)

- ［設計］単純マスタ(薬剤師介入種別と同じ作り)。列は `code`(unique)・`name`・`kind`・`warn_days`(整数、null 可)・`enabled`・`display_order`。
  区分 `kind` は固定の値:

| `kind` | 名称 | デバイス日数の系統 |
|---|---|---|
| `vascular-central` | 中心静脈 | 中心静脈カテーテル(CLABSI) |
| `vascular-peripheral` | 末梢静脈 | — |
| `arterial` | 動脈 | — |
| `urinary` | 尿路 | 尿道留置カテーテル(CAUTI) |
| `airway` | 気道 | 気管チューブ(VAP) |
| `gi` | 消化管 | — |
| `drain` | ドレーン | — |
| `other` | その他 | — |

- ［設計］`warn_days` は一覧・患者帯・カードで「留置日数が超えたら赤く出す」既定値。警告(advisory)の閾値は施設の規則の式に書く(§4.8)。
- ［設計］seed に代表的な種別を同梱する(code / name / kind / warn_days):
  `cvc` 中心静脈カテーテル vascular-central 14、`picc` PICC vascular-central 30、`cv-port` CV ポート vascular-central —、
  `piv` 末梢静脈カテーテル vascular-peripheral 4、`a-line` 動脈ライン arterial 7、`foley` 尿道留置カテーテル urinary 7、
  `nephrostomy` 腎瘻 urinary 30、`ett` 気管チューブ airway 14、`trach` 気管切開チューブ airway —、`ngt` 経鼻胃管 gi 14、
  `peg` 胃瘻 gi —、`chest-tube` 胸腔ドレーン drain 7、`drain-closed` 閉鎖式ドレーン drain 7、`drain-open` 開放式ドレーン drain 7、
  `epidural` 硬膜外カテーテル other 4。
- ［要確認］`warn_days` の既定値。CDC のガイドラインは「必要性を毎日評価」で日数の上限を定めていないため、施設の運用値に合わせて変える前提。
- 画面はマスタメンテの「看護」グループに `/line-drain-types`(`SimpleMasterPage`、`kind` は select)。

## 4. 画面

### 4.1 登録・編集(カルテ右ペイン)

- 右ペインの登録メニュー「看護 > ライン管理」(`karteMenu.ts`。正式名はライン・ドレーン)。項目は種別(マスタ)・部位・サイズ・製品名・ロット・挿入日時(既定いま)・
  挿入者・目的・コメント。ボタンは「登録」「更新」。
- カードの「編集」から同じフォームを右ペインで開く(`line-drain-edit`)。右ペインを使うのはこの登録と編集だけ。

### 4.2 カルテのカード

- 記録種別 `line-drain`(`karteTimeline.ts` の `KARTE_RECORD_KINDS`)。日付は挿入日。見出しは「種別 部位」、本文に デバイス・
  「留置 n 日目」または「n 日間(抜去日時・区分)」・直近の観察 1 行。ケバブは「編集」のみ(抜去・観察・誤登録はプロファイル区画で行う)。
- 観察 Observation はカードにしない(留置のカードと区画の履歴表で読む)。

### 4.3 プロファイル区画「ライン・ドレーン」

- `KarteProfileTab` の区画(有害事象の隣)。既定は留置中だけ表示し、「抜去したものも表示」で切り替える。
- 行 = 種別・部位・デバイス・挿入日時・挿入者・「留置 n 日目」(`warn_days` 超は赤)・最終観察。
  行のボタン「観察」「抜去」(compact)、ケバブに「観察履歴」「編集」「抜去取消」(抜去済のみ)「誤登録」。
- 抜去モーダル: 抜去日時(既定いま)・区分・コメント。ボタン「抜去」。抜去日時 ≥ 挿入日時を検証する。
- 観察モーダル: 上に履歴表(列 = 日時、行 = 項目)、下に入力(日時・各項目・ドレッシング交換・所見)。ボタン「登録」。
  行のゴミ箱(`TrashIcon`、「観察を削除」)。

### 4.4 患者帯のピクトグラム

- `cautionPictograms.tsx` に `line-drain`(注意区分マスタでは選ばせない。患者帯が台帳から直接使う)。留置中が 1 件以上で出し、件数を添える。
  吹き出しは「種別 部位 留置 n 日目」の一覧で、`warn_days` 超があれば警告色。リンクはプロファイル区画。
- 一覧の患者ドロワーも同じ帯なので自動で出る。

### 4.5 病棟横断の一覧(`/line-drains`、「看護業務」メニュー)

- `PressureUlcerPage` と同じ構造(URL の `ward` / `date` / `tab`、`useWardInpatients`)。
- 「留置中」タブ: 病室・患者・種別・部位・デバイス・挿入日・留置日数(`warn_days` 超は赤)・最終観察(3 日以上前は赤)・挿入者。
  行の「観察」「抜去」は §4.3 のモーダルをそのまま使う(カルテへ移らない)。区分で絞り込める。
- 「デバイス日数」タブ(病棟 × 月): 行 = 中心静脈カテーテル / 尿道留置カテーテル / 気管チューブ / その他、
  列 = デバイス日数・新規挿入・抜去・計画外抜去(`outcome` が self / accidental)・使用比(デバイス日数 ÷ 患者延べ日数)。
  患者延べ日数は `wardPatientsByDay`(ベッドスケジュールの計算)で出し、デバイス日数は日ごとに `start ≤ 日 かつ (end 無し または end ≥ 日)` の件数を足す
  (褥瘡の発生率と同型)。当月は今日までで数える(先の日の在院は見込みで、分母にしない)。
- 入院患者一覧のケバブ「病棟の関連画面」にも並べる。

### 4.6 看護ワークシート

- 患者欄のサブ行に留置中の管を「種別 n日目」で並べる(病棟 1 回の読み込みで済む)。

### 4.7 経過表の帯

- 印の欄 `MARK_SECTIONS` に `device`「ライン・ドレーン」を注射の前に足す。1 留置 = 1 行、印は `at` = 挿入日時・`end` = 抜去日時
  (留置中は表示終了の翌日 0 時にして右端まで伸ばす)。印のモーダルは一覧のみで実施は無い。
- ［事実］24 時間表示の `slotCenterX`(`VitalFlowsheetPanel.tsx`)は表示日以外の日付を一律 0(左端)にしているので、
  日をまたぐバーは `x = endX = 0` に潰れる。
- ［設計］表示日より前は左端、後は右端、表示日で枠が無いときは中央に寄せるよう変える。期間表示は既に前後で端に寄せているので変えない。
- `FlowsheetEventKind` に `device` を足す(`KIND_ORDER` の末尾)。

### 4.8 長期留置の警告(施設の規則)

- `populateContext` に変数 `%devices`(留置中の各件 `{ code, name, kind, bodySite, insertedAt, daysInserted }`)を足し、
  `usesVariables` で式が参照するときだけ台帳を読む(`%mealDiet` と同じ遅延)。この変数はテンプレートの初期値式でも使える。
- 新しい `AdvisoryKind` / `AdvisoryContext` は足さない(`facility-rule` + `patient-view` で足りる)。
- seed の `advisory_rules.csv` に記入例を**無効**で 2 件: `%devices.exists(kind='vascular-central' and daysInserted > 14)`(CLABSI 予防)、
  `%devices.exists(kind='urinary' and daysInserted > 7)`(CAUTI 予防)。
- ［設計］`%devices` にマスタの `warn_days` を持たせない(populate がマスタを読まない)。閾値は規則の式に書く。

## 5. 上流

- ［事実］第 1 段階は上流の変更なしで組める(Device の CRUD・`Procedure.date` の期間検索・`Observation.part-of` が揃っている)。
- client 側で足すのは `ALLOWED_RESOURCE_TYPES` の `Device` だけ(transaction の POST は許可リストを通らないが、編集での read に要る)。
- 上流に無いもの(`docs/server-improvement-backlog.md` に記録。実装を依存させない):
  - `Procedure` の `focal-device` 検索と `_include=Procedure:focal-device`(いまは Device の内容を `manipulated.display` に写して回避)
  - `Observation` の `device` / `focus` 検索(いまは `partOf` で結ぶ)
  - `Provenance:target` の対象に Device(Device を単独で更新する将来の来歴のため)

## 6. 未実装・今後

- **看護必要度の初期値**(ドレナージの管理・中心静脈圧測定・動脈圧測定): 留置中の管から「あり」を推せるが、評価票の項目は
  測定・管理の実施で、留置しているだけで該当と言えるかは評価の手引きの確認が要る(［要確認］)。
- **水分出納との連動**: 台帳のドレーンを排液量の入力行として出す。いまは施設設定の MEDIS 観察項目で部位別に数える方式のまま。
- **CLABSI / CAUTI / VAP の分子**(感染判定): 医療関連感染サーベイランス(`functional-gap-backlog.md` §6.1)で扱う。本機能は分母(デバイス日数)まで。
- **交換**(抜去 + 新規挿入を 1 操作で)、**部位図**、**Device.status の更新**、**MEDIS 看護観察マスタとの対応づけ**。
- **データ抽出の種別**「留置」: 抽出条件に Procedure(category line-drain)を足せば「留置した患者」は出せるが、延べ日数は出ない(指標は患者数単位)。
- **SS-MIX2**: 対象外のまま(留置の Procedure はメッセージを起こさない)。
