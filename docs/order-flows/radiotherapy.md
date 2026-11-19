# 放射線治療の業務フロー

放射線治療を、依頼から治療処方・受付・照射予定・毎回の照射・治療中の診察・終了サマリーまで追う流れです。
放射線治療は、臨床医が**他科依頼**で放射線治療科に相談し、放射線治療医が**治療処方**を登録し、放射線治療部門が数週間かけて照射する長い流れです。治療処方 1 件が、治療コース 1 件に当たります。
このシステムでは、依頼・治療処方・毎回の照射を別々に登録します。治療計画の中身(輪郭・ビーム・線量分布)は治療計画装置で扱い、このシステムでは扱いません。
依頼と回答の流れは[他科依頼・チーム依頼](consult-team.md)にあるので、先に読むと分かりやすくなります。

医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
設計は [radiotherapy-order-design.md](../radiotherapy-order-design.md)、依頼の流れは [consult-team.md](consult-team.md)(他科依頼)、
督促の通知は [features/notifications.md](../features/notifications.md)、有害事象の表示は [features/patient-profile.md](../features/patient-profile.md)「有害事象」、
種別共通の約束(代行入力・オーダーセット)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。

## 運用フロー

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph clinician["依頼医"]
    consult["他科依頼で<br/>放射線治療科に依頼"]
  end

  subgraph rtdoc["放射線治療医"]
    reply["依頼を受けて診察し<br/>回答を書く"]
    treat{"照射する?"}
    order["治療処方を登録"]
    review["週次レビュー<br/>有害事象の記録"]
    summary["治療終了サマリー"]
  end

  subgraph dept["放射線治療部門"]
    accept["受付(計画中)"]
    plan["計画 CT・治療計画・検証"]
    schedule["照射予定を一括登録"]
    begin["治療開始(治療中)"]
    fraction["毎回の照射を記録"]
    close["終了"]
  end

  start --> consult --> reply --> treat
  treat -- "いいえ" --> finish
  treat -- "はい" --> order --> accept --> plan --> schedule --> begin --> fraction
  fraction -- "部門が終了を決める" --> close --> summary --> finish
  fraction -. "治療のあいだ" .-> review
```

| 段 | 行うこと |
|---|---|
| 依頼 | 依頼医が、他科依頼で放射線治療科に依頼する。原発部位・治療目的・照射歴などを書く |
| 回答 | 放射線治療医が、他科依頼一覧で依頼を受けて診察し、回答を書く |
| 治療処方 | 放射線治療医が、標的・Phase・1 回線量・分割回数を登録する |
| 計画 CT・治療計画・検証 | 治療計画装置で行う。このシステムでは扱わない |
| 照射予定 | 部門が、装置・曜日・時刻を決めて一括で登録する |
| 毎回の照射 | 部門が、照射のカードの「実施」で記録する |
| 週次レビュー | 放射線治療医が、治療のあいだ定期的に診察して書く |

この文書で使う呼び名は次のとおりです。

- **治療処方**: 放射線治療医が登録するオーダーです。1 件が治療コース 1 件に当たります。登録と編集の場面では「治療処方」、部門が進める場面では「コース」と呼びます。
- **標的**: 照射する対象です。名称・種別・部位・左右を持ちます。
- **Phase**: 照射の段階です。モダリティ・照射技法・分割回数と、標的ごとの 1 回線量をひとまとまりで決めます。
- **指示医師**: 治療処方を指示した医師です。督促の通知は指示医師に届きます。
- **部門**: 放射線治療部門です。
- **週次レビュー**: 治療中の診察の記録です。画面では「診察」とも出ます。
- **照射記録と照射録**: 照射記録は、このシステムに登録する毎回の照射の記録です。照射録は、法令で保存が求められる照射の記録です。照射記録と治療処方を合わせて、照射録になります。
- **カルテの右ペイン**: カルテの右側のオーダー入力の欄です。

部門が使う画面は「部門業務 > 放射線治療カレンダー」です。

| 場所 | 見えるもの |
|---|---|
| 左の格子(日の表示) | 列が治療装置、縦が時刻。照射 1 回が 1 枚のカードで並ぶ |
| 左の格子(週の表示) | 行が治療装置、列が日 |
| 右の一覧 | 治療コースが 1 件 1 枚のカードで並ぶ。「進行中」と「終了・中止」に分かれる |

カードは 4 種類あります。この文書では次のように呼び分けます。

| 呼び名 | ある場所 | 表すもの |
|---|---|---|
| コースのカード | 放射線治療カレンダーの右の一覧 | 治療コース 1 件 |
| 照射のカード | 放射線治療カレンダーの格子 | 照射 1 回。予定・実施済・未実施のどれか |
| 治療処方のカード | カルテ | 治療処方 1 件 |
| 依頼のカード | カルテ | 他科依頼 1 件 |

- **依頼のテンプレート**: 依頼先に放射線治療科を選ぶと、依頼目的に「他科依頼 放射線治療依頼」のテンプレートが選ばれた状態になります。他院での照射歴は、このテンプレートにだけ書けます。
- **回答と治療処方は別です**: 回答は他科依頼一覧から書きます。治療処方はカルテの右ペインの「放射線治療」(「化学療法」の隣)から登録します。
- **元の依頼**: 治療処方を登録するときに、元の依頼を選べます(任意)。選ぶと、依頼目的がフォームに出ます。
- **行き来**: 依頼のカードの「治療処方表示」と、治療処方のカードの「依頼表示」で行き来できます。
- **部門で代わりに登録するとき**: 放射線治療カレンダーの「新規登録」からも治療処方を登録できます。
- **登録できる医師**: 絞っていません。
- **計画 CT**: 放射線検査オーダーで出します。固定具・呼吸同期・前処置は、放射線検査の特別指示テンプレートで書けます。
- **設定する人へ**: 依頼先の科ごとのテンプレートは施設設定で決めます。

治療処方のカードは、カルテの開始予定日の日に載ります。カードには次のものが出ます。

- 部位・照射技法・併用療法
- 標的ごとのコース合計(「PTV 全乳房 50 Gy / 25 回」のように出ます)
- 照射の回数と累積線量

### 治療コースの状態

| 状態 | 意味 | 変わるきっかけ |
|---|---|---|
| 処方済 | 部門がまだ引き受けていない | 治療処方の登録、受付取消、コースの中止取消 |
| 計画中 | 計画 CT・治療計画・検証のあいだ | 受付、治療開始取消 |
| 治療中 | 初回照射から最終照射まで | 治療開始、再開、終了取消 |
| 休止 | 体調不良・装置の故障などで中断 | 休止 |
| 終了 | 照射を終えた | 終了 |
| 中止 | 途中でやめた | 中止 |

コースのカードからできることは次のとおりです。メニューは、カードの「︙」のメニューです。

| 状態 | カードのボタン | カードのメニュー |
|---|---|---|
| 処方済 | 「受付」 | 「中止」 |
| 計画中 | 「治療開始」「予定登録」 | 「受付取消」「中止」 |
| 治療中 | 「終了」「休止」「予定登録」 | 「照射入力」「治療開始取消」「中止」 |
| 休止 | 「再開」「予定登録」 | 「中止」 |
| 終了 | 「サマリー」 | 「終了取消」 |
| 中止 | 「サマリー」 | 「中止取消」 |

- **状態を動かすのは部門だけ**: 状態は、放射線治療カレンダーのコースのカードから動かします。
- **照射を記録しても状態は変わりません**: 治療処方の回数に達しても、カードに「完了」の印が付くだけです。終了は部門が決めます。
- **日付と理由**: 「終了」は終了日、「休止」は休止日・理由・補足、「中止」は中止日・理由・補足を入れます。
- **「予定登録」が出るとき**: 予定と照射済みの回の合計が、治療処方の回数に届いていないときだけ出ます。
- **押し間違いの訂正**: 「受付取消」「治療開始取消」「終了取消」「中止取消」です。「終了取消」は治療中へ、「中止取消」は処方済へ戻ります。
- **どのカードにもあるメニュー**: 「表示」「週次レビュー」「カルテ表示」です。予定があるときは「予定全削除」も出ます。
- **絞り込み**: 右の一覧は、装置・進捗・患者(氏名と患者番号の部分一致)で絞れます。「進行中」には、処方済・計画中・治療中・休止のコースが並びます。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  check{"入力はそろっている?"}
  error["入力エラーを表示<br/>該当の項目に印を付ける"]
  fix["入力を直す"]
  send["治療処方を保存"]
  result{"保存できた?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は指示医師本人?"}
  approval["指示医師に<br/>承認待ちの通知"]
  done((("登録完了")))

  submit --> check
  check -- "いいえ" --> error --> fix --> submit
  check -- "はい" --> send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
```

入力する項目と、登録のときに確かめる条件は次のとおりです。

| まとまり | 項目 | 条件 |
|---|---|---|
| コース | 治療目的 | 必須 |
| コース | コース番号 | 必須。新規登録では、その患者の最大の番号 + 1 が入っている |
| コース | 開始予定日 | 必須。オーダーセットやクリニカルパスの内容として入れるときは不要 |
| コース | 担当医・併用療法・元の依頼・対象プロブレム・コメント | 任意 |
| 標的 | 標的 | 1 件以上 |
| 標的 | 名称・部位 | どの標的にも必須 |
| 標的 | 種別・左右 | 任意 |
| Phase | Phase | 1 件以上 |
| Phase | モダリティ・照射技法 | 必須 |
| Phase | 分割回数 | 必須。1〜99 |
| Phase | 使用予定装置 | 任意 |
| Phase | 週あたり回数 | 14 まで |
| Phase | 標的ごとの 1 回線量 | Phase ごとに、どの標的にも必須 |

- **治療プロトコル**: 定型の治療処方です。選ぶと、標的・Phase・治療目的が入ります。
- **部位が決まらないプロトコル**: 「骨転移」のようなプロトコルは部位が空なので、登録のときに選びます。部位の選択肢に無いときは、末尾の「自由記載」で名前を書きます。
- **総線量**: 入力しません。1 回線量 × 分割回数で計算されます。
- **Boost**: Phase 2 に、Boost の標的だけを置きます。
- **同時ブースト(SIB)**: 1 つの Phase に標的を複数置き、1 回線量を変えます。
- **1 日 2 回照射**: 週あたり回数で表します。
- **入力の手間を省くもの**: 治療プロトコルのほかに、DO(前回と同じ内容で出し直す)とオーダーセットが使えます。
- **承認待ち**: 指示医師でない人が代わりに入力すると、指示医師に承認待ちの通知が届きます。研修医が登録したときは、指導医に届きます。承認待ちでも、治療処方は部門に流れます。
- **クリニカルパス**: タスク分類「放射線治療」のタスクには、放射線治療のオーダーが初めから選ばれています。
- **オーダーセット**: 治療処方をオーダーセットに入れられます。開始予定日・担当医・元の依頼は、セットから引き継ぎません。

#### 登録のときの警告

警告はフォームの先頭に出ます。カルテの記録から拾うので、医師が打ち込む必要はありません。どれも登録は止めず、理由も聞きません。出ていた警告は、記録に残ります。

| 対象 | 警告 |
|---|---|
| 過去の放射線治療 | この患者の治療コースを表で出し、今回の標的と同じ部位のコースを強調する |
| 妊娠・授乳 | 患者プロファイルの妊娠・授乳 |
| 体内金属・ペースメーカー | 患者プロファイルの注意区分(体内金属のピクトグラム) |
| 施設の規則 | 「警告の規則マスタ」で、出す場所に放射線治療を選んだ規則 |

- **同じ部位**: 部位が一致し、左右が食い違わないコースを、同じ部位として強調します。
- **再照射の強調は気づきのためです**: 隣接部位の重なりや累積線量(EQD2 など)は評価しません。
- **自由記載の部位**: 部位を自由記載した標的は、過去のコースと突き合わせません。

### 照射予定の組み方

```mermaid
flowchart TD
  start(("予定を組む"))
  entry{"どこから始める?"}
  card["コースのカードの<br/>「予定登録」"]
  drop["コースのカードを掴んで<br/>格子に落とす"]
  slot["格子の空き枠を掴む"]
  pick["予定を足せるコースから選ぶ"]
  bulkQ{"残りの回をまとめて組む?"}
  add["「1 回だけ追加」<br/>次の回をその枠に入れる"]
  options["開始日・曜日・時刻・<br/>装置を入れる"]
  draft["残りの回を<br/>1 日 1 回ずつ割り付ける"]
  check["確認表で行ごとに<br/>日付を直す・外す"]
  save["登録"]
  done((("予定ができた")))

  start --> entry
  entry -- "「予定登録」" --> card --> options
  entry -- "カードを落とす" --> drop --> options
  entry -- "空き枠" --> slot --> pick --> bulkQ
  bulkQ -- "いいえ" --> add --> done
  bulkQ -- "はい" --> options
  options --> draft --> check --> save --> done
```

| 項目 | 初めの値 |
|---|---|
| 開始日 | 予定か照射記録があれば、その最後の日の翌日。無ければ今日 |
| 照射する曜日 | 月〜金 |
| 開始時刻 | カードを落とした枠・掴んだ枠の時刻 |
| 1 回の所要時間 | 15 分。空き枠を縦に引くと、その長さ |
| 装置 | カードを落とした枠・掴んだ枠の装置 |

- **予定を組めるコース**: 受付後(計画中・治療中・休止)で、残りの回があるコースだけです。処方済のコースは、先に受付します。
- **割り付け**: 残りの回を、Phase の順に、選んだ曜日へ 1 日 1 回ずつ割り付けます。祝日と休診日は飛ばします。
- **装置の点検日**: 割り付けは装置の点検日を考えません。確認表で直してください。割り付け直すと、直した内容は消えます。
- **照射しなかった回の番号**: 「この回中止」にした回の番号は空いたままになります。次に予定を組むとき、その番号から振替として埋まります。「この回中止」は「照射の記録」で説明します。
- **重なり**: 同じ装置・同じ時刻の重なりは止めません。格子で横に並んで見えます。
- **1 日 2 回照射**: 1 日 2 回の割り付けは、まだできません。1 日 1 回で割り付けてから「予定変更」で直します。

予定は、登録したあとも直せます。

- **動かす**: 予定の照射のカードは、掴んで動かせます。日の表示では時刻と装置、週の表示では日と装置を変えられます。
- **長さを変える**: 日の表示では、カードの上下の縁を掴んで、開始・終了時刻を変えられます。刻みは 5 分です。
- **「予定変更」**: 照射のカードのメニューの「予定変更」でも、日時と装置を直せます。
- **残りを後ろへずらす**: 休止などで残りをずらすときは、コースのカードのメニューの「予定全削除」のあと、もう一度「予定登録」します。

### 照射の記録

照射 1 回には、次の 4 つの状態があります。

| 照射 1 回の状態 | 意味 | なるきっかけ |
|---|---|---|
| 予定 | これから照射する | 照射予定の登録、回の「中止取消」 |
| 実施済 | 照射した | 「実施」、「照射入力」 |
| 未実施 | 照射しなかった。理由が残る | 「この回中止」 |
| 取消済 | 誤って登録した実施済を取り消した | 照射記録の「取消」 |

```mermaid
flowchart TD
  open(("当日の照射のカード"))
  doneQ{"照射した?"}
  perform["照射のカードの「実施」"]
  input["実施者などを入れて登録"]
  save["実施済<br/>回数と累積線量が進む"]
  interval{"週次レビューの間隔を<br/>超えている?"}
  remind["指示医師に督促の通知"]
  notdone["カードのメニューの<br/>「この回中止」"]
  skipped["未実施"]
  refill["振替を組む"]
  finish((("記録完了")))

  open --> doneQ
  doneQ -- "はい" --> perform --> input --> save --> interval
  interval -- "はい" --> remind --> finish
  interval -- "いいえ" --> finish
  doneQ -- "いいえ" --> notdone --> skipped --> refill --> finish
```

| 項目 | 条件 |
|---|---|
| 照射日・Phase・何回目・実照射線量 | 必須。予定から入っている |
| 実施者 | 必須 |
| 装置 | 予定から入っている |
| 開始・終了時刻 | 入れるなら、終了は開始より後 |
| 位置照合・コメント | 任意 |

- **予定を作らずに入れるとき**: 治療中のコースのカードのメニューの「照射入力」で、1 回ぶんを入れます。何回目・Phase・線量は、治療処方と照射済みの回から入ります。
- **「この回中止」**: 照射しなかった回を、理由を選んで残す操作です。その回は回数に数えず、番号は空きます。
- **コースの「中止」とは別です**: 「この回中止」は 1 回ぶんだけの操作です。コースをやめるときは、コースのカードの「中止」を使います。
- **回の「中止取消」**: 「この回中止」を押し間違えたときは、未実施の照射のカードの「中止取消」で予定に戻します。コースの「中止取消」とは別の操作です。
- **振替**: 「予定登録」か「1 回だけ追加」で組みます。
- **実施済の取消**: コースの詳細を開き、照射記録の「取消」を押します。詳細は、コースのカードの「表示」か、照射のカードの「コース表示」で開きます。カルテの詳細からは取り消せません。
- **取り消した記録**: 消えずに取消済として残り、回数と累積線量から外れます。照射録は保存が求められるためです。
- **照射記録は治療処方なしでは作れません**: 照射録に要る項目は、照射記録と治療処方を合わせてそろえます。項目は、患者の氏名・性別・年齢、照射年月日、照射方法、指示した医師、指示の内容です。

### 治療中の診察(週次レビュー)と有害事象

```mermaid
flowchart TD
  entry(("週次レビューを書く"))
  from{"どこから開く?"}
  karte["治療処方のカードの<br/>「週次レビュー」"]
  calendar["コースのカードのメニューの<br/>「週次レビュー」"]
  bell["督促の通知の「カルテ」"]
  pane["カルテの右ペインに<br/>記入欄が出る"]
  write["診察の内容を書く"]
  save["登録<br/>督促の通知が閉じる"]
  grade{"Grade を付けて<br/>追う症状がある?"}
  adverse["治療処方のカードの<br/>「有害事象」"]
  done((("記録完了")))

  entry --> from
  from -- "カルテ" --> karte --> pane
  from -- "放射線治療カレンダー" --> calendar --> pane
  from -- "通知" --> bell --> pane
  pane --> write --> save --> grade
  grade -- "はい" --> adverse --> done
  grade -- "いいえ" --> done
```

- **右ペインに出るもの**: そのコースのこれまでの週次レビューの一覧と、記入欄です。記入欄は、前回と同じ様式が選ばれています。初回は施設で決めた様式です。
- **書く内容**: 様式「放射線治療 週次レビュー」では、全身状態・体重・食事摂取、照射野の皮膚・粘膜炎・自覚症状、治療継続の判断と対応・次回予定を書きます。
- **カルテでの表示**: 週次レビューは、カルテのタイムラインにも出ます。
- **週次レビューと有害事象の違い**: 週次レビューは、その日に診てどう判断したかの記録です。有害事象は、症状 1 件ずつの記録です。
- **有害事象の入力**: CTCAE の用語・Grade・発現日・回復日・対処を入れます。入力欄は化学療法と同じです。
- **有害事象の表示**: 治療処方の詳細、カルテのタイムライン(発現日の日)、患者プロファイルの「有害事象」に出ます。

週次レビューが空いたコースは、次のように分かります。

- **カレンダーでの表示**: 治療中のコースのカードに、「診察 09-15(7 日)」のように最後の診察日と経過日数が出ます。間隔を超えたコースと「診察なし」のコースは強調されます。
- **見張るのは治療中だけ**: 処方済・計画中のコースは、照射が始まっていないので見張りません。
- **督促の通知**: 照射を記録したときに、前回の週次レビューから間隔を超えていると、指示医師に督促の通知が届きます。一度も週次レビューが無いときも届きます。
- **督促は重ねません**: そのコースに未対応の督促があれば、新しく出しません。
- **間隔**: 入院・外来を問わず同じ間隔です。
- **設定する人へ**: 間隔は「管理 > 施設設定 > 放射線治療の診察間隔」で決めます。初めは 7 日です。外来放射線照射診療料の「7 日間に 1 回」に合わせた値です。週次レビューの初回の様式も、施設設定で選びます。

### 休止・終了・中止と治療終了サマリー

```mermaid
flowchart TD
  course(("治療中のコース"))
  what{"どうする?"}
  hold["休止"]
  resume["再開(治療中へ)"]
  reschedule["残りの予定を組み直す"]
  complete["終了"]
  cancel["中止"]
  leftover{"残りの予定がある?"}
  clear["コースのカードのメニューの<br/>「予定全削除」"]
  closed["「終了・中止」の一覧に移る"]
  summary["「サマリー」"]
  write["治療経過などを書く"]
  saved["登録"]
  done((("コースを閉じた")))

  course --> what
  what -- "中断する" --> hold --> resume --> reschedule --> course
  what -- "照射を終えた" --> complete --> leftover
  what -- "途中でやめる" --> cancel --> leftover
  leftover -- "はい" --> clear --> closed
  leftover -- "いいえ" --> closed
  closed --> summary --> write --> saved --> done
```

- **理由**: 休止の理由は休止・中止理由マスタの「休止」用、中止の理由は「中止」用から選びます。
- **再開**: 再開すると、休止日と理由は消えます。残りの予定は、「予定全削除」のあと「予定登録」で組み直します。
- **休止のままやめるとき**: コースの「中止」を使います。
- **中止できる状態**: コースの「中止」は、処方済・計画中・治療中・休止のどれからでもできます。
- **残った予定は消えません**: 終了・中止しても、残っている照射予定はカレンダーに残ります。コースのカードのメニューの「予定全削除」で消します。

治療終了サマリーは、「終了・中止」の一覧のコースのカードから書きます。

| サマリーの内容 | 入り方 |
|---|---|
| 期間・回数 | 照射記録から入っている |
| 標的ごとの実照射線量 | 照射記録から入っている |
| 完遂かどうか | 入っている |
| 中止の理由 | コースの中止から引き継ぐ |
| 治療経過・急性有害事象・今後の方針 | 医師が書く |

- **印**: サマリーを書くまで、コースのカードに「サマリー未作成」と出ます。書くと、カルテの治療処方のカードに「サマリーあり」と出ます。
- **書き直し**: 書き直すと、期間・回数・線量だけが照射記録から入り直します。書いた本文は残ります。
- **標的ごとの回数**: その標的に線量を入れた回を数えます。Boost があると、標的ごとに回数が違います。

### 変更・中止・削除

| 操作 | どこから | できるとき |
|---|---|---|
| 治療処方の変更 | カルテの治療処方のカードの編集 | いつでも |
| コースの中止 | コースのカードのメニューの「中止」 | 処方済・計画中・治療中・休止 |
| 治療処方の削除 | カルテの治療処方のカード | 処方済だけ |
| DO | カルテの治療処方のカード | いつでも |
| 照射予定の削除・移動 | 予定の照射のカード | 予定だけ |

- **変更で保たれるもの**: 状態と、終了・中止・休止の日付と理由は保たれます。
- **治療中・終了の治療処方**: 標的と Phase を消せません。照射記録が、その標的と Phase に対して登録されているためです。
- **中止はカレンダーから**: カルテの治療処方のカードに「中止」はありません。
- **受付後は削除できません**: 計画中以降は、カレンダーでコースを中止するか、受付を取り消します。
- **DO**: 新しいコースとしてコピーされます。コース番号は振り直され、開始予定日は今日になります。元の依頼は引き継がず、打ち切った Phase はコピーされません。
- **実施済・未実施の照射のカード**: 動かせず、日時も変えられません。
- **Phase の打ち切り**: 治療中の Phase の打ち切り(再計画)は、画面からはまだできません。
- **入院と外来の切り替え**: 治療の途中で入院から外来に切り替わったことを表す方法は、まだありません。入院・外来の区分は、登録したときのままです。

### 放射線検査との違い

| | 放射線検査 | 放射線治療 |
|---|---|---|
| 登録する人 | 依頼医 | 放射線治療医 |
| オーダーの単位 | 検査 1 回 | 治療コース 1 件 |
| 入力する項目 | 撮影項目・部位・依頼病名・検査目的 | コース・標的・Phase |
| 入力の手間を省くもの | オーダーセット | 治療プロトコル、DO、オーダーセット |
| 日程 | 予約枠から選ぶ | 受付後に部門が照射予定を組む |
| 実施 | 1 回 | 照射 1 回ごとに記録する |
| 結果 | 読影レポート | 週次レビュー・有害事象・治療終了サマリー |
| 部門の画面 | 放射線検査一覧 | 放射線治療カレンダー |
| 登録時の警告 | 確認を要するものがある | どれも表示だけ |
| 退院 | – | 退院で止めない |
| レセコンへの送信 | 実施記録から送る | 照射記録から、照射 1 回ごとに送る |

- **登録する人**: 依頼医は、他科依頼で放射線治療科に頼みます。
- **オーダーの単位**: 治療コース 1 件は、数週間・数十回の照射になります。
- **入力する項目**: 放射線治療の項目は「登録の判定」の表にあります。
- **日程**: 放射線治療は予約枠を使いません。
- **実施**: 照射しなかった回も、理由つきで残します。
- **部門の画面**: 放射線検査一覧は日付で区切ります。放射線治療カレンダーは「全体の流れ」で説明しています。
- **退院**: 照射は外来で続くのがふつうなので、退院では止めません。

### 帳票

専用の帳票はありません。

## 開発者向け

### シーケンス図の前提

- **上流**: backend が中継する先の FHIR サーバーです。ブラウザの `/fhir` への読み書きは、backend の `FhirProxyController` が上流へ中継します。
- **書き込みは transaction**: `/fhir` への書き込みは、どれも 1 回の transaction Bundle です。週次レビューだけは、登録と督促を閉じる書き込みの 2 回になります。
- **楽観ロック**: `postBundle` が版を `ifMatch` に添え、版が違えば 412 で止まります。
- **照射記録の PUT**: 実施・この回中止・中止取消・取消・予定変更は、手元の写しではなく、読み直した版を土台にします。
- **ヘッダ**: 治療処方の `ServiceRequest` です。`basedOn` を持たない `ServiceRequest` を、オーダーのヘッダと呼びます。
- **全ページを読み切る検索**: 回数と累積線量を数える検索は、全ページを読み切れなければ結果を使いません(`searchAllPages` の `complete: true`)。
- **期間継続型**: 1 つのオーダーが期間続き、実施が日々積み上がる種別です(リハビリ・栄養指導と同じ)。照射しても進捗の Task は動かしません。
- **図の省略**: 応答は上流から backend を通ってブラウザへ戻りますが、図では上流からブラウザへの 1 本で書きます。同じ形の操作は図にせず、図の下の表に出します。
- **登場者**: 図の「放射線治療部門」は、照射の入力では診療放射線技師です。
- **SS-MIX2**: 有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。放射線治療はメッセージになりません。

| 操作 | 画面 | 組み立て | hook |
|---|---|---|---|
| 治療処方の登録 | `RadiotherapyOrderForm.tsx`、`RadiotherapyOrderPanels.tsx` | `buildRadiotherapyOrderBundle` | `useCreatePrescription` |
| 治療処方の編集 | 同じフォーム | `buildRadiotherapyOrderUpdateBundle` | `useUpdateRadiotherapyOrder` |
| 治療処方の削除 | カルテのカード | `buildRadiotherapyOrderDeleteBundle` | `deleteRadiotherapyOrderRequest` |
| 登録のときの警告 | `RadiotherapyPreCheck.tsx` | – | `useRadiotherapyAdvisories` |
| 部門の一覧 | `pages/RadiotherapyWorklistPage.tsx` | – | `useRadiotherapyWorklist`、`useRadiotherapyProcedures`、`useRadiotherapyReviews` |
| 進捗の変更 | 同じ画面 | `radiotherapyTaskActions`、`buildRadiotherapyOrderStatusEntry` | `useUpdateRadiotherapyTaskStatus` |
| 格子 | `components/RadiotherapyCalendar.tsx` | – | `useRadiotherapyCalendar` |
| 照射予定の一括登録 | `RadiotherapyPlanModal.tsx`、`RadiotherapySlotModal.tsx`(空き枠) | `draftRadiotherapyPlan`、`buildRadiotherapyPlanBundle` | `useRegisterRadiotherapyPlan` |
| 照射予定の移動・削除 | `components/RadiotherapyCalendar.tsx` | – | `useRescheduleRadiotherapyFraction`、`useDeleteRadiotherapyPlanned` |
| 照射入力 | `RadiotherapyPerformModal.tsx` | `buildRadiotherapyFractionBundle` | `useRegisterRadiotherapyFraction` |
| この回中止・中止取消 | 照射のカードのメニュー | – | `useMarkRadiotherapyFractionNotDone`、`useRestoreRadiotherapyFraction` |
| 実施済の取消 | `RadiotherapyOrderDetailPanel.tsx` | – | `useCancelRadiotherapyFraction` |
| 週次レビュー | `RadiotherapyReviewPanel.tsx` | `fhir/radiotherapyReviewHelpers.ts` | `useRadiotherapyCourseReviews`、`useCreateQuestionnaireResponse`、`useCloseRadiotherapyReviewDue` |
| 有害事象 | `RadiotherapyAdverseEventPanel.tsx`(フォームは `AdverseEventEditor`) | – | `useTreatmentAdverseEvents`、`useSaveAdverseEvent` |
| 治療終了サマリー | `RadiotherapyCourseSummaryModal.tsx` | `draftRadiotherapyCourseSummary`、`buildRadiotherapyCourseSummaryBundle` | `useSaveRadiotherapyCourseSummary` |

- **置き場所が名前と合わない hook**: `useCreatePrescription` は全種別共通の登録の hook で、`api/queries/labResult.ts` にあります。`useCreateQuestionnaireResponse` は `api/queries/patientProfile.ts` にあります。
- **hook の置き場所**: 放射線治療の hook は `api/queries/radiotherapy.ts`、有害事象は `api/queries/adverseEvent.ts` です。
- **組み立ての置き場所**: `fhir/radiotherapyOrderHelpers.ts`(治療処方)、`radiotherapyTaskHelpers.ts`(進捗)、`radiotherapyResultHelpers.ts`(予定・照射記録)、`radiotherapySummaryHelpers.ts`(サマリー)、`radiotherapyReviewHelpers.ts`(週次レビュー・督促)です。
- **部門の画面のパス**: `/radiotherapy-worklist` です。
- **モーダルを開く前の読み直し**: 入力するモーダルは、`useRadiotherapyCourseFractions` でそのコースの照射記録だけを引き直してから開きます。
- **照射記録の初期値**: `nextRadiotherapyFractionForm`(予定なし)と `radiotherapyFractionFormFromPlanned`(予定から)が作ります。
- **マスタ**: `/master/radiotherapy_{modalities,techniques,devices,stop_reasons,protocols}`(`api/masterClient/radiotherapy.ts`・`api/masterQueries/radiotherapy.ts`)。画面は「マスタメンテ > 放射線治療」です。
- **通知**: `components/notifications/notificationRegistry.tsx` の `radiotherapy-review-due` です。
- **呼び名**: 「運用フロー」の「登録のときの警告」を、コードでは安全確認(`RadiotherapyPreCheck`)と呼びます。

### リソースの構成

治療処方は、ヘッダの `ServiceRequest` 1 件です。明細は持たず、コース・標的・Phase はヘッダの拡張に入れます。進捗・照射・サマリー・週次レビュー・有害事象は、ヘッダを指す別のリソースです。

- ヘッダ `ServiceRequest`(治療処方)
    - 拡張 `radiotherapy-course`(コース)
    - 拡張 `radiotherapy-volume` × N(標的)
    - 拡張 `radiotherapy-phase` × N(Phase)
    - 拡張 `radiotherapy-consult-request`(元の依頼)
- `Task`(進捗。`focus` = ヘッダ)
- `Procedure`(照射予定・照射記録。`basedOn` = ヘッダ)
- `Procedure`(治療終了サマリー。`basedOn` = ヘッダ)
- `QuestionnaireResponse`(週次レビュー。`basedOn` = ヘッダ)
- `Observation`(有害事象。`basedOn` = ヘッダ)
- `Task`(週次レビューの督促。`focus` = ヘッダ)
- `Provenance`(代行入力。`target` = ヘッダ)

| リソース | 要素 | 中身 |
|---|---|---|
| ヘッダ `ServiceRequest` | `category` | `order-type\|radiotherapy` + `prescription-setting` |
| ヘッダ | `code` | `radiotherapy-order\|course-prescription` |
| ヘッダ | `occurrenceDateTime` | 開始予定日 |
| ヘッダ | `performer` | 担当医(任意) |
| ヘッダ | `bodySite[]` | 標的の部位の写し(JJ1017 部位・左右) |
| ヘッダ | `reasonReference` | 対象プロブレム |
| ヘッダ | 拡張 `radiotherapy-course` | courseNumber・intent・concurrentTherapy・protocol |
| ヘッダ | 同(終了・中止) | `endedOn` / `terminationReason` / `terminationNote` |
| ヘッダ | 同(休止) | `suspendedOn` / `suspensionReason` / `suspensionNote` |
| ヘッダ | 拡張 `radiotherapy-volume` | volumeId・label・type・bodySite |
| ヘッダ | 拡張 `radiotherapy-phase` | phaseId・status・modalityAndTechnique・device |
| ヘッダ | 同(回数と線量) | fractionsPrescribed・fractionsPerWeek・dosePrescribedToVolume |
| ヘッダ | 拡張 `radiotherapy-consult-request` | 元の依頼(他科依頼の `ServiceRequest`) |
| `Task`(進捗) | `code`、`focus` | `task-code\|radiotherapy`、`focus` = ヘッダ |
| `Procedure`(照射) | `category` | `order-type\|radiotherapy` + `radiotherapy-procedure\|fraction` |
| `Procedure`(照射) | `status` | `preparation` / `completed` / `not-done` / `entered-in-error` |
| `Procedure`(照射) | `statusReason` | 「この回中止」の理由 |
| `Procedure`(照射) | `code` | Phase の照射技法の写し |
| `Procedure`(照射) | `performedPeriod` | 照射の時刻。時刻なしは `performedDateTime` |
| `Procedure`(照射) | `performer`、`usedCode` | 実施者、装置 |
| `Procedure`(照射) | 拡張 `radiotherapy-fraction` | phaseId・fractionNumber・imageGuidance・doseDeliveredToVolume |
| `Procedure`(サマリー) | `category` | `radiotherapy-procedure\|course-summary` を含む |
| `Procedure`(サマリー) | `status` | `completed`(完遂)/ `stopped` |
| `Procedure`(サマリー) | `performedPeriod` | 初回〜最終照射日 |
| `Procedure`(サマリー) | `outcome` | サマリーの `outcome` |
| `Procedure`(サマリー) | 拡張 `radiotherapy-course-summary` | サマリーの拡張 |
| `QuestionnaireResponse` | `basedOn` | 週次レビュー。通常のテンプレート回答 |
| `Observation` | `category`、`basedOn` | 有害事象。`category` = `adverse-event` |
| `Observation` | `valueInteger`、`effectivePeriod` | Grade、発現〜回復 |
| `Observation` | 拡張 `treatment-context` | type = radiotherapy。化学療法と共通 |
| `Task`(督促) | `code`、`focus`、`owner` | `task-code\|radiotherapy-review-due`、ヘッダ、指示医師 |
| `Provenance` | `target` | 代行入力。種別共通 |

- **進捗の Task**: **登録時には作りません**。Task が無い治療処方は処方済です。
- **照射の `status`**: `preparation` は予定、`completed` は実施、`not-done` はこの回中止、`entered-in-error` は取消です。
- **サマリー**: 1 コースに 1 件です。
- **元の依頼**: 逆向きの参照は書かず、タイムラインが逆引きします(`karteTimeline.ts` の `radiotherapyByConsultId`)。
- **週次レビュー**: 上流の `based-on` 検索で集めます。
- **督促**: 通知レジストリの `radiotherapy-review-due` です。
- **Phase を子の `ServiceRequest` にしない理由**: 「`basedOn` を持たない `ServiceRequest` = オーダーのヘッダ」という前提を崩さないためです。同じ理由で、元の依頼も `basedOn` ではなく拡張です。
- **`volumeId` / `phaseId`**: 照射記録が指す安定キーです。編集では保ち、DO では振り直します(`buildDoRadiotherapyOrderForm`)。
- **線量**: Gy(UCUM)です。0.1 刻みの掛け算・足し算は、cGy の整数にしてから行います(`radiotherapyTotalDose`、`radiotherapyProgress`)。
- **集計**: 回数・累積線量・実施日の集計は `preparation` を数えません。

### 進捗 Task と status

他科依頼と同じく、**Task の遷移と同じ transaction で `ServiceRequest.status` も動かします**(`radiotherapyOrderStatusFor`)。
上流の `order-period` 検索は、終了日の拡張 URL が看護・食事・リハビリ・栄養指導の 4 種別に固定されていて、放射線治療では使えません。そのため、部門の一覧は status で切ります。
表示の正本は Task です(処方済・計画中・治療中は status では区別できません)。status は一覧を引くための索引です。書き込みの入口は `useUpdateRadiotherapyTaskStatus` だけです。

| Task | 表示 | `ServiceRequest.status` | ヘッダに書くもの |
|---|---|---|---|
| (無し)/ `requested` | 処方済 | `active` | – |
| `accepted` | 計画中 | `active` | – |
| `in-progress` | 治療中 | `active` | 休止・終了・中止の情報を落とす |
| `on-hold` | 休止 | `on-hold` | `suspendedOn` / `suspensionReason` / `suspensionNote` |
| `completed` | 終了 | `completed` | `endedOn` |
| `cancelled` | 中止 | `revoked` | `endedOn` / `terminationReason` / `terminationNote` |

- 遷移の表は `radiotherapyTaskActions`(`fhir/radiotherapyTaskHelpers.ts`)、ヘッダの PUT は `buildRadiotherapyOrderStatusEntry` です。
- 照射しても Task は動かしません。
- `executionPeriod` は、受付で `start`、終了で `end` が入ります。
- 休止中は `end` を入れません。処方済に戻すときと中止では、`executionPeriod` を落とします(`createTaskHelpers` の `buildTaskUpdate`)。

### シーケンス図: 治療処方の登録・編集・削除

登録です。編集は、最後の transaction の中身だけが違います。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 放射線治療医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /master/radiotherapy_*
  BE-->>UI: 選択肢
  UI->>BE: GET /fhir(過去のコースと依頼)
  BE->>FHIR: 検索
  FHIR-->>UI: 過去のコース・依頼・注意区分
  UI->>UI: 警告を出す
  Dr->>UI: 標的・Phase・線量を入れて登録
  UI->>UI: 入力を確かめる
  UI->>BE: POST /master/advisory_events
  BE-->>UI: 受理
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(版違いは 412)
```

| 読むもの・呼ぶもの | 中身 |
|---|---|
| マスタ | プロトコル・モダリティ・照射技法・装置、JJ1017 の部位 |
| 上流 | 患者の放射線治療の `ServiceRequest`、他科依頼、`Flag`、科の医師 |
| 警告 | `useRadiotherapyAdvisories` と施設の規則 |
| 入力の確認 | `validateRadiotherapyOrderForm` |
| `POST /master/advisory_events` | 出ていた警告を残す |

| 操作 | transaction の中身 |
|---|---|
| 登録 | POST ヘッダ `ServiceRequest`(fullUrl)、`Provenance`(CREATE) |
| 登録(代行・研修医) | 上に加えて `Task` `order-approval` |
| 編集 | PUT ヘッダ(`ifMatch`)、`Provenance`(UPDATE) |

- **登録**: 総線量は計算した値を書きます。登録時の入院病棟を `order-ward` に書きます。
- **編集**: status と、終了・中止・休止の情報は元から引き継ぎます。`volumeId` / `phaseId` は保ちます。

削除です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 放射線治療医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 削除
  UI->>BE: GET /fhir(治療処方と進捗)
  BE->>FHIR: 検索
  FHIR-->>UI: 治療処方と進捗
  UI->>UI: 処方済でなければ止める
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

- 検索は `ServiceRequest?_id&_revinclude=Task:focus` です。
- transaction は、ヘッダの DELETE です。

### シーケンス図: 部門の一覧と進捗の変更

部門の一覧の読み込みです。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 放射線治療部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 放射線治療カレンダーを開く
  UI->>BE: GET /fhir(治療コース)
  BE->>FHIR: 検索
  FHIR-->>UI: 治療コース
  par 回数・累積線量・サマリー
    UI->>BE: GET /fhir(コースの Procedure)
    BE->>FHIR: 検索(全ページを読み切る)
    FHIR-->>UI: 予定・照射記録・サマリー
  and 週次レビューの見張り
    UI->>BE: GET /fhir(コースの週次レビュー)
    BE->>FHIR: 検索
    FHIR-->>UI: 週次レビュー
  end
```

| 読むもの | 検索 |
|---|---|
| 治療コース(進行中) | `ServiceRequest?category=order-type\|radiotherapy&status=active,on-hold` |
| 治療コース(終了・中止) | 同じ検索で `status=completed,revoked` |
| 治療コースの共通の引数 | `based-on:missing=true`、`_sort=-authoredon`、`_include` 患者、`_revinclude` `Task:focus` |
| 予定・照射記録・サマリー | `Procedure?based-on=コース,…&category=order-type\|radiotherapy&status:not=entered-in-error` |
| 週次レビュー | `QuestionnaireResponse?based-on=コース,…` |

- `useRadiotherapyProcedures` は、表示中のコースの id を `based-on` に 20 件ずつ並べて引きます。

進捗の変更です。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 放射線治療部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: コースのカードで状態を変える
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| transaction の中身 | 補足 |
|---|---|
| `Task` を新しい状態にする | Task が無ければ POST する |
| PUT ヘッダ(`ifMatch`) | status と、終了・中止・休止の情報 |

- 状態を変える操作は、受付・治療開始・再開・各取消・終了・中止・休止です。終了・中止・休止は、日付と理由を入れます。
- 状態ごとに書くものは「進捗 Task と status」の表にあります。

### シーケンス図: 照射予定の一括登録・移動・削除

一括登録です。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 放射線治療部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(期間の照射)
  BE->>FHIR: 検索
  FHIR-->>UI: 格子に載せる照射
  Dept->>UI: 「予定登録」
  UI->>BE: GET /fhir(そのコースの Procedure)
  BE->>FHIR: 検索
  FHIR-->>UI: 照射済みの回と登録済みの予定
  UI->>BE: GET /master/holidays
  BE-->>UI: 祝日・休診日
  UI->>UI: 残りの回を割り付ける
  Dept->>UI: 確認表を直して登録
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 読むもの | 検索 |
|---|---|
| 格子の照射 | `Procedure?category=order-type\|radiotherapy&category:not=…\|course-summary&date=ge…&date=le…` |
| 格子の照射の共通の引数 | `status:not=entered-in-error`、`_include` 患者、`_include` 治療処方 |
| そのコースの照射 | `Procedure?based-on=そのコース` |

- 「予定登録」の入口は、コースのカード、カードを格子に落とす、空き枠の 3 つです。
- transaction は、POST `Procedure`(`status` = `preparation`)× 残りの回数です。Phase・回・装置・時刻を入れます。

| 操作 | 前に読むもの | transaction の中身 |
|---|---|---|
| 移動・伸縮・予定変更 | `Procedure/id`。`preparation` でなければ止める | PUT `Procedure`(日時・装置) |
| 予定削除・予定全削除 | – | DELETE `Procedure` × N |

### シーケンス図: 照射入力・この回中止・取消

照射入力です。

```mermaid
sequenceDiagram
  autonumber
  actor Dept as 放射線治療部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dept->>UI: 「実施」か「照射入力」
  UI->>BE: GET /fhir(そのコースの Procedure)
  BE->>FHIR: 検索
  FHIR-->>UI: 照射記録
  Dept->>UI: 実施者・線量を確かめて登録
  UI->>UI: 入力を確かめる
  par 督促の判定
    UI->>BE: GET /fhir(コースの週次レビュー)
    BE->>FHIR: 検索
    FHIR-->>UI: 週次レビュー
  and
    UI->>BE: GET /fhir(未対応の督促)
    BE->>FHIR: 検索
    FHIR-->>UI: 未対応の督促
  end
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 読むもの | 検索・中身 |
|---|---|
| 照射記録 | `Procedure?based-on=そのコース`。何回目・Phase・線量の初期値にする |
| 入力の確認 | `validateRadiotherapyFractionForm` |
| 週次レビュー | `QuestionnaireResponse?based-on=そのコース` |
| 未対応の督促 | `Task?code=…\|radiotherapy-review-due&focus=そのコース&status=requested` |

| transaction の中身 | 条件 |
|---|---|
| PUT `Procedure`(`status` = `completed`、同じ id) | 予定から入れたとき |
| POST `Procedure` | 予定なしで入れたとき |
| POST `Task` `radiotherapy-review-due`(`owner` = 指示医師) | 間隔を超えていて、未対応の督促が無いとき |

- 督促の判定は、`useRegisterRadiotherapyFraction` が同じ transaction に積みます。
- 進捗の Task は動かしません。

この回中止・中止取消・実施済の取消は、`Procedure/id` を読み直してから、transaction で PUT します。

| 操作 | 前提の `status` | PUT の中身 |
|---|---|---|
| この回中止 | `preparation` でなければ止める | `not-done` + `statusReason`。実施者と線量を落とす |
| 中止取消 | `not-done` でなければ止める | `preparation`。`statusReason` を落とす |
| 実施済の取消 | – | `entered-in-error`。物理削除はしない |

### シーケンス図: 週次レビュー・有害事象・治療終了サマリー

カレンダーと通知からは、カルテへ `open=radiotherapy-review:<id>` 付きで飛び、右ペインが開いた状態になります。

週次レビューです。登録と、督促を閉じる書き込みは、別の transaction です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 放射線治療医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(コースの週次レビュー)
  BE->>FHIR: 検索
  FHIR-->>UI: これまでの週次レビュー
  UI->>BE: GET /facility_settings
  BE-->>UI: 既定のテンプレートと間隔
  Dr->>UI: 記入して登録
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
  UI->>BE: GET /fhir(未対応の督促)
  BE->>FHIR: 検索
  FHIR-->>UI: 未対応の督促
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 読むもの・書くもの | 中身 |
|---|---|
| これまでの週次レビュー | `QuestionnaireResponse?based-on=治療処方`。前回のテンプレートを初期値にする |
| 施設設定 | `radiotherapy_review` の既定テンプレートと間隔 |
| 1 回目の transaction | POST `QuestionnaireResponse`(`basedOn` = 治療処方) |
| 未対応の督促 | `Task?code=…\|radiotherapy-review-due&focus=治療処方&status=requested` |
| 2 回目の transaction | PUT `Task`(`completed`、note「診察を記録しました。」) |

有害事象は、読んでから transaction を 1 回書く形です。

| 読むもの・書くもの | 中身 |
|---|---|
| そのコースの有害事象 | `Observation?based-on=治療処方&category=adverse-event` |
| 入力 | 用語・Grade・発現日など |
| transaction | POST か PUT `Observation`(`basedOn` = 治療処方、`treatment-context` = radiotherapy、`performer` = 記録した医療従事者) |

治療終了サマリーです。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 放射線治療医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: コースのカードの「サマリー」
  UI->>BE: GET /fhir(治療処方の Procedure)
  BE->>FHIR: 検索
  FHIR-->>UI: 照射記録と既存のサマリー
  UI->>UI: 期間・回数・線量を集計する
  Dr->>UI: 経過・有害事象・方針を書いて登録
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

- 検索は `Procedure?based-on=治療処方` です。
- 集計は、期間・回数・標的ごとの線量です。本文は既存のサマリーから残します。
- transaction は、初回が POST `Procedure`(course-summary)、書き直しが同じ `Procedure` への PUT です。

### 医事会計と SS-MIX2

SS-MIX2 には、どの操作も送りません(治療処方は `OMG^O19` の対象外、照射は `OMI^Z23` の対象外です)。
医事会計には、照射記録から集めて送ります(`BillingClaimBuilder` の `:procedure` 経路、`Resolvers::Radiotherapy`)。

| 送るもの | コードの出どころ | 条件 |
|---|---|---|
| 体外照射 | 照射技法マスタの `receipt_code` | その日の 1 回目の照射 |
| 体外照射 | 照射技法マスタの `receipt_code_second` | 同じ日の 2 回目の照射 |
| 放射線治療管理料 | 照射技法マスタの `management_receipt_code` | コースの初回の照射 |
| 照射部位のコメント | 施設設定 `receipt_codes.radiotherapy.site_comment` | コースの初回の照射 |

- 照射 1 回が 1 剤(医事会計に送る診療行為のまとまり)です。診療行為の区分は 840 です。
- ハブは、実施記録の親の `Procedure` です。ハブ 1 件が 1 剤になります。
- 体外照射のコードは、照射記録の照射技法から引きます。
- コースの初回の照射は、その日より前に完了した照射が無い日の照射です。照射部位のコメントは、治療処方の標的から組みます。
- 期間継続型(`continuous`)なので、照射記録の無い日のヘッダは報告しません。

| 起きたこと | 医事会計(`BillingClaimBuilder`) |
|---|---|
| 治療処方の登録・編集・削除 | なし |
| 受付・治療開始・休止・終了・中止 | なし |
| 照射予定の登録・変更・削除 | なし(`preparation` は集めない) |
| 照射(実施) | 照射日に体外照射を送る。初回は放射線治療管理料と照射部位のコメントも送る |
| 照射技法が無い、マスタにコードが無い | 「送れない項目」に出す |
| この回中止 | 「実施せずと記録されています」と報告する(送らない) |
| 照射の取消 | 対象から外れる(`entered-in-error`) |
| 週次レビュー・有害事象 | なし |
| 治療終了サマリー | 送らない(照射でないハブは resolver が読み飛ばす) |

- DPC の判定では、照射記録があることを手術・処置等のダミーコード `0008`(放射線療法)の根拠に使います。看護必要度は、コードで拾えない放射線治療を実施記録から補います([features/nursing.md](../features/nursing.md))。
