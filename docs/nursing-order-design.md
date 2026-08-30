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
  orderDetail[0].text = 条件(「38℃以上で報告」「疼痛時」。自由記載)
  occurrenceDateTime  = 開始日(日付のみ)
  extension[nursing-order-end] = 終了日(valueDate)。無ければ継続中
  extension[nursing-order-schedule] = 頻度(valueTiming)。無ければ適宜・必要時
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
- `http://fhir-client.local/StructureDefinition/nursing-order-schedule`(valueTiming)
- `http://fhir-client.local/nursing-perform-entry`(実施記録 1 回ぶんを束ねる identifier)
- `http://fhir-client.local/CodeSystem/nursing-observation-result`(列挙型の観察結果)

### 2.2 code は MEDIS の CodeSystem を二重に載せる

MEDIS の OID 表に従い、看護行為は

- `http://medis.or.jp/CodeSystem/master-nursingAction-16digits`: 第 1〜4 階層の識別番号を
  連結した 16 桁(`A001B001C001D001`)
- `urn:oid:1.2.392.200119.4.704`: 8 桁の管理番号

を併記する。16 桁は階層(指示簿のグループ分け)がそのまま読めるため、管理番号はマスタの
行を一意に引くために使う。看護観察は `http://medis.or.jp/CodeSystem/master-nursingObservationKeyCode`
に観察名称管理番号を入れる。マスタに無い指示は `code.text` だけで持つ。

### 2.3 頻度は Timing を root 拡張で持ち、条件は orderDetail.text の自由記載

`occurrence[x]` は choice なので、`occurrenceDateTime`(開始日)と `occurrenceTiming` は併用できず、
上流も `occurrenceDateTime` しか索引しない(リハビリの §2.3 と同じ判断)。そこで頻度は
root 拡張 `nursing-order-schedule` の `valueTiming` に持つ(`fhir/nursingScheduleHelpers.ts`)。
終了日の拡張と同じ置き方なので、`buildNursingOrderCloseEntry` のように拡張を組み直す経路でも
消えない。条件(「38℃以上で報告」)は頻度とは別物なので `orderDetail[0].text` に残す。

`Timing.repeat` の形:

| 頻度 | repeat | その日の予定 |
|---|---|---|
| 1日N回 | `frequency=N, period=1, periodUnit=d, timeOfDay=[...]` | timeOfDay そのまま |
| N時間毎 | `period=N, periodUnit=h, timeOfDay=[起点]` | 起点から N 時間刻みで **同日 0〜24 時に入る分**(起点より前も逆算)。翌日にかかる分は翌日の展開で出る。24 で割り切れない間隔(5・7 時間)は日ごとにずれる |
| 時刻指定 | `timeOfDay=[...]` | そのまま |
| 週N回 | `frequency=N, period=1, periodUnit=wk, dayOfWeek=[...], timeOfDay=[時刻]` | 曜日が当たる日だけ |
| 適宜・必要時 | (拡張なし) | 予定を持たない |

- 「1日N回」の時刻は**指示に焼き付ける**。初期値は施設設定(`facility_settings.nursing_schedule`、
  施設設定画面の「看護指示の既定時刻」)から入れるが、設定を変えても登録済みの指示は動かない。
- 拡張を付ける前の指示は頻度も `orderDetail` に書かれているが、「条件」として読めば表示は
  従来どおりなので移行しない。編集で開くと頻度は「適宜」・条件に旧文言が入るので、
  頻度を選び直して条件を消せば構造化される。
- 予定と実施の突き合わせ(`matchPerformsToSchedule`): 実施は最も近い予定に 1 対 1 で当て、
  許容幅は min(60 分, 予定の最小間隔の半分)。固定 60 分だけだと近い予定(9:00/9:30)に同じ実施が
  二重に当たり、間隔の半分だけだと 1 日 1 回(±12 時間)で夕方の実施が朝の予定に当たる。
  許容幅に入らない実施は「予定外」。

### 2.4 変更 = 編集 or 「新しい指示 + 前の指示に終了日」

1 行の内容を直すだけなら編集(PUT)。「明日から別の指示に変える」は新しい指示を登録し、
前の指示に終了日を入れる(食事変更と同じ)。中止は `status=revoked` にし、指示受け Task も
`cancelled` にする。

### 2.5 終了日の判定はクライアント

終了日はローカル拡張なので上流では絞れない。指示簿は `status=active` の SR を引いてから
`isNursingOrderRunningOn(sr, today)` で「まだ終わっていない」ものを残す。

### 2.6 実施記録 = 観察は Observation、行為は Procedure(`fhir/nursingPerformHelpers.ts`)

```
ServiceRequest(観察の指示) ← basedOn ── Observation
  category[0]     = order-type|nursing(**これだけ。vital-signs は付けない**)
  code.coding     = [MEDIS 観察コード(指示から複写), LOINC(対応表にあれば)]、text = 指示の文言
  value[x]        = 数値型 valueQuantity / 列挙型 valueCodeableConcept(text 必須、
                    coding は result_group_code + 選択肢の順番) / 文字型 valueString /
                    ２数値型 component×2 / 血圧型 = バイタルの血圧と同じ 85354-9 + component
  effectiveDateTime = 記録日時、performer = 実施者(Reference[] 直)
  identifier      = nursing-perform-entry|uuid(1 回の記録の束ね)
ServiceRequest(行為の指示) ← basedOn ── Procedure(category order-type|nursing、performedDateTime、performer[].actor)
```

- **実施しても指示受けの Task は動かさない**(リハビリ §4 と同じ。1 指示に実施が日々積み上がる)。
  取消は Observation / Procedure を 1 件ずつ消すだけ。
- **category を order-type|nursing だけにする理由**: 上流は `Observation.category` の先頭の
  concept しか索引しない。vital-signs を足しても検索には効かず、逆に先頭に置くとカルテの
  バイタル検索(`useKarteVitalsInfinite` / `useKarteDayIndex`)に混ざってカードにならない
  Observation で診療日だけが増える。経過表だけ `category=vital-signs,nursing` で引く
  (`queries.ts` の `VITAL_FLOWSHEET_CATEGORY`)。
- **LOINC 併記で経過表に合流**: 経過表の行キーは LOINC 優先なので、SpO2(31000001→2708-6)・
  体温(31001368→8310-5)・脈拍数・呼吸数・体重・身長・血圧型(31002365→85354-9)は手入力の
  バイタルと同じ行に並び、グラフも引ける(`NURSING_LOINC_MAP`)。収縮期・拡張期の単独項目は
  対応表に入れない(血圧行と別行になり、グラフの系列キーが衝突する)。それ以外の観察は
  MEDIS コードをキーにした行になる。`buildVitalFlowsheet` は valueCodeableConcept と
  component(2 値 → "12.5/8")も読むように広げた。
- `Observation` には `based-on` の検索パラメータが無いので、実施履歴は患者(または日付)で
  引いてから basedOn で指示に振り分ける(`useNursingPerformsOf` / `useNursingPerformsOn`)。

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
- 観察編の **表現タイプは 5 種**: 列挙型 / 数値型 / 文字型 / ２数値型 / **血圧型**(仕様書に無いが
  12 件実在、値 2 つ)。数値型の `result_1` は桁マスク("99.9")で、入力欄の step と max を
  ここから読む(`numberMaskFormat`)。列挙型の選択肢は `result_1..18` を正とする
  (`result_group_code` の観察結果テーブルは V 系グループ 3,773 行ぶんが存在しない)。
  ２数値型の `unit` は "縦cm:横cm" の `:` 区切り。
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
- **病棟の指示簿**(`pages/NursingWorklistPage.tsx`、`/nursing-worklist`):
  看護師が病棟単位で未指示受けを捌く画面。カルテの指示簿タブが患者 1 人ぶんなのに対し、
  こちらは病棟の患者を横断する。**部門業務メニューには入れない**(部門ではなく病棟の
  画面なので)。入院患者一覧と相互にボタンで行き来する(病棟と基準日を引き継ぐ)。
  - 軸はリハビリ一覧と同じ「基準日に効いている指示」。**病棟だけは上流の `ward` 検索で
    サーバー側で絞る**(看護指示は退院まで `status=active` で残るので、全病院ぶんを引いて
    から捨てると際限なく重くなる)。診療科・指示受け状態は他のワークリストと同じく画面側で絞る。
  - **行は患者でまとめる**(見出し行に病室・氏名・未指示受け件数)。病棟の作業単位が患者で、
    フラットに並べると同じ患者名が何行も続くため。見出しの氏名はカルテの指示簿タブ
    (`?tab=nursing`)へのリンク。見出し行のチェックでその患者の未指示受けをまとめて選ぶ
    (一部だけ選んでいるときは中間状態)。ベッド番号は出さない(並び順にだけ使う)。
  - 既定は「未指示受け」タブ(件数併記)。「全指示」タブで受け済みも見る。
  - 行の操作は「表示」(詳細モーダル)とケバブの「中止」だけ。**編集は置かない**
    (内容を変えるのは医師の操作で、カルテの右ペインが担当する)。
  - 病室・ベッドは `useInpatientEncounters`(入院患者一覧と同じキャッシュ)の
    `Encounter.location.display` から取る。並び順もこれで決める。
- **入院患者一覧の未指示受けバッジ**(`pages/InpatientListPage.tsx`): 「入院患者」タブの
  特記事項セルの先頭に「指示受け N」。押すとその患者のカルテの指示簿タブが開く。
  予定タグ(枠線)と違って要対応なので塗りつぶしで区別する。件数は
  `useNursingPendingCounts`(ワークリストと同じキャッシュ)から取り、病棟未選択・
  他タブでは引かない。タブ行の右に指示簿へのボタンを置く。
- **実施入力**(`NursingPerformModal`): 病棟の指示簿(患者見出し行の「実施入力」)とカルテの
  指示簿タブ(ツールバーの「実施入力」)の両方から、**患者単位で**開く。その患者の有効な指示が
  観察・行為に分かれて縦に並び、観察は表現タイプごとの入力欄(数値＋単位 / select /
  文字 / 縦×横 / 収縮期÷拡張期)、行為はチェック。値の入ったものだけを 1 transaction で保存。
  マスタ外の自由記載は文字入力。
- 指示の登録・編集フォームの頻度は select(適宜 / 1日1〜4回 / 4・6・8時間毎 / 時刻指定 /
  週N回)＋時刻の微調整＋条件(自由記載)。
- 病棟の指示簿に「本日」列。予定を持つ指示は「実施済/予定」(「1/3」)と次の予定
  (「次 14:00」、遅れていれば赤で「遅れ 06:00」)。予定の無い指示はその日の最新の値。
- 病棟の指示簿に「実施予定」タブ: 基準日が今日なら、遅れている・または現在時刻の前後
  1 時間に未実施の予定がある指示だけを患者ごとに(1 分ごとに再計算、`hooks/useNow`)。
  今日以外の日は「その日の未実施の予定がある指示」。
- 実施入力モーダル: 各行に予定の消化状況(`09:00✓ 14:00● 20:00`。● は次、遅れは赤)を出し、
  いま予定のある指示を上に並べる。予定はあるが時間でない指示は薄く出す(入力はできる。
  臨時の測定・頓用の記録のため)。記録日時を変えると並びと強調が追従する。
  データは `useNursingPerformsOn(date)`(ワークリスト本体とは別クエリ。入院患者一覧の
  バッジに Observation を読ませないため)。
- 詳細モーダルに「実施履歴」(日時・値・実施者・備考)と取消。
- 経過表: 看護観察が行として合流する(§2.6)。
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
- 病棟ワークリスト(第 2 段階): `queries.ts`(`useNursingWorklist` / `useNursingPendingCounts`、
  `invalidateNursing` に worklist キーを追加)、`pages/NursingWorklistPage.tsx`、
  `NursingOrderDetailModal`(患者名を出せるように)、`pages/InpatientListPage.tsx`、
  `App.tsx` / `App.css`
- 実施記録(第 3 段階): `fhir/nursingPerformHelpers.ts`、`fhir/vitalHelpers.ts`(血圧の
  組み立てを export、`buildVitalFlowsheet` の行キー・値の拡張)、`queries.ts`
  (`VITAL_FLOWSHEET_CATEGORY`、`useNursingPerformsOf` / `useNursingPerformsOn` /
  `useRegisterNursingPerform` / `useDeleteNursingPerform`)、`masterQueries.ts`
  (`useNursingObservationsByManageNos`)、`components/NursingPerformModal.tsx`、
  `NursingOrderDetailModal`(実施履歴)、`KarteNursingTab` / `NursingWorklistPage`(配線・本日列)
- 頻度の構造化(第 4 段階): backend `facility_settings.nursing_schedule`(jsonb、model の既定値
  マージ・書式検証、admin PATCH は渡した項目だけ更新)、`fhir/nursingScheduleHelpers.ts`
  (Timing 変換・展開・突き合わせ)、`nursingOrderHelpers`(schedule/condition)、
  `NursingOrderForm`(頻度 select)、`FacilitySettingsPage`(既定時刻)、`hooks/useNow`、
  `NursingWorklistPage`(本日列・実施予定タブ)、`NursingPerformModal`(予定バッジ・並び)

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
- 病棟ワークリスト: 東3階病棟で 3 件・患者でまとまること、指示の無い病棟と開始日前の
  基準日で 0 件になること、選択して指示受け → タブの件数が減ること、ケバブから中止できること、
  詳細モーダルに患者名が出て編集ボタンが出ないこと
- 指示受けの結果がカルテの指示簿タブと入院患者一覧のバッジにも反映されること
  (`invalidateNursing` に worklist キーを足してあること)
- 入院患者一覧: バッジ「指示受け 1」が出てカルテの指示簿タブへ飛べること、
  予定タグと見分けがつくこと
- 実施記録: テスト太郎に観察指示 5 件(SpO2 / 体温 / 便量 / 自壊創範囲 / 血圧型)を足し、
  行為 1 件と合わせて 1 回で記録 → Observation 6(LOINC 併記・列挙コード `R7031-01`・
  component)+ Procedure 1 が 1 transaction で作られ、`category=vital-signs` の件数は不変
- 経過表で SpO2・体温・血圧が既存行に合流、便量・自壊創範囲(12.5/8 cm)・自由記載が新規行
- 本日列に値が出ること、詳細モーダルの実施履歴と取消が効くこと
- 頻度の構造化(2026-08-30): 編集で「1日3回」を選ぶと施設既定の 9/14/20 時が入り、更新後の
  SR に `nursing-order-schedule` の Timing が付くこと。SpO2 を 6 時間毎、血圧を 1 日 2 回にして
  実施予定タブに 2 件(「0/4 遅れ 06:00」赤、「0/2 次 10:00」)、実施入力で予定のある指示が
  上に並び予定バッジが出ること。旧データ(自由記載)は条件として従来どおり表示されること

## 7. 申し送り

- 施設用「指示セット」(術後標準指示など)は未実装。JJ1017 の頻用コードと同じ local テーブルで足す
- **病棟の `ward` はオーダー登録時に焼き付けた値**なので、転棟すると指示が前の病棟の
  ワークリストに出続ける(リハビリ一覧と同じ制約)。今いる病棟で引きたいなら Encounter 側から
  患者を確定して突き合わせる作りに変える
- 指示受けの取消(accepted → requested)は未実装。カルテの指示簿タブにも無いので、
  戻す導線を足すときは両画面まとめて
- 実施記録のまとめ単位(nursing-perform-entry)での取消・編集は未実装(1 件ずつ消す)
- 収縮期・拡張期を単独項目で指示した場合、経過表では MEDIS コードの別行になる(血圧行に
  合流させたければ血圧型 31002365 で指示する運用)
- 指示受け前(requested)の指示にも実施を記録できる。受けてからに限るかは運用で決める
- 拡張を付ける前の指示(頻度が自由記載)は、編集で頻度を選び直すまで予定を持たない
- N 時間毎で 24 を割り切れない間隔(5・7 時間)は日ごとに時刻がずれる(起点固定・日単位展開)
- 施設設定の既定時刻は施設設定画面(管理者)から変える。登録済みの指示には波及しない
- 指示簿に食事・処方など他オーダーの要約行を参照表示する案は次フェーズ
- 終了日到来で SR を `completed` に閉じる処理は無い(有効のまま終了日で判定)。
  上流の `status=active` 検索に残り続けるので、件数が増えたら締め処理を検討
- 中止の確認は `window.confirm`(他画面と同じ)
