# 待合表示板(待合・診察進捗の表示板と待ち時間の実測)

`docs/functional-gap-backlog.md` §6.0 #18(2026-10-27 の追加候補)。
**状態: 実装済み(2026-10-28)。**
ロビーのモニターに、診察室ごとの「呼出中の番号・待ち人数・離席中の人数・本日の平均待ち時間」をログイン無しで出す。
受付のたびに当日の連番(受付番号)を振り、外来一覧の列と表示板の呼出番号にする。受付 → 診察開始の待ち時間は
データ抽出「入院・外来」の外来の列にして、内訳で平均・中央値を出せるようにする。

- **［事実］** = このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと

## 0. 前提(着手時に確認した範囲)

- 外来の受付は `Appointment.status = checked-in` と受付時刻の拡張 `appointment-checked-in-at`、診察は外来 Encounter
  (`class = AMB`、`in-progress` → `onleave`(一時終了)→ `finished`、`period.start / end`、`location[0]` に診察室)で記録済み。
  受付番号に当たるものは無かった(`Appointment.identifier` はレセコン連携の受付キーだけ)。
- ログイン無しで開ける画面は Web 問診の患者画面 `/q/<token>` だけ(`docs/web-intake-design.md` §3.1)。backend は
  `Intake::PublicController`(ヘッダのトークン、`rate_limit`)で、上流は `Integrations::FhirStore`(施設 1 本のトークン)で読む。
- データ抽出の外来の行は `Encounter` に受付(`Appointment`)を `_include` して組む(`fhir/encounterExtractHelpers.ts`)が、
  受付→開始の列は無かった。内訳は値の形で数値の列を判定する。

## 1. 方針

- **［設計］** 「呼び出し」の操作は新設しない。既存の**診察開始**(外来一覧・カルテ見出し)をそのまま呼出とみなし、
  診察中(`in-progress`)の受付の番号を表示板に出す。一時終了(`onleave`)は「離席中」、受付済で診察の無いものは「お待ちの方」。
- **［設計］** 待合表示板を使っている(有効なリンクがある)ときは、受付番号のある受付の診察開始で「呼出 / 呼出なし / 戻る」を確認する。
  「呼出なし」は外来 Encounter に拡張 `http://fhir-client.local/StructureDefinition/outpatient-board-call`(`valueBoolean` false)を付け、
  表示板はその診察の番号を「お呼び出し中」に出さない(待ちにも数えない。待ち時間の実測には入る)。拡張の無い診察は呼び出したものとして扱う。
- **［設計］** 診察開始とは別の呼出(来ない人の呼び直し、一時終了からの呼び戻し)はカルテの「患者呼出」で行う。予約の拡張
  `http://fhir-client.local/StructureDefinition/appointment-board-called-at`(`valueDateTime`、呼び直すたびに上書き)に時刻を書くだけで、
  状態は変えない。表示板は呼出から 10 分間(`CALL_DISPLAY_MINUTES`)その番号を「お呼び出し中」に出し、待ち・離席中からは外す。
  診察開始より前の呼出は数えない(診察開始の「呼出 / 呼出なし」に任せる)。診察終了・受付取消で消える。
- **［設計］** 区画は**診察室(Location、種別 `OF`)ごと**。診察が建っていればその `location[0]`、無ければ受付の診察室の participant。
  どちらも無い受付は**診療科**(受付の `specialty`、SS-MIX2)でまとめた区画に出す。
- **［設計］** 受付番号は **backend の日別カウンタ**(`reception_number_counters`)が払い出し、`Appointment.identifier`
  (system `http://fhir-client.local/identifier/reception-number`)に持つ。レセコン連携の受付はレセコンが日ごとに振る受付 ID
  (`Accept_Id`。受付キー「日付:ID」の ID、ゼロ埋め無し)を同じ system で添える(`ReceptionImporter`)。
  - 払い出したあと予約の書き込みが失敗した番号は欠番になる(番号に意味を持たせない)。受付取消で番号は外れ、受付し直すと次の番号が付く。
  - レセコン連携を使う施設で、カルテからも受付すると、レセコンの連番とこちらの連番が同じ日に重なり得る。
    受付はレセコンが正本(`docs/features/admin-integration.md`)なので、連携中はカルテから受付しない運用にする。
- **［設計］** 公開画面は**施設設定から発行したトークン付きリンク**(`/board/<token>`)で開く。表示板に患者を特定できるもの
  (患者番号・氏名)は出さず、応答にも入れない(患者の `_include` もしない)。
- 採らなかった案: 上流 `$next-identifier` で採番(`(型, system)` ごとに Postgres シーケンスを作るので、日ごとの system にすると
  上流にシーケンスが増え続ける)。トークン無しの固定 URL(本番は Render で公開されるので不可)。

## 2. backend

### 2.1 テーブル(`db/migrate/20261028090000_create_waiting_board.rb`)

```text
waiting_board_links        token_digest(unique) / token_salt / label / location_ids(jsonb、空なら全診察室) / created_by_id / created_by_name / revoked_at
reception_number_counters  day(date、unique) / last_number
```

- トークンはリンクごとの `token_salt` と `secret_key_base` の HMAC-SHA256(`WaitingBoardLink.token_for`)。DB には salt と SHA-256 だけを持ち、
  施設設定から表示板を開くときにサーバーが起こし直す(DB だけが漏れてもトークンは分からない)。`secret_key_base` を替えると
  起こし直したトークンが digest と合わなくなり、そのリンクは開けなくなる(発行し直す)。salt を持たない
  `20261029090000` より前のリンクも同じ。有効期限は無く、取り消すまで使える。
- `ReceptionNumberCounter.next!(day)` は日の行を `create_or_find_by!` → `lock!` → `increment!` で進める(受付の端末が複数でも同じ番号を配らない)。
  一意性は DB の unique index に任せる(モデルの uniqueness 検証を付けると `create_or_find_by!` が index の違反まで届かない)。

### 2.2 エンドポイント(新しいトップレベル `/waiting_board/*`。`vite.config.ts` と `render.yaml` の rewrite に追加済み)

- 職員用(`WaitingBoard::StaffController`、`UserAuthentication`):
  - `POST /waiting_board/links` `{label, location_ids}` → `{id, label, location_ids, created_at, created_by_name, path: "/board/<token>"}`。
  - `GET /waiting_board/links` → `{items: [...]}`(有効なものだけ。`path` は起こし直したもの、起こし直せなければ null)。
  - `DELETE /waiting_board/links/:id` → 204(取消)。
  - `POST /waiting_board/reception_numbers` `{day}` → `{day, number}`。day は frontend の `today()`(無ければ `FacilityClock.today`)。
- 公開(`WaitingBoard::PublicController`、ログイン無し、ヘッダ `X-Board-Token`、IP ごとに 30 回/分):
  - `GET /waiting_board/public` → `WaitingBoard::Snapshot`(§2.3)。トークンが無い・違う・取消済みは 401、上流に届かなければ 502。

### 2.3 `WaitingBoard::Snapshot`

- 上流を `Appointment?date=<今日>&status=checked-in,fulfilled&_revinclude=Encounter:appointment&_count=500` と
  `Location?type=OF&status=active` で読む(`Integrations::FhirStore`、strict)。検査予約(`basedOn` あり)は落とす。
- 予約ごとの診察は `entered-in-error` を除き `period.start` → `meta.lastUpdated` の新しいもの(frontend の `latestExamByAppointment` と同じ)。
- 応答:
  ```json
  { "generated_at": "...",
    "rooms": [{ "id", "name", "calling": "12", "waiting": 2,
                "waiting_list": [{ "number": "14", "booked_time": "09:30", "checked_in_time": "09:12" },
                                 { "number": "15", "booked_time": null, "checked_in_time": "09:20" }],
                "away": 1, "average_wait_minutes": 18 }],
    "departments": [{ "code": "01", "name": "内科", "calling": null, "waiting": 0, "waiting_list": [], "away": 0, "average_wait_minutes": null }] }
  ```
  - `calling` = 区画に 1 人。呼出中の受付(`in-progress` で呼出なしでないもの、「患者呼出」から 10 分以内のもの)のうち、
    最後に呼んだ受付(診察の `period.start` と呼出時刻の新しい方)の番号。無ければ null。前の人は次を呼んだ時点で消える。
    `waiting` = 受付済で診察無し、`away` = `onleave`(どちらも呼出中のものは除く)。
  - `waiting_list` = 待っている受付の受付番号・予約時間・受付時刻(日本時間の「HH:mm」)。当日受付は `start` が受付時刻から起こした
    名目の時間なので `booked_time` は null。並びは外来一覧と同じ `start` の順。番号の無い受付は `number` が null。
  - `average_wait_minutes` = その日の受付のうち受付時刻と診察の `period.start` が両方あるものの (開始 − 受付) の平均(分)。無ければ null。
  - 診察室の並びは `location-display-order` の拡張 → 名前。リンクに `location_ids` があればその診察室だけで、`departments` は空。

## 3. frontend

### 3.1 表示板 `/board/:token`(`pages/WaitingBoardPage.tsx`)

- `App.tsx` で `pathname` が `/board/` で始まるときは `<AuthGate>` の外で `WaitingBoardPage` だけを描く(Web 問診の患者画面と同じ)。
  API は `api/waitingBoardPublicClient.ts` の素の `fetch`(`credentials: "omit"`)。
- 30 秒ごとに読み直す(`refetchInterval`)。読み直しに失敗しても直前の値を残し、時計の横に「更新できていません」を出す。
  401 は「この表示板のリンクは無効です。」。受付が無ければ「本日の受付はありません。」。
- 区画はカードのグリッド(`.waiting-board__*`、テーマ変数のみ)。呼出中の番号(1 人)を大きく、「お待ちの方 n 人」とその下に待っている受付の表
  (受付番号・予約時間(当日受付は「当日」)・受付時刻。10 行まで、超えたぶんは「ほか n 人」)、「検査などで離席中 n 人」
  (0 人なら出さない)「本日の平均待ち時間 約 n 分」(実測が無ければ出さない)。患者が自分の順番の目安を掴めるように番号と時刻だけを出す。
- 上流は検索のたびに監査ログを書くので、表示板を置く端末は絞る(読み直しは 30 秒ごと、1 本の検索 + 診察室の検索)。

### 3.2 職員側

- **施設設定「待合表示板」**(`components/WaitingBoardLinksSection.tsx`): 発行済みリンクの表(名前・診察室・発行日時と発行者・「表示」・削除 = 取消)と、
  名前・診察室のチェック(空なら全部)・「発行」。「表示」は一覧の `path` を別タブで開く(`path` が null なら押せない)。
  発行すると URL(コピー)と QR(`qrcode`)を出す(次の発行や画面を離れると消える)。施設設定のフォームの中なのでボタンはすべて `type="button"`。
- **外来一覧**: 「受付番号」列(受付時間の右の固定列)。受付(`useUpdateAppointmentStatus` の `checked-in`)と当日受付・新患登録(`useWalkInCheckIn`)で
  `POST /waiting_board/reception_numbers` を呼んでから `withReceptionNumber` で書く。レセコン連携の受付(識別子あり)は採番しない。
  受付取消で番号を外す。
- **診察開始の呼出の確認**(`components/ExamStartCallModal.tsx`): 外来一覧(行・患者ドロワー)とカルテ見出しの「診察開始」で、
  待合表示板を使っていて(`useWaitingBoardInUse`)受付番号のある受付だけに出す。「受付番号 n ○○ さんを呼び出しますか?」に
  「呼出」「呼出なし」「戻る」。表示板を使っていない施設・番号の無い受付は、これまでどおり 1 クリックで始まる。
- **患者呼出**(`components/PatientCallModal.tsx`): カルテ右のボタン列の 1 項目(`karteMenu.ts` の `action` 項目。「共通」の最後で、頻用にも選べる)。
  待合表示板を使っている施設だけに出し、今日の受付(診察中・一時終了を含む)に受付番号が無ければ押せない。
  「受付番号 n ○○ さんを呼び出しますか?」に「呼出」「戻る」。`useCallOutpatient` が予約に呼出時刻を書く。
- **データ抽出**: 外来の行に「待ち時間(分)」(受付時刻 → 診察の `period.start`)。内訳で診療科別・月別の平均・中央値が出せる。

## 4. 先送り

- 放射線など部門の受付待ち(`rad-backlog.md` E-6)。部門に「撮影中」の状態が無いので、要るときに状態を足してから同じ画面に区画を増やす。
- 番号札の印刷(`print-backlog.md` の一覧印刷の基盤に載せる)、音声・チャイムでの呼び出し、呼出中の番号の履歴(呼んだが来ない人)。
- 表示板のテーマ(ロビーのモニターは明るい地が読みやすいことが多い。いまはブラウザのテーマ設定に従う)。
