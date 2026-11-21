# リハビリオーダーの業務フロー

リハビリオーダーを、登録からリハ部門の受付・次回予約・日々の実施・終了(退院での打ち切り)まで追う流れです。
リハビリは 1 つのオーダーが数週間〜数か月続き、その間に実施が何度も積み上がる**期間継続型**のオーダーです。オーダーで決めるのは「いつからいつまで、どの区分・療法を週何回・1 回何単位」までです。何時に行うかはリハ部門がそのつど取る予約で決め、行った結果は実施記録に残します。

医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
設計は [rehab-order-design.md](../rehab-order-design.md)、退院の画面は [features/ward.md](../features/ward.md)、
種別共通の約束(中止・削除・代行入力・オーダーセット)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。

## 運用フロー

このページでの呼び名です。

- **状態**: オーダーをリハ部門が受けたかどうかの段階(依頼済・実施中・終了・中止)。一覧では「ステータス」の列に出ます。
- **終了日**: オーダーの期間の終わりの日。状態の「終了」とは別のもので、終了日が付いても状態が「終了」になるとは限りません(→「終了・中止・退院」)。
- **基準日**: リハビリ一覧で選ぶ日付。その日に始まっていて、まだ終わっていないオーダーが並びます。
- **指示医師**: オーダーの指示を出した医師。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("完了")))

  subgraph doctor["医師"]
    order["リハビリオーダーを登録"]
    edit["オーダーを編集して<br/>期間を延ばす・内容を変える"]
  end

  subgraph dept["リハ部門"]
    accept["「受付」を押す"]
    book["「次回予約」で<br/>リハ室の枠を選ぶ"]
    day["その日の予約から実施を入力"]
    more{"リハビリを続ける?"}
    close["「終了」で終了日を入れる"]
  end

  subgraph ward["病棟"]
    discharge["退院の画面で<br/>退院日を終了日にする"]
  end

  start --> order --> accept --> book --> day --> more
  more -- "はい" --> book
  more -- "はい(期間を延ばす)" --> edit --> book
  more -- "いいえ" --> close --> finish
  day -. "入院中に退院" .-> discharge --> finish
```

- **入口**: オーダーはカルテの右ペイン(右側のオーダー入力)の「リハビリ」から出します。リハ部門の一覧から代わりに出す入口はありません。
- **部門の画面**: 「リハビリ部門 > リハビリ一覧」です。ホームでは理学療法士・作業療法士・言語聴覚士に件数のカードが出ます。
- **終了日を入れないオーダー**: 外来の継続リハビリは終了日を入れずに出し、リハ部門が「終了」で打ち切ります。
- **終了日を入れたオーダー**: その日を過ぎるとリハビリ一覧に出なくなります。状態は実施中のまま残ります。
- **取りやめ**: リハビリを取りやめるときは、リハ部門が一覧で「中止」にします(→「終了・中止・退院」)。

### オーダーの状態

| 状態 | 意味 | 変わるきっかけ | 一覧の行からできること |
|---|---|---|---|
| 依頼済 | リハ部門がまだ受けていない | 医師の登録、受付取消、中止取消 | 受付、中止 |
| 実施中 | 受けた。期間中ずっとこの状態で実施が積み上がる | 受付、終了取消 | 実施、次回予約、終了、受付取消、中止 |
| 終了 | 期間を打ち切った | 終了(終了日) | 終了取消(実施中へ) |
| 中止 | リハビリを取りやめた | 中止 | 中止取消(依頼済へ) |

- 状態を動かすのはリハ部門(リハビリ一覧)だけです。実施を入力しても状態は変わりません。
- ただし、クリニカルパスの画面から依頼済のオーダーを実施したときだけ、同時に実施中になります(終了にはなりません)。
- 一覧の行に直接出るボタンは「受付」「実施」「次回予約」「表示」です。
- 「終了」「受付取消」「終了取消」「中止」「中止取消」は、押し間違えると期間や状態が動くので、行のメニュー(行の右端の「︙」)に入れてあります。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  check{"入力は下の表の<br/>条件を満たす?"}
  error["入力エラーを表示し<br/>該当の項目に印を付ける"]
  fix["入力を直す"]
  send["オーダーを保存"]
  result{"保存できた?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は指示医師本人?"}
  approval["指示医師に承認待ちの通知"]
  done((("登録完了")))

  submit --> check
  check -- "いいえ" --> error --> fix --> submit
  check -- "はい" --> send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
```

| 入力する項目 | 条件 |
|---|---|
| 疾患別リハ区分 | 必須 |
| 療法種別(PT / OT / ST) | 1 つ以上。併用できる |
| 1 回あたりの単位数 | 1〜24 の整数 |
| 週あたりの回数 | 空か、1〜7 の整数 |
| 開始日 | 必須。オーダーセット・クリニカルパスに入れておく内容では不要 |
| 終了日 | 空か、開始日以降 |
| 起算日 | 空か、開始日以前 |
| 対象疾患名 | 必須 |

このほかに入外区分・対象プロブレム・コメントを入れます。

- **対象疾患名**: 疾患別リハの算定要件なので必須です。登録病名から選ぶ対象プロブレムとは別に、リハビリの対象として挙げた疾患を文字で残します。
- **起算日**: 発症日・手術日です。一覧の「起算日」列に出て、医事会計で発症年月日のコメントを付けるときに使います。算定日数の上限(150 日・180 日など)の警告はありません。
- **単位数と回数**: 1 単位は 20 分です。週あたりの回数は目安で、曜日は決めません。
- **入外区分**: 初期値は、入院中なら「入院」です。
- **承認待ち**: 承認待ちでもオーダーはリハ部門に届きます。
- **登録時の警告**: ありません。

### 予約

予約は、リハ部門がオーダーを受付した後に、行の「次回予約」でそのつど取ります。次回をいつにするかは毎回の実施のあとに決めるのが外来リハの実態なので、オーダー登録のときには予約を取りません。

```mermaid
flowchart TD
  start(("予約を取る"))
  accepted{"状態は「実施中」?"}
  stop["予約は取れない<br/>先に受付する"]
  book["行の「次回予約」"]
  pick["「リハビリ予約」の枠表から<br/>空き枠を選ぶ"]
  save["「この枠で予約」"]
  listed["一覧の「次回予約」列と<br/>その日の「予約」ビューに出る"]
  change{"予約を変える?"}
  move["「日時変更」"]
  cancel["「予約取消」"]
  done((("予約ができた")))

  start --> accepted
  accepted -- "いいえ" --> stop
  accepted -- "はい" --> book --> pick --> save --> listed --> change
  change -- "はい(日時を変える)" --> move --> listed
  change -- "はい(やめる)" --> cancel --> done
  change -- "いいえ" --> done
```

- **変更と取消の場所**: 「日時変更」「予約取消」は、リハビリ一覧の「予約」ビューの行のメニューと、カルテの予約タブから行えます。
- **枠**: リハ室(場所)ごとの「リハビリ予約」の枠表から選びます。療法士ごとの枠はありません(担当療法士は実施記録に残します)。
- **枠の準備**: 枠表は、設定する人が管理画面の「予約枠」で作ります。
- **定員**: 枠の定員は検査と違って 1 に固定しません。同じ時間帯に複数の患者を受け入れられます。
- **1 予約 = 1 枠**: 単位数ぶんの連続枠をまとめて押さえることはできません。
- **カルテの予約タブ**: 「リハビリ」の印が付きます。検査の予約と違い、ここから取消・日時変更ができます(予約がオーダーの日時と連動しないためです)。
- **外来患者一覧**: リハビリの予約は出ません。

### 日々の実施

```mermaid
flowchart TD
  open(("基準日を選んで一覧を開く"))
  view{"予約のある実施?"}
  appt["「予約」ビューの行<br/>その日の予約が時刻順に並ぶ"]
  orders["「依頼」ビューの行"]
  accepted{"状態は「実施中」?"}
  wait["実施できない<br/>先に受付する"]
  perform["「実施」を押す"]
  input["初期値を確かめて<br/>訓練内容を書く"]
  check{"入力は下の表の<br/>条件を満たす?"}
  error["入力エラーを表示"]
  save["「実施登録」を押す"]
  next["「次回予約」を取る"]
  done((("記録完了")))

  open --> view
  view -- "はい" --> appt --> accepted
  view -- "いいえ" --> orders --> accepted
  accepted -- "いいえ" --> wait
  accepted -- "はい" --> perform --> input --> check
  check -- "いいえ" --> error --> input
  check -- "はい" --> save --> next --> done
```

| 実施で入れる項目 | 開いたときの初期値 | 条件 |
|---|---|---|
| 実施日 | 入っている | 必須 |
| 時刻 | 予約から開いたときは予約の時刻 | – |
| 療法 | オーダーの療法が 1 つならその療法 | 必須。オーダーに載っている療法から選ぶ |
| 単位数 | オーダーの単位数 | 必須。1〜24 |
| 担当療法士 | ログイン中の人 | 必須 |
| 訓練内容 | – | 自由記載 |

- **登録した後**: 一覧の「本日」の列に実施量が出ます。状態は実施中のままです。
- **同じ日に 2 つの療法**: PT と OT を同じ日に行ったときは、療法ごとに 1 回ずつ登録します。
- **担当療法士**: 選べるようにしてあるのは、実施したのがログインした人とは限らないからです。受付の人が代わりに入れる運用があります。
- **「本日」の列**: その日に実施したかを日ごとに見るための列です。「未実施」と出ていても状態は実施中です。
- **入れないもの**: 器材・薬剤・訓練項目の入力はありません(リハビリの算定は単位数で決まるためです)。
- **絞り込み**: 一覧は疾患別リハ区分・療法種別・入外区分・病棟・診療科・ステータスで絞れます。

**実施の取消**

- 一覧の行の「表示」を開き、実施履歴の「取消」を押します。
- 一覧の「表示」は基準日のぶんの実施しか出しません。別の日の実施を取り消すときは、基準日をその日にします。
- カルテの詳細からは取り消せません。

### 終了・中止・退院

オーダーを閉じる方法は 3 つあります。どれも、もう来ない日の予約を同じ操作で取り消して枠を空けます。それより前の予約は通院の記録として残ります。

```mermaid
flowchart TD
  course(("実施中のオーダー"))
  what{"期間の途中で<br/>取りやめる?"}
  cancel["リハ部門: 行のメニューの「中止」"]
  revoked["状態が「中止」になる"]
  who{"退院に合わせて<br/>終える?"}
  discharge["病棟: 退院の画面のチェック"]
  dischargeEnd["退院日が終了日になる<br/>状態は実施中のまま"]
  complete["リハ部門: 行のメニューの「終了」"]
  ended["入れた日が終了日になる<br/>状態が「終了」になる"]
  done((("オーダーが閉じた")))

  course --> what
  what -- "はい" --> cancel --> revoked --> done
  what -- "いいえ" --> who
  who -- "はい" --> discharge --> dischargeEnd --> done
  who -- "いいえ" --> complete --> ended --> done
```

| 方法 | 操作 | 状態 | 終了日 | 取り消す予約 | リハビリ一覧 |
|---|---|---|---|---|---|
| 終了 | 行のメニューの「終了」で終了日を入れる | 終了 | 入れた日(開始日以降) | 終了日の翌日以降 | 終了日を過ぎると出ない |
| 中止 | 行のメニューの「中止」 | 中止 | 付かない | 今日以降 | 基準日が期間内なら中止の行として並ぶ |
| 退院 | 退院の画面の「リハビリオーダーを退院日で終了する」 | 実施中のまま | 退院日 | 退院日の翌日以降 | 終了日を過ぎると出ない |

- **退院のチェック**: 対象は、退院日より後まで続くオーダーです。外来リハに切り替えて続けることもあるので、食事とは別のチェックにしてあり、外せます。
- **退院と状態**: 退院で止めたオーダーは終了日が付くだけで、状態は「終了」になりません。
- **入院から外来への切り替え**: 切り替えを表す手段はありません。入外区分は登録時の値のままなので、外来で続けるときは新しいオーダーを出します。

**押し間違えたとき**

| 操作 | 戻る状態 | 戻らないもの |
|---|---|---|
| 「終了取消」 | 実施中 | 終了日、取り消した予約 |
| 「中止取消」 | 依頼済 | 取り消した予約 |

- **予約**: 取り消した予約は戻りません(取り消したあとに枠が埋まっていることがあるためです)。続けるときは「次回予約」で取り直します。
- **終了日**: 「終了取消」で終了日を消さないのは、打ち切った期間まで巻き戻すと、その間の実施記録と食い違うためです。期間を延ばしたいときは、オーダーを編集して終了日を直します。
- **中止取消の場所**: 中止のオーダーは、一覧の基準日が期間内なら中止の行として並びます。そこから「中止取消」ができます。

### 変更・削除・DO

| 操作 | できる場所 | 注意 |
|---|---|---|
| 変更 | カルテのカードの編集 | 状態・実施記録・予約は変わりません。中止のオーダーは中止のまま保存します |
| 中止 | リハビリ一覧の行のメニュー | カルテのカードに中止はありません(→「終了・中止・退院」) |
| 削除 | カルテのカード | 実施記録が無いオーダーだけできます |
| DO(前回と同じ内容で出し直す) | カルテのカード | 新しいオーダーとして写します |

- **削除と予約**: 取ってある予約は、削除と同じ操作で取り消して枠を空けます。
- **実施があるとき**: 実施を取り消してから削除するか、削除せずに中止します。
- **DO で写るもの**: 開始日は今日、終了日は空になります。起算日・対象疾患名はそのまま引き継ぎます。

### カルテ・パス・セットとのつながり

**カルテのカード**

- オーダーのカードは、カルテの開始日の所に 1 枚載ります。
- 見出しは「入外区分 / 期間」(例: 期間は「8/29〜継続中」)です。
- 中身は区分・療法・頻度(例:「週 3 回・1 回 2 単位」)と、直近の実施履歴です。
- 実施履歴には件数と合計単位(例:「12回 計24単位」)が添えられます。全件は詳細で見ます。
- 実施履歴をカードに出すのは実施中と終了のときです。依頼済と中止のカードには出しません。

**クリニカルパス・オーダーセット**

- クリニカルパスでは、タスク分類「リハビリ」の既定のオーダー種別がリハビリオーダーです。
- オーダーセットにも入れられます。開始日・終了日・起算日・対象プロブレムはセットに入れません。

### 検査・処置との違い

| | 検査・処置(放射線・生理・処置など) | リハビリ |
|---|---|---|
| オーダーの単位 | 検査・処置 1 回 | 期間(開始日〜終了日。終了日が無ければ継続中) |
| 入力する項目 | 項目・部位・依頼病名など | 区分・療法・単位数・回数・期間など(→「登録の判定」) |
| マスタ | 項目マスタ・伝票 | 持たない(疾患別リハ区分と療法種別は診療報酬の固定の分類) |
| 予約 | オーダー登録と一緒に取る(1 オーダー 1 予約) | リハ部門が受付後に「次回予約」をそのつど取る(1 オーダーに何件も) |
| 実施 | 1 回で状態が「実施済」になる | 何回実施しても状態は「実施中」のまま。実施記録が積み上がる |
| 部門の一覧 | その日に実施予定のオーダー | 基準日に始まっていて、まだ終わっていないオーダー |
| 終わり方 | 実施で終わる | リハ部門の「終了」か、退院での打ち切り |
| 登録時の警告 | 確認を要するものがある | 無い |
| 医事会計 | 実施記録から送る | 実施記録から送る(実施 1 回ごと) |

### 帳票

専用の帳票はありません。リハビリテーション実施計画書の様式も、まだ出せません。

## 開発者向け

### シーケンス図の前提

- **書き込みの経路**: `/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
- **上流**: backend の先にある FHIR サーバーのことです。図では「上流 FHIR」と書きます。
- **応答の中継は省く**: 図の `FHIR-->>UI` は、上流の応答を backend がそのままブラウザへ返すことを表します。
- **ヘッダ**: オーダー本体の `ServiceRequest` のことです。ほかの種別と呼び名を揃えていますが、リハビリは明細を持たず、ヘッダ 1 本だけです。
- **全ページを読み切る検索**: 取りこぼすと困る検索は `searchAllPages` に `complete: true` を渡し、上限までに読み切れなければ例外にして書き込みを止めます。`strict: true` は、検索の条件が効かずに全件が返るのを拾わないための指定です。
- **楽観ロック**: 版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。編集フォームは `useEditSnapshot` で開いた時点の版に固定します(`hooks/useRehabOrderInitialValues.ts`)。
- **SS-MIX2**: 有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。リハビリはメッセージになりません。

### リソースの構成

- ヘッダ `ServiceRequest`(オーダー。明細は持たない)
  - `Task`(進捗。`focus` = ヘッダ)
  - `Procedure`(実施記録。`basedOn` = ヘッダ。実施 1 回に 1 件)
  - `Appointment`(予約。`basedOn` = ヘッダ)+ `Slot`
  - `Provenance`(代行入力。`target` = ヘッダ。種別共通)

| リソース | 要素 | 中身 |
|---|---|---|
| ヘッダ `ServiceRequest` | `category` | `order-type|rehab` + 入外区分(v3 ActCode の `IMP` / `AMB`) |
| | `code` | 疾患別リハ区分(`rehab-disease-category`) |
| | `orderDetail[]` | 療法種別(`rehab-therapy-type`: pt / ot / st) |
| | `quantityQuantity` | 1 回あたりの単位数(unit「単位」、UCUM なし) |
| | `occurrenceDateTime` | 開始日(日付のみ) |
| | `reasonReference` | 対象プロブレム |
| | 拡張 `rehab-order-end` | 終了日。無ければ継続中 |
| | 拡張 `rehab-onset-date` | 起算日 |
| | 拡張 `rehab-target-disease` | 対象疾患名 |
| | 拡張 `rehab-frequency-per-week` | 週あたりの回数 |
| `Task` | `code` | `task-code|rehab` |
| | `status` | 部門の受け入れ状態(→「進捗 Task と status」) |
| `Procedure` | `category` | `order-type|rehab` |
| | `status` | `completed` |
| | `code` | 実施した療法種別 |
| | `performedDateTime` | 実施日時(時刻なしは日付のみ) |
| | `performer` | 担当療法士 |
| | 拡張 `rehab-performed-units` | 実施単位数 |
| | `note` | 訓練内容 |
| `Appointment` | `basedOn` | ヘッダ。1 予約 1 枠 |
| `Schedule`(枠表) | `serviceType` | `schedule-service-type|rehab` |
| | `actor` | リハ室の `Location` |

- **Task を作る時期**: 登録時には作りません。Task が無いオーダーは依頼済です。
- **実施の取消**: `Procedure` を DELETE します。
- **枠の定員**: 1 に丸めません(同じ時間帯に複数の患者を受け入れる)。
- **期間の持ち方**: 期間を `occurrencePeriod` にせず開始日 + 拡張にするのは、上流が `occurrenceDateTime` を索引するためです(食事の `meal-order-end` と同じ判断)。上流は `order-period` で開始日と `rehab-order-end` を合わせて索引しています。
- **週あたりの回数**: `occurrenceTiming` にしないのは、`occurrence[x]` が choice で、開始日の `occurrenceDateTime` と併用できないためです。
- **療法種別**: 明細の `ServiceRequest` にしないのは、療法ごとに量が分かれないためです(単位数はオーダー全体で 1 つ)。

### 進捗 Task と status

**実施しても Task を動かしません。** 他部門の実施は「実施記録 + Task を completed に」を 1 つの transaction にしますが、リハビリで同じにすると初日の実施で終了扱いになり、2 日目以降が実施できなくなります。
この逸脱は他部門の実施入力と作りが違う唯一の点です。実施ボタンを他部門と同じ形に揃えるリファクタをしないでください(`fhir/rehabTaskHelpers.ts`・`rehabResultHelpers.ts` の冒頭コメント)。

| Task | 表示 | `ServiceRequest.status` | ヘッダに書くもの |
|---|---|---|---|
| (無し)/ `requested` | 依頼済 | `active` | – |
| `accepted` | 実施中 | `active` | – |
| `completed` | 終了 | `active` のまま | `rehab-order-end`(終了日) |
| `cancelled` | 中止 | `revoked` | – |

- **遷移と入口**: 遷移の表は `rehabTaskActions`、書き込みの入口は `useUpdateRehabTaskStatus`(`api/queries/rehab.ts`)です。
- **中止とヘッダ**: 中止・中止取消は `orderCancelEntries` でヘッダの status を揃えます。
- **終了で終了日を書く理由**: 部門一覧が `order-period` で引くので、終了日が無いと status=active のまま基準日に永久にヒットし続けるためです(`buildRehabOrderCloseEntry`)。終了取消では消しません(意図した非対称)。
- **`executionPeriod`**: 受付で `start`、終了で `end` が入ります(`createTaskHelpers` の `buildTaskUpdate`)。
- **カルテのタイムライン**: 他部門が `completed` のときだけ実施情報を出すのに対し、リハビリは `accepted` / `completed` で出します(`karteTimeline.ts` の rehab 分岐)。

**予約の取消**

- 終了・中止・退院は、もう来ない日の有効な予約の取消を同じ transaction に積みます(`fetchOrderAppointmentCancelEntries` の `from`)。過ぎた予約は残します。
- 取り消す対象の検索は、全ページを読み切る検索(`complete: true`)で、`strict: true` も付けます。条件が効かずに全件を拾うと、関係ない予約まで取り消すためです。
- 読み切れなかったときは書き込みを止めます。

### 部品

| 操作 | 画面 | 組み立て | hook |
|---|---|---|---|
| 登録 | `components/RehabOrderForm.tsx`・`RehabOrderPanels.tsx` | `buildRehabOrderBundle`(`fhir/rehabOrderHelpers.ts`) | `useCreatePrescription`(`api/queries/labResult.ts`。名前と違い全種別共通) |
| 編集 | 同じフォーム | `buildRehabOrderUpdateBundle` | `useUpdateRehabOrder`(`api/queries/rehab.ts`) |
| 削除 | – | `deleteRehabOrderRequest` | `useDeleteRehabOrder`。送信は `postOrderDeleteBundle`(`api/queries/orderDelete.ts`) |
| 詳細とカード | `RehabOrderDetailPanel.tsx`、カード `karteCardBodies/RehabOrderCardBody.tsx` | – | `useRehabOrderDetail` |
| 部門の一覧 | `pages/RehabWorklistPage.tsx`(`/rehab-worklist`。依頼・予約の 2 ビュー、終了のモーダル) | – | `useRehabWorklist` |
| 状態の変更 | 同じ画面 | `fhir/rehabTaskHelpers.ts` | `useUpdateRehabTaskStatus` |
| 次回予約・日時変更 | `RehabBookModal.tsx`(枠選びは `AppointmentSlotPicker` の `scheduleType="rehab"`) | `buildRehabAppointmentBundle`(`fhir/appointmentHelpers.ts`) | `useBookRehabAppointment`、`useRescheduleAppointment`(`api/queries/appointment.ts`) |
| 予約取消 | 同じ画面とカルテの予約タブ | – | `useCancelAppointment`(`api/queries/appointment.ts`) |
| 実施 | `components/RehabPerformModal.tsx` | `buildRehabPerformBundle`(`fhir/rehabResultHelpers.ts`) | `useRegisterRehabPerform` |
| 実施の取消 | 部門の一覧の「表示」 | – | `useDeleteRehabPerform` |
| 退院での打ち切り | `components/DischargeModal.tsx` | `buildRehabOrderStopEntries`(退院の transaction に積む) | `usePatientRehabOrders`、`api/queries/encounter.ts` |
| パスからの実施 | `components/PathwayOrderModal.tsx` | `RehabPerformModal` に `acceptTask` を渡す | – |

`PathwayOrderModal.tsx` は、`TPRH` の実施のときに `RehabPerformModal` に `acceptTask` を渡します。

### シーケンス図: 登録・編集・削除

**登録**

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(候補と初期値)
  BE->>FHIR: 検索
  FHIR-->>UI: 対象プロブレムの候補など
  Dr->>UI: 入力して登録
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 段 | 中身 |
|---|---|
| 候補と初期値の検索 | 患者の `Condition`(対象プロブレムの候補)、入院中の `Encounter`(入外区分の初期値) |
| 入力 | 区分・療法・単位数・期間・対象疾患 |
| 入力検証 | `validateRehabOrderForm` |
| transaction | POST ヘッダ `ServiceRequest`(fullUrl)、`Provenance`(CREATE) |
| 代行・研修医のとき | `Task` order-approval を同じ transaction に足す |

**編集**

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(候補と初期値)
  BE->>FHIR: 検索
  FHIR-->>UI: 対象プロブレムの候補など
  Dr->>UI: 直して更新
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(版違いは 412)
```

| 段 | 中身 |
|---|---|
| 候補と初期値の検索・入力検証 | 登録と同じ |
| transaction | PUT ヘッダ(`ifMatch`。開いた時点の版)、`Provenance`(UPDATE) |
| 元が `revoked` のとき | `revoked` のまま書く(`keepOrderRevoked`) |

**削除**

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 削除
  UI->>BE: GET /fhir(取ってある予約)
  BE->>FHIR: 検索
  FHIR-->>UI: 取ってある予約
  UI->>BE: GET /fhir(オーダーを指すもの)
  BE->>FHIR: 検索
  FHIR-->>UI: オーダー・進捗・実施記録
  UI->>UI: 実施記録があれば止める
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 段 | 中身 |
|---|---|
| 取ってある予約の検索 | `Appointment?based-on=オーダー&status=有効` |
| オーダーを指すものの検索 | `ServiceRequest?_id&_revinclude=Task:focus,Procedure:based-on,…` |
| transaction | PUT `Appointment` cancelled + `Slot` free(予約ごと)、DELETE `Task`、DELETE ヘッダ |

### シーケンス図: 部門の一覧と進捗の変更

**一覧を開く**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 基準日を選ぶ
  UI->>BE: GET /fhir(基準日のオーダー)
  BE->>FHIR: 検索
  FHIR-->>UI: 基準日に効いているオーダー
  par 基準日の実施
    UI->>BE: GET /fhir(基準日の実施)
    BE->>FHIR: 検索
    FHIR-->>UI: 「本日」の列
  and 基準日以降の予約
    UI->>BE: GET /fhir(基準日以降の予約)
    BE->>FHIR: 検索
    FHIR-->>UI: 「次回予約」の列と「予約」ビュー
  end
```

| 検索 | 条件 |
|---|---|
| 基準日のオーダー | `ServiceRequest?category=order-type|rehab&status=active,revoked`、`order-period=ge基準日&order-period=le基準日`、`based-on:missing=true`、`_include` 患者、`_revinclude` `Task:focus` |
| 基準日の実施 | `Procedure?category=order-type|rehab&date=基準日` |
| 基準日以降の予約 | `Appointment?date=ge基準日&service-type=…|rehab&status=有効&_sort=date` |

- オーダーは `fetchWorklistBundles` で 500 件ずつ読みます。
- 一覧・実施・予約のどれかが上限で欠けたら `truncated` を出します。

**状態の変更**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 行のボタン・行のメニュー
  opt 中止・終了
    UI->>BE: GET /fhir(取り消す予約)
    BE->>FHIR: 検索(読み切る)
    FHIR-->>UI: 取り消す予約と枠
  end
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

書き込みは操作 1 回につき transaction 1 回です。中止と終了は、先に取り消す予約を読んでから、同じ transaction にまとめます。

| 操作 | 取り消す予約の検索 | transaction |
|---|---|---|
| 受付・受付取消・終了取消 | なし | `Task` を新しい状態に(無ければ POST) |
| 中止 | `Appointment?based-on=オーダー&date=ge今日&status=有効` | `Task` を cancelled に、PUT ヘッダ status=revoked、予約の取消 |
| 中止取消 | なし | `Task` を requested に、PUT ヘッダ status=active(`ifMatch`) |
| 終了(行のメニューの「終了」→ 終了日) | `Appointment?based-on=オーダー&date=ge終了日の翌日&status=有効` | PUT `Task` completed(`executionPeriod.end`)、PUT ヘッダ `rehab-order-end` = 終了日(`ifMatch`)、予約の取消 |

予約の取消は、予約ごとに PUT `Appointment` cancelled + `Slot` free です。検索は `strict: true`・`complete: true` です。

### シーケンス図: 予約・日時変更・取消

オーダー登録とは独立した単独の transaction です。枠を選ぶ操作は、先にリハ室の枠表と空き枠を読みます(`Schedule?service-type=…|rehab`、`Slot?schedule=…&status=free`)。

**次回予約**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(枠表と空き枠)
  BE->>FHIR: 検索
  FHIR-->>UI: リハ室の枠表と空き枠
  Dept->>UI: 枠を選んで「この枠で予約」
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

**日時変更・予約取消**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 「日時変更」か「予約取消」
  opt 日時変更
    UI->>BE: GET /fhir(枠表と空き枠)
    BE->>FHIR: 検索
    FHIR-->>UI: リハ室の枠表と空き枠
    Dept->>UI: 新しい枠を選ぶ
  end
  UI->>BE: GET /fhir(予約が押さえている Slot)
  BE->>FHIR: 検索
  FHIR-->>UI: 押さえている枠
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

「日時変更」「予約取消」は、リハビリ一覧の「予約」ビューとカルテの予約タブから行います。

| 操作 | transaction |
|---|---|
| 次回予約 | POST `Appointment`(`basedOn` = オーダー、患者・リハ室)、PUT `Slot` busy |
| 日時変更 | PUT `Appointment` 日時・枠、前の `Slot` free、新しい `Slot` busy |
| 予約取消 | PUT `Appointment` cancelled、`Slot` free |

### シーケンス図: 実施・実施の取消・退院での打ち切り

**実施**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 「実施」
  UI->>BE: GET /fhir(Practitioner)
  BE->>FHIR: 検索
  FHIR-->>UI: 担当療法士の候補
  Dept->>UI: 入力して登録
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 段 | 中身 |
|---|---|
| 「実施」 | 「予約」ビューか「依頼」ビューの行から開く |
| 入力 | 療法・単位数・担当療法士・訓練内容 |
| 入力検証 | `validateRehabPerformForm` |
| transaction | POST `Procedure`(`basedOn` = オーダー)。進捗 `Task` は動かさない |
| パスから依頼済のオーダーを実施したとき | `Task` accepted も同じ transaction に入れる |

**実施の取消**

```mermaid
sequenceDiagram
  autonumber
  actor Dept as リハ部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 「表示」→ 実施履歴の「取消」
  UI->>BE: DELETE /fhir/Procedure/id
  BE->>FHIR: DELETE
  FHIR-->>UI: 結果
```

実施記録は消します。`entered-in-error` にして残すことはしません。

**退院での打ち切り**

```mermaid
sequenceDiagram
  autonumber
  actor Ward as 病棟
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ward->>UI: 退院の画面を開く
  UI->>BE: GET /fhir(有効なオーダー)
  BE->>FHIR: 検索(読み切る)
  FHIR-->>UI: 有効なオーダー
  UI->>UI: 退院日より後まで続くものを選ぶ
  Ward->>UI: チェックを付けたまま退院
  UI->>BE: GET /fhir(取り消す予約)
  BE->>FHIR: 検索(読み切る)
  FHIR-->>UI: 取り消す予約と枠
  UI->>BE: POST /fhir(退院の transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 段 | 中身 |
|---|---|
| 有効なオーダーの検索 | `ServiceRequest?subject=患者&category=order-type|rehab&status=active`。`complete: true` で、欠けた結果は使わない(`usePatientRehabOrders`) |
| 止めるオーダーを選ぶ | `rehabOrderNeedsStop` |
| 取り消す予約の検索 | `Appointment?based-on=オーダー&date=ge退院日の翌日&status=有効` を、選んだオーダーごとに。`strict: true`・`complete: true` |
| transaction | `Encounter`・ベッドの更新、食事の打ち切りと一緒に、PUT ヘッダ `rehab-order-end` = 退院日、予約ごとに PUT `Appointment` cancelled + `Slot` free |
| 進捗 | `Task` は動かさない |

### 医事会計と SS-MIX2

リハビリは実施記録から集めます(`BillingClaimBuilder` の `:procedure` 経路、`Resolvers::Rehab`)。

- **送る単位**: 実施 1 件 = 1 剤です。同じ日に PT と OT があれば剤が 2 つになります。
- **コードと数量**: コードは施設設定の `receipt_codes.rehab`(疾患別リハ区分 × 療法)から引き、数量は実施単位数です。
- **コメント**: 区分ごとに施設設定で疾患名のコメント(830 系)・発症年月日のコメント(850 系)のコードを入れておくと、オーダーの対象疾患名と起算日から組んで添えます。
- **実施の無い日**: 期間継続型(`OrderCatalog` の `continuous`)なので、実施記録の無い日のオーダーを「実施記録がありません」とは報告しません。
- **診療種別区分**: 日レセの診療種別区分は 800 です。

医事会計に送るのは実施だけです。登録・編集・削除、受付・終了・中止・退院での打ち切り、予約・日時変更・取消では何も送りません。SS-MIX2 のメッセージはどの操作でも作りません(`OMG^O19` の対象外)。

| 起きたこと | 医事会計(`BillingClaimBuilder`) |
|---|---|
| 実施 | 実施日に送る |
| 実施の取消 | 対象から外れる(DELETE) |

実施を送れないときは、次のように報告します。

- 区分・療法が無い、または施設設定にコードが無いときは「送れない項目」に出します。
- コメントのコードがあるのに、オーダーに対象疾患名・起算日が無いときも、その旨を出します。

DPC の判定では、実施記録があることを手術・処置等のダミーコード `0007`(リハビリテーション)の根拠に使います(`Dpc::DummyRules`)。
