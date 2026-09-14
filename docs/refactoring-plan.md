# リファクタリング計画（FHIR サーバーへの寄せ・コメント整理）

fhir-client の非効率なコードを洗い出し、リファクタリングの要否と手順をまとめた記録。
観点は 2 つ。

1. クライアントが手元でしている絞り込み・並べ替え・結合のうち、FHIR サーバーに任せた方がよいもの
2. コメントに残った修正経緯と、過剰な説明

- 調査日: 2026-09-15
- 調査範囲: `frontend/src`、`backend/app`、上流 fhir-server の
  `app/lib/fhir/search_definitions/*.rb` と `app/lib/fhir/search_references.rb`
- 行番号はすべて 2026-09-15 時点。着手時は関数名で探し直すこと。

## 結論

- **リファクタリングの価値はある。** 中心は「上流が既に対応している検索をクライアントが使っていない」箇所（第 1 段）。
  上流は `category` / `requisition` / `_include:iterate` / `PractitionerRole.role` / `Schedule.specialty` などに
  対応済みだが、クライアントには「上流に無い」と書いたまま全件を取って手元で絞る実装が残っている。
- 変更はどれも 1 箇所あたり数行。転送量が減るだけでなく、`_count` の上限で**黙って取りこぼす**
  正しさの問題（A2・A4・A5・A6・A7）も同時に直る。
- 上流側に新しい実装が要るのは **`Observation.based-on` の 1 件**だけ（第 2 段）。
- コメントの整理は約 90 件（第 3 段）。TODO/FIXME は 0 件で、長い説明ブロックの大半はドメイン上の理由なので残す。
  直す対象は「〜する前のデータ」「旧データ」「(2026-xx-xx に確認)」といった過去との比較と、孤立・重複したコメント。

## 実施順

| 段 | 内容 | リポジトリ | 依存 |
|---|---|---|---|
| 第 1 段 | 上流対応済みの検索への追随（A1〜A17） | fhir-client | なし（上流は対応済み） |
| 第 2 段 | `Observation.based-on` の追加とクライアント追随 | fhir-server → fhir-client | 上流を先にデプロイ |
| 第 3 段 | コメント整理 | fhir-client | 第 1 段で消えるコメントは第 1 段と一緒に直す |

第 1 段と第 3 段は独立しているので、並行して進めてよい。

## 第 1 段の実施結果（2026-09-15）

A14 を除いて実装済み。`tsc -b` 通過。計画から変えた点は次のとおり。

| # | 計画との違い |
|---|---|
| A1 | 病理レポートのオーダー候補も同じ関数を使っていたので、`category=…\|pathology` を渡すようにした |
| A3 | `usePatientTasks` を `useOrderTasks(orderIds)` に置き換えた。承認 Task は `basedOn` でオーダーを指すので、`focus=` と `based-on=` の 2 検索を並列に引いて重複を除く |
| A6・A7 | 処方はオーダー種別（order-type）を持たないので、処方区分の system だけを指定する `category={PRESCRIPTION_CATEGORY_SYSTEM}\|` で絞った（処方ワークリストと同じ書き方）。A7 は注射の `order-type\|injection` とのカンマ OR |
| A10 | サーバーで絞るのは診察予約以外の種別だけ。診察予約は種別を持たない枠表や旧コードも含む（`scheduleTypeOf`）ので、完全一致では取りこぼす |
| A11 | 施設の全ロールではなく、診療科の所属者に限って `organization` + `practitioner`（カンマ OR）+ `role=doctor,dentist` で 1 回で引く |
| A14 | **やらない**。日付だけの `occurrenceDateTime` は上流で 0 時として索引されるため、`_sort=occurrence` だと時刻未指定の行が末尾ではなく先頭に来る |
| 重複統合 | 予約の読み出しは `useOrderAppointment`、取消エントリは共用の `fetchOrderAppointmentCancelEntries` に一本化。実施取消の検索は `procedurePerformSearchParams` / `fetchProcedurePerformResources` に一本化（生理・内視鏡・処置） |

**検証**: 開発環境で、旧条件（全件を取って手元で絞る）と新条件（サーバーで絞る）の結果の id 集合を突き合わせた。
すべて一致した。

| 項目 | 突き合わせた件数 |
|---|---|
| A1 検体検査 / 細菌検査 / 病理 | 38 / 4 / 6 |
| A2 看護の Observation / Procedure（2026-08-29） | 5 / 1 |
| A3 focus で指す Task / basedOn で指す Task | 50 / 2 |
| A4 連日注射の後続日（並び順も一致） | 7 |
| A5 有効な予約 | 24 |
| A6 処方 / A7 処方＋注射 | 30 / 65 |
| A8 検査オーダー / A9 手術のハブ | 46 / 2 |
| A10 検査・リハ・栄養指導・化学療法の枠表 | 2 / 1 / 1 / 1 |
| A11 医師ロール（2 施設） | 5 / 1 |
| A12 ベッド → 病棟名 | 36 |
| A13 予約の Slot | 17 |
| A15 検査結果の通知 Task | 1 |
| A16 と同じ形の検索（化学療法の予約が無いのでリハビリ予約で確認） | 9 |

画面では、指示簿の「本日」列、リハビリ一覧の次回予約、カルテ見出しの病棟名、経過表の検査イベントが表示され、
コンソールエラーが無いことを確認した。検査結果の登録フォームとパスの取消パネルは画面操作では開いていない
（検索条件の突き合わせのみ）。開発データに除外対象（revoked の検査オーダー、partOf を持つ手術記録、
化学療法室の予約）が無いため、A8・A9・A16 は除外が効く場面そのものは画面で見ていない。

---

## 第 1 段: 上流対応済みなのにクライアントが使っていない箇所

特に断りの無いものは `frontend/src/api/queries.ts`。上流の対応は定義ファイルで確認済み。

### 効果の大きいもの

#### A1. 検査・細菌の結果登録のオーダー候補 — `fetchOrderCandidates`（:4139）

- **現状**: 患者の全オーダーヘッダを `_count=500` × 最大 2 ページ取り、明細（`_revinclude:iterate`）と
  DiagnosticReport（`_revinclude`）も付けたうえで、`isTargetHeader` で検体検査・細菌検査だけ残す。
  コメント（:4131-4134）は「上流の ServiceRequest には category 検索パラメータが無いため」と書いているが、古い。
- **対応**: `category={ORDER_TYPE_SYSTEM}|{lab or micro}` を検索に付ける。呼び出し側の
  `fetchLabOrderCandidates` / `fetchMicroOrderCandidates` から種別コードを渡す。`isTargetHeader` は念のため残してよい。
  コメントは削除する。
- **影響**: 結果登録フォームを開くたびに走る。オーダー歴の長い患者では、候補 50 件を出すために
  最大 1000 ヘッダ分の明細と検査結果を読んでいる。
- 既存バックログ `server-improvement-backlog.md` の F-2 と同じ件。

#### A2. 看護指示簿の「本日」列 — `useNursingPerformsOn`（:9485）

- **現状**: 日付で**全患者**の看護の Observation と Procedure を 200 件ずつ取る。引数の `patientIds` は
  queryKey に入れているだけで、検索には使っていない。
- **対応**: `patient=Patient/a,Patient/b,...` の comma-OR を付ける。同じ書き方は既に :5519 などにある。
  病棟の患者数が多いと URL が長くなるので、`fetchByPatientChunks` と同じくチャンクに分ける。
- **影響**: 施設全体の実施記録が 200 件を超える日は、黙って欠落する。転送量より正しさの問題として優先度が高い。

#### A3. クリニカルパスのオーダーの Task — `usePatientTasks`（:11413）

- **現状**: 患者の Task を条件なしで 500 件取る。使っているのは次の 2 画面で、どちらも手元で
  オーダー id と突き合わせている。
  - `PathwayCancelPanel.tsx:36`: `planPathwayCancel` で受付済みのオーダーを見分け、
    `deleteNursingOrderRequest`（:11428）で看護指示の Task を消す。
  - `PathwayOrderModal.tsx:438`: オーダー 1 件の受付 Task を探す。
- **対応**: どちらも対象のオーダー id が分かっている。取消はパスのオーダー id 一覧で
  `Task?focus=ServiceRequest/a,ServiceRequest/b,...` とし、多い場合はチャンクに分ける。
  モーダルは `focus=ServiceRequest/{id}` で引く。上流の `Task.focus` は列索引あり。
- **影響**: 500 件取って数件だけ使っている。Task が 500 件を超える患者では、受付済みの判定と Task の削除が漏れる。

#### A4. 連日注射の後続日 — `useInjectionSeriesLater`（:3127）

- **現状**: 患者 + 注射 + 注射日（`occurrence=gt`）で 100 件取り、`requisition` を手元で突き合わせ、
  `orderDay` で並べ替える（:3165）。コメント（:3121-3125）は「上流に requisition 検索が無い」と書いているが、
  2026-09-09 に対応済み。
- **対応**: `requisition={system}|{value}` を付け（同じファイルの :10781 と同じ形）、`_sort=occurrence` に任せる。
  コメントは実装に合わせて書き直す。
- **影響**: 100 件の上限で系列の途中が切れる可能性を解消する。

#### A5. 予約の status を手元で絞る — `isActiveAppointment` の 14 箇所

- **現状**: 予約を status 無しで取り、`isActiveAppointment`（`fhir/appointmentHelpers.ts:43`）で
  proposed / pending / booked / arrived / checked-in / waitlist だけ残す。
- **対応**: `status=proposed,pending,booked,arrived,checked-in,waitlist` を検索に付ける。上流の `Appointment.status` は列索引あり。
  値の一覧は `appointmentHelpers.ts` に定数として置き、判定関数と検索の両方から使う。
- **箇所**:
  - 全施設の日付範囲検索で `_count=200`（上限で有効な予約が押し出される）:
    `fetchRehabAppointmentsFrom`（:8396）、`fetchNutritionGuidanceAppointmentsFrom`（:8725）
  - オーダー 1 件の予約: `useRadOrderAppointment`（:2726）、`usePhysioOrderAppointment`（:7286）、
    `useEndoscopyOrderAppointment`（:7601）、`useTreatmentOrderAppointment`（:7918）、
    取消エントリ組み立て（:7056、:7372、:7687、:7996、:8423）
  - 複数オーダー: `fetchOrderAppointments`（:10705）、`useChemoRoomList`（:11006）

### 小さいが無料で直るもの

| # | 箇所 | 現状 | 対応 |
|---|---|---|---|
| A6 | `latestPrescriptionBundle`（:6208） | 注射と区別できないので 5 件取り、最新の処方だけ残す（:6263-6265 のコメント） | 処方区分の system で `category={PRESCRIPTION_CATEGORY_SYSTEM}\|` と `_count=1`。5 回続けて注射だった患者で外れる問題が直る |
| A7 | `hooks/useAntimicrobialSuggestions.ts:40-47` | category 無しで直近 N 件を取り、薬剤を持つものだけ残す | 処方区分の system と `order-type\|injection` のカンマ OR。検査・放射線のオーダーで N 件の窓が埋まる問題が直る |
| A8 | `usePatientExamOrders`（:2282、除外は :2311） | revoked / entered-in-error を手元で除外 | `status:not=revoked,entered-in-error`（:2860 と同じ書き方） |
| A9 | `usePatientSurgeryPerforms`（:1961、除外は :1976） | 親を持つもの・entered-in-error・not-done を手元で除外 | `part-of:missing=true` と `status:not=entered-in-error,not-done` |
| A10 | `useScheduleOptions`（:2591） | 有効な Schedule を全部取り、serviceType と specialty を手元で絞る | `service-type=` はサーバーへ。specialty は「未設定の枠表は全科共通」を残すため手元のまま（`specialty=X` と `specialty:missing=true` の OR は書けない）。:2588 のコメントはこの理由に書き直す |
| A11 | `fetchFacilityRoleCodes`（:1006） | 施設の PractitionerRole を 100 件ずつ**上限なし**のループで読み切り、医師かどうかを手元で判定 | 上流の `PractitionerRole.role`（列索引あり）で医師・歯科医師のコードに絞る |
| A12 | `fetchWardNameByBed`（:2329-2354） | `_include:iterate` に応えない上流向けに、病棟を 1 件ずつ直列で読み足すループ | 上流は `_include:iterate` 対応済み。ループを削除し、:2327 と :1863 のコメントも消す |
| A13 | `fetchAppointmentSlots`（:2740） | 予約の Slot を `Promise.all(ids.map(readResource))` で個別に読む。取消エントリを組む 5 箇所（:7060、:7376、:7691、:8000、:8427）では、それを予約ごとの for ループ内で直列に await | `Slot?_id=a,b,c` の 1 検索にし、複数予約の分をまとめてから 1 回で読む |
| A14 | 部門ワークリストの並べ替え（:3535 放射線、:7150 生理、:7465 内視鏡、:7782 処置） | occurrence の時刻順・未設定を末尾、を手書きのソートキーで実装 | **やらない**（上の「第 1 段の実施結果」を参照） |
| A15 | `fetchReportTask`（:4673）の呼び出し :4967-4968 | 検査結果 1 件に対し、code だけ違う Task 検索を 2 回 | `code=A,B` の 1 検索にし、手元で振り分ける |
| A16 | `useChemoRoomList`（:10988-11041） | Appointment を取ってから ServiceRequest を `_id` で再検索する直列 2 往復 | `_include=Appointment:based-on` と `_revinclude:iterate=Task:focus`、`_revinclude:iterate=MedicationRequest:based-on` で 1 往復 |
| A17 | `usePathwayWardTasks`（:11321、ループは :11343-11359） | 10 件ずつのチャンク検索を直列に await | `Promise.all` で並列にする（クライアントだけの変更） |

### 同じ関数の重複を 1 つにする

上の A5・A13 を直すと同じ修正を何度も入れることになるので、先に重複を統合する。

- **予約取消エントリ**: `fetchRadAppointmentCancelEntries`（:7049）、`fetchPhysioAppointmentCancelEntries`（:7365）、
  `fetchEndoscopyAppointmentCancelEntries`（:7680）、`fetchTreatmentAppointmentCancelEntries`（:7989）は、
  共用の `fetchOrderAppointmentCancelEntries`（:8416）と中身が同じ。共用版に寄せて 4 関数を削除する。
- **オーダーの予約の読み出し**: `useRadOrderAppointment` / `usePhysioOrderAppointment` /
  `useEndoscopyOrderAppointment` / `useTreatmentOrderAppointment` は queryKey の種別名だけが違う。
  種別名を引数にした 1 つの hook にする。
- **実施取消の検索条件**: `physioPerformSearchParams`（:7179）・`endoscopyPerformSearchParams`（:7494）・
  `treatmentPerformSearchParams`（:7811）は同じ内容。直前の 8 行の JSDoc も三重になっているので、1 つにまとめる。

### やらないこと（理由つき）

- **リハビリ・栄養指導ワークリストの実施記録と予約**（`fetchRehabWorklist` :8340、`fetchNutritionGuidanceWorklist` :8757）
  は別検索のままにする。オーダーは期間を持つ継続指示なので、`_revinclude=Procedure:based-on` にすると
  その日の実施だけでなく全期間の実施と過去の予約まで付いてきて、かえって件数が増える。
  コメントの「オーダーの検索から辿れないので別に引く」は「その日の分だけ取るため別に引く」に直す。予約側は A5 で status を付ける。
- **部門ワークリストの当日全件取得と手元のフィルタ**（`RadWorklistPage.tsx` ほか約 10 画面）は残す。
  フィルタの選択肢をその日のオーダーから作るので、サーバーで絞ると選択肢が痩せる（:3468-3474 のコメント）。
- **患者番号順の並べ替え**（`comparePatientNumber`）は残す。include した Patient の identifier で並べるので、`_sort` では表現できない。
- **手術ワークリストの並べ替え**（:9603、:9668）は残す。手術室名は拡張の中にあり、priority は辞書順と意味の順が一致しない。
- **通知ベルの 2 回の `_summary=count`**（`useNotificationCounts` :4856）は残す。全件数と至急件数の 2 つの値なので 1 回にできない。
- **`fetchAllDepartments` と `fetchAllByPartOf` の全ページ読み**は残す。前者は選択肢と一括登録の重複判定で全件が要る。
  後者は 1 ページ目の total から残りを並列に読んでおり、既に効率がよい。
- **検査結果の版履歴**（`useLabObservationHistories` :4649）は残す。`_history` はリソースごとにしか引けない。

---

## 第 2 段: 上流 fhir-server 側の実装

### C-9. `Observation.based-on` 検索と `_include` / `_revinclude`

- **現状**: 上流の Observation には `part-of` と `derived-from` はあるが、`based-on` が無い。
  Procedure には `based-on` があるので、非対称になっている。そのためクライアントは次の 2 箇所で回り道をしている。
  - `useKartePathwayEvaluations`（:6646、コメント :6641）: 判定の Observation を取ってから basedOn の CarePlan を
    `_id` で別に引く 2 往復。
  - `fetchNursingPerforms`（:9452、コメント :9435）: 看護の観察を指示から辿れないので、患者か日付で引いてから
    basedOn で指示に振り分ける。
- **上流の変更**: `search_definitions/observation.rb` と `search_references.rb` の Observation に
  `based-on`（multiple、jsonb_key `basedOn`、targets `ServiceRequest` / `CarePlan`）を追加する。
  既存行の索引を作り直す必要があるかは、`ServiceRequest.requisition` を足したときの migration
  `20260909000003` を見て判断する。rspec に `Observation?based-on=` と `_revinclude=Observation:based-on` を追加する。
- **クライアントの追随**:
  - `useKartePathwayEvaluations` は `_include=Observation:based-on` と `_include:iterate=CarePlan:part-of` で 1 往復にする。
  - `fetchNursingPerforms` は、患者単位の呼び出し（`useNursingPerformsOf`）なら今のままでよい。
    コメントの「based-on の検索パラメータが無いので」だけを直す。日単位は A2 の patient 絞り込みで足りる。
- **デプロイ順**: 上流を先にデプロイする。上流が旧版のままクライアントが新しいパラメータを使うと、
  lenient 既定では条件が無視されて全件が返る。

### 追記のみ: 検査結果コードの前方一致

`server-improvement-backlog.md` の「見送り」にある JLAC11 分析物コード 5 桁の前方一致は、引き続き見送る。
ただし、感染症パネル（`useLabInfectionResults` :5815、`useInfectionsForPatients` :5592）は患者 5 人ずつ
`_count=500` で Observation を取っており、病棟マップでいちばん重い検索になっている。優先度を見直すときの材料として記録する。

---

## 第 3 段: コメント整理

方針はプロジェクトの規約どおり。「過去との比較は消し、現状の意図だけ残す」。
データの互換のために残している読み出しコードは、「〜する前のデータ」ではなく**データの形**で説明する。

### 3-1. 削除・移動・修正（確定）

**frontend/src/api/queries.ts**

- :2629-2632 — 存在しない関数（月ぶんの空き枠）の JSDoc が `useFreeSlotCountsOfMonth` の JSDoc の直前に残っている。削除する。
- :10670-10674 — レジメン適用ヘッダを id で引く関数の JSDoc だけが `useBookChemoAppointment` の直前に残っている。削除する。
- :8610-8615 — `useDeleteNutritionGuidanceOrder`（:8635）の説明が、本体を切り出した `deleteNutritionGuidanceOrderRequest` の
  上に取り残されている。hook 側へ移し、:8618-8632 の余分な字下げも直す。
- :8964-8969 — 同じ形。`useDeleteConsultOrder`（:8982）へ移す。
- 第 1 段で事実でなくなるコメント: :1863、:2327、:2588、:3121-3125、:4131-4134、:6263-6264、:8340、:8757。
  **第 1 段と同時に直し済み（2026-09-15）**。

**frontend のその他**

| 箇所 | 内容 | 直し方 |
|---|---|---|
| `components/PatientHeader.tsx:57-59` | 「［決定］…(2026-09-08)」 | 決定ログの枠と日付を落とし、帯に出さない理由だけ残す |
| `fhir/locationHelpers.ts:22-27` | 「［提案］」「(2026-08-28 に確認)」 | マーカーと日付を落とす |
| `fhir/labOrderHelpers.ts:25` | 「(上流サーバーは 2026-08-09 に based-on 検索へ対応済み)」 | 括弧ごと削除 |
| `fhir/labOrderHelpers.ts:31-32` | 「明細を contained に入れていた頃・…持っていた頃のオーダーも読める」 | 削除（読み出し箇所のコメントで足りる） |
| `karteLayout.ts:31` | 「(スプリッタ導入前の固定値)」 | 括弧ごと削除 |
| `components/PhysioOrderForm.tsx:73-75` | 「生理検査と違い JJ1017 コードと…」（自分自身と比べている） | 「放射線と違い」に直す |
| `components/EndoscopyOrderForm.tsx:73-75` | 「内視鏡と違い…」（同上） | 「放射線と違い」に直す |
| `components/KarteCardModals.tsx:826, 838, 979` | :813 の説明の繰り返し | 削除 |
| `fhir/oralPerformHelpers.ts:287` | `id` に「ハブの Procedure id。」 | 削除 |

**backend**

| 箇所 | 内容 | 直し方 |
|---|---|---|
| `app/services/injection_report.rb:109` | 「based-on 検索は上流に無い」 | 誤り。付録 B-2 と合わせて直すまでの間も、この一文は消す |
| `app/services/prescription_report.rb:5` | 「明細(_revinclude)」 | 実装は `based-on` 検索。実装に合わせる |
| `db/migrate/20260831140000_create_master_meal_diets.rb:4-8` | 「当初は…1 テーブルに入れていたが…分けた」 | 別テーブルにする理由 1 行にする |
| `app/services/fhir_gateway.rb:4-21, 44-48` | 過去の不具合と回避の経緯 | 現状の制約（なぜこの設定か）だけ残す |
| `app/services/fhir_token_provider.rb:6-8` | 「preserving the previous pass-through behaviour」 | 同上 |
| `app/controllers/wakeup_controller.rb:24-34`、`app/services/upstream_warmup.rb:35-36` | 過去の調査の記録 | 同上 |
| `app/controllers/master/base_controller.rb:87-88` | `count(:all)` にした経緯 | 同上 |
| `app/controllers/master/nursing_acts_controller.rb:34-35`、`jlac_items_controller.rb:74-75` | ORDER BY を外す経緯 | 同上 |
| `app/models/master/surgery_category.rb:8-9` | 「データ移行などで壊れた行」 | 守っているデータの形で書く |

### 3-2. 「〜する前のデータ」「旧データ」の言い換え（約 74 件）

互換のための読み出しコードは残し、コメントだけを「データの形」の説明に置き換える。

| 今の言い回し | 置き換え | 主な箇所 |
|---|---|---|
| 結果項目マスタ導入前の保存済み結果 | 施設コードを持たない結果（JLAC11 のみ） | `fhir/labResultHelpers.ts`（8 件）、`LabResultDetailPanel.tsx`、`LabResultTimelinePanel.tsx`、`hooks/useLabResultInitialValues.ts`、`api/masterQueries.ts`、`backend/.../lab_result_items_controller.rb:13` |
| 時刻を付ける前に登録した | 時刻を持たない | `fhir/encounterHelpers.ts`（5 件）、`lib/dates.ts:36`、`OrderDetailRows.tsx:10` |
| id の無い旧データ | id を持たない外出泊 | `fhir/encounterHelpers.ts:687-725` |
| 外来オーダーと、焼き付ける前に出したオーダー | 病棟を持たないオーダー（外来など） | ワークリスト 11 画面（Lab / Rad / Rx / Patho / Transfusion / Physio / Treatment / Endoscopy / Rehab / NutritionGuidance / Surgery の各 `*WorklistPage.tsx`）に 1〜2 箇所ずつ |
| 検体・採取管を拡張で持っていた頃の明細 | 検体・採取管を拡張に持つ明細 | `fhir/labOrderHelpers.ts:50, 318, 325`、`backend/app/services/lab_label_report.rb:38` |
| 種別 / capacity を持たない頃のデータ | 種別 / capacity を持たない枠表 | `fhir/scheduleHelpers.ts:213, 421` |
| 古いデータ / 旧データ（occurrencePeriod） | occurrencePeriod を持つ申込 | `fhir/surgeryOrderHelpers.ts:918, 1072` |
| 〜を作る前 / この機能より前に登録された | 削除（直前の文で規則が書かれている） | `fhir/radTaskHelpers.ts:14`、`fhir/injectionTaskHelpers.ts:11-12` |
| その他の「旧データ」「(この拡張を入れる前のデータもこれ)」など | 括弧を落とすか、データの形で書く | `fhir/{shared,conditionHelpers,mealOrderHelpers,patientHelpers,karteTimeline,provenanceHelpers,mealEncounterSync,prescriptionHelpers,injectionHelpers,pathoOrderHelpers}.ts`、`components/{InpatientPlanTables,QuestionnaireResponseForm,MealOrderForm}.tsx`、`orderContext.ts:51` |

探索用のコマンド:

```sh
grep -rnE "(前に登録|前のデータ|導入前|頃の|頃に|旧データ|古いデータ|旧形式|旧行|付ける前|入れる前|作る前|分ける前|焼き付ける前|より前に登録)" frontend/src backend/app backend/db/migrate
```

**除外する語**（業務用語で、コードの過去を語っていないもの）:

- 廃止（マスタ項目の状態）
- 開腹移行、乳汁移行、移行先管理番号
- 修正報告、amended
- 「元の食事に戻す」「変更前 → 後」（画面の振る舞い）
- 旧姓
- 旧 Binary、旧バージョン（`_history` や vread の話）

### 3-3. 残すもの

次のコメントは読んだうえで残すと判断した。

- `fhir/*Helpers.ts` 冒頭の 20〜36 行の説明。FHIR リソースの組み立て、JJ1017・JLAC・JANIS のコード体系、上流の制約を書いていて、コードからは読み取れない。
- `queries.ts` の 6 行以上のブロックの大半。検索条件を選んだ理由と、上流の `_count` 上限との関係を説明している。
- `backend/db/seeds.rb` の長いブロック。CSV 列の約束事を書いている。

---

## 付録: backend Rails の非効率（今回の範囲外、記録のみ）

FHIR サーバーへの往復に関わるものを B、Rails 内で完結するものを R とする。

| # | 箇所 | 現状 | 対応 | 効果 |
|---|---|---|---|---|
| B-1 | `app/services/lab_label_report.rb:137-179` | 管のグループごとに Specimen を 1 件ずつ直列に POST | 採番が要る分をまとめて 1 つの batch Bundle で登録（上流は entry ごとの `ifNoneExist` に対応） | 高 |
| B-2 | 帳票 4 種（`lab_label_report` / `prescription_report` / `injection_report` / `questionnaire_response_report`） | 患者参照を知るためだけに read し、続けて batch を投げる 2 往復 | `ServiceRequest?_id={id}&_include=ServiceRequest:subject&_revinclude=…` の 1 検索にまとめる | 高（PDF の待ち時間がほぼ半分） |
| B-3 | `app/services/questionnaire_response_report.rb:84-110` | `Questionnaire?url=` を件数指定なしで取り、先頭を選ぶ | `_count=1` を付ける（版指定が無いときの並びも明示する） | 低 |
| R-1 | `app/controllers/master/pathways_controller.rb:313-333` | パスの複製で、イベント → 単位 → 評価・タスクを入れ子のループで 1 件ずつ読んで create | 子テーブルを pathway_code で一括ロードし、階層ごとに `insert_all` | 中 |
| R-2 | `pathways_controller.rb`（承認検証と detail）、`regimens_controller.rb:287, 367` | 同じ子レコードを保存の検証と応答の組み立てで二度ロード | 1 回のロードを渡す | 中 |
| R-3 | `app/models/facility_settings.rb:132` と `app/controllers/facility_settings_controller.rb:11-19` | `current` がキャッシュなしの `first_or_create!` で、show の中で 6 回呼ばれる | show の中で 1 回にするか、`FhirConnectionSettings` と同じ短時間キャッシュ | 中 |
| R-4 | `app/controllers/master/nursing_acts_controller.rb:36-68` | 全件ロードして Ruby でソートし、ページを切る | ORDER BY と LIMIT/OFFSET を SQL に移す | 低〜中 |

---

## 検証の手順（着手時）

- 型チェックは `frontend` で `tsc -b`。`--noEmit` は何も検査しないので使わない。
- 第 1 段の各項目は、開発環境で該当画面を開き、Network で往復数・件数と表示結果が変わらないことを確かめる。
  - A1: テスト太郎の検体検査・細菌検査の結果登録フォームで、候補が同じ並びで出る
  - A2: 東 3 階病棟の指示簿の「本日」列
  - A3: クリニカルパス（900002〜900004 は適用済み）の取消で、看護指示の Task が消える
  - A4: 連日注射の編集・削除で、後続日が同じに出る
  - A5・A13・重複統合: 放射線・生理・内視鏡・処置・リハビリの予約付きオーダーの取消で、枠が空きに戻る
  - A14: 各部門ワークリストの並び順が変わらない
- 第 2 段は fhir-server のコンテナ内で rspec を実行する。
- 第 3 段はコメントだけの変更なので、`tsc -b` が通ればよい。
