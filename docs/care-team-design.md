# チーム医療(チーム依頼・回診記録・スクリーニング)と褥瘡の DESIGN-R・発生率

`functional.xlsx` の「チーム医療」(`docs/functional-gap-backlog.md` §1 #13、§2.5 褥瘡、§2.7 チーム医療)。
**状態: 実装済(2026-10-10)。** NST・ICT・褥瘡対策・緩和ケアなどのチームへの介入依頼、チーム単位のワークリスト、
回診記録、スクリーニング(チームの保存条件)、チームとメンバーのマスタ、褥瘡の DESIGN-R 評価と発生率。

- **［事実］** = 通知・FHIR 仕様、このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 1. チーム = 上流の `CareTeam`

- **［事実］** 上流(fhir-server)に CareTeam は無かった。`ServiceRequest.performer` と `Task.owner` の検索は参照文字列の
  一致なので、`performer=CareTeam/{id}` はそのまま効く。型の登録は Flag(JP Core がプロファイルしない型)と同じ手順。
- **［設計］** 上流に `CareTeam` を追加した(2026-10-10)。検索は identifier / status / category / name(string)/
  participant(participant[].member)/ subject(patient の別名)/ encounter / managing-organization / date。
  `ServiceRequest:performer`・`Task:owner` の `_include` の対象に CareTeam を足し、`CareTeam:participant`・`CareTeam:subject`
  を include の許可リストに入れた。組織的なチームは `subject` を持たず、患者コンパートメントには入らない。
- **［設計］** チームの持ち方(`fhir/careTeamHelpers.ts`):

```text
CareTeam
  status      = active / inactive
  category[0] = http://fhir-client.local/CodeSystem/care-team-kind | nst / ict / pressure-ulcer / palliative / dementia / rst / other
  name
  managingOrganization[0] = 自院 Organization
  participant[] { role[0] = http://fhir-client.local/CodeSystem/care-team-role | lead / member, member = Practitioner(display に氏名) }
  extension[care-team-round-template] = valueCanonical(回診記録に挿入する既定テンプレート。任意)
```

- **［設計］** `db/seeds.rb` が `db/seed_data/care_teams.json` の 3 チーム(nst / pressure-ulcer / ast)を上流に POST する。
  同じ category のチームがあれば飛ばす。participant は環境ごとの Practitioner を指すので持たせず、managingOrganization は
  自院が設定済みのときだけ付ける。
- **［設計］** マスタ画面はマスタメンテ > 共通 >「チーム医療」(`/care-teams`、`pages/CareTeamPage.tsx`)。指導医グループと
  同じ作りで、メンバーの追加・役割の変更・削除は CareTeam の PUT(読んだ版を If-Match に添える)。
- 採らなかった案: 診療科と同じ Organization(type=team)+ PractitionerRole。診療科・連携先の一覧は `partof` の有無で見分けて
  いるので、チームが混ざるのを防ぐために多くの検索を直すことになる。backend の `care_teams` テーブルは上流の変更が
  要らないが、依頼の宛先が論理参照になり、上流で絞れない。

## 2. チーム依頼 = オーダー種別 `team-request`

他科依頼(`docs/consult-order-design.md`)の構造を写した「明細を持たないヘッダ 1 本」。`fhir/orderKinds.ts` に 1 行足し、
対応表(`orderKindRegistry` / `KarteCardModals` / `KarteRightPane`)を埋めた。

```text
ServiceRequest (category: order-type|team-request)
  status      = active(依頼済・介入中) / completed(終了) / revoked(却下)   ← Task と同じ transaction で動かす
  code        = care-team-kind(チームの区分。一覧の絞り込み用)
  priority(routine / urgent), occurrenceDateTime(希望日。必須、既定は今日), reasonCode[0].text(依頼目的),
  note[0].text(補足), reasonReference(対象プロブレム)
  performer[0] = CareTeam/{id}(display にチーム名)
  requester / order-department / order-ward = 依頼元(applyOrderContext)
  extension[team-request-purpose-questionnaire-response] = 依頼目的をテンプレートから書いた記入内容
  extension[team-request-next-round]      = valueDate(次回回診日)
  extension[team-request-last-round]      = valueReference(最後の回診記録 Composition。表示用のキャッシュ)
  extension[team-request-last-round-date] = valueDate(最後の回診の日)
  ←focus── Task (task-code|team-request)  requested(依頼済) → accepted(介入中) → completed(終了) / cancelled(却下)
            却下の理由は Task.statusReason.text。executionPeriod は受付で start、終了で end
```

- **［設計］** 他科依頼との違いは「回答で完了しない」こと。回診記録は何度書いても介入中のままで、終了はチームが明示する。
  依頼済のまま回診記録を書くと介入中になる(回診したということは受けたということ)。
- **［設計］** 書き込みの入口は `api/queries/teamRequest.ts` の `useUpdateTeamRequestTaskStatus`・`useSaveTeamRound`・
  `useSetTeamRequestNextRound` だけ(Task と status が食い違わないように)。
- **［設計］** 受付済・終了した依頼は削除できない(`deleteTeamRequestRequest`)。先に受付取消・終了取消を行う。
- **［設計］** カルテの右ペイン「チーム依頼」(他科依頼の隣)。カードの見出しは入外区分 | チーム名(至急)、メタに最終回診・次回回診日、
  ケバブに「回診記録表示」(最後の記録を診療記録として開く)。`?open=team-request:<CareTeam id>` で宛先を選択済みで登録を開ける
  (スクリーニング一覧・褥瘡管理から。`karteUrl.ts` の `KarteOpenTarget`)。
- **［設計］** 依頼目的のテンプレート記入は他科依頼と同じ(回答を同じ transaction に載せ、解除・削除で孤児を残さない)。
  チームごとの既定テンプレートは持たない(依頼目的はチームを問わず書く内容が近い)。

## 3. 回診記録 = 診療記録

- **［設計］** 回診記録は経過記録(LOINC 11506-3)のまま、`category` に `clinical-note-category|team-round`、`event[0].detail` に
  依頼(`event.code` = `consult-note-event|round`)を持つ(`buildClinicalNote` の `teamRequestId`)。SOAP・自由記載・テンプレート挿入・
  シェーマがそのまま使え、タイムラインにも出る(`KARTE_NOTE_TYPE_SEARCH` は変えない)。タイトルの既定は「{チーム名} 回診記録」。
  チームに既定テンプレートがあれば、テンプレートの記載形式でそのテンプレートを選択済みで開く。
- **［設計］** 入口はチーム依頼一覧の行のモーダル(`components/TeamRoundModal.tsx`。上に依頼内容とこれまでの回診記録、
  次回回診日、下に診療記録フォーム)。保存は 1 つの transaction で「診療記録 + 依頼側の最後の回診・次回回診日(+ 依頼済なら Task を
  介入中)」を書く。
- **［事実］** 上流は `Composition.event` を索引していない。依頼の回診記録の一覧は、患者の回診記録
  (`Composition?patient=&category=…|team-round`)を引いて `event.detail` で絞る(患者 1 人ぶんなので有限)。
  `docs/server-improvement-backlog.md` C-21。

## 4. チーム依頼一覧(`/team-worklist`、「診療業務」メニュー)

- **［設計］** 他科依頼一覧を写し、タブは「介入中」(`status=active,revoked`。依頼済・介入中・却下)と「終了」(`status=completed`)。
  チームは `performer=CareTeam/{id}` で上流が絞り、既定は自分がメンバーのチームの先頭(`useMyCareTeams`。
  `CareTeam?participant=Practitioner/{me}`)。他の絞り込み(入外・病棟・依頼元の科・ステータス・至急・回診予定)は画面側。
- **［設計］** 列: 患者、依頼日(至急)、チーム、依頼目的、入外、病棟、依頼科 | 依頼医師、最終回診、次回回診(今日以前は赤)、ステータス
  (却下は理由を吹き出し)。操作: 受付 / 終了 / 回診記録 / 表示。ケバブ: 次回回診日・受付取消・却下(理由必須)・終了取消・却下戻し。
- 通知 Task は作らない(宛先が Practitioner 1 人に固定で、チームあてにできない。§8)。一覧が受信箱。

## 5. スクリーニング = データ抽出の保存条件の持ち主「チーム」

- **［設計］** 保存条件の持ち主に `team`(CareTeam の id)を足した(`ChartDefinition::SCOPES`。`ExtractQuery` が共有し、
  `PatientFolder`・`OrderSet` は据え置き)。`roots_for(team_ids:)` と一覧の `team_id`(カンマ区切り)で、自分のチームの条件を
  院内共通・診療科・自分と並べて引く。チームの条件はメンバーなら誰でも書ける(画面で判定。backend が守るのは自分の条件だけ)。
- **［設計］** `hooks/useDefinitionOwners.ts` が自分のチームを持ち主の選択肢に並べ(チャート定義にも出る)、`ExtractQuerySelect` は
  チームの条件を「スクリーニング: {チーム名}」の見出しにまとめる。条件の持ち主がチームのとき、抽出結果に「介入」の列を足す
  (`ServiceRequest?category=order-type|team-request&performer=CareTeam/x&status=active` の患者は「介入中」、それ以外は
  「チーム依頼」のリンク = カルテを `open=team-request:{teamId}` で開く)。
- 同梱の院内共通プリセットは足さない(チームの条件はチームの持ち物)。NST なら「直近 30 日の入院 かつ Alb 3.0 未満」のように
  検査結果の条件で組む。
- **［事実］** 患者属性の条件(年齢・性別)は上流の `Patient?active:not=false` が strict で弾かれる(2026-10-10 に開発環境で確認。
  `docs/server-improvement-backlog.md` C-22)。入院・病名・検査結果の条件は使える。

## 6. 褥瘡の DESIGN-R 評価と発生率

- **［設計］** 評価はテンプレート(看護プロファイルと同じ考え方)。同梱の `PU_DESIGNR_01`
  (`docs/report-mappings/pressure-ulcer-designr-01.questionnaire.json`、カテゴリ「褥瘡」)は **1 創 1 回答**で、評価のたびに新しい
  回答を書く(前回値複写が使える)。項目: 部位(選択肢 + その他の名称)、発生区分(持込 / 院内発生)、発生日、状態(継続 / 治癒)、
  治癒日、DESIGN-R 2020 の 7 項目(選択肢のコードは記号そのもの: d0・d1・d2・D3・D4・D5・DDTI・DU / e0・e1・e3・E6 /
  s0・s3・s6・s8・s9・s12・S15 / i0・i1・I3C・I3・I9 / g0・g1・g3・G4・G5・G6 / n0・N3・N6 / p0・P6・P9・P12・P24)、
  合計(深さを除く 0〜66 点。計算式 `%designrTotal` = コードの数字部分の和)、重症度(大文字の項目が 1 つでもあれば「重症」)、
  所見・処置。回答から Observation を生成する(`NURS-PU-DESIGNR-TOTAL` ほか)。
- **［事実］** 計算式の fhirpath は `answer.value.select(code.replaceMatches('[^0-9]', '').toInteger()).sum()` の形にする。
  `answer.value.code.replaceMatches(...)` は複数回答で「singleton を期待」のエラーになる(fhirpath.js 5.0)。
- **［設計］** チャート定義プリセット「褥瘡(DESIGN-R)」(院内共通。migration `20261010200000` で投入): 合計の折れ線と 7 項目の
  選択肢の行(記号の順 = 重さ)、体重。複数の創があると同じ行に混ざる(創ごとの経過は褥瘡管理の一覧で見る)。
- **［設計］** 施設設定 `pressure_ulcer.template`(DESIGN-R のテンプレートの url。版を問わない。既定は同梱の url)。
  褥瘡管理はこのテンプレートの回答から数える。施設が複製して項目を直すときも linkId(`pu_site` / `pu_onset_kind` / `pu_onset_date` /
  `pu_state` / `pu_healed_date` / `designr_*`)は変えない。
- **［設計］** 褥瘡管理(`/pressure-ulcer`、「看護業務」メニュー。`pages/PressureUlcerPage.tsx`):
  - 保有患者: 病棟 × 日。その日に病棟に居た患者の回答(`subject=` 100 人ずつ、全版の canonical)を創(患者 × 部位)ごとに最新を取り、
    治癒していない創を並べる。最終評価から 7 日以上は赤。行の「経過」は創(患者 × 部位)の評価を古い順に
    (`woundEvaluations`、`components/PressureUlcerHistoryModal.tsx`): 合計の推移(`LabTimelineChart`)と、評価日を列・項目を行にした表
    (検査結果の時系列と同じ向き)。経過は一覧で読んだ回答(その日までに記入したもの)から作り、別に引き直さない。行の「評価」(テンプレートの登録パネルを DESIGN-R 選択済みで)と
    「チーム依頼」(褥瘡対策(区分 pressure-ulcer)のチームが 1 つあるとき、そのチームを選択済みで)は、カルテへ移らずに
    この画面のモーダルで書く(右ペインと同じ登録パネルを Modal に入れる。表はフォームの外なので入れ子にならない)。
  - 発生率: 病棟 × 月。日本褥瘡学会の定義に合わせ、**褥瘡発生率** = 院内で新たに発生した患者数(発生区分 = 院内発生、発生日が
    その月。d2 以上の内数も)÷ 在院患者数(実人数)、**褥瘡有病率** = 月末(今日より先なら今日)に保有する患者数 ÷ 月末の在院患者数。
    持込は発生区分 = 持込で月初に保有していた患者。発生日が無ければ最初の評価日、治癒日が無ければ治癒と評価した日で区切る。
- **［要確認］** DESIGN-R の記号・点数は日本褥瘡学会の DESIGN-R 2020 の公表資料に沿う。褥瘡対策に関する診療計画書・
  褥瘡ハイリスク患者ケア計画書の様式は持たない(看護プロファイルの「褥瘡リスク」と看護計画で代える)。

## 7. 上流

- `CareTeam`(§1)。`ServiceRequest:performer`・`Task:owner` の include 対象に CareTeam。
- 足りないもの: `Composition.event.detail` の検索(C-21)、CareTeam の連鎖検索(`performer:CareTeam.name`)、
  `Patient?active:not`(C-22)。

## 8. 申し送り

- 通知 Task の宛先は Practitioner 1 人に固定(`notificationParams`)。チームあての通知(新しい依頼・次回回診日の期限)を出すなら、
  メンバーごとに Task を作るか、owner に CareTeam を許してベルの検索を変える。
- 回診記録の一覧は患者の記録を引いて手元で絞る。依頼の数が多い患者でも有限だが、上流に event の検索が付けば置き換える。
- 創ごとのチャートは持たない(テンプレートの回答を Observation にしているので、部位で分けられない)。創ごとに追うなら
  創 = Condition(bodySite)+ Observation の構造化に進む。
- DPC 様式1 の褥瘡の項目(A001040。入院時・退院時の DESIGN-R)は手入力のまま。DESIGN-R の回答から写す導線は未対応。
- チーム依頼のオーダーセット(`orderSetRegistry`)・データ抽出の部門オーダーの種別には足していない。
