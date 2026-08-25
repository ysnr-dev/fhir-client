# 内視鏡オーダーの設計

生理検査オーダー(`docs/physio-order-design.md`)を雛形にした内視鏡
(上部消化管内視鏡・下部消化管内視鏡・ERCP など)のオーダー。マスタ → オーダー入力 →
カルテカード → 部門一覧 → 実施入力 → 予約枠連携 まで生理検査と同じ形で、違うところ
だけをここに書く。同じところは生理検査の設計書(とその参照先の放射線の設計書)を参照。

実装日: 2026-08-24。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装・配布ファイルで確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 生理検査との違い = JED の取り込み

**［提案］名前は「内視鏡オーダー」とし、「検査」を付けない。** ESD・EMR・
ポリペクトミー・ERCP 治療・PEG 造設のような治療・手術のオーダーが内視鏡では
日常的で、同じ枠組み(項目マスタ・伝票・部門一覧・実施入力)にそのまま載るため。
JED 自身も「検査目的」と別に「治療目的」の用語を持ち、治療が載る前提の設計になって
いる。画面・カード・メニューの表記は「内視鏡」(オーダー種別の display も「内視鏡」)。
英語識別子(`endoscopy`、テーブル名、FHIR の code / URI)は「検査」を含意しないので
そのまま。検査種別マスタの「検査種別」という語は JED の語彙(JED も治療を含めて
検査種別と呼ぶ)なので変えない。

内視鏡も生理検査と同じく JJ1017 に収載されず、オーダー項目を一意に定義する標準
コード体系が無い。ただし内視鏡には JED(Japan Endoscopy Database, 日本消化器内視鏡
学会, https://jedproject.jges.net/ )があり、これをどう扱うかが生理検査との差分になる。

**［事実］JED はオーダー品目表ではなく、レポート用語の標準化用語集である。**

- 検査種別は 上部内視鏡・小腸内視鏡・下部内視鏡・ERCP の4区分のみ。経鼻/経口・
  鎮静の有無のようなオーダー・予約運用上の項目粒度は定義しない
- JJ1017 の32桁コードに当たる「オーダー項目を一意に定義するコード」は無い。
  用語集[基本情報]にはそもそもコード列が無い(表記の統一が目的)
- 消化器内視鏡限定。気管支鏡・膀胱鏡は対象外。EUS も4区分に独立しては存在しない

**［提案］よって検査項目マスタは生理検査と同じ施設定義とし、JED は次の2点だけを
取り込む。用語のマスタ(テーブル・取込)は持たない。**

1. **検査種別の分類軸**: 検査種別マスタに `jed_exam_category`(upper_gi /
   small_intestine / lower_gi / ercp / NULL)を持たせ、JED 4区分を seed する。
   JED 対象外の種別(気管支鏡 など)は NULL で施設が追加できる。将来のレポート・
   JED 出力で種別を機械的に判別するための軸
2. **選択肢用語はテンプレートへの転記**: JED 用語集[基本情報]の「検査目的」
   「治療目的」の統一表記を、検査種別ごとの Questionnaire テンプレート
   (END_*_PUR_01 系、§4)の選択肢に転記する。JED 用語にはコード体系が無く
   統一表記が本体なので、守るべきコードが無い。選択値は QuestionnaireResponse に
   残り、将来の JED 出力はそこから引ける。オーダー画面に専用の用語セレクタを
   足すより、既存のテンプレート機構(既定テンプレート+TemplateEntryModal)に
   乗せる方が画面が一様になる
3. **診断処置用語(部位・所見・診断・処置)は対象外**: 検査後のレポート記述の用語で、
   将来のレポート機能で扱う。スクリーニングJED・JAHIS標準準拠版も対象外

### 1.1 生理検査から変えたもの

| 論点 | 内視鏡での扱い | 理由 |
|---|---|---|
| 検査種別 | `jed_exam_category` 列を追加。seed は JED 4区分+気管支鏡+その他の6件 | 施設採番コードと JED 区分の対応軸。将来のレポート・JED 出力の前提 |
| 検査目的 | 検査種別ごとの既定テンプレート(END_*_PUR_01 系、§4)で JED 用語を選択式に | JED が「オーダリング側の工夫が必要」と明言する二重入力問題の解消点がここ。仕組みは既存のテンプレート機構のままで、選択値は QuestionnaireResponse に残る |
| 薬剤の投与経路 | `ENDOSCOPY_ROUTE_OPTIONS`: IV・IM・SC・PO・外用(TOP)・直腸内(PR)。生理検査の吸入(IH)・動注(IA)は外した | 鎮静剤=静注、鎮痙剤=静注・筋注、咽頭麻酔=局所、前処置=経口・直腸内が内視鏡の実態 |
| 器材 | 生理検査と同じ `master_medical_materials` 直参照 | 内視鏡は止血クリップ等の特定保険医療材料が実在するが、算定コードで直接足りる(施設内コードの段は不要) |
| 初期データ | 検査種別 seed(6件)+検査目的テンプレート4本(取込)。項目マスタは画面から手入力 | 項目粒度は施設で決まる |

生理検査からそのまま持ち込んだもの: セット(親子)、伝票レイアウト、`groupable`(単独
オーダー)、`requires_perform_input`、`requires_appointment` + `duration_minutes` +
`appointment_schedule_id`、実施入力データセット、検査目的・特別指示の既定テンプレート
(Questionnaire canonical)、即実施、実施の取消で実施記録を消す扱い、bodySite を
持たない判断(項目名が対象を含む)。

---

## 2. FHIR の構造

生理検査と同型。ヘッダも明細も ServiceRequest。

```text
ヘッダ ServiceRequest  (category: order-type|endoscopy)
  ←basedOn── 明細 ServiceRequest（単項目 or セット親）= GP
                ←basedOn── セットの構成項目 ServiceRequest
  ←focus──── Task           (進捗: endoscopy-exam)
  ←basedOn── Procedure      (実施記録) ←partOf── Procedure / MedicationAdministration
  ←basedOn── Appointment    (予約必須項目)
```

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。生理検査の physio-* と1対1で対応するものは
説明を省く。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `endoscopy` | ヘッダの `category[0]`。`isEndoscopyServiceRequest` の判定軸 |
| `CodeSystem/endoscopy-order-item` | 明細 `code.coding`。項目マスタの独自コード |
| `CodeSystem/endoscopy-exam-type` | 明細 `category`。検査種別 |
| `CodeSystem/task-code` の値 `endoscopy-exam` | 進捗 Task の `code` |
| `CodeSystem/endoscopy-procedure-code` | `Procedure.code`(レセ電算 診療行為コード) |
| `IdSystem/endoscopy-order-item-number` | 明細 `identifier`。伝票で選んだ並び順 |
| `StructureDefinition/endoscopy-exam-purpose` | 検査目的(テキスト) |
| `StructureDefinition/endoscopy-exam-purpose-questionnaire-response` | 検査目的のテンプレート回答参照 |
| `StructureDefinition/endoscopy-remarks-questionnaire-response` | 特別指示のテンプレート回答参照 |
| `StructureDefinition/endoscopy-material-quantity` | `usedCode` に数量を添える |

再利用: `CodeSystem/prescription-setting`、`CodeSystem/lab-item-abbreviation`、
`CodeSystem/medicine-code` / YJ、`CodeSystem/medical-material`、JP Core `route-codes`、
JP_Procedure、依頼科・病棟の拡張。

### 2.2 検査目的(明細の持ち方は生理検査と同一)

明細の拡張は生理検査と同じ3本(purpose のテキスト+テンプレート回答参照×2)。
JED 用語をテンプレートから選ぶと、平文が `endoscopy-exam-purpose` に、選択値
(coding)が QuestionnaireResponse に入る。オーダー側に JED 専用の coding 拡張は
持たない(一度 `endoscopy-exam-purpose-jed` として実装したが、テンプレート方式に
寄せて撤去した。JED 用語にコード体系が無い以上、独自採番コードをオーダーに焼き
付けても JED 出力の役に立たず、QuestionnaireResponse の選択値で足りる)。

JED の「予定性」(予定/緊急)は新しい要素を作らず、既存の至急フラグ
(`priority` = routine/urgent)がそのまま対応する。患者背景(抗血栓薬・ASA 等)・
検査時情報・偶発症はオーダーの構造化項目にしない(テンプレートと将来のレポート機能へ)。

---

## 3. マスタ

```text
master_endoscopy_exam_types     -- 検査種別。physio 同型 + jed_exam_category
master_endoscopy_items          -- 検査項目。master_physio_items と同型
master_endoscopy_set_items      -- セット親子(同型)
master_endoscopy_item_layouts   -- 伝票レイアウト(同型)
master_endoscopy_item_layout_cells
master_endoscopy_datasets       -- 実施入力データセット(同型)
master_endoscopy_dataset_details
```

テーブル構成は生理検査と1対1。JED 用語のテーブルは持たない(一度
`master_endoscopy_jed_terms` + Excel 取込として実装したが、§4 のテンプレート方式に
寄せて撤去した)。

seed は `db/seed_data/endoscopy_exam_types.csv`(上部消化管内視鏡 / 小腸内視鏡 /
下部消化管内視鏡 / ERCP / 気管支鏡 / その他)。JED 4区分に `jed_exam_category` を
対応させ、JED 対象外の気管支鏡は施設追加の例として空にしてある。既存行は上書き
しない。

### 3.1 実施入力の「データセット」候補(初期値OFF の明細を選ぶ)

データセットの明細には `default_selected`(初期値ON/OFF)がある。ON は実施入力を
開いた時点で明細に並び、OFF は「使ったときだけ足す」もの(鎮静剤・鎮痙剤・生検の
手技料・粘膜下注入材など)。従来 OFF の行は画面のどこにも出ず、レセ電算の全件検索
から名称で引き当てるしかなかった。

そこで実施入力の「診療行為を追加」「薬剤を追加」「器材を追加」で開く検索モーダルに
モード切替を足した。

- **データセット** … オーダーに載っている検査項目のデータセットに登録された候補だけを
  並べる。ON/OFF の別なく出し、既定量・経路も添える。すでに明細にあるコードは
  「追加済み」で選べない。選ぶとデータセットの既定量・経路がそのまま入る
  (実施入力を開いたときの初期行と同じ扱い)。
- **全件検索** … 従来どおりマスタ全件からの検索。候補に無いものはこちら。

候補が1件以上あればデータセット側から開く。切替は `DatasetPickList.tsx`
(`DatasetPickProps` を検索モーダルに渡すだけ)にまとめてあり、**放射線・生理検査・
内視鏡・処置の4部門に同じ形で入れてある**(放射線は器材が施設内マスタなので
`RadMaterialSearchModal`、造影剤は造影剤区分で絞った医薬品検索が相手になるが、
候補の作り方は同じ `buildDatasetPick`)。データセットを渡さない呼び出し
(処方・注射・マスタ保守など)は今までどおり全件検索だけになる。

放射線の「造影剤を追加」では、この違いが特に効く。全件検索は造影剤区分で絞るため、
データセットに登録した生理食塩液のような非造影剤は検索では出てこないが、候補には出る。

---

## 4. JED 用語のテンプレートへの転記

**［事実］配布 Excel(Ver5.0.3, `20181119_03_JED_kihonjyouhou_5_0_3-1.xlsx`)の構造:**

- 検査種別ごとの4シート(`…～上部～` / `★…～大腸～` / `★…～小腸～` / `★…～ERCP～`)
- 各シート7列: Type / カテゴリー / 細項目(出力データ項目名) / 属性 / 属性値① /
  属性値② / 備考。細項目は結合セル相当で空欄は直前の続き
- **選択肢の用語は「属性」列**。属性値①②は休薬期間・置換・対応・転帰のような
  さらに深い入れ子(レポート入力の詳細)
- コード列は無い(JED は表記の統一が目的で、統一表記が本体)

**［提案］「検査目的」「治療目的」は検査種別ごとのテンプレート4本に転記する。**

| テンプレート | 転記元(シート) | 内容 |
|---|---|---|
| `END_EGD_PUR_01` 上部内視鏡 検査目的 | 上部 | 検査目的6語+治療目的12語+補足 |
| `END_CS_PUR_01` 下部内視鏡 検査目的 | 大腸 | 検査目的13語+補足 |
| `END_SB_PUR_01` 小腸内視鏡 検査目的 | 小腸 | 検査目的14語+補足 |
| `END_ERCP_PUR_01` ERCP 検査目的 | ERCP | 検査目的15語+補足 |

`docs/report-mappings/endoscopy-purpose-*.questionnaire.json`(解説は
`endoscopy-purpose.md`)。項目マスタの既定テンプレート(purpose_template_canonical)に
検査種別に合うものを設定して使う。選択肢はシートの掲載順のまま、表記は一字も
変えずに転記する(変えると用語統一の意味が無くなる)。前処置・鎮静などその他の
基本情報用語も、必要になったテンプレート(END_EGD_01 の抗血栓薬・鎮静のように)へ
同じ流儀で転記する。

JED 用語集の版が上がったらテンプレートを改版して取り込み直す。転記元の Excel は
配布物のためリポジトリに含めない(`backend/tmp/master-data/jed/` に置く運用)。
テンプレートへの転記自体は、JED が推奨する利用形態(決められた単語をシステムに
登録し、選択して入力する)そのもの。

［実装］テンプレートを書くときは JASPEHR プロファイルの制約に注意する
(`validateQuestionnaireForm` がインポート時に弾く)。踏みやすいのは3つ:
**jsp-6** 選択肢項目には描画形式(itemControl)が必須 /
**jsp-1・jsp-9** 表示条件(enableWhen)は選択肢項目の直下のグループにしか置けない
(兄弟項目に条件は付けられない) / **jsp-5** name は15バイト以内。
テンプレート JSON を手で書いたら、インポート前に `parseTransferImport` に通して
確かめるのが早い。

---

## 5. 上流 fhir-server の追加

**不要**。生理検査(physio-order-design.md §4)で確認したとおり、使う検索パラメータは
すべて値に依存しない汎用実装で、`order-type|endoscopy` も同じ仕組みに乗るだけ。

---

## 6. 画面

| 画面 | パス | 元 |
|---|---|---|
| 内視鏡オーダー項目マスタ | `/endoscopy-items` | `PhysioItemPage` |
| 検査種別 | `/endoscopy-exam-types` | `PhysioExamTypePage` + JED区分列 |
| 内視鏡オーダーレイアウト | `/endoscopy-item-layouts` | `PhysioItemLayoutPage` |
| 実施入力データセット | `/endoscopy-datasets` | `PhysioDatasetPage` |
| 内視鏡一覧(部門業務) | `/endoscopy-worklist` | `PhysioWorklistPage` |
| オーダー入力 | カルテ右ペイン「内視鏡」 | `PhysioOrderForm`(生理検査と同一構成) |

オーダー画面は生理検査と同一で、内視鏡固有の UI は無い。検査目的の JED 用語は
既定テンプレート(END_*_PUR_01 系)の選択肢として出る。

---

## 7. 実装したもの

| 層 | 追加物 |
|---|---|
| migration | `20260824100000` 検査種別 / `100100` 項目+セット / `100200` レイアウト+セル / `100300` データセット+明細 |
| モデル | `Master::Endoscopy{ExamType,Item,SetItem,ItemLayout,ItemLayoutCell,Dataset,DatasetDetail}` |
| API | `endoscopy_exam_types` ほか7 resources |
| seed | `db/seed_data/endoscopy_exam_types.csv`(6件) |
| spec | リクエスト6本(75 examples)。backend 全 911 examples green |
| FHIR 変換 | `fhir/endoscopyOrderHelpers.ts` / `endoscopyTaskHelpers.ts` / `endoscopyResultHelpers.ts` |
| 画面 | §6 の6画面と `EndoscopyOrderForm` / `Panels` / `DetailPanel` / `EndoscopyItemSearchModal` / `EndoscopyPerformModal` / `endoscopyItemOptions` |
| カルテ | `karteTimeline` に `endoscopy-order` 種別、`KarteRightPane` の起動ボタン、`KarteTimeline` のカード・実施情報、`KarteCardModals` の詳細/JSON、`KarteCategoryList` / `karteUrl` / `KartePage` の分岐 |
| テンプレート | 検査目的4本(END_EGD/CS/SB/ERCP_PUR_01、§4)+ END_EGD_01(上部内視鏡 前処置・鎮静指示)。いずれも開発環境にインポート済み |

### 7.1 検証したこと

開発環境で以下を通した。

1. マスタ: 検査種別 6 件 seed(JED区分の表示・編集)→ 検査項目 2 件登録(自動採番・
   種別紐付け)
2. オーダー: 項目選択 → 検査目的入力 → 登録。FHIR 上でヘッダ(order-type|endoscopy・
   入外区分・依頼科・病棟拡張)と明細(項目コード・略称・検査種別 category・
   purpose 拡張)を確認
3. 編集: 保存値からのフォーム復元 → 検査目的の手編集 → 保存後の FHIR に反映
4. 部門一覧: 受付 → 実施(薬剤ミダゾラム 1管 静脈内)→ Procedure +
   MedicationAdministration が上流に登録 → カルテカードの実施情報に表示
5. DO: 検査項目・検査目的の文言を引き継いだ登録フォームが開く(テンプレート紐付けは
   外れる)
6. テンプレート: 5本ともインポート成功。END_EGD_01 は絶食「指示済」で条件付き
   グループ「絶食」が開くこと、END_EGD_PUR_01 は検査目的(ドロップダウン)と
   治療目的(チェックボックス)の描画を確認
7. 回帰: 既存の生理検査・検体検査カードが不変。既存テンプレート8本も同じ検証を
   通ることを確認。backend 全 911 examples green・`tsc -b` clean

※ 2〜4 の一部は JED 用語セレクタがあった時点での確認。テンプレート方式への
変更後はフォームが生理検査と同一構成に戻ったため、差分は「セレクタが無いこと」
だけを再確認した。END_*_PUR_01 テンプレートの記入 → 検査目的欄への反映は
既存のテンプレート機構(END_EGD_01 と同じ流れ)そのもの。

セット展開・伝票レイアウト・実施入力データセット・予約枠連携・削除・即実施・
実施取消は生理検査の写し(コードパスも同一)で、request spec では通しているが
画面からは通していない。運用に載せる前に生理検査 §6.1 と同じ手順で一巡すること。

---

## 8. 申し送り

1. **結果レポート**: 内視鏡所見レポート(部位・所見・診断・処置)は未実装。JED の
   診断処置用語(Ver5.0.5)とスクリーニングJED・胆膵EUS用語・JAHIS 内視鏡レポート
   構造化記述規約は、レポート機能を設計するときに扱う。ERCP 固有の検査時情報
   (胆道造影範囲・ERCP難度 など)も同じタイミングで `FIELDS` への追加を検討する
2. **JED 提出**: JED へのデータ提出(出力)機能は無い。検査目的・治療目的の選択値は
   QuestionnaireResponse に残るので、提出データの生成(統一表記の突合)・匿名化
   (JEDMaker 連携)はそこから設計する。用語を検索・集計の軸にしたくなった時点で、
   用語マスタの再導入(撤去した `master_endoscopy_jed_terms` の再利用)を検討する
3. **検査目的の複数選択**: JED では検査目的が複数併記されうるが、END_*_PUR_01 の
   検査目的は単一選択+補足(自由文)。複数選択が要る運用になったらテンプレートの
   choice を repeats にして改版する
4. **JED 用語集のライセンス**: JGES の配布物。Excel も抽出データもリポジトリに
   コミットせず、施設が自分でダウンロードして取り込む方式(JJ1017・JANIS・レセ電算と
   同じ姿勢)。再配布・商用利用の条件は配布元の規約を確認すること
5. **会計連携**: 生理検査 §7-2 と同じ。内視鏡の加算(病理組織採取加算 等)の扱いも
   会計側の課題
6. **共通化**: rad / physio / endoscopy で3例目の同型オーダーになった。セット・
   レイアウト・データセット・即実施・Task・予約枠連携はほぼ同一なので、4つ目を
   作ることになったら共通化(backend: concern + generic controller、frontend:
   `createOrderHelpers` のようなファクトリ)を先に検討する価値がある
7. **洗浄履歴・スコープ管理**: 内視鏡機器(スコープ)の洗浄・保守の記録は本オーダーの
   対象外
