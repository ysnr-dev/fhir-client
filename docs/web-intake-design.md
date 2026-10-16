# Web 問診(患者が自分で入力する問診票)

`docs/functional-gap-backlog.md` §4 の「記録の効率」(2026-10-16 の追加候補)。
**状態: 設計のみ(2026-10-16)。実装は未着手。**
予約・受付から発行した QR コードを患者が自分のスマホで開き(または院内のタブレットで)、問診票に回答する。
回答は職員が確認して QuestionnaireResponse としてカルテに取り込む。

- **［事実］** = このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 現状(実装済みの範囲)

- 認証は `UserAuthentication`(Cookie セッション / Bearer の ADMIN_TOKEN)。ログイン無しで到達できるのは `/up`・`/wakeup`・
  `/auth/session`・`/admin/session` と、レセコン連携の受信窓口 `POST /integrations/receipt/events`(DB に暗号化して持つ
  `inbound_token` を Bearer で照合)だけ。上流への書き込みは施設 1 本のトークン(`FhirTokenProvider`)で、
  backend から書く層は `Integrations::FhirStore#transaction`。
- frontend は `App.tsx` の `<AuthGate>` が全体を包む(未ログインならログイン画面だけを出す)。別タブのカルテペインと印刷ページは
  `pathname` で分岐しているが、AuthGate の内側。
- 回答フォーム `QuestionnaireResponseForm` は保存を持たず item ツリーを返す。`expressionContext`(初期値変数)と `loginAutofill` を
  渡さなければ患者向けにも使える。item 型は choice / text / string / integer / decimal / date / dateTime / time / group / display
  (`boolean`・`attachment` は無い)。`buildQuestionnaireResponse` は記入者名と機関番号を必須にしている(JASPEHR)。
- 予約は Appointment(`participant[0]` = 患者、受付は `appointment-checked-in-at`)。外来の Encounter は診察開始まで作らない。
- QR コード(2 次元)の生成は backend・frontend とも無い(barby は Code128)。
- カルテのタイムラインは `encounter:missing=true` の QR を拾う。未確定の回答を上流に置くと、見え方の制御と JASPEHR の記入者要件の
  両方に掛かる。
- 患者向け UI・多言語は無い。`Patient.communication`(言語・通訳要否)は記録できる。

## 1. 方針: 回答は backend に留め、取込で初めて FHIR に書く

- **［設計］** 患者の回答は backend の DB(`intake_responses`)に置き、職員が取込を確定したときに **通常の経路**(`saveResponse`)で
  QuestionnaireResponse を書く。上流には未確定の QR を置かない。
  - JASPEHR の記入者(Practitioner)要件に素直(取り込んだ職員が author)。
  - タイムラインに未確定の回答が混ざらない。
  - 個人情報の置き場所が backend の DB と上流の 2 か所に増えない。
- 採らなかった案: 回答を `status=in-progress` の QR として上流に書き、職員が `completed` に直す。上流の検索条件を直す箇所が多く、
  患者が記入者になる形を JASPEHR が許すか不明。

## 2. backend

### 2.1 テーブル

```text
intake_links
  id, token_digest(SHA-256、索引), appointment_fhir_id, patient_fhir_id, questionnaire_urls(jsonb: canonical の配列),
  birth_date(照合用。Patient から写す), expires_at, verified_at, failed_attempts, created_by(users.id), timestamps
intake_responses
  id, intake_link_id, questionnaire_url, questionnaire_version, answers(jsonb: QR の item 配列), submitted_at,
  status(pending / imported / discarded), imported_qr_id, imported_by, timestamps
```

- トークンは 32 バイトの乱数(URL safe)。DB には digest だけ。有効期限は予約日の翌日 23:59(予約が無ければ発行から 24 時間)。

### 2.2 エンドポイント(新しいトップレベル `/intake/*`。`vite.config.ts` と `render.yaml` の rewrite に追加)

- 職員用(`Intake::StaffController`、`UserAuthentication`):
  - `POST /intake/links` `{appointment_id | patient_id, questionnaire_urls?}` → `{url, expires_at}`。`questionnaire_urls` 省略時は
    施設設定の既定(§4)。既存の有効なリンクがあれば同じものを返す(QR を 2 回出しても 1 本)。
  - `GET /intake/links?appointment_ids=…` → 予約ごとの状態(未発行 / 発行済 / 回答済 / 取込済)。外来一覧の印に使う。
  - `GET /intake/responses?patient_id=…&status=pending` → 未取込の回答(質問票・回答日時)。
  - `PATCH /intake/responses/:id` `{status: imported, imported_qr_id}` / `{status: discarded}`。
- 患者用(`Intake::PublicController`、`ActionController::API` 直継承、認証なし):
  - `GET /intake/:token` → `{status, questionnaires: [Questionnaire の JSON], needs_verification}`。**個人情報は返さない**
    (患者名も出さない。画面は「ご本人確認のため生年月日を入力してください」から始める)。
  - `POST /intake/:token/verify` `{birth_date}` → 一致で `verified_at`、不一致は `failed_attempts` を増やし 5 回で失効(410)。
  - `POST /intake/:token/responses` `{questionnaire_url, answers}` → 保存。同じ質問票は上書き(回答し直し可)。
  - 期限切れ・失効・未照合は 410 / 403、本文は `{error}`。
  - 簡易なレート制限(IP × 1 分 × 30 回。`Rack::Attack` は入っていないので `Rails.cache` のカウンタ)。
- Questionnaire の JSON は backend が `FhirStore#read`(canonical → `Questionnaire?url=`)で引いて返す(患者端末から `/fhir` を叩かせない)。

### 2.3 QR コードの画像

- **［設計］** frontend で npm `qrcode`(canvas / SVG)を使う(コンテナ内 `npm install` → restart。イメージ再ビルド不要)。
  backend で作る案(`rqrcode` + barby)は Gemfile 変更で再ビルドが要る。
- 院内のタブレットで回答させるときは、職員が同じ URL を開く(QR は要らない)。

## 3. frontend

### 3.1 患者画面 `/q/:token`

- `App.tsx` で `pathname.startsWith("/q/")` のときは `<AuthGate>` の外で `IntakePage` だけを描く(ヘッダ・メニュー無し)。
  `useAuthSession` を呼ばない。
- 流れ: 生年月日の照合 → 質問票を 1 つずつ → 送信 → 完了(「受付でお知らせください」)。1 グループ 1 ページ(`group` 単位で送り)、
  文字を大きく(`--control-height-lg`)、`QuestionnaireResponseForm` を `onSubmit` 付き・メタ欄なしで使う。
  `boolean` 型が無いので「はい / いいえ」の choice で作る。進捗はブラウザに残さない(他人の端末も想定)。
- 既存の施設テーマ変数を使う。多言語は第 2 段。

### 3.2 職員側

- 外来一覧・予約一覧の行メニュー(`RowMenu`)に「問診 QR」: `POST /intake/links` → モーダルに QR と URL(コピー)、有効期限。
- 外来一覧に「問診」列(未発行 / 発行済 / 回答済 / 取込済。`GET /intake/links` を当日の予約 id で 1 本)。
- 患者帯に未取込の回答があればピクトグラム(吹き出しに「問診 n 件」、押すと取込へ)。
- 取込: `KartePaneState` に `{kind: "intake-review", responseId}` を 1 つ足す。`QuestionnaireResponseEditPanel` に
  `initialResponse`(answers を QR に組み直したもの)を渡し、職員が確認・修正して保存。保存は既存の `saveResponse`
  (Observation 生成のテンプレートならそれも効く)。QR には拡張 `http://fhir-client.local/StructureDefinition/intake-source`
  (valueCode `patient`)と `authored` = 患者の回答日時を付け、author は取り込んだ職員。保存後に `PATCH … imported`。
  「破棄」はカルテに書かずに `discarded`。

## 4. 問診票の選択と施設設定

- `facility_settings.intake`: `questionnaires`(既定の canonical の配列。`nursing_profile.templates` と同じ形)、
  `by_department`(診療科 Organization id → canonical の配列)、`expires_hours`(予約が無いときの有効時間、既定 24)。
- テンプレートカテゴリ「問診」を seed し、テンプレート一覧で見分けられるようにする(用途の印はカテゴリで足りる)。
- 患者向けに使うテンプレートの条件: 初期値変数(`%`)と `loginAutofill` を使っていない、シェーマ画像が無い、医療者向けの用語が無い。
  発行時に backend が初期値変数の有無を検査して警告する。

## 5. 対象外・残課題

- 多言語(Questionnaire の翻訳拡張と患者画面の言語切替、`Patient.communication` からの既定)。
- 予約の Web 取得・患者ポータル。問診は「来院が決まった患者」が前提。
- 添付(保険証・お薬手帳の写真)。`attachment` 型が無く、画像の置き場所(ファイル取込)との結び付けが要る。
- 回答からの Observation 生成を取込前に見せる(取込の画面でプレビュー)。

## 6. 検証(実装時)

- backend: `spec/requests/intake/*`。発行・照合(成功・5 回失敗で失効)・期限切れ 410・回答の上書き・未認証の `/intake/responses` が 401。
  個人情報が公開 API の応答に含まれないこと。
- 画面: 開発環境の予約(テスト太郎)から QR を発行し、スマホ幅(375px)で生年月日 → 回答 → 送信。外来一覧の印、患者帯、
  取込で QR がタイムラインに出ること。`npx tsc -b`、`npm run lint`。
