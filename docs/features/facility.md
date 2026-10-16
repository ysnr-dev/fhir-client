# 自院・医療機関・医療従事者

## 自院と連携先

本アプリはマルチテナントではありません。診療科・診察室・医療従事者（ログインするスタッフ）は
**自院のものだけ**を登録し、他院の医療機関・医師は診療情報提供書の送付先候補として
**連携先**に登録する、という切り分けです。

「どの Organization が自院か」はヘッダーの「管理 > 自院設定」（`/facility-settings`、AdminGate 対象）で
指定します。backend の単一行設定（`facility_settings` テーブル）に Organization.id を持ち、
`GET /facility_settings` でログイン済みユーザー全員が読めます（変更は `/admin/facility_settings`）。

この設定が入ると各画面の挙動が変わります。

| 画面・機能 | 自院設定あり | 自院未設定（初期セットアップ前） |
|---|---|---|
| マスタメンテ > 共通 > 医療機関 | 自院 1 件のみを表示・編集 | 従来どおり全医療機関の一覧（ここから登録して自院設定へ進む） |
| 診療科 / 診察室 / 医療従事者の登録 | 所属は自院で固定（選択 UI を出さない） | 従来どおり所属医療機関を選ぶ |
| 医療従事者一覧 | 所属ロールが自院のスタッフだけ | 全 Practitioner |
| 予約枠・外来一覧・部門ワークリストの診療科 | 自院配下の診療科だけ | 全医療機関の診療科 |
| 処方箋 PDF の医療機関欄 | 自院を read | 保険医療機関番号を持つ最初の Organization（取り違えうる） |
| テンプレートの自動入力・保険医療機関番号の初期値 | 自院の登録値 | ログイン中の医療従事者の所属 / 仮の番号 |

### 施設設定の項目（`facility_settings.settings`）

自院の Organization 以外の施設設定（看護指示の既定時刻・食事の提供時刻・バイタルの異常値・
内服の与薬の時刻・処方区分の初期値・文書作成の督促・水分出納の対象項目・他科依頼の
依頼先ごとの既定テンプレート・看護プロファイルの区画・経過表一括入力の列・DPC の医療機関別係数・
Web 問診の質問票と有効時間）は、
**`settings` jsonb 1 列**にまとめて入れます。backend はこれらを検索にも集計にも使わず（読むのは
frontend と、会計送信のコード引き当て・DPC の推定包括額だけ）、列に分けても索引も WHERE も使わないためです。

**項目を足すときに書くのは `FacilitySettings::SETTINGS`（項目表）だけです。** 検証・既定値の
穴埋め・読み書きのメソッド（`meal_schedule` / `meal_schedule_with_defaults` /
`FacilitySettings.meal_schedule`）・管理 API の受け取りと応答は、項目表から
`JsonShape`(`app/models/json_shape.rb`。チャート定義の検証と共用)が回します（migration も要りません）。

```ruby
"prescription_category" => {
  default: DEFAULT_PRESCRIPTION_CATEGORY,                     # 保存されていないときに返す値
  shape: { fields: { "inpatient" => { enum: [...], blank: true }, ... } },  # 構造
  check: ->(value) { ... }                                    # 構造で書けない決まり（任意）
}
```

- 構造の節は `fields`（決まったキー・知らないキーは弾く）/ `map`（キーが可変）/ `list` の 3 種、
  葉は `:time` / `:number` / `{ integer: }` / `{ enum: }` / `{ pattern: }` です。
- 既定値の重ね方は節で変わります。`fields` は**キーごと**（空欄は既定値に戻る）、`map` は
  **キー単位で差し替え**（バイタルのしきい値で「上限だけ空にする」を保存できるように）。
- `PATCH /admin/facility_settings` は**渡した項目だけ**を差し替えます（看護指示の既定時刻だけを
  保存しても他の設定は消えません）。応答と `GET /facility_settings` は、常に既定値で埋めた
  全項目を平らな JSON で返します（frontend から見える形は項目表の前後で変わりません）。

連携先（他院）は「マスタメンテ > 連携先」配下の**連携先医療機関**（`/partner-organizations`）と
**連携先医師**（`/partner-practitioners`）で登録します。FHIR 上の表現は自院と同じ
Organization / Practitioner + PractitionerRole で、所属ロールの `organization` が他院になる点だけが
違います（画面と検索条件で分けているだけで、別のリソース型は使いません）。連携先医師には自院の
診療科もログイン設定も持たせません。

- 自院の除外・限定はクライアント側で行います。上流の Organization 検索には「この id を除く」条件が
  無く、施設と診療科を切り分ける `partof:missing` しか使えないためです。
- 連携先医師の一覧で医療機関を「すべて」にしたときは、連携先の id を列挙した複数値検索
  （`organization=Organization/a,Organization/b`）で引きます。画面側で間引かないので件数と
  ページ送りが上流の結果とずれません。

## 医療機関（Organization）

「マスタメンテ > 共通 > 医療機関」（`/organizations`）と「マスタメンテ > 連携先 > 連携先医療機関」
（`/partner-organizations`）で、上流 FHIR サーバーの Organization を一覧・登録・編集・削除できます。
JP Core の `JP_Organization` プロファイルを想定した項目構成です。

| 画面項目 | FHIR 要素 |
|---|---|
| 医療機関名（必須） | `name` |
| 保険医療機関番号 | `identifier`（system は `http://jpfhir.jp/fhir/core/IdSystem/insurance-medical-institution-no` 固定。JP_Organization の `medicalInstitutionCode` スライス） |
| 種別 | `type`（`http://terminology.hl7.org/CodeSystem/organization-type`。binding は example） |
| 有効 | `active` |
| 電話番号 / FAX | `telecom`（`system=phone` / `system=fax`） |
| 郵便番号 / 所在地 | `address[0].postalCode` / `address[0].text` |

- 上流の検証は org-1 制約（`identifier` か `name` の少なくとも一方）のみのため、番号を持たない
  施設も登録できます。番号を入力した場合だけ 10 桁（都道府県2桁 + 点数表1桁 + 医療機関コード7桁）の
  書式を画面側で検証します。
- 検索は医療機関名（部分一致）と保険医療機関番号。更新は他画面と同じく `If-Match` による楽観ロックです。
- 他の識別子体系（例: `…/mhlw/IdSystem/medicalInstitutionCode10`）で登録済みのデータも一覧・編集で
  読めますが、保存すると上記のプロファイル準拠の system に書き換わります。
- 上流 FHIR サーバーを直接操作するため、backend の管理API（`ADMIN_TOKEN`）の対象外です
  （マスタ取込・帳票レイアウトと同じ扱い）。

### テンプレートへの一括入力

登録した医療機関は、テンプレート回答フォームから選んで項目に流し込めます（診療情報提供書の
紹介先・紹介元など）。この選択モーダルは自院・連携先の両方を候補に出します（宛先には他院を、
差出人には自院を選ぶため）。テンプレート編集画面の**拡張設定**で、短文入力・複数行テキストの項目に
**「医療機関の項目」** を設定すると、その項目を含むグループの枠内に「医療機関選択」ボタンが出ます
（医療従事者の選択ボタンと横に並びます）。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-organization-field
valueCode     : name | institutionNumber | addressFull | address | postalCode | phone | fax
```

| 「医療機関の項目」 | 入る値 |
|---|---|
| 名称 | `name` |
| 保険医療機関番号 | `identifier`（保険医療機関番号） |
| 郵便番号+所在地 | `〒{postalCode} {address.text}`（郵便番号未登録なら所在地のみ） |
| 所在地 / 郵便番号 | `address[0].text` / `address[0].postalCode` |
| 電話番号 / ＦＡＸ | `telecom` の `phone` / `fax` |

- ボタンは **グループ単位**（そのグループ直下の医療機関項目だけを埋める）。紹介先・紹介元のように
  グループが分かれていれば、それぞれ別の医療機関を選べます。繰り返しグループはインスタンスごとに選べます。
- 同じ項目に「医療機関の項目」と「医療従事者の項目」の両方は設定できません（どちらのボタンで入った値か
  分からなくなるため、保存時の検査で弾きます）。
- **選んだ内容で常に同期**します。医療機関側に登録が無い項目（例: FAX 未登録）は空になります。
  A病院→B病院と選び直したときに A の FAX が残る取り違えを防ぐためで、入力済みの欄を上書きするときは
  確認ダイアログが出ます。医療機関項目に指定していない欄（診療科名・担当医師名など）は手入力のまま残ります。
- 保存時の検査で、医療機関の項目は「短文入力・複数行テキスト」「グループの直下」に限り、
  計算式・正規表現制約との併用は弾きます（前者は式の評価結果で上書きされ、後者は流し込んだ値が
  制約に合わずに保存できなくなるため）。
- JASPEHR は `item.type = "reference"` を禁止しているため、**選択結果は文字列としてコピーされるだけ**で、
  「どの Organization を選んだか」は回答に保存されません。後から機械的に辿りたい場合は、
  保険医療機関番号の項目（必要なら hidden）を用意してください。
- 回答の内容表示（読み取り専用）ではボタンは出ません。テンプレートのプレビュー画面では動かして確認できます。
- 自院のように毎回同じ医療機関が入る欄は、選択ボタンではなく
  [ログイン中の医療従事者からの自動入力](#ログイン中の医療従事者からの自動入力)を設定できます
  （ログイン中の医療従事者の所属医療機関が入ります）。

## 医療従事者（Practitioner）

「マスタメンテ > 共通 > 医療従事者」（`/practitioners`）で、上流 FHIR サーバーの Practitioner を
一覧・登録・編集・削除できます。JP Core の `JP_Practitioner` プロファイルを想定した項目構成です。
自院が設定済みなら**自院スタッフ専用**の画面で、所属は自院で固定されます（他院の医師は
「マスタメンテ > 連携先 > 連携先医師」）。

| 画面項目 | FHIR 要素 |
|---|---|
| 氏名（漢字・必須） / 氏名（カナ） | `name`（`iso21090-EN-representation` が `IDE` / `SYL`。患者と同じ表現） |
| 医籍登録番号 | `qualification`（`identifier.system` は `http://jpfhir.jp/fhir/core/mhlw/IdSystem/medicalRegistrationNumber`、`code` は `JP_MedicalLicenseCertificate_CS|medical-registration`） |
| 性別 / 生年月日 | `gender` / `birthDate` |
| 有効 | `active` |
| 電話番号 / メールアドレス | `telecom`（`system=phone` / `system=email`） |
| 職種 / 所属医療機関 | 別リソース `PractitionerRole` の `code` / `organization`（下記） |

- JP Core 上、Practitioner に必須項目はありません（`gender` / `birthDate` は値がある場合だけ書式検証）。
  画面では氏名（漢字）の姓・名いずれかを必須にしています。
- 医籍登録番号は JP Core が指定する置き場所どおり `qualification` にのみ書きます。上流の `identifier`
  検索は `qualification[].identifier` も索引するため、番号での検索はそのまま効きます（読み出しは
  `qualification` を優先し、他システム由来のデータのためにトップレベル `identifier` もフォールバックで見ます）。
- 検索は氏名（漢字・カナの部分一致）と医籍登録番号。更新は他画面と同じく `If-Match` による楽観ロックです。
- 上流 FHIR サーバーを直接操作するため、backend の管理API（`ADMIN_TOKEN`）の対象外です。

### 職種・所属医療機関（PractitionerRole）

FHIR では職種・所属は Practitioner ではなく `PractitionerRole` に持ちます。画面では医療従事者フォームの
一部として一体で扱い、1 人につき次の 2 種類を登録します。

- **所属ロール** … 1 件。`organization` は医療機関（自院スタッフなら自院、連携先医師なら他院）。
  「職種・所属」欄がこれにあたり、兼務は表現できません。
- **診療科ロール** … 0〜N 件。`organization` は診療科 Organization で、うち 1 件が既定診療科。
  自院スタッフの「所属診療科」欄がこれにあたります（連携先医師には持たせません）。

両者はローカル拡張 `http://fhir-client.local/StructureDefinition/practitioner-role-primary-department`
の有無で区別します（既定診療科だけ `valueBoolean = true`）。診療科は医療機関と同じ Organization なので、
`organization` の参照先だけでは判別できないためです。カルテ画面ヘッダーの依頼科・依頼医師
（`OrderContextPicker`）は、この診療科ロールと自院設定から選択肢を組み立てます。医師以外の
ログインは代行入力として指示医師も選び、入力した本人と指示医師の承認は `Provenance` に残します
（「代行入力の記録と承認」）。

- 職種は `PractitionerRole.code`。コードは独自の CodeSystem
  `http://fhir-client.local/CodeSystem/practitioner-role` で、**HPKI（厚労省認可、MEDIS 運営）が
  電子署名の対象とする国家資格 27 種**に揃えています（医師 `doctor` / 歯科医師 `dentist` /
  薬剤師 `pharmacist` / 看護師 `nurse` / 保健師 `public-health-nurse` / 助産師 `midwife` /
  診療放射線技師 `radiological-technologist` / 臨床検査技師 `medical-technologist` /
  衛生検査技師 `laboratory-technician` / 臨床工学技士 `clinical-engineer` / 理学療法士 `physio` /
  作業療法士 `occupational` / 言語聴覚士 `speech` / 視能訓練士 `orthoptist` /
  義肢装具士 `prosthetist` / 歯科衛生士 `dental-hygienist` / 歯科技工士 `dental-technician` /
  管理栄養士 `dietitian` / 救急救命士 `emergency-technician` / 社会福祉士 `social-worker` /
  精神保健福祉士 `psychiatric-social-worker` / 介護福祉士 `care-worker` / 公認心理師 `psychologist` /
  柔道整復師 `judo-therapist` / あん摩マッサージ指圧師 `massage-practitioner` / はり師 `acupuncturist` /
  きゅう師 `moxibustionist`）。これに国家資格ではない事務職員 `clerk` と
  医師事務作業補助者 `medical-clerk` を加えています。
  - 標準のコード表を使っていないのは、使えるものが無いためです。JP_PractitionerRole の binding は
    `JP_PractitionerRole_VS` への **preferred**（上流はコード値を検証しません）ですが、この値セットが
    include している `JP_PractitionerRole_CS` は JP Core の IG に同梱されておらず未公開です。
    SS-MIX2 の `JSHR004 医療従事者の職種コード` は 7 コードしかなく、しかも
    「依頼医師 `DR-01` / 実施医師 `DR-02` / 実施技師 `TC-01`」のようにオーダー内の役割寄りで、
    診療放射線技師・臨床検査技師などを区別できません。JP Core がコード表を公開したら差し替えます。
  - HL7 の `http://terminology.hl7.org/CodeSystem/practitioner-role` は使いません。実際に定義されている
    コードは `doctor` / `nurse` / `pharmacist` / `researcher` / `teacher` / `ict` の 6 つだけで、
    歯科医師や療法士を表せないためです。
- 所属医療機関は `PractitionerRole.organization`。自院設定済みなら自院で固定され、連携先医師のときだけ
  検索モーダル（自院を除いた一覧）から選びます。`reference` に加えて `display` にも名称を入れます
  （一覧で Organization を引き直さずに表示するため）。
- 保存は **Practitioner と PractitionerRole を 1 つの transaction Bundle** で行います（新規作成時は
  `urn:uuid` を介して参照を解決）。職種・所属を両方空にして保存すると PractitionerRole は削除され、
  医療従事者を削除するとぶら下がる PractitionerRole も同じ Bundle で削除されます。
- 一覧は自院設定があれば `PractitionerRole?organization=<自院>&_include=PractitionerRole:practitioner`
  で引きます。所属ロールしか一致しないので、所属診療科の列を埋めるために
  `_revinclude:iterate=PractitionerRole:practitioner` で本人の残りのロールまで辿ります。自院未設定の
  環境では従来どおり `Practitioner?_revinclude=PractitionerRole:practitioner` です。
- 勤務期間（`period`）は未対応です。

### テンプレートへの一括入力

医療機関と同じ仕組みで、テンプレート編集画面の**拡張設定**から短文入力・複数行テキストの項目に
**「医療従事者の項目」** を設定すると、そのグループの枠内に「医療従事者選択」ボタンが出ます。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-practitioner-field
valueCode     : name | kana | medicalRegistrationNumber | role | organizationName | phone | email
```

- 職種・所属医療機関の値は選択した医療従事者の `PractitionerRole` から取ります。
- モーダルでは **氏名・職種・所属医療機関**で絞り込めます（職種・所属はプルダウン。所属は登録済みの
  医療機関の一覧から選ぶ）。職種・所属で絞る場合は
  `PractitionerRole?role=…&organization=…&_include=PractitionerRole:practitioner` を引きます。
- **同じグループで医療機関が選ばれていれば、所属医療機関のプルダウンの初期値**になります
  （そのまま開けば所属者だけが表示され、「すべて」に戻せば全件表示）。保存済み回答を開き直した直後は
  医療機関の id が分からないため、医療機関名の項目の値から名称の完全一致で引き当てます
  （同名が複数あるときは初期値になりません）。
- テンプレート側の **「職種の初期値」**（`…/questionnaire-practitioner-role-default`）を設定しておくと、
  職種プルダウンの初期値になります（例: 担当医師名の欄なら「医師」）。
- 職種・所属で絞り込んでいる間の氏名絞り込みは、1 段チェーン検索
  `practitioner.name:contains=…`（カナを含む全 name 表現に一致）で上流に渡します。
  ページングも他の検索と同様に効きます。

### ログイン中の医療従事者からの自動入力

「医療機関の項目」「医療従事者の項目」を設定した項目には、同じ**拡張設定**で
**「ログイン中の医療従事者（の所属医療機関）から自動入力」** を指定できます。設定すると、選択ボタンを
押さなくても**テンプレート登録画面を開いた時点**でログイン中のユーザーの値が入ります
（記載医師名・所属医療機関名など、毎回同じ値を手入力していた欄向け）。

```
extension url : http://fhir-client.local/StructureDefinition/questionnaire-login-autofill
valueBoolean  : true
```

- 入る値の種類は選択ボタンと同じ（`…/questionnaire-organization-field` /
  `…/questionnaire-practitioner-field` の `valueCode`）で、この拡張は「選択を待たずに入れる」かどうかだけを
  表します。どちらの項目も設定していない項目には指定できません（保存時の検査で弾きます）。
- 材料は**ログインアカウントに紐付く Practitioner**、その `PractitionerRole`（職種）、
  `PractitionerRole.organization` を辿った **Organization** です。所属医療機関が未登録なら医療機関の項目は
  入りません。**administrator でのログイン・認証なしモード**では紐付く Practitioner が無いため何も入りません。
- 入るのは**新規登録時（とプレビュー）だけ**です。保存済み回答の編集画面では、保存された値をそのまま
  復元します（後からログインユーザーの値で書き換わることはありません）。
- 入った後は手入力・選択ボタンで上書きできます。逆に、初期値・初期値式と同じ項目に設定した場合は
  自動入力の値が優先されます（ログイン側に登録が無い＝値が空のときだけ初期値が残ります）。
- 繰り返しグループでは 1 件目のインスタンスにのみ入ります（初期値・初期値式と同じ扱い）。
- 記入者名（登録情報の欄）は拡張設定とは無関係に、常にログイン中の医療従事者の氏名で初期表示されます。
