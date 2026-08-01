# 診療情報提供書 テンプレート・帳票一式

紙様式「紹介状（診療情報提供書）」
(https://www.hosp.ipu.ac.jp/cms/wp-content/uploads/2021/02/syoukaijyou.pdf)
を本アプリで入力・帳票出力するための 2 ファイルです。帳票タイトルは
「診療情報提供書」（「紹介状」は付けない）。

| ファイル | 用途 |
|---|---|
| `referral-01.questionnaire.json` | テンプレート(Questionnaire)のエクスポートファイル。テンプレート一覧のインポートから取り込む(name: `REFERRAL_01`、`http://example4.com|1.0.0`) |
| `referral-01.tlf` | 紙様式を再現した ThinReports レイアウト。管理画面 `/report-layouts` で登録する |

マッピング定義は不要（回答値は ID 規約 linkId = アイテム ID、メタ情報は
予約 ID をレイアウトに直接置いている）。登録時は「マッピング定義」欄を空のままにする。

## 使い方

1. テンプレート一覧 → インポートで `referral-01.questionnaire.json` を選択して保存。
2. `/report-layouts` で新規登録: canonical にこのテンプレート
   (`http://example4.com|1.0.0`)を選択し、`referral-01.tlf` をアップロード
   （マッピング定義は空）。

## FHIR リソースからの自動取り込み（初期値式）

以下の項目は SDC の `initialExpression` を持ち、テンプレート登録画面
（新規回答フォーム）を開いた時点で患者の FHIR リソースから初期値が流し込まれる
（`usePopulateSources` + `populateContext.ts`。値は編集可能で、保存された
QuestionnaireResponse に残るため PDF にもそのまま出る）。

| 項目 (linkId) | 初期値式 | 取り込み内容 |
|---|---|---|
| 傷病名 (`disease_names`) | `%conditions` | 転帰「継続」の Condition の傷病名を「、」区切りで列挙 |
| 病状経過及び検査結果 (`course`) | `%labResults` | 最新の検体検査結果(DiagnosticReport + Observation)1 件の項目・値・単位・H/L |
| 現在の処方 (`prescription`) | `%prescriptions` | 最新の処方(ServiceRequest + MedicationRequest)1 件の Rp・用法・薬品・数量 |
| 患者住所 (`pt_address`) | `%patient.address.first().text` | Patient の住所 |
| 電話番号 (`pt_phone`) | `%patient.telecom.where(system='phone').value.first()` | Patient の電話番号 |

該当データがなければ空欄のままになる（フォームで手入力できる）。

## 対応の要点

- **紹介先医療機関名は入力式**: 元の紙様式では「茨城県立医療大学付属病院」の
  固定値だが、`ref_to_name`(必須)として入力させる。診療科(`ref_to_dept`)・
  担当医師名(`ref_to_doctor`)も入力。
- **メタ情報**: 患者氏名/性別/生年月日/年齢 → `pt_name`/`pt_gender`/
  `pt_birthdate`/`pt_age`、記入日 → `qr_authored`、紹介元の医師氏名 →
  `qr_author`(記入者。フォームのメタ情報欄で入力)。
- **紹介元医療機関**: 名称・所在地・電話番号・ＦＡＸ・診療科名は入力項目
  (`ref_from_*`)。
- **医療機関(Organization)の選択で一括入力**: 紹介先・紹介元の各グループ見出しに
  出る「医療機関を選択」ボタンから、登録済みの医療機関を選んで流し込める
  (readme「医療機関（Organization）> テンプレートへの一括入力」参照)。対応は
  `ref_to_name`・`ref_from_name` → 名称、`ref_from_address` → 郵便番号+所在地、
  `ref_from_phone` → 電話番号、`ref_from_fax` → ＦＡＸ。診療科(`*_dept`)は
  Organization に対応する要素が無いため手入力のまま。
- **医療従事者(Practitioner)の選択で担当医師名を入力**: 紹介先グループの
  「医療従事者を選択」ボタンから選ぶと `ref_to_doctor` に氏名が入る。職種の初期値は
  「医師」を設定してあるため、モーダルは既定で医師に絞られる。紹介先医療機関を
  先に選んでおくと、その医療機関に所属する医療従事者だけが表示される。
- **linkId は英数字とアンダースコアのみ**のため、回答値の出力はすべて
  ID 規約(linkId = レイアウトのアイテム ID)で流れる。

## 紙様式との意図的な差分

- 帳票タイトルは「診療情報提供書」（元様式の「紹介状（診療情報提供書）」から変更）。
- 「平成 年 月 日」は記入日時 `qr_authored`(YYYY/MM/DD HH:MM)の印字に置き換え。
- 生年月日の元号表記(明・大・昭・平)は `pt_birthdate`(YYYY/MM/DD)に置き換え。
  性別の「男・女」丸囲みも `pt_gender` の文字印字(男性/女性)に置き換え。
- 患者氏名の敬称は「殿」ではなく「様」。
- 「病状経過及び検査結果」と「治療経過」は元様式どおり別欄。検査結果の
  初期値は「病状経過及び検査結果」欄に入る。
- 紹介元の所在地は郵便番号と 1 欄にまとめている(紙様式に〒の独立枠が無いため、
  `ref_from_address` に「〒100-0005 東京都…」の形で入る)。
- 医療機関を選択して入力した場合も、保存されるのは文字列だけで「どの
  Organization を選んだか」は残らない(JASPEHR が `item.type = "reference"` を
  禁止しているため)。

## 検証済みの内容

- `referral-01.questionnaire.json` は frontend の
  `parseQuestionnaireForm` + `validateQuestionnaireForm` を通過し、
  parse → build の往復で initialExpression が保たれる。
- ReportLayout のモデル検証(tlf / mapping)を通過。
- サンプル回答・未回答(空)の両方で `Reports::ThinreportsRenderer` による
  PDF 生成を確認(値の流し込み・メタ情報・レイアウト崩れなし)。
- `%conditions` / `%patient.…` の FHIRPath 評価(fhirpath.js)を確認。
- 医療機関の選択による一括入力を実機で確認(紹介先・紹介元で別々の医療機関、
  FAX 未登録の施設への選び直しで欄が空になること、手入力の診療科名が残ること、
  PDF への反映)。
