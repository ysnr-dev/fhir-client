# 検体検査の外注の設計メモ

`docs/lab-backlog.md` §B-2「外注(外部ラボ)」の設計。院内で測る項目と外部の検査センターへ出す項目を
オーダーから結果まで区別し、外注分の送り出しと結果の未着を追えるようにする。

調査日: 2026-11-23。段階 1(マスタ)と段階 2(オーダーへの焼き付け)は同日に実装済み。段階 3 以降は未実装で、本メモの内容は設計の予定。

- **［事実］** = FHIR R4 の仕様、またはこのリポジトリ・上流の実装で確認した内容
- **［提案］** = 本ドキュメントの設計提案

---

## 1. スコープ

1. 外注先を登録し、検査項目ごとに行き先(院内 / どの外注先)を決める
2. オーダーに行き先を焼き付け、入力画面・一覧・ラベルで外注と分かるようにする
3. 同じ検体でも行き先が違えば採取管を分ける
4. 外注分の送り出しを記録し、外注伝票を刷り、結果の未着を一覧する
5. 結果の実施施設に外注先を残す

### 含めないもの

- **外注先への依頼ファイルの出力と CSV の結果取込**。相手先の仕様が決まってから(`docs/lab-result-import-design.md` §9-1)。
- **外注締切・依頼可能曜日のチェック**(`docs/functional-gap-backlog.md` の運用チェック)。
- **同一検体の複数本採取の一般化**(`docs/lab-backlog.md` C-4)。分けるのは行き先の違いだけで、本数の指定は持たない。

## 2. 段階

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 外注先の登録、項目ごとの外注先、施設の既定の外注先 | 実装済み(2026-11-23) |
| 2 | オーダーの明細に行き先を焼き付け、入力画面・カード・詳細・検体検査一覧に表示 | 実装済み(2026-11-23) |
| 3 | 採取管を行き先で分ける、ラベルに外注先を刷る | 未実装 |
| 4 | 外注検査の画面(送り出し待ち / 結果未着)、送り出しの記録、外注伝票 | 未実装 |
| 5 | 結果の実施施設(取込元の外注先・手入力の初期値・内容表示) | 未実装 |

## 3. 外注先(段階 1)

**［事実］** 連携先(他院)は上流の Organization で、自院は施設設定の `self_organization_id` が指す 1 件
(`docs/features/facility.md`)。HL7 の `organization-type` に検査センターを表すコードは無い。上流の
`Organization?type=` は `Organization.type` のどの要素のどの coding にも当たる(`resource_tokens`)。

**［提案］** 外注先は連携先の Organization に**検査委託先の印**を付けたもの。専用のテーブルは作らない。

- 印は `Organization.type` の 2 つ目の要素に、ローカルの
  `http://fhir-client.local/CodeSystem/organization-role` / `clinical-lab` で持つ。1 つ目の種別
  (`organization-type`)とは独立で、医療機関が検査を受託する場合も表せる。
- 画面は連携先医療機関の登録・編集の「検査委託先」のチェック。自院の画面には出さない。
- 選択肢は `Organization?type=…|clinical-lab&active=true`(`useClinicalLabOptions`)。

## 4. 項目ごとの行き先(段階 1)

オーダー項目マスタ(`master_lab_order_items`)が持つ。

| 列 | 内容 |
|---|---|
| `execution_type` | `in_house`(院内)/ `outsourced`(外注)/ 空(未設定 = 院内として扱う) |
| `outsource_organization_id` | 外注先の Organization.id。空なら施設の既定の外注先。外注以外では保存時に空にする |

施設設定 `lab_outsource.default_organization_id` が既定の外注先。行き先は
`outsourceOrganizationIdOf`(`fhir/labOutsourceHelpers.ts`)で決まる: 外注でなければ空、外注なら
項目の外注先、無ければ施設の既定。どちらも無い外注項目は行き先が空になり、院内と同じ扱いで登録する
(既定の外注先を決めていない施設で、外注の印だけ付いた項目のオーダーを止めないため)。

## 5. オーダーへの焼き付け(段階 2)

明細の `ServiceRequest.performer` に外注先の Organization(`reference` と名称の `display`)を入れる。
院内は空のまま。既存のオーダーは `performer` が無いので院内として読める(移行は要らない)。未着の一覧を
1 回の検索で読めるよう、ヘッダにも明細の外注先を重複なしで写す(§7)。

- 行き先を決めるのはオーダー入力フォーム(`LabOrderForm` の `routedItems`)。新しく登録する明細(id 無し)に
  限り、登録時点のマスタと施設設定で決める。セット・パス・DO から来た明細も id が無いので同じ経路を通り、
  保存してあった行き先ではなく現在のマスタに従う。
- 登録済みの明細(id あり)は焼き付けた行き先を保つ。編集で項目を足すと、足した明細だけ現在のマスタで決まる。
- マスタ・施設設定・外注先の一覧を読み終えるまでは登録を止める(読み込み前に登録して院内扱いになるのを防ぐ)。
- 読み出しは `labOrderItems` が `outsourceOrganizationId` / `outsourceOrganizationName` に入れる。
  表示は `LabOutsourceBadge`、絞り込みは検体検査一覧の「実施区分」(画面側。1 日ぶんを読んだ後に絞る)。

## 6. 採取管の分割(段階 3・予定)

**［事実］** 採取管 1 本 = 検体グループ 1 つで、`groupBySpecimen` は検体コードだけでまとめる。
ラベルの二重発行は `If-None-Exist: request=…&type=…` で防いでいる(`docs/lab-arrival-design.md` §6-1)。

**［提案］** グループのキーを「検体 + 行き先」にする。管(ラベルの `Specimen`)に行き先を `identifier` で
持たせ、二重発行の条件に足す。識別子の無い既存の管は院内の管として読む。

## 7. 送り出しと未着(段階 4・予定)

**［事実］** 上流の `Specimen` 検索は `identifier` / `accession` / `status` / `type` / `subject` /
`request` / `collected` で、拡張は引けない。`ServiceRequest?performer=` は対応している。

**［提案］** 送り出しは管の `Specimen` にローカル拡張(送り出した日時・記録者)で書く。未着の一覧は
ヘッダの `ServiceRequest?performer=` に `_revinclude=Specimen:request` と結果を添えて読む。
**［事実］** `ServiceRequest?performer=` はカンマ OR が効き、型を省いた id は Organization として引ける
(2026-11-23 に開発の上流で確認)。

## 8. 結果の実施施設(段階 5・予定)

**［事実］** いまは `DiagnosticReport.performer` に自院とログインユーザーを焼き付けている
(`docs/features/lab.md`「結果に付随する情報」)。1 件のオーダーに院内と外注の項目が混ざる。

**［提案］** 項目単位の `Observation.performer` に外注先を入れる。取込は取込バッチに取込元の外注先を
持たせて引き、手入力は明細の行き先を初期値にする。
