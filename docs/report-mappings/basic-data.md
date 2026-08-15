# 基礎データ(POMR Database)テンプレート

POMR(問題志向型診療録)の 5 要素のうち **基礎データ(Data Base)** にあたるテンプレート。
プロブレムリストは「収集した基礎データから異常所見を抽出して立てる」ものなので、その
入口にあたる部分を、専用の構造化フォームを作らずテンプレート(Questionnaire)で用意した。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `social-01.questionnaire.json` | 社会歴 | `SOCIAL_01` / `http://fhir-client.local/Questionnaire/social-01\|1.0.0` |
| `family-01.questionnaire.json` | 家族歴 | `FAMILY_01` / `http://fhir-client.local/Questionnaire/family-01\|1.0.0` |
| `ros-01.questionnaire.json` | システムレビュー | `ROS_01` / `http://fhir-client.local/Questionnaire/ros-01\|1.0.0` |

レイアウト(`.tlf`)・マッピング定義は無し(帳票出力は対象外)。テンプレート一覧の
インポートから取り込む。3 件ともカテゴリ **「基礎データ」**
(code `6f3a9c14-5d02-4e7b-9a83-2c6e1b40d7f5`)を拡張に持たせてあるので、取り込む前に
同じ code のカテゴリを作っておくとカテゴリマスタ側の並び順が効く(未登録でも拡張の
表示名でグループ化されるため、取り込み自体は先でもよい)。

## 既往歴をここに含めていない理由

既往歴は「後からプロブレムへ昇格しうる」情報で、MEDIS 病名マスタのコードが要る。
テンプレートの選択肢(`answerOption`)は固定値の直書きでマスタ検索ができないため、
既存の「病名」タブ(`Condition` + MEDIS 検索 + 修飾語 + 転帰)に区分を足す方が安く、
プロブレムリストとの連続性も保てる。テンプレートで平文の既往歴を別に持つと、
同じ情報が 2 経路に増えて後で整理が必要になるため、あえて作っていない。

## 社会歴(SOCIAL_01)

設問は **JP Core の `JP_Observation_SocialHistory`**
(`JP_ObservationSocialHistoryCode_CS`、25 項目)に 1 対 1 で対応させてある。
対応するコードは各項目の `designNote`(編集画面の「設計メモ」。回答フォームには出ない)に
`JP Core 生活背景コード: MD00129xx ...` の形で書いてある。

| グループ | 項目 | 対応コード |
|---|---|---|
| 喫煙 | 喫煙歴 → (有の場合)現在の喫煙 / 喫煙種類 / 1 日の喫煙本数 / 通算喫煙年数 / 喫煙指数 | MD0012870・880・890・900・910・920 |
| 飲酒 | 飲酒歴 → (有の場合)現在の飲酒 / 種類 / 1 日の飲酒量 / 通算飲酒年数 | MD0012930・940・950・960・970 |
| 職業・環境 | 職業歴 / 化学物質・放射線物質の取り扱い歴 / 海外渡航歴(いずれも有の場合のみ詳細) | MD0012810・820・830・850 |
| 生活習慣 | 運動習慣 / 睡眠時間 / 常用薬剤・サプリメント / その他 | MD0012990・860・980 |

- **喫煙指数(ブリンクマン指数)は自動計算**。SDC の `calculatedExpression` に
  `descendants().where(linkId='smoke_num').answer.value.first() * descendants().where(linkId='smoke_yrs').answer.value.first()`
  を書いてある(1 日の喫煙本数 × 通算喫煙年数)。入力欄は読み取り専用になり
  「自動計算」と表示される。このリポジトリで `calculatedExpression` を使う最初の
  テンプレートなので、式の書き方の実例としても使える。
- 有無は `boolean` ではなく **choice(01 無 / 02 有 / 09 不明)**。JASPEHR の
  item type に boolean が無いため(既存の perio-01 と同じ流儀)。
- 詳細項目は「有」を選んだときだけ出る条件付きグループ(`enableWhen`)に入れてある。

## 家族歴(FAMILY_01)

血縁者 1 人を 1 件として **繰り返しグループ(最大 10 件)** で記載する。

- 続柄の選択肢コードは **HL7 v3-RoleCode** に合わせてある(`FTH` 父 / `MTH` 母 /
  `BRO` 兄弟 / `SIS` 姉妹 / `GRFTH` 祖父 …)。将来 `FamilyMemberHistory` へ変換する
  場合、`FamilyMemberHistory.relationship` にそのまま移せる。
- 「現況=死亡」を選ぶと死亡時年齢・死因が出る。
- 繰り返しグループと `enableWhen` は併用できない(jsp-8)ため、「特記すべき家族歴
  (無/有/不明)」は繰り返しの外に単独で置き、繰り返しグループ自体は条件を持たせて
  いない(該当者がいなければ空のまま保存する)。

## システムレビュー(ROS_01)

器官系ごとに陽性の自覚症状をチェックボックスで選ぶ。全身・頭頸部・呼吸器・循環器・
消化器・腎/泌尿器・神経・筋/骨格・皮膚・精神の 10 系統。

- **チェックの無い項目は「陰性」ではなく「未チェック」**を意味する。陰性を明示したい
  場合は末尾の補足欄に書く運用にしている(器官系ごとに陰性を明示すると設問数が倍増し、
  ROS の網羅性より入力コストが勝ってしまうため)。

## 将来 Observation として抽出する場合

現状は QuestionnaireResponse として保存するだけで、構造化データ(Observation)には
なっていない。エディタが `item.code` に未対応なためで、抽出(SDC の
Observation-based extraction)を実装するときは次の順で進める。

1. **先に `item.code` の編集対応を入れる**。エディタが扱わない要素は編集保存時に
   落ちる仕様(`questionnaireHelpers.ts` の parse/build)なので、先に JSON へ
   `item.code` を書いても画面から一度編集した時点で失われる。
2. 社会歴の `designNote` に書いてあるコードを `item.code` へ移す
   (system は `http://jpfhir.jp/fhir/core/CodeSystem/JP_ObservationSocialHistoryCode_CS`)。
3. 回答保存時に QuestionnaireResponse と Observation を同一の transaction Bundle へ
   積む(シェーマ画像の Binary と同じパターン。`clinicalNoteHelpers.ts` の保存処理が参考になる)。

サーバー側の対応は不要。上流の JASPEHR プロファイルは `item.code` /
`item.definition` / `sdc-questionnaire-itemExtractionContext` を既に許容している。

## 運用上の既知の制約

- **前回値の引き継ぎが無い**。基礎データは来院のたびに前回内容を見て差分更新する
  ものだが、初期値はマウント時に一度確定するだけで、前回の回答を持ち込む仕組みが
  無い。同じ回答を編集し続ける(同 id を更新する)運用で当面しのぐ。
- **カルテのタイムラインに時系列のカードとして並ぶ**。基礎データは「その時点の
  出来事」ではなく患者に紐づく現在の状態なので、回答を重ねるとタイムラインが
  基礎データで埋まる。アレルギータブのように独立したタブで最新 1 件を表示する形が
  本来は望ましい。
