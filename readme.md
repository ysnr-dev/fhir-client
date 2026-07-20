# fhir-client

FHIR サーバー(`../fhir-server`)に対する CRUD を仲介する、Rails 製バックエンドプロキシと React 製フロントエンドの構成です。

## 構成

```
fhir-client/
├── backend/    # Rails 7 API-only。/fhir/* を FHIR サーバーへ中継するプロキシ + /master/* マスタデータAPI (port 3001)
└── frontend/   # Vite + React + TypeScript。Patient の登録/更新/削除/一覧/検索 UI、マスタ取込 UI (port 5173)
```

- FHIR リソースは backend の DB に永続化しません(常に FHIR サーバーへ中継)。マスタデータ(後述)のみ backend 自身の DB に永続化します。
- フロントエンドは FHIR R4 の JSON をそのまま組み立て/解釈します(`@types/fhir` の `fhir4` 名前空間を使用)。
- 開発時、ブラウザ→フロントエンド(5173)は同一オリジンで、`/fhir/*` と `/master/*` は Vite の dev proxy が backend(3001)へ転送します。CORS 設定は不要です。

## 起動方法(Docker Compose、推奨)

fhir-server は**別リポジトリとして独立**しているため、先に起動しておきます。

```bash
cd ../fhir-server
docker compose up --build   # http://localhost:3000 で待ち受け
```

続いて fhir-client を起動します(db / backend / frontend の3コンテナ)。

```bash
cd fhir-client
docker compose up --build
```

- backend: `http://localhost:3001`(コンテナから `http://host.docker.internal:3000` 経由で fhir-server に接続。別サーバーに向けたい場合は `docker-compose.yml` の `FHIR_SERVER_BASE_URL` を変更)
- frontend: `http://localhost:5173/patients`
- db: `localhost:5434`(fhir-server の db の 5433、ローカル Homebrew Postgres の 5432 と衝突しないポート)

fhir-server の Rails は開発環境のデフォルトで `ActionDispatch::HostAuthorization` が有効なため、`Host: host.docker.internal:3000` を許可外ホストとして 403 で拒否します(fhir-server 自体は変更しない方針のため)。そこで backend の `FhirGateway` は `FHIR_SERVER_HOST_HEADER`(既定 `localhost:3000`)を使い、実際の接続先は `host.docker.internal` のままアップストリームに許可される `Host` ヘッダーを送出します。別サーバーに向ける際、そのサーバーの HostAuthorization 設定次第では `FHIR_SERVER_HOST_HEADER` の調整や空値化が必要です。
同様に fhir-client 自身の backend も frontend コンテナから `Host: backend:3001` で呼ばれるため、`backend/config/environments/development.rb` で `config.hosts << "backend"` を追加しています。

backend/frontend ともソースディレクトリをボリュームマウントしているため、コード変更は再ビルド不要で反映されます(Puma 再起動 / Vite HMR)。

初回起動時は `bin/docker-entrypoint.sh` が自動で `bin/rails db:prepare` を実行し、DB を作成します。

停止:

```bash
docker compose down          # コンテナ停止(DBデータは pg_data ボリュームに残る)
docker compose down -v       # DBデータも含めて削除
```

テスト実行(コンテナは `RAILS_ENV=development` で動いているため `-e RAILS_ENV=test` の指定が必要):

```bash
docker compose exec -e RAILS_ENV=test backend bundle exec rspec
```

## ローカル(rbenv/nodenv + Homebrew)での起動

Docker を使わない場合の手順です。

### 1. FHIR サーバー

```bash
cd ../fhir-server
export PATH="/usr/local/opt/postgresql@18/bin:$PATH"
bin/rails s
```

### 2. backend (プロキシ, port 3001)

```bash
cd backend
export PATH="/usr/local/opt/postgresql@18/bin:$PATH"
bin/rails s -p 3001
```

初回のみ: `bundle install && bin/rails db:create db:migrate`

接続先の FHIR サーバー URL は `backend/.env` の `FHIR_SERVER_BASE_URL` で切り替え可能です(デフォルト `http://localhost:3000`)。

### 3. frontend (port 5173)

```bash
cd frontend
npm install   # 初回のみ
npm run dev
```

## マスタデータAPI（処方オーダー基盤）

処方オーダー機能のための国内参照マスタ3種を管理する API です。**FHIR リソースではなく通常の
JSON REST**（snake_case、`OperationOutcome` は使わず `{error: ...}` / `{errors: [...]}` 形式）として
`/master` 配下に実装しています。データは fhir-server へは中継せず、**backend 自身の DB
(`master_*` テーブル)に永続化**します。

| マスタ | エンドポイント | ソースファイル形式 |
|---|---|---|
| HOTコード | `/master/hot_codes` | MEDIS HOT9マスタ（CSV, Shift_JIS） |
| 医薬品 | `/master/medicines` | 医薬品マスタ（CSV, Shift_JIS, ヘッダーなし） |
| 用法 | `/master/medicine_usages` | 電子処方箋用法マスタ（xlsx） |
| 薬効分類 | `/master/medicine_types` | 薬効分類番号(4桁)→名称。`db/seed_data/medicine_types.csv` を `db:seed` で投入（日本標準商品分類「87」由来） |

### 薬効分類（薬効検索）

薬効分類番号は **YJコード（`medicines.yakka_code`, 12桁）の上4桁**で、日本標準商品分類「87 医薬品」の細分類に対応する。
`master_medicine_types`（`code`=4桁, `name`=名称）がその名称マスタで、`db/seed_data/medicine_types.csv`（`code,name`, ヘッダー無し）を `bin/rails db:seed` で投入する。

医薬品検索(`GET /master/medicines`)は薬効での絞り込みに対応する:

- `yakko_code`（薬効分類番号の完全一致）/ `yakko_name`（薬効名の部分一致）で絞り込み
- レスポンス各件に `yakko_code`（YJ上4桁）と `yakko_name`（薬効分類名称）を付与

```bash
curl -G "http://localhost:3001/master/medicines" --data-urlencode "yakko_name=消化性潰瘍"
curl -G "http://localhost:3001/master/medicines" --data-urlencode "yakko_code=2325"
curl -G "http://localhost:3001/master/medicine_types" --data-urlencode "name=降圧"
```

以下、`{master}` は `hot_codes` / `medicines` / `medicine_usages` のいずれかに読み替えてください。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/master/{master}` | 検索（`{ total, page, per, items }`。`page`/`per`指定可、`per`上限100） |
| `GET` | `/master/{master}/:id` | 参照 |
| `POST` | `/master/{master}` | 作成 |
| `PATCH`/`PUT` | `/master/{master}/:id` | 更新 |
| `DELETE` | `/master/{master}/:id` | 削除（204） |
| `POST` | `/master/{master}/import` | ファイル一括インポート（**総洗い替え**：既存全件削除→全件挿入） |

### 一括インポート

フロントエンドの「マスタ取込」画面（`http://localhost:5173/master-import`）からローカルファイルを
アップロードするか、`multipart/form-data` の `file` パラメータで直接 API を呼び出します。
文字コード（Shift_JIS/CP932）やxlsxのシート構成はサーバー側で自動処理します。

```bash
curl -X POST http://localhost:3001/master/hot_codes/import \
  -F "file=@MEDIS20260630_HOT9.TXT"
# => {"imported": 38364}

curl -X POST http://localhost:3001/master/medicines/import \
  -F "file=@y_r07_ALL20260317.csv"
# => {"imported": 19337}

curl -X POST http://localhost:3001/master/medicine_usages/import \
  -F "file=@001056865.xlsx"
# => {"imported": 1803}
```

- **総洗い替え**: 1トランザクション内で既存データを全削除後、全件再挿入します。ファイルの一部行が
  不正（列数不一致）な場合は**インポート全体を中断**し、既存データは変更されません（422 + `{error: ...}`）。
- `file` 未指定の場合は 422。

### 検索例

```bash
curl -G "http://localhost:3001/master/medicines" --data-urlencode "name=ガスター" --data-urlencode "per=5"
curl -G "http://localhost:3001/master/hot_codes" --data-urlencode "sales_name=フローセン"
curl -G "http://localhost:3001/master/medicine_usages" --data-urlencode "usage_name=朝食"
```

### 注意点

- `hot_codes.hot_code` は**一意キーではありません**（MEDIS実データ上、同一HOTコードに異なる
  個別医薬品コード・販売名を持つ複数レコードが存在するため）。`medicines.medicine_code` /
  `medicine_usages.usage_code` は一意制約あり。
- 日付項目（`updated_on`, `changed_on` 等）は `"99999999"`（無期限）等の特殊値を含むため、
  すべて文字列（`YYYYMMDD`）で保持しています。

## 処方オーダー機能

患者一覧の「処方」リンクから患者ごとの処方一覧(`/patients/:id/prescriptions`)へ遷移し、新規処方の登録
(`.../prescriptions/new`)、登録済み処方の表示(`.../prescriptions/:srId`)、編集(`.../prescriptions/:srId/edit`)、
削除ができます。編集・削除も登録と同様に transaction Bundle で行い、`ServiceRequest`・`MedicationRequest`を
まとめて更新・削除します(フォーム上で削除された薬剤行は `DELETE` エントリとして送信されます)。

- **リソースの持ち方**: 1処方 = `ServiceRequest` 1リソース + 薬剤数分の `MedicationRequest`。
  fhir-server がトランザクション Bundle (`POST /`) に対応しているため、登録は **1回の transaction
  Bundle POST**（`ServiceRequest` → 各 `MedicationRequest` の順、`urn:uuid` で相互参照)で行い、
  一部が不正なら全体がロールバックされます。
- **SR→MRの紐づけ**: `MedicationRequest.basedOn` は fhir-server で検索できないため、代わりに
  `ServiceRequest.orderDetail[].extension`（ローカル定義の
  `http://fhir-client.local/StructureDefinition/prescription-medication-request`）に
  `valueReference` で各 `MedicationRequest` の `urn:uuid` を持たせています(Bundle 内での参照解決により
  実IDへ書き換わります)。処方詳細画面はこの extension から MedicationRequest の id を取り出し、並列 read
  で内容を取得します(`_id` のカンマ区切り検索に fhir-server が対応していないため)。
- **RP・医薬品**: 用法・医薬品はいずれもマスタデータAPI(後述)から検索して選択します。RP・医薬品行は
  フォーム上で動的に追加/削除でき、RP番号は自動連番です。用法の `basic_usage_category`（内服/頓服）に
  応じて「投与日数」または「投与回数」のいずれかを入力します。
- backend の `/fhir` プロキシは `ALLOWED_RESOURCE_TYPES` に `ServiceRequest` を追加し、
  `POST /fhir`(空パス)を transaction Bundle 中継用のルートとして扱います
  (`backend/app/controllers/fhir_proxy_controller.rb`)。

## テスト(ローカル)

```bash
cd backend
export PATH="/usr/local/opt/postgresql@18/bin:$PATH"
bundle exec rspec
```

## 動作確認済み

- `/fhir/metadata`, `/fhir/Patient` の GET/POST/PUT/DELETE、検索(name/gender/birthdate/identifier)、`_count`/`_offset` ページネーション
- Patient 作成時の identifier 必須バリデーション(422 が素通しされること)
- 楽観ロック: `If-Match` 不一致で 412 が返ること
- FHIR サーバー無応答時に backend が 502 + OperationOutcome を返すこと
- フロントエンドの本番ビルド(`npm run build`)と型チェック(`tsc -b`)
- Docker Compose での起動(db/backend/frontend)、backend→fhir-server(host.docker.internal経由)、frontend→backend(サービス名経由)の疎通
- マスタ3種のインポート(ローカル・Docker 双方で curl により確認。サンプルファイルで hot_codes=3件 / medicines=3件 / medicine_usages=1803件)、`file` 未指定 422、列数不一致 422(既存データ保持)

## 未検証

- ブラウザでの実際の画面操作(このセットアップ作業ではヘッドレスブラウザ/スクリーンショットツールを使用していないため、UI の見た目・操作感は上記の起動手順に沿って手動で確認してください)
