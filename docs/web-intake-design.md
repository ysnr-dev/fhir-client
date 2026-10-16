# Web 問診(患者が自分で入力する問診票)

`docs/functional-gap-backlog.md` §4 の「記録の効率」(2026-10-16 の追加候補)。
**状態: 実装済み(2026-10-17)。** 多言語・添付は §5 の残課題。
予約・受付から発行した QR コードを患者が自分のスマホで開き(または院内のタブレットで)、問診票に回答する。
回答は職員が確認して QuestionnaireResponse としてカルテに取り込む。

- **［事実］** = このリポジトリ・上流の実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 制度・運用で確かめていないこと

## 0. 前提(着手時に確認した範囲)

- 認証は `UserAuthentication`(Cookie セッション / Bearer の ADMIN_TOKEN)。ログイン無しで到達できるのは `/up`・`/wakeup`・
  `/auth/session`・`/admin/session` と、レセコン連携の受信窓口 `POST /integrations/receipt/events` だけだった。上流への書き込みは
  施設 1 本のトークン(`FhirTokenProvider`)で、backend から読む層は `Integrations::FhirStore`。
- frontend は `App.tsx` の `<AuthGate>` が全体を包む(未ログインならログイン画面だけを出す)。
- 回答フォーム `QuestionnaireResponseForm` は保存を持たず item ツリーを返す。item 型は choice / text / string / integer / decimal /
  date / dateTime / time / group / display(`boolean`・`attachment` は無い)。`buildQuestionnaireResponse` は記入者名と機関番号を
  必須にしている(JASPEHR)。
- 予約は Appointment(`participant` の `Patient/` が患者、診療科は `Organization/`)。外来の Encounter は診察開始まで作らない。
- カルテのタイムラインは `encounter:missing=true` の QR を拾う。未確定の回答を上流に置くと、見え方の制御と JASPEHR の記入者要件の
  両方に掛かる。

## 1. 方針: 回答は backend に留め、取込で初めて FHIR に書く

- **［設計］** 患者の回答は backend の DB(`intake_responses`)に置き、職員が取込を確定したときに **通常の経路**(テンプレート回答の
  登録パネル)で QuestionnaireResponse を書く。上流には未確定の QR を置かない。
  - JASPEHR の記入者(Practitioner)要件に素直(取り込んだ職員が author)。
  - タイムラインに未確定の回答が混ざらない。
  - 個人情報の置き場所が backend の DB と上流の 2 か所に増えない。
- 採らなかった案: 回答を `status=in-progress` の QR として上流に書き、職員が `completed` に直す。上流の検索条件を直す箇所が多く、
  患者が記入者になる形を JASPEHR が許すか不明。

## 2. backend

### 2.1 テーブル(`db/migrate/20261016200000_create_intake_links.rb`)

```text
intake_links
  id, token_digest(SHA-256、unique), appointment_fhir_id, patient_fhir_id(索引), questionnaire_urls(jsonb: canonical の配列),
  birth_date(照合用。Patient から写す。encrypts), expires_at, verified_at, failed_attempts(既定 0), revoked_at,
  created_by_id(Practitioner id), created_by_name, timestamps
intake_responses
  id, intake_link_id, questionnaire_url(url|version), questionnaire_version, answers(jsonb: QR の item 配列), submitted_at,
  status(pending / imported / discarded), imported_qr_id, imported_by_id(Practitioner id), timestamps
```

- トークンは `SecureRandom.urlsafe_base64(32)`。DB には digest だけ(`IntakeLink.issue!` が `[link, 生のトークン]` を返し、
  この場でしか得られない)。`birth_date` は `filter_parameters` にも入れてログに出さない。
- 状態(`IntakeLink`): 患者画面向け `public_status` は expired(失効・期限切れ)/ locked(照合 5 回失敗)/ verify / ready、
  職員向け `staff_status` は imported / answered / expired / issued。
- 有効期限は予約日の翌日 23:59:59(JST)。予約が無ければ発行から `expires_hours`(施設設定、既定 24 時間)。

### 2.2 発行(`Intake::LinkIssuer`)

- 予約 id か患者 id を受け、上流で Appointment と Patient(`birthDate`)を読む。質問票は引数 → 診療科の既定(予約の診療科
  Organization の SS-MIX2 コード)→ 施設の既定の順に決め、空なら 422。
- **発行のたびに新しいトークンを作り、同じ予約(予約が無ければ同じ患者)の有効なリンクは `revoked_at` で無効にする。**
  トークンは保存していないので「同じ QR をもう一度出す」ことはできず、出し直す方が運用が単純。前の QR を開くと「期限は過ぎました」になる。
- Questionnaire の JSON は発行時でなく患者が開いたときに読む(`Intake::QuestionnaireLoader`。`Questionnaire?url=&version=&status=active`
  で引き、版が無ければ最新)。

### 2.3 エンドポイント(新しいトップレベル `/intake/*`。`vite.config.ts` と `render.yaml` の rewrite に追加済み)

- 職員用(`Intake::StaffController`、`UserAuthentication`):
  - `POST /intake/links` `{appointment_id | patient_id, questionnaire_urls?}` → `{id, path: "/q/<token>", expires_at, questionnaire_urls}`。
    トークンはこの応答にだけ出す。
  - `GET /intake/links?appointment_ids=a,b` → `{items: [{appointment_fhir_id, status, expires_at}]}`。予約ごとに、回答のあるリンクが
    あればその最新、無ければ最新のリンクの `staff_status`(発行し直しても取込済が発行済に戻らない)。
  - `GET /intake/responses?patient_id=&status=pending|all` → 取込待ちの回答(質問票・回答日時・answers)。
  - `GET /intake/responses/:id` → 1 件。`PATCH /intake/responses/:id` `{status: imported, imported_qr_id}` / `{status: discarded}`。
- 患者用(`Intake::PublicController`、`ActionController::API` 直継承、認証なし):
  - **トークンはヘッダ `X-Intake-Token`** で受ける(パスに置くとリクエストログに残る。`/q/<token>` は SPA のパスで backend には届かない)。
    無い・一致しないときは 401。
  - `GET /intake/public` → `{status, submitted_urls, questionnaires?}`。`questionnaires`(Questionnaire の JSON)は `ready` のときだけ。
    **個人情報は返さない**(患者名も出さない。画面は生年月日の入力から始める)。
  - `POST /intake/public/verify` `{birth_date}` → 一致で `verified_at`、不一致は `failed_attempts` を増やし 403(5 回で `locked`)。
    失敗時は 0.2 秒待つ(ログインと同じ総当たり対策)。
  - `POST /intake/public/responses` `{questionnaire_url, questionnaire_version, answers}` → 201。照合前は 403、失効は 410。
    リンクは版なしの url で質問票を持ち、画面は開いた版の canonical を送るので、**url の部分で突き合わせ**、同じ質問票の取込待ちは上書き。
  - レート制限は Rails 8 の `rate_limit`(IP × 1 分 × 30 回)。既定の `cache_store` は開発・テストで `null_store` なので
    専用の `MemoryStore` を渡す(プロセスごと。本番は 1 プロセスなので足りる)。

### 2.4 QR コードの画像

- **［設計］** frontend で npm `qrcode`(`toDataURL`)を使う。backend で作る案(`rqrcode`)は Gemfile 変更で再ビルドが要る。
- 院内のタブレットで回答させるときは、職員が同じ URL を開く(QR は要らない)。

## 3. frontend

### 3.1 患者画面 `/q/:token`(`pages/IntakePage.tsx`)

- `App.tsx` で `pathname` が `/q/` で始まるときは `<AuthGate>` の外で `IntakePage` だけを描く(ヘッダ・メニュー無し。別タブの
  ペインのホストも無効)。API は `api/intakePublicClient.ts` の素の `fetch`(`credentials: "omit"`、CSRF ヘッダ無し)。
- 流れ: 状態を読む → 生年月日の照合 → 質問票を 1 つずつ(トップレベルの item 1 つを 1 ページ。戻る / 次へ / 送信)→ 完了
  (「受付でお知らせください」)。ページ送りの前に `form.reportValidity()` で必須と形式を確かめる。送信済みの質問票
  (`submitted_urls`。版なしの url で比べる)は飛ばす。
- `QuestionnaireResponseForm` に `pageIndex`(そのトップレベル item だけ描く。state は 1 つのまま)、`hidePickers`
  (医療機関・医療従事者の選択を出さない)、`formRef` を足した。初期値変数(`expressionContext`)と `loginAutofill` は渡さない。
- 文字は `--control-height-lg`、CSS は `.intake-page__*`(テーマ変数のみ)。進捗はブラウザに残さない(他人の端末も想定)。

### 3.2 職員側

- **QR モーダル**(`components/IntakeQrModal.tsx`): 開いた時点で発行し、QR 画像・URL(コピー)・有効期限・質問票の本数を出す。
  発行は `useIssuedIntakeLink`(モーダルごとの印をキーにした query。mutation にすると開発の StrictMode の仮アンマウントで
  結果を受け取れない)。閉じたら同じ QR は出せない(もう一度開くと発行し直す)。
- 外来一覧(`pages/OutpatientListPage.tsx`): 行メニューに「問診 QR」、列「問診」(発行済 / 回答済 / 取込済 / 期限切れ。
  `GET /intake/links` を当日の予約 id で 1 本)。カルテの予約タブ(`AppointmentTable`)の通常の予約のメニューにも「問診 QR」。
- 患者帯(`PatientHeader`): 取込待ちの回答があれば「用紙にチェック」のピクトグラム(アクセント色、件数付き)。吹き出しの
  「問診を取り込む(回答日時)」で `?open=intake:<回答 id>` のカルテを開く。
- 取込(右ペイン `intake-review`、`components/IntakeReviewPanel.tsx`): 回答を読み、質問票を回答時の canonical で引き、
  `QuestionnaireResponseCreatePanel` に `initialResponse`(answers を `in-progress` の QR に組み直したもの)・`authored`(送信日時)・
  `extension`(`http://fhir-client.local/StructureDefinition/intake-source` = `patient`)を渡す。職員が確認・修正して「登録」すると
  通常の保存経路(Observation 生成・帳票も効く)で書き、`onSaved` で `PATCH … imported`。「破棄」はカルテに書かずに `discarded`。
  `buildQuestionnaireResponse` に `authored?` と `extension?` を足した。

## 4. 問診票の選択と施設設定

- `facility_settings.intake`: `questionnaires`(既定の canonical の配列)、`by_department`(診療科の SS-MIX2 コード → canonical の配列。
  予約の診療科に合えばこちらを優先)、`expires_hours`(予約が無いときの有効時間、既定 24)。施設設定画面の「Web 問診」区画。
- 患者向けに使うテンプレートの条件(`docs/features/templates.md`「患者向けの質問票」): 初期値変数と `loginAutofill` を使わない、
  シェーマ画像が無い、質問をグループに分ける、はい / いいえは choice。
- 例: `docs/report-mappings/intake-general-01.questionnaire.json`(`INTAKE_01`、主訴・経過・既往歴・服薬・アレルギー・妊娠と喫煙。
  enableWhen は JASPEHR の制約に合わせ choice の子グループに置く)。

## 5. 対象外・残課題

- 多言語(Questionnaire の翻訳拡張と患者画面の言語切替、`Patient.communication` からの既定)。
- 予約の Web 取得・患者ポータル。問診は「来院が決まった患者」が前提。
- 添付(保険証・お薬手帳の写真)。`attachment` 型が無く、画像の置き場所(ファイル取込)との結び付けが要る。
- 回答からの Observation 生成を取込前に見せる(取込の画面でプレビュー)。
- 発行時に質問票が患者向けの条件(初期値変数など)を満たすかの検査。
- 失効したリンクと取込済み・破棄した回答の定期削除(個人情報の保持期間)。

## 6. 検証(2026-10-17)

- backend: `spec/requests/intake/staff_spec.rb`・`public_spec.rb`(発行・一覧の状態・取込の PATCH・未認証 401、トークン無し 401・
  照合の成功と 5 回失敗で locked・期限切れ 410・回答の保存と上書き・照合前 403・応答に生年月日と氏名が無いこと)。
- 画面: テスト太郎の予約から QR を発行 → 別タブで開き、誤った生年月日でエラー → 正しい生年月日 → 3 ページ回答 → 送信。
  外来一覧の列が「回答済」、患者帯にピクトグラム、吹き出しから右ペインの取込 → 登録で QR がタイムラインに出て
  `intake-source` と患者の送信日時を持ち、列が「取込済」になることを確認。公開 API の応答に個人情報が無いこと、
  トークン無し・職員 API の未認証が 401 になることを curl で確認。
