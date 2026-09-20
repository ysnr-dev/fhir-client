# レセコン連携

会計送信(カルテ → レセコン)で日レセの API 仕様に対して足りていない部分は
`docs/receipt-billing-backlog.md` にまとめてある。

## この設計が守っていること

**カルテはレセコンの製品を知らない。** 特定のレセコンの語彙 — 日レセなら
保険組合せ番号・Medical_Class・Api_Result・電文の項目名 — は
`Integrations::Orca` の内側で完結し、そこから外へは中立の値オブジェクトしか出ない。
他社レセコンを足すときに書くのはアダプタ 1 つで、画面もユースケースも変わらない。

**状態はレセコンとカルテ本体にしか置かない。** 送信履歴をテーブルに持つと、
そのテーブルが「患者番号」「送信済みかどうか」の置き場になり、医事課がレセコンの
画面で触った瞬間に食い違う。記録は記録に徹してログへ出し、判断はそのつど
レセコンと上流 FHIR に訊く。

**取り込みは差分ではなく全体を揃える。** レセコンの通知は「何かが変わった」としか
言わないし、未接続中の通知は再配達されない。差分を追わず「今あるものを全部書いて、
消えたものを失効にする」形にすれば、通知を取りこぼしたあとに流しても必ず追いつく。

## 向きと責務

| | 向き | 置き場 |
|---|---|---|
| 患者基本情報 | レセコン → カルテ | 上流 FHIR `Patient` |
| 保険・公費 | レセコン → カルテ | 上流 FHIR `Coverage`(JP_Coverage) |
| 受付 | レセコン → カルテ | 上流 FHIR `Appointment`(当日受付と同じ形) |
| 病名 | カルテ → レセコン | レセコン側 |
| 診療行為(会計) | カルテ → レセコン | レセコン側 |

カルテ側の患者登録・受付は塞がない。時間外・レセコン停止時・入院など、レセコンを
通らない受付の経路を潰さないため。同じ患者番号ならレセコン取り込み時に合流する。

## 構成

```
app/services/integrations/
  external_systems.rb  管理画面に並ぶ外部システムの定義(区画・項目・製品)
  event_log.rb       JSON Lines のログ(log/integrations/<system_key>.log)
  fhir_store.rb      上流 FHIR の読み書き。検索は Prefer: handling=strict
  code_mapper.rb     コード対応表の正引き・逆引き
  receipt_computer.rb        ポート。定義(external_systems.rb)で製品を解決する
  receipt_computer/
    records.rb                 中立の値オブジェクト
    patient_importer.rb        PatientRecord  → Patient upsert
    coverage_importer.rb       CoverageRecord → Coverage upsert / 失効
    reception_importer.rb      ReceptionEvent → Appointment upsert / 取消
    event_handler.rb           通知の振り分けと患者単位の直列化
    billing_claim_builder.rb   上流から 1 日ぶんの診療行為を集める(中立)
    diagnosis_collector.rb     その日に有効な保険病名を集める(中立)
    billing_sender.rb          会計送信。プレビュー・送信・取消
  orca/
    adapter.rb        ポートの実装。ここから下が日レセの世界
    gateway.rb xml.rb api_result.rb text.rb
    patient_api.rb system_api.rb medical_api.rb disease_api.rb
    medical_message.rb disease_message.rb insurance_codes.rb
```

アダプタが実装するもの:

```ruby
self.code_kinds / self.option_fields     # 画面が汎用に描くための宣言
test_connection
code_candidates(kind)
fetch_patient(patient_number)            # => PatientSnapshot
billing_status(patient_number:, date:, department_code:)
send_billing(claim)                      # => Result
cancel_billing(patient_number:, date:, department_code:)
send_diagnoses(patient_number:, date:, department_code:, coverage_set_key:, diagnoses:)
```

レセプト電算コードは全国共通なので、項目マスタからコードを引くところ
(`billing_claim_builder` / `order_catalog`)は中立側に置く。製品ごとの区分
(日レセの診療種別区分)を付けるのはアダプタの仕事。

## 通知の受け取り

```
レセコン ──WebSocket──> fhir-client-agent ──HTTP(Bearer)──> POST /integrations/receipt/events
```

エージェント(別リポジトリ `fhir-client-agent`、Go 製の単一バイナリ)は院内サーバーで常駐させる。backend は WebSocket も
製品ごとのイベント形式も知らない。中立ペイロードは 5 種類:

```json
{ "event_id": "uuid", "type": "patient.changed",
  "occurred_at": "2026-09-20T10:15:00+09:00", "patient_number": "00002" }

{ "event_id": "uuid", "type": "reception.created",
  "patient_number": "00002",
  "reception": { "key": "2026-09-20:00003", "date": "2026-09-20", "time": "10:16:00",
                 "department_code": "01", "physician_code": "10001",
                 "coverage_set_key": "0001" } }
```

`patient.changed` / `patient.deleted` / `reception.created` / `.updated` / `.canceled`。

**冪等性は identifier による条件付き更新で担保する。** 通知の uuid を台帳に持たない
(持つとそれ自体が管理対象になる)。同じ通知が二度届いても結果は同じになる。
ただし同じ患者の通知が同時に走ると条件付き作成が二重に成立するので、
`pg_advisory_xact_lock` で患者番号ごとに直列化する。

## Coverage の形

保険と公費はそれぞれ 1 つの Coverage にする(JP Core は 1 リソース 1 保険)。
「同時に使う保険の組」= 請求セットは `Coverage.class` に載せる。

```json
"class": [{ "type": { "coding": [{ "system": ".../coverage-class", "code": "billing-set" }] },
            "value": "0001", "name": "国保 30%" }]
```

`value` はレセコンが採番した**不透明なキー**で、カルテは中身を解釈しない。会計送信で
`coverage_set_key` として返すと、アダプタだけがそれを日レセの保険組合せ番号として使う。
こうすると FHIR に製品固有の番号が焼き付かない。

| JP_Coverage | 出どころ(日レセ) |
|---|---|
| `identifier` | `<NS>/coverage|<患者番号>:<external_key>`。条件付き更新のキー |
| `status` | `active`。取込結果から消えたら `cancelled` |
| `type` | `InsuranceProvider_Class` / `PublicInsurance_Class` |
| `extension` 記号/番号/枝番 | `HealthInsuredPerson_Symbol` / `_Number` / `_Branch_Number` |
| `subscriberId` | 公費の `PublicInsuredPerson_Number`(受給者番号) |
| `payor` | 保険者番号の論理参照。Organization は作らない |
| `period` | `Certificate_StartDate` / `_ExpiredDate` |
| `costToBeneficiary` | 外来負担割合(百分率) |

`external_key` は保険の内容から作るハッシュ。日レセは保険・公費に外部から引ける ID を
持たないため。証の内容が変われば別の保険として登録し直される(実際に別の資格なので正しい)。

## 決め事と、その理由

**患者番号の桁揃えは吸収する。** レセコンは 1009 の連番桁数でゼロ埋めし
(`00002`)、カルテは入力したまま持つ(`2`)。ゼロ埋めを外した形も同じ番号として
扱い、既にカルテに居る患者の番号は**書き換えない**。ここで振り直すと、カルテ側の
参照と検索が一斉にずれる。

**Medical_Uid は持たない。** 日レセは同じ患者・同じ日に 2 度目の登録を受け付けず
(`Api_Result=80`)、送り直しは置換(class=03)で Medical_Uid が要る。カルテ側に
控えを持たず、そのつど `tmedicalgetv2` で引き直す。登録が 1 往復増えるが、
医事課が日レセの画面で触ったときに食い違わない。
ただし仕様上、置換が使えるのは入院だけで、外来は削除しかできない
(`docs/receipt-billing-backlog.md` A-2)。

**受付取込で作るのは Appointment だけ。** 受付と診察開始は別物で、ここで Encounter を
作ると全員が受診済みに見える。Encounter は診察を始めたときにカルテ側で作る。
診察が始まっている受付はレセコン側で取り消されても触らない。

**上流の検索は strict で投げる。** 上流は既定で知らない検索条件を黙って無視して
全件返す。取り込み・取消の判断を検索結果に委ねているので、条件が効かなかったときは
全件が返るより失敗してほしい。

**受付時刻は Asia/Tokyo で読む。** アプリは UTC で動いているが、レセコンが返すのは
診療所の壁時計の時刻。ここを取り違えると 9 時間ずれた受付になる。

## 検証

```
# backend
docker compose exec backend env RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec

# エージェント(別リポジトリ)
cd ../fhir-client-agent && make test

# frontend
docker compose exec frontend npx tsc -b

# 取り込み(検証環境の日レセに患者 00002 が要る)
docker compose exec backend bin/rails runner \
  'puts Integrations::ReceiptComputer::EventHandler.new.import_patient("00002").inspect'

# 一括再同期(まず DRY_RUN で件数を見る)
docker compose exec -e DRY_RUN=true backend bin/rails integrations:receipt:resync
```

検証環境は別リポジトリ `weborca-dev`。PUSH は API と同じ :8000 で、オンプレ版は
認証が無い代わりに `X-GINBEE-TENANT-ID: 1` が要る。

エージェントと日レセは compose の profile(`agent` / `orca`)で切ってある。通しで動かすときは
fhir-client 側から両方まとめて起動する。

```
RECEIPT_INBOUND_TOKEN=<受信トークン> docker compose --profile agent --profile orca up -d --build
```

受信トークンは `cp .env.example .env` して書いておけば毎回渡さずに済む(`.env` は git 管理外)。

日レセは `weborca-dev` 側の compose と同じコンテナ名・同じボリュームを使うので、
向こうで起動していたら先に `cd ../weborca-dev && docker compose down` する
(`stop` だけではコンテナが残り、名前の衝突で起動できない)。
