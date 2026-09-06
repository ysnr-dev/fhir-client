# オーダーセットの設計

**状態: Phase 1 実装済(2026-09-06)。処方・注射・検体検査・放射線検査・生理検査・処置の 6 種別。**
本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 他の部門オーダーとの違い = 「オーダーそのものではない」こと

| | 部門オーダー(処方・検体検査など) | オーダーセット |
|---|---|---|
| 何を表すか | 患者に対する指示 | 患者を持たない入力値の雛形(「いつも出す組み合わせ」) |
| 保存先 | 上流 FHIR(ServiceRequest ほか) | backend DB(`order_sets` / `order_set_entries`) |
| いつ FHIR になるか | 登録した瞬間 | 適用して「一括登録」した瞬間だけ |
| 持ち主 | 患者(subject)と依頼医師(requester) | 院内共通 / 診療科 / 医師 の 3 段階 |
| 一覧の軸 | 日付・部門 | 持ち主ごとのフォルダツリー |

［導出］患者への参照(プロブレム・依頼病名・テンプレート回答・明細 id)を一切持てない。保存前に落とす(§4)。
［導出］種別ごとの画面を新しく作らず、既存のオーダー登録フォームをそのまま縦に積む(§5)。
セットの登録も適用も「通常のオーダー登録と同じ操作」になる。

### 1.1 命名

- **オーダーセット**(英語識別子 `order_set` / `order-set`)… 本ドキュメントの主題。種別をまたぐ束。
  画面表記はメニュー「セット登録」、カルテ右ペインのボタン「セット」、ペイン題「セット適用」。
- **セット / パネル** … 部門内の 1 オーダー種別の中の項目の束(`master_rad_set_items`, `master_physio_set_items`,
  `master_endoscopy_set_items`, `master_treatment_set_items`, `master_lab_panel_items`)。マスタが持つ固定の構成で、種別をまたがない。
- **テンプレート** … Questionnaire(文章の雛形)。上流 FHIR。
- **データセット** … 実施入力の既定明細(`master_*_datasets`)。
- **DO** … 過去 1 オーダーの複写(`buildDoXxxForm`)。保存されない。

［決定］セットの中にセットを参照する形(入れ子)は作らない。階層はフォルダで表す。

### 1.2 マスタではないのに `/master` に置く理由

オーダーセットは施設の参照表ではなく現場の医師が育てる運用データだが、ログイン認証・CSRF・エラー整形が
`Master::BaseController` に揃っているので、新しい基底クラスを増やさず `/master/order_sets` に置いた
(`backend/app/controllers/master/order_sets_controller.rb`)。`model_class` と `record_params` は上書きし、
列名丸ごとの permit は使わない。

---

## 2. 保存の構造

```text
order_sets                      … フォルダとセット(parent_id の隣接リスト、master_schema_categories と同型)
  code       uuid(unique)       … 環境間の移送とオーダーへ焼く印
  kind       folder | set
  parent_id  親フォルダ(NULL = 持ち主のルート直下)
  scope      facility | department | practitioner
  owner_id   診療科 Organization.id / Practitioner.id(facility は NULL)
  owner_name 表示用の非正規化
  name, display_order, active
order_set_entries               … セット 1 件に含まれるオーダー 1 件ぶん
  order_type   "prescription" / "lab-order" …(KartePaneState の種別接頭辞)
  label        一覧の要約(保存時にフロントが作る)
  values       jsonb = そのオーダー種別のフォーム値(PrescriptionFormValues など)そのもの
  schema_version
```

- ［事実］全種別のフォーム値は plain JSON(文字列・数値・真偽・null・配列・オブジェクト)で、日付も文字列。
  そのまま jsonb に入れ、読み出したら無変換でフォームの `initialValues` に渡せる。
- ［決定］外部キーは張らず、整合性はアプリ側の削除ガード(子が残るフォルダは 422)で守る(他マスタと同じ)。
- ［決定］名前は `(scope, owner_id, parent_id)` の中で一意。親と子の持ち主は必ず同じ(持ち主をまたぐ木は作らない)。
- `schema_version` は「フォーム値の項目を削除・改名したら上げる」運用。項目の追加は既定値で埋まるので上げない。
  新しい版で作られたエントリはこのクライアントでは読み取り専用にする(`migrateEntryValues`)。

## 3. 権限

| scope | 編集できる人 | サーバーが強制するもの |
|---|---|---|
| facility(院内共通) | 医師なら誰でも | ログイン済みであること |
| department(診療科) | その科を担当する医師 | 同上 |
| practitioner(医師) | 本人のみ | `owner_id` をパラメータではなく `current_user.practitioner_fhir_id` で上書き。他人のセットへの書き込みは 403 |

- ［事実］backend は職種を知らない(`users` は `login_id` / `password_digest` / `practitioner_fhir_id` だけ)。医師かどうかは
  上流の PractitionerRole にしか無いので、院内共通・診療科の「医師のみ」は画面側で判定する
  (`isDoctorRoleCode`、担当科は `parseDepartmentRoles`)。医師以外は全ルート閲覧のみ。
- 読み取りは誰でもできる。代行入力(医師以外のログイン)でカルテから指示医師のセットを開くため。
- 認証なしモード(`ADMIN_TOKEN` 未設定)は開発の摩擦を無くす後方互換で、パラメータの `owner_id` を通す。

### 3.1 代行入力

| 画面 | 診療科 | 医師 |
|---|---|---|
| セット登録(`/order-sets`) | ログイン医師の担当科(複数なら select) | ログイン本人 |
| カルテの適用パネル | `OrderContext.departmentId`(ヘッダーで選んだ依頼科) | `OrderContext.practitionerId`(**指示医師**) |

［導出］代行入力でカルテを開くと、右ペインのセットはログインユーザーではなく指示医師のセットになる。セットは
「その医師がいつも出す組み合わせ」で、代行者が入力していても出すのは指示医師のオーダーだから。

セットの一覧は**持ち主のタブ**で切り替える(適用パネル: 院内共通 / 科名 / 医師名、登録画面: 院内共通 / 科名 / 自分のセット)。
3 つを縦に並べると探しにくく、タブ名がそのまま「いま誰のセットを見ているか」の表示にもなる。中身はフォルダとセットの
ツリーで、入れ子は縦線と字下げで示す(件数は出さない)。登録画面では担当科が複数ある医師のために、診療科タブに科の選択を
添える。適用パネルでセットを選んだ後は「← セット選択」でツリーに戻れる(選び間違えてもペインを閉じ直さずに済む)。

## 4. 患者への参照を持たない

保存前に `sanitizeValuesForSet`(`fhir/orderSetHelpers.ts`)が落とす:

- 共通: 対象プロブレム、明細の id、日付・時刻(空に)
- 放射線・生理: 依頼病名(Condition)、検査目的・特別指示のテンプレート回答、単独枠の日時
- 注射: 束ね(`series`)、期間

適用時は既存の `buildDoXxxForm`(DO と同じ正規化)を通す。日付を当日で、入外区分を患者の在院状況で埋めるので、
空のまま画面に出て検証に落ちることはない。

### 4.1 適用日

適用パネルの上に「適用日」があり、変えると各オーダーの開始日(処方は投与開始日、検体検査は検査日、放射線・生理・処置は
撮影日/実施日と単独枠の日付)にまとめて入る。既定は当日。

- 実装は `hooks/useBulkStartDate.ts` + 各フォームの `bulkStartDate` prop。**値が変わったときだけ**反映するので、
  フォームを作り直さず、入力途中の内容や個別に直した日付は残る(初期値は `buildDoXxxForm` が入れた当日)。
- ［決定］**予約する項目には入れない**。予約必須の検査は予約した枠の日時が撮影日時そのもので
  (`buildRadOrderSplitEntries` が枠の日時で上書きする)、日付だけ動かすと予約と食い違うため。フォーム側で
  `requiresBooking(code)` の行を除いている。
- 登録日時(`authoredOn`)は適用日ではなく実際に登録した日時になる(readme「オーダーの日付」の規則どおり)。

［決定］入外区分・処方区分は**セット自身が持つ**(「外来の院外処方セット」は種類として意味がある)。適用時に患者の
在院状況と食い違うと `buildDo` が処方区分を空にするので、そのエントリの上に注意を出す
(「このセットは『外来』で作られています。患者はいま『入院』なので、区分を確認してください」)。

## 5. 登録と適用 = 積んだフォームを一括 submit する

セット登録画面(`pages/OrderSetPage.tsx`)と適用パネル(`components/OrderSetApplyPanel.tsx`)は同じ仕組み
(`hooks/useStackedOrderForms.ts`)を共有する。

- 各エントリの既存フォームを縦に積み、`form.requestSubmit()` を順に呼ぶ。submit ハンドラは同期に走るので、
  各フォームが `onSubmit` に返した値を Map に貯めればループを抜けた時点で揃う。
- フォームは検証に落ちたとき `onSubmit` を呼ばない → Map に無いキー = 検証落ち。そのエントリを展開してスクロールし、
  **何も登録しない**(上流に届かない)。フォームの検証ロジックを二重に持たない。
- 折りたたみ・除外はアンマウントせず `hidden` で隠す(入力中の値を保つ)。表示していないフォームでも
  `requestSubmit()` は動く(6 フォームとも HTML の `required` を使っていないため、ブラウザの制約検証で止まらない)。
- 適用パネルの各オーダーは**既定で閉じている**(まず全体を見渡し、直したいものだけ開く)。「すべて開く / すべて閉じる」で
  一括開閉でき、検証に落ちたエントリは自動で開いてそこへスクロールする。
- フォーム側には `setMode`(患者・日付に依存する入力と検証を外す)と `hideSubmit`(送信ボタンを出さない)を足した。
  既定値で従来の登録・編集・DO の経路は変わらない。

種別ごとの差分は `components/orderSetRegistry.tsx` の 1 表(Form・empty・buildDo・sanitize・summarize・buildBundle)に
閉じ、画面側は種別分岐を持たない。`buildBundle` は各 CreatePanel の `handleSubmit` と同じ組み立てなので、
セットからの登録も個別の登録も上流に届く Bundle は同じ形になる。

適用の「一括登録」は、種別ごとの transaction Bundle を `mergeTransactionBundles` で 1 本にまとめ、
`useCreatePrescription`(16 種別すべての登録が通るフック)で POST する。全部登録か全部失敗かのどちらかで、
来歴(Provenance)は 1 回の適用につき 1 件(全ヘッダと MedicationRequest を target)。承認画面の種別列は
含まれる種別を重複なく並べ、セット名を添える。

## 6. 登録されたオーダーへのセット印

ヘッダ ServiceRequest(basedOn を持たない)に `stampOrderSetInstance` で焼く:

```text
identifier  { system: http://fhir-client.local/Identifier/order-set-instance, value: 適用 1 回ぶんの uuid }
extension   { url: http://fhir-client.local/StructureDefinition/order-set,
              valueCoding: { system: .../CodeSystem/order-set, code: セットの code, display: セット名 } }
requisition 空いているときだけ同じ uuid
```

［事実］`ServiceRequest.requisition` は 0..1 で、注射の連日展開(`injection-series`)と看護指示の同時発行が先に使っている。
上書きすると注射の束ねを壊すので、印の本体は identifier と拡張とし、requisition はおまけ。

## 7. 実装フェーズ

- **Phase 1(実装済)**: backend(テーブル・API・request spec 18 件)、セット登録画面、カルテの適用パネル、
  処方・注射・検体検査・放射線検査・生理検査・処置の set モード、承認画面の種別列。
- **Phase 2(未実装)**: 細菌・病理・内視鏡・手術・輸血・リハビリ・栄養指導・他科依頼・食事・看護指示。
  各フォームに `setMode` / `hideSubmit` を足し、`orderSetRegistry.tsx` に定義を 1 つ足せば画面は変えなくてよい。
  注意点: 輸血は血液型を `useEffect` で後から流し込む(`TransfusionOrderForm.tsx`)ので「事前入力が終わるまで
  一括登録を disabled」の口が要る。食事・看護指示は入院 Encounter を submit 時に渡すので同様。看護指示は DO が無い。
  未対応の種別のエントリは、登録画面では「この画面ではまだ編集できません」と出して保存時にそのまま残し、
  適用では除外される。
- **Phase 3(提案)**:
  - 「この日のオーダーをセットとして保存」(カルテのカードから `useXxxInitialValues` → sanitize → 保存)。
    医師は実症例からセットを作るのが自然。
  - カード上の「セット名」バッジ(`orderSetOf` で読める)。
  - 適用時のマスタ廃止チェック(フォームはコードでマスタを引き直すので名前は自己修復するが、廃止は分からない)。
  - 日付オフセット(day0 採血、day1 手術のパス化)。
  - エクスポート/インポート(code が uuid なので環境間移送は可能)。
  - ピッカーの名前検索・最近使ったセット。
  - 予約必須の撮影項目をセットに入れたとき「適用時に予約が必要」と注記(`requires_appointment` をマスタから引ける)。

## 8. 実装したもの

- backend: `db/migrate/20260906000000_create_order_sets.rb`、`20260906000100_create_order_set_entries.rb`、
  `app/models/order_set.rb`、`app/models/order_set_entry.rb`、`app/controllers/master/order_sets_controller.rb`、
  `config/routes.rb`、`spec/requests/master/order_sets_spec.rb`
- frontend: `api/masterClient.ts` / `api/masterQueries.ts`(オーダーセット節)、`fhir/orderSetHelpers.ts`、
  `hooks/useStackedOrderForms.ts`、`components/orderSetRegistry.tsx`、`components/orderSetTree.ts`、
  `pages/OrderSetPage.tsx`、`components/OrderSetApplyPanel.tsx`、`components/KarteRightPane.tsx`(「セット」ボタンと
  `order-set` ペイン)、`App.tsx`(診療業務 > セット登録、`/order-sets`)、`App.css`
- フォームの `setMode` / `hideSubmit`: `PrescriptionForm` / `InjectionForm` / `LabOrderForm` / `RadOrderForm` /
  `PhysioOrderForm` / `TreatmentOrderForm`、`TemplateTextField`(`onOpenTemplate` 省略でテンプレート操作を出さない)
- `fhir/provenanceHelpers.ts` の `isHeaderEntry` を export(セット印の対象判定と共用)
- `pages/OrderApprovalPage.tsx` の種別列

### 8.1 検証したこと(2026-09-05〜06、開発環境のテスト太郎、ysnr-dev = 児玉 義憲でログイン)

- 自分のセット「感冒セット」(処方 + 検体検査(末梢血液一般パネル + HbA1c)+ 放射線(胸部立位 P→A))を登録画面で作成・保存・
  再読込で復元。DB の values に `problem` / 明細 id / 日付 / 依頼病名 / テンプレートが残っていない。
- 保存前の検証(投与日数未入力)でフォーム側のエラーが出て保存が止まる。
- カルテの「セット」→ ツリー(院内共通 / 内科のセット / 児玉 義憲のセット)→ 感冒セットで 3 フォームが積まれ、
  入院中の患者に外来セットを当てた注意行と、当日の日付・入院への切替が出る。
- 処方区分未選択で一括登録 → 「『処方』の入力を確認してください」で止まり、上流に POST されない。
- 処方区分を選んで一括登録 → POST /fhir が 1 回、カルテに 3 枚のカード(09/05)、ヘッダ SR に identifier・
  `order-set` 拡張・requisition、Provenance 1 件が 3 ヘッダ + MedicationRequest を target。
- `RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec` 1176 件成功、`npx tsc -b` 成功。

## 9. 申し送り

- 医師以外のログイン(nurse)での閲覧のみ・指示医師のセット表示は、ブラウザ自動化でパスワードを入れられないため
  画面では未確認(backend の 403 は spec で確認済み)。
- rad/physio/treatment の `groupable`(単独オーダーか)は常に今のマスタで再導出するので、セット作成後にマスタを変えると
  適用時の分割数が変わる。仕様として受け入れる。
- 大きなセット(entry 60〜80 件の Bundle)の上流 transaction 上限は未確認。落ちるならモデルにエントリ数上限を設ける。
- 「セットから出たオーダー」を横断で引く検索(identifier / 拡張)は上流に無い。必要になったら
  `docs/server-improvement-backlog.md` に起票。
- frontend コンテナの prettier は既定設定(80 桁)で動きリポジトリの整形と合わないので、`npx prettier --write` は使わない。
