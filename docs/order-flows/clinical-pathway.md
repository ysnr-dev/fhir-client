# クリニカルパスの業務フロー

クリニカルパスを、パス定義の作成と承認から患者への適用、病棟の日々の評価と実施、バリアンス、フェーズの進行、終了・中止まで追う流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
クリニカルパスは、疾患・術式ごとの入院診療の標準計画を**病日 × アウトカム**の格子(パスシート)で書いたものです。病日ごとに「患者がこうなっている」(アウトカム)、「それを何で判断するか」(観察項目)、「何をするか」(タスク)を置き、適用した患者ではタスクが日付の入ったオーダーになり、病棟は毎日アウトカムの達成・未達成(バリアンス)を記録します。
雛形から出たオーダー(処方・注射・検査・看護指示・食事など)はそれぞれの種別の流れに乗るので、部門の受付・実施の細部は各種別の業務フロー([看護指示](nursing.md)、[食事](meal.md)、[注射](injection.md)、[検体検査](lab.md)など)を読みます。
画面のふるまいは [features/orders-common.md](../features/orders-common.md#クリニカルパス定義マスタ)、設計は [clinical-pathway-design.md](../clinical-pathway-design.md)、不足機能は [clinical-pathway-backlog.md](../clinical-pathway-backlog.md) が正典です。基本仕様は JAMI・JSCP の ePath(ePath R4 実装ガイド)に準じます。

## 運用フロー

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

- 入口は、定義が「マスタメンテ > クリニカルパス > パス定義」、適用がカルテ右ペインの「クリニカルパス」、日々の記録がカルテの「パス」タブと病棟の指示簿です。
- アウトカム・観察項目は BOM(日本クリニカルパス学会の Basic Outcome Master)または施設のコードで持てます。BOM の配布ファイルは施設が学会から取得して「マスタ取込」で取り込みます。
- 1 つの入院に複数のパスを重ねて当てられます(術後に別のパスへ移るなど)。同じパスを同じ入院に二重には当てられません。

### パス定義の状態

| 状態 | 適用 | 内容の変更 |
|---|---|---|
| 下書き | できない | できる |
| 承認済 | 有効期間内ならできる | できない。複製して直し、承認し直す(版の小さい桁が 1 つ上がる) |
| 廃止 | できない | できない。使った記録として残す |

- 承認するときに確かめること: 適応基準・予定日数・版(「1」「1.1」の形式)がある、すべての病日にアウトカムが 1 つ以上ある、オーダー雛形を付けたタスクの中身が空でない、予定日数が標準の経路の最終病日以上。フェーズを分けたパスは、フェーズ名があり、分岐が循環せず、開始フェーズからすべてのフェーズに進め、フェーズの中の病日が連続していること。
- 承認済を下書きに戻せるのは、**患者に 1 件も適用していない**パスだけです。適用済みのパスは次のフェーズを定義から展開するので、直すと食い違うためです。
- 承認済の内容は凍結されますが、状態・有効期間・表示順は動かせます。削除は下書きだけです。

### 適用の状態

| 状態 | 意味 | 変わるきっかけ | できること |
|---|---|---|---|
| 進行中 | 評価・実施を記録している | 適用、終了の記録の取り消し | 評価・実施、次のフェーズ、予定外の追加、日程の変更、終了・中止、適用の取り消し(記録が無いときだけ) |
| 終了 | 予定どおりに終えた | 「終了・中止」で終了を選ぶ、分岐で「パスを終了」を選ぶ | 読む、ePath 出力、終了の記録の取り消し |
| 中止 | 途中でやめた(理由を残す) | 「終了・中止」で中止を選ぶ | 読む、ePath 出力、終了の記録の取り消し |

- 終了・中止は**手で記録**します。退院や最終病日の到来で自動的には終わりません。
- 取り消しは適用そのものを消すので、状態ではなく「なかったこと」になります。評価・実施・部門の受付が 1 つでもあれば取り消せず、中止にします。
- 進み具合(未評価・バリアンス・未実施の件数)はパスタブのオーバービューの見出し帯に出ます。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph committee["パスを管理する担当者"]
    draft["パス定義を作る<br/>病日 × アウトカム・観察項目・タスク<br/>タスクにオーダー雛形"]
    approve["承認<br/>(内容を凍結)"]
  end

  subgraph doctor["主治医"]
    apply["入院患者にパスを適用<br/>適応基準を確認、入院日から病日を割り付け<br/>雛形のオーダーがまとめて立つ"]
    variance["バリアンスの通知を確認<br/>治療方針を見直す"]
    nextPhase{"次のフェーズへ?"}
    phase["分岐の候補から選んで<br/>次のフェーズを適用"]
    close["終了・中止を記録<br/>(中止は理由、終了は総合評価)"]
  end

  subgraph ward["病棟の看護師"]
    daily["日めくりで病日の仕事を見る<br/>観察項目の実績値、タスクの実施"]
    evaluate["アウトカムを評価<br/>達成 / 未達成(バリアンス)/ 未評価"]
    tasks["指示簿の「パスのタスク」を実施<br/>(オーダーを持たないタスク)"]
  end

  subgraph dept["部門(検査室・薬剤部・リハビリなど)"]
    perform["雛形から出たオーダーを<br/>受付・実施(各種別の流れ)"]
  end

  start --> draft --> approve --> apply
  apply --> daily --> evaluate
  apply --> perform -. "実施済がシートの ☑ になる" .-> daily
  daily --> tasks --> evaluate
  evaluate -- "重要アウトカムが未達成" --> variance --> daily
  evaluate --> nextPhase
  nextPhase -- "まだ病日が残る" --> daily
  nextPhase -- "フェーズの最終病日" --> phase --> daily
  nextPhase -- "最後のフェーズを終えた<br/>または途中でやめる" --> close --> finish
```

- 「パスを管理する担当者」はパス委員会や各科のパス担当を想定した呼び方で、システムの権限ではありません。定義の作成・承認はマスタメンテから誰でも行えます。
- 医師の操作はカルテから、看護師の操作はカルテのパスタブと病棟の指示簿からです。パスシートの記録はどの職種でも行え、記録者はログイン中の本人です。
- 部門は、パスから出たことを気にせずに通常どおり受け付け・実施します。オーダーには「パス」の印が付き、カルテのカードにバッジで出ます。

### パス定義の作成と承認

```mermaid
flowchart TD
  open(("パス定義を開く"))
  from{"どこから?"}
  new["新規"]
  copy["承認済を複製<br/>(新しいコード・下書き・版が上がる)"]
  basic["基本情報<br/>名称・診療科・入外・予定日数・版<br/>適応基準・対象病名"]
  days["病日を並べる<br/>入院前日 … 入院日 … 退院日<br/>手術当日は術前 / 術後に分割"]
  units["病日ごとに OAT ユニット<br/>アウトカム(重要なら ★)<br/>+ 観察項目(適正値)+ タスク(分類)"]
  series["続きにする<br/>同じアウトカム・タスクを概要表のセルで<br/>翌日以降にも置く(1 行に並ぶ)"]
  templates["タスクにオーダー雛形を付ける<br/>処方・注射・検査・看護指示・食事 など<br/>付けないタスクはチェックリスト"]
  phases{"途中で道が分かれる?"}
  branch["フェーズに分けて<br/>分岐先と選ぶ目安を登録"]
  preview["プレビュー<br/>入院日を仮に入れてパスシートを確かめる"]
  save["保存(下書き)"]
  approveQ{"承認する?"}
  check{"承認の条件を満たす?<br/>適応基準・予定日数・版<br/>全病日にアウトカム、雛形が空でない<br/>フェーズの整合"}
  error["足りない項目を表示<br/>下書きのまま"]
  approved((("承認済<br/>適用できる")))
  draftEnd((("下書きのまま")))

  open --> from
  from -- "新しく作る" --> new --> basic
  from -- "承認済を直す" --> copy --> basic
  basic --> days --> units --> series --> templates --> phases
  phases -- "はい" --> branch --> preview
  phases -- "いいえ" --> preview
  preview --> save --> approveQ
  approveQ -- "いいえ" --> draftEnd
  approveQ -- "はい" --> check
  check -- "いいえ" --> error --> units
  check -- "はい" --> approved
```

- アウトカム・観察項目のコードは、BOM を取り込んだ施設では「選択」で名称から探せます。アウトカムを選ぶと、そのアウトカムに属する観察項目の候補がチェックで選べます。取り込んでいない施設は手入力です。
- 看護観察(MEDIS)に結んだ観察項目は、適正値を数値の範囲や許容値として構造化できます。適用後の評価で実績値に ○ / ✕ が付き、達成状態の提案に使われます。
- 「続き」は、同じアウトカムやタスクを複数の病日に置いたものです。名前・コード・雛形は続き全体で揃い、適正値は日ごとに変えられます(術後 1 日目は疼痛 3 以下、4 日目は 2 以下など)。
- 病日の「主要イベント」で、手術・内視鏡・放射線治療のタスクを選んでおくと、適用後のシートに実施の時刻つきで出ます。
- 承認済の定義を直すときは複製して下書きで直し、承認し直して元を廃止します。進行中の患者は元の定義のまま進みます。
- サンプルとして 4 泊 5 日の腹腔鏡下胆嚢摘出術、1 泊 2 日の大腸ポリープ切除、2 泊 3 日の鼠径ヘルニア、7 日間の市中肺炎、分岐つきの市中肺炎が下書きで入っています。

### 適用の判定

```mermaid
flowchart TD
  submit(("適用を押す"))
  pick["承認済で有効期間内のパスを選ぶ"]
  target["適用先を選ぶ<br/>入院中(既定)/ 入院予定 / 指定しない<br/>入院日 = 病日 1"]
  criteria{"適応基準を確認した?"}
  admission{"入院日がある?"}
  duplicate{"同じ入院に同じパスが進行中?"}
  othersQ{"別のパスが進行中?"}
  warn["注意を出して続ける"]
  conditions["対象病名を選ぶ<br/>(定義の対象病名と一致する病名は既定でチェック)"]
  orders["オーダーの区画を確かめる<br/>病日順に雛形のオーダーが並ぶ<br/>出さない行はチェックを外す"]
  valid{"各オーダーの入力は正しい?<br/>(左右・採取部位・処方区分など)"}
  fix["その行を開いて直す"]
  requesterQ{"依頼医師を選んだ?"}
  error["入力エラーを表示<br/>何も登録されない"]
  send["登録<br/>パスシート + オーダーをまとめて"]
  result{"成功?"}
  failed["エラーを表示<br/>何も登録されない"]
  done((("適用完了<br/>パスタブが開く")))

  submit --> pick --> target --> criteria
  criteria -- "いいえ" --> error
  criteria -- "はい" --> admission
  admission -- "いいえ" --> error
  admission -- "はい" --> duplicate
  duplicate -- "はい" --> error
  duplicate -- "いいえ" --> othersQ
  othersQ -- "はい" --> warn --> conditions
  othersQ -- "いいえ" --> conditions
  conditions --> orders --> valid
  valid -- "いいえ" --> fix --> orders
  valid -- "はい" --> requesterQ
  requesterQ -- "いいえ" --> error
  requesterQ -- "はい" --> send --> result
  result -- "いいえ" --> failed
  result -- "はい" --> done
```

- 入口はカルテ右ペインの「クリニカルパス」です。適応基準の文がそのまま出て、「適応基準を確認した」にチェックしないと適用できません。
- 入院予定に当てると、入院日はその予定の日付です。予定の日付が未定なら当日が入ります。入院日を変えると病日 → 日付の表とオーダーの開始日が追随します。
- オーダーの区画には、雛形を持つタスクが病日順に並びます。開始日は入院日 + (病日 − 1)。続く病日の看護指示は 1 件にまとまり、食事・安静度は次の食事・安静度の直前で終わります。その他の種別(注射・検査・処方など)は病日ごとに 1 件です。
- 雛形が外来で作られていると処方区分が空になることがあります。検証に落ちた行があれば何も登録せず、その行を開きます。
- フェーズを分けたパスは、最初は開始フェーズの病日とオーダーだけを登録します。
- 代行入力は他のオーダーと同じです。雛形から出たオーダーには承認待ちの通知が付き、パスの適用そのものには付きません。
- 予約が要る項目(CT・MRI・内視鏡など)は、適用では予約されません。適用後に部門の予約で枠を取ります。

### 日々の評価と実施

```mermaid
flowchart TD
  open(("今日の病日を開く"))
  from{"どこから?"}
  karte["カルテの「パス」タブ<br/>日めくり(今日の病日)"]
  worklist["病棟の指示簿<br/>「パスのタスク」(その病日のチェックリスト)"]
  badge["入院患者一覧・患者ヘッダのパス名<br/>バリアンスの通知の「カルテ」"]
  taskCheck["チェックで実施にする<br/>(観察・説明・文書など)"]
  cards["アウトカムのカードを上から見る<br/>観察項目の実績値・タスクの実施・達成状態"]
  values["実績値を入れる<br/>経過表の値が候補ボタンで出る<br/>適正値の範囲なら ○、外れたら ✕"]
  tasks["タスクの実施をチェック<br/>看護指示・部門のオーダーは<br/>実施記録からの自動判定"]
  achieve["達成状態を選ぶ<br/>達成 / 未達成(バリアンス)/ 未評価<br/>(✕ があれば未達成を提案)"]
  record["「記録(n 件)」<br/>変えたアウトカムだけが保存される"]
  unwritten{"記載の無い<br/>未達成がある?"}
  prompt["「記載なしのバリアンスが n 件」<br/>このまま記録 / 記載を書く"]
  writing["評価モーダルで記載<br/>SOAP か自由記載、テンプレート可"]
  critical{"重要アウトカム(★)を<br/>未達成にした?"}
  notify["入院の主治医に<br/>「パスのバリアンス」の通知"]
  dayNote["病日の総合評価を書く<br/>(医師、病日に 1 件)"]
  done((("記録完了")))

  open --> from
  from -- "患者から" --> karte --> cards
  from -- "病棟から" --> worklist --> taskCheck --> done
  from -- "一覧・通知から" --> badge --> karte
  cards --> values --> tasks --> achieve --> record --> unwritten
  unwritten -- "はい" --> prompt --> writing --> critical
  unwritten -- "いいえ" --> critical
  critical -- "はい" --> notify --> dayNote
  critical -- "いいえ" --> dayNote
  dayNote --> done
```

- パスタブは「日めくり」(1 病日ずつ)と「オーバービュー」(紙のパスシートと同じ格子。既定)の 2 つの見方があります。オーバービューはアウトカムのセルを押すと評価モーダル、タスクのセルを押すとそのオーダーの詳細(看護指示は実施入力)が開きます。
- 達成状態・実績値・タスクの実施は日めくりでまとめて入れ、記載(SOAP・自由記載)とコメントは評価モーダルで書きます。
- タスクの実施の決まり方は 3 通りです。オーダーを持たないチェックリストはチェックで記録する。看護指示・リハビリ・栄養指導を結んだタスクはその日の実施記録があれば ☑。その他のオーダーを結んだタスクは部門がオーダーを実施済みにすれば ☑。後の 2 つはパス側で押せません。
- オーダーの詳細から「実施入力」へ進めます(注射・輸血・放射線・生理・内視鏡・処置・手術・リハビリ・栄養指導)。部門の受付を済ませていなくても実施できます。検体検査・病理・細菌・他科依頼・食事・処方は部門や経過表で記録します。
- 同じアウトカムを 1 日に何度評価しても全部残ります。シートのセルには「×n」が付き、評価モーダルに履歴が並びます。実績値は前回と変えたものだけ新しく記録され、空にしても前の値は消えません。
- バリアンスの通知は重要アウトカム(★)を未達成にしたときだけ届きます。宛先は入院の主治医、強度は注意。未達成のまま記録し直しても出し直さず、達成・未評価に直すと未対応の通知は取り下げます。主治医は通知の「確認」で対応済みにします。
- 記載のある評価と病日の総合評価は、カルテのタイムラインに「パス評価」のカードとして記録日時の日に出ます。達成状態だけの評価はカードになりません。
- 指示簿の「パスのタスク」はオーダーを持たないタスクだけです。雛形から出た看護指示は同じ画面の上の表に、その他は各部門の画面に出るので重ねません。指示受けは要りません。

### フェーズの進行

```mermaid
flowchart TD
  start(("フェーズの最終病日を終える"))
  icon["パスタブの見出しの<br/>「次のフェーズを適用」(候補があるときだけ)"]
  choose["分岐の候補から選ぶ<br/>フェーズ名 + 選ぶ目安<br/>または「パスを終了」"]
  which{"選んだのは?"}
  closeFlow["終了・中止の入力へ"]
  form["右ペインの適用フォーム<br/>開始日(既定は前のフェーズの翌日)<br/>選んだ理由のコメント"]
  orders["そのフェーズのオーダーが並ぶ<br/>前のフェーズの食事・安静度は<br/>新しい開始の直前で終える"]
  apply["適用"]
  sheet["シートにフェーズの段が増える<br/>選んだ目安とコメントが残る"]
  wrong{"選び間違えた?"}
  undo["ケバブ「フェーズの取り消し」<br/>(そのフェーズに記録が無いときだけ)"]
  finish((("次のフェーズが進行中")))
  closed((("終了・中止へ")))

  start --> icon --> choose --> which
  which -- "パスを終了" --> closeFlow --> closed
  which -- "次のフェーズ" --> form --> orders --> apply --> sheet --> wrong
  wrong -- "はい" --> undo --> icon
  wrong -- "いいえ" --> finish
```

- 分岐は市中肺炎のように「3 日目の効果判定で、継続か抗菌薬変更か」のような道の分かれ目に使います。分岐の先頭が標準の経路です。
- 「どこまで適用したか」は適用済みの病日の印から決まります。最後のフェーズを終えたら「次のフェーズを適用」は出ません。
- 次のフェーズの開始日は、適用済みの最後の病日より後にします。前のフェーズの最終日より早くはできません。
- フェーズの取り消しで戻せるのは最後に適用した 2 つ目以降のフェーズだけで、条件は適用の取り消しと同じ(そのフェーズの病日に記録が無い)です。前のフェーズの食事・安静度に入れた終了は戻しません。

### 予定外・日程の変更・終了・中止・取り消し

```mermaid
flowchart TD
  course(("進行中の適用"))
  what{"どうする?"}
  unplanned["「予定外を追加」<br/>病日を選んでアウトカムを 1 件足す<br/>観察項目・タスク・オーダーも付けられる"]
  shift["「日程の変更」<br/>起点の病日と新しい日付を選び<br/>起点から後ろをまとめてずらす"]
  shiftCheck{"起点から後ろに<br/>評価・実施の記録がある?"}
  shiftNg["理由を並べて変更しない"]
  shiftOk["病日の日付が動く<br/>看護指示・食事は自動で動く<br/>その他は「日付違い」の印から 1 件ずつ編集"]
  closing["「終了・中止」<br/>終了日と区分(終了 / 中止)<br/>中止理由・総合評価"]
  closed["進行中でなくなる<br/>未実施のタスクはそのまま残る<br/>同じ入院に当て直せる"]
  reopen["終了の記録の取り消し<br/>(進行中に戻す)"]
  cancel["ケバブ「適用の取り消し」"]
  cancelCheck{"評価・実施・部門の受付が<br/>1 つでもある?"}
  cancelNg["理由を並べて取り消さない<br/>(中止にする)"]
  cancelOk["パスシートと雛形から出たオーダーを消す<br/>誰が適用したかの記録は残る"]
  done((("閉じた")))
  gone((("なかったことになる")))

  course --> what
  what -- "予定に無いアウトカムが要る" --> unplanned --> course
  what -- "入院日・手術日が動いた" --> shift --> shiftCheck
  shiftCheck -- "はい" --> shiftNg --> course
  shiftCheck -- "いいえ" --> shiftOk --> course
  what -- "終える / やめる" --> closing --> closed --> done
  closed -. "誤って閉じた" .-> reopen --> course
  what -- "間違えて当てた" --> cancel --> cancelCheck
  cancelCheck -- "はい" --> cancelNg --> closing
  cancelCheck -- "いいえ" --> cancelOk --> gone
```

- 予定外のアウトカムは、シートでは「予定外」の印の付いた行として予定どおりのものと同じに扱えます。付けたオーダーは適用と同じ束に入ります。終了・中止したパスには足せません。
- 日程の変更で自動でずらすのは看護指示と食事だけです(日付が 1 本で完結する)。注射・検査・手術・処置などは、明細・予約・部門の受付を伴うので、シートのセルの「日付違い」を見て 1 件ずつオーダー詳細の「編集」で直します。記録のある病日はずらせません。
- 終了は予定どおり終えたとき、中止は途中でやめたときです。どちらも手で記録し、退院しても自動では終わりません。退院後に進行中のまま残らないよう、退院の前後に終了を記録する運用にします。
- 終了・中止すると「予定外を追加」「日程の変更」「次のフェーズ」は出なくなります。間違えて閉じたときは「終了の記録」から取り消して進行中に戻せます。
- 適用の取り消しは、雛形から出したオーダーをカルテのカードの削除と同じ種別ごとの処理で消します(予約の取消、テンプレートの記入の削除なども各種別に任せる)。看護指示も、普段は中止で残すところをここでは消します。途中で失敗したら、もう一度開けば残ったオーダーから続けられます。

### ほかの画面とのつながり

| 画面 | クリニカルパスの使い方 |
|---|---|
| カルテの時系列 | 雛形から出たオーダーのカードに「パス」のバッジ(ツールチップにパス名)。記載のある評価と病日の総合評価は「パス評価」のカード |
| 病棟の指示簿 | 看護指示の表の下に「パスのタスク」(オーダーを持たないタスク)。氏名からパスタブのその病日の日めくりへ。雛形から出た看護指示は上の表に出て、続く病日は 1 件の指示 |
| 入院患者一覧・患者ヘッダ | 進行中のパス名。押すとパスタブ |
| 通知 | 「パスのバリアンス」(重要アウトカムの未達成)。入院の主治医あて、強度は注意、「カルテ」でその病日の日めくり、「確認」で対応済み |
| 経過表 | 看護観察に結んだ観察項目の実績値の候補を経過表の値から出す(押して記録したときだけパスの実績になる)。パスの実績値そのものは経過表に出ない |
| 部門の一覧(検査・放射線・リハビリなど) | 雛形から出たオーダーが通常どおり並ぶ。実施済みにするとシートの ☑ になる。パスタブのオーダー詳細「実施入力」から部門と同じ実施入力を開ける |
| データ抽出・ダッシュボード | 「パス」タブで適用 1 件 1 行(状態・終了区分・予定日数と実日数・評価とバリアンスの件数・中止理由)。クラスタ・指標にも使える |
| ePath 出力 | 定義の編集画面で施設パス、パスタブのケバブで患者に適用したパス(評価・実施・総合評価を含む)を JAMI 標準の XML でダウンロード |

### 変更・中止・削除

| 操作 | できること |
|---|---|
| 定義の変更 | 下書きは自由に。承認済は複製して直し、承認し直す。承認済を下書きに戻すのは適用 0 件のときだけ |
| 定義の削除 | 下書きだけ。承認済は廃止にする |
| 適用後の計画の変更 | 予定外のアウトカムの追加、日程の変更。病日や予定どおりのアウトカムを消す手段は無い(予定外のアウトカムも名前を直せない) |
| 雛形から出たオーダーの変更 | 通常のオーダーと同じ(カルテのカードやパスタブのオーダー詳細の「編集」から)。オーダーを直してもパス側の計画は変わらない |
| 終了・中止 | 見出しのアイコン「終了・中止」。終了日・区分・中止理由・総合評価。取り消して進行中に戻せる |
| 取り消し | 何も記録していない進行中の適用だけ。シートとオーダーを消す |
| 評価の訂正 | 達成状態・記載は記録し直す(履歴に残る)。実績値は正しい値をもう一度記録する(前の値は消えない) |

### 帳票

専用の帳票はありません。パスシートの持ち出しは ePath 出力(JAMI 標準の XML)です。雛形から出たオーダーの帳票(処方箋・注射箋・ラベルなど)は各種別と同じです。

## 開発者向け

### リソースの構成

定義は backend の DB、適用後は上流 FHIR に ePath 準拠の CarePlan の木で置きます。

| もの | 置き場所 | 要点 |
|---|---|---|
| パス定義 | backend `master_pathways` と子(対象病名・フェーズ・分岐・病日・OAT ユニット・観察項目・タスク) | `pathway_code` で結び、子は 1 リクエストで丸ごと置換。OAT ユニット・観察項目・タスクの `*_key`(uuid)は画面が採り、適用後の識別子に持ち越す。オーダー雛形は `order_type` + `order_values`(jsonb。オーダーセットのエントリと同じ形) |
| BOM | backend `master_bom_outcomes` / `master_bom_assessments` / `master_bom_pairs` | 取込で全件洗い替え。検索専用 |
| 適用 | `CarePlan`(根。`partOf` 無し) | `category` = `care-plan-type\|clinical-pathway` + `pathway-level\|apply`、`instantiatesUri` = `…/pathway/{code}`、`identifier` = `apply-id\|{施設コード}.{適用uuid}`、`addresses` = 対象病名、`encounter`、`period.start` = 入院日、拡張 `pathway-version` |
| 病日 | `CarePlan`(`partOf` = [適用]) | `pathway-level\|event`、`identifier` = `event-id\|….{病日[-ステップ]}`、`period.start = end = その日`、拡張 `pathway-phase`(フェーズ)・`pathway-phase-note`・`pathway-major-event` |
| OAT ユニット | `CarePlan`(`partOf` = [適用, 病日]) | `pathway-level\|oat-unit`、`identifier` = `oat-unit-id\|….{unit_key}`、`category` に BOM の大分類・中分類・コード、重要アウトカム、予定外は `EPathCarePlanUnplannedKind` = `Y`、`goal` → アウトカムの Goal(評価後) |
| 観察項目 | `CarePlan`(`partOf` = [適用, 病日, OAT ユニット]) | `pathway-level\|assessment`、`identifier` = `assessment-id\|….{assessment_key}`、`goal` → 適正値の `Goal`(`assessment-goal-id`。`target.detailString` / `detailRange` / `detailCodeableConcept`)。結ぶ観察項目の無いタスクは `ZZZZZZZZZZ` の観察項目で包む |
| タスク | `Procedure`(`basedOn` = [観察項目の CarePlan, オーダーのヘッダ]) | `status` = `preparation`(未実施)/ `completed`(実施)、`performedDateTime`、`performer`、拡張 `EPathProcedureTaskPlannedDateTime`(予定日)、`pathway-display-order` |
| 雛形から出たオーダー | 各種別のヘッダ `ServiceRequest` | `identifier` = `pathway-instance\|{適用uuid}`、拡張 `pathway-order`(valueCoding = パスコード・名前)、`requisition` = 同じ uuid。参照はタスク → オーダーの一方向 |
| アウトカムの評価 | `Goal`(`outcome-goal-id` = OAT ユニットの識別子)+ `Observation`(`observation-evaluation-id` = `….{記録番号}`) | `Goal.achievementStatus` = `EPathStateOfAchievementCS` 1 達成 / 2 未達成 / 3 未評価(最新)、`outcomeReference` → 評価を記録順に全部。`Observation.code` = `EPathEvaluationItemCS\|judgement`、`component` = S / O / A / P または `comp-assessment`(自由記載)、`category[0]` = パスの印、`basedOn` → OAT ユニット |
| 観察項目の実績 | `Observation`(`observation-result-id` = `….{assessment_key}.{記録番号}`) | `code` = 観察項目のコード、`value[x]` は看護観察の表現タイプ、`basedOn` → 観察項目の CarePlan。値が前回と変わったときだけ POST、PUT・DELETE しない |
| 病日の総合評価 | `Observation`(`observation-comp-assessment-id` = 病日の識別子) | `code` = `comp-assessment`、`valueString`、`basedOn` → 病日の CarePlan。病日に 1 件、上書き(PUT)、空にしたら DELETE |
| 終了・中止 | `Goal`(`apply-goal-id` = 適用の識別子) | `lifecycleStatus` = `completed` / `cancelled`、拡張 `EPathGoalStatusReason` = `EPathPathClosingTypeCS` 1 終了 / 2 中止、`statusDate` = 終了日、`note` = 中止理由(「中止理由: 」で始める)と総合評価 |
| バリアンスの通知 | `Task`(`task-code\|pathway-variance`) | `priority` = `urgent`、`focus` → 評価の Observation、`basedOn` → OAT ユニット、`owner` → 入院の主治医(participant ATND)、`input` にパス名・適用・病日・アウトカム |
| 来歴 | `Provenance` | 適用の CarePlan を対象に 1 件(author = 依頼医師、enterer = ログイン本人)。雛形から出たオーダーには種別共通の来歴(代行なら承認待ちの通知) |

- 子孫は `partOf` に祖先すべてを並べます。`part-of=CarePlan/{適用}` の 1 回で木全体、`part-of:missing=true` で根だけが引けます。
- 階層は `pathway-level` の category で判定します(partOf の本数でも導けるが、木を全部読まないと分からない)。EP12 出力では落とします。
- 評価・実績の Observation は `category[0]` にパスの印を置きます(上流は category の先頭しか索引しない)。`vital-signs` を持たないので経過表に出ません。
- 適用の木は 1 ページ(500 件)を超えうるので、`usePathwayApplicationTree` は total から残りのページも読みます。

### 状態の持ち方

| 表示 | 定義(`master_pathways.status`) | 適用(`CarePlan.status`) | 適用の `Goal` |
|---|---|---|---|
| 下書き / 承認済 / 廃止 | `draft` / `approved` / `retired` | – | – |
| 進行中 | – | `active`、`period.end` 無し | 無い |
| 終了 | – | `completed`、`period.end` = 終了日 | `lifecycleStatus` = `completed`、終了区分 1 |
| 中止 | – | `revoked`、`period.end` = 終了日 | `lifecycleStatus` = `cancelled`、終了区分 2 |
| 終了の記録の取り消し | – | `active` に戻し `period.end` を落とす | DELETE |
| 取り消し | – | 木を DELETE | – |

- 「どこまでフェーズを適用したか」は保存せず、適用済みの病日の `pathway-phase` の印から逆算します(`nextPhasesOf`)。印の無い適用は先頭のフェーズとして読みます。
- タスクの実施は `pathwayTaskPerformedOn` で判定します。チェックリストは Procedure の `status`、看護指示・リハビリ・栄養指導はその日の実施記録(`OrderProgress.performedDates`)、その他はオーダーの進捗 Task(`orderProgressByOrderId`。Task で進み具合を持たない処方・食事・細菌・化学療法は `ServiceRequest.status`)です。
- 二重適用のガードは、同じ Encounter に `active` の同じ `pathwayCode` があるかだけを見ます。終了・中止した適用には当て直せます。
- 承認の取り消し(`approved` → `draft`)は、backend が上流に `CarePlan?instantiates-uri=…&_summary=count`(strict)を問い合わせ、1 件でもあれば 422、確認できないときも 422 です。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`。CarePlan・Goal・パスの Observation・タスクの Procedure は対象外で、雛形から出たオーダーの `ServiceRequest` / `MedicationRequest` だけが各種別のメッセージになります)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。

| 部品 | 場所 |
|---|---|
| 定義の一覧・編集 | `pages/PathwayListPage.tsx`(`/pathways`)、`pages/PathwayEditorPage.tsx`(`/pathways/new`・`/pathways/:id`)、病日 `components/PathwayEventCard.tsx`、概要表 `PathwayOverviewTable.tsx`、雛形 `PathwayTaskTemplateModal.tsx`、分岐 `PathwayPhaseBranchModal.tsx`、プレビュー `PathwaySheetPreviewModal.tsx`、draft の型と検証 `fhir/pathwayHelpers.ts` |
| 定義の API | `api/masterClient/pathway.ts`・`api/masterQueries/pathway.ts`(`usePathwaySearch` / `usePathway` / `useApplicablePathways` / `usePathwayMutations`)、backend `Master::PathwaysController`(`validate_content!` が下書きと承認の検証)、BOM `BomOutcomesController` / `BomAssessmentsController` |
| 適用 | `components/PathwayApplyPanel.tsx`(右ペイン `pathway-apply` / `pathway-phase`)、`fhir/pathwayApplyHelpers.ts`(`buildPathwayApplyBundle` / `buildPathwayPhaseBundle` / `pathwayOrderPlan` / `stampPathwayOrders` / `buildUnplannedUnitBundle` / `parsePathwayApplication`)、`api/queries/pathway.ts`(`useApplyPathway` / `useAddUnplannedUnit` / `usePatientPlannedAdmissions`) |
| パスタブ | `components/KartePathwayTab.tsx`、日めくり `PathwayDayView.tsx`、評価 `PathwayEvaluatePanel.tsx`、総合評価 `PathwayDayAssessmentPanel.tsx`、タスク `PathwayTaskPanel.tsx`、オーダー詳細 `PathwayOrderModal.tsx`、シートの組み立て `fhir/pathwaySheetHelpers.ts`、評価の組み立て `fhir/pathwayEvaluationHelpers.ts`(`buildPathwayEvaluationBundle` / `buildPathwayDayAssessmentBundle` / `buildPathwayTaskBundle` / `judgeAssessment` / `proposeAchievement`) |
| 読み | `api/queries/pathway.ts`(`usePathwayApplications` / `usePathwayApplicationTree` / `usePathwayObservations` / `usePathwayApplyGoal` / `usePathwayVarianceTasks` / `useActivePathwaysByPatient` / `usePathwayWardTasks`) |
| 変更・終了 | `components/PathwayNextPhaseModal.tsx`、`PathwayUnplannedPanel.tsx`、`PathwaySchedulePanel.tsx`(`fhir/pathwayScheduleHelpers.ts` の `planPathwayShift` / `buildPathwayShiftBundle` / `planPhaseOrderClosings`)、`PathwayClosePanel.tsx`(`fhir/pathwayCloseHelpers.ts`)、`PathwayCancelPanel.tsx`(`planPathwayCancel` / `buildPathwayTreeDeleteBundle`、`useCancelPathwayApplication`) |
| バリアンス | `fhir/pathwayVarianceHelpers.ts`、`hooks/usePathwayVarianceNotice.ts`、`components/notifications/notificationRegistry.tsx`(`pathway-variance`) |
| ほかの画面 | `components/PathwayWardTasks.tsx`(指示簿、`fhir/pathwayWorklistHelpers.ts`)、`PathwayNameLinks.tsx`(入院患者一覧・患者ヘッダ)、`fhir/pathwayKarteHelpers.ts`(カルテのカード)、`fhir/pathwayExtractHelpers.ts`(データ抽出)、`fhir/epathMessageHelpers.ts` + `api/queries/epathExport.ts`(ePath XML) |

### シーケンス図: 定義の保存・承認・複製

定義は FHIR を通らず backend の DB だけです。承認の取り消しだけが上流に件数を問い合わせます。

```mermaid
sequenceDiagram
  autonumber
  actor Adm as パス担当
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 保存(下書き)
    Adm->>UI: 病日・OAT ユニット・タスク・雛形を編集して保存
    UI->>UI: validatePathwayDraft(入力中の案内)
    UI->>BE: POST /master/pathways または PATCH /master/pathways/:id
    Note over UI,BE: 本体 + indications / phases / events(病日 → OAT ユニット → 観察項目 → タスク)<br/>送った種別だけ丸ごと置換、*_key(uuid)は画面が採る
    BE->>BE: validate_content!(下書き: 病日の重複・フェーズの結び・主要イベント)
    BE-->>UI: 保存した定義(422 ならメッセージ)
  else 承認
    Adm->>UI: 運用の状態を「承認済」にして保存
    UI->>BE: PATCH /master/pathways/:id(status=approved)
    BE->>BE: approval_invalid_messages(適応基準・予定日数・版・全病日に OAT ユニット・雛形の中身・フェーズの整合)
    BE-->>UI: 承認済(approved_on / approved_by。内容は凍結)
  else 承認の取り消し
    Adm->>UI: 状態を「下書き」に戻して保存
    UI->>BE: PATCH /master/pathways/:id(status=draft)
    BE->>FHIR: GET CarePlan?instantiates-uri=…/pathway/{code}&_summary=count(strict)
    FHIR-->>BE: total
    BE-->>UI: total = 0 なら下書きに戻す(承認日・承認者を消す)。1 件以上か確認できなければ 422
  else 複製
    Adm->>UI: 「複製」
    UI->>BE: POST /master/pathways/:id/copy
    BE-->>UI: 新しいコード・下書き・版のマイナー +1・copied_from_code(uuid はそのまま)
  end
```

### シーケンス図: 適用(初回と次のフェーズ)

`buildPathwayApplyBundle` / `buildPathwayPhaseBundle`、`useApplyPathway`。計画の木とオーダーと来歴を 1 つの transaction にまとめます(`mergeTransactionBundles`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 右ペイン「クリニカルパス」でパスを選ぶ
  UI->>BE: GET /master/pathways?status=approved(有効期間内)、GET /master/pathways/:id
  BE-->>UI: 定義(フェーズ・病日・OAT ユニット・タスク・雛形)
  UI->>BE: GET /fhir(入院中・入院予定の Encounter、継続中の Condition、患者の CarePlan 根)
  BE->>FHIR: 検索
  FHIR-->>UI: 適用先の候補・対象病名・進行中の適用(二重適用の判定)
  Dr->>UI: 適応基準を確認、入院日・対象病名・依頼医師、オーダーの行を確かめて適用
  UI->>UI: 雛形のフォームを外から submit(落ちたら何も登録しない)
  UI->>BE: POST /fhir(transaction)
  alt 初回
    Note over UI,BE: POST CarePlan 適用(fullUrl urn:uuid、addresses・encounter・pathway-version)<br/>開始フェーズの病日ごとに POST CarePlan 病日(pathway-phase・主要イベント)<br/>→ OAT ユニット → 観察項目(+ 適正値の Goal)→ Procedure preparation(タスク)<br/>+ 雛形のオーダー(各種別の buildBundle、stampPathwayOrders で印、fullUrl 必須)<br/>+ Provenance(オーダー分、代行なら Task order-approval)+ Provenance(適用)
  else 次のフェーズ
    Note over UI,BE: 既存の適用の下に次のフェーズの病日 → OAT ユニット → … を POST<br/>最初の病日に pathway-phase-note(目安の写し + コメント)、Provenance はその病日を対象<br/>+ そのフェーズのオーダー<br/>+ 前のフェーズの食事・安静度(AL)を新しい開始の直前で終える PUT(planPhaseOrderClosings)<br/>適用の CarePlan は PUT しない
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(パスの木・来歴・ServiceRequest と各種別のキーを読み直し、パスタブを開く)
```

- 識別子は `{施設コード}.{適用uuid}` を先頭に階層ごとにピリオドで連ね、`unit_key` / `assessment_key` / `task_key` は定義の uuid です。定義を直しても同じアウトカムを追えます。
- 続く病日の看護指示は `orderContinuityOf` で 1 件にまとめ(先頭の病日の雛形、終了日は続きの最終日)、食事・安静度は後に並ぶ同じ種類のオーダーの直前で終えます(`pathwayOrderEnd`)。その他の種別は病日ごとに 1 件です。
- 予定外の追加(`buildUnplannedUnitBundle`、`useAddUnplannedUnit`)も同じ形で、選んだ病日の下に OAT ユニット → 観察項目 → Procedure を POST し、付けたオーダーを同じ transaction に入れます。`EPathCarePlanUnplannedKind` = `Y`、`unit_key` はその場の uuid です。

### シーケンス図: パスタブの読みと日次評価

`usePathwayApplicationTree`(木)・`usePathwayObservations`(評価・実績・総合評価、全ページ)・`usePathwayApplyGoal`(終了・中止)・`usePathwayVarianceTasks`、記録は `buildPathwayEvaluationBundle` と `useRecordPathwayEvaluation`。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 看護師・医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: カルテの「パス」タブを開く
  UI->>BE: GET /fhir(CarePlan?patient&category=パスの印&part-of:missing=true&_sort=-date)
  BE->>FHIR: 検索
  FHIR-->>UI: 適用の根(複数ならタブ、進行中が既定)
  par 木
    UI->>BE: GET /fhir(CarePlan?part-of=適用&_include=CarePlan:goal<br/>&_revinclude=Procedure:based-on&_include:iterate=Procedure:based-on<br/>&_revinclude:iterate=Task:focus,Procedure:based-on)
    BE->>FHIR: 検索(500 件ずつ、total まで)
    FHIR-->>UI: 病日・OAT ユニット・観察項目・適正値の Goal・タスク・オーダーのヘッダ・進捗の Task・実施記録
  and 評価
    UI->>BE: GET /fhir(Observation?patient&category=パスの印、全ページ)
    BE->>FHIR: 検索
    FHIR-->>UI: 評価(judgement)・実績・総合評価(comp-assessment)
  and 終了・通知
    UI->>BE: GET /fhir(Goal?identifier=apply-goal-id|適用、Task?patient&code=pathway-variance)
    BE->>FHIR: 検索
    FHIR-->>UI: 終了・中止の記録、既存のバリアンス通知
  end
  UI->>UI: buildPathwaySheet(識別子で行をまとめ、続きは 1 行)、buildEvaluationState(最新と履歴)
  Ns->>UI: 日めくりで実績値・タスク・達成状態を入れて「記録(n 件)」
  UI->>BE: GET /fhir(経過表の値 = 実績値の候補。useVitalFlowsheet、その日だけ)
  UI->>BE: POST /fhir(transaction。変えたアウトカムごとに組んで entry をつなぐ)
  Note over UI,BE: 初回: POST Goal(outcome-goal-id)+ POST Observation 評価 + PUT CarePlan OAT ユニット(goal を足す)<br/>2 回目以降: POST Observation 評価(記録番号 +1)+ PUT Goal(最新)<br/>値が変わった観察項目だけ POST Observation 実績、基準があれば PUT 適正値の Goal(achievementStatus)<br/>状態の変わったタスクだけ PUT Procedure(completed / preparation)<br/>テンプレートの回答 POST QuestionnaireResponse、総合評価は PUT / DELETE Observation(comp-assessment)<br/>重要アウトカムが未達成に変わった: POST / PUT Task pathway-variance(owner = 主治医)<br/>未達成でなくなった: PUT Task cancelled
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(パスの木・Observation・Goal・通知の件数を読み直す)
```

- 上流は `_revinclude:iterate` を 2 つ並べると最後の 1 つしか効かないので、カンマで 1 つにします。
- 既存の Observation には PUT も DELETE もしません(実績の訂正は正しい値をもう一度記録する)。テンプレートの回答も消さず、再編集したら新しい回答を POST して新しい評価だけが指します。
- オーダーを持たないタスクを 1 件だけ実施・未実施にする(`PathwayTaskPanel`、指示簿の「パスのタスク」)は `buildPathwayTaskBundle` の Procedure の PUT だけで、評価には触れません。
- パスタブから開いたオーダー詳細・実施入力・看護指示の実施入力は種別ごとの一覧しか読み直さないので、閉じたときに木を読み直します(`PATHWAY_TREE_KEY_PREFIX`)。

### シーケンス図: 指示簿のパスのタスク

`usePathwayWardTasks`、`parsePathwayWardTasks`。看護指示と違って `ward` 検索は使えないので、その日の入院患者のベッドから病棟を決めます。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: 病棟の指示簿で病棟と基準日を選ぶ
  UI->>BE: GET /fhir(Encounter 入院中 → ベッドから病棟の患者)
  BE->>FHIR: 検索
  FHIR-->>UI: 病棟の患者
  UI->>BE: GET /fhir(CarePlan?category=pathway-level|event&date=基準日&subject=患者(カンマ OR)&_include=CarePlan:part-of)
  BE->>FHIR: 検索
  FHIR-->>UI: 基準日の病日と適用の根(進行中だけ残す)
  UI->>BE: GET /fhir(CarePlan?part-of=病日(カンマ OR、10 件ずつ)&_revinclude=Procedure:based-on)
  BE->>FHIR: 検索
  FHIR-->>UI: 子孫とタスク(オーダーを持たない Procedure だけ並べる)
  Ns->>UI: チェックで実施 / 未実施
  UI->>BE: POST /fhir(transaction。PUT Procedure completed / preparation、performedDateTime・performer)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### シーケンス図: 終了・中止・日程の変更・取り消し

`buildPathwayCloseBundle` / `buildPathwayReopenBundle`(`useClosePathway`)、`planPathwayShift` / `buildPathwayShiftBundle`(`useShiftPathwaySchedule`)、`planPathwayCancel` / `buildPathwayTreeDeleteBundle`(`useCancelPathwayApplication`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 終了・中止
    Dr->>UI: 「終了・中止」で区分・終了日・中止理由・総合評価
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT CarePlan 適用 status=completed / revoked、period.end<br/>POST Goal apply-goal-id(lifecycleStatus、EPathGoalStatusReason、note)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(終了・中止したので同じ入院に当て直せる)
  else 終了の記録の取り消し
    UI->>BE: POST /fhir(transaction。PUT CarePlan active・period.end を落とす、DELETE Goal)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 日程の変更
    Dr->>UI: 起点の病日と新しい日付
    UI->>UI: planPathwayShift(起点から後ろに評価・実施・看護指示の実施記録・実施済みのオーダーがあれば blocker)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT CarePlan 病日(period)、PUT Procedure タスク(予定日の拡張)<br/>起点が最初の病日なら PUT CarePlan 適用(period.start)<br/>看護指示・食事の ServiceRequest の開始・終了を PUT + Provenance(UPDATE)<br/>その他の種別は触らず、シートに「日付違い」
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 適用の取り消し・フェーズの取り消し
    Dr->>UI: ケバブ「適用の取り消し」(または「フェーズの取り消し」)
    UI->>UI: planPathwayCancel(評価・実施済みタスク・看護指示の実施・実施済み・部門が受け付けたオーダーがあれば blocker)
    loop 雛形から出したオーダーごと
      UI->>BE: 種別ごとの削除の本体(delete…Request。明細・予約の取消・記入の削除は各種別。看護指示は指示と Task を DELETE)
      BE->>FHIR: DELETE / transaction
    end
    UI->>BE: POST /fhir(transaction。木の CarePlan・Procedure・適正値の Goal を DELETE。Provenance は残す)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(読み直しは最後に 1 回。URL の view を外す)
  end
```

- 取り消しで種別ごとの削除の hook を使わないのは、hook が 1 件ごとに一覧を読み直させ、数十件を続けると上流の回数制限に当たるためです。途中で失敗したら木は残し、もう一度開けば残ったオーダーから続けられます。
- 退院の transaction はパスに触りません(看護指示・食事・リハビリの打ち切りだけ)。退院後も進行中のまま残るのは運用で閉じます(バックログ A-6)。

### 医事会計と SS-MIX2

パスの計画・評価そのもの(CarePlan・Goal・パスの Observation・タスクの Procedure)は請求の項目を持たず、SS-MIX2 の対象リソース(`Ssmix2::Dispatcher::RESOURCE_TYPES`)にも入っていません。雛形から出たオーダーは、パスから出たことに関係なく各種別の規則で送られます。

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 定義の保存・承認・複製・廃止 | なし | なし |
| 適用・次のフェーズ・予定外の追加(計画の木) | なし | なし |
| 雛形から出たオーダーの登録 | 種別ごと(処方・食事・看護指示・他科依頼は対象外、部門オーダーは実施記録から) | 種別ごと(処方・注射は `RDE^O11`、検体検査は `OML^O33`、放射線・生理などは `OMG^O19`、食事は `OMD^O03`。看護指示・他科依頼は出さない) |
| 雛形から出たオーダーの実施 | 種別ごと(実施記録から送る) | 種別ごと(`RAS^O17` / `OMI^Z23` など) |
| 評価・実績・総合評価・タスクの実施(チェックリスト) | なし | なし |
| 日程の変更 | なし(看護指示・食事の日付が動くだけ) | 書き換えた食事オーダーごとに `OMD^O03`(`NW`)。看護指示はメッセージにならない |
| 終了・中止・終了の記録の取り消し | なし | なし |
| 適用の取り消し | 消したオーダーが対象から外れる(種別ごと) | 消したオーダーの `CA`(DEL)(種別ごと) |
| バリアンスの通知 | なし | なし |

雛形から出たオーダーかどうかは、ヘッダの `identifier`(`pathway-instance`)と拡張 `pathway-order` で判定します(`pathwayOf`)。
