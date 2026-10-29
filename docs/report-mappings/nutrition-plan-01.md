# 栄養管理計画書(NUT_PLAN_01)

診療報酬の様式「別紙23 栄養管理計画書」を入力・帳票出力するためのテンプレート一式(`docs/nutrition-care-plan-design.md`)。

| ファイル | 用途 |
|---|---|
| `nutrition-plan-01.questionnaire.json` | テンプレート。name `NUT_PLAN_01`、`http://fhir-client.local/Questionnaire/nutrition-plan-01\|1.0.0`。カテゴリ「栄養管理」 |
| `nutrition-plan-01.tlf` | A4 縦の ThinReports レイアウト。`/report-layouts` で登録する |
| `nutrition-plan-01.mapping.json` | 栄養補給方法・栄養食事相談の □ を ■ に切り替えるマッピング定義 |
| `gen_nutrition_plan_tlf.py` | 上の 2 ファイルを生成するスクリプト(`python3 gen_nutrition_plan_tlf.py`) |

## 使い方

1. テンプレート一覧 → インポートで `nutrition-plan-01.questionnaire.json` を取り込む。
2. `/report-layouts` で新規登録: canonical にこのテンプレートを選び、`nutrition-plan-01.tlf` をアップロードし、
   マッピング定義に `nutrition-plan-01.mapping.json` の中身を貼る(空にすると ■ が出ない)。
3. 施設設定「文書作成の督促」の「栄養管理計画書のテンプレート」に url を設定する。

## 項目と帳票

linkId = レイアウトのアイテム ID。メタ情報は患者氏名 `pt_name`・カナ `pt_kana`・性別 `pt_gender`・生年月日 `pt_birthdate`・
年齢 `pt_age`、計画作成日 `qr_authored`。

| グループ | linkId | 項目 | 備考 |
|---|---|---|---|
| 病棟・担当者 | `ward` / `attending` / `dietitian` / `admission_date` | 病棟・担当医師名・担当管理栄養士名・入院日 | 初期値 `%ward` / `%attending` / `%authorName` / `%admissionDate` |
| 栄養状態 | `risk` / `assessment` | 入院時栄養状態に関するリスク・栄養状態の評価と課題 | `risk` の初期値は同じ入院の栄養スクリーニング(`%admissionAnswers` の `must_total` / `must_risk` / `glim_result` / `glim_severity` / `sga_result`)を「MUST 2点(高)、GLIM 低栄養(中等度)、SGA B」の形で |
| 栄養管理計画 | `goal` | 目標 | |
| | `energy` / `protein` / `water` / `supply_other` | 栄養補給量(kcal / g / mL / その他) | `energy` / `protein` の初期値は目安の下限 `%targetEnergyMin` / `%targetProteinMin` |
| | `supply_route` | 栄養補給方法 | チェックボックス oral 経口 / enteral 経腸栄養 / parenteral 静脈栄養 → `mark_route_<code>` |
| | `meal_content` / `supply_note` | 食事内容・留意事項 | `meal_content` の初期値はいまの食事オーダー `%mealDiet` |
| 栄養食事相談 | `counsel_admission` / `counsel_inpatient` / `counsel_discharge` | 入院時栄養食事指導・栄養食事相談・退院時の指導の必要性 | 01 なし / 02 あり → `mark_<linkId>_<code>`。それぞれ `_detail`(内容)・`_date`(実施予定日) |
| | `counsel_note` | 備考 | |
| その他 | `other_issues` | その他栄養管理上解決すべき課題に関する事項 | |
| | `reassess_date` | 栄養状態の再評価の時期 | 入退院文書の再評価の期限に使う。linkId を変えない |
| | `discharge_evaluation` | 退院時及び終了時の総合的評価 | |

## 検証済みの内容

- 2 本とも frontend の `parseQuestionnaireForm` + `validateQuestionnaireForm` を通り、parse → build の往復で一致する
  (ファイルは往復後の正規形)。上流の `POST /Questionnaire/$validate` も通る。
- ReportLayout のモデル検証を通り、`Reports::ThinreportsRenderer` で全項目記入の PDF を生成して罫線・■ の出し分けを確認した。
