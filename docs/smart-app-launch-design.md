# SMART on FHIR アプリ起動(EHR launch)

`docs/functional-gap-backlog.md` §5.3「SMART on FHIR アプリ起動」(2026-10-18 の海外 EHR 照合で出た候補 7)。
**状態: 実装済み(2026-10-18、上流・client とも)。本番デプロイは fhir-server を client より先に行う(上流の migration あり)。**
カルテから外部アプリ(計算ツール・PHR ビューア・AI 記録製品・院内開発の小画面)を、患者・利用者・受診の文脈つきで起動し、
カルテのタブに埋め込む。アンビエント記録などを自前で作らず、施設が選んだ製品を差し込める入口にする。
準拠する規格は SMART App Launch 2.2 の EHR launch(`launch` パラメータ + `launch` スコープ)。

- **［事実］** = 規格、上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 実装時に確かめること

ユーザー決定(2026-10-18): (1) EHR launch の認可はログイン・同意画面を出さず即 302、(2) アプリの書き込みは OAuth クライアント登録時の
スコープに従う(既定は読み取り)、(3) 起動場所はカルテの「アプリ」タブのみ(患者なし起動は残課題)。

## 0. 実装前の状態(設計時の前提)

上流(`../fhir-server`、SMART の認可サーバー兼リソースサーバー):

- OAuth は Backend Services(`client_credentials`、private_key_jwt / client_secret)と、**患者向け** standalone launch
  (`authorization_code` + PKCE S256、`app/controllers/oauth/browser_controller.rb` が authorize / login / consent の HTML を出す)。
  `User` は患者アカウントで `Patient` と 1:1(`users.patient_id` NOT NULL)。**医療者のアカウントは無い。**
- スコープ(`app/lib/fhir/scopes.rb`)は `system/` と `patient/` のみ。`user/` は無効(35-36 行のコメント)、`launch` / `launch/patient` も無効。
  `patient/` の書き込みは無効。context scope は `offline_access` `online_access` `openid` `fhirUser` `profile`。
- トークン 3 種(`access_tokens` 1 時間、`authorization_codes` 5 分、`refresh_tokens` offline 30 日 / online 12 時間)は
  opaque でダイジェスト保存(`DigestedToken` / `SingleUseToken` concern)。`authorization_codes.user_id` と `refresh_tokens.user_id` は NOT NULL
  (`db/schema.rb` 105, 895 行)、`access_tokens.user_id` と `patient_id` は nullable。
- `ApplicationController#access_context`(46-54 行)は `token.patient_context?`(= `patient_id` あり)だけで `Fhir::PatientContext` を作り、
  患者コンパートメントに閉じる。`require_system: true` の操作(`_history`・`AuditEvent`・`$export`)は `system/` 必須。
- `Oauth::BrowserController` の `AUTHORIZE_PARAMS`(18 行)に **`aud` が無く、未検証**。`FhirAuditing` も include していない。
- `smart_configurations_controller.rb` は `launch-standalone` 系の capability を出し、「EHR launch is not implemented」のコメント。issuer は
  リクエストの `protocol + host_with_port`。
- 管理 API `/admin/oauth_clients`(index / create / destroy)と `/admin/scopes`(`X-FHIR-Admin-Token`)。`OauthClient` は `kind: launch | backend`、
  `redirect_uris` 完全一致、public / confidential。`system/` と `patient/` の混在は登録時に 422。
- 全応答に `X-Frame-Options: DENY`・`Referrer-Policy: no-referrer`・`Cross-Origin-Resource-Policy: same-origin`
  (`config/initializers/security_headers.rb`)。**CORS は無効**(`rack-cors` は Gemfile でコメントアウト)。
- rack-attack(`config/initializers/rack_attack.rb`): `api/token` 300/分、`api/ip` 120/分、`oauth/ip` 10/分、`oauth-browser/ip` 30/分、`admin/ip` 30/分。
- `config/initializers/filter_parameter_logging.rb` は `:token` `:secret` 等を伏せるが、`launch` `code` `code_verifier` は対象外。

client(このリポジトリ):

- backend は施設 1 本の Backend Services トークンで上流を呼ぶ(`FhirTokenProvider` / `FhirGateway`)。管理 API は `FhirAdminGateway`
  (`X-FHIR-Admin-Token`、トークンは `FhirConnectionSettings.effective.admin_token`。DB の暗号化列 → env `FHIR_ADMIN_TOKEN`)。
  上流の 401/403 は `UpstreamAdminRelay` が 502 に読み替える(SPA が自分のセッション切れと誤認しないため)。
- 上流の URL は `FhirConnectionSettings.base_url` → env `FHIR_SERVER_BASE_URL`。dev は `http://host.docker.internal:3000` で
  **ブラウザからは到達できない**。ブラウザ向けの上流 URL の設定は無く、`WakeupController#probe_url` が `base_url` を流用している。
- 利用者は `users.practitioner_fhir_id` で上流 `Practitioner` と 1:1。固定利用者 `administrator` は practitioner 無し。
  ログイン必須の API は `UserAuthentication` の `authorize_user!` + `verify_user_csrf!`。
- 管理画面は `Admin::BaseController`(セッション Cookie か Bearer `ADMIN_TOKEN`。本番で未設定なら 503 で閉じる API がある)。
  OAuth クライアント画面は `pages/OauthClientsPage.tsx` + `components/OauthClientCreateForm.tsx`(backend / launch の切替あり)。
- カルテのタブは `frontend/src/karteUrl.ts` の `KARTE_TABS` / `KARTE_TAB_GROUPS` と `pages/KartePage.tsx` の `renderTabPanel`
  (props `{patientId, view, onViewChange}`)。外来の診察中 Encounter は同ファイルの `examEncounter`。
- **iframe の前例は無い。** CSP / X-Frame の設定も backend・frontend・`render.yaml` のどこにも無い。frontend に `VITE_` 変数は無く、相対パス固定。

## 1. 全体の流れ

```
医療者(ブラウザ)        client frontend        client backend          上流 fhir-server            外部アプリ
     │ カルテ>アプリ>選択    │                       │                        │                          │
     │──────────────────────▶│ POST /smart_apps/:id/launch {patient_id, encounter_id?}                     │
     │                       │──────────────────────▶│ POST /admin/launch_contexts (X-FHIR-Admin-Token)   │
     │                       │                       │───────────────────────▶│ launch_contexts に保存    │
     │                       │                       │◀───────────────────────│ {launch, expires_in}     │
     │                       │◀──────────────────────│ {launch_url(iss, launch 付き), display}            │
     │                       │ <iframe src=launch_url>                        │                          │
     │                       │───────────────────────────────────────────────────────────────────────────▶│ GET launch_url?iss&launch
     │                       │                       │                        │◀─────────────────────────│ GET /oauth/authorize?...&launch&aud
     │                       │                       │                        │ 検証→consume→302 code    │
     │                       │                       │                        │◀─────────────────────────│ POST /oauth/token (CORS)
     │                       │                       │                        │ access_token, patient,   │
     │                       │                       │                        │ encounter, id_token ────▶│
     │                       │                       │                        │◀─────────────────────────│ GET /Patient/{id} (Bearer, CORS)
```

1. **［設計］** frontend: カルテ「アプリ」タブでアプリを選ぶと `POST /smart_apps/:id/launch` に `{patient_id, encounter_id?}` を送る(利用者認証 + CSRF)。
2. **［設計］** client backend: `smart_apps` 行を引き、ログイン中の利用者の `practitioner_fhir_id` が無ければ 403。`FhirAdminGateway` で上流に
   `POST /admin/launch_contexts` を送る(§2.4)。
3. **［設計］** 上流: `launch_contexts` に患者・受診・医療者・アプリ(client_id)を保存し、opaque な `launch` トークン(5 分、単回)を返す。
4. **［設計］** frontend: `iframe.src = launch_url + ?iss={ブラウザから見た上流 URL}&launch={token}`。`display = window` のアプリは `window.open`。
5. **［事実］** アプリは SMART の手順どおり `{iss}/.well-known/smart-configuration` を読み、`GET /oauth/authorize?response_type=code&client_id&redirect_uri
   &scope=launch openid fhirUser user/*.read&state&aud={iss}&launch={token}&code_challenge&code_challenge_method=S256` へ遷移する。
   **［設計］** 上流は launch 分岐で検証し、HTML を描画せずセッションにも触れず、即 302 で `code` を返す(§2.5)。
6. **［設計］** アプリは `POST /oauth/token`(CORS)で `access_token` と文脈(`patient` `encounter` `need_patient_banner` `id_token`)を得る(§2.6)。
7. **［事実］** 以降アプリは `/fhir` プロキシを通らず上流に直接 Bearer で読む・書く。到達範囲はトークンのスコープで決まる(§2.2)。

## 2. 上流の設計(`../fhir-server`)

実装は上流が先。本番デプロイも fhir-server を client より先に行う。

### 2.1 テーブル

**`launch_contexts`**(新規)。`DigestedToken` + `SingleUseToken` をそのまま使うため列名は `token_digest` / `used_at`。

| 列 | 型 | 制約 | 内容 |
|---|---|---|---|
| `token_digest` | string | NOT NULL, unique | `OauthClient.digest(raw)`。生値は発行応答にしか現れない |
| `oauth_client_id` | string | NOT NULL, FK | 起動対象アプリ。authorize で `client_id` と照合(横流し防止) |
| `patient_id` | string | NOT NULL | 起動時の患者(患者なし起動は残課題) |
| `encounter_id` | string | NULL | 診察中の Encounter |
| `practitioner_id` | string | NOT NULL | ログイン中の医療者(client `users.practitioner_fhir_id`) |
| `need_patient_banner` | boolean | NOT NULL, default false | 別ウィンドウ表示のとき true(トークン応答に写す) |
| `issued_by` | string | NULL | 監査表示用(`"fhir-client"`)。認証には使わない |
| `expires_at` | datetime | NOT NULL, index | 発行 + 5 分 |
| `used_at` | datetime | NULL | authorize で消費した時刻 |

既存テーブルの変更:

| テーブル | 変更 |
|---|---|
| `authorization_codes` | `user_id` を nullable に。`practitioner_id` string、`encounter_id` string、`launch_context_id` bigint(FK、`on_delete: :nullify`)を追加 |
| `refresh_tokens` | `user_id` を nullable に。`practitioner_id`、`encounter_id` を追加(`patient_id` NOT NULL は維持) |
| `access_tokens` | `practitioner_id`、`encounter_id` を追加 |
| `audit_events` | `agent_who_reference` string を追加(§2.9) |

モデル: `LaunchContext`(`include DigestedToken, SingleUseToken`、`TTL = 5.minutes`、`belongs_to :oauth_client`、
`self.issue(client:, patient_id:, encounter_id:, practitioner_id:, need_patient_banner:, issued_by:) -> [record, raw]`、raw は `SecureRandom.hex(32)`)。
`AuthorizationCode` / `RefreshToken` は `belongs_to :user, optional: true` にし、`user` か `practitioner_id` のどちらかを必須にする。
`AuthorizationCode.issue` は現在 `patient_id: user.patient_id` を内部で決めている(30 行)ので、呼び出し側から `patient_id:` を渡す形に変える。
`OauthClient` に `has_many :launch_contexts, dependent: :delete_all`(`Admin::OauthClientsController#dependent_counts` の件数にも加える)。

### 2.2 スコープの意味論(`Fhir::Scopes`、`OauthClient`)

- **［設計］** `user/` を有効にする(`USER_PATTERN = %r{\Auser/(\*|[A-Z][A-Za-z]*)\.([a-z*]+)\z}`)。v1 の read / write / * と v2 の cruds を受け、
  **書き込みも有効**。付与されるのは登録スコープの範囲だけ(authorize の既存検査 `(@scopes - @client.allowed_scopes).empty?`)。
- **［設計］** `user/` の到達範囲 = 「ログイン中の医療者が見られる範囲」。この EHR では施設内の全患者なので、**コンパートメント制限は掛けない**
  (`access_context` が nil)。ただし `system_allows?` は `system/` 専用のままにするので、`GET /_history`・`GET /AuditEvent`・`$export` は
  `user/` では引き続き 403。監査証跡と一括出力は医療者アプリに開かない。
- **［設計］** `launch` `launch/patient` `launch/encounter` を context scope に加える(`allows?` は満たさない。`offline_access` と同じ扱い)。
- **［設計］** `OauthClient` の登録検証: `patient/` と `user/` の **混在を禁止**(トークンの文脈判定を「`patient/` grant があるか」の一本にするため)。
  `user/` を持つクライアントも `redirect_uris` 必須・`system/` と混在不可(今の `patient/` の条件を「対話型 = patient か user」に広げる)。
  `launch` 系は `user/` か `patient/` の同伴が必要。
- **［設計］** `OauthClient#ehr_launchable?` = `launch_client? && allowed_scopes.include?("launch")`。**launch 発行はこれが真のクライアントにしか行わない。**
  管理者が `launch` を登録することが「EHR からの起動を許可する」スイッチになる。`/admin/oauth_clients` の応答に `ehr_launchable` を 1 キー足す。
- **［設計］** `Fhir::ScopeLabels` に `launch` 系の日本語ラベル、`/admin/scopes` に `user_access`(read / write / *)を足す(client のスコープ選択 UI 用)。

### 2.3 トークンの文脈と `access_context`

| トークンの grant | `patient_id` | `access_context` | 意味 |
|---|---|---|---|
| `patient/` のみ(standalone・EHR launch どちらも) | あり | `PatientContext` | 患者コンパートメントに閉じる(現状どおり) |
| `user/` のみ(EHR launch) | あり | nil | 制限なし。`patient` はトークン応答で文脈として渡すだけ |
| `system/` | なし | nil | 現状どおり |

- **［設計］** `access_context` の条件を `token.patient_context? && token.scope_set.patient_grants?` に変える。混在は登録時に弾くので、
  万一両方あれば制限側(fail closed)。
- **［設計］** `AccessToken#effective_scopes` で、`practitioner_id` の無いトークンの `user/` を落とす(`patient_id` の無い `patient/` と同じ規則)。
  さらに launch クライアントの `client_credentials` は `unauthorized_client` で拒否する。`user/` を有効にすると confidential な launch クライアントが
  `client_credentials` で利用者文脈なしの `user/` トークン(= 施設全体)を取れてしまうため、二重に塞ぐ。
- **［事実］** 書き込み経路(`fhir_resources_controller.rb` の create / update / patch / conditional_update)は `access_context` を見ていないので、
  `user/` の書き込みに追加の改修は要らない。スコープ検査は `authorize_interaction` の `[[resource_type, :write]]` で済む。
- **［要確認］** `bulk_exports_controller.rb` の `patient_context?` 分岐と `BundleProcessor`(`bundles_controller.rb` の `context: access_context`)が
  `user/` トークンでも意図どおりか。

### 2.4 launch 発行 API `POST /admin/launch_contexts`

認証は管理トークン(`Admin::BaseController`)。Backend Services の Bearer ではなく管理トークンにする理由:

- `system/` を持つ任意のクライアント(MCP サーバーなど B2B 全般)が「医療者 X として起動する」と主張できる権限は広すぎる。
  管理トークンは既に OAuth クライアントの発行・削除ができる root 相当で、「管理者が信頼した 1 本の中継(EHR)が医療者の身元を保証する」という
  今回の信頼モデルに一致する。
- `Admin::BaseController` の JSON 規約(`{error, error_description}` / `{errors}`)と、client 側の `FhirAdminGateway` + `UpstreamAdminRelay` の
  読み替えがそのまま使える。監査の actor も `admin-api` で揃う。
- 欠点は `admin/ip` 30/分が起動回数の上限になること。別枠にする(§2.9)。

リクエスト(`Content-Type: application/json`):

```json
{ "client_id": "4f3c…", "patient_id": "p-123", "encounter_id": "e-456",
  "practitioner_id": "pr-789", "need_patient_banner": false, "issued_by": "fhir-client" }
```

応答 201:

```json
{ "launch": "3b9f…(hex 64)", "expires_in": 300, "expires_at": "2026-10-18T09:05:00Z",
  "client_id": "4f3c…", "patient_id": "p-123", "encounter_id": "e-456", "practitioner_id": "pr-789" }
```

| 状況 | HTTP | ボディ |
|---|---|---|
| 管理トークン未設定 / 不一致 | 503 / 401 | 既存の `admin_api_disabled` / `unauthorized` |
| JSON の型不正 | 400 | `{error: "invalid_request", error_description}` |
| `client_id` が無い | 404 | `{error: "not_found"}` |
| クライアントが `ehr_launchable?` でない | 422 | `{errors: ["client is not registered for EHR launch (scope 'launch' is required)"]}` |
| `patient_id` / `practitioner_id` のリソースが無い・削除済み | 422 | `{errors: ["patient_id does not exist"]}` など |
| `encounter_id` が無い、または `subject` がその患者でない | 422 | `{errors: ["encounter_id does not belong to patient_id"]}`(［要確認］`subject` 列で照合できるか) |

### 2.5 `Oauth::BrowserController#authorize` の launch 分岐

- **［設計］** `AUTHORIZE_PARAMS` に `launch` と `aud` を足す。`params[:launch]` があれば EHR launch 分岐、無ければ従来の standalone(患者ログイン)。
- **［設計］** ステージ 1(`client_id` の存在、`redirect_uri` の完全一致。失敗は 400 の HTML を描画しリダイレクトしない)は共通。
  その後の検査はすべて `redirect_with_error`(`redirect_uri` は検証済み)で、順に:
  1. `params[:aud].to_s.chomp("/") == base_url` でなければ `invalid_request`(トークン取り違え攻撃の防御。SMART 2.x で必須)
  2. `@scopes` に `launch` が無ければ `invalid_scope`
  3. 全スコープが `valid_user? || valid_patient? || valid_context?`、資源スコープ(`user/` か `patient/`)が 1 つ以上
  4. `offline_access` を含めば `invalid_scope`(§4。`online_access` は許可)
  5. `(@scopes - @client.allowed_scopes).empty?`(既存)
  6. `LaunchContext.authenticate(params[:launch])` が nil / `expired?` / `used?` / `oauth_client_id != @client.id` → いずれも同じ
     `invalid_request "launch token is invalid or expired"`(区別しない)
  7. `launch/encounter` を要求されて `encounter_id` が無いときは無視して続行(文脈が無いだけ)
  8. `consume!` が false(並行消費)→ 6 と同じエラー
  9. `AuthorizationCode.issue(client:, user: nil, practitioner_id:, patient_id:, encounter_id:, launch_context:, scopes:, redirect_uri:, code_challenge:,
     code_challenge_method:, nonce:)` → `redirect_to_client(code:)`
- **［設計］** この分岐は **HTML を描画せず、セッションを読まず書かない**。iframe(サードパーティ文脈)で Cookie が無くても動く根拠。
- **［設計］** standalone 分岐は現状維持。`user/` や `launch` が来たら `invalid_scope`(医療者のログイン画面は無い、と明示する)。
- **［要確認］** standalone 分岐でも `aud` を必須にするか(既存クライアントの互換)。

### 2.6 token / refresh / id_token / introspect

`authorization_code` grant の応答:

```json
{ "access_token": "…", "token_type": "bearer", "expires_in": 3600,
  "scope": "launch openid fhirUser user/*.read",
  "patient": "p-123", "encounter": "e-456", "need_patient_banner": false,
  "id_token": "…", "refresh_token": "…(online_access のときだけ)" }
```

- **［設計］** `AccessToken` / `RefreshToken` に `practitioner_id` `encounter_id` を通し、**refresh でも引き継ぐ**。refresh の応答にも `patient` `encounter`。
  `need_patient_banner` は `code.launch_context&.need_patient_banner`(standalone では省略)。
- **［設計］** `Fhir::IdToken`: 医療者のとき `fhirUser = "{issuer}/Practitioner/{id}"`、`sub = "Practitioner/{id}"`(患者の `sub` は `user.id` の文字列で
  変えない。整数文字列と FHIR id の衝突を避けるため医療者側に接頭辞を付ける)。
- **［設計］** introspect の応答に `encounter` と `fhirUser`(医療者は Practitioner、患者は Patient、system は省略)。
- **［設計］** `fhirContext`(SMART 2.2 の `{reference, role}` 配列)は `encounter` と重複するので今回は返さない(残課題)。

### 2.7 discovery(`/.well-known/smart-configuration`)

- `scopes_supported` に `user/*.read user/*.write user/*.* user/*.rs user/*.cud user/*.cruds launch launch/patient launch/encounter`。
- `capabilities` に `launch-ehr context-ehr-patient context-ehr-encounter permission-user context-banner`。
- 「EHR launch is not implemented」のコメントを消す。`/metadata` の `oauth-uris` 拡張は変更不要。

### 2.8 CORS

- **［事実］** public client の SPA はブラウザから `POST /oauth/token` と FHIR API を叩くので CORS が要る。confidential(サーバー側)のアプリには要らない。
- **［設計］** `rack-cors` を有効にし、**Bearer 専用パスだけ** `origins "*"`, `credentials: false`:
  `/oauth/token`(POST)、`/oauth/revoke`(POST)、`/.well-known/*`、`/metadata`、FHIR リソースのパス(`/oauth/`・`/admin/`・`/up` を除く)。
  `expose` に `ETag Location Content-Location WWW-Authenticate Retry-After`。
  Cookie を使う `/oauth/authorize|login|consent`、管理 API、クライアント認証が要る `/oauth/introspect` は対象外。
- **［設計］** オリジン許可リストにしない。public client のアプリは任意のオリジンにあり得て、Cookie を一切使わない(`credentials: false`)前提では `*` の方が
  単純で安全側。
- **［設計］** ミドルウェアは rack-attack より前(`insert_before 0`)に置き、preflight(Authorization 無し)が `api/ip` 120/分に数えられないようにする。
- **［事実］** `Cross-Origin-Resource-Policy: same-origin` は CORS モードの `fetch` には効かないので維持できる。`<img src="{iss}/Binary/…">` のような
  no-cors 読込は塞がれたまま(残課題)。

### 2.9 レート制限・保守・監査・spec・docs

- **rack-attack**: `/admin/launch_contexts` を `admin/ip` から外し `admin-launch/ip`(既定 120/分、env `FHIR_RATE_LAUNCH_IP`)。`launch` 付きの
  `GET /oauth/authorize` は `oauth-browser/ip` から外し `oauth-launch/client`(`client_id` 単位、120/分)。病院の NAT では全医療者が同一 IP になるため。
- **保守**: `maintenance:purge_expired` に `LaunchContext.where("expires_at < ?", 1.day.ago).delete_all`。
- **ログ**: `filter_parameters` に `launch` `code` `code_verifier` `code_challenge` を足す(現状は `:token` `:secret` 等のみ)。
- **監査(AuditEvent)**:
  - 発行: `Admin::LaunchContextsController` は `FhirAuditing` を継承し、actor `admin-api`、`entity` = `LaunchContext/{id}`(トークンは載せない)。
  - authorize: `Oauth::BrowserController` に `FhirAuditing` を足す(standalone の login / consent も監査対象になる。望ましい副作用)。
  - 帰属: `audit_events.agent_who_reference` を追加し、`record_audit_event` で `@current_access_token` から `Practitioner/{id}`(患者なら `Patient/{id}`)を
    入れ、`to_fhir` の `agent[0].who.reference` に出す。「どのアプリが(client)・誰として(agent)・何を」が追える。
- **spec**(`spec/requests/` 直下の既存配置に合わせる): 新規 `smart_ehr_launch_spec.rb`(発行 → authorize が HTML を出さず 302 → コード交換 → 文脈と
  `fhirUser` → `user/` で他患者が読める・`AuditEvent` は 403・`user/*.cud` なら POST できる・`patient/` 登録なら他患者は 404。異常系: 期限切れ・再利用・
  `client_id` 不一致・`aud` 不一致・`launch` スコープ無し・`offline_access`・standalone 分岐で `user/`)、`admin/launch_contexts_spec.rb`、新規 `cors_spec.rb`。
  既存の `oauth_tokens_spec`(launch クライアントの client_credentials 拒否)、`oauth_refresh_tokens_spec`(引き継ぎ)、`oauth_introspections_spec`、
  `oauth_openid_connect_spec`(fhirUser = Practitioner)、`oauth_token_auditing_spec`(`agent_who_reference`)、`rack_attack_spec`、`spec/lib/fhir/scopes_spec`、
  `spec/models/oauth_client_spec` に追記。`spec/support/fhir_auth_helper.rb` に `issue_user_token(practitioner_id:, patient_id:, scopes:)`。
- **docs**: `docs/api-guide.md` の standalone 節の後に「SMART EHR launch」節(発行 API・authorize パラメータ・応答例・CORS)、`docs/ARCHITECTURE.md` の
  シーケンス図、`.env.production.example` に `FHIR_RATE_LAUNCH_IP`。

## 3. client の設計

### 3.1 backend

**`smart_apps`**(新規テーブル)

| 列 | 型 | 制約 |
|---|---|---|
| `name` | string | NOT NULL |
| `client_id` | string | NOT NULL, unique(上流 OAuth クライアントの id。`Admin::OauthClientsController::ID_PATTERN` と同じ形式) |
| `launch_url` | string | NOT NULL。絶対 URL、`https` 必須(development は `http` 可) |
| `display` | string | NOT NULL, default `embed`(`embed` / `window`) |
| `enabled` | boolean | NOT NULL, default true |
| `position` | integer | NOT NULL, default 0 |

**`FhirConnectionSettings.public_base_url`**(列追加): ブラウザから見た上流の URL(= SMART の `iss`)。`effective` は DB → env
`FHIR_SERVER_PUBLIC_BASE_URL` → `base_url` の順で決める。**［事実］** 上流の issuer / `aud` 照合はリクエストの Host 由来なので、
ブラウザが実際に使うホスト名と末尾スラッシュ無しで完全一致させる。`WakeupController#probe_url`(ブラウザから叩く URL)もこの値に揃える。
接続設定画面(`pages/ConnectionSettingsPage.tsx`)に項目「ブラウザから見た FHIR サーバー URL」。

**ルート**(新しいトップレベル `/smart_apps` → `frontend/vite.config.ts` の proxy と `render.yaml` の rewrite に `/smart_apps` `/smart_apps/*` を追加。
SPA の管理ページは `/smart-apps` にして衝突を避ける):

```ruby
namespace :admin do
  resources :smart_apps, only: %i[index create update destroy]   # 管理者(Admin::BaseController)
end
resources :smart_apps, only: :index do                            # 利用者(UserAuthentication)
  post :launch, on: :member
end
```

- `Admin::SmartAppsController`: CRUD。応答 `{total, items: [{id, name, client_id, launch_url, display, enabled, position, updated_at}]}`、422 は `{errors}`。
  **本番で `ADMIN_TOKEN` 未設定なら 503**(`Admin::OauthClientsController` の `require_admin_auth_configured!` と同じ。起動 URL の差し替えは
  フィッシングの導線になるので無認証で開けない)。
- `SmartAppsController`: `GET /smart_apps` は enabled を `position, id` 順で `{items: [{id, name, display}]}`。`POST /smart_apps/:id/launch`:

| 状況 | HTTP | ボディ |
|---|---|---|
| 未ログイン | 401 | 既存 |
| `current_user&.practitioner_fhir_id` が無い(administrator、認証なしモード) | 403 | `{error: "practitioner_required"}` |
| `patient_id` 空 | 400 | `{error: "patient_id is required"}` |
| アプリ無し / disabled | 404 | `{error: "not_found"}` |
| 管理トークン未設定(`FhirAdminGateway::NotConfigured`) | 503 | `{error: "FHIR 管理トークンが未設定です"}` |
| 上流 401 / 403 / 5xx、接続失敗 | 502 | `{error: "FHIR サーバーが起動要求を拒否しました (HTTP n)"}` |
| 上流 404 / 422(クライアント削除済み・`launch` 未登録・患者不在) | 422 | 上流の `errors` を透過 |
| 成功 | 200 | `{launch_url: "https://app.example/launch?iss=…&launch=…", display: "embed", expires_in: 300}` |

- `SmartLaunchIssuer`(`app/services/`): `FhirAdminGateway` で `POST /admin/launch_contexts`(`need_patient_banner: app.display == "window"`,
  `issued_by: "fhir-client"`)、`launch_url` の既存クエリに `iss`(`public_base_url.chomp("/")`)と `launch` を merge して返す。
- **［事実］** 認証なしモード(`ADMIN_TOKEN` 未設定)では `current_user` が nil なので、EHR launch は **ログイン有効時のみ**使える。dev は compose の
  `ADMIN_TOKEN` が入っているので医療者アカウントでログインすればよい。

### 3.2 frontend(API 層・管理画面)

- `api/adminClient.ts` / `api/adminQueries.ts`: `SmartApp` 型と CRUD(`/admin/smart_apps`)、`useSmartApps` / `useCreateSmartApp` / `useUpdateSmartApp` / `useDeleteSmartApp`。
- `api/smartAppsClient.ts` + `api/queries/smartApps.ts`(`index.ts` で再 export): `useLaunchableSmartApps()`(`GET /smart_apps`)と
  `useLaunchSmartApp()`(`POST /smart_apps/:id/launch`、CSRF ヘッダは `api/session.ts` の `withCsrfHeaders` を共用)。
- 管理ページ `pages/SmartAppsPage.tsx` + `components/SmartAppForm.tsx`: 名称 / OAuth クライアント(`useOauthClients()` の `kind === "launch"`、
  `ehr_launchable` があればそれで絞る select)/ 起動 URL / 表示(埋め込み・別ウィンドウ)/ 有効 / 並び順。行の削除はゴミ箱アイコン、ボタンは「登録」「取消」。
  `App.tsx` の管理メニューに「SMART アプリ」、ルートは `<AdminGate>` の中。
- `OauthClientCreateForm` / `ScopeSelector`: launch 形に `user/`(read / write / *)と `launch` 系の選択肢(`/admin/scopes` の `user_access` と `context_scopes` から)。

### 3.3 カルテ「アプリ」タブ

- `karteUrl.ts`: `KARTE_TABS` に `{ key: "smart-apps", label: "アプリ" }`、`KARTE_TAB_GROUPS` の「その他」に入れる。
- `KartePage.tsx` の `renderTabPanel`: `<KarteSmartAppsTab {...props} encounterId={examEncounter?.id} />`(外来の診察中 Encounter。
  入院中の Encounter を渡すかは実装時に決める ［要確認］)。
- `components/KarteSmartAppsTab.tsx`(props `{patientId, view, onViewChange, encounterId?}`):
  - `view` = 選択中のアプリ id(他タブの `?view=` と同じ作法)。左にアプリのボタン列、右に iframe。未選択なら空状態。
  - 起動は `[patientId, appId, encounterId]` が変わるたび(launch は単回使用なので患者を切り替えたら必ず新しい launch)。`<iframe key={launch}>` で作り直す。
    進行中フラグで多重起動を防ぐ。失敗は `ErrorBanner`。
  - 「再起動」ボタン: iframe 内でアプリが F5 すると消費済みの launch で `invalid_request` になるので、その復旧手段。
  - `display === "window"`: iframe は出さず「開く」ボタン。ポップアップブロック対策にクリック時に `window.open("", "_blank", "noopener")` を先に開き、
    応答後に `location` を差し替える。
  - iframe の属性:

    | 属性 | 値 | 理由 |
    |---|---|---|
    | `sandbox` | `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads` | SPA を動かす。PKCE の verifier / state を sessionStorage に置くため自身のオリジン扱いが要る(`allow-same-origin` が無いと opaque origin になり storage も CORS も壊れる)。**`allow-top-navigation` は付けない**(アプリが EHR 本体を遷移させられないように) |
    | `allow` | `clipboard-write` | 既定で十分。カメラ等は要求されたとき個別に |
    | `referrerpolicy` | 既定(`strict-origin-when-cross-origin`) | 患者 id 入りの EHR URL がパスごと漏れない |
    | `title` | アプリ名 | a11y |

- **アプリ側への要件**(登録時の運用。画面には書かない): 自身の応答に `Content-Security-Policy: frame-ancestors <EHR のオリジン>` を出す
  (`X-Frame-Options: DENY / SAMEORIGIN` を出さない)。EHR 側で枠内表示を強制する手段は無い。
- **［事実］** 上流のステージ 1 エラー(400 の HTML)は `X-Frame-Options: DENY` のため枠内に描画されず空白になる。タブに「表示されないときは再起動」の
  一行だけ出す(フォーム外なので可)。

## 4. セキュリティ

| 論点 | 設計 |
|---|---|
| launch トークン | `SecureRandom.hex(32)`、SHA-256 ダイジェスト保存、5 分、`SingleUseToken#consume!`(`UPDATE … WHERE used_at IS NULL`)で単回。並行消費は再生扱い |
| client_id 束縛 | 発行時に `oauth_client_id` を保存し authorize で照合。別アプリへの横流し不可 |
| `aud` 検証 | EHR launch 分岐で `aud == issuer` を必須に。別サーバーの issuer を名乗るトークン取り違えを防ぐ |
| open redirect | 既存のステージ 1(`client_id`・`redirect_uri` 完全一致、失敗は 400 を描画)を踏襲。launch 分岐も検証前にはリダイレクトしない |
| iframe | §3.3 の `sandbox`。`allow-top-navigation` 無し。アプリは `frame-ancestors` で EHR オリジンだけ許可 |
| 第三者 Cookie 不要 | authorize の launch 分岐はセッションを読まず書かない。トークンは Bearer。CORS は `credentials: false`。ブラウザがサードパーティ Cookie を全ブロックしても動く |
| トークン寿命と EHR ログアウト | access 1 時間、`online_access` の refresh 12 時間。EHR からログアウトしてもアプリのトークンは失効しない(SMART でも連動しない)。緩和: `offline_access` を launch 分岐で拒否(30 日の長期保持を作らない)、アプリはトークンをメモリ / sessionStorage に置く(登録時の要件)。医療者単位の失効 API は残課題 |
| `offline_access` | **拒否**(`invalid_scope`)。EHR 起動の文脈はその場限りで、医療者が自分で取り消す UI も上流に無い。`online_access` は許可 |
| client_credentials の悪用 | launch クライアントの `client_credentials` を拒否 + `effective_scopes` で practitioner 文脈の無い `user/` を落とす(二重) |
| `user/` の到達範囲 | コンパートメント無し(施設内全患者)。ただし `_history`・`AuditEvent`・`$export` は不可。書き込みは登録スコープどおり |
| 身元の保証 | 医療者の実在は上流が `Practitioner` の存在で検証。「ログイン中である」ことの保証は client のセッション(`authorize_user!` + CSRF)と管理トークンの保有に依存する。**EHR(client backend)を信頼する**前提 |
| 管理画面の権限 | `smart_apps` CRUD は管理者、本番で `ADMIN_TOKEN` 未設定なら 503。launch は利用者認証 + practitioner 必須。administrator は起動不可 |
| レート制限 | §2.9。管理トークンの試行は `admin/ip` のまま、launch 発行は別枠、authorize の launch 分岐は `client_id` 単位 |
| ログ | `launch`・`code`・`code_verifier`・`code_challenge` を params フィルタに追加。Rails ログに生値を出さない |

## 5. 検証手段

### 5.1 最小 SMART アプリ `frontend/public/smart-demo/index.html`

**［設計］** 依存ゼロの素の JS 1 ファイル(〜150 行)。Vite が `public/` をそのまま配信し(`/smart-demo/index.html`)、Render の static でも `dist` に入る。
EHR と同一オリジンなので `frame-ancestors` の問題無しに「launch → authorize 302 → code → token(CORS)→ FHIR(CORS)」を一通り通せる。
院内開発の小画面の雛形にもなる。

1. `iss` `launch` をクエリから読み、`GET {iss}/.well-known/smart-configuration`。
2. PKCE(`crypto.getRandomValues` + `crypto.subtle.digest("SHA-256")`)、`state`。verifier / state / iss を sessionStorage に保存。
3. `authorization_endpoint` へ `response_type=code&client_id&redirect_uri(自分の URL)&scope=launch openid fhirUser user/Patient.read user/Encounter.read
   user/Observation.read&state&aud={iss}&launch&code_challenge&code_challenge_method=S256` で `location.replace`。
4. 戻り(`?code=`)で `POST token_endpoint`(`grant_type=authorization_code`, `client_id`, `redirect_uri`, `code_verifier`)。`patient` `encounter`
   `need_patient_banner` と `id_token` の payload(`fhirUser`。署名検証は省略と明記)を表示。
5. `GET {iss}/Patient/{patient}` で氏名、`GET {iss}/Encounter/{encounter}`、`GET {iss}/Observation?patient=…&_count=5`。
6. `?error=` はそのまま表示。再起動の導線は EHR 側の「再起動」に任せる。

登録手順: OAuth クライアント画面で launch 形・public・`redirect_uris = http://localhost:5173/smart-demo/index.html`・
scopes `user/Patient.read user/Encounter.read user/Observation.read launch openid fhirUser` を登録 → SMART アプリ画面で
`launch_url = http://localhost:5173/smart-demo/index.html`、display = embed。

代替案: (i) 上流の request spec だけ — ブラウザ由来の論点(preflight・iframe・sessionStorage・frame-ancestors)が検証できないので併用が前提。
(ii) 別オリジンで配信(`npx serve -l 8089 --cors` 等で同じファイルを配り、`redirect_uri` をそのオリジンで追加登録)— **`frame-ancestors` と
「第三者 Cookie 不要」を本当に試すには別オリジンが要る**。常用は同一オリジン、必要時だけ別オリジン。(iii) 公開サンプル(SMART Health IT の
Growth Chart 等)— https 公開 URL が要り、`http://localhost:3000` の iss を受け付けないものが多いので不採用。

### 5.2 dev 環境

- 上流: `FHIR_AUTH_ENABLED=true FHIR_ADMIN_TOKEN=$(openssl rand -hex 32)` で起動(`../fhir-server/docker-compose.yml`)。認証 OFF でも launch → token は
  動くが、`user/` と `patient/` の差(コンパートメント)は認証 ON でしか確認できない。`OIDC_SIGNING_KEY` 未設定でも dev は一時鍵で可。
- client: `docker-compose.yml` の backend に `FHIR_SERVER_PUBLIC_BASE_URL: http://localhost:3000`(`FHIR_SERVER_BASE_URL` は `host.docker.internal` のまま)。
  接続設定画面で上流の `FHIR_ADMIN_TOKEN` と Backend Services の client_id / secret を入れる。
- **［事実］** ブラウザで `127.0.0.1:3000` を使うと `aud` が issuer(`localhost:3000`)と一致せず `invalid_request` になる。切り分けの注意として記録。

### 5.3 確認項目

1. 医師でログインし、患者 A のカルテ > アプリ > demo を選ぶ → 氏名 A と `fhirUser = Practitioner/<自分>` が出る。
2. 患者 B に切り替える → 再 launch して B になる(古い患者が残らない)。
3. iframe 内で F5 → 消費済みで `invalid_request` → 「再起動」で復旧する。
4. `user/*.read` のトークンで `GET {iss}/AuditEvent` → 403。`GET /Patient/B`(別患者)→ 200。
5. `patient/*.read` で登録したクライアントでは `GET /Patient/B` → 404 / 空。
6. 別オリジンで配信し `frame-ancestors` を外す → ブラウザがブロックする(付けると表示される)。
7. ブラウザのサードパーティ Cookie を全ブロックしても 1 が通る。
8. `administrator` でログインするとアプリタブは 403(「医療従事者でログイン」)を表示する。
9. 上流 rspec と client rspec が通る。`tsc -b`、lint。

### 5.4 検証結果(2026-10-18、開発環境・医師 一郎でログイン)

- 上流 rspec 2226 例・client rspec 全件・`tsc -b`・lint が通る(新規 spec: 上流 `smart_ehr_launch_spec` / `admin/launch_contexts_spec` /
  `cors_spec` / rack-attack の別枠、client `smart_apps_spec` / `admin/smart_apps_spec` / `models/smart_app_spec`)。
- カルテ「その他 → アプリ」で同梱の demo を起動: 上流の authorize が HTML を出さず 302 → token → `fhirUser = Practitioner/<一郎>`、
  テスト太郎の氏名と直近の Observation 5 件が枠内に出る(`need_patient_banner: false`)。CORS の preflight は `*` で通る。
- 患者を切り替える(テスト 20260923)と新しい launch で起動し直し、別の患者が残らない。「再起動」で 3 本目の launch が発行される。
  上流の `launch_contexts` は 3 行とも消費済み、`audit_events` の authorize 行に `agent_who_reference = Practitioner/…` が入る。
- 期限切れ・再利用・client_id 不一致・aud 不一致・`offline_access`・standalone 分岐での `user/`、`patient/` 登録時のコンパートメント、
  `user/` での `AuditEvent` 403 と登録時だけの書き込みは上流の request spec で確認。
- 上流は `FHIR_AUTH_ENABLED=false` のままなので、FHIR 読み取りの監査行にはトークンの帰属が付かない(認証 ON なら付く。spec で確認)。

## 6. 採らなかった案

| 案 | 不採用の理由 |
|---|---|
| client backend がトークンを代理取得して iframe に渡す(`postMessage` / URL fragment) | アプリの PKCE・クライアント認証が無意味になり、EHR が全アプリのトークンの発行者兼保管者になる。SMART 準拠の既製アプリが動かない。トークンが EHR のログに残る |
| 上流に医療者アカウント(`User`)を複製し、ログイン・同意画面を通す | 上流 `User` は患者 1:1 で設計が違う。パスワードの二重管理と同期が要る。iframe 内のログイン画面はサードパーティ Cookie に依存して壊れやすい。standalone の医療者ログインを作るときに別途検討(§7) |
| EHR launch でも同意画面を出す | 起動のたびに同意が入ると診療の動線が止まる。管理者がクライアント登録でスコープを決めており、同意の主体(施設)は既に同意している。患者向け standalone とは信頼モデルが違う |
| launch 発行を Backend Services の Bearer(`POST /oauth/launch`)で行う | §2.4。`system/` を持つ任意の B2B クライアントが医療者の身元を主張できてしまう |
| iframe を使わず常に別ウィンドウ | 患者切替と同期できず、別ウィンドウに古い患者が残る事故が起きる。`display` で選べるようにし既定は埋め込み |
| `aud` 検証を省く | トークン取り違え攻撃の防御線が無くなる。SMART 2.x は必須 |
| `fhirContext` を今回から返す | `encounter` と重複。R4 での形式が IG の版で揺れている |
| CORS をオリジン許可リストにする | public client のアプリは任意のオリジンにあり得る。Bearer 専用パスで `credentials: false` なら `*` の方が安全側に単純 |
| launch トークンを JWT(自己完結)にする | 既存の 3 トークンすべて opaque + ダイジェストで、単回使用の判定に DB が要るので利点がない |

## 7. 残課題

1. **患者なし起動**(`launch_contexts.patient_id` を nullable に、`launch/patient` を要求されたときの患者選択 UI、`refresh_tokens.patient_id` NOT NULL の緩和、アプリメニューからの起動)。
2. **standalone の医療者ログイン**(client の `/auth/session` を IdP にする OIDC 連携か、上流に Practitioner 連動の `User` を作るか)。
3. ~~CDS Hooks~~ — `patient-view` と `appContext` 付きの launch は `cds-hooks-design.md` で対応済み(2026-10-18)。
4. **SMART Health Links** との関係整理(患者向け共有は別の信頼モデル)。
5. **Subscriptions**(`server-improvement-backlog.md` L-3)との関係: アプリが rest-hook を受けるにはトークン寿命を超える購読が要り、`offline_access` 拒否と
   矛盾する。購読は `system/` クライアント側で行う前提にする。
6. **医療者単位のトークン失効**(EHR ログアウト・退職時。`DELETE /admin/launch_contexts?practitioner_id=` → `authorization_codes.practitioner_id` から `revoke_issued_tokens!`)。
7. `fhirContext`(`{reference, role}` 配列)と `smart_style_url`。
8. **Binary 等の no-cors 読込**(CORP same-origin のため `<img>` 直読み不可。アプリは `fetch` + Blob URL で読む要件にするか、上流で `/Binary` のみ CORP を緩めるか)。
9. 上流のエラーページが iframe で空白になる問題(launch 分岐の 400 HTML に限り `X-Frame-Options` を外す / `frame-ancestors` を設定値で許可するか)。
10. standalone 分岐の `aud` 必須化(互換の切り方)。
11. `AuditEvent` の `agent_who_reference` を検索パラメータにする(`agent` 検索の拡張)。
12. 病院 NAT 配下での rack-attack 既定値の見直し(運用で `FHIR_RATE_*` を上げる手順)。

## 8. 主なファイル(実装時)

| 場所 | ファイル | 役割 |
|---|---|---|
| 上流 | `app/controllers/oauth/browser_controller.rb` | launch 分岐・`aud` 検証・監査 |
| 上流 | `app/lib/fhir/scopes.rb`、`app/models/oauth_client.rb` | `user/`・`launch` の意味論、混在禁止、`ehr_launchable?` |
| 上流 | `app/controllers/application_controller.rb`、`app/models/access_token.rb` | `access_context` の分岐、`effective_scopes` |
| 上流 | `app/controllers/oauth_tokens_controller.rb`、`app/lib/fhir/id_token.rb`、`oauth_introspections_controller.rb` | 文脈の応答、`fhirUser` |
| 上流 | `app/models/launch_context.rb`、`app/controllers/admin/launch_contexts_controller.rb`(新規) | launch の保存と発行 API |
| 上流 | `app/controllers/smart_configurations_controller.rb`、`config/initializers/cors.rb`、`rack_attack.rb`、`filter_parameter_logging.rb` | discovery・CORS・制限・ログ |
| client | `backend/app/models/fhir_connection_settings.rb`、`admin/fhir_connection_settings_controller.rb`、`wakeup_controller.rb` | `public_base_url` |
| client | `backend/app/models/smart_app.rb`、`services/smart_launch_issuer.rb`、`controllers/smart_apps_controller.rb`、`admin/smart_apps_controller.rb`(新規) | アプリ台帳と起動 |
| client | `backend/config/routes.rb`、`frontend/vite.config.ts`、`render.yaml` | `/smart_apps` |
| client | `frontend/src/karteUrl.ts`、`pages/KartePage.tsx`、`components/KarteSmartAppsTab.tsx`(新規) | 「アプリ」タブ |
| client | `frontend/src/pages/SmartAppsPage.tsx`(新規)、`App.tsx`、`api/adminClient.ts`、`api/adminQueries.ts`、`api/queries/smartApps.ts`(新規) | 管理画面と API 層 |
| client | `frontend/public/smart-demo/index.html`(新規) | 検証用の最小 SMART アプリ |
