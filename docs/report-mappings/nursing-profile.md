# 看護プロファイルの雛形テンプレート

看護プロファイル(`docs/nursing-profile-design.md`)の区画の雛形。テンプレート一覧のインポートから取り込み、
管理 > 施設設定「看護プロファイルの区画」で並べる。施設の様式に合わせて複製・修正して使う想定。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `nursing-profile-admission-01.questionnaire.json` | 入院時情報 | `NP_ADMIT_01` / `http://fhir-client.local/Questionnaire/nursing-profile-admission-01\|1.0.0` |
| `nursing-profile-adl-01.questionnaire.json` | 生活・ADL | `NP_ADL_01` / `http://fhir-client.local/Questionnaire/nursing-profile-adl-01\|1.0.0` |
| `nursing-profile-fall-01.questionnaire.json` | 転倒・転落リスク | `NP_FALL_01` / `http://fhir-client.local/Questionnaire/nursing-profile-fall-01\|1.0.0` |
| `nursing-profile-pressure-ulcer-01.questionnaire.json` | 褥瘡リスク | `NP_PU_01` / `http://fhir-client.local/Questionnaire/nursing-profile-pressure-ulcer-01\|1.0.0` |

カテゴリ **「看護プロファイル」** を拡張に持たせてある(code `d2a7c5e1-3b84-4f6a-9e10-7c4b2a8f5e36`。別環境へ入れるときは
`questionnaire_categories` に作った code へ差し替えるか、同じ code でカテゴリを作る)。帳票(`.tlf`)は無い。

## 入院時情報

| グループ | 項目 |
|---|---|
| 入院の経緯 | 入院経路 / 入院時の移動 / 入院までの経過 / 情報提供者(複数) |
| 病気・入院の受け止め | 医師からの説明 / 本人の受け止め / 家族の受け止め / 本人・家族の希望 |
| 健康上の注意 | アレルギー(`%allergies`) / 感染症(`%infections`) / 既往歴(`%pastHistory`) / 持参薬 |
| 生活背景 | 同居者(複数) / キーパーソン / 介護保険 / 利用中のサービス / 退院後の生活の場 / 宗教・信条上の配慮 |

アレルギー・感染症・既往歴は初期値で、本体はアレルギータブ・患者プロファイル・病名タブ(ここで直しても元の登録は変わらない)。

## 生活・ADL(Observation を生成)

- 日常生活自立度: 障害高齢者の日常生活自立度(J1〜C2)・認知症高齢者の日常生活自立度(I〜M)。
- Barthel Index: 10 項目と合計(計算式。選択肢のコードは点数そのもの)。
- 食事(食形態・嚥下・義歯・食欲)、排泄(排尿・排便習慣・下剤)、睡眠(睡眠・睡眠薬・習慣)、
  感覚・コミュニケーション(視力・聴力・言語・補足)。
- 生成する Observation(category `survey`、code system `http://fhir-client.local/CodeSystem/observation-item`):
  `NURS-BEDRIDDEN-LEVEL` / `NURS-DEMENTIA-LEVEL` / `NURS-BARTHEL-TOTAL`(点)。

## 転倒・転落リスク(Observation を生成)

**自作の簡易スコア**で、特定の評価票の写しではない。施設の評価票に合わせて項目・配点を直して使う。

| 項目 | 配点 |
|---|---|
| 年齢 | 69 歳以下 0 / 70 歳以上 2 |
| 過去 1 年の転倒 | なし 0 / あり 2 |
| 歩行 | 自立 0 / 杖・歩行器 1 / 介助・車椅子 2 |
| 認知・判断 | 問題なし 0 / 見当識障害・判断力の低下 2 |
| 排泄 | 自立 0 / 頻尿・夜間の排泄 1 / 介助を要する 2 |
| 転倒に関わる薬剤 | なし 0 / あり 2(ありのとき薬剤の種類を複数選択) |
| 視力・聴力 | 問題なし 0 / 低下あり 1 |
| 点滴・ドレーン等のライン | なし 0 / あり 1 |

- 合計(0〜14 点)は変数 `%fallScore`(選択肢のコードの合計)から出し、危険度は 0〜3 点 I・4〜7 点 II・8 点以上 III。
- 生成する Observation: `NURS-FALL-SCORE`(点) / `NURS-FALL-LEVEL`(I・II・III)。

## 褥瘡リスク(Observation を生成)

診療報酬の「褥瘡対策に関する診療計画書」の危険因子の評価に沿う。

- 障害高齢者の日常生活自立度(J1〜C2)。
- 危険因子 8 項目(基本的動作能力 2 項目・病的骨突出・関節拘縮・栄養状態低下・皮膚湿潤・皮膚の脆弱性 2 項目)。
  選択肢のコードは「できない・あり」が 1。
- 該当する危険因子の数(変数 `%puRisk`)と、褥瘡対策の診療計画の要否(1 つでもあれば「要」)を計算式で出す。
- 現在の褥瘡の有無と、ありのときの部位・状態。
- 生成する Observation: `NURS-PU-RISK-COUNT`(項目) / `NURS-PU-PRESENT`。
