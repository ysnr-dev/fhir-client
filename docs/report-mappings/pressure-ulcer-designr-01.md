# 褥瘡 DESIGN-R評価(PU_DESIGNR_01)

褥瘡管理(`docs/care-team-design.md` §6)の評価テンプレート。テンプレート一覧のインポートから取り込み、
施設設定「褥瘡管理」の DESIGN-R 評価のテンプレートに url を設定する(既定はこの url)。

| ファイル | テンプレート | name / canonical |
|---|---|---|
| `pressure-ulcer-designr-01.questionnaire.json` | 褥瘡 DESIGN-R評価 | `PU_DESIGNR_01` / `http://fhir-client.local/Questionnaire/pressure-ulcer-designr-01\|1.0.0` |

カテゴリ **「褥瘡」** を拡張に持たせてある(code `3f0c9a52-7d61-4b8e-9a2c-5e1b7c4d8f02`。別環境へ入れるときは
`questionnaire_categories` に同じ code でカテゴリを作るか、作った code へ差し替える)。帳票(`.tlf`)は無い。

## 項目(linkId は褥瘡管理が読むので変えない)

| グループ | linkId | 項目 | 選択肢(コード) | Observation |
|---|---|---|---|---|
| 創 | `pu_site` | 部位 | sacrum 仙骨部 / coccyx 尾骨部 / ischium 坐骨部 / trochanter 大転子部 / heel 踵部 / other その他 | `NURS-PU-SITE` |
| | `pu_site_other` | 部位の名称(その他のとき) | | |
| | `pu_onset_kind` | 発生区分 | brought 持込 / acquired 院内発生 | `NURS-PU-ONSET-KIND` |
| | `pu_onset_date` | 発生日 | | |
| | `pu_state` | 状態 | open 継続 / healed 治癒 | `NURS-PU-STATE` |
| | `pu_healed_date` | 治癒日 | | |
| DESIGN-R 2020 | `designr_d` | 深さ | d0 d1 d2 D3 D4 D5 DDTI DU | `NURS-PU-DESIGNR-DEPTH` |
| | `designr_e` | 滲出液 | e0 e1 e3 E6 | `NURS-PU-DESIGNR-EXUDATE` |
| | `designr_s` | 大きさ | s0 s3 s6 s8 s9 s12 S15 | `NURS-PU-DESIGNR-SIZE` |
| | `designr_i` | 炎症・感染 | i0 i1 I3C I3 I9 | `NURS-PU-DESIGNR-INFLAMMATION` |
| | `designr_g` | 肉芽組織 | g0 g1 g3 G4 G5 G6 | `NURS-PU-DESIGNR-GRANULATION` |
| | `designr_n` | 壊死組織 | n0 N3 N6 | `NURS-PU-DESIGNR-NECROTIC` |
| | `designr_p` | ポケット | p0 P6 P9 P12 P24 | `NURS-PU-DESIGNR-POCKET` |
| | `designr_total` | 合計(深さを除く) | 計算式(コードの数字部分の和、0〜66) | `NURS-PU-DESIGNR-TOTAL`(点) |
| | `designr_severity` | 重症度 | 計算式(大文字の項目が 1 つでもあれば 重症) | `NURS-PU-DESIGNR-SEVERITY` |
| | `designr_note` | 所見・処置 | | |

- 1 創 1 回答。評価のたびに新しい回答を書く(前回値複写が使える)。
- 変数 `%designrTotal` は `select(code.replaceMatches('[^0-9]', '').toInteger()).sum()`、`%designrSevere` は
  `select(code).where($this.matches('^[A-Z]')).exists()`。
- チャート定義プリセット「褥瘡(DESIGN-R)」が合計と 7 項目の行を出す。
