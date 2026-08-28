# 手術の実施記録(第2段階)の設計

手術オーダー第1段階(`docs/surgery-order-design.md`。申込〜日程確保)の続き。
処置の実施入力(`docs/treatment-order-design.md`)と放射線の被曝線量
(`docs/rad-result-design.md`)を雛形にし、手術に固有のところだけをここに書く。
同じところは両設計書を参照。

実装日: 2026-08-27。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 他部門の実施入力との違い

骨格(ハブ Procedure に子をぶら下げる / 実施記録と Task を 1 transaction /
取消で記録ごと DELETE)は処置と同じ。違うのは 4 点。

| # | 違い | 扱い |
|---|---|---|
| 1 | **進捗に「入室中」が挟まる** | 他部門は 依頼済 → 受付済 → 実施済。手術は受付(日程確定)から実施まで長く、その間「今この患者が手術中である」ことが分からないと病棟・麻酔科・家族への説明が回らない。Task に `in-progress` を 1 段足した |
| 2 | **実施者が複数いる** | 処置は `performer[0]` の 1 人。手術は執刀医・助手・麻酔科医・器械出し・外回り・ME が誰だったかが記録の要件(算定でも執刀医を問われる)。［事実］`Procedure.performer` は 0..* で `function` に役割を持てるので、申込のスタッフ拡張と同じ CodeSystem を `function` に使う |
| 3 | **時間が幅を持つ** | 処置は `performedDateTime` の一点。手術は入室〜退室の幅が麻酔管理料などの算定根拠になるので `performedPeriod` にする |
| 4 | **測定値を持つ** | 出血量・尿量・輸血量。放射線の被曝線量と同じく、ハブに `partOf` でぶら下げる Observation |

［提案］**実施入力は退室後にまとめて 1 回**。入室は一覧の「入室」ボタンで Task を
進めるだけにした。術中のリアルタイム記録(麻酔記録)は別物で、第3段階の領分と割り切る。
2 段入力(入室時に一部保存)にすると途中状態の Procedure(`status: in-progress`)を
持つことになり、「実施記録は完成形で 1 回書く」という他部門の作法から外れる。

［提案］**実施入力データセット(器械セットなどの初期明細マスタ)は作らない**。
薬剤・材料は全件検索で足す。術式ごとの定型明細が欲しくなったら、処置と同型の
3 テーブル + 画面を後付けする(`DatasetPick` 機構はそのまま使える)。

---

## 2. FHIR の構造

```text
ServiceRequest(申込) ←basedOn── Procedure ハブ(実施記録。オーダー単位で1件)
                                  │ meta.profile = JP_Procedure
                                  │ status = completed / category = order-type|surgery
                                  │ code = 実施術式の1件目(レセ電算 K/L コード)
                                  │ performedPeriod = 入室〜退室
                                  │ performer[] = 役割つき複数(function = surgery-staff-role)
                                  │ usedCode = 材料(数量は拡張) / note = 実施コメント
                                  │ complication[0].text / outcome
                                  │ extension = 中間時刻4点・創分類・カウント
                                  ├ partOf ← Procedure(2件目以降の術式・麻酔の手技料)
                                  ├ partOf ← MedicationAdministration(薬剤)
                                  └ partOf ← Observation(出血量・尿量・輸血量)
```

子 Procedure は処置と同じく **`basedOn` もオーダーを指す**(`Procedure.code` は 0..1 で、
異なる手技を 1 つの CodeableConcept の複数 coding に混ぜるのは意味が違うため分ける)。

［提案］**実施者はハブだけが持つ**。子は「同じ手術の別の手技料」でしかなく、
術者を二重に持たせても読み手に足す情報が無い。

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 |
|---|---|
| `StructureDefinition/surgery-perform-times` | 中間時刻の複合拡張。sub-url `anesthesia-start` / `incision-start` / `incision-end` / `anesthesia-end`(valueDateTime)。［導出］入室・退室は `performedPeriod` の start/end に入るが、Period は 2 点しか持てないので途中の 4 点は標準要素に置き場所が無い |
| `StructureDefinition/surgery-wound-class` + `CodeSystem/surgery-wound-class` | 創分類。clean 清潔 / clean-contaminated 準清潔 / contaminated 汚染 / dirty 感染・不潔。SSI サーベイランスの軸 |
| `StructureDefinition/surgery-count-check` + `CodeSystem/surgery-count-check` | ガーゼ・器械カウント。verified 合致 / discrepancy 不一致 |
| `StructureDefinition/surgery-material-quantity` | `usedCode` に数量を添える(treatment-material-quantity と同型) |
| `CodeSystem/surgery-outcome` | `Procedure.outcome`。good 良好 / complicated 合併症あり / death 死亡 |
| `CodeSystem/surgery-observation` | 測定値 Observation の code。blood-loss / urine-output / transfusion-volume。単位は mL(UCUM `mL`) |

再利用: `CodeSystem/surgery-procedure-code`(**申込明細の K コードと同じ system**。
予定と実施を同じコード体系で突き合わせられるようにするため。麻酔の L 章も同じ)、
`CodeSystem/surgery-staff-role`(`performer.function`)、`CodeSystem/medical-material`、
`CodeSystem/medicine-code` / YJ、JP Core `route-codes`、`CodeSystem/order-type` の
`surgery`(部門振り分けの唯一の軸)、`CodeSystem/task-code` の `surgery`。

### 2.2 測定値 Observation

［提案］放射線の被曝線量と同じ流儀で、**`category` を持たせず `partOf` でハブに紐づける**。
バイタルのように経過表へ並ぶ測定値ではなく、手術の実施記録の一部だから。
値は UCUM(`system: http://unitsofmeasure.org`, `code: mL`)。

### 2.3 スタッフの役割

`SurgeryStaffRole` に器械出し(`scrub-nurse`)・外回り(`circulating-nurse`)・
臨床工学技士(`ce`)を足し、6 役にした。選択肢の配列だけを 2 つに分けてある。

- `SURGERY_STAFF_ROLE_OPTIONS`(3 役)… 申込フォーム
- `SURGERY_PERFORM_STAFF_ROLE_OPTIONS`(6 役)… 実施入力

［提案］器械出し・外回り・ME は「誰が入るか」が当日決まるので申込では聞かない。
コード体系は共通なので、申込で選んだ執刀医をそのまま実施記録の初期値にできる。

---

## 3. Task の状態遷移

| 状態 | 表示 | 主操作 | ケバブ(secondary) |
|---|---|---|---|
| requested | 申込済 | 受付 | 中止 |
| accepted | 受付済 | **入室** | 取消 / 中止 |
| in-progress | **入室中** | **実施**(実施入力を開く) | 入室取消 |
| completed | **実施済** | — | **実施取消**(記録ごと消す) |
| cancelled | 中止 | — | 中止を取消 |

［実装］**`taskHelpers.ts` の `executionPeriod` を直した**。従来は `accepted` のときだけ
`{start}` で、それ以外は `end` を入れていたため、`in-progress` に終了時刻が入ってしまう。
`accepted | in-progress` を `{start}` のみに変えた(汎用の修正。他部門は
`in-progress` を使っていないので挙動は変わらない)。

---

## 4. 緊急手術の例外路

［提案］**日程未定のまま入室できる**。日程未定タブで、予定区分が緊急・準緊急かつ
申込済の行にだけ「入室」を出す。押した日時をそのまま `occurrenceDateTime` に書き、
Task を入室中にするところまでを 1 transaction で書く(`useAdmitUnscheduledSurgery`。
既存の `buildSurgeryScheduleBundle`「オーダー PUT + Task」がそのまま使える)。

緊急手術は日程を決めてから始めるものではないので、「日程を確定 → 入室」の 2 操作を
踏ませると現場が先に手術を始めて記録が後追いになる。入室した事実の方が確かなので、
それを予定日時として記録する。入室すると occurrence が入るので未定タブから消え、
予定日別タブの当日ぶんに入室中で並ぶ。

所要時間・手術室は申込で希望していればそのまま残す(日程だけを埋める)。

---

## 5. 画面

`components/SurgeryPerformModal.tsx`。処置と同じ二層(`SurgeryPerformModal` = 送信つき /
`SurgeryPerformInputModal` = 値だけ)。今のところ入力層を使うのは 1 か所だが、
将来「即実施」相当が要るときに送信先を差し替えるだけで済むよう雛形どおり維持した。

1. **時刻** … 入室・退室(必須)+ 麻酔開始・執刀開始・執刀終了・麻酔終了(任意)。
   入室の初期値は予定入室時刻。［実装］入力があるものだけを並び順どおりに比べ、
   前後が破れていたら「執刀開始は麻酔開始以降の時刻にしてください。」と出す
   (`validateSurgeryTimes`)
2. **実施術式・麻酔**(1 件以上必須) … 申込の術式を初期行にする。「+ 術式(K)」
   「+ 麻酔(L)」で `MedicalProcedureSearchModal` を章を変えて開く。開腹移行・追加術式・
   麻酔管理料はここで差し替える。［実装］**K コードを持たない術式は初期行にしない**
   (名称だけ残しても手技料にならず、実施入力の目的から外れる)
3. **実施スタッフ** … 申込のスタッフが初期値。役割セレクト(6 役)+ 医療従事者検索。
   執刀医は必須。［実装］器械出し・外回りは看護師、それ以外は医師を職種フィルタの既定にする
4. **測定値** … 出血量・尿量・輸血量(mL)
5. **記録** … 創分類 / カウント / 転帰 / 合併症(自由記載)。
   ［実装］**カウント不一致のときは実施コメントを必須**にする(何が合わなかったかが
   後から追えないと記録の意味がない)
6. **薬剤・使用材料** … 処置と同じ検索モーダル。データセット候補モードは渡さない
7. 実施コメント

カルテカードは他部門と同じ `karte-perform` セクション。行は
術式 / スタッフ / 時刻 / 測定 / 記録 / 薬剤 / 材料 + コメント。
見出しは「実施情報 2026-08-28 09:05 〜 11:20」。
実施情報を出すのは**進捗が実施済のときだけ**(他部門と同じ判定)。

---

## 6. 上流 fhir-server の追加

**不要**。Procedure / MedicationAdministration / Observation はいずれも
`FhirProxyController::ALLOWED_RESOURCE_TYPES` にあり、`based-on` / `part-of` 検索も
実装済み。カルテの取得クエリ(`_revinclude=Procedure:based-on` /
`_revinclude:iterate=MedicationAdministration:part-of` / `Observation:part-of`)も
既にあるので、この形に載せるだけでカルテ側は無改修で動いた。

backend も変更なし(実施入力データセットを作らなかったため)。

---

## 7. 実装したもの

| 層 | 追加物 |
|---|---|
| FHIR 変換 | `fhir/surgeryResultHelpers.ts`(新規) |
| 画面 | `components/SurgeryPerformModal.tsx`(新規) |
| 変更 | `fhir/surgeryTaskHelpers.ts`(5 状態)/ `fhir/taskHelpers.ts`(in-progress の executionPeriod)/ `fhir/surgeryOrderHelpers.ts`(役割 6 役・`STAFF_ROLE_SYSTEM` を export)/ `pages/SurgeryWorklistPage.tsx` / `api/queries.ts` / `fhir/karteTimeline.ts` / `components/KarteTimeline.tsx` / `components/KarteCardModals.tsx` |

### 7.1 検証したこと

開発環境で以下を通した。`tsc -b` clean・`oxlint` 既存 4 warnings のみ・
backend 全 985 examples green(無変更の回帰確認)。

1. **入室**: 受付済の行 → 入室 → ステータス入室中。
   `Task.executionPeriod` に `end` が**入らない**こと
2. **実施入力**: 申込の術式(K コード)とスタッフ 3 名が初期表示 → 時刻の順序検証を
   1 回踏む(「執刀開始は麻酔開始以降の時刻にしてください。」)→ 直して L 章から
   「閉鎖循環式全身麻酔1」追加・セボフルラン 40mL 吸入・出血量 350 / 尿量 200・
   創分類 準清潔・カウント合致・転帰 良好・コメント → 登録
3. **FHIR**: ハブ Procedure(code / performedPeriod 09:05〜11:20 / performer 3 名に
   function / 拡張 3 本 / outcome / note)、子 Procedure 1、
   MedicationAdministration 1、Observation 2 が 1 transaction で入り、
   Task が completed になること
4. **カルテ**: カードが実施済 + 実施情報(入室〜退室・術式・スタッフ・時刻・測定・
   記録・薬剤・コメント)。FHIR JSON 表示が「オーダー」「実施記録」の 2 節になること
5. **実施取消**: Observation・MedicationAdministration・子・ハブが**全部消え**、
   Task が入室中に戻り(`end` も落ちる)、カードから実施情報が消えること
6. **緊急の例外路**: 日程未定・緊急の申込 → 未定タブに「入室」が出る(予定 routine の
   行には出ない)→ 押すと occurrence に押した日時が入り Task が入室中、未定タブから消えること
7. **回帰**: 処置一覧・既存 4 部門のカードと実施情報が不変。手術の申込〜受付・
   日程確定・入室取消も不変

［実装］使用材料は今回の画面検証では入れていない(検索モーダルと数量欄は処置と
同一コードで、request 相当の経路は薬剤で通っている)。

---

## 8. 申し送り

1. **第3段階**: **実装済み**(2026-08-28)。手術記録テンプレート + シェーマ
   (`SUR_OP_01`)、麻酔記録テンプレート(`SUR_ANES_01`)、手術説明・同意書の帳票
   (`SUR_CONSENT_01`)、術前指示テンプレート(`SUR_PREOP_01`)。
   `docs/report-mappings/sur-*.md` を参照。構造化データ(時刻・スタッフ・測定値
   など)は実施入力が持ち、テンプレートには再入力させない線引きを各ドキュメントに
   書いた。**術中のリアルタイム記録(麻酔チャート)も実装済み**
   (`docs/anesthesia-chart-design.md`。手術一覧の入室中・実施済の行から開く専用
   ページで、打点・イベント・薬剤を 1 点ずつ保存する)
2. **実施入力データセット**: 術式ごとの定型明細(ヘルニアならメッシュ一式 など)が
   欲しくなったら、処置と同型の `master_surgery_datasets` + 明細 + マスタ画面を足す。
   `DatasetPick` 機構と `MedicalProcedureSearchModal` の `datasetPick` prop は
   そのまま使える
3. **合併症のコード化**: 今は `complication[0].text` の自由記載。NCD 提出を見据えると
   コード表(Clavien-Dindo 等)が要るが、レポート機能と合わせて設計する方が筋がよい
4. **ASA-PS**: 麻酔の術前評価は実施記録ではなく麻酔科の術前診察に属するので入れていない。
   麻酔科ワークフロー(surgery-order-design §B-2 で「今は持たない」と決めたもの)を
   作るときに扱う
5. **会計連携**: K コード(ハブと子の `Procedure.code`)・材料の `usedCode` 数量・
   薬剤の `dosage.dose` が算定の素材。`ChargeItem` / `Claim` は上流に未実装
6. **DPC / NCD**: K コード・到達法(申込明細)・合併症・創分類が提出データの起点。
   構造化を崩さないこと
