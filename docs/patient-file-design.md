# カルテへのファイル取込の設計

**状態: 実装済(2026-09-19)。**

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 何を解く機能か

［事実］いま画像を扱えるのは読影レポート(`RadReportImagesEditor`)と病理レポート
(`PathoResultForm`)、テンプレートのシェーマ(`schemaImage.ts`)だけで、いずれも
「その業務のレポートに付く画像」である。

［導出］他院の紹介状・同意書・患者が持参した検査結果・説明書のスキャンなど、
**業務に紐づかず患者に紐づく書類**を置く場所が無い。カルテ左ペインに「ファイル」タブを足し、
任意のファイルを取り込めるようにする。

要件は 4 つ。

1. ドラッグ&ドロップとファイル選択の双方から、複数ファイルをまとめて登録できる
2. 運用中に増やせるカテゴリを 1 ファイルに 1 つ設定できる
3. 診療日を設定でき、一覧はその新しい順に読める
4. 取り込んだものを表示・ダウンロード・編集・削除できる

## 2. 器の判断: `DocumentReference` + `Binary`

［事実］このリポジトリは「FHIR リソースは backend の DB に持たず上流へ中継する」
(`readme.md` 冒頭)、「バイナリは `Binary` に置き、本体リソースと同じ transaction Bundle で
atomic に保存する」(`fhir/schemaImage.ts` 冒頭)を方針にしている。Active Storage は未導入で
(`backend/config/application.rb` でコメントアウトのまま)、Render の blueprint にディスクも無い。

［事実］上流は `DocumentReference` を実装済みで、患者コンパートメントにも自動で入る
(`fhir-server/app/lib/fhir/resource_registry.rb`、プロファイルは `JP_DocumentReference`)。

［提案］**1 ファイル = `Binary` 1 件 + `DocumentReference` 1 件**を 1 本の transaction Bundle で保存する。
新しい保存基盤は作らない。

```
DocumentReference
  status              "current"
  subject             Patient/<id>
  date                診療日 00:00 のローカル時刻 ("2026-09-19T00:00:00+09:00")
  category[0]         { coding: [{ system: <ローカル CodeSystem>, code: <カテゴリの code>,
                                   display: <カテゴリ名> }], text: <カテゴリ名> }
  author[0]           Practitioner/<登録した医療者>
  content[0].attachment
      contentType     元ファイルの MIME
      url             Binary/<id>   (Bundle 内は urn:uuid のプレースホルダ)
      title           表示名(既定は元のファイル名)
      size            元のバイト数
```

### 2.1 診療日を `date` に入れる理由

［事実］R4 の `DocumentReference.date` は「この参照が作られた日時」(`instant`)で、
臨床上の日付を置く枠としては `context.period` や `content.attachment.creation` の方が近い。

［事実］上流が索引している日付は `date`(`document_date` 列)だけで、`context.period` は索引されない
(`fhir-server/app/lib/fhir/search_definitions/document_reference.rb`)。

［導出］一覧の並び(`_sort=-date`)と期間検索を診療日で行うには `date` に入れるしかない。
`context.period` に入れると全件取得してクライアント側で並べ替えることになり、ページングと両立しない。
**`date` を診療日として使い、登録・更新の時刻は `meta.lastUpdated` に任せる**。
`instant` なので日付だけの値ではなく、その日の 0 時をローカルのオフセット付きで入れる
(`toFhirDateTime(\`${date}T00:00\`)`)。読むときは `slice(0, 10)`。

### 2.2 カテゴリを `category` に入れる理由

［事実］`DocumentReference.type` は JP Core が文書種別の値集合に縛る枠で、施設が自由に増やす分類とは合わない。
`category` は R4 の束縛が example 強度で、ローカルの CodeSystem を入れてよい。

［提案］`category` に `http://fhir-client.local/CodeSystem/file-category` の code を入れる。
`display` にカテゴリ名も焼き込むので、**カテゴリを消しても取り込み済みのファイルの表示名は変わらない**
(テンプレートカテゴリと同じ考え方)。

### 2.3 サイズの上限は 1 ファイル 7MB

［事実］上流はリクエスト本文が 10MB(`FHIR_MAX_BODY_BYTES` の既定)を超えると 413 で拒否する
(`fhir-server/lib/middleware/request_size_limiter.rb`)。base64 にすると約 4/3 倍になる。

［提案］**1 ファイルの上限を 7MB**(base64 で約 9.3MB)にし、`DocumentReference` のぶんの余白を残す。
画像(`image/*`)は既存の `normalizeImageFile(file, { format: "keep" })` で長辺 1600px に縮小してから数える
(PNG は PNG のまま。線画の書類を劣化させないため)。それ以外は無加工。

［提案］**複数ファイルはファイルごとに Bundle を分けて順に送る**。ファイル同士に整合性の要求は無く、
1 件が大きすぎて弾かれたときに他のファイルまで落ちる方が困る。結果は「N 件を登録しました。◯◯は…」と
まとめて返し、失敗したファイルだけを取込フォームに残す。

採らなかった案:

- **まとめて 1 つの transaction にする**。読影レポートの画像(`RAD_REPORT_MAX_NEW_IMAGE_LENGTH`)と
  同じ形になるが、あちらは「1 つのレポートに付く画像」なので全部まとまって保存される必要がある。
  独立した書類には要らない縛りで、1 回に入れられる総量が減るだけになる。
- **Active Storage を入れて backend に持つ**。`storage.yml` の新設と Render のディスク / S3 が要る。
  FHIR リソースを backend に持たない方針とも合わない。

### 2.4 削除は `DocumentReference` だけ

［提案］`Binary` は消さない。旧バージョン(`_history` / vread)がその `Binary` を参照しており、
消すと過去の記録が壊れる(シェーマ画像・読影レポートと同じ方針)。

## 3. 上流に足したもの

カテゴリの絞り込みをサーバー側で行うため、`DocumentReference` に `category` 検索を足した。
索引はトークンテーブル方式なのでマイグレーションは要らない。

- `search_definitions/document_reference.rb`: `"category" => { type: :token }`
- `extraction_definitions/document_reference.rb`: `TOKENS` に
  `"category" => { path: "category", kind: :codeable_concept_list }`
  (0..* の全 coding を 1 行ずつ索引する。`Observation.category` のような平坦列方式だと先頭しか当たらない)

本番は fhir-server を fhir-client より先にデプロイする。

## 4. カテゴリマスタ

［提案］`questionnaire_categories`(テンプレートカテゴリ)をそのまま写す。

- `file_categories` テーブル(`code` uniq / `name` uniq / `display_order`)。`code` はモデルが UUID で採番し、
  運用者には表示名だけを管理させる
- `Admin::FileCategoriesController`。`/admin` 配下だが、カルテの「ファイル」タブから読むので
  管理者認証ではなくアプリ本体のログイン認証で保護する(テンプレートカテゴリ・帳票レイアウトと同じ扱い)
- ファイル側からは FK を張らない。ファイル本体が上流にあり、backend の DB では参照整合性を保てないため

## 5. 画面

［提案］左ペインのタブ 1 つで完結させる(`components/KarteFileTab.tsx`)。右ペインは使わない。
一覧⇄詳細は URL の `view=`、取込・編集フォームはコンポーネントローカルの状態、という
他のタブと同じ分け方(`karteUrl.ts` 冒頭)。

- **一覧**: 表(`PatientFileTable.tsx`)とサムネイル(`PatientFileGrid.tsx`)を切り替えて使う。
  表は カテゴリ / 表示名 / 種類 / サイズ と、行の「表示」+ ケバブ(編集・削除)。
  ヘッダにカテゴリの絞り込み `<select>`、表示の切り替え、「カテゴリ管理」、「取込」
- ［決定］**どちらの見せ方でも診療日で区切る**(`groupPatientFilesByDate`)。カルテのタイムラインと
  同じ読み方に揃えるため。見出しはグループの上端に貼り付け、表からは重複する診療日の列を落とす。
  並びは上流の `_sort=-date` のままなので、同じ日が続く区間を折るだけでよい(ページの途中で日が
  切れても、そのページの中では正しくまとまる)。日付を持たないファイルだけは末尾に回す
  (上流の降順は NULL が先に来るが、カルテでは「日付なし」を最下部に置く決まり)。
- ［決定］**サムネイルで中身を読むのは画像だけ**にする。スキャンした書類は名前より見た目で探す方が
  早いが、PDF や Office の 1 ページ目を描くには別のレンダラが要るので、そちらは **MIME ごとのアイコン**
  (`FileTypeIcon.tsx`、振り分けは `fileIconKindOf`)を出す。同じ見た目でよいもの(Word と OpenDocument、
  Excel と CSV など)は 1 つの形にまとめ、知らない MIME は接頭辞(`text/` `audio/` `video/`)で拾う。
  切り替えは押したらどちらになるかを描くアイコン 1 つで、選んだ側は localStorage に残す
  (`karteLayout.ts` の `readFileViewMode`。左端ペインの診療日 / 種別の切り替えと同じ扱い)
- **取込**(`KarteFileUploadForm.tsx`): ドロップゾーン + ファイル選択(複数)。積んだ行ごとに表示名を直せる。
  診療日とカテゴリはフォーム 1 つぶんだけ持つ(同じ日に受け取った同じ分類の書類をまとめて入れる使い方が中心)
- **表示**(`KarteFilePreview.tsx`): `contentType` で出し分ける。画像は `<img>`、PDF は `<object>`、
  テキストは `<pre>`、それ以外はダウンロードだけ。中身は `Binary` から blob で取り、object URL にして描く
  (dataURL にすると大きなファイルで文字列が肥大する)。アンマウントで `revokeObjectURL` する
- **編集**: 表示名・診療日・カテゴリだけ。ファイル本体は差し替えない(消して入れ直す)

［導出］**タイムライン(カルテタブのカード)には出さない**。診療の経過そのものではなく
「患者に付いている書類の束」なので、予約・指示簿と同じくタブでのみ見る。

## 6. 残っていること

- **タブ行が横に溢れる**。タブが 12 個になり、左ペインの幅では「ファイル」までスクロールしないと見えない。
  検査結果と同じグルーピング(`KARTE_LAB_GROUP`)で畳むのが逃げ道になる
- **全文検索**。表示名でしか探せない。PDF の中身は読まない
- **画像以外のサムネイル**。PDF・Office はアイコンまでで、中身の 1 ページ目は見えない
