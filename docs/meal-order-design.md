# 食事オーダーの設計

入院患者の給食(常食・特別食・食止め)を指示するオーダー。処置オーダー
(`docs/treatment-order-design.md`)を雛形にしたが、**同型オーダーから落としたものが
非常に多く、残ったのは ServiceRequest 1 本だけ**という点で他の部門オーダーとは形が違う。

参考仕様に **SS-MIX2 標準化ストレージ仕様書 Ver.1.2i の給食オーダメッセージ
(OMD^O03、§3.8)** を使った。食種・主食・食止め・食事タイミングの表し方はこれに合わせている。

実装日: 2026-08-28。

本文中の区別:
- **［事実］** = FHIR R4 / SS-MIX2 の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 1. 他の部門オーダーとの違い = 「部門業務の作法」を全部落とすこと

| 落としたもの | 他オーダーでの役割 | 食事で落とす理由 |
|---|---|---|
| 明細 ServiceRequest | 1 伝票に複数項目を載せる | ［導出］オーダー 1 件が指すのは食種 1 つ。複数項目を束ねる概念が無く、ヘッダの `code` に直接入る(朝昼夕で変わる主食は §2.3 のとおり `orderDetail` の繰り返しで足りる) |
| 伝票レイアウト・セット・項目検索モーダル | 多数の項目から選ぶ導線 | 選択肢が施設あたり数十件で、セレクト 1 つで足りる |
| 進捗 Task・部門ワークリスト | 部門が受付 → 実施と進める | ［提案］今回は給食部門の画面を作らない。作るときは §7-1 |
| 実施記録(Procedure)・実施入力データセット | 実施内容を記録する | 配膳は記録の対象にしていない(同上) |
| 予約枠(Appointment/Slot) | 検査室の枠を押さえる | 食事に枠の概念が無い |
| 入外区分の選択 | 入院/外来を選ぶ | ［提案］食事は在院患者にだけ出す。§4 のとおり画面から欄を外し、値は `inpatient` 固定 |
| 至急区分(`priority`) | 通常/至急 | 食事に至急は無い |
| 実施日時の「時刻」入力 | 分単位の実施時刻 | ［事実］SS-MIX2 が食事を「朝食・昼食・夕食」のタイミング単位で扱う(§2.2)。分単位は要らない |

**足したもの**は「期間」だけ。他のオーダーが「その日 1 回」なのに対し、食事は
**開始したら次の指示まで続く**。ここが食事オーダー固有の設計点で、§2.2 に書く。

### 1.1 命名

［提案］英語識別子は `meal`。`nutrition` は将来 FHIR の `NutritionOrder` に載せ替える
可能性があるとき紛らわしいので使わない(§7-2)。画面・カード・メニューの表記は「食事」。

---

## 2. FHIR の構造

**ServiceRequest 1 本のみ**。明細も Task も実施記録も予約も無い。

```text
ServiceRequest (category: order-type|meal)
```

```jsonc
{
  "resourceType": "ServiceRequest",
  "status": "active", "intent": "order",
  "category": [
    { "coding": [{ "system": ".../order-type", "code": "meal" }] },
    { "coding": [{ "system": ".../prescription-setting", "code": "inpatient" }] }
  ],
  "code":        { "coding": [{ "system": ".../meal-type", "code": "A00105" }],
                   "text": "一般食2000kcal" },          // ODS-1=T 食種
  "orderDetail": [                                       // ODS-1=D 主食(食事ごと)
    { "extension": [{ "url": ".../meal-timing", "valueCode": "breakfast" }],  // ODS-2 サービス時間帯
      "coding": [{ "system": ".../meal-staple-food", "code": "105AG" }], "text": "米飯180g" },
    { "extension": [{ "url": ".../meal-timing", "valueCode": "dinner" }],
      "coding": [{ "system": ".../meal-staple-food", "code": "105AK" }], "text": "全粥" }
  ],
  "note":        [{ "text": "卵アレルギーあり。除去食で対応。" }],  // ODS-4 テキスト指示
  "occurrenceDateTime": "2026-08-28T08:00:00+09:00",     // TQ1-7 開始(朝)
  "extension": [
    { "url": ".../meal-skipped-timing", "valueCode": "lunch" },  // 昼は欠食(時間帯付きの食止め)
    { "url": ".../meal-order-end", "valueDateTime": "2026-08-31T18:00:00+09:00" },  // TQ1-8 終了(夕)
    { "url": ".../order-department", "valueReference": { "reference": "Organization/..." } },
    { "url": ".../order-ward",       "valueReference": { "reference": "Location/..." } }
  ],
  "reasonReference": [{ "reference": "Condition/..." }],  // 対象プロブレム
  "requester": { "reference": "Practitioner/..." }
}
```

### 2.1 新規に定義したローカル URI

いずれも `http://fhir-client.local/`。

| URI | 用途 | SS-MIX2 で対応するもの |
|---|---|---|
| `CodeSystem/order-type` の値 `meal` | `category[0]`。`isMealServiceRequest` の判定軸 | - |
| `CodeSystem/meal-type` | `code.coding`。食種(食止めを含む)マスタのコード | ODS-3(ODS-1=T)のローカルコード表 `99SKS` / `SSMIXTF01` |
| `CodeSystem/meal-staple-food` | `orderDetail[].coding`。主食マスタのコード | ODS-3(ODS-1=D)のローカルコード表 `99SSK` |
| `StructureDefinition/meal-timing` | `orderDetail[]` に付け、その主食がどの食事のものかを示す。無ければ全食共通 | ODS-2 サービス時間帯(`1:朝食` / `3:昼食` / `5:夕食`) |
| `StructureDefinition/meal-skipped-timing` | 欠食(`valueCode`。朝昼夕ぶん繰り返す) | 時間帯を指定した食止め `ODS\|T\|3^昼食\|NPO^食止め^SSMIXTF01` |
| `StructureDefinition/meal-order-end` | 終了日時(`valueDateTime`)。無ければ継続中 | TQ1-8 |

再利用: `CodeSystem/prescription-setting`、依頼科(`order-department`)・病棟(`order-ward`)の
拡張、`reasonReference`(対象プロブレム)。**`CodeSystem/task-code` は作っていない**(進捗が無い)。

［提案］**主食を `orderDetail` に置いた**のは、R4 の `orderDetail` が「`code` をどう実施するかの
追加詳細」で、食種に対する主食指定がまさにそれだから。細菌検査が目的菌を `orderDetail` に
入れている前例にも合う。ローカル拡張は標準要素が無いときの逃げなので使わない。

［提案］**コメントは `note`**。既存オーダーの `orderComment`(`fhir/shared.ts`)がそのまま
使える。`patientInstruction` はコードベースに使用例が無く、給食部門への指示であって
患者への指示でもない。

### 2.2 開始・終了は「日付 + 食事タイミング」

［事実］SS-MIX2 は TQ1-7(開始)/ TQ1-8(終了)を `YYYYMMDDHH` 形式にし、**HH に
`08:朝食` / `12:昼食` / `18:夕食`** を入れることを推奨している。

［提案］**この推奨値をそのまま `occurrenceDateTime` の時刻に焼き込む**。画面は
「開始日 + 朝/昼/夕」のセレクトで入力し、`08:00` / `12:00` / `18:00` に変換する
(`MEAL_TIMING_OPTIONS`)。理由:

1. SS-MIX2 と同じ表現なので、将来 OMD メッセージを出すときそのまま書ける
2. ［事実］上流は `occurrenceDateTime` だけを索引する(`occurrencePeriod` は索引されない)。
   開始が検索軸に載る
3. `orderCardDay`(`fhir/karteTimeline.ts`)が無変更で「開始日にカードを置く」
4. 同じ日の中の並びが文字列比較で済む

読み戻しは時刻の `08/12/18` からタイミングを逆引きする。**それ以外の時刻(他システムから
取り込んだデータなど)は判定せず、生の時刻をそのまま表示にフォールバックする**。

［提案］**終了はローカル拡張 `meal-order-end`**。`occurrencePeriod` を使えば標準の形に
なるが、上流が Period を索引しないので開始の検索性を失う。手術が
「`occurrenceDateTime` + 所要時間はローカル拡張(`surgery-duration`)」にしたのと同じ判断。
終了の時刻も開始と対称に `08/12/18` を入れ、「そのタイミングまで食べる」を表す。

［導出］**終了を設定しても `status` は `active` のまま**。終了は予定であって、期日に
`completed` へ倒すにはバッチが要る。継続中かどうかは拡張の有無で判定する
(`isMealOrderActiveOn`)。

### 2.3 主食は朝・昼・夕それぞれに指定する

［事実］SS-MIX2 は主食を **ODS-2(サービス時間帯)ごとに ODS を繰り返す**か、
**ODS-2 をブランクにした ODS を 1 つ**指定する形にしている。仕様書の例:

```text
ODS|T||A00105^一般食2000kcal^99SKS
ODS|D|1^朝食^99STM|105HI^パン^99SSK
ODS|D|3^昼食^99STM|105IA^めん^99SSK
ODS|D|5^夕食^99STM|105AG^米飯180g^99SSK
```

［提案］これに合わせ、**`orderDetail` を食事ごとに繰り返し**、どの食事のものかを
`meal-timing` 拡張(`breakfast` / `lunch` / `dinner`)で示す。CodeableConcept は Element
なので拡張を持てる。主食を `orderDetail` に置いた判断(§2.1)を変えずに時間帯の軸を足せる。

［実装］**`meal-timing` を持たない `orderDetail` は「全食共通」**として読む。SS-MIX2 で
ODS-2 をブランクにしたものと同じ意味で、この拡張を入れる前に登録したオーダーもこの形。
読み戻し(`parseMealStaples`)は食事ごとの指定を先に置き、共通の主食は**空いている食事だけ**
を埋める。

表示は逆に畳む。**全食同じ主食なら「主食: 米飯180g」の 1 行**、違うところがあれば
朝・昼・夕の 3 行に分ける(`uniformStaple` / `summarizeMealOrder`)。均一なオーダーの
カードが 3 行に増えないようにするため。

### 2.4 欠食(その食事だけ出さない)

［事実］SS-MIX2 では ODS-1=T(食種)にも ODS-2 を付けられるので、「昼だけ食事を出さない」は
`ODS|T|3^昼食^99STM|NPO^食止め^SSMIXTF01` — **時間帯を指定した食止め**になる。

［提案］つまり欠食は主食の一種ではなく食種側の情報なので、`orderDetail` に混ぜず
**独立した拡張 `meal-skipped-timing`**(`valueCode`、朝昼夕ぶん繰り返す)にした。
1 日を通して食事が出ない `is_fasting` の食種(§2.5)と、1 食だけ抜く欠食が、
FHIR 上でもはっきり別物になる。

［実装］画面では**主食セレクトの末尾の選択肢**として出す。行が増えず 1 操作で済むため
(モデル上は `MealStapleChoice = MealItemRef | MEAL_SKIPPED | null`)。

［実装］**3 食すべてが欠食のオーダーは弾く**。それは欠食ではなく食止めなので、
食種で「食止め」を選ぶよう促す。逆に食止めの食種を選んだときは 3 行ともクリアして無効にする。

### 2.5 食止めは食種の一つ

［事実］SS-MIX2 は食止めを **ODS-1=T(食種)の `NPO^食止め^SSMIXTF01`** で表すことを
推奨している(後方互換のため主食として書いてもよい、とも書かれている)。

［提案］これに合わせ、食止めを**食種マスタの 1 レコード**(`is_fasting = true`)として持つ。
`doNotPerform = true` は使わない。使うと「`order-type|meal` の active な SR」という
単純な検索・表示規則が壊れるだけで、得るものが無い。

［実装］`is_fasting` は**マスタ側の属性で、オーダーには写していない**。オーダー画面は
主食欄を無効にするためにこの印を使うだけなので、編集で開いたときはマスタを引き直して
入れ直す(`MealOrderForm` の `useEffect`)。

### 2.6 食事変更 = 新規登録と前オーダーの終了を 1 transaction で

［導出］食事は同時に 1 本しか出ていないのが正しい状態なので、「変更」は
**新しいオーダーの登録 + 前のオーダーへの終了設定**の 2 操作になる。片方だけ済むと
2 本が並んで出続けてしまうため、**1 つの transaction Bundle** にまとめた
(`buildMealOrderBundle` の第 4 引数)。

新規登録パネルは継続中のオーダーを列挙し(既定でチェック ON)、終了を
**新しい食事の直前のタイミング**に自動計算する(`previousMealPoint`)。

| 新しい食事の開始 | 前のオーダーの終了 |
|---|---|
| 朝 | 前日の夕 |
| 昼 | 同日の朝 |
| 夕 | 同日の昼 |

［実装］継続中の判定は 2 段構え。上流には終了拡張を絞る術が無いので、
`category=order-type|meal & status=active` で候補を引き、**開始日にまだ続いているか**を
クライアント側で評価する(`useActiveMealOrders`)。編集パネルには支援を付けない
(終了欄を直接直せる)。

---

## 3. マスタ

```text
master_meal_items  -- 食種(kind=diet)と主食(kind=staple)。1 テーブル
```

［提案］**食種と主食を 1 テーブルに入れた**。列構成が完全に同じで、FHIR 側は
CodeSystem の URI(`meal-type` / `meal-staple-food`)で既に区別しているため、テーブルを
分けても model・controller・spec・API・画面が 2 式になるだけ。処置の `kind`(single/set)と
同じやり方。

主な列: `item_code`(一意) / `name` / `name_kana` / `kind` / `is_fasting` /
`valid_from` / `valid_to` / `display_order` / `note` / `search_name` / `search_kana`。

- `short_name` は作らない(食種名は短く、カードにそのまま出る)
- **エネルギー kcal の列も作らない**。［提案］SS-MIX2 の例(`一般食2000kcal`)どおり名称に
  含める運用。栄養成分での集計が要るようになったら列を足す(§7-1)
- `is_fasting` は `kind = diet` のときだけ true にできる(モデルと画面の両方で落とす)
- 採番は「数字だけのコードの最大 + 1 を 6 桁ゼロ詰め」。［実装］**英字混じりのコードは
  計算から外す**ので、`NPO` や `A00105` のような SS-MIX2 互換コードを手入力しても
  自動採番が壊れない

**seed は無い**。配布マスタが無く、食種は施設ごとに違うので画面から 1 件ずつ登録する
(処置と同じ)。取込 API も付けていない。

---

## 4. 上流 fhir-server の追加

**不要**。使うのは `subject` / `category` / `status` / `_id` / `_sort=-authoredon` だけで、
すべて既存の汎用実装に乗る。

［事実］**`NutritionOrder` は使わなかった**。上流 fhir-server の対応リソース
(`config/routes.rb`)にも backend プロキシの許可リスト
(`fhir_proxy_controller.rb` の `ALLOWED_RESOURCE_TYPES`)にも無く、追加すると上流の
model・テーブル・search_definition・extraction まで要る。ServiceRequest なら他の 9 種の
オーダーと同じ器に乗り、カルテのタイムライン取得(1 本の ServiceRequest 検索)にも
そのまま混ざる。§7-2 に載せ替えの条件を書く。

［実装］`_sort` のキーは **`authoredon`**(`authored` ではない)。開発環境は
`Prefer: handling=strict` が効いているので、間違えると 400 になって気付ける。

---

## 5. 画面

| 画面 | パス | 元 |
|---|---|---|
| 食事オーダー項目マスタ | `/meal-items` | `TreatmentItemPage`(セット・データセット・レセ電算・予約を削除) |
| オーダー入力 | カルテ右ペイン「食事」 | 新規(`MealOrderForm`。伝票レイアウトが無いので 1 枚のフォーム) |

部門ワークリストは作っていない(§1)。

オーダーフォームの構成: 食種(必須)・対象プロブレム / 主食(朝・昼・夕、任意。欠食もここ) /
開始日・開始タイミング・終了日・終了タイミング / いま出ている食事(§2.6)/ コメント。

［実装］主食は**常に朝・昼・夕の 3 行**を出す。「共通で 1 つ」と「食事ごと」を切り替える
UI にはしていない(切り替えの状態を持たずに済み、行が固定なので読み間違えない)。

［実装］**入院中でない患者ではフォームを描かず**「食事オーダーは入院中の患者にだけ
登録できます」を出す(`MealOrderCreatePanel`)。入院判定は既存の
`useDefaultOrderSetting`(= `usePatientAdmission`)で、カルテの患者情報が既に引いている
問い合わせなので追加のリクエストは無い。同じ戻り値から病棟を取ってオーダーに焼き付ける。

［実装］検証は「食種が選ばれている」「3 食すべてが欠食でない(§2.4)」「開始日がある」
「終了 >= 開始」の 4 つ。終了の前後比較は日付とタイミングの並び順の 2 段で見る。

---

## 6. 実装したもの

| 層 | 追加物 |
|---|---|
| migration | `20260828200000_create_master_meal_items` |
| モデル | `Master::MealItem` |
| API | `master/meal_items`(index の kind / active / name フィルタ、自動採番) |
| spec | `spec/requests/master/meal_items_spec.rb`(14 examples) |
| FHIR 変換 | `fhir/mealOrderHelpers.ts` 1 本のみ(Task・実施記録のヘルパーは無い) |
| 画面 | `pages/MealItemPage.tsx` / `components/MealOrderForm.tsx` / `MealOrderPanels.tsx` / `MealOrderDetailPanel.tsx` / `mealItemOptions.ts` |
| queries | `useMealOrderDetail` / `useActiveMealOrders` / `useUpdateMealOrder` / `useDeleteMealOrder`、`OCCURRENCE_ORDER_TYPES` に `meal` を追加 |
| カルテ | `karteTimeline` に `meal-order` 種別、`KarteRightPane` の起動ボタンとパネル、`KarteTimeline` のカード本体・タイトル・削除、`KarteCardModals` の詳細/JSON、`KarteCategoryList` / `karteUrl` / `KartePage` の分岐 |

### 6.1 検証したこと

開発環境で以下を通した(患者「山田 太郎」= 東3階病棟 302号室に入院中)。

1. マスタ: 食種 3 件(`A00105 一般食2000kcal` / `A00201 糖尿病食1600kcal` /
   `NPO 食止め`(食止めフラグ ON))+ 主食 2 件(`105AG 米飯180g` / `105AK 全粥`)を登録。
   コード省略の登録が `000001` に自動採番され、**`NPO` などの英字コードが採番に
   混ざらない**こと。kind / active / 名称・カナ検索が効くこと
2. オーダー: カルテ右ペイン「食事」→ 一般食2000kcal + 米飯180g + 朝食から + コメントで登録。
   FHIR 上で `category`(`order-type|meal` + `prescription-setting|inpatient`)・
   `code`(食種)・`orderDetail`(主食)・`note`・
   **`occurrenceDateTime = 2026-08-28T08:00:00+09:00`**・依頼科・病棟拡張・`requester` を確認
3. カードが**開始日**に「食事 8/28 朝〜 継続中」で出て、食種・主食・コメントが並ぶこと
4. 食事変更: 続けて糖尿病食1600kcal を「夕食から」で登録。「いま出ている食事」に前の
   オーダーが出て既定 ON、開始を朝→夕に変えると終了点の表示が
   「2026-08-27 夕まで」→「2026-08-28 昼まで」に追随すること。登録後、前のオーダーが
   「8/28 朝〜 8/28 昼まで」に変わり、新しいオーダーが「8/28 夕〜 継続中」になること
   (FHIR 上でも `meal-order-end = 2026-08-28T12:00:00+09:00`)
5. 主食が食事ごとに違うオーダー: 朝 米飯180g / 昼 米飯200g / 夕 全粥 で登録し、
   `orderDetail` が 3 要素になり各要素に `meal-timing` 拡張が付くこと。カードが 3 行に分かれ、
   **時間帯拡張を持たない先に登録したオーダーは「主食: 米飯180g」の 1 行のまま**であること
   (後方互換)
6. 欠食: 朝 米飯180g / 昼 欠食 / 夕 米飯180g で登録し、`orderDetail` が 2 要素、
   `meal-skipped-timing = lunch` が付くこと。カード・編集フォームとも「昼: 欠食」で
   復元されること。3 食すべてを欠食にすると「食種で『食止め』を選んでください」で弾かれること
7. 食止め: 食種で「食止め」を選ぶと 3 行ともクリアされて無効になり、説明文が出ること
8. 詳細モーダル: 食種・主食(食事ごとなら「朝 米飯180g / 昼 欠食 / 夕 全粥」)・期間・コメント・対象プロブレム・オーダー日・依頼科|依頼医師が
   出ること。FHIR JSON 表示が ServiceRequest 1 本を出すこと
9. 編集: 保存値(糖尿病食・夕食から)からフォームが復元され、「いま出ている食事」の節が
   出ないこと。終了日 2026-08-31 を入れて更新 → カードが「8/28 夕〜 8/31 夕まで」になること
10. 削除: カードのケバブ「削除」でオーダーが消えること
11. 回帰: 既存の手術・検体検査カードが不変。backend `meal_items_spec` 14 examples green、
   `tsc -b --force` clean、`oxlint` 既存 4 warning のみ(新規ファイルの警告なし)

［申し送り］**外来患者での「入院中の患者にだけ登録できます」の表示は画面から通していない**
(検証に使った患者が入院中のため)。分岐は `useDefaultOrderSetting` の戻り値 1 つだけを
見る単純なもの。

---

## 7. 申し送り

1. **給食部門の画面**: ワークリスト(その日の患者ごとの食事一覧)と食数集計は未実装。
   作るときの要点:
   - 継続オーダーは**日付一致では引けない**。`category=order-type|meal & status=active &
     occurrence=le{当日}` で候補を絞り、終了拡張をクライアント側で評価する 2 段構えになる
     (`isMealOrderActiveOn` がそのまま使える)
   - 病棟で束ねるのはオーダーに焼き付けた `order-ward` 拡張から。上流の `ward` 検索
     パラメータも使える(実装済だがクライアントは未使用)
   - 配膳の進捗が要るなら `createTaskHelpers({ taskCode: { code: "meal-serve", ... } })` を
     呼ぶだけで、既存の Task 機構がそのまま乗る
   - 食数集計に栄養成分が要るなら、マスタに kcal 等の列を足す(§3)
2. **NutritionOrder への載せ替え**: 今回は上流に無いので ServiceRequest にした。載せ替えを
   検討する条件は「他システムと NutritionOrder で連携する必要が出たとき」。そのときは
   上流に model + テーブル + search_definition + routes、backend プロキシの許可リスト追加が
   要る。加えて `Task.focus` が ServiceRequest 前提(`fhir/taskHelpers.ts` が正規表現で
   決め打ち)なので、§7-1 の進捗を先に作っていると影響が出る
3. **嗜好品・補助食(おやつ)**: SS-MIX2 は ODS-1=P / S で表せるが今回は扱っていない。
   足すなら `orderDetail` を配列のまま使い、Coding の system で種別を分けるのが素直
   (時間帯の軸は `meal-timing` 拡張がそのまま使える)。ODS-2 の
   `2:午前のおやつ` / `4:午後のおやつ` / `6:軽い夜食` を足すことになるので、
   `MEAL_TIMING_OPTIONS` に食事以外のタイミングが混ざる点だけ注意が要る
   (開始・終了のタイミング選択にも同じ配列を使っているため)
4. **食事変更の同時終了は「継続中が複数あったら全部」**: 正しい状態では 1 本だが、
   データが乱れて複数になっていても画面で個別に外せるようにしてある
5. **入院・退院との連動**: 退院しても食事オーダーは `active` のまま残る。給食部門の画面を
   作るときに、退院済み患者の分を除く(または退院時に自動終了する)扱いを決める必要がある
6. **共通化**: 食事は明細も Task も持たない薄い型なので、処置の申し送り §7-4 が挙げていた
   「5 つ目の同型オーダー」には**当たらない**。ファクトリを作るときの対象からは外してよい
