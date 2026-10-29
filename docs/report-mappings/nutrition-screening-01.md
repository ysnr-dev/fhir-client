# 栄養スクリーニング(NUT_SCREEN_01)

入院時の栄養スクリーニングとアセスメント(`docs/nutrition-care-plan-design.md`)。テンプレート一覧のインポートから取り込み、
施設設定「文書作成の督促」の「栄養スクリーニングのテンプレート」に url を設定する。帳票(`.tlf`)は無い。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `nutrition-screening-01.questionnaire.json` | 栄養スクリーニング | `NUT_SCREEN_01` / `http://fhir-client.local/Questionnaire/nutrition-screening-01\|1.0.0` |

カテゴリ **「栄養管理」** を拡張に持たせてある(code `7a1d4c86-2f39-4b05-8e6a-0c9b3d5f2e71`。別環境へ入れるときは
`questionnaire_categories` に同じ code でカテゴリを作るか、作った code へ差し替える)。

## 項目

| グループ | linkId | 項目 | 値 | Observation |
|---|---|---|---|---|
| 身体計測 | `height` / `weight` | 身長・体重 | 初期値 `%bodyHeight` / `%bodyWeight` | |
| | `bmi` | BMI | 計算(`%nutBmi`) | |
| | `usual_weight` | 平常時体重(3〜6 か月前) | | |
| | `weight_loss_rate` | 体重減少率 | 計算(`%nutLossRate`) | |
| MUST | `must_bmi` | BMI の点 | 計算(20 超 0 / 18.5〜20 1 / 18.5 未満 2) | |
| | `must_weight_loss` | 体重減少の点 | 計算(5% 未満 0 / 5〜10% 1 / 10% 超 2、平常時体重が無ければ 0) | |
| | `must_acute` | 急性疾患の影響 | 0 なし / 2 あり | |
| | `must_total` | 合計 | 計算(`%nutMust`。BMI と急性疾患の影響がそろうと入る) | `NUT-MUST-SCORE`(点) |
| | `must_risk` | 栄養リスク | 計算(0 低 / 1 中 / 2 以上 高) | |
| GLIM 基準 | `glim_weight_loss` `glim_low_bmi` `glim_muscle` | 表現型基準 | 0 なし / 1 あり | |
| | `glim_intake` `glim_inflammation` | 病因基準 | 0 なし / 1 あり | |
| | `glim_result` | 判定 | 計算(表現型・病因の両方に 1 つ以上あれば 低栄養) | |
| | `glim_severity` | 重症度 | 1 中等度 / 2 重度 | |
| SGA | `sga_weight` ほか 5 項目 | 病歴・身体所見 | | |
| | `sga_result` | 判定 | A / B / C | `NUT-SGA` |
| 判定 | `nutrition_need` | 特別な栄養管理の必要性 | 01 有 / 02 無 | `NUT-NEED` |
| | `judge_note` | 所見 | | |

- `nutrition_need` は入退院文書が栄養管理計画書の対象を決めるのに読む(入院診療計画書 `ADM_PLAN_01` の同じ欄と共通)。linkId とコードを変えない。
- 計算項目の値は別の式から読めない(フォームの式は入力された回答だけで評価する)ので、MUST の点は変数で組んでいる。
