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

- **左ペインのタブ**: 「カルテ」「病名」「アレルギー」「経過表」「検査結果」「細菌検査」。
  病名・アレルギー・検査結果は一覧・
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
- **左ペイン(診療日 / 種別)**: 左端のペインは 2 つの探し方を切り替えて使います
  (`components/KarteSidePane.tsx`。モードは localStorage に保存。ペインは 160px しかないので、
  切替のラベルはスクロールバーが出ても表示切替アイコンが隠れない長さに保ちます)。
  - **診療日**: データが存在する診療日をツリー表示し(既定は閉じた状態)、クリックでタイムラインの
    該当位置までスクロールします。
  - **種別**: 情報の種別(診療記録・処方・注射・検体検査・細菌検査・放射線検査・生理検査・内視鏡・処置・テンプレート)を
    並べ、選ぶとタイムラインがその種別のカードだけになります。テンプレートは 1 種別しか無いので、
    展開してテンプレート名まで選べます(テンプレートカテゴリの見出し付き。一覧はテンプレート検索から
    作るので、タイムラインを読み進んでも選択肢は増減しません)。「社会歴」を選べば最新が先頭に来て、
    そのまま過去の回答も時系列で追えます。
  - 絞り込みの対象は URL の `?card=<種別>`(テンプレートを 1 つに絞るときは `?card=qr:<テンプレートの url>`)に
    載せるので共有・復元できます。**テンプレートはバージョンを見ず url で一致**させるため、
    テンプレートを改版しても過去の回答が絞り込みから外れません。
  - プロブレムの絞り込みと併用でき、両方選べば**両方を満たすカードだけ**が残ります。
  - **絞り込み中は必ず「種別」が表示されます**。診療日へ切り替えると絞り込みは解除され、
    絞り込み付きの URL で開いたときは(保存されたモードが診療日でも)種別が開きます。
    絞り込みの操作はこのペインだけで完結するので、タイムライン側には見出しを出しません
    (見えないところで絞り込みが効いたままにならないようにするため)。
- **プロブレムリスト(POMR)**: カルテタブの上に常時表示する横帯です(`components/KarteProblemList.tsx`)。
  問題志向型医療記録の「プロブレムリスト」にあたり、プロブレム・既往歴・保険病名は同じ `Condition` を
  `category` で区分します(下記「病名の区分」)。`category` の無い既存データは
  保険病名として扱い(移行不要)、編集保存された時点で明示的な区分が付きます。帯に出すのは
  プロブレムだけで、既往歴は出しません(現在の問題ではないため)。プロブレム番号(#1, #2...)は
  アプリローカル拡張 `http://fhir-client.local/StructureDefinition/problem-number` に永続化します
  (表示順から動的に採番すると削除や日付修正で番号がずれ、過去の記録が指すプロブレムが変わってしまうため)。
  登録・編集は「病名」タブの区分ラジオで行います。プロブレムの絞り込みは上流が `category` 検索を
  サポートしない可能性があるため、全件取得してクライアント側で振り分けます(`splitConditions`)。
  取得は `-onset-date` 順ですが、帯とフォームの候補は常に**番号順**に並べ替えます(番号を永続化して
  いるのに表示が発症日順では番号の意味が薄れるため)。番号の無い旧データは末尾に回します。
  継続(active)以外のプロブレムは既定で畳み、「解決済み N 件を表示」で開きます(帯の幅を継続中の
  プロブレムに使うため。開閉状態は localStorage に保存)。ただし選択中のプロブレムは、畳んだ状態でも
  タイムラインの減光・絞り込みの理由が分かるように残します。
- **プロブレム間の関連(統合・分割・親子)**: 症状名で立てたプロブレムが 1 つの診断にまとまったり
  (統合)、1 つが複数に分かれたり(分割)、下位のプロブレムがぶら下がったりします。「病名」タブの
  プロブレム編集で設定します。
  - **統合と分割は「引き継ぎ先」1 つで表します**(アプリローカル拡張
    `…/problem-succeeded-by`、0..*)。複数の旧プロブレムが同じ先を指せば統合、1 つが複数を指せば
    分割で、関係の向きが違うだけなので拡張を分けていません。引き継ぎ先を指定すると転帰を
    「中止」にして閉じ(画面の転帰欄も変わるので、閉じられたことが見えます)、帯では解決済みに
    畳まれて「→ #1 ２型糖尿病」のように行き先を併記します。
  - **下位プロブレム**は `…/problem-parent`(0..1)で親を指します。親子とも継続したまま併存し、
    帯では親の直後に破線のチップで並べます。
  - FHIR R4 には Condition 同士の型付き関連が無い(標準の `condition-related` 拡張は「関係がある」
    としか言えず統合と親子を区別できない)ため、プロブレム番号と同じくローカル拡張で持ちます。
  - **親を選んで絞り込むと、下位プロブレムに紐付く情報も含めて表示します**(合併症を含めた経過を
    1 つの軸で追えるようにするため)。サマリヘッダに「下位プロブレム N 件の記録も含めて表示して
    います」と出ます。減光も同じ範囲で効きます。参照が輪になっていても辿り直さないので止まります。
  - 親の候補からは自分自身と自分の配下を除きます(選ぶと参照が輪になるため)。
- **プロブレム単位の経過表示**: プロブレムを選んだときのタイムラインの見せ方は、帯の右端の
  ケバブメニューで「関連しない記録を減光」(既定)と「関連する記録のみ表示」を切り替えます
  (帯の行を増やさないためのケバブです。設定は localStorage に保存)。後者は POMR の
  「各 Problem の経過を縦に読む」読み方にあたり、絞り込み中はタイムラインの上に見出し
  (`components/KarteProblemSummary.tsx`)を出して、#番号・病名・発症日・転帰と、直近の記録の
  評価と計画(A/P)の抜粋を添えます(プロブレムリスト自体は「今どうなっているか」を持たないため)。
  絞り込みの対象は URL の `?problem=<Condition の id>` に載せるので共有・復元できます
  (減光だけの選択は一時的な状態なので載せません)。
  - **絞り込みはサーバー検索で行います**。4 系統の無限クエリにそれぞれ
    `Composition?entry=` / `ServiceRequest?reason-reference=` / `QuestionnaireResponse?problem=` /
    `Observation?problem=`
    を付け、対象の Condition id をクエリキーにも入れます(絞り込みごとに別のページング列に
    なるので、切り替えると先頭ページから読み直します)。親プロブレムを選んだときは下位
    プロブレムの id もカンマ区切りで並べます(参照検索のカンマは OR)。
  - 下位プロブレムを含めるにはプロブレム一覧が要るので、**その取得が終わるまで
    タイムラインの取得を始めません**(絞り込み前の並びが一瞬見えたり、直後に読み直しに
    なったりしないように)。
  - クライアント側に残る絞り込みは種別(`?card=`)だけで、こちらは
    `buildKarteTimeline` の**後**で行います(`filterKarteGroupsByCard`)。安全カットオフと
    次ページの要否は読み込み済みの全データで決まるので、件数が減ってもページングは
    壊れません。
- **バイタル**: 右ペインの「バイタル」から体温・血圧・脈拍・SpO2・呼吸数・身長・体重を 1 画面で
  入力します(`components/VitalForm.tsx`、組み立ては `fhir/vitalHelpers.ts`)。
  - **1 項目 = 1 Observation**(category `vital-signs`、コードは LOINC、単位は UCUM)。ただし
    **血圧だけは 85354-9 の Observation 1 件に収縮期(8480-6)と拡張期(8462-4)を component として
    入れます**。別々の Observation にすると「そのときの血圧」として組にして読めないためで、
    JP Core の `JP_Observation_BloodPressure` と同じ構造です。片方だけの入力は登録時に弾きます。
  - **BMI(39156-5)は身長・体重から自動計算**して一緒に残します。入力欄は持ちません(同じ測定の
    身長・体重から一意に決まる値なので、経過表で並べて追えるように保存しています)。
  - 空欄の項目は Observation を作りません(値 0 の Observation を残すと「測って 0 だった」と
    読めてしまうため)。
  - **1 回の測定は identifier(`http://fhir-client.local/vital-entry` + UUID)で束ねます**。
    タイムラインではこの単位で 1 枚のカードにし、編集・削除もまとめて行います。測定日時で
    束ねないのは、同じ時刻に別の担当者が入れた測定と混ざりうるためです。
  - 更新は「前回の測定を全部消して作り直す」方式です(入力欄を空にした項目の削除や血圧の追加で、
    項目と Observation の対応が崩れるため)。
  - 対象プロブレムはローカル拡張 `…/observation-problem` に持ちます(Observation には理由を表す
    標準要素が無いため)。上流には `Observation?problem=` を追加済みで、プロブレムの絞り込みにも
    乗ります。
  - タイムラインの取得では `derived-from:missing=true` を付けて、テンプレート回答から抽出した
    Observation を除きます(そちらは回答のカードとして既に出るため)。
- **経過表(フローシート)**: POMR 5 要素の 1 つで、「経過表」タブに出します
  (`components/VitalFlowsheetPanel.tsx`、組み立ては `buildVitalFlowsheet`)。カルテ以外のタブなので、
  上下分割にすると**上にカルテ、下に経過表**を並べて「SOAP を書きながら推移を見る」読み方ができます。
  - **列は測定 1 回**です(検査結果の時系列表示が「日付」を列にするのと違う点)。同じ日の朝夕の
    測定を 1 列に潰すと経過表として読めないため、ヘッダは日付の下に時刻を出します。
  - **行は測定項目**。入力欄と同じ順(血圧 → 体温 → … → 体重 → BMI)を先頭に置き、それ以外の
    `vital-signs` コードは登場順で後ろに並べます。
  - 対象は `category=vital-signs` の Observation すべてで、**テンプレート回答から抽出した値も
    含めます**(タイムラインと違い、値を時系列で読む画面なのでどの経路で作られたかは問いません)。
    検査値(`laboratory`)は合流させません。検査結果タブに表・グラフが揃っているためです。
  - 取得は検査結果の時系列表示と同じ流儀で、`_sort=-date` を「表示数 + 1 個目の測定日時が現れる」
    まで読み進めます(1 回の測定が 8 件前後の Observation に分かれるため、件数ではなく測定回数で
    打ち切ります)。
  - **読み取り専用**です。編集はカルテのバイタルカードから行います(編集の導線を 2 つ持つと
    同期の負債になるため)。
  - グラフは検査結果と同じ `LabTimelineChart` を再利用し、**血圧は収縮期・拡張期の 2 系列**に
    分けて描きます。横軸は測定日時なので、同じ日の朝夕が重なりません。
- **診療記録とプロブレムの紐付け**: POMR は「各 Problem に対して SOAP 形式で経過を記録する」ため、
  紐付けは**診療記録 1 件に対して 1 プロブレム**です(複数のプロブレムを扱うときは記録を分けて
  登録します)。**参考にしている C-CDA on FHIR の Progress Note には、S/O/A/P と並ぶ
  `problems_section`(LOINC 11450-4)が定義されている**ので、対象プロブレムはそのセクションを
  1 つ持たせて `section.entry` で `Condition` を参照します。ローカル拡張ではなく標準要素なので、
  絞り込みが **R4 標準の検索パラメータ `entry`** に乗ります(上流の標準外パラメータが 1 つ減ります)。
  セクションの `text` は entry から導出した要約なので `status` は `generated` です。
  なお `section.focus` は使いません。あれが表すのは「composition の subject ではない、subject に
  関連する人・物(配偶者・胎児・ドナー等)」で、記述の主題を表す要素ではないためです。
  `entry` の `display` には保存時点の「#番号 名称」を入れておくので参照解決なしでも描画できます。
  表示側は現在のプロブレムから名称を引き直すため、病名を編集しても過去の記録に古い名前は残りません。
  参照先が削除済みの場合は保存済みの表示名 +「(削除済み)」でフォールバックします。プロブレムのチップを
  選ぶと、そのプロブレムに紐付かないカードを減光します(件数が減るとページングの判定が動くため、隠さず
  減光にとどめています)。プロブレムを選んだ状態で「診療記録」から新規登録すると、そのプロブレムを対象の
  初期値にします(登録ボタンを押した時点の選択を `KartePaneState` に載せるので、選択を変えただけで
  入力中のフォームが作り直されることはありません)。プロブレムセクションは本文ではないので、編集欄・
  カード・詳細表示・一覧のセクション要約からは `noteBodySections` で除きます。
- **テンプレート回答とプロブレムの紐付け**: 単独登録のテンプレート回答(`QuestionnaireResponse`)も
  診療記録と同じく**回答 1 件に対して 1 プロブレム**を紐付けられます。ただし
  `QuestionnaireResponse` には診療記録の `problems_section` にあたる標準の受け皿が無いため、
  こちらはアプリローカル拡張
  `http://fhir-client.local/StructureDefinition/questionnaire-response-problem` の `valueReference`
  に持たせます(`display` の扱い・削除済みのフォールバックは診療記録と同じ)。初期計画(Dx/Rx/Ex)の
  ように「どのプロブレムに対する記載か」が要になるテンプレートを、診療記録に貼らず単独で残せる
  ようにするためです。プロブレムを選んだ状態で「テンプレート」から登録すればそのプロブレムが
  初期値になり、絞り込み表示にも乗ります。
- **クエリキー**: `["<型>", "search", "karte", patientId]`。既存の作成・更新・削除が無効化する
  `["<型>", "search"]` の配下に置いてあるので、右ペインでの保存後にタイムラインが自動で再取得されます。
- **右ペインの登録・編集**: 登録・編集 UI はパネル(`components/*Panels.tsx`)に切り出してあります。
  各フォームは初期値をマウント時にしか読まないため、対象の切り替えでは `key` でフォームを作り直します。
- **確定(署名)と変更履歴**: 診療記録のステータスを「確定」にして保存すると、**署名**として
  `Composition.attester` にログイン中の医療従事者を記録します(`mode` は `legal` = 内容に法的責任を
  負う者、`time` は確定日時)。ステータスだけでは「確定した」事実しか残らず、真正性の根拠に
  ならないためです。詳細表示に「確定者 児玉 義憲 (2026-08-15 07:48)」の形で出ます。
  - `attester` は 0..* ですが**最後に確定した 1 件だけ**を持ちます。過去の署名は版履歴に残るので
    二重に持たず、「今この記録に責任を負っているのは誰か」を一意に読めるようにするためです。
  - 確定済みの記録を修正すると `amended` になり、**署名も修正した本人に更新**します(作成者
    `author` は最初の記録者のまま)。医療従事者が紐付いていないアカウント(administrator 等)が
    修正した場合は、既存の署名をそのまま残します(空にすると誰も責任を負っていない確定記録に
    なってしまうため)。下書きに戻した場合は署名を外します。
  - **変更履歴**はカードのケバブ「変更履歴」から開きます。上流の `_history` で版の一覧を取り、
    版を選ぶとその時点の内容をそのまま表示します(現在の記録と同じ描画を使います)。版ごとに
    更新日時・ステータス・確定者が並ぶので、「いつ誰が何を直したか」を辿れます。
    上流・backend プロキシとも対応済みで、サーバー側の変更は不要です。
- **カードの操作**: タイムラインの各カードはケバブメニューに「詳細表示」「変更履歴」(診療記録のみ)「FHIR JSON 表示」「編集」
  「削除」(テンプレートは「平文表示」も)を畳んでいます。DO(処方)と PDF(テンプレート)だけは 1 行に
  出します。詳細表示は各リソースの詳細パネルをモーダルで開くので、処方の添付文書(DI)リンクや
  テンプレートのシェーマ画像もここで参照できます。
- **URL パラメータ**: 「どのタブで何を開いているか」は URL に載せます(`src/karteUrl.ts`)。
  `?tab=<karte|condition|allergy|lab>`、`?view=<ID or timeline>`、`?detail=<種別>:<ID>`、
  `?problem=<ID>`(プロブレムでの絞り込み)、`?card=<種別>`(情報の種別での絞り込み)の 5 つで、
  個別の記録をリンクで共有でき、ブラウザの戻るも画面内の操作に効きます。詳細モーダルはタイムラインの
  読み込み位置に依存しないよう ID から引き直し、別患者の ID を指す URL では内容を出しません。
  入力途中のフォーム(タブの登録・編集、右ペイン)は URL に載せません(復元しても入力内容は戻らず、
  空のフォームだけが開く中途半端な状態になるため)。

診療記録・処方・病名・アレルギー・検査結果・テンプレート回答は、患者ごとの一覧ページを持たずカルテ画面で
扱います(患者一覧にあった「リスト」メニューと、その先の一覧・詳細・登録・編集ページは廃止しました)。

### 日付未定オーダー

「依頼だけ立てて実施日は後で決める」オーダーを、種別に依存しない形で扱えるようにしてあります
(`fhir/karteTimeline.ts`)。今のところフォームで未定を許しているのは手術だけですが、他の種別で
開きたくなったらフォームの必須検証を外して `UNSCHEDULABLE_ORDER_TYPES` に足すだけです。

- **未定は値を入れないことで表します**(`occurrenceDateTime` を出さない)。予約値(`9999-12-31` など)は
  「この値は未定」という約束を全種別・全部門一覧・帳票が守り続ける必要があり、閉じ込め先が無くなるため
  採りません。上流は `:missing`・`$distinct-dates` の `undated` に対応済みです。
- **カードを置く診療日**は「実施予定日(`occurrence`)があればその日、無ければ、未定を許す種別なら
  『日付未定』、それ以外はオーダー日(`authoredOn`)」です(`orderCardDay`)。細菌検査は `occurrence` を
  書いていないので `authoredOn` に落ちます。処方・注射はそもそも実施予定日を持たず、入力した
  「処方日」「注射日」が `authoredOn` になります(オーダーした日を別に持ちません。この兼用が
  入院の定期処方や注射の連日オーダーで問題になる件は `docs/order-common-backlog.md` §1)。
- **「日付未定」は時系列の最上部**に出します(`KARTE_UNSCHEDULED_DAY` / `compareKarteDaysDesc`)。
  既にある「日付なし」(`day` が空文字、最下部)とは別概念で、あちらは日付を持たないリソース(データ不備)、
  こちらは予定がまだ決まっていない正常な状態です。表示名はどちらも `karteDayLabel` が返します。
- **先読み**: タイムラインのオーダーは `authoredOn` の降順でページングするので、日付未定のものと
  実施予定日が先のものは初期表示に出てきません。種別ではなく**状態で切った別クエリ**
  (`occurrence:missing=true` と `occurrence=gt{today}`、`useKartePendingOrders`)で全件先読みし、
  ページングの結果と `ServiceRequest.id` で寄せます。どちらも未処理の仕事なので件数は溜まりません。
- **診療日ペイン**の日付も同じ出どころに合わせてあります。`occurrence` でカードを出す種別は
  `$distinct-dates` を `date-param=occurrence` で当て、`authoredOn` 側のインデックスからは
  `category:not` で外します(両方で数えるとカードの無い日が並ぶため)。

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
- **期間・実施パターン(連日オーダー)**: 注射日(開始日)と終了日、実施パターン
  (**毎日 / N日ごと(隔日など) / 曜日指定**)を指定すると、該当する日ぶんを 1 日 1 オーダー
  (`ServiceRequest` + `MedicationRequest`)に展開し、1 つの transaction で登録します
  (一度に 14 件・期間 90 日まで。上限超過は打ち切らず入力エラーにします)。
  展開した各日は `requisition`(`.../Identifier/injection-series`、同じ uuid)で束ね、開始日を
  root 拡張 `.../StructureDefinition/injection-series-start`(valueDate)、実施パターンを
  `.../StructureDefinition/injection-series-schedule`(valueTiming。N日ごと=`period/periodUnit`、
  曜日=`dayOfWeek`、`boundsPeriod` に期間)に持ちます(毎日は拡張を付けず、無いものは毎日と読みます)。
  カードには「連日 N日目(開始日〜)」「隔日(開始日〜)」を添え、編集・削除では後続日があるとき
  「この日のみ / この日以降すべて」を選べます。方針の検討(オリジナルオーダー方式との比較)は
  `docs/injection-order-design.md`。
- **進捗と中止**: オーダーの `ServiceRequest` はそのままに、進捗を `Task`
  (`task-code|injection`、依頼済/受付済/払出済/実施済/中止)で持ちます。Task は最初の
  ステータス変更で作り、それまでは「Task が無い = 依頼済」として扱います。カルテのカードの
  ケバブから中止・中止取消ができ、連日オーダーでは「この日のみ / この日以降すべて」を選べます
  (実施済の注射は中止できません)。受付済・払出済・実施済へ進める導線(注射ワークリスト・
  払出・実施入力)は未実装です。詳細は `docs/injection-order-design.md` §5。
- **実施記録(施用)**: カードのケバブ「実施入力」から、施用の開始・終了時刻、実施者、結果
  (実施 / 途中で中止 / 実施せず)と理由、薬剤ごとの実施量を登録します。オーダーに無い薬剤も
  RP ごとに追加でき(依頼時と実施時で内容が変わることが多いため)、その `MedicationAdministration`
  は `request` を持たず、カードでは「(追加)」と印が付きます。輸血と同じく実施 1 回を
  `Procedure`(`category = order-type|injection`、`basedOn` = オーダー)のハブにし、薬剤ごとの
  `MedicationAdministration`(`partOf` = ハブ、`request` = その `MedicationRequest`)をぶら下げます。
  1 日に複数回の施用(開始時刻が複数)があるので、実施記録はオーダーに複数付き、予定回数に達した
  ときに Task を実施済にします。「実施取消」は記録をすべて消して Task を依頼済に戻します。
  詳細は `docs/injection-order-design.md` §6。
- **注射一覧(部門ワークリスト)と払出**: 部門業務メニューの「注射一覧」(`/injection-worklist`)で
  注射日 1 日ぶんを並べ、「受付」→「払出登録」で進めます。払出は薬剤ごとに `MedicationDispense`
  (`authorizingPrescription` = その `MedicationRequest`、数量の既定は投与量 × その日の施用回数、
  銘柄変更は `substitution.wasSubstituted`)を作り、払出済の Task と同じ transaction で書きます。
  疑義照会は `Task.note`。詳細は `docs/injection-order-design.md` §5.3。
- **帳票**: 注射一覧の「注射箋発行」(`GET /reports/injections/:order_id/pdf`、A5、注射指示票を兼ねる。
  発行が受付を兼ねる)と「注射ラベル発行」(`GET /reports/injection_labels/:order_id/pdf`、RP ごと 1 枚、
  60×40mm、患者番号バーコード)。処方箋と同じ帳票基盤(同梱 `.tlf`)で、プレースホルダーは
  `docs/report-mappings/injection-01.md`。
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

## 基礎データ（POMR の Data Base）のテンプレート

POMR は「基礎データから異常所見を抽出してプロブレムリストを立てる」構成なので、その入口にあたる
**社会歴・家族歴・システムレビュー(ROS)** をテンプレート(`Questionnaire`)として用意してあります
（[`docs/report-mappings/basic-data.md`](docs/report-mappings/basic-data.md)、
`social-01` / `family-01` / `ros-01` の 3 ファイル）。専用の構造化フォームを領域ごとに作らず
テンプレートで賄うことで、設問の追加・変更を画面から行えるようにしています。テンプレート一覧の
インポートから取り込み、カテゴリ「基礎データ」でまとめます。

- **社会歴**は JP Core の `JP_Observation_SocialHistory`（`JP_ObservationSocialHistoryCode_CS`）に
  設問を 1 対 1 で対応させ、各項目の `item.code` に持たせています（18 項目）。SDC の Observation
  抽出を実装すれば、この code がそのまま `Observation.code` になります（サーバー側の対応は不要。
  上流の JASPEHR プロファイルが `item.code` / `itemExtractionContext` を許容しています）。
  喫煙指数（ブリンクマン指数）は `calculatedExpression` による自動計算です。
- **既往歴はテンプレートではなく「病名」タブの区分**です（次節）。MEDIS 病名マスタのコードが要り、
  後からプロブレムへ昇格しうる情報なので、`Condition` 側に区分を足す方が安く、プロブレムリストとの
  連続性も保てるためです（同じ情報が 2 経路に増えるのを避けています）。
- 社会歴は「回答から Observation を生成する」を有効にしてあるので、回答を保存すると
  `category=social-history` の Observation が同時に作られます（次節）。

## テンプレートの項目コード（`Questionnaire.item.code`）

テンプレート編集画面の **「詳細設定 > 項目コード」** で、設問に標準コード（LOINC・JP Core など）を
付けられます。`code` / `display` / `system` の 3 列で、1 項目に複数のコードを持たせられます。

- **回答の選択肢（`answerOption`）のコードとは別物**です。項目コードは「この設問が何を訊いて
  いるか」を表し、SDC の Observation 抽出では `Observation.code` になります。
- **表示テキスト（display）には付けられません**（FHIR の不変条件 que-3）。入力欄自体を出さず、
  取り込んだテンプレートに付いていた場合は保存時のエラーで知らせます（黙って落としません）。
- 入力欄の種類（`item.type`）を変えてもコードは引き継ぎます（コードは「何を訊いているか」で、
  入力方法とは独立なため）。ただし表示テキストへ変更したときだけは落とします（que-3）。
- 空のコードは保存されません。`system` や `display` だけを入れて `code` が空の行は保存時に
  エラーになります（黙って消えると気づけないため）。

## 初期計画（POMR の Initial Plan）

POMR の初期計画を **診断計画(Dx)・治療計画(Rx)・教育計画(Ex)** の 3 分割で書くテンプレートを
用意してあります（[`docs/report-mappings/plan-01.md`](docs/report-mappings/plan-01.md)、`plan-01`）。
カテゴリは「診療計画」です。

- **診療記録の「治療計画(P)」セクションに『テンプレート記載』で貼り付けて使うのを勧めます**。
  SOAP の P は本来この 3 分割で書くもので、記録と計画が同じカードに収まる方が経過を読みやすい
  ためです。プロブレムを選んでから「診療記録」を開けば対象が初期選択されるので、その状態で貼れば
  計画もそのプロブレムのものになります。単独登録でも対象プロブレムは選べるので、記録に紐付かない
  計画だけを残すこともできます。
- 「確認する検査」「薬物療法」は**方針としての記載**で、実際のオーダーは検査・処方オーダーで
  出します（記録とオーダーが二重にならないようにするため）。
- 最後に「計画の見直し予定日」を置いています。初期計画は立てたままにせず経過記録で評価する
  ためです。
- 項目コード（`item.code`）は付けていません。各項目に対応する確度の高い標準コードが無く、
  計画は自由記載の方針で構造化データとして集計する対象でもないためです。

## 病名の区分（プロブレム / 既往歴 / 保険病名）

「病名」タブの区分ラジオで 3 つを選び分けます。いずれも同じ `Condition` で、`category` で区別します。

| 区分 | 用途 | `Condition.category` |
|---|---|---|
| プロブレム | POMR のプロブレムリストに載る現在の問題 | `problem-list-item` |
| 既往歴 | 基礎データとしての過去の病歴。プロブレムリストには載せない | `problem-list-item` ＋ ローカルの `past-history` |
| 保険病名 | レセプト用 | `encounter-diagnosis` |

- **既往歴が 2 つの分類を持つ理由**: FHIR 標準の `condition-category` には `problem-list-item` と
  `encounter-diagnosis` の 2 コードしか無く、既往歴に当たるコードがありません。JP Core も既往歴を
  `Condition` で表す方針なので、標準の `problem-list-item` を併記したうえで、ローカルの
  `http://fhir-client.local/CodeSystem/condition-category` の `past-history` で印を付けています。
  標準しか見ない相手にはプロブレムリスト項目として読め、アプリ内では区別できます。判定
  （`conditionCategoryOf`）はローカルコードを先に見ます。
- 既往歴には**プロブレム番号を振りません**。プロブレム帯・プロブレム選択の候補・診療記録やオーダーの
  対象プロブレムにも出しません（`splitConditions` がプロブレムと別に返します）。
- MEDIS 病名検索・接頭/接尾修飾語・転帰は 3 区分とも共通です。既往歴は転帰「治癒」＋終了日を
  入れる使い方を想定しています。

### 病名の入力方法（マスタ / フリー入力）

区分とは別に「入力方法」を選べます。**フリー入力**は、既往歴のように具体的な傷病名が判別できない
場合に使います（区分は問わず、保険病名でも選べます）。

- フリー入力の病名は `Condition.code` に **`text` だけ**を入れ、`coding` は付けません
  （レセプトに使えるコードが無いことを表します）。フォームのプレビューにも「(コードなし)」と出ます。
- **修飾語（接頭語・接尾語）と疑い病名はフリー入力では出しません**。修飾語はマスタの病名に
  付けるものだからです。マスタ→フリーに切り替えた時点で設定済みの修飾語も落とします
  （画面に出ていない語が付いたまま保存されるのを防ぐため）。
- 編集時の入力方法は保存内容から判定します（病名コードがあればマスタ、無ければフリー入力）。
  `code.text` は「接頭語＋病名＋接尾語」を連結したものなので、フリー入力として開き直すときは
  両端から修飾語の名称を剥がして病名本体を復元します（前後一致を確かめてから外すので、
  想定外の text を壊しません）。

### 疑い病名

「疑い病名(接尾語に「の疑い」を付ける)」のチェックボックスで、MEDIS 修飾語の **「の疑い」**
（管理番号 27000001）を付け外しできます。毎回修飾語のモーダルから探す手間を省くためのものです。

- チェックは**接尾語リストの表示そのもの**です。モーダルから「の疑い」を追加してもチェックが入り、
  接尾語のチップを × で消せばチェックも外れます（状態を二重に持ちません）。読みが「〇〇の疑い」に
  なるよう、常に接尾語の末尾に置きます。
- 疑い病名は確定診断ではないので、`Condition.verificationStatus` を `provisional` にします
  （付いていなければ従来どおり `confirmed`）。レセプト表記は修飾語、FHIR としての確からしさは
  `verificationStatus` と、二本立てで表しています。

## 前回の回答の複写

テンプレート回答の新規登録で、同じテンプレートの直近の回答を初期値として読み込めます
（「前回の回答を複写(YYYY-MM-DD)」ボタン）。基礎データのように「前回を見て変わったところだけ
直す」使い方のためのものです。

- **自動では入れません**。前回の内容を今回の所見として無自覚に確定してしまうのを避けるため、
  押したときだけ読み込み、読み込み後は「複写を取り消す」で空に戻せます。
- 複写しても**新しい回答として登録**されます（前回の回答は書き換えません）。id・報告単位 ID・
  記録日時は新規に採番され、記入者はログイン中の医療従事者のままです。
- **シェーマの描き込みは引き継ぎません**。同じ `Binary` を 2 つの回答が参照すると、片方を消した
  ときにもう片方の画像が壊れるためです（描き込みはその時点の所見なので、複写して使い回すもの
  でもありません）。計算式の項目は複写後に再計算されます。
- 直近の回答は canonical（`<url>|<version>`）の完全一致で引くので、**テンプレートのバージョンを
  上げると前回の回答は複写できなくなります**。設問が変われば回答の対応も崩れるため、版をまたいで
  複写しないのは意図した動作です。

## テンプレート回答からの Observation 生成

テンプレート編集画面の **「回答から Observation を生成」** を有効にすると、項目コードを設定した
設問の回答が `Observation` として保存され、検査結果と同じ構造化データになります
（SDC の Observation-based extraction 相当。実装は `frontend/src/fhir/observationExtract.ts`）。

- **設定はテンプレート単位**です。SDC 標準の拡張 `sdc-questionnaire-observationExtract`（有無）と
  `sdc-observationExtract-category`（生成する Observation の `category`）を Questionnaire に
  持たせます。項目コードの無い設問は対象外なので、除外したい設問はコードを付けなければ済みます。
- 生成される Observation は `code` = 項目コード、`value[x]` = 回答値、`subject` / `effectiveDateTime` は
  回答から引き継ぎ、`derivedFrom` に生成元の `QuestionnaireResponse` を持ちます。回答が下書き
  （`in-progress`）のうちは `status` を `preliminary`、確定後は `final` にします。
- **値の写し方**: 選択肢 → `valueCodeableConcept`、数値 + 単位 → `valueQuantity`、単位なしの整数 →
  `valueInteger`、文字列 → `valueString`、日付 → `valueDateTime`。複数選択（チェックボックス）は
  回答 1 つにつき 1 件の Observation にします（1 つの CodeableConcept に複数 coding を並べるのは
  「同じ概念の別コード体系」の意味なので、別々の所見をまとめる用途には使えないため）。
  単位は表示名だけを入れ、`system` / `code` は付けません。テンプレートの単位には「本/日」のように
  UCUM のコードではない値も入っており、そのまま UCUM として出すと誤ったコード体系の主張に
  なるためです。
- **保存は回答と同じ transaction Bundle** で行うので、片方だけ保存されることはありません。
  回答を更新すると前回生成した Observation を消して作り直し、回答を削除すると一緒に消します
  （由来を辿れない Observation だけが残らないように）。更新で作り直す（差分更新しない）のは、
  テンプレート側のコードが変わると項目と Observation の対応が崩れるためです。
- **前回の生成物は `Observation?derived-from=QuestionnaireResponse/<id>` で引き当てます**。
  回答を更新・削除するときに「この回答から作ったもの」を知る根拠は
  `Observation.derivedFrom` だけで、それをそのまま検索します。以前は生成した Observation の
  参照を回答側のローカル拡張に二重持ちしていましたが、上流が `derived-from` 検索に対応した
  ので撤去しました（拡張と実体がずれる余地が無くなります）。
- **診療記録に貼るテンプレート記載でも生成します**。記載の回答は診療記録と同じ transaction で
  保存されるので、生成した Observation もそこへ相乗りさせます（回答だけ保存されて Observation が
  無い、という中途半端な状態を作らないため）。新規記入では回答が Bundle 内の `urn:uuid` なので、
  `derivedFrom` も同じ `urn:uuid` を指し、上流の transaction 処理が実 ID へ解決します。
  - 記載を編集し直したとき・セクションごと外したとき・診療記録を削除したときの
    「前回の生成物」の削除は保存側（`api/queries.ts` の `saveClinicalNote`）で行います。
    Bundle の組み立ては同期処理で、`Observation?derived-from=` の検索が要るためです。
    対象は Bundle 内で既存の回答を PUT / DELETE しているエントリから拾います。
  - **放射線オーダーの検査目的・特別指示では生成しません**。こちらは別の Bundle 組み立て
    （`radOrderHelpers.ts`）なので未対応で、設定が有効なテンプレートを選ぶとモーダルに
    その旨を表示します（`TemplateEntryModal` の `extractsObservations`）。

## 自院と連携先

本アプリはマルチテナントではありません。診療科・診察室・医療従事者（ログインするスタッフ）は
**自院のものだけ**を登録し、他院の医療機関・医師は診療情報提供書の送付先候補として
**連携先**に登録する、という切り分けです。

「どの Organization が自院か」はヘッダーの「管理 > 自院設定」（`/facility-settings`、AdminGate 対象）で
指定します。backend の単一行設定（`facility_settings` テーブル）に Organization.id を持ち、
`GET /facility_settings` でログイン済みユーザー全員が読めます（変更は `/admin/facility_settings`）。

この設定が入ると各画面の挙動が変わります。

| 画面・機能 | 自院設定あり | 自院未設定（初期セットアップ前） |
|---|---|---|
| マスタメンテ > 共通 > 医療機関 | 自院 1 件のみを表示・編集 | 従来どおり全医療機関の一覧（ここから登録して自院設定へ進む） |
| 診療科 / 診察室 / 医療従事者の登録 | 所属は自院で固定（選択 UI を出さない） | 従来どおり所属医療機関を選ぶ |
| 医療従事者一覧 | 所属ロールが自院のスタッフだけ | 全 Practitioner |
| 予約枠・外来一覧・部門ワークリストの診療科 | 自院配下の診療科だけ | 全医療機関の診療科 |
| 処方箋 PDF の医療機関欄 | 自院を read | 保険医療機関番号を持つ最初の Organization（取り違えうる） |
| テンプレートの自動入力・保険医療機関番号の初期値 | 自院の登録値 | ログイン中の医療従事者の所属 / 仮の番号 |

連携先（他院）は「マスタメンテ > 連携先」配下の**連携先医療機関**（`/partner-organizations`）と
**連携先医師**（`/partner-practitioners`）で登録します。FHIR 上の表現は自院と同じ
Organization / Practitioner + PractitionerRole で、所属ロールの `organization` が他院になる点だけが
違います（画面と検索条件で分けているだけで、別のリソース型は使いません）。連携先医師には自院の
診療科もログイン設定も持たせません。

- 自院の除外・限定はクライアント側で行います。上流の Organization 検索には「この id を除く」条件が
  無く、施設と診療科を切り分ける `partof:missing` しか使えないためです。
- 連携先医師の一覧で医療機関を「すべて」にしたときは、連携先の id を列挙した複数値検索
  （`organization=Organization/a,Organization/b`）で引きます。画面側で間引かないので件数と
  ページ送りが上流の結果とずれません。

## 医療機関（Organization）

「マスタメンテ > 共通 > 医療機関」（`/organizations`）と「マスタメンテ > 連携先 > 連携先医療機関」
（`/partner-organizations`）で、上流 FHIR サーバーの Organization を一覧・登録・編集・削除できます。
JP Core の `JP_Organization` プロファイルを想定した項目構成です。

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
紹介先・紹介元など）。この選択モーダルは自院・連携先の両方を候補に出します（宛先には他院を、
差出人には自院を選ぶため）。テンプレート編集画面の**拡張設定**で、短文入力・複数行テキストの項目に
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

「マスタメンテ > 共通 > 医療従事者」（`/practitioners`）で、上流 FHIR サーバーの Practitioner を
一覧・登録・編集・削除できます。JP Core の `JP_Practitioner` プロファイルを想定した項目構成です。
自院が設定済みなら**自院スタッフ専用**の画面で、所属は自院で固定されます（他院の医師は
「マスタメンテ > 連携先 > 連携先医師」）。

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
一部として一体で扱い、1 人につき次の 2 種類を登録します。

- **所属ロール** … 1 件。`organization` は医療機関（自院スタッフなら自院、連携先医師なら他院）。
  「職種・所属」欄がこれにあたり、兼務は表現できません。
- **診療科ロール** … 0〜N 件。`organization` は診療科 Organization で、うち 1 件が既定診療科。
  自院スタッフの「所属診療科」欄がこれにあたります（連携先医師には持たせません）。

両者はローカル拡張 `http://fhir-client.local/StructureDefinition/practitioner-role-primary-department`
の有無で区別します（既定診療科だけ `valueBoolean = true`）。診療科は医療機関と同じ Organization なので、
`organization` の参照先だけでは判別できないためです。カルテ画面ヘッダーの依頼科・依頼医師
（`OrderContextPicker`）は、この診療科ロールと自院設定から選択肢を組み立てます。医師以外の
ログインは代行入力として指示医師も選びますが、**代行入力した本人はオーダーに記録していません**
（`docs/order-common-backlog.md` §2）。

- 職種は `PractitionerRole.code`。コードは HL7 の `http://terminology.hl7.org/CodeSystem/practitioner-role`
  （医師 `doctor` / 歯科医師 `dentist` / 薬剤師 `pharmacist` / 看護師 `nurse` / 理学療法士 `physio` /
  言語聴覚士 `speech` / 研究者 `researcher` / 教員 `teacher`）。JP_PractitionerRole の binding は
  `JP_PractitionerRole_VS` への **preferred** なので、上流はコード値を検証しません。
- 所属医療機関は `PractitionerRole.organization`。自院設定済みなら自院で固定され、連携先医師のときだけ
  検索モーダル（自院を除いた一覧）から選びます。`reference` に加えて `display` にも名称を入れます
  （一覧で Organization を引き直さずに表示するため）。
- 保存は **Practitioner と PractitionerRole を 1 つの transaction Bundle** で行います（新規作成時は
  `urn:uuid` を介して参照を解決）。職種・所属を両方空にして保存すると PractitionerRole は削除され、
  医療従事者を削除するとぶら下がる PractitionerRole も同じ Bundle で削除されます。
- 一覧は自院設定があれば `PractitionerRole?organization=<自院>&_include=PractitionerRole:practitioner`
  で引きます。所属ロールしか一致しないので、所属診療科の列を埋めるために
  `_revinclude:iterate=PractitionerRole:practitioner` で本人の残りのロールまで辿ります。自院未設定の
  環境では従来どおり `Practitioner?_revinclude=PractitionerRole:practitioner` です。
- 勤務期間（`period`）は未対応です。

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

## 病棟・病室・ベッド（Location）

入院患者を「どこに寝かせているか」で扱うための場所マスタです。マスタメンテ > 共通 > **病棟・病室**
（`/wards`）から登録します。診察室・撮影室（`/locations`）と同じ `Location` ですが、階層を持ち使う場面も
違うので画面を分けています。

### 3 階層の持ち方

`Location` を `partOf` で 3 段に積みます。

| 階層 | `physicalType` | `type` | `partOf` | `name` |
| --- | --- | --- | --- | --- |
| 病棟 | `wa`（Ward） | v3-RoleCode `HU`（病棟） | なし | 東3階病棟 |
| 病室 | `ro`（Room） | 区分（下記） | 病棟 | 301号室 |
| ベッド | `bd`（Bed） | なし | 病室 | `1`（番号のみ） |

病室の**区分**は該当する標準コードが無いのでローカル CodeSystem を建てています。

```
system : http://fhir-client.local/CodeSystem/room-class
code   : general（一般室） / private（個室） / special（特別室）
         icu（集中治療室） / hcu（高度治療室） / ccu（循環器疾患集中治療室） / scu（脳卒中集中治療室）
```

区分は `ROOM_CLASS_OPTIONS`（`frontend/src/fhir/wardHelpers.ts`）の定数配列なので、増やすときはここに
1 行足すだけです。

区分を `type[0]` に入れているのは、上流が `type` の索引に**最初の coding の code だけ**を採るためです。
これで病棟一覧の `type=HU` 検索に病室が混ざりません。

### ベッドの扱い

**ベッドは病室ごとに 1 件ずつ `Location` として作ります。** 病室の登録・編集画面で「ベッド数」を入れると、
その数に合うよう配下のベッドを自動で増減します（1 つの transaction Bundle で病室と一緒に書くので、
病室だけ保存されてベッドが中途半端に残ることはありません）。数を減らすと**番号の大きいベッドから**消えます。

- ベッドの `name` は病室内の**番号だけ**（`1`, `2`, …）です。「301号室 ベッド1」のような表示名は病室名と
  合成して作ります。名前に病室名を含めると、病室名を変えるたびに配下のベッドを全部書き換えることに
  なるためです。
- ベッド数は病室リソースには持たせず、**配下のベッドの件数から数えます**。数と実体を二重に持つと必ず
  どこかでずれるので、実体だけを正とします。
- 一覧の「病室数」「ベッド数」は `_revinclude=Location:partof` で子ごと取って数えています。`_revinclude`
  の結果は `_count` の対象外なので、子が何件あっても取りこぼしません。

ベッドに患者を割り当てる（入院）のは入院患者一覧です。下の「入院患者一覧（Encounter）」を参照してください。

### オーダーに焼き付ける入院病棟（`order-ward` 拡張）

部門業務の各種一覧（検体検査・放射線検査・生理検査・内視鏡・処置・処方）は「入院病棟」の列とフィルタを持ちます。値は
オーダーを登録した時点の病棟で、`ServiceRequest` のローカル拡張
`http://fhir-client.local/StructureDefinition/order-ward` に
`valueReference { reference: "Location/<病棟>", display: "東3階病棟" }` として持たせます
（依頼科の `order-department` と同じ持ち方。入外区分を `category` に焼き付けているのと同じ考え方です）。

- **一覧から入院を引き直さないため**です。入院は `Encounter` にあり、`Encounter.location[0]` が
  指すのはベッドなので、病棟名を出すには 1 患者あたり Encounter 検索 1 回 + `partOf` を辿る
  Location 検索 1 回が要ります。1 ページ 100 行の一覧でこれをやると 100〜200 リクエストになります。
  オーダー側に焼き付けておけば、一覧は**追加のリクエスト 0** で病棟名を出せます。
- 書き込み口はオーダー 8 種別（処方・注射・検体検査・放射線検査・生理検査・内視鏡・処置・細菌検査）が共通で通る
  `applyOrderContext` 1 箇所です。病棟は `useDefaultOrderSetting`（入外区分の初期値を決めるために
  すでに入院を引いている）の戻り値から取るので、**オーダー登録側の追加リクエストも 0** です。
- **入外区分が「入院」のときだけ**付けます。入院中の患者に手で「外来」を選んで出したオーダーには
  付きません（一覧の区分列と病棟列が食い違わないように）。
- **スナップショットなので転棟しても書き換わりません**。オーダーを編集して保存し直しても、
  `prescriptionRequester` が読み戻してそのまま渡すため登録時点の病棟が残ります
  （依頼科・依頼医師を引き継ぐのと同じ扱い）。
- この拡張が入る前に登録したオーダーは病棟を持たないので、一覧では `-` になります。
  一覧の病棟セレクトの選択肢は、読み込んだ 1 日ぶんのオーダーに実際に出てくる病棟だけです
  （拡張が `display` を持つので、病棟マスタを引く必要がありません）。
- 絞り込みは他のフィルタと同じくクライアント側です。上流で絞りたくなったら、`Observation` の
  `problem`（`element_match` 付きの reference 検索パラメータ）と同じ形で `ServiceRequest` に
  `ward` を足せます（マイグレーション不要）。

### 削除

- **病棟**は配下に病室があると削除できません（上流に参照整合性が無いので、削除前に
  `partof` で子の有無を確かめています）。先に病室をすべて削除してください。
- **病室**は配下のベッドごと削除します（確認ダイアログにベッド数を出します）。

### 診察室・撮影室（`/locations`）との分け方

同じ `Location` なので、放っておくと診察室の一覧やセレクトに病棟・病室・ベッドが混ざります。
上流の token 検索に `:not` が無いため「除く」ではなく、**診察室の種別（`LOCATION_TYPE_OPTIONS` の
コード）だけを挙げて OR で引く**ことで分けています。取得後にクライアント側で落とすやり方だと
`total` とページ内件数がずれるためです。

この都合で、診察室・撮影室の**種別は必須**です（未設定だと一覧に出てきません）。

## 入院患者一覧（Encounter）

患者一覧メニュー > **入院患者一覧**（`/inpatients`）。病棟を選ぶと、その病棟の病室・ベッドを
1 行 1 床で並べます。埋まっている床には入院中の患者を、空いている床には「患者選択」を出します。

### 入院の持ち方

入院は `Encounter` 1 件で「その患者が今どのベッドに居るか」を表します。

| 画面の項目 | Encounter の要素 |
| --- | --- |
| （入院中であること） | `status` = `in-progress`、`class` = v3-ActCode の `IMP` |
| 退院 | `status` = `finished` + `period.end`（退院日）、`location[0].status` = `completed` |
| 入院取消（誤登録） | `status` = `entered-in-error`（退院ではないので `period.end` は付けない） |
| 患者氏名・生年月日・性別 | `subject`（表示は `_include` で引いた Patient から）。カナは列を分けず「氏名（カナ）」と併記する |
| 病室・ベッド | `location[0].location` = **ベッドの Location**（病室・病棟は `partOf` で辿れる） |
| 診療科 | `serviceProvider` = 診療科の Organization |
| 主治医 | `participant` の種別 `ATND`（v3-ParticipationType の attender） |
| 担当看護師（複数可） | `participant` の種別 `nurse`（ローカル CodeSystem `http://fhir-client.local/CodeSystem/encounter-participant-role`。看護師を表すコードが ParticipationType に無いため） |
| 入院日 | `period.start`（時刻を持たない日付のみ） |
| 特記事項 | ローカル拡張 `http://fhir-client.local/StructureDefinition/encounter-note`（`valueString`） |

- **`Encounter.class` は Coding 単体**です（R4 では CodeableConcept ではない）。
- 主治医・担当看護師・特記事項は未入力なら要素ごと付けません。主治医と担当看護師は同じ
  `participant[]` に種別違いで並びます。
- 退院・入院取消はリソースを消さず `status` で残します。いつ誰が登録した記録なのかを
  後から追えるようにするためです。どちらも `in-progress` ではなくなるので一覧からは外れます。
- 特記事項に R4 の `Encounter` に無い要素（`note` など）を使っていないのは、プロファイル検証を
  将来 enforce にしたときに弾かれるためです。拡張なら中身を見られません。

### 取得のしかた

病棟で絞らず**院内の入院をすべて取ってから**ベッド id で突き合わせます
（`Encounter?status=in-progress,finished&class=IMP&_include=Encounter:subject`）。病棟のベッド id を
並べた `location=...` でも引けますが、ベッドの数だけ URL が伸びます。入院中の件数はベッド総数が
上限で高が知れているうえ、全部持っていれば「この患者は既に別の病棟に入院している」の判定も
追加のリクエスト無しでできます。

病室・ベッドの側は病棟マスタをそのまま使います（`partof` + `_revinclude=Location:partof` で
1 往復）。同じベッドに入院中が複数あったら、入院日（同日なら更新時刻）が新しいものを表示します。

**日付の絞り込み**は「その日にベッドを使っていた人」（入院日 ≦ 選択日 ≦ 退院日）なので、退院済み
（`finished`）も対象に含めます。上流の `date` は `eq` が「期間を完全に含む」で重なりではないため、
重なりは `ge` と `le` の AND で表します。

```
date=ge<選択日>   退院していない、または選択日以降に退院した
date=le<選択日>   選択日までに入院している
```

取り消した入院（`entered-in-error`）は在院ではないので `status` で外しています。

### 画面のふるまい

- 選んだ病棟と日付は URL の `?ward=` / `?date=` に持ちます。カルテへ渡す戻り先は検索文字列を
  含むので、カルテから「← 戻る」で同じ病棟・同じ日が開きます。
- **日付を選ぶとその日の在院状況になります。** `<` `>` で 1 日ずつ送れ、「今日」で当日に戻ります。
  日付は「いつの状態を見るか」なので、診療科・主治医・担当看護師の絞り込みとは別扱いです
  （日付を変えても空床は出します）。過去の日を見ているときは、入院登録の入院日の既定も
  その日になります（今日で登録すると登録した本人がその画面に出てこないため）。
- 病棟が未指定なら先頭の病棟を自動で開きます（履歴は汚さず replace で書き換え）。
- 「患者選択」→ 患者を検索して選ぶ → 診療科（必須）・主治医・担当看護師（複数可）・入院日（既定は今日）・特記事項で登録。
- 担当看護師はセレクトで 1 人ずつ選んで「追加」し、選んだ人は下に × 付きで並びます。選択済みの人は
  セレクトから消えるので二重に足せません。`select multiple` を使わないのは、Ctrl 押しながらの
  クリックが要って選び方が見て分からないためです。
- 選んだ患者が既にどこかの床に居る場合は確認を出しますが、転床やデータ修正の途中ということも
  あるので登録自体は止めません。
- 入院中の行の操作メニュー（⋮）に **退院** と **入院取消** があります。退院は退院日を聞く
  （既定は今日。入院日より前の日付は弾きます）、入院取消は誤登録向けで確認だけです。
- **診療科・主治医・担当看護師で絞り込めます。** 選択肢は院内の入院中の Encounter から作るので、実際に
  在院している科・医師しか並びません（病棟を切り替えても選択が消えないよう、表示中の病棟では
  なく全病棟ぶんを見ています）。絞り込み中は空床を出しません（空床はどちらも持たないので、
  残すと「絞ったのに一覧が変わらない」ように見えるため）。病室セルの rowspan も残った行数で
  数え直します。
- 病室の区分（個室・ICU など）は一覧には出しません。マスタメンテ > 病棟・病室 で見てください。
- 列はどれも折り返しません。入り切らないときは表ごと横スクロールします（折り返すと行の高さが
  変わってベッドの並びが読みにくくなるため）。

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
- 病棟・病室・ベッド(Location 3 階層): 病棟の登録と病室数の表示、病室の登録(病室とベッドを同一 transaction で作成し `urn:uuid` が解決されること)、ベッド数の増減(2→4 で 3・4 が増え、4→1 で番号の大きい方から消えること)、病室名を変えてもベッド名が変わらないこと、病室削除でベッドが道連れになること、配下に病室のある病棟の削除が拒否されること、`/locations` と予約枠の診察室セレクトに病棟・病室・ベッドが出ないことを Docker 環境の画面から確認
- 入院患者一覧: 病棟の自動選択と `?ward=` への反映、病室ごとの rowspan グリッド、空床への入院登録(診療科未選択のエラー、主治医未指定でも登録できること)、登録後に全カラムが埋まり「カルテ」ボタンに変わること、カルテから病棟選択を保ったまま戻れること、既に入院中の患者を選んだときの確認、病棟の切り替えを Docker 環境の画面から確認。上流の Encounter JSON(class が Coding 単体、period.start が日付のみ、participant の ATND、note の拡張)も目視
- 入院患者一覧の退院・入院取消: 操作メニューからの退院(入院日より前の退院日を弾くこと、退院で一覧から外れて空床に戻ること、`status=finished` + `period.end` + `location[0].status=completed` が入ること)、入院取消(確認ダイアログ、`status=entered-in-error` になり退院日が付かないこと)を Docker 環境の画面と上流 REST で確認
- 入院患者一覧の絞り込み・表示: 診療科/主治医の選択肢が在院中のものだけになること、絞り込みで空床が消えて rowspan が数え直されること、条件に合う患者がいないときの表示、絞り込みクリア、カナが「氏名（カナ）」の形で併記されることを Docker 環境の画面から確認
- 入院患者一覧の担当看護師: モーダルのセレクト+「追加」で複数選べること(選択済みはセレクトから消える、× で外すと戻る、未選択なら追加ボタンが押せない)、登録できること(participant に種別 nurse で複数並ぶこと)、一覧に「、」区切りで出ること、担当看護師での絞り込み、幅を狭めても折り返さず横スクロールになり行の高さが変わらないことを Docker 環境の画面と上流 REST で確認
- 入院患者一覧の日付: 退院済みの入院(08-15〜08-18)が入院日・退院日の両端で出て前日・翌日で消えること、`<` `>` の日送りと「今日」ボタン、日付が `?date=` に載ること、在院中の患者が入院日以降のどの日でも出ることを Docker 環境の画面と上流 REST で確認
- 手術室ブロックスケジュール(`docs/surgery-calendar-design.md`): マスタ画面での登録(手術室・曜日・時間帯・診療科)、同じ手術室・曜日で時間帯が重なる登録が弾かれること、境界が接するだけなら通ること、手術室・曜日での絞り込みを Docker 環境の画面から確認
- 手術室カレンダー: 手術一覧の 3 つ目のタブに出ること、日ビュー(手術室 × 時刻)で予定がその時刻に置かれ重なりが左右に分かれて警告色になること、割当科が背景の帯として出ること、時刻・手術室が未定の手術が格子の下に列挙されること、週ビュー(曜日 × 手術室)で件数・ミニチップ・重なりのセル色・土日の色が出ること、日送り/週送りと「今日」、日付が一覧タブと共有されることを Docker 環境の画面から確認
- ダブルブッキングの確認: 日程確定モーダルと申込フォームの両方で、同じ手術室の重なる時間帯を入れて登録すると確認モーダルが出ること、「重なりを承知で登録」で通ること、「戻る」で入力に戻れること、**申込フォームでは外側のフォームが送信されないこと**、重ならない時間帯なら確認なしで通ることを Docker 環境の画面から確認
- ブロックスケジュールの警告: 割当外の診療科(手術室1 金 午前 = 外科 に眼科)で申し込むと「この時間帯は 外科 の割当です」が出て、**登録は止まらない**ことを Docker 環境の画面から確認
- 手術室カレンダーのドラッグ＆ドロップ: 日ビューで受付済カードを縦に動かすと時刻が(掴んだ位置とカードの頭のずれを保って 5 分刻みで)変わること、横の列へ動かすと手術室が変わること、週ビューでチップを別セルへ動かすと日付が変わり時刻は維持されること、どの場合も「手術の日程を移動」の確認が出て変更前 → 後が並ぶこと、移動先が重なるときだけボタンが「重なりを承知で移動」になること、「戻る」で書き込まれないこと、実施済のカードは掴めないこと、週ビューでドラッグしても日ビューへ落ちないことを Docker 環境の画面から確認
- 手術カレンダーのカード: ステータス(色分け)・患者番号・氏名(カナ)・年齢・性別・主術式・執刀医が上から並ぶこと、所要時間の短いカードでは下の行が隠れるが title に全文が出ること、右上のケバブから「カルテを表示」でカルテへ飛べて「戻る」で手術一覧に戻れること、ケバブを押してもカードのドラッグが始まらないことを Docker 環境の画面から確認
- 手術カレンダーのカードの操作: 見出し行の右端に進捗ボタン(申込済→受付 / 受付済→入室 / 入室中→実施)が出てステータスが進むこと、実施済には出ないこと、「実施」で実施入力モーダルが開くこと、ケバブに「カルテを表示」「麻酔チャート」(入室中・実施済のみ)と取消・中止が入り中止が赤で出ること、「取消」「入室取消」で 1 つ前に戻せること、ボタン・ケバブを押してもカードのドラッグが始まらないことを Docker 環境の画面から確認

## 未検証

- ブラウザでの実際の画面操作(このセットアップ作業ではヘッドレスブラウザ/スクリーンショットツールを使用していないため、UI の見た目・操作感は上記の起動手順に沿って手動で確認してください)
