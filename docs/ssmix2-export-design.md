# SS-MIX2 標準化ストレージ出力の設計

診療データを上流 FHIR サーバーへ書くたびに、SS-MIX2 標準化ストレージ(HL7 v2.5 のファイルを
患者 ID / 診療日 / データ種別のフォルダに置く形式)へも書き出す。状態: **検討済み・未実装**。
仕様の原典は日本医療情報学会「SS-MIX2 標準化ストレージ仕様書 Ver.1.2j」「同 構成の説明と
構築ガイドライン Ver.1.2j」「同 コード表」(2026-08 版、`backend/tmp/docs/ssmix2/` に PDF)。

## 1. この設計が守っていること

**出力は上流への書き込みの写しで、画面には何も足さない。** 書き込みの入口は backend の
FHIR 中継(`FhirProxyController#relay`)1 本なので、ここで「書けた transaction」を記録し、
そこから HL7 を起こす。frontend の登録処理ごとに出力コードを足さない(漏れるため)。

**変換は backend、ファイル操作は院内エージェント。** FHIR → HL7 v2.5 の組み立てはマスタ
(HOT・MEDIS 病名・JLAC)と rspec がある backend に置く。backend は Render 上で院内ディスクに
触れないので、フォルダ作成・ファイル名・コンディションフラグの付け替えは
院内エージェント(別リポジトリ `fhir-client-agent`、Go)が行う。

**エージェントは取りに行く。** エージェントの原則「外向きのみ・待ち受けポート無し」を守り、
backend にジョブ基盤を足さない。HL7 の組み立てはエージェントのポーリング要求の中で行う。

**有効・無効と出力先は施設設定で切り替える。** エージェント向けの受信トークンだけは既存の
「外部システム連携」の仕組み(発行・暗号化保存・env フォールバック)を使う。

## 2. 全体の形

```
ブラウザ ──POST /fhir(transaction / 単体 POST・PUT・DELETE)──▶ FhirProxyController#relay ──▶ 上流 FHIR
                                                                      │ 2xx のとき(安い INSERT だけ)
                                                                      ▼
                                                   ssmix2_transactions(要求と transaction-response を保存)
                                                                      │
  agent(ssmix2-storage) ──GET /integrations/ssmix2/messages───────▶ 未処理 transaction を HL7 に起こす
  (院内サーバー)        ◀── {storage, messages[]} ─────────────────  (FhirStore で患者・入院・医師を補う)
       │ root/患者ID先頭3/次の3/患者ID/診療日/データ種別/ファイル(tmp → rename。既存 _1 → _2、取消は _0)
       └──POST /integrations/ssmix2/messages/ack──────────────────▶ written / failed を記録
```

レセコン連携が `Integrations::FhirStore` で Patient を書く経路も同じ記録を通す
(`FhirGateway#forward` を直接呼ぶ `ImagingStudyPublisher` は対象外リソースなので拾わない)。

## 3. 施設設定とトークン

`FacilitySettings::SETTINGS["ssmix2"]`(`docs/features/facility.md` の項目表に載せる):

| キー | 既定 | 内容 |
|---|---|---|
| `enabled` | false | 出力するか。**有効・無効はこの値だけを正とする**(外部システム連携側の enabled は見ない) |
| `root_path` | "" | 標準化ストレージのルートフォルダ。エージェントが解釈する絶対パス(UNC・ドライブ文字可)。有効のとき必須 |
| `facility_id` | "" | 医療施設 ID 10 桁(都道府県 2 + 機関区分 1 + 機関コード 6 + チェックデジット 1)。SS-MIX ヘッダーに使い、ルートフォルダ名の推奨値。有効のとき必須 |
| `patient_id_digits` | 6 | 患者 ID の桁数。足りなければ前ゼロ(ガイドライン表 2.3-1。1〜15) |
| `sending_application` | "fhir-client" | MSH-3 |

shape は `:boolean` / `{ pattern: /\A(\d{10})?\z/ }` / `{ integer: { min: 1, max: 15, unit: "桁" } }`、
必須は `check` で enabled のときだけ。読み出しは `FacilitySettings.ssmix2["enabled"]`。設定は
プロセス内キャッシュ(Mutex + 30 秒 TTL、`ExternalSystemConnection` と同じ流儀)で引く。

トークンは `Integrations::ExternalSystems::DEFINITIONS` に
`Definition.new(key: "ssmix2_storage", label: "SS-MIX2 標準化ストレージ", sections: %i[inbound_token])`
を足す。管理画面「外部システム連携」で発行し、env フォールバックは `SSMIX2_STORAGE_INBOUND_TOKEN`。
`system_types` が空の定義でも管理画面・一覧は描ける(一覧の状態は「無効」のままになるが、
API の認可はトークンの有無だけを見る)。

## 4. transaction の記録

テーブル `ssmix2_transactions`: `occurred_at(6)`、`actor_practitioner_id`、`method`、`path`、
`request jsonb`(送られた Bundle かリソース)、`response jsonb`(transaction-response か作成・更新後の
リソース。DELETE は null)、`status`(pending / building / done / skipped / failed)、`error`、
`attempts`、`leased_at`、`processed_at`。index `[status, occurred_at]`。

`Ssmix2::Recorder.record(method:, path:, request_body:, response_body:, actor:)`:

- 施設設定が無効なら何もしない。書き込み(POST / PUT / DELETE。GET と `metadata` は除く)で上流が
  2xx のときだけ 1 行 INSERT。batch Bundle は記録しない(`Bundle.type == "transaction"` と entry の
  `request.method` を見る)。
- 対象外のリソース(Binary・Questionnaire・Task・Provenance・Flag・Observation の経過表など)しか
  含まない要求はここで捨てる(`Ssmix2::Dispatcher.relevant?`)。Observation の連打で肥大しないため。
- actor は `current_user_payload&.dig(:practitioner_id)`(Bearer / 無認証では payload が nil)。
  取り出しも含めて `rescue StandardError` で包み、記録に失敗しても中継の応答は変えない。
- フック地点は `relay` の `forward` の戻りと `render` の間、および
  `Integrations::FhirStore#conditional_put` / `#put` / `#transaction`(actor は nil)。
- `done` の行も 14 日で purge(ポーリングの中で 1 日 1 回)。

## 5. HL7 v2.5 の組み立て(`backend/app/services/ssmix2/`)

### 5.1 共通部品

- `Hl7::Builder` — セグメント配列から電文を作る。区切り `|^~\&`、セグメント終端 CR、ファイルには
  `<FS><CR>` を付けない。HL7 エスケープ(`\F\ \S\ \T\ \R\ \E\`)、末尾の空フィールド省略。
  MSH-7 `YYYYMMDDHHMMSS.FFF`(JST、タイムゾーン無し)、MSH-9 `型^事象^構造`、MSH-11 `P`、MSH-12 `2.5`、
  MSH-18 `~ISO IR87`、MSH-20 `ISO 2022-1994`、MSH-21 `SS-MIX2_1.20_j^SS-MIX2^1.2.392.200250.2.1.100.1.2.120^ISO`。
- 文字コードは受信側(`lab_import/text_decoder.rb`)と揃えて **CP50221** で出力する(JIS X 0208 だけの
  `ISO-2022-JP` では NEC/IBM 拡張・全角チルダが落ちる)。半角カナ(U+FF61〜FF9F)だけ全角に寄せる
  (全体に NFKC をかけると全角英数が ASCII になり氏名が崩れる)。変換できない字は先に数えて
  `warnings` に残し、`?` に置き換える。
- `Hl7::Types` — CWE(`code^text^system`。ローカルと標準の併記は 1〜3 成分と 4〜6 成分)、
  XPN(`姓^名^^^^^L^I` と `L^P` の 2 繰返し。漢字/カナは `name[].extension` の
  iso21090-EN-representation IDE / SYL)、XCN(`ID^姓^名^^^^^^^L^^^^^I`)、
  XAD(`^^^^郵便番号^JPN^H^住所`)、XTN(`^PRN^PH^^^^^^^^^番号`)、
  PL(入院 `病棟^病室^ベッド^^^N`、外来 `診療科^^^^^C`)、TS(`YYYYMMDD[HHMM[SS]]`)。
- `Context` — 1 回の組み立てで使う上流データ。`FhirStore#search` に `_id=a,b,c` と `_include`
  (subject / encounter / requester / performer / location、Location は `_include:iterate=Location:partof`)
  をまとめて 1〜2 回で引く。患者・Practitioner・Location・Organization はプロセス内の短命キャッシュ
  (数分)に置き、同じ患者の連続 transaction で読み直さない。
  - 患者(PID)。PID-3 は `patient_id_digits` に前ゼロ、PID-33 更新日時。
  - 来院(PV1)。入院は Encounter(in-progress・IMP)の `location[0]` のベッド → 病室 → 病棟
    (`physicalType` bd / ro / wa の `partOf` 連鎖)。Location はコードを持たないので PV1-3 は
    Location.id(または name)。外来は診療科コード `^^^^^C`。PV1-7 主治医。
  - 医師(XCN)。ID は `qualification[].identifier`(医籍登録番号)、無ければ FHIR id。
  - 診療科(ORC-17 `コード^名称^HL70069`)。Organization.identifier の SS-MIX2 統一診療科コード
    (`frontend/src/fhir/departmentCodes.ts` と同じ system)、無ければ `-`。
  - 自院(ORC-21〜23)。`FhirStore#read_or_nil("Organization", FacilitySettings.self_organization_id)`、
    無ければ保険医療機関番号の system(`Reports::UpstreamBundle::INSTITUTION_NO_SYSTEM`)で検索。
- `Codes` — マスタ参照の薄い層。HOT9 はレセ電コード → `Master::HotCode.receipt_code_1/2`、
  アレルゲンの薬剤は JFAGY の YJ → `Master::HotCode.individual_medicine_code`。JLAC10 / MEDIS は
  リソースの coding から。MR9P の単位・剤形・処方区分、HL70162 経路、JHSD0006 転帰、HL70128 重症度は
  ここに対応表として持つ。
- `OrderNumber` — ORC-2 の 15 桁前ゼロ番号。対応表 `ssmix2_order_numbers`(`resource_ref` unique、
  `number` bigint sequence。`INSERT … ON CONFLICT DO NOTHING RETURNING`)で、ヘッダー ServiceRequest・
  Encounter・basedOn の無い DiagnosticReport の FHIR 参照に連番を割り当てる。POST の `urn:uuid` は
  transaction-response の `response.location` の実 id に解決してから採番する。同じオーダーの修正・
  取消は同じ番号になり、これがファイル名の履歴管理の前提。患者基本・病名・アレルギーは `ALL9`。

### 5.2 振り分け(`Dispatcher`)と対応表

transaction 1 件の `request`(entry のリソースと method)と `response`(採番された id・版)から、
起こすメッセージの一覧を決める。1 Bundle に複数種別が混ざれば複数メッセージ。オーダー種別は
frontend と同じ約束(ServiceRequest.category の `http://fhir-client.local/CodeSystem/order-type`、
`frontend/src/fhir/orderKinds.ts`)で読む。

| FHIR の書き込み | メッセージ | データ種別 | 診療日 | オーダ No | 処理区分 |
|---|---|---|---|---|---|
| Patient POST / PUT | ADT^A08 | ADT-00 | `-` | ALL9 | INS |
| Encounter(IMP)作成 in-progress | ADT^A01 | ADT-22 | PV1-44 入院日 | Encounter の番号 | INS |
| Encounter 更新 finished + period.end | ADT^A03 | ADT-52 | PV1-45 退院日 | 同上 | INS |
| Encounter 更新 location が増えた(転室・転床・転棟) | ADT^A02 | ADT-42 | EVN-6 転棟日 | 同上 + 当日連番 | INS |
| Encounter 更新 serviceProvider が変わった(転科) | ADT^A02 | ADT-42 | 同上 | 同上 | INS |
| Encounter entered-in-error(入院取消) | ADT^A11 | ADT-22 | 入院日 | 同上 | DEL |
| Encounter finished → in-progress で period.end 消失(退院取消) | ADT^A13 | ADT-52 | 退院日 | 同上 | DEL |
| Appointment checked-in(外来受付) | ADT^A04 | ADT-12 | PV1-44 受付日 | Appointment の番号 | INS |
| AllergyIntolerance 作成・更新・DELETE | ADT^A60(患者の全アレルギーを IAM で列挙、IAM-6 A/U/D) | ADT-61 | `-` | ALL9 | INS |
| Condition 作成・更新・DELETE | PPR^ZD1(患者の全病名を PRB + ZPR で列挙、PRB-1 AD/UP/DE) | PPR-01 | `-` | ALL9 | INS |
| 処方(SR ヘッダー + MedicationRequest)作成・更新 | RDE^O11(Rp ごとに ORC/RXE/TQ1/RXR、ORC-4 に Rp 番号) | OMP-01 | ORC-9 オーダー日(authoredOn) | ヘッダーの番号 | INS |
| 処方 取消(cancelled / revoked) | RDE^O11(ORC-1 CA) | OMP-01 | 同上 | 同上 | DEL |
| 注射 作成・更新・取消 | RDE^O11(RXE-2 `00^一般^99I02`、RXC に成分、RXR 経路・装置、TQ1-7/8 開始終了) | OMP-02 | 同上 | 同上 | INS / DEL |
| 検体検査オーダー(SR + Specimen) | OML^O33(SPM / ORC / OBR / OBX は依頼項目を OBX-11 `O`) | OML-01 | ORC-9 | ヘッダーの番号 | INS / DEL |
| 検体検査結果(DiagnosticReport + Observation) | OUL^R22(SPM-17 採取日、OBX-2 NM/ST/CWE、OBX-11 F/C/P、OBR-22 報告日時) | OML-11 | SPM-17 採取日 | 元オーダーの番号(basedOn 無しは DiagnosticReport で採番) | INS(訂正報告も INS。前の有効ファイルは過去履歴 2 になる) |

第 2 段階(Dispatcher に 1 行 + builder 1 クラスずつ足す): MedicationAdministration → RAS^O17
(OMP-11 / OMP-12)、食事 ServiceRequest → OMD^O03(対応は `docs/meal-order-design.md` と
`frontend/src/fhir/mealOrderHelpers.ts` 冒頭に整理済み)、放射線・内視鏡・生理のオーダー →
OMG^O19(OMG-01 / 02 / 03、JJ1017・LENDO)、実施 → OMI^Z23(OMG-11 / 12)、生理結果 → ORU^R01
(OMG-13)、入院予定 ADT^A14 / 退院予定 ADT^A16、担当医変更 ADT^A54、トランザクションストレージ
(`TR_<タイムスタンプ>_<処理系統>.DAT`)。

Encounter の転科と退院取消は前の版が要るので `Encounter/{id}/_history/{vid-1}` を読む
(vid は transaction-response の `response.location` `{type}/{id}/_history/{vid}` から。vid=1 と
同一 transaction 内の 2 回更新は前版無しとして扱う)。転室・転床は `location[]` が増えたことで判定でき、
前版は要らない。

### 5.3 各 builder の要点(`Ssmix2::Messages::*`)

親クラスが MSH / PID / PV1 を組み、子が本体セグメントと SS-MIX ヘッダー項目(患者 ID・診療日・
データ種別・オーダ No・処理区分・診療科・トランザクション日時)を返す。フィールドの対応は仕様書の
該当表(3.5 ADT、3.6 IAM、3.7 PRB/ZPR、3.9/3.11 ORC/RXE/TQ1/RXR/RXC、3.13/3.14 SPM/OBR/OBX)に従う。

- ORC: ORC-1 NW / CA(修正は NW のまま INS)、ORC-2 15 桁、ORC-9 `YYYYMMDDHHMMSS`、ORC-10 入力者(actor)、
  ORC-12 依頼者(requester)、ORC-13 入力場所、ORC-17 診療科、ORC-21〜23 自院、
  ORC-29 `I^入院患者オーダ^HL70482` / `O^外来患者オーダ^HL70482`。入外・処方区分は MedicationRequest に
  無く、ヘッダー ServiceRequest の category(`prescription-setting` / `prescription-category`)。
  MedicationRequest 単体の PUT では `basedOn` からヘッダーを読む。
- RXE: RXE-2 `HOT9^名称^HOT9`、無ければレセ電コードをローカル(`^99Zxxx`)にし RXE-31 に
  `ローカル^^99Zxxx^YJ^^YJ`。RXE-3/5 1 回量と単位(MR9P、無ければ ISO+ かローカル)、RXE-10/11 調剤量、
  RXE-15 処方箋番号(ヘッダー id)、RXE-21 処方区分(MR9P: OHP 外来 / IHP 入院 …)。
  TQ1-3 `usage_code&名称&JAMISDP01`(電子処方箋用法マスタの `usage_code` は JAMI 標準用法コード)、
  TQ1-6 `日数^d`、TQ1-7/8。頓用は用法コード 3 桁目で表す。RXR-1 は処方は用法の基本区分
  (内服 PO / 外用 AP)から、注射は Dosage.route(`route-codes`、HL7 0162 ベース)から。
- PRB: PRB-1 AD/UP/DE、PRB-3 `管理番号^病名^MDCDX2`、PRB-4 Condition.id、PRB-7 診断日、PRB-9 終了日
  (abatementDateTime)、PRB-10 `ICD10^^I10`、PRB-13 疑い(verificationStatus provisional か接尾語
  管理番号 27000001、JHSD0005)、PRB-14 転帰(clinicalStatus → JHSD0006)、PRB-16 開始日(onsetDateTime)、
  PRB-17 表示病名、ZPR-1/3 修飾語管理番号、ZPR-5 交換用コード。
- IAM: IAM-2 分類(category food / medication / environment → FA / DA / EA)、IAM-3 アレルゲン
  (薬剤は HOT9、他は JLAC10、無ければテキスト)、IAM-4 重症度(severity は無いので criticality low /
  high → HL70128 の近似)、IAM-5 反応(reaction[0].manifestation[0].text)、IAM-6 A/U/D、IAM-11 発症日。
- SPM / OBR / OBX: SPM-4 `JLAC10 材料コード^名称^JC10`、SPM-17 採取日(日付のみ)、OBR-4 検査セット
  (ローカル `99O03`)、OBR-22 報告日時(issued)、OBR-25 状態、OBX-3 `JLAC10^名称^JC10^ローカル^略称^99X03`、
  OBX-5/6/7/8 値・単位・基準値・異常フラグ(HL70078)、OBX-11 F / C / P、OBX-14 検査日。

### 5.4 組み立ての実行(`Materializer`)とメッセージの表

- `GET /integrations/ssmix2/messages` の中で呼ぶ。pending の transaction を古い順に **最大 5 件**
  `UPDATE … SET status='building', leased_at=now() WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`
  で短く確保し、ロックの外で組み立て、結果を書く(2 相。上流を読む数秒間 DB のロックを握らない)。
  `building` のまま 10 分経ったものは pending に戻す。
- 上流の 429 は failed にせず pending に戻して次回に回す(backend の 1 トークンに 300 件/分の
  レート制限があり、帳票・レセコン送信と予算を分け合う)。
- builder の例外は transaction を failed にして `error` を残し、他の行は続ける。`attempts` 5 回で諦める。
- テーブル `ssmix2_messages`: `transaction_id`、`patient_id`、`service_date`(`YYYYMMDD` か `-`)、
  `data_kind`、`order_no`、`process`(INS / DEL)、`department_code`、`transaction_at`
  (`YYYYMMDDHHMMSSFFF`。INSERT 時刻に、同じ患者 ID・診療日・データ種別・オーダ No の中で 1 ms ずつ
  ずらして一意にする)、`body binary`(CP50221 のバイト列)、`warnings text[]`、
  `status`(pending / leased / written / failed)、`leased_at`、`attempts`、`error`、`written_at`。
  index `[status, id]`。written は 14 日で purge、failed は手で片付けるまで残す。

## 6. エージェント向け API と状態 API

`config/routes.rb` の `namespace :integrations` に `namespace :ssmix2`(`/integrations/` は
`frontend/vite.config.ts` と `render.yaml` に既にある):

- `GET /integrations/ssmix2/messages?limit=20` — Bearer は `ssmix2_storage` の inbound_token
  (`Integrations::Receipt::EventsController#authorize_bridge!` と同じ照合を
  `Integrations::Ssmix2::BaseController` に)。Materializer を回し、pending のメッセージを **id 昇順**で
  `leased` にして返す(lease 5 分で pending に戻る)。

  ```json
  { "enabled": true,
    "storage": { "root_path": "\\\\nas\\ssmix2\\2219999998", "facility_id": "2219999998" },
    "messages": [
      { "id": 12, "patient_id": "0001234", "service_date": "20261104", "data_kind": "OMP-01",
        "order_no": "000000000000045", "process": "INS", "department_code": "01",
        "transaction_at": "20261104103012345", "body_base64": "..." } ] }
  ```

  施設設定が無効なら `{ "enabled": false, "messages": [] }`。
- `POST /integrations/ssmix2/messages/ack` `{ "written": [12, 13], "failed": [{ "id": 14, "error": "..." }] }`
  — written / failed に更新。failed は `attempts` を見て pending に戻すか諦める。
- `GET /integrations/ssmix2/status` — ログイン認証(`UserAuthentication` のみの BaseController。
  `Integrations::Receipt::BaseController` は継承しない)。施設設定画面が表示に使う:
  `{ pending, failed, written_today, warnings_today, last_written_at, last_polled_at, recent_failures: [...] }`。
  `last_polled_at` はプロセス内に置く。

## 7. エージェント(`fhir-client-agent`)のアダプタ `ssmix2-storage`

既存の「1 プロセス 1 連携」を保ち、SS-MIX2 用に **2 つ目のエージェントプロセス**を起動する
(日レセ連携と独立に止めたり動かしたりできる)。

- `internal/config/config.go`: `AdapterSsmix2Storage = "ssmix2-storage"`。`Config.Ssmix2` に
  `MessagesURL`(`KARTE_SSMIX2_URL`、必須)、`PollInterval`(`SSMIX2_POLL_INTERVAL`、既定 10s)、
  `AllowedRoot`(`SSMIX2_ALLOWED_ROOT`、任意。指定時はサーバーから来た `root_path` がこの下に無ければ拒否)。
  `Load` の必須項目をアダプタごとに分ける(`KARTE_EVENTS_URL` は orca-push のときだけ必須、
  トークンは共通の `KARTE_INBOUND_TOKEN`)。`config_test.go` の `TestLoadRejects` もアダプタ別に。
  `.env.example` / `dist/.env.example` に項目を足す。
- `main.go`: `buildAdapter` に 1 分岐。`deliver.New` は `cfg.EventsURL != ""` のときだけ作る。
- `internal/agent/agent.go`: `a.deliverer` を触る 4 箇所(Run の goroutine・stopped ログ・emit・Status)に
  nil ガード。`Status` に `Written` を足す。
- `internal/adapter/ssmix2/`(新規)
  - `adapter.go`: `Run(ctx, emit, ready)` は起動直後と `PollInterval` ごとに `GET messages`。
    2xx を受けたら enabled に関わらず `ready()`(以後 /healthz が 200)。`enabled: false` なら待つだけ。
    HTTP 失敗はエラーで返し、`agent.Agent` の再接続バックオフに任せる。
  - `storage.go`: 書き込み規則(ガイドライン 2.2 / 3.1.2 / 3.1.4(3))。
    - フォルダ `root / pid[0:3] / pid[3:6] / pid / (service_date | "-") / data_kind` を `MkdirAll`。
    - ファイル名 `pid_date_kind_orderNo_transactionAt_dept_flag`(拡張子なし)。各項目に `_` を含まないこと、
      `filepath.Clean` 後も root 配下であることを検証(`..` や絶対パスの混入を拒否)。
    - **冪等性**: 書こうとしているファイル名(フラグを除く)が既に存在すれば何もせず成功扱い
      (ack の失敗で同じ id が再配布されたとき、自分を `_2` に落とさない)。
    - INS: 同じ `pid_date_kind_orderNo_` で始まり末尾 `_1` のファイルを `_2` に rename し、新ファイルを `_1` で書く。
    - DEL: 末尾 `_1` と `_2` を `_0` に rename し、取消電文を `_0` で書く。
    - 書き込みは `.tmp` に書いて rename(`deliver.spool` と同じ)。同じ名前が衝突したら +1 ms。
    - 配列順に **逐次**処理し(並列化しない。同じオーダーの INS → DEL の順を守る)、結果をまとめて `POST ack`。
  - `storage_test.go`: 一時ディレクトリで INS → INS(履歴 2)→ DEL(0)の遷移、再配布の冪等性、
    `_` 混入の拒否、root 外の拒否。`adapter_test.go`: httptest で poll → write → ack。
- 配置
  - `deploy/fhir-client-agent.service` の `ReadWritePaths` に出力先を足す(`ProtectSystem=strict` では書けない)。
  - `deploy/docker-compose.yml` と fhir-client 側 `docker-compose.yml` に 2 つ目のサービス `agent-ssmix2`
    (profile `agent`、`AGENT_ADAPTER=ssmix2-storage`、`KARTE_SSMIX2_URL=http://backend:3001/integrations/ssmix2/messages`、
    出力先を `./backend/tmp/ssmix2:/ssmix2` に bind mount)。トークンは `.env` の `SSMIX2_INBOUND_TOKEN`。
  - Windows 機で動かすときは `root_path` に UNC か `D:\ssmix2` を書く(解釈するのはエージェント)。
  - README の「対応している連携」「設定」に追記。

## 8. 画面

- `frontend/src/api/adminClient.ts` の `FacilitySettings` / `FacilitySettingsPayload` に `ssmix2` を足す。
  型と既定値は `frontend/src/fhir/ssmix2Helpers.ts`(`Ssmix2Settings`、`DEFAULT_SSMIX2`)。
- `frontend/src/pages/FacilitySettingsPage.tsx` の `FACILITY_SECTIONS` に
  `{ key: "ssmix2", label: "SS-MIX2 標準化ストレージ" }`。項目は出力する / 出力先 / 医療施設 ID /
  患者 ID の桁数 / 送信アプリケーション名の 5 つ(説明文は置かない。必要なラベルは HelpTip)。
  保存時の妥当性は「有効なら出力先と医療施設 ID(10 桁)が必須」。
- 項目の下に状態(未出力・失敗・本日の出力・落とした字の件数・最終出力・最終ポーリング)を小さく出し、
  失敗の先頭数件を一覧に出す(`useSsmix2Status`、`GET /integrations/ssmix2/status`、画面を開いて
  いるときだけ 30 秒ごと)。トークンは「外部システム連携」の該当行で発行する(リンクのみ)。

## 9. 決め事と、その理由

- **修正は INS、取消は DEL。** 仕様書 2.1.5 の「削除 + 新規」ではなく「新しい内容のみ」を送る。
  受け側(エージェント)が同じオーダ No の有効ファイルを過去履歴(2)に改名するので、修正の履歴が残り、
  検査結果の訂正報告と同じ扱いになる。
- **診療日はガイドライン表 3.1-1 に従う。** オーダーは ORC-9(オーダーした日)。処方・注射の服用開始日
  を診療日にする許容規定は使わない(1 オーダーに複数の開始日が混ざるため)。患者基本・病名・
  アレルギーは `-`。病名とアレルギーは患者の全件を 1 ファイルにする(ガイドライン 3.1.2(2))。
- **外来受付(ADT-12)は Appointment の checked-in で起こす。** 外来 Encounter は診察開始で建つので
  受付ではない。
- **ファイルの文字コードは CP50221。** ガイドライン 3.1.2(3)②の「JIS」に合わせつつ、CP932 系の字を
  落とさない。半角カナは標準で認められないので全角に寄せる。
- **オーダ No は backend の対応表で採番する。** オーダーヘッダーは数値の番号を持たず、15 桁前ゼロの
  要件(仕様書 ORC-2)と「修正・取消で同じ番号」の要件を FHIR id では満たせない。
- **状態をテーブルに持つ。** レセコン連携の「送信履歴をテーブルに持たない」方針と違うのは、
  この出力が「書けたか」を backend しか知らず、エージェントは院内にあって再送の判断材料を持たないため。
  テーブルは短期の受け渡し(14 日)に限り、長期の記録は標準化ストレージそのもの。
- **読み取りを節約する。** 1 poll 5 transaction・`_id` と `_include` のまとめ読み・短命キャッシュ・
  429 は次回へ。上流のレート制限は backend のトークン単位で、帳票・レセコン送信と共有。
- **Location のコード。** 病棟・病室・ベッドの Location はコード identifier を持たないので PV1-3 には
  id(または name)を使う。コードが要る施設は Location に identifier を足す(将来)。

## 9.5 エージェント停止時の挙動

診療データの書き込みはエージェントに依存しない。中継は上流 FHIR へ書けたら `ssmix2_transactions`
に 1 行 INSERT するだけで、エージェントと通信しないので、停止中も登録・更新は普通に成功する。

**停止中**

- 行は `pending` のまま溜まる。purge の対象は `done` と `written` だけなので、停止が長くても消えない。
- 施設設定画面の状態は「未出力 n 件」が増え「最終ポーリング」が古いまま止まるので、停止に気づける。

**復帰後**

- 最初のポーリングから、backend が pending を古い順に 5 件ずつ HL7 に起こして返す。エージェントは
  id 昇順に逐次書くので、同じオーダーの「登録 → 取消」は `_1` → `_0` の順で再現される。
- ファイル名のトランザクション日時は組み立てた時刻になる。ガイドライン表 3.1-3 は、過去分を
  一括作成する場合は作成した日時を発生順の昇順で付けるとしており、これに沿う。診療日フォルダは
  オーダー日・採取日なので停止の影響を受けない。
- 書いている途中で再び落ちた場合は `leased` が 5 分で `pending` に戻って再配布される。エージェントは
  「同じファイル名(フラグ除く)が既にあれば何もしない」ので、二重に書いたり履歴をずらしたりしない。

**制約**

- 本体のリソース(処方の内容など)は記録した要求の内容で組むが、患者・入院・医師などの周辺情報は
  組み立て時点の上流の状態で補う。長く止めたあとに流すと、その間に変わった患者情報が過去の
  メッセージの PID に入る。
- 病名・アレルギーは患者の全件を 1 ファイルにするので、停止中に同じ患者を 3 回触ると同じ内容の
  PPR が 3 件できる(最新の有効 1 件、残りは過去履歴 2)。Materializer で同じ患者・同じ種別の
  pending を 1 件にまとめることで抑えられる(第 1 段階では行わない)。
- 大量の未出力を抱えて復帰すると、ポーリングごとに上流を読むため、レート制限の予算を帳票・
  レセコン送信と分け合う。1 poll 5 件とキャッシュで抑えるが、復帰直後の負荷として意識する。

## 10. 実装順

1. 施設設定 `ssmix2` + 外部システム定義 `ssmix2_storage` + 画面の設定項目。
2. `ssmix2_transactions` と Recorder、中継と FhirStore のフック。
3. HL7 共通部品(Builder / Types / Context / Codes / OrderNumber)+ ADT^A08 + Materializer + エージェント向け API。
   ここで端から端まで 1 本通す。
4. エージェントのアダプタ、compose の `agent-ssmix2`、開発環境で `backend/tmp/ssmix2` にファイルができることを確認。
5. 残りの第 1 段階の builder(入退院・転棟・外来受付、A60、PPR、RDE 処方・注射、OML、OUL)。
6. 状態 API と画面の状態表示、docs(`features/facility.md`・`features/admin-integration.md`・`development.md`)。
7. 第 2 段階(RAS / OMD / OMG / OMI / ORU / A14 / A16 / A54、トランザクションストレージ)。

## 11. 検証

```bash
# backend
docker compose exec -e RAILS_ENV=test -e ADMIN_TOKEN= backend bundle exec rspec \
  spec/services/ssmix2 spec/requests/integrations/ssmix2_messages_spec.rb spec/requests/facility_settings_spec.rb
# エージェント
cd ../fhir-client-agent && make test
# frontend
docker compose exec frontend npx tsc -b && docker compose exec frontend npm run lint
```

builder ごとの spec は FHIR の fixture(`spec/fixtures/ssmix2/`)→ 期待する電文の比較で、仕様書付録 1 の
サンプルに近い形にする。OUL^R22 を既存の `LabImport::Hl7Parser` で読み戻す往復テストは、同パーサーの
受理条件(JAHIS 前提)を確認してから入れる。

通し(開発環境):

1. 施設設定で出力を有効にし、出力先 `/ssmix2/2219999998`、医療施設 ID `2219999998` を保存。
   外部システム連携で `ssmix2_storage` のトークンを発行し `.env` の `SSMIX2_INBOUND_TOKEN` に入れる。
2. `docker compose --profile agent up -d --build agent-ssmix2`。
3. テスト太郎の患者情報を更新 → 処方を登録 → 取消。`backend/tmp/ssmix2/2219999998/000/000/0000001/-/ADT-00/` に
   `_1`、`…/20261104/OMP-01/` に `_1` → 取消後に `_0`(改名)と新しい `_0` ができることを確認。
4. ファイルを `iconv -f CP50221 -t UTF-8` で開き、付録 1 と見比べる(MSH-9 / PID-3 の桁 / ORC-2 の 15 桁 /
   TQ1-3 の JAMISDP01 / RXE-2 の HOT9)。
5. 施設設定画面の状態が「未出力 0・最終出力 日時」になること。エージェントを止めて書いた分が
   「未出力 n」になり、再起動で消えること。
6. 出力を無効にして書いても `ssmix2_transactions` が増えないこと。
