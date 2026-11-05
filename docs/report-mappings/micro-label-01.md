# 細菌検査の検体ラベル

細菌検査オーダーの容器に貼るラベル。1 ページ = 容器 1 つ(検体の容器と、別容器の検査項目 = 血液培養のボトル 1 項目ずつ)。
設計は `docs/micro-order-design.md` §7.6。検体検査・病理のラベル(`lab-label-01.md`・`patho-label-01.md`)と同じく
`report_layouts`(DB)には登録せず、リポジトリ同梱の `.tlf` を backend が直接読む(`MicroLabelReport::LAYOUT_PATH`)。

| ファイル | 帳票 |
|---|---|
| `backend/lib/report_layouts/micro_label.tlf` | 細菌検査検体ラベル |

用紙は検体検査のラベルと同じ 60×40mm(仮サイズ)のユーザー定義で、項目の配置は病理のラベルと同じ。差し替えは
ThinReports Basic Editor で `.tlf` を編集してコミットし、backend をデプロイし直す。text-block は vertical-align top にする。

## プレースホルダー

値の流し込みは `backend/app/services/reports/micro_label_renderer.rb`。レイアウトに無い ID は黙って捨てられる。

| ID | 種類 | 内容 |
|---|---|---|
| `barcode_img` | image-block | ラベル番号の CODE128 バーコード |
| `label_number` | text-block | 番号の目視用文字列(11 桁。検体検査の採取管と同じ採番) |
| `pt_id` | text-block | 患者番号 |
| `pt_name` | text-block | 漢字氏名 |
| `pt_kana` | text-block | カナ氏名 |
| `pt_birthdate` | text-block | 生年月日(YYYY/MM/DD) |
| `pt_gender` | text-block | 性別 |
| `specimen_label` | text-block | 「喀出痰 右 耳」(検体種別 + 採取部位) |
| `container_no` | text-block | 「容器 1/3」(オーダー通しの容器番号 / 容器の総数) |
| `specimen_detail` | text-block | 検体の容器は「吸引 塗抹/培養」(採取方法 + 検査項目の略称)、ボトルは項目名「血液培養（好気ボトル）」 |
| `order_date` | text-block | 「予定 2026/11/06 10:00」(検体の採取予定日時。時刻が未定ならオーダーの検査日だけ) |
| `urgent` | text(静的文字) | 「至急」。通常オーダーでは hide される |
