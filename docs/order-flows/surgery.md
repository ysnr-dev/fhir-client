# 手術オーダーの業務フロー

手術の申込から日程の確定・術前診察・入室・実施記録・症例登録までの流れです。医療機関の運用を検討する人は「運用フロー」、院内の開発者は「開発者向け」を読みます。
設計は [surgery-order-design.md](../surgery-order-design.md)(申込)・[surgery-calendar-design.md](../surgery-calendar-design.md)(手術室カレンダー)・
[surgery-result-design.md](../surgery-result-design.md)(実施記録)・[anesthesia-preop-design.md](../anesthesia-preop-design.md)(麻酔科術前診察)・
[anesthesia-chart-design.md](../anesthesia-chart-design.md)(麻酔チャート)・[ncd-registration-design.md](../ncd-registration-design.md)(NCD 症例登録)、
種別共通の約束(日付未定・中止・削除・代行入力)は [features/orders-common.md](../features/orders-common.md)、リソースの要素は実装ガイド(`../fhir-ig`)が正典です。

## 運用フロー

### 区分ごとの違い

| 予定区分 | 日程 | 受付 | 入室 | 手術室の重なりの確認 |
|---|---|---|---|---|
| 予定 | 希望日を書いて申し込むか、日程未定で申し込む | 手術部が日程を確定して受付 | 受付済から | 日程を書くたびに確かめ、重なっていれば承知のうえで登録 |
| 準緊急・緊急 | 同上 | 同上 | **日程未定のまま入室できる**(押した日時が予定日時になる) | 同上 |

1 オーダー = 手術 1 件で、麻酔は手術の一部(麻酔方法・管理区分)です。予約枠は使わず、手術室の空きは手術オーダーの予定日時と所要時間そのものから判断します。
申込の入口はカルテの右ペイン「手術」、手術カレンダーの空き枠、オーダーセット・クリニカルパスの適用です。

### 手術の状態

手術部と手術室の進み具合を示す状態です。受付と実施の間に入室の段があります。

| 状態 | 変わるきっかけ | 手術一覧・カレンダーからできること |
|---|---|---|
| 申込済 | 申込、受付取消、中止取消 | 受付(予定日別)、日程確定・入室(日程未定、入室は緊急・準緊急のみ)、日程の移動・日付未定/部屋未定に戻す、中止 |
| 受付済 | 受付、日程確定、入室取消 | 入室、日程の移動、受付取消(申込済へ)、中止 |
| 入室中 | 入室、実施取消 | 実施(実施入力)、麻酔チャート、入室取消(受付済へ) |
| 実施済 | 実施登録 | 麻酔チャート(閲覧)、実施取消(入室中へ。実施記録は消える) |
| 中止 | 中止 | 中止取消(申込済へ) |

- 入室は進捗を進めるだけで、実施記録は退室後にまとめて 1 回入れます。
- 日程の移動(カレンダーのドラッグ)は申込済・受付済だけで、進捗は動かしません。入室中・実施済は起きた事実なので動かせません。
- 術前診察は中止以外のどの状態でも書けます。麻酔チャートは入室中に書き始め、実施済で振り返ります。

### 全体の流れ

```mermaid
flowchart TD
  start(("開始"))
  finish((("終了")))

  subgraph doctor["主治医"]
    input["手術を申込<br/>術式・スタッフ・麻酔・準備・同意書<br/>術前指示・希望日"]
    register["登録<br/>(登録の判定)"]
  end

  subgraph dept["手術部"]
    scheduled{"日程あり?"}
    confirm["日程確定<br/>(日程確定の流れ)"]
    accept["受付"]
    adjust["カレンダーで日程を調整"]
  end

  subgraph anes["麻酔科"]
    preop["術前診察<br/>(麻酔科術前診察の流れ)"]
  end

  subgraph ward["病棟"]
    prepare["術前指示に沿って準備"]
  end

  subgraph room["手術室"]
    admit["入室"]
    chart["麻酔チャート<br/>打点・イベント・薬剤"]
    perform["退室後に実施入力<br/>(実施の流れ)"]
  end

  subgraph post["術後"]
    records["手術記録・麻酔記録<br/>(テンプレート)"]
    ncd["NCD 症例登録"]
  end

  start --> input --> register --> scheduled
  scheduled -- "いいえ" --> confirm --> adjust
  scheduled -- "はい" --> accept --> adjust
  adjust --> preop --> prepare --> admit --> chart --> perform --> records --> ncd --> finish
```

- 受付は日程確定を兼ねます。希望日つきの申込は予定日別タブの「受付」、日程未定の申込は日程未定タブの「日程確定」で受付済になります。
- 術前診察・術前指示・麻酔チャートは必須ではありません(術前診察が済んでいなくても受付・入室は止まりません)。
- 緊急・準緊急は日程未定のまま「入室」でき、日程確定を飛ばします。

### 登録の判定

```mermaid
flowchart TD
  submit(("登録を押す"))
  valid{"入力は正しい?<br/>術式 1 件以上・執刀医<br/>左右(必要な術式)<br/>麻酔科管理なら麻酔科医<br/>時刻だけで日付なしは不可"}
  validError["入力エラーを表示"]
  schedule{"日付・手術室・入室時刻が揃う?"}
  recheck["その日の手術を読み直して<br/>同じ手術室の重なりを確かめる"]
  conflict{"重なり・確かめられない?"}
  modal["確認モーダル<br/>重なる手術を並べる"]
  choice{"操作"}
  send["申込を保存"]
  result{"成功?"}
  failed["エラーを表示<br/>何も保存されない"]
  proxy{"入力者は指示医師本人?"}
  approval["指示医師に承認待ちの通知"]
  done((("登録完了")))
  fix["入力を直す"]

  submit --> valid
  valid -- "いいえ" --> validError --> fix --> submit
  valid -- "はい" --> schedule
  schedule -- "はい" --> recheck --> conflict
  schedule -- "いいえ" --> send
  conflict -- "はい" --> modal --> choice
  conflict -- "いいえ" --> send
  choice -- "戻る" --> fix
  choice -- "重なりを承知で登録" --> send
  send --> result
  result -- "いいえ" --> failed --> fix
  result -- "はい" --> proxy
  proxy -- "いいえ" --> approval --> done
  proxy -- "はい" --> done
```

- 左右は術式マスタで「左右が要る」と印を付けた術式だけ必須です(取り違え防止)。
- 薬剤のような警告(判断支援)はありません。ブロックスケジュール(曜日ごとの科の割当)に掛かる時間帯は警告だけで止めません。
- セット・パスからの一括登録は重なりの確認を挟めないので、登録後に手術カレンダーで確かめます。
- 術前指示はテンプレートから記入でき、申込と一緒に保存します。

### 日程確定の流れ

```mermaid
flowchart TD
  start(("申込を受けた"))
  has{"日程がある?"}
  listTab["予定日別タブで「受付」"]
  pendTab["日程未定タブで「日程確定」<br/>日・入室時刻・所要時間・手術室"]
  show["その日・その手術室の予定と<br/>科の割当を表示"]
  recheck{"重なり?"}
  modal["確認モーダル<br/>承知のうえで確定"]
  accepted((("受付済")))

  start --> has
  has -- "はい" --> listTab --> accepted
  has -- "いいえ" --> pendTab --> show --> recheck
  recheck -- "はい" --> modal --> accepted
  recheck -- "いいえ" --> accepted
```

受付の後も、手術カレンダーで日程を組み直せます。

```mermaid
flowchart TD
  open(("手術カレンダーを開く"))
  op{"操作"}
  drag["格子のカードをドラッグ<br/>日・部屋・時刻を移動(5 分刻み)"]
  resize["カードの縁を引く<br/>所要時間を変更"]
  pend["未確定リストから格子へドラッグ<br/>日付未定・部屋未定・時間未定"]
  confirm["変更の確認<br/>変更前 → 後、重なり、科の割当"]
  move["日程を更新<br/>進捗は動かない"]
  unschedule["日付未定・部屋未定に変更<br/>(申込済のみ)未確定リストへ"]
  done((("終了")))

  open --> op
  op -- "移動" --> drag --> confirm
  op -- "時間の変更" --> resize --> confirm
  op -- "未確定を置く" --> pend --> confirm
  op -- "日程を外す" --> unschedule --> done
  confirm --> move --> done
```

- 手術カレンダーは日ビュー(手術室 × 時刻)と週ビュー(曜日 × 手術室)で、右の未確定リスト(日付未定・部屋未定・時間未定)から格子へドラッグして日程を決めます。ドラッグで決めた日程は申込済のまま(受付は別操作)です。
- 日程の移動は進捗を動かしません。日程を外すのは申込済のときだけで、受付済なら先に受付取消をします。
- 重なりは登録を止めません。緊急の割り込みや前の手術が早く終わる読みで詰めることがあるためです。承知した事実は確認の操作として残ります。
- 読み切れなかった日(件数が多い)は「重なりなし」と言い切れないので、その旨を出します。

### 麻酔科術前診察の流れ

```mermaid
flowchart TD
  list(("麻酔科術前診察の一覧<br/>今日から 14 日先までと日程未定"))
  pick["手術を選んで「記入」<br/>(手術一覧の行メニューからも)"]
  write["カルテの右ペインで記入<br/>評価・気道・手術室への指示・病棟への指示"]
  status{"保存の仕方"}
  draft["記入中"]
  final["確定"]
  shown["手術一覧の列・手術カード<br/>手術の詳細・麻酔チャートの帯に出る"]
  carry["ASA-PS を麻酔記録・NCD 症例登録の<br/>初期値に引き継ぐ"]
  done((("終了")))

  list --> pick --> write --> status
  status -- "途中" --> draft --> write
  status -- "確定" --> final --> shown --> carry --> done
```

- 予定・身長体重・既往歴・アレルギー・内服薬が初期値で入ります。カルテの「テンプレート」から直接書いた回答は手術に結び付きません。
- 予測困難気道「あり」は一覧で赤、麻酔チャートでは赤い枠で出ます。
- 術前診察が付いた手術はカルテから削除できません(中止します)。

### 実施の流れ

```mermaid
flowchart TD
  start(("患者が手術室に入る"))
  where{"申込の状態"}
  admit["予定日別タブの「入室」"]
  emergency["日程未定タブの「入室」<br/>緊急・準緊急のみ。押した日時が予定日時に"]
  inRoom["入室中"]
  chart{"麻酔チャートを使う?"}
  chartStart["チャート開始<br/>打点・イベント・薬剤を 1 点ずつ保存"]
  chartClose["チャート確定"]
  leave["退室"]
  perform["実施入力<br/>入室・退室と中間時刻<br/>実施術式・麻酔(K・L)<br/>スタッフ(6 役)・出血量・尿量・輸血量<br/>創分類・カウント・転帰・合併症<br/>薬剤・材料"]
  valid{"時刻の順・執刀医<br/>K コードの術式 1 件以上<br/>カウント不一致ならコメント"}
  validError["入力エラーを表示"]
  completed["実施済"]
  done((("術後の記録へ")))

  start --> where
  where -- "受付済" --> admit --> inRoom
  where -- "日程未定" --> emergency --> inRoom
  inRoom --> chart
  chart -- "はい" --> chartStart --> chartClose --> leave
  chart -- "いいえ" --> leave
  leave --> perform --> valid
  valid -- "いいえ" --> validError --> perform
  valid -- "はい" --> completed --> done
```

- 実施入力は手術一覧とカレンダーのカードから開きます。申込の術式・スタッフ・予定入室時刻が初期値です。K コードを持たない術式は初期行になりません。
- 麻酔チャートは専用ページで、手術中は開きっぱなしにします。実施記録とは別の記録で、実施取消でチャートは消えません。チャートの薬剤は算定に載せず、算定する薬剤は実施入力に入れます。
- 実施取消は実施記録ごと消します。直すときは「実施取消 → 実施」の 2 手です。
- 術後は手術記録(`SUR_OP_01`、シェーマつき)・麻酔記録(`SUR_ANES_01`)のテンプレートをカルテで書き、NCD 症例登録(データ > NCD症例登録)で基本項目と術後 30 日の合併症を記入します。構造化した項目(時刻・スタッフ・測定値・ASA-PS)は初期値で入り、テンプレートに再入力しません。

### 変更・中止・削除

| 操作 | できる場所 | できないとき・注意 |
|---|---|---|
| 変更 | カルテのカード、カレンダーのカードと未確定リストのメニュー | 進捗では止まりません。日程を変えると重なりの確認を挟みます |
| 日程の移動 | 手術カレンダー(ドラッグ・縁のリサイズ) | 申込済・受付済のみ。確認モーダルを挟み、進捗は動きません |
| 中止 | 手術一覧・カレンダーのメニュー | 実施済からはできません(先に実施取消)。カレンダーと重なりの判定から外れ、医事会計の対象からも外れます。麻酔チャート・術前診察は残ります |
| 中止取消 | 手術一覧・カレンダーのメニュー | 申込済に戻ります |
| 受付取消・入室取消・実施取消 | 手術一覧・カレンダーのメニュー | 1 つ前の状態へ戻す訂正。実施取消は実施記録(術式・スタッフ・測定値・薬剤・材料)を消します |
| 削除 | カルテのカード | 実施記録か麻酔チャートがあるとできません。術前診察が付いていてもできません(中止します)。術前指示のテンプレート回答は一緒に消えます |

### 帳票

| 帳票 | 出す場所 | 内容 |
|---|---|---|
| 手術説明・同意書 | カルテのテンプレート `SUR_CONSENT_01` から帳票 | 術式・麻酔・輸血の説明と同意欄 |
| 手術記録・麻酔記録 | カルテのテンプレート `SUR_OP_01` / `SUR_ANES_01` | 記入内容の表示・印刷(テンプレート共通の機能) |
| NCD 症例登録の CSV | データ > NCD症例登録 | 登録済の回答を項目順に出す(NCD の一括取込の形式ではない) |

麻酔チャートの印刷はありません(バックログ)。

## 開発者向け

### リソースの構成

申込はヘッダの `ServiceRequest`(`order-type|surgery`)と、術式 1 件ずつの明細 `ServiceRequest`(`basedOn` でヘッダを指す。並び順 1 が主術式)です。
ヘッダに予定日時(`occurrenceDateTime`。未定なら出さない)・所要時間・手術室・執刀科・スタッフ・麻酔・輸血準備・特殊機器・検体提出予定・同意書・術前指示をローカル拡張で、明細に術式コード(`surgery-order-item`)・K コード・部位と左右(`bodySite`)・到達法・術前診断を持ちます([surgery-order-design.md](../surgery-order-design.md) §2)。

| もの | リソース | 補足 |
|---|---|---|
| 進捗 | `Task`(`task-code|surgery`、`focus` = ヘッダ) | 下の表 |
| 術前指示(テンプレート記入) | `QuestionnaireResponse` | ヘッダの拡張 `surgery-preop-instruction-questionnaire-response` が指す。申込と同じ transaction で書き、削除で一緒に消す |
| 麻酔科術前診察 | `QuestionnaireResponse`(`basedOn` = ヘッダ、`SUR_ANESPRE_01`) | 1 手術 1 件。`in-progress`(記入中)/ `completed`(確定)。要点は linkId(`anes_asa` など)で読む |
| 実施記録 | ハブ `Procedure`(`order-type|surgery`、`status = completed`、`code` = 実施術式 1 件目の K コード、`performedPeriod` = 入室〜退室、`performer` = 役割つき複数、拡張 = 中間時刻・創分類・カウント)← `partOf` ── `Procedure`(2 件目以降の術式・麻酔 L)、`MedicationAdministration`(薬剤)、`Observation`(出血量・尿量・輸血量。`category` 無し) | 実施取消で記録ごと消す |
| 麻酔チャート | ハブ `Procedure`(`order-type|anesthesia-chart`、記録中 `in-progress` / 確定 `completed`)← `partOf` ── `Observation`(打点。`category` 無し)、`Observation`(イベント `anesthesia-event`)、`MedicationAdministration`(単回 / 持続) | 実施記録と別のツリー。振り分けは必ずハブの `category` で行う |
| NCD 症例登録 | `QuestionnaireResponse`(`partOf` = 実施記録ハブ、`NCD_CASE_01`) | 登録状況は回答の項目 |
| ブロックスケジュール | backend `master_surgery_room_blocks` | 曜日ごとの科割当。警告だけで止めない |

### 進捗 Task(`surgery`)

Task は申込時には作りません。**Task が無い申込は申込済**として扱い、最初のステータス変更で作ります(`fhir/surgeryTaskHelpers.ts`)。
中止は同じ transaction でヘッダを `revoked` にし、中止取消で `active` に戻します(`orderCancelEntries`)。中止した申込を編集しても `revoked` のままです(`keepOrderRevoked`)。

| 状態 | `Task.status` | `executionPeriod` | 同じ transaction で書くもの |
|---|---|---|---|
| 申込済 | `requested`(または Task 無し) | なし | |
| 受付済 | `accepted` | `start` | 日程確定ならヘッダ・明細の `occurrenceDateTime`・所要時間・手術室 |
| 入室中 | `in-progress` | `start` | 緊急の入室ならヘッダ・明細の `occurrenceDateTime` |
| 実施済 | `completed` | `start` / `end` | 実施記録(ハブ + 子) |
| 中止 | `cancelled` | なし | ヘッダ `revoked` |

取消で戻すときに消すもの: 実施取消は実施記録(`category = surgery` のハブとその子だけ。麻酔チャートのツリーは残す)。受付取消・入室取消・中止取消は何も消しません。日程の移動(`buildSurgeryMoveBundle`)は Task に触りません。

### シーケンス図の前提

`/fhir` への書き込みはどれも 1 回の transaction Bundle で、backend の `FhirProxyController` が上流へ中継します。
SS-MIX2 を有効にしている施設では、中継が書き込みの控えを記録します(`Ssmix2::Recorder`。手術は電文にしません)。
楽観ロックの版は `postBundle` が `ifMatch` に添え、版が違えば 412 で止まります。
麻酔チャートだけは 1 点ずつ書く(打点 1 時点の組が 1 transaction、イベント・薬剤は 1 件ずつ)ので、他の種別と保存の単位が違います。

### シーケンス図: 申込・編集・削除

`components/SurgeryOrderForm.tsx`・`SurgeryOrderPanels.tsx`(カレンダーからは `SurgeryOrderModals.tsx` が同じパネルを包む)、`buildSurgeryOrderBundle` / `buildSurgeryOrderUpdateBundle` / `buildSurgeryOrderDeleteBundle`(`fhir/surgeryOrderHelpers.ts`)、
`hooks/useSurgeryConflictCheck.ts`、`useCreatePrescription`(全種別共通)/ `useUpdateSurgeryOrder` / `useDeleteSurgeryOrder`(`api/queries/surgery.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor Dr as 主治医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 申込
    UI->>BE: GET /master/surgery_items、GET /master/surgery_room_blocks
    BE-->>UI: 術式マスタ(既定の所要時間・到達法・体位・麻酔・術前指示テンプレート)、科の割当
    UI->>BE: GET /fhir(手術室の Location、医療従事者)
    BE->>FHIR: 検索
    FHIR-->>UI: 手術室・スタッフの候補
    Dr->>UI: 術式・部位と左右・スタッフ・麻酔・準備・同意書・術前指示・希望日を入力
    opt 日付と手術室を選んでいる
      UI->>BE: GET /fhir(その日の手術一覧。キャッシュを使わない)
      BE->>FHIR: 検索
      FHIR-->>UI: その日・その部屋の予定(重なりを表示)
    end
    Dr->>UI: 登録
    UI->>UI: 入力検証(術式・左右・執刀医・麻酔科医)
    opt 日付・手術室・入室時刻が揃う
      UI->>BE: GET /fhir(その日の手術一覧を引き直す)
      BE->>FHIR: 検索
      FHIR-->>UI: 同じ部屋の重なり
      opt 重なりがある・確かめられない
        UI-->>Dr: 確認モーダル
        Dr->>UI: 重なりを承知で登録
      end
    end
    UI->>UI: Bundle を組む
    Note over UI: ヘッダ ServiceRequest(fullUrl)+ 明細 ServiceRequest × 術式<br/>登録時の入院病棟を order-ward に<br/>術前指示: QuestionnaireResponse(POST)<br/>Provenance(CREATE)、代行・研修医: Task order-approval
    UI->>BE: POST /fhir(transaction)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 編集
    UI->>BE: GET /fhir(ヘッダ + 明細 + 術前指示の回答)
    BE->>FHIR: 検索
    FHIR-->>UI: 申込一式
    Dr->>UI: 直して更新(日程を変えれば重なりの確認)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ヘッダ(ifMatch、revoked なら保つ)<br/>明細は差分で POST / PUT / DELETE<br/>術前指示の回答は POST / PUT、外したものは DELETE<br/>Provenance(UPDATE)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 削除
    Dr->>UI: 削除
    UI->>BE: GET /fhir(ヘッダを指す明細・Task・Procedure)
    BE->>FHIR: 検索
    FHIR-->>UI: 明細・Task・実施記録・チャート
    alt 実施記録・麻酔チャート・術前診察がある
      UI-->>Dr: 削除できない
    else 無い
      UI->>BE: POST /fhir(transaction)
      Note over UI,BE: DELETE 明細 → ヘッダ<br/>DELETE Task、術前指示の回答
      BE->>BE: 削除の来歴を Bundle に足す
      BE->>FHIR: POST /
      FHIR-->>UI: 結果
    end
  end
```

### シーケンス図: 日程確定・移動・緊急の入室

`pages/SurgeryWorklistPage.tsx`、`components/SurgeryScheduleModal.tsx`・`SurgeryCalendar.tsx`・`SurgeryMoveConfirmModal.tsx`、`buildSurgeryScheduleBundle` / `buildSurgeryMoveBundle`(`fhir/surgeryOrderHelpers.ts`)、
`useConfirmSurgerySchedule` / `useMoveSurgerySchedule` / `useAdmitUnscheduledSurgery` / `useUpdateSurgeryTaskStatus`(`api/queries/surgery.ts`)。

```mermaid
sequenceDiagram
  autonumber
  actor OR as 手術部
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  alt 受付(予定日別タブ)
    OR->>UI: 受付
    UI->>BE: POST /fhir(transaction、Task surgery = accepted)
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 日程確定(日程未定タブ)
    UI->>BE: GET /fhir(occurrence:missing=true)
    BE->>FHIR: 検索
    FHIR-->>UI: 日程未定の申込(緊急 → 準緊急 → 予定、申込日の古い順)
    OR->>UI: 日程確定(日・入室時刻・所要時間・手術室)
    UI->>BE: GET /fhir(その日の手術一覧を引き直す)
    BE->>FHIR: 検索
    FHIR-->>UI: 同じ部屋の重なり(確認モーダル)
    UI->>BE: GET /fhir(明細 ServiceRequest)
    BE->>FHIR: 検索
    FHIR-->>UI: 術式の明細
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ヘッダ(occurrenceDateTime・所要時間・手術室)<br/>PUT 明細 × 術式(occurrenceDateTime を揃える)<br/>Task surgery = accepted
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else カレンダーで移動・リサイズ
    OR->>UI: カードをドラッグ(5 分刻み)/ 縁を引く
    UI->>BE: GET /fhir(移動先の日の手術一覧を引き直す)
    BE->>FHIR: 検索
    FHIR-->>UI: 重なり・科の割当(確認モーダル)
    OR->>UI: 移動(重なりを承知で移動)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ヘッダ・明細(occurrenceDateTime・所要時間・手術室だけ差し替え)<br/>Task は触らない
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 緊急の入室(日程未定タブ)
    OR->>UI: 入室
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT ヘッダ・明細(occurrenceDateTime = 押した日時)<br/>Task surgery = in-progress
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### シーケンス図: 麻酔科術前診察

`pages/AnesthesiaPreopPage.tsx`、`useAnesthesiaPreopList` / `useAnesthesiaPreop`(`api/queries/surgery.ts`)、`fhir/anesthesiaPreopHelpers.ts`、`fhir/populateSurgery.ts`(初期値の変数)。記入はカルテの右ペイン「テンプレート登録」(`?open=order-template:<オーダー id>@<テンプレートの url>`)です。

```mermaid
sequenceDiagram
  autonumber
  actor An as 麻酔科医
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  UI->>BE: GET /fhir(期間内と日程未定の手術 + 明細・Task + QuestionnaireResponse:based-on)
  BE->>FHIR: 検索
  FHIR-->>UI: 手術と術前診察の状況
  An->>UI: 記入(カルテの右ペインが開く)
  UI->>BE: GET /master/facility_settings(テンプレート)、GET /fhir(Questionnaire、初期値の元)
  BE->>FHIR: 検索
  FHIR-->>UI: テンプレート・手術の予定・身長体重・既往歴・アレルギー・内服薬
  An->>UI: 評価・気道・指示を入れて保存(記入中 / 確定)
  alt 新規
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: POST QuestionnaireResponse(basedOn = ヘッダ、status = in-progress / completed)
  else 続き・訂正
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: PUT QuestionnaireResponse(ifMatch)
  end
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
  Note over UI: 手術一覧の列・手術カード・手術の詳細・麻酔チャートの帯は basedOn で引く<br/>麻酔記録 SUR_ANES_01・NCD_CASE_01 の ASA-PS は %preopAsa で初期値
```

### シーケンス図: 入室・麻酔チャート・実施・実施取消

`pages/AnesthesiaChartPage.tsx`・`components/AnesthesiaChartPanel.tsx`、`useAnesthesiaChart` / `useAnesthesiaChartWrite`(`api/queries/anesthesia.ts`)、`fhir/anesthesiaChartHelpers.ts`、
`components/SurgeryPerformModal.tsx`、`buildSurgeryPerformBundle` / `buildSurgeryPerformDeleteEntries`(`fhir/surgeryResultHelpers.ts`)、`useRegisterSurgeryPerform` / `useUpdateSurgeryTaskStatus`。

```mermaid
sequenceDiagram
  autonumber
  actor OR as 手術室
  participant UI as ブラウザ
  participant BE as backend
  participant FHIR as 上流 FHIR

  OR->>UI: 入室
  UI->>BE: POST /fhir(transaction、Task surgery = in-progress)
  BE->>FHIR: POST /
  FHIR-->>UI: 結果
  opt 麻酔チャート
    OR->>UI: 麻酔チャート(行メニュー)
    UI->>BE: GET /fhir(Procedure?based-on + 子を part-of でページング)
    BE->>FHIR: 検索
    FHIR-->>UI: チャート(無ければ「開始」)
    OR->>UI: 開始
    UI->>BE: POST /fhir(Procedure ハブ、anesthesia-chart、in-progress)
    BE->>FHIR: POST /
    loop 術中
      OR->>UI: 打点(1 時点の組)/ イベント / 薬剤(単回・持続の開始と終了)
      UI->>BE: POST /fhir(transaction、Observation × 項目 / MedicationAdministration)
      BE->>FHIR: POST /
    end
    OR->>UI: 確定
    UI->>BE: PUT /fhir/Procedure(completed、performedPeriod.end)
    BE->>FHIR: PUT
  end
  alt 実施入力
    OR->>UI: 実施(退室後)
    UI->>BE: GET /fhir(Procedure?based-on + 子)
    BE->>FHIR: 検索
    FHIR-->>UI: 既存の記録(初期値は申込の術式・スタッフ・予定入室時刻)
    OR->>UI: 時刻・実施術式(K・L)・スタッフ・測定値・記録・薬剤・材料を入れて登録
    UI->>UI: 入力検証(時刻の順・執刀医・カウント不一致のコメント)
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: POST Procedure(ハブ、code = K、performedPeriod、performer × 役割、拡張)<br/>POST Procedure × 2 件目以降の術式・麻酔(partOf・basedOn)<br/>POST MedicationAdministration × 薬剤<br/>POST Observation × 測定値<br/>Task surgery = completed
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  else 実施取消
    OR->>UI: 行メニュー「実施取消」
    UI->>BE: GET /fhir(Procedure?based-on + 子)
    BE->>FHIR: 検索
    FHIR-->>UI: 実施記録とチャートのツリー
    UI->>UI: category = surgery のハブと子だけを選ぶ
    UI->>BE: POST /fhir(transaction)
    Note over UI,BE: DELETE Observation・MedicationAdministration → 子 Procedure → ハブ<br/>Task surgery = in-progress
    BE->>FHIR: POST /
    FHIR-->>UI: 結果
  end
```

### 医事会計と SS-MIX2

手術は実施記録から集めます(`BillingClaimBuilder` の `:procedure` 経路)。ハブと子の `Procedure.code`(K 章・L 章)が手技、薬剤・材料は直前の手技の剤に付きます。

| 起きたこと | 医事会計(`BillingClaimBuilder`) | SS-MIX2 |
|---|---|---|
| 申込・編集・受付・日程の移動・入室 | なし | なし(手術の電文は持たない) |
| 実施 | 当日の実施記録から、K 章の手技とその薬剤・材料を 500 の剤、L 章(麻酔)とその薬剤を 540 の剤として送る。麻酔時間の加算は実施入力で足す | なし |
| 麻酔チャート | 拾わない(チャートの薬剤は算定しない) | なし |
| 実施記録の無い当日の申込 | 「実施記録がありません(未実施のため送りません)」と報告 | なし |
| 実施取消 | 対象から外れる | なし |
| 中止 | 対象から外れる(`ServiceRequest` が `revoked`) | なし |
| 削除 | 対象から外れる | なし |

看護必要度の C 項目は実施記録の K コードから推します(`features/nursing.md`)。DPC の様式 1・NCD は K コード・到達法・創分類・合併症を起点にするので、構造化を崩さないでください。
