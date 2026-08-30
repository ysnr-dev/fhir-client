# 注射箋(注射指示票)・注射ラベル

注射一覧(部門ワークリスト)の「注射箋発行」「注射ラベル発行」で刷る帳票。
設計は `docs/injection-order-design.md` §5.4 を参照。

| ファイル | 帳票 | 用紙 |
|---|---|---|
| `backend/lib/report_layouts/injection_order.tlf` | 注射箋(注射指示票を兼ねる) | A5(419.53 × 595.28 pt) |
| `backend/lib/report_layouts/injection_label.tlf` | 注射ラベル(1 ページ = RP 1 つ) | 60 × 40 mm(170.1 × 113.4 pt。検体ラベルと同じ) |

処方箋・検体ラベルと同じく `report_layouts`(DB)には登録せず、リポジトリ同梱の `.tlf` を
backend が直接読む(`InjectionReport::ORDER_LAYOUT` / `LABEL_LAYOUT_PATH`)。
マッピング定義は使わない(プレースホルダー ID の直接一致のみ)。2 つの `.tlf` は
`docs/report-mappings/gen_injection_tlf.py` で生成した(backend ディレクトリで実行すると
`lib/report_layouts/` に書き出す)。手直しは ThinReports Basic Editor で `.tlf` を直接
編集してもよいが、text-block の vertical-align は top を保つこと(middle だと値がページ
中央へ流れる)。

## 注射箋のプレースホルダー

流し込みは `backend/app/services/reports/injection_renderer.rb`。

| ID | 種類 | 内容 |
|---|---|---|
| `pt_id` / `pt_name` / `pt_kana` / `pt_birthdate` / `pt_gender` | text-block | 患者 |
| `issue_date` | text-block | 注射日(オーダーの authoredOn) |
| `rx_category` | text-block | 「入院 定時」など(入外区分 + 注射区分) |
| `ward_name` | text-block | 病棟(order-ward 拡張の display) |
| `doctor_line` | text-block | 「内科 \| 児玉 義憲」(依頼科 \| 依頼医師) |
| `series_label` | text-block | 「連日 3日目(8/30〜)」「隔日(8/30〜)」。単日は空 |
| `rx_content` | text-block(複数行) | 注射内容(整形済みの行) |
| `remarks` | text-block | 注射コメント(SR.note) |
| `hospital_name` | text-block | 自院の名称 |
| `page_no` | text-block | 「n / m」 |
| `continued` | text(静的) | 「（次頁に続く）」。最終ページ以外で show |

下段の「実施記録（時刻・実施者）」欄は静的な枠だけ(病棟が手書きする)。これがあるので
注射指示票を別様式にしていない。

### 注射内容の行

```
RP1　点滴 | 静脈注射 | 静脈内 | 左前腕 | 末梢ルート | 100mL/h
　生理食塩液　１．３Ｌ 1袋（薬剤コメント）
　開始: 10:00、20:30　（用法コメント）
```

RP 見出しの用法はカルテの注射カードと同じ並び(`Reports::InjectionMeta.usage_summary`
= frontend の `injectionUsageSummary`)。変えるときは両方を揃える。

### 内容欄の寸法と行数・桁数

| 内容欄(rx_content) | 行送り | lines_per_page | max_cols(半角) |
|---|---|---|---|
| 幅 373.5 × 高さ 276 pt、9pt | 12pt | 23 | 82 |

寸法や行送りを変えたら `InjectionReport::ORDER_LAYOUT` の定数も合わせて直し、renderer spec の
続紙テストで境界を確かめること(あふれは truncate で黙って消える)。

## 注射ラベルのプレースホルダー

流し込みは `backend/app/services/reports/injection_label_renderer.rb`。

| ID | 種類 | 内容 |
|---|---|---|
| `barcode_img` | image-block | 患者番号の CODE128(ASCII でない番号は刷らない) |
| `urgent` | text(静的) | 「至急」。注射区分が緊急(emergency)のとき show |
| `rp_label` | text-block | 「RP1 / 2　10:00、20:30」(RP 番号 / RP 総数 + 開始時刻) |
| `pt_id` / `pt_name` / `pt_kana` / `pt_birthdate` / `pt_gender` | text-block | 患者(漢字氏名も出す。検体ラベルと違いベッドサイドで本人確認に使うため) |
| `medicines` | text-block(複数行、3 行) | 薬剤名と量。4 剤以上は truncate で切れるので注射箋を併用 |
| `usage` | text-block | 用法 1 行 |
| `order_date` | text-block | 注射日 |

ラベル番号の採番は持たない(RP はオーダー内の連番で、検体ラベルのような台帳が要らない)。
