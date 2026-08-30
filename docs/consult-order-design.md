# 他科依頼(コンサルテーション)オーダーの設計

**状態: 実装済(2026-08-30)。** 看護指示(`docs/nursing-order-design.md`)の実装後に着手した。
計画時の判断からの変更は §5.1(回答の入口)。

これまでのオーダーは「部門(検査室・薬剤部・リハ科)に作業を頼み、結果や実施記録が返る」
ものだった。他科依頼は **人(他の診療科の医師)に判断を頼み、文章が返る** 最初のオーダーで、
往復の後半(回答が依頼元のカルテに戻る)がこれまで存在しなかった。

本文中の区別は他の設計書と同じ(［事実］/［導出］/［提案］)。

---

## 1. 他の部門オーダーとの違い = 「回答が返る」こと

| 項目 | 検査・処置(部門オーダー) | 他科依頼 |
|---|---|---|
| 依頼先 | 部門(検査室・リハ科)。オーダー種別で決まる | **診療科**。同じ種別のまま宛先が変わる。§2.1 |
| 結果 | DiagnosticReport / Procedure(構造化) | **診療記録(Composition)**。文章。§5 |
| 実施者 | 技師・療法士 | 医師 |
| 完了の意味 | 検査を行った | **回答を書いた** |
| 一覧の絞り込み軸 | 実施予定日 | 依頼先科 + 未回答かどうか。§4.1 |

［導出］「宛先が診療科ごとに変わる」ため、部門一覧は 1 つでよいが **依頼先科での
絞り込みが要る**。「日付軸を持たない」ため、部門一覧を日付で区切れず、
未回答をサーバー側で絞る手段が別に要る(§4.1)。

### 1.1 命名

［提案］英語識別子は `consult`。`consultation` は長く、`referral` は院外への
診療情報提供書(`docs/report-mappings/referral-01.md`)で既に別の意味に使っている。
画面表記は「他科依頼」。返ってくるものは「回答」(「返書」は院外紹介の用語なので使わない)。

---

## 2. FHIR の構造

明細を持たないヘッダ 1 本 + 回答の診療記録。

```text
ヘッダ ServiceRequest  (category: order-type|consult)
  status      = active(未回答) / completed(回答済) / revoked(取消)。§4.1
  code        = 依頼種別 (CodeSystem/consult-request-type: consult/opinion/exam/transfer)
  priority    = routine | urgent
  occurrenceDateTime = 希望日(任意。日付のみ)
  reasonCode[0].text = 依頼目的(必須)
  note[0].text       = 補足(任意)
  reasonReference    = Condition (対象プロブレム)
  performer[0] = Organization/{依頼先科}   (必須)。§2.1
  performer[1] = Practitioner/{指名医師}   (任意)
  requester / ext order-department / order-ward = 依頼元(applyOrderContext)
  extension[consult-reply] = Composition/{回答} valueReference。§2.3
  extension[consult-purpose-questionnaire-response] = 依頼目的の記入内容。§2.4
  ←focus──── Task (task-code|consult)  requested → accepted → completed / cancelled

回答 Composition
  type       = LOINC 11488-4 Consult note
  event[0].detail = ServiceRequest/{依頼}   ← 依頼への正引き。§2.3
  event[0].code   = CodeSystem/consult-note-event|reply
  ext[order-department] = 回答した診療科
  author     = 回答した医師
  section    = 通常の診療記録と同じ(SOAP / 自由記載、テンプレート挿入も使える)
```

### 2.1 依頼先は `performer`

［事実］`ServiceRequest.performer`(0..*, Reference(Practitioner|Organization|…))は
「依頼を実行することが求められている者」で、他のオーダー種別はどれも使っていない。
依頼元の診療科はローカル拡張 `order-department` に入っているので衝突しない。

［提案］依頼先科を `performer[0]`(Organization)、指名医師を `performer[1]`(Practitioner)
に置く。ローカル拡張を新設せず標準の場所を使う。`display` に名称を埋めて、一覧で
Organization を引き直さずに描けるようにする(依頼元と同じ方針)。

［事実］上流 FHIR サーバーは `ServiceRequest.performer` を索引していない
(実装済みの検索は based-on / occurrence / department / ward)。
［導出］部門一覧の依頼先科での絞り込みはクライアント側になる(§4.1)。
サーバーに `performer` 検索を足すのが本筋なので `docs/server-improvement-backlog.md`
に起票する。

### 2.2 依頼種別はマスタを持たない

［提案］診察依頼 / 意見のみ / 検査依頼 / 転科相談 の 4 つを frontend の定数で持つ。
施設ごとに増減する性質のものではなく、増えたとしても「依頼目的」の自由記載で足りる
(リハビリの療法種別・疾患別リハ区分と同じ判断。`docs/rehab-order-design.md` §3)。
backend の変更は無し。

### 2.3 回答の紐付けは双方向

［事実］FHIR R4 の Composition には `basedOn` が無い。あるのは
`Composition.event`(「この文書が記述している臨床上の出来事」)で、`event.detail` は
Reference(Any)。

［提案］**正引き(回答 → 依頼)は `Composition.event.detail`**。ローカル拡張を作らずに
済み、意味も「この記録が記述している出来事 = その依頼」で合っている。

［提案］**逆引き(依頼 → 回答)は ServiceRequest のローカル拡張 `consult-reply`**。
上流は `Composition.event` を索引していないので `_revinclude` で回答を連れて来られず、
これが無いとカルテのカードも部門一覧も「回答済かどうか」を出せない。回答の保存は
どのみち ServiceRequest を PUT する(status を completed にする)transaction なので、
同じ transaction で `urn:uuid` 参照として書き込む(テンプレート回答の QR を
Composition から参照するのと同じやり方)。

［導出］二重に持つので、どちらかだけが残る壊れ方がありうる。**正本は `event.detail`**
とし、拡張は表示のためのキャッシュと位置づける(依頼科・依頼医師の `display` を
埋めているのと同じ性格)。

### 2.4 依頼目的はテンプレートからも書ける

［事実］依頼目的を自由文だけで書くと「何を聞かれているのか」が読み取れず、依頼先が
カルテを最初から辿り直すことになる。訊く項目を決めておけば揃う。

［提案］放射線の特別指示・病理の臨床経過と**同じ作り**にする。テンプレート
(Questionnaire)から記入すると回答が平文になって `reasonCode.text` に入り、回答そのものも
QuestionnaireResponse として残ってローカル拡張から参照される。読む側(カルテのカード・
部門一覧・回答モーダル)は平文だけを見るので、テンプレートを使ったかどうかで作りが
変わらない。

- テンプレート紐付き中は欄を直接編集させない(回答と本文が食い違うため)
- 「解除」は紐付けだけ外して文言は残す。外れた回答は同じ transaction で DELETE する
- DO(複写)では紐付けを引き継がない。同じ回答を 2 つのオーダーが指すと、片方を
  消したときにもう片方が壊れるため(病理・手術と同じ)
- 依頼を削除するときは回答も道連れにする

［提案］汎用テンプレート `CONSULT_PUR_01`(`docs/report-mappings/consult-purpose-01.md`)を
用意し、カテゴリ「他科依頼」を新設した。科ごとの定型(術前評価など)は同じカテゴリに
足していく。

---

## 3. マスタ

新規マスタは無し。使うのは既存の診療科(Organization。`useSelfDepartments`)と
その所属医師(`useDepartmentDoctors`)だけ。backend のコード変更も無し。

依頼目的のテンプレート(§2.4)のために **テンプレートカテゴリ「他科依頼」** を 1 件
足してある(`questionnaire_categories`。既存のカテゴリ運用に乗るだけで、テーブルも
画面も新設していない)。


---

## 4. Task と ServiceRequest.status の役割分担(意図的な逸脱)

```
Task     requested (依頼済)  … 依頼先科がまだ見ていない
         accepted  (対応中)  … 受けた。回答はまだ
         completed (回答済)
         cancelled (取消)    … 依頼先科が「対応不要」として閉じた

SR.status  active    … 未回答(依頼済・対応中)
           completed … 回答済
           revoked   … 取消
```

［事実］他の部門オーダーは進捗を Task だけで持ち、`ServiceRequest.status` は
`active` のまま動かさない。

［提案］他科依頼は **Task の遷移と同じ transaction で `ServiceRequest.status` も動かす**。

［導出］理由は部門一覧の絞り込み(§4.1)。リハビリが「Task を completed にするだけでは
`occurrence=le{基準日}` に永久にヒットし続ける」ので ServiceRequest にも終了日を書いた
(`docs/rehab-order-design.md` §6.1)のと同じ事情で、こちらは書く先が拡張ではなく
標準の `status` になる。

［導出］表示の正本は Task(依頼済と対応中を `status` では区別できないため)。
`status` は検索のための索引と位置づける。**片方だけを動かす実装を書かないこと**
(`useUpdateConsultTaskStatus` が両方を 1 つの transaction で書く。他に入口を作らない)。

### 4.1 なぜ status を使うのか = 一覧を絞る軸が他に無い

［事実］他部門の一覧は実施予定日で絞る(`occurrence=<基準日>`、リハビリは `le{基準日}`)。
他科依頼の希望日は任意入力で、大半のオーダーは日付を持たない。

［導出］日付で絞れないので、素直に作ると「これまでの全依頼を読んでクライアントで
未回答だけ残す」になり、件数が増え続ける。`status=active` で絞れば未回答だけが
サーバーから返り、件数は「いま溜まっている仕事」に比例する(有限)。

［提案］一覧のビューは 2 つ。
- **未回答** … `status=active`。依頼済・対応中の両方(Task で色分け)。
- **回答済** … `status=completed`、`_sort=-authoredon` の直近ぶんだけ。

依頼先科の絞り込みは `performer` が索引されていないのでクライアント側(§2.1)。
既定は OrderContext(ヘッダーで選択中)の診療科。

---

## 5. 回答 = 診療記録

［提案］回答は専用の入力欄やテンプレートを作らず、**既存の診療記録エディタで書く**
(`ClinicalNoteForm`)。SOAP でも自由記載でも書け、テンプレート挿入・シェーマも
そのまま使える。回答内容は結局のところ診察所見と評価・方針なので、専用の様式を
作ると同じものを二重に持つことになる。

［導出］回答は **通常の診療記録としてもタイムラインに出る**(回答した医師が書いた
記録なので、出るのが正しい)。加えて依頼カードの「回答表示」からも開ける。
タイトルの既定値は「他科依頼回答(依頼元科)」。

### 5.1 入口は一覧のモーダル

［事実］カルテ画面の右ペインは URL に載せない方針(`karteUrl.ts` の冒頭)。
［導出］部門一覧から「カルテの右ペインを開いた状態」へ遷移させられない。
［提案］回答は **他科依頼一覧の行から開くモーダル**で書く(輸血・リハビリの実施入力
モーダルと同じ入口)。モーダルの上半分に依頼内容、下半分に診療記録フォームを置く。

**計画からの変更**: 当初はカルテ右ペインに `consult-reply` ペインを足す想定だったが、
上記の理由でモーダルに変えた。合わせて詳細モーダルの種別(`KarteDetailKind`)も
増やしていない — 回答は診療記録なので既存の `note` 詳細で開ける。

### 5.2 カルテでの見せ方

- カードは希望日(あれば)、無ければ依頼日に 1 枚。
- 見出し = 入外区分 | 依頼先科(指名医師) | 至急のときだけ「至急」。
- 本文 = 依頼種別 / 依頼目的 / 補足 / 回答済なら回答者と回答日。
- メタに進捗(依頼済・対応中・回答済・取消)を出す(他部門と同じ位置)。
- ケバブメニューに「回答表示」。回答がまだ無いオーダーでは無効化する
  (検体検査の「検査結果表示」と同じ作り)。

### 5.3 メニューは「診療業務」に置く(部門業務ではない)

［事実］部門業務メニューに並んでいるのは検査室・薬剤部・リハ科など、**依頼を受ける
部門**が捌く一覧。

［導出］他科依頼を受けるのは技師や薬剤師ではなく **他科の医師**で、返すのも結果では
なく診療記録。同じメニューに置くと「部門の仕事」に見えて、当の医師が自分の画面だと
思わない。

［提案］**「診療業務」メニューを新設**して他科依頼一覧をそこに置く。診療科の医師が
捌く仕事が増えたらここに並べる。

---

## 6. 実装フェーズ

1. **オーダー発行**(ヘルパー・フォーム・カルテ統合)
2. **部門一覧 + 回答**(同時。回答が無いと部門一覧の意味が無いため)

backend の変更は無し(§3)。上流 FHIR サーバーの変更も無し
(`order-type|consult` は汎用実装に乗るだけ)。`performer` 検索だけを
改善バックログに起票する。

### 6.1 診療記録の検索に回答の種別を足す(見落としやすい連動)

［事実］カルテのタイムラインと診療日ペインは Composition を
`type=http://loinc.org|11506-3`(経過記録)で絞って引いていた。

［導出］回答は type が Consult note(11488-4)なので、そのままでは **保存されているのに
カルテに出ない**。実装中に実際に踏んだ。

［提案］種別のリストを `clinicalNoteHelpers.ts` の `KARTE_NOTE_TYPE_SEARCH`
(token 検索のカンマ = OR)に集約し、2 か所(`useKarteClinicalNotesInfinite` /
`useKarteDayIndex`)がそれを見る。診療記録の種別を増やすときはここに足す。

---

## 7. 実装したもの

- 依頼目的テンプレート: `docs/report-mappings/consult-purpose-01.questionnaire.json`
  (カテゴリ「他科依頼」を新設)
- オーダー: `fhir/consultOrderHelpers.ts` / `components/ConsultOrderForm.tsx` /
  `ConsultOrderPanels.tsx` / `ConsultOrderDetailPanel.tsx` /
  `hooks/useConsultOrderInitialValues.ts`
- 進捗: `fhir/consultTaskHelpers.ts`
- 回答: `components/ConsultReplyModal.tsx` + `buildClinicalNote` の
  `consultOrderId` / `department` オプション
- 一覧: `pages/ConsultWorklistPage.tsx`(`/consult-worklist`、**診療業務**メニュー。§5.3)
- 問い合わせ: `api/queries.ts` の「他科依頼」節
- カルテ統合: `karteTimeline.ts` / `KarteTimeline.tsx` / `KarteCardModals.tsx` /
  `KarteRightPane.tsx` / `KartePage.tsx` / `karteUrl.ts` / `KarteCategoryList.tsx`

backend の変更は無し。上流 FHIR サーバーの変更も無し。

### 7.1 検証したこと(2026-08-30、開発環境のテスト太郎)

- カルテから登録 → カードが依頼日に載り、`performer` に依頼先科、`reasonCode.text` に
  依頼目的(改行を保持)、`reasonReference` に対象プロブレムが入る
- 部門一覧「未回答」→ 受付 → Task=accepted / SR.status=active(status は動かない)
- 回答 → 1 transaction で Composition(type=11488-4、`event.detail`=依頼)+
  Task=completed + SR.status=completed + `consult-reply` 拡張。`urn:uuid` は上流が
  実 ID に書き換える
- 回答後: 一覧から「未回答」→「回答済」へ移り、カルテのカードに「回答済」と回答者、
  ケバブの「回答表示」で回答の診療記録が開く。回答は診療記録のカードとしても出る
- 回答済の依頼を削除 → 「回答済の他科依頼は削除できません」で拒否
- 回答取消 → SR.status=active・`consult-reply` 拡張が外れ・Task=accepted。
  回答の Composition は残る
- 回答済の依頼を編集して保存 → status と `consult-reply` 拡張が保たれる
- 依頼目的をテンプレートから記入 → 平文が欄に入り欄は読み取り専用になる。保存で
  QuestionnaireResponse が同じ transaction に載り、オーダーの拡張が実 ID を指す
- 編集で開き直すとテンプレート紐付きが復元される。「解除」して保存すると拡張が外れ、
  文言は残り、回答は 410(削除済)になる — 孤児が残らない
- テンプレート由来の回答はカルテの単独テンプレートカードには出ない
- 上流の対応を確認: `status=active,revoked` のカンマ OR は効く / Composition の
  `type` のカンマ OR も効く / `performer` 検索は `handling=strict` で
  `Unsupported search parameter` になる(§2.1)

---

## 8. 申し送り

- **`performer` 検索が上流に無い**ので依頼先科の絞り込みがクライアント側。
  件数が増えたら `status=active` で絞った先をさらにページングする必要が出る。
- **回答の削除**(診療記録として消す)では依頼の状態は戻らない。ServiceRequest には
  `consult-reply` 拡張と `status=completed` が残る。戻す入口は部門一覧の「回答取消」
  (Task を対応中へ、status を active へ、拡張を外す)。回答の記録そのものは消さない。
- **回答済の依頼は削除できない**(`useDeleteConsultOrder` が拒否する)。回答という
  別の医師の記録がぶら下がっているため。先に「回答取消」を行う。
- 回答を取り消してもう一度回答すると、診療記録は 2 件残る(前の回答は消さない)。
  依頼から辿れるのは新しい方だけ。
- 依頼先の医師を指名しても、その医師にだけ一覧が出る仕組みは無い(一覧の軸は科)。
  医師単位の受信箱が要るようになったら `performer` 検索と合わせて考える。
- **依頼先の科ごとに既定テンプレートを出す仕組みは無い。** 放射線・内視鏡は項目マスタに
  「既定のテンプレート」を持たせているが、他科依頼の宛先は Organization(診療科)で、
  診療科マスタは上流の Organization そのものなのでフロント側の設定を持つ場所が無い。
  科ごとの定型が増えたら、backend に「診療科 → 既定テンプレート」の対応表を持つのが
  素直(そこまでは依頼医がカテゴリから選ぶ)。
- テンプレートカテゴリ「他科依頼」の code は環境ごとに違う。別環境へ
  `consult-purpose-01.questionnaire.json` を入れるときは、その環境で作った code に
  差し替える(`docs/report-mappings/consult-purpose-01.md`)。
