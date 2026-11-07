# 注射オーダーの業務フロー

注射オーダーの登録から払出・実施までの流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
画面のふるまいは [features/medication.md](../features/medication.md)、リソースの要素は実装ガイド(`../fhir-ig` の `medication.md`)、
連日オーダーと実施記録の設計は [injection-order-design.md](../injection-order-design.md)、監査の設計は [rx-verification-design.md](../rx-verification-design.md) が正典です。
化学療法の日オーダーは[化学療法の業務フロー](chemotherapy.md)を読みます。

## 運用フロー

### 区分ごとの違い

| 注射 | 処方監査 | 注射箋・注射ラベル | 払出登録 | 実施の記録 | 医事会計への送信 |
|---|---|---|---|---|---|
| 入院(定時・臨時・緊急) | あり | あり | あり | あり | なし(外来のみ) |
| 外来 | あり | あり | あり | あり | 実施の記録から |

注射は 1 日 1 オーダーです。連日の指示は登録のときに日ごとのオーダーへ展開します。処方監査は連日をまとめて 1 回、それ以外(注射箋発行・払出・実施)は日ごとに進みます。

### 注射の状態

薬剤部と実施の進み具合を示す状態です。

| 状態 | 変わるきっかけ | 注射一覧のメニューからできること |
|---|---|---|
| 依頼済 | 医師の登録、受付取消、中止取消、実施取消 | 中止 |
| 受付済 | 注射箋発行、疑義照会の回答・取下げ、払出取消 | 受付取消(依頼済へ)、中止 |
| 照会中・処方変更待ち | 疑義照会 | なし(疑義照会の操作で変わる) |
| 払出済 | 払出登録 | 払出取消(受付済へ。払出の記録は残る)、中止 |
| 実施済 | 実施の記録が予定回数に達する | なし(カルテの実施取消で依頼済へ) |
| 中止 | 中止 | 中止取消(依頼済へ) |

実施取消は実施の記録をすべて消します。実施済だった注射は、払い出し済みだったかどうかに関わらず依頼済へ戻ります。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["医師"]
    input["注射を入力<br/>新規・DO、連日は日ごとに展開"]
    register["登録<br/>(登録の判定)"]
  end

  subgraph pharmacy["薬剤部"]
    verify["処方監査<br/>問題なし・介入あり"]
    issue["注射箋と注射ラベルを発行<br/>発行が受付を兼ねる"]
    inquire{"疑義あり?"}
    inquiry["疑義照会<br/>(処方と同じ流れ)"]
    wait{"未監査かつ<br/>監査待ちの施設設定?"}
    dispense["払い出して結果を登録"]
  end

  subgraph ward["病棟・外来"]
    perform["施用して実施を記録<br/>(実施の流れ)"]
    more{"その日の<br/>残りの施用?"}
  end

  series{"連日の残りの日?"}

  start --> input --> register
  register --> verify
  register --> issue
  issue --> inquire
  inquire -- "はい" --> inquiry --> inquire
  inquire -- "いいえ" --> wait
  verify -. "監査済" .-> wait
  wait -- "はい" --> verify
  wait -- "いいえ" --> dispense --> perform --> more
  more -- "あり" --> perform
  more -- "なし" --> series
  series -- "あり" --> issue
  series -- "なし" --> finish
```

- 監査と注射箋発行は並行して進みます。既定では未監査でも払出登録でき、施設設定「監査済まで調剤登録・払出登録を出さない」のときだけ待ちます。
- 疑義照会は依頼済からも送れます(図は受付済からの経路だけを示します)。照会は日ごとのオーダーに対して行います。
- 払出登録は受付済の注射にだけ出ます。注射ラベルは進捗を動かさず、中止以外のどの状態でも刷れます。
- 予定は登録した時点で注射カレンダー・経過表・看護ワークシートに出ます。
- 実施は払出・監査・疑義照会を待ちません。止まるのは中止した注射だけです。薬剤部から病棟へ薬を届ける作業は記録の対象ではありません。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  valid{"入力は正しい?<br/>連日は 14 件・90 日まで"}
  validError["入力エラーを表示"]
  blocked{"止める警告がある?"}
  blockedError["登録できない<br/>警告を表示"]
  confirm{"確認を要する警告がある?"}
  modal["確認モーダルで<br/>警告ごとに理由を選ぶ"]
  choice{"確認モーダルの操作"}
  ledger["警告と確認理由を記録"]
  send["全日の注射をまとめて保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  done((("登録完了")))
  fix["入力を直す"]

  submit --> valid
  valid -- "いいえ" --> validError --> fix
  valid -- "はい" --> blocked
  blocked -- "はい" --> blockedError --> fix
  blocked -- "いいえ" --> confirm
  confirm -- "はい" --> modal --> choice
  choice -- "戻る" --> fix
  choice -- "登録" --> ledger
  confirm -- "いいえ" --> ledger
  ledger --> send --> result
  result -- "はい" --> done
  result -- "いいえ" --> failed --> fix
  fix --> submit
```

処方と違い、外部の判断支援への問い合わせはありません。

### 実施の流れ

```mermaid
flowchart TD
  open(("実施入力を開く"))
  enabled{"3点認証を使う?"}
  scan["患者番号と注射ラベルの<br/>RP バーコードを読む"]
  how{"照合の結果"}
  matched["読めた RP を施用にして進む"]
  skip["理由を選んでスキップ"]
  input["結果と薬剤ごとの実施量を入力<br/>オーダーに無い薬剤も足せる"]
  outcome{"結果"}
  given["実施を記録"]
  stopped["途中で中止を記録<br/>理由は必須"]
  notDone["実施せずを記録<br/>理由は必須"]
  reached{"予定回数に達した?"}
  completed["実施済へ"]
  keep["状態は変わらない"]
  finish((("完了")))

  open --> enabled
  enabled -- "はい" --> scan --> how
  enabled -- "いいえ" --> input
  how -- "患者一致・RP が 1 つ以上" --> matched --> input
  how -- "読めない" --> skip --> input
  input --> outcome
  outcome -- "実施" --> given --> reached
  outcome -- "途中で中止" --> stopped --> reached
  outcome -- "実施せず" --> notDone --> keep
  reached -- "はい" --> completed --> finish
  reached -- "いいえ" --> keep --> finish
```

- 開く場所はカルテのカード、注射カレンダー、経過表の注射欄、看護ワークシート、血糖インスリン指示患者一覧、パスのタスク、注射バーコード実施です。
- 3点認証は施設設定で有効にしたときに出ます。実施者はログイン中の医療従事者で代替します。
- 注射バーコード実施(`/injection-scan`)は、患者番号と RP バーコードを読んだ状態で実施入力を開き、施設設定に関わらず照合を記録します。
- 予定回数は RP の開始時刻の数です(複数の RP なら最も多いもの。時刻が無ければ 1 回)。「実施」「途中で中止」の記録だけを数えます。
- インスリンのスケールは、前後の血糖値・主食の摂取量から案内量を出します。案内と違う量にしたら理由が必須です。

### 変更・中止・削除・継続

| 操作 | できる場所 | 範囲 | できないとき |
|---|---|---|---|
| 変更 | カルテのカード、注射カレンダー | この日のみ / この日以降すべて | |
| 中止 | カルテのカード、注射カレンダー | この日のみ / この日以降すべて | 実施済 |
| 中止 | 注射一覧のメニュー | その日のみ | 実施済、照会中・処方変更待ち |
| 中止取消 | カルテのカード、注射カレンダー、注射一覧のメニュー | 中止と同じ | |
| 削除 | カルテのカード、注射カレンダー | この日のみ / この日以降すべて。理由は必須 | 実施の記録がある |
| 継続 | 注射カレンダーの行のメニュー | 連日の最後の日に、同じ内容の日を足す | |

- 変更と継続は、監査済でも未監査へ戻り、再監査になります。
- 変更・中止は薬剤部へ通知しません。変更は再監査で、中止は注射一覧の状態で見えます。払い出した薬剤の返品・再払出はシステムの記録の対象外です。
- 注射ラベルの読み取りは内容の変更を見分けません。変更した注射はラベルを刷り直します。
- 「この日以降すべて」の中止は実施済の日を除きます。中止取消は中止した日だけを戻します。
- 中止した注射は医事会計へ送られません。1 日に複数回の注射で、中止の前に実施した分は送られます。会計を送ったあとに中止したときは医事へ連絡し、医事が送り直します。

### 疑義照会の流れ

処方と同じです([処方オーダーの疑義照会の流れ](prescription.md#疑義照会の流れ))。「調剤登録」を「払出登録」に読み替えます。

## 開発者向け

### 進捗 Task(`injection`)

Task は登録時には作りません。**Task が無いオーダーは依頼済**として扱い、最初のステータス変更で作ります。
日ごとのオーダーに 1 件です([injection-order-design.md](../injection-order-design.md) §5)。

| 状態 | `Task.status` |
|---|---|
| 依頼済 | `requested`(または Task 無し) |
| 受付済 | `accepted` |
| 照会中・処方変更待ち | `on-hold` + `statusReason` |
| 払出済 | `in-progress` |
| 実施済 | `completed` |
| 中止 | `cancelled` |

監査 Task(`rx-verification`)は束ね(`requisition`)に 1 件で、`groupIdentifier` に束ねの uuid、`focus` に束ねの最初の日を持ちます。
最初の日を削除すると残りの最初の日へ付け替えます(`rxVerificationDeleteEntries`)。

中止は同じ transaction で `ServiceRequest` を `revoked`、`MedicationRequest` を `cancelled` にします(`rxOrderCancelEntries`)。中止取消は `active` に戻します。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。

### シーケンス図: 登録

`components/InjectionForm.tsx`・`InjectionPanels.tsx`、`buildInjectionBundle`(`fhir/injectionHelpers.ts`)、`useCreatePrescription`(`api/queries/labResult.ts`。全種別共通)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 医薬品・用法・期間・実施パターンを入力
  UI->>UI: 薬剤の警告を判定して行に表示
  UI->>UI: 展開する日をプレビュー(injectionDates)
  Dr->>UI: 登録
  UI->>UI: 入力検証・止める警告の確認
  opt 確認を要する警告がある
    UI-->>Dr: 確認モーダル
    Dr->>UI: 理由を選んで登録
  end
  UI-)BE: POST /master/advisory_events(発火・無視の台帳)
  UI->>UI: Bundle を組む
  Note over UI: 日ごとに ServiceRequest + MedicationRequest × 薬剤数<br/>全日で同じ requisition と開始日<br/>Provenance(CREATE)<br/>Task rx-verification(束ねに 1 件)<br/>代行・研修医: Task order-approval<br/>警告の無視: Provenance<br/>特定抗菌薬: 届出の通知 Task(連日は 1 件)
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>BE: transaction-response
  BE-->>UI: 結果
  UI->>UI: 一覧・カード・通知を読み直す
```

### シーケンス図: 編集・継続・削除

`InjectionEditPanel`、`InjectionContinueModal`、`InjectionDeleteModal`、`useInjectionSeriesLater`(後続日)、`deleteInjectionSeriesRequest`、`postOrderDeleteBundle`(`api/queries/orderDelete.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(requisition と occurrence で後続日)
  BE->>FHIR: 検索
  FHIR-->>UI: 後続日の ServiceRequest・MedicationRequest・Task
  alt 編集
    Dr->>UI: 反映範囲を選び、内容を変えて更新
    Note over UI,FHIR: 登録と同じ警告の判定を通る
    UI->>BE: GET /fhir(既存の監査 Task)
    BE->>FHIR: 検索
    FHIR-->>UI: Task rx-verification
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: この日のみ: PUT ServiceRequest・MedicationRequest<br/>POST 追加した薬剤行 / DELETE 消した薬剤行<br/>この日以降: 後続日の PUT ServiceRequest<br/>後続日の MedicationRequest は差し替え<br/>Provenance(UPDATE)<br/>Task rx-verification を未監査へ<br/>処方変更待ちなら進捗を受付済へ
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(版違いは 412)
  else 継続
    Dr->>UI: 終了日を選んで継続
    UI->>UI: 束ねのパターンで足す日を計算(injectionExtensionDates)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: 足す日の ServiceRequest + MedicationRequest<br/>requisition・開始日・パターンは同じ<br/>Provenance(CREATE)<br/>Task rx-verification を未監査へ
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 削除
    Dr->>UI: 範囲と理由を選んで削除
    UI->>BE: GET /fhir(オーダーを指す記録)
    BE->>FHIR: 検索
    FHIR-->>UI: Task・MedicationDispense・実施記録
    alt 実施記録がある
      UI-->>Dr: 削除できない(実施を取り消す)
    else 実施記録が無い
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: DELETE ServiceRequest・MedicationRequest<br/>DELETE Task・MedicationDispense<br/>監査 Task は残る日があれば付け替え<br/>予約があれば取消
      BE->>BE: 削除の来歴を Bundle に足す
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
    end
  end
```

### シーケンス図: 中止・中止取消

`InjectionCancelModal`、`useUpdateInjectionTaskStatus`(`api/queries/outpatient.ts`)。注射一覧のメニューは範囲を選ばず、同じ hook でその日だけを書きます。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Dr->>UI: 中止(または中止取消)
  UI->>BE: GET /fhir(requisition と occurrence で後続日)
  BE->>FHIR: 検索
  FHIR-->>UI: 後続日の ServiceRequest・Task
  Dr->>UI: この日のみ / この日以降
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: 選んだ日ぶんの Task injection<br/>中止: cancelled + ServiceRequest revoked + MedicationRequest cancelled<br/>中止取消: requested + ServiceRequest・MedicationRequest active
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### 処方監査・疑義照会

処方と同じ画面・hook を使います([処方監査](prescription.md#シーケンス図-処方監査)、[疑義照会](prescription.md#シーケンス図-疑義照会))。
注射一覧の「監査」「疑義照会」から開き、進捗の組み立てだけを `progressBuilderOf("injection")` で切り替えます。

### シーケンス図: 注射箋発行

`pages/InjectionWorklistPage.tsx`・`InjectionPrintPage.tsx`、`useUpdateInjectionTaskStatus`、`InjectionReport`。
PDF の生成は読むだけで、再発行と注射ラベル単独の発行は同じ PDF を刷り進捗を動かしません。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ph->>UI: 注射一覧の注射日を選ぶ
  UI->>BE: GET /fhir(注射日 1 日ぶん)
  BE->>FHIR: 検索
  FHIR-->>UI: ServiceRequest・MedicationRequest・Task・患者
  UI->>BE: GET /fhir(束ねの監査 Task)
  BE->>FHIR: 検索
  FHIR-->>UI: Task rx-verification
  Ph->>UI: 注射箋発行
  par 別タブ /injection-print/:order_id
    UI->>BE: GET /reports/injections/:order_id/pdf
    BE->>FHIR: batch Bundle(オーダー一式と自院)
    FHIR-->>BE: 注射一式
    BE-->>UI: 注射箋 PDF
    UI->>BE: GET /reports/injection_labels/:order_id/pdf
    BE->>FHIR: batch Bundle(オーダー一式と自院)
    FHIR-->>BE: 注射一式
    BE-->>UI: 注射ラベル PDF
  and 進捗を受付済へ
    UI->>BE: POST /fhir(transaction、Task injection = accepted)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 払出登録

`components/InjectionDispenseModal.tsx`、`fhir/injectionDispenseHelpers.ts`、`useRegisterInjectionDispense`。受付済の行にだけ出ます。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ph->>UI: 払出登録
  UI->>BE: GET /fhir(focus の Task)
  BE->>FHIR: 検索
  FHIR-->>UI: 照会の履歴・未確認の回答の通知
  UI->>BE: GET /master/...(投与量換算)
  BE-->>UI: 換算マスタ
  UI-->>Ph: 数量の初期値を表示(投与量 × その日の施用回数を製剤数へ換算)
  Ph->>UI: 銘柄・数量を確かめて登録
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: POST MedicationDispense × 薬剤数<br/>進捗 Task を in-progress(払出済)<br/>回答の通知を completed
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

払出取消は進捗を受付済へ戻すだけで、`MedicationDispense` は残ります。

### シーケンス図: 実施

`components/InjectionPerformModal.tsx`・`InjectionVerifyStep.tsx`、`fhir/injectionPerformHelpers.ts`、`useRegisterInjectionPerform`・`useCancelInjectionPerforms`。
払出済かどうかに関わらず記録できます。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 実施入力
    Ns->>UI: 実施入力
    opt 3点認証が有効、または注射バーコード実施
      Ns->>UI: 患者番号と RP バーコードを読む(またはスキップ)
      UI->>UI: 患者の identifier とオーダーの RP に照合
    end
    opt スケールのインスリン
      UI->>BE: GET /fhir(血糖・主食の Observation、血糖の看護指示)
      BE->>FHIR: 検索
      FHIR-->>UI: 測定値
    end
    Ns->>UI: 結果・時刻・薬剤ごとの実施量を入力して登録
    alt 実施・途中で中止
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: POST Procedure(completed / stopped、照合は拡張)<br/>POST MedicationAdministration × 施用した薬剤<br/>手入力の血糖値: POST Observation<br/>予定回数に達したら Task injection を completed
    else 実施せず
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: POST Procedure(not-done、理由)
    end
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 実施取消
    Ns->>UI: カードの「実施取消」
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE MedicationAdministration → Procedure(記録すべて)<br/>実施済なら Task injection を requested
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### 医事会計と SS-MIX2

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 登録・編集 | なし | RDE^O11(OMP-02)。`ServiceRequest` を書くと出す |
| 削除 | 対象から外れる | RDE^O11 の `CA`(DEL) |
| 中止 | 対象から外れる。実施済みの施用は送る | RDE^O11 の `CA`(DEL) |
| 中止取消 | 対象に戻る | RDE^O11 の `NW`(INS) |
| 実施 | 薬剤行を 1 施用 1 剤で送る。剤区分は手技・用法種別・経路から決まり、手技料は日レセが算定 | RAS^O17(OMP-12)。実施ごとに採番 |
| 途中で中止・実施せず | 請求せず理由を報告 | RAS^O17 |
| 実施取消 | 対象から外れる | RAS^O17 の DEL |
