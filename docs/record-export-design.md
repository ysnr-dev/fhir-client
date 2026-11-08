# 診療記録の一括出力(患者 × 期間)の設計

`docs/functional-gap-backlog.md` §1 #3・§2.2「診療記録出力(患者 × 期間の一括 PDF)」、`docs/print-backlog.md` §2.2。

**第 1 段を実装済み(2026-11-08)**。

- **［事実］** = FHIR R4・上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと

## 1. 背景とスコープ

診療記録の開示請求、適時調査、訴訟、転院先への写しでは、患者 1 人のある期間の記録を 1 冊にまとめて出す。
これまでは診療経過記録(カルテ 2 号用紙)を「カルテ印刷」で出せるだけで、病名やサマリーはそれぞれの画面から個別に印刷していた。

第 1 段に含めるもの:

- 1 患者 × 期間で、次の 4 区画を選んで 1 回の印刷(PDF 保存を含む)にまとめる
  1. 表紙(自院・患者・出力期間・出力日時と出力者・収録区画・期間内の入退院歴と受診歴)
  2. 病名・プロブレム
  3. 退院時サマリー(期間に重なる入院のもの)
  4. 診療経過記録(今の 2 号用紙。「履歴を印刷」もそのまま)

含めないもの(§6 で第 2 段以降に回す): 検歴、所見・読影・病理レポート、看護計画・看護サマリー・看護プロファイル、経過表、
指示簿・指示歴、1 号用紙(保険・労災)、複数患者の一括出力、出力の記録(開示の台帳)。

## 2. 器の判断

［設計］**新しい画面を作らず、「カルテ印刷」タブと印刷用ページ(`/karte-print/:patientId`)に区画の選択を足す。**

- 期間の指定・印刷用の別タブ・紙面のライト固定・ページ番号はカルテ印刷にすでにある。区画だけ違う画面を
  もう 1 つ作ると、ほぼ同じものが 2 つ並ぶ。
- PDF は backend で作らず、ブラウザの印刷に任せる(`window.print`)。2 号用紙の本文は画面のカードと同じ描き方(装飾・画像・シェーマ)で、
  ThinReports では表せない(`docs/features/karte.md`「カルテ印刷」)。HTML → PDF を backend に置くと、カードの描き方を
  backend 側で作り直すことになる。サーバーに PDF を残す用途(ダウンタイムの定時 PDF・原本保管)が出たら別に考える(`print-backlog.md` §3-1)。
- 出力の記録は残さない(第 1 段の決めごと)。誰がいつ何を出したかは、職種別の権限・閲覧ログ(`functional-gap-backlog.md` §2.1)と一緒に扱う。

## 3. URL と入力

［設計］`/karte-print/:patientId?from=&to=&history=1&sections=cover,conditions,summaries,progress`

| キー | 区画 | 表示名 |
|---|---|---|
| `cover` | 表紙 | 表紙 |
| `conditions` | 病名・プロブレム | 病名 |
| `summaries` | 退院時サマリー | 退院時サマリー |
| `progress` | 診療経過記録(2 号用紙) | 経過記録 |

- 区画の定義は `karteUrl.ts` の `KARTE_PRINT_SECTIONS` 1 か所。並び順は定義の順で、URL の並びには左右されない。
- `sections` が無い URL は 4 区画すべて。知らないキーは無視する。
- タブの入力は開始日・終了日・区画のチェック(既定はすべて ON)・「履歴を印刷」。「履歴を印刷」は経過記録を選んだときだけ押せる。
  区画が 1 つも無いと「印刷」は押せない。

## 4. 区画ごとの読み込みと描き方

読み込みは選んだ区画のぶんだけ行う(選ばない区画の hook は `enabled` で止める)。`api/queries/recordExport.ts`。
画面に並べるだけの読み込みなので、上限で欠けたら区画ごとに `TruncatedNotice` を出す。

### 4.1 共通の見出し

［設計］区画ごとに表(`table`)を分け、見出し(`thead`)に自院名・患者番号・氏名・生年月日・性別・期間・印刷日時を置く
(見出しは印刷用ページで 1 つ組み、区画の紙面 `KartePrintSheet` に渡す)。ブラウザが `thead` をページごとに繰り返すので、どのページを抜き出しても誰の何かが分かる。
2 つ目以降の区画は改ページで始める(`break-before: page`)。ページ番号は `@page` の下中央(全区画の通し番号)。

### 4.2 表紙

- 自院名(`useSelfOrganization`。未設定なら出さない)、患者番号・氏名・カナ・生年月日・性別、出力期間、出力日時、出力者、
  収録区画(選んだ区画の表示名)。
- 出力者はログイン中の医療従事者の氏名(`useCurrentPractitioner`)。紐づく医療従事者が無いログイン(`administrator`)はログイン ID。
- 期間内の入退院歴・受診歴: ［事実］上流の `Encounter?date=ge{from}&date=le{to}` は `period` が期間に**重なる**ものを返す
  (2026-11-08 に開発環境で確認。期間の途中で始まった入院・期間をまたぐ入院の両方が入る)。
  `status:not` で予定・予定の取消・誤登録を除き(`ENCOUNTER_HISTORY_EXCLUDED_STATUSES`)、`_include=Encounter:appointment` で
  外来の診療科を引く。行は受診歴と同じ `encounterHistoryRows()`(`fhir/encounterHistoryHelpers.ts`)で作り、古い順に並べる。

### 4.3 病名・プロブレム

- ［設計］患者の病名を**期間で切らずにすべて**出す。1 号用紙の傷病名欄と同じく累積で、開始日・終了日・転帰を見れば期間中の状態が分かる。
  期間で切るには「開始日 ≤ 終了日 かつ(終了日なし または 終了日 ≥ 開始日)」の OR が要り、上流の 1 回の検索で表せない。
- `Condition?patient=&_sort=onset-date`(看護問題は `excludeNursingProblems` で除く)を `searchAllPages` で読み、
  `splitConditions()` で「プロブレム」(番号順)・「病名」(保険病名)・「既往歴」の 3 つの表に分ける。
- 列: 区分(プロブレムは番号)・病名・開始日・終了日・転帰(`summarizeCondition`)。画面の `ConditionTable` は行の操作を持つので使わない。

### 4.4 退院時サマリー

- 表紙と同じ入院(`class=IMP`)のうち期間に重なるものの id で `Composition?encounter=<カンマ OR>&type=18842-5&status=final,amended&_sort=date`
  を 1 回読む(入院ごとに検索を並べない)。下書き(`preliminary`)は記録になる前のものなので出さない。
- 入院の読み込みは表紙と共有する(区画で表紙を外しても、サマリーのために同じ検索を行う)。
- 描き方は診療記録の詳細と同じ `ClinicalNoteDetailPanel`(記録情報・入院情報・セクション・埋め込みテンプレート)。
  カウンターサインの承認・差し戻しボタンを印字しないよう `hideCountersign` を渡す(確定者は記録情報に出る)。
- ［設計］サマリーは 2 号用紙にもその日の記録として残す(2 号用紙は記録の並びを忠実に出すもので、区画の選び方で中身を変えない)。

### 4.5 診療経過記録

今のカルテ印刷のまま(`useKartePrintTimeline` / `useKartePrintHistory` / `KartePrintDocument`)。見出しは他の区画と同じものを渡し、区画名の行(「診療経過記録」)を足した。

## 5. ファイル

| ファイル | 内容 |
|---|---|
| `frontend/src/karteUrl.ts` | `KARTE_PRINT_SECTIONS`、`kartePrintUrl` の `sections`、`parseKartePrintSections` |
| `frontend/src/components/KartePrintTab.tsx` | 区画のチェック |
| `frontend/src/pages/KartePrintPage.tsx` | 区画の読み込みと並べ方 |
| `frontend/src/api/queries/recordExport.ts` | 入院・受診歴、病名、退院時サマリーの読み込み |
| `frontend/src/components/recordExport/` | `KartePrintSheet`(区画の紙面・見出し行・空の行)/ `RecordExportCover` / `RecordExportConditions` / `RecordExportSummaries` |
| `frontend/src/components/ClinicalNoteDetailPanel.tsx` | `hideCountersign` |

## 6. 第 2 段以降

| 候補 | 当たり |
|---|---|
| 検歴(項目 × 採取日の累積表) | `buildLabTimeline()` を期間で読む hook(今の `useLabResultTimeline` は直近 N 日ぶん) |
| 所見・読影・病理レポート | `useResultSummariesQuery` に期間。本文は `PathoResultDetailPanel`(そのまま描ける)・`ExamReportDetailPanel`(画像ビューアを外す) |
| 看護計画・看護サマリー・看護プロファイル | `NursingProblemTree`(そのまま描ける)、サマリーは `ClinicalNoteDetailPanel`、プロファイルは `nursingProfileSections()` |
| 経過表 | `buildVitalFlowsheet()` を紙の幅で区切る(画面の `VitalFlowsheetPanel` は操作が多く使えない) |
| 指示簿・指示歴 | `usePatientNursingOrders`(中止済みを含む)を期間で切って表に |
| 1 号用紙(保険・労災) | 保険はレセコン(`patientgetv2`)。`print-backlog.md` §2.2 |
| 複数患者 | 患者フォルダ・データ抽出の結果から、患者ごとに区画を続ける。読み込みの総数がレート制限に掛かるので患者を 1 人ずつ順に読む |
| 出力の記録 | 職種別の権限・閲覧ログ(`functional-gap-backlog.md` §2.1)と一緒に |

## 7. 検証(2026-11-08、Docker 環境)

- `tsc -b`・lint(既存の警告数のまま)・`import-cycles` を通した。上流は 3 つの検索とも `Prefer: handling=strict` で受理。
- 入院三郎(08-25〜09-17 入院、確定済みサマリー)を 08-01〜09-30 で 4 区画: 表紙の入退院歴に入院 1 件、
  病名は「登録されている病名はありません。」、サマリーは記録情報・入院情報・各セクションが出て、紙面にボタンは無い。
  2 区画目以降は `break-before: page`。
- 同じ患者を 10-01〜10-31(入院の後)で表紙・サマリーだけ: 「期間内の受診はありません。」「期間内の退院時サマリーはありません。」。
- テスト太郎を 10-01〜10-31 で表紙・病名・経過記録・履歴あり: 病名はプロブレム(番号順)・病名・既往歴の 3 群、経過記録に変更履歴 31 件。
- タブ: 経過記録を外すと「履歴を印刷」が押せず、区画を全部外すと「印刷」が押せない(ダークテーマでも表示崩れ無し)。
