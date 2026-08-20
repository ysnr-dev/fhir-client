# 検体ラベル

検体検査一覧(部門ワークリスト)の「ラベル発行」で刷る、採取管に貼るラベル。
1 ページ = 採取管 1 本(オーダー内の検体・採取管グループ 1 つ)。
設計は `docs/lab-label-design.md` を参照。

| ファイル | 帳票 |
|---|---|
| `backend/lib/report_layouts/lab_label.tlf` | 検体ラベル |

他の帳票と違い、`report_layouts`(DB)には登録しない。バーコードの読み取りに合わせた
固定様式で院内が書き換えるものではないため、リポジトリ同梱の `.tlf` を backend が
直接読む(`LabLabelReport::LAYOUT_PATH`)。環境ごとの登録作業が要らず、コードと様式の
版が揃う。`.tlf` は backend の Docker ビルドコンテキスト(`./backend`)の中に置く必要が
あるので `docs/` ではなく `backend/lib/report_layouts/` に置く。
マッピング定義は使わない(プレースホルダー ID の直接一致のみ)。

差し替えるときは ThinReports Basic Editor で `.tlf` を編集してコミットし、backend を
デプロイし直す(管理画面からの操作は無い)。

用紙は 60×40mm(仮サイズ)のユーザー定義。ラベルプリンタ・用紙が決まったら
`.tlf` の `report.width` / `report.height`(pt = mm × 72 ÷ 25.4)と配置を合わせる。
注意: user 用紙で `orientation: landscape` にすると幅・高さが入れ替わるため、
実寸を width / height に直接書いて portrait のままにする。

## プレースホルダー

値の流し込みは `backend/app/services/reports/lab_label_renderer.rb`。
レイアウトに無い ID は黙って捨てられるので、必要な項目だけ置けばよい。

| ID | 種類 | 内容 |
|---|---|---|
| `barcode_img` | image-block | 検体ラベル番号の CODE128 バーコード |
| `label_number` | text-block | 番号の目視用文字列(11 桁) |
| `pt_id` | text-block | 患者番号 |
| `pt_name` | text-block | 漢字氏名(既定レイアウトでは未使用) |
| `pt_kana` | text-block | カナ氏名 |
| `pt_gender` | text-block | 性別(男性/女性) |
| `pt_birthdate` | text-block | 生年月日(YYYY/MM/DD) |
| `order_date` | text-block | 検査日(オーダーの authoredOn) |
| `specimen_name` | text-block | 検体名(未設定なら「検体未設定」) |
| `container_name` | text-block | 採取管(色)。「EDTA管（紫）」。採取管マスタの short_name と cap_color |
| `items` | text-block | グループ内の検査項目(略称優先、「・」区切り) |
| `urgent` | text(静的文字) | 「至急」。通常オーダーでは hide される |
