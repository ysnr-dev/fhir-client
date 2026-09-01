# 注射オーダーの設計

医師が患者に出す注射(点滴・静注・皮下注など)のオーダー。FHIR 上の持ち方の全体は
`readme.md`「注射オーダー機能」に書いてあるので、ここでは **連日オーダー(期間展開)** を
中心に、設計判断とその理由を残す。

## 1. リソースの単位 = 1 施行日 1 オーダー

| | 処方 | 注射 |
|---|---|---|
| 伝票の単位 | 1 処方 = SR 1 本 + 薬剤の MR | **1 日分 = SR 1 本 + 薬剤の MR** |
| 期間 | 内服は「日数」を薬剤行に持ち、SR は 1 本 | **日数ぶんの SR に展開**して登録 |
| 束ね | (無し) | `requisition`(同じ uuid) |

注射は 1 施行ごとに実施入力(看護)・払出(薬剤部)・算定が起こる。「◯日間」の
指示をどう持つかは 2 案あった。

### 1.1 検討した 2 案

**A. オリジナルオーダー方式**: 期間付きのオーダーを 1 本置き、実施入力のたびに次の
1 施行分を展開する。

**B. 一括展開方式**: 登録時に期間ぶんのオーダーを 1 日 1 本生成する。修正・削除は
1 本ずつになるのが弱点。

### 1.2 B(一括展開)を採った理由

1. **翌日以降の予定が最初から存在する**。薬剤部の払出(通常は前日)、看護のワーク
   シート、経過表の予定欄はどれも「明日以降に何があるか」を見る。A は実施するまで
   次の 1 本が生まれないので、これらが成り立たない(実施していないから展開されない、
   展開されていないから払い出せない、の循環になる)。
2. **1 施行 = 1 SR** なら、この後に足す Task(進捗・中止)・MedicationDispense(払出)・
   MedicationAdministration(実施)を処方と同じ 1 対 1 の構造で付けられ、`rxTaskHelpers` /
   `rxDispenseHelpers` を流用できる。A は「何日目の施行か」を全リソースに別途持たせる
   ことになる。
3. 上流の検索は `occurrence` / `authoredon` が **日時 1 点**にしか効かない(Period は
   索引されない)。「その日の注射」を部門が引く用途には、日ごとに SR がある方が素直。
4. 国内の電子カルテ・注射システムの慣行も「注射は日単位、期間指定は展開」で、
   帳票(注射箋)やレセ(注射は日ごとに算定)がその前提で組まれている。

B の弱点(修正・削除が 1 本ずつ)は、展開した SR を `requisition` で束ね、編集・削除に
**「この日のみ / この日以降すべて」の範囲選択**を付けて吸収した(§3)。

## 2. FHIR の構造(連日に関わる部分)

```
ServiceRequest(1 日分)
  authoredOn         = オーダー登録日時(全日で同じ値。全種別共通の意味、readme「オーダーの日付」)
  occurrenceDateTime = その日の注射日(日付のみ)
  requisition  = injection-series|<uuid>       ← 同時に展開した全日で同じ値
  extension[injection-series-start]    = valueDate 開始日
  extension[injection-series-schedule] = valueTiming 実施パターン(毎日のときは付けない)
  (category・orderDetail・MedicationRequest の持ち方は readme のとおり)
```

- `http://fhir-client.local/Identifier/injection-series`(requisition の system)
- `http://fhir-client.local/StructureDefinition/injection-series-start`(valueDate)
- `http://fhir-client.local/StructureDefinition/injection-series-schedule`(valueTiming)

**単日で登録したものも 1 日ぶんの束ねを持つ**(requisition と開始日を必ず付ける)。
後から「この日以降」の操作をするときに、束ねの有無で分岐しなくて済む。

**「何日目」は開始日との差から計算する**(`injectionSeriesDay`)。総日数は保存しない。
後続日を削除・変更すると総日数は変わるため、焼き付けると必ず古くなる。総日数が要る
画面(編集・削除の範囲選択)は後続日を検索して数える。

**開始日を拡張に持つ理由**: requisition だけでも束ねは分かるが、「連日 3 日目」を出すのに
毎回束ね全体を引くのは重い。開始日は展開後に変わらない(先頭日を消しても、残りの
オーダーの「開始日から N 日目」という意味は保たれる)ので焼き付けてよい。

### 2.1 実施パターン(毎日 / N 日ごと / 曜日指定)

期間は **注射日(開始日)〜終了日**で指定し、その中のどの日にオーダーを立てるかを
実施パターンで間引く(`injectionDates`)。

| パターン | 展開する日 | Timing.repeat |
|---|---|---|
| 毎日 | 期間の全日 | (拡張を付けない) |
| N 日ごと | 開始日を 1 回目として N 日おき(2 なら隔日) | `period: N, periodUnit: d` |
| 曜日指定 | 期間内でその曜日に当たる日 | `period: 1, periodUnit: wk, dayOfWeek: [...]` |

いずれも `repeat.boundsPeriod` に開始日と(実際に展開した)終了日を入れる。

- **毎日だけ拡張を付けない**。「拡張が無い = 毎日」と読めるので、この機能より前に
  登録されたオーダーもそのまま毎日として扱える(`scheduleFromTiming`)。
- **曜日指定では開始日にオーダーが立たないことがある**(開始日が対象曜日でないとき)。
  最初のオーダーは最初に曜日が当たる日になる。開始日は「期間の起点」であって
  「1 回目の施行日」ではない。
- `dayOfWeek` は FHIR の `days-of-week`(mon〜sun)をそのまま使う。看護指示の頻度
  (`nursingScheduleHelpers.ts`)と同じコード。

### 2.2 展開の上限

一度に展開できるのは **14 件**(`MAX_INJECTION_ORDERS`)、期間は **90 日**まで
(`MAX_INJECTION_SPAN_DAYS`)。曜日指定は間引かれるぶん長い期間を張れるので、
日数ではなく**件数**を上限にしている。上限を超える指定は**黙って打ち切らず**、
「N 件を超えます。期間を短くしてください」と入力を止める(意図より少ない日数で
登録されてしまうのを防ぐ)。

登録フォームには展開結果のプレビュー(「隔日: 2026-09-07 まで 4 件のオーダーを
登録します(8/30、9/1、9/3…)」)を出し、登録前に日付が見えるようにする。

### 2.3 保存は 1 transaction

全日を 1 つの transaction Bundle で POST する(`buildInjectionBundle`)。途中の日で
失敗したときに「3 日目まで登録済み」のような半端な状態を作らないため。

## 3. 編集・削除の範囲選択

後続日(同じ requisition で注射日 occurrence がその日より後)は
`useInjectionSeriesLater`(`api/queries.ts`)で引く。上流に `requisition` 検索が無いので、
`ServiceRequest?patient=&category=order-type|injection&authoredon=gt<日付>&_revinclude=MedicationRequest:based-on`
で引いてクライアントで requisition を突き合わせる(展開は 14 日までなので `_count=100`
で足りる)。

| 操作 | 後続日が無い | 後続日がある |
|---|---|---|
| 編集(`InjectionEditPanel`) | その日を更新 | 「この日のみ / この日以降すべて」を選ぶ |
| 削除(`InjectionDeleteModal`) | 削除確認 | 「この日のみ / この日以降 N 日分」を選ぶ |

「この日以降すべて」の編集は、編集中の日の内容を後続日に**注射日以外そのまま書き込む**
(`buildInjectionSeriesUpdateBundle`)。後続日の MedicationRequest は差し替え(編集中の日の
薬剤行 id は後続日には無いので新規作成し、元の行は DELETE)。一括更新も 1 transaction。

**過去日には遡らない**。今日以降を直す用途がほとんどで、実施済みの日を書き換える
のは実施記録との食い違いを生むため。前の日も直したいときは、その日を開いて「以降」を
選べば届く。

編集フォームでは期間・実施パターンを出さない(`mode="edit"`)。編集は常に 1 日分の
内容を直す操作で、期間を延ばす・パターンを変えるのは DO(流用)で新しく展開する
(既存の束ねの一部だけパターンを変えると、束ねに焼き付けた Timing と実際の日付が
食い違うため)。1 日分の更新では束ねの情報(requisition・開始日・パターン・期間)を
保存済みのものからそのまま書き戻す。

## 4. 画面

- 登録フォーム: 「注射日」の隣に「終了日」「実施パターン」(毎日 / N日ごと / 曜日指定)。
  N日ごとは間隔、曜日指定はチェックボックスが続けて出る。下に展開結果のプレビュー。
  注射日を後ろにずらすと終了日も連れて動く(期間が逆転したままにしない)。
- カルテのカード: メタ行に「連日 2日目(8/30〜)」。間引きのあるパターンでは回数が
  開始日からの日数と一致しないので「隔日(8/30〜)」「毎週 月・水(8/30〜)」と
  パターンだけを出す。毎日の 1 日目は単日の注射と見分けが付かないので出さない。
- 詳細モーダル: 注射日の横に同じラベル、「実施パターン」に期間付きで出す。
- DO(流用): 束ねは引き継がず(新しい requisition を採番)、単日・毎日で始める。

## 5. 進捗(Task)と中止

他部門と同じく、オーダーの `ServiceRequest` はそのままにして進捗を `Task` に持つ。

```
ServiceRequest(1 日分) ← focus ── Task(進捗)
  Task.code   = task-code|injection
  Task.status = requested / accepted / in-progress / completed / cancelled
```

| Task.status | 表示 | 意味 | 進める導線 |
|---|---|---|---|
| requested | 依頼済 | まだ誰も触っていない | (Task を作らない状態) |
| accepted | 受付済 | 薬剤部が受け取った | **未実装**(注射ワークリスト) |
| in-progress | 払出済 | 混注・払出が済んだ | **未実装**(払出登録) |
| completed | 実施済 | 施用した | **未実装**(実施入力) |
| cancelled | 中止 | 行わないことにした | カルテのカード → ケバブ「中止」 |

- **Task はオーダー登録時には作らない**。最初のステータス変更(いまは中止)で作り、
  それまでは「Task が無い = 依頼済」として扱う(この機能より前の注射もそのまま並ぶ)。
  実装は共通の `createTaskHelpers`(`fhir/taskHelpers.ts`)。
- **払出済を `completed` ではなく `in-progress` にする**のは、実施済(施用)を後から
  足すため。`preserveEnd: true` で、実施済へ進めても `executionPeriod.end`
  (薬剤部の手が離れた時刻)は動かさない(処方の調剤と同じ)。
- **`ServiceRequest.status` は動かさない**(検体検査・放射線検査・処方と同じ)。
  部門一覧が進捗で絞るときは上流の `_has:Task:focus:status` を使う。他科依頼だけが
  SR の status も動かすのは、日付軸を持たず status でしか絞れないため
  (docs/consult-order-design.md §4)。注射は日付軸があるので要らない。

### 5.1 中止は「この日のみ / この日以降すべて」

注射の中止は「明日からやめる」という形で起きるので、削除と同じ範囲選択にする
(`InjectionCancelModal`)。後続日は `useInjectionSeriesLater` が Task ごと返し、
選んだ日ぶんの Task を **1 つの transaction** で書く(途中の日だけ中止済み、という
半端な状態を作らない)。

- **実施済の注射は中止できない**(`canCancelInjection`)。中止は「これから行わない」
  という指示で、済んだ事実は消せない。訂正は実施記録側の取り消しで行う(未実装)。
- 中止を取り消すと **依頼済に戻る**(`canRestoreInjection`)。受付済・払出済には戻さない
  — 中止の連絡を受けた薬剤部がどこまで戻したかはこちらから決められないため。
- カルテからの中止をカードのケバブに置いたのは、注射ワークリスト(部門画面)がまだ
  無いため。部門画面ができたら、受付・払出・実施はそちらに置く。

### 5.2 表示

- カード: メタ行の先頭に進捗(`karte-card__status`)。中止だけ色を変える既存のスタイルに乗る。
- 詳細モーダル: 「進捗」の行。

## 5.3 注射一覧(部門ワークリスト)と払出

`/injection-worklist`(`pages/InjectionWorklistPage.tsx`)。作りは処方一覧(`RxWorklistPage`)と
同じで、注射日(`authoredon`)で 1 日ぶんを読み、入外区分・注射区分・病棟・診療科・進捗は
画面側で絞る。注射は 1 日 1 オーダーに展開済みなので、その日の施用ぶんがそのまま並ぶ。
連日オーダーは「連日 N日目」を添える(明日も同じものが出る、という段取りの手がかり)。

| 進捗 | 一覧の操作 |
|---|---|
| 依頼済 | 「注射箋発行」→ PDF を開くと同時に受付済(発行が受付を兼ねる。処方箋と同じ) |
| 受付済 | 「払出登録」→ 払出済(`InjectionDispenseModal`) |
| 払出済 | (カルテの実施入力で実施済へ) |
| ケバブ | 注射箋再発行 / 注射ラベル発行 / 受付取消 / 払出取消 / 中止 / 中止を取消 |

### 払出(MedicationDispense)

`fhir/injectionDispenseHelpers.ts`。処方の調剤(`rxDispenseHelpers`)と同じ考え方:
薬剤(`MedicationRequest`)1 件につき `MedicationDispense` 1 件、`authorizingPrescription` で
紐付け、銘柄を変えたら `substitution.wasSubstituted`、疑義照会は `Task.note`、
払出済の Task と 1 transaction。

処方と違うのは**数量の意味**。注射は 1 日 1 オーダーで RP の開始時刻の数だけ施用があるので、
払出数量の既定は「投与量 × その日の施用回数」(開始時刻が無ければ 1 回)。用法(経路・手技・
速度)は医師の指示なので払出では変えない(出すだけ)。混注の準備(ミキシング)そのものは
記録しない — 払い出した薬剤と数量が記録の対象で、誰がいつ混ぜたかは実施記録側の関心事。

払出取消は進捗を受付済に戻すだけで `MedicationDispense` は残す(処方の調剤取消と同じ。
払出結果の訂正・削除は別タスク)。

## 5.4 帳票(注射箋・注射ラベル)

処方箋(docs/prescription-report-design.md)と同じ基盤(ThinReports、同梱 `.tlf`、
`/reports/*` を Cookie セッションで GET)。プレースホルダーは docs/report-mappings/injection-01.md。

```
InjectionWorklistPage「注射箋発行」<a target="_blank">
  → GET /reports/injections/:order_id/pdf        → InjectionReport#generate_order
  → GET /reports/injection_labels/:order_id/pdf  → InjectionReport#generate_labels
      ① GET /ServiceRequest/{id}
      ② batch: ServiceRequest?_id&_revinclude=MedicationRequest:based-on / Patient / 自院 Organization
```

- **注射箋と注射指示票は 1 様式**(`injection_order.tlf`、A5、1 オーダー = 1 日分 = 1 枚)。
  どちらも「その日のこの患者の注射」の一覧で中身が同じ。薬剤部は払出の指示書として、
  病棟は下段の実施記録欄(時刻・実施者を手書き)を使って指示票として読む。様式を分けると
  同じ内容を 2 回刷ることになる。
- **注射ラベルは RP ごと 1 枚**(`injection_label.tlf`、60×40mm、検体ラベルと同じ用紙)。
  混注したボトル・シリンジに貼る単位が RP だから。ベッドサイドの本人確認に使うので
  漢字氏名も出し、バーコードは患者番号(ラベル番号の採番・台帳は持たない)。緊急の
  注射区分は「至急」を出す。
- **発行が受付を兼ねる**(処方箋と同じ)。PDF エンドポイントは Task に触らず、受付の遷移は
  frontend のリンクが行う。再発行はケバブ。ラベルは進捗を動かさず、どの進捗でも刷れる
  (混注の準備で払出の前に使う)。
- 連日オーダーは**その日の分だけ**を刷る(1 日 1 SR なので自然にそうなる)。用紙に
  「※連日オーダーはこの日の分のみ」と入れ、「連日 3日目(8/30〜)」を添える。
- 内容が枠を超えたら同じレイアウトで続紙(処方箋と同じ `lines_per_page` 方式)。

## 6. 実施記録(施用)

輸血(docs/transfusion-order-design.md)と同じ形。実施 1 回を `Procedure` のハブにし、
薬剤ごとの `MedicationAdministration` をぶら下げる(`fhir/injectionPerformHelpers.ts`)。

```
ServiceRequest(1 日分)
 └ basedOn ← Procedure (実施 1 回。施用のたびに 1 件)
      │  category        = order-type|injection(処置・手術・輸血の Procedure と振り分け)
      │  performedPeriod = 施用の開始/終了(ワンショットは開始だけ)
      │  performer       = 実施者(ログイン中の医療従事者)
      │  status          = completed(実施) / stopped(途中で中止) / not-done(実施せず)
      │  statusReason    = 中止・未実施の理由(text)
      └ partOf ← MedicationAdministration (薬剤 1 件ごと。実施せず のときは作らない)
           request = その薬剤の MedicationRequest
           status  = completed / stopped
           dosage  = 実施量 + オーダーから写した経路・部位・手技・速度
```

### 6.1 なぜ MedicationAdministration だけで持たないか

FHIR としては `request → MedicationRequest` を持つ `MedicationAdministration` だけで
足りる。それでも `Procedure` をハブに置くのは、このコードベースの実施記録がすべて
「Procedure(basedOn オーダー) + partOf の子」で揃っていて、カルテの読み出し
(`_revinclude=Procedure:based-on` → `_revinclude:iterate=MedicationAdministration:part-of`)
も実施取消もその形に乗っているため。注射だけ別の形にすると読み出しの経路が増える。
`request` は FHIR としての意味を保つために併記する(将来 MedicationAdministration を
薬剤単位で引く用途に使える)。

### 6.2 1 日に複数回の施用

RP の開始時刻が「10:00、20:30」のように複数あるので、ハブはオーダー 1 件に複数付く。
実施入力はそのたびに開き、カードには施用時刻の順に並ぶ。

**Task を実施済にするのは、「実施」または「途中で中止」の記録が予定回数
(RP の開始時刻の最大数。無ければ 1)に達したとき**(`buildInjectionPerformBundle`)。
「実施せず」は回数に数えない(その日の施用が済んだわけではない)。実施記録と Task は
1 transaction で書き、記録だけあって進捗が止まる状態を作らない。

### 6.3 入力

- 開始時刻の既定は「今」。オーダーの予定時刻にしないのは、実施入力は施用した直後に
  その場で入れる想定で、予定を既定にすると予定どおりでなかったときに直し忘れて予定が
  実績になるため。
- 薬剤の行はオーダーの薬剤を初期値にする。実施量は直せる、混注のうち一部を入れなかった
  なら「施用」を外す(オーダーの行は消せない — 施用しなかった記録として残す)。
- **オーダーに無い薬剤も RP ごとに追加できる**。注射は依頼時と実施時で内容が変わることが
  多い(側管からの追加、溶解液の変更、医師の口頭指示)ため、実施記録は「実際に入れたもの」を
  そのまま書けなければならない。追加した薬剤の `MedicationAdministration` は `request` を
  持たない(元になった `MedicationRequest` が無い)ので、カードでは「(追加)」と印を付け、
  **依頼と実施の差**が後から読めるようにする。追加した行は取り消せる(足したまま入力
  しなかった行を残さないため)。
- オーダー側は書き換えない。実施時の変更をオーダーに反映すると「何を依頼したか」が
  消えるので、差は実施記録側にだけ残す。
- 結果(実施 / 途中で中止 / 実施せず)は必ず選ぶ。実施 以外は理由が必須。

### 6.4 実施取消

そのオーダーの実施記録を**すべて消す**(輸血と同じ。放射線検査などが Task を戻すだけで
記録を残すのとは違う)。注射の実施記録は「この薬をこの量入れた」という事実の記録で、
取り消したのに残っているとその記録が嘘になる。実施済になっていた Task は依頼済に戻す
(払出済だったかは分からないので、いちばん手前に戻す)。

記録が複数あるとき 1 件だけ消す操作は持たない(取り消すのは誤登録で、誤登録なら
入れ直せばよい)。

## 7. ファイル

| 役割 | ファイル |
|---|---|
| FHIR 変換・束ね・展開 | `frontend/src/fhir/injectionHelpers.ts` |
| 後続日の検索・一括削除 | `frontend/src/api/queries.ts`(`useInjectionSeriesLater` / `useDeleteInjectionSeries`) |
| 登録・編集パネル(反映範囲) | `frontend/src/components/InjectionPanels.tsx` |
| 削除確認(範囲選択) | `frontend/src/components/InjectionDeleteModal.tsx` |
| フォーム(投与日数) | `frontend/src/components/InjectionForm.tsx` |
| 日付演算 | `frontend/src/lib/dates.ts`(`addDays` / `diffDays`) |
| 進捗 Task | `frontend/src/fhir/injectionTaskHelpers.ts` |
| 中止(範囲選択) | `frontend/src/components/InjectionCancelModal.tsx` |
| 進捗の書き込み | `frontend/src/api/queries.ts`(`useUpdateInjectionTaskStatus`) |
| 実施記録の FHIR 変換・表示 | `frontend/src/fhir/injectionPerformHelpers.ts` |
| 実施入力 | `frontend/src/components/InjectionPerformModal.tsx` |
| 実施登録・実施取消 | `frontend/src/api/queries.ts`(`useRegisterInjectionPerform` / `useCancelInjectionPerforms`) |
| 注射一覧 | `frontend/src/pages/InjectionWorklistPage.tsx`、`api/queries.ts`(`useInjectionWorklist`) |
| 払出 | `frontend/src/fhir/injectionDispenseHelpers.ts`、`components/InjectionDispenseModal.tsx` |
| 一覧の内容表示 | `frontend/src/components/InjectionOrderViewModal.tsx` |
| 帳票 | `backend/app/services/injection_report.rb`、`reports/injection_renderer.rb`、`reports/injection_label_renderer.rb`、`reports/injection_meta.rb`、`lib/report_layouts/injection_{order,label}.tlf` |

## 8. 未実装・今後

2026-09-01 に不足機能を洗い出して整理した。着手の推奨順は A → C-1 → B-1 → B-2/B-3 → C の訂正系。
オーダー種別をまたぐ課題は `docs/order-common-backlog.md` に分けてある(オーダー日と注射日を
`authoredOn` 1 つで兼ねていた件は 2026-09-01 に対応済み: authoredOn = 登録日時、occurrence = 注射日)。

### A. 安全性チェック(フォームに薬剤の警告が一切無い)

- **アレルギー照合**: 医薬品選択時に患者の `AllergyIntolerance`(`fhir/allergyHelpers.ts`)と
  突き合わせて RP 行に警告を出す。造影剤は `master_medicines.contrast_medium_category` でも拾える。
- **麻薬・向精神薬・毒薬・生物由来製剤の表示**: `master_medicines.narcotic_category` /
  `biological_product_flag` を持っているが未使用。RP 行にマークを付け、麻薬は注射箋にも印字する。
- **同日重複オーダーの警告**: 連日展開で同じ日に同じ薬剤が二重に立つのを登録前に検出する。
- **体重あたり用量の補助**: 直近の体重(`vitalHelpers.ts`)を参照して mg/kg を併記する
  (小児・抗がん剤・ヘパリン等)。

### B. 入力の効率化

- **注射セット(約束注射)**: 他部門にあるセット/テンプレート機構が注射には無い。RP 単位の
  定型(「生食 100mL + ○○」)を院内マスタに持ち、フォームから呼び出す。個人セットも同じ器で。
- **「◯回で終了」の回数指定**(いまは期間指定のみ)。`injectionDates` に停止条件を足せば済む。
- **既存の束ねへの日数追加(延長)**(いまは DO で新しい束ねを作る)。「この日以降すべて」の
  編集と同じ導線に「終了日を延ばす」を置く。
- **フォーム内から過去の注射を選んで DO**(いまはカードのケバブからのみ)。
- **主薬 / 溶解液・希釈液の区別**(JAHIS の混注区分に相当)。総投与量・ラベル・混注指示の
  読みやすさのため。

### C. 部門・病棟側の運用

- **看護ワークシートへの注射予定の表示**: `NursingWorklistPage` に注射への参照が無い。
  看護指示と同じ画面に当日の注射を開始時刻順に並べ、そこから実施入力へ飛べるようにする。
- **払出結果(MedicationDispense)の表示・訂正・削除**(いまは登録のみ。取消は進捗を戻すだけで
  MedicationDispense は残る)。
- **実施記録 1 件だけの取消・訂正**(いまは全件取消して入れ直す。1 日複数回施用で困る)。
- **実施記録の詳細モーダルへの表示**(いまはカードのみ。詳細は SR + MR + Task しか引いていない)。
- **持続点滴の速度変更・中断/再開の記録**: いまの実施記録は開始〜終了と実施量だけで、
  昇圧剤・インスリン等の途中の流量変更が残せない。`MedicationAdministration` を区間ごとに
  追加する形が素直。
- **注射箋の一括発行**(翌日分を病棟・注射区分でまとめて PDF 化)。
- **注射ラベルの薬剤欄は 3 行**(4 剤以上は切れる)。TPN など多剤の混注が増えたらラベルを
  大きくするか 2 枚に分ける。

### D. 表示・後片付け

- **連日オーダーを束ね単位で 1 枚のカードにまとめる表示**(いまは日ごとにカード。14 日展開で 14 枚)。
  日ごとに進捗・払出・実施が違うので、本体は開始日に置き、2 日目以降にはその日の状態だけを出す
  1 行の参照カードを残す形が現実的。登録日時は `authoredOn` に残るようになった(2026-09-01)ので、
  「オーダーした日に本体を置く」案も選べる。
- **経過表(フローシート)への注射欄**: `VitalFlowsheetPanel` はバイタルのみ。同じ時間軸に
  注射の予定・実施を並べる。
- **オーダーを削除しても進捗の Task が残る**(検体検査・放射線検査など既存の部門と同じ挙動)。
  中止してから削除する流れがある注射では起きやすいので、部門横断で片付けるときに直す。
