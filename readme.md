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
  表示・登録・編集・削除がタブ内で完結します。テーブル(`components/*Table.tsx`)は `onView` / `onEdit` を
  受け取り、ページ遷移せずタブ内で表示を切り替えます。内容表示は `components/*DetailPanel.tsx`、
  検査結果タブにはさらに「時系列表示」(`components/LabResultTimelinePanel.tsx`)も置いてあります。
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
- **プロブレムリスト(POMR)**: カルテタブの上に常時表示する横帯です(`components/KarteProblemList.tsx`)。
  問題志向型医療記録の「プロブレムリスト」にあたり、プロブレムと保険病名は同じ `Condition` の
  `category`(`problem-list-item` / `encounter-diagnosis`)で区分します。`category` の無い既存データは
  保険病名として扱い(移行不要)、編集保存された時点で明示的な区分が付きます。プロブレム番号(#1, #2...)は
  アプリローカル拡張 `http://fhir-client.local/StructureDefinition/problem-number` に永続化します
  (表示順から動的に採番すると削除や日付修正で番号がずれ、過去の記録が指すプロブレムが変わってしまうため)。
  登録・編集は「病名」タブの区分ラジオで行います。プロブレムの絞り込みは上流が `category` 検索を
  サポートしない可能性があるため、全件取得してクライアント側で振り分けます(`splitConditions`)。
  取得は `-onset-date` 順ですが、帯とフォームの候補は常に**番号順**に並べ替えます(番号を永続化して
  いるのに表示が発症日順では番号の意味が薄れるため)。番号の無い旧データは末尾に回します。
  継続(active)以外のプロブレムは既定で畳み、「解決済み N 件を表示」で開きます(帯の幅を継続中の
  プロブレムに使うため。開閉状態は localStorage に保存)。ただし選択中のプロブレムは、畳んだ状態でも
  タイムラインの減光の理由が分かるように残します。
- **診療記録とプロブレムの紐付け**: POMR は「各 Problem に対して SOAP 形式で経過を記録する」ため、
  紐付けはセクション単位ではなく**診療記録 1 件に対して 1 プロブレム**です(複数のプロブレムを扱う
  ときは記録を分けて登録します)。base `Composition` には対象疾患を表す要素が無い(`event` は検査・
  手術などの「行為」用)ので、アプリローカル拡張
  `http://fhir-client.local/StructureDefinition/clinical-note-problem` の `valueReference` に持たせます。
  `display` には保存時点の「#番号 名称」を入れておくので参照解決なしでも描画できます。表示側は現在の
  プロブレムから名称を引き直すため、病名を編集しても過去の記録に古い名前は残りません。参照先が
  削除済みの場合は保存済みの表示名 +「(削除済み)」でフォールバックします。プロブレムのチップを選ぶと、
  そのプロブレムに紐付かないカードを減光します(件数が減るとページングの判定が動くため、隠さず減光に
  とどめています)。プロブレムを選んだ状態で「診療記録」から新規登録すると、そのプロブレムを対象の
  初期値にします(登録ボタンを押した時点の選択を `KartePaneState` に載せるので、選択を変えただけで
  入力中のフォームが作り直されることはありません)。セクション単位で紐付けていた頃の `section.entry` も
  読めるようにしてあり、保存し直せば拡張へ正規化されます。
- **クエリキー**: `["<型>", "search", "karte", patientId]`。既存の作成・更新・削除が無効化する
  `["<型>", "search"]` の配下に置いてあるので、右ペインでの保存後にタイムラインが自動で再取得されます。
- **右ペインの登録・編集**: 登録・編集 UI はパネル(`components/*Panels.tsx`)に切り出してあります。
  各フォームは初期値をマウント時にしか読まないため、対象の切り替えでは `key` でフォームを作り直します。
- **カードの操作**: タイムラインの各カードはケバブメニューに「詳細表示」「FHIR JSON 表示」「編集」
  「削除」(テンプレートは「平文表示」も)を畳んでいます。DO(処方)と PDF(テンプレート)だけは 1 行に
  出します。詳細表示は各リソースの詳細パネルをモーダルで開くので、処方の添付文書(DI)リンクや
  テンプレートのシェーマ画像もここで参照できます。
- **URL パラメータ**: 「どのタブで何を開いているか」は URL に載せます(`src/karteUrl.ts`)。
  `?tab=<karte|condition|allergy|lab>`、`?view=<ID or timeline>`、`?detail=<種別>:<ID>` の 3 つで、
  個別の記録をリンクで共有でき、ブラウザの戻るも画面内の操作に効きます。詳細モーダルはタイムラインの
  読み込み位置に依存しないよう ID から引き直し、別患者の ID を指す URL では内容を出しません。
  入力途中のフォーム(タブの登録・編集、右ペイン)は URL に載せません(復元しても入力内容は戻らず、
  空のフォームだけが開く中途半端な状態になるため)。

診療記録・処方・病名・アレルギー・検査結果・テンプレート回答は、患者ごとの一覧ページを持たずカルテ画面で
扱います(患者一覧にあった「リスト」メニューと、その先の一覧・詳細・登録・編集ページは廃止しました)。

## 処方オーダー機能

カルテ画面の右ペイン「処方」から新規登録し、タイムラインのカードから表示(詳細モーダル)・編集・削除・DO
を行います。編集・削除も登録と同様に transaction Bundle で行い、`ServiceRequest`・`MedicationRequest`を
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

## 注射オーダー機能

カルテ画面の右ペイン「注射」から新規登録し、処方と同じくタイムラインのカードから
表示(詳細モーダル)・編集・削除・DO を行います(JAHIS注射データ交換規約 Ver.2.2 /
JP Core の `JP_MedicationRequest_Injection` プロファイルを参考にした表現)。

- **リソースの持ち方**: 処方と同一(1注射 = `ServiceRequest` + 薬剤数分の `MedicationRequest`、
  RP = 同じルートから同時に投与する薬剤のまとまり(混注)、登録・更新・削除は transaction Bundle)。
  実装は `frontend/src/fhir/injectionHelpers.ts`。
- **処方との判別**: `ServiceRequest.category` にローカルのオーダー種別
  (`http://fhir-client.local/CodeSystem/order-type` = `injection`)を付与します。カルテの
  タイムラインは処方と同じ `ServiceRequest` 検索(1本のページング)で取得し、この category で
  処方カード/注射カードに振り分けます(処方の `ServiceRequest` はオーダー種別を持たない)。
- **入外区分・注射区分**: `category` にはオーダー種別に続けてこの2つも入れます。入外区分
  (入院/外来)は処方と同じコードシステム(`.../prescription-setting`)を共用し、注射区分は
  選択肢が処方と異なるため専用のコードシステム(`.../injection-category`)にしています
  (入院→定時/臨時/緊急、外来→外来)。category は 3 要素になるので、読み出しは処方
  (添字で引く)と違い system で引きます。
- **用法**: JP Core の `JP_MedicationDosage_Injection` に寄せて `dosageInstruction` に持ちます。
  - 用法種別(点滴/ワンショット): 対応する標準コード表が無いためローカル拡張
    (`http://fhir-client.local/StructureDefinition/injection-usage-type`)
  - 投与経路: `route`。JP Core の `route-codes`(HL7 Table 0162 ベース。IV/IM/SC など)
  - 投与部位: `site`。JAMI標準用法規格 表13 外用部位コード(`urn:oid:1.2.392.200250.2.2.20.32`。
    SS-MIX2 でも利用されるコード表)
  - 手技: `method`。JAMI詳細用法コード(`urn:oid:1.2.392.200250.2.2.20.40`)の注射手技(30〜3Z)。
    投与経路から手技が一意に決まるもの(筋肉内→筋肉内注射、皮下→皮下注射、皮内→皮内注射、
    動脈内→動脈注射、髄腔内→脳脊髄腔注射、腹腔内→腹腔内注射)は経路の選択時に自動で入れます。
    静脈内だけは末梢の静脈注射(30)と中心静脈注射(31)のどちらもありうるので自動選択しません。
    経路を選び直したときは、前の経路に固有だった手技は経路と食い違うので落とします
  - ライン: JP Core の `JP_MedicationDosage_Line` 拡張。コードは公式表が無いためローカル定義
    (末梢/中心静脈 × 本管/側管)
  - 投与速度: `doseAndRate.rateQuantity`(mL/h、UCUM)。点滴のときのみ入力(下記の自動計算あり)
  - 開始時刻: `timing.event`(複数可)。入力は時刻(HH:mm)のみで、日付は注射日を使う。
    FHIR の dateTime は時刻を持つならタイムゾーンが必須なので、実行環境のオフセットを付けて
    `2026-08-04T10:00:00+09:00` の形で保存する
  - 投与量: `doseAndRate.doseQuantity`(処方の用量と同じ持ち方)
- **医薬品検索**: 処方と同じ医薬品検索モーダルを剤形区分 4(注射薬)で初期絞り込みして使います
  (`/master/medicines` に `dosage_form` パラメータを追加)。
- **総投与量と投与速度の自動計算**: 投与量は薬価算定単位(袋・管・瓶…)で入力するため、
  投与量換算マスタ(`master_medicine_dose_conversions` の `from_unit = mL` の行。
  1[薬価算定単位] = `factor` [mL])を掛けて RP 内の薬剤を mL に揃え、合計を **総投与量**として
  常時表示します(ワンショットでも表示)。点滴では **投与時間**(30分〜24時間)を選ぶと
  `総投与量 ÷ 投与時間` を投与速度(mL/h)として自動計算し、その間は投与速度が読み取り専用に
  なります。投与時間を「指定なし」に戻すと計算値を初期値として直接入力に切り替わります。
  保存するのは計算結果の投与速度だけで、投与時間は FHIR に持たせません(編集時は直接入力に戻る)。
  mL 換算行を持たない医薬品(粉末バイアル等、容量がマスタに無いもの)は合計から除外し、
  「N件はmL換算できないため含みません」と件数を添えます(注射薬 4176 件のうち mL 換算を
  持つのは 2569 件。輸液バッグは 583 件中 545 件と、量を占めるものは概ね揃っています)。
  RP 内の医薬品はまとめて引くため、`/master/medicine_dose_conversions` の `medicine_code` は
  カンマ区切りの複数指定に対応し、`from_unit` での絞り込みも追加しています。
- **用法種別の自動入力**: 医薬品を選ぶと、包装(薬価算定単位)から点滴/ワンショットを推定して
  用法種別に入れます(`frontend/src/fhir/usageMapping.ts` の `presetInjectionUsageType`)。
  点滴かワンショットかは本来オーダーの指示であって医薬品の属性ではないため確定はできませんが、
  包装は強い手がかりになります(注射薬 4176 件で確認: アンプル(管)に 100mL 以上は 0 件、
  バッグ(袋)は 95% が 100mL 以上)。判定は上から順に、名称に「点滴」→ 点滴 / 袋 → 点滴 /
  キット(名称に「シリンジ」を含むものを除く)→ 点滴 / 瓶かつ注射容量 100mL 以上(輸液ボトル)
  → 点滴 / 管・筒・シリンジのキット → ワンショット / それ以外(主に粉末バイアル)は空。
  これで約 73% に既定値が入り、残りはユーザーが選びます。
  判定は RP 単位で行い、混注は「輸液 + アンプル」の構成になるので **RP 内に点滴の薬剤が
  1 つでもあれば点滴**とします。用法種別を手で選んだ RP は、以降医薬品を変えても上書きしません。
  点滴になったときは投与経路の既定として静脈内(`IV`)を入れます(自動判定・手動選択のどちらでも)。
  投与経路が選択済みなら上書きしないので、手で選んだ経路が医薬品の入れ替えで戻ることはありません。
- テンプレートへの一括入力(`%prescriptions`)は最新の「処方」を対象とし、注射オーダーは
  対象外です(検索結果から category で除外)。

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

- 押すと backend の `GET /wakeup` をポーリングします（最大 4 分、5 秒間隔）。
  リクエストが backend に届くこと自体が backend の起動トリガーです。
- 上流 fhir-server を起こすのは **ブラウザ** です。`/wakeup` が返す `upstream_probe_url`
  （`FHIR_SERVER_BASE_URL` + `/up`）を、フロントが `mode: "no-cors"` で直接叩きます
  （同時 1 本、最大 60 秒）。backend から叩いても上流は起きません（後述）。
- `/wakeup` 自体は上流の `/up` を 5 秒だけ叩き、その瞬間の可否
  （`{"backend":"ready","upstream":"ready"|"waking","upstream_probe_url":"…"}`）を返す
  判定専用です。待ち切らないのは、長時間ぶら下がるとゲートウェイのタイムアウトに
  当たるためです。
- ボタンの表示は「backend 起動中…」→（backend から応答が返ったら）「FHIR サーバー起動中…」
  と進み、両方起きると「起動しました」になって数秒後に元へ戻ります。

`/wakeup` は静的サイト側の rewrite（`render.yaml`）と dev サーバーの proxy（`vite.config.ts`）
で backend に転送しています。

### なぜ上流はブラウザから起こすのか

Render 上のサービスから `*.onrender.com` を叩くと内部経路に落ちるらしく、スピンダウン中の
インスタンスの起動トリガーになりません。本番で実測したところ、上流がコールドの間 backend
からのプローブは `open_timeout`（2 秒）にも達せず即失敗し（`/wakeup` 全体が 0〜1 秒で応答）、
2 分叩き続けても上流は寝たままでした。一方、外部クライアント（ブラウザや手元の curl）から
同じ URL を叩くとゲートウェイがリクエストを保留して起動が走り、~45 秒で 200 を返すように
なります。この非対称性が「起こすのはブラウザ、判定は backend」という分担の理由です。

なお `/wakeup` は上流を起こさずに状態だけ観測できるので、切り分けにも使えます。

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
