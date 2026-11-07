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
看護(看護計画・ワークシート・看護必要度)、病棟・入退院管理、通知(Task)、帳票 PDF、データ抽出・分析ダッシュボード・DPC、
レセコン連携。

## ドキュメント

機能ごとの説明(画面のふるまいと FHIR リソースの持ち方)は `docs/features/` にあります。

| ドキュメント | 内容 |
|---|---|
| [development.md](docs/development.md) | 起動方法(Docker Compose・任意の profile・ローカル)、テスト、動作確認の記録 |
| [features/readme.md](docs/features/readme.md) | 機能ごとの説明(画面のふるまいと FHIR リソースの持ち方)の索引 |
| [order-flows/readme.md](docs/order-flows/readme.md) | オーダー種別ごとの業務フロー(運用のアクティビティ図と開発者向けシーケンス図)の索引 |
| [demo-seed.md](docs/demo-seed.md) | デモ患者の投入ツール |
| `docs/*-design.md` | 機能ごとの設計書 |
| `docs/*-backlog.md` | 未対応の課題。上流への要望は [server-improvement-backlog.md](docs/server-improvement-backlog.md) |
