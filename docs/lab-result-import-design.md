# 検体検査結果の取込の設計メモ

`docs/lab-backlog.md` §B-1「結果の取込」の設計。検査室の分析装置・LIS・外注ラボから受け取った
ファイルを読み込み、手入力と同じ形で上流に結果を登録する。検体ラベルと到着確認
(`docs/lab-label-design.md` / `docs/lab-arrival-design.md`)で作った Specimen(ラベル番号)を
突き合わせのキーに使う。

調査日: 2026-09-12。**2026-09-23 に実装**(部門業務 > 臨床検査部門 > 検査結果取込、
`/lab-result-imports`)。取り込む形式は JAHIS 臨床検査データ交換規約 Ver.5.0C の
**ORU^R01(ファイル転送型の正式形)と OUL^R22(会話型)**で、CSV は同じ中間表現に後から載せる。

実装にあたって設計から変えた点は次の 3 つ。本文は実装後の形に直してある。

1. **取込元コード対応表(`master_lab_import_item_mappings`)は作らなかった**。JLAC10 / JLAC11 を
   正本に引き当て、保留行で人が選んだときに結果項目マスタの空の JLAC を埋めて育てる(§4)。
   マスタに JLAC が入っていれば施設ごとの対応表を二重に持つ必要がないため。
2. **OUL^R22 にも対応した**。ORU との違いは SPM が群の頭に来るか尻に来るかだけで、同じ
   状態機械に収まる(§3)。
3. サービスの名前空間は `LabImport::`(`app/services/lab_import/`)。モデル `LabResultImport`
   と衝突させないため。

- **［事実］** = HL7 v2.5 / JAHIS 規約の仕様、またはこのリポジトリ・上流の実装で確認した内容
- **［導出］** = 仕様・実装から論理的に導ける内容
- **［提案］** = 本ドキュメントの設計提案

---

## 1. スコープ

1. HL7 v2.5(ORU^R01 / OUL^R22)のファイルを画面からアップロードして読み込む
2. ファイルの JLAC コードを施設の結果項目(`master_lab_result_items`)に引き当てる
3. 引き当てできない行・患者やオーダーを特定できない行を**保留**にし、画面で人が直す
4. 内容を確認してから上流へ登録する。既に結果があるオーダーは既存レポートへの追記(訂正報告)になる

### 含めないもの

- **CSV 形式**。器は同じにする(§6 の中間表現)が、列仕様は取込元が決まってから決める(§9)。
- **取込元ごとのコード対応表**。JLAC を正本にし、マスタを育てる形にした(§4)。
- **分析装置との直結・自動受信**。今回はファイルを人がアップロードする形だけ。
- **外注ラボとのやり取り一式**(依頼の送り出し・未着一覧)。`docs/lab-backlog.md` §B-2。
  結果ファイルの取込はこの器に載る。
- **取込の非同期実行**。backend に ActiveJob の実運用が無く(アダプタ未設定)、1 ファイルは
  数百行なので同期でよい。

---

## 2. 分担: backend は台帳まで、上流への登録は画面から

**［事実］** 検査結果の登録は**すべて frontend にある**。1 本の transaction Bundle を組むのは
`frontend/src/fhir/labResultHelpers.ts` の `buildLabResultBundle` / `buildLabResultUpdateBundle` で、
その中と周辺に次の処理が入っている。

- 基準値の適用と H/L・HH/LL の判定(`matchReferenceRange` / `judgeInterpretation`)、
  適用した基準値の `Observation.referenceRange` への焼き付け
- パニック値の通知 Task(`fhir/labPanicHelpers.ts`。訂正で取り下げ・作り直しも)
- 結果確認(既読)の通知 Task(`fhir/resultReviewHelpers.ts`。最終報告のときだけ、訂正で未確認に戻す)
- 報告区分の遷移(`nextLabReportStatus`。確定済みを編集すると `corrected`)
- `DiagnosticReport.performer`(自院 + ログインユーザー)・`issued`・`Observation.method`
- ラベル Specimen の参照(`planSpecimens`。材料が一致する管は参照だけして書き換えない)

**［事実］** backend が上流に書いている前例は検体ラベルの Specimen 作成
(`app/services/lab_label_report.rb`)だけで、DiagnosticReport / Observation を組むコードは無い。

**［提案］** **backend は取込の台帳まで**(ファイルを受け取り、解析し、項目コードを引き当て、
行の状態を持つ)。**上流への登録は取込画面から既存のフロント経路**(`useCreateLabResult` /
`useUpdateLabResult`)で行う。上の処理が二重に実装されることを避けるため。画面は取込の行から
`LabResultFormValues` を組むだけで、書き込み自体は手入力と 1 本の同じ道を通る。

設計判断: 採らなかった代案。

- **backend で完結させる(Ruby で Bundle を組んで登録まで行う)** — 人の確認を挟まずに装置から
  無人で取り込めるが、上の判定・通知・遷移をすべて Ruby に複製することになる。結果の仕様を
  変えるたびに 2 か所を直すのは割に合わない。**装置からの無人投入が要件になったとき**に、
  フロントの判定ロジックを共有できる形(backend からフロントの登録 API を呼ぶ、または
  判定を上流に持たせる)と合わせて改めて判断する。
- **ファイルを frontend で解析する** — backend を触らずに済むが、文字コード(Shift_JIS /
  ISO-2022-JP)の変換とファイルの保管がブラウザ側になり、取込の履歴・保留の続きが端末に縛られる。
  複数人で処理する運用に向かない。

---

## 3. HL7 v2.5 の読み方

**［事実］** セグメントは改行区切り(CR / CRLF / LF のいずれも来る)、フィールド区切りは MSH-1、
成分 `^` / 繰り返し `~` / エスケープ `\` / 副成分 `&` は MSH-2 で宣言される。1 メッセージに
複数の患者・複数の検査群が入る。

**［事実］** ORU^R01 と OUL^R22 の違いは **SPM が群の頭に来るか尻に来るか**だけ。

    ORU^R01 : ORC → OBR → [NTE] → OBX{ → NTE} → [SPM]
    OUL^R22 : SPM → [SAC] → OBR → ORC → [NTE] → OBX{ → NTE}

**［提案］** 「SPM を見たら次の群のために取っておき、群が開くときに渡す」「群が開いている
ところに来た SPM はその群に付ける」の 2 つで同じ状態機械(`LabImport::Hl7Parser`)に収まる。
OUL は 1 つの検体に複数の OBR が続くので、SPM は次の SPM まで保持する。

読む位置と台帳の列の対応。

| セグメント | 位置 | 取るもの |
|---|---|---|
| MSH | 3 / 4 | 送信アプリ / 送信施設。**取込元**(`source`。4 が空なら 3)|
| MSH | 7 / 9 / 10 / 18 | メッセージ日時 / メッセージ種別 / メッセージ ID / 文字集合 |
| PID | 3 / 5 / 7 / 8 | 患者番号 / 氏名 / 生年月日 / 性別(M・F・O・U)|
| PV1 | 2 | 入外区分(I → 入院、O → 外来)|
| ORC | 2 / 3 | 依頼者オーダー番号 / 実施者オーダー番号 |
| OBR | 2 / 3 | 依頼者オーダー番号 / 実施者オーダー番号 |
| OBR | 4 / 7 / 22 / 25 | 検査(セット)コード / 検体採取日時 / 報告日時 / 結果状態(F・P・C)|
| OBX | 2 / 3 | 値型(NM・ST・SN・CE・CWE・TX)/ 検査項目(コード^名称^体系)|
| OBX | 5 / 6 / 7 | 結果値 / 単位 / 基準範囲(ファイル側のもの。参考表示)|
| OBX | 8 / 11 / 14 | 異常フラグ(H・L・HH・LL・N)/ 結果状態 / 実施日時 |
| SPM | 2 / 4 / 17 | 検体 ID(**ラベル番号の候補**)/ 材料 / 採取日時 |
| NTE | 3 | 直前が OBR なら総合所見、OBX なら項目コメント |

- **候補のまとまり**は ORC / OBR で始まる群(`group_no`)。1 群 = 上流の DiagnosticReport 1 件。
- OBX-11 が `X`(結果なし)・`D`(削除)の行は取り込まず、数だけ `skipped_count` に残す。
- **SPM 直下の OBX は検体の状態**(溶血・乳びなど)で結果ではないので取り込まない。
- MSH だけフィールドの添字が 1 つずれる(MSH-1 が区切り文字そのもの、MSH-18 は `parts[17]`)。
- 分割は**フィールド → 繰り返し → 成分 → 副成分**の順で、エスケープ(`\F\` `\S\` `\T\` `\R\`
  `\E\` `\.br\` `\Xhh\`)を戻すのは葉だけ。先に戻すと `\S\` が成分区切りに化ける。
- 繰り返し `~` を全部使うのは SPM-2(管 ID)・NTE-3・TX の OBX-5 だけ。他は先頭を採る。
- MLLP の枠(`\x0B` … `\x1C`)とバッチの FHS / BHS / BTS / FTS は読み飛ばす。
- **日時はタイムゾーン無しの現地時刻(JST)として読む**(`LabImport::Hl7Time`)。
  `config.time_zone` は未設定(UTC)なので、明示しないと 9 時間ずれる。

### 文字コード

**［事実］** JAHIS 規約 Ver.5.0C の既定は `UNICODE UTF-8`(MSH-18)だが、付録の例文は
`ISO IR87`(ISO-2022-JP)で、実運用では Shift_JIS も来る。Ruby は `CP50221`(ISO-2022-JP +
半角カナ)を組み込みで変換できるので追加の gem は要らない。

**［提案］** 判定の順序(`LabImport::TextDecoder`)。使った名前と**判定根拠**を取込バッチに残し、
画面に出す(ずれたときに原因が分かるように)。

1. 画面で明示指定(UTF-8 / Shift_JIS / ISO-2022-JP)
2. BOM
3. ESC シーケンス(`\e$B` `\e(B` `\e(J`)を含む → CP50221
4. 先頭の MSH を ASCII で覗いて MSH-18(`ISO IR87` → CP50221、`UNICODE UTF-8` → UTF-8)
5. UTF-8 として妥当なら UTF-8
6. CP932

**ISO-2022-JP はすべて 7bit なので「UTF-8 として妥当」に見えてしまう**。3・4 を 5 より先に
置くのが要点。置換文字(U+FFFD)が全体の 1% を超えたら、化けたまま取り込まず
「文字コードを判定できません」で止めて明示指定を促す。

---

## 4. 結果項目の引き当て — JLAC が正本

**［事実］** ファイルの OBX-3 は取込元ごとに違う。JLAC10 の 17 桁で来ることが多いが、装置固有の
コードや施設で決めたコードも来る。施設側の結果項目は `master_lab_result_items.result_item_code`
(施設コード)が本体で、JLAC11 / JLAC10 は属性(readme「検体検査の結果項目マスタ」)。

**［事実］** OBX-3 の体系名(第 3 成分 / 第 6 成分)が `JC10` / `JLAC10` なら JLAC10、
`JC11` / `JLAC11` なら JLAC11。**体系名を付けない装置がある**ので、空で 17 桁の英数字なら
どちらの体系か決められず、JLAC10・JLAC11 の両方の候補に入れる。

**［提案］** 次の順で引き当て、当たった段階を `resolution` に残す(`LabImport::ItemResolver`)。

1. `jlac10_code` の完全一致 → `jlac10`
2. `jlac11_code` の完全一致 → `jlac11`
3. 17 桁の**先頭 12 桁**(測定物 5 + 識別 4 + 材料 3)の前方一致 → `jlac10_prefix` / `jlac11_prefix`

試薬・機器単位のコードは下 5 桁(測定法・結果識別)がマスタの代表コードと違うことが多いので
3 が要る。**どの段階でも複数当たったら先勝ちさせず**、候補を `candidate_item_codes` に残して
保留(`item_ambiguous`)にする。有効期間(`valid_from` / `valid_to`)の外の項目は当てない。

**どれにも当たらない行は保留**(`item_unresolved`)にして、画面で結果項目を選ぶ。そのとき
**「結果項目マスタに JLAC を書き込む」**(既定 ON)で、選んだ項目の空の `jlac10_code` /
`jlac11_code` にファイルのコードを入れる。次回からは 1・2 で自動的に当たる。既に別の値が
入っているときは上書きせず、画面に食い違いを出すだけにする。

設計判断: **取込元ごとのコード対応表(`source` + 外部コード → 結果項目)は作らなかった**。
JLAC は施設をまたいで同じ意味を持つ標準コードなので、対応表を施設ごとに育てるより、
結果項目マスタの JLAC を埋める方が 1 か所で済む。装置固有コードしか来ない取込元が出てきたら、
そのときに対応表を足す(引き当ての段の 0 番目に入れるだけで済む形にしてある)。

**値の検証**も引き当てと同じ場所で行う。

- **コード型**(データ型 CD / CO)は OBX-5 のコード → 表示名の順で `code_value_list` に照合し、
  当たれば値をコードに正規化する。外れたら結果項目を保ったまま保留(`value_unmatched`)にし、
  画面の選択肢から選び直す。選択肢に無い値を文字列で入れると時系列表示や判定が壊れるため。
- **数値型**(PQ)に数値でない値(SN の `<5` など)が来たら保留(`value_not_numeric`)。
  そのまま登録すると `valueQuantity` が NaN になる。画面で値を直すと、その場で判定し直す。

---

## 5. データモデル(backend)

取込バッチと行は施設マスタではなく作業データなので `master_` を付けず、
オーダーセット(`order_sets`)と同じく素のテーブルにする。

### `lab_result_imports`(取込バッチ)

| 列 | 内容 |
|---|---|
| `source` | 取込元(MSH-4、空なら MSH-3)|
| `format` | `hl7_v25`(将来 `csv`)|
| `message_type` | `ORU^R01` / `OUL^R22` |
| `encoding` / `encoding_reason` | 実際に使った文字コードと判定根拠(§3)|
| `file_name` | |
| `message_control_id` / `message_datetime` | MSH-10 / MSH-7 |
| `imported_by_login_id` / `imported_by_practitioner_id` | 取り込んだ人(認証なし運用では空)|
| `row_count` / `skipped_count` | 行数 / OBX-11 が X・D で読み飛ばした数 |

index: `created_at`、`source`、`message_control_id`。

### `lab_result_import_rows`(OBX 1 件 = 1 行)

ヘッダ(患者・オーダー・検体)は**行に非正規化して持つ**。保留になる単位は行(項目)で、
候補のまとまりは `group_no` で復元できるため、レポート候補のテーブルを別に作る必要がない。
訂正で同じ患者・同じ日の結果が繰り返し来るので、行の独立性が高い方が扱いやすい。

- 位置: `lab_result_import_id` / `group_no`(ORC・OBR 群の連番)/ `sequence`(ファイル内の行順)
- 患者: `patient_number` / `patient_name` / `patient_birth_date` / `patient_sex` / `setting`
- オーダー・検体: `placer_order_number` / `filler_order_number` / `specimen_ids`(SPM-2 の全部) /
  **`label_number`**(SPM-2 → OBR-2 → ORC-2 の順で、最初に見つかった 11 桁 + チェックデジット一致) /
  `specimen_material_code` / `specimen_material_name` / `collected_at` / `reported_at` /
  `report_status` / `report_comment`
- 結果: `external_code` / `external_name` / `external_code_system` / **`jlac10_code` / `jlac11_code`**
  (再引き当てを再パース無しで回すため列に持つ)/ `value_type` / `value` / `value_text` /
  `value_code_system` / `unit` / `reference_range` / `abnormal_flag` / `observation_status` /
  `observed_at` / `note`
- 引き当てと状態: `result_item_code` / `resolution`(`jlac10` / `jlac11` / `jlac10_prefix` /
  `jlac11_prefix` / `manual`) / **`status`**(`pending` 保留 / `ready` 登録待ち /
  `skipped` 取り込まない / `registered` 登録済み) / `pending_reason`(`item_unresolved` /
  `item_ambiguous` / `value_unmatched` / `value_not_numeric`) / `candidate_item_codes` /
  `patient_fhir_id` / `order_fhir_id` / `report_fhir_id` / `registered_at` / `registered_by_practitioner_id`

index: `[lab_result_import_id, group_no, sequence]`、`[lab_result_import_id, status]`、
`[lab_result_import_id, external_code]`、`label_number`、`report_fhir_id`。
他のマスタと同じく外部キーは張らず、バッチ削除時に行も消す。

---

## 6. サービス構成(backend)

`app/services/lab_import/` に置く(モジュール `LabImport::`。モデル `LabResultImport` と
名前が衝突しないように、設計時の `lab_result_import/` から変えた)。

| ファイル | 役割 |
|---|---|
| `text_decoder.rb` | §3 の文字コード判定と UTF-8 への変換 |
| `hl7_tokenizer.rb` | セグメント分割、区切り文字の取り出し、エスケープ復元 |
| `message.rb` | **中間表現**。`Root(source, message_type, control_id, sent_at, reports[])` / `Report(患者, 番号, specimens[], collected_at, status, comments[], observations[])` / `Observation(code, name, jlac10, jlac11, value…)`。CSV パーサを足すときも同じ型を返す |
| `hl7_parser.rb` | セグメント列 → `Message`。§3 の状態機械 |
| `hl7_time.rb` | HL7 の TS を JST として `Time` / `Date` に |
| `label_number.rb` | 11 桁 + M10W3 チェックデジットの検証と、候補からの選択 |
| `row_builder.rb` | 中間表現 → 行の属性(ヘッダの非正規化、ラベル番号の選択)|
| `item_resolver.rb` | §4 の引き当てと値の検証。コードをまとめて 1 回ずつ引く |
| `importer.rb` | 上をつないで `LabResultImport` と行を作る。`PARSERS = { "hl7_v25" => Hl7Parser }` |

- **ラベル番号の検証は backend に無かった**。採番が上流に移った際に `lab_label_numbers` ごと
  消えており(`docs/lab-arrival-design.md` §6-1)、M10W3 の計算は frontend の
  `fhir/labSpecimenHelpers.ts` の `isValidLabelNumber` だけなので、同じ計算を `label_number.rb` に持つ。
- マスタ取込の `Master::Importable` / `MasterImport::CsvImporter` は**使わない**。あちらは
  「全件を消して入れ直す」前提で、行ごとの状態を残す取込とは器が違う。
- 解析中の例外は `LabImport::ImportError`(`MasterImport::ImportError` を継承)にまとめ、
  `Master::BaseController` の `rescue_from` で 422 になる。

---

## 7. API

`namespace :master` に置く(マスタ画面と同じ認証・CSRF・エラー整形に乗るため。
オーダーセットと同じ理由)。

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/master/lab_result_imports` | 取込。multipart で `file`、`encoding`(`auto` 既定)、`format` |
| GET | `/master/lab_result_imports` | バッチ一覧(新しい順、状態別の件数付き)|
| GET | `/master/lab_result_imports/:id` | バッチ + 全行(`group_no`, `sequence` 順)+ 同じメッセージ ID のバッチ |
| POST | `/master/lab_result_imports/:id/resolve` | 保留行の引き当てをやり直す(マスタを直した後)|
| DELETE | `/master/lab_result_imports/:id` | バッチと行を消す |
| PATCH | `/master/lab_result_import_rows/:id` | 行の更新 |
| PATCH | `/master/lab_result_import_rows/bulk_update` | `ids[]` に同じ更新(候補単位の書き戻し)|

- 行の更新で受け取るのは `result_item_code` / `status`(`pending` ⇄ `skipped`)/ `value` /
  `patient_fhir_id` / `order_fhir_id` / `report_fhir_id` / `write_to_master` / `apply_to_same_code`。
- `result_item_code` を入れたら `resolution = manual` にし、値の検証を通してから `ready` にする。
- `write_to_master` が真なら結果項目マスタの**空の JLAC** を埋める。既に別の値なら書かず
  `master_conflict: true` を返す。
- `apply_to_same_code` が真なら、**同じバッチ内で外部コードと体系が同じ**保留行にも同じ
  結果項目を入れる(1 ファイルに同じ項目が何十行も入るため)。体系も条件に入れるのは、
  別体系の同じコードを巻き込まないため。
- `value` だけを直した行は、結果項目が決まっていればその場で検証し直して保留を外す。
- `report_fhir_id` を入れたら `status = registered` にし、登録者と時刻を残す。
- 応答は**更新した全行**。1 行の操作が他の行にも及ぶので、画面はこれでキャッシュを差し替える。
- 再引き当て(`resolve`)は人が手で選んだ行(`resolution = manual`)を上書きしない。

---

## 8. 画面(frontend)

### 8-1. 検査結果取込(部門業務 > 臨床検査部門 > 検査結果取込、`/lab-result-imports`)

上にアップロード(ファイル選択 + 文字コードの選択。`pages/MasterImportPage.tsx` と同じ形)、
下にバッチ一覧(取込日時・取込元・ファイル名・文字コード・件数(保留 / 登録待ち / 登録済み /
対象外)・削除)。取り込むと詳細へ移る。

### 8-2. バッチの詳細(`/lab-result-imports/:id`)

**レポート候補**(`group_no`)1 件 = 1 カード。カードの見出しに患者(番号・氏名・生年月日)、
採取日、材料、ラベル番号、報告区分、紐付け先のオーダー、既存結果の有無を出す。
同じメッセージ ID のバッチが他にあれば、見出しの上で知らせる(取込は止めない)。

**患者とオーダーの解決**は次の順(`hooks/useLabImportGroupContext.ts`)。

1. 行に `order_fhir_id` が入っていれば、それを使う(人が選んだ後)
2. **ラベル番号**から `Specimen?accession=` で管を引き、その `request` のオーダーを使う
   (`fetchLabelSpecimenByNumber` / `fetchLabArrivalContext`)。
   **その管がファイルの患者番号と違う患者のものなら採らない**(番号の取り違えや採番のずれで
   他の患者の結果を登録してしまわないように)。画面に理由を出して 3 へ進む
3. **患者番号 + 採取日**で患者を引き、その日の検体検査オーダーを候補に出す。0 件なら
   「オーダーに紐付けずに登録」、1 件なら自動で選び、複数なら選ばせる
4. 患者も引けなければ保留(患者番号の対応が付いていないファイル)

**行のテーブル**: 外部コード・名称 → 結果項目(保留は赤字。ボタンで結果項目の検索モーダルを開く)、
値・単位、ファイルの基準値と異常フラグ(参考)、**登録する判定**、コメント、対象外にする操作。
値で保留になった行は、その場で選択肢から選ぶ / 数値を打ち直せる。

- **H/L は施設の基準値で付け直す**。結果項目に基準値があれば `matchReferenceRange` +
  `judgeInterpretation` で判定し(パニック値なら HH / LL)、基準値が無ければファイルの OBX-8 を
  写す(`>` → H、`<` → L。N / A / AA は判定なし)。施設の基準値が正本で、
  `Observation.referenceRange` に焼き付くのもそちらのため(readme「基準値と H/L の自動判定」)。
  ファイルの基準範囲(OBX-7)は参考として画面に出すだけで保存しない。
- **登録**は候補ごとのボタンと全件一括の 2 つ。候補の行が全部 `ready` か `skipped` になっていて、
  患者が決まっていることが条件。
  - そのオーダーに結果がまだ無ければ新規登録(`useCreateLabResult`)。
  - 既にあれば既存レポートを読み込んで項目を差し替え・追加し、更新(`useUpdateLabResult`)。
    確定済みのレポートを更新すると保存時に**訂正報告**(`corrected`)になり、確認の通知も
    未確認に戻る(readme「報告区分」「検査結果の確認」)。
  - 報告区分はファイルの OBR-25 から、`P` → 中間報告、`F` / `C` → 最終報告。
    OBR-25 が無ければ OBX-11 が全部 `P` のときだけ中間報告にする。
  - パニック値の通知の宛先は紐付けたオーダーの依頼医(手入力と同じ)。
  - 全件一括は候補を**逐次**処理し、失敗した候補は理由を残して残りを続ける。
    1 候補で上流に 3〜4 回書き込むため。
- 登録が終わったら、その候補の行に `report_fhir_id` を書き戻して `registered` にし、
  カードからカルテへのリンクを出す。

### 8-3. 実装メモ(流用した既存部品)

- 登録: `api/queries.ts` の `useCreateLabResult` / `useUpdateLabResult`(中で
  `buildLabResultBundle` / `buildLabResultUpdateBundle` を呼ぶ)。既存レポートの読み込みは
  `fetchLabResultDetail` + `parseLabResultForm` + `hydrateLabResultForm`、
  既存 Specimen は `specimenRefsFrom`。
- 判定: `fhir/labResultHelpers.ts` の `matchReferenceRange` / `judgeInterpretation` /
  `lineKeyOf`(行の突き合わせ)/ `parseCodeValueList`(選択肢)/ `labResultSubjectOf`。
- 検体・オーダー: `fetchLabelSpecimenByNumber` / `fetchLabArrivalContext` /
  `fetchLabOrderCandidates` / `fetchPatientByNumber`、`fhir/labSpecimenHelpers.ts` の
  `isValidLabelNumber` / `specimenOrderIdOf`。
- 画面部品: `components/LabResultItemSearchModal.tsx`(結果項目の選択)、`components/Modal.tsx`、
  `components/ErrorBanner.tsx`、`pages/MasterImportPage.tsx`(アップロード)。
- `DiagnosticReport.performer` に自院とログインユーザーを入れる処理は、もともと
  `components/LabResultForm.tsx` の副作用の中にしかなかった。取込でも同じ値が要るので
  `hooks/useLabResultPerformerDefaults.ts` に切り出して両方から使う。
- 取込固有の変換は `fhir/labImportHelpers.ts`(行 → `LabResultFormValues`、判定の付け直し、
  既存レポートへのマージ)。

---

## 9. 未決事項・申し送り

1. **CSV 形式の列仕様**。取込元(装置・外注ラボ)が決まってから決める。パーサを 1 本足すだけで
   済むように中間表現(§6 の `message.rb`)を形式非依存にしてある。
2. **同じファイルの再取込**。メッセージ ID が同じバッチがあれば画面で知らせるが、取込は止めない
   (訂正版が同じ ID で来ることがあるため)。二重登録は「既に結果があるオーダーは追記になる」
   ことで防ぐ。
3. **登録済みの行を含むバッチの削除**。許す。台帳は作業キューで、登録した結果は上流にある。
4. **1 つの検査群に複数の管(SPM)があり、別オーダーのラベル番号が混ざる場合**。最初に見つかった
   有効な番号でオーダーを決め、残りは画面に出すだけにする。運用で起きるようなら分割を考える。
5. **到着していない検体の結果が来たとき**。いまは何もしない(結果登録と到着の接続は
   `docs/lab-arrival-design.md` §6-4 で保留のまま)。検査室の運用が固まってから、
   「未到着の管の結果です」と画面に出すか、到着済みに進めるかを決める。
6. **外注(B-2)**。外注ラボの結果ファイルもこの器で取り込む。取込元が外注先 Organization に
   対応するので、`source` から実施施設(`DiagnosticReport.performer`)を引けるようにするのが
   そのときの追加になる(いまは自院とログインユーザーが入る)。
7. **装置固有コードしか来ない取込元**。そのときは取込元ごとのコード対応表を引き当ての
   0 番目に足す(§4 の設計判断)。
8. **入外区分の食い違い**。オーダーの区分を優先し、ファイルの PV1-2 は
   オーダーに紐付けないときだけ使う。
7. **取込の履歴の保持期間**。行が溜まり続けるので、登録済みのバッチを一定期間で消す掃除を
   入れるかどうか。運用の量を見てから。
