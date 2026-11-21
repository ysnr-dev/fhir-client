# 栄養指導・服薬指導の業務フロー

管理栄養士への栄養食事指導の依頼(栄養指導)と、薬剤師への服薬指導の依頼(服薬指導)を、登録から部門の受付・指導の積み上げ・終了(退院での打ち切り)まで追う流れです。
2 つともリハビリと同じ**期間継続型**のオーダーです。1 つの依頼が数週間〜数か月続き、その間に指導の記録が何度も積み上がります。予約の取り方はリハビリと同じなので、先に [rehab.md](rehab.md) を読むと分かりやすくなります。リハビリとの違いは、流れを書いた後ろの「リハビリとの違い」にまとめます。

医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
設計は [nutrition-guidance-order-design.md](../nutrition-guidance-order-design.md)(栄養指導)・[medication-guidance-order-design.md](../medication-guidance-order-design.md)(服薬指導)、
画面のふるまいは [features/medication.md](../features/medication.md)「服薬指導」、指導記録のテンプレートは [report-mappings/nutrition-guidance-record-01.md](../report-mappings/nutrition-guidance-record-01.md)、
種別共通の約束(中止・削除・代行入力・オーダーセット)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。

## 運用フロー

### 全体の流れ(栄養指導)

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["主治医"]
    order["栄養指導オーダーを登録<br/>→「登録の判定」"]
    edit["オーダーを編集して<br/>期間を延ばす"]
  end

  subgraph dept["栄養部門(管理栄養士)"]
    accept["「受付」を押す<br/>(状態が実施中になる)"]
    book["「次回予約」で<br/>栄養相談室の枠を選ぶ"]
    day["予約の日に指導し<br/>実施を記録する"]
    more{"指導を続ける?"}
    close["「終了」を押し<br/>終了日を入れる"]
  end

  subgraph ward["病棟"]
    discharge["退院の画面で<br/>栄養指導を退院日で終える"]
  end

  start --> order --> accept --> book --> day --> more
  more -- "はい" --> book
  more -- "はい(期間が足りない)" --> edit --> book
  more -- "いいえ" --> close --> finish
  day -. "入院中の患者が退院する" .-> discharge --> finish
```

- 初回はおおむね 30 分以上、2 回目以降はおおむね 20 分以上という算定の目安があります。初回と継続 2〜3 回で終わるのが典型です。
- 予約を取らずに指導した日(ベッドサイドでの指導など)は、栄養指導一覧の「依頼」ビューから実施を記録します。

### 全体の流れ(服薬指導)

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["主治医"]
    order["服薬指導オーダーを登録<br/>→「登録の判定」"]
    dc_order["退院時指導のオーダーを登録"]
  end

  subgraph pharm["薬剤部(薬剤師)"]
    accept["「受付」を押す<br/>(状態が実施中になる)"]
    assign["受け持ちの薬剤師を決める"]
    day["病棟で指導し<br/>実施を記録する(週ごと)"]
    dc{"退院が決まった?"}
    more{"指導を続ける?"}
    dc_accept["退院時指導を受付"]
    dc_day["退院時指導を記録する"]
    close["「終了」を押し<br/>終了日を入れる"]
  end

  subgraph ward["病棟"]
    discharge["退院の画面で<br/>服薬指導を退院日で終える"]
  end

  start --> order --> accept --> assign --> day --> dc
  dc -- "はい" --> dc_order --> dc_accept --> dc_day --> discharge --> finish
  dc -- "いいえ" --> more
  more -- "はい" --> day
  more -- "いいえ" --> close --> finish
```

- **2 つのオーダー**: 入院中の指導(指導区分「服薬指導」)と退院時の指導(指導区分「退院時指導」)は、別のオーダーにします。退院時指導のオーダーでは、実施の指導種別が「退院時指導」だけになるためです。
- **退院のとき**: 退院の画面で、入院中の指導のオーダーも退院時指導のオーダーも、退院日で終えられます。
- **受け持ちの薬剤師**: 受付の前でも決められます。状態は依頼済のままで、受け持ちだけが付きます。終了・中止・取消をしても、受け持ちは外れません。
- **受け持ちの漏れ**: 服薬指導一覧は、受け持ち(自分 / 未定)で絞れます。ホームの「服薬指導」カードには、受け持ちが未定の件数が出ます。

この文書で使う呼び名は次のとおりです。

| 呼び名 | 指すもの |
|---|---|
| 部門の一覧 | 「部門業務 > 栄養部門 > 栄養指導一覧」と「部門業務 > 薬剤部門 > 服薬指導一覧」 |
| 行のメニュー | 部門の一覧の行の「︙」から開くメニュー |
| 状態 | 部門の進み具合(依頼済・実施中・終了・中止) |
| 状態の「終了」 | 部門が「終了」を押して期間を打ち切った状態。オーダーの終了日とは別 |
| 終了日 | オーダーの期間の終わりの日 |
| 受け持ちの薬剤師 | 服薬指導一覧の「担当薬剤師」。行のメニューの「担当」で決める |
| 指導した薬剤師 | 実施の入力の「担当薬剤師」。その回に指導した人 |
| 依頼医 | オーダーを指示した医師 |

- **入口**: カルテの右ペイン(右側のオーダー入力)の「栄養指導」「服薬指導」です。部門の一覧から代わりに登録する入口はありません。
- **クリニカルパス**: タスク分類は、栄養指導が「栄養指導」、服薬指導が「服薬指導」です。
- **オーダーセット**: オーダーセットにも入れられます。開始日・終了日・対象プロブレムは、セットには入りません。

### 進捗の状態

| 状態 | 意味 | 変わるきっかけ | 部門の一覧の行からできること |
|---|---|---|---|
| 依頼済 | 部門がまだ受けていない | 医師の登録、「受付取消」、「中止取消」 | 「受付」、「中止」 |
| 実施中 | 部門が受けた。期間中はずっとこの状態 | 「受付」、「終了取消」 | 「実施」、「次回予約」(栄養指導)、「終了」、「受付取消」、「中止」 |
| 終了 | 部門が期間を打ち切った | 「終了」 | 「終了取消」 |
| 中止 | 指導を取りやめた | 「中止」 | 「中止取消」 |

- **状態を変える場所**: 状態を変えるのは、部門の一覧だけです。実施を記録しても、状態は実施中のままです。
- **行に直接出るボタン**: 「受付」「実施」「次回予約」(栄養指導)「表示」です。「終了」・各取消・「中止」は、行のメニューにあります。
- **服薬指導の「担当」**: 行のメニューにあり、依頼済・実施中・終了の行で使えます。
- **クリニカルパスからの実施**: 依頼済のオーダーをパスの画面から実施すると、同時に実施中になります。
- **退院**: 退院で終えたオーダーは、終了日が付くだけで、状態は「終了」になりません。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  check{"入力はそろっている?"}
  error["入力エラーを表示<br/>該当の項目に印を付ける"]
  fix["入力を直す"]
  send["オーダーを保存"]
  result{"保存できた?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は依頼医本人?"}
  approval["依頼医に承認待ちの通知"]
  done((("登録完了")))

  submit --> check
  check -- "いいえ" --> error --> fix --> submit
  check -- "はい" --> send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
```

登録のときに確かめる項目は次のとおりです。

| 項目 | 栄養指導 | 服薬指導 |
|---|---|---|
| 指導形態 | 必須 | 項目なし |
| 指導区分 | 項目なし | 必須 |
| 対象疾患名 | 必須 | 項目なし |
| 開始日 | 必須 | 必須 |
| 終了日 | 空か、開始日以降 | 空か、開始日以降 |

開始日は、オーダーセット・クリニカルパスの内容として作るときは不要です。

栄養指導で入力する項目は次のとおりです。

- 指導形態(個別指導 / 集団指導)。初期値は「個別指導」
- 期間(開始日・終了日)
- 対象疾患名
- 指示食種
- 指導目的
- 栄養部門への指示
- 対象プロブレム

服薬指導で入力する項目は次のとおりです。

- 指導区分(服薬指導 / 退院時指導)。初期値は「服薬指導」
- 指導条件(複数選べる)
- 期間(開始日・終了日)
- 対象薬剤
- 指導してほしいこと
- 薬剤部への連絡事項
- 対象プロブレム

**栄養指導**

- 対象疾患名は、特別食加算の算定要件なので必須です。登録病名から選んで写すこともできます。写した後に手で書き換えると、病名とのつながりは外れます。
- 指示食種は任意で、食事オーダーと同じ食種マスタから選びます。
- 入院中で食事が出ていれば、いまの食種が横に出て、「指示食種へ複写」で写せます。違う食種を指導することもあるので、自動では入りません。

**服薬指導**

- 指導条件は、「ハイリスク薬」「麻薬」「吸入・自己注射の手技」「多剤併用」「服薬状況の確認」「嚥下・剤形の相談」「家族への指導」から選びます。
- 「ハイリスク薬」を付けると、実施の指導種別の初期値が「服薬指導(ハイリスク薬)」になります。

**共通**

- 入外区分の初期値は、入院中なら「入院」です。
- 承認待ちのあいだも、オーダーは部門の一覧に出ます。

### 予約(栄養指導)

栄養指導の予約は、栄養部門がオーダーを受付した後に、行の「次回予約」でそのつど取ります。オーダーの登録のときには取りません。「日時変更」「予約取消」は、栄養指導一覧の「予約」ビューとカルテの予約タブからできます。
取り方はリハビリと同じです。詳しくは [rehab.md](rehab.md)「予約」にあります。リハビリと違うのは次の点です。

- **枠**: 「栄養指導予約」の枠表から選びます。場所は栄養相談室などです。
- **枠の準備**: 枠表は、設定する人が管理画面の「予約枠」で作ります。
- **定員**: 集団指導では 1 枠に複数の患者が入るので、枠の定員は 1 に固定されません。
- **カルテの予約タブ**: 「栄養指導」の印が付きます。

服薬指導には予約がありません。指導する日は、受け持ちの薬剤師が病棟の都合で決めます。

### 日々の実施

栄養指導です。

```mermaid
flowchart TD
  open(("基準日を選んで<br/>栄養指導一覧を開く"))
  view{"予約のある指導?"}
  appt["「予約」ビュー<br/>その日の予約が時刻順に並ぶ"]
  orders["「依頼」ビュー"]
  accepted{"状態は実施中?"}
  wait["先に「受付」を押す"]
  perform["「実施」を押して入力"]
  check{"入力はそろっている?"}
  error["入力エラーを表示"]
  save["登録<br/>「本日」の列に出る"]
  next["次回予約を取る(任意)"]
  done((("記録完了")))

  open --> view
  view -- "はい" --> appt --> accepted
  view -- "いいえ" --> orders --> accepted
  accepted -- "いいえ" --> wait --> perform
  accepted -- "はい" --> perform
  perform --> check
  check -- "いいえ" --> error --> perform
  check -- "はい" --> save
  save -.-> next -.-> done
  save --> done
```

服薬指導です。

```mermaid
flowchart TD
  open(("基準日を選んで<br/>服薬指導一覧を開く"))
  mine["受け持ち(自分)で絞る"]
  accepted{"状態は実施中?"}
  wait["先に「受付」を押す"]
  perform["「実施」を押して入力"]
  check{"入力はそろっている?"}
  error["入力エラーを表示"]
  save["登録<br/>「本日」の列に出る"]
  done((("記録完了")))

  open --> mine --> accepted
  accepted -- "いいえ" --> wait --> perform
  accepted -- "はい" --> perform
  perform --> check
  check -- "いいえ" --> error --> perform
  check -- "はい" --> save --> done
```

実施で入力する項目は次のとおりです。

| 項目 | 栄養指導 | 服薬指導 |
|---|---|---|
| 実施日 | 必須 | 必須 |
| 指導種別 | 必須 | 必須 |
| 実施時間(分) | 必須。1〜600 分 | 項目なし |
| 理解度 | 項目なし | 任意(良好 / 一部理解 / 不十分) |
| 担当 | 必須(「担当管理栄養士」) | 必須(「担当薬剤師」) |
| 指導内容 | 自由入力かテンプレート | 自由入力かテンプレート |

「実施」を押すと、実施日・時刻(予約の時刻)・担当(ログイン中の人)が入った状態で開きます。登録しても、状態は実施中のままです。

**指導種別**

- 栄養指導は、オーダーの指導形態に合うものだけ選べます。個別指導のオーダーなら「初回」か「2 回目以降」、集団指導のオーダーなら「集団」だけです。
- 初回か 2 回目以降かは、指導した人が選びます。
- 服薬指導は、退院時指導のオーダーなら「退院時指導」だけです。それ以外のオーダーは、「服薬指導」「服薬指導(ハイリスク薬)」から選びます。

**担当**

- 担当を選べるようにしてあるのは、指導したのがログインした人とは限らないためです。
- 服薬指導では、実施の入力の「担当薬剤師」(指導した薬剤師)と、服薬指導一覧の「担当薬剤師」(受け持ちの薬剤師)は別に残ります。

**指導内容のテンプレート**

- 指導内容はテンプレートからも書けます。栄養指導には、指導記録のテンプレート「栄養指導 指導記録」(カテゴリ「栄養指導」)があります。
- テンプレートで書いているあいだは、欄を直接直せません。「テンプレート編集」から直します。
- 「解除」を押すと、テンプレートとのつながりだけが外れ、文言は残ります。

**実施の取消**

- 部門の一覧の行の「表示」を開き、実施履歴の「取消」を押します。テンプレートで書いた記入内容も一緒に消えます。
- 別の日の実施を取り消すときは、基準日をその日にします。

**確かめていないこと**

- 月あたりの回数、指導時間の下限、特別食に当たるかどうかは、画面では確かめていません。

### 終了・中止・退院

```mermaid
flowchart TD
  course(("オーダーを閉じる"))
  what{"どう閉じる?"}
  complete["行のメニューの「終了」<br/>終了日を入れる"]
  cancel["行のメニューの「中止」"]
  discharge["退院の画面のチェック"]
  ended["状態が終了になり<br/>終了日が付く"]
  revoked["状態が中止になる"]
  dischargeEnd["退院日が終了日として付く<br/>状態は変わらない"]

  course --> what
  what -- "期間を打ち切る" --> complete --> ended
  what -- "指導を取りやめる" --> cancel --> revoked
  what -- "退院する" --> discharge --> dischargeEnd
```

| 操作 | できるとき | 部門の一覧での見え方 | 栄養指導の予約 |
|---|---|---|---|
| 「終了」 | 実施中 | 終了日を過ぎると出なくなる | 終了日の翌日以降の予約が取り消される |
| 「中止」 | 依頼済・実施中 | 中止の行として残る | 今日以降の予約が取り消される |
| 退院 | 退院日より後まで続くオーダー | 退院日を過ぎると出なくなる | 退院日の翌日以降の予約が取り消される |

- **「終了」**: 終了日は、開始日以降の日を入れます。
- **退院の画面のチェック**: 「栄養指導オーダーを退院日で終了する」「服薬指導オーダーを退院日で終了する」です。外来の栄養指導・服薬指導に切り替えて続けることもあるので、食事とは別のチェックになっていて、外せます。
- **予約の扱い**: 取り消されるのは、もう指導に来ない日の予約だけです。枠は空きます。それより前の予約は、来院の記録として残ります。

押し間違えたときは、行のメニューの取消で戻します。

| 操作 | 戻る先 | 戻らないもの |
|---|---|---|
| 「終了取消」 | 実施中 | 終了日、取り消された予約 |
| 「中止取消」 | 依頼済 | 取り消された予約 |
| 「受付取消」 | 依頼済 | なし |

- **「終了取消」の後に期間を延ばすとき**: オーダーを編集して終了日を直し、予約を取り直します。
- **終了日が残る理由**: 終了日を自動で消すと、打ち切った後の期間までオーダーが続いていたことになり、その間に実施記録が無いことと食い違うためです。

### 変更・中止・削除

| 操作 | できる場所 |
|---|---|
| 変更 | カルテのカード(カルテに出る、そのオーダーのカード)の編集 |
| 中止 | 部門の一覧の行のメニューの「中止」 |
| 削除 | カルテのカード |
| DO(前回と同じ内容で出し直す) | カルテのカード |

- **変更**: 状態・実施記録・予約・受け持ちの薬剤師は変わりません。中止のオーダーを編集しても、中止のままです。
- **中止**: カルテのカードに中止はありません。
- **削除できるとき**: 実施記録が無いオーダーだけ削除できます。実施記録があるときは、実施を取り消してから削除するか、中止します。
- **削除で一緒に消えるもの**: 栄養指導では、取ってある予約が取り消され、指導目的のテンプレートの記入内容も消えます。
- **DO**: 新しいオーダーとして写ります。開始日は今日になり、終了日は空になります。
- **DO で引き継ぐもの**: 栄養指導は、対象疾患名と指示食種を引き継ぎます。指導目的は文言だけを引き継ぎ、テンプレートとのつながりは外れます。

### リハビリとの違い

実施を記録しても状態が変わらないこと、「終了」で期間を打ち切ること、退院で終えられることは、リハビリと同じです。違いは次のとおりです。

| | リハビリ | 栄養指導 | 服薬指導 |
|---|---|---|---|
| 依頼先 | リハ部門(療法士) | 栄養部門(管理栄養士) | 薬剤部(薬剤師) |
| 予約 | 部門が「次回予約」でそのつど取る | 部門が「次回予約」でそのつど取る | 無い(薬剤師が病棟で指導する) |
| 受け持ち | 無い | 無い | 受け持ちの薬剤師を一覧で決める |
| テンプレート | 無い | 指導目的と指導内容で使える | 指導内容で使える |
| 部門の画面 | リハビリ一覧 | 栄養指導一覧 | 服薬指導一覧 |
| ホームのカード | 療法士向け | 管理栄養士向けの「栄養指導」 | 薬剤師向けの「服薬指導」 |
| 医事会計 | 実施 1 回ごとに送る | 実施 1 回ごとに送る | まだ送らない |

- **必須の項目**: リハビリは区分・療法・単位数・開始日・対象疾患名です。栄養指導と服薬指導は「登録の判定」の表のとおりです。
- **実施で入れるもの**: リハビリは療法・単位数・担当療法士・訓練内容です。栄養指導と服薬指導は「日々の実施」の表のとおりです。
- **実施した人**: どのオーダーも、実施記録に担当(療法士・管理栄養士・薬剤師)を残します。
- **服薬指導の医事会計**: 送信の画面では、服薬指導は「送れない項目」に出ます。

### 帳票

専用の帳票はありません。次のものは、このオーダーでは扱いません。

- 服薬指導患者表・同意書・薬歴の帳票
- 栄養管理計画書(入院時の栄養管理は、病棟の「栄養管理」で扱う)

## 開発者向け

### シーケンス図の前提

- **書き込みの経路**: `/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
- **SS-MIX2**: 有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。栄養指導・服薬指導は、どちらも電文になりません。
- **楽観ロック**: 版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。編集フォームは `useEditSnapshot` で開いた時点の版に固定します(`hooks/useNutritionGuidanceOrderInitialValues.ts`、`hooks/useMedicationGuidanceOrderInitialValues.ts`)。
- **図の描き方**: 応答は backend を通って戻りますが、図では上流からブラウザへ直接描きます。検索の条件と transaction の中身は、図の下の表に出します。

このページで使う呼び名は次のとおりです。

| 呼び名 | 指すもの |
|---|---|
| 上流 | 上流の FHIR サーバー |
| ヘッダ | オーダー 1 件を表す `ServiceRequest`。明細は持たない |
| 全件の検索 | 全ページを読み切る検索(`complete: true`)。欠けた結果は使わず、書き込みを止める |
| 予約の取消 | 栄養指導の、もう来ない日の有効な予約を `cancelled` にし、枠を `free` に戻すこと |
| 記入内容 | テンプレートで書いた回答(`QuestionnaireResponse`) |

識別子は、栄養指導が `NutritionGuidance`、服薬指導が `MedicationGuidance` を名前に持ちます。2 つで同じ形のものは、栄養指導の名前を書き、服薬指導の名前を並べます。

### リソースの構成

ヘッダ(`ServiceRequest`)の要素は次のとおりです。

| 要素 | 栄養指導 | 服薬指導 |
|---|---|---|
| `category` | `order-type|nutrition-guidance` と 入外区分(v3 ActCode の `IMP` / `AMB`) | `order-type|medication-guidance` と 入外区分(v3 ActCode の `IMP` / `AMB`) |
| `code` | 指導形態(`nutrition-guidance-format`) | 指導区分(`medication-guidance-kind`) |
| `orderDetail[]` | 使わない | 指導条件(`medication-guidance-condition`) |
| `occurrenceDateTime` | 開始日 | 開始日 |
| `reasonCode` | 指導目的 | 指導してほしいこと |
| `note` | 栄養部門への指示 | 薬剤部への連絡事項 |
| `reasonReference` | 対象プロブレム | 対象プロブレム |

ヘッダの拡張は次のとおりです。

| 拡張 | 中身 |
|---|---|
| `nutrition-guidance-order-end` | 栄養指導の終了日 |
| `nutrition-guidance-target-disease` | 対象疾患名 |
| `nutrition-guidance-target-condition` | 対象疾患名を写した元の `Condition` |
| `nutrition-guidance-target-diet` | 指示食種。食種マスタの Coding で、system は食事と共通の `meal-type` |
| `nutrition-guidance-purpose-questionnaire-response` | 指導目的の記入内容への参照 |
| `medication-guidance-order-end` | 服薬指導の終了日 |
| `medication-guidance-target-drugs` | 対象薬剤 |

ヘッダのほかのリソースは次のとおりです。

| もの | リソース | 栄養指導 | 服薬指導 |
|---|---|---|---|
| 指導目的の記入内容 | `QuestionnaireResponse` | ヘッダの拡張から参照する | 無い |
| 進捗 | `Task`(`focus` = ヘッダ) | `task-code|nutrition-guidance` | `task-code|medication-guidance`。`owner` = 受け持ちの薬剤師 |
| 実施記録 | `Procedure`(`basedOn` = ヘッダ) | 下の表 | 下の表 |
| 予約 | `Appointment`(`basedOn` = ヘッダ)と `Slot` | 枠表は `Schedule` | 無い |
| 代行入力 | `Provenance`(`target` = ヘッダ) | 種別共通 | 種別共通 |

実施記録(`Procedure`)の要素は次のとおりです。

| 要素 | 栄養指導 | 服薬指導 |
|---|---|---|
| `category` | `order-type|nutrition-guidance` | `order-type|medication-guidance` |
| `code` | 指導種別(`nutrition-guidance-session-type`) | 指導種別(`medication-guidance-session-type`) |
| `code` の値 | initial / follow-up / group | standard / high-risk / discharge |
| `performer` | 担当管理栄養士 | 指導した薬剤師 |
| 拡張(実施時間・理解度) | `nutrition-guidance-performed-minutes`(分) | `medication-guidance-understanding`(good / partial / poor) |
| 拡張(指導記録の記入内容) | `nutrition-guidance-record` | `medication-guidance-record` |
| `note` | 指導内容 | 指導内容 |

- **指導目的の記入内容**: ヘッダと同じ transaction で書きます。テンプレートの解除・オーダーの削除で消します。
- **進捗の Task**: 登録時には作りません。Task が無いオーダーは依頼済です。服薬指導で受け持ちだけ先に付けると、依頼済のまま Task を作ります。
- **予約の枠表**: `Schedule` の `serviceType` は `schedule-service-type|nutrition-guidance` です。定員は 1 に潰しません。
- **期間の持ち方**: 期間を開始日と終了日の拡張で持つ理由と、上流の `order-period` 索引は、リハビリと同じです([rehab.md](rehab.md)「リソースの構成」)。
- **分類の置き場所**: 指導形態・指導種別・指導区分・指導条件・理解度は、診療報酬上の固定の分類です。DB マスタを持たず、フロントの定数に置いています。

### 進捗 Task と status

**実施しても Task を動かしません。** ほかの種別は実施で Task を進めますが、この 2 種別はリハビリと同じく進めません。初回の指導で終了扱いにならないようにするためです。実施ボタンを他部門と同じ形に揃えるリファクタをしないでください(`fhir/nutritionGuidanceTaskHelpers.ts`・`medicationGuidanceTaskHelpers.ts` の冒頭コメント)。

| Task | 表示 | `ServiceRequest.status` | ヘッダに書くもの |
|---|---|---|---|
| (無し)/ `requested` | 依頼済 | `active` | – |
| `accepted` | 実施中 | `active` | – |
| `completed` | 終了 | `active` のまま | 終了日の拡張(`nutrition-guidance-order-end` / `medication-guidance-order-end`) |
| `cancelled` | 中止 | `revoked` | – |

- **遷移の表**: `nutritionGuidanceTaskActions` / `medicationGuidanceTaskActions` です。
- **書き込みの入口**: `useUpdateNutritionGuidanceTaskStatus` / `useUpdateMedicationGuidanceTaskStatus` です。中止・中止取消は、`orderCancelEntries` でヘッダの status を揃えます。
- **終了で終了日を書く理由**: 部門の一覧は `order-period` で引きます。終了日が無いと、基準日にいつまでもヒットし続けるためです(`buildNutritionGuidanceOrderCloseEntry` / `buildMedicationGuidanceOrderCloseEntry`)。
- **終了取消で終了日を消さない**: 意図した非対称です。
- **予約の取消**: 栄養指導の終了・中止・退院は、予約の取消を同じ transaction に積みます。予約は `fetchOrderAppointmentCancelEntries` の `from` 以降を、全件の検索で読みます。
- **受け持ちの薬剤師の変更**: `useAssignMedicationGuidancePharmacist` / `buildMedicationGuidanceAssignment` は、Task だけを書きます。状態の変更(`buildTaskUpdate`)は元の Task を引き継ぐので、受け持ちは残ります。
- **カルテのタイムライン**: `accepted` / `completed` のときに実施履歴を出します(`karteTimeline.ts`。リハビリと同じ)。

### 部品

| 部品 | 栄養指導 | 服薬指導 |
|---|---|---|
| オーダーのフォーム | `components/NutritionGuidanceOrderForm.tsx`・`NutritionGuidanceOrderPanels.tsx` | `components/MedicationGuidanceOrderForm.tsx`・`MedicationGuidanceOrderPanels.tsx` |
| オーダーの詳細 | `components/NutritionGuidanceOrderDetailPanel.tsx` | `components/MedicationGuidanceOrderDetailPanel.tsx` |
| カード | `components/karteCardBodies/NutritionGuidanceOrderCardBody.tsx` | `components/karteCardBodies/MedicationGuidanceOrderCardBody.tsx` |
| 組み立て(オーダー) | `fhir/nutritionGuidanceOrderHelpers.ts` | `fhir/medicationGuidanceOrderHelpers.ts` |
| 組み立て(進捗) | `fhir/nutritionGuidanceTaskHelpers.ts` | `fhir/medicationGuidanceTaskHelpers.ts` |
| 組み立て(実施) | `fhir/nutritionGuidanceResultHelpers.ts` | `fhir/medicationGuidanceResultHelpers.ts` |
| 組み立て(予約) | `fhir/appointmentHelpers.ts` の `buildNutritionGuidanceAppointmentBundle` | 無い |
| 部門の画面 | `pages/NutritionGuidanceWorklistPage.tsx`(依頼・予約の 2 ビュー、終了のモーダル) | `pages/MedicationGuidanceWorklistPage.tsx`(終了・担当のモーダル) |
| 実施入力 | `components/NutritionGuidancePerformModal.tsx` | `components/MedicationGuidancePerformModal.tsx` |
| 次回予約・日時変更 | `components/NutritionGuidanceBookModal.tsx` | 無い |
| hook | `api/queries/nutritionGuidance.ts` | `api/queries/medicationGuidance.ts` |
| 予約の取消・日時変更の hook | `api/queries/appointment.ts` | 無い |

- `NutritionGuidanceBookModal.tsx` は、`AppointmentSlotPicker` を `scheduleType="nutrition-guidance"` で使います。
- 退院は、2 種別とも `components/DischargeModal.tsx` と `api/queries/encounter.ts`(`buildNutritionGuidanceOrderStopEntries` / `buildMedicationGuidanceOrderStopEntries`)です。
- パスからの実施は、2 種別とも `components/PathwayOrderModal.tsx`(`acceptTask`)です。

### シーケンス図: 登録・編集・削除

| 操作 | 組み立て | hook |
|---|---|---|
| 登録 | `buildNutritionGuidanceOrderBundle` / `buildMedicationGuidanceOrderBundle` | `useCreatePrescription` |
| 編集 | `buildNutritionGuidanceOrderUpdateBundle` / `buildMedicationGuidanceOrderUpdateBundle` | `useUpdateNutritionGuidanceOrder` / `useUpdateMedicationGuidanceOrder` |
| 削除 | `deleteNutritionGuidanceOrderRequest` / `deleteMedicationGuidanceOrderRequest` | `postOrderDeleteBundle`(`api/queries/orderDelete.ts`) |

`useCreatePrescription` は名前に反して全種別共通の hook で、`api/queries/labResult.ts` にあります。

フォームを開いたときの読み込みです。

```mermaid
sequenceDiagram
  autonumber
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(患者の病名・入院など)
  BE->>FHIR: 検索
  FHIR-->>UI: フォームの候補と初期値
  opt 栄養指導の指示食種
    UI->>BE: GET /master/meal_diets
    BE-->>UI: 食種マスタ
  end
```

| 読むもの | 得るもの |
|---|---|
| 患者の `Condition` | 病名・対象プロブレムの候補 |
| 入院中の `Encounter` | 入外区分の初期値 |
| 食事オーダー(栄養指導だけ) | いまの食種 |

登録です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 項目を入れて登録
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

入力検証は `validateNutritionGuidanceOrderForm` / `validateMedicationGuidanceOrderForm` です。

| 書くもの | 条件 |
|---|---|
| POST `QuestionnaireResponse`(`urn:uuid`) | 栄養指導の指導目的をテンプレートで書いたとき |
| POST ヘッダ `ServiceRequest` | `fullUrl` を付ける |
| `Provenance`(CREATE) | 毎回 |
| `Task` `order-approval` | 代行入力・研修医のとき |

編集です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 直して更新
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果(版違いは 412)
```

| 書くもの | 条件 |
|---|---|
| 記入内容の PUT / POST | 栄養指導の指導目的をテンプレートで書いたとき |
| 記入内容の DELETE | 栄養指導で、テンプレートを解除したとき |
| PUT ヘッダ | `ifMatch` を添える(開いた時点の版)。元が `revoked` なら `revoked` のまま(`keepOrderRevoked`) |
| `Provenance`(UPDATE) | 毎回 |

削除です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 削除
  opt 栄養指導
    UI->>BE: GET /fhir(オーダーと有効な予約)
    BE->>FHIR: 検索(予約は全件の検索)
    FHIR-->>UI: 記入内容の参照と予約
  end
  UI->>BE: GET /fhir(オーダーと従属リソース)
  BE->>FHIR: 検索
  FHIR-->>UI: オーダー・進捗・実施記録
  UI->>UI: 実施記録があれば止める
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

| 読む・書くもの | 条件 |
|---|---|
| 栄養指導の検索 | `ServiceRequest/id` と、`Appointment?based-on=オーダー&status=有効` |
| 従属リソースの検索 | `ServiceRequest?_id&_revinclude=Task:focus,Procedure:based-on,…` |
| PUT `Appointment` を `cancelled` に、`Slot` を `free` に | 栄養指導。予約ごと |
| DELETE `QuestionnaireResponse` | 栄養指導。指導目的の記入内容 |
| DELETE `Task`、DELETE ヘッダ | 実施記録が無いとき |

### シーケンス図: 部門の一覧・進捗・担当

一覧の hook は `useNutritionGuidanceWorklist` / `useMedicationGuidanceWorklist` で、`fetchWorklistBundles` が 500 件ずつ読みます。一覧・実施・予約のどれかが上限で欠けたら、`truncated` を出します。

一覧の読み込みです。

```mermaid
sequenceDiagram
  autonumber
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(基準日に効いているオーダー)
  BE->>FHIR: 検索
  FHIR-->>UI: オーダーと進捗の Task
  par 基準日の実施
    UI->>BE: GET /fhir(基準日の Procedure)
    BE->>FHIR: 検索
    FHIR-->>UI: 「本日」の列
  and 基準日以降の予約(栄養指導)
    UI->>BE: GET /fhir(基準日以降の Appointment)
    BE->>FHIR: 検索
    FHIR-->>UI: 「次回予約」の列と「予約」ビュー
  end
```

| 読むもの | 条件 |
|---|---|
| オーダー | `ServiceRequest?category=order-type|種別&status=active,revoked` |
| | `order-period=ge基準日&order-period=le基準日`、`based-on:missing=true` |
| | `_include` 患者、`_revinclude` `Task:focus`。Task の `owner` が受け持ちの薬剤師 |
| 実施 | `Procedure?category=order-type|種別&date=基準日` |
| 予約 | `Appointment?date=ge基準日&service-type=…|nutrition-guidance&status=有効&_sort=date` |

状態の変更と、受け持ちの薬剤師の変更です。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 管理栄養士・薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 行のボタンか行のメニュー
  opt 栄養指導の終了・中止
    UI->>BE: GET /fhir(取り消す予約)
    BE->>FHIR: 全件の検索
    FHIR-->>UI: 取り消す予約と枠
  end
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

| 操作 | 書くもの |
|---|---|
| 受付・受付取消・終了取消 | `Task` を新しい状態にする。無ければ POST |
| 中止取消 | `Task` を `requested` に、PUT ヘッダ `status=active`(`ifMatch`) |
| 中止 | PUT `Task` `cancelled`、PUT ヘッダ `status=revoked`(`ifMatch`)。栄養指導は予約の取消 |
| 終了 | PUT `Task` `completed`(`executionPeriod.end`)、PUT ヘッダの終了日の拡張 = 終了日(`ifMatch`)。栄養指導は予約の取消 |
| 担当(服薬指導) | `Task` の `owner` を書き換える。無ければ `requested` で POST |

| 予約の取消で読む予約 | 条件 |
|---|---|
| 中止 | `Appointment?based-on=オーダー&date=ge今日&status=有効` |
| 終了 | `Appointment?based-on=オーダー&date=ge終了日の翌日&status=有効` |

予約の取消は、予約ごとに PUT `Appointment` `cancelled` と `Slot` `free` を積みます。

予約・日時変更・取消のシーケンスは、リハビリと同じです([rehab.md](rehab.md)「シーケンス図: 予約・日時変更・取消」)。栄養指導で使うのは、`useBookNutritionGuidanceAppointment` / `buildNutritionGuidanceAppointmentBundle`、`useRescheduleAppointment`、`useCancelAppointment` です。

### シーケンス図: 実施・実施の取消・退院での打ち切り

| 操作 | 組み立て | hook |
|---|---|---|
| 実施 | `buildNutritionGuidancePerformBundle` / `buildMedicationGuidancePerformBundle` | `useRegisterNutritionGuidancePerform` / `useRegisterMedicationGuidancePerform` |
| 実施の取消 | | `useDeleteNutritionGuidancePerform` / `useDeleteMedicationGuidancePerform` |
| 退院での打ち切り | `buildNutritionGuidanceOrderStopEntries` / `buildMedicationGuidanceOrderStopEntries` | `usePatientNutritionGuidanceOrders` / `usePatientMedicationGuidanceOrders` |

実施です。

```mermaid
sequenceDiagram
  autonumber
  actor Staff as 管理栄養士・薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Staff->>UI: 行の「実施」
  UI->>BE: GET /fhir(Practitioner)
  BE->>FHIR: 検索
  FHIR-->>UI: 担当の候補
  opt 指導内容をテンプレートで書く
    UI->>BE: GET /fhir(Questionnaire)
    BE->>FHIR: 検索
    FHIR-->>UI: テンプレート
  end
  Staff->>UI: 項目を入れて登録
  UI->>UI: 入力検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

入れるのは、指導種別・実施時間(栄養指導)・理解度(服薬指導)・担当・指導内容です。入力検証は `validateNutritionGuidancePerformForm` / `validateMedicationGuidancePerformForm` です。

| 書くもの | 条件 |
|---|---|
| POST `QuestionnaireResponse`(`urn:uuid`) | 指導内容をテンプレートで書いたとき |
| POST `Procedure` | `basedOn` = オーダー |
| 進捗の `Task` | 動かさない |
| `Task` を `accepted` に | パスから依頼済のオーダーを実施したとき。同じ transaction に積む |

実施の取消です。

```mermaid
sequenceDiagram
  autonumber
  actor Staff as 管理栄養士・薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Staff->>UI: 行の「表示」→ 実施履歴の「取消」
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

| 書くもの | 条件 |
|---|---|
| DELETE `Procedure` | 毎回。`entered-in-error` では残さない |
| DELETE `QuestionnaireResponse` | 指導記録の記入内容があるとき |

退院での打ち切りです。

```mermaid
sequenceDiagram
  autonumber
  actor Ward as 病棟
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(患者の有効なオーダー)
  BE->>FHIR: 全件の検索
  FHIR-->>UI: 有効なオーダー
  UI->>UI: 退院日より後まで続くものを選ぶ
  opt 栄養指導
    UI->>BE: GET /fhir(取り消す予約)
    BE->>FHIR: 全件の検索
    FHIR-->>UI: 取り消す予約と枠
  end
  Ward->>UI: チェックを入れたまま退院を登録
  UI->>BE: POST /fhir(退院の transaction)
  BE->>FHIR: 中継
  FHIR-->>UI: 結果
```

| 読む・書くもの | 条件 |
|---|---|
| オーダーの検索 | `ServiceRequest?subject=患者&category=order-type|種別&status=active` |
| 選ぶ | `nutritionGuidanceOrderNeedsStop` / `medicationGuidanceOrderNeedsStop` |
| 予約の検索 | `Appointment?based-on=オーダー&date=ge退院日の翌日&status=有効`。選んだオーダーごと |
| PUT ヘッダの終了日の拡張 = 退院日 | `Task` は動かさない |
| 予約の取消 | 栄養指導。予約ごと |

退院の transaction には、`Encounter`・ベッドの更新と、食事・リハビリの打ち切りも一緒に載ります。

### 医事会計と SS-MIX2

SS-MIX2 の電文は、どの操作でも出しません(`OMG^O19` の対象外です)。

**栄養指導**

- 実施記録から集めます(`BillingClaimBuilder` の `:procedure` 経路、`Resolvers::NutritionGuidance`)。
- 実施 1 件が 1 剤で、数量は 1 です。コードは、施設設定の `receipt_codes.nutrition_guidance`(初回 / 2 回目以降 / 集団)から指導種別で引きます。
- 期間継続型(`continuous`)なので、実施記録の無い日のヘッダは報告しません。
- 日レセの診療種別区分は 130 です。

**服薬指導**

- 送り方は未実装です(`OrderCatalog::PENDING`)。
- 薬剤管理指導料・退院時薬剤情報管理指導料の区分を、実施の指導種別から引く形にはしてあります。コードの持ち方は決めていません。

| 起きたこと | 医事会計(`BillingClaimBuilder`) |
|---|---|
| 登録・編集・削除 | 栄養指導は何も送らない |
| | 服薬指導は、オーダーの開始日の送信で「この種別はまだ医事会計へ送りません」と送れない項目に出す |
| 実施 | 栄養指導は実施日に送る。指導種別が無いときと、施設設定にコードが無いときは「送れない項目」に出す |
| | 服薬指導は送らない |
| 実施の取消 | 対象から外れる(DELETE) |
| 受付・終了・中止・担当・退院での打ち切り、予約・日時変更・取消 | 何も送らない |
