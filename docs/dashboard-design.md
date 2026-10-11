# ダッシュボード 設計

データ抽出(docs/data-extract-design.md)で保存した条件を、タイルとして好きな位置・大きさに並べて
1 画面で見渡す機能。並べ方はダッシュボードとして名前を付けて保存する。
メニューは「データ > ダッシュボード」(`/dashboards`)。

## 1. 方針

- ダッシュボードは「どの保存条件を、どこに、どう見せるか」だけを持つ。抽出の中身(条件)は持たず、
  保存条件を `code` で指す(条件を直せばダッシュボードにもそのまま効く。環境をまたいでも同じ条件を指す)。
- 抽出の実行はデータ抽出と同じく画面が上流 FHIR を引いて行う。backend は形を確かめて預かるだけ。
- 結果は DB に残さない。開いた直後のタイルは枠と条件名だけで、「更新」で実行して実行時点の結果を出す。
  過去の状況を見たいときは、条件の期間(絶対日付)で検索する。期間ごとの推移は記録タブの内訳(行=期間)のグラフで出す。
- 開いただけでは上流を叩かない(タイルが多いと 1 トークン 300 件/分のレート制限に当たるため)。
- 新しいトップレベルパスは足さない(API は `/master/dashboards`、画面は `/dashboards`)。
  `vite.config.ts` と `render.yaml` の変更は不要。

## 2. 置ける条件とタイルの表示

「患者」タブと記録タブ(病名・入院外来・テンプレート・検査結果・投薬・細菌検査・手術・実施・有害事象・パス)の
保存条件すべてを置ける。タイルごとに表示(`view`)を選ぶ。

| 表示 | 「患者」タブの条件 | 記録タブの条件 |
|---|---|---|
| `count`(件数) | 該当人数 | 件数と人数 |
| `breakdown`(内訳) | 性別 × 年齢帯の表(`extractBreakdown`) | 保存した切り口(`definition.breakdown`)の表とグラフ。行が期間なら推移の折れ線 |
| `list`(一覧) | 患者の一覧(患者番号・氏名・出力項目) | 記録の一覧(`RecordResultTable` の一覧) |

- 一覧は画面に並べるだけなので先頭だけを出し、切ったことを `TruncatedNotice` で示す(すべてはデータ抽出で開いて見る)。
- タイルの中では切り口を変えない(変えたいときはデータ抽出で開いて条件を直して保存する)。

### 記録タブの実行の切り出し(前提の作業)

今は記録タブの各パネル(`components/extract/*ExtractPanel.tsx`)が、入力欄の state から実行の条件を組み立てている
(例 `ConditionExtractPanel.tsx` の `handleRun`)。保存定義だけで実行できるよう、タブごとに次を切り出す。

- `definition → 実行の条件` の純粋関数(`fhir/*ExtractHelpers.ts` に置く)。パネルの `handleRun` もこれを使う。
- 患者の絞り込み・比較群・担当医(`hooks/useExtractPatientScope.ts`)の `resolve` を、state ではなく
  定義(`patient_query_code` / `patient_folder_id` / `strata` / `strata_only` / `attending`)を引数に取る形にする。
  パネルは今の state から定義を作って渡す。
- 実行結果 → 表の見出しと行(`RecordTableRow[]`)の関数(パネルの `tableHeader` / `tableRows` 相当)。
- これらをタブ → 実装の対応表 `fhir/extractTabRunners.ts`(仮)に 1 行ずつ並べ、タイルはタブで引く
  (タブごとの if を並べない)。

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
- タイルは 40 個まで。重なりは backend では拒否しない(画面が詰めて保存する)。
- `query_code` の存在は検証しない(条件を消したタイルは画面で「条件が見つかりません」と出す)。
- 形の検証は `JsonShape`(`ExtractQuery::DEFINITION_SHAPE` と同じ書き方)。

## 4. 画面

### 表示

- 上部: ダッシュボードの選択(`ExtractQuerySelect` と同じ作り)、「更新」「編集」「新規」。
- 本体: CSS grid(`grid-template-columns: repeat(12, 1fr)`、`grid-row` / `grid-column` に x/y/w/h)でタイルを並べる。
  狭い画面では 1 列に積む。
- タイル: 見出し(タイトル・実行日時)、本体(§2 の表示)、ケバブメニュー(RowMenu)に
  「更新」「データ抽出で開く」(`/data-extract?tab=<tab>&query=<id>`)。
- 「更新」は全タイルを上から順に 1 つずつ実行する(並列にしない)。実行中は進み具合を出し、「中止」できる。
  同じ条件を置いたタイルは 1 回の実行を共有する。タイル単位の更新はケバブメニューから。
- 結果はページを開いている間だけ持つ(別のダッシュボードに切り替えたら捨てる)。

### 編集

- 「編集」で編集モードにする。タイルを掴んで動かす・右下の角で大きさを変える・ゴミ箱アイコンで削除。
- 掴む処理は `hooks/useCardDrag.ts`(Pointer Events)を使う。マスへの丸めと重なりの解消
  (動かしたタイルとぶつかるタイルを下へ押し出す)は純粋関数 `fhir/dashboardLayout.ts` に置く
  (病棟マップの `fhir/wardMapHelpers.ts` と同じ分け方)。取り消しは `hooks/useUndoableState.ts`。
- 「タイル追加」はモーダルで、タブ・保存条件(見える持ち主すべて)・表示を選ぶ。
  空いている最初の位置に既定の大きさ(`count` 3×2、`breakdown` 6×4、`list` 12×6)で置く。
- 「保存」「別名保存」「削除」はデータ抽出の条件と同じ操作(持ち主の選択は `useDefinitionOwners`、`SaveQueryModal` 相当)。
  未保存の変更があるときは切り替え時に確認する。

## 5. API

`/master/dashboards`(`resources :dashboards, only: %i[index show create update destroy]`)。

- `Master::DashboardsController` は `ScopedDefinitions` を include するだけ。
  読みは誰でも、自分(医師スコープ)の書き換えは本人だけ(backend)。院内共通・診療科の書き込みは画面で医師に限る。
- frontend: `api/masterClient/dashboard.ts`、`api/masterQueries/dashboard.ts`(`useDashboards` / `useDashboardMutations`)。

## 6. 主なファイル

| 区分 | ファイル |
|---|---|
| backend | `db/migrate/*_create_dashboards.rb`、`app/models/dashboard.rb`、`app/controllers/master/dashboards_controller.rb`、`config/routes.rb`、`spec/requests/master/dashboards_spec.rb` |
| frontend | `pages/DashboardPage.tsx`、`components/dashboard/*`(グリッド・タイル・タイル追加)、`fhir/dashboardLayout.ts`、`fhir/extractTabRunners.ts`、`App.tsx`(「データ」メニューと route) |
| 再利用 | `components/extract/ExtractResults.tsx`(`BreakdownTable`・`ResultTable` を export)、`RecordResultTable` / `RecordBreakdownView` / `RecordBreakdownChart`、`api/queries/extractQuery.ts`(`useExtractRun`)と記録タブの `use*Extract`、`api/masterQueries/extractQuery.ts`(`useExtractQueries`) |

## 7. 進め方

1. 記録タブの実行の切り出し(§2)。データ抽出の画面の動きは変えない。
2. backend(`dashboards`)と API。
3. 表示(「患者」タブ → 記録タブ)。
4. 編集(配置・大きさ・追加・削除・保存)。
