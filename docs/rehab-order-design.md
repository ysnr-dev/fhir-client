# リハビリオーダーの設計（計画）

**状態: 設計のみ。未実装。** 輸血オーダー(`docs/transfusion-order-design.md`)の実装後に
着手する。ここには着手時に迷わないだけの設計判断を残す。

食事オーダー(`docs/meal-order-design.md`)を雛形にした「期間継続型」のオーダー。
1 回で完結する検査・処置と違い、1 つのオーダーが数週間〜数か月続き、その間に実施が
何度も積み上がる。同じところは食事・処置の設計書を参照し、違うところだけをここに書く。

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 他の部門オーダーとの違い = 「1 オーダー 1 実施」でないこと

| 項目 | 検査・処置(単発型) | リハビリ(期間継続型) |
|---|---|---|
| オーダーと実施の関係 | 1 対 1(取消 → 再実施で複数になることはある) | 1 対 多(1 日 1 回 × 数十日) |
| Task の意味 | 部門の作業進捗(受付 → 実施済) | 部門の**受け入れ状態**(受付 → 終了)。§4 |
| 期間 | 持たない | 開始日 + 終了日(未定なら継続中) |
| カードの実施情報 | 実施済のときだけ出す | 受付済以降は常に出す。§5 |

### 1.1 命名

［提案］英語識別子は `rehab`。`rehabilitation` は長く、`therapy` は輸血・輸液など他の
治療も指してしまうので使わない。画面表記は「リハビリ」。

---

## 2. FHIR の構造

食事と同じくヘッダ 1 本のみ。明細は持たない。

```text
ヘッダ ServiceRequest  (category: order-type|rehab)
  code        = 疾患別リハ区分 (CodeSystem/rehab-disease-category)
  orderDetail = 療法種別 ×N   (CodeSystem/rehab-therapy-type: pt/ot/st。併用可)
  occurrenceDateTime = 開始日
  quantityQuantity   = { value: 1回あたりの単位数, unit: "単位" }
  extension[rehab-order-end]          = 終了日 valueDate(無ければ継続中)
  extension[rehab-onset-date]         = 起算日 valueDate(発症日・手術日)
  extension[rehab-target-disease]     = 対象疾患名 valueString
  extension[rehab-frequency-per-week] = 週あたり実施回数 valueInteger
  ←focus──── Task       (進捗: rehab)
  ←basedOn── Procedure  (1 回の実施 = 1 件。期間中に複数積む)
       code = 実施した療法種別 / performedDateTime / performer = 担当療法士
       extension[rehab-performed-units] = 実施単位数 valueInteger
       note = 訓練内容
```

### 2.1 療法種別を orderDetail に置く

［事実］1 人の患者に PT と OT を併せて出すことは普通にある。［提案］製剤(輸血)と違って
種別ごとの「量」が分かれないので、明細 ServiceRequest を作らず `orderDetail`(0..*)に
並べる。単位数はオーダー全体で 1 つ(`quantityQuantity`)。

### 2.2 期間は occurrenceDateTime + 拡張

［事実］上流は `occurrenceDateTime` しか索引しない。［提案］食事の `meal-order-end`・
手術の `surgery-duration` と同じ判断で、開始日を `occurrenceDateTime`、終了日を
ローカル拡張にする。部門一覧は開始日 `le` で候補を引き、終了日の判定はクライアントで
行う(`useMealOrderMonth` と同じ形)。

### 2.3 頻度に Timing を使わない

［事実］`ServiceRequest.occurrence[x]` は choice なので、`occurrenceDateTime` を開始日に
使うと `occurrenceTiming` は併用できない。［提案］「週 N 回」はローカル拡張
`rehab-frequency-per-week` にする。厳密な曜日指定は要件に無く、実施の正本は
Procedure(実際に行った日)なので、オーダー側は目安の回数だけ持てば足りる。

---

## 3. マスタ

［提案］初期実装では DB マスタを持たない。疾患別リハ区分(脳血管疾患等・運動器・
呼吸器・心大血管・廃用症候群)と療法種別(PT/OT/ST)はどちらも診療報酬上の固定の分類で
施設ごとに増減しないため、フロントの定数(`rehabOrderHelpers.ts`)に置く。
訓練項目マスタ(実施メモの定型化)は申し送り。

---

## 4. Task の意味を「部門の受け入れ状態」にする（意図的な逸脱）

```
requested (依頼済)  … リハ科がまだ受けていない
accepted  (受付済)  … 受けた = 実施中。期間中ずっとこの状態
completed (終了)    … 期間が終わった / 中止でなく完了した
cancelled (中止)
```

［導出］他部門の Task は「1 回の作業の進捗」なので実施で completed になる。リハビリで
同じにすると、初日の実施で completed になり 2 日目以降が実施できなくなる。

［提案］Task は部門の受け入れ状態を表すことにし、日々の実施は Task を動かさず
Procedure を追加するだけにする。部門一覧の「実施」ボタンは Procedure を POST するのみ
(`buildRehabPerformBundle`)。**この逸脱は他部門の実施入力と作りが違う唯一の点**なので、
実装時にヘルパーの先頭コメントにも書くこと。

---

## 5. カルテでの見せ方

［提案］カードは食事と同じく開始日(occurrence)に 1 枚。本文は
「区分 / 療法種別 / 期間(8/29〜継続中) / 週 N 回・1 回 M 単位」+ 実施履歴を新しい順に
数件(件数バッジ付き)。

［導出］実施情報の表示条件だけ他部門と変える。他部門は `status === "completed"` の
ときだけ実施情報を出す(取り消した検査に実施情報が残らないようにするため)が、
リハビリは受付済のまま実施が積み上がるので、この条件だと期間中ずっと実施が見えない。
**受付済以降は常に出す**。`karteTimeline.ts` の rehab 分岐だけ条件が違うことになるので、
理由をコメントに残さないと将来の統一リファクタで壊れる。

---

## 6. 実装フェーズ

1. **オーダー発行**(ヘルパー・フォーム・カルテ統合。マスタ不要なので backend 変更なし)
2. **部門一覧 + 日々の実施記録**(同時。実施が無いと部門一覧の意味が無いため)

---

## 7. 未決事項・申し送り

- 訓練項目マスタ(実施内容の定型選択)は持たず、実施メモは自由文。定型化するなら
  テンプレート(QuestionnaireResponse)を実施記録に紐付けるのが既存の作法に合う。
- 算定日数上限(疾患別リハの 150 日・180 日など)の警告は未実装。起算日
  (`rehab-onset-date`)を持っているので、後から画面側の計算だけで足せる。
- 実施計画書(リハビリテーション実施計画書)の様式は未実装。
- 食事の月カレンダーに当たる「リハビリ実施暦」タブは初期スコープ外。実施が
  Procedure で日ごとに並ぶので、要るようになったら食事タブと同じ形で作れる。
