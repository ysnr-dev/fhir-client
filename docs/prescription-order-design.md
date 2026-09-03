# 処方オーダーの設計(与薬の実施を中心に)

処方オーダーそのもの(ServiceRequest + RP ごとの MedicationRequest、RP の組み立て、
用法・投与日数の入力)は `readme.md` の「処方オーダー機能」に書いてある。このドキュメントは
**後から足した「内服の与薬実施」**の設計を残す。経過表側の見え方は
`docs/flowsheet-design.md` §9。

## 1. なぜ Task の「実施済」を使わないか

処方の進捗 `Task`(`rx-dispense`)は 依頼済 → 受付済 → 調剤済 → **実施済** → 中止 で、
`completed`(実施済)は最初から与薬用に空けてあった(`fhir/rxTaskHelpers.ts` のコメント
「調剤済を completed ではなく in-progress にするのは、実施済を後から足すため」)。

**それでも与薬では Task を動かさない。**

- Task が表すのは**薬剤部の進捗**(処方箋を発行して調剤した)で、与薬は病棟の行為。軸が違う。
- 処方は 1 件が投与日数ぶん続き、1 日に何回も飲ませる(朝昼夕 × 7 日 = 21 枠)。
  **「実施済」という 1 つの状態が定まらない**。食事オーダーにカードの状態を出さないのと
  同じ理由(`docs/flowsheet-design.md` §8.4)。

「実施済」を「払出済」に読み替える改名は、処方ワークリストとカードの表示に波及するので
別に起こす(§5)。

## 2. リソースの構造

与薬 1 回 = **ハブ `Procedure` 1 件 + 薬剤ごとの `MedicationAdministration`**。
注射の実施(`docs/injection-order-design.md` §6)と同じ骨格で、このコードベースの実施記録が
すべて「Procedure(basedOn オーダー)+ partOf の子」で揃っているのに乗せる。

```
ServiceRequest(処方。投与開始日と RP を持つ)
 └ basedOn ← Procedure (与薬 1 回。予定枠ごとに 1 件)
      │  performedDateTime = 実際に飲ませた時刻
      │  extension[medication-schedule-slot] = どの予定枠の与薬か
      │  status       = completed(与薬) / not-done(与薬せず)
      │  statusReason = 与薬しなかった理由(text、自由記載)
      │  note         = コメント
      └ partOf ← MedicationAdministration (薬剤 1 件ごと)
           request = その薬剤の MedicationRequest
           dosage  = 用量(オーダーから写す)
```

### 2.1 ServiceRequest には order-type を付けない

`Procedure` / `MedicationAdministration` の `category` には
`order-type|prescription`(`PRESCRIPTION_ORDER_TYPE`)を付けて、注射・処置・手術の記録と
振り分ける。**この区分を処方の `ServiceRequest` には付けない**。

処方は注射より前から存在するため、「**order-type を持たない ServiceRequest は処方**」という
取り決めになっている(`isPrescriptionServiceRequest`)。SR に付けると処方一覧・ワークリスト・
カルテのタイムラインが一斉に壊れる。

### 2.2 「途中で中止」は無い

注射の実施は 実施 / 途中で中止 / 実施せず の 3 つだが、内服は **与薬 / 与薬せず の 2 つ**。
飲むか飲まないかで、点滴のような途中停止が無い。一部の薬剤だけ飲ませなかったときは、
その薬剤の `MedicationAdministration` を作らない(注射の `skipped` と同じ)。

与薬せず(`not-done`)のときは薬剤の記録を 1 件も作らない(飲ませていない薬に投与記録が
あると嘘になる)。

### 2.3 予定枠をローカル拡張で持つ

`http://fhir-client.local/StructureDefinition/medication-schedule-slot`(`valueDateTime`)に
**どの予定枠の与薬か**を焼く。

処方 1 件に何十枠もあり、実際に飲ませた時刻は予定と数十分ずれるのが普通なので、時刻の
近さで予定と記録を突き合わせると取り違える。枠を明示して持てば、予定の印を消すのも、
その枠の記録を取り消すのも一意に決まる。

拡張にしたのは注射の終了予定時刻(`injection-scheduled-period`)と同じ判断で、標準の
置き場所が無く、上流の索引も要らないため(`docs/injection-order-design.md` §2.2)。

## 3. 予定時刻は用法コードから

処方は「1 日 3 回・食後」までしか持たず、何時に飲ませるかはどこにも無い。用法コード
(16 桁)を復号して施設の食事時刻と突き合わせる。桁の意味と展開の規則は
`docs/flowsheet-design.md` §9.1(実データで突合して確認した表がある)。

施設設定 `facility_settings.medication_schedule`:

| キー | 既定 | 意味 |
|---|---|---|
| `before_meal_minutes` | 30 | 食前・食直前のずらし(分。食事の時刻から引く) |
| `after_meal_minutes` | 30 | 食直後・食後のずらし(分。食事の時刻に足す) |
| `bedtime` | 21:00 | 就寝前 |
| `wake_time` | 06:00 | 起床時 |

食事の時刻そのものは `meal_schedule`(食事オーダーと共用)。**表示時に計算する**ので、
設定を変えれば過去の処方の予定にも効く(登録済みのオーダーは動かない)。

## 4. 取消

記録ごと消す(子の `MedicationAdministration` → 親の `Procedure` の順に DELETE)。
注射・輸血と同じで、「この薬を飲ませた」という事実の記録なので、取り消したのに残って
いるとその記録が嘘になる。Task を動かしていないので戻す先は無い。

導線は**経過表の一覧モーダルだけ**。処方はカルテのカードに実施を出さない(§1)ので、
他に置く場所が無い。

## 5. 未実装・今後

- **頓用・イベント型の与薬**。予定枠が決まらないので入力の起点が無い。枠に紐づかない
  「臨時の与薬」の導線が要る。時刻指定型の「決まった時刻に」(用法コードの `Z`)も同じで、
  処方フォームに時刻を自由入力する欄を足すのと対になる。
- **病棟の与薬ワークリスト**。「今から 1 時間の与薬」を病棟単位で並べる画面。いまは
  患者ごとの経過表からしか記録できない。
- **配薬(薬剤部 → 病棟)の段階**。いまは調剤済かどうかに関わらず与薬を記録できる。
- **自己管理の患者**。与薬記録を付けない患者を処方単位か患者単位で示す仕組み。
- **持参薬**。リソースを持っていない(`docs/order-common-backlog.md`)。
- **Task「実施済」の改名**。「払出済」に読み替えるなら処方ワークリストとカードの表示に
  波及する。与薬の側から Task を動かす設計にするなら、枠ごとの完了を 1 つの状態にどう
  畳むかを先に決める。
- **投与終了日**。`rpEndDate`(投与開始日 + 投与日数 − 1)を与薬の予定を出すために作ったが、
  処方切れの検知(`docs/order-common-backlog.md` の未対応項目)には使っていない。
- **薬剤の追加**。注射の実施入力は「オーダーに無い薬剤を実施時に足す」ができるが、
  与薬では持たない(内服でその場に足す運用が無い)。
