# 化学療法の業務フロー

レジメンの適用からクールの登録、当日の投与可否の確認、投与、終了までの流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
投与日の注射と内服は通常の注射・処方として流れるので、払出・調剤・実施の細部は[注射オーダーの業務フロー](injection.md)と[処方オーダーの業務フロー](prescription.md)を読みます。
画面のふるまいは [features/orders-common.md](../features/orders-common.md#化学療法レジメンマスタ)、設計は [chemo-regimen-design.md](../chemo-regimen-design.md) が正典です。

## 運用フロー

### 通常の注射・処方との違い

| 投与日のオーダー | 処方監査 | 帳票 | 払出・調剤 | 実施の記録 | 医事会計への送信 |
|---|---|---|---|---|---|
| 注射 | あり(投与日ごと) | 注射箋・注射ラベル(レジメン名・クール・Day 入り) | 払出登録 | あり | 外来は実施の記録から。外来化学療法加算と無菌製剤処理料を足す |
| 内服(入院) | あり | 処方箋(備考にレジメン名・クール・Day) | 調剤登録 | 経過表で | なし(外来のみ) |
| 内服(外来・院内) | あり | 処方箋(同上) | 調剤登録 | なし | 投与日の会計に載る |
| 内服(外来・院外) | なし(保険薬局が監査) | 院外処方箋(同上) | 保険薬局が調剤 | なし | 投与日の会計に載る |

- 適用 1 件で、開始日から 1〜3 クールを一度に登録します。投与日ごとに、その日の注射をまとめた 1 オーダーと、内服をまとめた 1 オーダーができます。
- 注射は注射日で注射一覧に、内服は投与開始日で処方一覧に並びます。数クール分をまとめて登録しても、登録した日の一覧には載りません。
- 処方監査は投与日のオーダーごとに行います。連日の注射のように束ねません。登録した日から未監査に並ぶので、先のクールも同じです。
- 処方監査一覧と注射一覧にレジメン名・クール・Day が出ます。監査の画面では体格と体表面積あたりの量も確かめられます。施設設定「監査済まで調剤登録・払出登録を出さない」も通常の注射・処方と同じくかかります。
- 中止しても監査は未監査のまま残ります。一覧の進捗に「中止」が出るので、薬剤師が監査済にして閉じます。
- 疑義照会は注射・処方と同じです([処方オーダーの疑義照会の流れ](prescription.md#疑義照会の流れ))。
- 投与日のオーダーは DO できません。同じ内容をもう一度出すときは次クールを登録します。

### レジメンマスタの状態

| 状態 | 適用 | 内容の変更 |
|---|---|---|
| 下書き | できない | できる |
| 承認済 | 有効期間内ならできる | できない。複製して承認し直し、元を廃止する |
| 廃止 | できない | できない |

承認済を下書きへ戻せるのは、患者に 1 件も適用していないレジメンだけです。治療中の患者の次クールは、元のレジメンが廃止や有効期間外になっても注意を出して登録できます。

### 適用の状態

| 状態 | 変わるきっかけ | レジメン詳細からできること |
|---|---|---|
| 適用中 | 適用、再開 | 次クール登録、休止、適用編集、完了、レジメン中止、クール取消 |
| 休止 | 休止 | 再開、適用編集、完了、レジメン中止、クール取消 |
| 完了 | 完了 | 帳票の表示 |
| 中止 | レジメン中止(理由を選ぶ) | 帳票の表示 |

- 予定クール数に達しても自動では完了しません。最後のクールを終えたら医師が完了にします。予定クール数は適用編集で延ばせます。
- 休止は適用の状態だけを変え、登録済みの投与日はそのまま残します。一覧・払出登録・調剤登録に「休止中」の印が出ますが、払出と実施は止まりません。投与を止めるときは投与日を中止します。
- 完了とレジメン中止は、未実施の投与日をすべて中止にして、その日の化学療法室の予約も取り消します。実施済の日は残ります。
- 適用中・休止の適用があると、患者帯に化学療法のピクトグラムが出ます。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))
  book["外来は投与日ごとに<br/>化学療法室を予約"]

  subgraph doctorApply["医師"]
    apply["レジメンを選んで適用<br/>(登録の判定)"]
  end

  subgraph doctorDay["医師"]
    go{"検査値と体調を確認<br/>投与する?<br/>(投与可否の確認)"}
    change["投与日を移動・中止"]
  end

  subgraph pharmacy["薬剤部"]
    prepare["処方監査<br/>注射箋の発行と払出、内服は調剤"]
  end

  subgraph room["外来化学療法室・病棟"]
    perform["施用して実施を記録"]
  end

  subgraph doctorNext["医師"]
    adverse["有害事象を記録"]
    day{"次の投与日?"}
    cycle{"次のクール?"}
    addCycle["次クールを登録<br/>(登録の判定)"]
    close["完了・レジメン中止"]
  end

  start --> apply --> book --> go
  go -- "投与する" --> prepare --> perform --> adverse --> day
  go -- "見合わせる" --> change --> day
  day -- "あり" --> go
  day -- "なし" --> cycle
  cycle -- "続ける" --> addCycle --> book
  cycle -- "終える" --> close --> finish
```

- 図は標準の順序です。投与可否の確認は払出と実施を止めません。未確認のままでも払出と実施はできます。
- クールの途中でも休止できます。休止の間は次クールを登録できません(適用の状態)。
- 見合わせた日のために払い出した薬剤の扱いはシステムの記録の対象外で、運用で決めます。
- 実施は注射の[実施の流れ](injection.md#実施の流れ)と同じです。カルテのカード、注射カレンダー、経過表などから入力します。
- 化学療法室の予約はカルテの投与日パネルから、その投与日の枠だけを選びます。日を変えるときは投与日を移動します。移動した日の予約は取り消されるので取り直します。
- 外来化学療法室の一覧は予約の時間順に、レジメン・クール・投与可否・進捗を並べます。予約の無い患者は出ません。
- 有害事象はレジメン詳細のクール一覧から、クールごとに CTCAE 用語と Grade を記録します。次クールの登録画面に前のクールの有害事象が出ます。

### 登録の判定

適用と次クール登録は同じ画面で、同じ判定を通ります。

```mermaid
flowchart TD
  open(("レジメンを選ぶ<br/>次クール登録を押す"))
  calc["体格と基準から投与量を計算<br/>投与前チェックと警告を表示"]
  input["開始日・クール数・区分を確認<br/>投与量を確認し、必要なら減量"]
  submit["登録を押す"]
  valid{"入力は正しい?<br/>一度に 3 クールまで"}
  validError["入力エラーを表示"]
  confirm{"確認を要する警告がある?"}
  modal["確認モーダルで<br/>警告ごとに理由を選ぶ"]
  choice{"確認モーダルの操作"}
  ledger["警告と確認理由を記録"]
  send["全投与日のオーダーをまとめて保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  done((("登録完了")))

  open --> calc --> input --> submit --> valid
  valid -- "いいえ" --> validError --> input
  valid -- "はい" --> confirm
  confirm -- "はい" --> modal --> choice
  choice -- "戻る" --> input
  choice -- "登録" --> ledger
  confirm -- "いいえ" --> ledger
  ledger --> send --> result
  result -- "はい" --> done
  result -- "いいえ" --> failed --> input
```

| 警告 | 確認を要する(理由が必須) | 表示のみ |
|---|---|---|
| 投与前チェック | 適応基準を外れる検査値 | 値が取れない、古い(7 日より前) |
| 薬剤アレルギー | 銘柄または成分が一致 | |
| 累積投与量 | 上限を超える | 判定できない |
| 体重の変化 | 前のクールから ±10% 以上 | |
| レジメンの重なり | 同じレジメンが適用中・休止 | 別のレジメンが進行中 |
| 開始日 | | 過去日、登録済みの投与日と重なる |
| 候補外のレジメン | | 廃止・有効期間外、適用後のマスタ変更 |
| 妊娠・授乳 | | 該当するとき |
| 施設の規則 | 規則の設定による | 規則の設定による |

- 登録を止める警告はありません。基準外でも、理由を選べば登録できます。
- 次クールでは、前のクールの投与量・減量・区分が初期値になります。体格は直近の測定値が初期値で、「いまの体格で出し直す」を選ぶと投与量を計算し直します。
- 処方と違い、外部の判断支援への問い合わせはありません。

### 投与可否の確認

```mermaid
flowchart TD
  open(("暦の投与日を押す"))
  recheck["その日までの検査値で<br/>投与前チェックを出し直す"]
  doctor{"医師?"}
  view["状態だけ見る"]
  judge{"判断"}
  out{"基準外がある?"}
  ask["確認ダイアログ"]
  record["実施可を記録<br/>投与前チェックの結果も残す"]
  move["投与日を移動"]
  cancel["投与日を中止<br/>理由を残す"]
  done((("完了")))

  open --> recheck --> doctor
  doctor -- "いいえ" --> view --> done
  doctor -- "はい" --> judge
  judge -- "投与する" --> out
  out -- "はい" --> ask --> record
  out -- "いいえ" --> record
  record --> done
  judge -- "延期" --> move --> done
  judge -- "取りやめ" --> cancel --> done
```

| 印 | 意味 | 出る場所 |
|---|---|---|
| 未確認 | 実施可の記録が無い | 投与日パネル、注射一覧、処方一覧、外来化学療法室 |
| 実施可 | 医師が確認した | 同上と暦 |
| 要再確認 | 確認のあとで移動・編集した | 同上と暦 |
| 休止中 | 適用が休止中。投与可否の印に代わって出る | 注射一覧、処方一覧、外来化学療法室 |

- 記録できるのは基本の職種が医師・歯科医師のログインだけです。代行入力はありません。
- 実施可は同じ日の注射と内服の両方に記録します。「取消」で未確認に戻せます。
- 見合わせという状態はありません。延期は移動、取りやめは中止で記録します。
- 実施済・中止の日には確認欄も印も出ません。

### 変更・中止・削除

| 操作 | できる場所 | 範囲 | できないとき | 化学療法室の予約 |
|---|---|---|---|---|
| 移動 | 暦のドラッグ、投与日パネル | この日のみ / この日以降すべて | 実施済 | 取り消す |
| 編集 | 投与日パネル | その日 | | そのまま |
| 中止 | 投与日パネル | この日のみ / この日以降すべて | 実施済 | 取り消す |
| 中止 | カルテのカード(注射)、注射一覧・処方一覧のメニュー | その日 | 実施済、照会中など(注射・処方の文書のとおり) | 取り消す |
| 中止取消 | 投与日パネル | この日のみ / この日以降すべて | | 戻らない。取り直す |
| 中止取消 | カルテのカード(注射)、注射一覧・処方一覧のメニュー | その日 | | 戻らない。取り直す |
| クール取消 | レジメン詳細 | クール全体 | 依頼済・中止以外の日を含む | 取り消す |
| 削除 | カルテのカード | その日 | 注射は実施の記録があるとき | 取り消す |

- どこから中止しても、予約の取消と止めた人の記録は同じです。理由を入力できるのは投与日パネルだけで、範囲を選べるのも投与日パネルだけです。
- 注射カレンダーからは実施と実施取消だけができます。
- 中止取消は、受付済・払出済など中止する前の進捗に戻します。
- 編集すると投与可否は要再確認に戻り、再監査になります。
- 移動は投与量も進捗も変えませんが、投与可否は要再確認に戻り、再監査になります。受付済以降の日を動かすときは、確認の画面に件数が出ます。薬剤部へ通知は届かないので日付の変更を伝えます。
- 最初の投与日を移動すると、適用の開始日も合わせて動きます。
- 投与を止めるのではなく、登録の誤りを片付けるときはクール取消を使います。
- 代行で移動・中止・完了・休止などをすると、指示医師の承認待ちに並びます。

### 帳票

| 帳票 | 開く場所 | 内容 |
|---|---|---|
| 化学療法実施計画書 | レジメン詳細のクール一覧の「計画書」 | クールの投与日ごとのステップ・薬剤・投与量・進捗、確認欄 |
| スケジュール表 | レジメン詳細 | 患者向けの月の暦。中止した投与日は出さない |
| 公開用 PDF | レジメンマスタの編集画面 | 外部向けのレジメンの内容。承認済だけ |

## 開発者向け

### リソースの構成

適用 1 件はヘッダの `ServiceRequest`(`order-type|chemo-regimen`、`intent = plan`)です。投与日のオーダー(日オーダー)は通常の注射・処方で、`requisition` にヘッダと同じ `regimen-instance` の uuid、`regimen-order` 拡張にクール・Day・体格を持ちます。
日オーダーはヘッダを `basedOn` で指しません(`basedOn` を持つと明細として扱われ、一覧から消えます)。構造の全体は [chemo-regimen-design.md](../chemo-regimen-design.md) §7.1 です。

| 適用の状態 | ヘッダの `status` | 記録 |
|---|---|---|
| 適用中 | `active` | |
| 休止 | `on-hold` | |
| 完了 | `completed` | `regimen` 拡張の `completedOn` |
| 中止 | `revoked` | `regimen` 拡張の `discontinuationReason`・`discontinuationNote`・`discontinuedOn` |

日オーダーの進捗は注射の `injection`、処方の `rx-dispense` の Task で、状態の対応はそれぞれの文書のとおりです。

### 投与可否 Task(`chemo-go`)

日オーダー 1 件に 1 件で、確認し直しは同じ Task を書き直します。ヘッダの版を動かさないので、受付・払出では無効になりません。

| 印 | 判定(`regimenDecisionOf`) |
|---|---|
| 未確認 | Task が無い、または `status = cancelled` |
| 実施可 | `status = completed` で、`input` の版が日オーダーの `meta.versionId` と一致 |
| 要再確認 | `status = completed` で、版が一致しない |

版が読めないときは投与日の一致だけで判定します。日オーダーのヘッダを PUT する処理を足すと、実施可は要再確認に落ちます。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。

### シーケンス図: 適用・次クール登録

`components/RegimenApplyPanel.tsx`、`buildRegimenApplicationBundle`・`buildRegimenCycleBundle`(`fhir/regimenOrderHelpers.ts`)、`useCreatePrescription`(`api/queries/labResult.ts`。全種別共通)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: レジメンを選ぶ(次クールはレジメン詳細から)
  UI->>BE: GET /master/...(レジメン・投与量換算・用量規則)
  BE-->>UI: マスタ
  UI->>BE: GET /fhir(体格・検査結果・アレルギー・適用と日オーダー)
  BE->>FHIR: 検索
  FHIR-->>UI: 患者の記録
  UI->>UI: 投与量を計算(planDrugDose)
  UI->>UI: 投与前チェック・累積投与量・警告を判定
  Dr->>UI: 開始日・クール数・区分・投与量を確かめて登録
  UI->>UI: 入力検証(validateRegimenApply)
  opt 確認を要する警告がある
    UI-->>Dr: 確認モーダル
    Dr->>UI: 理由を選んで登録
  end
  UI-)BE: POST /master/advisory_events(発火・無視の台帳)
  UI->>UI: Bundle を組む
  Note over UI: 適用: POST ヘッダ ServiceRequest<br/>次クール: 体格か入外区分が変わればヘッダを PUT<br/>(身長・体重が揃わないクールは前の体格を残す)<br/>投与日ごと: 注射と内服の ServiceRequest<br/>+ MedicationRequest × 薬剤数<br/>Provenance(CREATE)<br/>注射・内服(院外を除く): Task rx-verification<br/>代行・研修医: Task order-approval<br/>警告の無視: Provenance
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>BE: transaction-response
  BE-->>UI: 結果
  UI->>UI: 暦・一覧・通知を読み直す
```

### シーケンス図: 投与可否

`RegimenDecisionFields`(`components/RegimenDecision.tsx`)、`useSaveRegimenDecision`、`fhir/regimenDecisionHelpers.ts`。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 暦の投与日を押す
  UI->>BE: GET /master/regimens/:id(適応基準)
  BE-->>UI: レジメン
  UI->>BE: GET /fhir(検査結果・体格)
  BE->>FHIR: 検索
  FHIR-->>UI: Observation
  UI->>UI: 投与日までの結果で投与前チェック(checkLabCriteria)
  alt 実施可
    Dr->>UI: コメントを入れて実施可
    opt 基準外がある
      UI-->>Dr: 確認ダイアログ
      Dr->>UI: OK
    end
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task chemo-go × その日の未実施の日オーダー<br/>status = completed、owner に医師<br/>input に投与日・オーダーの版・レジメン<br/>output に投与前チェックの結果
  else 取消
    Dr->>UI: 取消
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task chemo-go を status = cancelled
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### シーケンス図: 化学療法室の予約

`RegimenDayBooking`(`components/RegimenPanels.tsx`)、`ChemoBookModal`、`useBookChemoAppointment`、`buildChemoAppointmentBundle`。

```mermaid
sequenceDiagram
  autonumber
  actor Us as 利用者
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Us->>UI: 投与日パネルの予約
  UI->>BE: GET /fhir(投与日の Slot)
  BE->>FHIR: 検索
  FHIR-->>UI: Schedule・Slot(service-type = chemo)
  Us->>UI: 枠を選ぶ
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: POST Appointment<br/>basedOn はその日の注射の ServiceRequest
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

予約はオーダーと別の transaction です。適用時に取らないので、枠が空いていなくても適用は止まりません。

### シーケンス図: 移動

`RegimenMoveModal`・`RegimenDayPanel`(`components/RegimenPanels.tsx`)、`useMoveRegimenDays`、`buildRegimenMoveBundle`、`regimenStartDateEntries`。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 暦のマスを別の日に落とす、または日付を入れて移動
  UI-->>Dr: 範囲の確認(進捗が進んだ日があれば件数)
  Dr->>UI: この日のみ / この日以降すべて
  UI->>BE: GET /fhir(対象の日の監査 Task と予約)
  BE->>FHIR: 検索
  FHIR-->>UI: Task rx-verification・Appointment
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: 実施済を除く日の ServiceRequest・MedicationRequest を PUT<br/>印と投与量の拡張は写す<br/>最初の投与日が変われば、ヘッダの開始日も PUT<br/>Task rx-verification を未監査へ<br/>Provenance(UPDATE)<br/>予約を取消
  BE->>FHIR: POST /
  FHIR-->>UI: 結果(版違いは 412)
```

日オーダーを PUT するので投与可否は要再確認になります。進捗の Task は変えません。

### シーケンス図: 投与日の中止・中止取消

`RegimenDayPanel`、`useRegimenDayStopEntries`(`api/queries/regimen.ts`)、`taskBeforeCancel`。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 中止
    Dr->>UI: 範囲と理由を入れて中止
    UI->>BE: GET /fhir(対象の日の予約)
    BE->>FHIR: 検索
    FHIR-->>UI: Appointment
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: 進捗 Task を cancelled(理由は statusReason)<br/>ServiceRequest revoked + MedicationRequest cancelled<br/>予約を取消<br/>Provenance(CANCEL。対象は日オーダー)
  else 中止取消
    Dr->>UI: 中止取消
    UI->>BE: GET /fhir/Task/_history(_id のカンマ OR)
    BE->>FHIR: 型レベルの履歴
    FHIR-->>UI: 進捗 Task の版
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: 進捗 Task を中止前の版の内容へ(無ければ requested)<br/>ServiceRequest・MedicationRequest を active<br/>Provenance(REACTIVATE)
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

カルテのカードと注射一覧の `useUpdateInjectionTaskStatus`、処方一覧の `useUpdateRxTaskStatus` も、日オーダーの中止・中止取消(`isRegimenDayStop`)では同じ `useRegimenDayStopEntries` で書きます。

### シーケンス図: 休止・再開・完了・レジメン中止・クール取消

`RegimenDetailView`、`RegimenRevokeModal`、`useUpdateRegimenStatus`・`useDeleteRegimenCycle`(`api/queries/adverseEvent.ts`)、`useRevokeRegimen`(`api/queries/regimen.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 休止・再開
    Dr->>UI: 休止 / 再開
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: ヘッダを on-hold / active で PUT<br/>Provenance(SUSPEND / RESUME)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 完了・レジメン中止
    Dr->>UI: 完了 / レジメン中止(理由)
    UI->>BE: GET /fhir(未実施の日の予約)
    BE->>FHIR: 検索
    FHIR-->>UI: Appointment
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: ヘッダを completed / revoked で PUT<br/>未実施の日: 進捗 Task cancelled<br/>ServiceRequest revoked + MedicationRequest cancelled<br/>予約を取消<br/>Provenance(COMPLETE / CANCEL。対象はヘッダ)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else クール取消
    Dr->>UI: クール一覧の取消
    UI->>UI: canDeleteCycle(依頼済か中止の日だけ)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE ServiceRequest・MedicationRequest<br/>DELETE 進捗 Task・投与可否 Task<br/>予約を取消
    BE->>BE: 削除の来歴を Bundle に足す
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### 払出・調剤・実施

日オーダーは通常の注射・処方なので、[注射箋発行](injection.md#シーケンス図-注射箋発行)、[払出登録](injection.md#シーケンス図-払出登録)、[実施](injection.md#シーケンス図-実施)、[処方箋発行](prescription.md#シーケンス図-処方箋発行)、[調剤登録](prescription.md#シーケンス図-調剤登録)、[与薬](prescription.md#シーケンス図-与薬)と同じです。
違いは表示だけで、`regimenOrderOf` で印を読み、`useHeldRegimenIds` で休止中を判定します。

### 医事会計と SS-MIX2

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 適用・休止・再開・完了・レジメン中止(ヘッダ) | 対象外(`OrderCatalog::IGNORED`) | 出さない |
| 日オーダーの登録・編集・移動 | 注射はなし。内服は投与日の会計に載る | RDE^O11(注射 OMP-02、内服 OMP-01) |
| 投与日の中止、完了・中止で止めた日 | 対象から外れる。実施済みの施用は送る | RDE^O11 の `CA`(DEL) |
| 中止取消 | 対象に戻る | RDE^O11 の `NW`(INS) |
| クール取消・日オーダーの削除 | 対象から外れる | RDE^O11 の `CA`(DEL) |
| 注射の実施 | 通常の注射に、その日の最初の注射の剤へ外来化学療法加算(15 歳未満は別コード)と無菌製剤処理料を 1 回足す | RAS^O17(OMP-12) |
| 投与可否・有害事象 | なし | 出さない |

外来化学療法加算のコードが施設設定に無いときは、送れなかった項目として報告します。無菌製剤処理料はコードがあるときだけ足します。

化学療法の日オーダーかどうかは `requisition` の system(`regimen-instance`)で判定します。
