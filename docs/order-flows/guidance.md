# 栄養指導・服薬指導の業務フロー

管理栄養士への栄養食事指導の依頼(栄養指導)と、薬剤師への服薬指導の依頼(服薬指導)を、登録から部門の受付・指導の積み上げ・終了(退院での打ち切り)まで追う流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
2 つともリハビリと同じ**期間継続型**のオーダーです。1 つの依頼が数週間〜数か月続き、その間に指導の記録が何度も積み上がります。骨格は [rehab.md](rehab.md) と同じなので、この文書は**リハビリとの違い**を中心に書きます。
設計は [nutrition-guidance-order-design.md](../nutrition-guidance-order-design.md)(栄養指導)・[medication-guidance-order-design.md](../medication-guidance-order-design.md)(服薬指導)、
画面のふるまいは [features/medication.md](../features/medication.md)「服薬指導」、指導記録のテンプレートは [report-mappings/nutrition-guidance-record-01.md](../report-mappings/nutrition-guidance-record-01.md)、
種別共通の約束(中止・削除・代行入力・オーダーセット)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。

## 運用フロー

### リハビリとの違い

| | リハビリ | 栄養指導 | 服薬指導 |
|---|---|---|---|
| 依頼先 | リハ部門(療法士) | 栄養部門(管理栄養士) | 薬剤部(薬剤師) |
| 入力する項目 | 区分・療法・単位数・週の回数・期間・対象疾患名・起算日 | 指導形態(個別 / 集団)・期間・対象疾患名・指示食種・指導目的・栄養部門への指示 | 指導区分(服薬指導 / 退院時指導)・指導条件(複数可)・期間・対象薬剤・指導してほしいこと・薬剤部への連絡事項 |
| 必須の項目 | 区分・療法・単位数・開始日・対象疾患名 | 指導形態・開始日・対象疾患名 | 指導区分・開始日 |
| 予約 | 部門が「次回予約」を都度取る | 部門が「次回予約」を都度取る(栄養相談室の枠) | 持たない(薬剤師が病棟で指導する) |
| 担当 | 実施記録の担当療法士だけ | 実施記録の担当管理栄養士だけ | 受け持ちの「担当薬剤師」を一覧で登録する。実施した薬剤師は別に残す |
| 実施で入れるもの | 療法・単位数・担当療法士・訓練内容 | 指導種別(初回 / 2 回目以降 / 集団)・実施時間(分)・担当管理栄養士・指導内容 | 指導種別(服薬指導 / ハイリスク薬 / 退院時指導)・理解度・担当薬剤師・指導内容 |
| テンプレート | 無し | 指導目的(オーダー)と指導内容(実施)で使える | 指導内容(実施)で使える |
| 部門の画面 | リハビリ一覧 | 部門業務 > 栄養部門 > 栄養指導一覧(`/nutrition-guidance-worklist`) | 部門業務 > 薬剤部門 > 服薬指導一覧(`/medication-guidance-worklist`) |
| ホームのカード | 療法士 | 管理栄養士「栄養指導」 | 薬剤師「服薬指導」(担当未定の件数を添える) |
| 医事会計 | 実施 1 回ごとに送る | 実施 1 回ごとに送る | まだ送らない(送れない項目に出す) |

- 入口はカルテの右ペイン「栄養指導」「服薬指導」です。部門の一覧から代わりに起こす入口はありません。
- クリニカルパスのタスク分類は、栄養指導が `EGNC`、服薬指導が `EGMG` です。オーダーセットにも入れられます(開始日・終了日・対象プロブレムは持ち込みません)。
- 実施しても進捗は動かない、終了で期間を打ち切る、退院で止められる、という点はリハビリと同じです。

### 進捗の状態

| 状態 | 意味 | 変わるきっかけ | 一覧の行からできること |
|---|---|---|---|
| 依頼済 | 部門がまだ受けていない | 医師の登録、受付取消、中止取消 | 受付、中止(服薬指導は担当も) |
| 実施中 | 受けた。期間中ずっとこの状態で指導が積み上がる | 受付、終了取消 | 実施、次回予約(栄養指導)、終了、受付取消、中止(服薬指導は担当も) |
| 終了 | 期間を打ち切った | 終了(終了日) | 終了取消(実施中へ。服薬指導は担当も) |
| 中止 | 指導を取りやめた | 中止 | 中止取消(依頼済へ) |

- 状態を動かすのは部門の一覧だけです。実施しても状態は変わりません。
- 一覧の行に直接出るのは「受付」「実施」「次回予約」(栄養指導)「表示」です。終了・各取消・中止と、服薬指導の「担当」は行のケバブメニューに畳んであります。
- 例外はクリニカルパスからの実施です。依頼済のオーダーをパスの画面から実施すると、同時に実施中になります。

### 全体の流れ(栄養指導)

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["主治医"]
    order["栄養指導オーダーを登録<br/>指導形態・期間・対象疾患名・指示食種・指導目的"]
    edit["期間を延ばす・内容を変える<br/>(オーダーの編集)"]
  end

  subgraph dept["栄養部門(管理栄養士)"]
    accept["受付(実施中)"]
    book["次回予約<br/>栄養相談室の枠を選ぶ"]
    day["予約の日に指導し<br/>実施を記録する"]
    more{"続ける?"}
    close["終了<br/>終了日を入れる"]
  end

  subgraph ward["病棟"]
    discharge["退院<br/>栄養指導を退院日で終了する"]
  end

  start --> order --> accept --> book --> day --> more
  more -- "はい" --> book
  more -- "期間を延ばす" --> edit --> book
  more -- "いいえ" --> close --> finish
  day -. "入院中に退院" .-> discharge --> finish
```

- 初回はおおむね 30 分以上、2 回目以降はおおむね 20 分以上という算定の目安があり、初回と継続 2〜3 回で終わるのが典型です。
- 予約を取らずに指導した日は、一覧の「依頼」ビューから実施を記録します(ベッドサイドでの指導など)。

### 全体の流れ(服薬指導)

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["主治医"]
    order["服薬指導オーダーを登録<br/>指導区分・指導条件・期間・対象薬剤"]
    dc_order["退院時指導のオーダーを登録"]
  end

  subgraph pharm["薬剤部(薬剤師)"]
    accept["受付(実施中)"]
    assign["担当薬剤師を決める"]
    day["病棟で指導し<br/>実施を記録する(週ごと)"]
    more{"どうなった?"}
    dc_accept["退院時指導を受付"]
    dc_day["退院時指導を記録する"]
    close["終了<br/>終了日を入れる"]
  end

  subgraph ward["病棟"]
    discharge["退院<br/>服薬指導を退院日で終了する<br/>(どちらのオーダーも)"]
  end

  start --> order --> accept --> assign --> day --> more
  more -- "入院が続く" --> day
  more -- "退院が決まった" --> dc_order --> dc_accept --> dc_day --> discharge --> finish
  more -- "指導を終える" --> close --> finish
```

- 入院中の指導(指導区分「服薬指導」)と退院時の指導(「退院時指導」)は別のオーダーにします。退院時指導のオーダーでは、実施の指導種別が「退院時指導」だけになるためです。
- 担当薬剤師は受付の前でも決められます(依頼済のまま担当だけ付きます)。担当は終了・中止・取消をしても外れません。
- 一覧は担当(自分 / 未定)で絞れ、ホームの「服薬指導」カードは担当未定の件数を出すので、受け持ちの漏れに気づけます。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  kind{"種別は?"}
  format{"指導形態がある?"}
  disease{"対象疾患名がある?"}
  gkind{"指導区分がある?"}
  start{"開始日がある?<br/>(セット・パスの内容では不要)"}
  end_q{"終了日が空か<br/>開始日以降?"}
  error["入力エラーを表示<br/>該当の項目に印を付ける"]
  send["オーダーを保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は指示医師本人?"}
  approval["指示医師に承認待ちの通知"]
  done((("登録完了")))
  fix["入力を直す"]

  submit --> kind
  kind -- "栄養指導" --> format
  format -- "いいえ" --> error
  format -- "はい" --> start
  kind -- "服薬指導" --> gkind
  gkind -- "いいえ" --> error
  gkind -- "はい" --> start
  start -- "いいえ" --> error
  start -- "はい" --> end_q
  end_q -- "いいえ" --> error
  end_q -- "はい(栄養指導)" --> disease
  end_q -- "はい(服薬指導)" --> send
  disease -- "いいえ" --> error
  disease -- "はい" --> send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
  error --> fix --> submit
```

- 栄養指導の対象疾患名は特別食加算の算定要件なので必須です。登録病名から選んで写すこともでき、手で書き換えると病名との紐付けは外れます。
- 栄養指導の指示食種は任意で、食事オーダーと同じ食種マスタから選びます。入院中で食事が出ていれば、いまの食種を横に出し「指示食種へ複写」で写せます(違う食種を指導することもあるので自動では入れません)。
- 服薬指導の指導条件は「ハイリスク薬」「麻薬」「吸入・自己注射の手技」「多剤併用」「服薬状況の確認」「嚥下・剤形の相談」「家族への指導」から複数選べます。ハイリスク薬を付けると、実施の指導種別の初期値が「服薬指導(ハイリスク薬)」になります。
- 指導形態の初期値は「個別指導」、指導区分の初期値は「服薬指導」です。入外区分の初期値は、入院中なら「入院」です。
- 承認待ちでもオーダーは部門に流れます。

### 予約(栄養指導)

予約の取り方・日時変更・取消はリハビリと同じです([rehab.md](rehab.md)「予約」)。違いは次の点だけです。

- 枠は管理画面の「予約枠」で作る「栄養指導予約」の枠表です(場所は栄養相談室など)。
- 集団指導では 1 枠に複数の患者が入るので、枠の定員は 1 に固定しません。
- カルテの予約タブでは「栄養指導」の印が付き、取消・日時変更ができます。
- 服薬指導には予約がありません。指導する日は担当薬剤師が病棟の都合で決めます。

### 日々の実施

```mermaid
flowchart TD
  open(("基準日を選んで一覧を開く"))
  kind{"種別は?"}
  view{"どこから?(栄養指導)"}
  appt["「予約」ビュー<br/>その日の予約を時刻順に並べる"]
  orders["「依頼」ビュー<br/>予約の無い指導"]
  mg["服薬指導一覧<br/>担当(自分)で絞る"]
  accepted{"受付済(実施中)?"}
  wait["実施できない<br/>(先に受付する)"]
  perform["「実施」<br/>実施日・時刻(予約の時刻)・<br/>担当(ログイン中の人)が入っている"]
  ng_input["指導種別(初回 / 2 回目以降、集団オーダーは集団だけ)<br/>実施時間(分)・指導内容"]
  mg_input["指導種別(退院時指導のオーダーは退院時指導だけ)<br/>理解度・指導内容"]
  check{"必須の項目がある?<br/>栄養指導: 実施日・指導種別・実施時間 1〜600 分・担当<br/>服薬指導: 実施日・指導種別・担当"}
  error["入力エラーを表示"]
  save["登録<br/>「本日」の列に出る<br/>進捗は実施中のまま"]
  next["次回予約を取る(栄養指導)"]
  done((("記録完了")))

  open --> kind
  kind -- "栄養指導" --> view
  view -- "予約" --> appt --> accepted
  view -- "依頼" --> orders --> accepted
  kind -- "服薬指導" --> mg --> accepted
  accepted -- "いいえ" --> wait
  accepted -- "はい" --> perform
  perform -- "栄養指導" --> ng_input --> check
  perform -- "服薬指導" --> mg_input --> check
  check -- "いいえ" --> error
  error --> perform
  check -- "はい" --> save
  save -- "栄養指導" --> next --> done
  save -- "服薬指導" --> done
```

- 栄養指導の指導種別は、オーダーの指導形態と食い違うものを選ばせません(個別のオーダーなら初回 / 2 回目以降、集団のオーダーなら集団だけ)。初回か 2 回目以降かは指導した人が選びます。
- 服薬指導の指導種別は、退院時指導のオーダーなら「退院時指導」だけ、それ以外は「服薬指導」「服薬指導(ハイリスク薬)」から選びます。理解度(良好 / 一部理解 / 不十分)は任意です。
- 担当を選ばせるのは、実施したのがログインした人とは限らないからです。服薬指導では、実施した薬剤師と一覧の担当薬剤師は別に残ります。
- 指導内容はテンプレートからも書けます。栄養指導には指導記録のテンプレート(`NUTGUIDE_REC_01`、カテゴリ「栄養指導」)があります。テンプレートで書いている間は欄を直接直せず、「テンプレート編集」から直します。「解除」で紐付けだけ外れ、文言は残ります。
- 実施の取消は、一覧の行の「表示」→ 実施履歴の「取消」です。テンプレートで書いた記入内容も一緒に消えます。別の日の実施を取り消すときは基準日をその日にします。
- 月あたりの回数・指導時間の下限・特別食に当たるかどうかの判定はしていません。

### 終了・中止・退院

```mermaid
flowchart TD
  course(("実施中のオーダー"))
  what{"どうする?"}
  complete["ケバブの「終了」<br/>終了日を入れる(開始日以降)"]
  cancel["ケバブの「中止」"]
  discharge["退院の画面<br/>「栄養指導オーダーを退院日で終了する」<br/>「服薬指導オーダーを退院日で終了する」"]
  ended["オーダーに終了日が付く<br/>栄養指導: 終了日の翌日以降の予約を取り消す<br/>その日を過ぎると一覧に出ない"]
  revoked["栄養指導: 今日以降の予約を取り消す<br/>中止の行として一覧に残る"]
  dischargeEnd["退院日より後まで続くオーダーに<br/>退院日を終了日として付ける<br/>栄養指導: 退院日の翌日以降の予約を取り消す<br/>(進捗は実施中のまま)"]
  undo{"押し間違い?"}
  restore["「終了取消」で実施中へ<br/>(終了日と予約は戻らない。<br/>延ばすときは編集して予約を取り直す)"]
  restore2["「中止取消」で依頼済へ<br/>(予約は戻らない)"]
  done((("閉じた")))

  course --> what
  what -- "期間を打ち切る" --> complete --> ended --> undo
  what -- "取りやめる" --> cancel --> revoked --> undo
  what -- "退院" --> discharge --> dischargeEnd --> undo
  undo -- "終了を戻す" --> restore --> course
  undo -- "中止を戻す" --> restore2 --> done
  undo -- "いいえ" --> done
```

- 扱いはリハビリと同じです。栄養指導の予約は、もう来ない日のぶんを同じ操作で取り消して枠を空け、それより前の予約は来院の記録として残します。
- 退院では、外来の栄養指導・服薬指導に切り替えて続けることもあるので、食事とは別のチェックにしてあり外せます。退院で止めたオーダーは終了日が付くだけで、進捗は「終了」になりません。
- 終了取消で終了日を消さないのは、打ち切った期間まで巻き戻すとその間の実施記録と食い違うためです。期間を延ばしたいときはオーダーを編集します。

### 変更・中止・削除

| 操作 | できること |
|---|---|
| 変更 | カルテのカードの編集。進捗・実施記録・予約・担当は変わりません。中止のオーダーは中止のまま保存します |
| 中止 | 部門の一覧の行のケバブ「中止」。カルテのカードに中止はありません |
| 削除 | 実施記録が無いオーダーだけできます。栄養指導は取ってある予約を同じ操作で取り消し、指導目的のテンプレートの記入内容も消します。実施があるときは実施を取り消してから削除するか、中止します |
| DO | 新しいオーダーとして写します。開始日は今日、終了日は空にします。栄養指導は対象疾患名・指示食種を引き継ぎ、指導目的は文言だけ引き継ぎます(テンプレートとの紐付けは外します) |

### 帳票

専用の帳票はありません。服薬指導患者表・同意書・薬歴の帳票、栄養管理計画書(入院時の栄養管理は [features/ward.md](../features/ward.md)「栄養管理」)はこのオーダーの外です。

## 開発者向け

### リソースの構成

| もの | リソース | 栄養指導 | 服薬指導 |
|---|---|---|---|
| オーダー(ヘッダ) | `ServiceRequest` | `category` = `order-type|nutrition-guidance` + `prescription-setting`、`code` = 指導形態(`nutrition-guidance-format`)、`occurrenceDateTime` = 開始日、`reasonCode` = 指導目的、`note` = 栄養部門への指示、`reasonReference` = 対象プロブレム | `category` = `order-type|medication-guidance` + `prescription-setting`、`code` = 指導区分(`medication-guidance-kind`)、`orderDetail[]` = 指導条件(`medication-guidance-condition`)、`occurrenceDateTime` = 開始日、`reasonCode` = 指導してほしいこと、`note` = 薬剤部への連絡事項、`reasonReference` = 対象プロブレム |
| 期間・対象 | ヘッダの拡張 | `nutrition-guidance-order-end`、`-target-disease`、`-target-condition`(写した元の Condition)、`-target-diet`(食種マスタの Coding、system は食事と共通の `meal-type`)、`-purpose-questionnaire-response` | `medication-guidance-order-end`、`-target-drugs` |
| 指導目的の記入内容 | `QuestionnaireResponse` | ヘッダの拡張から参照。ヘッダと同じ transaction で書き、テンプレートの解除・オーダーの削除で消す | – |
| 進捗 | `Task`(`focus` = ヘッダ) | `task-code|nutrition-guidance`。**登録時には作らず**、Task が無いオーダーは依頼済 | `task-code|medication-guidance`。`owner` = 担当薬剤師。担当だけ先に付けると依頼済のまま Task を作る |
| 実施記録 | `Procedure`(`basedOn` = ヘッダ) | `category` = `order-type|nutrition-guidance`、`code` = 指導種別(`nutrition-guidance-session-type`: initial / follow-up / group)、`performer` = 担当管理栄養士、拡張 `nutrition-guidance-performed-minutes`(分)・`nutrition-guidance-record`(指導記録の QR)、`note` = 指導内容 | `category` = `order-type|medication-guidance`、`code` = 指導種別(`medication-guidance-session-type`: standard / high-risk / discharge)、`performer` = 指導した薬剤師、拡張 `medication-guidance-understanding`(good / partial / poor)・`medication-guidance-record`、`note` = 指導内容 |
| 予約 | `Appointment`(`basedOn` = ヘッダ) + `Slot` | 枠表は `Schedule`(`serviceType` = `schedule-service-type|nutrition-guidance`)。定員は 1 に潰さない | – |
| 代行入力 | `Provenance`(`target` = ヘッダ) | 種別共通 | 種別共通 |

- 期間を開始日 + 終了日の拡張で持つ理由、上流の `order-period` 索引はリハビリと同じです([rehab.md](rehab.md)「リソースの構成」)。
- 指導形態・指導種別・指導区分・指導条件・理解度は診療報酬上の固定の分類なので、DB マスタを持たずフロントの定数に置いています。

### 進捗 Task と status

**実施しても Task を動かしません。** リハビリと同じ逸脱で、初回の指導で終了扱いにならないようにするためです。実施ボタンを他部門と同じ形に揃えるリファクタをしないでください(`fhir/nutritionGuidanceTaskHelpers.ts`・`medicationGuidanceTaskHelpers.ts` の冒頭コメント)。

| Task | 表示 | `ServiceRequest.status` | ヘッダに書くもの |
|---|---|---|---|
| (無し)/ `requested` | 依頼済 | `active` | – |
| `accepted` | 実施中 | `active` | – |
| `completed` | 終了 | `active` のまま | `*-order-end`(終了日) |
| `cancelled` | 中止 | `revoked` | – |

- 遷移の表は `nutritionGuidanceTaskActions` / `medicationGuidanceTaskActions`、書き込みの入口は `useUpdateNutritionGuidanceTaskStatus` / `useUpdateMedicationGuidanceTaskStatus` です。中止・中止取消は `orderCancelEntries` でヘッダの status を揃えます。
- 終了で終了日を書くのは、部門一覧が `order-period` で引くので、終了日が無いと基準日に永久にヒットし続けるためです(`build*GuidanceOrderCloseEntry`)。終了取消では消しません(意図した非対称)。
- 栄養指導の終了・中止・退院は、もう来ない日の有効な予約の取消を同じ transaction に積みます(`fetchOrderAppointmentCancelEntries` の `from`。strict で全ページを読み、欠けたら書き込みを止める)。
- 担当薬剤師の変更(`useAssignMedicationGuidancePharmacist` / `buildMedicationGuidanceAssignment`)は Task だけを書きます。状態の変更(`buildTaskUpdate`)は元の Task を引き継ぐので担当は残ります。
- カルテのタイムラインは、`accepted` / `completed` のときに実施履歴を出します(`karteTimeline.ts`。リハビリと同じ)。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`。どちらもメッセージになりません)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。編集フォームは `useEditSnapshot` で開いた時点の版に固定します(`hooks/use*GuidanceOrderInitialValues.ts`)。

| 部品 | 栄養指導 | 服薬指導 |
|---|---|---|
| オーダーのフォーム | `components/NutritionGuidanceOrderForm.tsx`・`NutritionGuidanceOrderPanels.tsx`、詳細 `NutritionGuidanceOrderDetailPanel.tsx`、カード `karteCardBodies/NutritionGuidanceOrderCardBody.tsx` | `components/MedicationGuidanceOrderForm.tsx`・`MedicationGuidanceOrderPanels.tsx`、詳細 `MedicationGuidanceOrderDetailPanel.tsx`、カード `karteCardBodies/MedicationGuidanceOrderCardBody.tsx` |
| 組み立て | `fhir/nutritionGuidanceOrderHelpers.ts`・`nutritionGuidanceTaskHelpers.ts`・`nutritionGuidanceResultHelpers.ts`、予約 `fhir/appointmentHelpers.ts` の `buildNutritionGuidanceAppointmentBundle` | `fhir/medicationGuidanceOrderHelpers.ts`・`medicationGuidanceTaskHelpers.ts`・`medicationGuidanceResultHelpers.ts` |
| 部門の画面 | `pages/NutritionGuidanceWorklistPage.tsx`(依頼・予約の 2 ビュー、終了のモーダル) | `pages/MedicationGuidanceWorklistPage.tsx`(終了・担当のモーダル) |
| モーダル | 実施入力 `components/NutritionGuidancePerformModal.tsx`、次回予約・日時変更 `NutritionGuidanceBookModal.tsx`(`AppointmentSlotPicker` の `scheduleType="nutrition-guidance"`) | 実施入力 `components/MedicationGuidancePerformModal.tsx` |
| hook | `api/queries/nutritionGuidance.ts`、予約の取消・日時変更は `api/queries/appointment.ts` | `api/queries/medicationGuidance.ts` |
| 退院・パス | `components/DischargeModal.tsx`・`api/queries/encounter.ts`(`build*GuidanceOrderStopEntries`)、`components/PathwayOrderModal.tsx`(`acceptTask`) | 同左 |

### シーケンス図: 登録・編集・削除

`buildNutritionGuidanceOrderBundle` / `buildNutritionGuidanceOrderUpdateBundle`、`buildMedicationGuidanceOrderBundle` / `buildMedicationGuidanceOrderUpdateBundle`、`useCreatePrescription`(`api/queries/labResult.ts`。全種別共通)、`useUpdate*GuidanceOrder`、`delete*GuidanceOrderRequest` / `postOrderDeleteBundle`(`api/queries/orderDelete.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 登録・編集
    UI->>BE: GET /fhir(患者の Condition、入院中の Encounter、栄養指導は食事オーダー)
    BE->>FHIR: 検索
    FHIR-->>UI: 病名・対象プロブレムの候補、入外区分の初期値、いまの食種
    opt 栄養指導の指示食種
      UI->>BE: GET /master/meal_diets
      BE-->>UI: 食種マスタ
    end
    Dr->>UI: 項目を入れて登録
    UI->>UI: 入力検証(validate*GuidanceOrderForm)
    alt 登録
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: 栄養指導の指導目的をテンプレートで書いた: POST QuestionnaireResponse(urn:uuid)<br/>POST ヘッダ ServiceRequest(fullUrl)<br/>Provenance(CREATE)、代行・研修医: Task order-approval
    else 編集
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: 記入内容の PUT / POST、解除した記入内容の DELETE(栄養指導)<br/>PUT ヘッダ(ifMatch。開いた時点の版)<br/>元が revoked なら revoked のまま(keepOrderRevoked)<br/>Provenance(UPDATE)
    end
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(版違いは 412)
  else 削除
    Dr->>UI: 削除
    opt 栄養指導
      UI->>BE: GET /fhir(ServiceRequest/id、Appointment?based-on=オーダー&status=有効)
      BE->>FHIR: 検索(予約は strict、complete: true)
      FHIR-->>UI: 指導目的の記入内容の参照と、取ってある予約
    end
    UI->>BE: GET /fhir(ServiceRequest?_id&_revinclude=Task:focus,Procedure:based-on,…)
    BE->>FHIR: 検索
    FHIR-->>UI: オーダー・進捗・実施記録
    UI->>UI: 実施記録があれば止める
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: 栄養指導: PUT Appointment cancelled + Slot free(予約ごと)、DELETE QuestionnaireResponse<br/>DELETE Task、DELETE ヘッダ
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 部門の一覧・進捗・担当

`useNutritionGuidanceWorklist` / `useMedicationGuidanceWorklist`(`fetchWorklistBundles` で 500 件ずつ)。一覧・実施・予約のどれかが上限で欠けたら `truncated` を出します。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 管理栄養士 / 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(ServiceRequest?category=order-type|種別&status=active,revoked)
  Note over UI,BE: order-period=ge基準日&order-period=le基準日<br/>based-on:missing=true、_include 患者、_revinclude Task:focus
  BE->>FHIR: 検索
  FHIR-->>UI: 基準日に効いているオーダー(Task の owner = 担当薬剤師)
  par 基準日の実施
    UI->>BE: GET /fhir(Procedure?category=order-type|種別&date=基準日)
    BE->>FHIR: 検索
    FHIR-->>UI: 「本日」の列
  and 基準日以降の予約(栄養指導)
    UI->>BE: GET /fhir(Appointment?date=ge基準日&service-type=…|nutrition-guidance&status=有効&_sort=date)
    BE->>FHIR: 検索
    FHIR-->>UI: 「次回予約」の列と「予約」ビュー
  end
  alt 受付・受付取消・中止取消・終了取消
    Dept->>UI: 行のボタン / ケバブ
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task を新しい状態に(無ければ POST)<br/>中止取消: PUT ヘッダ status=active(ifMatch)
  else 中止
    Dept->>UI: ケバブ「中止」
    opt 栄養指導
      UI->>BE: GET /fhir(Appointment?based-on=オーダー&date=ge今日&status=有効)
      BE->>FHIR: 検索(strict、complete: true)
      FHIR-->>UI: 取り消す予約と枠
    end
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Task cancelled、PUT ヘッダ status=revoked(ifMatch)<br/>栄養指導: PUT Appointment cancelled + Slot free(予約ごと)
  else 終了
    Dept->>UI: ケバブ「終了」→ 終了日
    opt 栄養指導
      UI->>BE: GET /fhir(Appointment?based-on=オーダー&date=ge終了日の翌日&status=有効)
      BE->>FHIR: 検索(strict、complete: true)
      FHIR-->>UI: 取り消す予約と枠
    end
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Task completed(executionPeriod.end)<br/>PUT ヘッダ *-order-end = 終了日(ifMatch)<br/>栄養指導: PUT Appointment cancelled + Slot free(予約ごと)
  else 担当(服薬指導)
    Dept->>UI: ケバブ「担当」→ 薬剤師を選ぶ / 解除
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task の owner を書き換え(無ければ requested で POST)
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

予約・日時変更・取消のシーケンスはリハビリと同じです(`useBookNutritionGuidanceAppointment` / `buildNutritionGuidanceAppointmentBundle`、`useRescheduleAppointment`、`useCancelAppointment`。[rehab.md](rehab.md)「シーケンス図: 予約・日時変更・取消」)。

### シーケンス図: 実施・実施の取消・退院での打ち切り

`build*GuidancePerformBundle`、`useRegister*GuidancePerform`、`useDelete*GuidancePerform`、退院は `build*GuidanceOrderStopEntries`(`usePatient*GuidanceOrders` で患者の有効なオーダーを全件読む)。

```mermaid
sequenceDiagram
  autonumber
  actor Staff as 管理栄養士 / 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 実施
    Staff->>UI: 行の「実施」
    UI->>BE: GET /fhir(Practitioner)
    BE->>FHIR: 検索
    FHIR-->>UI: 担当の候補
    opt 指導内容をテンプレートで書く
      UI->>BE: GET /fhir(Questionnaire)
      BE->>FHIR: 検索
      FHIR-->>UI: テンプレート
    end
    Staff->>UI: 指導種別・実施時間 / 理解度・担当・指導内容を入れて登録
    UI->>UI: validate*GuidancePerformForm
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: POST QuestionnaireResponse(urn:uuid。テンプレートで書いたとき)<br/>POST Procedure(basedOn = オーダー)<br/>進捗 Task は動かさない<br/>パスから依頼済のオーダーを実施: Task accepted も同じ transaction に
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 実施の取消
    Staff->>UI: 行の「表示」→ 実施履歴の「取消」
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE Procedure、DELETE QuestionnaireResponse(指導記録があれば)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(entered-in-error では残さない)
  else 退院での打ち切り
    UI->>BE: GET /fhir(ServiceRequest?subject=患者&category=order-type|種別&status=active)
    BE->>FHIR: 検索(complete: true。欠けた結果は使わない)
    FHIR-->>UI: 有効なオーダー
    UI->>UI: 退院日より後まで続くものを選ぶ(*GuidanceOrderNeedsStop)
    opt 栄養指導
      UI->>BE: GET /fhir(Appointment?based-on=オーダー&date=ge退院日の翌日&status=有効)× 選んだオーダー
      BE->>FHIR: 検索(strict、complete: true)
      FHIR-->>UI: 取り消す予約と枠
    end
    UI->>BE: POST /fhir(退院の transaction)
    Note over UI,BE: Encounter・ベッドの更新、食事・リハビリの打ち切りと一緒に<br/>PUT ヘッダ *-order-end = 退院日(Task は動かさない)<br/>栄養指導: PUT Appointment cancelled + Slot free(予約ごと)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### 医事会計と SS-MIX2

栄養指導は実施記録から集めます(`BillingClaimBuilder` の `:procedure` 経路、`Resolvers::NutritionGuidance`)。実施 1 件 = 1 剤で、コードは施設設定の `receipt_codes.nutrition_guidance`(初回 / 2 回目以降 / 集団)から指導種別で引き、数量は 1 です。期間継続型(`continuous`)なので、実施記録の無い日のヘッダは報告しません。日レセの診療種別区分は 130 です。
服薬指導は送り方が未実装です(`OrderCatalog::PENDING`)。薬剤管理指導料・退院時薬剤情報管理指導料の区分を実施の指導種別から引く形にはしてありますが、コードの持ち方を決めていません。

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 登録・編集・削除 | 栄養指導はなし。服薬指導はオーダーの開始日の送信で「この種別はまだ医事会計へ送りません」と送れない項目に出す | なし(`OMG^O19` の対象外) |
| 受付・終了・中止・担当・退院での打ち切り | なし | なし |
| 予約・日時変更・取消(栄養指導) | なし | なし |
| 実施 | 栄養指導は実施日に送る。指導種別が無い、施設設定にコードが無いときは「送れない項目」に出す。服薬指導は送らない | なし |
| 実施の取消 | 対象から外れる(DELETE) | なし |
