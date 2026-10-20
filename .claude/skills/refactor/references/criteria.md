# 判断の細目

SKILL.md の「何を直し、何を残すか」の補足。例はこのリポジトリの実際の形に合わせてある。

## コメント

このリポジトリのコメントは日本語で「なぜそうなっているか」を書く文化で、量は多い。量を減らすこと自体は
目的ではない。**読み手が今のコードを理解するのに要らない文**を消し、要る文は現在形に書き換える。

### 消す

| 種類 | 例 | 扱い |
|---|---|---|
| 修正経緯・過去との比較 | `// 以前は Date.current を使っていたが JST で前日になるので FacilityClock に変更` | 「JST 9 時前に前日になるので FacilityClock.today を使う」に書き換える |
| 直した事実 | `// 二重予約のバグを修正`、`// #123 対応` | 消す(事実は git log にある)。直した結果に理由が要るなら理由だけ残す |
| コードの訳 | `// ステータスを completed にする` の直後に `status: "completed"` | 消す |
| 作業メモ | `// TODO: あとで共通化`、`// 要確認` | 消す。課題として残す価値があれば `docs/*-backlog.md` に 1 行(勝手に書かず報告で提案) |
| コメントアウトされたコード | `// const old = ...` | 消す(git にある) |
| 「とりあえず」「暫定」「仮実装」 | `// とりあえず文字列で持つ` | 今もそうなら「文字列で持つ(理由)」に書き換える。理由が無ければ消す |
| 自明な節見出し | `// ---- state ----` が 3 行の useState の上にある | 消す。長いファイルの本当の節見出し(`// ---- 即実施 ----` と説明文)は残す |
| 関数名を繰り返す JSDoc | `/** 患者を取得する */ function fetchPatient()` | 消す。引数の意味・戻り値の条件・副作用を書いたものは残す |

### 残す(書き換えて残す)

- そうなっている**理由**: 上流の制約(「上流の occurrence 検索は occurrenceDateTime しか索引しない」)、
  FHIR の作法(「使われなくなった枠は消さず active=false にするのが FHIR の想定」)、時差、競合、レート制限。
- **罠**: `Modal` は非ポータルなので中に `<form>` を書かない、fabric v7 の origin、`_elements` のキー名。
- 読み手が「なぜここで分岐するのか」と疑う箇所の根拠(「削除済みのプロブレムを指す URL でも記録側には表示名が残っている」)。
- 不変条件・前提(「entries は Observation より後に Specimen の削除を置く。参照が先に消えると 409 になる」)。
- 業務上の用語としての「変更前」「削除済み」「暫定報告」「対応済み」(`scan-comments.sh` はこれらも拾う)。

### 書き換えの型

経緯を含む文は「結論 + 理由」の現在形にする。

- 前: `// 以前は search で全件取ってから手元で絞っていたが、上流が department 検索に対応したので寄せた。`
- 後: `// 自科の絞り込みは上流の department 検索に任せる(手元で絞ると件数上限で取りこぼす)。`

英語のコメント(上流の `app/lib/fhir` に多い)も同じ基準。`no longer` / `previously` / `renamed` は経緯の印。

## 重複

### まとめる

- 同じ流れを部門ごとに書き写したもの。典型は部門オーダーの「実施 Bundle(実施記録一式 + Task の完了)」、
  項目レイアウト画面(`pages/*ItemLayoutPage.tsx`)、データセット画面(`pages/*DatasetPage.tsx`)、
  項目検索モーダル(`components/*ItemSearchModal.tsx`)、オーダーフォームの予約枠・病名の欄、
  `fhir/*TaskHelpers.ts`(`createTaskHelpers` に渡す設定だけが違う)、`hooks/use*OrderInitialValues.ts`、
  `components/*OrderPanels.tsx`。`compare-departments.py` で差が数十行以内なら設定方式で 1 つにできる。
  `duplicate-blocks.py` で 50 行超 × 3 ファイル以上が出るものは、ほぼ確実にまとめる価値がある。
- 同じ hook の呼び出しと後処理を複数の画面でコピーしているもの(`useMutation` の `onSuccess` の invalidate など)。
- 同じ FHIR の読み方(Bundle から型で取り出す、参照の id を取る)を各所で書いているもの。
  `fhir/shared.ts` に既にある関数(`resourcesOfType`、`withVersionLock` など)を先に探す。

### まとめ方

1. 共通化後の関数の**引数で差分を表す**。差分が「種別」なら、引数にするのではなく対応表
   (`fhir/orderKinds.ts` と `orderKindRegistry.tsx` の形)に行を足し、関数は表を引く。
2. 部門ごとの型(`RadPerformFormValues` と `PhysioPerformFormValues`)が違うなら、共通部分を型として切り出し、
   共通関数はその型だけを受ける。部門固有の項目は呼び出し側で組み立てて渡す。
3. 置く場所: 2 つ以上の部門から使う純粋関数は `fhir/` の共通ファイル(`shared.ts` は Bundle・参照・版ロックの
   汎用、`orderHeader.ts` はオーダー共通の依頼科・病棟・依頼元。該当が無ければ隣に倣って `<役割>Common.ts` を作る)。画面の部品は
   `components/` に共通コンポーネント。hook は `hooks/`。
   設定方式(部門ごとの設定を渡して関数・hook・部品を作る)の既存例を先に探し、同じ形に揃える:
   - `fhir/taskHelpers.ts` の `createTaskHelpers(config)`: 部門の Task の状態遷移
   - `api/queries/worklist.ts` の `makeUpdateTaskStatusHook` / `makePerformDetailHook` / `deleteOrderWithItems`、
     `api/queries/core.ts` の `makeOrderDetailHook`: 部門一覧の hook
   - `api/masterClient/radiotherapy.ts` の `simpleMasterClient<T>(path)` と
     `api/masterQueries/radiotherapy.ts` の `simpleMasterHooks`: マスタの CRUD クライアントと hook
   - `api/masterClient/itemLayout.ts` + `api/masterQueries/itemLayout.ts` + `pages/ItemLayoutPage.tsx`:
     部門のオーダーレイアウト(クライアント・hook・画面を部門の設定で作る)。実施入力データセットは
     `performDataset.ts` の 2 本と `pages/PerformDatasetPage.tsx` が同じ形
   - `components/DatasetPickList.tsx`、`components/TemplateTextField.tsx`: 部門をまたぐ共通部品
     (ローカルに同名のコピーを持つフォームがあれば、まずそれを共通版に置き換える)
   - `fhir/orderKinds.ts` + `components/orderKindRegistry.tsx`: 種別ごとの対応表
4. まず 1 部門を置き換えて検証し、残りを置き換える。全部置き換えたら元の関数を消し、`dead-exports.cjs` で残骸を確かめる。

### まとめない

- 似ているが業務が違う(検体検査の採血管グループと放射線の器材、処方の用法と注射の施用時刻)。
- 今は同じだが、別々に変わることが分かっているもの(設計書に別の方向が書いてある)。
- 2 か所だけで、共通化すると引数が 5 個以上になるもの(読みにくくなる)。
- CSS クラス名が部門名のまま(`rad-perform` を生理・内視鏡でも使う)でも、共通化のついでに改名しない
  (整形差分と同じ扱い。改名は別テーマで、`App.css` と全使用箇所を一度に)。
- backend のコントローラの `*_params`・`set_*`(Rails の慣習として各コントローラにあるのが自然)。
  ただし 3 つ以上の部門で全く同じ concern 相当の塊があれば `controllers/concerns/master/` に寄せる
  (`dataset_actions.rb`、`item_layout_actions.rb` がその形)。

## 未使用

| 対象 | 見つけ方 | 消すときに一緒に見るもの |
|---|---|---|
| frontend の export | `dead-exports.cjs` | 「未使用」は定義ごと、「export 不要」は `export` を外すだけ |
| frontend のローカル | `tsc -b`(noUnusedLocals) | — |
| CSS クラス | `App.css` のセレクタ名を `grep -rn "クラス名" frontend/src --include=*.tsx` | BEM の `__子` も同じ親が無ければ消す |
| Ruby のメソッド | `dead-ruby-methods.py` | `send` / `public_send` / `define_method` / `.tlf` / seed の CSV 列 |
| ルート | `backend/config/routes.rb` の各行を frontend の `api/*Client` と `grep` | controller のアクションとテスト |
| マスタの列 | migration で足したが画面も取込も使っていない列 | 消すときは migration(本番は Neon の非 pooled URL が要る) |
| 画像・テンプレート | `public/`・`lib/report_layouts/*.tlf`・`db/seed_data/` | 登録済みの帳票レイアウト(`report_layouts` テーブル)から参照されていないか |
| docs の参照 | `grep -rn "<消す名前>" docs readme.md CLAUDE.md` | 索引(`readme.md`)の行 |

消す前に必ず `grep -rn "<名前>"` を 3 リポジトリ(fhir-client、../fhir-server、必要なら ../fhir-client-agent)で回す。
通知レジストリのキー・Task のコード・Questionnaire の linkId のように**データとして上流に保存されている名前**は、
コードから消えても過去データが参照しているので、読み込み側の互換が要る(その場合はリファクタではなく仕様の話として報告)。

## 約束からの外れ(CLAUDE.md「実装上の約束」)

`scan-conventions.sh` が出すもの。直すときに振る舞いが変わるかどうかで分ける。

| 項目 | 振る舞いが変わらない直し方 | 振る舞いが変わる(別立てで報告) |
|---|---|---|
| 色の直書き | 同じ値を `index.css` の既存変数に置き換える。無い色は変数を足してライト・ダーク両方に定義 | 色そのものを変える |
| `toISOString().slice(0, 10)` | — | `today()` / `localDay()` に替えると JST 9 時前の結果が変わる(不具合修正) |
| `Date.current` | — | `FacilityClock.today` に替える(不具合修正) |
| `as any` / `@ts-ignore` | 型を正しく付けて外す | — |
| ボタンのサイズ指定 | 個別の height・padding・fontSize を外して共通スタイルに任せる(見た目が揃う方向) | — |
| 削除ボタンの「×」 | `TrashIcon` に替え、`title` と `aria-label` に「〜を削除」 | — |
| フォーム内の説明文 | 消す。意味が必要なラベルは単語 + `HelpTip`。スクリプトでは拾えないので、触るフォームを目で見る(「読み込み中…」「枠がありません」のような状態表示は説明文ではない) | — |
| 種別ごとの分岐の列挙 | 対応表に寄せる(型エラーで漏れを埋める) | — |
| `_count` > 500 | `searchAllPages` に替える | — |
| 手元の `.filter` | 上流の検索パラメータに寄せる(上流の対応を `docs/server-improvement-backlog.md` と上流の検索定義で確認) | 上流に無い → 上流に足すか backlog |

## 大きなファイルの分割

目安は 1,000 行。分割の境界:

- `pages/*Page.tsx`・`components/*Panel.tsx`: 画面の中の独立した区画(タブ・モーダル・一覧の行)を
  `components/<Name>*.tsx` に。状態の持ち主は親に残し、props で渡す。
- `fhir/*Helpers.ts`: 「読む(解釈)」「書く(組み立て)」「一覧の整形」が同居していれば、
  隣にある `*ResultHelpers.ts` / `*OrderHelpers.ts` / `*TaskHelpers.ts` の分け方に倣う。
- `api/queries/*.ts`: ドメインで分け、`index.ts` で再 export(`bb11f12a` の分割がその形)。
  分けたら `node scripts/import-cycles.cjs` で循環を確かめる。
- backend の service: 1 クラス 1 ファイル。取込は `master_import/<name>_importer.rb` の形。

分割は import の張り替えが大きい割に効果が見えにくいので、**同時に共通化や削除を伴うときだけ**行う。
分割のためだけの分割はユーザーが頼んだときに限る。例外として、1,500 行級のフォームが内部にローカルの関数
コンポーネント(`OrderFrame`、`GroupEditor` のような)を複数持ち、それが他部門のフォームにも同じ形であるなら、
それらを `components/<役割>/` に切り出すだけで分割と共通化が同時に成り立つので、積極的に行う。
本体(フォームの状態と送信)は部門ごとに残してよい。

## 上流 ../fhir-server に手を入れるとき

- 検索パラメータの追加は `app/lib/fhir/search_definitions/<resource>.rb`、索引は token 検索インデックスの
  初期化(`docs/operations.md`)が要ることがある。追加したら `docs/api-examples.md` の該当リソースにも書く。
- バリデータ・プロファイルの変更は fhir-client の出力と IG の両方に関わるので、リファクタの範囲では触らない。
- rspec は `docker compose exec web bash -c "RAILS_ENV=test bundle exec rspec spec/..."`。
- コミットは両リポジトリとも指示があるまでしない。client が上流の変更に依存するなら、報告に
  「本番は fhir-server を先に」と書く。
