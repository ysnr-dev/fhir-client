# カルテへの DICOM 取込と表示の設計

**状態: 実装済(2026-09-19。PDI の目次からの取込は 2026-09-22)。**

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］/［決定］)。

---

## 1. 何を解く機能か

［事実］他院から持ち込まれる画像は PDI 形式の CD(DICOMDIR と、拡張子の無い DICOM ファイルの束)で届く。
これまでカルテに入れられるのは「ファイル」タブの書類(`docs/patient-file-design.md`)と、レポートに貼る
PNG / JPEG だけで、DICOM のまま取り込んで見る手段が無かった。

［決定］カルテに「DICOM」タブを足し、DICOM を取り込んで院内のビューアで開けるようにする。

- 取込口は 3 つ: PDI のディスク(フォルダごと)、ZIP(ディスクの中身を固めたもの)、単一の `.dcm`。
- 取込前に、中身(DICOM 側の患者名・患者 ID・検査日・モダリティ・枚数)をカルテの患者と並べて確かめる。
- ビューアは、ウィンドウ(WW/WL)の調整とプリセット、拡大・移動、コマ送り、タグの表示、
  計測(距離・角度・Cobb 角・長径短径・点の値)、範囲(矩形・楕円・円・フリーハンド)、注釈(矢印・文字)。
- 注釈を描いたままの画像を JPEG にして、カルテの「ファイル」に登録できる。

［決定］「ファイル」タブには混ぜない。あちらは「1 ファイル = 1 件、診療日とカテゴリを手で付ける」、
こちらは「スタディ > シリーズ > インスタンスの階層、検査日とモダリティはタグから決まる」で、
一覧の単位も取込の経路も表示の道具も重ならない。

範囲外: PACS・モダリティとの接続(Q/R、Storage SCP)、オーダー・読影レポートとの紐付け、匿名化、
動画(マルチフレーム)の連続再生、SR・PDF など画像でない SOP Class の表示。

---

## 2. リソース構造(器の判断)

### 2.1 実体は backend、上流には ImagingStudy だけ

［事実］上流の `Binary` は base64 のまま Postgres の jsonb に入り、書き込みのたびに `resource_versions` へ
全文が複製される。削除は論理削除で、容量は戻らない。1 リクエストは 10MB まで。
［導出］CT 1 スタディ(300 枚・150MB)で DB が 400MB 前後増える。本番 DB(Neon の無料枠)には置けない。

［事実］FHIR の `ImagingStudy` はもともと画素を持たない。実体は PACS にあり、`ImagingStudy` はそこを指す。

［決定］**DICOM の実体は、この backend の Active Storage に置く**(開発はローカルディスク、本番は
Backblaze B2)。**上流にはメタ情報の `ImagingStudy` だけを置く**。backend が簡易の PACS の役をする形で、
将来ほんものの PACS に繋ぐときは、画像の取得先を差し替えればよい。

［決定］Active Storage は DICOM のためだけに使う。`docs/patient-file-design.md` §2.3 が Active Storage を
採らなかった理由(FHIR リソースを backend に持たない)は、書類については今も変わらない。DICOM の実体は
FHIR リソースではなく、上流に置ける大きさでもない。

採らなかった案:

- **上流の `Binary` にそのまま置く**。追加のインフラは要らないが、上の容量の問題に加えて、1 枚 7.5MB を
  超える画像(マンモグラフィ、一部の CR/DX)が入らない。
- **上流の `Binary` を生バイトの POST とオブジェクトストレージに対応させる**。FHIR としては素直だが、
  両リポジトリの改修になり、版の履歴・transaction との整合まで設計が要る。必要になったら、
  `ImagingStudy` はそのままに実体の置き場だけ移せる。

### 2.2 `dicom_instances`(backend)

［決定］1 行 = DICOM の 1 インスタンス(1 ファイル)。`sop_instance_uid` が一意キーで、実体は
`has_one_attached :file`。スタディ・シリーズの属性(検査日、モダリティ、シリーズ番号、説明など)も
行に持つ。同じスタディの行はどれも同じ値になるが、`ImagingStudy` を行の集まりだけから組み立てられる
ことを優先し、studies / series の表は作らない。

［決定］DICOM のタグに書かれていた患者名・患者 ID(他院の CD なら他院の患者番号)は `encrypts` で
暗号化して持つ。検索には使わない。

［決定］同じ SOP Instance UID の送り直しは成功として扱う(再送・再取込が安全)。別の患者に
取り込まれている UID は 409 で断る(上書きも共有もしない)。

### 2.3 サーバー側で確かめること

［決定］Ruby の DICOM ライブラリは入れない。`DicomHeader` が読むのは、オフセット 128 の `DICM` と
File Meta Information(group 0002)だけ。ここは転送構文によらず Explicit VR Little Endian で書かれる。
確かめるのは「DICOM であること」と「申告された SOP Instance UID が実体と一致すること」。SOP Class と
転送構文はファイルから読んだ値を保存し、それ以外の属性はブラウザが読んだ値を信用する
(データセット本体は転送構文ごとに読み方が変わり、サーバーで読み直す利点が小さい)。

### 2.4 `ImagingStudy`

［決定］書くのは backend(`ImagingStudyBuilder` / `ImagingStudyPublisher`)。保存済みの行の現状から
組み立て、`PUT /ImagingStudy?identifier=urn:dicom:uid|urn:oid:<Study UID>` で置き換える。
追加取込でも、一部失敗のあとの再送でも、「組み立て直して置く」だけで揃う。実体の無いインスタンスが
`ImagingStudy` に載ることも無い。ブラウザが `/fhir` 経由で触るのは読み出しだけ。

| 要素 | 値 |
|---|---|
| `identifier` | `urn:dicom:uid` \| `urn:oid:<Study Instance UID>`。Accession Number があれば type `ACSN` でもう 1 つ |
| `status` | `available` |
| `subject` | 取込先の患者 |
| `started` | Study Date + Study Time(`+09:00`)。時刻が無ければ日付だけ、日付も無ければ省く |
| `modality` | シリーズのモダリティの集合(`http://dicom.nema.org/resources/ontology/DCM`) |
| `description` | Study Description |
| `extension` | `http://fhir-client.local/StructureDefinition/imaging-source`(`institutionName` / `patientId` / `patientName`)。取込元の施設と、タグに書かれていた患者 |
| `series[]` | `uid` / `number` / `modality` / `description` / `bodySite`(display のみ) / `instance[]`(`uid` / `sopClass` / `number`) |

［事実］上流のプロファイル検証(JP_ImagingStudy_Radiology)は既定で警告どまりだが、`series.uid` /
`series.modality` / `instance.uid` / `instance.sopClass` は 1..1。強制に切り替わっても通るよう全部埋める
(モダリティがタグに無いシリーズは `OT`)。

［決定］インスタンスの実体の URL は `ImagingStudy` に書かない。SOP Instance UID から
`/imaging/instances/<uid>` と決まるので、URL の体系を変えても `ImagingStudy` を書き直さずに済む。

［事実］UID は実際の DICOM から読んだもの。`docs/rad-backlog.md` F-1 が戒めている「UID の捏造」には当たらない。

### 2.5 削除

［決定］スタディ単位で、実体ごと消す。順序は「上流の `ImagingStudy` → backend の実体と行」。上流で
失敗したら実体は残す(`ImagingStudy` はあるのに画像が無い、という状態を作らない)。

---

## 3. API(backend `/imaging`)

認証は `/fhir` プロキシと同じ(ログインセッション + 非 GET は CSRF トークン)。

| メソッド / パス | 内容 |
|---|---|
| `POST /imaging/instances` | multipart(`file` / `patient_id` / `meta`)。201 新規、200 取込済、409 別患者、413 200MB 超、422 DICOM でない・UID 不一致 |
| `GET /imaging/instances/:sop_uid?patient=` | `.dcm` をそのまま返す。`Cache-Control: private, immutable` と ETag(内容は UID ごとに不変) |
| `GET /imaging/studies?patient=` | スタディごとの保存済み枚数(取込フォームの「取込済」判定) |
| `GET /imaging/studies/:study_uid/instances?patient=` | 保存済みインスタンスの一覧(フレーム数・転送構文など `ImagingStudy` に無い属性) |
| `POST /imaging/studies/:study_uid/commit` | 保存済みの行から `ImagingStudy` を置く |
| `DELETE /imaging/studies/:study_uid?patient=` | §2.5 |

［決定］配信は backend が中継する(ストレージへのリダイレクトにしない)。ブラウザから見えるオリジンが
1 つのままなので、ログインの Cookie がそのまま効き、ストレージ側の CORS 設定も要らない。Active Storage の
既定のルート(`/rails/active_storage/*`)は生やさない(`draw_routes = false`)。

［決定］Direct upload は使わない。サーバーで DICOM の検証ができなくなり、既定のルートも開けることになる。

---

## 4. 画面

### 4.1 「DICOM」タブ(`KarteImagingTab`)

一覧(検査日で区切った表: 時刻 / モダリティ / 検査内容 / シリーズ数 / 枚数 / 取込元)→ 詳細(検査情報と、
シリーズごとのサムネイル)→ ビューア。一覧は `_elements` で `series` を落として引く(1 スタディに
数百インスタンスが載るため)。

### 4.2 取込(`KarteImagingImportForm`)

［決定］ZIP の展開とタグの解析はブラウザで行う(`fhir/dicomImport.ts`)。backend にジョブ基盤が無く、
数百 MB の ZIP を 1 リクエストで受けて同期で処理するとタイムアウトしやすい。ブラウザで開けば、取込前に
中身を確かめられ、インスタンス単位で送るので進捗(N / M 枚)が出せ、失敗したぶんだけ再送できる。

- **PDI のディスクは目次(DICOMDIR)から読む**(`fhir/dicomdir.ts`)。フォルダを選ぶ・ドロップすると
  ディスクの中身が全部渡ってくるが、目次に載っているファイルだけを相手にすれば、ビューアのプログラム
  (`VIEWER/`)や Web 表示用の JPEG(`IHE_PDI/`)を開かずに済み、一覧もファイルを開く前に出る。
  - 目次の木(患者 > スタディ > シリーズ > 画像)はファイル先頭からのバイト位置で繋がっている。
    並び順ではないので、`(0004,1200)` の根から「下」`(0004,1420)`・「次」`(0004,1400)` を辿る。
    参照先 `(0004,1500)` は選ばれたファイルの位置と突き合わせる(大文字に揃える。フォルダではなく
    ファイルを直に選んだときは、名前が 1 つしかないものに限り名前で突き合わせる)。
  - 目次に無い属性(施設名・部位)があるので、スタディごとに 1 枚だけファイルのタグを読んで補う。
  - **送る meta はファイル本体のタグから作り直す**(`instanceToSend`)。実体は送るために開くので、
    ついでにタグを読めばよい。目次と中身が食い違っていても、保存されるのは中身の方になる。
- **目次が無い・読めない・指しているファイルが 1 つも無いときは、ファイル 1 つずつのタグ
  (Study / Series / SOP Instance UID)だけで振り分ける**。一部だけコピーされたフォルダでも、ZIP でも、
  単体の `.dcm` でも同じに扱える。拡張子は見ず、オフセット 128 の `DICM` で判定する。
- ZIP は fflate のストリーム展開。DICOM でないエントリは先頭を見た時点で捨てる。`unzipSync` は
  壊れた ZIP64 で無限ループする既知の問題があるので使わない。ZIP の中の目次は使わない(どのみち
  全エントリを展開しながら読むので、目次で減らせるものが無い)。
- 文字コードは `fhir/dicomText.ts`。ISO 2022(IR 87 / IR 13 / IR 159)はエスケープを自前で追う
  (TextDecoder の iso-2022-jp は 8 ビットの半角カナを扱えない)。文字集合の指定が無いのに 8 ビット文字が
  入っているファイルは、UTF-8、Shift_JIS の順に当てはまるものを使う。
- カルテの患者と DICOM 側の患者が違っていても止めない(他院の CD は患者番号が違うのが普通)。並べて見せる。
- 送信は 3 並列。スタディごとに、送り終えたら commit する。一部が失敗したスタディも、保存できたぶんで
  `ImagingStudy` を作る(再送が通れば同じ操作で枚数が増える)。
- 既に全枚数が保存されているスタディは「取込済」と出し、既定では送らない。

### 4.3 ビューア(`DicomViewerModal` / `DicomViewport`)

［決定］Cornerstone3D(`@cornerstonejs/core` / `tools` / `dicom-image-loader`)。CD の画像は JPEG Lossless
などの圧縮転送構文が普通で、復号を自前で持つのは現実的でない。3 パッケージは同じ版に固定する。
大きいので `lazy()` で分け、画像を開くまで読み込まない。

- 左ドラッグの道具(ウィンドウ / 移動 / 拡大 / 距離 / 角度)は選んで切り替える。中ドラッグ = 移動、
  右ドラッグ = 拡大、ホイール = コマ送りは常に効く。↑↓ でコマ送り、←→ でシリーズ、Esc で閉じる。
- CT のときだけウィンドウのプリセット(肺野・縦隔・腹部・骨・脳)を出す。
- 四隅に、取込元の患者・施設、検査日・検査内容・シリーズ、コマ番号・拡大率、WW/WL。
- タグ一覧は表示中の 1 枚を読み直して作る(ブラウザのキャッシュから返る)。名前を出すタグは
  `imaging/dicomTagNames.ts` の範囲。
- マルチフレームはフレームごとに 1 コマとして並べる。フレーム数は `ImagingStudy` に無いので
  `/imaging/studies/:uid/instances` から取る。
- **計測・注釈は保存しない**。ビューアを開いている間だけのもの。残したいものは「画像を保存」で、
  画像・注釈(SVG 層)・四隅の文字を 1 枚の canvas に描き直し、画像の写っている範囲に切り詰めた JPEG を `DocumentReference` + `Binary`
  (`docs/patient-file-design.md` と同じ形)で登録する。表示名・診療日(既定は検査日)・カテゴリは保存時に選ぶ。
- 矢印・文字の注釈の入力は、cornerstone 既定の `window.prompt` を使わずビューア内の入力欄で受ける
  (`getTextCallback` / `changeTextCallback` の差し替え)。
- サムネイルはシリーズの中央の 1 枚をその場で描く(別に保存しない。実体は immutable でキャッシュされる)。

### 4.4 Vite の設定

［事実］`dicom-image-loader` は復号用の Web Worker と wasm を自分のファイルからの相対 URL で読むので、
依存の事前バンドルから外す(`optimizeDeps.exclude`)。外すとその依存も素通しになるため、次は名指しで
事前バンドルに戻している。

- `dicom-parser` と復号の codec: CommonJS で、ブラウザはそのまま読めない。
- `@cornerstonejs/metadata`: core も使う。素通しだと core 側と別の実体になり、ローダーが登録した画像の
  属性を core が引けない(症状は "no pixel data in NATURALIZED")。

［事実］cornerstone の描画基盤(vtk.js)が引き込む `xmlbuilder2` は Node の `events` を継承する。
ブラウザ用の `events` パッケージを依存に入れて解決している。

---

## 5. 本番の準備

1. Backblaze B2 に非公開のバケットと、そのバケットに限定した Read and Write のアプリケーションキーを
   作る。B2 の有効化にはカードの登録は要らないが、SMS による電話番号の確認が要る。無料枠は 10GB と、
   保存量の 3 倍までの下り転送。
2. Render の backend に `B2_KEY_ID`(keyID)と `B2_APPLICATION_KEY`(applicationKey)を設定する。
   endpoint・region・バケット名は `config/storage.yml` に既定があるので、変える必要が無い限り
   設定は要らない(env で上書きはできる)。`render.yaml` の env は Blueprint を再適用しないと
   反映されないので、ダッシュボードで設定する。
   ［事実］Active Storage の service は起動時(eager load)に作られるので、endpoint・region・
   バケット名のどれかが欠けると aws-sdk が例外を投げ、**アプリ全体が起動しない**。既定を
   `storage.yml` に持たせているのはこのため。アプリケーションキーだけは欠けても起動は通り、
   取り込みのときに認証エラーになる。
   ［事実］認証情報が見つからないと aws-sdk は EC2 のインスタンスプロファイル
   (169.254.169.254)へ問い合わせて起動が数秒止まるので、`production.rb` で
   `AWS_EC2_METADATA_DISABLED` を立てている。
   別の S3 互換ストレージに替えるときは `config/storage.yml` の `b2` ブロックだけを差し替える。
3. `render.yaml` の static site に `/imaging` と `/imaging/*` の rewrite がある(無いと SPA フォールバックに落ちる)。
4. 上流の変更は無い(`ImagingStudy` は実装済み・本番に反映済み)。

---

## 6. 未決事項・申し送り

1. **オーダー・読影レポートとの紐付け**。`ImagingStudy.basedOn` / `procedureReference`、
   `DiagnosticReport.imagingStudy`。突き合わせの鍵は Accession Number(`identifier` に保存済み)。
   院内のモダリティ・PACS と繋がる段階の話で、持ち込み CD の取込では要らない(`docs/rad-backlog.md` F-1)。
2. **孤児インスタンスの掃除**。commit の前に取込を中断すると、`ImagingStudy` の無い行が残る。
   同じものを取り込み直せば埋まるが、取り込み直さない場合の掃除の口は無い。
3. **モダリティの値集合**。JP_ImagingStudy_Radiology の `modality` は required binding。値集合に無い
   モダリティのファイルは、上流がプロファイル検証を強制に切り替えると弾かれる。
4. **大きな ZIP**。展開した DICOM は送信まで Blob として持つ。1GB 級で問題が出たら、1 周目で
   メタ情報だけ集め、2 周目で選ばれたスタディだけを送る形に変える。ZIP64 と、サイズ不明の無圧縮エントリは
   ストリーム展開できない(エラーを出す)。
5. **マルチフレームの大きなファイル**。1 フレームを見るのにもファイル全体を取得する(Range 配信は無い)。
6. **画像でない SOP Class**(SR・PDF・線量レポート)。取り込むが、ビューアでは「表示非対応」。
7. **タブの横あふれ**。カルテのタブが 13 個になった(`docs/patient-file-design.md` §6 と同じ課題)。

---

## 7. 実装の差し込み点

| 層 | ファイル | 内容 |
|---|---|---|
| backend | `config/application.rb` / `config/storage.yml` / `config/environments/*` | Active Storage の有効化(既定ルート無し・解析無し) |
| backend | `db/migrate/*_create_active_storage_tables.rb` / `*_create_dicom_instances.rb` | 表 |
| backend | `app/models/dicom_instance.rb` | 行と実体 |
| backend | `app/services/dicom_header.rb` | File Meta Information の読み取り |
| backend | `app/services/imaging_study_builder.rb` / `imaging_study_publisher.rb` | `ImagingStudy` の組み立てと上流への書き込み |
| backend | `app/controllers/imaging/*` / `config/routes.rb` | API |
| backend | `app/controllers/fhir_proxy_controller.rb` | `ImagingStudy` を許可リストに追加(読み出し用) |
| frontend | `fhir/dicomImport.ts` / `fhir/dicomText.ts` | ファイル・フォルダ・ZIP からの収集、タグ解析、文字コード |
| frontend | `fhir/imagingHelpers.ts` / `api/imagingClient.ts` / `api/queries.ts` | `ImagingStudy` の読み取り、`/imaging` のクライアント |
| frontend | `components/KarteImagingTab.tsx` / `ImagingStudyTable.tsx` / `KarteImagingDetail.tsx` / `KarteImagingImportForm.tsx` | タブ |
| frontend | `components/DicomViewerModal.tsx` / `DicomViewport.tsx` / `DicomThumbnail.tsx` / `DicomTagListModal.tsx` / `imaging/*` | ビューア |
| frontend | `karteUrl.ts` / `pages/KartePage.tsx` / `vite.config.ts` | タブの追加、proxy と事前バンドルの設定 |
| 配備 | `docker-compose.yml` / `render.yaml` | 実体の置き場、rewrite |

雛形にした既存実装: `KarteFileTab` 一式(タブの状態の持ち方、取込フォーム、日付で区切る表)、
`LabLabelReport`(backend から上流への書き込み)、`SchemaPaintModal`(重い部品の `lazy()`)。

---

## 8. 実装時の検証

- backend: `spec/requests/imaging/*`、`spec/services/dicom_header_spec.rb`、
  `spec/services/imaging_study_builder_spec.rb`。
- 試料は pydicom のテストデータ(CT / MR、JPEG Lossless、JPEG 2000、RLE カラー、マルチフレーム、
  日本語の文字集合 `chrH31` / `chrH32`)。リポジトリには入れない。
- 確かめたこと: ZIP(拡張子なしのファイル + DICOM でないファイル混在)と単一ファイルの取込、日本語の
  患者名の復号、同じ ZIP の取り込み直しが「取込済」になること、各転送構文の表示、マルチフレームの
  フレーム展開、プリセット、距離の計測、タグ一覧、削除(上流 410 / 実体 404 / ディスク 0 件)。
- ブラウザ自動化のタブは非表示扱いで `requestAnimationFrame` が止まり、cornerstone が描画しない。
  確認するときは rAF を `setTimeout` に差し替えるか、通常のタブで見る。
