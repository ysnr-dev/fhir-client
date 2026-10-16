# fhir-client

FHIR R4 サーバー(別リポジトリ `../fhir-server`)を診療データの正本とする電子カルテです。
Rails 製の backend が FHIR リクエストを上流へ中継し、国内マスタ・帳票レイアウト・施設設定などの独自データを持ちます。
React 製の frontend が FHIR R4 の JSON をそのまま組み立て/解釈します。

## 構成

```
fhir-client/
├── backend/    # Rails 8 API-only (port 3001)。/fhir/* を上流へ中継 + /master/* などの独自 API
├── frontend/   # Vite + React 19 + TypeScript (port 5173)
└── docs/       # 機能ごとの説明(features/)、設計書(*-design.md)、バックログ(*-backlog.md)
```

- FHIR リソースは backend の DB に永続化しません(常に上流へ中継)。backend の DB に置くのはマスタ・帳票レイアウトなどの独自データだけです。
- 型は `@types/fhir` の `fhir4` 名前空間を使います。
- 開発時は Vite の dev proxy が `/fhir` `/master/` などを backend へ転送するので、CORS 設定は不要です。

## クイックスタート(Docker Compose)

```bash
cd ../fhir-server && docker compose up --build    # 上流 FHIR サーバー(port 3000)
cd ../fhir-client && docker compose up --build    # db(5434) / backend(3001) / frontend(5173)
```

- 画面: `http://localhost:5173/`(開発ログイン `administrator` / `local-dev-passphrase`)
- backend テスト: `docker compose exec -e RAILS_ENV=test -e ADMIN_TOKEN= backend bundle exec rspec`
- 院内エージェント・日レセを含めた起動、ローカル(Docker なし)での起動は [docs/development.md](docs/development.md)

## 主な機能

外来・入院のカルテ(診療記録・テンプレート・経過表)、部門オーダー(処方・注射・検査・放射線・手術ほか)と部門業務、
看護(看護計画・ワークシート・看護必要度)、病棟・入退院管理、通知(Task)、帳票 PDF、データ抽出・ダッシュボード・DPC、
レセコン連携。

## ドキュメント

機能ごとの説明(画面のふるまいと FHIR リソースの持ち方)は `docs/features/` にあります。

| ドキュメント | 内容 |
|---|---|
| [development.md](docs/development.md) | 起動方法(Docker Compose・任意の profile・ローカル)、テスト、動作確認の記録 |
| [features/home.md](docs/features/home.md) | ホーム(トップページ)、掲示板 |
| [features/karte.md](docs/features/karte.md) | カルテ画面(タブ・時系列・左ペイン・右ペイン)、退院時サマリー、Web 問診の取込、ファイル取込 |
| [features/orders-common.md](docs/features/orders-common.md) | オーダーの日付、代行入力と承認、カウンターサイン、日付未定オーダー、オーダーセット、レジメン・クリニカルパスのマスタ |
| [features/medication.md](docs/features/medication.md) | 処方、疑義照会、持参薬、服薬指導、薬剤付加情報、ロット番号、注射 |
| [features/lab.md](docs/features/lab.md) | 検体検査の結果項目マスタ、パニック値、既読、基準値と H/L、報告区分、結果取込、読影・所見レポート |
| [features/notifications.md](docs/features/notifications.md) | 通知(Task)の種別と画面 |
| [features/nursing.md](docs/features/nursing.md) | 看護計画・看護サマリー・看護プロファイル・ワークシート・看護必要度・チーム医療・褥瘡、看護マスタ |
| [features/templates.md](docs/features/templates.md) | シェーマ、テンプレートカテゴリ・入出力、帳票 PDF、基礎データ・初期計画、項目コード、回答の複写、Observation 生成 |
| [features/patient-profile.md](docs/features/patient-profile.md) | 患者の基本情報、血液型・身長体重・妊娠・感染症、診療上の注意(Flag)、病名の区分 |
| [features/facility.md](docs/features/facility.md) | 自院と連携先、施設設定、医療機関(Organization)、医療従事者(Practitioner / PractitionerRole) |
| [features/ward.md](docs/features/ward.md) | 病棟・病室・ベッド(Location)、入院患者一覧、病棟マップ、ベッドスケジュール |
| [features/master-data.md](docs/features/master-data.md) | マスタデータ API(医薬品・用法・頻用コード)、マスタメンテ |
| [features/data-analysis.md](docs/features/data-analysis.md) | 患者フォルダ、データ抽出、ダッシュボード、DPC |
| [features/admin-integration.md](docs/features/admin-integration.md) | 管理画面、外部システム連携、レセコン連携、サーバーの休眠と起動 |
| [demo-seed.md](docs/demo-seed.md) | デモ患者の投入ツール |
| `docs/*-design.md` | 機能ごとの設計書 |
| `docs/*-backlog.md` | 未対応の課題。上流への要望は [server-improvement-backlog.md](docs/server-improvement-backlog.md) |
