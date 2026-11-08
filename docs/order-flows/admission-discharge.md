# 入院から退院までの業務フロー

入院を、入院予定の登録からベッドの割り当てと入院実施、入院中の転室・転床・転科・転棟・外出泊、退院予定と退院、退院後の文書まで追う流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
入院は**患者 1 人の 1 回の入院を 1 件の記録**で表し、予定から退院までその記録の状態と居場所(ベッド)が移っていきます。入院中のオーダーはそれぞれの種別の流れに乗りますが、食事・看護指示・リハビリ・栄養指導・服薬指導・持参薬は退院や外出泊に合わせて止まり、戻ります。その連動の細部は各種別の業務フロー([食事](meal.md#入退院外出泊との連動)、[看護指示](nursing.md)、[リハビリ](rehab.md)、[栄養指導・服薬指導](guidance.md))を読みます。
画面のふるまいは [features/ward.md](../features/ward.md)、ベッドスケジュール・病床状況・入退院文書は [bed-management-design.md](../bed-management-design.md)、退院時サマリーは [discharge-summary-design.md](../discharge-summary-design.md)、DPC は [dpc-coding-design.md](../dpc-coding-design.md)、SS-MIX2 は [ssmix2-export-design.md](../ssmix2-export-design.md) が正典です。

## 運用フロー

### 入院の状態

| 状態 | 意味 | 変わるきっかけ | 一覧での見え方 |
|---|---|---|---|
| 入院予定 | 入院が決まっている。病棟は決まり、病室・ベッド・日付は未定でもよい | 入院予定の登録(カルテ右ペイン・入院患者一覧・救急の転帰「入院」) | 入院患者一覧の「入院予定」タブ、ベッドスケジュールの点線の帯(ベッド未定は最下段)、病棟マップの「本日の入院予定」 |
| 入院中 | ベッドに居る | 入院実施(予定から)、空床への入院登録(予定なし) | 入院患者一覧の「入院患者」タブ、病棟マップのカード、ベッドスケジュールの塗りの帯 |
| 退院 | 退院日時で入院を終えた | 退院 | 「退院患者」タブ、ベッドスケジュールの退院日までの帯 |
| 入院予定取消 | 予定がなくなった(誤りではない) | 入院予定取消 | どこにも出ない |
| 入院取消 | 誤って入院登録した | 入院取消 | どこにも出ない |

入院中の患者には、状態とは別に**予定のメモ**を 1 件ずつ持てます。

| 予定 | 持てる数 | 中身 | 済んだら |
|---|---|---|---|
| 転科・転棟予定 | 1 件(登録し直すと置き換わる) | 予定日・移動先の病棟(必須)・病室・ベッド・診療科 | 転科・転棟の実施で消える |
| 外出泊 | 何件でも | 開始日時・終了(帰院予定)日時・理由・帰院済みか | 帰院で「帰院済み」になり、記録として残る |
| 退院予定 | 1 件(登録し直すと置き換わる) | 退院予定日時・理由 | 退院で消える |

- 記録は消さずに状態で残します。退院・入院取消・予定取消のどれも、いつ誰が登録したかを後から追えます。
- 入院日数は保存せず、入院日を 1 日目として数えます。
- 入院中の患者の入院日・病棟・主治医は、オーダーの入外区分の初期値、オーダーに残す入院病棟、クリニカルパスの病日、DPC の入院日の元になります。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph decide["外来・救急の医師"]
    plan["入院予定を登録<br/>病棟(必須)・病室・ベッド・予定日<br/>診療科・主治医・入院経路"]
  end

  subgraph bed["病棟(ベッドコントロール)"]
    board["ベッドスケジュール・病床状況で<br/>空床と予定を見て床を決める"]
    admit["入院実施<br/>空床を選び入院日時を確定"]
    move["転室・転床<br/>(病棟マップでまとめて動かせる)"]
    transfer["転科・転棟の実施"]
    leave["外出泊・帰院"]
    discharge["退院<br/>食事・看護指示・リハビリなどを一緒に止める"]
  end

  subgraph doctor["主治医"]
    care["入院中の診療<br/>オーダー・クリニカルパス<br/>入院診療計画書"]
    transferPlan["転科・転棟予定"]
    dischargePlan["退院予定<br/>(退院食止めが掛かる)"]
    summary["退院時サマリー<br/>DPC の決定"]
  end

  subgraph staff["看護師・部門"]
    intake["入院時の記録<br/>看護プロファイル・持参薬<br/>栄養スクリーニング・褥瘡リスク"]
    nsum["看護サマリー(退院)"]
  end

  start --> plan --> board --> admit
  admit --> care
  admit --> intake
  care --> transferPlan --> transfer --> care
  care --> move --> care
  care --> leave --> care
  care --> dischargePlan --> discharge
  care -- "予定なしで退院" --> discharge
  discharge --> summary --> finish
  discharge --> nsum --> finish
```

- 役割の分け方は運用で決めます。システムの権限で止めているのは一部(看護サマリーの承認など)だけで、入退院の操作はどの職種のログインでもできます。
- 入院実施の前でも、入院予定に対してクリニカルパスを当てられます(病日 1 は予定日)。
- 入院中の情報は、入院患者一覧・病棟マップ・ベッドスケジュール・病床状況・入退院文書・看護必要度・DPC 患者一覧が同じ入院の記録から読みます。

### 入院予定から入院実施まで

```mermaid
flowchart TD
  open(("入院が決まる"))
  from{"どこから?"}
  karte["カルテの右ペイン<br/>「入院予定登録」"]
  list["入院患者一覧の<br/>「入院予定」タブ"]
  er["救急患者一覧で<br/>転帰「入院」を確定"]
  form["病棟(必須)・病室・ベッド<br/>入院予定日(空なら日付未定)<br/>診療科・主治医・担当看護師<br/>入院経路・予定/救急の区分・特記事項"]
  wardQ{"病棟を選んだ?"}
  error["入力エラーを表示"]
  planned["入院予定になる<br/>日付未定は一覧の先頭に並ぶ"]
  wait{"入院の日が来た?"}
  cancelQ{"入院しなくなった?"}
  cancelPlan["入院予定取消"]
  exec{"どこで実施する?"}
  fromList["入院予定タブの「入院実施」"]
  fromMap["病棟マップの「本日の入院予定」を<br/>空床へ落とす"]
  execForm["空床を選ぶ(予定のベッドが埋まっていれば選び直す)<br/>入院日時(既定は今)<br/>診療科・主治医は予定から"]
  bedQ{"ベッドを選んだ?<br/>診療科がある?"}
  dupQ{"別の床に<br/>入院中?"}
  confirm["確認して続ける<br/>(転床やデータ修正の途中のことがある)"]
  admitted((("入院中")))
  cancelled((("予定取消")))
  direct["予定なしの入院登録<br/>入院患者一覧・病棟マップの空床の「患者選択」"]

  open --> from
  from -- "外来の診察中" --> karte --> form
  from -- "病棟から" --> list --> form
  from -- "救急外来" --> er --> form
  form --> wardQ
  wardQ -- "いいえ" --> error --> form
  wardQ -- "はい" --> planned --> wait
  wait -- "まだ" --> cancelQ
  cancelQ -- "はい" --> cancelPlan --> cancelled
  cancelQ -- "いいえ" --> wait
  wait -- "来た" --> exec
  exec -- "一覧" --> fromList --> execForm
  exec -- "マップ" --> fromMap --> execForm
  execForm --> bedQ
  bedQ -- "いいえ" --> error
  bedQ -- "はい" --> dupQ
  dupQ -- "はい" --> confirm --> admitted
  dupQ -- "いいえ" --> admitted
  open -. "予定を立てずに<br/>すぐ入院" .-> direct --> bedQ
```

- 入院予定は日付が決まっていなくても登録でき、そのまま入院実施できます。「日付を確定してから実施」という段階はありません。
- 救急の転帰で「入院」を確定すると、そのまま入院予定の入力に進みます。病棟・ベッドは救急では決めず、入院予定から入院実施の流れに乗せます。救急車で来た患者は入院経路に搬送が引き継がれます。
- 入院実施は予定日ではなく今日の日時が既定です。予定のベッドが埋まっていれば、その病棟の空床から選び直します。
- 入院予定取消と入院取消は別の操作です。予定がなくなったのは誤りではないので「取消」、入院を誤って登録したのは「入院取消」です。
- ベッドスケジュールでは、退院前の患者と入院予定が同じベッドに重なると段を分けて積みます。床を決めるときに重なりを見ます。

### 入院時に書くもの

入院すると、入退院文書(`/admission-documents`)にその入院の行ができ、期限つきで作成状況が出ます。期限・テンプレートは施設設定「文書作成の督促」で決め、テンプレートが未設定の文書は列を出しません。

| 文書 | 期限の既定 | 書く人の目安 | 対象 |
|---|---|---|---|
| 褥瘡リスク評価 | 入院日 + 1 日 | 看護師(看護プロファイルの区画) | 全員 |
| 栄養スクリーニング | 入院日 + 3 日 | 看護師・管理栄養士 | 全員 |
| 入院診療計画書 | 入院日 + 7 日 | 主治医 | 全員 |
| 栄養管理計画書 | 入院日 + 7 日 | 管理栄養士 | スクリーニングか計画書で「特別な栄養管理」が有の入院 |
| 褥瘡対策計画書 | 入院日 + 7 日 | 看護師 | 褥瘡リスク評価で計画が要ると判定された入院 |

- セルを押すとカルテを開き、未作成なら右ペインでその入院の登録を始めます。期限を過ぎて作成済でないものは赤です。
- 計画書は再評価の時期を過ぎて在院していると「再評価」が出ます。
- このほか、持参薬(カルテの「持参薬」タブ。登録すると薬剤部に鑑別依頼が届く)、看護プロファイル、看護計画、クリニカルパスの適用が入院時の仕事です。

### 入院中の移動

```mermaid
flowchart TD
  course(("入院中"))
  what{"何が変わる?"}
  bedMove["転室・転床<br/>移動日と移動先の空床"]
  mapMove["病棟マップでカードを掴んで<br/>空床・別の患者の床へ運ぶ<br/>(占有床なら入れ替え)"]
  pending["「保留中の移動」に積む<br/>一時退避に置けば床を空けられる"]
  commitQ{"退避中の患者が残っていない?<br/>他の端末で変わっていない?"}
  commit["「転床確定」<br/>全件をまとめて書く"]
  fix["移動を直す"]
  tplan["転科・転棟予定<br/>予定日・移動先の病棟(必須)<br/>病室・ベッド・診療科"]
  texec["転科・転棟の実施<br/>移動日と空床(予定の病棟の中から)<br/>診療科も移せる"]
  wardQ{"病棟が変わった?"}
  dpc["主治医に<br/>DPC 再判定の督促"]
  staff["担当者変更<br/>主治医・担当看護師を差し替える"]
  undo["移動取消<br/>直前の 1 回を取り消し、前の床と科に戻す"]
  done((("移った")))

  course --> what
  what -- "同じ病棟で床を変える" --> bedMove --> done
  what -- "病棟でまとめて組み替える" --> mapMove --> pending --> commitQ
  commitQ -- "いいえ" --> fix --> pending
  commitQ -- "はい" --> commit --> done
  what -- "別の病棟・別の科へ" --> tplan --> texec --> wardQ
  wardQ -- "はい" --> dpc --> done
  wardQ -- "いいえ" --> done
  what -- "担当が変わる" --> staff --> course
  done -. "誤って移した" .-> undo --> course
```

- 移った記録は消えず、「いつまでどの床に居たか」が入院に積み上がります。ベッドスケジュールでは床ごとに帯が分かれます。
- 転科・転棟予定は、ベッドまで決まっていればベッドスケジュールに「転予」の点線で出ます。予定の取消は転科・転棟タブの行のメニューからです。
- 転科・転棟の実施では、予定の床が埋まっていることがあるので、実施の時点で空いている床から選び直します。
- DPC 再判定の督促は、病棟が変わったときだけ、その入院に未対応の督促が無ければ出ます。転棟時の決定を保存すると閉じます。
- 移動取消は直前の 1 回ずつです。移動前の床に別の患者が入っていれば確認で知らせますが止めません。その転棟で出した DPC 再判定の督促も取り下げます。
- オーダーに残る入院病棟は登録した時点のものです。転棟しても前に出したオーダーの病棟は書き換わりません(看護指示は前の病棟の指示簿に出続けます)。

### 外出泊

```mermaid
flowchart TD
  start(("外出・外泊する"))
  form["外出泊を登録<br/>開始日時(必須)・帰院予定日時・理由"]
  check{"開始日時がある?<br/>帰院予定が開始より後?"}
  error["入力エラーを表示"]
  meal{"「食事を止める」に<br/>チェックしたまま?"}
  stop["出発までの最後の食事で止め<br/>帰院までは外泊食止め<br/>帰院予定があれば再開まで用意"]
  saved["外出泊中<br/>病棟マップのカードに札、外出泊タブに並ぶ"]
  back{"帰院した?"}
  ret["帰院<br/>帰院日時を入れる"]
  resume["帰院後の最初の食事から<br/>元の食事に戻す"]
  cancel["外出泊取消<br/>(誤って登録した・取りやめた)"]
  restore["止めた食事を元に戻す"]
  done((("帰院済み")))
  gone((("なかったことになる")))

  start --> form --> check
  check -- "いいえ" --> error --> form
  check -- "はい" --> meal
  meal -- "はい" --> stop --> saved
  meal -- "いいえ" --> saved
  saved --> back
  back -- "はい" --> ret --> resume --> done
  back -- "取りやめ" --> cancel --> restore --> gone
```

- 1 回の入院に何度でも外出泊を登録できます。登録済みの外出泊は登録画面に並び、間違えたものを外せます。
- 止める食事・戻す食事は手で選ばず、施設設定の食事の提供時刻と出発・帰院の時刻から決まります。登録の画面で、止める食事と再開する食事を確かめられます。
- 外出泊の期間を後から直す操作はありません。取り消して登録し直すと、食事も戻ってから掛かり直ります。
- 外出泊中でも看護指示・リハビリなどは自動では止まりません。

### 退院予定と退院

```mermaid
flowchart TD
  course(("入院中"))
  planQ{"退院の日が決まった?"}
  dplan["退院予定を登録<br/>退院予定日時・理由"]
  planMeal["退院予定の時刻までに出る<br/>最後の食事で食事を止める<br/>(退院食止め)"]
  planned["退院予定タブ・病棟マップの札<br/>ベッドスケジュールの帯が予定日で止まる"]
  change{"予定が変わった?"}
  replan["登録し直す(止めた食事も立て直す)<br/>取りやめなら退院予定取消(食事が戻る)"]
  dday(("退院の日"))
  modal["退院<br/>退院日時(既定は今)・転帰(退院先)"]
  dateQ{"退院日が入院日より前?"}
  error["入力エラーを表示"]
  stops["一緒に止めるものを確かめる(既定はすべてチェック)<br/>食事: 退院時刻までの最後の食事まで<br/>看護指示・リハビリ・栄養指導・服薬指導: 退院日で終了<br/>リハビリ・栄養指導の翌日以降の予約は取消<br/>持参薬: 継続中・休止中を終了、鑑別依頼を取り下げ"]
  due["主治医に退院時サマリーの督促<br/>(確定済みのサマリーがあれば作らない)"]
  done((("退院")))

  course --> planQ
  planQ -- "はい" --> dplan --> planMeal --> planned --> change
  change -- "はい" --> replan --> planned
  change -- "いいえ" --> dday
  planQ -- "当日に決まった" --> dday
  dday --> modal --> dateQ
  dateQ -- "はい" --> error --> modal
  dateQ -- "いいえ" --> stops --> due --> done
```

- 退院予定だけでも食事は止まります(退院食止め)。予定のまま退院すると、止めた理由が「退院」に置き換わります。
- 退院で止めるものは、退院の記録と同じ 1 回の書き込みで書きます。退院だけ通ってオーダーが残ることはありません。チェックを外したものは止まりません。
- 看護指示は退院日を終了日にするだけで、指示受けの状態は動きません。リハビリ・栄養指導の進捗(部門の「終了」)も部門が締めます。
- 転帰は退院の画面でも退院時サマリーでも書けます。
- 退院してもクリニカルパスは自動では終わりません。パスタブで終了・中止を記録します。
- 退院するとそのベッドはすぐ空床として選べるようになり、同じ日の入院予定を入れられます。

### 退院後に書くもの

| 文書 | 期限の既定 | 書く人 | 督促・確認 |
|---|---|---|---|
| 退院時サマリー | 退院日 + 14 日(施設設定) | 主治医 | 退院で通知「文書作成」が主治医に届く。確定で保存すると閉じる。入院中から書き始められる |
| 看護サマリー(区分「退院」) | 退院日 + 7 日 | 担当看護師 | 入退院文書の列。病棟の「看護サマリー承認」で承認する |
| DPC の決定(退院時) | – | 主治医・医事 | 「診断群分類」タブで判定・決定。DPC 患者一覧で未決定・期間Ⅱ超えを見る |
| DPC 様式 1 | – | 医事 | 入院の情報と退院時サマリーなどから初期値を集める |

- 退院時サマリーは入院期間のプロブレム・入院経過(入院・転棟・転床・外泊・退院と手術)・手術処置・退院時処方・アレルギーを初期値に集めます。
- 入退院文書では、退院系の文書は退院するまで「退院後」と出し、書き始めていれば状態を出します。
- 退院時サマリーが不要な入院は、通知一覧の「対応済」で督促を閉じます。

### 取消

| 取消 | どこから | 何が戻るか |
|---|---|---|
| 入院予定取消 | 入院予定タブの行のメニュー | 予定がなくなる。誤りではないので記録は「取消」として残る |
| 入院取消 | 入院患者タブの行のメニュー | 誤登録として扱い、どの一覧にも出なくなる。その入院の DPC 再判定の督促を取り下げる |
| 移動取消 | 入院患者タブの行のメニュー(一度でも移った入院) | 直前の 1 回の移動を取り消し、前の床と診療科に戻す。その転棟の DPC 再判定の督促を取り下げる |
| 転科・転棟予定取消 | 転科・転棟タブの行のメニュー | 予定のメモを外す |
| 外出泊取消 | 外出泊タブの行のメニュー・外出泊の登録画面 | 外出泊を外し、止めた食事を元に戻す(食止め・再開のオーダーは消える) |
| 退院予定取消 | 退院予定タブの行のメニュー | 予定のメモを外し、退院食止めを元に戻す |
| 退院取消 | 退院患者タブの行のメニュー | 入院中に戻し、退院で止めた食事を戻し、退院時サマリーの督促を取り下げる。退院した床に別の患者が入っていれば確認で知らせる |

- 退院取消で戻るのは入院と食事だけです。看護指示・リハビリ・栄養指導・服薬指導に入れた終了日と、取り消した予約、終了にした持参薬は戻りません。続けるものは出し直します。
- 退院のときに消えた退院予定も戻りません。必要なら立て直します。
- 取消はどれも確認だけで、理由は残しません。

### ほかの画面とのつながり

| 画面 | 入院の使い方 |
|---|---|
| 入院患者一覧(`/inpatients`) | 病棟と日付で、その日の床と患者。タブは入院予定・入院患者・転科転棟・外出泊・退院予定・退院患者。パス・DPC・NEWS2 の列、指示受けの札、経過表一括入力 |
| 病棟マップ(`/ward-map`) | 間取りの上の患者カード(退院予定・転棟予定・外出泊中の札)、転床のまとめ確定、本日の入院予定を空床へ |
| ベッドスケジュール(`/bed-schedule`) | ベッド × 日付の帯。実績は塗り、予定(入予・転予)は点線、ベッド未定の予定は最下段 |
| 病床状況(`/bed-status`) | 病棟ごとの在院・稼働率・空床・当日の入退院と転出入・翌日の予定・病床利用率・平均在院日数 |
| 入退院文書(`/admission-documents`) | 入院時・退院時の文書の作成状況と期限 |
| カルテ | 患者ヘッダに入院中の病棟・入院日数。退院時サマリー・看護サマリー・持参薬・DPC のタブ。オーダーの入外区分の初期値 |
| 看護の画面 | 指示簿・ワークシート・看護必要度・看護サマリー承認は病棟の入院患者で組む |
| 給食部門の食事一覧 | 入院のいまのベッドで病棟を決める。転棟した患者はいまの病棟に出る |
| マルチチャート | 入院を期間のバー、転棟・外出泊を印で出す |
| データ抽出 | 「入院・外来」タブで入院 1 件 1 行 |

## 開発者向け

### リソースの構成

| もの | リソース | 要点 |
|---|---|---|
| 入院 | `Encounter`(`class` = v3-ActCode `IMP`) | `status` = `planned` / `in-progress` / `finished` / `cancelled` / `entered-in-error`、`period.start` = 入院(予定)日、`period.end` = 退院日、`serviceProvider` = 診療科、`participant` = 主治医(`ATND`)と担当看護師(`encounter-participant-role\|nurse`)、`hospitalization.dischargeDisposition` = 転帰、拡張 `encounter-note`(特記事項) |
| 入院予定の居場所 | `Encounter.location`(`status` = `planned`) | 病棟(必須)・病室・ベッドを `physicalType`(`wa` / `ro` / `bd`)付きで並べる。参照先を引かずに階層が分かる |
| 入院中の居場所 | `Encounter.location` | `location[0]` = いまのベッド(`active`)。移動すると先頭に足し、前の床は `completed` + `period.end` で後ろに残す。科も変えた移動は移動先に拡張 `encounter-location-prior-department` |
| 入院経路 | `Encounter.hospitalization.admitSource` と拡張 | 入院経路・予定/救急の区分は `admitSource` に `dpc-admission-route` / `dpc-admission-type` のローカル体系、紹介の有無・外来からの入院などは拡張(`admissionRouteHelpers.ts`)。救急からは搬送を引き継ぐ。DPC 様式 1 の初期値になる |
| 転科・転棟予定 | 拡張 `encounter-transfer-plan` | 子 `date` / `ward` / `room` / `bed` / `department`。1 件だけ |
| 外出泊 | 拡張 `encounter-leave`(複数) | 子 `id`(uuid)/ `start` / `end`(帰院前は予定、帰院後は実際)/ `reason` / `returned` |
| 退院予定 | 拡張 `encounter-discharge-plan` | 子 `date`(dateTime)/ `reason`。1 件だけ |
| ベッド | `Location`(病棟 `wa` → 病室 `ro` → ベッド `bd`、`partOf`) | ベッド数は配下のベッドの件数。休止は `status` |
| 入院時・退院時の文書 | `QuestionnaireResponse`(`encounter` = 入院)、`Composition`(退院時サマリー LOINC `18842-5`、看護サマリー) | 入退院文書は回答の `encounter`、無ければ記入日で当てる |
| 督促 | `Task`(`document-due`・`dpc-recoding-due`) | `focus` / `encounter` = 入院、`owner` = 主治医。退院時サマリーは `restriction.period.end` = 期限 |
| 連動で止めるオーダー | 各種別の `ServiceRequest` | 食事は `meal-order-end-reason`(`discharge-plan` / `discharge` / `leave`)と `previousEnd` で戻せる形、看護指示は `nursing-order-end`、リハビリ・栄養指導・服薬指導は各種別の終了日 |
| 持参薬 | `MedicationStatement`(`context` = 入院)+ `Task`(`brought-med-review`) | 退院で `completed`、鑑別依頼は `cancelled` |

- 入院予定の日付未定は `period` を付けません。上流の `_sort=date` は期間の無いものを末尾に置くので、画面で先頭に並べ替えます(`sortPlannedAdmissions`)。
- 予定のメモを R4 の要素に載せず拡張にしているのは、`Encounter` に置き場が無いためです。外出泊の `id` は SS-MIX2 と食事の連動が外出泊ごとに突き合わせるのに使います。
- 院内の入院は病棟で絞らずに全部読み、ベッド id で突き合わせます(`fetchInpatients`。`status=in-progress,finished&class=IMP`、日付は `date=ge{日}&date=le{日}` の重なり)。入院予定は日付で絞れないので全件です(`fetchPlannedAdmissions`)。

### 状態の持ち方

| 表示 | `Encounter.status` | `period` | `location[0]` |
|---|---|---|---|
| 入院予定 | `planned` | `start` = 予定日(未定なら無し) | 病棟・病室・ベッドが `planned` |
| 入院中 | `in-progress` | `start` = 入院日時 | ベッドが `active` |
| 退院 | `finished` | `end` = 退院日時 | ベッドが `completed` |
| 入院予定取消 | `cancelled` | そのまま | そのまま |
| 入院取消 | `entered-in-error` | `end` を付けない | そのまま |

- 退院取消は `in-progress` に戻し、`period.end` を消し、`location[0]` を `active` に戻します(`buildDischargeCancelledEncounter`)。退院で落とした退院予定の拡張は戻しません。
- 同じベッドに入院中が複数あれば、入院日(同日なら更新時刻)の新しいものを表示します(`latestEncounterByBed`)。二重入院は確認だけで止めません。
- 楽観ロック: 入院の書き換えはどれも `postBundle` が版を `ifMatch` に添えるので、2 台で同じ入院を操作すると後の方が 412 で止まります。病棟マップの転床確定は、直前に入院を引き直して他端末の変更が無いことも確かめます(`findStaleMoves`)。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。入院の書き換えに連動の entry(食事・看護指示・リハビリ・督促 Task など)を足すときも同じ transaction に載せます。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録し(`Ssmix2::Recorder`)、`Encounter` の前後の版を比べて ADT のメッセージを組みます。

| 部品 | 場所 |
|---|---|
| 画面 | `pages/InpatientListPage.tsx`(6 タブ)、`components/InpatientPlanTables.tsx`(転科転棟・外出泊・退院予定・退院患者の表と取消)、`pages/WardMapPage.tsx`、`pages/BedSchedulePage.tsx`、`pages/BedStatusPage.tsx`、`pages/AdmissionDocumentsPage.tsx` |
| モーダル | 入院予定 `PlannedAdmissionForm.tsx`(`PlannedAdmissionModal` / 右ペイン `planned-admission-create` / 救急 `EmergencyRowModals.tsx`)、入院実施 `AdmissionExecuteModal.tsx`、予定なしの入院 `AdmissionModal.tsx`、転室・転床 `BedTransferModal.tsx`、転科転棟 `TransferPlanModal.tsx`・`TransferExecuteModal.tsx`、外出泊 `LeaveModal.tsx`・`LeaveReturnModal.tsx`、退院予定 `DischargePlanModal.tsx`、退院 `DischargeModal.tsx` |
| 組み立て | `fhir/encounterHelpers.ts`(入院・予定・移動・外出泊・予定のメモ・退院・取消)、`fhir/bedMovePlanHelpers.ts`(病棟マップの移動プラン)、`fhir/admissionRouteHelpers.ts`、`fhir/mealEncounterSync.ts`(食事の連動)、`fhir/dpcRecodingDueHelpers.ts`、`fhir/dischargeSummaryHelpers.ts`、`fhir/bedScheduleHelpers.ts`、`fhir/admissionDocumentHelpers.ts` |
| hook | `api/queries/encounter.ts`(`useInpatientEncounters` / `usePlannedAdmissions` / `useAdmitPatient` / `useUpdateEncounter` / `useCommitBedMoves` / `useDischargePatient` / `useCancelAdmission` / `useCancelTransfer` / `usePatientAdmission`)、`api/queries/bedManagement.ts`(`useEncountersInRange` / `useAdmissionDocumentResources`)、`hooks/useMealSyncContext.ts` |

### シーケンス図: 入院予定・入院実施・入院取消

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師・病棟
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 入院予定の登録
    Dr->>UI: 病棟・病室・ベッド・予定日・診療科・主治医・入院経路
    UI->>UI: validatePlannedAdmissionForm(病棟だけ必須)
    UI->>BE: POST /fhir/Encounter(status=planned、location は physicalType 付きで planned)
    BE->>FHIR: POST
    FHIR-->>UI: 結果(入院予定タブ・ベッドスケジュールを読み直す)
  else 入院実施(予定から)
    UI->>BE: GET /fhir(Encounter?status=planned&class=IMP&_sort=date&_include=Encounter:subject)
    BE->>FHIR: 検索(全ページ)
    FHIR-->>UI: 入院予定
    Dr->>UI: 空床・入院日時を選んで「入院実施」
    UI->>UI: validateAdmissionForm、別の床に入院中なら確認
    UI->>BE: POST /fhir(transaction。PUT Encounter in-progress、location = ベッド 1 件 active、ifMatch)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 予定なしの入院登録
    Dr->>UI: 空床の「患者選択」→ 患者・診療科・主治医・入院日時
    UI->>BE: POST /fhir/Encounter(status=in-progress)
    BE->>FHIR: POST
    FHIR-->>UI: 結果
  else 入院予定取消・入院取消
    UI->>BE: POST /fhir(transaction。PUT Encounter cancelled / entered-in-error)
    Note over UI,BE: 入院取消は DPC 再判定の督促 Task を cancelled にする entry を足す
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 転室・転床・転科転棟・移動取消

`buildBedTransferEncounter` / `buildTransferPlanEncounter` / `buildTransferExecutedEncounter` / `buildTransferCancelledEncounter`、病棟マップは `buildMovePlanBundle`(`useCommitBedMoves`)。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 転室・転床(1 人)
    Ns->>UI: 移動日と空床
    UI->>BE: POST /fhir(transaction。PUT Encounter: 先頭に新しい床 active、前の床 completed + period.end)
  else 病棟マップの転床確定
    Ns->>UI: 保留中の移動を積んで「転床確定」(転床日)
    UI->>BE: GET /fhir(Encounter 入院中を引き直す)
    BE->>FHIR: 検索
    FHIR-->>UI: 最新の入院(findStaleMoves で他端末の変更を確かめる)
    UI->>BE: POST /fhir(transaction。動かした入院ごとに PUT Encounter)
  else 転科・転棟予定
    Ns->>UI: 予定日・移動先の病棟・病室・ベッド・診療科
    UI->>BE: POST /fhir(transaction。PUT Encounter 拡張 encounter-transfer-plan)
  else 転科・転棟の実施
    Ns->>UI: 移動日と空床(予定の病棟から)、診療科
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter(床を移す、科が変われば serviceProvider と prior-department、予定の拡張を外す)<br/>病棟が変わり未対応の督促が無ければ POST Task dpc-recoding-due(owner = 主治医)
  else 移動取消
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter(先頭の床を外し前の床を active、prior-department があれば科を戻す)<br/>その移動日の dpc-recoding-due を cancelled
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(版違いは 412。入院患者一覧・マップ・スケジュールを読み直す)
```

### シーケンス図: 外出泊・帰院・退院予定

食事の連動は `useMealSyncContext`(入院の食事オーダーと施設の食事の提供時刻)から `mealEncounterSync.ts` が entry を組みます。詳細は[食事のシーケンス図](meal.md#シーケンス図-入退院外出泊の連動)。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟・医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(ServiceRequest?subject=患者&category=order-type|meal&status=active、食止めの食種マスタ)
  BE->>FHIR: 検索
  FHIR-->>UI: 食事オーダー(止める・戻す食事の見込みを画面に出す)
  alt 外出泊の登録
    Ns->>UI: 開始日時・帰院予定・理由
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter(encounter-leave を足す、id を採番)<br/>buildLeaveStartEntries: 出発までで食事を終える PUT、外泊食止め・再開の POST
  else 帰院
    Ns->>UI: 帰院日時
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter(returned = true、end = 帰院日時)<br/>buildLeaveReturnEntries: 外泊食止めを帰院の直前で終え、再開を POST / PUT
  else 外出泊取消
    UI->>BE: POST /fhir(transaction。PUT Encounter で外出泊を外す、buildLeaveCancelEntries で食止め・再開を DELETE し終了を戻す)
  else 退院予定・取消
    Ns->>UI: 退院予定日時・理由(または取消)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter(encounter-discharge-plan を付ける / 外す)<br/>登録: buildDischargeSyncEntries(reason = discharge-plan、previousEnd を残す)<br/>取消: buildDischargeRestoreEntries(["discharge-plan"])
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(Encounter と ServiceRequest を読み直す)
```

### シーケンス図: 退院・退院取消

`DischargeModal`、`useDischargePatient`、退院取消は `InpatientPlanTables` の `handleCancel`。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟・医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 退院
    par 止めるものを読む
      UI->>BE: GET /fhir(食事・リハビリ・栄養指導・服薬指導・看護指示の ServiceRequest、持参薬 MedicationStatement と鑑別依頼 Task)
      BE->>FHIR: 検索
      FHIR-->>UI: 退院日より後まで続くもの(…NeedsStop で選ぶ)
    and 督促の要否
      UI->>BE: GET /fhir(Composition?type=…|18842-5&encounter=入院、Task?code=document-due&encounter=入院)
      BE->>FHIR: 検索
      FHIR-->>UI: 確定済みのサマリーと未対応の督促の有無
    end
    Ns->>UI: 退院日時・転帰、止めるもののチェック
    UI->>UI: validateDischargeDate(入院日より前は不可)
    UI->>BE: GET /fhir(Appointment。打ち切るリハビリ・栄養指導の翌日以降の予約)
    BE->>FHIR: 検索
    FHIR-->>UI: 取り消す予約
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter finished、period.end、location[0] completed、dischargeDisposition、退院予定の拡張を外す<br/>食事: 退院時刻までの最後の食事で終了(reason = discharge)<br/>リハビリ・栄養指導・服薬指導・看護指示: 退院日で終了、予約を cancelled<br/>持参薬 completed、鑑別依頼 cancelled<br/>POST Task document-due(owner = 主治医、期限 = 退院日 + N 日)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(Encounter・ServiceRequest・Task・MedicationStatement・予約を読み直す)
  else 退院取消
    UI->>BE: GET /fhir(食事オーダー、Task?code=document-due&encounter=入院)
    BE->>FHIR: 検索
    FHIR-->>UI: 戻す食事と取り下げる督促
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT Encounter in-progress(period.end を消し location[0] active)<br/>buildDischargeRestoreEntries(["discharge", "discharge-plan"])、document-due を cancelled
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### 医事会計と SS-MIX2

入院の出来事は医事会計に送りません(会計送信の入口は外来一覧だけです)。入院中のオーダーの扱いは各種別の文書を読みます。
SS-MIX2 は `Encounter` の書き込みごとに前の版と比べて ADT を組みます。オーダ No は事象ごとに採番し、取消は同じ番号の DEL です。

| 起きたこと | 医事会計 | SS-MIX2 |
|---|---|---|
| 入院予定の登録・変更 | なし | `ADT^A14`(ADT-21、PV2-8 入院予定日。未定は `-`) |
| 入院予定取消 | なし | `ADT^A27`(ADT-21、DEL) |
| 入院実施・予定なしの入院登録 | なし | `ADT^A01`(ADT-22。予定からの実施も A01) |
| 入院取消 | なし | `ADT^A11`(ADT-22、DEL) |
| 転室・転床・転科転棟の実施、床を移さない転科 | なし | `ADT^A02`(ADT-42) |
| 移動取消 | なし | `ADT^A12`(ADT-42、DEL) |
| 転科・転棟予定の登録・変更 / 取消 | なし | `ADT^A15` / `ADT^A26`(ADT-41)。実施で消えたときは出さない |
| 担当者変更(主治医) | なし | `ADT^A54`(新しい主治医)/ `ADT^A55`(外れた主治医)(ADT-01) |
| 外出泊の登録・変更 / 取消 | なし | `ADT^A21` / `ADT^A52`(ADT-31) |
| 帰院 / 帰院の取り消し | なし | `ADT^A22` / `ADT^A53`(ADT-32) |
| 退院予定の登録・変更 / 取消 | なし | `ADT^A16` / `ADT^A25`(ADT-51)。退院で消えたときは出さない |
| 退院 | なし | `ADT^A03`(ADT-52、PV1-45 退院日) |
| 退院取消 | なし | `ADT^A13`(ADT-52、DEL) |
| 連動で止めた・戻した食事 | なし | 書き換えた食事オーダーごとに `OMD^O03` |
| 連動で止めた看護指示・リハビリ・栄養指導・服薬指導 | なし | なし |
| 退院時サマリー・看護サマリー・入退院文書・督促 | なし | なし |
