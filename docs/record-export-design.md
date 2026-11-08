# 診療記録の一括出力(患者 × 期間)の設計

`docs/functional-gap-backlog.md` §1 #3・§2.2「診療記録出力(患者 × 期間の一括 PDF)」、`docs/print-backlog.md` §2.2。

**第 1 段・第 2 段を実装済み(2026-11-08)**。

- **［事実］** = FHIR R4・上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと

## 1. 背景とスコープ

診療記録の開示請求、適時調査、訴訟、転院先への写しでは、患者 1 人のある期間の記録を 1 冊にまとめて出す。
これまでは診療経過記録(カルテ 2 号用紙)を「カルテ印刷」で出せるだけで、病名やサマリーはそれぞれの画面から個別に印刷していた。

含めるもの: 1 患者 × 期間で、次の区画を選んで 1 回の印刷(PDF 保存を含む)にまとめる。

| 段 | 区画 |
|---|---|
| 第 1 段 | 表紙(自院・患者・出力期間・出力日時と出力者・収録区画・期間内の入退院歴と受診歴)、病名・プロブレム、退院時サマリー(期間に重なる入院のもの)、診療経過記録(今の 2 号用紙。「履歴を印刷」もそのまま) |
| 第 2 段 | 指示簿(指示歴)、看護(看護問題・看護サマリー・看護プロファイル)、経過表、検歴、レポート(所見・読影・病理) |

含めないもの(§6): 1 号用紙(保険・労災)、複数患者の一括出力、出力の記録(開示の台帳)。

## 2. 器の判断

［設計］**新しい画面を作らず、「カルテ印刷」タブと印刷用ページ(`/karte-print/:patientId`)に区画の選択を足す。**

- 期間の指定・印刷用の別タブ・紙面のライト固定・ページ番号はカルテ印刷にすでにある。区画だけ違う画面を
  もう 1 つ作ると、ほぼ同じものが 2 つ並ぶ。
- PDF は backend で作らず、ブラウザの印刷に任せる(`window.print`)。2 号用紙の本文は画面のカードと同じ描き方(装飾・画像・シェーマ)で、
  ThinReports では表せない(`docs/features/karte.md`「カルテ印刷」)。HTML → PDF を backend に置くと、カードの描き方を
  backend 側で作り直すことになる。サーバーに PDF を残す用途(ダウンタイムの定時 PDF・原本保管)が出たら別に考える(`print-backlog.md` §3-1)。
- 出力の記録は残さない(第 1 段の決めごと)。誰がいつ何を出したかは、職種別の権限・閲覧ログ(`functional-gap-backlog.md` §2.1)と一緒に扱う。

## 3. URL と入力

［設計］`/karte-print/:patientId?from=&to=&history=1&sections=cover,conditions,...`

| キー | 区画 | 表示名 |
|---|---|---|
| `cover` | 表紙 | 表紙 |
| `conditions` | 病名・プロブレム | 病名 |
| `summaries` | 退院時サマリー | 退院時サマリー |
| `progress` | 診療経過記録(2 号用紙) | 経過記録 |
| `nursingOrders` | 指示簿(指示歴) | 指示簿 |
| `nursing` | 看護問題・看護サマリー・看護プロファイル | 看護 |
| `flowsheet` | 経過表 | 経過表 |
| `labs` | 検歴 | 検歴 |
| `reports` | 所見・読影・病理レポート | レポート |

並びは紙のカルテの綴じ順(要約 → 経過 → 指示 → 看護 → 測定 → 検査)に合わせた。

- 区画の定義は `karteUrl.ts` の `KARTE_PRINT_SECTIONS` 1 か所。並び順は定義の順で、URL の並びには左右されない。
- `sections` が無い URL はすべての区画。知らないキーは無視する。
- タブの入力は開始日・終了日・区画のチェック(既定はすべて ON)・「履歴を印刷」。「履歴を印刷」は経過記録を選んだときだけ押せる。
  区画が 1 つも無いと「印刷」は押せない。
- 区画のチェックは「診療録」(表紙・病名・退院時サマリー・経過記録)・「看護」(指示簿・看護・経過表)・「検査」(検歴・レポート)の
  群に分けて均等の幅の列で横に並べ、群の中は縦に並べる。群の見出しのチェックで群ごとに切り替える(一部だけ選んでいると中間の表示)。
  「履歴を印刷」は「経過記録（履歴を印刷）」のように経過記録の行の括弧の中に置く。群は `KartePrintTab.tsx` の `SECTION_GROUPS`。

## 4. 区画ごとの読み込みと描き方

読み込みは選んだ区画のぶんだけ行う(選ばない区画の hook は `enabled` で止める)。`api/queries/recordExport.ts`。
画面に並べるだけの読み込みなので、上限で欠けたら区画ごとに `TruncatedNotice` を出す。

### 4.1 共通の見出し

［設計］区画ごとに表(`table`)を分け、見出し(`thead`)に自院名・患者番号・氏名・生年月日・性別・期間・印刷日時を置く
(見出しは印刷用ページで 1 つ組み、区画の紙面 `KartePrintSheet` に渡す)。ブラウザが `thead` をページごとに繰り返すので、どのページを抜き出しても誰の何かが分かる。
2 つ目以降の区画は改ページで始める(`break-before: page`)。ページ番号は `@page` の下中央(全区画の通し番号)。
日時の列が紙の幅に収まらない表(経過表・検歴)は、決まった列数ずつの表に分けて改ページせずに続け、区画名に「(1/2)」のように番号を付ける
(`KartePrintMatrix`)。項目名などの固定列はどの表にも出す。期間が年をまたぐときだけ列の日付に年を付ける。

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

### 4.6 指示簿

- `ServiceRequest?subject=&category=<看護指示>&status:not=entered-in-error,draft&order-period=ge{from}&order-period=le{to}&_sort=authoredon`
  (`nursingOrderParams` から実施の `_revinclude` を外したもの)。中止・終了した指示も残す(指示歴)。
- 列: 指示内容(コメントは下に小さく)・頻度・条件・期間・指示者・状態(`summarizeNursingOrder`、`nursingOrderState` を今日で判定)。

### 4.7 看護

1 つの区画に「看護問題」「看護サマリー」「看護プロファイル」の見出しを置いて続ける。

- 看護問題: 看護計画タブと同じ `fetchNursingCarePlans`(患者ぶん全部)を読み、立案日が終了日以前かつ(未解決または解決日が開始日以降)の
  問題を残す。［設計］この重なりの条件は上流の 1 回の検索で表せず、看護計画は患者あたり数十件なので手元で絞る。
  描き方は看護計画タブのカードと同じ `NursingProblemTree`(目標は終了日 — 今日より後なら今日 — 時点)。
- 看護サマリー: 期間に重なる入院の id で `Composition?encounter=&type=<看護サマリー>&status=final,amended`(退院時サマリーと同じ読み方)。
  作成中(preliminary)は出さない。承認待ち・承認済みは出す。描き方は `ClinicalNoteDetailPanel`(`hideCountersign`)。
- 看護プロファイル: 同じ入院の id で `QuestionnaireResponse?encounter=&questionnaire:not=<DPC 様式1>&_include=QuestionnaireResponse:questionnaire`。
  入院ごとに `nursingProfileSections()` で施設設定の区画に振り分け、看護プロファイルタブと同じ平文(`questionnaireResponsePlainText`)で出す。
  記入の無い区画は出さない。

### 4.8 経過表

- 経過表と同じ `useVitalFlowsheet`(期間で読む)と `buildVitalFlowsheet`(施設のしきい値)。バイタル・看護観察・テンプレートから抽出した測定値が
  「項目 × 測定日時」に並ぶ。しきい値を外れた値は太字にし、白黒でも分かるよう判定(H / L)を値の後ろに文字で添える。
- 列は 10 ずつ。注射・内服・食事・水分出納の行は出さない(診療経過記録と指示簿に出る)。

### 4.9 検歴

- `DiagnosticReport?patient=&category=LAB&date=ge{from}&date=le{to}&status:not=registered,entered-in-error&_include=DiagnosticReport:result`。
  検査結果タブの時系列表示と同じ `buildLabTimeline`(施設コードの無い結果の読み替え `resultItemAliases` も同じ)で「項目 × 採取日」にする。
- 列は項目・単位・基準値と採取日 8 つずつ。判定(H / L / HH / LL)は値の後ろに文字で、中間報告・訂正報告は ◦ / ▴ の印で示し、
  印があるときは表の下に凡例を添える。

### 4.10 レポート

- 所見レポート(放射線・生理・内視鏡の category)と病理(SP・CP)を 1 回の検索で読む: `DiagnosticReport?category=<カンマ OR>&date=ge&le
  &status:not=registered,entered-in-error&_include=DiagnosticReport:result&_include=DiagnosticReport:specimen`。
  レポートごとに `result` / `specimen` の参照で所見と検体を振り分ける(1 件ずつ読み直さない)。
- 描き方は各タブの内容表示と同じ。読み込み済みのレポートを受け取る `ExamReportView`(`ExamReportDetailPanel.tsx`)と
  `PathoResultView`(`PathoResultDetailPanel.tsx`)を足した。病理の「病理検査オーダー」の行はオーダーを 1 件ずつ読むことになるので印刷では出さない。
- 見出しはレポートの種類(読影レポート・内視鏡所見レポートなど)と検査日時。
## 5. ファイル

| ファイル | 内容 |
|---|---|
| `frontend/src/karteUrl.ts` | `KARTE_PRINT_SECTIONS`、`kartePrintUrl` の `sections`、`parseKartePrintSections` |
| `frontend/src/components/KartePrintTab.tsx` | 区画のチェック |
| `frontend/src/pages/KartePrintPage.tsx` | 区画の読み込みと並べ方 |
| `frontend/src/api/queries/recordExport.ts` | 区画ごとの読み込み |
| `frontend/src/components/recordExport/` | `KartePrintSheet`(区画の紙面・見出し行・空の行)・`KartePrintMatrix`(項目 × 日時の表)と区画ごとの `RecordExport*` |
| `frontend/src/components/ClinicalNoteDetailPanel.tsx` | `hideCountersign` |
| `frontend/src/components/ExamReportDetailPanel.tsx` / `PathoResultDetailPanel.tsx` | 読み込み済みのレポートを描く `ExamReportView` / `PathoResultView` |

## 6. 残り

| 候補 | 当たり |
|---|---|
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
- 第 2 段: 新しい検索(指示簿・検歴・レポート・看護プロファイル)は `Prefer: handling=strict` で受理。テスト太郎を 08-01〜11-08 で第 2 段の 5 区画:
  - 指示簿は終了した指示を含めて 14 件、状態「終了」。
  - 看護は看護問題 3 件(解決済み 1 件を含む)・中間サマリー(修正済み)・看護プロファイル(入院時情報)。
  - 経過表は測定日時 17 列が 2 表(10 + 7)に分かれ、2 表目は改ページしない。体温 37.8 に「H」。
  - 検歴は 7 採取日、訂正報告の値に ▴、判定 L / H / HH と凡例。
  - レポートは読影 2・内視鏡 2・病理 3 件が検査日の順に並び、重要所見・画像も出る。
- 全区画(`sections` 無しの URL)で 10-08〜11-08: 9 区画がこの順に並び、エラーなし。
