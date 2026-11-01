# 処方箋発行の設計

処方一覧(部門業務)の「処方箋発行」で刷る処方箋 PDF の設計。帳票基盤の使い方は
検体ラベル(docs/lab-label-design.md)を踏襲しているので、共通部分の理由はそちらを参照。

## 1. 全体像

```
RxWorklistPage「処方箋発行」<a target="_blank">
  → GET /reports/prescriptions/:order_id/pdf   (Cookie セッション認証)
    → Reports::PrescriptionPdfsController#show
      → PrescriptionReport#generate
          batch Bundle POST /
             - ServiceRequest?_id={id}&_include=ServiceRequest:subject
                 &_revinclude=MedicationRequest:based-on
             - Organization/{自院 id}(未設定なら Organization?identifier={保険医療機関コードの system}|)
          → Reports::PrescriptionRenderer#render (Thinreports)
      → send_data inline
```

- frontend からはオーダー id だけを渡し、データ収集は backend が上流から行う。
- 副作用は無い(検体ラベルと違い採番が要らないので、何度呼んでも読むだけ)。
- 進捗の Task にも触らない。発行 = 受付(requested → accepted)の遷移は frontend の
  ボタンが行い、PDF エンドポイントは Task の状態を縛らない。受付前に URL を直叩き
  しても困るのは本人だけで、再発行用の API を分けずに済む(検体ラベルと同じ判断)。

## 2. 様式は 3 つ(固定レイアウト)

| | 院外 | 院外(QR コード付き) | 院内 |
|---|---|---|---|
| ファイル | `backend/lib/report_layouts/prescription_external.tlf` | `prescription_external_qr.tlf` | `prescription_internal.tlf` |
| 様式 | 処方箋 様式第2号(2024年12月改定、A5) | A4 横。左半分が様式第2号(A5 実寸)、右半分に QR コード(§7) | 簡易様式(A5) |
| 対象 | 入外区分 = 外来 かつ 処方区分 = 院外(external) | 同左で、施設設定 `prescription_print.external_qr` が真 | それ以外すべて(院内・入院全区分) |

- どれで刷るかはオーダーの category と施設設定から backend が決める(`PrescriptionReport#layout_key`)。
  区分が読めないオーダーは院内様式に倒す。素性の分からないものを保険請求の様式で
  刷る方が事故だから。QR コード付きは院外の様式をそのまま左半分に置いたもので、処方欄の
  行数・桁数(`lines_per_page` / `max_cols`)は院外と同じ。
- レイアウトはマスタ(report_layouts)に登録しない。国の様式と院内の定型で、院内ごとに
  書き換えるものではないため、検体ラベルと同じくリポジトリ同梱のファイルを直接読む
  (理由の詳細は docs/report-mappings/lab-label-01.md)。
- 様式第2号の保険・公費の欄(保険者番号・公費負担者番号・被保険者証記号番号・区分)は
  保険情報を扱っていないので枠だけ描いて空欄。リフィル・分割調剤も入力機能が無いので
  枠のみ。「変更不可」「患者希望」列は後発品変更不可(§5)の薬品の行に「レ」を刷る。
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
  「Rp 見出し → 薬品 → 用法 → 調剤指示」で、カルテの紹介状に流し込む処方文字列
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
| 交付年月日 | ServiceRequest.authoredOn(登録日時)の日付。投与開始日(occurrenceDateTime)ではない。発行操作の日でもないので、再発行しても同じ日付になる。化学療法レジメンの日オーダー(requisition が regimen-instance)だけは投与開始日(`docs/chemo-regimen-design.md` §8.19) |
| 保険医氏名 | ServiceRequest.requester.display |
| 依頼科 | order-department 拡張の display |
| 医療機関(名称・住所・電話) | 自院 Organization |
| 都道府県番号・点数表番号・医療機関コード | 自院 Organization の保険医療機関コード(10 桁)を 2+1+7 に分割 |
| 処方欄 | MedicationRequest を RP 番号で畳んだもの(frontend groupByRp と同じ規則) |
| 備考 | ServiceRequest.note(処方箋コメント) |

薬品名は一般名処方コード(【般】〜)を優先し、無ければレセ電コードの display。

調剤指示(一包化・粉砕・別包化・混合)は明細の `dispenseRequest` の `instructionForDispense` 拡張で、RP の
用法の次に「調剤指示: 一包化・粉砕」の行を足す(院外・院内とも)。

後発品変更不可は `MedicationRequest.substitution`(変更可否コード 1 + 理由「医療上必要」/「患者希望」)。
院外様式では「変更不可」「患者希望」列の text-block(`rx_no_change` / `rx_patient_wish`)に、処方欄と
同じ行送りで薬品の 1 行目の高さに「レ」を刷る(折り返した継続行には付けない)。列の無い院内様式は
薬品名の後ろに【変更不可】【患者希望】を書く。一般名処方には付かない(フォームが出さない)。
保険医署名欄は記名(保険医氏名)で足り、押印は紙で行う。

## 6. 画面(処方一覧)

- 依頼済の行の「処方箋発行」は PDF を新規タブで開くと同時に受付済へ進める
  (検体ラベルの発行と同じ「発行が受付を兼ねる」)。
- 受付済以降(中止を除く)の行は、ケバブメニューの「処方箋再発行」で同じ PDF を開く。
  進捗は動かさない。再発行を主ボタンの列に出さないのは、調剤登録など日常の操作と
  並ぶと押し間違えるため。

## 7. 院外処方箋の QR コード(JAHIS 院外処方箋2次元シンボル記録条件規約)

施設設定「処方箋の印刷」の「院外処方箋にQRコードを印字する」を入れると、院外処方箋が
A4 横(`prescription_external_qr.tlf`)になり、右半分に処方内容の QR コードを刷る。記録条件は
JAHIS 技術文書 26-101「院外処方箋2次元シンボル記録条件規約 Ver.1.11」(2026 年 5 月)に従う。

### 7.1 記録する内容(`Reports::PrescriptionQrData`)

1 レコード 1 行のカンマ区切り(CRLF 終端、Shift_JIS)。先頭はバージョン `JAHIS11`。
規約の前提どおり**紙に書いていない情報は入れない**。

| レコード | 内容 | 出どころ |
|---|---|---|
| 1 医療機関 | 点数表番号(1 医科 / 3 歯科)・医療機関コード 7 桁・都道府県番号・名称 | 自院 Organization の保険医療機関コード(紙と同じ 2+1+7 分割)と name |
| 2 所在地 / 3 電話 | 郵便番号(3-4 桁)・住所 / 電話・FAX | 自院 Organization。無ければレコードごと省く |
| 4 診療科 | コードなし(種別 1)+ 科名 | order-department 拡張の display |
| 5 医師 | 漢字氏名 | requester.display |
| 11〜13 患者 | 患者番号・漢字氏名・半角カナ氏名、性別(1/2)、生年月日(YYYYMMDD) | Patient(カナは `Reports::HalfWidthKana` で半角に) |
| 14 一部負担区分 | 交付日に 6 歳未満なら 3 | 生年月日と交付年月日 |
| 22 保険者番号 / 23 記号番号 | `22,` / `23,,,1,`(空) | 保険情報を扱っていないので、必須レコードの枠だけ(紙の保険欄が空欄なのと同じ) |
| 51 交付年月日 | YYYYMMDD | 紙の交付年月日と同じ(`PrescriptionMeta.issue_date`) |
| 81 備考 | 化学療法のレジメン行 → 処方箋コメント。行ごと・50 文字ごとに分ける | 紙の備考と同じ |
| 101 剤形 | RP 番号・剤形区分・調剤数量 | 剤形は用法の基本区分(内服 1・外用 3・注射 5、注入は 9 + 名称)。頓用(用法コード 3 桁目 = 5)は 2。調剤数量は内服 = 日数、頓服 = 回数、それ以外 = 1(用量に全量) |
| 111 用法 | 用法コード種別 2(JAMI)・16 桁コード・名称・1 日回数 | 用法マスタ(厚労省 電子処方箋用法マスタ = JAMI 標準用法コード)。1 日回数は 4 桁目 |
| 181 用法補足 | 補足用法 I/W/D/C(区分 8 + 8 桁コード)、用法コメント(区分なし)、調剤指示(一包化 2・粉砕 4、別包化・混合は区分なし) | Dosage.additionalInstruction / instructionForDispense 拡張 |
| 201 薬品 | 情報区分(レセ電 7 始まりは特定器材 2)・コード種別(一般名 7 / レセ電 2 / なし 1)・コード・名称・用量・力価フラグ・単位 | 用量は紙と同じ(日数を持つ内服は 1 日量、頓用は 1 回量、それ以外は全量)。力価は 2 |
| 221 不均等 | 各回の量 5 つと V コード 5 つ | 補足用法 V コード(`V` + 回目 + 量、空きは N) |
| 241 1回服用量 | 1 回量・1 日回数 | 内服で 1 回量が決まるとき(不均等のときは 221 のみ) |
| 281 薬品補足 | 後発品変更不可(3)・先発医薬品患者希望(8)・薬剤コメント(区分なし) | MedicationRequest.substitution / note |

出さないレコード: 保険種別(21)・負担給付率(24)・公費(27〜30)・使用期限(52)・麻薬(61)・分割(63、102)・
リフィル(64)・処方箋番号(82)・単位変換(211)・負担区分(231)。いずれも対応する入力機能が無い
(単位変換は官報告示単位との換算表を持たないため)。

文字は Windows-31J で符号化し、入らない文字は規約の外字の扱いどおり「■」にする。半角カンマは
全角に、項目内の改行は全角空白にし、各項目の前後の空白は落とす。桁数(文字数)を超えた分は切る。

### 7.2 QR コードの作り方(`Reports::PrescriptionQrSymbols`)

- QR コード モデル 2、誤り訂正レベル M(規約は L 以上)、8 ビットバイトモード。
- 1 シンボルは版 30 まで。枠は一辺 120pt(≒42mm)の固定で、セルは 0.29mm 以上(規約は 0.25mm 以上)。
  版を上げるよりシンボルを分ける方を取る。
- 入り切らない処方は QR コードの連結(structured append、最大 16 シンボル)で分割する。
  分割はレコード(行)の境で行い、各シンボルの大きさをなるべく揃える(連結ヘッダの位置・総数・
  パリティは `StructuredAppendSegment` が書く。rqrcode_core は連結を持たない)。
- レイアウトの枠は `qr_1`〜`qr_6`(1 ページ 6 個)。分割されたときは 1 ページ目の枠から順に埋め、
  添え書き `qr_label_n` に「n / 総数」を出す。枠が足りなければ続紙の枠に送り、それでも足りなければ
  422(`prescription_qr_too_large`)。単独のシンボルには添え書きを出さない。
- 画像は枠より大きく描いて縮める(ThinReports の image-block は枠より大きい画像だけを縮尺する)ので、
  枠の大きさがそのままシンボルの実寸になる。

### 7.3 画面と設定

- 施設設定「処方箋の印刷」(`prescription_print.external_qr`、既定 off)。切り替えは次に刷る処方箋から
  効き、再発行も同じ設定で刷る(発行済みの PDF は保存していない)。
- 処方一覧の「処方箋発行」「処方箋再発行」の経路は変わらない(backend がレイアウトを選ぶだけ)。
