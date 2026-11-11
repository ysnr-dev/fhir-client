# 透析経過表(透析中の時系列記録)の設計

透析オーダー(`docs/dialysis-order-design.md`)の申し送り §9 の先頭にある、透析中の時間軸の記録。
30 分毎のバイタル(血圧・脈拍・SpO2・体温)と装置の値(血流量・除水速度・累積除水量・静脈圧など)、
透析中のできごと(穿刺・除水停止・血圧低下・返血など)を、透析中にその場で 1 点ずつ記録し、
チャート(グラフ + 表)で見せる。

麻酔チャート(`docs/anesthesia-chart-design.md`)の器(ハブ Procedure + 時刻つき Observation)を流用する。
ただし麻酔チャートがオーダー単位で 1 枚なのに対し、透析経過表は**透析の 1 回(セッション)ごとに 1 枚**。

設計日: 2026-11-10。第 1 段〜第 3 段を同日に実装、第 4 段(透析中の薬剤・右軸・温度板・印刷)を 2026-11-11 に実装(§6)。

本文中の区別:
- **［事実］** = FHIR R4 / JP Core の仕様、または上流・既存実装で確認した内容
- **［導出］** = 仕様から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計判断

---

## 0. 既存のものとの棲み分け

| # | 既存のもの | 経過表との関係 |
|---|---|---|
| 1 | **実施記録**(`dialysis-order-design.md` §6。入室 → 開始 → 終了のハブ Procedure と、透析前後の体重・血圧・除水量・実透析時間の子) | 実施記録は**各回の完成形**(会計・カルテの実施履歴・ボードの進捗)。経過表は**その回の中の時間軸**。経過表のハブは実施記録のハブに `partOf` でぶら下がる(§1) |
| 2 | **実施記録の薬剤**(MedicationAdministration。ESA・ヘパリンなど、会計に送るもの) | 経過表は透析中の薬剤(補液・昇圧薬など)を**時刻つき**で持つ(§2.1)。会計に送るのは実施記録の薬剤で、終了の入力の初期値に経過表の薬剤を流し込む(§2.3)。二度書きにはせず、経過表の薬剤のハブは実施記録と別なので会計に乗らない |
| 3 | **経過表(温度板)**(`flowsheet-design.md`。`vital-signs` と看護の Observation を読む) | 期間表示(1 週間〜1 か月)には**出さない**。30 分毎の打点で透析日だけ列が伸びるのを避ける(麻酔チャートと同じ判断)。**24 時間表示にだけ**バイタルの打点を重ねる(§4) |
| 4 | **麻酔チャート** | 器(グラフ・打点表・イベント・時刻の入力)を共通化して両方から使う(§3.4)。麻酔チャートの薬剤(単回/持続)と術前評価の帯は麻酔側に残す |
| 5 | **透析支援システム**(`dialysis-order-design.md` §8) | 装置が出す分単位の値は、外部システムがこの経過表の形で書く(§5)。画面側は手入力と同じデータとして扱う |

［提案］**記録は 1 点ずつ即保存する**(麻酔チャートと同じ)。透析中は 4 時間ベッドサイドで記録し続けるもので、
端末が落ちても失われないことが第一。

---

## 1. 単位は「透析の 1 回」

［事実］維持透析は週 3 回・年 150 回を超える。麻酔チャートのように**オーダー単位で 1 枚**にすると、
1 枚に数千点が積もり、横軸も「回」の切れ目を持たない。

［提案］経過表は**実施記録のハブ(1 回 = 1 件の Procedure)ごとに 1 枚**。横軸はその回の開始〜終了。
回のまたぎ(ベッドサイドの CHDF で連日 24 時間など)は、その回のハブが連日になるので経過表もその長さになる
(麻酔チャートの横軸の 4 段階の目盛りと「全画面」がそのまま効く)。

［導出］「回ごと」にすると、ボードのカード・ベッドサイドの行・カルテの実施履歴の行のどれからも
「この回の経過表」として開ける。開く先の単位が実施記録と一致するので、画面側の導線が素直になる。

---

## 2. FHIR の構造

```text
ServiceRequest(透析オーダー)
 └ basedOn ← Procedure 実施記録のハブ(1 回 = 1 件。category = order-type|dialysis。§6 のもの)
      ├ partOf ← Observation / MedicationAdministration / Procedure(実施記録の子。従来どおり)
      └ partOf ← Procedure 経過表のハブ(1 回 = 1 件)
           │  status    = in-progress(記録中) / completed(回の終了で閉じる)
           │  category  = order-type|dialysis-chart
           │  code      = 「透析経過表」(ローカル固定)
           │  subject   = 患者
           │  performer = 記録を始めた人
           │  performedPeriod = 最初の打点〜回の終了
           │  basedOn   = 持たない(§2.2)
           ├ partOf ← Observation (打点。category = order-type|dialysis-chart)
           ├ partOf ← Observation (イベント。code = dialysis-event)
           └ partOf ← MedicationAdministration (透析中の薬剤。category = order-type|dialysis-chart)
```

- ［事実］`Procedure.partOf` は Procedure を指せる(R4)。上流は `Procedure?part-of=Procedure/{id}` を索引している
  (`../fhir-server/app/lib/fhir/search_definitions/procedure.rb`)。
- ［提案］ハブの category は `order-type` に **`dialysis-chart`** を足して区別する。実施記録の振り分け
  (`isDialysisProcedure`。category = `dialysis`)には引っかからないので、ボード・カルテ・会計のどれにも経過表のハブが混ざらない。
  麻酔チャートの `anesthesia-chart` と同じく、`fhir/orderKinds.ts` には載せない(オーダーの種別ではない)。

### 2.1 子リソース

**打点**: 1 時点 1 項目 = 1 Observation(`effectiveDateTime`)。血圧だけはパネル 1 件に収縮期・拡張期を component で持つ
(バイタル入力・麻酔チャートと同じ)。

| 項目 | code | 単位(UCUM) | 由来 |
|---|---|---|---|
| 血圧 | LOINC 85354-9(component 8480-6 / 8462-4) | mmHg | 麻酔チャートと同じ |
| 脈拍 | LOINC 8867-4 | /min | 同上 |
| SpO2 | LOINC 2708-6 | % | 同上 |
| 体温 | LOINC 8310-5 | Cel | 同上 |
| 血流量 QB | `dialysis-measurement\|qb` | mL/min | 実施記録の「回の QB」と同じコード(その時点の値) |
| 透析液流量 QD | `dialysis-measurement\|qd` | mL/min | 同上 |
| 累積除水量 | `dialysis-measurement\|ultrafiltration` | L | 実施記録の「回の除水量」と同じコード(その時点までの累積。最後の点 ≒ 回の除水量) |
| 除水速度 | `dialysis-measurement\|uf-rate`(新規) | mL/h | |
| 静脈圧 | `dialysis-measurement\|venous-pressure`(新規) | mm[Hg] | |
| 動脈圧 | `dialysis-measurement\|arterial-pressure`(新規) | mm[Hg] | |
| TMP | `dialysis-measurement\|tmp`(新規) | mm[Hg] | 膜間圧力差 |

- ［提案］打点の category は **`order-type|dialysis-chart`** にする。麻酔チャートの打点は category 無しだが、
  透析は装置からの取込(§5)と抽出の対象になるので、種別で引ける印を持たせる。`vital-signs` は付けない
  (温度板に出さない。§4)。実施記録の測定値は category = `dialysis` なので、コードが同じでも混ざらない。
- ［導出］QB・QD・累積除水に実施記録と同じコードを使うのは、意味が同じ(粒度だけ違う)から。データ抽出・SS-MIX2 で
  「血流量」を 1 つのコードで引ける。

**イベント**: `code = CodeSystem/dialysis-event` の Observation。値は持たず時刻が本体。「その他」は `note` に本文。
「補液」は時刻の印で、何をどれだけ入れたかは薬剤(下)に書く。

| code | 表示 |
|---|---|
| `puncture` | 穿刺 |
| `uf-stop` | 除水停止 |
| `uf-resume` | 除水再開 |
| `hypotension` | 血圧低下 |
| `fluid-bolus` | 補液 |
| `circuit-change` | 回路交換 |
| `blood-return` | 返血 |
| `hemostasis` | 止血確認 |
| `other` | その他 |

- ［提案］**開始・終了はイベントに持たない**。回の開始・終了は実施記録のハブの `performedPeriod` が正本で、
  グラフにはそこから固定の印として描く。二重に持つと食い違いの元になる(麻酔チャートに「麻酔開始」があるのは、
  手術の実施記録が退室後にまとめて書かれ、術中はチャートしか時刻を持たないから)。

**薬剤**: 麻酔チャートと同じ `MedicationAdministration`(器の `buildChartDrugAdministration`)。単回は `effectiveDateTime`、
持続は `effectivePeriod`(終了で `completed` + `end`)。医薬品マスタのコード(`medicine-code` + YJ)、`dosage.dose`(製剤単位)または
`dosage.rateQuantity`、`dosage.route`(`DIALYSIS_ROUTE_OPTIONS`)。`category` に `order-type|dialysis-chart` を付け、`partOf` は経過表のハブ。
- ［提案］**会計には乗せない**。会計・カルテの実施履歴が読む薬剤は実施記録のハブの子(category = `dialysis`)で、経過表の薬剤は
  別のハブの子なので検索に混ざらない。実施記録の薬剤の行は、終了の入力で経過表の薬剤を初期値に流し込んで作る(§2.3)。
  持続投与は総量が決まらないので量は空で流し、手で入れる。

### 2.2 読み出しと、既存の読み出しへの影響

- ハブ: `Procedure?part-of=Procedure/{実施記録のハブ}&category=order-type|dialysis-chart`(1 回に 1 件)。
- 子: `Observation?part-of=Procedure/{経過表のハブ}` を `_offset` でページングして全件(麻酔チャートの `fetchAllByPartOf` を共用)。
  30 分毎 × 4 時間で 8 時点 × 10 項目 = 80 件、CHDF の連日(1 時間毎 × 72 時間)でも 1000 件未満で、上限 4 ページ(2000 件)に収まる。

［提案］**経過表のハブは `basedOn` を持たない**。カルテの詳細(`useDialysisOrderDetail`)は
`Procedure?based-on=SR&_revinclude:iterate=Observation:part-of` で実施記録の子まで読むので、経過表のハブが
`basedOn` を持つとその打点まで同じ応答に乗り、年 150 回 × 80 点で 1 万件を超える。`partOf` だけで結べば、
既存の読み出し(`ORDER_PERFORM_REVINCLUDES` は `Procedure:based-on` の直接の逆引きだけ。ボードの `fetchDialysisSessions` は
category = `dialysis` の日付検索)のどれにも乗らない。

### 2.3 実施記録の取消・終了との関係

| 操作 | 経過表 |
|---|---|
| 実施取消(`buildDialysisPerformDeleteBundle`) | **一緒に消す**。実施しなかった回の経過表は残す意味が無い(麻酔チャートが実施取消で消えないのとは逆。手術は実施記録とチャートが別の事実だが、透析は経過表が実施記録の中身)。順序は 打点・イベント → 経過表のハブ → 実施記録の子 → 実施記録のハブ |
| 終了(`buildDialysisFinishBundle`) | 経過表があれば、ハブを `completed` にし `performedPeriod.end` を回の終了に揃える PUT を同じ transaction に入れる |
| 終了の入力の初期値 | 透析後血圧 = 最後の血圧の打点、除水量 = 最後の累積除水量(無ければ従来どおり前後の体重の差)。装置の値のほうが実際の除水に近い。薬剤の行 = オーダーから写した行に経過表の薬剤を重ねる(`mergeChartMedicines`。同じ薬で量が空の行には量と経路を入れ、それ以外は行を足す。算定の印はオーダー側の行のまま) |

［導出］終了・取消のどちらも経過表の有無を知る必要があるので、実施入力のモーダル(終了の段階)と取消の処理は
経過表のハブを 1 回読む(`useDialysisChart(sessionId)`)。終了は 1 回に 1 度しか開かないので、この読みは許容する。

［提案］**経過表に独自の「確定」を置かない**。麻酔チャートの確定(ハブ completed + 閲覧のみ)は、チャートが
手術の事実の記録として単独で閉じるためのものだった。透析では回の終了がその役を担う。終了後も打点の追加・削除は
できる(書き忘れた血圧を後から足す運用があり、経過表は会計に載らないので鍵を掛ける理由が無い)。

---

## 3. 画面

### 3.1 入り口

| 場所 | 出し方 | 条件 |
|---|---|---|
| 透析一覧のボードのカード | ケバブ(RowMenu)に「経過表」 | 実施記録が開始以降(`in-progress` / `completed`)。入室だけの回には出さない(開始前の値は実施記録の透析前体重・血圧に入る) |
| 透析一覧のベッドサイドの表 | 操作列に「経過表」 | 同上 |
| カルテの透析カードの詳細(実施履歴の表) | 行に「経過表」 | 同上。モーダルで開く(カルテを見ながら読み返す) |

- **経過表ありの印**: 経過表のある回には折れ線のアイコン(`DialysisChartMark`、title「経過表あり」)を添える。
  ボード・週・ベッドサイドの表は、実施記録の読み出し(`fetchDialysisSessions`)の `_revinclude=Procedure:part-of` に
  経過表のハブが乗るので、追加の検索は無い(`dialysisChartSessionIds`)。カルテ(カードの実施の行・詳細の実施履歴)は
  経過表のハブが `basedOn` を持たずオーダーの詳細に乗らないので、オーダー単位のチェーン検索 1 本で引く
  (`Procedure?category=order-type|dialysis-chart&part-of:Procedure.based-on=ServiceRequest/{id}&_sort=-date`。
  `useDialysisChartSessionIds`)。カルテの読み出しに `_revinclude:iterate=Procedure:part-of` を足すと
  `Observation:part-of` の :iterate で打点まで乗るので使わない。読み直しは経過表のハブを作った・消したときだけ。
- 専用ページ `/dialysis-sessions/:sessionId/chart`(sessionId = 実施記録のハブの id)。「戻る」は開いた画面へ返す(`useChartReturnTo`)。
- ［提案］モーダルではなくページを本体にする(麻酔チャートと同じ理由。透析中に開きっぱなしにし、グラフ + 表 + 入力が要る)。
  カルテからだけモーダル。
- ［提案］ボードでは常設のボタンにせずケバブに畳む。カードの常設は次の段階(入室 / 開始 / 終了)のためのもので、
  経過表は看護師・臨床工学技士が別の文脈で開く(`ui-compact-band-kebab-menu` と同じ判断)。

### 3.2 ページの構成

1. **ヘッダ**: 患者(氏名・患者番号)、回の日付・ベッドまたはベッドサイド・シフト、浄化方法、指示の条件
   (透析時間・QB・QD・目標除水 = 透析前体重 − DW)、回の開始時刻。経過表が無ければ打点の入力だけを出し、
   最初の打点でハブを作る(「開始」ボタンは置かない。回の開始は実施記録が持っている)。
2. **グラフ**(SVG。器の `TimeSeriesPlot` を共用): 横軸 = 時刻(回の開始〜終了、記録中は右に余白)。
   収縮期(∨)・拡張期(∧)・脈拍(●)を 0〜220 の共通軸。イベントは上端に ▼ + ラベル。回の開始・終了は
   固定の縦線(実施記録の `performedPeriod`)。目盛りは 4 段階(広く / 標準 / 拡大 / 全画面)。
   **累積除水量は右軸**(■ + 折れ線。`ChartSecondaryAxis`)。上端は目標除水 × 1.2(目標が無ければ記録の最大値 × 1.2)を
   0.5L 刻みに丸め、目標除水(透析前体重 − DW)を破線の横線で描く(`dialysisChartSecondaryAxis`)。目標も記録も無ければ右軸を出さない。
3. **打点の表**: 列 = 時点、行 = 項目(血圧・脈拍・SpO2・体温・QB・QD・除水速度・累積除水量・静脈圧・動脈圧・TMP)。
   列頭に削除(その時点の打点を 1 transaction で消す)。追加フォームは時刻(既定 = 今、「現在」ボタン)+ 各項目で、
   入れた項目だけ Observation になる。
   ［提案］**装置の値の行は前回の値を初期値にする**(QB・QD は回の中でほぼ変わらず、累積除水は単調に増える)。
   血圧・脈拍は空から入れる。
4. **イベント**: 種別(+ その他は自由文)と時刻で追加。一覧に削除(ゴミ箱アイコン)。
5. **薬剤**(器の `DrugsSection`): 医薬品マスタから選び、単回(量 + 製剤単位)か持続(速度)、経路、時刻。持続は「終了」で閉じる
   (終わった回では回の終了時刻、透析中なら今)。一覧に削除。
6. **フッタ**: 「印刷」(別タブ。§3.5)と「経過表取消」(打点・イベント・薬剤・ハブを消す。confirm を挟む)。確定は無い(§2.3)。

### 3.3 保存の単位

- 最初の打点 = ハブ POST + その時点の Observation 一式を 1 transaction(ハブは `urn:uuid` で結ぶ)。
- 打点の追加 = その時点の Observation 一式を 1 transaction。
- イベント = 1 件ずつ POST。
- 時点の削除 = その時点の Observation を 1 transaction で DELETE。
- 経過表取消 = 子 → ハブの順に 1 transaction で DELETE(履歴は上流の `_history` に残る)。

### 3.4 器の共通化(麻酔チャートからの切り出し)

［事実］麻酔チャートの画面(`components/AnesthesiaChartPanel.tsx`、986 行)は、グラフ(`ChartPlot`・`PlotLegend`・
目盛り `PLOT_SCALES` / `gridSpec`)・打点の表と入力(`VitalsSection`)・イベント(`EventsSection`)・時刻の入力(`TimeField`)・
薬剤(`DrugsSection`)・術前評価の帯(`AnesthesiaPreopBand`)を 1 ファイルに持つ。FHIR の組み立て(`fhir/anesthesiaChartHelpers.ts`)も
打点・イベントの組み立てと読み出しが麻酔の定数(`CHART_MEASURES`・`CHART_EVENT_OPTIONS`)に結びついている。

［提案］**部門ごとに写さず、器を切り出して両方から使う**(`refactor` の約束: 部門ごとの重複を作らない)。

| 新しい場所 | 中身 | 由来 |
|---|---|---|
| `fhir/timeSeriesChartHelpers.ts` | `ChartSpec`(打点の項目の定義 = key / label / code system / code / unit / ucum / step、イベントの定義、打点の category)、打点 Observation の組み立て、イベント Observation の組み立て、打点の時刻ごとの束ね(`ChartPoint`)、削除エントリ | `anesthesiaChartHelpers` の `buildChartVitalObservations`・`buildChartEventObservation`・`buildAnesthesiaChartData` の打点とイベントの部分 |
| `components/timeSeriesChart/TimeSeriesPlot.tsx` | グラフ・凡例・目盛り | `ChartPlot`・`PlotLegend`・`PLOT_SCALES`・`gridSpec` |
| `components/timeSeriesChart/PointsSection.tsx` | 打点の表と入力 | `VitalsSection` |
| `components/timeSeriesChart/EventsSection.tsx` | イベントの一覧と入力 | `EventsSection` |
| `components/timeSeriesChart/TimeField.tsx` | 時刻の入力と「現在」 | `TimeField` |
| `App.css` | クラス名を `anes-chart__*` / `anes-plot__*` から `time-chart__*` / `time-plot__*` に寄せる | 55 規則 |

- 麻酔側に残すもの: ハブの組み立て(`buildAnesthesiaChartHub`。麻酔担当の performer)、術前評価の帯、確定 / 再開、イベントの種別定数。
  薬剤(`DrugsSection`・`buildChartDrugAdministration`・`finishChartInfusion`・`groupChartDrugs`)は第 4 段で器に移した
  (経路の選択肢は `ChartSpec.drugRoutes`、category は `ChartSpec.category` の先頭を `MedicationAdministration.category` に写す)。
- グラフに描く項目は `ChartSpec` の `plot`(収縮期・拡張期・脈拍の key)で指す。固定の縦線(透析の開始・終了)は
  `TimeSeriesPlot` の `markers` で渡す。
- ［提案］**切り出しは振る舞いを変えない第 1 段として先に行い、麻酔チャートの画面が変わらないことを確かめてから**透析に進む(§6)。

### 3.5 印刷

［事実］ThinReports ではグラフを描けない(麻酔チャートの申し送りと同じ)。

［提案］**画面と同じ SVG をブラウザの印刷に渡す**。別タブのページ `/dialysis-chart-print/:sessionId`(`pages/DialysisChartPrintPage.tsx`。
`App.tsx` の印刷ページ判定に足し、ヘッダー無し・ライトテーマ固定)。紙面の組み立ては器 `components/timeSeriesChart/ChartPrintPage.tsx`
(`ChartPrintSheet` に見出しの項目・打点・イベント・薬剤を渡す。麻酔チャートの印刷 `/anesthesia-chart-print/:orderId` と共用。CSS は `time-chart-print__*`)で、
部門のページは見出しに並べる情報を集めるだけ。A4 横 1 枚を目安に:

1. 見出し: 施設名、患者(氏名・患者番号)、実施日・時刻、浄化方法、条件、透析前体重、DW、目標除水、記録者、印刷日時。
2. グラフ: `TimeSeriesPlot` を `fixedWidth`(紙面の幅 277mm → px)と `height`(210px)で描く。横軸の切り替えは出さず、
   「全画面」と同じく全体を幅に収める。右軸・イベント・固定線は画面と同じ。
3. 打点の表: 列 = 時点。1 段 18 列までで段に分け、段数を最小にして列の数を揃える(25 時点なら 13 + 12)。行見出しに単位。
4. できごと・薬剤の一覧(2 段組)。

4 時間の回(30 分毎 8 時点)は 1 枚に収まる。紙面の確認は `browser-print-pdf-check` の手順(puppeteer で PDF)。

---

## 4. 経過表(温度板)との関係

［事実］温度板は `Observation?category=vital-signs,{order-type}|nursing` を読む(`api/queries/karte.ts`)。
1 週間表示では 1 測定が 1 列になるので、30 分毎の打点をそのまま読むと透析日だけ 8 列伸びる。

［提案］期間表示には**出さない**(打点に `vital-signs` を付けない)。
**24 時間表示にだけ**(`flowsheet-design.md` §1.1)透析中のバイタルを重ねる(第 4 段で実装)。取得は `useVitalFlowsheet` の
第 4 引数(`withDialysisChart`)で、24 時間表示のときだけ
`Observation?patient&category=order-type|dialysis-chart&code=85354-9,8867-4,2708-6,8310-5&date=…` をもう 1 本並列に引いて混ぜる
(装置の値は code で上流に落としてもらう。手元で絞らない)。打点は `vital-entry` の identifier を持たないので、列からバイタル編集は開かない。

---

## 5. 透析支援システムからの取込

［事実］`dialysis-order-design.md` §8 の境界は「実施記録のハブとその子」。透析中の時間軸はこの経過表の器に入れる。

［提案］外部システムは、対象の回の実施記録のハブ(`Procedure?category=order-type|dialysis&date=…&subject=…` か、
予約の `dialysis-appointment` から)を引いたうえで、§2 の形(経過表のハブ 1 件 + 打点)を書く。打点の `device` に装置の
Device を添えてよい(画面は読まない)。画面側は手入力と同じデータとして扱うので、取込口は作らない。
取り込んだ打点の削除・修正は外部側の責任にし、画面の削除ボタンも効く(人が直せる)。

---

## 6. 実装の段階と触る場所

**第 1 段: 器の切り出し**(振る舞いを変えない。`refactor:`)— 実装済み(2026-11-10)。

- 新規: `fhir/timeSeriesChartHelpers.ts`、`components/timeSeriesChart/*.tsx`。
- 変更: `fhir/anesthesiaChartHelpers.ts`(打点・イベントの組み立てと読み出しを器に委ねる)、`components/AnesthesiaChartPanel.tsx`
  (器を使う。薬剤・術前評価・確定は残す)、`App.css`(クラス名)。
- 確認: 麻酔チャートのページとカルテのモーダルで、サンプルデータ(`dev-seed-anesthesia-chart`。胆嚢摘出術に 2 時間ぶん)の
  表示・打点の追加と削除・イベント・薬剤・確定 / 再開が変わらないこと。
- 切り出したもの: `ChartSpec`(項目・イベント・category)、`buildChartPointObservations` / `buildChartEventObservation`
  (ハブの参照は `urn:uuid` も受ける)、`groupChartObservations`、`chartObservationDeleteEntries`、`nowInput`。
  画面は `TimeSeriesPlot`(`extraTimes` で薬剤の時刻を軸に入れる、`emptyStart`、`pulseKey`)・`PointsSection`(`legend`)・
  `EventsSection`・`TimeField`。麻酔の打点は従来どおり category 無しで書かれる(FHIR 上の形は変えていない)。

**第 2 段: 透析経過表**(`feat:`)— 実装済み(2026-11-10)。

- 新規: `fhir/dialysisChartHelpers.ts`(`DIALYSIS_CHART_TYPE`、`DIALYSIS_CHART_SPEC`(§2.1 の項目とイベント)、ハブの組み立て、
  `isDialysisChartHub`、`buildDialysisChartData`、取消のエントリ)、`components/DialysisChartPanel.tsx`、`DialysisChartModal.tsx`、
  `pages/DialysisChartPage.tsx`。ルート `/dialysis-sessions/:sessionId/chart`(`App.tsx`)。
- `api/queries/dialysis.ts`: `useDialysisChart(sessionId)`(ハブ 1 件 + 子を全件)、`useDialysisChartWrite(sessionId)`。
  `fetchAllByPartOf` は `api/queries/anesthesia.ts` から `core.ts` へ移して共用。
- `fhir/dialysisResultHelpers.ts`: `MEASUREMENTS` に §2.1 の 4 コードを足す。`buildDialysisFinishBundle` に経過表のハブを閉じる PUT、
  `buildDialysisPerformDeleteBundle` に経過表の削除、`initialDialysisPerformForm` に最後の血圧・累積除水の初期値(§2.3)。
- `components/DialysisPerformModal.tsx`: 終了の段階で `useDialysisChart` を読み、初期値と bundle に渡す。
- 入り口(§3.1): `components/DialysisBoard.tsx` のケバブ、`pages/DialysisWorklistPage.tsx` のベッドサイドの表、
  `components/DialysisOrderDetailPanel.tsx` の実施履歴の行(モーダルは `KarteCardModals.tsx` から)。
- ドキュメント: `dialysis-order-design.md` §2.1(新しい URI)・§6・§9、`order-flows/dialysis.md`(各回の実施・リソースの構成・部品)、
  `functional-gap-backlog.md` の透析の行。
- 実装で決めたこと:
  - 装置の値(QB・QD・除水速度・累積除水・静脈圧・動脈圧・TMP)は前回の打点の値を次の入力の初期値にする(`ChartSpec.carryOver`)。
  - 終わった回を後から書くときは、時刻の初期値を回の開始にし、追加のたびに直前の時刻を残す(透析中の回は「今」)。
  - 回の開始・終了はグラフの固定線(`TimeSeriesPlot` の `markers`)。
  - 実施取消は `useCancelDialysisPerform` が先に経過表を読んでから、経過表 → 実施記録の順の 1 transaction で消す。
  - 終了の入力(`DialysisPerformModal`)は終了の段階でだけ経過表を読み、最後の血圧・累積除水を初期値にし、
    経過表のハブを回と一緒に閉じる(`buildDialysisFinishBundle` の `chartHub`)。
  - `fetchAllByPartOf` は `api/queries/core.ts` に移し、麻酔チャートと共用。

**第 3 段: 見本**— 実装済み(2026-11-10)。

- デモ投入(`demo-seed/dialysis.ts` の `chartBundle`): 直近 3 回と血圧低下で短縮した回に、30 分毎の打点(血圧・脈拍・QB・QD・
  除水速度・累積除水・静脈圧・TMP)と穿刺・返血・止血確認、血圧低下の回には「血圧低下 → 除水停止 → 補液 → 除水再開」のイベント。
  1 回ぶんを 1 transaction(ハブは urn:uuid)。
- `docs/order-flows/dialysis.md` の全体の流れと各回の実施の図に「透析中の記録」の箱。
- 温度板の 24 時間表示への表示(§4)は要望があれば(§8-3)。

**第 4 段: 透析中の薬剤・右軸・温度板・印刷**(`feat:`)— 実装済み(2026-11-11)。

- 器: `fhir/timeSeriesChartHelpers.ts` に薬剤(`ChartDrugFormValues`・`buildChartDrugAdministration`・`finishChartInfusion`・
  `ChartDrugLine`・`groupChartDrugs`)、`chartChildDeleteEntries`(打点・イベント・薬剤)、`ChartSecondaryAxis`、`ChartSpec.drugRoutes`。
  `components/timeSeriesChart/DrugsSection.tsx`(麻酔チャートから移設)。`TimeSeriesPlot` に `secondary`(右軸)・`fixedWidth`・`height`。
  麻酔チャート(`anesthesiaChartHelpers.ts`・`AnesthesiaChartPanel.tsx`)は器を使う形に書き換え(FHIR 上の形は変えていない)。
- 透析: `DIALYSIS_CHART_SPEC.drugRoutes`、`DialysisChartData.drugs`、`fetchDialysisChart` が `MedicationAdministration` も part-of で読む、
  `dialysisChartLatest` に `medicines`、`initialDialysisPerformForm` の `mergeChartMedicines`、`dialysisChartSecondaryAxis`・`dialysisChartTarget`、
  `DialysisChartPanel` に `DrugsSection` と「印刷」、`DIALYSIS_CHART_FLOWSHEET_CODES`。
- 温度板: `api/queries/karte.ts` の `useVitalFlowsheet(…, withDialysisChart)`、`VitalFlowsheetPanel` が 24 時間表示で渡す。
- 印刷: `pages/DialysisChartPrintPage.tsx`、`DIALYSIS_CHART_PRINT_PATH`(`api/reportsClient.ts`)、`App.css` の `.dialysis-chart-print*`。
- デモ投入(`demo-seed/dialysis.ts`): 血圧低下の回の経過表に生理食塩液 200mL バッグ 1 袋(12:23・静脈内)の薬剤を足した(`MED.saline`)。

---

## 7. 検証の手順(開発環境)

1. `tsc -b`・`npm run lint`・import 循環(`scripts/import-cycles.cjs src/api/queries`)。
2. 第 1 段: 麻酔チャートの既存データで、ページ・モーダルともに見た目と操作が変わらないこと(ライト・ダーク)。
3. 第 2 段(テスト太郎または中村 浩二検証。`dev-seed-dialysis-order`):
   - ボードで開始済みの回のケバブに「経過表」が出る(入室だけの回・予約だけの回には出ない)→ ページで打点を 3 時点追加
     → FHIR 上で経過表のハブが実施記録のハブを `partOf` で指し、`basedOn` を持たず、打点が `category = dialysis-chart` で
     `partOf = 経過表のハブ` になること → 表とグラフに反映、開始の縦線が実施記録の開始時刻に出る。
   - イベント(除水停止・補液「生食 200mL」・除水再開)→ グラフの ▼ とラベル、2 段に振られること。
   - 時点の削除 → その時点の Observation が 1 transaction で消える。
   - 終了 → 透析後血圧と除水量の初期値が最後の打点になる → 保存で経過表のハブが completed・end が回の終了に揃う。
   - カルテの透析カードの詳細(`useDialysisOrderDetail`)の応答に経過表の打点が**乗らない**こと(上流への検索で件数を見る)。
   - 実施履歴の行の「経過表」でモーダルが開く。
   - 実施取消 → 経過表(ハブ + 打点 + イベント)も消え、予約が予約済に戻る。
   - ベッドサイドのオーダー(開発環境には無いので作る。CHDF を 1 件)で、経過表が連日の横軸になり「広く」「全画面」で読めること。
   - 温度板に打点が出ないこと。

---

## 8. 申し送り

1. **装置からの自動取込**(§5)。HL7 / ベンダー API の受け口は院内エージェント(`fhir-client-agent`)側の話。
2. **持続投与の総量**: 経過表の持続(速度 × 時間)から実施記録の薬剤の量を出していない(製剤単位への換算が要る)。終了の入力では量が空で流れる。
3. **同時編集**: 1 点 1 リソースなので追加同士は衝突しない。回の終了(ハブ PUT)と打点の追加が同時でも、打点はハブを触らないので 412 にならない。
