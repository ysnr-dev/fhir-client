---
name: update-fhir-ig
description: 実装ガイド(別リポジトリ ../fhir-ig、FSH + IG Publisher)を fhir-client の現在の FHIR 出力に合わせて更新し、SUSHI と全体ビルドの QA で検証する手順。ユーザーが「fhir-ig を更新して」「IG に反映して」「実装ガイドを最新化して」「IG をビルドして」「IG の QA を見て」のように実装ガイドの更新・ビルド・検証を明示的に頼んだときに必ず使う。fhir-client の変更で IG に載せる内容が生じただけのとき(ユーザーが IG に触れていないとき)は使わず、反映が要ることを一言添えるだけにする。
argument-hint: "[反映する範囲。省略すると前回の更新以降の差分すべて]"
---

# fhir-ig(実装ガイド)の更新

`../fhir-ig` は、fhir-client が上流 FHIR サーバーに書くリソースの仕様を FSH で記述した実装ガイド(IG)。
**IG はアプリの現状をそのまま写す文書**なので、正はいつも fhir-client のコードにある。アプリの出力が変わったら
IG を追随させ、アプリの出力が FHIR / JP Core の作法から外れていれば、IG を曲げずに `known-issues.md` に書く。

全体ビルドは 7〜12 分かかる。だから安い検査から順に通し、**全体ビルドは編集をすべて終えてから 1 回**にする
(差分の把握 → FSH の編集 → SUSHI(約 1 分)→ 全体ビルド → QA の比較)。

スクリプトは fhir-client のリポジトリ直下から `.claude/skills/update-fhir-ig/scripts/<name>` で実行する
(fhir-ig の場所が隣でないときは `FHIR_IG_DIR` で指定)。

## 1. 何を反映するか決める

ユーザーが範囲を指定していればそれに絞る。指定が無ければ、前回の IG 更新以降の差分を洗う。

```bash
.claude/skills/update-fhir-ig/scripts/app-changes.sh   # 前回の IG コミット以降に変わった組み立てコード
.claude/skills/update-fhir-ig/scripts/url-drift.py     # アプリの URL と IG の定義の突き合わせ
```

- `app-changes.sh` は fhir-ig の最終コミット日時を基準に、追加・削除された canonical の URL の行、
  `frontend/src/fhir`・`backend/app/services`・`docs/report-mappings` に触れたコミットと変更ファイルを出す。
  基準は引数で変えられる(コミットか日時)。fhir-ig に未コミットの変更が残っていれば、前回の作業が途中なので
  `git -C ../fhir-ig diff` で中身を見てから進める。
- `url-drift.py` の A(アプリにあって IG に無い URL)は必ず埋める。B(IG にあってアプリに出てこない定義)は
  アプリから消えた機能の残りなので、アプリのコードを検索して本当に無ければ IG からも消す。

一覧に出たものがすべて IG に関わるわけではない。リファクタや画面の変更が大半なので、**出力される JSON が
変わったかどうか**で選ぶ。関わるのは次のような変更:

- Extension・CodeSystem・identifier の system の URL が増えた・消えた・名前が変わった
- CodeSystem のコードや表示名(display)が増えた・変わった
- 組み立て関数(`build*` など)の出力の形が変わった: 要素の追加・削除、必ず出る ⇔ 条件付き、category の並び、
  参照先のリソース、status の取りうる値
- 新しいリソース種別・オーダー種別(`fhir/orderKinds.ts`)・通知 Task の種別
- 同梱テンプレート(`docs/report-mappings/*.questionnaire.json`)
- backend が書くリソース(連携・取込・DICOM など `backend/app/services`)
- 出力の不具合を直した(それより前に書かれたデータは古い形のまま残るので、IG に記録が要る)

読み込み・検索・表示だけの変更、コードの置き場所が変わっただけのリファクタは反映不要。ただしリファクタの
コミットでも組み立て関数に手が入っていれば、`git diff <基準> -- <path>` で出力が同じかを確かめる。

反映する項目が決まったら、編集に入る前に一覧をユーザーに短く示す(確認待ちで止まらなくてよい)。
反映するものが無ければ、ビルドせずにそう報告して終える。

## 2. アプリの出力を読む

反映する項目ごとに、組み立て関数を読んで「実際に出る JSON」を把握する。コミットメッセージや設計書ではなく
コードを根拠にする(IG の例は Publisher がプロファイルで検証するので、推測で書くとそこで食い違う)。

- 常に出る要素と、条件付きでしか出ない要素を分ける(画面で未選択にできる項目は条件付き)。
- コードの値・表示名は定数とマスタ・seed にある実際の形を写す。
- 読んでも確信が持てないときは、開発環境の実データを `/fhir` から読んで確かめる。

読んでいてアプリの出力が不具合に見えるとき(消すべきでない拡張を落としている、空の要素を書いている、など)は、
IG をその形に合わせる前にユーザーに報告する。直すなら fhir-client 側で直し、直さないなら `known-issues.md` に書く。

## 3. FSH と本文を直す

最初に `../fhir-ig/README.md` の「書き方の規約」を読む(Id の付け方、例の書き方、cardinality の決め方の正)。
既存の定義の場所は `grep -rn "<URL の末尾や Id>" ../fhir-ig/input` で探す。ファイルはドメインごとに分かれている。

| 変わったもの | 直す場所(`../fhir-ig/` から) |
|---|---|
| Extension | `input/fsh/extensions/<ドメイン>.fsh`(`Context` も)。使うプロファイルの `extension contains` と例 |
| CodeSystem・コード・表示名 | `input/fsh/terminology/<ドメイン>.fsh`(列挙は `EnumCS` + 対の ValueSet、院内マスタ由来は `MasterCS`)。system を持たない `valueCode` 用は `code-only.fsh`。別名は `aliases.fsh` |
| identifier の system | `input/fsh/namingsystems.fsh` と `input/pagecontent/guidance-identifiers.md` |
| リソースの形 | `input/fsh/profiles/<ドメイン>.fsh` と `input/fsh/examples/` の例 |
| 新しいドメイン・ページ | `input/pagecontent/<page>.md` と `sushi-config.yaml` の `pages` / `menu` |
| アプリの非準拠 | `input/pagecontent/known-issues.md` の「既知の非準拠パターン」 |
| 不具合修正で変わった出力 | 同ページの「より前に書かれたデータ」の節に古い形を足す(日付ごとの節) |
| 上流サーバーの制約 | 同ページの「上流サーバーの制約」 |

- プロファイル・拡張・用語を直したら、**対応する例と本文ページ(`pagecontent`)も同じ変更で直す**。
  具象プロファイルには例が 1 件以上要る。例は組み立て関数の出力をそのまま写し、常に出る要素を省かない。
- 定義を消すときは、参照しているプロファイル・例・本文・`aliases.fsh` も一緒に消す。
- スライス・例の拡張・親プロファイルの選び方には Publisher 特有の罠がある。新しくスライスや例を書くとき、
  または SUSHI / QA のエラーの意味が分からないときは `references/pitfalls.md` を読む。

## 4. SUSHI で検査する(約 1 分)

```bash
.claude/skills/update-fhir-ig/scripts/sushi.sh
```

ホストに node は無いので、IG Publisher のコンテナに入っている SUSHI を使う(Docker が起動している必要がある)。
末尾の `Errors` が 0 になるまで直す。Warnings も増えた分は読む(存在しない要素へのパスや、解決できない
別名はここで見つかる)。SUSHI が通らないうちは全体ビルドに進まない。

## 5. 全体ビルドと QA の比較

ビルドは `output/` を作り直すので、**始める前に**前回の QA を控える(`<scratchpad>` はセッションの一時ディレクトリ)。

```bash
.claude/skills/update-fhir-ig/scripts/qa-summary.py --save <scratchpad>/qa-before.json
```

`output/` がまだ無い(初回)ときは控えられないので、`../fhir-ig/README.md` の「公開」の節にある
「QA に残るエラー」を基準にする。

ビルドはバックグラウンドで実行する(Bash の `run_in_background`、制限時間は 40 分ほど)。終わると通知が来るので、
その間に待ちで止まらず、本文の読み直しや fhir-client 側の `readme.md` の確認を進める。

```bash
cd ../fhir-ig && ./_docker.sh > <scratchpad>/ig-build.log 2>&1
```

- 7〜12 分で終わる。30 分を超えたら異常なので、止めてログの末尾を見てユーザーに報告する(やり直しを重ねない)。
- 異常終了したらログの末尾を読む。メモリ不足なら `IG_HEAP=4g ./_docker.sh`。

終わったら前回と比べる。

```bash
.claude/skills/update-fhir-ig/scripts/qa-summary.py --compare <scratchpad>/qa-before.json
```

- **増えたエラーは 0 にする。** FSH か例の誤りなら直す。アプリの出力がそのまま非準拠なら、IG は現状のままにして
  `known-issues.md` と `README.md` の「QA に残るエラー」に足し、ユーザーに報告する。
- 増えた警告は、自分が書いたプロファイル・例に対するものを読む(スライスが評価できない、未知のコード、
  表示名の不一致は直す)。テンプレート由来の警告(HTML fragment など)は元からあるもの。
- 理由があって残す警告は `input/ignoreWarnings.txt` に理由を添えて書く。
- 消えたエラーがあれば、`known-issues.md` と `README.md` の該当の記述も消す。
- 直したら SUSHI → 全体ビルドをやり直す。細かい修正のたびにビルドせず、直す点をまとめてから回す。

ページの見た目を確かめたいときは `../fhir-ig/output/index.html`、QA の詳細は `output/qa.html`。

## 6. 報告

ユーザーに次を伝える。

- 反映した項目(アプリのどの変更に対して、IG の何を足した・直した・消したか)
- QA の件数の前後(Errors / Warnings)と、残っているエラーがすべて既知のものかどうか
- アプリ側で見つけた不具合や、判断を保留したもの
- ビルドを通していない・途中で止めた場合は、その事実と理由

**コミットと push はユーザーの指示があるまでしない。** fhir-ig は `main` への push で GitHub Actions が
ビルドし、GitHub Pages に公開する(外に出る操作)。コミットメッセージは fhir-client と同じ規約
(日本語、`feat:` / `fix:` / `docs:` / `chore:` などの接頭辞)。

書き方の新しい決まりや Publisher の罠を見つけたら、`../fhir-ig/README.md` の「書き方の規約」に足す
(次に IG を書く人が読む場所)。
