# 麻酔科術前診察テンプレート

麻酔科医が手術の前に書く術前診察の記録。手術オーダー 1 件に回答 1 件で、回答は `basedOn` で手術オーダーを指す
(`docs/anesthesia-preop-design.md`)。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `sur-anes-preop-01.questionnaire.json` | 麻酔科術前診察 | `SUR_ANESPRE_01` / `http://fhir-client.local/Questionnaire/sur-anes-preop-01\|1.0.0` |

レイアウト(`.tlf`)・マッピング定義は無し。テンプレート一覧のインポートから取り込む。
カテゴリ **「手術」**(code `9c4e1f37-8a52-4bd6-b071-3f8e2a5c9d14`)を拡張に持たせてある。

## 構成

| グループ | 項目 |
|---|---|
| 予定 `grp-plan` | 手術予定日 / 予定術式 / 申込の麻酔方法(すべて初期値) |
| 術前評価 `grp-history` | 身長 / 体重 / 現病歴 / 既往歴 / 麻酔歴 / 悪性高熱症の家族歴 / アレルギー / 内服薬 / 喫煙 / ASA-PS / 緊急(E) / NYHA / 運動耐容能 / 評価の要点 |
| 気道 `grp-airway` | Mallampati / 開口 / 甲状頤間距離 / 頸部後屈 / 歯牙 / 予測困難気道(ありなら内容と対応) |
| 手術室への指示 `grp-room` | 麻酔法 / 気道確保 / ルート / 導入薬 / モニタ / 術後鎮痛 / 術後管理先 / 特記 |
| 病棟への指示 `grp-ward` | 最終摂食 / 最終飲水 / 前投薬 / 内服の継続・休薬 / 入室方法 / 特記 |
| 説明 `grp-consent` | 麻酔の説明 / 説明の要点 |

- 差し替えるテンプレートも `docs/anesthesia-preop-design.md` §2 の linkId を持つこと。一覧の列と手術カードの要点はこの linkId で読む。
- ASA-PS のコード(1〜5)と緊急のコード(yes / no)は `SUR_ANES_01` と揃えてある。麻酔記録と NCD の初期値はこのコードをそのまま使う。
