# 輸血オーダーの設計

病理検査オーダー(`docs/patho-order-design.md`)を雛形にした輸血(赤血球液・新鮮凍結血漿・
濃厚血小板 など)のオーダー。マスタ → オーダー入力 → カルテカード → 部門一覧 →
実施入力 まで病理・処置と同じ形で、違うところだけをここに書く。同じところは病理の
設計書(とその参照先の処置・生理検査の設計書)を参照。

実装日: 2026-08-29。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. スコープ

輸血は「製剤を何単位、いつ投与するか」を依頼し、輸血部門が交差適合試験(クロスマッチ)
を経て製剤を払い出し、病棟が投与する。本実装で扱うのは次のとおり。

| 扱う | 扱わない(申し送り §7) |
|---|---|
| 製剤マスタ(施設で編集する少数のマスタ) | 血液センターへの発注・在庫管理 |
| オーダー入力(製剤・単位数・投与予定日・検査区分・製剤ごとの血液型) | 製剤 1 バッグ単位の在庫引当・返品 |
| 血液型・不規則抗体の参照(検査結果の 2 回一致で確定) | 輸血関連検査(ABO/RhD/不規則抗体)のオーダー自動発行 |
| 輸血部門一覧(受付 → 出庫 → 実施、自己血の採血) | 交差用検体の期限 |
| 出庫入力(バッグごとの払出記録・交差適合試験の結果・割付チェック) | 副作用の詳細報告書(ヘモビジランス様式) |
| 実施入力(照合・確認者・製剤番号・観察・副作用の症状) | 輸血後感染症検査のフォロー管理 |
| カルテカード・詳細モーダル・輸血関連情報カード | |

### 1.1 命名

［提案］英語識別子は `transfusion`。`blood` は検体検査の検体(blood)と紛らわしく、
`bloodproduct` は製剤(モノ)を指してオーダー(行為)を指さないので使わない。画面・カード・
メニューの表記は「輸血」。

### 1.2 既存の「輸血」との関係

［事実］手術オーダーに輸血準備の項目(`surgeryOrderHelpers.ts` の
`SURGERY_BLOOD_PREPARATION_OPTIONS`)があり、手術実施入力には輸血量の Observation
(`surgeryResultHelpers.ts`)がある。

［提案］どちらも残す。手術の輸血準備は「手術申込時点の見込み」であって輸血オーダー
そのものではなく(実際に出すかは術中に決まる)、手術実施の輸血量は術中出納の一項目
だから。輸血オーダーは、手術中に実際に出すことが決まった時点で別に発行される。
両者を自動で連動させることはしない(見込みと実施は別の意思決定)。

---

## 2. FHIR の構造

病理と同型。ヘッダも明細も ServiceRequest。

```text
ヘッダ ServiceRequest  (category: order-type|transfusion)
  code = 輸血検査区分 / occurrenceDateTime = 投与予定日時 / priority = 緊急度
  locationReference = 使用場所 / reasonCode.text = 使用目的
  extension[transfusion-abo] = 患者の ABO 血液型(不明は unknown) / extension[transfusion-rhd] = 患者の RhD
  extension[transfusion-consent] = 同意書確認済(valueBoolean)
  ←basedOn── 明細 ServiceRequest ×N = 製剤 1 種類ぶん(code = 製剤、quantity = 単位数、
                                         extension[transfusion-abo/rhd] = その製剤を出す型)
  ←focus──── Task            (進捗: transfusion)
  ←basedOn── Procedure       (出庫記録ハブ、category = procedure-category|transfusion-dispense)
                               ←partOf── MedicationDispense ×N = 払い出したバッグ 1 本
  ←basedOn── Procedure       (実施記録ハブ、category = order-type|transfusion、
                               performer = 実施者 / 確認者、extension = 照合の結果)
                               ←partOf── MedicationAdministration ×N(入れなかったバッグは not-done)
                               ←partOf── Observation(副作用。症状は component、遅発性は後から追記)
                               ←partOf── Observation(投与前・5 分後・15 分後・終了時のバイタル)
```

### 2.1 なぜ明細を独立した ServiceRequest にするか

［提案］食事のように「ヘッダ 1 本 + orderDetail」にはしない。理由は 2 つ。

1. **量を持てない**。1 オーダーに「RBC-LR 4 単位 + FFP-LR 2 単位」のように製剤ごとの
   単位数が付く。［事実］`ServiceRequest.orderDetail` は CodeableConcept なので数量を
   持てず、載せるならローカル拡張が要る(処置が器材の数量で同じ問題に当たっている)。
   明細を ServiceRequest にすれば［事実］`ServiceRequest.quantityQuantity`(R4 標準)に
   単位数をそのまま置ける。
2. **取得の作法が既存と揃う**。カルテ・部門一覧はどちらも
   `_revinclude:iterate=ServiceRequest:based-on` で明細を連れてくる形で統一されており、
   病理の検体明細と同じコードで書ける。

### 2.2 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `transfusion` | ヘッダの `category[0]`。`isTransfusionServiceRequest` の判定軸 |
| `CodeSystem/transfusion-test-type` | ヘッダの `code`。輸血検査区分(T&S / 交差適合試験) |
| `CodeSystem/transfusion-product` | 明細の `code.coding`。製剤マスタの独自コード |
| `CodeSystem/task-code` の値 `transfusion` | 進捗 Task の `code` |
| `IdSystem/transfusion-order-item-number` | 明細 `identifier`。画面で並べた順 |
| `CodeSystem/transfusion-abo` | ABO 血液型(A / B / O / AB。ヘッダだけ unknown = 不明) |
| `CodeSystem/transfusion-rhd` | RhD 血液型(positive / negative。ヘッダだけ unknown) |
| `StructureDefinition/transfusion-abo` | ヘッダ = オーダー時点の患者の ABO、明細 = その製剤を出す ABO(valueCodeableConcept) |
| `StructureDefinition/transfusion-rhd` | ヘッダ = 患者の RhD、明細 = 製剤の RhD(valueCodeableConcept) |
| `StructureDefinition/transfusion-consent` | ヘッダ。輸血同意書の確認済フラグ(valueBoolean) |
| `StructureDefinition/transfusion-lot-number` | MedicationAdministration。製剤番号(valueString) |
| `CodeSystem/procedure-category` の値 `transfusion-dispense` | 出庫記録ハブ Procedure の `category`。実施記録(order-type)と別の体系 |
| `IdSystem/blood-product-number` | MedicationDispense の `identifier`。製剤番号(献血番号) |
| `StructureDefinition/transfusion-expiry` | MedicationDispense。バッグの有効期限(valueDate) |
| `StructureDefinition/transfusion-irradiated` | MedicationDispense。照射済か(valueBoolean) |
| `StructureDefinition/transfusion-crossmatch` / `CodeSystem/transfusion-crossmatch` | MedicationDispense。交差適合試験の結果(compatible / incompatible / omitted) |
| `CodeSystem/transfusion-dispense-performer` | MedicationDispense.performer.function(dispenser = 出庫者 / crossmatch = 適合試験者) |
| `CodeSystem/transfusion-performer` | 実施記録 Procedure.performer.function(performer = 実施者 / verifier = 確認者) |
| `StructureDefinition/transfusion-verification` / `CodeSystem/transfusion-verification-skip-reason` | 実施記録。投与時の照合の結果(status・patient・bag・reason・at) |
| `CodeSystem/transfusion-bag-outcome` | MedicationAdministration.statusReason。入れなかったバッグの扱い(not-given = 未実施 / returned = 返却) |
| `CodeSystem/transfusion-reaction-symptom` | 副作用 Observation の component。日本輸血・細胞治療学会の症状項目 |
| `StructureDefinition/transfusion-reaction-timing` | 副作用 Observation。immediate(輸血中〜直後)/ delayed(遅発性、実施後の追記) |
| `StructureDefinition/transfusion-observation-point` | バイタル Observation。観察の時点(before / 5min / 15min / end) |
| `CodeSystem/transfusion-reaction` | 副作用 Observation の `code` と値 |

再利用: `CodeSystem/prescription-setting`(入外区分)、依頼科・病棟の拡張
(`applyOrderContext`)、JP Core `route-codes`(投与経路 IV)、JP_Procedure。

### 2.3 輸血検査区分をヘッダの code に置く

［事実］輸血の依頼は「T&S(タイプ&スクリーン。事前に血液型と不規則抗体だけ調べておき、
実際に出すときに省略法で適合を確認する)」と「交差適合試験(製剤を指定して患者血と
実際に混ぜる)」で部門の作業が変わる。

［提案］病理の検査区分(組織診/細胞診)と同じ位置づけなので、同じくヘッダの `code` に
置く。1 オーダーに 1 つだけ選ぶ軸であり、部門一覧の絞り込み軸にもなる。

### 2.3.1 緊急度は priority

［事実］JAHIS 患者安全ガイド(輸血編)付録 1-3 の危機的出血の 3 段階(レベルⅠ = 心停止が切迫・準備 10 分・
交差試験なし / レベルⅡ = 昇圧剤が要る・30 分・生食法 / レベルⅢ = 循環は安定・60 分)。

［提案］FHIR の `priority` に stat / asap / urgent を当て、緊急でない依頼は routine。部門一覧・カードは
「緊急Ⅰ〜Ⅲ」のバッジ。至急区分(routine / urgent)で登録した古いオーダーはレベルⅢとして読む。

### 2.3.2 使用場所と使用目的

［提案］使用場所は `locationReference`(病棟 HU・手術室 SU・救急 ER・検査処置室 DX の Location)。
ガイド 7.2.2-3 の「別部署に払い出された」事例への対策で、入院中は入院病棟が初期値。
使用目的は `reasonCode.text` の自由記述(登録病名の参照 `reasonReference` とは別)。

### 2.4 日付軸

［提案］`occurrenceDateTime` = 投与予定日時。［事実］上流は `occurrenceDateTime` しか
索引しない(`docs/server-improvement-backlog.md`、病理・食事と同じ制約)ので Period は
使わない。部門一覧の日付軸とカルテカードの置き場所を兼ねる。

実際に投与した時間帯は実施記録側の `Procedure.performedPeriod` で持つ。［提案］輸血は
「いつ始めていつ終わったか」が副作用の判断に直結する(開始 15 分以内の観察が要る)ので、
処置の `performedDateTime`(時点)ではなく Period(期間)にする。

### 2.5 血液型はオーダーに載せ、検査結果は参照として隣に置く

［事実］血液型(ABO/RhD)と不規則抗体スクリーニングは検体検査の結果(Observation)として
既にカルテに入る。

［提案］**血液型そのものはオーダーに載せる**(`transfusion-abo` / `transfusion-rhd`)。
輸血は「何型を出すか」が依頼の中身そのもので、製剤の払い出しはこの型で行われるため、
オーダーを読んだだけでは型が分からないのでは依頼として成り立たない。ABO と RhD を
1 つの拡張にまとめないのは、検査としても別項目(JLAC11 も別)で、「ABO は分かっているが
RhD はこれから」という状態がありうるため。

［提案］一方、**検体検査の結果への参照は保存しない**。保存すると結果が修正・削除された
ときの整合をオーダー側で面倒みることになる一方、輸血部門は自部門で改めて検査するのが
実務なので、オーダーに焼き付ける意味が無い。結果は画面に参照として並べるだけで、
正本は常に検査結果側にある。

血液型は JAHIS 患者安全ガイド(輸血編)7.2.3 に寄せて 2 か所に分ける
(`docs/transfusion-backlog.md` §7.2)。

- **ヘッダ = オーダー時点の患者の血液型**。検体検査の結果で確定した型(異なる日の 2 検体で一致、
  `fhir/bloodTypeHelpers.ts`)だけを写し、確定していなければ `unknown`(不明)を明示する。医師は手で
  入れない。申告のままの型や 1 回だけの検査結果は参照として並べるにとどめ、警告「血液型の未確定」を出す。
- **明細 = その製剤を出す血液型**。患者の型・製剤区分・緊急度から既定を入れ、適合する型だけを
  選ばせる(`compatibleAbo` / `compatibleRhd`)。選ぶのはフォーム先頭の「血液型」のチップ(従来と同じ
  見た目)で、選んだ型は適合するすべての製剤に入る。押せるのは選択中の製剤すべてに適合する型だけで、
  区分ごとに適合する型が違う(型が不明で赤血球と血漿を一緒に出すなど)ときは製剤カードの型を読む。赤血球は抗原(A → A/O、AB → 全部、O → O)、血漿・血小板は
  抗体(A → A/AB、O → 全部、AB → AB)で決まり、型が不明なら赤血球は O・血漿と血小板は AB だけ
  (指針の異型適合血)。RhD 陰性の患者には陰性だけ(レベルⅠは陽性も可)、血漿は RhD を問わない。
  自己血は本人の型だけ、区分「その他」(アルブミンなど)は型を持たない。
- 患者の型と違う型を選んだ製剤には「異型」の印を付け、警告(表示のみ)にも出す。
- 製剤の型を持たない古い明細は、ヘッダの型(当時は「何型を出すか」)を製剤の型として読む。

依頼時の警告(`fhir/transfusionAdvisoryHelpers.ts`、警告の器 `docs/advisory-design.md`): 輸血拒否の注意区分、
血液型の未確定(未検査 / 1 回 / 不一致)、不規則抗体スクリーニングの未検査と有効期間外(施設設定
`transfusion.antibody_screen_valid_days`、既定 3 日、投与予定日を含む)、異型適合血、輸血副作用歴。

### 2.5.1 血液型の色

［事実］日本赤十字社の血液製剤のラベルは ABO 血液型ごとに区分色が決まっている
(A = 黄 / B = 白 / O = 青 / AB = 桃)。

［提案］選択中のチップとカード・詳細のバッジをこの区分色で塗る。現場で見慣れた色と
一致させることで、文字を読まなくても型が掴め、取り違えに気付きやすくなる。色そのものに
意味があるので明暗テーマで色は変えず、文字色の方をそれぞれの背景に合わせて固定する
(白は明るいテーマの地と紛れるため純白にし、選択の輪郭は本文色で囲む)。

［提案］RhD には日赤のラベル区分色が無い。陽性(多数派)は色で主張させず、陰性は適合する
製剤が限られる(在庫の確認が要る)ので注意色にする。

### 2.6 製剤番号を拡張で持つ理由

［事実］FHIR で製剤のロット番号を標準的に持つ場所は `Medication.batch.lotNumber` で、
MedicationAdministration からは contained Medication か参照で指す。

［提案］ローカル拡張 `transfusion-lot-number` を
MedicationAdministration に直接付ける。既存のコードベースは処方・注射・処置・手術の
どこでも contained Medication を使っておらず(すべて `medicationCodeableConcept`)、
ここだけ別の作法を持ち込むと読み手が 2 通りの形を覚えることになるため。製剤番号は
実施記録の一属性として扱えば足りる(在庫引当をしないので Medication インスタンスを
作る動機が無い)。

［追記 2026-10-06］薬剤のロット番号(特定生物由来製品など)も同じ作法で、拡張
`medication-lot-number` を MedicationAdministration に付ける。上流の `lot-number` 検索は
両方の拡張を索引するので、製剤番号もロット管理画面の検索で引ける(`docs/lot-number-design.md`)。

### 2.7 副作用は Observation

［提案］手術の出血量・尿量(`surgeryResultHelpers.ts`)と同じく Observation にする。
`code` = `transfusion-reaction`、値は「なし / あり」の CodeableConcept で、内容は note に
書く。実施ハブの Procedure に `partOf` でぶら下げ、`category` に order-type を持たせて
他部門の Observation と振り分ける(手術が既に採っている方式)。

［導出］「副作用なし」も記録する。輸血では観察したうえで無かったことが記録として要る
ので、Observation が無い = 未観察、値が none = 観察して無かった、を区別する。

### 2.7.1 出庫記録は MedicationDispense(2026-11-01)

［事実］JAHIS 患者安全ガイド(輸血編)7.3〜7.4 は、割付・払出でバッグごとに患者の型・依頼の型・
製剤種・有効期限・不規則抗体・照射・交差適合試験の結果を確かめ、不適合のバッグを出庫させないことを
求める。それまでの出庫はボタン 1 つで、何を出したかを記録していなかった。

［提案］出庫で**バッグごとに `MedicationDispense`** を作る(注射の払出と同じ器)。製剤番号は
`identifier`(`blood-product-number`)、バッグの血液型は明細と同じ `transfusion-abo/rhd` の拡張、
有効期限・照射・交差適合試験の結果はローカル拡張、対応する依頼の製剤明細は `supportingInformation`。
出庫者と適合試験者は `performer.function` で分ける。

［事実］上流の `MedicationDispense` はオーダー(ServiceRequest)を直接参照できない
(`authorizingPrescription` は MedicationRequest 専用)。［提案］実施記録と同じ**ハブ + 子**の形にし、
出庫記録ハブの `Procedure`(`basedOn` = オーダー)に `partOf` でぶら下げる。実施記録と同じ検索
(`Procedure?based-on=` + `_revinclude=MedicationDispense:part-of`。上流に `part-of` を追加)で
引ける。ハブの `category` は実施記録(`order-type|transfusion`)と別の体系(`procedure-category`)にして、
実施記録を数える処理(看護必要度・医事)が出庫を実施と取り違えないようにする。

［提案］出庫入力は一覧の「出庫」から開くモーダル(`TransfusionDispenseModal`)。日赤の製剤ラベルの
バーコード(ISBT 128。献血番号 `=`、製品 `=<`、血液型 `=%`、有効期限 `&>`。`fhir/isbt128.ts`)を 1 つの
読み取り欄で受け、選択中のバッグに入れる。割付のチェック(`dispenseAdvisories`)は警告の器に載せる:
①患者の型との適合 ②依頼の型との一致 ③依頼の製剤との一致 ④有効期限と投与予定日 ⑤不規則抗体陽性
(抗原陰性血の確認) と、照射(製剤マスタ `requires_irradiation`)、交差適合試験の結果(未入力・不適合)、
血液型の 2 回確定、不規則抗体の有効期限。不適合のバッグは確認を要する警告で、医師と協議のうえ出す
ときは理由を残す(止めはしない。ガイド 7.4.3-2 の「協議の上で行う場合はこの限りでない」)。

［提案］出庫取消は記録ごと消す(実施取消と同じ)。中止では消さない(出したバッグは返却の対象。
返却・廃棄の記録は段階 D)。実施入力は出庫記録があればそのバッグ(製剤番号つき)を初期行にする。

### 2.7.2 投与時の照合・確認者・観察・入れなかったバッグ(2026-11-01)

JAHIS 患者安全ガイド(輸血編)7.5.3 に合わせた実施入力の拡張(`fhir/transfusionResultHelpers.ts`)。

- **照合**: 施設設定 `transfusion.verification_enabled` で、実施入力の前に患者番号(リストバンド)と
  製剤ラベルの献血番号(ISBT 128)を読む段(`TransfusionVerifyStep`。注射の 3 点認証と同じ作り)を出す。
  実施するバッグ全部と患者が一致したら入力へ、できなければ理由を選んでスキップ。結果はハブの拡張
  `transfusion-verification` に残し、カードに「照合済」「照合スキップ(理由)」と出す。
- **確認者**: 読み合わせの相手を医療従事者から選び、`Procedure.performer` に `function` = verifier で
  実施者(performer)と並べる。
- **出庫記録との突き合わせ**: 出庫したバッグが初期行に入る(製剤番号・型つき)。出庫記録に無い製剤番号、
  有効期限切れ、未照射、交差不適合、患者の型との不適合、出庫したのに入力に無いバッグは警告の器に出す
  (`transfusion-perform` の文脈。確認を要する警告は理由を残して通す)。
- **入れなかったバッグ**: 消さずに「未実施」「返却」で残す。`MedicationAdministration.status` = not-done、
  理由は `statusReason`。医事(保存血液輸血の手技・製剤)とロット管理は completed だけを投与として数える。
- **観察**: 投与前・5 分後・15 分後・終了時の血圧・脈拍・体温・SpO2・呼吸数。ふつうのバイタル
  (`category` = vital-signs、`buildVitalObservations`)として書くので経過表にもそのまま載り、
  `partOf` と `transfusion-observation-point` でこの輸血の観察だと分かる。空の時点は作らない。
- **副作用の症状項目**: 「あり」なら日本輸血・細胞治療学会ヘモビジランス委員会の症状項目(17 項目)から
  選び、`component` に並べる。自由記述は `note`。副作用歴は依頼時と実施時の両方に警告(表示のみ)で出す。
- **遅発性副作用の追記**: 実施済みのカードのケバブ「副作用追記」で、実施記録を取り消さずに副作用の
  Observation(`transfusion-reaction-timing` = delayed、発症日時)を 1 件足す(`TransfusionReactionModal`)。

### 2.9 自己血・不規則抗体の特異性・移植後の血液型・輸血関連情報カード(2026-11-01)

JAHIS 患者安全ガイド(輸血編)7.1.3-3・7.3.3-1 ⑤・7.7・7.8 に合わせた残り(段階 E)。

- **不規則抗体の特異性**(`fhir/transfusionProfileHelpers.ts`): スクリーニングの陽性・陰性は検査結果から
  読むが、同定した抗体(抗 E など)は結果項目に無いので、プロファイルタブの「身体」で手入力する
  (`category=exam` の Observation `transfusion-profile|irregular-antibody`、抗体は `component`)。出庫入力では
  赤血球のバッグに「抗原陰性」の確認欄(同じ抗原の一覧)が出て、確認していない抗原があれば警告する
  (`MedicationDispense` の拡張 `transfusion-antigen-negative`)。同定していない陽性は従来どおり確認を求める。
- **造血幹細胞移植後の血液型**(同): 移植日・ドナーの型・移植後に輸血に使う型(赤血球と血漿・血小板で別)を
  手入力する(`transfusion-profile|transplant-blood-type`)。あればオーダーと出庫の適合表(`compatibleAbo` /
  `compatibleRhd`)で患者の型より優先し、オーダー画面に「移植後」の印と案内(表示のみ)を出す。
- **自己血(貯血式)**(`fhir/autologousHelpers.ts`): 自己血の製剤を含むオーダーに、一覧の「採血」から採った血を
  1 本ずつ記録する(採血記録ハブ `Procedure`(category `procedure-category|autologous-collection`)+
  `MedicationDispense`(status = preparation、製剤番号・型・有効期限))。有効期限は採血日 + 製剤マスタの
  `shelf_life_days` で決めて手では変えられず、使用予定日が期限より後なら警告する。採血ラベル
  (患者・型・製剤番号のバーコード・採血日・使用予定日・有効期限・署名欄)は `GET /reports/autologous_labels/:procedure_id/pdf`
  (`lib/report_layouts/autologous_label.tlf`)。出庫入力では自己血のバッグを本人の採血記録から選び、記録に無い
  製剤番号は警告する(本人の血かの照合)。
- **自己血の採血予定**(`fhir/autologousPlanHelpers.ts`): 採血 1 回を `Appointment` 1 件で持つ(`basedOn` = 輸血オーダー、
  `serviceType` = `schedule-service-type|autologous`、`start`/`end`(30 分)、`participant[0]` = 患者、予定量は拡張
  `autologous-planned-volume`)。採血室の枠(Schedule/Slot)は使わず日付と時刻だけ持つ。状態は booked(未採血)→
  fulfilled(採血済)/ cancelled(取消)。
  - オーダー画面: 自己血の製剤を選ぶと「採血予定」の欄が出る。手術日(投与予定日)・回数・1 回量・間隔から
    「提案」で逆算する(最終採血日 = 手術日 − 3 日、そこから間隔ずつ遡る。回数の既定は依頼量 ÷ 1 回量、
    1 回量は製剤マスタの既定単位数、間隔 7 日)。医師が日時・量を直して保存すると、オーダーの transaction に
    `Appointment` の POST を同梱する。更新では外した予定を cancelled に、残した予定は PUT、足した予定は POST。
    採血済みの予定は動かせない。1 回目の採血日 + 有効日数が手術日より前なら警告(`autologous-expiry`)。
    セットの内容・DO では予定を持たない(患者の手術日から組み直す)。
  - 採血の画面: 上に予定の表を出し、選んだ予定の日付と量を初期値に入れる。登録の transaction で予定を
    fulfilled にし、採血記録のハブは拡張 `autologous-appointment` で予定を指す。予定に無い採血(臨時)は
    「予定なしで採血」。直近の Hb(検体検査の結果、分析物 B1004。g/L は g/dL に揃える)を出し、施設設定
    `transfusion.autologous_hb_min`(既定 11.0 g/dL)を下回る・未検査なら警告(`autologous-hb`)。
    累計(採血済み / 予定 / 依頼の mL)も出す。
  - 部門一覧: 日付の軸を「投与予定日 | 採血予定日」で切り替える。採血予定日は予定 1 件 = 1 行
    (予定時刻・予定量・累計・状態、「採血」でその予定を選んだ採血入力)。投与予定日の行には未採血の予定数
    「採血 未 n」を出す。ホームの輸血カードにその日の採血予定数と未採血数を添える。
  - 取消: オーダーの削除・中止(Task → cancelled)で残っている booked の予定を cancelled にする。カルテの
    予約タブには「自己血採血」として並び、日時変更・取消はオーダーの編集・削除から行う。
- **輸血関連情報カード**: プロファイルタブの「輸血カード」から `GET /reports/transfusion_cards/:patient_id/pdf`
  (`TransfusionCardReport`、`lib/report_layouts/transfusion_card.tlf`)。血液型(検査結果の 2 回一致と申告)・
  不規則抗体(スクリーニングと特異性)・移植後の型・輸血歴(実施済みのバッグ)・副作用歴を A4 1 枚にまとめる。
  検査結果の検索コードは画面と同じく結果項目マスタの JLAC11 から作る。

### 2.8 進捗 Task の 5 状態

```
requested (依頼済)   … 輸血部門はまだ受け取っていない
accepted  (受付済)   … 依頼を受けた。適合試験中
in-progress (出庫済) … 製剤を払い出した。病棟が投与するのを待っている
completed (実施済)   … 投与が終わった
cancelled (中止)
```

［提案］手術(入室中)と同じく `in-progress` を挟む。輸血は「部門が製剤を出した」時点と
「病棟が投与し終えた」時点が別の場所・別の人の作業で、出庫済のまま投与されていない
製剤を部門が把握できないと事故になるため。［事実］`createTaskHelpers` の
`executionPeriod` は `in-progress` を終了時刻なしで扱うので、そのまま使える。

---

## 3. マスタ

`master_transfusion_products`(製剤マスタ)1 つだけ。食事(`master_meal_items`)と同じ
単純編集型で、配布マスタの取込は持たない。

［提案］製剤の種類は施設でも数十件で、日本赤十字社の製品名は変わりうるが配布形式の
標準マスタが無いため、画面から手で入れる形にする。セット・伝票レイアウト・実施入力
データセット・予約枠はいずれも持たない(輸血に「伝票から項目を選ぶ」作法は無く、
製剤の一覧から選ぶだけで足りる)。

| 列 | 用途 |
|---|---|
| `item_code` | 独自採番の製剤コード。ISBT128 の製品コードを手入力してもよい |
| `name` / `name_kana` | 「赤血球液-LR「日赤」2単位」など |
| `abbreviation` | 「RBC-LR」。一覧・カードの狭い場所で使う |
| `category` | 製剤区分(rbc / ffp / plt / auto / other)。部門一覧の絞り込み軸 |
| `unit_label` | 単位の呼び方。既定「単位」(血小板は「単位」、自己血は「mL」もある) |
| `default_units` | 既定の単位数。RBC なら 2 など、入力の初期値 |
| `requires_crossmatch` | 交差適合試験が要る製剤か。FFP・PLT は不要が既定 |
| `requires_irradiation` | 放射線照射が要る製剤か。出庫入力で未照射のバッグに警告を出す。既定は不要 |
| `shelf_life_days` | 有効日数(採血日からの日数)。自己血の有効期限の算出に使う |
| `valid_from` / `valid_to` / `display_order` / `note` | 他マスタと同じ |
| `search_name` / `search_kana` | `SearchNormalizer` で正規化した検索用 |

---

## 4. 画面

| 画面 | 場所 | 備考 |
|---|---|---|
| 製剤マスタ | マスタメンテ > 輸血 | `MealItemPage` と同じ素朴な CRUD |
| オーダー入力 | カルテ右ペイン「輸血」 | 血液型(選択 + 検査結果の参照)・検査区分・投与予定日時・製剤明細・同意書確認 |
| カルテカード | タイムライン | 血液型バッジ + 検査区分 + 製剤(略称 × 単位数)+ 進捗バッジ + 実施情報 |
| 詳細モーダル | カードから | 明細と実施記録の全項目 |
| 輸血部門一覧 | 部門業務 > 輸血 | 投与予定日(受付/出庫/実施の操作)と採血予定日(自己血の採血予定)の切り替え |
| 出庫入力 | 部門一覧の「出庫」 | バッグごとの製剤番号・血液型・有効期限・照射・交差適合試験(バーコード入力可)、割付の警告 |
| 照合 | 実施入力の前段(施設設定で有効なとき) | 患者番号と製剤ラベルの読み取り、確認者の選択 |
| 副作用追記 | カルテカードのケバブ(実施済) | 遅発性副作用の発症日時・症状・内容 |
| 採血(自己血) | 部門一覧の「採血」(自己血の製剤を含むオーダー、採血予定日の行) | 採血予定の選択・直近の Hb・累計、採血日時・採血量・製剤番号・有効期限(自動)、採血ラベル |
| 不規則抗体の特異性 / 移植後の血液型 | プロファイルタブ「身体」 | 手入力。輸血カードの印刷もここから |
| 実施入力 | 部門一覧の「実施」とカルテカード | 開始/終了時刻・実施者・確認者・バッグごとの製剤番号と実施/未実施/返却・観察・副作用(症状項目) |

---

## 5. 実装フェーズ

1. **製剤マスタ**(backend + マスタメンテ画面) — 実装済
2. **オーダー発行**(ヘルパー・フォーム・カルテ統合) — 実装済
3. **部門一覧**(Task) — 実装済
4. **実施記録**(Procedure + MedicationAdministration + Observation) — 実装済

### 5.1 実施入力の入口は部門一覧だけでは足りない

［事実］放射線・生理・内視鏡・処置・手術の実施入力は、いずれも部門一覧からしか
開けない(カルテのカードからは開かない)。実施が部門の中で完結するため。

［導出］輸血は**出庫するのが輸血部門、投与するのが病棟**で、場所も担当も分かれる。
部門一覧だけに実施入力を置くと、実際に投与した病棟の看護師が記録を書けない。
第 4 段階では実施入力をカルテのカードからも開けるようにする必要があり、これは
既存 5 種別のどれとも違う形になる。

［提案］そこで実施入力の入口を 2 つ持つ。どちらも同じ Bundle を書く。
- 輸血一覧の「実施」… 部門が病棟から受けた報告を代わりに入れる
- カルテカードのケバブ「実施入力」… 投与した病棟がその場で入れる

［導出］カルテから実施登録するには進捗の Task 本体が要る(実施登録は Task を実施済へ
更新する transaction なので、実物が無いまま POST すると既にある Task と二重になる)。
そのため輸血のカルテカードだけは `status` に加えて `task` そのものを持つ
(`karteTimeline.ts` の KarteTimelineItem)。他の種別は `status` しか持たない。

［提案］どちらの入口も**出庫済(in-progress)のときだけ**出す。出庫していない製剤は
輸血できないため。

### 5.2 実施取消は記録ごと消す

［事実］放射線・生理・内視鏡・処置は、実施取消で Task を戻すだけで実施記録を消さない
(docs/rad-result-design.md §7-6)。手術は記録ごと消す。

［提案］輸血は**手術と同じく記録ごと消す**。輸血の実施記録は「このバッグを輸血した」
という遡及調査の記録そのもので、取り消したのに残っているとその記録が嘘になるため。
入力し直す手間も、バッグ数本ぶんなので手術ほど大きくない。

---

## 6. 検証(2026-08-29、開発環境で実施)

### 6-1. 製剤マスタ(Phase 1)

- `bundle exec rspec spec/requests/master/transfusion_products_spec.rb` … 14 例すべて成功。
  一覧の表示順・製剤コードのカンマ区切り取得・区分絞り込み・`active=true` の有効期間
  絞り込み・名称/カナ検索・製剤コードでの show/update/destroy・自動採番
  (ISBT128 の英字混じりコードが採番計算に混ざらないこと)・区分と既定単位数の検証・
  有効期間の前後関係を確認。
- マスタメンテ画面で 8 件(RBC-LR / 照射 RBC-LR / FFP-LR / 照射 PC-LR / 自己血 /
  アルブミン)を投入し、一覧の表示順・「交差不要」の印・既定単位数の表示を確認。

### 6-2. オーダー発行(Phase 2)

［事実］**`quantityQuantity` は上流にそのまま保存された**(このコードベース初出の
フィールドだったので最初に確かめた)。保存後の取得で `{value: 2, unit: "単位"}` が
そのまま返る。

確認したこと:

| 確認 | 結果 |
|---|---|
| 製剤を選ぶと既定単位数・単位・略称がその行に入る | RBC 2 単位 / FFP 240 は 4 単位が自動で入った |
| 入外区分が入院中の患者で「入院」になる | 入院(東3階病棟)が初期選択 |
| 同意書未チェックで登録できない | 「輸血同意書の確認にチェックを入れてください。」で止まる |
| ヘッダ + 明細 2 件の transaction | 明細の `basedOn` がヘッダを指し、`identifier` が 1・2 の順で入る |
| 依頼科・病棟の焼き付け | `order-department`(内科)・`order-ward`(東3階病棟)が入る |
| 同意書の拡張 | `transfusion-consent` valueBoolean:true |
| カードが投与予定日に出る | 2026-08-30 の診療日に「入院 \| 交差適合試験 投与 10:00」で出た |
| カード本文 | 製剤を番号付きで並べ、備考(放射線照射済)も出た |
| 詳細モーダル | 依頼共通(同意書「取得済」を含む)と製剤表を表示 |
| FHIR JSON モーダル | ヘッダ + 明細の Bundle で表示(病理も同時に配線した) |
| 編集で製剤を外す | 外した明細が DELETE され、ヘッダと残り 1 件だけになった |
| DO | 製剤を引き継ぎ、投与予定日時は空・登録日時は新規(自動)・**同意書のチェックは引き継がない** |
| 削除 | ヘッダと明細がまとめて消えた(明細の直接取得が 410 Gone) |
| 種別ペインの絞り込み | 「輸血」で絞り込める(`?card=transfusion-order`) |
| 既存種別への影響 | 病理検査一覧が従来どおり動く(Task は task-code で振り分けるため) |

輸血前検査の参照表示は、この患者に血液型の Observation が無いため 3 項目とも
「未検査」(赤字)で出ることを確認した。値のある患者(テスト太郎)での表示は 2026-11-01 に確認した(§2.5)。

### 6-3. 血液型の選択(§2.5 の追加分)

| 確認 | 結果 |
|---|---|
| ABO 4 色が日赤の区分色で出る | A=黄 / B=白 / O=青 / AB=桃。明暗テーマの双方で確認 |
| 選択の解除 | 選択中のチップをもう一度押すと外れる |
| 保存 | `transfusion-abo`(AB)・`transfusion-rhd`(positive)の拡張が入る |
| カード | 製剤より上に色付きバッジ「AB型 RhD＋」が出る |
| 詳細モーダル | 「血液型」行に同じバッジが出る |
| 明るいテーマでの B 型 | 純白 + 本文色の輪郭で、地(--surface-panel)と区別できる |
| 同意欄 | 未チェックは注意色の枠、チェックで枠が通常色に戻る |

［事実］この作業中に 2 つ直した。

- **存在しない CSS 変数を使っていた**。`--text-muted` と `--danger` はこのプロジェクトに
  定義が無く(`index.css` にあるのは `--text` / `--text-h` / `--lab-high` など)、
  フォールバック無しで書いた宣言は無効になっていた。実在の変数に置き換えた。
- **`.prescription-form label` の縦積みに負けていた**。同意チェックが縦に積まれていた
  ため、`.order-select__cell label` と同じく `.prescription-form` から書いて詳細度を
  上げた。

［事実］HMR が古い変換結果を配信し続ける現象が出た(カード・詳細パネルに変更が
反映されない)。コンテナ内で対象ファイルを `touch` すると解消する。

### 6-4. 部門一覧(Phase 3)

| 確認 | 結果 |
|---|---|
| 投与予定日で 1 日ぶんを引く | 8/31 の 2 件が出る。日付を変えると入れ替わる |
| 状態遷移 | 依頼済 →(受付)→ 受付済 →(出庫)→ 出庫済。出庫済で主ボタンが無くなる |
| ケバブ | 出庫済の行に「出庫取消」と赤字の「中止」 |
| 血液型の列 | オーダー画面と同じ区分色で独立した列に出る(AB=桃 / O=青) |
| 同意書未取得の行 | 行が警告色 + 「同意書未」バッジ。モーダルにも「未取得」 |
| 至急 | 「至急」バッジ + 行の警告色 |
| 絞り込み | 輸血検査区分(T&S で 1 件)・ステータス(出庫済で 1 件)が効く |
| 「表示」モーダル | カルテと同じ詳細パネルが出る |
| カルテカードの進捗 | 「出庫済」「依頼済」が種別バッジの右のメタ行に出る |
| 既存部門への回帰 | 病理検査一覧が従来どおり(Task は task-code で振り分けるため) |

［事実］検証用のオーダーを画面から作れないケース(同意書未取得)があったため、
ブラウザから直接 transaction Bundle を POST した。backend は非 GET に
`X-CSRF-Token` を要求するので、`GET /auth/session` の `csrf_token` を添える必要が
ある(付けないと 403)。

### 6-5. 実施記録(Phase 4)

| 確認 | 結果 |
|---|---|
| 実施入力の入口(部門一覧) | 出庫済の行にだけ「実施」。押すとモーダルが開く |
| 実施入力の入口(カルテ) | 出庫済のカードのケバブにだけ「実施入力」。実施済・依頼済には出ない |
| バッグの初期行 | オーダーの製剤・単位数が入った状態で開く |
| 必須検証 | 製剤番号 → 副作用の有無 → (あり なら)副作用の内容、の順に止まる |
| 保存された FHIR | Procedure(`performedPeriod` 14:05〜15:35 / category=transfusion / performer / note)、MedicationAdministration(`effectivePeriod`・`dosage.dose` 2単位・`transfusion-lot-number`)、Observation(category=transfusion / code=輸血副作用 / value=なし) |
| バッグ時刻の既定 | バッグごとの時刻を空にすると輸血全体の時間帯が `effectivePeriod` に入る |
| Task | 実施登録と同じ transaction で実施済になる |
| カルテカード | 実施情報(時間帯・実施者・バッグ+製剤番号・副作用・コメント)が出る |
| 副作用「あり」 | チップが注意色になり、内容が Observation の note に入る |
| 実施取消 | Procedure・MedicationAdministration・Observation の 3 件が消え、出庫済に戻る |
| FHIR JSON 表示 | オーダーと実施記録が 2 つの節に分かれて出る |
| 既存部門への回帰 | 処置一覧が従来どおり動く |

［事実］実施入力モーダルで、**入れ物の外にある入力欄が素の見た目のまま残る**
問題を 2 つ踏んだ。どちらも原因は同じで、このプロジェクトが入力欄の見た目を
フォームごとにスコープしている(`.prescription-form input` /
`.lab-order-item__fields input[type=...]` / `.prescription-form label` の縦積み)
ことによる。オーダー画面では `.prescription-form` の中に入るので効くが、
実施入力モーダルはそのフォームの外にある。

- バッグ行のラベルが入力欄と横に並んだ → `.transfusion-order__product > label` で
  縦積みを明示(祖先に依存しない形にした)。
- バッグ行・副作用の内容・実施コメントの入力欄に枠も背景も付かなかった →
  モーダルのフォームに `.transfusion-perform` を付け、
  `.transfusion-perform input / select / textarea` でまとめて当てた。値は同じ
  モーダル内の `.lab-order-item__fields` に揃えてある(あちらの方が詳細度が高いので
  重なっても見た目は変わらない)。オーダー画面側は `.prescription-form input` が
  そのまま効いており、影響していないことを確認済み。

［導出］新しいモーダルに入力欄を足すときは、**その入力欄がどのフォームのスコープに
入っているか**を必ず確かめる。素の `input` に当たる全体規則はこのプロジェクトに無い。

### 6-6. 実施入力の製剤はマスタから選ぶ(修正)

［事実］最初、実施入力の製剤名をフリー入力にしていた(「実際に出庫されたバッグが
オーダーと違うことがある」ため)。これは**誤りで、記録が壊れる**ことが分かった。

`buildBagAdministration` は `coding: [{ system, code: bag.productCode,
display: bag.productName }]` を組み立てるが、`productCode` はマスタから選んだときにしか
入らない。そのため次の 2 通りで壊れていた。

- 初期行の製剤名を書き換えると、`code` はオーダー時の製剤のまま `display`/`text` だけが
  変わり、**コードと表示が別の製剤を指す** Coding が黙って保存される。
- 「バッグ追加」した行は `productCode` が空のままで、検証が `productName` しか
  見ていなかったため、`code: ""`(FHIR の `code` 型として不正)がそのまま出る。

製剤番号を必須にして遡及調査の起点にしている以上、製剤コードが実物と食い違ってはいけない。

［提案］オーダー画面と同じ**製剤マスタのセレクト**にする。「実際のバッグが違う」という
要件は、フリー入力ではなく*マスタから別の製剤を選び直せること*で満たされる。選び直すと
コード・名称・単位の呼び方がまとめて入れ替わるので、食い違いが起きない。検証と保存の
対象も `productCode` で判定するようにし、製剤を選んでいない行は保存しない。

［提案］ただし**単位数は選び直しても上書きしない**。オーダー画面は「これから出す計画」
なので製剤の既定単位数で上書きしてよいが、実施入力は「実際に何単位入れたか」の記録で、
入力済みの値を既定値で消してはいけない。空の行(手で足したバッグ)にだけ既定値を入れる。

［事実］マスタに無い製剤を使ったときはマスタ側を直すのが筋。どうしても記録が要る場合の
正直な表現は `coding` を持たせず `text` だけにすることだが、今回はその口を開けていない。

確認したこと: セレクトにオーダーの製剤が選択された状態で開く / 選び直すとコードと
名称が揃って入れ替わり入力済みの単位数は保持される / 手で足した行には既定単位数が入る /
製剤未選択の行だけでは登録できない / 保存された 2 本の Coding が
`code`・`display`・`text` すべて選び直した製剤で一致する。

［事実］このとき、カードの実施情報で「バッグ:」が 2 行に折り返した。
`.karte-perform__label` は flex アイテムで、既存の「薬剤:」「器材:」はたまたま収まって
いただけだった。共有クラスに `flex: none` と `white-space: nowrap` を足して全種別で
折り返さないようにした(処置カードの表示が変わらないことを確認済み)。

---

## 7. 未決事項・申し送り

JAHIS 患者安全ガイド(輸血編)と突き合わせた不足機能と、その残り(出庫票の帳票・検査オーダーの呼び出し・
前回値の警告・交差用検体の期限)は `docs/transfusion-backlog.md` にまとめてある。

- 血液型・不規則抗体の検査オーダーを輸血オーダーから自動発行することはしていない。
  T&S を選んだときに検体検査オーダーを併発する運用が要るなら、手術の「輸血準備」と
  同じく別オーダーとして手で出す。
- 製剤 1 バッグの在庫引当・返品は持たない。出庫のバッグ(`MedicationDispense`)と実施入力の製剤番号は
  「何を出したか・何を入れたか」の記録であって、在庫の消し込みではない。
- 輸血後感染症検査(3 か月後の HBV/HCV/HIV)のフォロー管理は未実装。
- 副作用は症状項目(`component`)と時点・自由文までで、報告書(ヘモビジランス様式)には
  していない。様式化するならテンプレート(QuestionnaireResponse)を実施入力に紐付けるのが
  既存の作法に合う。
- 手術オーダーの「輸血準備」との自動連動はしない(§1.2)。
- 輸血管理料・輸血手技料の算定は未実装。実施記録の Procedure.code は輸血手技の
  コード表を持っていないので text だけ("輸血")にしてある。
- 実施記録の修正(登録し直し)は「実施取消 → 実施」の 2 手。編集画面は持たない
  (手術と同じ)。
- **入力欄の高さ揃えは輸血の製剤カードにしかスコープしていない**
  (`.transfusion-order__product > label > select / input`)。select だけが低くなる
  現象はアプリ全体で起きており(オーダー画面の「輸血検査区分」select 33.5px に対し
  「依頼日」date 42.1px など)、原因も共通で `font: inherit` が根の
  `line-height: 26.1px` を input にだけ渡すこと。全画面を揃えるには
  `.prescription-form input / select` と `.lab-order-item__fields` にも同じ考え方を
  入れる必要があるが、全レイアウトが動くため**別タスクとする**(2026-08-29 合意)。
