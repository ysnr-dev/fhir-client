# SUSHI / IG Publisher の罠と、このガイド固有の事情

SUSHI や QA でエラーが出たとき、または新しいプロファイル・スライス・例を書くときに読む。
書き方の規約そのものは `../fhir-ig/README.md` の「書き方の規約」が正で、ここは「なぜそう書くか」と症状からの逆引き。

## スライス

- **抽象親でスライスを宣言し、子で `contains` するとスナップショットが壊れる**(`Task.input`、`Procedure.category.coding` で発生)。
  スライスは具象プロファイルごとに宣言する。親が宣言済みのスライスを子で絞るのは問題ない。
- **discriminator が value / system のスライスは `.system =` を固定する。** `= $cs#code` の pattern だけだと
  QA が `SLICING_CANNOT_BE_EVALUATED` を出す。
- **1 つの CodeableConcept に coding を 2 つ持つ pattern** は
  `^patternCodeableConcept.coding[1].system` / `.code` で書く(クリニカルパスの `CarePlan.category`)。
- 上流サーバーが `category` の先頭しか索引しないので、種別を表す coding は先頭。プロファイルは `^slicing.ordered = true`。

## 例(Instance)

- 名前付きスライスの拡張と URL 直書きの拡張を混ぜるときは、名前付きを先に書き、直書きは `extension[1]` から番号を振る。
  `extension[0]` や `[+]` は名前付きスライスと衝突する。
- 入れ子の `Questionnaire.item.item` には親プロファイルのスライス名が効かない。拡張は URL 直書きにする。
- `display-warnings: true` でも、**pattern に入れた display の不一致はエラー**になる。CodeSystem の display は
  アプリのコードにある表示名と一字一句合わせる。
- LOINC のバイタルコード(8310-5 / 8867-4 など)を持つ Observation は FHIR 基本の Vital Signs プロファイルで自動検証され、
  `category = vital-signs` を要求される。麻酔チャートや看護観察の例は、該当しないコードを選んで避けている。
- jpfhir-terminology 1.4.0 は J-FAGY や MEDIS 看護観察などを一部のコードだけ `content = complete` で収載している。
  例には収載されているコードを使う(収載外だと「未知のコード」のエラー)。

## 親プロファイルの選び方

JP Core の定義にアプリの出力が乗らないものは、FHIR 基本定義から派生させて `known-issues.md` に理由を書いてある。
JP Core 親に付け替えるとエラーが大量に出るので、アプリ側が変わらない限り触らない。

- Observation 全般、MedicationRequest / Dispense / Administration / Statement、看護行為の Procedure、
  Questionnaire / QuestionnaireResponse

## 依存パッケージ

- `jpfhir.jp.core#1.2.0` と `jpfhir-terminology(.r4)#1.4.0` は公開レジストリに無い。`_installdeps.sh` が
  `~/.fhir/packages` に展開する(`_docker.sh` と `scripts/sushi.sh` が毎回呼ぶ)。
- `hl7.fhir.uv.sdc#3.0.0` は自動取得。
- JASPEHR と ePath は依存にしない(ePath は JP Core 1.1.2 依存で衝突する)。ePath の拡張は
  `sushi-config.yaml` の `extension-domain: http://e-path.jp` で未知の拡張として許している。
- canonical(`http://fhir-client.local/StructureDefinition/...`)の外にある拡張 URL は `special-url` に足す。

## ビルド

- IG Publisher をバインドマウント上で直接動かすと Docker Desktop for Mac では 2 時間以上かかる。必ず `_docker.sh`
  (コンテナ内ディスクにコピーしてビルドし、`output/` だけ書き戻す)を使う。
- ヒープは `IG_HEAP`(既定 3g)。メモリ不足で落ちたら `IG_HEAP=4g ./_docker.sh`。Docker Desktop のメモリは 6 GB 以上。
- ビルドが失敗するのは SUSHI のエラーと IG Publisher の異常終了だけ。QA のエラー・警告では失敗しない
  (だから QA は自分で前回と比べる)。
- GitHub Actions(`.github/workflows/publish.yml`)は `main` への push でビルドして GitHub Pages に公開する。
