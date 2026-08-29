# 看護指示(指示簿)の設計

医師が入院患者に出す看護向けの指示(安静度・清潔・排泄・観察項目など)を登録し、
看護師が「指示受け」をして、今その患者に効いている指示を一覧で見る「指示簿」。

用語は MEDIS 看護実践用語標準マスター(看護行為編・看護観察編)を使う。

## 1. 他の部門オーダーとの違い = ヘッダを持たず「1 指示行 = 1 ServiceRequest」

| | 他部門(検体検査など) | 食事・リハビリ | 看護指示 |
|---|---|---|---|
| 伝票の単位 | ヘッダ SR + 明細 SR(basedOn) | ヘッダ SR 1 本 | **指示 1 行 = SR 1 本**、ヘッダ無し |
| 同時発行の束ね | basedOn | (無し) | `requisition`(同じ uuid) |
| Task の意味 | 部門の作業の進捗 | 部門の受け入れ状態 | **看護師の指示受け** |
| カルテでの見せ方 | 時系列カード | カード + 暦タブ | **指示簿タブのみ**(カードにしない) |

指示簿の各行は別々に開始・終了・中止されるので、伝票ごと動かす形が合わない。
同時に出した指示群は `requisition` で束ね、履歴ビューで「いつ・誰が・何を」として並べる。

カルテの時系列に出さないのは、指示簿が「いつ出したか」より「今なにが有効か」を見る情報だから。
`karteTimeline.ts` の `orderRequests` で `isNursingServiceRequest` を除外している。
外すと種別の振り分けの最後(どの種別にも当たらない SR は処方)に落ちて処方カードになる。

### 1.1 命名

- `NURSING_ORDER_TYPE = { code: "nursing", display: "看護指示" }`(`order-type` CodeSystem)
- ファイル: `fhir/nursingOrderHelpers.ts` / `fhir/nursingTaskHelpers.ts` /
  `components/KarteNursingTab.tsx` / `NursingOrderForm.tsx` / `NursingOrderPanels.tsx` /
  `NursingItemSearchModal.tsx`

## 2. FHIR の構造

```
ServiceRequest(指示 1 行)
  category        = order-type|nursing, setting|inpatient(固定)
  code            = 看護行為(16 桁コード + 管理番号) | 看護観察(管理番号) | text のみ(自由記載)
  orderDetail[0].text = 頻度・条件(「1日3回」「38℃以上で報告」)
  occurrenceDateTime  = 開始日(日付のみ)
  extension[nursing-order-end] = 終了日(valueDate)。無ければ継続中
  requisition     = nursing-order-requisition|uuid(同時発行の束ね)
  encounter       = 入院 Encounter
  status          = active(有効) / revoked(中止) / completed(終了で閉じたもの)
  requester・依頼科・病棟 = applyOrderContext(他オーダーと同じ)
Task(指示受け) ← focus
  code   = task-code|nursing
  status = requested(指示受け待ち) / accepted(指示受け済) / cancelled(中止)
  owner  = 指示受けをした看護師(Practitioner)
```

### 2.1 新規に定義したローカル URI

- `http://fhir-client.local/StructureDefinition/nursing-order-end`(valueDate)
- `http://fhir-client.local/Identifier/nursing-order-requisition`

### 2.2 code は MEDIS の CodeSystem を二重に載せる

MEDIS の OID 表に従い、看護行為は

- `http://medis.or.jp/CodeSystem/master-nursingAction-16digits`: 第 1〜4 階層の識別番号を
  連結した 16 桁(`A001B001C001D001`)
- `urn:oid:1.2.392.200119.4.704`: 8 桁の管理番号

を併記する。16 桁は階層(指示簿のグループ分け)がそのまま読めるため、管理番号はマスタの
行を一意に引くために使う。看護観察は `http://medis.or.jp/CodeSystem/master-nursingObservationKeyCode`
に観察名称管理番号を入れる。マスタに無い指示は `code.text` だけで持つ。

### 2.3 頻度は orderDetail.text、Timing は使わない

`occurrence[x]` は choice なので、`occurrenceDateTime`(開始日)と `occurrenceTiming` は併用できず、
上流も `occurrenceDateTime` しか索引しない(リハビリの §2.3 と同じ判断)。
頻度・条件は自由記載にして、入力欄の datalist に定型候補を出す。

### 2.4 変更 = 編集 or 「新しい指示 + 前の指示に終了日」

1 行の内容を直すだけなら編集(PUT)。「明日から別の指示に変える」は新しい指示を登録し、
前の指示に終了日を入れる(食事変更と同じ)。中止は `status=revoked` にし、指示受け Task も
`cancelled` にする。

### 2.5 終了日の判定はクライアント

終了日はローカル拡張なので上流では絞れない。指示簿は `status=active` の SR を引いてから
`isNursingOrderRunningOn(sr, today)` で「まだ終わっていない」ものを残す。

## 3. マスタ(MEDIS 看護実践用語標準マスター)

配布ファイル(cp932・カンマ区切り txt・ヘッダあり・引用符なし)を取込画面から全件洗い替える
読み取り専用マスタ。`MasterImport::CsvImporter` のサブクラスで、画面からの編集は持たない。

| テーブル | 配布ファイル | 列 | 備考 |
|---|---|---|---|
| `master_nursing_acts` | koui-ver.*.txt | 18 | `code_16`(階層コードの連結)と `active` を取込時に作る |
| `master_nursing_observations` | kansatsu-ver.*.txt | 46 | 結果 1〜18 は列のまま。管理番号は一意でない(下記) |
| `master_nursing_observation_results` | result-ver.*.txt | 3 | 列挙型の選択肢 |
| `master_nursing_units` | unit-ver.*.txt | 2 | |

- 変更区分: 0=継承 / 1=今版削除 / 2=既削除 / 3=新規 / 5=変更 / 7=管理番号の移行元。
  1・2・7 と、移行先管理番号を持つ行は `active=false`。検索は既定で有効のみ(`active=false` で全件)。
- 看護観察の管理番号は一意でない(用語の統合で番号が再利用され、変更区分 7 の旧行と新行が
  同じ番号で並ぶ)ので unique index にしていない。
- `GET /master/nursing_acts/levels` が第 1・第 2 階層の一覧を返す。検索モーダルの絞り込みと
  指示簿のグループ見出しに使う。
- `GET /master/nursing_acts/actions` は行為(第 3 階層)ごとに畳んだ一覧。修飾語の数と、
  行為を選んだ時点で確定する既定コード(修飾語なし D000、無ければ先頭)を返す。
- **MEDIS の使用許諾**: 医療機関外での使用・配布には使用許諾申請書の提出が必要。配布ファイルは
  リポジトリに同梱せず(spec fixture は数行のみ)、施設ごとに取込画面から投入する。

## 4. Task = 看護師の指示受け

指示 1 行に Task 1 つ。指示の登録 transaction で `requested` を同時に作る(SR の fullUrl
`urn:uuid` を focus に指す。生理検査の即実施と同じ作り)。看護師は指示簿でまとめて
`accepted` にし、受けた人を `Task.owner`(ログイン本人の Practitioner)に入れる。
`taskHelpers.buildTaskUpdate` は owner を扱わないので `withTaskOwner` で後から載せる。

指示の終了(終了日到来)では Task を動かさない。退院時の一括終了も SR の終了日だけを書く
(リハビリと同じ)。

## 5. 画面

- カルテ左ペイン「指示簿」タブ(`KARTE_TABS` の `nursing`)。
  - 一覧(view=""): 今日効いている指示を区分(行為の第 1・第 2 階層 / 観察 / その他)で
    グループ化。「終了・中止も表示」で全件。指示受け待ちの行はチェックしてまとめて指示受け。
    **列は 6 列**(チェック / 指示内容 / 頻度・条件 / 期間 / 指示受け / 操作)。左ペインは
    幅が限られるので、他タブ(病名 6 列・アレルギー 7 列・予約 6 列)と同じ密度に合わせる。
    列を増やすと日付や医師名まで折り返して、かえって読めなくなる:
    - 期間は「08-29 〜 09-05」の 1 セル。同じ入院の中で見るので年は省く(年跨ぎだけ年付き)
    - 状態の列は持たない。既定では全行「有効」で情報量が無いため、
      「終了・中止も表示」で混ざったときだけ行の減光とバッジで示す
    - 指示医・発行日・コード・指示受けの日時・備考の全文は詳細モーダルへ
    - 操作は「表示」+ ケバブ(編集・中止)。アレルギー・予約の一覧と同じ畳み方
  - 詳細(`NursingOrderDetailModal`): 読み取り専用。編集は右ペインに渡す。
    病名・アレルギーのように view を切り替えず**モーダル**にしたのは、指示簿が複数の指示を
    見比べる画面で、一覧が消えると確認の文脈を失うため。
  - 履歴(view="history"): `requisition` 単位で発行日・指示医・行(有効/終了/中止)を新しい順に。
- 登録・編集は右ペイン(`nursing-order-create` / `nursing-order-edit`)。登録は複数行を
  1 transaction で。用語は `NursingItemSearchModal`(行為/観察タブ、階層絞り込み、自由記載)。
- **看護行為は二段で選ぶ**: モーダルは行為(第 3 階層)までを出し(3,664 行 → 558 行為)、
  修飾語(第 4 階層)は選択後にフォームのセレクトで選ぶ。「入浴」だけで修飾語が 10 種あり、
  モーダルに全行を並べると同じ行為が何行も続いて探しにくいため。選ぶたびに 16 桁コードと
  管理番号が入れ替わり、指示内容の文言も追従する(手で書き換えたあとも上書きされる)。
  修飾語を持たない行為ではセレクトを出さない。
- 退院モーダルに「看護指示を退院日で終了する」(食事・リハビリと同型)。
- マスタメンテ > 看護: 看護行為マスタ / 看護観察マスタ(閲覧のみ)。取込は「マスタ取込」。

## 6. 実装したもの

- backend: migration `20260830100000_create_master_nursing_masters`、model / importer /
  controller ×4、routes、importer spec ×3、request spec ×2
- frontend: `masterClient.ts` / `masterQueries.ts`(検索・levels)、`MasterImportPage`(4 件)、
  `NursingActPage` / `NursingObservationPage`、`nursingOrderHelpers` / `nursingTaskHelpers`、
  `queries.ts`(useActiveNursingOrders / usePatientNursingOrders / useNursingOrderDetail /
  useUpdateNursingOrder / useRevokeNursingOrder / useAcceptNursingOrders、退院 transaction)、
  `KarteNursingTab` / `NursingOrderForm` / `NursingOrderPanels` / `NursingItemSearchModal`、
  `KarteRightPane` / `KartePage` / `karteUrl` / `karteTimeline` / `DischargeModal`

### 6.1 検証したこと(2026-08-29)

- 開発環境に MEDIS 4 ファイルを取込(行為 3,664 / 観察 6,797 / 結果 1,029 / 単位 42)
- テスト太郎に 3 行(行為・観察・自由記載)を登録 → 一覧にグループ分けで表示、指示受け待ち 3 件
- 行為の二段選択: モーダルで「入浴」を選ぶ → 修飾語セレクトから「全介助（リフト）」に変更 →
  登録された SR の code が `A001B001C001D386` / 管理番号 12001133 になること、編集で復元されること
- 2 行を指示受け → 指示受け済 + 受けた人の表示
- 1 行を中止 → 中止表示、1 行を編集して終了日を設定、履歴ビューで発行単位に表示
- カルテ時系列に看護指示のカードが出ないこと
- 一覧の 6 列化: 全行が 1 行に収まること、詳細モーダルにコード・依頼科・指示受け日時が出ること、
  中止済みの行が減光 + バッジになり操作が出ないこと、ケバブから編集・中止できること

## 7. 申し送り

- 施設用「指示セット」(術後標準指示など)は未実装。JJ1017 の頻用コードと同じ local テーブルで足す
- 病棟画面の「指示受け未」バッジは未実装
- 実施記録(行為 → Procedure、観察 → Observation)と経過表への連携は未実装。観察編の
  表現タイプ・観察結果テーブル・単位テーブルはそのために取り込んである
- 指示簿に食事・処方など他オーダーの要約行を参照表示する案は次フェーズ
- 終了日到来で SR を `completed` に閉じる処理は無い(有効のまま終了日で判定)。
  上流の `status=active` 検索に残り続けるので、件数が増えたら締め処理を検討
- 中止の確認は `window.confirm`(他画面と同じ)
