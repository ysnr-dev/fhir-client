# fhir-server 改善バックログ（将来課題）

fhir-client のワークアラウンド調査（2026-08-01）で見つかった「fhir-server 側を直した方が
効率がよい」項目のうち、**今回実装しなかったもの**の記録。実装済みの項目
（日付のみ dateTime の受理、qualification[].identifier の索引化、Questionnaire canonical の
一意制約、canonical `_include`、チェーン検索・`_sort`×`_include` の回帰 spec、
プロブレム単位の絞り込み検索と `Observation.derived-from`）については
両リポジトリのコミット履歴を参照。

各項目は「現状のワークアラウンド → 望ましいサーバー機能 → 影響範囲」の形式。

## 1. 検査結果の時系列表示のサーバー集計（Observation `$lastn` 相当）

- **現状**: `frontend/src/api/queries.ts` の `fetchLabTimelineResources` が、
  `DiagnosticReport?patient=X&category=LAB&_sort=-date&_include=DiagnosticReport:result` を
  100 件×最大 10 ページ辿り、クライアント側で JLAC11 コードごとにピボットしている
  （`buildLabTimeline`）。「直近 N 回分の採取日」が揃った時点で打ち切るが、
  最悪ケースで 10 リクエスト + 全 Observation の転送が発生する。
- **望ましいサーバー機能**: FHIR 標準の `Observation/$lastn`（patient + code 軸で
  「各コードの最新 n 件」を返す）か、それに準ずる集計 operation。
  あるいは Observation を patient + code + date 範囲で直接検索できれば、
  項目軸での取得に切り替えられる（検索パラメータ自体は `code` / `date` とも実装済みだが、
  現状クライアントは DiagnosticReport 経由でしか取得していない）。
- **影響範囲**: 時系列表示（表・グラフ）のレイテンシと転送量。患者あたりの検査結果が
  数百件を超える運用で顕著。

## 2. 検査結果詳細の前後移動のカーソル化

- **現状**: `fetchLabResultOrder` が「一覧と同じ並び順の DiagnosticReport id 列」を
  `_elements=id` で 100 件×最大 10 ページ取得し、`ids.indexOf(reportId)` で前後の id を
  求めている。「＜ ＞」ボタン 1 つのために最大 1000 件の id 走査が要る。
- **望ましいサーバー機能**: ソートキーに対するカーソル検索
  （例: `date=lt<基準値>&_sort=-date&_count=1` で「次の 1 件」）。同値タイブレークを
  id で安定させる仕様が要る（現状の `_sort` は id タイブレーク済みなので、
  `(date, id)` の複合カーソルが表現できれば成立する）。または「このリソースの前後」を
  返す小さな operation。
- **影響範囲**: 検査結果詳細画面のナビゲーション。現状は `staleTime: 30_000` で連打を
  緩和しており、通常運用では許容範囲。

## 3. 条件付き削除の複数マッチ対応（カスケード削除）

- **現状**: 「処方削除」「医療従事者削除」「検査結果削除」は、子リソースの id を
  事前 GET（`_revinclude` や `_elements=id` 検索）で集めてから transaction Bundle で
  DELETE している（削除 1 操作 = 2 往復）。
- **望ましいサーバー機能**: 条件付き削除の複数マッチ許可
  （`DELETE /MedicationRequest?based-on=ServiceRequest/X` で該当全件を削除、
  CapabilityStatement の `conditionalDelete: "multiple"`）。transaction Bundle 内の
  条件付き DELETE エントリと組み合わせれば、事前 GET なしの 1 往復で消せる。
  MedicationRequest に `based-on` 検索パラメータの追加も必要。
- **影響範囲**: 各削除操作の往復数が 2 → 1 になる。頻度が低い操作なので優先度は低め。
  複数削除は誤削除のリスクを広げるため、導入時は監査ログ（AuditEvent）での追跡性も確認する。

## 4. 未知の検索パラメータの strict 化（`Prefer: handling=strict`）

- **現状**: fhir-server は未知の検索パラメータ・`_include` トークンを**黙って無視**する
  （`Fhir::Search` が `resolve_clause` で nil をスキップ）。タイポや未対応パラメータが
  「フィルタなし全件取得」に化けるため、クライアント側の実装ミスに気づきにくい。
  今回の変更でもチェーン検索や `_include` の綴りを回帰 spec で固定して防御している。
- **望ましいサーバー機能**: FHIR 標準の `Prefer: handling=strict` リクエストヘッダ対応
  （strict 時は未知パラメータを 400 + OperationOutcome で拒否）。既定は現状どおり
  lenient のままでよい（spec 準拠）。fhir-client の backend プロキシが常に strict を
  付ければ、開発時にタイポが即座に 400 で見える。
- **影響範囲**: 不具合の早期検出。挙動変更リスクが低く費用対効果が高いので、
  次にサーバーを触るときの筆頭候補。

## 5. `ServiceRequest.orderDetail` extension のレガシー整理（fhir-client 側）

- **現状**: かつて「`MedicationRequest.basedOn` が fhir-server で検索できない」ために、
  `ServiceRequest.orderDetail[].extension`（`prescription-medication-request`）へ
  MedicationRequest の id を埋め込んでいた。現在は `_revinclude=MedicationRequest:based-on`
  が使えるようになり読み出しはそちらに移行済みだが、**書き込み側は extension を
  今も付け続けている**（`prescriptionHelpers.ts`）。一覧の「薬品数」表示が
  `sr.orderDetail?.length` に依存しているため、単純削除はできない。
- **望ましい対応**: 薬品数を `orderDetail` の件数ではなく `_revinclude` で取った
  MedicationRequest の件数（または `orderDetail` の医薬品表示文字列のみ）に変えたうえで、
  extension の書き込みを廃止する。readme の該当記述（orderDetail extension の説明）も更新する。
- **影響範囲**: データ構造の簡素化のみで機能追加はなし。既存データには extension が
  残るため、読み出しの互換は当面維持する。

## 6. `AllergyIntolerance` の発症日ソート

- **現状**: アレルギー一覧は発症日（`onsetDateTime`）を表示しつつ、検索パラメータが
  無いため記録日（`date` = `recordedDate`）でソートしている（`queries.ts` にコメントあり）。
  表示と並び順の基準がずれている。
- **望ましいサーバー機能**: `AllergyIntolerance.onset` 検索パラメータ（R4 標準）と
  抽出カラムの追加。`_sort=-onset` が使えるようになる。
- **影響範囲**: 一覧の並び順の正確さのみ。データ量が少ない画面なので優先度は低い。
