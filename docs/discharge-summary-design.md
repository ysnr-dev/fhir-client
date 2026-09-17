# 退院時サマリー(退院時要約)と文書作成の督促の設計

**状態: 第 1 段を実装済(2026-09-17)。** PDF(第 2 段)は未着手。

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 器の判断: テンプレートに寄せるか、診療記録に寄せるか

［事実］診療情報提供書・入院診療計画書はテンプレート(`Questionnaire` + ThinReports)で帳票化してある。
一方で退院時サマリーは「入院期間のデータを集めて書く」文書で、テンプレートのプリフィルは
`%patient / %conditions / %labResults(最新 1 件) / %prescriptions(最新 1 件)` の 4 変数だけ
(`fhir/populateContext.ts`)。入院も `Encounter` も見ない。項目型に `reference` が無く(JASPEHR 制約)、
署名(`attester`)も変更履歴の画面も無い。

［事実］診療記録(`Composition`)は確定・署名・修正済み・`_history` の履歴表示・リッチテキスト・
セクションへのテンプレート埋め込み(`SECTION_QR_EXT_URL`)・プロブレム紐付け(`entry` 検索)が揃っている。
他科依頼回答が「type コードを足して新しい文書種別を作った」前例(`CONSULT_NOTE_TYPE`)。足りないのは PDF だけ。

［導出］**診療記録の器で作り、テンプレートは施設独自の項目の受け皿としてセクションに埋め込む。**
新しい文書基盤は作らない。PDF は処方箋・注射箋と同じ「FHIR から直接描く専用レンダラ」で第 2 段に作る。

## 2. Composition の形

- `type` = LOINC `18842-5` Discharge summary(`DISCHARGE_SUMMARY_TYPE`)。`KARTE_NOTE_TYPE_SEARCH` に含めてある
  (含めないと保存されてもカルテに出ない)。
- `encounter` = 対象の入院。**Composition.encounter の初使用**。上流は `encounter` 検索対応済み
  (`fhir-server/app/lib/fhir/search_definitions/composition.rb`)。1 入院 1 件を
  `Composition?type=…|18842-5&encounter=Encounter/{id}` で守る(`useDischargeSummaryFor`)。
- `status` / `attester` / `author` / `date` / 診療科拡張は診療記録と同じ(`buildAttester` を共用)。
- `title` は「退院時サマリー」固定。

### 2.1 セクション(固定順、`SUMMARY_SECTIONS`)

| LOINC | 見出し | 種類 | 初期値 |
|---|---|---|---|
| 11535-2 | 退院時診断 | entry(Condition) | プロブレムのうち入院期間にかかるもの(active または発症〜転帰が期間と重なる)を選択済みで、他は候補 |
| 8648-8 | 入院経過 | text | 入院イベント(入院・転棟・転床・外泊・退院)+ 実施済の手術を日付順の箇条書き |
| 47519-4 | 手術・処置 | entry(ServiceRequest) | 期間内の手術・処置・内視鏡のオーダー。実施記録(Procedure)があるものを選択済み |
| 30954-2 | 主な検査所見 | text | 期間内に実施した放射線・内視鏡・生理・病理の名前と日付を箇条書き。値は医師が書く |
| 10183-2 | 退院時処方 | entry(MedicationRequest) | 処方区分「退院」(`prescription-category\|discharge`)の薬剤。全部選択済み |
| 10184-0 | 退院時の状態 | text | 空 |
| 18776-5 | 退院後の方針 | text | 空 |
| 48765-2 | アレルギー | entry(AllergyIntolerance) | 有効なアレルギー(inactive / resolved / refuted を除く)。全部選択済み |

- entry セクションの `text.div` は選んだ参照の表示名から生成して焼き付ける(`status: generated`)。
  参照解決なしでカード・詳細・履歴が描けるように。選択が無ければ「なし」と残す(書き忘れではなく、
  確認したうえで無かったことが読めるように)。
- text セクションは `buildBodySections`(診療記録から切り出した共通関数)で組む。空なら出さない。
- プロブレムセクション 11450-4 は持たない。退院時診断の `entry` が R4 標準の `entry` 検索に乗るので、
  プロブレムの絞り込みは自動で効く。

### 2.2 転帰(退院先)

標準要素 `Encounter.hospitalization.dischargeDisposition`(値は HL7 discharge-disposition のうち
home / other-hcf / snf / hosp / aadvice / exp / oth)。退院モーダルの任意欄と、サマリーの転帰欄の
どちらからも書ける。サマリーの保存で変えたときは同じ transaction で `Encounter` を PUT する
(上流の `EncounterValidator` は status と class しか見ない)。

## 3. 集約の方法

［事実］オーダー・記録は `Encounter` を参照していない(参照するのはパスの CarePlan・食事・看護指示・
処方の一部だけ。`applyOrderContext` は `order-ward` 拡張しか書かない)。

［導出］集約は**患者 + 入院期間の日付範囲**で行う(経過表と同じ手段)。範囲は `period.start` 〜
`period.end ?? 今日`。`useDischargeSummarySources` が 1 か所で引く:
入院イベント(`encounterEvents` + `withEventWards`)、病名(全件)、
オーダー(`category` = surgery/treatment/endoscopy/rad/physio/pathology、`based-on:missing=true`、
`occurrence` の範囲、`_revinclude:iterate=ServiceRequest:based-on`、`_revinclude=Procedure:based-on`)、
退院処方(`category=prescription-category|discharge`、`_revinclude=MedicationRequest:based-on`)、アレルギー。

「下書きを集め直す」(`draftDischargeSummaryForm(sources, existing)`)は候補だけを集め直し、
書いた本文と選択状態は残す。既存に無くなった参照(削除された病名など)は、選択されていれば残す。

## 4. 画面

- 入口: カルテ右ペインの「退院時サマリー」(登録ボタン列の一番下)。`KartePaneState` の `summary-create` /
  `summary-edit`。通知と入院患者一覧(退院患者の操作メニュー)からは `?open=discharge-summary:<入院 id>`
  で開く。一回限りの引数で、`KartePage` が読んだら URL から消す(フォームを URL に載せない方針と両立)。
- 対象の入院の選択: `Encounter?subject&class=IMP&status=in-progress,finished&_sort=-date`
  (`usePatientAdmissions`)。既定は「今の入院」、無ければ最新の退院。**入院中でも書ける**。
  既にあれば編集に切り替える。
- フォーム(`DischargeSummaryForm`): 入院情報の帯 + 転帰 + 記録日時 + ステータス、下に 8 セクション。
  本文セクションの編集部品は診療記録と共用(`NoteSectionsEditor`。モーダルを `<form>` の外に置くために
  フック `useNoteSectionsEditor` が sections / items / modals を分けて返す)。
- カード: kind は `note` のまま(取得クエリも共通)。バッジは「退院時サマリー」。左ペインの種別は
  「診療記録」「退院時サマリー」に分かれる(`KarteCardFilter.noteType`、URL は `note:discharge-summary`)。
  詳細パネルには入院情報の帯を足してある。

## 5. 文書作成の督促(通知 Task `document-due`)

［事実］定期実行の主体がシステムに無い(backend にも上流にも job/cron が無い。上流の唯一の cron は
GitHub Actions の purge)。通知の器には `restriction.period.end`(`dueDate`)が定義済みで未使用だった。

［導出］**退院の transaction で期限付きの Task を作り、期限超過は表示時に判定する。** N 日後に
サーバーが何かをする必要が無い。既存 5 種別と同じ「事象を書く transaction に entry を足す」形。

- `code` = `document-due`「文書作成」。文書種別は `input`(`文書` = `discharge-summary`)で持つので、
  将来の返書やパス終了の督促も同じ種別に載る。
- `focus` と `encounter` = `Encounter/{id}`(上流の Task は `encounter` 検索対応)。`owner` = 入院の主治医
  (`Encounter.participant[ATND]`)。無ければ宛先なし。`dueDate` = 退院日 + 施設設定
  `document_reminder.discharge_summary_days`(既定 14)。強度は info。

| 事象 | 場所 | Task |
|---|---|---|
| 退院 | `useDischargePatient` の `extraEntries`(`DischargeModal` が組む) | 作成。確定済みサマリーがある入院、requested の同 Task がある入院には作らない |
| 退院取消 | `InpatientPlanTables` の `handleCancel`(`documentDueCancelEntries`) | cancelled |
| サマリーを確定(final / amended)で保存 | `useSaveDischargeSummary` | completed(note「文書を作成しました。」)。下書き保存では閉じない |
| 通知一覧の「対応済」 | 既定の completed PUT | 手で閉じる(サマリー不要の入院向け) |

- 通知一覧の内容セル: 対象日 = 退院日、「退院時サマリー 未作成(期限 MM-DD)」。期限を過ぎていれば
  「期限超過 n 日」を赤で併記(`documentDueRowOf` が今日と比べる。priority は変えない)。

## 6. 第 2 段: PDF(未着手)

- backend `Reports::DischargeSummaryReport` + `reports/discharge_summary_renderer.rb` + 同梱 `.tlf`
  (処方箋 `prescription_renderer.rb` と同じ「FHIR から直接描く」前例)。ルート
  `GET /reports/discharge_summaries/:composition_id/pdf`。
- 描く内容: 患者メタ・入院情報(日付・診療科・主治医・転帰)・各セクションの見出しと本文
  (XHTML → プレーンテキスト)・埋め込みテンプレート回答。長文の改ページは ThinReports のリストで行う
  (ここが実装上のリスク)。
- フロント: `reportsClient.ts` に URL を足し、カードの PDF ボタンを `note` かつ type 18842-5 のときに出す。

## 7. 検証(2026-09-17、Docker 環境)

- 入院患者一覧から「入院 三郎」を退院(転帰「自宅」)→ 上流に `document-due` Task
  (owner = 主治医、`restriction.period.end` = 退院日 + 14 日、`encounter` あり)と
  `Encounter.hospitalization.dischargeDisposition` = home が入ることを REST で確認。
- 通知一覧に「文書作成 / 退院時サマリー 未作成(期限 2026-10-01)」が出て、「カルテ」で
  `?open=…` からカルテが開き、右ペインがその入院のサマリーで始まり URL から引数が消えること。
  下書きに入院情報・転帰「自宅」・入院経過の箇条書き・退院時処方が入ること。
- 確定で保存 → カード(バッジ「退院時サマリー」)が出て、Task が completed、`attester` が付き、
  `encounter` と各セクションの `entry` が期待どおりであること。ベルの件数が 1 減ること。
- もう一度「退院時サマリー」→ 編集に切り替わること。左ペインの種別「退院時サマリー」で絞れ、
  「診療記録」では出ないこと。詳細モーダルに入院情報の帯が出ること。
- `Task?code=document-due&encounter=…` の検索が効くこと(退院取消・確定保存が使う)。
- backend spec(`facility_settings`)と `tsc -b` が通ること。
