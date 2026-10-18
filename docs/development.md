# 開発環境

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

- backend: `http://localhost:3001`(コンテナから `http://host.docker.internal:3000` 経由で fhir-server に接続。別サーバーに向けたい場合は `docker-compose.yml` の `FHIR_SERVER_BASE_URL` を変更。ブラウザが上流を直接叩く URL(SMART アプリの `iss`・起こしボタン)は `FHIR_SERVER_PUBLIC_BASE_URL`、既定 `http://localhost:3000`)
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

### 任意の profile(院内エージェント / 日レセ)

レセコン連携([features/admin-integration.md](features/admin-integration.md))を通しで動かすときだけ要るコンテナは profile で切ってあり、既定では起動しません。

| profile | サービス | 中身 |
| --- | --- | --- |
| `agent` | `agent` | 院内エージェント(別リポジトリ `../fhir-client-agent`)。レセコンの通知をカルテへ中継する |
| `orca` | `orca` | 日レセ検証環境(別リポジトリ `../weborca-dev`)。`http://localhost:8000/` |

隣にそれぞれのリポジトリを clone したうえで、profile を指定して起動します(`--profile "*"` で全部)。

```bash
cp .env.example .env         # RECEIPT_INBOUND_TOKEN を入れる(.env は git 管理外)
docker compose --profile "*" up -d --build
```

- `RECEIPT_INBOUND_TOKEN` は管理画面「外部システム連携 > 医事会計」で発行した受信トークン。未設定だとエージェントが起動時に落ちます。`.env` に書く代わりにコマンドの前に置いて渡すこともできます
- 日レセは `weborca-dev` 側の compose と**同じコンテナ名 `weborca`・同じボリューム**を使うので、片方だけ動かします。向こうで起動していたら先に `cd ../weborca-dev && docker compose down`(`stop` だけだとコンテナが残り、名前の衝突で起動できません)
- 別プロジェクトが作ったボリュームを指すため、起動のたびに `volume "weborca-dev_pg_data" already exists but was created for project "weborca-dev"` という警告が出ますが無視して構いません
- 停止時も profile を付けます(付けないと `agent` / `orca` が残ります)

```bash
docker compose --profile "*" down
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
- 手術カレンダーのカード: ステータス(色分け)・患者番号・氏名(カナ)・年齢・性別・主術式・執刀医が上から並ぶこと、所要時間の短いカードでは下の行が隠れるが title に全文が出ること、右上のケバブから「カルテ表示」でカルテへ飛べて「戻る」で手術一覧に戻れること、ケバブを押してもカードのドラッグが始まらないことを Docker 環境の画面から確認
- 手術カレンダーのカードの操作: 見出し行の右端に進捗ボタン(申込済→受付 / 受付済→入室 / 入室中→実施)が出てステータスが進むこと、実施済には出ないこと、「実施」で実施入力モーダルが開くこと、ケバブに「カルテ表示」「麻酔チャート」(入室中・実施済のみ)と取消・中止が入り中止が赤で出ること、「取消」「入室取消」で 1 つ前に戻せること、ボタン・ケバブを押してもカードのドラッグが始まらないことを Docker 環境の画面から確認
- カルテのファイル取込: 表・サムネイルとも診療日の見出しで区切られること、表とサムネイルの切り替え(選んだ側がリロード後も残ること、画像だけサムネイルが出て PDF・Word・Excel・CSV・PowerPoint・ZIP・テキストはそれぞれ別のアイコンになること)、カテゴリの追加・並べ替え、PDF・PNG・テキストの一括登録(診療日とカテゴリの一括設定)、一覧が診療日の降順で並ぶこと、カテゴリでの絞り込み(上流の `category` 検索)、PDF・画像・テキストのプレビューとダウンロード、表示名・診療日・カテゴリの編集で並びが変わること、削除、7MB 超のファイルが取込時に弾かれて他のファイルは残ること、ドロップでの追加と枠の強調を Docker 環境の画面と上流 REST で確認

## 未検証

- ブラウザでの実際の画面操作(このセットアップ作業ではヘッドレスブラウザ/スクリーンショットツールを使用していないため、UI の見た目・操作感は上記の起動手順に沿って手動で確認してください)
