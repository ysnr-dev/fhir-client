# 医事会計(診療行為送信)の設計 — 種別ごとの送り方

2026-09-22 に、`docs/receipt-billing-backlog.md`(棚卸し)の「送っていない診療行為」を種別ごとに
どう送るかを決め、土台になる 2 つ(**実施記録ベースの収集**と**診療行為マスタの章からの区分導出**)を
実装した記録。連携全体の方針は `docs/receipt-computer-integration.md`。

決めたこと(2026-09-22):

- 対象は **外来のみ**。入院(`InOut=I`・食事・入院料)は別 API も絡むので方針だけ書く(§6)。
- **初診・再診料は日レセの自動算定(`Medical_Fee_Auto`)のまま**。医学管理料(指導料など)は
  各種別の実施記録の明細として送る。
- **加算は実施入力で明細に足す**(データセットの既定・診療行為マスタの検索で足せる画面が既にある)。
  採血料のように機械的に決まるものだけ送信時にルールで付ける。

- **［事実］** = このリポジトリの実装、または API 仕様書・実機で確認した内容
- **［決定］** = 本設計で決めたこと

---

## 1. 収集の軸 = 実施記録ファースト

［事実］オーダー種別は 3 つの表し方に分かれる(`receipt_computer/order_catalog.rb`)。

| source | 種別 | 集め方 |
|---|---|---|
| `:procedure` | rad / physio / endoscopy / treatment / surgery / injection(Phase 2〜: transfusion / rehab / radiotherapy / nutrition-guidance) | `Procedure?subject&date=当日&status=completed&_revinclude=Procedure:part-of&_revinclude:iterate=MedicationAdministration:part-of` → ハブ(`partOf` 無し、category = order-type)ごとに 1 剤 |
| `:order` | lab / micro(Phase 3: pathology) | ヘッダ SR を `occurrence=当日` で集め、明細 SR を `_revinclude=ServiceRequest:based-on` |
| 処方 | prescription | 同じ検索の `_revinclude:iterate=MedicationRequest:based-on`。処方のヘッダは order-type を持たない(それで処方と判定する frontend の規約と同じ)。RP 番号ごとに 1 剤 |

［事実］上流への往復は Procedure 1 回 + ServiceRequest 1 回。Task の照会は「実施記録が無いのに
実施入力不要の項目だけのオーダー」があるときだけ 1 オーダー 1 回。

［決定］二重計上と未実施の扱い:

- `:procedure` 種別はオーダー明細 SR を読まない。当日 `occurrence` のオーダーに実施記録が無ければ
  `skipped`「実施記録がありません(未実施のため送りません)」。
- 例外は項目マスタ `requires_perform_input=false` の項目だけのオーダー。部門は記録を作らず Task を
  実施済にするだけなので(`RadWorklistPage.tsx` の `needsPerformInput`)、Task が `completed` なら
  明細 SR + `receipt_code` で組む。Task が開いていれば「部門で実施済になっていません」。
- 子 Procedure / MedicationAdministration / usedCode は `partOf` で属するハブにだけ載せる。
  帰属先が当日に無いものは `skipped`。
- `category = anesthesia-chart` のツリーは拾わない(麻酔チャートの薬剤は算定しない。麻酔の手技は
  手術の実施記録の手技行で送る)。
- 日付は日本の暦日で判定する(`local_date.rb`)。上流の `date=` はタイムゾーン無しの値を Asia/Tokyo で
  解釈するので検索はそのままでよいが、返ってきた `performedDateTime` を UTC の日付で比べると深夜の
  実施が前日に寄る。
- Procedure と Encounter の日付検索は `date=<日付>`(等価)ではなく **`date=sa<前日>&date=le<日付>`**
  (その日に始まった)。等価は期間の終了が無いリソース(注射の実施は開始だけ、診察中の Encounter)に
  当たらない。会計の日付判定も開始の日なので意味が揃う。`status=completed,stopped,not-done` で
  日時を持たない計画中の Procedure を除く。
- 同じ内容の剤(同じ処置を 2 回)は 1 剤にまとめて回数にする。処方(日数を持つ)は対象外。

## 2. 剤の中身と区分

［事実］実施記録のハブ 1 件が 1 剤。行の並びは 手技(ハブの code → 子の code)→ 薬剤 → 材料 → コメント
(`performed_item_builder.rb`)。

| 行 | 出どころ | コード | 数量 |
|---|---|---|---|
| 手技・加算 | `Procedure.code`(`.../CodeSystem/{種別}-procedure-code`) | レセ電算 診療行為コード | 1 |
| 薬剤 | `MedicationAdministration.medicationCodeableConcept`(`medicine-code`) | レセ電算 医薬品コード | `dosage.dose.value` + unit |
| 材料 | `Procedure.usedCode`(`medical-material`。放射線だけ `rad-material` → `master_rad_materials.receipt_material_code`) | 特定器材コード | 拡張 `{種別}-material-quantity` |
| コメント | `Procedure.note` | `810000001`(フリーコメント) | — |

［決定］**中立層は区分を決めない**。手技の行に点数表の区分番号 `section`(章記号 + 3 桁。例 `K920`)を
`master_medical_procedures` から一括で載せ(`procedure_sections.rb`)、日レセの区分はアダプタが決める
(`orca/medical_message.rb`)。区分体系は日レセ固有で、`records.rb` の「レセコンの言葉を外に出さない」
方針に沿う。

［事実］章 → 診療種別区分(実機 `tbl_tensu.srysyukbn` で確認):

| 章 | 区分 | 章 | 区分 |
|---|---|---|---|
| A 初・再診 | 送らない(自動算定) | H リハビリ | 800 |
| B 医学管理 | 130 | I 精神科専門療法 | 830 |
| C 在宅 | 140 | J 処置 | 400 |
| D 検査 | 600 | K 手術 | 500(K920〜K924 輸血は 510) |
| E 画像診断 | 700 | L 麻酔 | 540 |
| F 投薬 | 処方経路(210/220/230) | M 放射線治療 | 840 |
| G 注射 | 経路で 310〜350(Phase 2) | N 病理診断 | 640 |

9 桁コードの先頭桁は当てにならない(外来化学療法加算 130013990 は G 章 → 330)。

［決定］薬剤・材料・コメントの行は**直前の手技の区分**に付く。1 つのハブの中で区分が変わったら剤を切る
(手術の実施記録に K 章と L 章が並ぶと 500 と 540 の 2 剤になり、麻酔薬は 540 側に付く)。
手技の行が無い剤(区分番号が引けない)は種別の既定(`MEDICAL_CLASS`)に落ちる。
加算は同じ剤の明細として送る(電子画像管理加算 E → 700、外来迅速検体検査加算 D → 600、
時間外加算(麻酔)L → 540)。

［事実］コメントの送り方はコードの先頭 3 桁で決まるので、中立の行は `kind: :comment` + コードだけを持つ。
842 → `Medication_Number` に数値、830 → `Medication_Name` に文だけ(全角 50 文字ごとに行を分ける)、
810000001 → 80 バイト(全角 2 バイト)で切る。

## 3. 中立の値オブジェクト(`records.rb`)

```
BillingClaim  + time                                   Perform_Time(Phase 4)
BillingItem   + count, route, method, usage_type, performed_at, source_ref
BillingLine   + kind(:procedure/:medicine/:material/:comment), section, generic
PreviewItem   画面用。区分(class_code/class_name)を添えて剤を分けたもの
```

`days`(内服の日数)と `count`(回数)は分け、アダプタは `count || days || "1"` を `Medical_Class_Number` に。

## 3-1. 送り直し・状態・警告の扱い(2026-09-23、バックログ A 系)

- 外来の送り直しは **class=02(削除)→ class=01(再登録)**。置換 class=03 は入院用に残す。再登録で
  落ちたときは「医事会計側のデータは消えています。もう一度送ってください」と伝える。
- `billing_status` は **none / sent / opened / settled**。会計済み(`acceptlstv2` class=02)と
  日レセ画面で展開・再保存された中途データ(`tmedicalgetv2` の `Medical_Mode` / `Medical_Mode2`、
  または `Medical_Uid` が消えたもの)は画面で送信・取消を止める。
- `W02`(保険組合せゼロ登録)/ `W04` / `W05` は `Api_Result` がゼロでも失敗。応答の
  `Insurance_Combination_Number` が送った番号と違えば失敗。`M01`〜`M05` は「送れなかった項目」に並べる。
- `Perform_Time` は当日の外来 Encounter の `period.start`。時間外・休日・深夜の判定は日レセに任せる。
- 病名の転帰は `resolved` → `F`(治ゆ)、`inactive` → `N`(不変)。

## 4. 画面

プレビューは「実際に送る剤の並び」を見せる。アダプタの `describe_billing` が区分ごとに分けた剤を
区分名つきで返し(`PreviewItem`)、`BillingSendModal.tsx` は剤の見出しに区分名・回数/日数・実施時刻、
行に種類(手技/薬剤/材料/コメント)と数量 + 単位を出す。接続設定が無いときは区分名なしで出す。
アダプタが置けない行(初診料など)は「送れない項目」に並ぶ。

## 5. 未対応種別の送り方(Phase 2〜)

| 種別 | 区分 | 足りないもの | 送り方 |
|---|---|---|---|
| 注射 `injection` | 310 皮下筋注 / 320 静注 / 330 点滴 / 340 その他 / 350 中心静脈 | — | **対応済み(2026-09-23)**。実施記録(ハブ + MedicationAdministration)から薬剤行だけを送り、手技料は区分から日レセが算定する。区分は 手技 31 → 350、点滴(オーダーの usage-type)→ 330、手技 30 → 320、32/33/34 → 310、他の手技 → 340、手技が無ければ経路(IV 320 / IM・SC・ID 310 / 他 340)。1 施用(ハブ)が 1 剤で、同じ内容の施用は回数にまとめる。途中で中止・実施せずの記録は請求せず理由を出す |
| 輸血 `transfusion` | 510 | `master_transfusion_products` にコード列が無い | 製剤は医薬品コードなので `medicine_code` 列を足す。手技(K920 系)は実施入力の手技行。数量 = 単位数 |
| 病理 `pathology` | 640 | — | **対応済み(2026-09-23)**。施設設定 `receipt_codes.pathology`(検査区分 N000/N004/N003 → コード)。`:order` 経路で、数量 = 検体(明細)の数。判断料・診断料は日レセの自動算定 |
| リハビリ `rehab` | 800 | — | **対応済み(2026-09-23)**。施設設定 `receipt_codes.rehab`(疾患別区分 × 療法士 PT/OT/ST → コード。2024 年改定で担い手ごとにコードが分かれた)。回数 = 実施単位数(同じ日の同じコードは合算) |
| 放射線治療 `radiotherapy` | 840 | — | **対応済み(2026-09-23)**。`master_radiotherapy_techniques` の `receipt_code`(体外照射 1 回目)・`receipt_code_second`(同日 2 回目)・`management_receipt_code`(放射線治療管理料。コースの初回の照射だけ)。治療終了サマリーは送らない |
| 栄養指導 `nutrition-guidance` | 130 | — | **対応済み(2026-09-23)**。施設設定 `receipt_codes.nutrition_guidance`(初回 / 2 回目以降 / 集団 → コード) |
| 化学療法 `chemo-regimen` | 注射 + 加算 | — | **対応済み(2026-09-23)**。レジメン由来の注射(ヘッダの `requisition` が regimen-instance)の剤に、施設設定の外来化学療法加算(15 歳未満は別コード。患者の生年月日で判定)と無菌製剤処理料を 1 日 1 回足す |
| 麻酔(手術配下) | 540 | — | §2 の剤分割で自動。麻酔時間の加算は実施入力で足す |
| 食事・看護・他科依頼 | — | 出来高の項目が無い | 対象外(`OrderCatalog::IGNORED`。`skipped` にも出さない) |

［決定］**施設で 1 値に決まるコードは `FacilitySettings.receipt_codes`**(項目表に足すだけで migration 不要)、
**製品・技法ごとのコードはマスタの列**。`FacilitySettings` を backend が読むのはこれが初めてになるので、
モデルのクラスコメント「backend は読まない」を直す。

段階:

- **Phase 2** 注射(2026-09-23 済み)、輸血(列追加 + 管理画面 + CSV)、麻酔(spec のみ)、化学療法の加算。
- **Phase 3**(2026-09-23 済み)施設設定 `receipt_codes`(`FacilitySettings`。backend は
  `ReceiptComputer::ReceiptCodes` で読む)と病理・リハ・栄養指導・放射線治療の resolver
  (`receipt_computer/resolvers.rb`。実施記録の種別は `call(record, order) -> [lines, count]`、
  オーダーの種別は `call(header, details) -> BillingItem`)、照射技法マスタの 3 列。
  採血料(血液の検体があれば `receipt_codes.lab.blood_draw` を最初の検体検査の剤末尾に 1 回)と
  化学療法の加算もここで入れた。
- **Phase 4** 外用の日数(総量 × 1)、一般名処方(代表銘柄 + `Medication_Generic_Flg=yes`)、
  `Perform_Time`(外来 Encounter の `period.start`)、数値コメント 842 の実施入力。
  外来迅速検体検査加算は「当日結果説明」を backend で判定できないので初期は送らない。
- **Phase 5** 放射線のフィルム(枚数-分画。実施入力に分画数を足す。特定器材のフィルムは
  `material_category` では区別できないので名称/コード帯で見分ける)、造影剤注入手技、
  部位コメント(2024-06 以降は日レセ側の設定で不要なので初期は送らない)。
- **Phase 6** 画面の仕上げ(skipped の種別畳み)、バックログの A-2(02→01)/ B-12(class=04)。

## 6. 入院(方針だけ)

`InOut=I` + `Admission_Date`、置換は class=03 が正規。食事は `hsacctmodv2` の `Meal_Information`。
入院料は入院基本料の算定単位が日でオーダーと結び付かないので、入退院登録(`hsptinfmodv2`)側の
自動算定に委ねる。項目表は実機のレコード定義(`weborca-dev` の `scripts/dump-record-defs.sh`)にある。

## 7. 検証

```
docker compose exec backend env RAILS_ENV=test ADMIN_TOKEN= bundle exec rspec spec/services/integrations
docker compose exec frontend npx tsc -b
docker compose exec backend bin/rails runner \
  'pp Integrations::ReceiptComputer::BillingSender.new.preview(patient_fhir_id: "<id>", perform_date: "2026-09-17")'
```

2026-09-22 に実機(WebORCA オンプレ receipt 20260825-1、患者 00002)で確かめたもの:

- テスト太郎 2026-09-17(CT 撮影 + コンピューター断層診断 + 電子画像管理加算、E 章 → 700)を
  class=01 で登録 → `Api_Result=00`、警告なし(M01/M05 が無い = 3 コードとも区分 700 で受理)。
- 同 2026-08-13(造影剤注入手技 + 造影剤(薬剤)+ エクステンションチューブ(材料)+ フリーコメント)も
  警告なしで登録して取消。
- 同 2026-08-20(内服 3 剤)は登録されたが薬剤 1 つが `M01`(点数マスタに登録がありません)。検証環境の
  点数マスタが古いだけで、警告として画面に出る(A-4 の扱いは据え置き)。
- 取消は class=02 で `Medical_Uid` が消えることを `tmedicalgetv2` で確認。

点数計算の正確性は検証対象外(無償ソース利用の前提)。
