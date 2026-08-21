# 処方箋(院外・院内)

処方一覧(部門ワークリスト)の「処方箋発行」で刷る処方箋。
設計は `docs/prescription-report-design.md` を参照。

| ファイル | 帳票 |
|---|---|
| `backend/lib/report_layouts/prescription_external.tlf` | 院外処方箋(様式第2号、2024年12月改定、A5) |
| `backend/lib/report_layouts/prescription_internal.tlf` | 院内処方箋(簡易様式、A5) |

検体ラベルと同じく `report_layouts`(DB)には登録しない。国の様式と院内の定型で
院内ごとに書き換えるものではないため、リポジトリ同梱の `.tlf` を backend が直接読む
(`PrescriptionReport::LAYOUTS`)。理由の詳細は `lab-label-01.md` を参照。
マッピング定義は使わない(プレースホルダー ID の直接一致のみ)。

差し替えるときは ThinReports Basic Editor で `.tlf` を編集してコミットし、backend を
デプロイし直す。用紙は A5 実寸(419.53 × 595.28 pt)のユーザー定義
(user 用紙は landscape にすると幅・高さが入れ替わるため portrait のまま)。

## プレースホルダー

値の流し込みは `backend/app/services/reports/prescription_renderer.rb`。
レイアウトに無い ID は黙って捨てられるので、必要な項目だけ置けばよい
(院外・院内の欄の差はこの仕組みで吸収している)。

| ID | 種類 | 院外 | 院内 | 内容 |
|---|---|---|---|---|
| `pt_id` | text-block | − | ○ | 患者番号 |
| `pt_name` | text-block | ○ | ○ | 漢字氏名 |
| `pt_kana` | text-block | ○ | ○ | カナ氏名(氏名の上に小さく) |
| `pt_birthdate` | text-block | ○ | ○ | 生年月日(YYYY/MM/DD) |
| `pt_gender` | text-block | ○ | ○ | 性別(男性/女性) |
| `issue_date` | text-block | ○(交付年月日) | ○(処方日) | オーダーの authoredOn |
| `doctor_name` | text-block | ○(保険医氏名) | ○(依頼医師) | requester の display |
| `department_name` | text-block | − | ○(依頼科) | 依頼科拡張の display |
| `rx_category` | text-block | − | ○(区分) | 「外来 院内」「入院 定期」など |
| `rx_content` | text-block | ○ | ○ | 処方内容(整形済みの行、複数行) |
| `remarks` | text-block | ○(備考) | ○(備考) | 処方箋コメント(SR.note) |
| `hospital_name` | text-block | ○ | ○(下端) | 自院の名称 |
| `hospital_address` | text-block | ○ | − | 自院の住所(〒付き) |
| `hospital_tel` | text-block | ○ | − | 自院の電話番号 |
| `hospital_fax` | text-block | −(未配置) | − | 自院の FAX(必要なら枠を足すだけで載る) |
| `pref_no` / `table_no` / `inst_no` | text-block | ○ | − | 保険医療機関コード 10 桁の 2+1+7 分割 |
| `page_no` | text-block | ○ | ○ | 「n / m」 |
| `continued` | text(静的) | ○ | ○ | 「（次頁に続く）」。最終ページ以外で show |

## 処方欄の寸法と行数・桁数の対応

処方内容(`rx_content`)はレンダラが桁数で事前に折り返し、枠の行数を超えたら続紙を
起こす。行数・桁数は `PrescriptionReport::LAYOUTS` の定数と対:

| レイアウト | 処方欄(rx_content) | 行送り | lines_per_page | max_cols(半角) |
|---|---|---|---|---|
| external | 幅 312.5 × 高さ 164 pt、9pt | 12pt | 13 | 68 |
| internal | 幅 373.5 × 高さ 330 pt、9pt | 12pt | 27 | 82 |

処方欄の寸法や行送り(style の line-height。thinreports は line-height-ratio ではなく
この絶対値を読む)を変えたら、定数も合わせて直し、renderer spec の続紙テストで
境界を確かめること。あふれは overflow: truncate で黙って消えるので、ずれると薬が
印字されずに落ちる。

## 様式第2号で空欄にしている欄

保険・公費(保険者番号・公費負担者番号・受給者番号・被保険者証記号番号・区分)、
処方箋の使用期間、変更不可・患者希望のチェック列、リフィル、調剤実施回数(分割)、
調剤済年月日以下の薬局記入欄。いずれも入力機能が無いため枠と見出しだけを描いている。
