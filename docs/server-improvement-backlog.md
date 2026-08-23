# fhir-server 改善バックログ（将来課題）

fhir-client のワークアラウンド調査で見つかった「fhir-server 側を直した方が効率がよい」
項目のうち、**未実装のもの**の記録。

- 調査履歴: 2026-08-01（初回、6 項目）、2026-08-23（frontend/backend 全面再調査で拡充）。
- 実装済みの項目（日付のみ dateTime の受理、qualification[].identifier の索引化、
  Questionnaire canonical の一意制約、canonical `_include`、チェーン検索・`_sort`×`_include` の
  回帰 spec、プロブレム単位の絞り込み検索と `Observation.derived-from`、
  ServiceRequest の `based-on` 検索と `_revinclude`〔2026-08-09〕）については
  両リポジトリのコミット履歴を参照。
- **2026-08-23 に優先度 A の 5 件をサーバー側に実装済み**（下記「実装済み・クライアント側の
  追随待ち」参照）。

各項目は「現状のワークアラウンド → 望ましいサーバー機能 → 影響範囲」の形式。
優先度 B（operation 系のレイテンシ・転送量改善）→ C（個別の検索パラメータ・仕様適合）
→ 長期、の順に並べる。

---

## 実装済み・クライアント側の追随待ち（旧・優先度 A、2026-08-23 サーバー実装完了）

fhir-server 側は実装・テスト済み。**デプロイ時の手動操作は不要**: migration 3 本
（service_requests.occurrence_date_time / organizations.identifier_value / Organization の
type token バックフィル）が、entrypoint の `bin/rails db:prepare` で起動時に自動適用される。
Render 無料枠には Shell も cron も無く rake タスクを流せないため、token 再索引も
マイグレーションに畳み込んである（`fhir:reindex_tokens` は開発用に残置）。

1. **`Prefer: handling=strict`** — 未知の検索パラメータ・未対応 modifier・未知の
   `_include`/`_revinclude` トークン・未知の `_sort` キーを 400 + OperationOutcome
   （問題を全件列挙）で拒否。既定は従来どおり lenient。
   → **追随**: backend プロキシ（`fhir_proxy_controller.rb`）で strict を付与する
   （まず開発環境のみで有効化し、既存コードの隠れた未対応パラメータを洗い出してから
   本番へ広げるのが安全）。
2. **Organization の `type` 検索・`_sort=identifier`** — `type=dept` で診療科だけを
   取得でき、`_sort=identifier` で診療科コード順が返る（識別子の system 単独検索
   `identifier=<system>|` は従来から対応済みだった）。
   → **追随**: `DepartmentListPage` の全件取得→画面側ソート・ページングを
   `type=dept&_sort=identifier&_count/_offset` に置換。`partof:missing` による
   施設/診療科判別、backend `prescription_report.rb` の自院推定も `type` 検索へ。
3. **token 検索の `:not` 修飾子**（`_id` 含む。カンマ値は「どれでもない」、値を
   持たないリソースも一致） —
   → **追随**: 自院除外（`PartnerOrganizationListPage` ほか 2 画面の `_id:not=<自院>`）、
   診察室検索の `type:not=HU,...`、外来一覧の `status:not=cancelled,entered-in-error`。
4. **ServiceRequest の `occurrence` / `department` / `ward` 検索** — 実施予定日時
   （R4 標準 occurrence）とローカル拡張（order-department / order-ward）の検索。
   進捗の絞り込みは既存の `_has:Task:focus:status=`（`business-status` も可）が
   使える（回帰 spec で固定済み。なお `category` 検索は従来から実装済みで、
   `queries.ts:2710` のコメントが古いだけ）。
   → **追随**: Lab/Rad/Rx ワークリストのフィルタをサーバー側パラメータに移し、
   `matchesFilters` と `truncated` フォールバックを縮小。撮影日の authoredOn への
   重複記載も廃止できる。
5. **`MedicationRequest.based-on` 検索＋条件付き削除の複数マッチ**
   （CapabilityStatement は `conditionalDelete: "multiple"`）。Bundle transaction 内の
   条件付き DELETE も複数件を消せる。
   → **追随**: backend `prescription_report.rb` の `_revinclude` 迂回を
   `MedicationRequest?based-on=` に置換。処方などのカスケード削除は事前 GET を
   やめ、`DELETE /MedicationRequest?based-on=ServiceRequest/X`（transaction 内条件付き
   DELETE）で 1 往復に。

---

## 優先度 B: operation 系（レイテンシ・転送量）

### B-1. 検査結果・バイタルのサーバー集計（Observation `$lastn` 相当）

- **現状**: 「直近 N 回分の列が揃うまでページを読む→手元でピボット」が 2 箇所。
  - 検査結果時系列: `queries.ts:2969` の `fetchLabTimelineResources` が
    `DiagnosticReport?...&_include=DiagnosticReport:result` を 100 件×最大 10 ページ辿り、
    `buildLabTimeline`（`fhir/labResultHelpers.ts`）で JLAC11 コード×採取日の行列を構築
  - バイタルフローシート: `queries.ts:4261` の `fetchVitalFlowsheetObservations` が同型で、
    `fhir/vitalHelpers.ts` の `groupVitalEntries` が identifier で測定回に束ね直す
- **望ましいサーバー機能**: FHIR 標準の `Observation/$lastn`（patient + code 軸で
  「各コードの最新 n 件」）か、それに準ずる集計 operation。
- **影響範囲**: 時系列表・グラフ・フローシートのレイテンシと転送量。患者あたりの
  結果が数百件を超える運用で顕著（2026-08-01 調査から継続、適用範囲をバイタルに拡大）。

### B-2. カルテタイムラインの統合フィードと診療日インデックス

- **現状**:
  - `KartePage.tsx` は Composition / ServiceRequest / QuestionnaireResponse / Observation の
    4 本の無限クエリを並走させ、ブラウザでマージする。各検索が独立にページングするため、
    「全ソースが読み終わった日までしか表示しない」safe cutoff 機構が必要
    （`fhir/karteTimeline.ts:204` の `safeCutoff`）
  - 左ペインの診療日一覧は `queries.ts:4112` の `fetchKarteDays` が 4 リソース種別
    それぞれで患者の**全履歴**を `_elements=<日付のみ>` でフルスキャンし、distinct を取る
- **望ましいサーバー機能**: 日付ソート済み・マージ済みの患者タイムライン検索
  （`Patient/$everything` の type + date 絞り込み版）。それが大きければ、まず
  「患者の診療日の distinct 集合」を返す小さな operation だけでも 4 本のフルスキャンが消える。
- **影響範囲**: カルテを開くたびの転送量と、safe cutoff まわりの複雑さ。履歴が長い
  患者ほど顕著。

### B-3. 検査結果詳細の前後移動のカーソル化

- **現状**: `fetchLabResultOrder` が「一覧と同じ並び順の DiagnosticReport id 列」を
  `_elements=id` で 100 件×最大 10 ページ取得し、`ids.indexOf(reportId)` で前後の id を
  求めている。「＜ ＞」ボタン 1 つのために最大 1000 件の id 走査が要る。
- **望ましいサーバー機能**: ソートキーに対するカーソル検索
  （例: `date=lt<基準値>&_sort=-date&_count=1` で「次の 1 件」）。現状の `_sort` は
  id タイブレーク済みなので、`(date, id)` の複合カーソルが表現できれば成立する。
- **影響範囲**: 検査結果詳細画面のナビゲーション。`staleTime: 30_000` で連打を緩和して
  おり、通常運用では許容範囲（2026-08-01 調査から継続）。

### B-4. 病棟・入院系の検索とカウント

- **現状**: 入院患者一覧（`frontend/src/pages/InpatientListPage.tsx`、1102 行）は
  病院全体の入院 Encounter を全件取得し（病棟で絞るには「ベッドの数だけ location= を
  並べる」しかなく URL が破綻する: `queries.ts:1146`）、ブラウザで
  Location×Encounter×Patient を join、6 タブ分の絞り込みと在院/空床統計まで in-memory。
  入院予定は日付検索自体ができず全件取得（`queries.ts:1281`）。病棟一覧の病室数・
  ベッド数は `_revinclude` で子リソースを全部転送して数えている（`queries.ts:894`）。
  患者ヘッダのベッド→病室→病棟解決は `_include:iterate` が効かない場合に備えて
  1 件読み足すフォールバック付き（`queries.ts:1369`）。
- **望ましいサーバー機能**（段階的に）:
  1. Encounter のチェーン検索 `location.partof.partof=`（病棟でのサーバー絞り込み）
  2. 拡張に埋まっている入院予定日・転棟予定・外出泊・退院予定の検索パラメータ化
  3. `_include:iterate`（多段 include）の確実化
  4. 親ごとの子リソース件数を返すカウント facet（または batch Bundle での
     `_summary=count` 一括実行）
- **影響範囲**: 病床規模が大きいほど顕著。1 は既存のチェーン検索基盤の延長で費用対効果が高い。

### B-5. 検体ラベル番号のサーバー採番

- **現状**: backend に残る唯一の採番。`backend/app/models/lab_label_number.rb` が
  created_at しか持たないテーブルの autoincrement を消費して 10 桁＋チェックデジットを
  発番する。台帳は既に上流 Specimen（accessionIdentifier / request / receivedTime）に
  移行済みで、「一意な短い番号の採番」だけが FHIR で表現できないとして残存。
  type コードの無い検体は If-None-Exist の条件一致ができず、二重クリックで番号を
  二重消費する既知レースあり（`backend/app/services/lab_label_report.rb:161-163`）。
- **望ましいサーバー機能**: サーバー側の採番 operation（例 `Specimen/$generate-accession`）
  またはサーバー付与の accessionIdentifier（作成時に未設定なら採番して埋める）。
- **影響範囲**: backend の `lab_label_numbers` テーブル・モデル・レース対策が丸ごと消え、
  採番の一意性がサーバーのトランザクションで保証される。

### B-6. `QuestionnaireResponse/$extract`（SDC）と参照検索のカンマ OR

- **現状**: `frontend/src/fhir/observationExtract.ts:9` に「上流に $extract operation は
  無いため、回答の保存時にクライアントで組み立てて同じ transaction Bundle に載せる」と
  明記。派生 Observation は削除→再作成で更新し、編集した応答 id ごとに
  `Observation?derived-from=` を 1 検索ずつ発行する N+1 もある（`queries.ts:3319` 付近）。
- **望ましいサーバー機能**: SDC の `QuestionnaireResponse/$extract`（サーバー側での
  Observation 抽出）。それが大きければ、まず reference 検索のカンマ OR
  （`Observation?derived-from=A,B,C`）だけでも N+1 が 1 検索になる。
- **影響範囲**: 経過記録・テンプレート保存の往復数と、抽出ロジックの二重管理リスク。

---

## 優先度 C: 個別の検索パラメータ・仕様適合

### C-1. 日付・期間検索の細部

- **date のみ検索の UTC 境界**: 日付だけ（2026-08-18）を渡すと上流は UTC の 1 日として
  比べるため、朝 9 時前の予約が前日に落ちる。クライアントは
  `ge<当日00:00+09:00>` & `lt<翌日00:00+09:00>` に展開して回避中（`queries.ts:1860` 付近）。
  → サーバーが検索値のタイムゾーン（または設定されたローカル TZ）で日境界を解釈する。
- **period 型への `eq` の意味論**: 上流の `eq` は「期間を完全に含む」で、FHIR 仕様の
  overlaps と異なる。在院検索は `ge`&`le` の 2 パラメータで代用中（`queries.ts:1151` 付近）。
- **`Slot.end` 検索パラメータ**: R4 に定義が無いため独自追加が要る。現状は start を
  2 回並べた AND で近似し、枠が数百件でも全ページ読み切っている（`queries.ts:1514`）。
  併せて「日別の空き枠数」を返す facet があれば、月カレンダーのバッジ
  （`components/AppointmentSlotPicker.tsx`）のための全 Slot 転送も消える。

### C-2. `_sort` の信頼性向上と `AllergyIntolerance.onset`

- **現状**: サーバーソートを信用せず画面側で並べ直す箇所が点在。
  - Appointment 新しい順（`queries.ts:1716` のコメント「上流の _sort に依存しないため」）
  - 入院予定の period.start 順（`fetchPlannedAdmissions`）
  - `_history` の versionId 降順「念のため」（`queries.ts:3285-3289`）
  - アレルギー一覧は `onsetDateTime` を表示しつつ、検索パラメータが無いため
    `date`（recordedDate）でソートしており、表示と並び順の基準がずれている
- **望ましいサーバー機能**: 主要リソースの `_sort` 対応状況を CapabilityStatement で明示し、
  対応済みのものは順序を保証する。`AllergyIntolerance.onset` 検索パラメータ（R4 標準）を追加。
- **影響範囲**: 画面側ソートの削減と、アレルギー一覧の並び順の正確さ。

### C-3. `_elements` の choice 型対応（仕様適合）

- **現状**: 上流の `_elements` はトップレベルの JSON キー名の完全一致で切り出すため、
  choice 型は基底名（`effective`）ではなく実キー名（`effectiveDateTime`）で指定する必要が
  ある（`queries.ts:2898-2899` のコメント）。
- **望ましいサーバー機能**: FHIR 仕様どおり element 基底名での指定を受理する
  （実キー名も後方互換で受理し続けてよい）。
- **影響範囲**: 仕様適合のみ。クライアントの記述が素直になる。

### C-4. `Location.physical-type` 検索

- **現状**: 病棟/病室/ベッドの階層判別は `physicalType` で行っているのに検索できず、
  type コードの OR 列挙で代用（`queries.ts:796` 付近）。
- **望ましいサーバー機能**: `Location?physical-type=`（R4 標準）。
- **影響範囲**: 診察室・病棟系検索の記述の単純化。`:not` 修飾子（実装済み）で
  `type:not=` と書けるようになったため、優先度はさらに低い。

### C-5. `Schedule.specialty` 検索の実装

- **現状**: 予約枠セレクトは全 Schedule を取得後にコードで絞っている
  （`queries.ts:1641` のコメント「上流の specialty 検索に頼らず」）。
- **望ましいサーバー機能**: `Schedule?specialty=`（R4 標準）の実装（または対応済みなら
  CapabilityStatement での明示とクライアント側の移行）。
- **影響範囲**: 予約画面の転送量。Schedule 件数が少ないうちは軽微。

---

## 長期（アーキテクチャ）

### L-1. マスタ群のターミノロジーサーバー化の検討

- **現状**: backend の `Master::*` 名前空間（約 45 テーブル・約 50 コントローラ:
  HOT/YJ 医薬品、JLAC10/11 検査項目、JJ1017 放射線、JANIS、ICD 病名・修飾語、
  J-FAGY ほか）は、正規化検索（`Master::SearchNormalizer`）・LIKE ベースの関連度順・
  コード間マッピングを SQL で実装した、事実上の terminology service。
- **FHIR 的な対応**: CodeSystem / ValueSet / ConceptMap + `$expand`（filter= が文字列検索、
  property フィルタがカスケード facet に対応）、`$lookup`、`$validate-code`、`$translate`
  （HOT↔YJ↔レセ電マッピング）。
- **扱い**: 規模が大きく即時性は低い。方向性の記録に留め、移行判断は別途行う。

### L-2. その他（低優先で記録のみ）

- **検索 Bundle の ETag（または version-less PUT の許容）**: 一覧画面はエントリの ETag を
  持たないため、単発 PUT でなく transaction Bundle PUT を使うパターンが 5 箇所以上ある。
- **削除時の参照整合性ガード**: 病棟削除などはクライアントが事前に `_summary=count` で
  子の存在を確認している。サーバー側の参照整合性チェック（409 応答）があれば確実になる。
- **QuestionnaireResponse 帳票での Binary の `_include`**: backend は batch Bundle で
  3+N 往復を回避しているが、`_include` で添付 Binary まで返せれば 1 検索になる
  （`backend/app/services/questionnaire_response_report.rb`）。
- **バリデーションエラーの日本語化**: OperationOutcome の diagnostics が英語のため、
  クライアントが issue.code から日本語文言を組み立てている（`frontend/src/fhir/outcome.ts`）。

---

## fhir-client 側の課題（サーバー改修不要・ついでに記録）

### F-1. `ServiceRequest.orderDetail` extension のレガシー整理

- **現状**: かつて「`MedicationRequest.basedOn` が検索できない」ために
  `ServiceRequest.orderDetail[].extension`（`prescription-medication-request`）へ
  MedicationRequest の id を埋め込んでいた。読み出しは `_revinclude` へ移行済みだが、
  **書き込み側は extension を今も付け続けている**（`prescriptionHelpers.ts`）。一覧の
  「薬品数」表示が `sr.orderDetail?.length` に依存しているため、単純削除はできない。
- **望ましい対応**: 薬品数を `_revinclude` で取った MedicationRequest の件数に変えたうえで
  extension の書き込みを廃止する。readme の該当記述も更新する。既存データには extension が
  残るため、読み出しの互換は当面維持する。

### F-2. `fetchOrderCandidates` の古いコメントと category 未使用

- **現状**: `queries.ts:2710` 付近のコメントは「上流の ServiceRequest には category
  検索パラメータが無い」と述べているが、これは**古い**（ワークリスト系の
  `worklistParams` は `category=` 検索を実運用している）。そのため検査結果の
  オーダー候補取得は患者の全オーダーヘッダを最大 5 ページ読んで手元で振り分けている。
- **望ましい対応**: `category=` をサーバーに渡して絞り込み、コメントを現状に合わせて更新する。
