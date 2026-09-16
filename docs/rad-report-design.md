# 放射線検査 読影レポートの設計

放射線検査の読影レポート(所見・診断・画像)の登録と表示。オーダー側は
`docs/rad-order-master-design.md`、実施入力は `docs/rad-result-design.md`、不足機能の全体像は
`docs/rad-backlog.md`(本書は同 §A の設計)。

調査日: 2026-09-16。上流 fhir-server の実装状況は同日のソースで確認済み。

**実装済み(2026-09-16)**。開発環境で §11 の検証を通した(結果は §11 の末尾)。設計から変えた点・
実装で決めた点は各節の「実装メモ」に書いた。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・このリポジトリの実装で確認した内容
- **［導出］** = 仕様・事実から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計提案

---

## 1. スコープ

- 読影レポートの登録・編集・削除・表示(所見・診断・読影医・報告日時)
- **任意の画像を複数添付**し、**画像に描き込み(アノテーション)**を入れる
- 報告区分(暫定・最終・訂正)
- 依頼医の既読(結果確認)と、重要所見の通知
- 所見・診断のテンプレート記入
- 導線: 放射線検査一覧とカルテの放射線カード

含めないもの:

- **読影ワークリスト**(撮影日をまたいで未読影を並べる一覧)… `docs/rad-backlog.md` §A-5
- **ImagingStudy と PACS 連携** … §9-1
- **線 1 本単位の描き込みの再編集** … §3.3
- **カルテのタブ**(検体検査の累積表のような読影レポート専用の表示)… §4.5
- **前回レポートとの比較表示** … §9-3

---

## 2. リソース構造

［提案］病理レポート(`docs/patho-order-design.md` §4.2、`fhir/pathoResultHelpers.ts`)を雛形にする。
検体検査は「項目 × 値」の表で形が合わず、病理は「所見(自由文)+ 診断 + 画像」で読影レポートと
ほぼ同じ形をしている。保存は病理と同じく 1 本の transaction Bundle(`POST /fhir`)。

```text
ServiceRequest (放射線オーダー ヘッダ)                          ※既存
 ├ basedOn ← ServiceRequest (明細 = 撮影項目)                   ※既存
 ├ focus   ← Task (依頼済 → 受付済 → 実施済 / 中止)             ※既存
 ├ basedOn ← Procedure (実施記録)                               ※既存
 └ basedOn ← DiagnosticReport (読影レポート)                    ← 本書の中心
      status             = preliminary | final | amended
      category           = LOINC|LP29684-5 + v2-0074|RAD + 入外区分
      code               = JP_DocumentCodes_CS|18748-4(画像検査報告書)+ text = 撮影内容
      subject / encounter
      effectiveDateTime  = 撮影日時
      issued             = 報告日時
      resultsInterpreter = 読影医
      performer          = 自院
      conclusion         = 診断
      result → Observation (所見。valueString)
      extension[rad-report-image]                 0..*  画像(§3)
      extension[rad-critical-finding]             0..1  重要所見の要点(§6.2)
      extension[rad-report-findings-response]     0..1  所見のテンプレート記入(§7)
      extension[rad-report-conclusion-response]   0..1  診断のテンプレート記入(§7)
      extension[order-department]                       診療科(既存)
```

### 2.1 前提として確認した事実

- ［事実］上流の `DiagnosticReportValidator` が要求するのは `status`(値セット検証あり)・`code`・
  `subject`(実在する Patient)だけ。
- ［事実］上流の DiagnosticReport は `based-on` / `category` / `code` / `date` / `result` / `status` /
  `subject` の検索と `_revinclude=DiagnosticReport:based-on` に対応済み(検体検査・病理で使用中)。
- ［事実］`DiagnosticReport` / `Observation` / `Binary` / `QuestionnaireResponse` / `Task` / `Provenance` は
  すべて `FhirProxyController::ALLOWED_RESOURCE_TYPES` にある。
- ［導出］**上流とプロキシの変更は要らない**。足りないのはクライアント側の器だけ。

### 2.2 要素ごとの設計判断

- **読影医は `resultsInterpreter`**。［事実］R4 の `DiagnosticReport.resultsInterpreter` は
  「結果の主たる解釈者」で読影医そのもの。`performer` は「レポートの発行に責任を持つ者」なので自院を入れる。
  病理・検体検査は読影医に当たる概念が無く `performer` に実施者を入れているが、放射線は
  「撮った人(技師)」と「読んだ人(医師)」が別で、前者は実施記録の `Procedure.performer` が既に持っている。
  ［提案］読影医は保存時にログイン中の医療従事者を焼き付け、編集では最初の読影医を残す
  (検体検査の実施者と同じ扱い)。Practitioner に紐付かないアカウント(管理者)では付けない。
- **所見は `Observation`、診断は `conclusion`**。［事実］`conclusion` は「結果の簡潔な臨床的解釈」と
  定義されており、読影の診断(インプレッション)に当たる。［導出］所見まで `conclusion` に入れると、
  訂正のときにどちらを直したかが `_history` から読めなくなる。病理は診断も Observation にしているが、
  病理は JAHIS 規約がセクション LOINC を定めているためで、読影にはその縛りが無い。
- **所見の Observation は 1 件**。［提案］部位ごとに分けない。読影所見は「胸部: … 腹部: …」と
  一続きの文章で書くのが通常で、構造化(RadLex・ACR の定型報告)は §9-4 で扱う。
- **撮影日時は実施記録から写す**。［提案］`effectiveDateTime` は実施記録の `performedDateTime`、
  実施記録が無ければ(実施入力の無い撮影項目)オーダーの `occurrenceDateTime`。
  ［導出］カルテの並びと通知の「対象日」が撮影日になり、読影した日にならない。
- **`code` の text は撮影内容**。［提案］オーダー明細の GP ごとの `entryLabel`(「Ｘ線CT | 胸部単純CT」)を
  「・」で連結する。通知の内容欄と既読の一覧はこの text を読む。
- **`category` の v2-0074 は `RAD`**。［事実］検体検査は `LAB`・細菌は `MB`・病理は `SP` / `CP` で、
  結果一覧(`useResultSummariesQuery`)はそれぞれ自分の種別だけを検索している。
  ［導出］読影レポートがこれらのタブに混ざることは無い。
- **`presentedForm`(PDF 埋め込み)は使わない**。検索も差分も取れない塊になり、訂正の履歴が読めなくなる。
  外部の RIS からレポートを取り込む段階(§9-2)で改めて判断する。
- **`imagingStudy` は空**。§9-1。
- **`category` と `code` は JP Core の `JP_DiagnosticReport_Radiology` に合わせる**。［事実］同プロファイルは
  `category` に LOINC `LP29684-5`(Radiology)を固定スライスで、`code` に
  `http://jpfhir.jp/fhir/core/CodeSystem/JP_DocumentCodes_CS` の `18748-4`(画像検査報告書)を
  固定スライスで求める(JP Core 1.1.2)。`result` は放射線では定義されていない。
  ［実装］上流の登録先プロファイルは `JP_DiagnosticReport_Common` なので `meta.profile` は付けず、
  要素の入れ方だけを Radiology プロファイルに合わせた。`category` には v2-0074 の `RAD` と入外区分も並べる
  (他の結果と同じ軸で引けるようにするため)。読影レポートの判定(`isRadReport`)は LOINC の category で行う。

### 2.3 コードシステム・拡張

すべて `http://fhir-client.local/` 配下。

| URI 末尾 | 種別 | 用途 |
|---|---|---|
| `StructureDefinition/rad-report-image` | 複合拡張 | 画像 1 枚(§3.1) |
| `StructureDefinition/rad-critical-finding` | valueString | 重要所見の要点(§6.2) |
| `StructureDefinition/rad-report-findings-response` | valueReference | 所見のテンプレート記入(§7) |
| `StructureDefinition/rad-report-conclusion-response` | valueReference | 診断のテンプレート記入(§7) |
| `CodeSystem/rad-report-item` | CodeSystem | 所見 Observation の `code`(`findings`)。LOINC が確定したら coding を**追加**する |

既存を再利用するもの: 入外区分(`lab-result-setting`)、診療科(`order-department`)、
通知の `task-code`(`result-review` と新設の `rad-critical-finding`)。

---

## 3. 画像と描き込み

### 3.1 持ち方

［事実］上流に **Media リソースは無い**(ルートにもレジストリにも無い)。［事実］R4 の
`DiagnosticReport.media.link` は `Reference(Media)` を要求する。［導出］病理(`docs/patho-order-design.md`
§4.5)と同じく **Binary + 拡張**にするしかない。

```text
extension[rad-report-image]                                    0..*(並び順 = 表示順)
  extension[source]     valueAttachment  1..1  元画像
                          contentType, url = Binary/<id>, title = キャプション
  extension[annotated]  valueAttachment  0..1  描き込みの合成画像
                          contentType, url = Binary/<id>
```

設計判断:

- **元画像と描き込み画像を別の Binary に持ち、両方を参照する**。［事実］描き込みモーダル
  (`components/SchemaPaintModal.tsx`)は fabric のオブジェクトを保存せず、背景込みの合成画像だけを返す。
  ［導出］合成画像だけを残すと、描き込みを直すときに元の画像を取り戻せない。オーダーのシェーマ・
  病理の切り出し図では台紙がシェーママスタに残っているので困らなかったが、読影の画像は台紙が
  ユーザーの貼った 1 枚きりで、合成すると元が失われる。
- **表示は `annotated` があればそれ、無ければ `source`**。拡大表示では両者を切り替えられる(§4.3)。
- **キャプションは `source.title`**。画像 1 枚の属性はキャプションだけにする(種別の分類は持たない)。
  ［提案］キーになるスライスには「肺野条件 右 S1 の結節」のように読影医が書く。種別を固定の
  選択肢にすると、モダリティごとに要る分類(条件・相・シーケンス)が違って選択肢が破綻する。
- **病理の `patho-report-image` とは別の URL にする**。病理は `kind` + `image`、放射線は `source` + `annotated` で
  子拡張の意味が違う。同じ URL に意味の違う子を混ぜると、読み手がどちらの形か判別できない。
- **並び順は拡張の順**。読影では見せる順番に意味がある(所見の記述順に並べる)ので、入力画面に
  上下の並べ替えを付ける。病理(並べ替え無し、表示は種別ごとにまとめ直す)とはここが違う。
- **Binary の扱いは既存と同じ**。［事実］本体と同じ transaction に積み、`fullUrl` の `urn:uuid` で参照する
  (`imageBinaryEntry`)。外した画像・描き直しで参照が外れた Binary は削除しない
  (上流の旧版が参照しているため。readme「シェーマ画像」)。

### 3.2 サイズ(上流の本文上限への対応)

［事実］上流はリクエスト本文が 10MB(`FHIR_MAX_BODY_BYTES` の既定)を超えると 413 で拒否する
(`lib/middleware/request_size_limiter.rb`)。［事実］画像は base64 で Bundle に埋め込むので元の約 4/3 倍になる。
［事実］`normalizeImageFile` は長辺 1600px に縮小し、PNG は PNG のまま残す(線画のシェーマを劣化させないため)。

［導出］CT・MR・単純写真のスクリーンショットは写真的な濃淡画像で、PNG のままだと長辺 1600px で
1 枚 1〜3MB になる。元画像と描き込み画像の 2 枚を持つので、数枚で 10MB に届く。

［提案］3 つの対策を組み合わせる。

1. **放射線の画像は元画像・描き込み画像とも JPEG(品質 0.9)で保存する**。
   `normalizeImageFile` に出力形式のオプション(既定は現状どおり)、`SchemaPaintModal` に書き出し形式の
   オプション(既定は PNG)を足す。透過のある画像は白で塗ってから変換する(サムネイル生成と同じ)。
   濃淡画像を JPEG 0.9 にしても読影に差し支える劣化は出ず、1 枚あたり数百 KB に収まる。
2. **1 回の保存で新しく送る画像の合計に上限を置く**(base64 で 7MB)。本文・Observation・テンプレート回答
   (テンプレート内のシェーマ画像を含む)の余白を残した値。超えたら保存させず
   「一度に添付できる画像の量を超えています。いったん保存してから追加してください。」と出す。
   ［導出］保存済みの画像は参照だけで再送しないので、分けて保存すれば枚数の制限にはならない。
3. **上限の判定は Bundle を組んだ後に行う**。新規の Binary エントリの `data` の長さを合計する。
   フォームの状態から見積もると、テンプレート回答の画像を数え落とす。

採らなかった案:

- **画像を先に別の transaction で送り、後で本体を保存する**。本体の保存に失敗すると参照されない Binary が残る。
  このリポジトリは「画像と本体を 1 回で保存し、孤児を構造的に作らない」を方針にしている
  (`fhir/schemaImage.ts` 冒頭)。
- **上流の上限を上げる**。無償枠のサーバーで大きな本文を受けるとメモリを圧迫する。上げても枚数を
  増やせば同じ問題に当たるので、保存を分ける導線の方が根本的な答えになる。

### 3.3 描き込み

［提案］`SchemaPaintModal`(ペン・直線・矢印・四角・楕円・文字、undo/redo)をそのまま使う。
［事実］入出力は `{ title, backgroundDataUrl, onSave(dataUrl), onClose, saveLabel }` だけの疎結合で、
既に 4 か所(テンプレート回答・診療記録・病理オーダー・病理レポート)で使い回している。

足すもの:

- **色の選択肢を渡せるようにする**。［事実］いまは黒・赤・青・緑の固定。［導出］暗い CT・MR の上では
  黒と青が見えない。放射線は **黄・赤・水色・白** を渡す。既定は現状のまま。
- **書き出し形式**(§3.2)。

描き込みの操作(1 枚ごと):

| 状態 | 操作 | 台紙 | 結果 |
|---|---|---|---|
| 描き込み無し | 描き込み | 元画像 | `annotated` を新設 |
| 描き込みあり | 描き足す | 描き込み画像 | `annotated` を差し替え |
| 描き込みあり | 元画像から描き直す | 元画像 | `annotated` を差し替え |
| 描き込みあり | 描き込みを外す | — | `annotated` を削除(元画像の表示に戻る) |

設計判断:

- **線 1 本単位の再編集は作らない**。fabric のオブジェクトを JSON で保存すれば可能になるが、
  `SchemaPaintModal` に読み込み・書き出しを足すことになり、他の 4 か所にも波及する。
  ［導出］「元画像から描き直す」があれば、直したい線があっても元画像は失われない。
  描き込みは矢印と短い文字が大半で、描き直しの手間は小さい。
- **保存済みの画像に描き込むときは、台紙を Binary から読み直す**(`fetchBinaryImage`)。
  React Query のキャッシュに dataURL があればそれを使う。

---

## 4. 画面

### 4.1 入力(読影レポートのモーダル)

［提案］放射線検査一覧とカルテの両方から**同じモーダル**を開く。病理は一覧のモーダルとカルテのタブで
入力するが、放射線はカルテのタブを持たない(§4.5)ので、入口を 1 つの部品に揃える。
オーダー id を受けて、レポートがあれば編集、無ければ登録として開く。

上から順に:

1. **依頼内容**(読み取り専用、畳める)。撮影内容・依頼病名・検査目的・特別指示・撮影日時・造影剤。
   読影医が臨床情報と造影の有無を見て読むため。`RadOrderDetailPanel` と実施記録
   (`useRadPerformDetail` + `radPerformsByOrderId`)を流用する。
2. **報告区分**: 暫定報告 / 最終報告。確定済み(最終・訂正)を編集しているときは、保存ボタンの文言を
   「訂正報告として更新」に変える。［実装］注意書きの文を足さないのは、フォームに説明文を置かない
   このアプリの方針に合わせたため(判定は病理の `willBecomeAmended` と同じ)。
3. **所見**(複数行)と **診断**(複数行)。どちらもテンプレート記入に対応(§7)。
4. **重要所見**: 「重要所見あり」のチェックと要点(1 行)。チェックすると要点が必須になる(§6.2)。
5. **画像**(§4.2)。

検証:

- 最終報告は**診断を必須**にする。暫定は空でも保存できる(当直帯の速報で所見だけ先に出す運用を止めない)。
- 所見・診断・画像がすべて空なら保存させない。
- 画像の量の上限(§3.2)。

読影医と報告日時は入力欄を出さず、保存時に焼き付ける(§2.2)。

［実装］画像欄はファイルのドロップ・貼り付けを受けるので `<form>` の外に置き、保存ボタンは `form` 属性で
本文のフォームに結び付けた。描き込み・拡大表示・テンプレート記入のモーダルもフォームの子孫にしない
(`Modal` は非ポータルで、form の入れ子は送信が外へ漏れる)。レポートの削除は、編集で開いたときに
モーダルの上部に置く「読影レポートを削除」から行う。

### 4.2 画像欄

1 行 = 1 枚。

```text
[サムネイル] キャプション[______________]  [描き込み ▾] [↑][↓] [×]
```

- サムネイルを押すと拡大表示(§4.3)。描き込みがあるものはサムネイルに印を付ける。
- 「描き込み」は §3.3 の表の操作。描き込みがある行ではメニューに畳む。
- 追加の経路は 3 つ。
  - **「＋画像を添付」**。ファイル選択は**複数選択**を許し、選んだ順に行を足す。
    ［事実］病理は 1 枚ずつしか選べない(`files?.[0]`)。
  - **ドラッグ&ドロップ**。画像欄にファイルを落とす。
  - **貼り付け**。画像欄にフォーカスがあるときの貼り付けで、クリップボードの画像を足す。
    ［導出］読影端末では、ビューアのスクリーンショットをファイルに保存せずに貼る運用が最も手数が少ない。
    テキストの貼り付け(キャプション欄など)には干渉しない。
- 画像以外のファイル・20MB を超えるファイルは、その 1 件だけ追加せずに理由を出す(他は足す)。

### 4.3 拡大表示

［事実］いまの画像表示(`SchemaImageGallery`)は 160px のサムネイルだけで、拡大する手段が無い。
［導出］読影のキー画像は、サムネイルでは所見が見えず役に立たない。

［提案］拡大表示のモーダルを新設する。

- 画面に収まる最大の大きさで表示し、キャプションを添える。
- 前へ / 次へ(ボタンと左右キー)で同じレポートの画像を移る。
- 描き込みがある画像は「描き込み / 元画像」を切り替えられる。
- `SchemaImageGallery` に「サムネイルを押したとき」のコールバックを足し、病理レポート・
  病理オーダーのシェーマからも同じ拡大表示を使えるようにする(既定では何もしない)。

### 4.4 表示

読影レポートの内容表示(詳細モーダルと、一覧から開く表示で共用):

- 報告区分(暫定・訂正はバッジ)、報告日時、読影医、撮影内容、撮影日時
- 重要所見(ある場合だけ、目立つ枠で先頭に)
- 所見、診断(テンプレート記入のシェーマ画像があれば並べる)
- 画像のギャラリー(押すと拡大表示)
- 依頼医の確認(§6.1)

### 4.5 導線

**放射線検査一覧**(`pages/RadWorklistPage.tsx`):

- 「レポート」列を足す。未 / 暫定 / 最終 / 訂正。
- 実施済の行に「読影」ボタン。レポートが無ければ登録、あれば編集として §4.1 を開く。
  ［提案］受付済の行には出さない。撮る前の読影は無い(病理は受付済の行から出している)。
- ［事実］一覧の検索は `_revinclude` を `params.set` で 1 本だけ設定している。
  ［導出］`DiagnosticReport:based-on` を足すときは `append` に直さないと、Task の取得が上書きされて
  進捗が全行「依頼済」に戻る。

**カルテの放射線カード**:

- 報告区分のバッジ(「結果:暫定報告」「結果:訂正報告」)。病理のカードと同じ位置。
- メニューに「読影レポート表示」(レポートが無ければ無効)と「読影レポート登録 / 編集」。
- 詳細モーダルの種別に `rad-result` を足す(`karteUrl.ts` の `KarteDetailKind` と `DETAIL_KINDS` の両方。
  型だけ足すと URL の解析で弾かれる)。
- ［事実］カルテのオーダー検索は既に `_revinclude=DiagnosticReport:based-on` を付けており、
  `reportByOrderId` もオーダー種別を問わず作っている。［導出］放射線カードに `reportId` / `reportStatus` を
  持たせるのは、振り分けで引くだけで済む(検索の変更は要らない)。

**カルテのタブは作らない**。［提案］放射線の結果は画像と文章で、検体検査のような累積表に並べる
意味が薄い。カードから詳細を開けば足りる。前回レポートとの比較(§9-3)を作るときに改めて判断する。

---

## 5. 報告区分

［提案］病理と同じ規約にする(`fhir/pathoResultHelpers.ts` の `nextReportStatus`)。

| status | 表示 | いつ |
|---|---|---|
| `preliminary` | 暫定報告 | 画面で選ぶ |
| `final` | 最終報告 | 画面で選ぶ |
| `amended` | 訂正報告 | 最終・訂正のレポートを編集保存したとき自動で |

- 画面で選べるのは暫定と最終だけ。確定済みを編集すると必ず `amended` になる。
- ［導出］検体検査の `corrected`(値の誤りを直した)ではなく `amended`(内容を改めた)を使う。
  読影の訂正は解釈の変更で、病理と同じ性質。
- 旧版は上流の `_history` から読める。［提案］版の比較画面は作らない(要望が出てから)。
- 暫定を最終にするのは訂正ではない(`preliminary` → `final` は通常の進行)。

---

## 6. 既読と重要所見の通知

### 6.1 依頼医の既読(結果確認)

［事実］既読の仕組み(readme「検査結果の確認(既読)」)は検体検査・細菌・病理で動いており、
`fhir/resultReviewHelpers.ts` の `ReviewReportKind` に「読影レポートを入れるときにここへ足す」と
書いてある。

［提案］`ReviewReportKind` に `rad` を足し、規則はそのまま使う。

- 最終報告になったときに依頼医あての `result-review` の通知(強度お知らせ)を作る。
  暫定報告では作らない。
- 訂正すると同じ通知を未確認に戻す。
- 確認の記録は `Provenance`(`verifier` + Verification Signature)。確認できるのは誰でも。
- 確認の操作は、読影レポートの詳細モーダルに置く(カルテにタブが無いため)。
- 通知の内容欄は `code.text`(撮影内容)。

［事実］通知の「カルテ」リンク(`resultReviewKind.karteLink`)は、種別をそのままカルテのタブのキーに
使っている。［導出］`rad` を足しただけでは存在しないタブへ飛び、カルテの既定タブに落ちて
レポートが開かない。［提案］`rad` のときだけ `detail=rad-result:<レポート id>` で詳細モーダルを開く
リンクにする。

### 6.2 重要所見の通知

［提案］新しい通知種別を足す。

| 種別(`Task.code`) | 強度 | 焦点(`focus`) | 宛先(`owner`) | 操作 |
|---|---|---|---|---|
| `rad-critical-finding` 重要所見 | アラート | 読影レポート(`DiagnosticReport`) | オーダーの依頼医 | 確認 |

- 読影医が「重要所見あり」をチェックし、要点を 1 行書いて保存すると通知を作る。要点は
  `extension[rad-critical-finding]` に残し、通知の `Task.input` と `description` にも写す
  (上流の `_include=Task:focus` は ServiceRequest しか返さないので、一覧は Task 自身から読む)。
- **暫定報告でも出す**。［導出］緊急異常値(検体検査の中間報告でも出す)と同じで、気胸・大動脈解離が
  見つかったことは確定前でも変わらない。
- **状態の遷移**:

  | 保存時の状態 | 既存の通知 | 動作 |
  |---|---|---|
  | チェックあり | 無し | 作る(未確認) |
  | チェックあり・要点が同じ | 未確認 / 確認済み | そのまま |
  | チェックあり・要点が変わった | 未確認 / 確認済み | 書き換えて未確認に戻す |
  | チェック無し | 未確認 | 取り下げる(`cancelled`) |
  | チェック無し | 確認済み | そのまま(確認した事実は残す) |

- **確認**は緊急異常値と同じく、通知を完了にして `Task.note` に誰がいつを残す。Provenance は作らない
  (真正性の記録ではなく、連絡が届いたことの記録)。
- 器は既存どおり: 通知を作るヘルパー(`fhir/labPanicHelpers.ts` と同じ形)と内容セルを書き、
  `components/notifications/notificationRegistry.tsx` の `NOTIFICATION_KINDS` に 1 要素足す。
  一覧・件数・ベルの赤・種別フィルタ・一括確認はそれで動く。
- ［提案］保存時に既存の通知を読むのは 1 回にまとめる(`result-review` と `rad-critical-finding` を
  コードの OR で `focus=DiagnosticReport/<id>` から引く)。
- **オーダーに紐付かないレポートは無い**(読影は必ずオーダーから開く)ので、宛先が決まらない場合は
  依頼医が Practitioner に紐付かないときだけ。緊急異常値と同じく宛先無しで作り、「自分あてのみ」を
  外すと見える。

---

## 7. テンプレート記入

［提案］所見と診断を、診療記録と同じテンプレート記入(`TemplateEntryModal` + `TemplateTextField`)で
書けるようにする。放射線オーダーの検査目的・特別指示(`docs/rad-order-master-design.md` §9.2)と同じ形。

- 記入内容は `QuestionnaireResponse` として**レポートと同じ transaction** で保存し、
  `extension[rad-report-findings-response]` / `[rad-report-conclusion-response]` で参照する。
- テンプレートから記載した欄は直接編集不可、「テンプレート編集」で開き直す、「解除」で文言を残して
  直接入力に戻す。
- 解除・差し替えで参照が外れた回答は、同じ transaction で DELETE する。レポートを削除するときも回答を消す。
- 所見 Observation の `valueString` と `conclusion` には、記入内容を平文にしたもの
  (`questionnaireResponsePlainText`)を入れる。［導出］テンプレートを解さない読み手
  (通知・外部連携)にも所見が読める。
- ［事実］テンプレート記入を `DiagnosticReport` で使うのは**初めて**(これまではオーダーと実施入力だけ)。
  器は種別に依存しないので追加の仕組みは要らないが、レポートの内容表示でテンプレート内の
  シェーマ画像を出す部分は新しく書く。
- テンプレート内のシェーマ画像は、画像の量の上限(§3.2)に数える。

**既定テンプレート**:

- ［提案］撮影項目マスタに `report_findings_template_canonical` を足し、所見の既定テンプレートにする
  (検査目的・特別指示と同じく canonical で持つ)。マスタ画面(`/rad-items`)の「既定のテンプレート」に欄を足す。
- 複数の撮影項目を含むオーダー(単純撮影のまとめ)では、最初の項目の既定を使う。
- 診断には既定を持たない。［導出］診断は所見から導く 1〜数行で、定型化しにくい。手動でテンプレートを
  選ぶことはできる。

---

## 8. 既存の操作との整合

- **実施の取消は、読影レポートがあると止める**。［事実］実施の取消(実施済 → 受付済)は実施記録一式を
  DELETE する(`docs/rad-result-design.md` §7-6)。［導出］レポートの撮影日時の根拠が消え、
  「撮っていないのに読影された」記録になる。「読影レポートを削除してから取り消してください。」と出す。
- **オーダーの削除も、読影レポートがあると止める**。レポートの `basedOn` が指す先が消えるため。
  カードの「削除」を無効にし、理由をツールチップで出す。
- **中止**(依頼済・受付済からの中止)にはレポートが付きえないので、判定は要らない。
- **レポートの削除**:
  - DiagnosticReport・所見 Observation・テンプレート回答を DELETE する(`entered-in-error` にしない。病理と同じ)。
  - 未確認の通知(`result-review` / `rad-critical-finding`)を取り下げる(`cancelled`)。
    ［事実］病理と検体検査は削除で通知を取り下げていない。［導出］削除したレポートを指す未確認の通知が一覧に残り続ける。
    ［提案］放射線で先に直し、同じ関数を病理・検体検査にも当てる。
  - Binary は消さない(§3.1)。
- **DO(複写)**: オーダーを複写しても読影レポートは複写しない(結果はオーダーごとの事実)。
- **FHIR JSON 表示**: カルテのカードの「FHIR JSON」に、オーダー・実施記録に続けて読影レポートの節を足す。

---

## 9. 未決事項・申し送り

1. **ImagingStudy と PACS 連携**。［事実］上流は ImagingStudy に対応しているが、プロキシの許可リストに無い。
   ［事実］JP_ImagingStudy_Radiology は `series.uid` と `series.modality` が 1..1 で DICOM の UID が要る。
   連携の段階で `DiagnosticReport.imagingStudy` を足し、ビューアを開くリンクを内容表示に出す。
   そのとき、ここで添付した画像は「キー画像の写し」として残す(PACS の画像を指し直すことはしない)。
2. **外部 RIS からのレポート取込**。読影を外部の読影システムで行う施設では、レポートは HL7 v2 か
   PDF で届く。`presentedForm` を使うかはそこで判断する(§2.2)。
3. **前回レポートとの比較**。同じ患者・同じモダリティ・同じ部位の過去のレポートを入力画面の横に出す。
   読影の実務では必須に近いが、検索の軸(JJ1017 の種別 + 部位)と表示の場所(カルテのタブの要否)を
   決めてから設計する。
4. **構造化レポート**(RadLex・定型報告)。所見を Observation に分けるのはこの段階。
   いまの「所見 1 件の自由文」から、Observation を**追加**する形で移れる。
5. **読影ワークリスト**。`docs/rad-backlog.md` §A-5。
6. **線 1 本単位の描き込みの再編集**。`docs/patho-order-design.md` §8-10 と同じ課題。`SchemaPaintModal` に fabric の JSON の
   読み書きを足せば 4 か所で同時に効く。
7. **帳票(読影レポートの PDF)**。紹介状に添える用途で要望が出うる。画像の差し込みは
   `questionnaire_response_report.rb` の batch 読み出しと同じ器で作れる。

---

## 10. 実装の差し込み点

| 層 | ファイル | 内容 |
|---|---|---|
| FHIR 組み立て(新規) | `fhir/radReportHelpers.ts` | フォーム値の型、Bundle の組み立て(登録・更新・削除)、読み戻し、status 遷移、画像の拡張、量の判定 |
| 通知(新規) | `fhir/radCriticalFindingHelpers.ts` | 重要所見の通知の組み立てと一覧の行 |
| 画面(新規) | `components/RadReportForm.tsx` / `RadReportEntryModal.tsx` / `RadReportDetailPanel.tsx` / `RadReportImagesEditor.tsx` / `ReportImageViewerModal.tsx` | §4 |
| フック(新規) | `hooks/useRadReportInitialValues.ts` | 編集の初期値(`usePathoResultInitialValues` と同じ形) |
| 画像の共通部品 | `fhir/schemaImage.ts` / `components/SchemaPaintModal.tsx` / `components/SchemaImageGallery.tsx` | 出力形式、書き出し形式と色の選択肢、サムネイルを押したとき |
| クエリ | `api/queries.ts` | レポートの取得・登録・更新・削除、通知 2 種の同梱、放射線一覧のレポート取得(`set` → `append`)、実施取消の判定 |
| 部門一覧 | `pages/RadWorklistPage.tsx` | レポート列、「読影」ボタン |
| カルテ | `fhir/karteTimeline.ts` / `components/KarteTimeline.tsx` / `components/KarteCardModals.tsx` / `karteUrl.ts` | `reportId` / `reportStatus`、バッジ、メニュー、`rad-result`、削除の判定 |
| 既読・通知 | `fhir/resultReviewHelpers.ts` / `components/notifications/notificationRegistry.tsx` | `rad` の追加、リンクの分岐、重要所見の種別 |
| マスタ | migration + `db/schema.rb` / `api/masterClient.ts` / `pages/RadItemPage.tsx` | `report_findings_template_canonical`(permit は列名から自動) |
| 文書 | readme / `docs/rad-backlog.md` | 「検査結果の確認」から放射線対象外の記述を外す、通知の表、読影レポートの節 |

雛形にする既存実装:

- `fhir/pathoResultHelpers.ts` … Bundle の組み立て(画像を先に積む順序)、`nextReportStatus`、読み戻し
- `components/PathoResultForm.tsx` / `PathoResultDetailPanel.tsx` / `pages/PathoWorklistPage.tsx` … 画面と一覧の導線
- `fhir/labPanicHelpers.ts` … 通知の組み立て(強度アラート、書き換えで未確認に戻す)
- `fhir/radOrderHelpers.ts` … テンプレート回答の参照・解除・DELETE
- `api/queries.ts` の `withResultReviewTask` … 保存 Bundle への通知の同梱

---

## 11. 実装時の検証

開発環境のテスト太郎の実施済みの放射線オーダーを使う。

1. **一巡**: 放射線検査一覧から「読影」→ 画像を 3 枚(ファイル選択で 2 枚同時・貼り付け・ドラッグ)→
   1 枚に矢印を描き込む → 暫定で保存 → 一覧の列とカルテのバッジ → 詳細の表示と拡大表示 →
   最終に更新 → 依頼医の通知 → 確認 → 編集で訂正報告になり、通知が未確認に戻る。
2. **描き込み**: 元画像から描き直し、上流に元画像・旧合成・新合成の 3 つの Binary があり、
   レポートが元画像と新合成を指すこと。「描き込みを外す」で元画像の表示に戻ること。
3. **重要所見**: チェックして保存 → 通知(アラート、ベルが赤)→ 要点を変えて保存 → 未確認に戻る →
   チェックを外して保存 → 取り下げ。暫定報告でも通知が出ること。
4. **量の上限**: 大きな画像を多数選び、保存前に上限の文が出ること。分けて保存すれば通ること。
   上流が 413 を返さないこと。
5. **テンプレート**: 所見をテンプレートで記入 → 保存 → 編集で開き直す → 解除で回答が消えること。
6. **整合**: 読影レポートのあるオーダーで、実施の取消とオーダーの削除が止まること。
   レポートを削除すると通知が取り下げられ、実施の取消ができるようになること。
7. **混入しないこと**: 検体検査・病理のタブと、検体検査の結果登録のオーダー候補に読影レポート・放射線オーダーが出ないこと。
8. 型チェックは `tsc -b`(`--noEmit` は 0 ファイル検査で必ず通る)。backend の rspec は
   `RAILS_ENV=test` と `ADMIN_TOKEN=` を明示する。

### 11.1 検証結果(2026-09-16、開発環境)

- 1〜6 を Chrome で通した。画像はファイル選択(2 枚同時)・ドロップ・貼り付けのいずれも追加でき、
  3MB の PNG が長辺 1600px の JPEG(約 600KB)になった。上流にはレポートが元画像 4 枚と描き込み画像を
  別の Binary で指し、読影医・発行施設・撮影日時(実施記録から)・所見 Observation が入った。
- 重要所見は、要点の変更で未確認に戻る・チェックを外すと取り下げ・付け直すと未確認・確認済みのまま
  同じ要点で保存しても確認済みのまま、の 4 通りを確認した。通知は種別ごとに 1 件のまま増えない。
- 量の上限は、保存前に文が出て送信されないことを確認した(分けて保存が通ることは既存の保存で確認済み)。
- テンプレートは UI から記入内容を保存し、レポートの拡張から参照されること、「解除」で保存すると回答が
  削除されることを確認した。再編集(PUT)の Bundle は組み立て関数の出力で確認した。
- 取消・削除の制限は、一覧の「取消」とカードの「削除」が無効になること、オーダーの削除処理を直接呼んでも
  止まることを確認した。レポートを削除すると 410 になり、未確認の重要所見が取り下げられた。
- 7 は、結果一覧が種別(`LAB` / `MB` / `SP,CP`)で検索していることをコードで確認した(画面では未確認)。
- 開発環境のテスト太郎の 2026-08-12 のオーダーに、検証で作った読影レポート(訂正報告・画像 4 枚)が残っている。
