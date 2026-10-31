# 化学療法実施計画書・スケジュール表

カルテの化学療法タブ「レジメン詳細」の「計画書」(クールごと)と「スケジュール表」、レジメンマスタ編集画面の「公開用PDF」で刷る帳票。
設計は `docs/chemo-regimen-design.md` §8.25 を参照。

| ファイル | 帳票 | 用紙 |
|---|---|---|
| `backend/lib/report_layouts/regimen_plan.tlf` | 化学療法実施計画書(1 クールぶん) | A4 縦 |
| `backend/lib/report_layouts/regimen_schedule.tlf` | 患者向けのスケジュール表(1 ページ = 1 か月) | A4 縦 |
| `backend/lib/report_layouts/regimen_public.tlf` | 外部公開用のレジメン(レジメンマスタ 1 件。患者情報なし) | A4 縦 |

注射箋と同じく `report_layouts`(DB)には登録せず、同梱の `.tlf` を backend が直接読む
(`RegimenReport::PLAN_LAYOUT_PATH` / `SCHEDULE_LAYOUT_PATH`、`RegimenMasterReport::LAYOUT_PATH`)。3 つの `.tlf` は
`docs/report-mappings/gen_regimen_tlf.py` で生成した(backend ディレクトリで実行すると `lib/report_layouts/` に書き出す)。
.tlf を手で直さず、スクリプトを直して再生成すること。

## 実施計画書のプレースホルダー

流し込みは `backend/app/services/reports/regimen_plan_renderer.rb`。

| ID | 種類 | 内容 |
|---|---|---|
| `cycle_title` | text-block | 「第 2 クール」 |
| `pt_id` / `pt_name` / `pt_kana` / `pt_birthdate` / `pt_gender` | text-block | 患者 |
| `regimen_name` / `regimen_status` | text-block | 「mFOLFOX6（900001）」/ 適用の状態(適用中・休止・完了・中止) |
| `purpose` / `emetic_risk` | text-block | 治療目的・制吐リスク(レジメンマスタ) |
| `setting` / `problem` | text-block | 入外区分・対象病名(ヘッダの reasonReference) |
| `cycle_rule` | text-block | 「21 日/クール（投与 14 日・休薬 7 日） · 予定 8 クール」 |
| `cycle_period` | text-block | Day 1 〜 クールの最終日 |
| `body_line` | text-block | 身長・体重(適用時)/ 体表面積(このクールの算出に使った値) |
| `doctor_line` | text-block | 依頼科 \| 依頼医師 |
| `content` | list | 投与表(下記) |
| `remarks` | text-block(複数行) | 適用のコメント |
| `hospital_name` / `printed_on` / `page_no` | text-block | 自院・発行日・「n / m」 |
| `continued` | text(静的) | 「（次頁に続く）」。最終ページ以外で show |

下段の医師・薬剤師(監査)・看護師の確認欄は静的な枠(手書き)。

### 投与表(list `content`)

明細行(高さ 13pt)の text-block を、行の種類ごとに使い分ける。

| 行 | 使う ID | 例 |
|---|---|---|
| 日 | `day` | 「Day1　2026/09/22(火)　注射　［依頼済］」 |
| RP | `step` | 「RP2 オキサリプラチン　点滴 静脈内」「RP1 カペシタビン　１日２回朝夕食後　服用　14日分」 |
| 薬剤 | `role` / `name` / `basis` / `ratio` / `dose` / `packs` | 抗がん剤 / 医薬品名 / 85 mg/m² / 100% / 131.75 mg / 1.32 瓶 |
| 注記 | `note` | 用法コメントの見出し以外(点滴時間・器材・注意)、減量理由 |

1 ページの行数は list の `content-height ÷ detail.height` から決め、ページの頭が日の途中なら「（続き）」の日見出しを補う。

## スケジュール表のプレースホルダー

流し込みは `backend/app/services/reports/regimen_schedule_renderer.rb`。

| ID | 種類 | 内容 |
|---|---|---|
| `pt_name` | text-block | 「がん 花子 様」 |
| `regimen_line` / `month_label` | text-block | 「治療: CapeOX」/「2026年10月」 |
| `d{行}{列}` | text-block | 日付(行 0〜5 = 週、列 0〜6 = 日〜土。月外は空) |
| `c{行}{列}` | text-block(複数行) | 「C1 Day1」「点滴: …」「内服: …」「休薬」(18 桁 × 7 行で折り返し・打ち切り) |
| `contact` | text-block | 自院の名称と電話番号(Organization の telecom phone) |
| `printed_on` / `page_no` | text-block | 発行日・「n / m」 |

## 外部公開用のレジメンのプレースホルダー

流し込みは `backend/app/services/reports/regimen_public_renderer.rb`。

| ID | 種類 | 内容 |
|---|---|---|
| `regimen_title` | text-block | レジメン名 |
| `regimen_code` / `department` | text-block | レジメンコード・診療科 |
| `purpose` / `setting` | text-block | 治療目的・実施区分 |
| `cycle_rule` / `planned_cycles` | text-block | 「21 日（投与 14 日・休薬 7 日）」/「8 クール」(空なら「継続」) |
| `emetic_risk` / `approved_on` | text-block | 制吐リスク・承認日 |
| `content` | list | 本文(下記) |
| `contact` | text-block | 自院の名称と電話番号 |
| `hospital_name` / `printed_on` / `page_no` | text-block | 自院・発行日・「n / m」 |

### 本文(list `content`)

見出しごとに流す(中身の無い見出しは出さない): 適応疾患 → 投与内容 → 投与基準（検査値）→ 減量基準 → 中止基準 → 主な副作用 → 参考文献。

| 行 | 使う ID | 例 |
|---|---|---|
| 見出し | `section` | 「■ 投与内容」 |
| 列名 | `h_role` / `h_name` / `h_basis` / `h_max` | 投与内容の先頭に 1 行 |
| ステップ | `step`(太字) | 「1. オキサリプラチン」 |
| 用法 | `usage` | 「Day 1　点滴　静脈内　末梢ルート　2時間」 |
| 薬剤 | `role` / `name` / `basis` / `max` | 抗がん剤 / 医薬品名 / 85 mg/m² / 上限 |
| 注記 | `note` | 薬剤のコメント、器材・投与時注意 |
| 本文 | `body` | 自由記述・検査基準・副作用 |

行の高さは 15pt(実施計画書より広い)で、ステップの間は 1 行空ける。見出しをページの最終行に残さず、ページの頭が用法・薬剤の途中なら「（続き）」のステップ見出しを補う。
