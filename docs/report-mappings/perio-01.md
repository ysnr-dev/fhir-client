# 周術期口腔機能管理計画書 テンプレート・帳票一式

紙様式「周術期口腔機能管理計画書」(https://www.tokyo-sk.com/pdf/121130_keikaku.pdf)
を本アプリで入力・帳票出力するための 3 ファイルです。

| ファイル | 用途 |
|---|---|
| `perio-01.questionnaire.json` | テンプレート(Questionnaire)のエクスポートファイル。テンプレート一覧のインポートから取り込む(name: `PERIO_01`、`http://example3.com|1.0.0`) |
| `perio-01.tlf` | 紙様式を再現した ThinReports レイアウト。管理画面 `/report-layouts` で登録する |
| `perio-01.mapping.json` | チェックマーク表示切替のマッピング定義。レイアウト登録時に「マッピング定義」欄へ貼り付ける |

## 使い方

1. テンプレート一覧 → インポートで `perio-01.questionnaire.json` を選択して保存
   (口腔図のシェーマ画像は保存時に Binary として自動作成)。
2. `/report-layouts` で新規登録: canonical にこのテンプレート
   (`http://example3.com|1.0.0`)を選択し、`perio-01.tlf` をアップロード、
   `perio-01.mapping.json` の内容をマッピング定義欄へ貼り付けて保存。

## 対応の要点

- **linkId は英数字とアンダースコアのみ**で作ってあるため、回答値の出力
  (基礎疾患・既往歴・歯磨き回数・喫煙本数・睡眠時間・飲酒量・各「その他」・
  手術予定日・病名・指導方針の補足・特記事項など)はすべて ID 規約
  (linkId = レイアウトのアイテム ID)で流れる。マッピング定義は
  **チェックマーク(「レ」text)の表示切替のみ**(63 ルール)。
- **メタ情報**: 患者名/性別/生年月日 → `pt_name`/`pt_gender`/`pt_birthdate`、
  策定日 → `qr_authored`、保険医療機関名・担当歯科医師名 → `qr_institution`
  (保険医療機関番号)・`qr_author`。
- **口腔図**: 元 PDF から抽出した口腔図をシェーマ画像として
  「口腔内の状態(現症)」グループ(`grp_oral`)に添付。帳票側は無地の口腔図
  (`default_mouth_image`)を常時表示し、描き込みがあれば `grp_oral_img`
  (image-block)が同位置に重なる。
- **単位**: 歯磨き回数(回)・喫煙本数(本/日)・睡眠時間(時間)・飲酒量(ml/日)は
  questionnaire-unit 拡張を持ち、値に「10 本/日」の形で単位が付いて印字される
  (帳票側に静的な単位表記は置いていない)。
- **条件付きグループ**: 喫煙「有」→喫煙本数、飲酒「有」→飲酒量、
  各実施内容の「その他」→自由記述、予想される変化「有」→内容(口腔粘膜炎/口腔乾燥症)
  を enableWhen で出し分け(jsp-9 準拠で choice の子グループに配置)。

## 紙様式との意図的な差分

- 生年月日の「明・大・昭・平 年 月 日生」の元号表記は `pt_birthdate`
  (YYYY/MM/DD)での印字に置き換え。性別の「男・女」丸囲みも `pt_gender` の
  文字印字(男性/女性)に置き換え(meta 値は show ルールを駆動できないため)。
- 策定日は `qr_authored`(記入日時 YYYY/MM/DD HH:MM)をそのまま印字。
- 「手術・化学療法・放射線治療（ / ）」の日付は date 型 1 項目
  (`surgery_date`、YYYY/MM/DD 印字)に集約。
- 「予想される変化」の「□その他」は自由記述(`change_other`)に回答があれば
  チェックが付く(answered ルール)。セルフケアの指導方針の枠内自由記述は
  `selfcare_note`(指導方針の補足)として独立した設問にした。

## 検証済みの内容

- ReportLayout のモデル検証(tlf / mapping)を通過。
- サンプル回答・未回答(空)の両方で `Reports::ThinreportsRenderer` による
  PDF 生成を確認(チェックの出し分け・値の流し込み・口腔図の重ね描き)。
- `perio-01.questionnaire.json` は frontend の
  `parseQuestionnaireForm` + `validateQuestionnaireForm` を通過
  (シェーマ画像は未保存画像として復元される)。
