# fhir-client

FHIR サーバー(`../fhir-server`)に対する CRUD を仲介する、Rails 製バックエンドプロキシと React 製フロントエンドの構成です。

## 構成

```
fhir-client/
├── backend/    # Rails 7 API-only。/fhir/* を FHIR サーバーへ中継するプロキシ + /master/* マスタデータAPI (port 3001)
└── frontend/   # Vite + React + TypeScript。Patient の登録/更新/削除/一覧/検索 UI、マスタ取込 UI (port 5173)
```

- FHIR リソースは backend の DB に永続化しません(常に FHIR サーバーへ中継)。マスタデータ(後述)と帳票レイアウト(後述)のみ backend 自身の DB に永続化します。
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

fhir-server の Rails は開発環境のデフォルトで `ActionDispatch::HostAuthorization` が有効なため、`Host: host.docker.internal:3000` を許可外ホストとして 403 で拒否します。そこで backend の `FhirGateway` は `FHIR_SERVER_HOST_HEADER`(既定 `localhost:3000`)を使い、実際の接続先は `host.docker.internal` のままアップストリームに許可される `Host` ヘッダーを送出します。別サーバーに向ける際、そのサーバーの HostAuthorization 設定次第では `FHIR_SERVER_HOST_HEADER` の調整や空値化が必要です。
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

## カルテ画面

患者一覧の「カルテ」ボタンから患者ごとのカルテ(`/patients/:id/karte`)を開きます。左ペインで登録済みの
診療情報を参照し、右ペインで登録・編集する 2 ペイン構成です(この画面だけ `#root` の幅制限を外すため、
`KartePage` が `body.karte-wide` を付け外しします)。

- **左ペインのタブ**: 「カルテ」「病名」「アレルギー」「検査結果」。病名・アレルギー・検査結果は一覧・
  表示・登録・編集・削除がタブ内で完結します(既存の一覧・詳細ページへは遷移しません)。テーブルは既存
  コンポーネントに任意の `onView` / `onEdit` を渡して再利用しており、未指定なら従来どおりページ遷移
  します。内容表示は詳細ページと同じ UI(`components/*DetailPanel.tsx`)で、検査結果タブにはさらに
  「時系列表示」(`components/LabResultTimelinePanel.tsx`)も置いてあります。
- **カルテタブ**: 診療記録(`Composition`)・処方(`ServiceRequest` + `MedicationRequest`)・単独登録の
  テンプレート回答(`QuestionnaireResponse`)を診療日ごとにまとめた時系列表示です。診療記録のセクションから
  参照されている回答は記録カードの本文として描画済みなので、単独カードには出しません。カードは高さを
  制限して折りたたみ、溢れる場合だけ「続きを表示」を出します。
- **無限スクロール**: 3 リソースをそれぞれ `_count=20` のオフセットページングで読み(`useKarte*Infinite`)、
  表示側(`fhir/karteTimeline.ts`)がマージします。まだ次ページがあるリソースの「読み込み済みで最も古い
  診療日」を安全カットオフとし、それより新しい診療日のグループだけを描画します(後からグループが歯抜けで
  増えるのを防ぐため、カットオフ当日も出しません)。末尾のセンチネルが見えている間、カットオフを押し
  下げているリソースだけ次ページを読みます。
- **診療日パネル**: データが存在する診療日をツリー表示し(既定は閉じた状態)、クリックでタイムラインの
  該当位置までスクロールします。
- **クエリキー**: `["<型>", "search", "karte", patientId]`。既存の作成・更新・削除が無効化する
  `["<型>", "search"]` の配下に置いてあるので、右ペインでの保存後にタイムラインが自動で再取得されます。
- **右ペインの再利用**: 登録・編集 UI は既存ページと共通のパネル(`components/*Panels.tsx`)です。既存の
  `/patients/:id/clinical-notes/new` などのページも同じパネルを使い、保存後の遷移だけをページ側が担います。
  各フォームは初期値をマウント時にしか読まないため、対象の切り替えでは `key` でフォームを作り直します。

「診療情報」メニューからの従来の一覧・登録動線は当面そのまま残します(将来的にカルテ画面へ統合予定)。

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

## シェーマ画像（テンプレートへの画像添付と描き込み）

テンプレート(`Questionnaire`)の各項目に画像を1枚添付でき、回答(`QuestionnaireResponse`)ではその画像に
ペイントツールで描き込めます。画像本体は `Binary` リソースに置き、項目からは extension の
`valueAttachment.url`(`Binary/<id>`)で参照します。

- **extension**: テンプレート側は標準の
  `http://hl7.org/fhir/StructureDefinition/questionnaire-itemMedia`、回答側の描き込み画像は
  ローカル定義の `http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image`。
  描き込みは元画像を書き換えず、合成 PNG を別の `Binary` として保存します。
- **保存は transaction Bundle**: 画像と本体リソースを**1回の `POST /fhir`** で atomic に保存します
  (画像エントリの `fullUrl`(`urn:uuid:...`)を `valueAttachment.url` に入れ、上流が実 ID に解決)。
  更新時は本体を `PUT` + `ifMatch` にするので、**412 で弾かれた場合は画像も保存されません**
  = 参照されない孤児 `Binary` が生まれません。
- **旧 Binary は削除しません**: 画像の差し替えや描き込みのやり直しで参照が外れた `Binary` は残します。
  リソースの旧バージョン(`_history` / vread)がその画像を参照しているため、消すと過去の記録が壊れます
  (容量よりも履歴保全を優先する方針)。
- backend の `/fhir` プロキシは `ALLOWED_RESOURCE_TYPES` に `Binary` を追加しています。画像の表示は
  `Accept: image/*` を付けた `GET /fhir/Binary/<id>` で生バイトを取得します(上流が非 FHIR な Accept に
  対して `contentType` 付きの実体を返す挙動を利用)。

## テンプレートカテゴリ

テンプレート(`Questionnaire`)を分類し、テンプレート選択のプルダウンで「カテゴリ → テンプレート」と
辿れるようにします。カテゴリは任意で、未設定のテンプレートはプルダウンの先頭階層(カテゴリと同じ層)に
並びます。

- **カテゴリの管理**: テンプレート一覧の「カテゴリ管理」ボタンから、追加・改名・並べ替え・削除を行います
  (backend DB の `questionnaire_categories`。FHIR リソースではありません)。並び順がプルダウンの表示順です。
- **テンプレートへの割り当て**: テンプレート編集画面の「カテゴリ」で選びます。保持先は Questionnaire の
  extension `http://fhir-client.local/StructureDefinition/questionnaire-template-category` の `valueCoding`
  (`code` = カテゴリの UUID、`display` = 設定時のカテゴリ名)。テンプレート本体は上流 FHIR サーバー、
  カテゴリマスタは backend DB と保存先が別々なので、backend からテンプレートを参照する構造にはしていません。
- **マスタに無い code の扱い**: カテゴリを削除した後や、別環境からインポートしたテンプレートのように
  マスタに該当 code が無い場合は、extension の `display` を見出しにしたグループとして登録済みカテゴリの
  後ろに表示します(テンプレート側の設定を勝手に落とさないため)。表示名はマスタがあればマスタ側を優先するので、
  カテゴリを改名してもテンプレートの再保存は不要です。
- **選択プルダウン**: 「テンプレート回答の登録」(ページ / カルテ右ペイン)と診療記録の「テンプレート記載」
  モーダルで共通コンポーネント(`frontend/src/components/TemplateSelect.tsx`)を使います。

## テンプレートのエクスポート / インポート

テンプレート(`Questionnaire`)を単一の JSON ファイルとして書き出し、別環境(開発→本番など)へ
取り込めます。テンプレート一覧の行メニュー「エクスポート」でダウンロード、一覧上部の
「インポート」ボタンでファイルを選択して取り込みます。

- **自己完結なファイル**: シェーマ画像は `Binary/<id>` 参照のままでは移行先で辿れないため、
  エクスポート時に `valueAttachment.data`(base64)として埋め込みます。サーバー固有の `id` /
  `meta.versionId` / `meta.lastUpdated` は含めません(`meta.profile` は保持)。
- **インポートは新規作成と同じ経路**: ファイルを編集フォームの中間表現に変換して検証
  (JASPEHR 制約)した上で、画像 `Binary` と本体を 1 つの transaction Bundle で保存、という
  新規作成と同じ流れで取り込みます。canonical(url + version)の一意性は上流 fhir-server の
  バリデーション + DB 制約が保証し、同じ url + version のテンプレートが既にあると 422 エラーに
  なります(取り込みたい場合は既存側を削除するか、ファイルの `url` / `version` を変更してください)。
- エディタが扱わない要素・拡張はインポート時に失われます(本アプリで作成したテンプレートの
  移行を前提とします)。

## 帳票PDF出力（QuestionnaireResponse の ThinReports 帳票）

テンプレートの回答(`QuestionnaireResponse`)を、あらかじめ登録した帳票レイアウトに流し込んで
PDF 出力できます。レイアウトは [ThinReports Basic Editor](https://github.com/thinreports/thinreports-basic-editor)
で作成した `.tlf` ファイルを管理画面 `/report-layouts` からアップロードし、テンプレートの
canonical(`url|version`)に紐付けます(backend DB の `report_layouts` に保存)。

- **PDF 生成は backend**(`thinreports` gem、純 Ruby・IPA フォント同梱)。上流アクセスは
  QR の read と、batch Bundle(元 Questionnaire 検索 + Patient + シェーマ画像 Binary ×N)の
  計 2 往復で組み立てます。
- **エンドポイント**: `GET /reports/questionnaire_responses/:id/pdf`(inline 表示)、
  `GET /reports/layouts?canonical=...`(登録有無の照会。テンプレート表示画面の「PDF」ボタンの
  表示判定に使用)。レイアウト未登録のテンプレートではボタンが無効になります。
- **レイアウト管理 API**: `/admin/report_layouts`(CRUD。`ADMIN_TOKEN` 設定時は他の管理APIと
  同じ認証・CSRF が必要)。

### プレースホルダー規約(レイアウト側アイテム ID)

Basic Editor のアイテム ID は「先頭英数字 + 英数字・アンダースコア」しか使えないため、
linkId の記号を変換して対応付けます。

| 出力したい内容 | アイテム ID | 種類 |
|---|---|---|
| 項目の回答値 | linkId の記号(`-.!#%/:;?@~` 等)を 1 文字ずつ `_` に置換した ID。先頭が英数字でない場合は `x` を前置(例: `body/temp` → `body_temp`) | text-block |
| 繰り返しグループ n 回目(n≥2)の回答 | `<ID>_2`, `<ID>_3`, ...(出現順。レイアウトに置いた個数を超えた分は出力されない) | text-block |
| シェーマ描き込み画像 | `<ID>_img`(n 回目は `<ID>_img_2`, ...) | image-block |
| 患者: 氏名 / カナ / 患者番号 / 生年月日 / 年齢(記入日時点) / 性別 | `pt_name` / `pt_kana` / `pt_id` / `pt_birthdate` / `pt_age` / `pt_gender` | text-block |
| 回答: タイトル / ステータス / 記入日時 / 記入者 / 保険医療機関番号 / ID | `qr_title` / `qr_status` / `qr_authored` / `qr_author` / `qr_institution` / `qr_id` | text-block |

- 値の整形は平文表示と同じ(choice は display 優先、複数回答は `、` 連結、単位付与)。日付は
  `YYYY/MM/DD`、日時は JST の `YYYY/MM/DD HH:MM`。
- **未回答の項目は空文字**になります(text-block のデザイン時初期値は残りません)。レイアウトに
  無いプレースホルダーは黙って捨てられ、逆にレイアウト独自の text-block(linkId 由来でない ID)は
  触りません。
- 変換の結果 2 つの linkId が同じ ID に潰れる場合(例: `a-b` と `a.b`)は生成時に 422 で拒否します。
  **帳票化するテンプレートの linkId は英数字とアンダースコアのみを推奨**します。
- 予約 ID(`pt_*` / `qr_*`)は linkId 由来の値より優先されます。
- **各テンプレートで使えるアイテム ID の一覧は、管理画面 `/report-layouts` の登録フォームで
  テンプレートを選択すると表示されます**(変換済み ID・単位・繰り返しの有無・ID 衝突の警告つき。
  コピーボタンで Basic Editor へ貼り付けられます)。

### マッピング定義(チェックマーク・丸囲みの表示切替、独自 ID への出力)

ID 規約だけでは表現できない帳票 --- choice 回答の code に応じてチェックマーク(✓ の text)や
丸囲み(ellipse)を出し分ける紙様式の再現、既存レイアウトの独自アイテム ID への出力 --- は、
レイアウト登録時に**マッピング定義**(JSON 配列)を併せて登録することで対応できます
(管理画面 `/report-layouts` のフォーム、または API の `mapping` パラメータ)。

ルールは 1 要素 1 件で、次の 4 形式があります:

```jsonc
[
  // 回答値を任意 ID の text-block へ出力(対象が image-block なら描き込み画像を出力)
  { "linkId": "item-1", "tlfId": "answer_1" },
  // answerCoding.code が一致する回答があればアイテム(text/ellipse 等)を表示
  { "linkId": "item-2", "code": "01", "show": ["check_1", "circle_1"] },
  // 回答が 1 つでもあれば表示(code 省略時と同義)
  { "linkId": "item-2", "answered": true, "show": ["check_any"] },
  // 予約プレースホルダー(pt_* / qr_*)の値を別 ID の text-block にも出力
  { "meta": "pt_name", "tlfId": "patient_name" }
]
```

- `show` に指定したアイテムは、**どのルールの条件も満たさなければ強制的に非表示**になります
  (レイアウト側の display 設定に依らず、回答だけで出力が確定します)。チェックボックス
  (複数回答)は複数の code ルールがそれぞれ独立に評価されます。
- マッピングの値出力先も未回答時は空文字になります(デザイン時初期値は残りません)。
  レイアウトに存在しない ID を参照するルールは黙って無視されます。
- 繰り返しグループは非対応です(値は最後の出現で上書き、show は全出現の OR)。
- マッピングは ID 規約と併用できます。規約どおりの ID とマッピングの両方がある場合は両方に
  出力され、予約 ID への直接出力は従来どおり機能します。
- 記入例: 歯科疾患管理計画書のマッピング定義が
  [`docs/report-mappings/shikan-01.mapping.json`](docs/report-mappings/shikan-01.mapping.json)
  にあります。

## 医療機関（Organization）

ヘッダーの「管理 > 医療機関」（`/organizations`）で、上流 FHIR サーバーの Organization を
一覧・登録・編集・削除できます。JP Core の `JP_Organization` プロファイルを想定した項目構成です。

| 画面項目 | FHIR 要素 |
|---|---|
| 医療機関名（必須） | `name` |
| 保険医療機関番号 | `identifier`（system は `http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no` 固定。JP_Organization の `medicalInstitutionCode` スライス） |
| 種別 | `type`（`http://terminology.hl7.org/CodeSystem/organization-type`。binding は example） |
| 有効 | `active` |
| 電話番号 / FAX | `telecom`（`system=phone` / `system=fax`） |
| 郵便番号 / 所在地 | `address[0].postalCode` / `address[0].text` |

- 上流の検証は org-1 制約（`identifier` か `name` の少なくとも一方）のみのため、番号を持たない
  施設も登録できます。番号を入力した場合だけ 10 桁（都道府県2桁 + 点数表1桁 + 医療機関コード7桁）の
  書式を画面側で検証します。
- 検索は医療機関名（部分一致）と保険医療機関番号。更新は他画面と同じく `If-Match` による楽観ロックです。
- 他の識別子体系（例: `…/mhlw/IdSystem/medicalInstitutionCode10`）で登録済みのデータも一覧・編集で
  読めますが、保存すると上記のプロファイル準拠の system に書き換わります。
- 上流 FHIR サーバーを直接操作するため、backend の管理API（`ADMIN_TOKEN`）の対象外です
  （マスタ取込・帳票レイアウトと同じ扱い）。

### テンプレートへの一括入力

登録した医療機関は、テンプレート回答フォームから選んで項目に流し込めます（診療情報提供書の
紹介先・紹介元など）。テンプレート編集画面の**拡張設定**で、短文入力・複数行テキストの項目に
**「医療機関の項目」** を設定すると、その項目を含むグループの枠内に「医療機関を選択」ボタンが出ます
（医療従事者の選択ボタンと横に並びます）。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-organization-field
valueCode     : name | institutionNumber | addressFull | address | postalCode | phone | fax
```

| 「医療機関の項目」 | 入る値 |
|---|---|
| 名称 | `name` |
| 保険医療機関番号 | `identifier`（保険医療機関番号） |
| 郵便番号+所在地 | `〒{postalCode} {address.text}`（郵便番号未登録なら所在地のみ） |
| 所在地 / 郵便番号 | `address[0].text` / `address[0].postalCode` |
| 電話番号 / ＦＡＸ | `telecom` の `phone` / `fax` |

- ボタンは **グループ単位**（そのグループ直下の医療機関項目だけを埋める）。紹介先・紹介元のように
  グループが分かれていれば、それぞれ別の医療機関を選べます。繰り返しグループはインスタンスごとに選べます。
- 同じ項目に「医療機関の項目」と「医療従事者の項目」の両方は設定できません（どちらのボタンで入った値か
  分からなくなるため、保存時の検査で弾きます）。
- **選んだ内容で常に同期**します。医療機関側に登録が無い項目（例: FAX 未登録）は空になります。
  A病院→B病院と選び直したときに A の FAX が残る取り違えを防ぐためで、入力済みの欄を上書きするときは
  確認ダイアログが出ます。医療機関項目に指定していない欄（診療科名・担当医師名など）は手入力のまま残ります。
- 保存時の検査で、医療機関の項目は「短文入力・複数行テキスト」「グループの直下」に限り、
  計算式・正規表現制約との併用は弾きます（前者は式の評価結果で上書きされ、後者は流し込んだ値が
  制約に合わずに保存できなくなるため）。
- JASPEHR は `item.type = "reference"` を禁止しているため、**選択結果は文字列としてコピーされるだけ**で、
  「どの Organization を選んだか」は回答に保存されません。後から機械的に辿りたい場合は、
  保険医療機関番号の項目（必要なら hidden）を用意してください。
- 回答の内容表示（読み取り専用）ではボタンは出ません。テンプレートのプレビュー画面では動かして確認できます。
- 自院のように毎回同じ医療機関が入る欄は、選択ボタンではなく
  [ログイン中の医療従事者からの自動入力](#ログイン中の医療従事者からの自動入力)を設定できます
  （ログイン中の医療従事者の所属医療機関が入ります）。

## 医療従事者（Practitioner）

ヘッダーの「管理 > 医療従事者」（`/practitioners`）で、上流 FHIR サーバーの Practitioner を
一覧・登録・編集・削除できます。JP Core の `JP_Practitioner` プロファイルを想定した項目構成です。

| 画面項目 | FHIR 要素 |
|---|---|
| 氏名（漢字・必須） / 氏名（カナ） | `name`（`iso21090-EN-representation` が `IDE` / `SYL`。患者と同じ表現） |
| 医籍登録番号 | `qualification`（`identifier.system` は `http://jpfhir.jp/fhir/core/mhlw/IdSystem/medicalRegistrationNumber`、`code` は `JP_MedicalLicenseCertificate_CS|medical-registration`） |
| 性別 / 生年月日 | `gender` / `birthDate` |
| 有効 | `active` |
| 電話番号 / メールアドレス | `telecom`（`system=phone` / `system=email`） |
| 職種 / 所属医療機関 | 別リソース `PractitionerRole` の `code` / `organization`（下記） |

- JP Core 上、Practitioner に必須項目はありません（`gender` / `birthDate` は値がある場合だけ書式検証）。
  画面では氏名（漢字）の姓・名いずれかを必須にしています。
- 医籍登録番号は JP Core が指定する置き場所どおり `qualification` にのみ書きます。上流の `identifier`
  検索は `qualification[].identifier` も索引するため、番号での検索はそのまま効きます（読み出しは
  `qualification` を優先し、他システム由来のデータのためにトップレベル `identifier` もフォールバックで見ます）。
- 検索は氏名（漢字・カナの部分一致）と医籍登録番号。更新は他画面と同じく `If-Match` による楽観ロックです。
- 上流 FHIR サーバーを直接操作するため、backend の管理API（`ADMIN_TOKEN`）の対象外です。

### 職種・所属医療機関（PractitionerRole）

FHIR では職種・所属は Practitioner ではなく `PractitionerRole` に持ちます。画面では医療従事者フォームの
「職種・所属」欄として一体で扱い、**1 人につき 1 件**だけ登録できます（兼務は表現できません）。

- 職種は `PractitionerRole.code`。コードは HL7 の `http://terminology.hl7.org/CodeSystem/practitioner-role`
  （医師 `doctor` / 歯科医師 `dentist` / 薬剤師 `pharmacist` / 看護師 `nurse` / 理学療法士 `physio` /
  言語聴覚士 `speech` / 研究者 `researcher` / 教員 `teacher`）。JP_PractitionerRole の binding は
  `JP_PractitionerRole_VS` への **preferred** なので、上流はコード値を検証しません。
- 所属医療機関は `PractitionerRole.organization`。登録済みの医療機関を検索モーダル（医療機関画面と同じ
  もの）から選び、`reference` に加えて `display` にも名称を入れます（一覧で Organization を引き直さずに
  表示するため）。
- 保存は **Practitioner と PractitionerRole を 1 つの transaction Bundle** で行います（新規作成時は
  `urn:uuid` を介して参照を解決）。職種・所属を両方空にして保存すると PractitionerRole は削除され、
  医療従事者を削除するとぶら下がる PractitionerRole も同じ Bundle で削除されます。
- 一覧は `_revinclude=PractitionerRole:practitioner` で職種・所属を一緒に取得して表示します。
- 診療科（`specialty`）や勤務期間（`period`）は未対応です。

### テンプレートへの一括入力

医療機関と同じ仕組みで、テンプレート編集画面の**拡張設定**から短文入力・複数行テキストの項目に
**「医療従事者の項目」** を設定すると、そのグループの枠内に「医療従事者を選択」ボタンが出ます。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-practitioner-field
valueCode     : name | kana | medicalRegistrationNumber | role | organizationName | phone | email
```

- 職種・所属医療機関の値は選択した医療従事者の `PractitionerRole` から取ります。
- モーダルでは **氏名・職種・所属医療機関**で絞り込めます（職種・所属はプルダウン。所属は登録済みの
  医療機関の一覧から選ぶ）。職種・所属で絞る場合は
  `PractitionerRole?role=…&organization=…&_include=PractitionerRole:practitioner` を引きます。
- **同じグループで医療機関が選ばれていれば、所属医療機関のプルダウンの初期値**になります
  （そのまま開けば所属者だけが表示され、「すべて」に戻せば全件表示）。保存済み回答を開き直した直後は
  医療機関の id が分からないため、医療機関名の項目の値から名称の完全一致で引き当てます
  （同名が複数あるときは初期値になりません）。
- テンプレート側の **「職種の初期値」**（`…/questionnaire-practitioner-role-default`）を設定しておくと、
  職種プルダウンの初期値になります（例: 担当医師名の欄なら「医師」）。
- 職種・所属で絞り込んでいる間の氏名絞り込みは、1 段チェーン検索
  `practitioner.name:contains=…`（カナを含む全 name 表現に一致）で上流に渡します。
  ページングも他の検索と同様に効きます。

### ログイン中の医療従事者からの自動入力

「医療機関の項目」「医療従事者の項目」を設定した項目には、同じ**拡張設定**で
**「ログイン中の医療従事者（の所属医療機関）から自動入力」** を指定できます。設定すると、選択ボタンを
押さなくても**テンプレート登録画面を開いた時点**でログイン中のユーザーの値が入ります
（記載医師名・所属医療機関名など、毎回同じ値を手入力していた欄向け）。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-login-autofill
valueBoolean  : true
```

- 入る値の種類は選択ボタンと同じ（`…/questionnaire-organization-field` /
  `…/questionnaire-practitioner-field` の `valueCode`）で、この拡張は「選択を待たずに入れる」かどうかだけを
  表します。どちらの項目も設定していない項目には指定できません（保存時の検査で弾きます）。
- 材料は**ログインアカウントに紐付く Practitioner**、その `PractitionerRole`（職種）、
  `PractitionerRole.organization` を辿った **Organization** です。所属医療機関が未登録なら医療機関の項目は
  入りません。**administrator でのログイン・認証なしモード**では紐付く Practitioner が無いため何も入りません。
- 入るのは**新規登録時（とプレビュー）だけ**です。保存済み回答の編集画面では、保存された値をそのまま
  復元します（後からログインユーザーの値で書き換わることはありません）。
- 入った後は手入力・選択ボタンで上書きできます。逆に、初期値・初期値式と同じ項目に設定した場合は
  自動入力の値が優先されます（ログイン側に登録が無い＝値が空のときだけ初期値が残ります）。
- 繰り返しグループでは 1 件目のインスタンスにのみ入ります（初期値・初期値式と同じ扱い）。
- 記入者名（登録情報の欄）は拡張設定とは無関係に、常にログイン中の医療従事者の氏名で初期表示されます。

## 管理画面（接続設定 / OAuth クライアント）

`/settings`（接続設定）と `/oauth-clients`（OAuth クライアント）は管理用の画面です。

### アクセス制限

環境変数 `ADMIN_TOKEN` を設定すると、両画面はログインを要求します。入力したパスフレーズは
backend が照合し、成功すると **HttpOnly のセッション Cookie**（`path=/admin`、SameSite=Lax、12時間）を
張ります。トークンをブラウザ側（sessionStorage 等）に保持しないため、XSS でパスフレーズ自体を
持ち去られることがありません。非 GET リクエストには `X-CSRF-Token`（ログイン応答で渡される値）が必要です。

`ADMIN_TOKEN` 未設定なら従来どおり認証なしで通ります（`docker compose up` だけで触れる）。
ただし本番環境では、`ADMIN_TOKEN` 未設定のとき OAuth クライアント管理の API は 503 で閉じます。
`Authorization: Bearer` / `X-Admin-Token` ヘッダーによる直叩き（curl・CI）も従来どおり使えます
（Cookie を使わないので CSRF トークンは不要）。

`ADMIN_TOKEN` をローテーションすると既存のセッションはすべて失効します。

### OAuth クライアント管理

fhir-server 側の OAuth クライアント（SMART Backend Services / 対話型 launch）を一覧・登録・削除できます。
これまで fhir-server の rake タスクでしか登録できず、削除の手段がありませんでした。

**fhir-server 側に管理 API `/admin/oauth_clients` を追加してあります**（`FHIR_ADMIN_TOKEN` による共有トークン認証）。
fhir-server は CORS を意図的に無効にしているため、ブラウザから直接は叩けません。この backend が
`FhirAdminGateway` でサーバー間中継します（`FHIR_SERVER_HOST_HEADER` は引き続き HostAuthorization 対策として必要）。

使うには両側の設定が必要です:

1. fhir-server に `FHIR_ADMIN_TOKEN` を設定する（`openssl rand -hex 32`。未設定なら管理 API は 503）
2. fhir-client の `/settings` で「FHIR 管理トークン」に同じ値を入れて保存する
   （DB に暗号化して保存。`FHIR_ADMIN_TOKEN` 環境変数でも渡せますが、接続先を変えるたびに
   再デプロイが必要になるので画面からの設定を推奨）

`client_secret` は登録直後の一度だけ表示され、以後どのレスポンスにも現れません。削除は物理削除で、
発行済みのアクセストークン・リフレッシュトークン・認可コードも同時に失効します（件数が返ります）。

> 上流の管理トークンが誤っている場合、画面は 502「管理トークンを拒否されました」を表示します
> （401 をそのまま返すとログアウト扱いになってしまうため、意図的に読み替えています）。
> 上流がスリープ中の場合、初回の表示は最大 90 秒ほどかかることがあります。

## サーバーの休眠と「起こす」ボタン

Render 無料枠は約 15 分アクセスがないとスピンダウンし、次のリクエストで起動に 1 分前後
（backend + 上流 fhir-server で合わせて 1〜2 分）かかります。画面操作で待たされないよう、
ヘッダー右端に地味な「サーバー起動」ボタンを置いています。

- 押すと backend の `GET /wakeup` をポーリングします（最大 3 分、5 秒間隔）。
  リクエストが backend に届くこと自体が backend の起動トリガーです。
- `/wakeup` は上流 fhir-server（`FHIR_SERVER_BASE_URL` = `ysnr-fhir-server`）の `/up` を
  5 秒だけ叩いて起動のきっかけを与え、その瞬間の可否
  （`{"backend":"ready","upstream":"ready"|"waking"}`）を返します。Render は届いたリクエスト
  自体でスピンアップするので、応答を待ち切らなくても起動は始まります。待ち切らないのは、
  長時間ぶら下がるとゲートウェイのタイムアウトに当たるためです。
- ボタンの表示は「backend 起動中…」→（backend から応答が返ったら）「FHIR サーバー起動中…」
  と進み、両方起きると「起動しました」になって数秒後に元へ戻ります。

`/wakeup` は静的サイト側の rewrite（`render.yaml`）と dev サーバーの proxy（`vite.config.ts`）
で backend に転送しています。

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
- 医療機関(Organization)の登録・編集・削除・検索(名称部分一致)を Docker 環境の画面から確認。保険医療機関番号の 10 桁バリデーション、他体系の identifier で登録済みデータの表示も確認
- 医療従事者(Practitioner)の登録・編集・削除・検索(氏名部分一致・医籍登録番号)を Docker 環境の画面から確認。氏名(漢字)必須のバリデーション、`qualification` と `identifier` の両方への医籍登録番号の保存、`If-Match` の 412 も確認
- 職種・所属医療機関(PractitionerRole)を医療従事者と同じ transaction Bundle で保存・更新・削除できることを画面から確認(新規作成時の `urn:uuid` 参照解決、職種のみ/所属のみの登録、両方を空にしたときの PractitionerRole 削除、医療従事者削除時の連鎖削除、一覧の `_revinclude` 表示)
- 医療従事者のテンプレートへの一括入力: 職種・所属医療機関のプルダウンで絞り込めること、テンプレートの職種の初期値と選択済み医療機関がそれぞれの初期値になること、「すべて」に戻すと絞り込みが外れること、選択した医療従事者の氏名が項目に入ることを画面から確認
- 医療機関のテンプレートへの一括入力: テンプレート編集での設定の往復(保存→再編集)、診療情報提供書の紹介先・紹介元で別々の医療機関を選択、FAX 未登録の施設への選び直しで欄が空になること、繰り返しグループでのインスタンスごとの選択とインスタンス削除時の繰り上がり、PDF への反映を確認

## 未検証

- ブラウザでの実際の画面操作(このセットアップ作業ではヘッドレスブラウザ/スクリーンショットツールを使用していないため、UI の見た目・操作感は上記の起動手順に沿って手動で確認してください)
