# 文書作成(Word / Excel テンプレートへの差し込み、様式への入力)の設計

**状態: 実装済(Word / Excel: 2026-10-01、様式: 2026-10-24)。**

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 何を解く機能か

［事実］文書を作る手段は、テンプレート(`Questionnaire`)に回答して帳票レイアウト(.tlf)で
PDF にする経路だけだった。様式を作るには項目定義とレイアウトの両方が要る。

［導出］診断書や各種証明書のように、**院内で Word / Excel の様式のまま運用している文書**を
そのまま使う手段が無い。様式ファイルを登録しておき、カルテの内容を差し込んだファイルを
患者ごとに作れるようにする。

要件は 3 つ。

1. カルテ右ペインの「文書作成」から、登録済みの様式を選んで文書を作れる
2. 様式ファイルは Word(.docx)/ Excel(.xlsx)のまま登録できる
3. 様式に書いたプレースホルダーへ、作成時点のカルテの内容が自動で入る

## 2. 全体の流れ

```
マスタメンテ > テンプレート > 文書テンプレート      様式ファイルを登録(backend の DB)
        │
カルテ右ペイン「文書作成」                        様式を選ぶ → 値を確認 →「作成」
        │  ブラウザで差し込み
        ├─ 患者のファイルとして保存(Binary + DocumentReference)
        └─ ダウンロード → 手元の Word / Excel で開いて続きを書く
        │
カルテ「ファイル」タブ >「差し替え」               書き上げたファイルを同じ文書に戻す
```

［提案］ブラウザから Word / Excel を直接は起動できないので、「開く」はダウンロードで行う。
作成した時点でカルテに残し、書き上げたものは差し替えで戻す。

## 3. プレースホルダー

様式ファイルの本文に `{{ }}` で書く。書き方は 2 通り。

| 書き方 | 例 | 意味 |
|---|---|---|
| 変数一覧の名前 | `{{患者番号}}` | `POPULATE_EXPRESSION_OPTIONS` の label |
| 式 | `{{%patient.birthDate}}` | テンプレートの初期値式と同じ FHIRPath(`%` で始める) |

［事実］値の出どころはテンプレートの初期値式と同じ `usePopulateSources` →
`buildPopulateContext`(`fhir/populateContext.ts`)。変数一覧は 1 つで、初期値式と文書の両方から使う。
使える名前は文書テンプレート画面の「変数一覧」で確認・コピーできる。

［提案］どちらでもない名前は FHIRPath に流さず「一覧にありません」とする。日本語の名前は
FHIRPath としても読めてしまい、書き間違いがエラーにならず空欄になるため。

解決の結果は 4 通り(`fhir/documentPlaceholders.ts`)。

| 状態 | 文書への反映 |
|---|---|
| 値あり | 値を入れる |
| 該当なし(入院していない等) | 空欄にする |
| 一覧に無い名前 | `{{名前}}` のまま残す |
| 式を評価できない | `{{式}}` のまま残す |

［提案］解決できないものがあっても作成は止めない。作成前の表で赤く示し、残った箇所は
Word / Excel で直せる。

文書用に足した変数(初期値式からも使える)。

- 自院: 医療機関名・郵便番号・住所・電話番号・FAX・保険医療機関番号(施設設定の自院)
- 作成者: 氏名・カナ・職種・診療科(ログイン中の医療従事者。紐付く医療従事者が無いログインでは空)
- 和暦: 今日の日付・生年月日・入院日(`lib/dates.ts` の `toWareki`。1 年目は「元年」)

## 4. 差し込み(`fhir/officeTemplate.ts`)

［事実］.docx / .xlsx は ZIP に入った XML。`fflate` で開き、本文の XML から `{{ }}` を探して
値に置き換え、ZIP に戻す。依存は足していない。

［提案］XML は DOM に通さず、タグ単位に切って必要な文字だけを書き換える。DOM で読んで
書き戻すと XML 宣言や名前空間の書き方が変わり、触っていない部分まで別物になるため。

［事実］Word はプレースホルダーを書式の境目や校正の印で複数の run に割る。段落ごとに文字を
つなげてから探し、値は `{{` のあった run に入れる(その run の書式で表示される)。
段落をまたぐプレースホルダーは拾わない。

対象にする場所。

| 形式 | 場所 |
|---|---|
| docx | 本文・ヘッダー・フッター・脚注・文末脚注(表・テキストボックスの中を含む) |
| xlsx | セルの文字列・ヘッダー・フッター・図形の中の文字 |

対象にしないもの: Word のフィールドコードと変更履歴の削除部分、Excel の数式とシート名。

そのほかの扱い。

- 複数行の値は、Word では改行、Excel ではセル内改行になる(セルの「折り返して全体を表示」は様式側で設定する)
- Excel のふりがなは、置き換えたセルから取り除く(プレースホルダー名のふりがなが残るため)
- Excel は開いたときに数式を計算し直させる(差し込んだ値を参照する数式のため)
- Excel に入る値は文字列のセルになる

［提案］対応しないもの: 旧形式(.doc / .xls)、PowerPoint、表の行をデータ件数ぶん増やす繰り返し、
条件分岐。複数件の値(病名・処方など)は改行区切りの 1 つの文字列として入る。

## 5. 文書テンプレートのマスタ

［提案］backend の `document_templates` に本体ごと持つ(帳票レイアウトと同じ考え方)。
Active Storage は DICOM 専用のまま(`docs/imaging-design.md`)。

| 列 | 内容 |
|---|---|
| `code` | 自動採番の UUID。作成した文書から参照される不変のコード(様式はフロントが先に採番して送る。§7) |
| `kind` | `office`(Word / Excel)か `form`(様式。§7) |
| `name` | 名称(一意) |
| `file_category_id` | 作成した文書を入れるファイルカテゴリ(`file_categories`)。未設定可 |
| `file_name` / `content_type` / `byte_size` | 種類とサイズはファイル名と本体から backend が決める(様式は元ファイルの名前と種類、ページ画像の合計) |
| `data` | 本体(office のみ)。5MB まで(差し込み後に患者ファイルの 7MB へ収めるための余白) |
| `layout` / `questionnaire_url` / `questionnaire_version` | 様式のフィールド配置と、回答を保存する Questionnaire の canonical(§7) |
| `display_order` / `active` | 並び順と有効・無効。無効にすると文書作成の選択肢から外れる |

様式のページ画像は `document_template_pages`(1 ページ 1 行。`page_number`・`content_type`・`data`・`byte_size`・
`width_px` / `height_px`(フィールド座標の基準)・`width_pt` / `height_pt`(PDF のページ寸法))に持つ。

API は `/admin/document_templates`(認証はアプリ本体のログイン。カルテから読むため)。
一覧は本体を返さず、本体は `GET /admin/document_templates/:id/file`(office)と
`GET /admin/document_templates/:id/pages/:number`(様式のページ画像)で取る。
登録・更新は本体を base64 にして JSON で送る(`file_data` / `pages`。省けば本体は据え置き)。

## 6. 作成した文書の保存と差し替え

［事実］保存は患者ファイルと同じ `Binary` + `DocumentReference`(`docs/patient-file-design.md`)。
「ファイル」タブにそのまま並ぶ。

- カテゴリ: テンプレートのファイルカテゴリ
- 表示名: 既定は「テンプレート名 + 拡張子」。ダウンロード時のファイル名になるので拡張子を必ず付ける
- 登録者: ログイン中の医療従事者(`author`)
- どのテンプレートから作ったか: `DocumentReference.type` に
  `http://fhir-client.local/CodeSystem/document-template` の code(テンプレートの `code`)を書く。
  上流は `type` で検索できる

［提案］保存できてからダウンロードさせる。カルテに無い文書が手元にだけ残らないようにするため。

差し替えは `DocumentReference` を同じ id のまま、指す `Binary` だけを替える。旧版は上流の
`_history` に残る。文書作成で作ったものに限らず、すべてのファイルで使える。

## 7. 様式(PDF / 画像)テンプレート

［事実］紙の様式(同意書・証明書・届出)は Word / Excel で持っていないことも多く、PDF やスキャン画像しか無い。
そこで PDF / 画像をそのまま登録し、その上にフィールドを置いて、様式の見た目のまま入力できるようにした。
Word / Excel と違い、表示用 PDF と構造化データ(回答)の両方を残す。

### 7.1 ページ画像

［提案］PDF はブラウザで **pdfjs-dist** によりページ画像(PNG、150dpi 相当。A4 で 1240×1754px)にして登録する
(`fhir/documentFormRaster.ts`。デザイナを開いたときだけ読み込む)。画像(PNG / JPEG)は長辺 2500px に縮め、
150dpi のスキャンとして扱う(pt = px × 72 / 150)。ページ画像が正本で、元の PDF は保存しない(差し替えは再アップロード)。

PDF と画像を同じ「ページ画像」にすることで、デザイナ・入力画面・PDF 生成が 1 本の座標系(ページ画像の px)で済む。
ベクタの品質は落ちるが、印刷用途では 150dpi で足りる。上限は 10 ページ、1 ページ 1.5MB、合計 5MB
(合成した PDF がページ画像の合計とほぼ同じ大きさになり、患者ファイルの 7MB に収まる)。
PNG が 1.5MB を超えるページ(写真)は JPEG に落とす。

### 7.2 レイアウト(`document_templates.layout`)

フィールドは 5 種類: テキスト(`text`)・複数行(`textarea`)・選択(`select`)・チェック(`checkbox`)・日付(`date`)。
座標と大きさはページ画像の px、文字サイズは pt(画面は `width_px / width_pt` で px に換算し、PDF は逆に pt に換算する)。

```jsonc
{ "schema_version": 1,
  "fields": [{ "id": "f_xxxx", "type": "text", "label": "患者氏名", "page": 1,
               "x": 276, "y": 148, "w": 320, "h": 36, "font_size": 10.5, "align": "left", "required": false,
               "options": ["男", "女"],                  // select のみ
               "initial_expression": "%patientName",     // text / textarea / date。初期値式(変数一覧の式)
               "transfer_kinds": ["prescription"],       // text / textarea。転記ボタンの出どころ
               "date_format": "wareki" }] }              // date のみ(slash / iso / wareki)
```

形の検証は backend(`DocumentTemplate#layout_shape`)が担う(既知のキーだけ、id の一意、ページ内に収まること、
フィールド 200 件まで)。フロントの純粋関数は `fhir/documentFormLayout.ts`。

デザイナ(`components/documentForm/DocumentFormDesigner.tsx`)は病棟マップ編集と同じ DOM 方式
(絶対配置 + CSS `scale`、`useCardDrag` で移動・8 方向リサイズ、`useUndoableState` で取り消し)。
種別ボタンを押してからページを押すとその位置に置く。Delete で削除、矢印で 1px 移動(Shift で 10px)。

### 7.3 Questionnaire の自動生成

［提案］回答の構造化データは **QuestionnaireResponse** にする。既存のテンプレート回答の表示(カルテ時系列のカード)・
データ抽出がそのまま使え、新しい保存先を増やさない。項目の定義はデザイナ(layout)が正で、保存時に Questionnaire を
機械的に作る(`fhir/documentFormQuestionnaire.ts`)。

- url は `http://fhir-client.local/Questionnaire/document-form/<テンプレートの code>`。code はフロントが先に採番する
  (Questionnaire → テンプレートの順に書くため)。`name` は JASPEHR(jsp-5)の 15 文字制限に収めた `DF` + code の先頭 12 桁。
- 項目は text→`string`、textarea→`text`、date→`date`、select→`choice` + drop-down(選択肢は
  `http://fhir-client.local/CodeSystem/document-form-option` の `<id>-<n>`)、checkbox→`choice` + check-box + 1 選択肢。
  初期値式は `initialExpression`。既存のエディタと同じ `buildQuestionnaire` に通し、プロファイルの要件(subjectType 等)を満たす。
- `code` に `http://fhir-client.local/CodeSystem/questionnaire-kind|document-form` を付け、テンプレート一覧の検索に
  `code:not=` を足して通常のテンプレート選択から隠す(上流は extension を検索できないが `code` と `:not` は対応)。
  拡張 `http://fhir-client.local/StructureDefinition/questionnaire-document-form`(valueString = code)も付ける。
- **版**: `questionnaire_version` は整数。回答の意味が変わる差(項目の増減・種類・ラベル・選択肢・初期値式・必須)があるときだけ
  上げ、新しい版を新しい Questionnaire として POST する(旧版は既存の回答が `url|version` で指すので残す)。
  位置や大きさだけの変更では上げない。保存は Questionnaire → テンプレートの順で、途中で止まっても次の保存で同じ版を見つけて続きから進む。

### 7.4 入力と転記

カルテ右ペインの「文書作成」で様式を選ぶと、ページ画像の上にフィールドの入力欄を重ねて出す
(`components/documentForm/DocumentFormFill.tsx`。幅はペインに合わせて縮め、「全画面」で広げる)。

- 初期値: 開いた時点で `initial_expression` を `buildPopulateContext` の環境で評価して入れる(`fhir/documentPlaceholders.ts` の
  `resolvePlaceholders`。変数一覧の式と `%` の式のどちらも使える)。
- 転記: `transfer_kinds` を持つ text / textarea に「転記」ボタンを出し、患者の処方・注射・部門オーダー・病名・検査結果を
  一覧から選んで文字で追記する(`components/documentForm/OrderTransferModal.tsx`)。オーダーはカルテのタイムラインと同じ
  検索(`karteOrderParams` + `appendKarteOrderIncludes`、最新 100 件)を `buildKarteTimeline` でカードの単位にし、
  処方・注射は Rp 形式(`prescriptionRpLines`)、ほかは「日付 種別 タイトル」の 1 行にする(`fhir/documentFormTransfer.ts`)。
  開いたタブのぶんだけ読む。

### 7.5 表示用 PDF と保存

［提案］PDF は backend の Prawn(thinreports の依存、IPA P ゴシック同梱)で作る(`Reports::DocumentFormRenderer`、
`POST /reports/document_forms/:template_id/pdf`)。フロントは表示用に整形した文字列(選択肢の表示・チェックの ✓・和暦)を
送るだけにし、値の整形を `fhir/documentFormLayout.ts` の `displayTextOf` に一元化する。ページ画像を敷いて `text_box` で描き、
箱に収まらない文字は縮める(`shrink_to_fit`)ので、ブラウザと IPA フォントで折返しが違っても箱からはみ出さない。

保存は 1 本の transaction Bundle(`fhir/patientFileHelpers.ts` の `buildDocumentFormBundle`):
QuestionnaireResponse(POST、`fullUrl` は urn:uuid)+ Binary(PDF)+ DocumentReference(POST、`type` はテンプレートの code、
`context.related` で回答を指す。上流が urn:uuid を実 id に書き換える)。

再編集はファイルタブの「内容編集」から右ペインで同じ画面を開き(`document-edit`)、保存済みの回答から値を復元する。
更新は QuestionnaireResponse を PUT(`If-Match`)、PDF を新しい Binary、DocumentReference を向け替え(`If-Match`)で、
文書も回答も開いた時点の版に固定する(`useEditSnapshot`)。旧 Binary は履歴が参照するので残す。
再編集はテンプレートの現在の版の Questionnaire に付け替える(値は linkId で引き継ぐ)。

### 7.6 対応しないもの

ベクタのままの PDF 背景、繰り返し行、条件分岐、電子署名。フォントの一致(ブラウザの表示と PDF で折返しが多少違う)。
