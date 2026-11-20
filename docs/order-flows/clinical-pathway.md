# クリニカルパスの業務フロー

クリニカルパスを、パス定義の作成と承認から患者への適用、病棟の日々の評価と実施、バリアンス、フェーズの進行、終了・中止まで追う流れです。
クリニカルパスは、疾患・術式ごとの入院診療の標準計画です。病日(入院日を 1 とする日数)ごとに、患者がどうなっているか・何で判断するか・何をするかを書きます。患者に適用すると、計画は**病日 × アウトカム**の表(パスシート)になり、病棟は毎日アウトカムの達成・未達成を記録します。
パスから出たオーダー(処方・注射・検査・看護指示・食事など)は、それぞれの種別の流れに乗ります。部門の受付・実施の細部は、各種別の業務フロー([看護指示](nursing.md)、[食事](meal.md)、[注射](injection.md)、[検体検査](lab.md)など)を読みます。
基本仕様は、日本医療情報学会(JAMI)と日本クリニカルパス学会(JSCP)の ePath に準じます。

医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
画面のふるまいは [features/orders-common.md](../features/orders-common.md#クリニカルパス定義マスタ)、設計は [clinical-pathway-design.md](../clinical-pathway-design.md)、不足機能は [clinical-pathway-backlog.md](../clinical-pathway-backlog.md) が正典です。

## 運用フロー

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("パスが閉じる")))

  subgraph committee["パスを管理する担当者"]
    draft["パス定義を作る"]
    approve["承認する<br/>(内容を変えられなくなる)"]
  end

  subgraph doctor["主治医"]
    apply["入院患者にパスを適用<br/>オーダーがまとめて登録される"]
    variance["バリアンスの通知を確認<br/>治療方針を見直す"]
    nextPhase{"次はどうする?"}
    phase["分岐の候補から選んで<br/>次のフェーズを適用"]
    close["終了・中止を記録"]
  end

  subgraph ward["病棟の看護師"]
    daily["その日の病日を開く<br/>実績値とタスクの実施を入れる"]
    tasks["指示簿の「パスのタスク」を実施"]
    evaluate["アウトカムを評価<br/>達成 / 未達成 / 未評価"]
  end

  subgraph dept["部門(検査室・薬剤部・リハビリなど)"]
    perform["パスから出たオーダーを<br/>受付・実施"]
  end

  start --> draft --> approve --> apply
  apply --> daily --> evaluate
  apply --> perform -. "実施済がパスシートの ☑ になる" .-> daily
  daily --> tasks --> evaluate
  evaluate -- "重要アウトカムが未達成" --> variance --> daily
  evaluate --> nextPhase
  nextPhase -- "次の病日へ" --> daily
  nextPhase -- "次のフェーズへ" --> phase --> daily
  nextPhase -- "終える・やめる" --> close --> finish
```

**このページの言葉**

| 言葉 | 意味 |
|---|---|
| パス定義 | 疾患・術式ごとに作る計画の元。承認すると患者に適用できる |
| 適用 | パス定義を 1 人の患者の入院に当てはめること。当てはめた結果も「適用」と呼ぶ |
| 病日 | 入院日を 1、入院前日を -1 とする日数 |
| アウトカム | その病日に「患者がこうなっている」という目標 |
| 観察項目 | アウトカムを何で判断するか。適正値を持てる |
| タスク | その病日に何をするか |
| オーダー雛形 | タスクに付けておくオーダーの内容。適用すると日付の入ったオーダーになる |
| バリアンス | アウトカムの未達成 |
| フェーズ | 連続する病日のまとまり。途中で道が分かれるパスで使う |
| パスシート | 適用したパスの、病日 × アウトカムの表 |

**使う画面**

| だれが | 画面 | すること |
|---|---|---|
| パスを管理する担当者 | 「マスタメンテ > クリニカルパス > パス定義」 | 定義の作成・承認 |
| 主治医 | カルテの右ペイン(右側のオーダー入力)の「クリニカルパス」 | 適用、次のフェーズ |
| 看護師・主治医 | カルテの「パス」タブ(以下、パスタブ) | 日々の評価と実施、終了・中止 |
| 看護師 | 病棟の指示簿 | オーダーを持たないタスクの実施 |

- 「パスを管理する担当者」は、パス委員会や各科のパス担当を想定した呼び方です。システムの権限ではなく、定義の作成・承認はマスタメンテから誰でも行えます。
- パスシートの記録は、どの職種でも行えます。記録者は、ログイン中の本人です。
- 部門は、パスから出たオーダーかどうかを気にせず、通常どおり受け付け・実施します。パスから出たオーダーには、カルテのカードに「パス」のバッジが出ます。
- 1 つの入院に、複数のパスを重ねて適用できます(術後に別のパスへ移るなど)。同じパスを同じ入院に二重には適用できません。

### パス定義の状態

| 状態 | 適用 | 内容の変更 |
|---|---|---|
| 下書き | できない | できる |
| 承認済 | 有効期間内ならできる | できない。複製して直す |
| 廃止 | できない | できない。使った記録として残す |

- 承認済の内容は変えられません。状態・有効期間・表示順は変えられます。
- 承認済を直すときは、複製して下書きで直し、承認し直して、元を廃止します。複製すると、版の小さい桁が 1 つ上がります。進行中の患者は、元の定義のまま進みます。
- 承認済を下書きに戻せるのは、**患者に 1 件も適用していない**パスだけです。適用済みのパスは、次のフェーズを定義から作るので、定義を直すと食い違うためです。
- 削除できるのは下書きだけです。承認済は廃止にします。
- 承認の条件は「パス定義の作成と承認」にあります。

### 適用の状態

| 状態 | 意味 | 変わるきっかけ | できること |
|---|---|---|---|
| 進行中 | 評価・実施を記録している | 適用、終了の記録の取り消し | 評価・実施と、下の「進行中にできる操作」 |
| 終了 | 予定どおりに終えた | 「終了・中止」で終了を選ぶ、分岐で「パスを終了」を選ぶ | 読む、ePath 出力、終了の記録の取り消し |
| 中止 | 途中でやめた(理由を残す) | 「終了・中止」で中止を選ぶ | 読む、ePath 出力、終了の記録の取り消し |

**進行中にできる操作**

- 次のフェーズの適用
- 予定外の追加
- 日程の変更
- 終了・中止
- 適用の取り消し(評価・実施・部門の受付が 1 つも無いときだけ)

**注意すること**

- 終了・中止は**手で記録**します。退院や最終病日の到来で、自動的には終わりません。
- 「適用の取り消し」は、適用そのものを消します。状態が変わるのではなく、適用しなかったことになります。
- 評価・実施・部門の受付が 1 つでもあれば、適用の取り消しはできません。そのときは中止にします。
- 進み具合(未評価・バリアンス・未実施の件数)は、パスタブのオーバービューの見出しに出ます。

このページでは、「取り消し」を 3 つに呼び分けます。

| 呼び名 | 何を取り消すか |
|---|---|
| 適用の取り消し | 適用そのもの。パスシートと、パスから出たオーダーを消す |
| 終了の記録の取り消し | 終了・中止の記録。進行中に戻す |
| フェーズの取り消し | 最後に適用したフェーズ。前のフェーズまで戻す |

### パス定義の作成と承認

```mermaid
flowchart TD
  open(("パス定義を開く"))
  from{"どこから作る?"}
  new["新規"]
  copy["承認済を複製<br/>(下書きになり、版が上がる)"]
  edit["内容を作る<br/>→ 下の「作る内容」"]
  preview["プレビューで<br/>パスシートを確かめる"]
  save["保存(下書き)"]
  approveQ{"承認する?"}
  check{"承認の条件を満たす?"}
  error["足りない項目を表示<br/>下書きのまま"]
  approved((("承認済<br/>適用できる")))
  draftEnd((("下書きのまま")))

  open --> from
  from -- "新しく作る" --> new --> edit
  from -- "承認済を直す" --> copy --> edit
  edit --> preview --> save --> approveQ
  approveQ -- "いいえ" --> draftEnd
  approveQ -- "はい" --> check
  check -- "いいえ" --> error --> edit
  check -- "はい" --> approved
```

**作る内容**

| 順 | 作るもの | 中身 |
|---|---|---|
| 1 | 基本情報 | 名称・診療科・入外・予定日数・版・適応基準・対象病名 |
| 2 | 病日 | 入院前日から退院日までを並べる |
| 3 | アウトカム・観察項目・タスク | 病日ごとに置く |
| 4 | 続き | 同じアウトカム・タスクを翌日以降にも置く |
| 5 | オーダー雛形 | タスクに付ける。処方・注射・検査・看護指示・食事など |
| 6 | フェーズ(任意) | 途中で道が分かれるパスだけ。分岐先と選ぶ目安を登録する |

- **複製**: 複製した定義は、新しいコードの下書きになります。
- **病日**: 手術当日は、術前と術後に分けられます。
- **アウトカム・観察項目・タスク**: 1 つのアウトカムと、それを判断する観察項目、行うタスクを 1 組にして置きます。画面ではこの組を「OAT ユニット」と呼びます。
- **重要アウトカム**: アウトカムに重要の印(★)を付けられます。未達成にしたとき、主治医に通知が届きます。
- **観察項目とタスク**: 観察項目には適正値、タスクには分類を付けます。
- **続き**: 概要表(定義の編集画面の末尾の、病日 × アウトカムの表)のセルから足します。パスシートでは 1 行に並びます。
- **続きでそろうもの**: 名前・コード・雛形は続き全体でそろいます。適正値は日ごとに変えられます(術後 1 日目は疼痛 3 以下、4 日目は 2 以下など)。
- **オーダー雛形**: 雛形を付けないタスクは、チェックで実施を記録するチェックリストになります。
- **プレビュー**: 入院日を仮に入れて、パスシートを確かめられます。

**承認の条件**

| 対象 | 条件 |
|---|---|
| すべてのパス | 適応基準がある |
| すべてのパス | 予定日数がある |
| すべてのパス | 版が「1」「1.1」の形式である |
| すべてのパス | 病日が 1 つ以上ある |
| すべてのパス | すべての病日にアウトカムが 1 つ以上ある |
| すべてのパス | オーダー雛形を付けたタスクの、雛形の中身が空でない |
| すべてのパス | 予定日数が、標準の経路の最終病日以上である |
| すべてのパス | どのフェーズにも病日がある |
| フェーズを分けたパス | フェーズ名がある |
| フェーズを分けたパス | 分岐が循環していない |
| フェーズを分けたパス | 開始フェーズから、すべてのフェーズに進める |
| フェーズを分けたパス | フェーズの中の病日が連続している |
| フェーズを分けたパス | 分岐先のフェーズが、前のフェーズの最終病日の翌日から始まる |

- 標準の経路は、各フェーズの分岐の先頭をたどった経路です。
- 下書きの保存でも、次のものは保存できません。同じ病日の重複、フェーズに属さない病日、分岐先が同じフェーズか存在しないフェーズ、その病日に無いタスクを選んだ主要イベント。

**コードと適正値**

- アウトカム・観察項目は、BOM(日本クリニカルパス学会の Basic Outcome Master)または施設のコードを持てます。
- BOM の配布ファイルは、施設が学会から取得して「マスタ取込」で取り込みます。
- BOM を取り込んだ施設では、「選択」で名称からコードを探せます。アウトカムを選ぶと、そのアウトカムに属する観察項目の候補をチェックで選べます。取り込んでいない施設は手入力です。
- 看護観察(MEDIS)に結んだ観察項目は、適正値を数値の範囲や許容値として登録できます。適用後の評価で実績値に ○ / ✕ が付き、達成状態の提案に使われます。

**主要イベント**

- 病日の「主要イベント」で、手術・内視鏡・放射線治療のタスクを選んでおくと、適用後のパスシートに実施の時刻つきで出ます。

**サンプル**

- 次の 5 つが下書きで入っています。4 泊 5 日の腹腔鏡下胆嚢摘出術、1 泊 2 日の大腸ポリープ切除、2 泊 3 日の鼠径ヘルニア、7 日間の市中肺炎、分岐つきの市中肺炎。

### 適用の判定

適用は、カルテの右ペインの「クリニカルパス」で、次の順に入力してから「適用」を押します。

1. 承認済で有効期間内のパスを選ぶ。
2. 適用先を選ぶ。入院中(既定)、入院予定、指定しない、のどれか。
3. 入院日を確かめる。入院日が病日 1 になる。
4. 適応基準を読み、「適応基準を確認した」にチェックする。
5. 対象病名を選ぶ。定義の対象病名と一致する病名は、既定でチェックが付いている。
6. オーダーの区画を確かめる。出さない行はチェックを外す。
7. 依頼医師を選ぶ。

```mermaid
flowchart TD
  submit(("適用を押す"))
  check{"入力は条件を満たす?"}
  error["入力エラーを表示<br/>何も登録されない"]
  valid{"各オーダーの入力は正しい?"}
  fix["その行が開く<br/>直してもう一度押す"]
  send["パスシートとオーダーを<br/>まとめて登録"]
  result{"登録できた?"}
  failed["エラーを表示<br/>何も登録されない"]
  done((("適用完了<br/>パスタブが開く")))

  submit --> check
  check -- "いいえ" --> error
  check -- "はい" --> valid
  valid -- "いいえ" --> fix
  valid -- "はい" --> send --> result
  result -- "いいえ" --> failed
  result -- "はい" --> done
```

**入力の条件**

| 項目 | 条件 |
|---|---|
| 適応基準 | 「適応基準を確認した」にチェックしている |
| 入院日 | 入っている |
| 同じパス | 同じ入院に、同じパスが進行中でない |
| 依頼医師 | 選んでいる |
| 各オーダー | 種別ごとの入力の条件を満たす(左右・採取部位・処方区分など) |

- 別のパスが進行中のときは、注意が出ますが、そのまま適用できます。
- オーダーの入力に誤りのある行が 1 つでもあると、何も登録されず、その行が開きます。
- 雛形が外来で作られていると、処方区分が空になっていることがあります。

**入院日**

- 入院予定に適用すると、入院日はその予定の日付です。予定の日付が未定なら、当日が入ります。
- 入院日を変えると、病日ごとの日付の表と、オーダーの開始日も変わります。

**登録されるオーダー**

オーダーの区画には、雛形を持つタスクが病日順に並びます。開始日は、その病日の日付です。

| 種別 | オーダーの数 | 終わる日 |
|---|---|---|
| 看護指示 | 続く病日で 1 件 | 続きの最終日 |
| 食事・安静度 | 病日ごとに 1 件 | 次の食事・安静度が始まる直前 |
| そのほか(注射・検査・処方など) | 病日ごとに 1 件 | 種別ごと |

- フェーズを分けたパスは、最初は開始フェーズの病日とオーダーだけを登録します。
- 予約が要る項目(CT・MRI・内視鏡など)は、適用では予約されません。適用後に、部門の予約で枠を取ります。
- 代行入力は、ほかのオーダーと同じです。承認待ちの通知は、パスから出たオーダーに付きます。パスの適用そのものには付きません。

### 日々の評価と実施

パスタブには、2 つの見方があります。

| 見方 | 中身 | 使いどころ |
|---|---|---|
| 「オーバービュー」(既定) | パスシート。紙のパスシートと同じ表 | 全体を見る。セルから 1 件ずつ開く |
| 「日めくり」 | 1 病日ずつ、アウトカムのカードが並ぶ | その日の達成状態・実績値・タスクの実施をまとめて入れる |

**開き方**

| どこから | 開くもの |
|---|---|
| カルテの「パス」タブ | パスタブ。「日めくり」で今日の病日を開く |
| 入院患者一覧・患者ヘッダのパス名 | パスタブ |
| バリアンスの通知の「カルテ」 | その病日の日めくり |
| 病棟の指示簿の「パスのタスク」の氏名 | その病日の日めくり |

```mermaid
flowchart TD
  open(("日めくりで<br/>今日の病日を開く"))
  input["実績値・タスクの実施・<br/>達成状態を入れる"]
  record["「記録(n 件)」を押す"]
  unwritten{"記載の無い未達成がある?"}
  prompt{"記載を書く?"}
  writing["評価モーダルで記載を書く"]
  critical{"重要アウトカム(★)を<br/>未達成にした?"}
  notify["入院の主治医に<br/>「パスのバリアンス」の通知"]
  done((("記録完了")))

  open --> input --> record --> unwritten
  unwritten -- "はい" --> prompt
  unwritten -- "いいえ" --> critical
  prompt -- "はい(記載を書く)" --> writing --> critical
  prompt -- "いいえ(このまま記録)" --> critical
  critical -- "はい" --> notify --> done
  critical -- "いいえ" --> done
```

**日めくりで入れるもの**

| 入れるもの | 中身 |
|---|---|
| 実績値 | 観察項目の値。経過表の値が候補のボタンで出る |
| タスクの実施 | チェックリストのタスクにチェックする |
| 達成状態 | 達成 / 未達成(バリアンス)/ 未評価から選ぶ |

- 実績値が適正値の範囲なら ○、外れたら ✕ が付きます。✕ があれば、未達成が提案されます。
- 「記録(n 件)」で保存されるのは、変えたアウトカムだけです。
- 記載の無い未達成があると、「記載なしのバリアンスが n 件」と出ます。「記載を書く」か「このまま記録」を選びます。
- 記載は評価モーダルで書きます。SOAP か自由記載で、テンプレートも使えます。コメントも評価モーダルで書きます。

**オーバービューから開くもの**

- アウトカムのセルを押すと、評価モーダルが開きます。
- タスクのセルを押すと、そのオーダーの詳細が開きます。看護指示は実施入力が開きます。

**タスクに ☑ が付く条件**

| タスクの種類 | ☑ が付くとき |
|---|---|
| オーダーを持たないチェックリスト | パスタブか指示簿でチェックしたとき |
| 看護指示・リハビリ・栄養指導を結んだタスク | その日の実施記録があるとき |
| そのほかのオーダーを結んだタスク | 部門がオーダーを実施済みにしたとき |

- 下の 2 つは、パスタブではチェックできません。
- オーダーの詳細から「実施入力」へ進める種別は、注射・輸血・放射線・生理・内視鏡・処置・手術・リハビリ・栄養指導です。部門の受付を済ませていなくても実施できます。
- 検体検査・病理・細菌・他科依頼・食事・処方は、部門や経過表で記録します。

**指示簿の「パスのタスク」**

- 病棟の指示簿の「パスのタスク」には、その病日の、オーダーを持たないタスク(観察・説明・文書など)が並びます。チェックで実施にします。
- パスから出た看護指示は同じ画面の上の表に、そのほかのオーダーは各部門の画面に出ます。「パスのタスク」には重ねて出ません。
- 「パスのタスク」に指示受けは要りません。

**病日の総合評価**

- 医師は、病日ごとに総合評価を 1 件書けます。
- パスを終了・中止するときに書く総合評価とは別のものです。

**評価の履歴**

- 同じアウトカムを 1 日に何度評価しても、全部残ります。パスシートのセルには「×n」が付き、評価モーダルに履歴が並びます。
- 実績値は、前回と変えたものだけが新しく記録されます。空にしても、前の値は消えません。

**バリアンスの通知**

- 通知は、重要アウトカム(★)を未達成にしたときだけ届きます。宛先は入院の主治医で、通知の強度は「注意」です。
- 未達成のまま記録し直しても、通知は出し直されません。達成・未評価に直すと、未対応の通知は取り下げられます。
- 主治医は、通知の「確認」で対応済みにします。

**カルテのタイムライン**

- 記載のある評価と、病日の総合評価は、カルテのタイムラインに「パス評価」のカードとして、記録日時の日に出ます。
- 達成状態だけの評価は、カードになりません。

### フェーズの進行

```mermaid
flowchart TD
  start(("フェーズの最終病日を終える"))
  icon["パスタブの見出しの<br/>「次のフェーズを適用」"]
  choose["分岐の候補から選ぶ"]
  which{"選んだのは次のフェーズ?"}
  closeFlow["終了・中止の入力へ"]
  form["右ペインの適用フォーム<br/>開始日とコメントを入れる"]
  orders["そのフェーズのオーダーを<br/>確かめる"]
  apply["適用"]
  sheet["パスシートに<br/>フェーズの段が増える"]
  wrong{"選び間違えた?"}
  undo["パスタブの見出しのメニューの<br/>「フェーズの取り消し」"]
  finish((("次のフェーズが進行中")))
  closed((("終了・中止へ")))

  start --> icon --> choose --> which
  which -- "いいえ(「パスを終了」)" --> closeFlow --> closed
  which -- "はい" --> form --> orders --> apply --> sheet --> wrong
  wrong -- "はい" --> undo --> icon
  wrong -- "いいえ" --> finish
```

**分岐**

- 分岐は、市中肺炎の「3 日目の効果判定で、継続か抗菌薬変更か」のような、道の分かれ目に使います。分岐の先頭が標準の経路です。
- 候補には、フェーズ名と選ぶ目安が出ます。「パスを終了」も選べます。
- 「次のフェーズを適用」は、候補があるときだけ出ます。最後のフェーズを終えたら出ません。

**次のフェーズの適用**

- 開始日の既定は、前のフェーズの翌日です。適用済みの最後の病日より後にします。前のフェーズの最終日より早くはできません。
- 選んだ理由をコメントに書けます。選んだ目安とコメントは、パスシートに残ります。
- 前のフェーズの食事・安静度は、新しいフェーズの開始の直前で終わります。

**フェーズの取り消し**

- 戻せるのは、最後に適用した 2 つ目以降のフェーズだけです。
- 条件は適用の取り消しと同じで、そのフェーズの病日に記録があれば取り消せません。
- 前のフェーズの食事・安静度に入った終了日は、取り消しても戻りません。

### 予定外・日程の変更・終了・中止・取り消し

どれも進行中の適用に行う操作で、パスタブの見出しから行います。

**予定外の追加と日程の変更**

```mermaid
flowchart TD
  course(("進行中の適用"))
  what{"どの操作をする?"}
  unplanned["「予定外を追加」<br/>病日を選んでアウトカムを足す"]
  shift["「日程の変更」<br/>起点の病日と新しい日付を選ぶ"]
  shiftCheck{"起点から後ろに<br/>記録がある?"}
  shiftNg["理由が出て、変更されない"]
  shiftOk["起点から後ろの<br/>病日の日付が動く"]

  course --> what
  what -- "予定に無いアウトカムが要る" --> unplanned --> course
  what -- "入院日・手術日が動いた" --> shift --> shiftCheck
  shiftCheck -- "はい" --> shiftNg --> course
  shiftCheck -- "いいえ" --> shiftOk --> course
```

- **予定外の追加**: アウトカムを 1 件足します。観察項目・タスク・オーダーも付けられます。付けたオーダーは、アウトカムと一緒に登録されます。
- **予定外の見え方**: パスシートでは「予定外」の印の付いた行になります。評価・実施は、予定どおりのアウトカムと同じように記録できます。
- **日程の変更**: 起点の病日から後ろを、まとめてずらします。起点から後ろに評価・実施の記録があると、変更できません。

日程の変更でのオーダーの扱いは、種別で違います。

| 種別 | 日付 |
|---|---|
| 看護指示・食事 | 自動で動く |
| そのほか(注射・検査・手術・処置など) | 動かない。1 件ずつ直す |

- 動かないオーダーには、パスシートのセルに「日付違い」の印が出ます。オーダーの詳細の「編集」で、1 件ずつ直します。
- 自動で動かさないのは、明細・予約・部門の受付を伴うためです。

**終了・中止と適用の取り消し**

```mermaid
flowchart TD
  course(("進行中の適用"))
  what{"どの操作をする?"}
  closing["「終了・中止」<br/>終了日と区分を入れる"]
  closed((("終了または中止")))
  reopen["終了の記録の取り消し"]
  cancel["パスタブの見出しのメニューの<br/>「適用の取り消し」"]
  cancelCheck{"評価・実施・部門の受付が<br/>1 つでもある?"}
  cancelNg["理由が出て、取り消されない"]
  cancelOk["パスシートとオーダーが消える"]
  gone((("適用しなかったことになる")))

  course --> what
  what -- "終える・やめる" --> closing --> closed
  closed -. "誤って閉じた" .-> reopen --> course
  what -- "間違えて適用した" --> cancel --> cancelCheck
  cancelCheck -- "はい" --> cancelNg --> closing
  cancelCheck -- "いいえ" --> cancelOk --> gone
```

- **終了と中止**: 終了は予定どおり終えたとき、中止は途中でやめたときです。「終了・中止」で、終了日・区分・中止理由・総合評価を入れます。
- **退院との関係**: 退院しても、パスは自動では終わりません。退院後に進行中のまま残らないよう、退院の前後に終了を記録する運用にします。
- **終了・中止の後**: 「予定外を追加」「日程の変更」「次のフェーズを適用」は出なくなります。未実施のタスクは、そのまま残ります。同じ入院に、同じパスをもう一度適用できます。
- **終了の記録の取り消し**: 間違えて閉じたときは、「終了の記録」から取り消して、進行中に戻せます。
- **適用の取り消し**: パスシートと、パスから出たオーダーが消えます。誰が適用したかの記録は残ります。
- **取り消しで消えるオーダー**: オーダーごとに、カルテのカードから削除したときと同じ結果になります(予約の取消、テンプレートの記入の削除など)。看護指示も、ふだんは中止で残しますが、適用の取り消しでは消えます。
- **取り消しが途中で失敗したとき**: もう一度「適用の取り消し」を開くと、残ったオーダーから続けられます。

### 変更・中止・削除

| 操作 | できること |
|---|---|
| 定義の変更 | 下書きは自由に変えられる。承認済は複製して直す |
| 定義の削除 | 下書きだけ。承認済は廃止にする |
| 適用後の計画の変更 | 予定外の追加と、日程の変更だけ |
| パスから出たオーダーの変更 | 通常のオーダーと同じ |
| 終了・中止 | パスタブの見出しの「終了・中止」から記録する |
| 適用の取り消し | 何も記録していない進行中の適用だけ |
| 評価の訂正 | 記録し直す |

- **適用後の計画**: 病日や、予定どおりのアウトカムを消す手段はありません。予定外のアウトカムも、名前は直せません。
- **オーダーの変更**: カルテのカードか、パスタブのオーダーの詳細の「編集」から行います。オーダーを直しても、パスの計画は変わりません。
- **評価の訂正**: 達成状態・記載は記録し直すと、前の評価は履歴に残ります。実績値は、正しい値をもう一度記録します。前の値は消えません。

### ほかの画面とのつながり

| 画面 | クリニカルパスとの関係 |
|---|---|
| カルテの時系列 | パスから出たオーダーのカードに「パス」のバッジが出る。評価は「パス評価」のカードになる |
| 病棟の指示簿 | 看護指示の表の下に「パスのタスク」が出る |
| 入院患者一覧・患者ヘッダ | 進行中のパス名が出る。押すとパスタブが開く |
| 通知 | 「パスのバリアンス」が入院の主治医に届く |
| 経過表 | 経過表の値が、実績値の候補に出る |
| 部門の一覧(検査・放射線・リハビリなど) | パスから出たオーダーが通常どおり並ぶ |
| データ抽出・ダッシュボード | 「パス」タブに、適用 1 件が 1 行で出る |
| ePath 出力 | 定義と、患者に適用したパスを XML でダウンロードできる |

- **カルテの時系列**: バッジのツールチップにパス名が出ます。「パス評価」のカードになるのは、記載のある評価と病日の総合評価です。
- **病棟の指示簿**: パスから出た看護指示は上の看護指示の表に出ます。続く病日は 1 件の指示です。
- **通知**: 通知の「カルテ」でその病日の日めくりが開き、「確認」で対応済みになります。
- **経過表**: 候補に出るのは、看護観察に結んだ観察項目です。候補を押して記録したときだけ、パスの実績値になります。パスの実績値は経過表には出ません。
- **部門の一覧**: 部門が実施済みにすると、パスシートの ☑ になります。パスタブのオーダーの詳細の「実施入力」からも、部門と同じ実施入力を開けます。
- **データ抽出・ダッシュボード**: 列は、状態・終了区分・予定日数と実日数・評価とバリアンスの件数・中止理由です。クラスタ・指標にも使えます。
- **ePath 出力**: 施設パスは定義の編集画面から、患者に適用したパスはパスタブの見出しのメニューから出します。適用したパスには、評価・実施・総合評価が含まれます。形式は JAMI 標準の XML です。

### 帳票

専用の帳票はありません。パスシートを外へ持ち出すときは、ePath 出力(JAMI 標準の XML)を使います。パスから出たオーダーの帳票(処方箋・注射箋・ラベルなど)は、各種別の帳票がそのまま出ます。

### オーダーセット・レジメンとの違い

| | オーダーセット | レジメン(化学療法) | クリニカルパス |
|---|---|---|---|
| 何を表すか | 医師がいつも出す組み合わせ | 化学療法の治療計画の雛形 | 疾患・術式ごとの入院診療の標準計画 |
| 持ち主 | 院内共通 / 診療科 / 医師 | 院内共通(承認制) | 院内共通(承認制) |
| 時間軸 | 無い(適用した日に全部出す) | 相対日(Day 1・8・15) | **病日**(入院日 = 1、入院前日 = -1) |
| 適用の単位 | 1 回で全部 | クール | **フェーズ**(分岐の無いパスは一括) |
| 適用後に残るもの | オーダーだけ | 適用の記録と投与日のオーダー | **パスシート**(病日ごとの計画)とオーダー |
| 評価 | 無い | 投与可否の確認 | **アウトカムの達成 / 未達成(バリアンス)**を病日ごとに記録 |
| 日々見る人 | なし | 化学療法室 | 病棟の看護師と主治医 |
| 終わり方 | なし | 完了・中止 | 終了・中止(手で記録) |

## 開発者向け

### シーケンス図の前提

**書き込みの経路**

- `/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
- SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。対象と対象外は「医事会計と SS-MIX2」にあります。
- 楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。
- 定義は FHIR を通らず、backend の DB だけに置きます。

**このページの呼び名**

| 呼び名 | 指すもの |
|---|---|
| 上流 | backend が中継する先の FHIR サーバー |
| 定義 | backend の DB に置くパス定義(`master_pathways` と子) |
| 適用 | 患者に適用したパス。上流の `CarePlan` の木 |
| 木・根 | 適用の `CarePlan`(根)と、それを `partOf` で指す子孫 |
| OAT ユニット | 1 つのアウトカム + それを判定する観察項目 + 実施するタスクの組 |
| ヘッダ | パスから出たオーダーの `ServiceRequest` |
| 雛形から出たオーダー | 運用フローの「パスから出たオーダー」 |
| パスの印 | `category` の `care-plan-type\|clinical-pathway`(`PATHWAY_MARKER_SYSTEM` / `PATHWAY_MARKER_CODE`) |
| 厳密な検索 | `Prefer: handling=strict` を付けた検索。上流が知らない条件を読み飛ばさず、エラーにする |
| EP12 | ePath の適用後パスデータ |

**図の書き方**

- 図では、上流から backend を通ってブラウザへ返る応答を、上流からブラウザへの 1 本の矢印で書きます。
- 検索の条件と transaction の中身は、図の下の表に書きます。
- 登場者の「主治医」「病棟の看護師」は、運用フローの部署に合わせた名前です。パスシートの記録はどの職種でも行えます。

### リソースの構成

定義は backend の DB、適用後は上流 FHIR に ePath 準拠の `CarePlan` の木で置きます。

- 適用(`CarePlan`。根)
  - 病日(`CarePlan`。`partOf` = [適用])
    - OAT ユニット(`CarePlan`。`partOf` = [適用, 病日])
      - 観察項目(`CarePlan`。`partOf` = [適用, 病日, OAT ユニット])
        - タスク(`Procedure`。`basedOn` = [観察項目の `CarePlan`, オーダーのヘッダ])
        - 適正値(`Goal`。観察項目の `goal` が指す)
        - 観察項目の実績(`Observation`。`basedOn` = 観察項目)
      - アウトカムの評価(`Goal` + `Observation`。`basedOn` = OAT ユニット)
    - 病日の総合評価(`Observation`。`basedOn` = 病日)
- 適用に付くもの: 終了・中止(`Goal`)、来歴(`Provenance`)、バリアンスの通知(`Task`)
- 雛形から出たオーダー(各種別の `ServiceRequest`。タスクから指す)

**定義(backend の DB)**

| もの | 置き場所 | 中身 |
|---|---|---|
| パス定義 | `master_pathways` と子 | 子は対象病名・フェーズ・分岐・病日・OAT ユニット・観察項目・タスク |
| 子の結び方 | `pathway_code` | 子は 1 リクエストで丸ごと置換する |
| 識別子 | `*_key`(uuid) | OAT ユニット・観察項目・タスクの識別子。画面が採り、適用後の識別子に持ち越す |
| オーダー雛形 | `order_type` + `order_values`(jsonb) | オーダーセットのエントリと同じ形 |
| BOM | `master_bom_outcomes` / `master_bom_assessments` / `master_bom_pairs` | 取込で全件を洗い替える。検索専用 |

**計画の木**

| リソース | 要素 | 中身 |
|---|---|---|
| `CarePlan`(適用) | `partOf` | 無し(根) |
| `CarePlan`(適用) | `category` | `care-plan-type\|clinical-pathway` + `pathway-level\|apply` |
| `CarePlan`(適用) | `instantiatesUri` | `…/pathway/{code}` |
| `CarePlan`(適用) | `identifier` | `apply-id\|{施設コード}.{適用uuid}` |
| `CarePlan`(適用) | `addresses` | 対象病名 |
| `CarePlan`(適用) | `encounter` | 入院 |
| `CarePlan`(適用) | `period.start` | 入院日 |
| `CarePlan`(適用) | 拡張 `pathway-version` | 版 |
| `CarePlan`(病日) | `category` | `pathway-level\|event` |
| `CarePlan`(病日) | `identifier` | `event-id\|….{病日[-ステップ]}` |
| `CarePlan`(病日) | `period` | `start` = `end` = その日 |
| `CarePlan`(病日) | 拡張 `pathway-phase` | フェーズ |
| `CarePlan`(病日) | 拡張 `pathway-phase-note` | 選んだ目安の写しとコメント |
| `CarePlan`(病日) | 拡張 `pathway-major-event` | 主要イベント |
| `CarePlan`(OAT ユニット) | `category` | `pathway-level\|oat-unit`、BOM の大分類・中分類・コード、重要アウトカム |
| `CarePlan`(OAT ユニット) | `identifier` | `oat-unit-id\|….{unit_key}` |
| `CarePlan`(OAT ユニット) | `EPathCarePlanUnplannedKind` | 予定外は `Y` |
| `CarePlan`(OAT ユニット) | `goal` | アウトカムの `Goal`(評価後) |
| `CarePlan`(観察項目) | `category` | `pathway-level\|assessment` |
| `CarePlan`(観察項目) | `identifier` | `assessment-id\|….{assessment_key}` |
| `CarePlan`(観察項目) | `goal` | 適正値の `Goal` |
| `Goal`(適正値) | `identifier` | `assessment-goal-id` |
| `Goal`(適正値) | `target` | `detailString` / `detailRange` / `detailCodeableConcept` |
| `Procedure`(タスク) | `basedOn` | 観察項目の `CarePlan` と、オーダーのヘッダ |
| `Procedure`(タスク) | `status` | `preparation`(未実施)/ `completed`(実施) |
| `Procedure`(タスク) | `performedDateTime`・`performer` | 実施の日時と実施者 |
| `Procedure`(タスク) | 拡張 `EPathProcedureTaskPlannedDateTime` | 予定日 |
| `Procedure`(タスク) | 拡張 `pathway-display-order` | 定義の並び順 |
| `ServiceRequest`(雛形から出たオーダー) | `identifier` | `pathway-instance\|{適用uuid}` |
| `ServiceRequest`(雛形から出たオーダー) | 拡張 `pathway-order` | valueCoding = パスコード・名前 |
| `ServiceRequest`(雛形から出たオーダー) | `requisition` | 同じ uuid |
| `Provenance`(来歴) | `target` | 適用の `CarePlan`。1 件 |
| `Provenance`(来歴) | `agent` | author = 依頼医師、enterer = ログイン本人 |

- 子孫は `partOf` に祖先すべてを並べます。`part-of=CarePlan/{適用}` の 1 回で木全体、`part-of:missing=true` で根だけが引けます。
- 階層は `pathway-level` の category で判定します。`partOf` の本数でも導けますが、木を全部読まないと分かりません。この category は EP12 出力では落とします。
- 結ぶ観察項目の無いタスクは、コード `ZZZZZZZZZZ` の観察項目で包みます。ePath の「タスクのみの観察項目」を表す固定コードです(`EMPTY_ASSESSMENT_CODE`)。
- 参照は、タスクからオーダーへの一方向です。
- 雛形から出たオーダーには、種別共通の来歴も付きます。代行入力なら承認待ちの通知が付きます。
- 雛形から出たオーダーかどうかは、ヘッダの `identifier`(`pathway-instance`)と拡張 `pathway-order` で判定します(`pathwayOf`)。
- 適用の木は 1 ページ(500 件)を超えうるので、`usePathwayApplicationTree` は total から残りのページも読みます。

**評価と記録**

| リソース | 要素 | 中身 |
|---|---|---|
| `Goal`(アウトカムの評価) | `identifier` | `outcome-goal-id` = OAT ユニットの識別子 |
| `Goal`(アウトカムの評価) | `achievementStatus` | `EPathStateOfAchievementCS` の 1 達成 / 2 未達成 / 3 未評価。最新の値 |
| `Goal`(アウトカムの評価) | `outcomeReference` | 評価の `Observation` を記録順に全部 |
| `Observation`(評価) | `identifier` | `observation-evaluation-id` = `….{記録番号}` |
| `Observation`(評価) | `code` | `EPathEvaluationItemCS\|judgement` |
| `Observation`(評価) | `component` | S / O / A / P、または `comp-assessment`(自由記載) |
| `Observation`(評価) | `category[0]` | パスの印 |
| `Observation`(評価) | `basedOn` | OAT ユニット |
| `Observation`(観察項目の実績) | `identifier` | `observation-result-id` = `….{assessment_key}.{記録番号}` |
| `Observation`(観察項目の実績) | `code` | 観察項目のコード |
| `Observation`(観察項目の実績) | `value[x]` | 看護観察の表現タイプ |
| `Observation`(観察項目の実績) | `basedOn` | 観察項目の `CarePlan` |
| `Observation`(病日の総合評価) | `identifier` | `observation-comp-assessment-id` = 病日の識別子 |
| `Observation`(病日の総合評価) | `code` | `comp-assessment` |
| `Observation`(病日の総合評価) | `valueString` | 総合評価の文 |
| `Observation`(病日の総合評価) | `basedOn` | 病日の `CarePlan` |
| `Goal`(終了・中止) | `identifier` | `apply-goal-id` = 適用の識別子 |
| `Goal`(終了・中止) | `lifecycleStatus` | `completed` / `cancelled` |
| `Goal`(終了・中止) | 拡張 `EPathGoalStatusReason` | `EPathPathClosingTypeCS` の 1 終了 / 2 中止 |
| `Goal`(終了・中止) | `statusDate` | 終了日 |
| `Goal`(終了・中止) | `note` | 中止理由(「中止理由: 」で始める)と総合評価 |
| `Task`(バリアンスの通知) | `code` | `task-code\|pathway-variance` |
| `Task`(バリアンスの通知) | `priority` | `urgent`。運用フローの「通知の強度は「注意」」に当たる |
| `Task`(バリアンスの通知) | `focus` | 評価の `Observation` |
| `Task`(バリアンスの通知) | `basedOn` | OAT ユニット |
| `Task`(バリアンスの通知) | `owner` | 入院の主治医(participant ATND) |
| `Task`(バリアンスの通知) | `input` | パス名・適用・病日・アウトカム |

- 観察項目の実績は、値が前回と変わったときだけ POST します。PUT・DELETE はしません。
- 病日の総合評価は病日に 1 件で、上書き(PUT)します。空にしたら DELETE します。
- 評価・実績の `Observation` は `category[0]` にパスの印を置きます。上流が category の先頭しか索引しないためです。`vital-signs` を持たないので、経過表には出ません。
- 通知の強度は `Task.priority` に写します。注意が `urgent`、アラートが `stat` / `asap` です(`fhir/notificationHelpers.ts`)。

### 状態の持ち方

**定義の状態**

| 表示 | `master_pathways.status` |
|---|---|
| 下書き | `draft` |
| 承認済 | `approved` |
| 廃止 | `retired` |

**適用の状態**

| 表示 | `CarePlan.status` | `period.end` | 適用の `Goal` |
|---|---|---|---|
| 進行中 | `active` | 無し | 無い |
| 終了 | `completed` | 終了日 | `lifecycleStatus` = `completed`、終了区分 1 |
| 中止 | `revoked` | 終了日 | `lifecycleStatus` = `cancelled`、終了区分 2 |

**状態を戻す操作**

| 操作 | 適用の `CarePlan` | 適用の `Goal` |
|---|---|---|
| 終了の記録の取り消し | `active` に戻し、`period.end` を落とす | DELETE |
| 適用の取り消し | 木を DELETE | – |

- **フェーズの進み**: 「どこまでフェーズを適用したか」は保存しません。適用済みの病日の `pathway-phase` の印から逆算します(`nextPhasesOf`)。印の無い適用は、先頭のフェーズとして読みます。
- **二重適用のガード**: 同じ `Encounter` に、`active` の同じ `pathwayCode` があるかだけを見ます。終了・中止した適用があっても、もう一度適用できます。
- **承認の取り消し**: `approved` から `draft` に戻すとき、backend が上流に件数を問い合わせます。1 件でもあれば 422、確認できないときも 422 です。

タスクの実施は `pathwayTaskPerformedOn` で判定します。

| タスクの種類 | 判定に使うもの |
|---|---|
| チェックリスト | `Procedure` の `status` |
| 看護指示・リハビリ・栄養指導 | その日の実施記録(`OrderProgress.performedDates`) |
| そのほかのオーダー | オーダーの進捗の `Task`(`orderProgressByOrderId`) |
| 処方・食事・細菌・化学療法 | `ServiceRequest.status`。進み具合を `Task` で持たないため |

### 部品

画面は `components/` と `pages/`、組み立ては `fhir/`、hook は `api/queries/pathway.ts` にあります。

| 操作 | 画面 | 組み立て | hook |
|---|---|---|---|
| 定義の一覧 | `pages/PathwayListPage.tsx` | – | `usePathwaySearch` |
| 定義の編集 | `pages/PathwayEditorPage.tsx` | `validatePathwayDraft` | `usePathway`・`usePathwayMutations` |
| 適用 | `PathwayApplyPanel.tsx` | `buildPathwayApplyBundle`・`pathwayOrderPlan`・`stampPathwayOrders` | `useApplyPathway`・`useApplicablePathways`・`usePatientPlannedAdmissions` |
| 次のフェーズ | `PathwayNextPhaseModal.tsx`・`PathwayApplyPanel.tsx` | `buildPathwayPhaseBundle`・`planPhaseOrderClosings` | `useApplyPathway` |
| 予定外の追加 | `PathwayUnplannedPanel.tsx` | `buildUnplannedUnitBundle` | `useAddUnplannedUnit` |
| パスタブの読み込み | `KartePathwayTab.tsx` | `parsePathwayApplication`・`buildPathwaySheet` | 下の「読み込みの hook」 |
| 日次評価 | `PathwayDayView.tsx`・`PathwayEvaluatePanel.tsx` | `buildPathwayEvaluationBundle`・`judgeAssessment`・`proposeAchievement` | `useRecordPathwayEvaluation` |
| 病日の総合評価 | `PathwayDayAssessmentPanel.tsx` | `buildPathwayDayAssessmentBundle` | – |
| タスクの実施 | `PathwayTaskPanel.tsx` | `buildPathwayTaskBundle` | – |
| オーダーの詳細 | `PathwayOrderModal.tsx` | – | – |
| 指示簿のパスのタスク | `PathwayWardTasks.tsx` | `parsePathwayWardTasks` | `usePathwayWardTasks` |
| 日程の変更 | `PathwaySchedulePanel.tsx` | `planPathwayShift`・`buildPathwayShiftBundle` | `useShiftPathwaySchedule` |
| 終了・中止と、その取り消し | `PathwayClosePanel.tsx` | `buildPathwayCloseBundle`・`buildPathwayReopenBundle` | `useClosePathway` |
| 適用・フェーズの取り消し | `PathwayCancelPanel.tsx` | `planPathwayCancel`・`buildPathwayTreeDeleteBundle` | `useCancelPathwayApplication` |
| バリアンスの通知 | `notifications/notificationRegistry.tsx` | `pathwayVarianceHelpers.ts` | `usePathwayVarianceNotice` |

- 「–」は、専用の名前をこの表に載せていない所です。
- 読み込みの hook は、`usePathwayApplications`・`usePathwayApplicationTree`・`usePathwayObservations`・`usePathwayApplyGoal`・`usePathwayVarianceTasks`・`useActivePathwaysByPatient`・`usePathwayWardTasks` です。

名前と置き場所が合わないもの:

- 定義の hook(`usePathwaySearch` / `usePathway` / `useApplicablePathways` / `usePathwayMutations`)は `api/masterQueries/pathway.ts` にあります。
- `usePathwayVarianceNotice` は `hooks/usePathwayVarianceNotice.ts` にあります。
- `validatePathwayDraft` は入力中の案内で、`fhir/pathwayHelpers.ts` にあります。下書きと承認の検証は backend の `validate_content!` です。
- 適用の右ペインの種別は `pathway-apply`、次のフェーズは `pathway-phase` です。

そのほかの置き場所:

| もの | 場所 |
|---|---|
| 定義の画面の経路 | `/pathways`、`/pathways/new`、`/pathways/:id` |
| 定義の編集の部品 | 病日 `PathwayEventCard.tsx`、概要表 `PathwayOverviewTable.tsx`、雛形 `PathwayTaskTemplateModal.tsx` |
| 定義の編集の部品(続き) | 分岐 `PathwayPhaseBranchModal.tsx`、プレビュー `PathwaySheetPreviewModal.tsx` |
| draft の型と検証 | `fhir/pathwayHelpers.ts` |
| 定義の API(frontend) | `api/masterClient/pathway.ts`・`api/masterQueries/pathway.ts` |
| 定義の API(backend) | `Master::PathwaysController` |
| BOM の API | `BomOutcomesController` / `BomAssessmentsController` |
| 適用の組み立て | `fhir/pathwayApplyHelpers.ts` |
| パスシートの組み立て | `fhir/pathwaySheetHelpers.ts` |
| 評価の組み立て | `fhir/pathwayEvaluationHelpers.ts` |
| 日程の変更の組み立て | `fhir/pathwayScheduleHelpers.ts` |
| 終了・中止の組み立て | `fhir/pathwayCloseHelpers.ts` |
| 指示簿 | `fhir/pathwayWorklistHelpers.ts` |
| 入院患者一覧・患者ヘッダのパス名 | `PathwayNameLinks.tsx` |
| カルテのカード | `fhir/pathwayKarteHelpers.ts` |
| データ抽出 | `fhir/pathwayExtractHelpers.ts` |
| ePath の XML | `fhir/epathMessageHelpers.ts` + `api/queries/epathExport.ts` |

### シーケンス図: 定義の保存

定義は FHIR を通らず、backend の DB だけに書きます。

```mermaid
sequenceDiagram
  autonumber
  actor Adm as パスを管理する担当者
  participant UI as ブラウザ
  participant BE as backend

  Adm->>UI: 内容を編集して保存
  UI->>UI: 入力中の案内
  UI->>BE: POST か PATCH(定義)
  BE->>BE: 下書きの検証
  BE-->>UI: 保存した定義(だめなら 422)
```

| 項目 | 中身 |
|---|---|
| 編集するもの | 病日・OAT ユニット・タスク・雛形 |
| 入力中の案内 | `validatePathwayDraft` |
| リクエスト | `POST /master/pathways` または `PATCH /master/pathways/:id` |
| 送るもの | 本体 + indications / phases / events(病日 → OAT ユニット → 観察項目 → タスク) |
| 置換の単位 | 送った種別だけを丸ごと置換する。`*_key`(uuid)は画面が採る |
| 下書きの検証 | `validate_content!`。病日の重複・フェーズの結び・主要イベント |
| 失敗 | 422 とメッセージ |

### シーケンス図: 定義の承認

```mermaid
sequenceDiagram
  autonumber
  actor Adm as パスを管理する担当者
  participant UI as ブラウザ
  participant BE as backend

  Adm->>UI: 状態を「承認済」にして保存
  UI->>BE: PATCH(status=approved)
  BE->>BE: 承認の検証
  BE-->>UI: 承認済(だめなら 422)
```

| 項目 | 中身 |
|---|---|
| 画面の操作 | 運用の状態を「承認済」にして保存する |
| リクエスト | `PATCH /master/pathways/:id`(status=approved) |
| 承認の検証 | `approval_invalid_messages` |
| 結果 | `approved_on` / `approved_by` が入り、内容は凍結される |

- 承認の検証が見るのは、適応基準・予定日数・版・病日の有無・全病日に OAT ユニット・雛形の中身・予定日数と標準の経路の最終病日・フェーズの整合です。
- フェーズの整合は、各フェーズに病日があること、フェーズ名、分岐の循環、開始フェーズからの到達、病日の連続、分岐先が前のフェーズの翌日から始まることです(`phase_invalid_messages`)。

### シーケンス図: 承認の取り消し

承認の取り消しだけが、上流に件数を問い合わせます。

```mermaid
sequenceDiagram
  autonumber
  actor Adm as パスを管理する担当者
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Adm->>UI: 状態を「下書き」に戻して保存
  UI->>BE: PATCH(status=draft)
  BE->>FHIR: 適用の件数を検索
  FHIR-->>BE: total
  BE-->>UI: 0 件なら下書き。ほかは 422
```

| 項目 | 中身 |
|---|---|
| リクエスト | `PATCH /master/pathways/:id`(status=draft) |
| 件数の検索 | `GET CarePlan?instantiates-uri=…/pathway/{code}&_summary=count`(厳密な検索) |
| total = 0 | 下書きに戻し、承認日・承認者を消す |
| 1 件以上、または確認できない | 422 |

### シーケンス図: 定義の複製

```mermaid
sequenceDiagram
  autonumber
  actor Adm as パスを管理する担当者
  participant UI as ブラウザ
  participant BE as backend

  Adm->>UI: 「複製」
  UI->>BE: POST(copy)
  BE-->>UI: 新しいコードの下書き
```

| 項目 | 中身 |
|---|---|
| リクエスト | `POST /master/pathways/:id/copy` |
| 結果 | 新しいコード・下書き・版のマイナー +1・`copied_from_code`。uuid はそのまま |

### シーケンス図: 適用(初回と次のフェーズ)

初回と次のフェーズは同じ流れで、transaction の中身だけが違います。計画の木とオーダーと来歴を、1 つの transaction にまとめます(`mergeTransactionBundles`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 右ペインでパスを選ぶ
  UI->>BE: GET 承認済の定義
  BE-->>UI: 定義
  UI->>BE: GET /fhir(適用先と病名)
  BE->>FHIR: 検索
  FHIR-->>UI: 適用先の候補・対象病名
  Dr->>UI: 入力を確かめて適用
  UI->>UI: 雛形のフォームを検証
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 読むもの | 取得先 |
|---|---|
| 適用できる定義 | `GET /master/pathways?status=approved`(有効期間内) |
| 選んだ定義 | `GET /master/pathways/:id`。フェーズ・病日・OAT ユニット・タスク・雛形 |
| 適用先の候補 | `GET /fhir` で入院中・入院予定の `Encounter` |
| 対象病名 | `GET /fhir` で継続中の `Condition` |
| 進行中の適用 | `GET /fhir` で患者の `CarePlan` の根。二重適用の判定に使う |

- 主治医が確かめるのは、適応基準・入院日・対象病名・依頼医師・オーダーの行です。
- 雛形のフォームは、外から submit して検証します。落ちたら、何も登録しません。
- 結果のあと、パスの木・来歴・`ServiceRequest` と各種別のキーを読み直し、パスタブを開きます。

| 初回の transaction に書くもの | 補足 |
|---|---|
| POST `CarePlan`(適用) | fullUrl は urn:uuid。`addresses`・`encounter`・`pathway-version` |
| POST `CarePlan`(病日) | 開始フェーズの病日ごと。`pathway-phase`・主要イベント |
| POST `CarePlan`(OAT ユニット、観察項目) | 病日の下に順に。観察項目には適正値の `Goal` |
| POST `Procedure` preparation(タスク) | 観察項目の下 |
| 雛形のオーダー | 各種別の buildBundle。`stampPathwayOrders` で印を付ける。fullUrl 必須 |
| POST `Provenance`(オーダー分) | 代行入力なら `Task` `order-approval` も |
| POST `Provenance`(適用) | 1 件 |

| 次のフェーズの transaction に書くもの | 補足 |
|---|---|
| POST 次のフェーズの病日 → OAT ユニット → … | 既存の適用の下に足す |
| 最初の病日の `pathway-phase-note` | 目安の写し + コメント |
| POST `Provenance` | 最初の病日を対象にする |
| そのフェーズのオーダー | 初回と同じ形 |
| PUT 前のフェーズの食事・安静度(AL) | 新しい開始の直前で終える(`planPhaseOrderClosings`) |

- 次のフェーズでは、適用の `CarePlan` は PUT しません。
- **識別子**: `{施設コード}.{適用uuid}` を先頭に、階層ごとにピリオドで連ねます。`unit_key` / `assessment_key` / `task_key` は定義の uuid です。定義を直しても、同じアウトカムを追えます。
- **看護指示**: 続く病日の看護指示は `orderContinuityOf` で 1 件にまとめます。内容は先頭の病日の雛形、終了日は続きの最終日です。
- **食事・安静度**: 後に並ぶ同じ種類のオーダーの直前で終えます(`pathwayOrderEnd`)。そのほかの種別は病日ごとに 1 件です。
- **予定外の追加**: 同じ形です(`buildUnplannedUnitBundle`、`useAddUnplannedUnit`)。選んだ病日の下に OAT ユニット → 観察項目 → `Procedure` を POST し、付けたオーダーを同じ transaction に入れます。`EPathCarePlanUnplannedKind` = `Y`、`unit_key` はその場の uuid です。

### シーケンス図: パスタブの読み込み

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟の看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: カルテの「パス」タブを開く
  UI->>BE: GET /fhir(適用の根)
  BE->>FHIR: 検索
  FHIR-->>UI: 適用の根
  par 木
    UI->>BE: GET /fhir(適用の木)
  and 評価
    UI->>BE: GET /fhir(パスの Observation)
  and 終了・通知
    UI->>BE: GET /fhir(Goal と通知)
  end
  BE->>FHIR: 検索
  FHIR-->>UI: 木・評価・終了の記録・通知
  UI->>UI: パスシートを組み立てる
```

| 読むもの | 検索 | hook |
|---|---|---|
| 適用の根 | `CarePlan?patient&category=パスの印&part-of:missing=true&_sort=-date` | `usePathwayApplications` |
| 適用の木 | 下の「木の検索」 | `usePathwayApplicationTree` |
| 評価・実績・総合評価 | `Observation?patient&category=パスの印`(全ページ) | `usePathwayObservations` |
| 終了・中止の記録 | `Goal?identifier=apply-goal-id\|適用` | `usePathwayApplyGoal` |
| 既存のバリアンスの通知 | `Task?patient&code=pathway-variance` | `usePathwayVarianceTasks` |

木の検索は `CarePlan?part-of=適用` に次を付け、500 件ずつ total まで読みます。

- `_include=CarePlan:goal`
- `_revinclude=Procedure:based-on`
- `_include:iterate=Procedure:based-on`
- `_revinclude:iterate=Task:focus,Procedure:based-on`

木の検索で読めるものは、病日・OAT ユニット・観察項目・適正値の `Goal`・タスク・オーダーのヘッダ・進捗の `Task`・実施記録です。

- 適用が複数あればタブで並べ、進行中を既定にします。
- 評価の `Observation` は、評価(judgement)・実績・総合評価(comp-assessment)です。
- パスシートは `buildPathwaySheet` が識別子で行をまとめ、続きは 1 行にします。評価の最新と履歴は `buildEvaluationState` が作ります。
- 上流は `_revinclude:iterate` を 2 つ並べると最後の 1 つしか効かないので、カンマで 1 つにします。

### シーケンス図: 日次評価の記録

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟の看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: 日めくりを開く
  UI->>BE: GET /fhir(その日の経過表の値)
  BE->>FHIR: 検索
  FHIR-->>UI: 実績値の候補
  Ns->>UI: 値を入れて「記録(n 件)」
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

- 経過表の値は `useVitalFlowsheet` で、その日だけを読みます。
- 看護師が入れるのは、実績値・タスクの実施・達成状態です。
- transaction は、変えたアウトカムごとに組んで entry をつなぎます(`buildPathwayEvaluationBundle`、`useRecordPathwayEvaluation`)。
- 結果のあと、パスの木・`Observation`・`Goal`・通知の件数を読み直します。

| transaction に書くもの | 条件 |
|---|---|
| POST `Goal`(`outcome-goal-id`)+ POST `Observation`(評価) | そのアウトカムの初回の評価 |
| PUT `CarePlan`(OAT ユニット)に `goal` を足す | そのアウトカムの初回の評価 |
| POST `Observation`(評価。記録番号 +1)+ PUT `Goal`(最新) | 2 回目以降の評価 |
| POST `Observation`(実績) | 値が変わった観察項目だけ |
| PUT 適正値の `Goal`(`achievementStatus`) | 観察項目に基準があるとき |
| PUT `Procedure`(completed / preparation) | 状態の変わったタスクだけ |
| POST `QuestionnaireResponse` | テンプレートの回答 |
| PUT / DELETE `Observation`(comp-assessment) | 病日の総合評価 |
| POST / PUT `Task` pathway-variance(owner = 主治医) | 重要アウトカムが未達成に変わったとき |
| PUT `Task` cancelled | 未達成でなくなったとき |

- 既存の `Observation` には PUT も DELETE もしません。実績の訂正は、正しい値をもう一度記録します。
- テンプレートの回答も消しません。再編集したら新しい回答を POST し、新しい評価だけがそれを指します。
- オーダーを持たないタスクを 1 件だけ実施・未実施にするとき(`PathwayTaskPanel`、指示簿の「パスのタスク」)は、`buildPathwayTaskBundle` の `Procedure` の PUT だけです。評価には触れません。
- パスタブから開いたオーダーの詳細・実施入力・看護指示の実施入力は、種別ごとの一覧しか読み直しません。閉じたときに木を読み直します(`PATHWAY_TREE_KEY_PREFIX`)。

### シーケンス図: 指示簿のパスのタスク

看護指示と違って `ward` 検索は使えないので、その日の入院患者のベッドから病棟を決めます(`usePathwayWardTasks`、`parsePathwayWardTasks`)。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 病棟の看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: 指示簿で病棟と基準日を選ぶ
  UI->>BE: GET /fhir(入院中の Encounter)
  BE->>FHIR: 検索
  FHIR-->>UI: 病棟の患者
  UI->>BE: GET /fhir(基準日の病日)
  BE->>FHIR: 検索
  FHIR-->>UI: 基準日の病日と適用の根
  UI->>BE: GET /fhir(病日の子孫とタスク)
  BE->>FHIR: 検索
  FHIR-->>UI: 子孫とタスク
  Ns->>UI: チェックで実施 / 未実施
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| 読むもの | 検索 | 補足 |
|---|---|---|
| 病棟の患者 | 入院中の `Encounter` | ベッドから病棟の患者を決める |
| 基準日の病日と適用の根 | `CarePlan?category=pathway-level\|event&date=基準日&subject=患者&_include=CarePlan:part-of` | 患者はカンマの OR。進行中の適用だけ残す |
| 子孫とタスク | `CarePlan?part-of=病日&_revinclude=Procedure:based-on` | 病日はカンマの OR で 10 件ずつ。オーダーを持たない `Procedure` だけ並べる |

| transaction に書くもの | 補足 |
|---|---|
| PUT `Procedure` completed / preparation | `performedDateTime`・`performer` |

### シーケンス図: 終了・中止

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 「終了・中止」に入力
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| transaction に書くもの | 補足 |
|---|---|
| PUT `CarePlan`(適用) | `status` = completed / revoked、`period.end` |
| POST `Goal`(`apply-goal-id`) | `lifecycleStatus`、`EPathGoalStatusReason`、`note` |

- 入力は、区分・終了日・中止理由・総合評価です(`buildPathwayCloseBundle`、`useClosePathway`)。
- 終了・中止したので、同じ入院にもう一度適用できます。

### シーケンス図: 終了の記録の取り消し

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 終了の記録を取り消す
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

| transaction に書くもの | 補足 |
|---|---|
| PUT `CarePlan`(適用) | `active` に戻し、`period.end` を落とす |
| DELETE `Goal` | 終了・中止の記録 |

- 組み立ては `buildPathwayReopenBundle` です。

### シーケンス図: 日程の変更

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 起点の病日と新しい日付
  UI->>UI: 変更できるかを確かめる
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

`planPathwayShift` は、起点から後ろに次のどれかがあれば、変更を止めます(blocker)。

- 評価
- 実施
- 看護指示の実施記録
- 実施済みのオーダー

| transaction に書くもの | 条件 |
|---|---|
| PUT `CarePlan`(病日)の `period` | – |
| PUT `Procedure`(タスク)の予定日の拡張 | – |
| PUT `CarePlan`(適用)の `period.start` | 起点が最初の病日のとき |
| PUT 看護指示・食事の `ServiceRequest` の開始・終了 + `Provenance`(UPDATE) | – |

- そのほかの種別のオーダーは触らず、パスシートに「日付違い」を出します。
- 組み立ては `buildPathwayShiftBundle`、hook は `useShiftPathwaySchedule` です。

### シーケンス図: 適用の取り消し・フェーズの取り消し

画面の操作は、パスタブの見出しのメニューの「適用の取り消し」か「フェーズの取り消し」です。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: メニューの「適用の取り消し」
  UI->>UI: 取り消せるかを確かめる
  loop 雛形から出したオーダーごと
    UI->>BE: 種別ごとの削除
    BE->>FHIR: DELETE / transaction
  end
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

`planPathwayCancel` は、次のどれかがあれば、取り消しを止めます(blocker)。

- 評価
- 実施済みのタスク
- 看護指示の実施
- 実施済みのオーダー、部門が受け付けたオーダー

| 書くもの | 補足 |
|---|---|
| 種別ごとの削除の本体(`delete…Request`) | 明細・予約の取消・記入の削除は各種別のとおり。看護指示は指示と `Task` を DELETE |
| DELETE 木の `CarePlan`・`Procedure`・適正値の `Goal` | 最後の transaction。`Provenance` は残す |

- 読み直しは最後に 1 回です。URL の view を外します。
- 種別ごとの削除の hook を使わないのは、hook が 1 件ごとに一覧を読み直させ、数十件を続けると上流の回数制限に当たるためです。
- 途中で失敗したら木は残します。もう一度開けば、残ったオーダーから続けられます。
- 退院の transaction はパスに触りません。打ち切るのは看護指示・食事・リハビリだけです。退院後も進行中のまま残る適用は、利用者が終了を記録して閉じます([clinical-pathway-backlog.md](../clinical-pathway-backlog.md) A-6)。

### 医事会計と SS-MIX2

パスの計画・評価そのもの(`CarePlan`・`Goal`・パスの `Observation`・タスクの `Procedure`)は請求の項目を持たず、SS-MIX2 の対象リソース(`Ssmix2::Dispatcher::RESOURCE_TYPES`)にも入っていません。
雛形から出たオーダーは、パスから出たことに関係なく、各種別の規則で送られます。SS-MIX2 のメッセージになるのは、雛形から出たオーダーの `ServiceRequest` / `MedicationRequest` だけです。

次の操作は、医事会計にも SS-MIX2 にも何も送りません。

- 定義の保存・承認・複製・廃止
- 適用・次のフェーズ・予定外の追加(計画の木)
- 評価・実績・総合評価・タスクの実施(チェックリスト)
- 終了・中止・終了の記録の取り消し
- バリアンスの通知

送るものがある操作は、次のとおりです。

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 雛形から出たオーダーの登録 | 種別ごと | 種別ごと |
| 雛形から出たオーダーの実施 | 種別ごと。実施記録から送る | 種別ごと(`RAS^O17` / `OMI^Z23` など) |
| 日程の変更 | なし | 書き換えた食事オーダーごとに `OMD^O03`(`NW`) |
| 適用の取り消し | 消したオーダーが対象から外れる(種別ごと) | 消したオーダーの `CA`(DEL)(種別ごと) |

- **登録の医事会計**: 処方・食事・看護指示・他科依頼は対象外です。部門オーダーは実施記録から送ります。
- **登録の SS-MIX2**: 処方・注射は `RDE^O11`、検体検査は `OML^O33`、放射線・生理などは `OMG^O19`、食事は `OMD^O03` です。看護指示・他科依頼は出しません。
- **日程の変更**: 看護指示・食事の日付が動くだけです。看護指示はメッセージになりません。
