# 研修医のカウンターサインの設計

研修医・学生が書いた診療記録とオーダーを、指導医が後から承認(カウンターサイン)・差戻し・コメントする。
臨床研修病院の運用(研修医の記載は指導医が確認する)と、`functional.xlsx` の「カルテ承認一覧」「カルテ内容確認画面」
「コメント入力画面」「承認要否設定」「指導医グループ」に当たる。承認は**事後**で、承認前でも記録は読め、
オーダーは部門へ流れる(代行入力の承認と同じ方針。`docs/order-common-backlog.md` §2.5)。

## 1. 誰が研修医か・誰が承認できるか

- **研修区分**は `Practitioner` のローカル拡張 `http://fhir-client.local/StructureDefinition/trainee-level`
  (`valueCode` = `resident` 研修医 / `student` 学生)。医療従事者の登録・編集の「研修区分」で付ける。
  職種は医師のまま(研修医を職種にすると `isDoctorRoleCode` から外れ、オーダーが代行入力の経路になる)。
  学生は職種を医師にしないので、オーダーは代行入力の経路(指示医師を選ぶ)。
- **指導医グループ**は backend の `supervisor_groups`(名称・備考)と `supervisor_group_members`
  (`practitioner_fhir_id`・保存時の表示名・`role` = `supervisor` / `trainee`)。1 人が複数のグループに
  いてよい。上流 FHIR の `Group` は使わない(proxy の許可リストを広げず、運用データは backend に寄せる)。
- `GET /master/supervisor_groups/mine` が、ログイン中の人から見た `supervisors`(研修医として仰ぐ指導医)と
  `trainees`(指導医として受け持つ研修医)をグループをまたいで重複なく返す。セッションに医療従事者が無い経路
  (認証なし・ヘッダ認証)では `practitioner_id` で本人を受け取る。
- 画面側は `useCountersignContext()`(`api/queries/countersign.ts`)にまとめる。`enterer`(来歴・通知に名乗る本人。
  研修区分と指導医を添える)、`trainees`(受け持つ研修医の id の Set)。`useOrderEnterer` はこれを返す。

## 2. 診療記録

看護サマリーの承認(`docs/nursing-care-plan-design.md`)と同じ `Composition.attester` の器。

| 状態 | Composition |
|---|---|
| 作成中 | `preliminary` |
| 差戻し | `preliminary` で、未対応の差戻しの通知がある(Composition だけでは作成中と区別しない) |
| 承認待ち | `final` / `amended` + `attester(legal = 研修医)`、`professional` が無い |
| 承認済 | `attester(professional = 指導医)` を足す |

- 対象かどうかは `Composition.category` の印 `clinical-note-category|countersign`
  (`COUNTERSIGN_CATEGORY`)。研修医が新規に書くときに付け、編集では引き継ぐ。書いた時点の区分なので、
  後から研修を終えてもその記録は承認が要る記録のまま。
- 研修医が確定し直すと `buildAttester` が `legal` だけを作り直すので `professional` が落ち、また承認待ちになる。
  指導医が研修医の記録を直して保存すると(修正承認)、保存した内容に `professional` を足して承認済みにする。
  研修医でも指導医でもない人の編集は印も状態も変えない(前の承認待ちの通知が残る)。
- タイムラインのカードのバッジ(承認待ち・承認済)は Composition だけで決める(`countersignBadgeOf`)。
  差戻しは詳細でだけ分かる(通知を引き直さないため)。

## 3. オーダー

代行入力の承認(`Provenance`)に乗せる。

- 研修医が**自分を指示医師として**入れた活動は、来歴の `agent(author)` に `role`
  (`http://fhir-client.local/CodeSystem/trainee-level`)を付ける(`provenanceEntry`)。入力者 ≠ 指示医師
  (代行入力)のときは付けない(それは代行の承認)。
- `needsApproval` = 「代行か研修医」で未承認。`summarizeOrderProvenance` は `traineeAuthor` を返し、
  `useCanApproveOrder` は研修医の活動なら本人以外の受け持つ指導医、代行なら author 本人だけを通す。
- 承認は従来の `approvalTransactionEntries`。来歴に `verifier` と署名を足し、通知は自分あてを対応済みに、
  他の指導医あてを取り下げる。

## 4. 通知(Task)

| 種別 | 焦点 | 宛先 | 閉じ方 |
|---|---|---|---|
| `note-countersign` カルテ承認 | `Composition` | 指導医ごとに 1 件 | 承認・差戻しで自分あては completed、残りは cancelled |
| `note-returned` カルテ差戻し | `Composition` | 記録した研修医 | 確定し直すと completed(通知からも手で閉じられる) |
| `order-approval` オーダー承認 | `Provenance` | 研修医の活動は指導医ごとに 1 件 | 同上 |

- 1 通知 = 1 宛先の作法(readme「通知(Task)」)を守り、グループの Task は作らない。こうすると既存の
  「自分あて」の絞り込みと `canAct`(宛先 = 自分)がそのまま使える。
- 新規の記録の承認待ちは、記録の POST と同じ transaction で `focus` を `urn:uuid` で指す
  (`saveClinicalNote` → `saveWithImages` → `resourceWithImagesBundle` に `fullUrl` を通した)。
- 研修医が承認待ちの記録を確定し直したときは、前の承認待ちを取り下げて出し直す(同じ指導医に二重に並べない)。
- 指導医が 1 人も登録されていなければ通知は作らない。承認は記録・オーダーの詳細からできる。

## 5. コメント

- 指導医のコメントは承認待ちの通知(`Task.note`)に積む。対応の記録(`buildCompletedNotificationTask` が書く
  `note`)と見分けるため、コメントには拡張 `task-note-comment` を付ける。閉じるときもコメントは残す
  (`closeNoteCountersignEntries`)。
- 積む先は自分あての承認待ちの Task。閉じていれば最後に自分あてだったもの。自分あてが無ければ書けない。
- 記録の詳細は、その記録を `focus` にする通知を状態を問わず全部引き(`fetchNoteTasks`)、コメントを時刻順に並べる。
  自分のコメントは直せる・消せる(Task の PUT。読んだ版を `postBundle` が `ifMatch` に添える)。
- 別の Task を立てない。コメントは承認待ちに付随する指導で、単独で誰かに届けるものではない。

## 6. 画面

- 記録の詳細(`ClinicalNoteDetailPanel`)の「カウンターサイン」欄(`NoteCountersignPanel`)。状態・承認者・
  差戻し理由・コメント歴。受け持つ指導医には承認・差戻し(理由のモーダル)・コメント。
- 診療業務 > カルテ承認(`/countersigns`、`CountersignListPage`)。自分あての `note-countersign` と研修医の
  `order-approval` を未承認・承認済みで引き(`useMyCountersignTasks`)、種別・研修医で絞る。記録は「開く」で
  その場のモーダルに詳細を出し、承認・差戻し・コメントはそこで行う。オーダーは「カルテ」で詳細モーダルへ。
- 通知(`/notifications`)の種別「カルテ承認」「カルテ差戻し」(レジストリに 2 要素)。承認は一覧からもできる。
- マスタメンテ > 共通 > 指導医グループ(`/supervisor-groups`、`SupervisorGroupPage`)。

## 7. 決めなかったこと

- 事前承認(承認されるまでオーダーを無効にする)は採らない。緊急オーダーが止まるため。
- オーダーの差戻しは無い(オーダーは編集・中止で直す)。
- 研修医でも指導医でもない人が研修医の記録を編集したときの承認待ちの出し直しは、その人が研修医の指導医を
  知らないので行わない。
