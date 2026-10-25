# テンプレート・帳票

## シェーマ画像（テンプレートへの画像添付と描き込み）

テンプレート(`Questionnaire`)の各項目に画像を1枚添付でき、回答(`QuestionnaireResponse`)ではその画像に
ペイントツールで描き込めます。画像本体は `Binary` リソースに置き、項目からは extension の
`valueAttachment.url`(`Binary/<id>`)で参照します。

- **extension**: テンプレート側は標準の
  `http://hl7.org/fhir/StructureDefinition/questionnaire-itemMedia`、回答側の描き込み画像は
  ローカル定義の `http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image`。
  描き込みは元画像を書き換えず、合成 PNG を別の `Binary` として保存します。
- **保存は transaction Bundle**: 画像と本体リソースを**1回の `POST /fhir`** で atomic に保存します
  (画像エントリの `fullUrl`(`urn:uuid:...`)を `valueAttachment.url` に入れ、上流が実 ID に解決)。
  更新時は本体を `PUT` + `ifMatch` にするので、**412 で弾かれた場合は画像も保存されません**
  = 参照されない孤児 `Binary` が生まれません。
- **描き込み画面の表示**: ツールバー右端のアイコンで「画面に合わせる」(既定)と「原寸大」(台紙の 1 画素を
  画面の 1px で表示し、はみ出た分はスクロール)を切り替えます。表示を変えても描画の解像度は変わらず、
  書き出し画像は台紙の実寸(長辺 1600px まで)です。
- **旧 Binary は削除しません**: 画像の差し替えや描き込みのやり直しで参照が外れた `Binary` は残します。
  リソースの旧バージョン(`_history` / vread)がその画像を参照しているため、消すと過去の記録が壊れます
  (容量よりも履歴保全を優先する方針)。
- backend の `/fhir` プロキシは `ALLOWED_RESOURCE_TYPES` に `Binary` を追加しています。画像の表示は
  `Accept: image/*` を付けた `GET /fhir/Binary/<id>` で生バイトを取得します(上流が非 FHIR な Accept に
  対して `contentType` 付きの実体を返す挙動を利用)。

## テンプレートカテゴリ

テンプレート(`Questionnaire`)を分類し、テンプレート選択のプルダウンで「カテゴリ → テンプレート」と
辿れるようにします。カテゴリは任意で、未設定のテンプレートはプルダウンの先頭階層(カテゴリと同じ層)に
並びます。

- **カテゴリの管理**: テンプレート一覧の「カテゴリ管理」ボタンから、追加・改名・並べ替え・削除を行います
  (backend DB の `questionnaire_categories`。FHIR リソースではありません)。並び順がプルダウンの表示順です。
- **テンプレートへの割り当て**: テンプレート編集画面の「カテゴリ」で選びます。保持先は Questionnaire の
  extension `http://fhir-client.local/StructureDefinition/questionnaire-template-category` の `valueCoding`
  (`code` = カテゴリの UUID、`display` = 設定時のカテゴリ名)。テンプレート本体は上流 FHIR サーバー、
  カテゴリマスタは backend DB と保存先が別々なので、backend からテンプレートを参照する構造にはしていません。
- **マスタに無い code の扱い**: カテゴリを削除した後や、別環境からインポートしたテンプレートのように
  マスタに該当 code が無い場合は、extension の `display` を見出しにしたグループとして登録済みカテゴリの
  後ろに表示します(テンプレート側の設定を勝手に落とさないため)。表示名はマスタがあればマスタ側を優先するので、
  カテゴリを改名してもテンプレートの再保存は不要です。
- **テンプレート一覧**: 施設設定と同じく左にカテゴリ、右に選んだカテゴリのテンプレートを並べます。
  左にはマスタのカテゴリ(テンプレートの無いものも含む)、マスタに無い code のグループ、未設定のテンプレートが
  あれば「未分類」をこの順に出し、件数を添えます。カテゴリは extension にしか無く上流で検索できないので、
  一覧は全件(上限 2,000 件)を読んで画面で振り分けます。選んだカテゴリは URL(`?category=`)に持ちます。
- **選択プルダウン**: 「テンプレート回答の登録」(ページ / カルテ右ペイン)と診療記録の「テンプレート記載」
  モーダルで共通コンポーネント(`frontend/src/components/TemplateSelect.tsx`)を使います。

## 患者向けの質問票（Web 問診）

Web 問診(`docs/web-intake-design.md`)で患者に見せる質問票も、ふつうのテンプレート(`Questionnaire`)です。
施設設定「Web 問診」で既定の質問票(と診療科ごとの質問票)を canonical(`url|version`)で選びます。

- 患者画面は医療機関・医療従事者の選択を出さず、初期値変数(`%` で始まる式)と `loginAutofill` も効きません。
  患者向けの質問票にはこれらを使わず、シェーマ画像も付けないでください。`boolean` 型は無いので
  「はい / いいえ」は choice で作ります。
- 1 ページにトップレベルの item 1 つ(ふつうは group)を出すので、質問はグループに分けます。
  `display` 型も 1 ページに数えます。
- 例として `docs/report-mappings/intake-general-01.questionnaire.json`(`INTAKE_01`: 主訴・経過・既往歴・服薬・
  アレルギー・妊娠と喫煙)を置いてあります。テンプレートのインポートで取り込めます。

## 文書作成(文書テンプレート)

カルテ右ペインの「文書作成」から、マスタメンテ > テンプレート > 文書テンプレート(`/document-templates`)に登録した様式で
患者の文書を作ります。作った文書はカルテの「ファイル」タブに入ります。設計は `docs/document-template-design.md`。

テンプレートは 2 種類で、管理画面ではタブ(「様式」「Word / Excel」)で分けて一覧・登録します。
テンプレートのカテゴリは「ファイル」タブと同じファイルカテゴリで、作った文書はそのカテゴリでファイルに入ります。
カテゴリの追加・改名・並べ替え・削除は管理画面の「カテゴリ管理」(「ファイル」タブのものと同じ)で行います。

- **Word / Excel**(.docx / .xlsx): 様式の中に `{{患者番号}}` のようなプレースホルダー(「変数一覧」の名前か `%` で始まる
  初期値式)を書いておくと、作成時にカルテの値を差し込んだファイルを患者ファイルとして保存し、ダウンロードします。
  続きは手元の Word / Excel で書き、「ファイル」タブの「差し替え」で戻します。PDF にはしません。
  例として診療情報提供書の Word テンプレート `docs/report-mappings/referral-word-01.docx`(`referral-word-01.md`)を置いてあります。
  - **検査項目の最新値**は「変数一覧」の「検査項目の最新値」で結果項目と取り出す値(値・単位・採取日・値と単位・判定)を選ぶと、
    `{{%labs.where(code = '160010010').value}}` のような式ができます(初期値式でも同じ式を使います)。記入時に、その結果項目の
    最新の結果 1 件だけを取ります。結果項目マスタの施設コードで引くので、施設コードを持たない旧い結果は対象外です。
- **様式**(PDF / PNG / JPEG): 「様式」タブの「新規登録」で開くデザイナで PDF や画像をページ画像にし(150dpi、10 ページ・合計 5MB まで)、
  その上にテキスト・複数行・選択・チェック・日付の項目を置きます(種別ボタンを押してからページを押す。ドラッグで移動、
  角と辺で大きさ変更、Delete で削除、矢印キーで 1px 移動)。項目には初期値(変数一覧の式)、転記の出どころ、必須、
  日付の表示形式(2026/01/23・2026-01-23・和暦)、塗りつぶし(枠内を白で塗り、雛形の「年 月 日」などの印字を隠す)を設定できます。
  - カルテでは様式の見た目のまま入力します(「最大化」で右ペイン全体に、「全画面」で画面幅いっぱいに広げられます。Escape で元に戻ります)。初期値は開いた時点のカルテの値が入り、
    「転記」ボタンから処方・注射・部門オーダー・病名・検査結果を選んで追記できます。一覧は期間(1か月・3か月・6か月・
    1年・全期間、既定は 3か月)で絞り、各行の「▸」(または「すべて展開」)で転記される文字列をそのまま確かめられます。
    処方・注射は Rp 単位、部門オーダーは見出しの下に項目(検体・撮影項目・術式・食種など)を字下げして転記します。
  - 「作成」で表示用 PDF(backend の Prawn、IPA フォント)を患者ファイルに保存し、入力内容はテンプレート回答
    (`QuestionnaireResponse`)としても保存します。カルテの時系列には「文書作成」のカードとして見出しだけを出します
    (内容は「PDF」で保存した PDF を開くか詳細表示で見ます。「編集」で文書編集を開きます。削除すると文書と回答が一緒に消えます)。
  - 「ファイル」タブの文書の表示画面にある「内容編集」で同じ画面を開き直し、値を直して PDF を作り直せます
    (回答は更新、PDF は新しい本体に差し替え。旧版は上流の履歴に残ります)。
  - 様式が自動生成する Questionnaire(`code` に `questionnaire-kind|document-form`)は、テンプレート回答の選択肢には出しません。
    項目(ラベル・種類・選択肢・初期値)を変えて保存すると Questionnaire の版が上がり、作成済みの文書は前の版を指したまま残ります。
  - ファイルタブで様式文書を削除すると、回答も一緒に消えます。
  - 行メニューの「複製」で、ページ画像・項目の配置・カテゴリを写した新しい様式を「〜 のコピー」の名前で作ります。
    Questionnaire は新しい url の 1 版として作り直し、カルテの文書作成に出ないよう無効で登録します。
  - 行メニューの「エクスポート」で、ページ画像(base64)・項目の配置・カテゴリを 1 つの JSON ファイルに書き出します
    (`GET /admin/document_templates/:id/export`。code と Questionnaire の canonical は含めません)。
    「様式」タブの「インポート」でそのファイルを取り込むと、新しい code と Questionnaire の 1 版で無効の様式として登録します。
    名称が使われていれば末尾に番号を付け、カテゴリは code、無ければ名称で取り込み先のものに引き当てます(無ければ未設定)。
  - 例として診療情報提供書の様式 `docs/report-mappings/referral-form-01.json`(`referral-form-01.md`)と、
    主治医意見書の様式 `docs/report-mappings/care-opinion-form-01.json`(`care-opinion-form-01.md`、2 ページ・項目 238 件)、
    生活習慣病 療養計画書の初回用・継続用 `lifestyle-plan-initial-form-01.json` / `lifestyle-plan-continued-form-01.json`(`lifestyle-plan-form-01.md`)を置いてあります。

## テンプレートのエクスポート / インポート

テンプレート(`Questionnaire`)を単一の JSON ファイルとして書き出し、別環境(開発→本番など)へ
取り込めます。テンプレート一覧の行メニュー「エクスポート」でダウンロード、一覧上部の
「インポート」ボタンでファイルを選択して取り込みます。

- **自己完結なファイル**: シェーマ画像は `Binary/<id>` 参照のままでは移行先で辿れないため、
  エクスポート時に `valueAttachment.data`(base64)として埋め込みます。サーバー固有の `id` /
  `meta.versionId` / `meta.lastUpdated` は含めません(`meta.profile` は保持)。
- **インポートは新規作成と同じ経路**: ファイルを編集フォームの中間表現に変換して検証
  (JASPEHR 制約)した上で、画像 `Binary` と本体を 1 つの transaction Bundle で保存、という
  新規作成と同じ流れで取り込みます。canonical(url + version)の一意性は上流 fhir-server の
  バリデーション + DB 制約が保証し、同じ url + version のテンプレートが既にあると 422 エラーに
  なります(取り込みたい場合は既存側を削除するか、ファイルの `url` / `version` を変更してください)。
- エディタが扱わない要素・拡張はインポート時に失われます(本アプリで作成したテンプレートの
  移行を前提とします)。

## 帳票PDF出力（QuestionnaireResponse の ThinReports 帳票）

テンプレートの回答(`QuestionnaireResponse`)を、あらかじめ登録した帳票レイアウトに流し込んで
PDF 出力できます。レイアウトは [ThinReports Basic Editor](https://github.com/thinreports/thinreports-basic-editor)
で作成した `.tlf` ファイルを管理画面 `/report-layouts` からアップロードし、テンプレートの
canonical(`url|version`)に紐付けます(backend DB の `report_layouts` に保存)。

- **PDF 生成は backend**(`thinreports` gem、純 Ruby・IPA フォント同梱)。上流アクセスは
  QR の read と、batch Bundle(元 Questionnaire 検索 + Patient + シェーマ画像 Binary ×N)の
  計 2 往復で組み立てます。
- **エンドポイント**: `GET /reports/questionnaire_responses/:id/pdf`(inline 表示)、
  `GET /reports/layouts?canonical=...`(登録有無の照会。テンプレート表示画面の「PDF」ボタンの
  表示判定に使用)。レイアウト未登録のテンプレートではボタンが無効になります。
- **レイアウト管理 API**: `/admin/report_layouts`(CRUD。`ADMIN_TOKEN` 設定時は他の管理APIと
  同じ認証・CSRF が必要)。

### プレースホルダー規約(レイアウト側アイテム ID)

Basic Editor のアイテム ID は「先頭英数字 + 英数字・アンダースコア」しか使えないため、
linkId の記号を変換して対応付けます。

| 出力したい内容 | アイテム ID | 種類 |
|---|---|---|
| 項目の回答値 | linkId の記号(`-.!#%/:;?@~` 等)を 1 文字ずつ `_` に置換した ID。先頭が英数字でない場合は `x` を前置(例: `body/temp` → `body_temp`) | text-block |
| 繰り返しグループ n 回目(n≥2)の回答 | `<ID>_2`, `<ID>_3`, ...(出現順。レイアウトに置いた個数を超えた分は出力されない) | text-block |
| シェーマ描き込み画像 | `<ID>_img`(n 回目は `<ID>_img_2`, ...) | image-block |
| 患者: 氏名 / カナ / 患者番号 / 生年月日 / 年齢(記入日時点) / 性別 | `pt_name` / `pt_kana` / `pt_id` / `pt_birthdate` / `pt_age` / `pt_gender` | text-block |
| 回答: タイトル / ステータス / 記入日時 / 記入者 / 保険医療機関番号 / ID | `qr_title` / `qr_status` / `qr_authored` / `qr_author` / `qr_institution` / `qr_id` | text-block |

- 値の整形は平文表示と同じ(choice は display 優先、複数回答は `、` 連結、単位付与)。日付は
  `YYYY/MM/DD`、日時は JST の `YYYY/MM/DD HH:MM`。
- **未回答の項目は空文字**になります(text-block のデザイン時初期値は残りません)。レイアウトに
  無いプレースホルダーは黙って捨てられ、逆にレイアウト独自の text-block(linkId 由来でない ID)は
  触りません。
- 変換の結果 2 つの linkId が同じ ID に潰れる場合(例: `a-b` と `a.b`)は生成時に 422 で拒否します。
  **帳票化するテンプレートの linkId は英数字とアンダースコアのみを推奨**します。
- 予約 ID(`pt_*` / `qr_*`)は linkId 由来の値より優先されます。
- **各テンプレートで使えるアイテム ID の一覧は、管理画面 `/report-layouts` の登録フォームで
  テンプレートを選択すると表示されます**(変換済み ID・単位・繰り返しの有無・ID 衝突の警告つき。
  コピーボタンで Basic Editor へ貼り付けられます)。

### マッピング定義(チェックマーク・丸囲みの表示切替、独自 ID への出力)

ID 規約だけでは表現できない帳票 --- choice 回答の code に応じてチェックマーク(✓ の text)や
丸囲み(ellipse)を出し分ける紙様式の再現、既存レイアウトの独自アイテム ID への出力 --- は、
レイアウト登録時に**マッピング定義**(JSON 配列)を併せて登録することで対応できます
(管理画面 `/report-layouts` のフォーム、または API の `mapping` パラメータ)。

ルールは 1 要素 1 件で、次の 4 形式があります:

```jsonc
[
  // 回答値を任意 ID の text-block へ出力(対象が image-block なら描き込み画像を出力)
  { "linkId": "item-1", "tlfId": "answer_1" },
  // answerCoding.code が一致する回答があればアイテム(text/ellipse 等)を表示
  { "linkId": "item-2", "code": "01", "show": ["check_1", "circle_1"] },
  // 回答が 1 つでもあれば表示(code 省略時と同義)
  { "linkId": "item-2", "answered": true, "show": ["check_any"] },
  // 予約プレースホルダー(pt_* / qr_*)の値を別 ID の text-block にも出力
  { "meta": "pt_name", "tlfId": "patient_name" }
]
```

- `show` に指定したアイテムは、**どのルールの条件も満たさなければ強制的に非表示**になります
  (レイアウト側の display 設定に依らず、回答だけで出力が確定します)。チェックボックス
  (複数回答)は複数の code ルールがそれぞれ独立に評価されます。
- マッピングの値出力先も未回答時は空文字になります(デザイン時初期値は残りません)。
  レイアウトに存在しない ID を参照するルールは黙って無視されます。
- 繰り返しグループは非対応です(値は最後の出現で上書き、show は全出現の OR)。
- マッピングは ID 規約と併用できます。規約どおりの ID とマッピングの両方がある場合は両方に
  出力され、予約 ID への直接出力は従来どおり機能します。
- 記入例: 歯科疾患管理計画書のマッピング定義が
  [`docs/report-mappings/shikan-01.mapping.json`](../report-mappings/shikan-01.mapping.json)
  にあります。

## 基礎データ（POMR の Data Base）のテンプレート

POMR は「基礎データから異常所見を抽出してプロブレムリストを立てる」構成なので、その入口にあたる
**社会歴・家族歴・システムレビュー(ROS)** をテンプレート(`Questionnaire`)として用意してあります
（[`docs/report-mappings/basic-data.md`](../report-mappings/basic-data.md)、
`social-01` / `family-01` / `ros-01` の 3 ファイル）。専用の構造化フォームを領域ごとに作らず
テンプレートで賄うことで、設問の追加・変更を画面から行えるようにしています。テンプレート一覧の
インポートから取り込み、カテゴリ「基礎データ」でまとめます。

- **社会歴**は JP Core の `JP_Observation_SocialHistory`（`JP_ObservationSocialHistoryCode_CS`）に
  設問を 1 対 1 で対応させ、各項目の `item.code` に持たせています（18 項目）。SDC の Observation
  抽出を実装すれば、この code がそのまま `Observation.code` になります（サーバー側の対応は不要。
  上流の JASPEHR プロファイルが `item.code` / `itemExtractionContext` を許容しています）。
  喫煙指数（ブリンクマン指数）は `calculatedExpression` による自動計算です。
- **既往歴はテンプレートではなく「病名」タブの区分**です（次節）。MEDIS 病名マスタのコードが要り、
  後からプロブレムへ昇格しうる情報なので、`Condition` 側に区分を足す方が安く、プロブレムリストとの
  連続性も保てるためです（同じ情報が 2 経路に増えるのを避けています）。
- 社会歴は「回答から Observation を生成する」を有効にしてあるので、回答を保存すると
  `category=social-history` の Observation が同時に作られます（次節）。

## テンプレートの項目コード（`Questionnaire.item.code`）

テンプレート編集画面の **「詳細設定 > 項目コード」** で、設問に標準コード（LOINC・JP Core など）を
付けられます。`code` / `display` / `system` の 3 列で、1 項目に複数のコードを持たせられます。

- **回答の選択肢（`answerOption`）のコードとは別物**です。項目コードは「この設問が何を訊いて
  いるか」を表し、SDC の Observation 抽出では `Observation.code` になります。
- **表示テキスト（display）には付けられません**（FHIR の不変条件 que-3）。入力欄自体を出さず、
  取り込んだテンプレートに付いていた場合は保存時のエラーで知らせます（黙って落としません）。
- 入力欄の種類（`item.type`）を変えてもコードは引き継ぎます（コードは「何を訊いているか」で、
  入力方法とは独立なため）。ただし表示テキストへ変更したときだけは落とします（que-3）。
- 空のコードは保存されません。`system` や `display` だけを入れて `code` が空の行は保存時に
  エラーになります（黙って消えると気づけないため）。

## 初期計画（POMR の Initial Plan）

POMR の初期計画を **診断計画(Dx)・治療計画(Rx)・教育計画(Ex)** の 3 分割で書くテンプレートを
用意してあります（[`docs/report-mappings/plan-01.md`](../report-mappings/plan-01.md)、`plan-01`）。
カテゴリは「診療計画」です。

- **診療記録の「治療計画(P)」セクションに『テンプレート記載』で貼り付けて使うのを勧めます**。
  SOAP の P は本来この 3 分割で書くもので、記録と計画が同じカードに収まる方が経過を読みやすい
  ためです。プロブレムを選んでから「診療記録」を開けば対象が初期選択されるので、その状態で貼れば
  計画もそのプロブレムのものになります。単独登録でも対象プロブレムは選べるので、記録に紐付かない
  計画だけを残すこともできます。
- 「確認する検査」「薬物療法」は**方針としての記載**で、実際のオーダーは検査・処方オーダーで
  出します（記録とオーダーが二重にならないようにするため）。
- 最後に「計画の見直し予定日」を置いています。初期計画は立てたままにせず経過記録で評価する
  ためです。
- 項目コード（`item.code`）は付けていません。各項目に対応する確度の高い標準コードが無く、
  計画は自由記載の方針で構造化データとして集計する対象でもないためです。

## 前回の回答の複写

テンプレート回答の新規登録で、同じテンプレートの直近の回答を初期値として読み込めます
（「前回の回答を複写(YYYY-MM-DD)」ボタン）。基礎データのように「前回を見て変わったところだけ
直す」使い方のためのものです。

- **自動では入れません**。前回の内容を今回の所見として無自覚に確定してしまうのを避けるため、
  押したときだけ読み込み、読み込み後は「複写取消」で空に戻せます。
- 複写しても**新しい回答として登録**されます（前回の回答は書き換えません）。id・報告単位 ID・
  記録日時は新規に採番され、記入者はログイン中の医療従事者のままです。
- **シェーマの描き込みは引き継ぎません**。同じ `Binary` を 2 つの回答が参照すると、片方を消した
  ときにもう片方の画像が壊れるためです（描き込みはその時点の所見なので、複写して使い回すもの
  でもありません）。計算式の項目は複写後に再計算されます。
- 直近の回答は canonical（`<url>|<version>`）の完全一致で引くので、**テンプレートのバージョンを
  上げると前回の回答は複写できなくなります**。設問が変われば回答の対応も崩れるため、版をまたいで
  複写しないのは意図した動作です。

## テンプレート回答からの Observation 生成

テンプレート編集画面の **「回答から Observation を生成」** を有効にすると、項目コードを設定した
設問の回答が `Observation` として保存され、検査結果と同じ構造化データになります
（SDC の Observation-based extraction 相当。実装は `frontend/src/fhir/observationExtract.ts`）。

- **設定はテンプレート単位**です。SDC 標準の拡張 `sdc-questionnaire-observationExtract`（有無）と
  `sdc-questionnaire-observation-extract-category`（生成する Observation の `category`）を Questionnaire に
  持たせます。項目コードの無い設問は対象外なので、除外したい設問はコードを付けなければ済みます。
- 生成される Observation は `code` = 項目コード、`value[x]` = 回答値、`subject` / `effectiveDateTime` は
  回答から引き継ぎ、`derivedFrom` に生成元の `QuestionnaireResponse` を持ちます。回答が下書き
  （`in-progress`）のうちは `status` を `preliminary`、確定後は `final` にします。
- **値の写し方**: 選択肢 → `valueCodeableConcept`、数値 + 単位 → `valueQuantity`、単位なしの整数 →
  `valueInteger`、文字列 → `valueString`、日付 → `valueDateTime`。複数選択（チェックボックス）は
  回答 1 つにつき 1 件の Observation にします（1 つの CodeableConcept に複数 coding を並べるのは
  「同じ概念の別コード体系」の意味なので、別々の所見をまとめる用途には使えないため）。
  単位は表示名だけを入れ、`system` / `code` は付けません。テンプレートの単位には「本/日」のように
  UCUM のコードではない値も入っており、そのまま UCUM として出すと誤ったコード体系の主張に
  なるためです。
- **保存は回答と同じ transaction Bundle** で行うので、片方だけ保存されることはありません。
  回答を更新すると前回生成した Observation を消して作り直し、回答を削除すると一緒に消します
  （由来を辿れない Observation だけが残らないように）。更新で作り直す（差分更新しない）のは、
  テンプレート側のコードが変わると項目と Observation の対応が崩れるためです。
- **前回の生成物は `Observation?derived-from=QuestionnaireResponse/<id>` で引き当てます**。
  回答を更新・削除するときに「この回答から作ったもの」を知る根拠は
  `Observation.derivedFrom` だけで、それをそのまま検索します。以前は生成した Observation の
  参照を回答側のローカル拡張に二重持ちしていましたが、上流が `derived-from` 検索に対応した
  ので撤去しました（拡張と実体がずれる余地が無くなります）。
- **診療記録に貼るテンプレート記載でも生成します**。記載の回答は診療記録と同じ transaction で
  保存されるので、生成した Observation もそこへ相乗りさせます（回答だけ保存されて Observation が
  無い、という中途半端な状態を作らないため）。新規記入では回答が Bundle 内の `urn:uuid` なので、
  `derivedFrom` も同じ `urn:uuid` を指し、上流の transaction 処理が実 ID へ解決します。
  - 記載を編集し直したとき・セクションごと外したとき・診療記録を削除したときの
    「前回の生成物」の削除は保存側（`api/queries.ts` の `saveClinicalNote`）で行います。
    Bundle の組み立ては同期処理で、`Observation?derived-from=` の検索が要るためです。
    対象は Bundle 内で既存の回答を PUT / DELETE しているエントリから拾います。
  - **放射線オーダーの検査目的・特別指示では生成しません**。こちらは別の Bundle 組み立て
    （`radOrderHelpers.ts`）なので未対応で、設定が有効なテンプレートを選ぶとモーダルに
    その旨を表示します（`TemplateEntryModal` の `extractsObservations`）。
