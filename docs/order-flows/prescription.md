# 処方オーダーの業務フロー

処方オーダーの登録から調剤・与薬までの流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
画面のふるまいは [features/medication.md](../features/medication.md)、リソースの要素は実装ガイド(`../fhir-ig` の `medication.md`)、
与薬の設計は [prescription-order-design.md](../prescription-order-design.md)、監査の設計は [rx-verification-design.md](../rx-verification-design.md) が正典です。

## 運用フロー

### 区分ごとの違い

| 処方 | 処方監査 | 処方箋 | 調剤登録 | 与薬の記録 | 医事会計への送信 |
|---|---|---|---|---|---|
| 入院(定期・継続・臨時・退院・緊急) | あり | 院内様式 | あり | 内服の RP を経過表で | なし(外来のみ) |
| 外来・院内 | あり | 院内様式 | あり | なし | あり |
| 外来・院外 | なし(保険薬局が監査) | 様式第2号 | 保険薬局が調剤 | なし | あり |
| 持参(持参薬の継続) | なし(持参薬鑑別で確認) | 刷らない | なし | 経過表で | なし |

### 処方の状態

薬剤部の進み具合を示す状態です。与薬の記録では変わりません。

| 状態 | 変わるきっかけ | 処方一覧のメニューからできること |
|---|---|---|
| 依頼済 | 医師の登録 | 中止 |
| 受付済 | 処方箋発行、疑義照会の回答・取下げ | 取消(依頼済へ)、中止 |
| 照会中・処方変更待ち | 疑義照会 | なし(疑義照会の操作で変わる) |
| 調剤済 | 調剤登録 | 取消(受付済へ。調剤の記録は残る) |
| 中止 | 中止 | 中止取消(依頼済へ) |

中止した処方は医事会計への送信から外れます。会計を送ったあとに中止したときは医事へ連絡し、医事が送り直します。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))
  kind{"処方区分"}
  setting{"入院の処方?"}

  subgraph doctor["医師"]
    input["処方を入力<br/>新規・DO・持参薬の継続"]
    register["登録<br/>(登録の判定)"]
  end

  subgraph pharmacy["薬剤部"]
    verify["処方監査<br/>問題なし・介入あり"]
    issue["処方箋発行<br/>発行が受付を兼ねる"]
    external{"院外処方?"}
    inquire{"疑義あり?"}
    inquiry["疑義照会<br/>(疑義照会の流れ)"]
    wait{"未監査かつ<br/>監査待ちの施設設定?"}
    dispense["調剤して結果を登録"]
  end

  handOut["患者へ交付"]
  pharmacyOut["患者が保険薬局で受け取る"]

  subgraph ward["病棟"]
    planned["経過表に与薬の予定が出る"]
    admin{"与薬する?"}
    give["与薬を記録"]
    skip["与薬せずと理由を記録"]
    more{"残りの予定枠?"}
  end

  start --> input --> register --> kind
  kind -- "院内(入院・外来)" --> verify
  kind -- "院内(入院・外来)" --> issue
  kind -- "院外" --> issue
  kind -- "持参" --> planned
  issue --> external
  external -- "はい" --> pharmacyOut --> finish
  external -- "いいえ" --> inquire
  inquire -- "はい" --> inquiry --> inquire
  inquire -- "いいえ" --> wait
  verify -. "監査済" .-> wait
  wait -- "はい" --> verify
  wait -- "いいえ" --> dispense --> setting
  setting -- "いいえ" --> handOut --> finish
  setting -- "はい" --> planned --> admin
  admin -- "はい" --> give --> more
  admin -- "いいえ" --> skip --> more
  more -- "あり" --> admin
  more -- "なし" --> finish
```

- 監査と処方箋発行は並行して進みます。既定では未監査でも調剤登録でき、施設設定「監査済まで調剤登録・払出登録を出さない」のときだけ待ちます。
- 疑義照会は依頼済からも送れます(図は受付済からの経路だけを示します)。
- 与薬の予定が出るのは入院の内服だけです。頓用と時刻指定の用法は予定が出ません。
- 「患者へ交付」「患者が保険薬局で受け取る」はシステムの外の作業です。薬剤部から病棟へ薬を届ける作業は記録の対象ではなく、調剤済かどうかに関わらず与薬を記録できます。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  valid{"入力は正しい?"}
  validError["入力エラーを表示"]
  blocked{"止める警告がある?"}
  blockedError["登録できない<br/>警告を表示"]
  cds{"外部の判断支援を<br/>使っている?"}
  sign["判断支援に問い合わせる<br/>届かなくても続ける"]
  confirm{"確認を要する警告か<br/>判断支援の指摘がある?"}
  modal["確認モーダルで<br/>警告ごとに理由を選ぶ"]
  choice{"確認モーダルの操作"}
  ledger["警告と確認理由を記録"]
  send["処方を保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  done((("登録完了")))
  fix["入力を直す"]

  submit --> valid
  valid -- "いいえ" --> validError --> fix
  valid -- "はい" --> blocked
  blocked -- "はい" --> blockedError --> fix
  blocked -- "いいえ" --> cds
  cds -- "はい" --> sign --> confirm
  cds -- "いいえ" --> confirm
  confirm -- "はい" --> modal --> choice
  choice -- "戻る" --> fix
  choice -- "登録" --> ledger
  confirm -- "いいえ" --> ledger
  ledger --> send --> result
  result -- "はい" --> done
  result -- "いいえ" --> failed --> fix
  fix --> submit
```

### 疑義照会の流れ

```mermaid
flowchart TD
  ask["薬剤師が照会を送る<br/>進捗は照会中"]
  stop["調剤登録が止まる"]
  who{"次に起きること"}
  withdraw["薬剤師が取り下げる<br/>進捗を受付済へ"]
  answer{"処方医の回答"}
  released["回答を記録して薬剤師へ通知<br/>進捗を受付済へ"]
  held["回答を記録して薬剤師へ通知<br/>進捗は処方変更待ち"]
  edit["処方医がオーダーを編集して保存<br/>進捗を受付済へ、監査済は未監査へ"]
  next(("調剤へ"))

  ask --> stop --> who
  who -- "取下げ" --> withdraw --> next
  who -- "回答" --> answer
  answer -- "処方どおり" --> released
  answer -- "薬剤部で変更してよい" --> released
  answer -- "処方を変更する" --> held --> edit --> next
  released --> next
```

## 開発者向け

### 進捗 Task(`rx-dispense`)

Task は登録時には作りません。**Task が無いオーダーは依頼済**として扱い、最初のステータス変更で作ります。
与薬では動きません([prescription-order-design.md](../prescription-order-design.md) §1)。

| 状態 | `Task.status` |
|---|---|
| 依頼済 | `requested`(または Task 無し) |
| 受付済 | `accepted` |
| 照会中・処方変更待ち | `on-hold` + `statusReason` |
| 調剤済 | `in-progress` |
| 実施済(作る操作なし) | `completed` |
| 中止 | `cancelled` |

中止は同じ transaction で `ServiceRequest` を `revoked`、`MedicationRequest` を `cancelled` にします(`rxOrderCancelEntries`)。中止取消は `active` に戻します。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。

### シーケンス図: 登録

`components/PrescriptionForm.tsx`・`PrescriptionPanels.tsx`、`useCreatePrescription`(`api/queries/labResult.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant CDS as 外部 CDS
  participant FHIR as 上流 FHIR

  Dr->>UI: 医薬品・用法・用量を入力
  UI->>UI: 薬剤の警告を判定して行に表示
  opt order-select のサービスがある
    UI->>BE: POST /integrations/cds/order_select(入力の 1 秒後)
    BE->>CDS: order-select
    CDS-->>BE: カード
    BE-->>UI: カード(失敗は空)
  end
  Dr->>UI: 登録
  UI->>UI: 入力検証・止める警告の確認
  opt order-sign のサービスがある
    UI->>BE: POST /integrations/cds/order_sign
    BE->>CDS: order-sign
    CDS-->>BE: カード
    BE-->>UI: カード(失敗は空)
  end
  opt 確認を要する警告かカードがある
    UI-->>Dr: 確認モーダル
    Dr->>UI: 理由を選んで登録
    UI-)BE: POST /integrations/cds/feedback(カードの無視)
  end
  UI-)BE: POST /master/advisory_events(発火・無視の台帳)
  UI->>UI: Bundle を組む
  Note over UI: ServiceRequest + MedicationRequest × 薬剤数<br/>Provenance(CREATE)<br/>院内: Task rx-verification(未監査)<br/>代行・研修医: Task order-approval<br/>警告の無視: Provenance<br/>特定抗菌薬: 届出の通知 Task<br/>持参薬の継続: MedicationStatement の更新
  UI->>BE: POST /fhir(transaction)
  BE->>FHIR: POST /
  FHIR-->>BE: transaction-response
  BE-->>UI: 結果
  UI->>UI: 一覧・カード・通知を読み直す
```

### シーケンス図: 編集・削除

`PrescriptionEditPanel`、`useUpdatePrescription`、`postOrderDeleteBundle`(`api/queries/orderDelete.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 医師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 編集
    Dr->>UI: カードの「編集」
    UI->>BE: GET /fhir(オーダーと focus の Task)
    BE->>FHIR: 検索
    FHIR-->>UI: ServiceRequest・MedicationRequest・Task
    Dr->>UI: 内容を変えて更新
    Note over UI,FHIR: 登録と同じ警告・order-sign の判定を通る
    UI->>BE: GET /fhir(既存の監査 Task)
    BE->>FHIR: 検索
    FHIR-->>UI: Task rx-verification
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ServiceRequest・MedicationRequest<br/>POST 追加した薬剤行 / DELETE 消した薬剤行<br/>Provenance(UPDATE)<br/>Task rx-verification を未監査へ<br/>処方変更待ちなら進捗を受付済へ
    BE->>FHIR: POST /
    FHIR-->>UI: 結果(版違いは 412)
  else 削除
    Dr->>UI: カードの「削除」と理由
    UI->>BE: GET /fhir(オーダーを指す記録)
    BE->>FHIR: 検索
    FHIR-->>UI: Task・MedicationDispense・実施記録
    alt 実施記録がある
      UI-->>Dr: 削除できない(実施を取り消す)
    else 実施記録が無い
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: DELETE ServiceRequest・MedicationRequest<br/>DELETE Task・MedicationDispense
      BE->>BE: 削除の来歴を Bundle に足す
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
    end
  end
```

### シーケンス図: 処方監査

`pages/RxVerificationPage.tsx`・`components/RxVerificationModal.tsx`、`useCompleteRxVerification`。処方一覧の「監査」からも同じモーダルが開きます。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ph->>UI: 処方監査の未監査タブ
  UI->>BE: GET /fhir(Task rx-verification, requested)
  BE->>FHIR: 検索
  FHIR-->>UI: 未監査の Task
  Ph->>UI: 監査を開く
  UI->>BE: GET /fhir(処方・患者の状態)
  BE->>FHIR: 検索
  FHIR-->>UI: 処方・照会の履歴・アレルギー・検査値
  UI-->>Ph: 内容と登録時と同じ警告
  Ph->>UI: 問題なし、または介入あり(種別・内容・処方医の対応)
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: PUT Task rx-verification<br/>status = completed、owner = 薬剤師<br/>output = 監査結果
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### シーケンス図: 処方箋発行

`pages/RxWorklistPage.tsx`・`components/RxBatchIssueModal.tsx`、`useUpdateRxTaskStatus`・`useIssuePrescriptions`。
PDF の生成は読むだけで、再発行は同じ PDF を刷り進捗を動かしません。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 行の「処方箋発行」
    Ph->>UI: 処方箋発行
    par PDF を新しいタブで開く
      UI->>BE: GET /reports/prescriptions/:order_id/pdf
      BE->>FHIR: batch Bundle(オーダー一式と自院)
      FHIR-->>BE: 処方一式
      BE-->>UI: PDF
    and 進捗を受付済へ
      UI->>BE: POST /fhir(transaction、Task rx-dispense = accepted)
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
    end
  else 処方箋一括発行(病棟)
    Ph->>UI: 病棟を選んで発行
    UI->>BE: GET /fhir(1 日ぶんを読み直す)
    BE->>FHIR: 検索
    FHIR-->>UI: 最新の一覧
    UI->>BE: POST /reports/prescriptions/pdf(order_ids)
    BE->>FHIR: batch Bundle
    FHIR-->>BE: 処方一式
    BE-->>UI: PDF
    UI->>BE: POST /fhir(transaction、依頼済の Task をまとめて accepted)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 疑義照会

`components/RxInquiryModal.tsx`・`RxInquirySection.tsx`、`fhir/rxInquiryHelpers.ts`、`useWriteRxInquiry`。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  actor Dr as 処方医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ph->>UI: 疑義照会(照会内容)
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: POST Task rx-inquiry(owner = 処方医)<br/>進捗 Task を on-hold(照会中)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
  alt 処方医が回答
    Dr->>UI: 通知かカードから回答
    alt 処方どおり・薬剤部で変更してよい
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: Task rx-inquiry を completed(output に回答)<br/>POST Task rx-inquiry-answered(宛先 = 薬剤師)<br/>進捗 Task を accepted
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
    else 処方を変更する
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: Task rx-inquiry を completed(output に回答)<br/>POST Task rx-inquiry-answered<br/>進捗 Task は on-hold(処方変更待ち)
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
      Dr->>UI: 右ペインでオーダーを編集して保存
      Note over UI,FHIR: 編集の transaction で進捗 Task を accepted、監査 Task を未監査へ
    end
    UI-->>Ph: 回答の通知(ベル)
  else 薬剤師が取下げ
    Ph->>UI: 取下げ
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: Task rx-inquiry を cancelled<br/>進捗 Task を accepted
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 調剤登録

`components/RxDispenseModal.tsx`、`fhir/rxDispenseHelpers.ts`、`useRegisterRxDispense`。受付済の行にだけ出ます。

```mermaid
sequenceDiagram
  autonumber
  actor Ph as 薬剤師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ph->>UI: 調剤登録
  UI->>BE: GET /fhir(focus の Task)
  BE->>FHIR: 検索
  FHIR-->>UI: 照会の履歴・未確認の回答の通知
  UI->>BE: GET /master/...(投与量換算)
  BE-->>UI: 換算マスタ
  UI-->>Ph: 処方の内容を初期値に表示(力価は製剤数へ換算)
  Ph->>UI: 銘柄・数量を確かめて登録
  UI->>BE: POST /fhir(transaction)
  Note over UI,BE: POST MedicationDispense × 薬剤数<br/>進捗 Task を in-progress(調剤済)<br/>回答の通知を completed
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
```

### シーケンス図: 与薬

`components/OralPerformModal.tsx`・`VitalFlowsheetPanel.tsx`、`fhir/oralPerformHelpers.ts`、`useRegisterOralPerform`・`useCancelOralPerforms`。
調剤済かどうかに関わらず記録でき、進捗 Task は動きません。

```mermaid
sequenceDiagram
  autonumber
  actor Ns as 看護師
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  Ns->>UI: 経過表を開く
  UI->>BE: GET /fhir(入院の処方・与薬の記録)
  BE->>FHIR: 検索
  FHIR-->>UI: 処方・Procedure・進捗 Task
  UI->>UI: 用法コードと施設の時刻から予定枠を展開
  alt 与薬入力
    Ns->>UI: 予定枠の「与薬入力」
    alt 与薬
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: POST Procedure(completed、予定枠の拡張)<br/>POST MedicationAdministration × 飲ませた薬剤
    else 与薬せず
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: POST Procedure(not-done、理由)
    end
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 与薬取消
    Ns->>UI: 記録済みの枠の「与薬取消」
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE MedicationAdministration → Procedure
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```
