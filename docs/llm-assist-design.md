# LLM による記録支援(経過の要約・サマリーの下書き)

`docs/functional-gap-backlog.md` §4 の「記録の効率」(2026-10-16 の追加候補)。
**状態: 設計のみ(2026-10-16)。実装は未着手。**
入院期間の記録・オーダー・結果から、退院時サマリー・看護サマリーの本文の下書きと、カルテを開いたときの「これまで」の要約を
LLM(Claude API)で生成する。**生成文は下書きで、必ず人が編集・確定する。**

- **［事実］** = API、このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 現状(実装済みの範囲)

- 外部 API の呼び出しはすべて Faraday。日レセの `Integrations::Orca::Gateway` は open_timeout 3 秒・timeout 60 秒、
  502 / 503 / 504 を 0.5 / 1.5 / 3 秒で再送する。例外は `Integrations::Error / NotConfigured / Unreachable / Rejected / NotFound`
  (`backend/app/services/integrations.rb`)で、コントローラが `rescue_from` で 503 / 502 / 404 と `{error}` に写す。
- 秘密情報は `ExternalSystemConnection`(`encrypts :password, :inbound_token`、空なら環境変数 `<KEY>_PASSWORD` などで補う)。
  システムの宣言は `Integrations::ExternalSystems::DEFINITIONS` に 1 要素足すと管理画面「外部システム連携」に出る。
  `usable?` は `connection` 区画があると base_url・username・password の 3 つを要求する。
- 記録は `Integrations::EventLog`(JSON Lines、電文の本文は `INTEGRATION_LOG_BODIES=true` のときだけ)。
- 施設設定(`facility_settings`)はログイン済みの全員が読めるので秘密は置けない。
- 退院時サマリーは `DischargeSummarySources`(`fhir/dischargeSummaryHelpers.ts`)を `useDischargeSummarySources` が集め、
  `draftDischargeSummaryForm` が **空の text セクションにだけ**箇条書きを入れる。「再収集」で候補だけ集め直す。
  入院経過は入院イベントと手術の箇条書きで、日々の記録・検査値・看護記録は集めていない。
- 看護サマリーは `NursingSummarySources` + `recordOf`(看護記録を `{date, author, title, text}` の平文に)→ `appendNursingRecords` で
  看護経過に追記する。申し送りの器は無い。
- 期間のカルテは `useKartePrintTimeline(patientId, from, to)`(`api/queries/kartePrint.ts`)が `KarteDayGroup[]` を返す。
  テキスト化する関数は無く、部品(`cardTitle` / `cardMeta` / `narrativePlainText` / `questionnaireResponsePlainText` / `summarize*Order` /
  `summarizeDiagnosticReport` / `formatLabResults`)が散在する。
- 記録エディタ(Tiptap)は非制御で、本文の差し替えは `sections[i].html` を書き換えて `uid` を更新する。
- Provenance の組み立て(`fhir/provenanceHelpers.ts`)は ServiceRequest 向けだけ。アクセスログのテーブルは無い。
- **個人情報を外部へ送ることについての方針は docs に無い。**

## 1. 個人情報の扱い(先に決める)

- **［設計］** LLM に送るのは **臨床の本文と構造化データだけ**。氏名・患者番号・住所・電話・生年月日(年齢に直す)・医療従事者名・
  保険情報は **frontend が組む payload の型に欄を作らない**。backend は patient id を記録のためだけに受け取り、`Patient` を引かない。
  記録本文に氏名が書かれていることはあり得るので、設計書は「仮名化を保証する」とは書かず「識別子を送らない」と書く。
- **［設計］** 施設設定 `assist.enabled` を管理者が明示的に立てるまで、どの画面にもボタンを出さない。管理画面の説明に
  「外部のクラウド API に診療情報の本文を送る」ことと、院内規程(3 省 2 ガイドラインの外部事業者の利用)の確認を促す文を置く。
- **［設計］** 1 回の生成ごとに `Integrations::EventLog`(`system: "llm_assist"`)へ利用者 id・患者 id・機能・モデル・入出力トークン数・
  所要時間を残す。本文は残さない。管理画面「外部システム連携」の `llm_assist` に直近の利用件数と失敗件数を出す。
- **［設計］** 生成文を取り込んで確定した Composition には Provenance を付ける(agent: author = 確定した職員、
  `assembler` = `Device`(display "llm-assist / <モデル名>")、`entity.role = source` に元にした期間の記録は付けない)。
  `provenanceHelpers` の `provenanceEntry` を Composition にも使えるよう target の型を広げる。
- **［要確認］** 患者の同意を個別に取るか(包括同意の掲示で足りるか)は施設の判断。設計上は同意の有無を見ない。
- 採らなかった案: 氏名を正規表現で伏せ字にしてから送る。日本語の氏名は機械的に見つけられず「伏せた」と言えないので、
  識別子を構造的に除く方針に留める。

## 2. 構成

### 2.1 backend

- 新しいトップレベル `/assist/*`(`frontend/vite.config.ts` の proxy と `render.yaml` の rewrite に追加)。
- `Assist::DraftsController`(`UserAuthentication` を include、`authorize_user!` と `verify_user_csrf!`):
  `POST /assist/drafts` に `{feature, patient_id, payload}` → `{sections: {...}, usage: {input_tokens, output_tokens}, truncated}`。
  `rescue_from` は receipt の `BaseController` と同じ写し方。`feature` ごとにプロンプトと出力の JSON Schema を `Assist::Features` に置く。
- `Assist::Client`: **Faraday で Messages API(`POST https://api.anthropic.com/v1/messages`)を直接呼ぶ**(gem を足さず、
  イメージの再ビルドを避ける。ユーザー決定 2026-10-16)。
  - ヘッダ `x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`。
  - 本文: `model`(既定 `claude-opus-5-5`、設定で変更可)、`max_tokens: 16000`、`output_config: { effort: "medium", format: <機能ごとの JSON Schema> }`、
    `system`(施設の補足を末尾に)、`messages[0]` に資料と指示。
  - 応答: `content[].type == "text"` を JSON として読む。`stop_reason == "refusal"` は `Integrations::Rejected`(画面に「生成できませんでした」)、
    `max_tokens` は切り詰めの印を付けて返す。
  - 再送: 429 / 529 / 5xx と接続失敗を 0.5 / 1.5 / 3 秒で 3 回(429 は `retry-after` を優先)。open_timeout 3 秒、timeout 120 秒。
  - `usage` をそのまま EventLog に書く。
- 設定: `Integrations::ExternalSystems::DEFINITIONS` に `llm_assist`(label「記録支援(LLM)」)。区画は新設の `api_key`
  (`password` 列を鍵に使い、`usable?` は `password` だけを要求する)。`options` に `model`、`max_input_chars`(既定 60,000)。
  環境変数フォールバックは `LLM_ASSIST_PASSWORD`(既存の命名規則)。本番は Render の env に `sync: false` で置く。
- `facility_settings.assist`: `enabled`、`features`(有効にする機能の配列)、`style_note`(施設の書き方の補足。system に追記)。

### 2.2 frontend

- `api/assistClient.ts`: `postAssistDraft(feature, patientId, payload)`(`masterFetch` 経由で CSRF ヘッダが付く)。
- `fhir/karteTextHelpers.ts`(新規、純関数): `karteDayGroupsToText(groups, {maxChars})` → `{text, truncated}`。
  1 日 1 見出し、項目は `cardTitle` + 本文(記録は `narrativePlainText`、テンプレートは `questionnaireResponsePlainText`、
  オーダーは `summarize*Order`、結果は `summarizeDiagnosticReport`)。上限を超えたら **古い側から**落として `truncated` を返す
  (直近の経過のほうが要約の価値が高い)。
- 生成ボタンは `assist.enabled` かつ機能が `features` にあるときだけ描く(`useFacilitySettings`)。
  生成中はボタンを無効にし、結果は差分を見せずに「空の欄にだけ入れる」。既に本文がある欄は上書きしない(退院時サマリーの既存の作法)。

## 3. 機能(段取り順)

| 順 | 機能 | 入力 | 出力の入れ先 |
|---|---|---|---|
| 1 | 退院時サマリーの下書き | `DischargeSummarySources`(病名・手術・退院処方・アレルギー)+ 期間の記録の平文(`useKartePrintTimeline` → `karteDayGroupsToText`)+ 主要検査値(`formatLabResults` の期間版) | 入院経過 8648-8・退院時の状態 10184-0・退院後の方針 18776-5 の空欄に `linesToHtml` で。`DischargeSummaryForm` の「再収集」の隣に「AI 下書き」 |
| 2 | 経過の要約(「これまで」) | 期間(既定: 直近 90 日、入院中なら入院日から)の `karteDayGroupsToText` | カルテ上部のパネルに表示するだけ(保存しない)。`sessionStorage` に患者 × 期間で保持。生成日時と「下書き」の印 |
| 3 | 看護サマリーの下書き | `NursingSummarySources`(`recordOf` の平文)+ 看護計画の問題・目標 | 看護経過 nursing-course・現在の状態 current-status・継続看護 continuing-care の空欄に(`appendNursingRecords` と同じ入れ方) |
| 4 | 紹介状など Questionnaire の text 項目 | 項目拡張 `http://fhir-client.local/StructureDefinition/assist-prompt`(valueString = その欄の指示)+ 直近 90 日の平文 | `QuestionnaireResponseForm` の text 項目に、拡張があるときだけ「AI 下書き」ボタン(空欄のときだけ有効) |

- 出力はすべて機能ごとの JSON Schema(節ごとの文字列の配列)で受け、画面側が HTML にする。LLM に HTML を書かせない。
- プロンプトの原則(`Assist::Features` に置く): 資料に無いことは書かない、推測は「〜の可能性」と書かず省く、日本語の診療録の文体、
  各節は箇条書きではなく段落、薬剤名・数値・日付は資料のまま。
- 申し送り(I-SBAR)は記録の器が無いので対象外。経過記録に category `handover` を足す案は残課題へ。

## 4. 費用と上限

- 入力は `max_input_chars`(既定 60,000 文字 ≒ 4〜6 万トークン)で切り詰める。1 回の生成は入力 6 万・出力 2 千トークン程度で、
  `claude-opus-5-5`(入力 $4 / 出力 $20 per MTok)なら 1 回 0.3 ドル前後。1 利用者あたり 1 分 5 回まで(backend でカウント)。
- 同じ資料で連続して生成するときの prompt caching は第 2 段(資料部分を `cache_control` で区切る)。

## 5. テスト

- backend: `spec/requests/assist/drafts_spec.rb`。WebMock で `api.anthropic.com` を塞ぎ、成功(JSON を節に写す)、鍵未設定 503、
  `refusal` 502、429 の再送、`max_tokens` の切り詰め印。EventLog に本文が残らないこと。
- frontend: `npx tsc -b`、`npm run lint`。開発環境に鍵を入れ、テスト太郎の入院で退院時サマリーを 1 回生成して空欄にだけ入ること、
  既存の本文が消えないこと、Provenance が付くことを画面で確認。

## 6. 対象外・残課題

- 音声入力(Web Speech API)。別の設計に分ける。
- 生成文の評価(施設の医師が採点する簡易な eval)。運用が始まってから。
- 自由記載からの病名・Observation 候補の抽出(構造化の提案)。入力の器(記録エディタの提案 UI)から設計し直す。
