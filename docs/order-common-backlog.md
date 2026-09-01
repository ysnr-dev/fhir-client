# オーダー共通の未対応課題

2026-09-01 に注射オーダーの不足機能を洗い出す過程で見つかった、**オーダー種別をまたぐ**
課題の記録。個々の種別に閉じた未実装は各 `*-order-design.md` の「未実装・今後」にある。

---

## 1. オーダー日と実施日の持ち方が種別ごとにばらばら — **対応済み(2026-09-01)**

> 決定: `authoredOn` = オーダー登録日時(システム時刻、編集で不変、フォーム入力欄なし)、
> `occurrenceDateTime` = オーダー開始日(全種別必須、未定可は手術のみ)。処方は「投与開始日」欄を新設、
> 他科依頼は希望日必須、細菌検査は検査日必須。カルテの本流は `occurrence` 軸でページング、処方一覧だけ
> 交付日(`authoredon`)で引く。既存データは上流 migration `20260901000001` で補完。
> 現行のルールは readme「オーダーの日付(登録日時と開始日)」と `fhir/shared.ts` 冒頭。以下は検討の記録。

### 1.1 現状

`ServiceRequest.authoredOn` と `occurrence` の入れ方が 3 通りある。

**グループ A: `authoredOn` = 実施日(オーダー日を残していない)**

| 種別 | フォームのラベル | `occurrence` |
|---|---|---|
| 処方 | 処方日 | 無し |
| 注射 | 注射日 | 無し |
| 検体検査 | 検査日 | `authoredOn` と同じ日を複製 |
| 放射線・生理・内視鏡・処置 | 実施日時 | 同じ日 + 時刻 |
| 細菌検査・病理 | 依頼日 | 無し |

初期に作った種別群で、「オーダーした日 = 実施する日」を前提にしている。フォームで入れた
日付がそのまま `authoredOn` になるので、未来日を入れれば `authoredOn` が未来になる。
放射線は `radOrderHelpers.ts:562` に「撮影日時。オーダー日と同じ日を入れる」と意図的な兼用と
書いてある。

**グループ B: `authoredOn` = 依頼日、`occurrence` = 予定日 / 開始日**

| 種別 | `authoredOn` | `occurrence` |
|---|---|---|
| 手術 | 申込日 | 予定日時(未定なら無し →「日付未定」) |
| 輸血 | 依頼日 | 投与予定日時 |
| リハビリ・栄養指導 | 依頼日 | 開始日 |
| 看護指示・食事 | 登録日(`today()`) | 開始日 |

後から作った種別群。方針転換の理由は `surgeryOrderHelpers.ts:581` に「既存 4 種と違い、申込から
実施まで日が空くのが普通なので実施日を `authoredOn` に入れない」と書いてある。カードの日は
`orderCardDay` が `occurrence` を優先するので、このグループは自然に予定日に出る。

**グループ C: 他科依頼** — 日付軸を持たず status で絞る(`docs/consult-order-design.md` §4)。

### 1.2 何が困るか

- **注射**: `authoredOn` を施行日に転用しているので「いつ指示したか」が残らない。連日オーダーの
  束ね表示(`docs/injection-order-design.md` §8 D)で「オーダーした日に本体を置く」ができない。
- **処方**: **投与開始日を持つ場所が無い**。入院の処方区分は 定期 / 継続 / 臨時 / 退院 / 緊急
  (`prescriptionHelpers.ts:64`)で、このうち定期・継続・退院は処方日と投与開始日が一致しないのが
  普通(定期処方は病棟の定期処方日にまとめて入力し、投与は次サイクルの初日から)。医師は
  「処方日 = 入力日(いつから飲むかが消える)」か「処方日 = 開始日(いつ指示したかが消え、処方箋の
  交付日が未来になる)」の二択を迫られる。派生して:
  - **投与終了日(開始日 + 投与日数 − 1)が出せない** → 処方切れを検知できない。次の定期処方を
    いつ出すかは現行処方が何日で切れるかを見て決めるので、定期処方運用の中核が欠けている。
  - `RxWorklistPage` は `authoredon` の 1 日で引くので、開始日前日に調剤・カート充填する運用に
    乗らない(実質「入力日に調剤する」前提)。
  - 持参薬・退院処方との期間の重複チェックができない。
- **検査系(放射線・生理・内視鏡・処置・検体検査)**: `occurrence` があるのでカードの位置は正しいが、
  `authoredOn` に実施日を入れているため「いつ依頼したか」が失われている。予約枠を先に取る内視鏡・
  生理では実施日が未来になり、依頼日も未来として記録される。

### 1.3 直し方

処方・注射をグループ B に寄せる。**作業内容がほぼ同じなのでまとめて 1 タスクにする。**

処方(1 本の SR が期間全体を持つ形は変えない):

```
ServiceRequest
  authoredOn         = 処方日(交付日・入力日)      ← 本来の意味に戻す
  occurrenceDateTime = 投与開始日                  ← 新設。フォームに項目を足す(既定は処方日)
MedicationRequest
  dispenseRequest.expectedSupplyDuration = 投与日数(現状のまま)
```

投与終了日は「開始日 + 日数 − 1」で計算する(内服のみ。頓服は期間を持たない)。

注射(1 日 1 SR の展開は変えない):

```
ServiceRequest
  authoredOn         = オーダー日
  occurrenceDateTime = 注射日(施行日)              ← いまの authoredOn の値
```

- **カードの見た目は変わらない**。`orderCardDay` が `occurrence` を優先するため。
- 上流は `occurrenceDateTime` しか索引しないので `occurrencePeriod` は使わない。
- 既存データの移行は `occurrence` に `authoredOn` を複製するだけ。
- 影響範囲(注射): `useInjectionWorklist` / `useInjectionSeriesLater`(`authoredon=gt`)、
  `injectionHelpers.ts` の `sr.authoredOn.slice(0, 10)`(約 10 か所)、帳票 `injection_meta.rb`。
- 影響範囲(処方): `RxWorklistPage` の日付軸、`rxDispenseHelpers`、処方箋帳票の処方日、DO、
  フォームへの投与開始日の追加。
- **検査系は後回しでよい**。`occurrence` が既にあるのでカードの位置は正しく、直すのは
  `authoredOn` を入力日に戻すことだけ(失っているのは依頼日のみ)。放射線・検体検査ぶんは
  `docs/server-improvement-backlog.md` F-3 に先に挙がっている(重複記載の廃止)。

---

## 2. 代行入力(入力者)が記録されていない

### 2.1 現状

代行入力の仕組み自体はある(`components/OrderContextPicker.tsx`、`orderContext.ts:4`)。

- 医師・歯科医師のログイン … 依頼科だけを選ぶ。依頼医師は本人
- それ以外のログイン … 代行入力。依頼科を開いてその科の**指示医師**を選ぶ

しかし保存されるのは共通の `applyOrderContext()`(`fhir/prescriptionHelpers.ts:212`)が書く
3 つだけ。

```
resource.requester           = Practitioner/{選んだ指示医師}
extension[order-department]  = 依頼科
extension[order-ward]        = 在院病棟
```

**ログイン中のユーザー(実際に入力した人)はどのリソースにも入らない。** 代行入力で登録した
オーダーと、指示医師本人が入力したオーダーは、保存されたデータ上まったく区別が付かない。
全種別(処方・注射・検体検査・細菌・病理・放射線・生理・内視鏡・処置・手術・輸血・リハビリ・
栄養指導・食事・看護指示・他科依頼)が同じ `applyOrderContext` を通るので、種別による差もない。

**上流の監査ログからも追えない**。`AuditEvent.agent.who` に入るのは OAuth クライアント
(`fhir-server/app/controllers/concerns/fhir_auditing.rb:47` の `client_name` / `client_id`)で、
エンドユーザーではない。fhir-client は 1 つのクライアントとしてアクセスするため、監査を見ても
「fhir-client が書いた」までしか分からない。

**実施系とは非対称になっている**。実施記録の `Procedure.performer`(実施者)や検体到着の
`lab-arrival-recorder` 拡張はログインユーザーを残している。「実際に手を動かした人」は残すのに、
オーダーだけが残していない。

### 2.2 なぜ問題か

厚労省「医療情報システムの安全管理に関するガイドライン」の**真正性**の要件として、代行入力は
(1) 誰が代行入力したか (2) 誰の指示によるか (3) 指示した医師が後から確認・承認した記録
の 3 点を残すことが求められる。現状は (2) だけで、(1) と (3) が無い。

### 2.3 直し方

**最小の変更で全種別に効く**。入力者は `applyOrderContext` 1 か所に足せば、そこを通る全種別に
一度に入る。

```
extension[order-enterer] = Practitioner/{ログインユーザー}   ← 新設
```

- **指示医師と同じ人でも常に付ける**。後から「代行だったか」を判定でき、付け忘れも起きない。
- 表示は「入力者 ≠ 依頼医師」のときだけ「代行入力: ○○」と出す。
- 標準に寄せるなら `Provenance` が正解だが、上流が対応しておらず読み出しにも手が入るので、
  まずはローカル拡張で足元を埋める(§2.4)。

**処方・注射だけは標準要素がある**。`MedicationRequest.recorder` は定義そのものが「口頭指示・
電話指示などで、他人に代わってオーダーを入力した人」で代行入力者に一致する。ただし
`ServiceRequest` には `recorder` が無いので、処方・注射だけ標準要素・他の 14 種別は拡張、と
持ち方が割れると読み出し側が面倒になる。**第 1 段階は全種別で拡張に統一**し、
`MedicationRequest.recorder` は FHIR としての意味を保つための併記に留める(注射の実施記録で
`MedicationAdministration.request` を併記しているのと同じ考え方)。

### 2.4 Provenance に移す場合(第 2 段階)

#### 紐付けは `Provenance.target` — Provenance 側からの一方向参照

```
Provenance
  target[]  = [ ServiceRequest/123, MedicationRequest/456, ... ]   ← 1..*
  recorded  = 2026-09-01T10:30:00+09:00   (instant、必須)
  agent[0]  type = author,  who = Practitioner/{指示医師}
  agent[1]  type = enterer, who = Practitioner/{代行入力者}
                            onBehalfOf = Practitioner/{指示医師}
```

- `agent.type` は `http://terminology.hl7.org/CodeSystem/provenance-participant-type`
  (`author` / `enterer` / `verifier` / `attester` / `legal` …)。代行入力者は `enterer`。
- **`ServiceRequest` 側に Provenance を指す要素は無い**。逆参照は張れないので、「このオーダーの
  入力者は誰か」を知るには必ず Provenance 側を引く。
- `target` が `1..*` なので、**1 オーダー(SR 1 + MedicationRequest N)に Provenance 1 件**で
  全部を指せる。増えるリソースは 1 件で済む。
- 書き込みは既存の transaction Bundle にエントリを 1 つ足すだけ。新規登録では SR にまだ id が
  無いので `fullUrl: urn:uuid:xxx` を `target.reference` に書けばサーバーが解決する。
- 読み出しは `ServiceRequest?_id=123&_revinclude=Provenance:target`(既存の読み出しに乗る)か
  `Provenance?target=ServiceRequest/123`。

#### 障壁

1. **上流が Provenance を持っていない(最大)**。`fhir-server/app/lib/fhir/resource_registry.rb` の
   対応リソースは 33 型で Provenance は含まれず、POST しても弾かれる。model / validator /
   `SearchDefinitions::Provenance::PARAMS`(`target`・`agent`・`recorded`・`patient`)/ 抽出定義 /
   `_revinclude` の逆参照を足す必要がある。JP Core にプロファイルが無いので、Task と同じく
   基底 HL7 定義 + 手書きバリデータの形になる
   (`docs/server-improvement-backlog.md` C-7)。
2. **1 活動 = 1 件なので件数が増える**。Provenance は create / update という活動の記録で、
   編集のたびに 1 件増えるのが本来の姿(`target` もバージョン付き参照
   `ServiceRequest/123/_history/2` にするのが正しい)。注射の連日オーダーは 1 回の登録なら
   `target` 複数で 1 件に束ねられるが、「この日以降すべて」の一括更新でまた 1 件。
   `_revinclude` すると編集回数ぶん返るので、最新 1 件を取るにはクライアント側で `recorded` を
   見て target ごとに畳む処理が要る。
3. **読み出しコストが全オーダー種別に乗る**。タイムラインは既に SR + MedicationRequest + Task +
   Procedure と `_revinclude` を重ねている。入力者は詳細モーダルを開いたときだけ見えればよい
   情報なので、**一覧では引かない**設計にする。
4. **削除時に取り残される**。オーダーを削除しても Provenance が残る(Task と同じ問題。
   `docs/injection-order-design.md` §8 D に既出)。

#### 拡張との関係

第 2 段階に移っても**拡張は残して併記でよい**。拡張は「いま誰が入れたか」の即値、Provenance は
履歴、と役割が分かれる。`Provenance.signature`(電子署名)と `agent.type = verifier` は §2.5 の
承認フローにそのまま使えるので、承認まで作るなら Provenance は避けて通れない。

### 2.5 承認フロー(別タスク・規模大)

代行入力を実運用するなら避けて通れないが、2.3 / 2.4 とは切り離す。

- 未承認の状態を持たせる。`ServiceRequest.status = draft` は「オーダーとして成立していない」意味に
  なり部門一覧から消えるので使えない。承認状態はローカル拡張か Task で持つ。
- 医師の承認画面と、未承認オーダーの一覧。
- 承認前に部門へ流すかどうかの運用判断(緊急のオーダーが承認待ちで止まると困る)。
