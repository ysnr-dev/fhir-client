# 褥瘡対策に関する診療計画書(PU_PLAN_01)

診療報酬の様式「別紙3 褥瘡対策に関する診療計画書」を入力・帳票出力するためのテンプレート一式(`docs/pressure-ulcer-plan-design.md`)。

| ファイル | 用途 |
|---|---|
| `pressure-ulcer-plan-01.questionnaire.json` | テンプレート。name `PU_PLAN_01`、`http://fhir-client.local/Questionnaire/pressure-ulcer-plan-01\|1.0.0`。カテゴリ「褥瘡」 |
| `pressure-ulcer-plan-01.tlf` | A4 縦の ThinReports レイアウト。`/report-layouts` で登録する |
| `pressure-ulcer-plan-01.mapping.json` | 褥瘡の有無・日常生活自立度・危険因子の □ を ■ に切り替えるマッピング定義 |
| `gen_pressure_ulcer_plan_tlf.py` | 上の 2 ファイルを生成するスクリプト(`python3 gen_pressure_ulcer_plan_tlf.py`) |

カテゴリ「褥瘡」は `pressure-ulcer-designr-01` と同じ code(`3f0c9a52-7d61-4b8e-9a2c-5e1b7c4d8f02`)。

## 使い方

1. テンプレート一覧 → インポートで `pressure-ulcer-plan-01.questionnaire.json` を取り込む。
2. `/report-layouts` で新規登録: canonical にこのテンプレートを選び、`pressure-ulcer-plan-01.tlf` をアップロードし、
   マッピング定義に `pressure-ulcer-plan-01.mapping.json` の中身を貼る(空にすると ■ が出ない)。
3. 施設設定「文書作成の督促」の「褥瘡リスク評価のテンプレート」に看護プロファイルの「褥瘡リスク」
   (`nursing-profile-pressure-ulcer-01`)を、「褥瘡対策計画書のテンプレート」にこのテンプレートの url を設定する。

## 項目と帳票

linkId = レイアウトのアイテム ID。メタ情報は患者氏名 `pt_name`・性別 `pt_gender`・生年月日 `pt_birthdate`・年齢 `pt_age`、
計画作成日 `qr_authored`。

| グループ | linkId | 項目 | 備考 |
|---|---|---|---|
| 病棟・記入者 | `ward` / `physician` / `nurse` | 病棟・記入医師名・記入看護師名 | 初期値 `%ward` / `%attending` / `%authorName` |
| 褥瘡の有無 | `pu_present` | 現在 | 0 なし / 1 あり → `mark_pu_present_<code>`。初期値は同じ入院の褥瘡リスク |
| | `pu_current_site` / `pu_current_site_other` | 部位(チェックボックス)・その他の部位 | 仙骨部・坐骨部・尾骨部・腸骨部・大転子部・踵部・その他 |
| | `pu_onset_date` | 褥瘡発生日 | |
| | `designr_d` 〜 `designr_p` / `designr_total` | DESIGN-R2020 の 7 項目と合計点(深さを除く) | 選択肢・合計の式は `PU_DESIGNR_01` と同じ。Observation は作らない |
| | `pu_past` / `pu_past_site` / `pu_past_site_other` | 過去・部位・その他の部位 | 0 なし / 1 あり → `mark_pu_past_<code>` |
| 危険因子の評価 | `pu_bedridden_level` | 日常生活自立度 J1〜C2 | → `mark_pu_bedridden_level_<code>`。初期値は同じ入院の褥瘡リスク |
| | `pu_risk_turn` / `pu_risk_sit` / `pu_risk_bone` / `pu_risk_contracture` / `pu_risk_nutrition` / `pu_risk_moisture` / `pu_risk_edema` / `pu_risk_skintear` | 危険因子 8 項目 | 0 / 1(あり・できない) → `mark_<linkId>_<code>`。初期値は同じ入院の褥瘡リスク |
| | `pu_count` / `pu_plan` | 該当する危険因子・看護計画の立案(要 / 不要) | 計算式(変数 `%puRisk` / `%puNeed`) |
| 看護計画 | `care_pressure_bed` / `care_pressure_chair` | 圧迫・ズレ力の排除(ベッド上・イス上) | |
| | `care_skin` / `care_nutrition` / `care_rehab` | スキンケア・栄養状態改善・リハビリテーション | |
| 評価 | `reassess_date` | 評価の予定日 | 入退院文書の再評価の期限に使う。linkId を変えない |
| | `evaluation` | 評価 | |

- 褥瘡の有無・日常生活自立度・危険因子の linkId と選択肢のコードは看護プロファイルの「褥瘡リスク」と同じ(初期値の写しと
  入退院文書の判定が linkId で読む)。

## 検証済みの内容

- frontend の `parseQuestionnaireForm` + `validateQuestionnaireForm` を通り、parse → build の往復で一致する(ファイルは往復後の正規形)。
  上流の `POST /Questionnaire/$validate` も通る。
- `Reports::ThinreportsRenderer` で全項目記入の PDF を生成して罫線・■ の出し分けを確認した。
