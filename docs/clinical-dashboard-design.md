# 診療ダッシュボード 設計

カルテ左ペインのタブ(経過表・検体検査・投薬歴・カルテのタイムラインなど)をカードとして好きな位置・大きさに並べ、
1 患者を 1 画面で読む機能。並べ方は診療ダッシュボードとして名前を付けて保存する。
カルテ左ペインの「その他」→「診療ダッシュボード」(`?tab=clinical-dashboard`)。
データ抽出の条件を並べる分析ダッシュボード(docs/dashboard-design.md)とはマス目の処理と保存の形を共有する。

## 1. 方針

- ダッシュボードは「どのタブを、どこに、どの大きさで」だけを持つ。患者のデータは持たず、開いている患者で各カードを描く。
- カードの中身はタブと同じ部品(`components/KarteTabPanel.tsx`)をそのまま使う。カード用の縮小版は作らない
  (タブの中でできる操作はカードの中でも同じ。右ペイン・詳細モーダルはカルテ画面のものを使う)。
- 基準日は 1 つの仕組みで渡す。各部品は任意の prop `baseDate`(「表示の既定を決める日。無ければ今日」)を受け、
  ダッシュボードは基準日を変えたら全カードを `key` で作り直す(部品は初期値の導出にだけ `baseDate` を使い、
  変化に追従する effect を持たない)。
- 新しいトップレベルパスは足さない(API は `/master/clinical_dashboards`)。

## 2. 置ける種別と基準日の意味

種別は `karteUrl.ts` の `KARTE_TABS` から、カルテ印刷・SMART アプリ・診療ダッシュボード自身を除いたもの
(`fhir/clinicalDashboardLayout.ts` の `CLINICAL_DASHBOARD_CARD_KINDS`。一覧を二重に持たない)。

| 種別 | 基準日の意味 |
|---|---|
| カルテ(`karte`、`components/KarteTimelineCard.tsx`) | その日(無ければそれより前で最も新しい診療日)が先頭に来る位置へスクロール。まだ読んでいない範囲なら読み進めてから合わせる |
| 経過表・マルチチャート・投薬歴 | view に基準日が無いときの既定の基準日(右端)。`format*View` の「既定なら省く」基準も基準日 |
| 注射カレンダー | 既定の表示開始日 = 基準日 − 既定の遡り日数 |
| 食事・化学療法 | 暦の初期の月(化学療法は適用の開始月と基準日の月の遅い方) |
| クリニカルパス | 日めくりの既定の病日(遅れ判定・セルの色・実施の既定時刻は今日のまま) |
| 指示簿・看護計画 | その日に有効な指示・問題(実施入力は今日) |
| 予約 | 期間指定の開始日 = 基準日の 1 か月前 |
| 検体検査・細菌検査・病理検査・放射線検査・生理検査・内視鏡 | 開くレポート = 基準日以前で最新(`latestSummaryOnOrBefore`)。無ければ最新 |
| 病名・プロファイル・アレルギー・持参薬・口腔診査情報・看護プロファイル・ファイル・DICOM・検体検査時系列 | 影響しない |

カードの表示状態(タブの `view` に当たるもの)はダッシュボードがカードごとに持ち、基準日を変えたら空に戻す。

## 3. データの置き場所

backend の DB に持つ(上流 FHIR には置かない)。

| 表 | 主な列 |
|---|---|
| `clinical_dashboards` | `code`(uuid)、`scope`(`facility` / `department` / `practitioner`)、`owner_id`、`owner_name`、`name`、`definition`(jsonb)、`display_order`、`active` |

持ち主と権限は分析ダッシュボードと同じ(`Master::ScopedDefinitions`)。チームには保存しない(`ClinicalDashboard::SCOPES`)。

### definition の形

```json
{ "schema_version": 1,
  "cards": [
    { "id": "c1", "kind": "flowsheet", "title": "経過表", "x": 0, "y": 0, "w": 12, "h": 8 },
    { "id": "c2", "kind": "lab", "x": 0, "y": 8, "w": 6, "h": 8, "zoom": 80 } ] }
```

- 位置と大きさはマス(横 12 列、縦は 1 マス固定の高さで下へ伸びる)の整数。`x + w <= 12`。
- `title` は省略でき、無ければタブの名前を出す。
- `zoom` はカードの中身の表示倍率(%、50〜100)。省略は 100(画面は 100% を選ぶとキーを落とす)。
- カードは 20 個まで。重なりは backend では拒否しない(画面が読み込むときに `normalizeClinicalDashboard` で解く)。
- `kind` の値は検証しない(種別の一覧は画面にしか無い)。知らない種別のカードは画面が「この種別は表示できません」と出す。
- 形の検証は `JsonShape`(`ClinicalDashboard::DEFINITION_SHAPE`)。

## 4. 画面(`components/KarteClinicalDashboardTab.tsx`)

- タイトル行: マルチチャートと同じ作り(`.patient-chart__toolbar`。操作の大きさも同じ)。画面の名前、ダッシュボードの選択
  (`ExtractQuerySelect`。持ち主ごとにまとめる)、基準日(前の日 / 日付 / 次の日 / 今日。既定は今日)、「編集」「削除」「全画面」。
  選択中の id は `?view=<id>`。view が空なら前回選んだもの(localStorage、`karteLayout.ts`)を開き、無ければ「新しいダッシュボード」(編集モード)。
- 全画面: 経過表・マルチチャートと同じ枠(`.clinical-dashboard--fullscreen`)。上端は `hooks/useKarteFullscreenTop.ts`
  (カルテのレイアウトの上端を実測。経過表・マルチチャート・投薬歴・パスシートと共通)で決め、Escape でも抜けられる(`useEscapeClose`)。
  全画面は URL に載せない(view はダッシュボードの id)。
- 本体: 分析ダッシュボードと同じ CSS grid(`.dashboard__grid`)。カードの枠は `components/dashboard/DashboardTileFrame.tsx`
  (分析ダッシュボードのタイルと共通)、中身は `KarteTabPanel`(カルテは `KarteTimelineCard`)。
  `.clinical-dashboard` の修飾で本体の溢れを隠し、中の `.karte-tabpanel` / タイムラインがスクロールする。
- 編集: 「カード追加」(`components/dashboard/AddClinicalCardModal.tsx`。種別とタイトル。空いている最初の位置に既定の大きさ
  (12×8)で置く)、見出しを掴んで動かす・右下の角で大きさを変える(`hooks/useGridTileDrag.ts`)、
  ゴミ箱で削除、表示倍率(見出しの選択。100〜60%、`CLINICAL_CARD_ZOOMS`)、元に戻す / やり直す(`hooks/useUndoableState.ts`)。
- 表示倍率: タブの部品は文字の大きさを px で持つので、文字だけでなく中身ごと CSS `zoom` で縮める
  (本体に `--card-zoom` を渡す)。カードの外(ビューポート基準)に出るもの(モーダル・`escapesClipping` の RowMenu・
  テンプレート選択・吹き出し・各タブの全画面・DICOM ビューア)は `App.css` で倍率を打ち消し、カルテのタブと同じ大きさで出す。
  ビューポート基準で出すものを足したら、その打ち消しの一覧にも加える。
- 保存: 「保存」「別名保存」は分析ダッシュボードと同じ(`useDefinitionOwners` からチームを除く、`SaveQueryModal`)。
  未保存の変更があるときは切り替え時に確認する。

## 5. API

`/master/clinical_dashboards`(`resources :clinical_dashboards, only: %i[index show create update destroy]`)。

- `Master::ClinicalDashboardsController` は `ScopedDefinitions` を include するだけ。`team_id` は受けるが無視する。
- frontend: `api/masterClient/clinicalDashboard.ts`、`api/masterQueries/clinicalDashboard.ts`
  (`useClinicalDashboards` / `useClinicalDashboardMutations`)。

## 6. 主なファイル

| 区分 | ファイル |
|---|---|
| backend | `db/migrate/20261022090000_create_clinical_dashboards.rb`、`app/models/clinical_dashboard.rb`、`app/controllers/master/clinical_dashboards_controller.rb`、`spec/requests/master/clinical_dashboards_spec.rb` |
| frontend | `components/KarteClinicalDashboardTab.tsx`、`components/KarteTimelineCard.tsx`、`components/dashboard/AddClinicalCardModal.tsx`、`fhir/clinicalDashboardLayout.ts`、`karteUrl.ts`(`KARTE_TABS` / `KARTE_TAB_GROUPS`)、`karteLayout.ts` |
| 分析ダッシュボードと共有 | `fhir/dashboardLayout.ts`(マス目の純粋関数)、`hooks/useGridTileDrag.ts`、`components/dashboard/DashboardTileFrame.tsx`、`components/extract/SaveQueryModal.tsx`・`ExtractQuerySelect.tsx`、`hooks/useDefinitionOwners.ts` |
| カルテと共有 | `components/KarteTabPanel.tsx`(タブの部品と `KartePanelActions`)、`hooks/useKarteTimelineFeed.ts`(タイムラインの読み込み)、`hooks/useKarteFullscreenTop.ts`(全画面の上端) |
