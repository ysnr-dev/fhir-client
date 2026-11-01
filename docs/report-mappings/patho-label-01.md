# 病理検体ラベル

病理検査オーダーの容器に貼るラベル。1 ページ = 容器 1 つ(オーダーの容器の総数ぶん)。
設計は `docs/patho-order-design.md` §4.10。検体検査のラベル(`lab-label-01.md`)と同じく `report_layouts`(DB)には
登録せず、リポジトリ同梱の `.tlf` を backend が直接読む(`PathoLabelReport::LAYOUT_PATH`)。

| ファイル | 帳票 |
|---|---|
| `backend/lib/report_layouts/patho_label.tlf` | 病理検体ラベル |

用紙は検体検査のラベルと同じ 60×40mm(仮サイズ)のユーザー定義。差し替えは ThinReports Basic Editor で `.tlf` を
編集してコミットし、backend をデプロイし直す。text-block は vertical-align top にする(middle は中央へ流れる)。

## プレースホルダー

値の流し込みは `backend/app/services/reports/patho_label_renderer.rb`。レイアウトに無い ID は黙って捨てられる。

| ID | 種類 | 内容 |
|---|---|---|
| `barcode_img` | image-block | ラベル番号(ユニーク ID)の CODE128 バーコード |
| `label_number` | text-block | 番号の目視用文字列(11 桁。検体検査の採取管と同じ採番) |
| `pt_id` | text-block | 患者番号 |
| `pt_name` | text-block | 漢字氏名 |
| `pt_kana` | text-block | カナ氏名 |
| `pt_birthdate` | text-block | 生年月日(YYYY/MM/DD) |
| `pt_gender` | text-block | 性別 |
| `specimen_label` | text-block | 「検体1 右 胃前庭部」(検体番号 + 左右 + 臓器・検査材料) |
| `container_no` | text-block | 「容器 2/3」(オーダー通しの容器番号 / 容器の総数) |
| `specimen_detail` | text-block | 「組織診・生検・EMR・3個」(検査区分・検体タイプ・採取法・検体個数) |
| `order_date` | text-block | 採取を記録していれば「採取 YYYY/MM/DD」、まだなら採取予定日で「予定 YYYY/MM/DD」 |
| `urgent` | text(静的文字) | 「至急」。通常オーダーでは hide される |
