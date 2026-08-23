# 入院診療計画書 テンプレート・帳票一式

診療報酬の様式「**別紙2 入院診療計画書**」
(https://saka1029.github.io/s/08/k/pdf/K1-T6-S2.pdf)
を本アプリで入力・帳票出力するための 3 ファイルです。

| ファイル | 用途 |
|---|---|
| `admission-plan-01.questionnaire.json` | テンプレート(Questionnaire)のエクスポートファイル。テンプレート一覧のインポートから取り込む(name: `ADM_PLAN_01`、`http://fhir-client.local/Questionnaire/admission-plan-01\|1.0.0`) |
| `admission-plan-01.tlf` | 紙様式を再現した ThinReports レイアウト。管理画面 `/report-layouts` で登録する |
| `admission-plan-01.mapping.json` | 「特別な栄養管理の必要性」の有／無に○を出し分けるマッピング定義 |

## 使い方

1. テンプレート一覧 → インポートで `admission-plan-01.questionnaire.json` を選択して保存。
2. `/report-layouts` で新規登録: canonical にこのテンプレート
   (`http://fhir-client.local/Questionnaire/admission-plan-01|1.0.0`)を選択し、
   `admission-plan-01.tlf` をアップロード。**マッピング定義に
   `admission-plan-01.mapping.json` の中身を貼る**(空にすると有／無の○が出ない)。

カテゴリ **「診療計画」**(code `b41c7e28-9f56-4d03-8a17-5e2c9b04af61`)を拡張に持たせて
ある(`plan-01` と同じカテゴリ)。この code は環境ごとのマスタ UUID なので、別環境へ
持っていくとマスタに無い code として扱われるが、拡張の表示名でグループが作られるため
インポート自体は問題なく通る。

## 項目と帳票の対応

linkId = レイアウトのアイテム ID の規約で流れるため、値の出力にマッピングは要らない
(マッピングが要るのは○の出し分けだけ)。紙様式の欄立てをそのまま 14 項目にし、
紙の並び順のまま 4 つのグループに入れている(グループは入力フォームの見出しになるだけで、
帳票には出ない。グループに入れている理由は後述の上流検証の制約)。

| グループ | 紙様式の欄 | linkId | 型 |
|---|---|---|---|
| 入院先・担当者 (`grp_admission`) | 病棟（病室） | `ward_room` | 短文 |
|  | 主治医以外の担当者名 | `other_staff` | 長文 |
|  | 在宅復帰支援担当者名 ＊ | `home_return_staff` | 短文 |
| 病名・症状 (`grp_disease`) | 病名 | `disease_name` | 長文 |
|  | （他に考え得る病名） | `other_disease_name` | 長文 |
|  | 症状 | `symptoms` | 長文 |
| 診療計画 (`grp_plan`) | 治療計画 | `treatment_plan` | 長文 |
|  | 検査内容及び日程 | `test_plan` | 長文 |
|  | 手術内容及び日程 | `surgery_plan` | 長文 |
|  | 推定される入院期間 | `expected_stay` | 短文 |
| その他 (`grp_other`) | 特別な栄養管理の必要性 | `nutrition_need` | 選択(ラジオ) 01=有 / 02=無 |
|  | その他（看護計画・リハビリテーション等の計画） | `other_note` | 長文 |
|  | 在宅復帰支援計画 ＊ | `home_return_plan` | 長文 |
|  | 総合的な機能評価 ◇ | `functional_assessment` | 長文 |

**メタ情報**: 患者氏名 → `pt_name`、記入日 → `qr_authored`、主治医氏名 → `qr_author`
(記入者。フォームのメタ情報欄で選ぶ医療従事者)。

各項目の意図と、紙様式の注1)〜注5) のどれに対応するかは `designNote`(編集画面の
「設計メモ」。回答フォームには出ない)に書いてある。

## FHIR リソースからの自動取り込み（初期値式）

| 項目 (linkId) | 初期値式 | 取り込み内容 |
|---|---|---|
| 病名 (`disease_name`) | `%conditions` | 転帰「継続」の Condition の傷病名を「、」区切りで列挙 |

該当データがなければ空欄のままで、フォームで手入力できる。値は編集可能で、保存された
QuestionnaireResponse に残るため PDF にもそのまま出る。

**病棟（病室）は自動では入らない**。`populateContext.ts` の実行時コンテキストに入院
(Encounter)由来の変数が無いため、現状は手入力になる。入院情報から埋めたい場合は
`%encounter` 相当の変数を足す変更が要る。

## 「特別な栄養管理の必要性」の○

紙様式は「有　・　無　（どちらかに○）」で、どちらかを丸で囲む欄。レイアウトには
有／無の文字の上に重ねた○を `mark_nutrition_yes` / `mark_nutrition_no` という
`display: false` の text アイテムとして置き、マッピング定義の `show` ルールで
回答の code に応じて表示を切り替えている。未回答なら両方とも出ない。

```json
[
  {"linkId": "nutrition_need", "code": "01", "show": ["mark_nutrition_yes"]},
  {"linkId": "nutrition_need", "code": "02", "show": ["mark_nutrition_no"]}
]
```

## レイアウトの作り方

`.tlf` は元 PDF から**罫線の座標を実測して**起こしている(コンテンツストリームの矩形
描画を読み、PDF の下端原点から ThinReports の上端原点へ変換)。表の左端 x=74.3、
項目名と記入欄の仕切り x=167.9、右端 x=521.0、行の境界は 13 本で、いずれも紙様式と
同じ位置・同じ行高になっている。注記の文言も原文どおり。

## 紙様式との意図的な差分

- **「　年　　月　　日」は記入日時 `qr_authored`(YYYY/MM/DD HH:MM)の印字に置き換え**。
  予約プレースホルダーが日付＋時刻を返すため、時刻まで出る。
- **患者氏名の記入線を右へ延ばした**(元様式は 202pt まで、本レイアウトは 260pt まで)。
  元の幅では長い氏名が切れるため。敬称は元様式どおり「殿」。
- **項目名の飾り空白を詰めた**。元様式は「病　棟（病　室）」のように全角空白で
  字間を空けてセル内の見た目を整えているが、本レイアウトはセル内中央寄せで同じ
  見た目にしているため「病棟（病室）」と書いている(「病　名」「症　状」のように
  中央寄せだけでは間が持たない短い項目名は元の字間を残した)。
- **「その他」欄は 1 つの入力項目**にしている。項目名セルに列挙されている
  「・看護計画」「・リハビリテーション等の計画」は、紙様式ではこの欄に何を書くかの
  内訳であって別の記入欄ではないため、欄割りも入力項目も分けていない。看護計画と
  リハビリ計画を別々に入力させたい場合は項目を分けたうえで記入欄も分割することに
  なるが、そのぶん紙様式の罫線から離れる。
- **「病名」欄だけは記入欄を上下 2 段に分けている**。紙様式も項目名が
  「病名 /（他に考え得る病名）」の 2 段で、記入欄の上下に書き分ける前提のため
  (`disease_name` が上段、`other_disease_name` が下段)。段の間に罫線は引いていない
  (元様式にも無い)。

## 検証済みの内容

- `admission-plan-01.questionnaire.json` は frontend の `parseQuestionnaireForm` +
  `validateQuestionnaireForm` を通過し、parse → build の往復で内容が一致する
  (ファイル自体を往復後の正規形にしてあるので、アプリから再エクスポートしても差分が出ない)。
- `questionnairePlaceholders` で 14 項目すべてが ID 衝突なしに列挙され、レイアウト側の
  アイテム ID と一致することを確認。
- ReportLayout のモデル検証(tlf / mapping)を通過。
- `Reports::ThinreportsRenderer` による PDF 生成を、**全項目記入・「無」のみ選択・
  完全未記入**の 3 パターンで確認(値の流し込み、有／無の○の出し分け、未記入時に
  デザイン時の初期値が残らないこと、レイアウト崩れが無いこと)。
- 生成 PDF と元様式 PDF の**罫線座標を機械的に突き合わせ**、水平 14 本・垂直 3 本の
  すべてが 0.00pt 差で一致することを確認(元様式は矩形描画、生成側は line 描画なので、
  両者の座標を上端原点に揃えて比較)。

## 上流(JASPEHR)の検証で踏んだ制約

作成時に上流 FHIR サーバーの `POST /Questionnaire/$validate` で弾かれた 2 点。
同種のテンプレートを作るときも同じことが起きる。

- **`name` は 15 バイト以内**(`jsp-5`)。当初 `ADMISSION_PLAN_01`(17 バイト)にしていて
  弾かれたため `ADM_PLAN_01` にしている。
- **ルート直下の item に拡張を付けると closed slicing エラーになる**。当初は 14 項目を
  グループ無しのフラットな並びにしていたところ、`initialExpression` を持つ `disease_name` と
  `itemControl` / `choiceOrientation` を持つ `nutrition_need` が
  `... does not match any defined slice of Questionnaire.item.extension.value[x] (closed slicing)`
  で弾かれた。**グループ配下の item なら出ない**ため、4 グループに入れて解消している
  (上流のバリデータ側の既知の不具合。2026-08-23 時点でも再現する)。
