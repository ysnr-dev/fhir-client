# 分析ダッシュボード 設計

データ抽出(docs/data-extract-design.md)で保存した条件を、タイルとして好きな位置・大きさに並べて
1 画面で見渡す機能。並べ方は分析ダッシュボードとして名前を付けて保存する。
メニューは「データ > 分析ダッシュボード」(`/dashboards`)。カルテのタブを並べる診療ダッシュボードは
`docs/clinical-dashboard-design.md`(マス目の処理と保存の形を共有する)。

## 1. 方針

- 分析ダッシュボードは「どの保存条件を、どこに、どう見せるか」だけを持つ。抽出の中身(条件)は持たず、
  保存条件を `code` で指す(条件を直せばダッシュボードにもそのまま効く。環境をまたいでも同じ条件を指す)。
- 抽出の実行はデータ抽出と同じく画面が上流 FHIR を引いて行う。backend は形を確かめて預かるだけ。
- 結果は DB に残さない。開いた直後のタイルは枠と条件名だけで、「実行」で実行時点の結果を出す。
  過去の状況を見たいときは、条件の期間(絶対日付)で検索する。期間ごとの推移は記録タブの内訳(行=期間)のグラフで出す。
- 開いただけでは上流を叩かない(タイルが多いと 1 トークン 300 件/分のレート制限に当たるため)。
- 新しいトップレベルパスは足さない(API は `/master/dashboards`、画面は `/dashboards`)。

## 2. 置ける条件とタイルの表示

「患者」タブと記録タブ(クラスタ・入院・外来・病名・テンプレート・検査結果・投薬・細菌検査・手術・部門実施・有害事象・パス)の
保存条件すべてを置ける。タイルごとに表示(`view`)を選ぶ。

| 表示 | 「患者」タブの条件 | 記録タブの条件 |
|---|---|---|
| `count`(件数) | 該当人数 | 件数と人数(`recordCountLabel`)。指標タブは直近の割合(`RecordTable.headline`) |
| `breakdown`(内訳) | 性別 × 年齢帯と条件ごとの人数(`ExtractResults` の `BreakdownTable`) | 保存した切り口(`definition.breakdown`)の表とグラフ(`RecordBreakdownView` を `controls={false}` で)。行が期間なら推移の折れ線。指標タブは割合の推移(`IndicatorTrendView`) |
| `list`(一覧) | 患者の一覧(`ResultTable`) | 記録の一覧(`RecordListTable`) |

- 一覧は画面に並べるだけなので先頭だけを出し、切ったことを `TruncatedNotice` で示す(すべてはデータ抽出で開いて見る)。
- タイルの中では切り口を変えない(変えたいときはデータ抽出で開いて条件を直して保存する)。
- 比較群・担当医の列(docs/data-extract-design.md §21)はデータ抽出と同じく出す(担当医は実行の中で読む)。クラスタタブの条件は列の見出しを
  「クラスタ」にする。クラスタタブの概要・重なり(§22)はタイルに出さない(件数・一覧・内訳だけ)。

### 記録タブの実行の組(`fhir/extractTabRunners.ts`)

記録タブは保存した条件だけから実行できるよう、タブごとに「条件 → 読み込みの条件」(`criteria`)と「読み込みの結果 → 表」(`table`)の
組を `EXTRACT_TAB_RUNNERS` に 1 行ずつ並べ、データ抽出の各パネルとダッシュボードが同じ組で実行する(docs/data-extract-design.md §17)。
患者の絞り込み・比較群・担当医は `resolvePatientScope`(`hooks/useExtractPatientScope.ts`)が保存した形から解く。

## 3. データの置き場所

backend の DB に持つ(上流 FHIR には置かない)。

| 表 | 主な列 |
|---|---|
| `dashboards` | `code`(uuid)、`scope`(`facility` / `department` / `practitioner` / `team`)、`owner_id`、`owner_name`、`name`、`definition`(jsonb)、`display_order`、`active` |

持ち主と権限はデータ抽出の条件と同じ(`Master::ScopedDefinitions` をそのまま使う。§5)。

### definition の形

```json
{ "schema_version": 1,
  "tiles": [
    { "id": "t1", "query_code": "…uuid…", "view": "count",
      "title": "糖尿病で HbA1c 8 以上",
      "x": 0, "y": 0, "w": 3, "h": 2 },
    { "id": "t2", "query_code": "…uuid…", "view": "breakdown",
      "x": 3, "y": 0, "w": 9, "h": 4 } ] }
```

- 位置と大きさはマス(横 12 列、縦は 1 マス固定の高さで下へ伸びる)の整数。`x + w <= 12`。
- `title` は省略でき、無ければ保存条件の名前を出す。
- タイルは 40 個まで。重なりは backend では拒否しない(画面が読み込むときに `normalizeDashboard` で解く)。
- `query_code` の存在は検証しない(条件を消したタイルは画面で「条件が見つかりません」と出す)。
- 形の検証は `JsonShape`(`Dashboard::DEFINITION_SHAPE`)。

### 見本(`db/seed_data/dashboard_presets.json`)

院内共通の見本は JSON で持ち、`DashboardPresets` が migration(`20261011180000_seed_dashboard_presets.rb`)と db:seed から入れる。
タイルは条件を code ではなく院内共通の条件のタブ(`query_tab`、省略は「患者」)と名前(`query_name`)で書き、投入のときに
`query_code` に置き換える(code は環境ごとに違う)。見つからない条件のタイルは置かない。同じ名前の院内共通のダッシュボードがあれば触らない。

## 4. 画面(`pages/DashboardPage.tsx`)

### 表示

- 上部: ダッシュボードの選択(`ExtractQuerySelect`。持ち主ごとにまとめる)、「実行」(実行中は「中止」)、「編集」、削除(ゴミ箱)。
  `?id=<id>` で開くと読み込む(実行はしない)。
- 本体: CSS grid(`grid-template-columns: repeat(12, 1fr)`、1 行 `--dashboard-row`)で、タイルは `--tile-x/y/w/h` から
  `grid-column` / `grid-row` を決める。狭い画面(720px 以下)では 1 列に積む。
- タイル(`components/dashboard/DashboardTile.tsx`): 見出し(タイトル・タブと表示・実行日時)、本体(§2 の表示)、
  ケバブメニュー(RowMenu)に「実行」「データ抽出で開く」(`/data-extract?tab=<tab>&query=<id>`)。
- 「実行」は全タイルを上から順(y, x)に 1 つずつ実行する(`hooks/useDashboardRun.ts`)。同じ条件を置いたタイルは
  1 回の実行を共有する。実行中は検索の回数を出し、「中止」できる。
- 結果はフックの状態にだけ持つ(別のダッシュボードに切り替えたら捨てる)。

### 編集

- 「編集」で編集モードにする。見出しを掴んで動かす・右下の角で大きさを変える・ゴミ箱アイコンで削除。
  「元に戻す」「やり直す」は `hooks/useUndoableState.ts`(ドラッグの途中経過は履歴に積まず、離したときだけ積む)。
- 掴む処理は `hooks/useCardDrag.ts`(Pointer Events)。マスへの丸めと重なりの解消(動かしたタイルを優先し、ぶつかる
  タイルを下へ押し出す)は純粋関数 `fhir/dashboardLayout.ts`(`moveTile` / `resizeTile` / `settleTiles`)。
- 「タイル追加」(`components/dashboard/AddTileModal.tsx`)はタブ・保存条件(見える持ち主すべて)・表示・タイトルを選ぶ。
  空いている最初の位置に既定の大きさ(`count` 3×2、`breakdown` 6×5、`list` 12×6)で置く。
- 「保存」「別名保存」はデータ抽出の条件と同じ(持ち主の選択は `useDefinitionOwners`、モーダルは `SaveQueryModal`)。
  未保存の変更があるときは切り替え時に確認する。

## 5. API

`/master/dashboards`(`resources :dashboards, only: %i[index show create update destroy]`)。

- `Master::DashboardsController` は `ScopedDefinitions` を include するだけ。
  読みは誰でも、自分(医師スコープ)の書き換えは本人だけ(backend)。院内共通・診療科の書き込みは画面で医師に限る。
- frontend: `api/masterClient/dashboard.ts`、`api/masterQueries/dashboard.ts`(`useDashboards` / `useDashboardMutations`)。
  保存条件はタブを指定せず全タブぶんを 1 回で読む(`useExtractQueries(..., "all")`)。

## 6. 主なファイル

| 区分 | ファイル |
|---|---|
| backend | `db/migrate/20261011130000_create_dashboards.rb`、`app/models/dashboard.rb`、`app/services/dashboard_presets.rb`、`db/seed_data/dashboard_presets.json`、`app/controllers/master/dashboards_controller.rb`、`spec/requests/master/dashboards_spec.rb` |
| frontend | `pages/DashboardPage.tsx`、`components/dashboard/DashboardTile.tsx`・`AddTileModal.tsx`、`fhir/dashboardLayout.ts`、`hooks/useDashboardRun.ts`、`App.tsx`(「データ」メニューと route) |
| データ抽出と共有 | `fhir/extractTabRunners.ts`、`hooks/useExtractPatientScope.ts`(`resolvePatientScope`)、`hooks/useRecordPatientAttributes.ts`(`patientAttributesOf`)、`components/extract/ExtractResults.tsx`(`BreakdownTable`・`ResultTable`)、`RecordResultTable.tsx`(`RecordListTable`)、`RecordBreakdownView.tsx`(`controls`)、`RecordResultNotices.tsx` |
