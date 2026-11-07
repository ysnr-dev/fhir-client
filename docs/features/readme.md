# 機能ごとの説明

画面のふるまいと FHIR リソースの持ち方を機能ごとにまとめた文書です。設計の詳細は `docs/*-design.md`、オーダーの業務フローは [order-flows/readme.md](../order-flows/readme.md) を読みます。

| 文書 | 内容 |
| --- | --- |
| [home.md](home.md) | ホーム(トップページ)、掲示板 |
| [karte.md](karte.md) | カルテ画面(タブ・時系列・左ペイン・右ペイン)、退院時サマリー、Web 問診の取込、ファイル取込 |
| [outpatient.md](outpatient.md) | 外来患者一覧(受付・受付番号・診察開始)、待合表示板 |
| [orders-common.md](orders-common.md) | オーダーの日付、代行入力と承認、カウンターサイン、日付未定オーダー、オーダーセット、レジメン・クリニカルパスのマスタ |
| [medication.md](medication.md) | 処方、疑義照会、処方監査、持参薬、服薬指導、薬剤付加情報、ロット番号、注射 |
| [lab.md](lab.md) | 検体検査の結果項目マスタ、パニック値、既読、基準値と H/L、報告区分、結果取込、読影・所見レポート |
| [notifications.md](notifications.md) | 通知(Task)の種別と画面 |
| [nursing.md](nursing.md) | 看護計画・看護サマリー・看護記録(フォーカスチャーティング)・看護プロファイル・ワークシート・看護必要度・チーム医療・褥瘡・留置物、看護マスタ |
| [templates.md](templates.md) | シェーマ、テンプレートカテゴリ・入出力、文書作成(Word / Excel・様式)、帳票 PDF、基礎データ・初期計画、項目コード、回答の複写、Observation 生成 |
| [patient-profile.md](patient-profile.md) | 患者の基本情報、血液型・身長体重・妊娠・感染症、感染症の発生届、診療上の注意(Flag)、病名の区分 |
| [oral-exam.md](oral-exam.md) | 口腔診査情報(JDAOES 準拠の歯式図と診査ごとのスナップショット) |
| [facility.md](facility.md) | 自院と連携先、施設設定、医療機関(Organization)、医療従事者(Practitioner / PractitionerRole) |
| [ward.md](ward.md) | 病棟・病室・ベッド(Location)、入院患者一覧、病棟マップ、ベッドスケジュール |
| [master-data.md](master-data.md) | マスタデータ API(医薬品・用法・頻用コード)、マスタメンテ |
| [data-analysis.md](data-analysis.md) | 患者フォルダ、データ抽出、分析ダッシュボード、DPC、院内がん登録、NCD 症例登録 |
| [admin-integration.md](admin-integration.md) | 管理画面、外部システム連携、レセコン連携、サーバーの休眠と起動 |
