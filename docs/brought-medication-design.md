# 持参薬の設計

入院時に患者が持ってきた薬(持参薬)を登録し、薬剤部が鑑別し、医師が入院中に続けるか
どうかを決めるまでの設計。続ける薬は院内の処方オーダー(処方区分「持参」)に起こすので、
与薬・重複チェック・退院処方は処方の仕組みにそのまま乗る。

```
入院 ─ 看護師・薬剤師が登録 ─→ 薬剤部が鑑別 ─→ 医師が判断 ─┬ 継続 → 処方(区分「持参」)
                                                          ├ 入院中休止
                                                          └ 中止
退院 → まだ閉じていない持参薬を終了にする
```

対象は入院の持参薬だけ。外来の他院処方・お薬手帳の服用薬は同じ器に載せられるように
しておく(入院を必須にしない)が、画面は作っていない(§8)。

## 1. リソースの構造

持参薬 1 剤 = **`MedicationStatement` 1 件**(JP Core `JP_MedicationStatement`)。

| 要素 | 値 |
|---|---|
| `status` | §2 の対応表 |
| `statusReason` | 医師の判断。`http://fhir-client.local/CodeSystem/brought-medication-decision`(continue / hold / stop)+ 理由の自由記載(`text`) |
| `category` | `medication-statement-category\|community`(他院で処方され、自宅で飲んでいた薬) |
| `medicationCodeableConcept` | 医薬品マスタから選べたら処方と同じ形(`medicationCodeableConcept`)、選べなければ `text` だけ。鑑別で特定した医薬品に置き換える |
| `subject` | 患者 |
| `context` | 入院(Encounter)。**必須にはしない** |
| `dateAsserted` | 登録日時 |
| `informationSource` | 登録した職員(Practitioner)。医療従事者に紐付かないアカウントでは付けない |
| `effectivePeriod.end` | 入院前の最終服用日時(任意)。退院で終了にしても書き換えない |
| `dosage[0]` | 処方の `MedicationRequest.dosageInstruction` と同じ形(`buildDosage`)。用法コード・1 回量・頓用 |
| `note` | 登録時のコメント |

ローカル拡張(`http://fhir-client.local/StructureDefinition/...`):

- `brought-medication-info`(複合): 聞き取りの情報
  - `source`(string)… 情報源(本人・家族・お薬手帳・薬剤情報提供書・紹介状)
  - `prescriber`(string)… 処方元の医療機関
  - `broughtQuantity`(Quantity)… 持参数
- `brought-medication-identification`(複合): 鑑別の結果
  - `identifiedBy`(Reference Practitioner)・`identifiedAt`(dateTime)
  - `reportedName`(string)… 登録時の名前。医薬品を置き換えても残す
  - `remainingDays`(Quantity、`d`)… 残りの日数
  - `substitution`(code)… `same`(同じ薬が院内にある)/ `alternative`(院内の代替薬で続ける)/ `none`(持参分を使う)
  - `substitute`(CodeableConcept)… 院内の代替薬
  - `comment`(string)
- `brought-medication-decision`(複合): 医師の判断
  - `decidedBy`(Reference Practitioner)・`decidedAt`(dateTime)
  - `convertedOrder`(Reference ServiceRequest)… 継続で起こした処方

### 1.1 なぜ MedicationStatement か

持参薬は「この病院が指示した薬」ではなく「患者が飲んでいる薬」なので、指示を表す
`MedicationRequest` には載せない。`MedicationStatement` は服用状況を表すリソースで、上流も
JP Core のプロファイルで受け付ける。1 剤 1 件にするのは、判断(継続・中止)が薬ごとに
分かれるため。お薬手帳 1 冊ぶんのまとまりは、同じ入院(`context`)で束ねれば足りる。

### 1.2 院内処方とは両方向に結ぶ

- 処方の明細(`MedicationRequest.supportingInformation`)→ 元の持参薬。R4 の `basedOn` は
  `MedicationStatement` を指せない。
- 持参薬(decision の `convertedOrder`)→ 起こした処方。上流は `supportingInformation` を
  索引していないので、持参薬の側から処方を開くのに逆引きの検索を要らなくする。

どちらも同じ transaction の中で張る(処方は `urn:uuid`)。

## 2. 状態

| 画面の状態 | `status` | `statusReason` | 重複チェック |
|---|---|---|---|
| 未鑑別 | active | なし(鑑別の拡張も無い) | 数える |
| 未判断(鑑別済) | active | なし | 数える |
| 継続 | active | continue | 数えない(起こした処方の側で数える) |
| 休止 | on-hold | hold | 数えない |
| 中止 | stopped | stop | 数えない |
| 服用していない | not-taken | なし | 数えない |
| 終了(退院) | completed | 元の判断を残す | 数えない |

「服用していない」は鑑別で分かったもの(処方されていたが飲んでいなかった)。医師の判断は
要らないので未判断に数えない。

判断の取消は、`statusReason` と decision の拡張を落として active に戻す。継続を取り消す
ときは、起こした処方を先に中止するか消す(§5)。

## 3. 鑑別の依頼(Task)と通知

```
登録 ─(同じ transaction)→ Task[brought-med-review] requested(focus = encounter = 入院)
鑑別一覧: 鑑別開始 → in-progress、鑑別完了 → completed
        └(同じ transaction)→ 通知 Task[brought-med-identified] owner = 入院の主治医
医師がすべての持参薬を判断した transaction で、通知を completed にする
```

- 鑑別依頼は**入院 1 件につき閉じていないものを 1 件まで**。登録のたびに探して、無ければ作る。
  鑑別を完了したあとに持参薬を足したら新しく作る(完了した依頼を開き直すより履歴が素直)。
- 依頼の Task は部門進捗(`createTaskHelpers`)と同じ語彙(requested / in-progress /
  completed / cancelled)だが、焦点が `ServiceRequest` ではなく入院なので別に組み立てる
  (`fhir/broughtMedTaskHelpers.ts`)。
- 一覧に出す病棟・入院日は `Task.input` に焼き付ける。上流の `_include=Task:focus` は
  `ServiceRequest` しか返さない(通知と同じ事情)。
- 鑑別済の通知は通知の器(`docs/order-common-backlog.md` の通知レジストリ)に 1 種別足す。
  カルテの持参薬タブへ飛ぶ。

## 4. 処方区分「持参」

継続した持参薬を起こした処方。`PRESCRIPTION_CATEGORY_SYSTEM` の `brought`。

- **医師が選ぶ選択肢には出さない**(`CATEGORY_OPTIONS` に入れない)。処方フォーム・施設設定の
  初期値・レジメン適用に波及するため。持参の処方を編集するときだけ区分欄に出して固定する。
- **DO では区分を持ち越さない**。持参薬に結び付かない「持参」の処方を作らせない。
- **処方一覧には並べる**(薬剤部が把握できるように。中止もここからできる)。進捗は
  「持参(調剤なし)」と出し、処方箋の発行・調剤登録は出さない。絞り込みの区分には「持参」を出す。
- **処方箋 PDF を出さない**。backend も `brought` を 422 で断る。
- **請求に載せない**(`BillingClaimBuilder#prescription_items`)。ORCA への送信も同じ経路。
- 与薬(経過表)・重複チェック・カードの表示は、入外区分が「入院」なのでそのまま動く。

## 5. 画面

### 5.1 カルテの「持参薬」タブ

アレルギーの隣(患者情報のグループ)。一覧・詳細・登録・編集をタブの中で完結させる
(アレルギーと同じ作り)。

- 一覧は既定で今の入院の持参薬。入院していなければ直近の入院。
- 1 剤 1 行で、薬剤・用法・持参数と残日数・状態を出す。
- 未判断の行を選んで「継続」「休止」「中止」をまとめて行える。
- 「継続」は右ペインの処方登録を、選んだ持参薬から作った初期値で開く。
  - 入外区分は入院、区分は持参、開始日は今日。区分と入外区分は変えさせない。
  - RP は用法・頓用の回数・日数・用法コメントが同じものをまとめる。日数は残日数。
  - 薬剤は院内の代替薬があればそれ、無ければ鑑別で特定した医薬品。医薬品が特定できて
    いない持参薬は継続できない(先に鑑別する)。
  - 保存では、処方の登録と持参薬の更新(継続・`convertedOrder`)を同じ transaction で送る。
    判断が出揃えば鑑別済の通知も同じ transaction で閉じる。フォームで行を消した持参薬は
    継続にしない(未判断のまま残る)。
  - 継続を判断した人(decision の `decidedBy`)は処方の指示医師。代行入力なら選んだ医師。
- 「休止」「中止」は理由を入れる小さなモーダルで受ける。継続していた持参薬を中止すると、
  起こした処方の進捗(調剤の Task)も同じ transaction で中止にする。`convertedOrder` は残す。
- 休止・中止は「判断を取消」で未判断に戻せる。継続は処方を起こしているので、戻さずに中止する。
- 鑑別と休止・中止は医療従事者に紐付いたアカウントで行う(`identifiedBy` / `decidedBy` に
  ログイン中の本人を入れる)。

### 5.2 薬剤部の「持参薬鑑別一覧」

部門業務の処方一覧の隣。閉じていない鑑別依頼を 1 入院 1 行で並べる。

- 鑑別開始 → 鑑別(入院 1 件ぶんの持参薬を一括で入力するモーダル)→ 鑑別完了。
- 鑑別完了は、鑑別していない持参薬が残っていると押せない。
- 鑑別で入れるもの: 医薬品の特定(マスタで選び直す)・持参数・残日数・院内での扱い
  (同じ薬 / 代替薬 / 持参分を使う)と代替薬・服用していない・コメント。

### 5.3 患者プロファイル

入院中なら「持参薬」の節に、件数と未鑑別・未判断の数、薬剤名の先頭数件を出し、タブへ飛ぶ。

### 5.4 退院

退院登録の transaction で、その入院の active / on-hold の持参薬を completed にする
(退院モーダルのチェックで外せる)。閉じていない鑑別依頼は cancelled にする。
退院の取消では戻さない(§8)。

## 6. 重複チェックとの関係

薬剤行の警告(`fhir/medicationSafetyHelpers.ts`)は、投与中の処方に加えて**未鑑別・未判断の
持参薬**を数える。継続した持参薬は起こした処方の側で数えるので二重には出さない。
継続を登録している最中の処方フォームでは、その持参薬を除く。

**鑑別前に名前だけで登録した薬は YJ コードを持たないので、重複チェックに掛からない。**
鑑別で医薬品を特定した時点で掛かるようになる。

## 7. 上流アクセスの注意

- `MedicationStatement` の検索パラメータは identifier / status / patient / code / context /
  effective だけ。category では引けないので、入院の持参薬は `context` で引く。
- 鑑別依頼の Task は `Task?code=…|brought-med-review&encounter=Encounter/{id}` で引く。
- 同時編集(鑑別と判断が同じ持参薬を書く)に備えて、持参薬の更新は `ifMatch` を付ける。

## 8. 未実装・今後

- **外来の他院処方・お薬手帳**。同じ `MedicationStatement` に `context` 無しで載せられる。
- **院内採用薬に絞った代替薬の選択**。医薬品マスタに採用区分が無いので、全国マスタから選ぶ。
- **持参薬の返却・廃棄の記録**。
- **退院処方で持参薬を再開する導線**(休止していた持参薬を退院時に戻す)。
- **退院の取消で持参薬を戻す**。退院で終了にした持参薬と取り下げた鑑別依頼は、退院を
  取り消しても元に戻らない。
- **持参薬が切れる前の知らせ**。起こした処方は残日数ぶんなので、切れたら次の定期処方で
  院内の薬に切り替える。処方切れの検知(`docs/order-common-backlog.md`)と一緒に扱う。
