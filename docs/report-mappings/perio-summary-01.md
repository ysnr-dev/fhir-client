# 歯周組織検査のまとめ テンプレート

歯周基本検査・歯周精密検査の結果を、患者単位の指標にまとめて記録するテンプレートです。
マルチチャートで HbA1c などの検査値と並べ、歯周病と糖尿病の経過を一緒に追うために作りました。

| ファイル | 用途 |
|---|---|
| `perio-summary-01.questionnaire.json` | テンプレート(Questionnaire)。テンプレート一覧のインポートから取り込む(name: `PERIO_SUM_01`、`http://fhir-client.local/Questionnaire/perio-summary-01|1.0.0`) |

帳票レイアウトはありません。

## 項目

「回答から Observation を生成する」を有効にしてあります(category は `exam`)。
項目コードの system は `http://fhir-client.local/CodeSystem/observation-item` です。

| 項目 | 型 | 単位 | コード | マルチチャート |
|---|---|---|---|---|
| 検査区分(基本検査/精密検査) | choice | | なし | 出さない(記録のみ) |
| 現存歯数 | integer | 本 | DENT-PRESENT-TEETH | 数値 |
| PD 4mm以上の部位数 | integer | 部位 | DENT-PD4-SITES | 数値 |
| PD 6mm以上の部位数 | integer | 部位 | DENT-PD6-SITES | 数値 |
| 最大PD | integer | mm | DENT-MAX-PD | 数値 |
| BOP率 | decimal | % | DENT-BOP-RATE | 数値 |
| PISA | integer | mm² | DENT-PISA | 数値 |
| PCR | decimal | % | DENT-PCR | 数値 |
| 動揺度2度以上の歯数 | integer | 本 | DENT-MOBILITY2-TEETH | 数値 |
| 歯周炎のステージ(I〜IV) | choice | | DENT-PERIO-STAGE | 選択肢の行 |
| 歯周炎のグレード(A〜C) | choice | | DENT-PERIO-GRADE | 選択肢の行 |

- **歯ごとの記録は持ちません。** 1歯6点の値は歯周チャートの役目で、マルチチャートの「患者×時間」の軸には載せません。
  ここには、歯周チャートから集計した値を転記します。
- **ステージとグレードの選択肢は、程度の順に並べてあります。** マルチチャートでは、並び順が濃さの段になります。
- **検査区分には項目コードを付けていません。** 基本検査と精密検査は程度の順ではないので、選択肢の行にすると濃さの意味を取り違えるためです。

## マルチチャートでの使い方(例: 歯周病×糖尿病)

- 数値: HbA1c・空腹時血糖(検査)、BOP率・PD 4mm以上の部位数・PISA(このテンプレート)
- 選択肢の行: 歯周炎のステージ
- 軸: 月 × 24 列
- 対比: X に BOP率、Y に HbA1c、±14 日で組にする。検査と歯科の記録の日がずれることが多いため
- 層別の要約: 歯周基本治療を始めた日を基準日にし、その前後で HbA1c を比べる
