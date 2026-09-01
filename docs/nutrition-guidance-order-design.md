# 栄養指導オーダーの設計

**状態: 実装済(2026-09-01)。** 他科依頼オーダー(`docs/consult-order-design.md`)の
実装後に着手した。

リハビリオーダー(`docs/rehab-order-design.md`)を雛形にした「期間継続型」のオーダー。
医師が管理栄養士へ栄養食事指導を依頼し、栄養部門が受付 → 都度予約 → 実施(指導)を
繰り返し、期間の終わりに終了する。骨格はリハビリと同じなので、**同じところはリハビリの
設計書を参照し、違うところだけをここに書く**。

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. なぜリハビリ型(期間継続型)か

［事実］栄養食事指導料(B001-9 外来栄養食事指導料・B001-10 入院栄養食事指導料 等)は
「初回はおおむね 30 分以上、2 回目以降はおおむね 20 分以上」「月 1〜2 回」を算定単位と
する。1 人の患者に対して初回 + 継続 2〜3 回と続くのが実態。

［導出］「1 オーダー 1 実施」の検査・処置型では、継続指導のたびに医師がオーダーを
出し直すことになり実務に合わない。1 つの依頼に複数回の指導が積み上がる**リハビリ型**が
適合する。

［事実］他科依頼型(`consult`)を採らない理由:

| 軸 | 栄養指導の実態 | 他科依頼型との不一致 |
|---|---|---|
| 依頼先 | 常に栄養部門 1 つ | consult は `performer` で毎回宛先が変わる。上流は `performer` を索引していない(`docs/server-improvement-backlog.md` C-6) |
| 実施者 | 管理栄養士(コメディカル) | consult は医師が回答を書く前提 |
| 予約 | 栄養相談室の枠を押さえる | consult に予約機構が無い |
| 完了の意味 | 指導を実施した(複数回) | consult は回答を書いた(1 回) |

### 1.1 命名

［事実］`meal` は食事オーダー(`docs/meal-order-design.md`)が使用済み。また FHIR R4 の
標準リソース `NutritionOrder` は**食事箋**(何を食べさせるか)を指すもので、栄養指導
(何を教えるか)ではない。

［提案］英語識別子は `nutrition-guidance`。`nutrition` 単独は上記 2 つと紛らわしく、
将来 `NutritionOrder` を食事オーダーの表現に採り入れたときに衝突する。
`diet-counseling` も候補だが、既存コードの命名は直訳系(`meal`/`rehab`/`consult`)で
そろっているのでこちらを採らない。画面表記は「栄養指導」。

ファイル・関数のプレフィックスは `nutritionGuidance` / `NutritionGuidance`、カルテの
アイテム種別は `nutrition-guidance-order`、ルートは `/nutrition-guidance-worklist`。

---

## 2. FHIR の構造

```text
ServiceRequest (category[0]=order-type|nutrition-guidance, category[1]=setting|外来/入院)
  status = active / intent = order
  code               = 指導形態(個別 / 集団)
  subject            = Patient
  authoredOn         = 登録日時(システム時刻。全種別共通、readme「オーダーの日付」)
  occurrenceDateTime = 開始日(指導希望日。日付のみ)
  reasonCode         = 指導目的(任意。テンプレートからも書ける)
  extension[nutrition-guidance-order-end]        = 終了日(無ければ継続中)
  extension[nutrition-guidance-target-disease]   = 対象疾患名(必須)
  extension[nutrition-guidance-target-condition] = 対象疾患名の元にした登録病名(任意)
  extension[nutrition-guidance-target-diet]      = 指示食種(任意。食種マスタの Coding)
  extension[nutrition-guidance-purpose-questionnaire-response] = 指導目的の記入内容
  note               = 栄養部門への指示
  reasonReference    = 対象プロブレム(Condition)
  + applyOrderContext(依頼医師・依頼科・入院病棟)

  ← focus ── Task        (task-code|nutrition-guidance。部門の受け入れ状態)
  ← basedOn ─ Procedure ×N (1 回の指導。日々積み上がる)
  ← basedOn ─ Appointment ×N (栄養相談室の予約。部門が都度取る)
```

### 2.1 リハビリから落とした要素

［導出］リハビリの `orderDetail`(療法種別)・`quantityQuantity`(単位数)・
`rehab-onset-date`(起算日)・`rehab-frequency-per-week`(週頻度)は持たない。栄養指導は
療法の種類で作業が分かれず、算定は「回数と指導時間」で決まり、起算日から日数上限を
数える仕組みも無い。フォームはリハビリより 1 段簡素になる。

### 2.2 対象疾患名と指示食種を拡張で持つ

［事実］特別食加算の算定要件は「医師が特別食を必要と認めた者」で、対象疾患名が要件
そのもの。［導出］リハビリの `rehab-target-disease` と同じ理由で必須の文字列として
持つ(登録病名 `reasonReference` とは別。算定上の対象疾患は登録病名と一致しないこと
がある)。

［事実］指示食種(「糖尿病食 1600kcal」等)は食事オーダーと同じ食種マスタ
(`master_meal_diets`)の項目そのもの。［導出］文字列ではなく**マスタのコードで持つ**
(`valueCoding`、system は食事オーダーと共通の `meal-type`)。施設の食種名を手で打ち
直すと表記が揺れ、あとから「どの食種で指導したか」を数えられなくなるため。選択 UI も
食事オーダーと同じ `MealDietPickerModal`(主成分量を横に並べて比べる表)を使う。

［導出］指示食種は任意。外来では食事オーダー自体が無く、食種を決めずに依頼することが
あるため。ただし入院中で食事が出ていれば、**現在の食事オーダーの食種を参考表示して
「写す」**ボタンで選べるようにする(いま出ている食事と違う食種を指導することもあるので、
自動では入れない)。

### 2.2.1 対象疾患名は登録病名から選べる

［導出］対象疾患名は登録済みの病名から選んで写せる(放射線オーダーの依頼病名と同じ
`ConditionPickerModal`)。写した元の Condition は拡張
`nutrition-guidance-target-condition` に残し、手で書き換えたら外す。

［事実］放射線は同じ紐付けを `reasonReference` に載せているが、こちらは
`reasonReference` を**対象プロブレム**(カルテのプロブレム絞り込みが読む)に使って
いるので拡張に分けている。

### 2.2.2 指導目的はテンプレートからも書ける

［導出］「何を指導してほしいか」は自由文だけだと書き漏れが出るので、放射線の検査目的・
他科依頼の依頼目的と同じテンプレート機構(`TemplateTextField` + `TemplateEntryModal`)を
使えるようにした。平文は `reasonCode[0].text` に入れて読む側の作りを変えず、回答本体は
QuestionnaireResponse として残して拡張から参照する。オーダーの削除・テンプレートの解除で
参照が外れた回答は同じ transaction で消す。DO では紐付けだけ捨てて平文は引き継ぐ
(同じ回答を 2 件のオーダーが指さないようにするため)。

［導出］`TemplateTextField` は放射線オーダーの中に閉じていたが、栄養指導で 2 例目に
なったので `components/TemplateTextField.tsx` に切り出して共用にした。

### 2.3 指導形態と指導種別を分ける

［事実］オーダー側で決まるのは「個別指導か集団指導か」(体制の話)。実施側で決まるのは
「初回か 2 回目以降か」(算定区分の話。初回 30 分・継続 20 分と要件が違う)。

［導出］前者を `ServiceRequest.code`(`nutrition-guidance-format`)、後者を
`Procedure.code`(`nutrition-guidance-session-type`)に置く。実施入力では**オーダーの
指導形態と食い違う指導種別を選ばせない**(個別オーダーなら初回/2 回目以降の 2 択、
集団オーダーなら「集団」固定)。リハビリの「オーダーで指示された療法種別だけ出す」と
同じ理由。

［導出］どちらも診療報酬上の固定分類で施設ごとに増減しないので、DB マスタを持たず
フロント定数に置く(`docs/rehab-order-design.md` §3 と同じ判断)。**backend の変更は
無い。**

---

## 3. Task の意味(リハビリと同じ逸脱)

`requested`(依頼済) → `accepted`(実施中) → `completed`(終了) / `cancelled`(中止)。

**実施しても Task は動かさない。** 実施は `Procedure` を 1 件足すだけ。理由と注意は
`docs/rehab-order-design.md` §4 と同じなのでそちらを参照。「終了」で Task を completed
にすると同時に ServiceRequest に終了日拡張を書く(書かないと `status=active &
occurrence=le{基準日}` に永久にヒットし続ける。同 §6.1)。「終了を取消」で終了日は
消さない非対称も踏襲する。

---

## 4. 実施記録 = Procedure + テンプレート

```text
Procedure
  meta.profile = JP_Procedure
  status   = completed
  category = order-type|nutrition-guidance
  code     = 指導種別(初回 / 2 回目以降 / 集団)
  basedOn  = ServiceRequest
  performedDateTime = 実施日時
  performer[0].actor = Practitioner(担当管理栄養士)
  extension[nutrition-guidance-performed-minutes] = 実施時間(分)
  extension[nutrition-guidance-record] = QuestionnaireResponse(指導記録テンプレート)
  note     = 指導内容(自由文)
```

### 4.1 実施時間を分で持つ

［事実］算定要件が「おおむね 30 分以上 / 20 分以上」と**時間**で決まる(リハビリの
「単位」のような換算単位ではない)。［導出］`valueInteger` の分でそのまま持つ。
リハビリの `rehab-performed-units` に相当する位置づけ。

### 4.2 指導内容をテンプレートで定型化する

［事実］`docs/rehab-order-design.md` §8 に「訓練内容を定型化するならテンプレート
(QuestionnaireResponse)を実施記録に紐付けるのが既存の作法に合う」という申し送りが
ある。放射線の特別指示・病理の臨床経過・他科依頼の依頼目的が同じ機構
(`TemplateEntryModal` + `TemplateBinding`)で動いている。

［導出］栄養指導の記録は「食事摂取状況・体重・検査値・指導内容・目標・理解度」と
定型項目が多く、この申し送りを実装する最初の種別にする。平文を `Procedure.note` に
入れ、回答本体は QuestionnaireResponse として残してローカル拡張から参照する
(`consultOrderHelpers.ts` の `pushPurposeTemplateEntry` と同じ形)。

［導出］実施の取消では `Procedure` と紐付く `QuestionnaireResponse` を**同じ
transaction で両方 DELETE** する(entered-in-error では残さない。放射線の明細削除が
QR を道連れにするのと同じ後始末)。そのため一覧表示用の型に QR の id を持たせる。

---

## 5. カルテでの見せ方

リハビリと同じ。カードは開始日に置き(`occurrenceDateTime`)、**受付済以降は実施情報を
常に出す**(他部門は実施済のときだけ)。期間中ずっと accepted のまま実施が積み上がる
ため。`OCCURRENCE_ORDER_TYPES` にも追加して診療日索引を開始日で数える。

---

## 6. 予約

`docs/rehab-order-design.md` §7 と同じ「部門側で都度」方式。オーダー登録の transaction
には同梱せず、部門一覧の「次回予約」から単独の transaction で取る。枠種別
(`schedule-service-type`)に `nutrition-guidance` を足す。

［導出］`exam` の定員 1 強制(`buildSchedule`)には乗せない。集団指導では 1 枠に複数
患者が入るため。

---

## 7. 実装フェーズ

1. ヘルパー(order / task / result)
2. フォーム・パネル(オーダー発行) + カルテ統合
3. 部門一覧 + 実施入力 + 予約
4. 指導記録テンプレート(`NUTGUIDE_REC_01`)

---

## 8. 未決事項・申し送り

- **算定チェックは未実装。** 初回 30 分・継続 20 分の下限、月あたりの回数上限、特別食
  該当判定はいずれも入力欄の注記のみ。他部門と同じく算定は全面的に未実装。
- **集団指導の複数患者一括登録は未対応。** 1 患者 1 オーダー 1 実施で登録する。
- 指導目的テンプレートの**既定テンプレート**(この指導形態ならこのテンプレート)は無い。
  放射線の `defaultCanonical` に当たる仕組みで、指導形態はマスタを持たないため。
- 栄養管理計画書・NCM(栄養ケアマネジメント)様式は対象外。
- 実施記録が付いたオーダーを削除すると Procedure が孤児になる(リハビリと同じ未対応。
  `docs/rehab-order-design.md` §8)。
