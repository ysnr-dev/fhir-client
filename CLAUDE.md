# CLAUDE.md

電子カルテ(FHIR R4 クライアント)。上流 FHIR サーバー(別リポジトリ `../fhir-server`)への中継と、
国内マスタ・帳票などの独自データを持つ Rails backend、React frontend の 2 層構成。
仕様の正典は `readme.md`(機能ごとの節)と `docs/*-design.md`。着手前に該当節を読むこと。

## 構成

```
backend/   Rails 8 API-only (port 3001)
  app/controllers/fhir_proxy_controller.rb  /fhir/* を上流へ中継(FhirGateway)。FHIR リソースは自前 DB に保存しない
  app/controllers/master/                   /master/* 国内マスタ(JSON REST, snake_case, {error}/{errors} 形式)
  app/controllers/{admin,auth,reports,imaging,integrations}/
  app/services/                             FhirGateway, マスタ取込(master_import), 帳票(ThinReports), DICOM, レセコン連携
  lib/report_layouts/                       帳票レイアウト(.tlf)
  db/seed_data/                             seed 同梱のマスタ CSV
frontend/  Vite + React 19 + TypeScript (port 5173)
  src/api/fhirClient.ts                     FHIR 呼び出しの唯一の入口(search/read/create/update/delete/postBundle)
  src/api/queries/*.ts                      TanStack Query の hook(ドメインごと、index.ts で再 export)
  src/api/masterClient/, masterQueries/     /master/* 用
  src/fhir/*Helpers.ts                      FHIR リソースの組み立て・解釈(純粋関数)
  src/components/, src/pages/, src/hooks/   画面
  src/demo-seed/                            デモ患者投入ツール(docs/demo-seed.md)
docs/      設計書(*-design.md)、バックログ(*-backlog.md)、server-improvement-backlog.md(上流への要望)
```

- 型は `@types/fhir` の `fhir4` 名前空間を使う。FHIR JSON はフロントで直接組み立てる。
- dev では Vite proxy が `/fhir` `/master/` `/admin` `/auth` `/reports` `/imaging` `/integrations/` などを backend へ転送する。
  backend に新しいトップレベルパスを足したら `frontend/vite.config.ts` と本番の `render.yaml` の rewrite の両方に追加する。

## 開発環境(Docker Compose)

- 上流 fhir-server を先に起動(`../fhir-server` で `docker compose up`、port 3000)。その後このリポジトリで `docker compose up -d`。
- ポート: backend **3001** / frontend 5173 / db 5434。**3000 は上流 FHIR サーバー**(`/master` が 404 なら 3000 を叩いていないか疑う)。
- 開発ログイン: `administrator` / `local-dev-passphrase`(compose の `ADMIN_TOKEN`)。
- ソースはボリュームマウント済みで再ビルド不要。ただし:
  - backend の Gemfile 変更はイメージ再ビルドが必要。Gemfile.lock の PLATFORMS に `aarch64-linux` が要る
  - migration 後は backend を再起動(スキーマキャッシュで 500 になる)
  - frontend の依存追加はコンテナ内で `npm install` してから restart
  - ホスト側の編集が HMR に反映されない／古い変換結果が返るときはコンテナ内でファイルを `touch`。Vite が落ちていたら `docker compose up -d frontend`
- seed やマスタ取込はコンテナ内で実行する(ホストから実行すると別 DB に入る)。
- 任意 profile: `agent`(院内エージェント `../fhir-client-agent`)、`orca`(日レセ `../weborca-dev`)。readme「任意の profile」参照。

## 検証コマンド

```bash
# backend テスト(RAILS_ENV=test と ADMIN_TOKEN の無効化が両方必要。無いと 403 / 401 で全滅)
docker compose exec -e RAILS_ENV=test -e ADMIN_TOKEN= backend bundle exec rspec [spec/path]

# frontend 型チェック(必ず -b。--noEmit は 0 ファイル検査で常に通る)
docker compose exec frontend npx tsc -b

# lint
docker compose exec frontend npm run lint

# import 循環の確認
docker compose exec frontend node scripts/import-cycles.cjs src/api/queries
```

- frontend にユニットテストは無い。動作は画面で確認する(ブラウザ自動化可)。
- コンテナの prettier は使わない(既定 80 桁でリポジトリと合わず大量差分になる)。整形は周囲のコードに合わせる。

## 上流 FHIR サーバーとの付き合い方

- 検索は既定で **lenient**:未対応パラメータは黙殺され全件が返る。新しい検索パラメータを使うときは上流の対応を確認する。
- 絞り込み・並べ替え・結合は可能な限り上流に任せる(`_include` / `_revinclude[:iterate]` / `:not` / カンマ OR / `_summary=count`)。
  手元でのフィルタや N+1 の read を足さない。上流に足りない機能は `docs/server-improvement-backlog.md` に記録する。
- `_count` の上限は 500。全件を読むときは `searchAllPages` を使う(`_include` 行は件数に数えない。続きの有無は `link[next]`)。
  上限(`maxPages`)で欠けた結果を使えない読み込み(有無の判定・合計・打ち切りの対象)は `complete: true` を付け、
  画面に並べるだけの読み込みは `truncated` を `TruncatedNotice` で出す。黙って切らない。
- `_elements` は JSON キー完全一致(choice 型は `effectiveDateTime` など実キー名)。
- 日付の検索値はタイムゾーン無しで渡してよい(上流が Asia/Tokyo で解釈)。
- レート制限は 1 トークン 300 件/分。まとめて書くときは transaction Bundle にし、hook の連続呼び出しで読み直しを積み重ねない。
- transaction Bundle でオーダーヘッダを書くときも `fullUrl` を必ず付ける(漏れると来歴とパス参照が付かない)。
- 楽観ロックは `If-Match`(ETag)。単体の更新は `FhirResult.etag` を引き回す。transaction の PUT は、読んだリソースを
  書き換えて送れば `postBundle` が版(`meta.versionId`)を `ifMatch` に添える。フォームから組み直す更新は
  `withVersionLock(bundle, 元のリソース)`(`fhir/shared.ts`)。版違いは 412。
  編集フォームの元データは `useEditSnapshot`(`hooks/`)で開いた時点の版に固定する(読み直された版で保存させない)。

## 実装上の約束

- 「今日」は `lib/dates` の `today()` を使う。`toISOString().slice(0, 10)` は JST 9 時前に前日になるので禁止。
  日時を書くときは `nowFhirDateTime()` / `toFhirDateTime()`(オフセット付き)、読むときは `localDay()`。
  backend の `Date.current` も UTC なので使わず、`FacilityClock.today`(日本時間)か画面から渡した日付を使う。
- 色はテーマ変数(`index.css` の `:root` / `:root[data-theme="dark"]`)を使い、直書きしない。
- コメントには現状の意図だけを書く。修正経緯や過去との比較(「〜に変更」「以前は〜」など)は残さない。
- フォームには項目ラベルと入力欄だけを置く。説明文・補足文・注意書きは書かない。
- ボタンの名称はできるだけ単語で書く(「登録」「取消」「実施」など。「〜を取り消す」のような文にしない)。
- ボタンは大きくしすぎない。処方オーダー(`PrescriptionForm`)と同じ大きさを上限の目安にする。
  主ボタンは全体共通の `button` スタイル(`--control-height` 34px・文字 15px。単独の主ボタンのみ `--control-height-lg`)、
  カード内の補助ボタンは `rp-card__compact-button` 相当(文字 13px)、アイコンだけのボタンは `rp-card__icon-button` 相当。
  個別に height・padding・font-size を大きくする指定は足さない。
- `Modal` はポータルではない。フォーム内のモーダルに `<form>` を書かない(外側がネイティブ submit される)。
- 1 行に収まらないトグル類は行のケバブメニュー(RowMenu)に畳む。
- 通知は Task に統一。種別を足すときはレジストリに 1 要素足す。
- fabric.js v7 は originX/originY の既定が center。生成時に left/top と origin を明示する。

## 作業の進め方

- **ユーザーの指示があるまで git commit しない。**
- コミットメッセージは日本語で `feat:` / `fix:` / `change:` / `style:` / `refactor:` / `chore:` / `docs:` / `remove:` 接頭辞。
- 機能を足したり振る舞いを変えたら `readme.md` の該当節(必要なら `docs/*-design.md`)も更新する。
- 開発環境のデータは確認なしで自由に修正・投入して検証してよい。ただし日付範囲での一括削除はしない(上流は `_history` から PUT で戻せる)。
- 上流サーバーの変更が必要な場合は `../fhir-server` 側で行い、rspec はそのコンテナ内で実行する。本番デプロイは fhir-server を client より先に。
- 実装ガイド(`../fhir-ig`)はビルドが重いので、明示指示があるときだけ触る。
- 本番は Render(`render.yaml`)。本番 DB の migration は Neon の非 pooled URL が必要。一回限りのデータ処理は migration に畳み込む。
