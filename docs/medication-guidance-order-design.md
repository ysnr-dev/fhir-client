# 服薬指導オーダーの設計

**状態: 実装済(2026-10-06)。** `functional.xlsx` の「服薬指導依頼」(873-876)・「服薬指導レポート」
「服薬指導患者一覧」「服薬指導退院時指導登録」「服薬指導スケジュール」(2057-2073)に当たる。

栄養指導オーダー(`docs/nutrition-guidance-order-design.md`)を雛形にした「期間継続型」。医師が薬剤師へ
服薬指導を依頼し、薬剤部が受付 → 入院中に週ごとの指導 → 退院時指導 → 終了と進める。**同じところは栄養指導の
設計書を参照し、違うところだけをここに書く。**

## 1. なぜ期間継続型か

薬剤管理指導料(B008)は入院中に週 1 回・月 4 回まで、退院時薬剤情報管理指導料(B014)は退院時に 1 回算定する。
1 人の入院患者に指導が何度も積み上がるのが実態なので、1 オーダー 1 実施の検査型ではなく、栄養指導・リハビリと
同じ「1 つの依頼に実施が積み上がる」形にする。

命名は `medication-guidance`(ファイル・関数は `medicationGuidance`、カルテの種別は `medication-guidance-order`、
ルートは `/medication-guidance-worklist`)。画面表記は「服薬指導」。

## 2. FHIR の構造

```text
ServiceRequest (category[0]=order-type|medication-guidance, category[1]=setting|外来/入院)
  code               = 指導区分(medication-guidance-kind: inpatient 服薬指導 / discharge 退院時指導)
  orderDetail[]      = 指導条件(medication-guidance-condition。複数可)
  occurrenceDateTime = 開始日
  reasonCode         = 指導してほしいこと(平文)
  note               = 薬剤部への連絡事項
  reasonReference    = 対象プロブレム
  extension[medication-guidance-order-end]    = 終了日(無ければ継続中)
  extension[medication-guidance-target-drugs] = 対象薬剤(文字列)
  + applyOrderContext(依頼医師・依頼科・入院病棟)

  ← focus ── Task      (task-code|medication-guidance。部門の受け入れ状態。owner = 担当薬剤師)
  ← basedOn ─ Procedure ×N
       code      = 指導種別(medication-guidance-session-type: standard / high-risk / discharge)
       performer = 指導した薬剤師
       extension[medication-guidance-understanding] = 理解度(good / partial / poor)
       extension[medication-guidance-record]        = 指導記録テンプレートの回答
       note      = 指導内容
```

### 2.1 栄養指導から落とした・足した要素

- **落とした**: 対象疾患名(特別食加算の要件だったもの)、指示食種、指導目的のテンプレート、予約(Appointment)、
  実施時間(分)。服薬指導は薬剤師が病棟で行い、枠を押さえない。算定は時間ではなく回数と区分で決まる。
- **足した**: 指導条件(`orderDetail`)。薬剤管理指導料 1(特に安全管理が必要な医薬品)と 2 の区別の手掛かりで、
  ハイリスク薬の条件が付いたオーダーは実施入力の指導種別の初期値がハイリスクになる。
- **足した**: 担当薬剤師(`Task.owner`)。xlsx の「担当薬剤師の登録」。実施した薬剤師は `Procedure.performer` で、
  担当とは別人のこともある。状態の変更(`buildTaskUpdate`)は元の Task を引き継ぐので担当は残る。
  Task がまだ無いオーダー(依頼済)に担当を付けると、依頼済のまま Task を作る。
- **足した**: 理解度(実施記録の拡張)。xlsx の「患者の理解度」。

### 2.2 指導区分と指導種別

オーダーの指導区分(服薬指導 / 退院時指導)と、実施の指導種別(服薬指導 / 服薬指導(ハイリスク薬)/ 退院時指導)を
分ける。実施入力では指導区分と食い違う種別を選ばせない(退院時指導のオーダーなら退院時指導だけ)。どれも
診療報酬上の固定分類なので DB マスタを持たない。**backend の変更は会計連携の未実装種別の登録だけ。**

## 3. Task・終了・退院

栄養指導と同じ(`requested` → `accepted`(実施中)→ `completed` / `cancelled`。実施しても Task は動かさない。
終了は Task を completed にすると同時にオーダーに終了日を書く。終了取消で終了日は消さない)。退院モーダルで
栄養指導と同じく退院日を終了日にして打ち切れる。

## 4. 画面

- カルテの右ペイン「服薬指導」(登録・編集・DO)。カードは開始日に載り、受付済以降は実施履歴を出す。
- 部門業務 > 薬剤部門 > 服薬指導一覧。基準日に効いているオーダーを並べ、指導区分・入外区分・病棟・診療科・
  担当(自分 / 未定)・進捗で絞る。行の操作は受付・実施・表示、ケバブに担当・終了・受付取消・中止。
- 薬剤師のホームに「服薬指導」の件数カード(担当未定の件数を添える)。

## 5. 未決事項・申し送り

- **会計連携は未実装。** 薬剤管理指導料の区分は実施の指導種別から引ける形にしてあるが、レセプト電算コードの
  持ち方(施設設定か)を決めていない。会計送信のプレビューでは「服薬指導」を送れない項目として報告する
  (`OrderCatalog::PENDING`)。
- **オーダーセット・クリニカルパスは対応済(2026-10-06)。** 種別 `medication-guidance-order` を
  `ORDER_SET_ORDER_TYPES`(フロント)と `OrderSetEntry::ORDER_TYPES`(backend。パスのタスクの検証も共用)に足した。
  セットの内容では対象プロブレムを出さず、開始日・終了日は持ち込まない(栄養指導と同じ)。パスのタスク分類(中)に
  `EGMG` 服薬指導を足し(ePath に無いこのアプリの分類)、既定の種別を服薬指導にした。パスシートのタスクからの
  実施入力は栄養指導と同じく「依頼済なら受付済にしてから実施を積む」。
- 服薬指導患者表・同意書・薬歴の帳票、指導スケジュールのカレンダー表示(xlsx 2057-2073 の一部)は対象外。
- 週 1 回・月 4 回の算定上限のチェックはしていない。
