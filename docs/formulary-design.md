# 院内フォーミュラリ

薬効群ごとに推奨薬と推奨順位(第一選択・第二選択…)を定めた施設の参照表。処方・注射・レジメン編集・
持参薬の代替薬選択で、全件検索と並べてここから薬を選べるようにし、載っている薬には推奨順位を印で出す。**登録は止めない**(薬剤の安全性チェックと同じ思想。`docs/order-common-backlog.md` §3)。

## 1. 持つもの

- `master_formulary_groups` — 薬効群。`code`(一意)・`name`・`yakko_codes`(群の範囲を示す薬効分類番号 = YJ 上 4 桁の配列。マスタ画面の表示用)・
  `dosage_form`(群の剤形。注射オーダーで注射薬の群だけ出す絞り込み用)・`display_order`・`note`。
- `master_formulary_entries` — 群に載せた医薬品。`medicine_code`(レセプト電算コード)・`rank`(1 = 第一選択)・`note`(推奨理由・使い分け)。
  群内で同じ薬は 1 回だけ。

医薬品は `medicine_code` で緩く紐づける。医薬品マスタは取込のたびに `delete_all` + 再挿入されて id が
変わるため(`master_medicine_dose_conversions` と同じ理由)。FK は無く、取込で消えた薬は名称が NULL で残る。

施設で 1 本。オーダーセットのような 院内共通 / 診療科 / 医師 のスコープは持たない。フォーミュラリは
薬事委員会が決めるもので、科ごとの使い分けは `note` に書く。採用区分(採用・仮採用・採用外)は持たない。

## 2. 印

医薬品検索 API(`GET /master/medicines`)が各行に相関サブクエリで `formulary_rank`(載っている群での順位。
複数の群に載っていれば最小。載っていなければ NULL)と `formulary_group_name` を添える。
画面の印(`FormularyMark`)は `formulary_rank` があるときだけ **第 n 選択** を出す。載っていない薬には何も出さない。

一般名(【般】)の行は、同じ一般名処方コードの銘柄が 1 つでも載っていれば推奨とみなし、その最小 rank を付ける。

## 3. 画面

- 医薬品の検索モーダル(`MedicineSearchModal`)に `formularyPick` を渡すと「全件検索」の隣に「フォーミュラリ」タブが出る(始まりは全件検索)。
  群ごとの見出しの下に順位順の薬剤。選ぶとコードで医薬品マスタの行を引き直してから返す(剤形・規制区分など
  呼び出し側が使う列をそろえるため)。「全件検索」タブの各行にも順位の印が付く。
- 渡している画面: 処方(`PrescriptionForm`)、注射(`InjectionForm`、注射薬の群だけ)、レジメン編集(`RegimenEditorPage`、
  段階の内服/注射で群を絞る)、持参薬の鑑別の **代替薬**(`BroughtMedicationIdentifyModal`。持参薬の特定側は他院の薬なので出さない)。
  調剤・実施入力・アレルギーなどほかの呼び出し元は全件検索のまま。
- フォームの薬剤行にも `MedicineCautionMarks` の隣に印を出す。レジメンの薬剤はコードと名称しか持たないので、
  群の一覧から順位を引いて出す(`useFormularyRankLookup`)。
- マスタ画面 `/formularies`(マスタメンテ > 医薬品 > フォーミュラリ)。左に薬効群、右に選んだ群の薬剤を順位順に。
  ↑↓で順位の入れ替え(`POST /master/formulary_entries/reorder`)、推奨理由はインライン編集、薬剤の追加は医薬品検索モーダル。

## 4. API

- `GET /master/formulary_groups?dosage_form=&name=` — 群を表示順で全件(ページングなし)。各群に `entries` を
  医薬品名・単位・剤形・一般名・薬効分類名・YJ コード付きでネスト
- `POST/PATCH/DELETE /master/formulary_groups/:id` — 群の CRUD(削除は薬剤ごと)
- `POST /master/formulary_entries` — 薬剤の追加。`rank` を省くと群の末尾
- `PATCH/DELETE /master/formulary_entries/:id`
- `POST /master/formulary_entries/reorder` `{ ids: [...] }` — 並びで rank を 1 から振り直す。同じ群の薬剤だけ

## 5. 残り

- 採用区分(採用・仮採用・採用外)と採用期間。院内採用薬の一覧そのものはまだ無い
- 後発品への変更可否と組み合わせた提案(`generic_flag` は取り込んでいるが未使用)
- 処方箋・注射箋・カルテの表示側には印を出していない(オーダー入力時の判断材料に留めている)
