# 細菌検査結果の設計メモ

細菌検査(微生物検査)の結果(塗抹・培養・薬剤感受性)の登録・表示。
オーダー側の設計は `docs/micro-order-design.md`、検体検査結果(先行実装)は
`frontend/src/fhir/labResultHelpers.ts` を参照。

項目は JANIS 検査部門フォーマット(検体データ・菌データ・薬剤感受性データ)に
準拠する。菌量・菌数は JANIS の生コードのまま保存し、将来の JANIS 提出ファイル
生成への布石とする。

## 1. リソース構造

検体検査結果と同型の 1 本の transaction Bundle(POST /fhir)。新規は
`urn:uuid` fullUrl + POST、更新は PUT + 外れた Observation を同 Bundle 内で
DELETE。backend は FhirProxyController の中継のみで改修なし。

```
DiagnosticReport (category = v2-0074 "MB" + 入外区分(lab-result-setting)、
                  code = LOINC 18725-2 "Microbiology studies (set)"、
                  status = preliminary(中間報告) | final(最終報告)、
                  basedOn = 細菌検査オーダーのヘッダ ServiceRequest)
 ├ specimen → Specimen ×1 (独立リソース。type = janis-specimen-type、status=available)
 └ result → Observation 群 (category=laboratory、status は report と同値)
     ├ 培養結果      (code=micro-result-item|culture、valueCC negative/positive)
     ├ 塗抹・鏡検所見 (smear、valueString 自由記載)
     ├ 喀痰品質 M&J   (sputum-miller-jones、valueCC P1..M2)   ※実施時のみ
     ├ 喀痰品質 Geckler(sputum-geckler、valueCC 1..6)          ※実施時のみ
     ├ 膿尿評価      (pyuria、method=評価法、valueCC=評価結果) ※実施時のみ
     ├ 分離菌 A〜E 最大5 (isolate、valueCC=janis-organism の写し、
     │                    component: 菌量/菌数/起炎性 ※JANIS 生コード)
     └ 薬剤感受性 菌ごと最大30 (code=[janis-antimicrobial, 略号]、
         derivedFrom=[分離菌 Observation]、method=janis-susceptibility-method、
         valueQuantity=MIC(comparator=仕切法、"=" は省略、unit=µg/mL UCUM)、
         component: 阻止円径(mm)/判定(+)、
         interpretation=v3 ObservationInterpretation の S/I/R)
```

設計判断:

- **感受性 → 分離菌の紐付けは `derivedFrom`**。hasMember(分離菌→感受性)だと
  感受性行の増減のたびに分離菌 Observation の更新が要る。新規時は urn:uuid を
  指し、サーバー側で採番後 id に解決される(オーダーの basedOn 連鎖と同じ)。
  parse は derivedFrom の id で groupBy するだけ。
- **分離菌 A〜E の並びは `DiagnosticReport.result` の参照順**で表現(識別子は
  持たない)。取得時は result 順にソートして復元する。
- **名称はすべて coding.display にマスタの写し**として保存する。編集フォームの
  復元は FHIR リソースだけで完結し、検体検査結果の hydrate(マスタ引き直し)に
  相当する処理は不要。
- **報告区分**: 細菌検査は培養に日数がかかるため、塗抹のみの時点で中間報告
  (preliminary)として保存し、後の編集で最終報告(final)へ切り替える。一覧・
  詳細・カルテカードに「中間」バッジを出す。
- **profile**: DiagnosticReport / Observation の JP_*_LabResult は検体検査用
  プロファイルなので付けない。Specimen のみ JP_Specimen_Common(上流の
  JASPEHR 検証は subject/status 等で通ることを確認済み)。
- **時系列マトリクスは作らない**。細菌検査は「項目×日付」の表にならず、
  レポート単位の内容表示が本体。一覧に材料・培養結果・分離菌名を出して
  経過を追えるようにしている。

## 2. コードシステム(すべて `http://fhir-client.local/CodeSystem/`)

| URI 末尾 | 用途 |
|---|---|
| `micro-result-item` | Observation.code / component.code の種別(culture, smear, sputum-miller-jones, sputum-geckler, pyuria, isolate, colony-quantity-type, colony-count, causative, disk-diameter, susceptibility-grade) |
| `micro-culture-result` | 培養結果 negative / positive |
| `micro-miller-jones` / `micro-geckler` | 喀痰品質評価 |
| `micro-pyuria-method` / `micro-pyuria-result` | 膿尿評価 |
| `micro-colony-quantity-type` | 菌量(JANIS 生コード 1:半定量, 2:定量, 9:その他) |
| `micro-colony-count` | 菌数(JANIS 生コード 1〜8) |
| `micro-causative` | 起炎性 none / present / unknown |
| `micro-susceptibility-grade` | 判定(+) -/+/++/+++ |
| `janis-antimicrobial` | JANIS 抗菌薬コード(新マスタ) |
| `micro-antimicrobial-abbreviation` | 抗菌薬の略号(表示補助) |
| `janis-susceptibility-method` | JANIS 感受性測定法コード(新マスタ) |

菌名は既存 `janis-organism`、材料は既存 `janis-specimen-type`
(microOrderHelpers から export)を再利用。入外区分は検体検査結果の
`lab-result-setting`(labResultHelpers から export)を共有する。

## 3. マスタ

`master_micro_organisms` と同じパターン(official 洗い替え・local 温存・
取込は MasterImportPage)。

- **master_micro_antimicrobials** — JANIS 抗菌薬コード表
  (antimicrobialdrugcode_ver*.xls の「抗菌薬コード一覧」シート)。
  系統見出し行(和名が字下げされていない行)は薬剤として保存せず後続行の
  `category` にする。`frequent`(結果画面に直接並べる頻用薬)は取込で温存、
  初期セットは `db/seed_data/micro_frequent_antimicrobials.csv`。
- **master_micro_susceptibility_methods** — JANIS 薬剤感受性検査測定法コード表
  (drugsusceptibilitymeasurementmethod_ver*.xls の最新版シート)。分類
  (自動化機器/用手法)は見出しセルが空のため「方法」列の右隣を固定で読む。
  30件程度なので頻用フラグは持たない。

最新版シート判定(`latest_version_sheet`)は `MasterImport::ExcelSource` に
共通化し、病原体コード取込と共用する。

## 4. 実装ファイル

- FHIR 変換: `frontend/src/fhir/microResultHelpers.ts`
- 画面: `KarteMicroResultTab`(カルテ「細菌検査」タブ、list/detail/create/edit)、
  `MicroResultForm` / `MicroResultTable` / `MicroResultDetailPanel`、
  検索モーダル `MicroOrganismSearchModal` / `MicroAntimicrobialSearchModal`
  ※フォーム(form 要素)の中に出すモーダルなので form の入れ子を作らない
- クエリ: `frontend/src/api/queries.ts` — `useMicroResultSearch`(category=MB +
  `_include=DiagnosticReport:result` で一覧に培養・分離菌を出す)、
  `useMicroOrderCandidates`(検体検査と共通の `fetchOrderCandidates`)、
  `useCreate/Update/DeleteMicroResult`、`useMicroResultNavigation`
- 初期値復元: `frontend/src/hooks/useMicroResultInitialValues.ts`
- カルテカード連携: `karteTimeline.ts`(micro-order カードに reportId /
  reportStatus)、`KarteTimeline.tsx`(「検査結果表示」+ 中間報告バッジ)、
  `KarteCardModals.tsx`(kind="micro-result" のモーダル)
- マスタ画面: `MicroAntimicrobialPage` / `MicroSusceptibilityMethodPage`

## 5. 未決事項・申し送り

1. **JANIS 提出ファイル生成**: 未着手。患者基本・感染症・抗菌薬投与・デバイス等の
   セクションは結果画面では扱わない(提出時に他ソースから補う想定)。
2. **喀痰品質のその他評価・貪食像の構造化**: JANIS 検体データにはあるが初期実装
   では持たない(塗抹・鏡検所見の自由記載で運用)。
3. **結果の DO**: 結果の複写は臨床的意味が薄いため持たない(オーダー側の DO で足りる)。
4. **耐性菌サーベイランス表示**(同一患者の同一菌の感受性推移): 初期スコープ外。
