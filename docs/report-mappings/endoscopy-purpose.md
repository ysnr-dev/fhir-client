# 内視鏡 検査目的テンプレート(JED 用語)

内視鏡オーダーの GP 単位の欄「**検査目的**」に貼るテンプレート。JED(Japan Endoscopy
Database, 日本消化器内視鏡学会)用語集[基本情報] Ver5.0.3 の「検査目的」「治療目的」の
統一表記を、検査種別ごとに選択肢へ転記してある。

JED 用語は表記の統一が目的の用語集で、コード体系を持たない(統一表記が本体)。
そのため専用の用語マスタは持たず、テンプレートの選択肢として供給する。選択値は
QuestionnaireResponse に残るので、将来 JED 向けの出力を作るときはそこから引ける。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `endoscopy-purpose-egd-01.questionnaire.json` | 上部内視鏡 検査目的 | `END_EGD_PUR_01` / `http://fhir-client.local/Questionnaire/endoscopy-purpose-egd-01\|1.0.0` |
| `endoscopy-purpose-cs-01.questionnaire.json` | 下部内視鏡 検査目的 | `END_CS_PUR_01` / `…/endoscopy-purpose-cs-01\|1.0.0` |
| `endoscopy-purpose-sb-01.questionnaire.json` | 小腸内視鏡 検査目的 | `END_SB_PUR_01` / `…/endoscopy-purpose-sb-01\|1.0.0` |
| `endoscopy-purpose-ercp-01.questionnaire.json` | ERCP 検査目的 | `END_ERCP_PUR_01` / `…/endoscopy-purpose-ercp-01\|1.0.0` |

name が略記なのは JASPEHR の jsp-5(15バイト以内)に収めるため。画面に出るのは
title の方なので、どの種別かはそちらで分かる。

レイアウト(`.tlf`)・マッピング定義は無し。テンプレート一覧のインポートから取り込む。
カテゴリ **「検査」**(code `25675b10-0ef3-4425-83c4-c1f8c3015cca`)を拡張に持たせてある。

## 使い方

内視鏡の検査項目マスタ(`/endoscopy-items` の編集モーダル「既定のテンプレート」→
検査目的)に、その項目の検査種別に合うテンプレートを設定しておく。オーダー画面で
その項目を選ぶと検査目的欄の「テンプレート」から選択済みで開き、選んだ目的が
平文で検査目的欄に入る。

- 「検査目的」は JED「検査目的」の統一表記(検査種別ごとに選択肢が違う)。単一選択の
  ドロップダウン
- 「治療目的」は上部のみ(JED Ver5.0.3 の収載どおり。ポリペクトミー・EMR・ESD など)。
  1 回の内視鏡で複数の治療を行うことがあるのでチェックボックス(複数選択)。
  診断のみの依頼では空のままでよい
- 「補足」は自由文。「その他」を選んだときの内容などを書く

## 用語の版管理

選択肢は JED の統一表記の**転記**なので、勝手に文言を直すと用語統一の意味が
無くなる。JED 用語集の版が上がったらテンプレートを改版して(canonical の
バージョンを上げて)取り込み直す。転記元の Excel は配布物のためリポジトリには
含めない(`backend/tmp/master-data/jed/` に置く運用)。
