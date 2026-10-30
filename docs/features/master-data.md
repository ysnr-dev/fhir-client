# マスタデータ API・マスタメンテ

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
| 口腔診査コード | `/master/oral_exam_codes` | 口腔診査情報標準コード仕様(JDAOES)のコード表。配布 xlsx から rake で作った `db/seed_data/oral_exam_codes.csv` を seed と migration で投入。読み取り専用（`docs/features/oral-exam.md`） |

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
- 例外は **DPC 電子点数表**（`/master/dpc_tables/import`）で、全シートを 1 ファイルから取り込み、
  **同じ版（改定の開始日）の行だけ**を入れ替えます（改定をまたぐ入院を退院日の版で判定するため。下の「DPC」）。
  手術基幹コード（STEM7）の対応表（`/master/dpc_stem7_codes/import`。厚生労働省の改定ページの「（別表）Kコードに
  対応する手術基幹コード（STEM7）」）は総洗い替えです。
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

## マスタメンテ(マスタの一覧)

ヘッダーの「管理」>「マスタメンテ」は一覧のページ(`/masters`)を開きます。マスタの画面は数が多く、
ヘッダーのメニューに並べると画面の大きさによっては下の項目に届かないため、ページにしています。

- マスタを診療領域ごとのカードにまとめて並べます(どの領域にも属さないものは「共通」)。画面の幅に
  合わせて段の数が変わり、収まらないぶんは縦に送ります。
- 右上の入力欄で絞り込めます。項目名に当たればその項目だけ、領域名に当たればその領域をまるごと
  残します。ひらがな・カタカナ、英字の大小は区別しません(漢字の読みでは引けません)。
- 一覧とそこから入ったマスタの画面(登録・編集の画面も含む)にいる間は、「管理」メニューの
  「マスタメンテ」を強調します。
- マスタの画面の右上には「戻る」を出します。マスタの一覧の画面からはマスタメンテの一覧へ、
  登録・編集などの配下の画面からはそのマスタの一覧へ戻ります(`masterBackPath`)。
- 並べるマスタは `frontend/src/masterMenu.ts` に定義しています。マスタの画面を足すときは、ルートに
  加えてここに 1 行足します。

## 祝日・休診日

「マスタメンテ」>「共通」>「祝日・休診日」(`/holidays`)。1 日 1 行で、区分は「祝日」(国民の祝日)と
「休診日」(施設の年末年始・創立記念日など)の 2 つです(`master_holidays`)。

- 国民の祝日は内閣府の「国民の祝日」CSV(`syukujitsu.csv`、Shift_JIS)をマスタ取込(`holidays`)で入れます。
  ファイルが覆う期間の祝日だけを入れ替え、休診日には触れません。休診日と同じ日の祝日は取り込みません(休診日の名称を残す)。
  毎年 2 月ごろに内閣府が翌年分を公表するので、そのつど取り込みます。初期値は migration で 1955〜2027 年を入れてあります
  (`db/seed_data/holidays.csv`)。
- 休診日は画面の「休診日追加」で開始日〜終了日(31 日まで)と名称を入れると、日ごとに登録します。行を押すと名称の変更と削除ができます。
- 読む側(`useHolidays` で表示期間の年をまとめて引き、年単位でキャッシュ):
  - カレンダーの色分け: 祝日・休診日を日曜と同じ色にし、見出しの title に名称を出す。予約枠カレンダー・手術カレンダー(週)・
    放射線治療カレンダー(週)・予約の月カレンダー・カルテの注射・食事・化学療法・薬歴(日単位)・経過表
  - 予約枠の一括生成: 「祝日・休診日を除く」(既定でオン)。祝日に診療する施設は外して生成する
  - 放射線治療の予定登録: 割り付けで祝日・休診日を飛ばす。確認表の曜日に祝日名を添える
- パス・レジメンの Day、督促期限(退院サマリーなど)は暦日のままで、祝日を見ません。
