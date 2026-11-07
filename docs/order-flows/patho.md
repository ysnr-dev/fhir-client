# 病理検査オーダーの業務フロー

病理検査オーダーの登録から採取・ラベル発行・病理受付・レポート・結果確認・患者説明までの流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
進捗の考え方は検体検査と同じなので、この文書は [lab.md](lab.md) との違いを中心に書きます。
設計は [patho-order-design.md](../patho-order-design.md)、画面のふるまいは [features/lab.md](../features/lab.md)「病理検査オーダーの検体個数・容器数と採取」「病理診断レポートの診断医・重要度・追加報告・患者説明」、
種別共通の約束(中止・削除・代行入力)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。
組織診・細胞診・術中迅速は 1 つのオーダーの検査区分で分けます。免疫染色の追加依頼・遺伝子検査・剖検はオーダーにありません。標本作製(カセット・スライド)は病理部門システムの領域で、電子カルテには記録しません。

## 運用フロー

### 検査区分ごとの違い

| | 組織診 | 細胞診 | 術中迅速 |
|---|---|---|---|
| 検体タイプ | 生検・手術材料 | 細胞診材料 | 生検・手術材料 |
| 至急区分 | 通常が初期値 | 通常が初期値 | 至急が入る(通常に戻せる) |
| 手術室番号 | なし | なし | 入れられる |
| レポートの診断 | 自由文かテンプレート | 判定 5 段階と推定病変 | 自由文かテンプレート |
| 重要度の初期値 | なし | 判定が悪性・悪性疑いなら同じ重要度 | なし |

レポートの持ち方と進捗はどの区分でも同じです。

### 検体検査との違い

| | 検体検査 | 病理検査 |
|---|---|---|
| オーダーの単位 | 検体をまたいで 1 オーダー | 1 オーダーに検体を複数入れる。多部位の生検は検体ごとに臓器を分ける |
| ラベル発行 | 発行が受付を兼ねる。病棟は一括発行 | **進捗を動かさない**。容器ごとに 1 枚で、カルテのカードか一覧の行から刷る |
| 採取の記録 | なし | **あり**。採取日時と、検体ごとの個数・容器数・臓器・左右。誰が採ったかは残らない |
| 受付済 | ラベルを発行した | **全容器のラベルを読んで受け付けた**。病理受付番号が振られる |
| 終わりの状態 | 全部の管が届くと実施済 | **一覧の「検査済」を押す**。レポートの保存では動かない |
| 報告区分 | 中間・最終・訂正 | 下書き・中間・最終・訂正・追加 |
| 緊急の通知 | パニック値 | なし。重要度(悪性疑い・悪性)が付くと検査結果確認がアラートになる |
| 確認の後 | なし | **患者説明の台帳**を依頼医が閉じる |
| 結果の入れ方 | 手入力とファイル取込 | 手入力だけ |

採取(予定)日時は必須で、予約枠は使いません。日付未定・即実施・事後はありません。登録時の警告もありません。

### 病理検査の状態

病理部門の進み具合を示す状態です。レポートの報告区分はこの状態に含めず、一覧の「レポート」の列(未・下書き・中間報告・最終報告・訂正報告・追加報告)で見せます。

| 状態 | 変わるきっかけ | 病理検査一覧からできること |
|---|---|---|
| 依頼済 | 医師の登録、取消、中止取消 | 受付(病理受付を開く)、受付済にする、中止、ラベル発行 |
| 受付済 | 病理受付の受付、受付済にする、検査済の取消 | 検査済、レポート登録・編集、取消(依頼済へ)、中止、ラベル発行 |
| 検査済 | 一覧の「検査済」 | レポート登録・編集、取消(受付済へ)、ラベル発行 |
| 中止 | 中止 | 中止取消(依頼済へ) |

- 検査済とレポートは別々に動きます。最終報告を保存しても受付済のままで、レポートが無くても検査済にできます。
- 一覧は採取(予定)日の 1 日ぶんです。細菌検査の「未完了(14日)」はありません。前の日のオーダーは日付を送るか、「ラベル番号・病理受付番号」欄の番号で呼び出します。
- 検体の列に容器の総数を出し、依頼済で採取の記録が無ければ「未採取」と出します。

容器 1 つごとに別の状態があります。**未発行 → 発行済 → 到着済**で、病理受付の表に番号と照合の「済」が出ます。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["医師"]
    input["病理検査を入力<br/>検査区分・採取(予定)日時・検体<br/>臨床経過・シェーマ"]
    register["登録<br/>(登録の判定)"]
  end

  subgraph ward["病棟・外来・手術室・内視鏡室"]
    collect["採取して記録し、ラベルを貼る<br/>(採取とラベル)"]
  end

  subgraph patho["病理部門"]
    reception["全容器のラベルを読んで受付<br/>(病理受付の流れ)"]
    prepare["標本作製・鏡検<br/>電子カルテの外"]
    interim["必要なら中間報告で保存<br/>(レポートの登録と報告)"]
    finalReport["診断を確定して最終報告で保存"]
    examined["一覧の「検査済」"]
  end

  subgraph review["医師"]
    notify["検査結果確認の通知"]
    confirm["結果を確認<br/>(結果の確認と患者説明)"]
    explain["患者に説明して記録"]
  end

  start --> input --> register --> collect --> reception --> prepare --> interim --> finalReport --> examined
  finalReport --> notify --> confirm --> explain --> finish
```

- 手術や内視鏡で採る検体も、別に病理検査オーダーを出します。手術オーダーの検体提出予定からは作られません。
- 医師は中間報告の内容をカルテで読めますが、通知は出ず、確認の記録も残せません。
- 外来の診察終了で、当日の病理検査が依頼済・受付済のまま残っていると「一時終了」を選べます。中間報告以降のレポートがあれば対象になりません。外来患者一覧の印も、下書きはレポートなしと同じに扱います。
- 看護ワークシートに病理の採取の印はありません。採取の記録はカルテのカードから行います。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  date{"採取(予定)日時がある?"}
  organ{"検体ごとに<br/>臓器・検査材料がある?"}
  count{"容器数は 1 以上?<br/>検体個数は空か 1 以上?"}
  error["入力エラーを表示<br/>該当の項目に印を付ける"]
  send["オーダーを保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は指示医師本人?"}
  approval["指示医師に承認待ちの通知"]
  done((("登録完了")))
  fix["入力を直す"]

  submit --> date
  date -- "いいえ" --> error
  date -- "はい" --> organ
  organ -- "いいえ" --> error
  organ -- "はい" --> count
  count -- "いいえ" --> error
  count -- "はい" --> send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
  error --> fix --> submit
```

- 検体ごとに検体タイプ・臓器・左右・採取法・補足・検体個数・容器数を入れます。検体タイプは検査区分で選べるものが変わり、区分を切り替えると合う値に直ります。
- 検体個数は任意です。採取するまで分からないことが多いので、依頼時は空で構いません。容器数の初期値は 1 です。
- 臓器・検査材料は頻用の印が付いたものがボタンで並び、ほかは検索します。検索は名称と ICD-10 で引けます。
- 臨床経過は自由入力かテンプレートです。既定のテンプレートはなく、毎回選びます。
- シェーマはシェーママスタの臓器図に描き、複数枚添付できます。
- 承認待ちでもオーダーは部門に流れます。オーダーセット・クリニカルパスからの適用も同じ保存を通ります。

### 採取とラベル

```mermaid
flowchart TD
  start(("検体を採る"))
  open["カルテのカードの「採取」"]
  record["採取日時を入れる<br/>検体ごとの臓器・左右・個数・容器数を直す"]
  valid{"採取日時がある?<br/>個数・容器数は 1 以上?"}
  error["入力エラーを表示"]
  print{"「ラベル発行」にチェック?"}
  issue["容器ごとにラベルを刷る"]
  later["カードか一覧のメニューから後で刷る"]
  paste["容器に貼って病理部門へ"]
  done((("採取完了")))

  start --> open --> record --> valid
  valid -- "いいえ" --> error --> record
  valid -- "はい" --> print
  print -- "はい" --> issue --> paste
  print -- "いいえ" --> later --> issue
  paste --> done
```

- 「採取」は依頼済のあいだだけ出ます。記録の後は「採取修正」になり、受け付けられると出なくなります。
- 検体個数は依頼時は任意ですが、採取では必須です。仮の数のまま搬送しないためです。
- 採取日時は 1 つで、全検体に同じ値が入ります。採取者の欄はなく、ネームバンドの照合もありません。
- ラベルは容器 1 つに 1 枚で、番号のバーコード・患者番号・氏名・カナ・生年月日・性別・「検体1 右 胃前庭部」・「容器 2/3」・検査区分・検体タイプ・採取法・個数・採取日(未採取なら予定日)・至急を刷ります。
- 同じ容器は刷り直しても同じ番号です。容器数を減らしたり検体を外したりして刷り直すと、余ったラベルは取り下げになります。戻すと同じ番号で復帰します。
- 取り下げも新しい容器の発行も、**ラベルを刷ったとき**に起こります。チェックを外して容器数を直すと、受付で数が合いません(増やした容器は「ラベル未発行」、減らした容器のラベルは「オーダーの容器に当たらないラベル」)。
- 検体検査の「ラベル一括発行」に病理検査は入りません。中止したオーダーには発行できません。

### 病理受付の流れ

画面は**部門業務 > 病理部門 > 病理受付**で、一覧の「受付」からも開きます。検体検査の検体到着確認とは別の画面です。1 容器ごとに記録する到着確認と違い、全容器を読み終えてから 1 回で受け付けます。

```mermaid
flowchart TD
  scan(("ラベルを読む"))
  check{"読んだラベルの検査"}
  alert["赤い警告を出す<br/>照合に入れない"]
  target{"照合の対象がまだ無い?"}
  load["そのオーダーを照合の対象にする<br/>患者・検査・容器の表を出す"]
  same{"照合中のオーダーのラベル?"}
  other["別の患者・別のオーダーと警告"]
  fit{"オーダーの容器に当たる?"}
  state{"オーダーの状態"}
  info["受付済のオーダーと案内<br/>受付番号を表示"]
  mark["容器に「済」を付ける"]
  all{"全容器を読んだ?<br/>未発行の容器が無い?"}
  more(("次の容器へ"))
  receive["「受付」を押す"]
  done["受付済になる<br/>病理受付番号が振られる<br/>容器に到着が残る"]
  finish((("受付完了")))

  scan --> check
  check -- "番号の形式違い・発行記録なし<br/>検体検査のラベル・取り下げたラベル" --> alert --> more
  check -- "病理の有効なラベル" --> target
  target -- "はい" --> load --> fit
  target -- "いいえ" --> same
  same -- "いいえ" --> other --> more
  same -- "はい" --> fit
  fit -- "いいえ" --> alert
  fit -- "はい" --> state
  state -- "中止" --> alert
  state -- "受付済・検査済" --> info --> more
  state -- "依頼済" --> mark --> all
  all -- "いいえ" --> more
  all -- "はい" --> receive --> done --> finish
```

- 検体検査と細菌検査のラベルはどちらも「検体検査の検体です」で弾きます。
- 一覧の「受付」から開くと対象のオーダーが決まった状態で始まり、別のオーダーのラベルは警告になります。ここでもラベルを全部読むまで受付は押せません。
- 読み間違えたら「やり直し」で照合を捨てます。
- ラベルの無い古いオーダーは、一覧のメニューの「受付済にする」で受け付けます。照合を通らず、病理受付番号だけ振られ、容器の到着は残りません。
- 「取消」で依頼済に戻しても、病理受付番号と容器の到着の記録は残ります。受け付け直しても番号は変わりません。
- 検体到着確認で病理のラベルを読むと「病理の受付で読んでください」と出して記録しません。
- 一覧の「ラベル番号・病理受付番号」欄に番号を入れると、そのオーダーの日に移って内容を開きます。

### レポートの登録と報告

```mermaid
flowchart TD
  open(("レポートを書く"))
  where{"入口"}
  worklist["病理検査一覧のレポート登録<br/>受付済・検査済の行"]
  karte["カルテの検査結果 > 病理検査<br/>新規登録・編集"]
  link["オーダーを選ぶ<br/>レポートの無いオーダーから。紐付けなしも可"]
  fill["検体情報を確認し、所見と診断を入力<br/>肉眼・顕微鏡所見、追加染色<br/>診断(細胞診は判定と推定病変)<br/>診断医・重要度・フォロー推奨・画像"]
  confirmed{"確定済みのレポート?"}
  status{"報告区分"}
  revise{"訂正報告か追加報告を選ぶ"}
  draft["一時保存<br/>下書き。臨床側に見せない"]
  prelim["中間報告で保存<br/>臨床側から読める"]
  need{"診断(判定)と診断医がある?"}
  error["入力エラーを表示"]
  tasks["依頼医に検査結果確認の通知<br/>患者説明の台帳<br/>フォロー推奨があればその台帳"]
  done((("保存完了")))

  open --> where
  where -- "病理部門" --> worklist --> fill
  where -- "病理部門・医師" --> karte --> link --> fill
  fill --> confirmed
  confirmed -- "いいえ" --> status
  confirmed -- "はい" --> revise --> need
  status -- "一時保存" --> draft --> done
  status -- "中間" --> prelim --> done
  status -- "最終" --> need
  need -- "いいえ" --> error --> fill
  need -- "はい" --> tasks --> done
```

- 検査済・受付済はレポートの保存では動きません。一覧の「検査済」を別に押します。
- 一覧から開くとオーダーは行で決まり、検査区分と検体をオーダーから写します。検体の採取日の初期値は採取の記録の日で、記録が無ければオーダーの採取予定日です。実際と違えば直します。
- カルテからは、進捗によらずレポートの無いオーダーを選べます。依頼済や中止のオーダーにも書けて、状態はそのままです。オーダーに紐付けないレポートは依頼医がいないので、通知と台帳は宛先なしで作られます。
- 1 オーダーにレポートは 1 件です。中間報告を編集して最終報告に切り替えます。
- 一時保存は報告日だけで保存でき、フォームを閉じます。**下書きは公開前のレポートだけ**で、中間報告以降を下書きには戻せません。下書きはカードではレポートなしと同じ扱いで、病理タブでは破線の枠で並び、内容は出ません。病理検査一覧では内容まで見えます。
- 確定済みのレポートを編集すると、訂正報告か追加報告を毎回選びます。診断を改めるなら訂正、免疫染色の結果を足すなら追加です。最終報告には戻せません。
- 診断医は 3 人まで入れられ、ログイン中の医師が 1 人目に入ります。確定する報告には 1 人以上が必須で、中間報告は診断も診断医も空で保存できます。
- 組織診・術中迅速の診断はテンプレートから書けます。同梱は固形がん共通 TNM と大腸癌です。この回答から院内がん登録の形態コード・pTNM・病期の初期値が入ります。
- 画像はファイルからの添付と、シェーマへの切り出し図の描き込みです。種別は肉眼写真・切り出し図・鏡検写真・その他です。

### 結果の確認と患者説明

確認の仕組みは検体検査と同じです([lab.md](lab.md)「結果の確認」)。病理には、その後に患者へ伝えたかを追う台帳があります。

```mermaid
flowchart TD
  saved(("確定の報告が保存された<br/>最終・訂正・追加"))
  severity{"重要度がある?"}
  alert["検査結果確認(アラート)<br/>悪性・悪性疑いの印"]
  notice["検査結果確認(お知らせ)"]
  ledger["患者説明の台帳に載る<br/>ベルには出ない"]
  where{"医師が確認する場所"}
  fromList["通知の「カルテ」から<br/>検査結果 > 病理検査を開く"]
  fromKarte["カルテの検査結果 > 病理検査<br/>またはカードのレポート表示"]
  recorded["確認者と日時を記録<br/>通知を確認済みに"]
  stale["7 日以上未確認なら<br/>検査結果フォローの「未確認の結果」に残る"]
  explain["「患者説明」で記録<br/>説明済・紹介先で説明・説明不要"]
  auto["未確認なら確認も同時に記録"]
  overdue["検査結果フォローの「患者説明」タブ<br/>14 日以上は経過が赤"]
  done((("説明の記録済み")))

  saved --> severity
  severity -- "はい" --> alert --> where
  severity -- "いいえ" --> notice --> where
  saved --> ledger --> explain --> auto --> done
  where -- "通知" --> fromList --> recorded
  where -- "カルテ" --> fromKarte --> recorded
  alert -. "放置" .-> stale
  notice -. "放置" .-> stale
  ledger -. "放置" .-> overdue
```

- 宛先は依頼医ですが、確認は誰でもできます。記録には確認した本人が残ります。
- 中間報告と下書きのうちは確認できず、台帳にも載りません。
- 訂正報告・追加報告で保存すると、確認は未確認に、説明は説明済みでも未説明に戻ります。通知には「訂正報告」「追加報告」の印が付きます。
- 説明の記録には対応・説明日・メモを入れます。ログインしたユーザーが医療従事者に紐付いていないと記録できません。誤りは一覧の「未説明に戻す」で直します。
- 一覧の「自分あてのみ」を外すと全員分を見られ、「重要度ありのみ」で絞れます。件数はホームの「検査結果フォロー」カードに出ます。
- フォロー推奨の扱いは読影・所見レポートと同じで、確定で台帳に載り、推奨か期限を変えると未対応に戻ります。

### 変更・中止・削除

| 操作 | できる場所 | できないとき・注意 |
|---|---|---|
| 変更 | カルテのカード | 進捗では止まりません。検体や容器数を変えたら、ラベルを刷り直します |
| 採取の修正 | カルテのカードの「採取修正」 | 依頼済のあいだだけです |
| 中止 | 病理検査一覧のメニュー | 依頼済・受付済から。検査済からはできません。レポートが付いていても止まらず、レポートは残ります |
| 中止取消 | 病理検査一覧のメニュー | 依頼済に戻ります |
| 取消 | 病理検査一覧のメニュー | 1 つ前の状態に戻す訂正です。受付の取消で病理受付番号と到着の記録は消えません |
| 削除 | カルテのカード | レポートが付いているとできません(下書きを含む。レポートを削除してから)。進捗は一緒に消え、発行済みの容器の記録は残ります |
| レポートの削除 | カルテの検査結果 > 病理検査 | 所見・検体・テンプレートの回答を消し、**未確認の検査結果確認・未説明の患者説明・未対応のフォロー推奨を取り下げます**。報告区分によらず消せます。進捗は動きません |

- 変更は再度の承認を要する場合があります(代行入力のとき)。部門への通知はなく、一覧の内容で見えます。
- DO はオーダーの内容と検体の個数・容器数を写します。採取の記録・ラベル・受付番号・レポート・テンプレートの紐付け・シェーマは写りません。臨床経過の文言は残ります。

### 帳票

| 帳票 | 出す場所 | 内容 |
|---|---|---|
| 病理検体ラベル | 採取の記録、カルテのカードのメニュー、病理検査一覧のメニュー | 容器 1 つ 1 枚(「採取とラベル」) |

病理診断レポートの報告書はありません。レポートはカルテと一覧で読みます。

## 開発者向け

### リソースの構成

オーダーは 2 層です。ヘッダの `ServiceRequest`(`order-type|pathology`、`code` = 検査区分 LPATHO001)← `basedOn` ── 検体明細(contained `Specimen`)です。検査項目の層はありません(`fhir/pathoOrderHelpers.ts`)。
ヘッダは拡張 `patho-clinical-info`(臨床経過)・`patho-clinical-info-questionnaire-response`(テンプレートの回答)・`patho-report-due`(報告希望日)・`patho-operating-room`(手術室番号)・`patho-schema-image`(シェーマ、`Binary`)を持ちます。

| もの | リソース | 補足 |
|---|---|---|
| 進捗 | `Task`(`task-code|patho-exam`、`focus` = ヘッダ) | 下の表 |
| 採取の記録 | 検体明細の contained `Specimen` の `collection`(`collectedDateTime`・`quantity`・`bodySite`)と拡張 `patho-container-count` | 明細だけを PUT する(ヘッダを組み直すと依頼医が替わる)。来歴は付けない。`collector` は持たない |
| 容器の台帳 | `Specimen`(`request` = [ヘッダ, 検体明細]、`identifier` = `patho-container`、`accessionIdentifier` = ラベル番号) | `identifier` の値は「検体明細の id:明細内の順番」。発行 = 作成、到着 = `receivedTime` + `status: available`、取り下げ = `entered-in-error`。番号は検体検査の採取管と同じ採番 |
| 病理受付番号 | ヘッダの `identifier`(`IdSystem/patho-accession-number`) | 上流の `ServiceRequest/$next-identifier` で払い出す。編集でも元の値を引き継ぐ |
| 結果 | `DiagnosticReport`(`category` = v2-0074 `SP` / `CP`、`code` = LOINC `11526-1`、`basedOn` = ヘッダ、`status` = `registered` / `preliminary` / `final` / `amended` / `appended`)+ `Observation` | 所見は規約のセクション LOINC を `Observation.code` に使う(肉眼 `22634-0`・顕微鏡 `22635-7`・診断 `22637-3`・追加染色 `10157-6`)。細胞診の診断は `valueCodeableConcept`(判定)+ `component`(推定病変)。`Observation.status` に `appended` は無いので `amended` にする |
| レポートの補足 | `resultsInterpreter`(診断医)、拡張 `patho-report-importance`(重要度)・`patho-follow-up`(フォロー推奨)・`patho-report-image`(画像、`Binary`)・`patho-diagnosis-response`(診断のテンプレートの回答) | 回答はレポートと同じ transaction に積む |
| 結果の検体 | `Specimen`(`type` = 検体タイプ) | 結果側が所有する。ラベルの台帳とは別で、参照しない |
| 検査結果確認の通知 | `Task`(`task-code|result-review`、`focus` = 結果、`owner` = 依頼医) | 確定の報告のとき。重要度ありは `priority = stat`、印は `input` |
| 患者説明 | `Task`(`task-code|result-explanation`、`focus` = 結果、`owner` = 依頼医) | `completed` で記録済。対応と説明日は `output`。通知のレジストリには載せない |
| フォロー推奨 | `Task`(`task-code|followup-recommendation`、`focus` = 結果、`owner` = 依頼医) | 読影・所見レポートと同じ |
| 確認(既読) | `Provenance`(`target` = 結果、`agent.type = verifier`、`signature`) | 検体検査と同じ |
| 代行入力 | `Provenance`(`target` = ヘッダ、`activity` CREATE / UPDATE) | 明細は `target` に入れない |

### 進捗 Task(`patho-exam`)

Task は登録時には作りません。**Task が無いオーダーは依頼済**として扱い、最初の受付・中止で作ります(`fhir/pathoTaskHelpers.ts`)。
中止は同じ transaction でヘッダを `revoked` にし、中止取消で `active` に戻します(`orderCancelEntries`)。中止したオーダーを編集しても `revoked` のままです(`keepOrderRevoked`)。

| 状態 | `Task.status` | `executionPeriod` | 進めるもの |
|---|---|---|---|
| 依頼済 | `requested`(または Task 無し) | なし | 受付の取消、中止取消 |
| 受付済 | `accepted` | `start` | 病理受付、受付済にする、検査済の取消 |
| 検査済 | `completed` | `start` / `end` | 一覧の「検査済」 |
| 中止 | `cancelled` | なし | 一覧の中止 |

検体検査・細菌検査と違い、レポートの保存・削除は Task に触りません。報告区分は `DiagnosticReport.status` が正本です。
外来の印(`fhir/outpatientOrderProgressHelpers.ts`)はレポートがあれば進捗より先にレポートの段階を見ます。`registered`(下書き)はレポートの段階に数えず、進捗で決めます。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。
例外はラベルの PDF で、backend(`PathoLabelReport`)が上流を直接読み書きします。こちらは batch Bundle です。

### シーケンス図: 登録・編集・削除

`components/PathoOrderForm.tsx`・`PathoOrderPanels.tsx`、`buildPathoOrderBundle` / `buildPathoOrderUpdateBundle` / `buildPathoOrderDeleteBundle`(`fhir/pathoOrderHelpers.ts`)、
`useCreatePrescription` / `useUpdatePrescription`(`api/queries/labResult.ts`。全種別共通)、`useDeletePathoOrder`(`api/queries/patho.ts`)、`postOrderDeleteBundle`(`api/queries/orderDelete.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 登録
    UI->>BE: GET /master/...(臓器・検査材料、採取法)
    BE-->>UI: マスタ
    Dr->>UI: 検査区分・採取(予定)日時・検体・臨床情報を入力して登録
    UI->>UI: 入力検証
    UI->>UI: Bundle を組む
    Note over UI: 画像 Binary・テンプレートの回答(ヘッダより先)<br/>ヘッダ ServiceRequest(fullUrl)<br/>検体明細 × 検体(contained Specimen)<br/>登録時の入院病棟を order-ward に<br/>Provenance(CREATE)<br/>代行・研修医: Task order-approval
    UI->>BE: POST /fhir(transaction)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 編集
    UI->>BE: GET /fhir(ヘッダ + 明細)
    BE->>FHIR: 検索
    FHIR-->>UI: ServiceRequest 一式
    Dr->>UI: 直して更新
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ヘッダ(ifMatch、identifier を引き継ぐ)<br/>明細は差分で POST / PUT / DELETE<br/>採取の記録はフォーム値に持ち回って保つ<br/>外した回答は DELETE、Binary は消さない<br/>Provenance(UPDATE)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(版違いは 412)
  else 削除
    Dr->>UI: 削除
    UI->>BE: GET /fhir(ヘッダ + 明細)
    BE->>FHIR: 検索
    FHIR-->>UI: オーダー一式
    UI->>BE: GET /fhir(Task・DiagnosticReport ほか)
    BE->>FHIR: 検索
    FHIR-->>UI: 従属リソース(レポートがあれば止める)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE ヘッダ・明細・回答・Task<br/>台帳の Specimen は残す
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 採取の記録とラベル発行

`components/PathoCollectionModal.tsx`、`buildPathoCollectionBundle`(`fhir/pathoOrderHelpers.ts`)、`useRecordPathoCollection`(`api/queries/patho.ts`)、
`Reports::PathoLabelPdfsController`、`PathoLabelReport`。保存の前に空のタブを開くのはポップアップブロックを避けるためで、PDF は保存の後に差し替えます(保存前に刷ると直す前の容器数になる)。

```mermaid
sequenceDiagram
  autonumber
  actor Staff as 医師・看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Staff->>UI: カードの「採取」、日時・個数・容器数を入力して保存
  UI->>UI: 入力検証、ラベル発行なら空のタブを開く
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: PUT 検体明細 × 検体(ifMatch)<br/>ヘッダは書かない
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
  opt ラベル発行
    UI->>BE: GET /reports/patho_labels/:order_id/pdf
    BE->>FHIR: GET /ServiceRequest?_id + 患者・明細・台帳の Specimen
    FHIR-->>BE: オーダー一式
    BE->>BE: いまの容器(明細 × 容器数)と台帳を突き合わせる
    opt 台帳と差がある
      BE->>FHIR: POST /(batch)
      Note over BE,FHIR: 無い容器を作成(ifNoneExist)<br/>外れた容器を entered-in-error<br/>戻した容器を復帰
      FHIR-->>BE: 採番された番号
    end
    BE-->>UI: PDF(1 ページ = 容器 1 つ)
  end
```

カードのメニューと一覧のメニューの「ラベル発行」は、`opt ラベル発行` の部分だけを新しいタブで行います。

### シーケンス図: 病理受付

`pages/PathoReceptionPage.tsx`、`expectedPathoContainers` / `buildPathoReceptionBundle`(`fhir/pathoReceptionHelpers.ts`)、
`fetchPathoReceptionContext` / `fetchContainerByLabelNumber` / `useReceivePathoOrder`(`api/queries/pathoReception.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Tech as 病理部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  loop 容器ごと
    Tech->>UI: ラベルを読む
    UI->>BE: GET /fhir(Specimen をラベル番号で検索)
    BE->>FHIR: 検索
    FHIR-->>UI: 台帳の Specimen
    opt 照合の対象がまだ無い、または別のオーダー
      UI->>BE: GET /fhir(ServiceRequest?_id + 患者・明細・Specimen・Task)
      BE->>FHIR: 検索
      FHIR-->>UI: オーダー文脈
    end
    UI->>UI: 容器の鍵で照合(合わなければ警告)
  end
  Tech->>UI: 受付
  opt 病理受付番号がまだ無い
    UI->>BE: GET /fhir(ServiceRequest/$next-identifier)
    BE->>FHIR: 採番
    FHIR-->>UI: 番号
  end
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: Task patho-exam = accepted<br/>PUT ヘッダ(identifier に受付番号、ifMatch)<br/>PUT Specimen × 容器(receivedTime・status available)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(版違いは 412)
```

### シーケンス図: 一覧・検査済・中止

`pages/PathoWorklistPage.tsx`、`usePathoWorklist` / `useUpdatePathoTaskStatus`(`api/queries/patho.ts`)、`makeUpdateTaskStatusHook`(`api/queries/worklist.ts`)、`findPathoOrderIdByNumber`(`api/queries/pathoReception.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Tech as 病理部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(ServiceRequest?category=pathology&occurrence=採取日&based-on:missing=true)
  Note over UI,BE: _include 患者<br/>_revinclude 明細(iterate)・Task・DiagnosticReport
  BE->>FHIR: 検索
  FHIR-->>UI: オーダー一式
  alt 受付済にする(照合なし)
    Tech->>UI: メニューの「受付済にする」
    UI->>BE: GET /fhir($next-identifier)、POST /fhir(transaction)
    Note over UI,BE: Task = accepted、PUT ヘッダ(受付番号)<br/>容器の到着は書かない
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 検査済・取消
    Tech->>UI: 検査済 / 取消
    UI->>BE: POST /fhir(Task patho-exam = completed / accepted / requested)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 中止・中止取消
    Tech->>UI: 中止 / 中止取消
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task patho-exam = cancelled / requested<br/>PUT ヘッダ revoked / active
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: レポートの登録・編集・削除

`components/KartePathoResultTab.tsx`・`PathoResultForm.tsx`・`PathoResultDetailPanel.tsx`、`buildPathoResultBundle` / `buildPathoResultUpdateBundle` / `buildPathoResultDeleteBundle` / `nextReportStatus`(`fhir/pathoResultHelpers.ts`)、
`useCreatePathoResult` / `useUpdatePathoResult` / `useDeletePathoResult` / `withPathoReportTasks`(`api/queries/patho.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Tech as 病理部門
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 保存
    Tech->>UI: 所見・診断・診断医・重要度・報告区分を入力して保存
    UI->>UI: 入力検証・Bundle を組む
    Note over UI: 画像 Binary・テンプレートの回答<br/>Specimen × 検体<br/>Observation × 所見<br/>DiagnosticReport(registered / preliminary / final / amended / appended)<br/>編集は差分で POST / PUT / DELETE
    opt 確定の報告
      UI->>BE: GET /fhir(依頼医、このレポートの Task)
      BE->>FHIR: 検索
      FHIR-->>UI: 宛先と既存の通知・台帳
      UI->>UI: result-review・result-explanation・followup-recommendation を足す
    end
    UI->>BE: POST /fhir(transaction)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(版違いは 412)
  else 削除
    Tech->>UI: 削除
    UI->>BE: GET /fhir(DiagnosticReport、このレポートの Task)
    BE->>FHIR: 読む
    FHIR-->>UI: レポートと通知・台帳
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE レポート → Observation → 結果側の Specimen → 回答<br/>requested の Task を cancelled に<br/>Task patho-exam には触らない
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

結果確認の書き込みは [lab.md](lab.md)「シーケンス図: 結果確認」のカルテからの経路と同じです(`ResultReviewAction`、`useMarkResultReviewed`)。

### シーケンス図: 患者説明の記録

`components/ResultExplanationAction.tsx`・`ResultExplanationModal.tsx`、`recordExplanationEntry`(`fhir/resultExplanationHelpers.ts`)、`useRecordExplanation` / `useReopenExplanation`(`api/queries/resultFollowup.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 「患者説明」で対応・説明日・メモを入力
  UI->>BE: GET /fhir(このレポートの result-review)
  BE->>FHIR: 検索
  FHIR-->>UI: 通知
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: Task result-explanation = completed(output に対応・説明日)<br/>未確認なら Provenance(verifier)と Task result-review = completed
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### 医事会計と SS-MIX2

病理検査は検体検査と同じくオーダーで集める種別です(`BillingClaimBuilder` の `:order` 経路)。実施入力を持たないので、進捗 Task は見ず、**オーダーの採取(予定)日**で集めます。採取の記録の日時は使いません。中止は `ServiceRequest.status` で判定します。
レセ電算コードは検査項目マスタではなく施設設定の「病理検査(検査区分ごと)」から検査区分で引きます(`Resolvers::Pathology`)。数量は検体明細の数です。判断料・診断料は日レセが自動算定します。
SS-MIX2 の電文は持ちません。`OmlO33` は `order-type|lab`、`OmgO19` は放射線・内視鏡・生理、`OulR22` は v2-0074 `LAB`、`OruR01` は `physio` だけを対象にします。

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 登録・編集 | 採取(予定)日のオーダーを検査区分のコードで送る。コードが未設定なら「送れない項目」に出す | なし |
| 採取・ラベル発行・受付・検査済 | なし | なし |
| レポートの保存・訂正・追加・削除 | なし | なし |
| 中止 | 対象から外れる(`ServiceRequest` が `revoked`) | なし |
| 削除 | 対象から外れる | なし |
