# CDS Hooks(外部の判断支援サービスの呼び出しとカード表示)

`docs/functional-gap-backlog.md` §5.1「外部アプリと判断支援を差し込む標準の経路」と `smart-app-launch-design.md` §7 の残課題 3。
**状態: 実装済み(2026-10-18)。hook は `patient-view` と、処方オーダーの `order-select` / `order-sign`。**
カルテを開いたときに、登録した外部の CDS サービス(CDS Hooks 2.0)を backend から呼び、返ってきたカードを患者帯の
ピクトグラム(吹き出し)に出す。サービスへのデータは prefetch で backend が同梱する。提供元に委任クライアントを紐づけたときだけ、
読み取り専用・5 分の短命トークンを `fhirAuthorization` で渡し、サービスが自分で上流を読めるようにする(§2.6)。
カードのリンク(`smart`)は `smart-app-launch-design.md` の EHR launch に `appContext` を添えて起動する。

- **［事実］** = 規格(https://cds-hooks.hl7.org/2.0/)、上流・このリポジトリの実装で確認した内容
- **［設計］** = 本ドキュメントの決めごと
- **［要確認］** = 実装時・運用で確かめること

ユーザー決定(2026-10-18): (1) hook は `patient-view` から始め、同日に処方の `order-select` / `order-sign` を追加(§3.3)、(2) データは prefetch のみ(`fhirAuthorization` は渡さない)、
(3) カードは情報・リンク・無視理由(feedback)まで。提案(suggestion)は内容を表示するだけでリソースは作らない、
(4) 表示は患者帯のピクトグラム「判断支援 N」+ 吹き出し(帯の下に常時出す案は採らない)。

## 0. 実装前の状態(設計時の前提)

- 外部 API は `Integrations::*`(Faraday、`EventLog` の JSON Lines、`Integrations::Error / NotConfigured / Unreachable / Rejected / NotFound`)。
  `Integrations::FhirStore` が上流の読み書きの薄い層(`search` は `link[next]` を追う、`Prefer: handling=strict`)。
- `ExternalSystemConnection` はシステムごとに 1 行で、複数のエンドポイントは持てない。
- 患者帯のピクトグラムは `components/PatientHeader.tsx` の `PatientPictogramStrip` に並び、`PictogramPopover`(クリックで開き外側クリックで閉じる、
  **中を押しても閉じる**)で吹き出しを出す。図柄は `icons/cautionPictograms.tsx` の `CAUTION_PICTOGRAM_KEYS`。
  同じ帯は一覧の患者ドロワーでも使う(そこで外部を呼んではいけない)。
- Markdown のレンダラは frontend に無い(`dompurify` はある)。無視理由の定型文マスタも無い。
- SMART の EHR launch(`smart_apps`、`POST /smart_apps/:id/launch`、上流 `launch_contexts`)は実装済みだが `appContext` は無い。

## 1. 全体の流れ

1. **［設計］** カルテを開くと frontend が `POST /integrations/cds/patient_view {patient_id}` を呼ぶ(利用者認証 + CSRF)。
   紐づく医療者が無いログイン(`administrator`・認証なし)では backend は呼ばずに空を返す(`context.userId` が決まらない)。
2. **［設計］** backend は有効な `cds_services`(= サービス提供元の URL)ごとに discovery(`GET {base_url}/cds-services`、5 分キャッシュ)を読み、
   `hook == "patient-view"` のサービスを選ぶ。サービスごとに prefetch テンプレートを施設トークンで解決し、
   `POST {base_url}/cds-services/{id}` にリクエストを送る(提供元ごとに並列、1 本 10 秒)。
3. **［設計］** 返ってきたカードを正規化して(§2.4)まとめ、`{cards, services}` を返す。失敗した提供元は `services[].status` に残すだけでカードは無し
   (判断支援の失敗で診療を止めない)。
4. **［設計］** frontend は患者帯に「判断支援 N」のピクトグラムを出し(0 件なら出さない)、吹き出しにカードを並べる。
   リンク `smart` はアプリタブに切り替えて `appContext` 付きで起動、`absolute` は別タブ。「無視」は理由を選ぶとサービスの
   `feedback` に `overridden` を送り、カードを吹き出しから消す。

リクエスト(CDS Hooks 2.0 の `patient-view`):

```json
{ "hookInstance": "<uuid>", "fhirServer": "<ブラウザから見た上流の URL>", "hook": "patient-view",
  "context": { "userId": "Practitioner/<id>", "patientId": "<id>", "encounterId": "<id>" },
  "prefetch": { "patient": { "resourceType": "Patient", ... }, "meds": { "resourceType": "Bundle", ... } } }
```

`fhirAuthorization` は提供元に委任クライアントがあるときだけ付ける(§2.6)。`encounterId` は外来の診察中のときだけ(カルテが持つ `examEncounter`)。

## 2. backend

### 2.1 テーブル `cds_services`

| 列 | 型 | 内容 |
|---|---|---|
| `name` | string | 提供元の表示名 |
| `base_url` | string | `/cds-services` を持つ URL(絶対、本番は https) |
| `auth_token` | string(暗号化) | 任意。あれば `Authorization: Bearer` で送る。ブラウザへは有無だけ返す |
| `enabled` | boolean | |
| `position` | integer | 呼ぶ順(カードの並び順) |

1 行が 1 提供元で、提供元が複数のサービス(`id`)を持つ。サービスの一覧は保存せず discovery で読む(提供元がサービスを足しても登録不要)。

### 2.2 API

| パス | 認証 | 内容 |
|---|---|---|
| `GET/POST/PATCH/DELETE /admin/cds_services` | 管理者(本番で `ADMIN_TOKEN` 未設定なら 503) | 台帳の CRUD。`auth_token` は書き込み専用 |
| `GET /admin/cds_services/:id/discover` | 管理者 | discovery をその場で読んで `{services: [{id, hook, title, description, prefetch}]}` を返す(登録の確認用) |
| `POST /integrations/cds/patient_view {patient_id, encounter_id?}` | 利用者 | §1 の呼び出し。`{cards, services: [{id, name, status}]}` |
| `POST /integrations/cds/order_select {patient_id, draft_orders, selections}` | 利用者 | §3.3。`selections` は `draft_orders` の中のオーダー("MedicationRequest/<id>")に限る |
| `POST /integrations/cds/order_sign {patient_id, draft_orders}` | 利用者 | §3.3 |
| `POST /integrations/cds/feedback {service_id, service, card, outcome, override_reason?, user_comment?}` | 利用者 | `POST {base_url}/cds-services/{service}/feedback` に転送。サービスの失敗は 204 のまま(ログに残す) |

`/integrations/` は vite proxy と `render.yaml` に登録済みなので追加不要。

### 2.3 `Integrations::Cds`

- `Client`(Faraday、open 2 秒 / 10 秒、再送なし): `discover`、`invoke(service_id, body)`、`feedback(service_id, body)`。
  非 2xx は `Rejected`、接続失敗は `Unreachable`。`EventLog.for("cds_hooks")` に提供元・サービス・所要時間・カード数(本文は `INTEGRATION_LOG_BODIES`)。
- `Discovery`: 提供元ごとの `GET /cds-services` を 5 分だけプロセス内に持つ(`ExternalSystemConnection` と同じ TTL キャッシュ)。
  管理画面の「探索」は キャッシュを使わない。
- `Prefetch`: テンプレートの `{{context.patientId}}` `{{context.userId}}` `{{context.encounterId}}` を置換し、`FhirGateway` で GET する。
  - **［設計］** 読めるのは `FhirProxyController::ALLOWED_RESOURCE_TYPES` の型だけ(`AuditEvent` など画面が読まないものは渡さない)。
    `_count` が無い検索は `_count=100` を補う。
  - **［事実］** 規格では満たせないテンプレートは省略してよい。`encounterId` が無いとき・型が許可外のとき・上流が 2xx 以外のときは
    その key を省く(サービスは無い前提で振る舞う)。
- `Invocation`(hook 名を受ける): 提供元 → discovery → その hook のサービスごとに prefetch を解決 → 提供元ごとにスレッドで `invoke` →
  `Cards.normalize`。提供元 1 つの失敗はその提供元のカードが無いだけ。context は共通の `userId` / `patientId` / `encounterId` に、
  hook 固有の `selections` / `draftOrders` を足す。
- `draft_orders` の検査(コントローラ): `Bundle` で、entry は id 付きの `MedicationRequest` だけ、100 件まで、`subject` が `patient_id` の患者。
  prefetch のテンプレートに `{{context.draftOrders...}}` は使えない(埋まらないので省く)。

### 2.4 カードの正規化(`Cards`)

サービスの応答をそのまま画面に出さず、画面が使う形だけに写す:

| 項目 | 規則 |
|---|---|
| `uuid` | 無ければ生成(feedback の宛先になるので必須) |
| `summary` | 必須。140 字で切る |
| `detail` | 任意。**プレーンテキストとして出す**(Markdown のレンダラは足さない。残課題) |
| `indicator` | `info` / `warning` / `critical` 以外は `info` |
| `source` | `label`(無ければ提供元の名前)、`url`、`topic.display` |
| `links` | `type` が `absolute` なら `url` は http(s) の絶対 URL に限る。`smart` なら登録済み `smart_apps.launch_url`(クエリを除く)と一致するアプリを探し `smart_app_id` を添える。一致しなければ `smart_app_id: null`(画面は「未登録のアプリ」として押せない)。`appContext` は文字列のまま(8 KB まで) |
| `suggestions` | `label` と `actions[].description` だけ(表示用。適用はしない) |
| `overrideReasons` | `{code, system, display}` をそのまま |
| `service` | `{id: cds_services.id, name, service: <discovery の id>}`(feedback の宛先) |

### 2.6 `fhirAuthorization`(委任トークン)

- **［設計］** CDS サービスは上流に **委任クライアント**(`user/` スコープだけ、リダイレクト URI なし、`kind: "delegated"`)として登録する。
  トークン窓口(`client_credentials` / `authorize`)は使えず、コンテキストスコープ(`openid` など)も持てない。
- **［設計］** 上流 `POST /admin/delegated_tokens {client_id, practitioner_id, patient_id?}`(管理トークン認証):
  登録スコープのうち**読み取りだけ**(`user/X.read`)を持つ `AccessToken`(practitioner_id・patient_id 付き、**寿命 5 分**)を発行し、
  CDS Hooks 2.0 の `fhirAuthorization` の形(`access_token` `token_type: "Bearer"` `expires_in` `scope` `subject`=client_id `patient`)で返す。
  EHR launch と同じく「その医療者がログイン中か」は管理トークンを持つ中継(client backend)を信頼する。rack-attack は起動文脈と同じ別枠。
- **［設計］** client: `cds_services.client_id` に委任クライアントを紐づけると、`Integrations::Cds::Authorization` が hook を呼ぶ直前に
  提供元ごとに 1 本発行し、その提供元の全サービスのリクエストに載せる。発行に失敗したら `fhirAuthorization` なしで呼ぶ(prefetch は渡る)。
  電文をログに残す設定(`INTEGRATION_LOG_BODIES`)でもトークンの生値は `[FILTERED]` にする。
- **［事実］** `user/` トークンは患者コンパートメントに閉じない(`smart-app-launch-design.md` §2.2)ので、サービスは施設内の全患者を読める。
  書き込み・`AuditEvent`・`_history`・`$export` は不可。監査にはサービス(client)と医療者(`agent.who.reference`)が残る。
- `fhirServer` はブラウザから見た上流の URL。サービスが別のネットワークにいる場合は、サービス側で到達できる URL に読み替える運用になる。

### 2.5 SMART launch の `appContext`

- 上流: `launch_contexts.app_context`(text)を足し、`POST /admin/launch_contexts` で `app_context`(文字列、8 KB まで)を受け、
  トークン応答に `appContext` を返す(**［事実］** CDS Hooks 2.0 §"Link" はトークン応答の `appContext` で渡すと定める)。
- client: `POST /smart_apps/:id/launch` に `app_context` を足し、`SmartLaunchIssuer` が上流へ渡す。
- frontend: 吹き出しの `smart` リンクは `lib/smartAppLaunchContext.ts` に `{appId → appContext}` を置いてから
  `?tab=smart-apps&view=<id>` へ遷移し、アプリタブが起動時に取り出して `app_context` に添える(「再起動」でも同じ値を使う)。
  URL に載せないのは、長さの上限と、ブラウザの履歴に業務上の文脈を残さないため。

## 3. frontend

### 3.1 患者帯のピクトグラム

- `PatientHeader` と `PatientPictogramStrip` に `cds?: boolean` を足し、**カルテ(`KartePage`)だけ** `cds` を付ける。
  一覧の患者ドロワーの帯では外部を呼ばない(患者ごとに CDS を叩くことになる)。
- `CdsPictogram`(`components/CdsPictogram.tsx`): `useCdsPatientView(patientId, encounterId)` で読み、カードが 0 件・失敗・未読込なら何も出さない。
  図柄は `cautionPictograms` に `cds`(吹き出しに電球)を足す(注意区分マスタでは選ばせない)。色はカードの最も重い `indicator`
  (`critical` → `--danger`、`warning` → `--warning`、`info` → `--accent`)。件数は右肩。
- 吹き出し(`PictogramPopover` に `closeOnClick` を足し、ここでは閉じない): カードごとに
  指標の色帯・`summary`・出所(`source.label`、`url` があればリンク)・「詳細」で `detail` を展開・提案の見出し・リンクのボタン・「無視」の選択。
  「無視」は `overrideReasons` があればそれ、無ければ既定の 4 つ(対応済み / 該当しない / 臨床判断で不要 / その他。
  system `http://fhir-client.local/CodeSystem/cds-override-reason`)。選ぶと feedback を送り、そのカードを吹き出しから外す
  (query のデータを書き換える。次にカルテを開いたときに出すかはサービスが決める)。
- 読み込みは `useQuery`(キー `["cds","patient-view",patientId,encounterId]`、staleTime 5 分、retry なし)。
  カルテの描画を待たせない(帯のアイコンは届いてから現れる)。

### 3.3 処方フォーム(`order-select` / `order-sign`)

- `buildPrescriptionDraftOrders(values, patientId, requester)`(`fhir/prescriptionHelpers.ts`): 薬剤が入った行を
  `MedicationRequest`(status=draft、`basedOn` なし、`authoredOn` は日付だけ)にし、id は RP と行の位置から `draft-<RP>-<行>`。
  入力のたびに同じ行は同じ id で、内容が変わった行を `selections` で指せる。
- **order-select**(`PrescriptionOrderSelectCards`): draftOrders を 1 秒置いてから、前回から内容が変わった行を `selections` にして呼ぶ。
  開いたときの内容(編集の読み込み)は呼ばない。カードは妊娠の注意の下、入力欄の前に並べ、登録は止めない。「無視…」で理由を選ぶと
  feedback を送ってそのカードを閉じる。次の応答までは前のカードを出したまま。
- **order-sign**(`PrescriptionOrderSignModal`): 「登録」で検証が通ったら order-sign を呼ぶ(ボタンは「確認中...」)。
  カードがあれば確認モーダルを出し、「登録」「戻る」。**重要(critical)のカードは理由を選ぶまで「登録」できない**。登録するときに、
  理由を選んだカードの feedback を送る。カードが無い・サービスに届かない(例外)ときはそのまま登録する。
- オーダーセットの内容入力(`setMode`)と外から一括 submit する画面(`hideSubmit`)では呼ばない(患者が決まらない / 確認を挟めない)。
- `encounterId` は渡さない(フォームは受診を持たない)。注射は未対応(Bundle の組み立てが別実装)。

### 3.2 管理画面「CDS サービス」(`/cds-services`)

名称 / URL / 認証トークン(書き込み専用、有無だけ表示)/ 有効 / 表示順。行の「探索」で discovery の結果(サービス id・hook・
title・prefetch の key)をモーダルに出す。メニューは「管理」の SMART アプリの隣。

## 4. セキュリティ・運用

| 論点 | 設計 |
|---|---|
| サービスに渡す情報 | prefetch で同梱する分と、委任クライアントを紐づけた提供元には読み取り専用・5 分の `fhirAuthorization`(§2.6)。紐づけなければ `fhirServer` は URL を知らせるだけで読めない |
| prefetch の範囲 | 許可リストの型だけ、`_count` の上限 100、`encounterId` が無いテンプレートは省く |
| サービスの応答 | 正規化して画面に出す。`detail` はプレーンテキスト、`absolute` リンクは http(s) のみ、`smart` リンクは登録済みアプリだけ起動 |
| 失敗 | 提供元ごとに握り、カード無しで返す。EventLog と管理画面の「探索」で切り分ける |
| 無視の記録 | サービスの feedback に送り、重要のカードは共通の警告の器(`advisory-design.md`)の来歴と台帳にも残る。既定の無視理由はマスタ「警告の確認理由」 |
| 認証トークン | `encrypts`、ブラウザへは有無のみ。本番の URL は https のみ |

## 5. 検証

### 5.1 模擬サービス `backend/script/cds_demo_service.ru`

依存ゼロの rack アプリ。`GET /cds-services` に `patient-view` のサービス 1 つ(prefetch: `patient`、`meds`)、
`POST /cds-services/demo-patient-view` に prefetch の中身からカードを 3 枚(情報 / warning + `smart` リンク(demo アプリ、`appContext` 付き)/
critical + 無視理由)、`POST .../feedback` は受けた内容を標準出力に出して 200。

```bash
# backend コンテナの中で動かす(backend からは http://localhost:8787 で届く)
docker compose exec -d backend bundle exec rackup -p 8787 script/cds_demo_service.ru
```

管理画面「CDS サービス」に `http://localhost:8787` を登録し、「探索」でサービスが見えることを確認する。

模擬サービスは order-select(選んだ薬剤名の情報カード)と order-sign(重要のカード、無視理由 2 つ)も返す。
`fhirAuthorization` を受け取ると、そのトークンで `Patient/{patientId}` を読み直して「fhirAuthorization で上流から読みました: 氏名」の
カードを足す(コンテナの中からは `CDS_DEMO_FHIR_BASE`、既定 `http://host.docker.internal:3000` で読む)。

### 5.2 確認項目(2026-10-18、開発環境・医師 一郎でログイン。1〜3・6〜9 は実施済み、4・5 はコードの構造で担保)

1. テスト太郎のカルテを開くと患者帯に「判断支援 3」が出て、吹き出しに 3 枚のカードが指標の色つきで並ぶ。
2. warning カードの「アプリで開く」でアプリタブに切り替わり、demo アプリの表示に `appContext` の値が出る(上流のトークン応答に `appContext`)。
3. critical カードを「無視」(理由を選ぶ)すると吹き出しから消え、模擬サービスの標準出力に feedback が出る。
4. 提供元を無効にする、または止めると帯にアイコンが出ない(カルテは普通に開ける)。
5. 一覧の患者ドロワーの帯では `/integrations/cds/patient_view` が呼ばれない。
6. `administrator` でログインすると呼ばれず、アイコンも出ない。
7. 上流 rspec・client rspec・`tsc -b`・lint。
8. 処方フォームで薬剤を選ぶと 1 秒後に「選んだ薬剤: …」のカードが入力欄の前に出る(`selections` は `MedicationRequest/draft-1-1`)。
9. 「登録」で確認モーダルに重要のカードが出て、理由を選ぶまで「登録」が押せない。理由を選んで登録すると処方が作られ、
   模擬サービスに `overridden` と理由の feedback が届く(テスト 20260923 に 10/18 のガスター散の処方が残っている)。
10. 提供元に委任クライアント「CDS デモ(FHIR 読み取り)」を紐づけると、patient-view のリクエストに `fhirAuthorization` が付き、
    模擬サービスがそのトークンでテスト太郎を読めた。上流の `access_tokens` は委任クライアント・一郎の Practitioner・読み取り 3 スコープ・寿命 5 分。
    開発の上流は認証 OFF なので、トークンの効き(他患者は読める・書けない・AuditEvent 403・監査の帰属)は上流の request spec で確認した。

## 6. 採らなかった案

| 案 | 理由 |
|---|---|
| 帯の下に常時カードの帯を出す | 画面の高さを取る。ユーザー決定でアイコン + 吹き出しに |
| `fhirAuthorization` に書き込みも含める | サービスは判断のために読むだけで、書き込みは医師が提案を受けて行う(suggestion)。読み取りだけを発行する |
| 委任トークンをトークン窓口(token exchange など)で取らせる | サービス側に OAuth の実装と秘密の保管を求めることになる。EHR が発行して渡す CDS Hooks の想定どおりにする |
| `ExternalSystemConnection` に載せる | 1 システム 1 行で提供元を複数持てない。`:connection` 区画は username/password を要求する |
| suggestion の `actions` を登録フォームの初期値にする | 種別ごとの対応表が要り大きい。まず表示だけ |
| Markdown のレンダラを足す | 依存を増やし XSS の面を広げる。`detail` はプレーンテキストで十分なところから |
| `appContext` を URL に載せてアプリタブへ渡す | 長さの上限と履歴への残留。メモリ上の受け渡しにする |
| 無視の台帳を backend に持つ | バックログ §5.3「警告の器とガバナンス」で既存の警告と一緒に設計する |

## 7. 残課題

1. ~~`order-select` / `order-sign`~~ — 処方は対応済み(§3.3)。注射・部門オーダーへの展開と、order-sign への `encounterId` は残り。
2. ~~`fhirAuthorization`~~ — 対応済み(§2.6、読み取りのみ・5 分)。サービスごとにスコープを絞る設定画面(今は登録スコープの読み取り全部)は残り。
3. suggestion の適用(`actions` の `create` をフォームの初期値に)と `systemActions`。
4. Markdown の `detail`。
5. ~~無視の台帳と発火数・無視率の管理画面~~ — `advisory-design.md` で対応済み。患者帯(patient-view)のカードの無視は feedback だけ。
6. `feedback` の `accepted`(suggestion を適用したとき)。
7. 提供元ごとのタイムアウト・有効な hook の設定、discovery の結果を保存して管理画面で見せる。

## 8. 主なファイル

| 場所 | ファイル | 役割 |
|---|---|---|
| 上流 | `app/models/launch_context.rb`、`admin/launch_contexts_controller.rb`、`oauth_tokens_controller.rb` | `app_context` / `appContext` |
| 上流 | `app/models/oauth_client.rb`(`delegated_client?` / `delegated_scopes`)、`admin/delegated_tokens_controller.rb`、`access_token.rb`(`DELEGATED_TTL`) | 委任トークン |
| backend | `app/services/integrations/cds/authorization.rb` | `fhirAuthorization` の発行 |
| backend | `app/models/cds_service.rb`、`admin/cds_services_controller.rb` | 提供元の台帳 |
| backend | `app/services/integrations/cds/{client,discovery,prefetch,cards,invocation}.rb` | 呼び出し・prefetch・正規化 |
| backend | `app/controllers/integrations/cds/hooks_controller.rb` | `patient_view` / `order_select` / `order_sign` / `feedback` |
| backend | `script/cds_demo_service.ru` | 検証用の模擬サービス |
| frontend | `api/cdsClient.ts`、`api/cdsQueries.ts`、`components/CdsPictogram.tsx`、`components/CdsCardList.tsx`、`fhir/cdsCardHelpers.ts`、`components/PictogramPopover.tsx` | 帯のアイコンと吹き出し、カードの一覧 |
| frontend | `fhir/prescriptionHelpers.ts`(`buildPrescriptionDraftOrders`)、`components/PrescriptionCdsCards.tsx`、`components/PrescriptionForm.tsx`、`hooks/useDebouncedValue.ts` | 処方の order-select / order-sign |
| frontend | `lib/smartAppLaunchContext.ts`、`components/KarteSmartAppsTab.tsx`、`api/smartAppsClient.ts` | `appContext` の受け渡し |
| frontend | `pages/CdsServicesPage.tsx`、`api/adminClient.ts`、`api/adminQueries.ts`、`App.tsx` | 管理画面 |
