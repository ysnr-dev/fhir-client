# 放射線治療オーダーの設計

**状態: 第1段階(依頼の補強・施設固有マスタ・治療処方・部門一覧)と第2段階(照射記録・累積線量・
休止)を実装済(2026-09-21)。** 治療終了サマリー・週次レビュー・計画 CT・予約・会計は後続フェーズ
(§6)で、この文書では構造だけを定める。

他科依頼(`docs/consult-order-design.md`)とリハビリ(`docs/rehab-order-design.md`)を雛形にした。
同じところはそちらを参照し、違うところだけをここに書く。

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 他のオーダーとの違い = 「オーダー画面に照射条件を全部入れる」にしない

［事実］放射線治療は、依頼医が治療を依頼し、放射線治療医が診察して方針と線量を処方し、治療計画
装置で計画を作り、承認・QA のあと数週間かけて照射する、という長い流れ。IHE-RO も Treatment
Management System / Treatment Planning / Treatment Delivery を別のアクターとして整理している。

［導出］**「依頼」「治療処方」「治療計画」「照射実績」を同じデータにしない。**

| 段階 | 誰が | このアプリでの器 | 段階 |
|---|---|---|---|
| 依頼 | 臨床医 | 他科依頼(既存)＋放射線治療依頼テンプレート(§1.2) | 第1 |
| 治療処方(Course / Phase / 標的別線量) | 放射線治療医 | **放射線治療オーダー**(ServiceRequest。§2) | 第1 |
| 治療計画(輪郭・ビーム・MU・DVH) | 物理士・治療計画装置 | **持たない**(DICOM RT の領域。§1.3) | - |
| 照射実績(1 回ごと) | 診療放射線技師 | Procedure(§6.1) | 第2 |
| 経過・有害事象 | 放射線治療医 | Observation(CTCAE。§6.3) | 後続 |
| 終了サマリー | 放射線治療医 | Procedure(Course Summary。§6.2) | 後続 |

［導出］依頼医に「60 Gy / 30 回、VMAT」を入れさせない。依頼医が決めるのは「何を相談したいか」
までで、線量と技法は放射線治療医の処方で決まる。

### 1.1 命名

［事実］`rad` は放射線**検査**のオーダー種別として既に使われている(`order-type|rad`、
`RadOrderForm`、`rad-order`)。JJ1017 頻用コードの区分には `radiotherapy` が既にある
(`master_rad_jj1017_frequent_codes.category`)。

［導出］治療は **`radiotherapy`** で統一する。オーダー種別 `order-type|radiotherapy`、カルテの種別
`radiotherapy-order`、Task コード `task-code|radiotherapy`、ファイル接頭辞 `radiotherapy` /
`Radiotherapy`。`rt` のような略語は使わない(`rad` と並ぶと読み違える)。

### 1.2 依頼は他科依頼でまかなう

［事実］他科依頼の依頼先は上流の Organization(診療科)で、自由に登録できる。SS-MIX2 統一診療科
コード表 V1.0 には **3 ケタ科の `30B 放射線治療科`**(親は `30 放射線科`)があるので、`/departments`
から登録すれば依頼先の候補に出る。受け手は他科依頼一覧で自分の科あての依頼を見て、回答を診療記録で
返す。この流れは放射線治療の診察依頼にそのまま当てはまる。

［事実］原典は「2 ケタ科ないし 3 ケタ科のいずれかの値を使用する。両者が混在しても構わない」と
している。［実装］`departmentCodes.ts` は 2 ケタ科 87 件に加えて 3 ケタ科 233 件を持ち、登録画面では
親の 2 ケタ科で束ねて選ばせる。一括登録の対象は 2 ケタ科だけ(3 ケタ科は施設が実際に持つ科だけを選ぶ)。

［導出］依頼専用のオーダー種別は作らない。足りなかった 3 点だけを補った。

1. **放射線治療依頼テンプレート**(`docs/report-mappings/consult-purpose-radiotherapy-01.md`)。
   原発部位・治療対象部位・左右・治療目的・臨床情報・併用治療・**過去の放射線治療歴**・注意事項・
   希望開始時期を構造化する。他院での照射歴はここが唯一の入口。
2. **依頼先の科ごとの既定テンプレート**(施設設定 `consult_default_templates`。
   `docs/consult-order-design.md` §8)。依頼先に放射線治療科を選ぶと上のテンプレートが開く。
3. **依頼 → 治療処方の紐付け**(§2.5)。

［事実］他科依頼には受け手への通知(通知 Task)と予約連携が無い。気づきの手段は他科依頼一覧だけ。
これは他科依頼全体の課題で、放射線治療に限らない(§8)。

### 1.3 治療計画装置・部門システム(OIS)との境界

［提案］OIS が無くても回る形にする。電子カルテ側が持つのは治療処方と、後続フェーズの照射記録
(法定の照射録の項目＋線量・回数)まで。GTV/CTV/PTV の輪郭、ビーム、エネルギー、MU、
アイソセンタ、MLC、線量分布、DVH は持たない。これらは DICOM RT(RT Structure Set / RT Plan /
RT Dose / RT Treatment Record)の領域で、IHE-RO(BRTO-II・TPPC・TDW-II)が装置間の連携を定めている。

［提案］将来 OIS と連携するときの境界は **照射記録の Procedure と Course Summary の Procedure**。
OIS が照射のたびに §6.1 の形で Procedure を書けば、画面側は手入力と同じデータとして扱える。
治療処方(ServiceRequest)は電子カルテが正本のままにする。

---

## 2. FHIR の構造

```text
ServiceRequest(治療処方 = Course 1 件。明細は持たない)   intent=order
  status    active(処方済・計画中・治療中)| completed(終了)| revoked(中止)   ※ §4
  category  order-type|radiotherapy ＋ prescription-setting|inpatient/outpatient
  code      radiotherapy-order|course-prescription「放射線治療処方」
  occurrenceDateTime  開始予定日(照射初日の予定。日付のみ)
  authoredOn          登録日時
  requester           処方医 ＋ order-department / order-ward(applyOrderContext)
  performer           [Practitioner 担当医](任意。無ければ処方医が担当)
  reasonReference     対象プロブレム(Condition)
  bodySite[]          標的の部位の写し(jj1017p ＋ jj1017-laterality ＋ text)
  note                コメント
  extension
    radiotherapy-course
      courseNumber:integer  intent:Coding  concurrentTherapy:Coding  protocol:Coding
      endedOn:date  terminationReason:Coding  terminationNote:string      ← §4 が書く
    radiotherapy-volume ×N
      volumeId:string  label:string  type:Coding(GTV/CTV/ITV/PTV/other)
      bodySite:CodeableConcept  description:string
    radiotherapy-phase ×N
      phaseId:string  number:integer  label:string  status:code(active|revoked)
      modalityAndTechnique { modality:CodeableConcept  technique:CodeableConcept }
      device:CodeableConcept  fractionsPrescribed:unsignedInt  fractionsPerWeek:integer
      dosePrescribedToVolume ×M { volume:string(volumeId)  fractionDose:Quantity(Gy)  totalDose:Quantity(Gy) }
    radiotherapy-consult-request   valueReference → ServiceRequest(他科依頼)＋ display
  ←focus── Task  code=task-code|radiotherapy(部門の進捗。§4)
```

拡張の URL はすべて `http://fhir-client.local/StructureDefinition/` 配下。実装は
`frontend/src/fhir/radiotherapyOrderHelpers.ts`。

### 2.1 Phase を子の ServiceRequest にしない

［事実］CodeX RT IG は Course Prescription と Phase Prescription を別の ServiceRequest にし、Phase が
`basedOn` で Course を指す。一方このアプリは「`basedOn` を持たない ServiceRequest = オーダーのヘッダ」
を至る所で前提にしている(`provenanceHelpers.ts` の `isHeaderEntry`、部門一覧の
`based-on:missing=true`、退院時サマリーの収集。`docs/chemo-regimen-design.md` §7.1)。

［導出］Phase は **ヘッダの中の複合拡張**にする。Phase は 1〜3 件、標的は 1〜4 件と小さく、Phase を
単独で検索する要件も無い。編集が PUT 1 本で済み、リハビリ・他科依頼の「ヘッダ 1 本型」の雛形
(詳細・JSON・DO・オーダーセット)がそのまま使える。CodeX の形へは輸出時に展開できる(§2.6)。

### 2.2 標的(Volume)を分ける

［導出］線量は「Phase × 標的」で決まる。標的を Phase の外に出して `volumeId` で指すことで、

- **SIB**(同時ブースト) … 1 つの Phase に標的行を複数置き、1 回線量だけ変える(回数は共通)
- **Boost** … Phase 2 に Boost の標的だけを置く
- **コース合計** … 標的ごとに全 Phase を足す(`radiotherapyVolumeTotals`)

が同じ構造で表せる。「総線量 60 Gy・30 回」の 2 項目だけでは Boost と SIB が書けない。

［事実］上流に BodyStructure が無い(mCODE の Radiotherapy Volume は BodyStructure)。
［導出］標的は拡張の中に持つ。ヘッダの `bodySite[]` は標的の部位の写しで、過去コースとの部位の
突き合わせ(§5.3)に使う。

### 2.3 volumeId / phaseId は安定キー

［提案］後続の照射記録は「どの Phase の何回目で、どの標的に何 Gy」を `phaseId` / `volumeId` で指す
(§6.1)。そのため**編集では保ち、DO では振り直す**(`buildDoRadiotherapyOrderForm`。別のコースの
照射記録が同じキーを指さないように)。治療が始まった処方では、画面から標的・Phase を消せなくしてある
(`RadiotherapyOrderForm` の `lockStructure`。§8)。

### 2.4 線量

［提案］単位は **Gy**(UCUM `Gy`)。日本の臨床での書き方に合わせた。mCODE は cGy なので輸出時に ×100。
総線量は 1 回線量 × 分割回数の派生値で、入力させず保存時に計算して焼く。1.8 × 28 が浮動小数の
誤差で 50.400000000000006 にならないよう、cGy の整数で掛けてから戻す(`radiotherapyTotalDose`)。

［事実］`occurrence[x]` は choice で、開始予定日に `occurrenceDateTime` を使うと `occurrenceTiming` は
併用できない(リハビリと同じ制約)。［導出］分割回数と週あたり回数は Phase の拡張に持つ。
1 日 2 回照射は週あたり回数(〜14)で表す。

### 2.5 依頼への参照は拡張で持つ

［導出］`basedOn` は使えない(§2.1 と同じ理由で、治療処方が明細扱いになって消える)。
`radiotherapy-consult-request`(valueReference ＋ display)を使う。`supportingInfo` も検討したが、
後続で計画 CT などを入れると判別が要るのでやめた。

［提案］逆向きの参照(依頼 → 治療処方)は書き戻さない。二重管理を避け、カルテのタイムラインが
手元の ServiceRequest から逆引きする(`karteTimeline.ts` の `radiotherapyByConsultId`)。
依頼カードの「治療処方表示」、治療処方カードの「依頼表示」で行き来する。処方フォームでは、選んだ
依頼の依頼目的(テンプレートの平文)をそのまま表示する。依頼への回答(診療記録)は従来どおり別に書く。

### 2.6 標準規格の採否と対応表

| 規格 | 採否 | 理由 |
|---|---|---|
| JP Core | 該当なし | ［事実］放射線治療のプロファイルが無い(v1.2.0 の 34 プロファイルに治療系なし) |
| HL7 mCODE STU4 / CodeX RT IG | **要素構成を採用** | 下の対応表。プロファイルは名乗れない(下記) |
| SNOMED CT(mCODE の値セット) | コードとしては不採用 | ［事実］日本は SNOMED International 非加盟。［導出］ローカルの CodeSystem を使い、マスタの `reference_code` に参考として対応を持つ |
| JJ1017 | 部位・左右は部品コードを採用 | §3.2。頻用コード F3(治療系)は照射 1 回ごとのコードなので後続の照射記録で使う |
| DICOM RT / IHE-RO | 対象外(境界のみ) | §1.3 |
| 診療放射線技師法施行規則(照射録) | 後続で満たす | §6.1 |
| CTCAE v5.0 | 後続で採用 | マスタは取込済み(`docs/chemo-regimen-design.md` §8.11) |

［事実］上流は書き込み時に `meta.profile` を捨て、読み出し時に登録表の値(JP_ServiceRequest_Common)で
上書きする。mCODE のプロファイル URL を送っても保存されない。未知の拡張は検証も索引もされずに往復する
(3 階層の入れ子拡張が PUT → GET で保たれることは確認済み。§9)。
［導出］**要素の構成と名前を mCODE / CodeX に 1:1 で合わせ**、輸出が要るときに機械的に写せるようにする。

| このアプリ | mCODE / CodeX RT |
|---|---|
| ServiceRequest(治療処方) | Radiotherapy Course Prescription(ServiceRequest) |
| `radiotherapy-course.intent` | `mcode-procedure-intent` |
| `radiotherapy-course.terminationReason` | `mcode-treatment-termination-reason`(Course Summary 側) |
| `radiotherapy-phase` | Radiotherapy Phase Prescription(ServiceRequest, basedOn = Course)。輸出時に展開 |
| `radiotherapy-phase.modalityAndTechnique` | `mcode-radiotherapy-modality-and-technique`(modality / technique) |
| `radiotherapy-phase.fractionsPrescribed` | `radiotherapy-fractions-prescribed` |
| `radiotherapy-phase.dosePrescribedToVolume`(volume / fractionDose / totalDose) | `radiotherapy-dose-prescribed-to-volume`(同名の子要素。単位は cGy = Gy × 100) |
| `radiotherapy-volume`(volumeId / type / bodySite) | Radiotherapy Volume(BodyStructure: identifier / morphology / location) |
| `radiotherapy-consult-request` | `ServiceRequest.basedOn` |
| 照射記録の Procedure(§6.1) | Radiotherapy Treated Phase / CodeX の Treated Fraction |
| Course Summary の Procedure(§6.2) | Radiotherapy Course Summary(code = SNOMED 1217123003) |

---

## 3. マスタ

［導出］保有する装置・実施できる照射技法・定型の線量分割は施設ごとに違う。リハビリの疾患別区分の
ような「全国で固定の分類」ではないので、**選択肢は backend のマスタで持つ**。どれも数十件で、
配布形式の標準マスタは無く、画面から手で入れる単純編集型(輸血製剤マスタと同じ)。初期値は `db:seed`。

| マスタ | テーブル | 使いどころ | seed |
|---|---|---|---|
| 照射モダリティ | `master_radiotherapy_modalities` | Phase のモダリティ | 9 件(X線・電子線・陽子線・炭素イオン線・小線源…) |
| 照射技法 | `master_radiotherapy_techniques` | Phase の照射技法。`modality_codes` で選べるモダリティを絞る | 15 件(3D-CRT・IMRT・VMAT・SRS・SRT・SBRT・TBI…) |
| 治療装置 | `master_radiotherapy_devices` | Phase の使用予定装置(任意)。後続の照射記録・予約枠で本格利用 | なし(施設ごとに違う) |
| 休止・中止理由 | `master_radiotherapy_stop_reasons` | 中止の理由(`kind` = suspend / terminate / both) | 12 件 |
| 治療プロトコル(定型処方) | `master_radiotherapy_protocols` | 処方フォームで選ぶと標的と Phase が展開される | 15 件(乳房温存術後・前立腺・骨転移・全脳・肺 SBRT・頭頸部 SIB…) |

メニューは「マスタメンテ > 放射線治療」。API は `/master/radiotherapy_*`(コードでも id でも引ける。
`enabled=true` で有効な行だけ)。フロントは `masterClient.ts` の `radiotherapyMasterClient` と
`masterQueries.ts` の `radiotherapyMasterHooks` が 5 つ分をまとめて作る。

### 3.1 オーダーにはコードと名称を焼く

［提案］オーダーには `CodeSystem/radiotherapy-modality|technique|device|protocol|stop-reason` の
コードと、その時点の名称を焼く(他のオーダーと同じ)。マスタを無効にしても登録済みの処方の表示は
変わらない。無効にした行は新規の選択肢から消えるが、編集画面では保存済みの値を選択肢に補う。

［提案］`reference_system` / `reference_code` は標準コード(mCODE の値セット = SNOMED CT)との
対応の**参考**で、オーダーには焼かない(§2.6)。定位照射(SRS/SRT/SBRT)と全身照射は mCODE の
技法の値セットに無いので空。

### 3.2 部位と左右は JJ1017 の部品コード

［事実］JJ1017 の部品表(`master_rad_jj1017_codes`)に部位 431 件・左右等 13 件を取込済み。system は
放射線検査と同じ `jj1017p` / `jj1017-laterality`(`radOrderHelpers.ts`)。
［導出］標的の部位はこれを使う。「骨転移」のように定型では部位が決まらないプロトコルは部位を空に
しておき、処方のときに選ぶ。部品表に無い部位は選択肢の末尾の**「自由記載」**を選ぶと名前で書ける
(`bodySite.text` だけが入る)。［提案］自由記載はフォームの中だけの値(`FREE_TEXT_BODY_PART`)で、
未選択と区別するために置いている。オーダーには焼かず、読み直すときは「部位のコードが無く text がある」
ことから自由記載に戻す。再照射の照合(§5.3)では自由記載の部位は突き合わせない(同じ名前でも同じ部位とは
限らない)。

［事実］頻用コード F3(治療系 4,567 件)は 32 桁で、門数・「1 回目 / 同日 2 回目」・管理料・エネルギーを
含む**照射 1 回ごとの実施・会計コード**。［導出］コース全体の処方の `code` には合わない。後続の
照射記録の `Procedure.code` に使う(§6.1)。

### 3.3 治療プロトコルは jsonb、承認は持たない

［提案］標的(`volumes`)と Phase(`phases`)は jsonb 列に入れ子のまま持つ。数件で、単独で検索も
集計もしないため(レジメンのように子テーブルに分けない)。形の検証はモデルが行う(線量行が標的を
指しているか、分割回数が正の整数か)。

［提案］レジメンのような承認の段階(下書き → 承認済)は持たない。プロトコルは入力の手間を省く
雛形で、展開後に放射線治療医が内容を確かめて登録する。オーダーにはプロトコルのコードと名称だけが
残る(`radiotherapy-course.protocol`)。

［提案］治療目的(根治・術前・術後・緩和・予防)・併用療法・標的の種別は施設で増減しないので
フロントの定数(`RADIOTHERAPY_INTENT_OPTIONS` ほか)。治療目的のコードはプロトコルマスタの
`intent` と共通。

---

## 4. Task と ServiceRequest.status(他科依頼と同じ意図的な逸脱)

```text
Task requested   処方済  ↔ SR.status active
Task accepted    計画中  ↔ SR.status active      計画 CT 〜 治療計画 〜 承認
Task in-progress 治療中  ↔ SR.status active      初回照射から最終照射まで
Task completed   終了    ↔ SR.status completed   ＋ course.endedOn
Task cancelled   中止    ↔ SR.status revoked     ＋ course.endedOn / terminationReason / terminationNote
```

［事実］上流の `order-period` 検索(期間継続型の「基準日に効いているオーダー」)は、終了日の拡張 URL が
看護・食事・リハビリ・栄養指導の 4 つに固定されている。新しい種別では上流を改修しないと使えない。
［導出］部門一覧は他科依頼と同じく **status で切る**(§4.1)。そのため **Task の遷移と同じ
transaction で ServiceRequest.status も動かす**。

**表示の正本は Task**(処方済・計画中・治療中を status では区別できない)、status は検索のための索引。
書き込みの入口は `useUpdateRadiotherapyTaskStatus` だけにする。編集(`buildRadiotherapyOrderUpdateBundle`)は
status と終了・中止の情報を元のリソースから引き継ぐ。

［提案］治療コースの間、Task は「治療中」のまま動かない(リハビリと同じ「部門の受け入れ状態」)。
日々の照射は Task を動かさず Procedure を足す(§6.1)。

［提案］**受付後(計画中以降)の処方は削除させない**(`deleteRadiotherapyOrderRequest`)。計画や照射が
進んだ処方が消えると、何に基づいて照射したのかが辿れなくなる。やめるときは部門一覧の「中止」。

### 4.1 部門一覧(放射線治療一覧)

`/radiotherapy-worklist`(部門業務メニュー)。

- **進行中** … `status=active`。いま抱えているコースなので有限。進捗で絞り込める
- **終了・中止** … `status=completed,revoked` の直近ぶん(登録日の降順)

「終了」は終了日を、「中止」は中止日・理由(マスタ)・補足を聞いてから進める。取消(終了を取消・
中止を取消)で戻すと、それらは落ちる(`buildRadiotherapyOrderStatusEntry`)。

---

## 5. カルテでの見せ方

### 5.1 右ペイン

「放射線治療」ボタンは「化学療法」の隣(どちらもがんの治療計画)。臨床医からの依頼は「他科依頼」。

### 5.2 カードと詳細

カードの見出しは「入外 | 第 N コース | 治療目的」、本文は部位・照射技法・併用療法と、**標的ごとの
コース合計**(「PTV 全乳房 50 Gy / 25 回」)。Phase の内訳は詳細で見る。終了・中止は日付と理由を添える。
カードは開始予定日に載る。

### 5.3 安全確認(`RadiotherapyPreCheck`)

処方フォームの先頭に出す。該当が無い項目は何も出さない。

- **過去の放射線治療** … この患者の治療コースを一覧にし、今回の標的と同じ部位(JJ1017 の部位コードが
  一致し、左右が食い違わない)のコースを強調する
- **妊娠・授乳** … 既存の `PregnancyNotice`
- **体内金属・ペースメーカー** … 患者プロファイルの注意区分(ピクトグラム `implant` の Flag)

［提案］再照射の強調は**気づきのためのもの**で、登録は止めない。隣接部位の重なりや累積線量
(EQD2 など)は評価しない。他院での照射歴は、紐付けた依頼の依頼目的を読む(§1.2)。

### 5.4 周辺

オーダーセット(`radiotherapy-order`。患者に依存する開始予定日・担当医・元の依頼は持ち込まない)、
クリニカルパスのタスク分類 `TPRT` の既定のオーダー種別、退院時サマリーの「手術・処置」の候補、
承認待ち通知の種別に載せてある。

［提案］**退院で止めない。** 照射は退院後も外来で続くのが普通なので、退院時に打ち切る対象
(食事・リハビリ・看護指示)には入れない。

---

## 6. 後続フェーズ(構造のみ)

### 6.1 照射記録(1 回の照射 = Procedure 1 件)【第2段階・実装済】

```text
Procedure   basedOn = 治療処方
  status     completed(照射した)| not-done(照射しなかった回)| entered-in-error(取消)
  statusReason       照射しなかった理由(休止・中止理由マスタ)
  category   order-type|radiotherapy ＋ radiotherapy-procedure|fraction
  code       照射方法(Phase のモダリティ + 照射技法の写し。照射録の法定項目)
  performedPeriod    照射の開始・終了時刻(時刻を入れないときは performedDateTime に日付)
  performer          実施者(診療放射線技師)
  usedCode           使用した治療装置
  extension[radiotherapy-fraction]
    phaseId  fractionNumber  imageGuidance(位置照合)
    doseDeliveredToVolume ×M { volume(volumeId), dose(Gy) }
```

- 実装は `frontend/src/fhir/radiotherapyResultHelpers.ts`、入力は `RadiotherapyPerformModal`
  (部門一覧の「照射入力」)。何回目・どの Phase・標的ごとの線量は処方と実施済み件数から決まるので、
  開いた時点で入っている
- **照射しても進捗 Task は動かさない**(リハビリ・栄養指導と同じ期間継続型。§4)。終わりは部門一覧の
  「終了」が決める。カードの実施情報も受付済以降は常に出す
- **［決定］取消は物理削除にしない。** 照射録は保存の対象なので `status=entered-in-error` にする
  (リハビリ・処置は会計の都合で DELETE だが、ここは揃えない)。累積線量と回数からは外れる
- **［決定］照射しなかった回も記録に残す**(`status=not-done` ＋ 理由)。休止の判断と治療期間の評価に
  要るため。線量は持たない
- 累積線量は `_revinclude=Procedure:based-on` で取った照射記録を標的ごとに足す
  (`radiotherapyProgress`)。0.1 刻みの線量を何十回も足すので、cGy の整数にしてから足す
- 再計画は、旧 Phase を `status=revoked` にして新しい Phase を足す。「どの回をどの処方で照射したか」は
  照射記録の `phaseId` で追える(§8 のとおり、Phase の打ち切りは画面から作れない)
- ［事実］照射録の法定項目(診療放射線技師法施行規則): 患者の氏名・性別・年齢、照射年月日、照射方法、
  指示した医師、指示の内容。［実装］氏名・性別は `subject`、年齢は照射日から導出、照射方法は `code`
  (Phase の写し)、指示医師と指示内容は `basedOn` の治療処方。**照射記録は処方なしでは作れない**ので、
  指示と実績は必ず結びつく
- 経過表への照射日・累積線量と、会計(M001 体外照射ほか。単位は照射 1 回、JJ1017 F3 → レセ電算コード)は
  後続フェーズ

### 6.2 治療終了サマリー

Procedure(`category = radiotherapy-course-summary`、`basedOn` = 治療処方、`performedPeriod` = 初回〜最終
照射、標的ごとの実照射線量と回数、完遂 / 中止と理由)。照射記録から自動で下書きする
(退院時サマリーの「下書きを集め直す」と同じ作り)。他院での照射歴を構造化して残すときも、`basedOn` の
無い Course Summary として同じ器に入れられる。

### 6.3 治療中の診察(週次レビュー)と有害事象

［事実］CTCAE の記録は実装済みだが、`adverseEventHelpers.ts` は `regimen-order` 拡張(どのレジメンの
何クールか)が無いと読めない。［提案］「原因となった治療」への参照を一般化してから放射線治療に広げる。

### 6.4 休止【第2段階・実装済】

Task `on-hold` ↔ `SR.status on-hold`。部門一覧の「休止」で休止日と理由(休止・中止理由マスタの
`kind=suspend`)を入れ、「再開」で治療中に戻る。休止の情報はコース拡張の `suspendedOn` /
`suspensionReason` / `suspensionNote` に持ち、再開すると落ちる(終了・中止の `endedOn` 側とは別の枠)。

［実装］`taskHelpers.ts` の `executionPeriod` は「受付済・作業中・休止中」で終了時刻を入れない
(部門の手が離れていないため)。ここは共通実装なので、他部門の Task の挙動は変わらない。

### 6.5 計画 CT・固定具

計画 CT は既存の放射線検査オーダーで出し、治療処方から参照する(拡張)。体位・固定具・呼吸同期・
前処置(蓄尿・絶食)は放射線検査の特別指示テンプレートで持てる。

---

## 7. 予約(後続)

［提案］リハビリと同じ「部門が受付後に都度取る」形。Schedule の `serviceType = radiotherapy`、
actor は治療装置の Location。30 回ぶんを一括で確保する操作と、休止のときの一括ずらしが要る
(手術室ブロックの作りが近い)。

---

## 8. 未決事項・申し送り

- **依頼の通知が無い。** 放射線治療科は他科依頼一覧を見に行くしかない。緊急照射の依頼は「至急」で
  出せるが、通知ベルには出ない(他科依頼全体の課題)
- **処方できる人を絞っていない。** 権限の仕組みが無いので、どの医師でも治療処方を登録できる
- **治療中の Phase の打ち切り**(`status=revoked`)は画面から作れない。構造と表示(詳細の「中止」、
  コース合計から除外、DO で引き継がない)と、照射記録からの追跡(`phaseId`)だけ入っている
- **クリニカルパスから照射入力を開いたときは進捗 Task を動かさない**(リハビリ・栄養指導は依頼済なら
  受付済にする)。放射線治療の Task は部門が決めるものなので、処方済のまま照射記録だけが付きうる
- **入院 → 外来の切り替え**を表す手段が無い。入外区分は登録時の値のまま
- **同時化学放射線療法**は併用療法の区分を持つだけ。化学療法タブの暦に照射期間を重ねるのは後続
- **小線源・RI 内用療法**はモダリティに小線源だけ入れてある。RI 内用療法の投与量(MBq)は扱わない
- 再照射の強調は JJ1017 の部位コードの一致だけ(§5.3)
- 既定テンプレートの設定とテンプレートカテゴリの code は環境ごとに違う

---

## 9. 検証

2026-09-21、開発環境(テスト太郎)。

1. `/departments` で診療科「放射線治療科」を 3 ケタ科 `30B` で登録 → 他科依頼の依頼先と、処方フォームの
   担当医(その科の医師)に出る
2. テンプレート `CONSULT_RT_01` を取り込み、施設設定で放射線治療科の既定に設定 → 依頼先に放射線治療科を
   選んで「テンプレート」を押すと、選択済みで開く
3. 「放射線治療」→ プロトコル「乳房温存術後 50Gy/25回 + Boost 10Gy/5回」を選ぶ → 標的 2 件・Phase 2 件・
   治療目的(術後)が展開され、コース合計が「50 Gy / 25 回」「10 Gy / 5 回」になる → 左側を選んで登録
4. カード(第1コース・左側 乳房・3次元原体照射・電子線照射・標的ごとの合計)と進捗「処方済」を確認
5. DO → コース番号が 2 になり、安全確認に第 1 コースが出て、同じ部位なので強調される
6. 放射線治療一覧で 受付 → 治療開始 → 終了(終了日を入力)→「進行中」から消え「終了・中止」に出る →
   「終了を取消」で治療中へ戻る
7. 治療中の処方を編集で開く → 標的・Phase・線量が復元され(入れ子の拡張が上流で保たれている)、
   標的と Phase の削除ボタンが無効になる
8. 編集で元の他科依頼を選んで更新 → 依頼目的が表示され、依頼カードのメニューに「治療処方表示」、
   治療処方カードのメニューに「依頼表示」が出る。進捗は治療中のまま
9. 部門一覧の「照射入力」で 1 回目を登録 → カードと詳細に照射記録が出て、累積線量と「1 / 28 回」が
   進む。未実施(理由つき)も登録できる。取消は消えずに一覧から外れる(`entered-in-error`)
10. 「休止」→ 進行中のまま状態が休止になり、休止日と理由が詳細に出る →「再開」で治療中に戻る
11. `tsc -b`、backend の rspec(`spec/requests/master/radiotherapy_masters_spec.rb`、
   施設設定の spec)

上流の落とし穴: JASPEHR の Questionnaire は `name` が 15 文字以内(jsp-5)、`enableWhen` を持てるのは
`choice` 項目の子だけ(jsp-9)。
