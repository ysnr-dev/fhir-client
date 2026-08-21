# 処方箋発行の設計

処方一覧(部門業務)の「処方箋発行」で刷る処方箋 PDF の設計。帳票基盤の使い方は
検体ラベル(docs/lab-label-design.md)を踏襲しているので、共通部分の理由はそちらを参照。

## 1. 全体像

```
RxWorklistPage「処方箋発行」<a target="_blank">
  → GET /reports/prescriptions/:order_id/pdf   (Cookie セッション認証)
    → Reports::PrescriptionPdfsController#show
      → PrescriptionReport#generate
          ① GET /ServiceRequest/{id}
          ② batch Bundle POST /
             - ServiceRequest?_id={id}&_revinclude=MedicationRequest:based-on
             - Patient/{id}
             - Organization?identifier={保険医療機関コードの system}|
          → Reports::PrescriptionRenderer#render (Thinreports)
      → send_data inline
```

- frontend からはオーダー id だけを渡し、データ収集は backend が上流から行う。
- 副作用は無い(検体ラベルと違い採番が要らないので、何度呼んでも読むだけ)。
- 進捗の Task にも触らない。発行 = 受付(requested → accepted)の遷移は frontend の
  ボタンが行い、PDF エンドポイントは Task の状態を縛らない。受付前に URL を直叩き
  しても困るのは本人だけで、再発行用の API を分けずに済む(検体ラベルと同じ判断)。

## 2. 様式は 2 つ(固定レイアウト)

| | 院外 | 院内 |
|---|---|---|
| ファイル | `backend/lib/report_layouts/prescription_external.tlf` | `prescription_internal.tlf` |
| 様式 | 処方箋 様式第2号(2024年12月改定、A5) | 簡易様式(A5) |
| 対象 | 入外区分 = 外来 かつ 処方区分 = 院外(external) | それ以外すべて(院内・入院全区分) |

- どちらで刷るかはオーダーの category から backend が決める(`PrescriptionReport#external?`)。
  区分が読めないオーダーは院内様式に倒す。素性の分からないものを保険請求の様式で
  刷る方が事故だから。
- レイアウトはマスタ(report_layouts)に登録しない。国の様式と院内の定型で、院内ごとに
  書き換えるものではないため、検体ラベルと同じくリポジトリ同梱のファイルを直接読む
  (理由の詳細は docs/report-mappings/lab-label-01.md)。
- 様式第2号の保険・公費の欄(保険者番号・公費負担者番号・被保険者証記号番号・区分)は
  保険情報を扱っていないので枠だけ描いて空欄。リフィル・分割調剤も入力機能が無いので
  枠のみ。「変更不可」「患者希望」列も同様に常に空欄。
- プレースホルダー ID の一覧と寸法の対応は docs/report-mappings/prescription-01.md。

## 3. 上流アクセスの注意(明細は _revinclude で取る)

`MedicationRequest?based-on=...` は上流に無い検索パラメータで、上流は未知の
パラメータを黙って無視するため全患者の明細が返ってしまう。明細は必ず

```
ServiceRequest?_id={id}&_revinclude=MedicationRequest:based-on
```

で取る(frontend の usePrescriptionDetail と同じ形)。spec がこの URL を固定している。

自院(保険医療機関)の Organization は identifier の system だけを指定した検索
(`identifier=...insurance-medical-institution-no|`)で引く。Organization 検索に type は
無いため。system のみの identifier 検索は上流に実装を足した(fhir-server 2026-08-20、
token 検索の `system|` 形式と同じ扱い)。検索が空振りしても発行は止めず、医療機関欄を
空欄にして刷る。

## 4. 処方欄の組み方

- RP 明細は 1 個の text-block(`rx_content`)に整形済みの行を流し込む。行の並びは
  「Rp 見出し → 薬品 → 用法」で、カルテの紹介状に流し込む処方文字列
  (frontend populateContext.ts の formatPrescriptions)と同じ。変えるときは両方を揃える。
- 折り返しは ThinReports 任せにせず、レンダラが桁数(半角換算、全角 = 2)で事前に折る。
  枠に入る行数(`lines_per_page`)との対応を決定的にするため。あふれた行は同じ
  レイアウトの続紙(start_new_page)に送り、最終ページ以外に「（次頁に続く）」を出す。
- `lines_per_page` は .tlf の処方欄の高さ ÷ 行送り(line-height 12pt)の実測値。
  レイアウトを直したら renderer spec の続紙テストで境界を確かめること
  (あふれは overflow: truncate で黙って消えるので、ずれると薬が印字されずに落ちる)。

## 5. 各欄の値の出どころ

| 欄 | 出どころ |
|---|---|
| 患者(氏名・カナ・生年月日・性別) | Patient(Reports::PatientMeta) |
| 交付年月日 | ServiceRequest.authoredOn(処方日)。発行操作の日ではないので、再発行しても同じ日付になる |
| 保険医氏名 | ServiceRequest.requester.display |
| 依頼科 | order-department 拡張の display |
| 医療機関(名称・住所・電話) | 自院 Organization |
| 都道府県番号・点数表番号・医療機関コード | 自院 Organization の保険医療機関コード(10 桁)を 2+1+7 に分割 |
| 処方欄 | MedicationRequest を RP 番号で畳んだもの(frontend groupByRp と同じ規則) |
| 備考 | ServiceRequest.note(処方箋コメント) |

薬品名は一般名処方コード(【般】〜)を優先し、無ければレセ電コードの display。
「変更不可」チェックは入力機能が無いため常に空欄で、一般名処方は名称の【般】が
その表明になっている。

## 6. 画面(処方一覧)

- 依頼済の行の「処方箋発行」は PDF を新規タブで開くと同時に受付済へ進める
  (検体ラベルの発行と同じ「発行が受付を兼ねる」)。
- 受付済以降(中止を除く)の行は、ケバブメニューの「処方箋再発行」で同じ PDF を開く。
  進捗は動かさない。再発行を主ボタンの列に出さないのは、調剤登録など日常の操作と
  並ぶと押し間違えるため。
