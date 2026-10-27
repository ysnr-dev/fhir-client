# 印刷・帳票の不足機能

2026-10-17 に印刷・帳票の実装を棚卸しして洗い出した未実装の記録。帳票の不足は
`docs/functional-gap-backlog.md` §2.10、`docs/lab-backlog.md` B-3、`docs/rad-backlog.md` §C、
`docs/order-common-backlog.md` §4.6、`docs/clinical-pathway-backlog.md` E-4 と各設計書の「未着手」節に
散っていて、「何が出せて何が出せないか」を横断して見る場所が無かったのでここにまとめる。
個別領域の文脈はそれぞれのバックログに残し、本書は横断一覧と基盤側の課題を持つ。

判定基準は、既存バックログに載っている項目に加えて、国内の病院向け電子カルテで標準的に出せる帳票。
会計系(受付票・領収書・明細書)はレセコンが正本なので対象外(§4)。

## 1. 現状

### 1.1 出せるもの(8 系統)

backend の帳票ルートは `backend/config/routes.rb` の `namespace :reports`、frontend の URL 生成は
`frontend/src/api/reportsClient.ts` に集まっている。

| # | 帳票 | 入口 | 仕組み | 様式 |
|---|---|---|---|---|
| 1 | 処方箋(院外 = 様式第2号 / 院内 = 簡易様式、A5) | 処方一覧(`pages/RxWorklistPage.tsx`)の「処方箋発行」「処方箋再発行」 | `GET /reports/prescriptions/:order_id/pdf`、ThinReports | `backend/lib/report_layouts/prescription_external.tlf`、`prescription_internal.tlf` |
| 2 | 注射箋(注射指示票を兼ねる、A5、1 オーダー = 1 日分) | 注射一覧(`pages/InjectionWorklistPage.tsx`)の「注射箋発行」「注射箋再発行」 | `GET /reports/injections/:order_id/pdf` | `injection_order.tlf` |
| 3 | 注射ラベル(RP 単位、60×40mm、患者番号バーコード) | 同じ画面の「注射ラベル発行」 | `GET /reports/injection_labels/:order_id/pdf` | `injection_label.tlf` |
| 4 | 検体ラベル(採取管 1 本 = 1 枚、CODE128) | 検体検査一覧(`pages/LabWorklistPage.tsx`)の「ラベル発行」 | `GET /reports/lab_labels/:order_id/pdf`。発行で Specimen を作り採番 | `lab_label.tlf` |
| 5 | テンプレート回答(QuestionnaireResponse)の PDF | カルテ時系列(`components/KarteTimeline.tsx`)のテンプレートカードの「PDF」。レイアウト登録済みのテンプレートだけ有効 | `GET /reports/questionnaire_responses/:id/pdf`。レイアウトは `/report-layouts` で DB(`report_layouts`)に登録 | `docs/report-mappings/` に見本 4 本(入院診療計画書 `admission-plan-01`・診療情報提供書 `referral-01`・手術説明同意書 `sur-consent-01`・周術期口腔機能管理計画書 `perio-01`)。`shikan-01` は mapping だけで .tlf が無い |
| 6 | カルテ印刷(診療経過記録 = 2 号用紙、A4、期間指定、履歴の差分) | 「その他」→「カルテ印刷」(`components/KartePrintTab.tsx`)→ 別タブ `pages/KartePrintPage.tsx` | `window.print()`。`App.css` の `@page` / `@media print` | なし(HTML) |
| 7 | 文書作成(Word / Excel 様式への差し込み) | カルテ右ペイン「文書作成」(`components/DocumentCreatePanel.tsx`) | ブラウザ内で `{{ }}` を置換し患者ファイルに保存してダウンロード。PDF 化はしない | 施設が `/document-templates` に登録。同梱様式なし |
| 9 | 文書作成(PDF / 画像の様式に項目を置いて入力) | 同じ「文書作成」で様式テンプレートを選ぶ(`components/documentForm/DocumentFormFill.tsx`) | `POST /reports/document_forms/:template_id/pdf`、Prawn(ページ画像 + `text_box`)。回答は QuestionnaireResponse | 施設が `/document-templates` のデザイナで登録。見本は `docs/report-mappings/` の `*-form-01.json`(インポートで取り込む) |
| 8 | 検査結果報告書(1 件分、A4、2 段組み、材料なし) | 検査結果の内容表示(`components/LabResultDetailPanel.tsx`)の「印刷」 | `GET /reports/lab_results/:report_id/pdf`、ThinReports(左右 2 本の list) | `lab_result.tlf` |

印刷ではないファイル出力: データ抽出の CSV、DPC 患者一覧 CSV と様式 1 提出ファイル(FF1)、
看護必要度の様式 10・43(CSV / Excel)、AST 抗菌薬使用量 CSV、ロット番号 CSV。

### 1.2 基盤の現状

- PDF 生成は ThinReports(prawn)1 本。固定レイアウト向けで、長文・可変行数(記録・サマリー・一覧表)には向かない。
  可変行数の表は検査結果報告書が list を自動改ページなしで使い、段・ページの割り付けを Ruby で行う前例になる。
  HTML → PDF の経路は無い。
- `window.print` を使うのはカルテ印刷の 1 件だけ。印刷用ビューの共通部品(自院ヘッダ・患者帯・`@page`)は無い。
- 自院欄(医療機関名・住所・電話・FAX・保険医療機関コード)は自院 Organization から取るが、読むのは処方箋・注射箋だけ。
  テンプレート回答の帳票は読まない。
- 印影・医師の記名押印欄は無い(処方箋は記名のみで押印は紙。`docs/prescription-report-design.md` 97 行)。
- 保険情報は持たないので処方箋の保険・公費欄は空枠。リフィル・分割調剤も枠だけ(同 41〜42 行)。
- 施設設定に印刷・用紙・既定プリンタの項目は無い。
- `report_layouts` に帳票種別(`kind`)が無く、DB 登録のレイアウトは QuestionnaireResponse 用に限られる。
  同梱 6 種(ラベル・処方箋・注射・検査結果)は施設が差し替えられない(`docs/lab-label-design.md` §7)。
- 帳票内に QR コードは無い(Web 問診の QR は画面表示のみ)。
- 処方箋 PDF はカルテのカードから出せず、処方一覧からだけ(`docs/order-common-backlog.md` §4.6)。

## 2. 不足している帳票

必要度は 高 / 中 / 低。「出典」は既存バックログ・設計書の該当節で、無印は今回の比較で足した項目。

### 2.1 患者に渡す紙(外来の日常)

| 帳票 | 必要度 | 出典 | 当たり |
|---|---|---|---|
| 予約票(次回以降の予約、保存時印刷、日未定、バーコード) | 高 | gap §2.10 | `GET /reports/appointment_slip/:patient_id/pdf`、同梱 .tlf 1 枚 |
| 薬剤情報提供書・お薬手帳シール・薬袋ラベル | 高 | order-common §4.6 | ラベルは `injection_label.tlf` と同じ器。情報提供書は医薬品マスタに効能・注意文が要る |
| 検査結果報告書(患者控え。累積表 = 項目 × 採取日) | 高 | lab B-3、gap §4.5 | 1 件分は対応済み(§1.1 #8)。累積表は `lab_result.tlf` の list の作りを流用できる |
| 検査案内(放射線・内視鏡・生理の前処置説明、患者控え) | 中 | rad C-1 | 項目マスタに `patient_instruction` を足して差し込む |
| 説明書・パンフレット(印刷だけの文書ライブラリ) | 中 | gap §2.2 | `document_templates.kind = reference`、右ペインから「印刷のみ」 |
| 患者用パス(クリニカルパスの患者向け日程表) | 中 | pathway E-4 | — |
| 化学療法の患者向けスケジュール表 | 中 | chemo-regimen E-2 | — |

### 2.2 文書・同意書・計画書

| 帳票 | 必要度 | 出典 | 当たり |
|---|---|---|---|
| 退院時サマリー PDF(科別レイアウト) | 高 | discharge-summary-design §6、gap §2.2 | `GET /reports/discharge_summaries/:composition_id/pdf`。長文の改ページが課題(§3-1) |
| 診断書・死亡診断書などの標準様式の同梱 | 中 | — | 様式の見本は診療情報提供書(`referral-form-01`)・主治医意見書(`care-opinion-form-01`)・生活習慣病 療養計画書(`lifestyle-plan-*-form-01`)・歯科疾患管理料の管理計画書(`dental-plan-*-form-01`)。それ以外は施設が登録する |
| 同意書の状態管理(作成 → 印刷 → 同意済 → 原本保管)と印刷部数 | 中 | gap §2.2 | 文書の横断一覧とスキャン原本の結び付け |
| 造影剤検査の同意書 | 中 | rad C-2 | テンプレート + .tlf |
| 輸血の説明書・同意書(現状はオーダーの確認チェックだけ) | 中 | transfusion-design 58 行 | 同上 |
| 入院診療計画書の自動発生・退院療養計画書 | 中 | gap §2.10 | 見本 .tlf あり。入院実施の transaction で下書きを作る |
| 看護計画・看護サマリーの帳票 | 中 | nursing.md 55 行、gap §2.4 | Composition → ThinReports を退院サマリーと共通化 |
| リハビリテーション実施計画書・リハビリ処方箋 | 中 | rehab-design 214 行、gap §2.8 | — |
| 褥瘡対策計画書 | 低 | care-team-design 132 行 | 看護プロファイルと看護計画で代えている |
| 化学療法実施計画書・無菌調製の調製指示書 | 中 | chemo-regimen E-2 / E-3 | — |

### 2.3 オーダー控え・部門帳票

| 帳票 | 必要度 | 出典 | 当たり |
|---|---|---|---|
| 麻薬施用票 | 高 | gap §2.10 | `master_medicines.narcotic_category` で明細を拾い .tlf 1 枚 |
| 標本ラベル(病理) | 高 | gap §2.10 | `lab_label.tlf` 流用、標本番号の採番とセット |
| 自己血ラベル・細菌検査の容器ラベル | 中 | gap §2.10、micro-design 351 行 | 同上 |
| 検査依頼書(検体の伝票・放射線の依頼票・受付票) | 中 | lab B-3、rad C-3 | バーコード付き。撮影室の受付スキャンに使う |
| 持参薬鑑定書・指示書 | 中 | gap §2.10 | .tlf 1 枚 |
| 処置指示票・処置報告書 | 中 | gap §2.10、treatment-design 214 行 | 注射箋と同じ基盤 |
| 注射実施シート(1 日サマリ)・注射カレンダー・処方カレンダーの印刷 | 中 | gap §2.10、§2.7 | 一覧印刷の基盤(§3-4) |
| 照射録 | 中 | rad D-3 | — |
| 読影レポート・所見レポートの PDF | 中 | rad-report-design 493 行、exam-report-design 29 行 | 紹介状に添える用途 |
| 麻酔記録(麻酔チャート)の印刷 | 中 | anesthesia-design 253 行 | SVG → PDF の別経路が要る |
| はい膳表・食札 | 中 | meal-design 962 行 | — |
| ピッキング集計表(注射の薬剤別払出数) | 中 | gap §2.10 | 注射一覧の日付ぶんを薬剤で集計 |
| 単位換算印字・中止処方箋の関連番号 | 中 | gap §2.10 | 投与量換算マスタを流用 |
| 服薬指導記録・薬歴の印刷 | 低〜中 | gap §2.10、medication-guidance-design 82 行 | 投薬歴タブの表を PDF 化 |
| カルテのカードから処方箋 PDF を出す導線 | 中 | order-common §4.6 | `reportsClient.ts` の URL をカードのメニューへ |
| パスシートの印刷 | 中 | pathway E-4 | — |
| 血糖・インスリンスケールの一覧印刷 | 低 | injection-design 546 行 | — |

### 2.4 病棟・一覧の印刷

| 帳票 | 必要度 | 出典 | 当たり |
|---|---|---|---|
| 入院患者一覧・外来一覧・病棟マップ・移動予定 | 中 | gap §2.2、§2.6 | 病棟 × 日の一覧印刷エンドポイントを 1 種類作って横展開(§3-4) |
| 指示簿・用途別ワークシート(移動・食事・採血・清潔ケア・投薬切れ) | 中 | gap §2.4 | 同上 |
| 経過表(温度板)の印刷 | 中 | flowsheet-design 500 行 | 患者 × 期間のエンドポイントが要る |
| 検歴の時系列表 | 中 | lab B-3、gap §2.4 | — |
| 検体ラベルの病棟一括発行・区切りラベル | 中 | gap §2.4 | — |
| ダウンタイム用の定時 PDF(病棟一覧・指示簿・注射予定・食事) | 中〜高 | gap §4 | 一覧印刷ができれば定時ジョブで出すだけ |
| 看護必要度の様式(現状は CSV / Excel のみ) | 低 | nursing.md | 厚生局の様式へは転記で足りる |

### 2.5 診療記録の出力・法定・患者識別

| 帳票 | 必要度 | 出典 | 当たり |
|---|---|---|---|
| 患者 × 期間の一括 PDF(表紙・1 号用紙・病名・サマリー・記録・看護・経過表・検歴を束ねる) | 高 | gap §2.2 | `GET /reports/patients/:id/records.pdf?from&to&sections=`。長文なので §3-1 の経路が前提 |
| オーダー控え・指示歴の印刷 | 高 | gap §2.2 | カルテ印刷ページ(`KartePrintPage.tsx`)の基盤に足す |
| カルテ 1 号用紙(患者・保険・病名・労災) | 中 | gap §2.10 | 保険はレセコン(`patientgetv2`)から |
| リストバンド・バーコード台紙 | 中 | gap §2.3、§2.10 | .tlf 1 枚ずつ。患者番号バーコードは実装済み |
| PHR 向け Bundle の QR | 低 | gap §4.5 | — |

## 3. 基盤側の不足(帳票を増やす前に要る)

1. **長文・可変行数向けの PDF 経路**。退院サマリー・一括出力・一覧印刷・経過表の前提。
   選択肢は (a) HTML → PDF の gem を足す(Gemfile 変更 = イメージ再ビルド)、(b) カルテ印刷と同じ
   印刷用ビュー + `window.print` を共通部品化する(自院ヘッダ・患者帯・`@page` の部品)。
   サーバー側で PDF を保存する用途(ダウンタイム定時 PDF、文書の原本保管)があるなら (a)。
2. **`report_layouts` に `kind` を足す**。QuestionnaireResponse 以外の帳票も施設が .tlf を差し替えられるようにし、
   同梱 .tlf は既定値に下げる。ラベル用紙サイズの変更要望(`docs/lab-label-design.md` §7-1)もこれで吸収する。
3. **帳票ヘッダの共通化**。自院欄を全帳票へ(テンプレート回答の帳票も)、医師名・記名欄の規約。印影は紙押印のまま。
4. **一覧印刷のエンドポイント 1 種類**(病棟 × 日、または患者 × 期間)。§2.4 と §2.5 の多くがこの上に乗る。
5. **Word / Excel の文書テンプレートの PDF 化は対象外のまま**(手元の Word / Excel で印刷)。LibreOffice 等の変換サーバーは置かない。
   PDF / 画像の様式は §1.1 の 9 のとおり backend(Prawn)で PDF にする。

## 4. 対象外

- 会計系: 受付票・領収書・診療明細書・請求書(レセコンが正本。`docs/receipt-billing-design.md`)。
- ハードウェア依存: 病棟プリンタの指定、印刷枚数の指定、プリンタマスタ、ラベルプリンタ・バーコードリーダ・PDA 連携そのもの
  (`docs/functional-gap-backlog.md` §3)。PDF を新しいタブで開いてブラウザから印刷する運用を続ける。
- 汎用印刷(任意の画面のハードコピー)。ブラウザの印刷で足りる。
- 文書テンプレート(docx / xlsx)のサーバー側 PDF 変換(§3-5)。様式(PDF / 画像)は対象内(§1.1 の 9)。
- 色帯のカラー印刷(ラベル。`docs/lab-label-design.md` §7-4)。プリンタ・用紙が決まるまで保留。

## 5. 着手順の案

既存基盤(ThinReports + 同梱 .tlf)だけで作れるものを先に、基盤 §3-1 が要るものを後に。

1. 予約票(§2.1。毎日渡す紙で必要度が最も高い。ThinReports 1 枚)
2. 麻薬施用票(§2.3。法定帳票。ThinReports 1 枚)
3. 標本ラベル(§2.3。`lab_label.tlf` 流用、標本番号採番と同時)
4. 薬剤情報提供書・薬袋ラベル(§2.1。ラベルは `injection_label.tlf` 流用、情報提供書は医薬品マスタの拡張が先)
5. カルテのカードから処方箋 PDF(§2.3。URL を繋ぐだけ)
6. 基盤 §3-1 を決めた上で、退院時サマリー PDF(§2.2)→ 患者 × 期間の一括 PDF・オーダー控え(§2.5)
7. 基盤 §3-4 の一覧印刷エンドポイント → 入院患者一覧・指示簿・注射実施シート(§2.4、§2.3)→ ダウンタイム定時 PDF
8. 基盤 §3-2 の `kind` 列(施設から .tlf 差し替えの要望が出た時点で)
