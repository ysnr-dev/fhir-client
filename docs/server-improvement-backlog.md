# fhir-server 改善バックログ（将来課題）

fhir-client のワークアラウンド調査で見つかった「fhir-server 側を直した方が効率がよい」
項目のうち、**未実装のもの**の記録。

- 調査履歴: 2026-08-01（初回、6 項目）、2026-08-23（frontend/backend 全面再調査で拡充）、
  2026-08-30（他科依頼の実装で C-6 を追加）、2026-09-01（オーダー横断の課題整理で C-7 を追加）。
- 実装済みの項目（日付のみ dateTime の受理、qualification[].identifier の索引化、
  Questionnaire canonical の一意制約、canonical `_include`、チェーン検索・`_sort`×`_include` の
  回帰 spec、プロブレム単位の絞り込み検索と `Observation.derived-from`、
  ServiceRequest の `based-on` 検索と `_revinclude`〔2026-08-09〕、オーダー日付の統一に伴う
  `occurrenceDateTime` の backfill migration `20260901000001`〔2026-09-01、client 側は
  readme「オーダーの日付」〕）については両リポジトリのコミット履歴を参照。
- **2026-08-23 に優先度 A（5 件）・B（operation 系）・C-1（日付／期間検索）・C-2
  （`_sort` と `AllergyIntolerance.onset`）をサーバー・クライアント両側とも実装済み**
  （下記の「対応済み」節を参照）。残るは C-3〜C-7 と長期のみ。

各項目は「現状のワークアラウンド → 望ましいサーバー機能 → 影響範囲」の形式。
**残っているのは優先度 C の C-3〜C-7 と長期のみ**（優先度 A・B と C-1・C-2 は
2026-08-23 に対応済み）。

---

## 2026-08-23 に対応済み（旧・優先度 A）

サーバー側の実装とクライアント側の追随がどちらも完了。デプロイ時の手動操作は不要:
migration 3 本（service_requests.occurrence_date_time / organizations.identifier_value /
Organization の type token バックフィル）が entrypoint の `bin/rails db:prepare` で
起動時に自動適用される。Render 無料枠には Shell も cron も無く rake タスクを流せないため、
token 再索引もマイグレーションに畳み込んである（`fhir:reindex_tokens` は開発用に残置）。

1. **`Prefer: handling=strict`** — 未知の検索パラメータ・未対応 modifier・未知の
   `_include`/`_revinclude` トークン・未知の `_sort` キーを 400 + OperationOutcome
   （問題を全件列挙）で拒否。既定は従来どおり lenient。
   **クライアント**: backend プロキシ（`fhir_proxy_controller.rb`）が開発環境でのみ
   strict を付ける（`FHIR_STRICT_HANDLING=1/0` で明示的に上書き可）。本番を lenient の
   ままにしたのは、検索が 1 つ通らないだけで画面が壊れるより従来どおり動く方を
   優先したため。導入時にクライアントが投げる全パラメータ・`_include` トークン・
   `_sort` キーを strict で検査済み（取りこぼしは無かった）。
2. **Organization の `type` 検索・`_sort=identifier`**
   **クライアント**: 診療科一覧を `_sort=identifier,name` + `_count`/`_offset` の
   サーバーページングに変更（`useDepartmentPage`）。全件取得→画面側ソート→画面側
   ページングが消えた。
   なお**判別条件は `partof:missing` のまま**にした。診療科を診療科たらしめているのは
   「所属医療機関を持つこと」（フォームが必須にしている不変条件）で、`type` は
   冗長なメタデータに過ぎないため。施設側も 1 件だけ `type=prov` を持たない
   データがあり、`type` に寄せると取りこぼす。
3. **token 検索の `:not` 修飾子**（`_id` 含む。カンマ値は「どれでもない」、値を
   持たないリソースも一致）
   **クライアント**: 連携先医療機関一覧と医療機関検索モーダルの自院除外を
   `_id:not` に変更（取得後に間引いていたので `total` とページ内件数がずれていた）。
   外来一覧の取消・誤登録の除外も `status:not=cancelled,entered-in-error` に変更。
   - 診察室検索（`useLocationSearch`）は `type` の OR 列挙のまま。`type:not=HU,...` より
     「許可する種別を挙げる」方が、未知の種別が増えても混ざらず正確なため。
   - 連携先医師一覧の自院除外は連携先 id のカンマ OR のまま。除外対象が
     `organization`（reference）で、`:not` は token 専用だから。
4. **ServiceRequest の `occurrence` / `department` / `ward` 検索**
   **クライアント**: 放射線・検体検査のワークリストを `occurrence`（実施予定日 =
   撮影日・検査日）で引くように変更。日付境界は外来一覧と同じくローカル 0 時を
   タイムゾーン付きで渡す `ge`/`lt` 形式（撮影時刻を持つオーダーが UTC 比較で
   前日に落ちるのを防ぐ）。処方は実施予定日を持たないので `authoredon` のまま。
   - 診療科・病棟・進捗（`_has:Task:focus:status`）での絞り込みは**画面側のまま**に
     した。絞り込みの選択肢をその日のオーダーから組み立てているため、サーバーで
     絞ると選んだ値しか候補に出なくなる。1 日ぶん数十件なので実害も無い。
   - 撮影日・検査日を `authoredOn` にも重複記載する書き込みは**そのまま**。廃止すると
     編集フォームの日付復元（`parseRadOrderForm` ほか）とカルテの日付軸に影響するので、
     別途判断する（下の F-3）。
5. **`MedicationRequest.based-on` 検索＋条件付き削除の複数マッチ**
   （CapabilityStatement は `conditionalDelete: "multiple"`）
   **クライアント**: backend の処方箋帳票が `MedicationRequest?based-on=` で明細を直接
   取得するようになった（`ServiceRequest?_id=...&_revinclude=...` の迂回を廃止）。
   処方の削除と医療従事者の削除は、事前 GET をやめて transaction 内の条件付き DELETE
   （`MedicationRequest?based-on=...` / `PractitionerRole?practitioner=...`）で 1 往復に。
   - 検体検査・細菌検査のオーダー削除は事前 GET のまま。明細が
     ヘッダ → パネル → 構成項目の 2 段で、条件付き削除では孫まで辿れないため。

---

## 2026-08-23 に対応済み（旧・優先度 B）

サーバー側の実装とクライアント側の追随が完了したもの。デプロイ時の手動操作は不要
（migration は entrypoint の `db:prepare` で自動適用）だが、**Render の環境変数
`SPECIMEN_ACCESSION_SYSTEM` の追加が要る**（render.yaml に定義済み。Blueprint を
再適用しない場合はダッシュボードで手動設定。上流を fhir-client backend より先に
デプロイすること — 未設定のまま新 backend が動くとラベル発行が失敗する）。

1. **`$distinct-dates` operation（B-1・B-2 の集計部分）** — ある date 検索パラメータが
   取る値の重複なし集合(新しい順)を返す独自 operation。`date-param` / `precision=day|full` /
   `timezone=±HH:MM`(day の日境界) / `limit`。通常の検索パラメータ・コンパートメント・
   strict handling がそのまま効く。
   **クライアント**: 3 箇所を置き換えた。
   - カルテの診療日インデックス: 4 リソース種別の全履歴フルスキャン → `$distinct-dates` ×4
     (「日付なし」は応答の `undated` フラグで表現)
   - 検査結果時系列: 「採取日が N+1 個揃うまで全件ページング」→ 直近 N 個の採取日を集計
     してから期間下限付きの 1 検索(通常 2 リクエスト)
   - バイタル経過表: 同型(`precision=full` で測定日時の実値を列にする)
2. **多段チェーン検索（B-4 の 1）** — `Encounter?location.partof.partof=Location/<病棟>`
   のような 3 セグメントまでのチェーンに対応(それ以上は unsupported 扱い、strict なら 400)。
   **クライアント**: 入院患者一覧は**あえて全件取得のまま**(「別病棟に既入院」の判定に
   全件が要る・件数はベッド総数上限。queries.ts の fetchInpatients コメント参照)。
   病床数が増えて truncated が出るようになったらチェーン検索で絞る作りに変える。
3. **`_include:iterate` の多段の回帰 spec 固定（B-4 の 3）** — ベッド→病室→病棟の
   2 段 include が返ることを spec で固定した。クライアントの読み足しフォールバック
   (`queries.ts` の fetchPatientAdmission)はデータ異常への防御として残置。
4. **検体ラベル番号のサーバー採番（B-5）** — `Fhir::AccessionAssigner`。
   `SPECIMEN_ACCESSION_SYSTEM` の accessionIdentifier が値なしで POST されたとき、
   作成時に連番 10 桁 + M10W3 チェックデジットを払い出す(Postgres シーケンス)。
   conditional create が既存に合流したときは採番しないので番号の空振り消費が無い。
   **クライアント**: backend の `LabLabelNumber`(モデル・テーブル)を削除し、
   ラベル発行は system だけ送って応答の番号を使う。
5. **参照検索のカンマ OR の確認と N+1 解消（B-6 の即効部分）** —
   `Observation?derived-from=QR/a,QR/b` を回帰 spec で固定し、経過記録保存前の
   回答ごと 1 検索(N+1)を 1 検索にまとめた。

### 見送り（理由つき）

- **B-2 の統合タイムライン検索**（4 リソースのマージ済みフィード）: 診療日インデックスの
  フルスキャンが消えた時点で主要な痛みは解消。safe cutoff 機構は残るが、設計としては
  安定して動いている。`Patient/$everything` の type+date 絞り込み版は必要になったら。
- **B-3 のカーソル検索**: 調査の結果、id 列の走査は「検体採取日ペイン」(全件表示が必要)と
  共用になっており、前後移動だけを operation 化しても要約一覧の取得は消えない。
  ペイン自体をページングする設計に変えるときに再検討。
- **B-4 の 2（入院系拡張の検索パラメータ化）と 4（カウント facet）**: タブ絞り込みの
  選択肢を手元のデータから組み立てる作りのため、サーバーで絞ると候補が痩せる
  (ワークリストと同じ理由)。病室数・ベッド数のカウントは `_revinclude` 1 往復で
  実用上十分。規模が増えたら batch の `_summary=count` 一括か facet を検討。
- **B-6 の `QuestionnaireResponse/$extract`**: 抽出ロジック(observationExtract.ts)は
  テンプレートのローカル拡張仕様と密結合で、サーバーに移すと二重管理になる。
  保存は transaction Bundle で既に原子的なので、往復数の問題も残っていない。

---

## 2026-08-23 に対応済み（旧・優先度 C-1 / C-2）

デプロイ時の手動操作は不要（migration は `db:prepare` で自動適用、`FHIR_LOCAL_TIMEZONE`
はアプリ側の既定も `Asia/Tokyo` なので未設定でも同じ挙動。render.yaml には明示済み）。

1. **タイムゾーンを持たない検索値のローカル解釈** — FHIR の検索仕様は「検索値に
   タイムゾーンが無ければサーバーのタイムゾーンを使う」と定めている。`Fhir::LocalTimeZone`
   を追加し、既定 `Asia/Tokyo`（`FHIR_LOCAL_TIMEZONE` で上書き可、タイムゾーン名か
   `+09:00` 形式）で解釈するようにした。現在の設定は `/metadata` の
   `implementation.description` に出る。
   **補正を掛けるのは timestamp 列（`:datetime`）だけ**で、`date` 型の列（生年月日）は
   タイムゾーンを持たない日付なのでそのまま比べる。
   **クライアント**: 「日付を渡すときは `ge<当日00:00+09:00>` & `lt<翌日00:00+09:00>` に
   展開する」という暗黙のルールを廃止し、外来一覧・部門ワークリスト・検査時系列の
   下限をすべて日付そのものに戻した（パラメータが 2 本から 1 本になった）。
2. **`Slot.end` 検索パラメータ** — R4 に定義が無いローカル追加（`end_time` 列）。
   `start=lt…&end=gt…` で「その期間に掛かる枠」を正確に引ける（start だけだと期間の頭を
   またぐ枠を取りこぼす）。
3. **`$distinct-dates` の件数モード（`count=true`）** — 日付ごとの件数を返す。
   **クライアント**: 予約枠の月カレンダーの「空き◯」バッジが、1 か月ぶんの Slot を
   全ページ読んで数える作りから 1 リクエストになった（15 分枠なら 1 か月で数百件）。
   `timezone` の既定もサーバーのローカルゾーンに揃えた。

### 訂正: 期間への `eq` は仕様どおり

バックログには「上流の `eq` は『期間を完全に含む』で FHIR 仕様の overlaps と異なる」と
書いていたが、**これは誤り**。FHIR の date 検索は期間に対して `eq` を「検索値の範囲が
対象の期間を完全に含む」と定めており、重なりが欲しい場合は `ge` と `le` を組み合わせる
のが仕様どおりの書き方。上流の実装は正しく、クライアントの `ge`&`le` も回避策ではなく
標準的な書き方だった。回帰 spec（`search_features_spec.rb` の period comparison
semantics）で固定し、クライアント側のコメントも「上流の制限ではない」と直した。

---

### C-2. `_sort` の信頼性向上と `AllergyIntolerance.onset`

- **サーバー**: `AllergyIntolerance.onset` 検索パラメータ（R4 標準、`onsetDateTime` を
  索引。`onsetPeriod` / `onsetAge` などの他の onset[x] は点の時刻として比べられないので
  索引していない）を追加。あわせて **`_sort` は値を持たない行を方向によらず末尾に置く**
  （`NULLS LAST`）ようにした — Postgres の既定は DESC が NULLS FIRST で、「新しい順」に
  日付未設定のものが先頭に来てしまうため。並び順の保証（Appointment / Encounter の
  `date`、`_history` の新しい版が先）は回帰 spec で固定。`_sort` の規則は README に記載。
- **クライアント**: 「上流の `_sort` を信用せず画面側で並べ直す」防御を 3 箇所から撤去した
  （カルテの予約タブ、入院予定の一覧、診療記録の版履歴）。

#### 訂正: アレルギー一覧の「表示と並び順のずれ」は誤り

バックログには「アレルギー一覧は `onsetDateTime` を表示しつつ `date`（recordedDate）で
ソートしており基準がずれている」と書いていたが、**これは誤り**。一覧（`AllergyTable`）が
表示しているのは記録日で、`_sort=-date` と一致していた。発症日を出しているのは詳細
パネルの方。一覧の並び順は記録日のまま据え置き、追加した `onset` は「発症日で絞る／
並べる画面ができたときに使える標準パラメータ」として残している。

---

## 優先度 C: 個別の検索パラメータ・仕様適合（残り）

### C-3. `_elements` の choice 型対応（仕様適合）

- **現状**: 上流の `_elements` はトップレベルの JSON キー名の完全一致で切り出すため、
  choice 型は基底名（`effective`）ではなく実キー名（`effectiveDateTime`）で指定する必要が
  ある（`fetchLabResultSummaries` のコメント）。
- **望ましいサーバー機能**: FHIR 仕様どおり element 基底名での指定を受理する
  （実キー名も後方互換で受理し続けてよい）。
- **影響範囲**: 仕様適合のみ。クライアントの記述が素直になる。

### C-4. `Location.physical-type` 検索

- **現状**: 病棟/病室/ベッドの階層判別は `physicalType` で行っているのに検索できず、
  type コードの OR 列挙で代用（`useLocationSearch`）。
- **望ましいサーバー機能**: `Location?physical-type=`（R4 標準）。
- **影響範囲**: 診察室・病棟系検索の記述の単純化。`:not` 修飾子（実装済み）で
  `type:not=` と書けるようになったため、優先度はさらに低い。なお現状の
  「許可する種別を挙げる」書き方は、未知の種別が増えても混ざらない利点がある。

### C-5. `Schedule.specialty` 検索の実装

- **現状**: 予約枠セレクトは全 Schedule を取得後にコードで絞っている
  （`useScheduleOptions` のコメント「上流の specialty 検索に頼らず」）。
- **望ましいサーバー機能**: `Schedule?specialty=`（R4 標準）の実装（または対応済みなら
  CapabilityStatement での明示とクライアント側の移行）。
- **影響範囲**: 予約画面の転送量。Schedule 件数が少ないうちは軽微。

### C-6. `ServiceRequest.performer` 検索の実装

- **現状**: 他科依頼(`docs/consult-order-design.md`)は依頼先の診療科を標準の
  `ServiceRequest.performer`(Organization)に持つが、上流が索引していないため
  (`handling=strict` で `Unsupported search parameter 'performer'` を確認済み)、
  他科依頼一覧は `status` で絞った全件を読んでからクライアントで依頼先科を絞っている
  (`fetchConsultWorklist` + `matchesFilters`)。
- **望ましいサーバー機能**: `ServiceRequest?performer=`(R4 標準)。
- **影響範囲**: 他科依頼一覧。未回答の件数は「いま溜まっている仕事」に比例するので
  当面は破綻しないが、科ごとに絞ってページングしたくなった時点で必要になる。
  医師単位の受信箱(`performer=Practitioner/...`)を作るときも前提になる。

### C-7. `Provenance` リソースの実装（代行入力・承認の記録）

- **現状**: オーダーの `requester` には指示医師しか入らず、**代行入力した本人（ログイン
  ユーザー）はどのリソースにも記録されていない**（`applyOrderContext` が書くのは
  `requester` / 依頼科 / 在院病棟の 3 つだけ）。サーバー側の `AuditEvent` も
  `agent.who` は OAuth クライアント（`fhir_auditing.rb` の `client_name`）で、
  エンドユーザーではないため監査ログからも追えない。詳細は
  `docs/order-common-backlog.md` §2。
- **望ましいサーバー機能**: `Provenance`（R4）の保存・検索。`Provenance.target` が
  `ServiceRequest` などを指す一方向参照なので、model / validator /
  `SearchDefinitions::Provenance::PARAMS`（`target`・`agent`・`recorded`・`patient`）/
  抽出定義に加えて、`_revinclude=Provenance:target` の逆参照定義が要る。JP Core に
  プロファイルが無いので、Task / Group / Composition と同じく基底 HL7 定義に載せ、
  検証は手書きの `ProvenanceValidator` が行う形になる。
- **影響範囲**: これが無いと代行入力の記録は client 側のローカル拡張
  （`extension[order-enterer]`）で代替するしかない。拡張でも「誰が入力したか」は残せるが、
  編集ごとの履歴と `Provenance.signature`（医師の承認・電子署名）は表現できないので、
  真正性の要件を満たす承認フローを作る段階で必要になる。カルテのタイムラインは
  `_revinclude` を既に重ねているので、Provenance は一覧では引かず詳細を開いたときだけ
  引く前提でよい。

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

### F-3. 撮影日・検査日の `authoredOn` への重複記載の廃止

- **現状**: 放射線・検体検査のオーダーは、画面の「撮影日」「検査日」を
  `occurrenceDateTime`（実施予定日時）と `authoredOn`（オーダー発行日）の**両方**に
  書いている。ワークリストの検索は `occurrence` に移したので、読み出し側はもう
  `authoredOn` を日付軸に使っていない。
- **望ましい対応**: `authoredOn` を本来の意味（オーダーを書いた日時）に戻し、
  重複記載をやめる。そうすると「明日の撮影を今日オーダーする」が正しく表現できる。
- **影響範囲**: 編集フォームの日付復元（`radOrderHelpers` の `parseRadOrderForm`、
  `labOrderHelpers` の同等処理が `sr.authoredOn` から日付を取っている）と、カルテの
  タイムラインが `-authoredon` でオーダーを並べている点。既存データは両方に
  同じ日付が入っているので読み出しの互換は保たれるが、並び順の意味は変わる。
