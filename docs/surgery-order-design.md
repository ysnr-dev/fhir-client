# 手術オーダーの設計(第1段階: 申込〜日程確保)

処置(`docs/treatment-order-design.md`)を雛形にした 5 例目の同型オーダー。ただし
過去 4 例(rad → physio → endoscopy → treatment)が「落とすだけ」の差分だったのに
対し、手術は**足すものが多い**。マスタ → 申込入力 → カルテカード → 手術一覧 の
骨格は同型のまま、申込ヘッダを厚くしてある。同じところは処置の設計書(とその参照
先)を参照。

実装日: 2026-08-25。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 手術が既存 4 種と違うところ

| # | 違い | 第1段階での扱い |
|---|---|---|
| 1 | 多資源の同時確保(手術室 × 時間帯 × 執刀チーム × 麻酔科医) | ［提案］予約枠(Slot)は使わない。**日時 + 手術室の指定のみ**とし、同室の時間帯の重なりは手術一覧(手術室 → 入室時刻順)の目視で確かめる。多資源の空き判定は予約機構の拡張として将来扱う |
| 2 | 参加者が多役割(執刀医・助手・麻酔科医・器械出し・外回り…) | 申込では執刀医(必須)・助手(複数)・麻酔科医の 3 役。実施メンバーは第2段階(実施記録)で扱う |
| 3 | 時間軸が長い(申込 → 受付 → 入室 → 退室 → 記録) | 第1段階の Task は申込済 → 受付済 (→ 中止) のみ。`in-progress`(入室) / `completed` は第2段階で足す |
| 4 | 記録が本体級に重い(手術記録・麻酔記録) | 第2段階以降。テンプレート(Questionnaire)+ シェーマに載せる予定 |
| 5 | 予定と実施の乖離が常態(開腹移行・追加術式) | 明細は「予定術式」。実施術式は第2段階の Procedure 側に持つ |

その他の判断:
- **1 オーダー = 手術 1 件**。処置のような単独/まとめの分割・セット・伝票レイアウト
  は持たない(術式は検索モーダルで選ぶ)。
- **予定手術日は任意(希望日)で、手術部が確定する**。診療科は日程未定のまま申し込め、
  手術部が手術一覧の「日程未定」タブから日程・手術室を入れて確定する(§5.2)。
  日程を入れて申し込むこともでき、その場合は予定日別タブでそのまま受付する。
- **authoredOn は申込日**。既存 4 種は実施日を入れているが、手術は申込から実施まで
  日が空くのが普通なので、予定日時は `occurrence` に分けた。
  ［事実］上流の occurrence 検索は `occurrenceDateTime` だけを抽出する
  (`extraction_definitions/service_request.rb`。Period は索引されない)ため、
  `occurrencePeriod`(入室〜退室)ではなく **`occurrenceDateTime`(入室予定) +
  所要時間のローカル拡張**にした。退室予定は start + 所要時間で導出できるので
  情報は落ちておらず、上流改修も要らない。
- 麻酔は別オーダーにせず**手術オーダーの一部**(麻酔方法・管理区分をヘッダに持つ)。
- 共通化(treatment §7-4 の申し送り)は今回も見送り、写しで作った。手術はヘッダの
  要素・多役割スタッフ・Task の状態数と差分が大きく、ファクトリに手術だけの例外を
  入れ込むと抽象を誤るため。**申し送りは「手術完了後(5 例の実態が見えた後)に再検討」へ更新**。

### 1.1 命名

英語識別子は `surgery`。画面・カード・メニューの表記は「手術」。カルテ右ペインの
ボタンも「手術」(押すと申込フォーム)。

---

## 2. FHIR の構造

```text
ヘッダ ServiceRequest  (category: order-type|surgery)
  ←basedOn── 明細 ServiceRequest(術式。identifier の並び順 1 が主術式)
  ←focus──── Task           (進捗: surgery)
```

第1段階では Procedure(実施記録)・Appointment(予約)を作らない。

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 |
|---|---|
| `CodeSystem/order-type` の値 `surgery` | ヘッダの `category[0]`。`isSurgeryServiceRequest` の判定軸 |
| `CodeSystem/surgery-order-item` | 明細 `code.coding[0]`。術式マスタの独自コード |
| `CodeSystem/surgery-procedure-code` | 明細 `code.coding[1]`。レセ電算 診療行為コード(K章)の写し |
| `IdSystem/surgery-order-item-number` | 明細 `identifier`。1 が主術式 |
| `StructureDefinition/surgery-room` | 手術室(valueReference → Location) |
| `StructureDefinition/surgery-duration` | 予定所要時間(valueQuantity 分) |
| `StructureDefinition/surgery-department` | 執刀科(valueReference → Organization)。依頼科(order-department)と別れうる |
| `StructureDefinition/surgery-position` | 手術体位(valueCoding) |
| `StructureDefinition/surgery-estimated-blood-loss` | 予定出血量(valueQuantity mL) |
| `StructureDefinition/surgery-staff` | スタッフ。複合拡張 `role`(valueCoding) + `member`(valueReference → Practitioner) を人数ぶん繰り返す |
| `StructureDefinition/surgery-anesthesia-method` | 麻酔方法(valueCoding、複数可) |
| `StructureDefinition/surgery-anesthesia-management` | 麻酔の管理区分(麻酔科管理/執刀医管理) |
| `StructureDefinition/surgery-blood-preparation` | 輸血準備。複合拡張 `type`(valueCoding) + `units`(valueQuantity) |
| `StructureDefinition/surgery-equipment` | 特殊機器(valueCoding、複数可。「その他」は display に自由記載) |
| `StructureDefinition/surgery-specimen-plan` | 病理・培養の提出予定(valueCoding、複数可) |
| `StructureDefinition/surgery-consent` | 取得済み同意書(valueCoding、複数可)。［提案］FHIR `Consent` は使わない(proxy 未許可で、第1段階は取得済みチェックで足りる。書面は将来の帳票) |
| `CodeSystem/surgery-{position,staff-role,anesthesia-method,anesthesia-management,blood-preparation,equipment,specimen-plan,consent,approach}` | 上記拡張の valueCoding の system |

明細側:

| URI | 用途 |
|---|---|
| `StructureDefinition/surgery-approach` | 到達法(開腹/腹腔鏡/胸腔鏡/ロボット支援/鏡視下/経皮/その他)。［提案］DPC・NCD の起点になるので構造化して持つ |

再利用: `CodeSystem/prescription-setting`、`CodeSystem/lab-item-abbreviation`、
`CodeSystem/jj1017-laterality`(bodySite の左右 R/L/B)、`CodeSystem/task-code` の値
`surgery`、依頼科・病棟の拡張(`applyOrderContext`)。

### 2.2 ヘッダの中身

| 画面項目 | FHIR 要素 |
|---|---|
| 申込日 | `authoredOn` |
| 予定手術日・入室予定時刻 | `occurrenceDateTime`(時刻なしなら日付のみ)。**未定なら要素ごと出さない** |
| 予定所要時間 | `extension[surgery-duration]`(valueQuantity 分) |
| 予定区分(予定/準緊急/緊急) | `priority` = routine / urgent / stat |
| 対象プロブレム | `reasonReference[0]`(既存共通) |
| 特記・申し送り | `note` |
| 手術室〜同意書 | §2.1 の拡張群 |
| 入外区分・依頼科・依頼医・在院病棟 | 既存同型(`category[1]` / `applyOrderContext`) |

### 2.3 明細(術式)1 件の中身

| FHIR要素 | 入れるもの |
|---|---|
| `code.coding` | 術式コード(`surgery-order-item`)、K コード(`surgery-procedure-code`)、略称 |
| `identifier` | 並び順(1 が主術式) |
| `bodySite` | 部位(text) + 左右(jj1017-laterality の R/L/B)。text は「右 膝関節」の形 |
| `extension[surgery-approach]` | 到達法 |
| `reasonReference` / `reasonCode.text` | 術前診断。登録病名(ConditionPickerModal)か直接入力(rad の依頼病名と同型) |
| `basedOn` | ヘッダ |

［提案］部位・左右を明細ごとに聞くのは左右の取り違え防止のため。rad と違い部位の
標準コード表は使わない(術式名 + 自由記載で足り、JJ1017P は手術の語彙ではない)。

［提案］**左右は術式マスタの `requires_laterality` が立っている術式でだけ必須**にする
(申込画面が印を見て検証し、ラベルも「左右(必須)」になる)。左右のある術式
(鼠径ヘルニア・人工関節置換 など)は WHO 手術安全チェックリストの取り違え防止項目に
当たるので必須にするが、左右の無い臓器(胃・虫垂 など)まで一律に必須にすると意味の無い
「指定なし」を選ぶ手数が増える。既定は false で、左右のある術式の方を印付ける。
保存済みオーダーの明細からは印を復元できないので、申込画面は選択中の術式コードから
今のマスタを引き直す(処置の `groupable` と同じ扱い)。

---

## 3. マスタ

```text
master_surgery_items   -- 術式マスタ。master_treatment_items から kind/セット/
                          groupable/データセット/予約列を落とし、申込フォームの
                          既定値列を足したもの:
                          receipt_code(Kコード) / default_duration_minutes /
                          default_approach / default_position /
                          default_anesthesia_methods(カンマ区切り、複数可) /
                          requires_laterality(左右を必須にするか。既定 false)
```

- セットのテーブル(`master_surgery_set_items`)は**作らなかった**。術式の主・副は
  申込画面でその都度選ぶもので、定型の組み合わせが要る運用になってから足す。
- 伝票レイアウト・実施入力データセットも無い(§1)。
- 既存規約どおり FK 無し・`Master::` 名前空間・`SearchNormalizer` の `search_*` 列。
  **seed は無い**(配布マスタが無く、施設が 1 件ずつ登録する。K コード検索で補助)。

既定値列は「術式を選んだ時点で申込ヘッダに写す」初期値。最初に選んだ術式(=通常は
主術式)の既定だけを使い、2 件目以降では上書きしない。

---

## 4. 上流 fhir-server の追加

**不要**。使う検索パラメータ(`category` / `occurrence` / `based-on:missing` /
`_revinclude` Task:focus / `_include` subject)はすべて値に依存しない汎用実装で、
`order-type|surgery` も同じ仕組みに乗るだけ(過去 3 例で確認済み)。予約枠を使わない
ので `Schedule.specialty` 検索(server-improvement-backlog C-5)も要らない。

---

## 5. 画面

| 画面 | パス | 元 |
|---|---|---|
| 術式マスタ | `/surgery-items` | `TreatmentItemPage`(セット・レイアウト・予約・データセット列を削除、既定値列を追加。K コードは `MedicalProcedureSearchModal` の `defaultSection="K"` から選べる) |
| 手術一覧(手術部業務) | `/surgery-worklist` | `TreatmentWorklistPage`(並びを手術室 → 入室予定時刻に変更、手術室フィルタ追加、実施入力なし) |
| オーダー入力 | カルテ右ペイン「手術」 | 新規(`SurgeryOrderForm`)。伝票タブ無し、術式は検索モーダル、ヘッダ入力が厚い |

### 5.1 申込フォームの構成

1. **手術共通**: 対象プロブレム / 入外区分 / 予定区分 / 執刀科(自院の診療科)
2. **日程・手術室**: 予定手術日(必須) / 入室予定時刻 / 予定所要時間(分) / 手術室
   (Location 種別 `SU` のセレクト。未定も可)
3. **術式**(1..*、必須): 検索モーダルで追加。先頭が主術式(「上へ」で入れ替え)。
   各行に 部位 / 左右 / 到達法 / 術前診断
4. **スタッフ**: 執刀医(必須・1人) / 助手(複数) / 麻酔科医(1人)。
   `PractitionerSearchModal`(職種=医師)で選び、チップで並べる
5. **麻酔**: 麻酔方法(チェックボックス複数) / 管理区分。
   ［実装］麻酔科管理を選んだら麻酔科医の選択を必須にする
6. **準備**: 輸血準備(不要/T&S/交差適合/自己血、後2者は単位数) / 予定出血量(mL) /
   手術体位 / 特殊機器(複数+その他自由記載) / 検体提出予定(術中迅速・永久標本・培養)
7. **同意書**: 手術/麻酔/輸血の取得済みチェック
8. **特記・申し送り**: 自由文

### 5.2 手術一覧

タブが 2 つ。

**予定日別**
- 上流での絞り込みは**予定手術日**(`occurrence`)のみ。
- 並びは手術室 → 入室予定時刻。部屋未定は末尾。同室の時間帯の重なりがそのまま見える。
- フィルタ: 手術室 / 入外区分 / 病棟 / 診療科(依頼科) / ステータス。
  手術室・病棟の選択肢は読み込んだ 1 日ぶんのオーダーから拾う(マスタを引かない)。
- 行の操作は「受付」(=日程確定)と、ケバブメニューの取消・中止。

**日程未定**(`occurrence:missing=true`)
- 予定手術日を入れずに申し込まれたもの。タブ見出しに件数を出す(滞留に気づけるように)。
- 並びは緊急 → 準緊急 → 予定、その中で申込日の古い順(待たせている順)。
- 先頭列は「手術室 / 入室」ではなく**申込日**。日付・手術室・ステータスのフィルタは出さない
  (全件が未定・申込済なので絞る意味がない)。
- 行の操作は「日程を確定」(`SurgeryScheduleModal`)。予定手術日・入室予定時刻・
  所要時間・手術室を入れて、**オーダーの日程と Task(受付済 = 日程確定)を 1 transaction**で書く
  (`buildSurgeryScheduleBundle`)。所要時間は申込時に術式マスタの既定値が入っているので初期表示。
  確定後の日程変更はカルテカードの編集から行うので、モーダルは「未定 → 確定」の一方向だけ。

［提案］**希望日を書いた申込は日程未定タブには出ない**(`occurrence` を持つので予定日別
タブのその日に「申込済」として出る)。手術部の待ち行列が 2 か所に分かれるが、1 か所に
集約するには希望日と確定日を別要素で持つか、登録時から Task を作る(全部門の約束を
変える)必要があり、どちらも高くつく。

### 5.3 カルテでの見え方

手術カードは**予定手術日**の位置に出す(申込日ではない)。日程未定のあいだは時系列の
最上部の「日付未定」グループに入り、日程が決まるとその日へ移る。診療日ペインにも
「日付未定」が出る(存在するときだけ)。

これは手術専用の仕掛けではなく、**種別非依存の土台**として `fhir/karteTimeline.ts` に置いた。
詳細は readme の「日付未定オーダー」を参照。

### 5.4 共通基盤に足したもの

- `MedicalProcedureSearchModal` の章セレクタに **`K 手術` / `L 麻酔`** を追加
  (L は第2段階の麻酔コード入力の先行対応。既存の呼び出しは変更なし)
- `LOCATION_TYPE_OPTIONS` に **`SU 手術室`** を追加(`/locations` から登録。
  `LOCATION_TYPE_CODES` が一覧・選択肢の検索キーを兼ねるので追加だけで効く)
- カルテ 6 箇所(`karteTimeline` / `KarteRightPane` / `KarteTimeline` /
  `KarteCardModals` / `KarteCategoryList` / `karteUrl` / `KartePage`)に
  `surgery-order` の分岐(treatment 追加時と同じ箇所)

カルテカードは申込日の位置に置き、メタ行に「予定 日時 | 手術室 | 依頼元」、本文に
主・副術式(部位・到達法つき)と「執刀: ◯◯ | 麻酔: ◯◯」の要点 1 行を出す。
タイトルは入外区分+(緊急・準緊急のときだけ)予定区分。

---

## 6. 実装したもの

| 層 | 追加物 |
|---|---|
| migration | `20260825100000` 術式マスタ |
| モデル | `Master::SurgeryItem` |
| API | `surgery_items`(index/show/create/update/destroy) |
| spec | リクエスト 1 本(12 examples)。backend 全 984 examples green |
| FHIR 変換 | `fhir/surgeryOrderHelpers.ts` / `surgeryTaskHelpers.ts` |
| 画面 | `SurgeryItemPage` / `SurgeryWorklistPage` / `SurgeryOrderForm` / `SurgeryOrderPanels` / `SurgeryOrderDetailPanel` / `SurgeryItemSearchModal` / `useSurgeryOrderInitialValues` |
| カルテ | `karteTimeline` に `surgery-order` 種別、`KarteRightPane` の「手術」ボタン、`KarteTimeline` のカード、`KarteCardModals` の詳細/JSON、`KarteCategoryList` / `karteUrl` / `KartePage` の分岐 |
| 共通 | `MedicalProcedureSearchModal` に K/L 章、`locationHelpers` に SU |

### 6.1 検証したこと

開発環境で以下を通した。`tsc -b` clean・`oxlint` 既存 4 warnings のみ・backend 全
984 examples green(手術 12 examples 含む)。

1. マスタ: `/locations` に種別「手術室」で手術室1を登録。`/surgery-items` で
   術式 2 件登録(K 章に絞った医科診療行為検索から「腹腔鏡下胆嚢摘出術」を選び、
   K コード・名称が写ること。既定値: 120分・腹腔鏡・仰臥位・全身麻酔(吸入))
2. 申込: カルテ右ペイン「手術」→ 術式選択で既定値(所要時間・到達法・体位・
   麻酔方法)がヘッダに写る → 執刀医・助手・麻酔科医(職種 = 医師で絞った検索)、
   麻酔科管理、T&S、予定出血量、特殊機器・検体提出予定・同意書のチェック、
   特記 → 登録。FHIR 上でヘッダ(order-type|surgery・入外区分・priority・
   occurrenceDateTime・全拡張・依頼科・病棟拡張)と明細(術式コード・K コード・
   略称・approach 拡張・reasonCode.text)を確認
3. カルテカード: バッジ「手術」、メタ「申込済 | 予定 2026-08-28 09:00 | 手術室1 |
   依頼元」、本文に主術式 + 到達法 +「執刀 | 麻酔」の要点行。詳細モーダルに
   全項目、FHIR JSON 表示
4. 手術一覧: 予定手術日で絞り込み、行(手術室/入室・術式・執刀医・麻酔・区分・
   病棟・依頼元)→ 受付 → ステータスが受付済になり、カルテカードにも反映
5. 編集: 保存値からのフォーム復元(日程・スタッフ・チェック群) → 更新
6. DO: 術式・スタッフ・準備を引き継ぎ、予定手術日・入室時刻は空の申込フォームが
   開くこと

**occurrencePeriod からの直し**: 最初の実装は予定日時を `occurrencePeriod`
(start=入室、end=start+所要時間)にしていたが、手術一覧(occurrence 検索)に
1 件も出ないことで上流が Period を索引しないと分かり、`occurrenceDateTime` +
`surgery-duration` 拡張へ変えた(§1)。読み出しは occurrencePeriod にも
フォールバックするので、直す前に登録したオーダーも表示・編集できる(編集して
更新すれば新しい形に置き換わる)。

削除はオーダー削除が `window.confirm` を挟むため画面からは通していない
(ヘッダ + 明細の一括削除。request 層は既存 4 種と同型)。

---

## 7. 申し送り

1. **第2段階(実施記録)**: 時刻 6 点(入室/麻酔開始/執刀開始/執刀終了/麻酔終了/退室)、
   実施術式(予定との差分)、実施スタッフ(器械出し・外回り・ME を役割コードに追加)、
   出血量・尿量・輸血量(Observation)、ガーゼ・器械カウント、創分類(SSI)、
   `Procedure.complication` / `outcome`、薬剤・材料実績、麻酔コード(L 章、
   `defaultSection="L"` は追加済み)。Task に `in-progress` / `completed` を足す
2. **第3段階**: 手術記録・麻酔記録テンプレート + シェーマ、同意書帳票
   (admission-plan-01 方式)、術前指示テンプレート(SUR_PREOP_01。絶飲食・前投薬・
   抗血栓薬休薬・除毛・予防抗菌薬)を作り、既存テンプレート機構に載せる
3. **手術室カレンダー**: ブロックスケジュール(曜日ごとの科割り当て)や多資源の
   同時空き判定が要る運用になったら、予約機構の拡張として別途設計する。
   **ダブルブッキングの防止もここに含める**。予約枠(Slot)を使わない判断をしたので、
   今の手立ては「手術部が全件の日程を確定する人的チェック」と「一覧を手術室 →
   入室時刻順に並べて重なりを隣接させること」の 2 つ。カレンダーが入れば競合する
   オーダーを作れなくなるので、それまでの中間策(一覧に警告バッジを出す 等)は
   捨て仕事になる。
   なお**日程を確定するモーダルからは、その日その部屋の他の予定が見えない**のが
   唯一の盲点(競合が生まれるのはこの瞬間)。カレンダーより先に運用へ載せるなら、
   確定モーダルに「その日のその部屋の予定」を出す最小版を入れれば足りる
4. **DPC / NCD**: K コード・到達法・(第2段階の)合併症は提出データの起点になるので、
   構造化を崩さないこと
5. **共通化**: treatment §7-4 の「5 つ目が出る前に共通化を検討」は、手術の差分が
   大きく写しを選んだため「手術完了後に、5 例の実態を見て再検討」に更新する
