# JLAC11をベースとした検体検査オーダーマスタの設計調査

調査日: 2026-08-08。事実はすべて一次資料で確認済み。

本文中の区別:
- **［事実］** = 公式資料で確認した内容
- **［導出］** = 標準仕様から論理的に導ける内容
- **［提案］** = 本レポートの設計提案

---

## 1. エグゼクティブサマリー

**結論: 「Order Concept 1 : N JLAC11」という前提の設計は実現可能であり、強く推奨できる。むしろ標準側の設計自体がこの分離を要求している。**

- ［事実］JLAC11は策定側が「**結果を重視したコード（依頼はおまけ）**」と明言しており（JSLM項目コード委員・第44回医療情報学連合大会チュートリアル）、測定法コードは**体外診断薬・機器の販売名（製品）単位**で中央付番される。実際、公開マスタではCRP=103コード、HbA1c=83コード、ヘモグロビン=107コードが併存する。JLAC11コードをそのままオーダー項目にすることは設計上不可能。
- ［事実］粒度分離は日米とも公式に確立した考え方である。日本ではJLAC10の「**オーダーは結果識別を除く15桁／結果は17桁**」運用（MEDIS・JSLM資料）、米国ではLOINCの「オーダーコードは実施された検査のコードより広くてよい」（ONC ISA）、LOINC Universal Lab Orders Value Set（1,523件）、さらに2025年のLOINC 2.81では「**結果用LOINCはオーダーには細かすぎる**」ことを理由に LABORDERS.ONTOLOGY クラス（約2,500概念）が新設されている。
- ［事実］重要な制約が2つある。(1) **JLAC11の公開マスタは電子カルテ情報共有サービス対象の43検査項目＋5感染症項目のみ**（約3,000行）で、ヘマトクリット単独や白血球分画単独のコードはまだ公開されていない。(2) JLAC11は2026年8月時点で**厚労省標準規格に未認定**（令和7年7月1日公表資料で認定方針は明示済み、2027年1〜2月頃に電子カルテ情報共有サービス全国本格運用目標）。
- ［提案］したがって実装戦略は「**Order Conceptを独立採番のマスタとして構築し、JLAC11（公開済み範囲）・JLAC10（全域カバー用）・LOINC（粒度の参考と国際相互運用用）を属性としてマッピングする**」こと。JLAC11の**測定物コード（約300）＋識別＋材料クラス＋Scaleでグループ化するとほぼそのままOrder Concept粒度になる**、というのが本調査の中心的な発見である。

---

## 2. JLAC11 / LOINC 比較表（オーダーマスタの観点から）

| 観点 | JLAC10 | JLAC11 | LOINC (2.82, 2026-02-24) |
|---|---|---|---|
| 構造 | 17桁＝分析物5＋識別4＋材料3＋測定法3＋結果識別2 | 17桁＝**測定物5（先頭英字）**＋識別4＋材料3＋測定法3＋**結果単位2** | 6軸FSN: Component:Property:Time:System:Scale:Method |
| 測定法の粒度 | 測定原理の分類（例: 271=可視吸光光度法） | **試薬・機器の販売名単位**（001〜500=体外診断薬、501〜900=機器） | Methodは**唯一null許容の軸**。「臨床的意義・基準範囲が異なる場合のみ」付与 |
| 単位 | 持たない（JLAC10不振の一因と厚労省が分析） | 結果単位コードで直接表現 | Propertyが単位系を規定（MCnc, NCnc, NFr等）、単位そのものは持たない |
| オーダー表現 | オーダー15桁／結果17桁の公式運用 | **依頼・結果とも17桁**。セット見出し＝識別9999＋結果単位00（=依頼） | 同一コードを両用（ORDER_OBS=Both）。パネルはOrder。Universal Lab Orders VS（1,523件）と LABORDERS.ONTOLOGY あり |
| パネル | セット親（2A990）＋結果識別51〜58で子を表現 | セット測定物コード（B0001等）が独立 | PanelsAndForms.csv（隣接リスト、ネスト可、R/O/C区分、PanelType 3種） |
| 付番方式 | 各施設が要素を組み合わせて生成可能 | **JLACセンター（IDIAL）中央付番**。施設は識別(共通)・材料・結果単位のみ選択 | Regenstrief中央管理、申請制 |
| 収載規模 | 17桁 約7,000（分析物約2,900） | 17桁 約7,000だが**公開は43+5項目・約3,000行のみ** | 109,325概念（Lab 66,861） |
| 標準規格 | MEDIS臨床検査マスターがHS014 | **未認定**（認定方針は公表済み） | 日本の公式スタック（JP-CLINS）には**入っていない** |
| 日本語名称 | 学会コード表に和名あり | 学会名称あり | **公式日本語訳なし**（公式翻訳21言語に日本語なし。韓国語・中国語はある） |
| 相互対応 | — | JLAC10↔11は**1:1でない**。Ver1.1で対応表掲載終了。「JLAC11→JLAC10は特定可、逆は不可」 | JLAC↔LOINCの公式対応表なし。名古屋医療センターのMITライセンス対応表が唯一の公開実用リソース |

---

## 3. Order Concept 生成ルール（統合／分離の判断基準）

［提案］（LOINCのMethod運用ルール・JLAC11の可変/不可変コード区分から導出）

### 分離キー（これが異なれば別Order Concept）

1. **測定物**（JLAC11測定物コード ≒ JLAC10分析物コード）
2. **臨床条件を表す識別（共通）**: 負荷試験（1001〜1299）、採取時間（1301〜1399）。例: 「ブドウ糖負荷後60分血糖」は「血糖」と別概念
3. **オーダー区別材料クラス**（後述）: 血液系／尿／髄液／便／穿刺液など。「蛋白（血清）」と「蛋白（尿）」は別概念
4. **Scaleクラス**: 定量（Qn）／半定量／定性（Ord）。「CRP定量」と「CRP定性」は別概念。LOINCでもScaleは必須軸
5. **臨床的意味が異なるProperty修飾**: HbA1c NGSP値 vs IFCC値（LOINCでは4548-4 vs 59261-8とComponent修飾レベルで別）はレビューのうえ分離判断

### 測定法の扱い（原則抽象化、例外あり）

- ［事実→導出］JLAC11の測定法は製品単位なので**必ず抽象化する**（さもないとCRPが103項目になる）。JLAC10の測定法（原理分類）も原則抽象化。
- ［提案］例外＝分離する条件。LOINC Users' Guide 2.7の基準「**同じComponentを測る検査間で臨床的意義または基準範囲が異なる場合のみMethodを区別**」をそのまま採用する:
  - LOINCが慣行的にMethodを保持するドメイン（微生物・血清学・免疫化学・凝固）で、Method違いが感度・特異度に影響する場合
  - **診療報酬上の算定項目が分かれる場合**（例: 末梢血液像（自動機械法）15点 と 末梢血液像（鏡検法）25点は別Order Concept。点数表が「オーダーとして区別すべき」ことの国内的な根拠になる）
  - 定性/半定量/定量の違いとして現れる場合（これはScaleクラスの分離で吸収）
- 判定の実務: グループ化した結果、対応するLOINCがMethod付きコードに分かれて存在し（例: 自動 vs 鏡検、culture vs NAA）、かつ結果解釈が異なるなら分離。単なる機器差（TIA vs ラテックス比濁のCRP）は統合。

### 材料の扱い（測定法より慎重に）

- ［提案］JLAC10/11の材料コード（JLAC11: 血清250、血漿240、全血(静脈・抗凝固剤入り)211、尿100…約100種）を、**2段階に写像**する:
  - **オーダー区別材料クラス**（Order Conceptの属性）: 血液／尿（随時・蓄尿は識別で分ける）／髄液／便／鼻咽頭ぬぐい…。医師が臨床的に選ぶ単位
  - **実施材料**（マッピング側の属性）: 血清か血漿か、抗凝固剤の種類か——は検査室・外注先が決める。Order Conceptでは持たず、JLAC11マッピング行に保持
- 統合してよい典型: CRPの血清023/血漿022/全血018…（JP-CLINSに5材料×11測定法で37コード）→「CRP（血液）」1概念。
- 統合してはいけない典型: 同一測定物で尿と血液（糖、蛋白、アミラーゼ）、髄液と血液。［導出］判定機械化のヒント: 材料クラスが異なればLOINCのSystem軸も必ず異なる（Ser/Plas vs Urine vs CSF）ので、LOINC対応候補のSystemが分かれるかで自動検出できる。
- グレーゾーン（レビュー送り）: 動脈血 vs 静脈血（血液ガス系）、毛細管血（SMBG系の随時血糖 `3D010129901826201` のように運用が別立ての場合）。

### 結果単位の扱い

- ［提案］原則、Order Conceptを分けない（結果側の属性）。JLAC11で同一測定物にG3（×10⁴/μL）とG5（×10⁶/μL）が併存する例は表示単位の違いにすぎない。
- 例外: 単位差が**Propertyの差**を意味する場合。%（NFr）と絶対数（NCnc）は別の結果概念（好中球%と好中球数）だが、**オーダー概念としては1つ**（白血球分画をオーダーすれば両方返る）。この区別のため、データモデルでは「結果概念」をOrder Conceptと同じテーブルの orderability=observation な行として扱う。

---

## 4. データモデル

［提案］最大のポイントは「**オーダーされる概念と結果として返る概念を同じ `lab_concepts` テーブルで管理し、`orderability` で区別する**」こと（LOINCのORDER_OBS: Order/Observation/Both/Subsetと同型）。好中球のように「単独オーダー不可・結果としてのみ存在」する概念を自然に表現でき、Panel構造が閉じる。

```text
lab_concepts                     -- Order Concept / Result Concept 統合マスタ
--------------------------------
id                  -- 独自採番（標準コードをIDにしない）
code                -- 人間可読の安定コード（例: LC-CRP-QN-BLD）
concept_kind        -- single | panel
orderability        -- order | observation | both   (LOINC ORDER_OBSと同型)
specimen_class_id   -- オーダー区別材料クラス（血液/尿/髄液/…）
scale_class         -- quantitative | semi_quantitative | qualitative | nominal
method_class        -- NULL原則。分離条件に該当した場合のみ（automated/microscopy/culture/NAA…）
formal_name_ja / display_name_ja / short_name
status              -- draft | in_review | active | retired
valid_from / valid_to
source              -- auto_jlac11 | auto_jlac10 | manual | standard_panel
notes

concept_names                    -- 検索用の別名（カナ・略称ゆらぎ）
--------------------------------
lab_concept_id / name_type (formal|display|short|kana|alias) / name

specimen_classes                 -- オーダー区別材料クラス
--------------------------------
id / code / name_ja

specimen_class_materials         -- JLAC材料コード → クラスの写像
--------------------------------
specimen_class_id / code_system (jlac10|jlac11) / material_code

concept_jlac11_maps              -- 1 Order Concept : N JLAC11
--------------------------------
lab_concept_id
jlac11_code (17桁) / jlac11_version
material_code / method_code / result_unit_code   -- 分解して保持（検索・検証用）
relationship        -- exact | narrower | broader
is_primary          -- 結果取込時の既定コード
mapping_status      -- candidate | reviewed | approved
mapping_confidence  -- 0.0–1.0
valid_from / valid_to / source

concept_jlac10_maps              -- 同上。order15桁とresult17桁を区別して保持
--------------------------------
lab_concept_id / jlac10_order_code_15 / jlac10_result_code_17
jlac10_version / relationship / is_primary / mapping_status / ...

concept_loinc_maps               -- N:M 許容
--------------------------------
lab_concept_id / loinc_code / loinc_status (active|deprecated|discouraged)
relationship (equivalent|narrower|broader|related)
is_primary / mapping_status / mapping_confidence / loinc_version_added

panel_members                    -- 標準的Panel構造（Panel 1:N concept、ネスト可）
--------------------------------
panel_concept_id / member_concept_id
display_order
member_type         -- required | optional | conditional | reflex  (LOINC R/O/C/Rflxと同型)

order_sets                       -- 医療機関独自セット（標準Panelとは別テーブル）
--------------------------------
id / facility_id / name / active / valid_from / valid_to

order_set_members
--------------------------------
order_set_id / lab_concept_id / display_order

mapping_reviews                  -- 自動生成→レビューのワークフロー
--------------------------------
id / lab_concept_id (nullable=新規候補)
detection_reason    -- method_divergence | specimen_ambiguous | scale_mixed |
                    -- multiple_loinc | panel_detected | jlac10_11_mismatch | unit_property_diff
payload (JSON)      -- 候補グループの根拠データ
status              -- open | approved | rejected | merged
reviewer / decided_at
```

設計判断の根拠:

- **標準的Panelとローカルセットは別概念にする**。［事実］LOINC自身がPanelType＝Panel（単一オーダー単位）と Convenience group（通常は単一ユニットでオーダーされない集合）を区別している。標準Panelは標準コード（B0001, 58410-2）にマッピングされ全施設共通、ローカルセットは施設ごとの編成で標準コードを持たない——性質が違うのでテーブルを分ける。
- **JLAC10マッピングにorder15桁/result17桁の両方を持つ**のは、JLAC10の公式運用がその形だから。
- `loinc_status` を持つのは、24318-8（Manual Differential panel）のように**DISCOURAGEDに落ちたコードを検知して張り替える**必要があるため。

---

## 5. 自動生成アルゴリズム

［提案］処理フロー（JLAC11公開分→JLAC10で補完の2系統）:

```text
入力: JLAC11コード一覧 (JSLM xlsx / JP-CLINS CodeSystem JSON)
      JLAC10コード表 第138版 + MEDIS臨床検査マスター（カバレッジ補完用）
      LOINC: Loinc.csv + PanelsAndForms.csv + Universal Lab Orders VS
      名古屋医療センター LOINC-JLAC10対応表 (MIT)

STEP 1  パース: 17桁 → {測定物/分析物, 識別, 材料, 測定法, 結果単位/結果識別}

STEP 2  正規化:
        材料コード → specimen_class（写像テーブル）
        結果単位/結果識別 → scale_class を推定
          （JLAC10: 結果識別01=定量値/11=判定 等。JLAC11: 単位が数値系か判定系か）
        測定法 → method_class（JLAC11はコード帯 980-989=鏡検 等で粗分類可能）

STEP 3  グループ化キー = 測定物 × 識別(共通・臨床条件) × specimen_class × scale_class
        → 1グループ = Order Concept候補 1件
        （例: E3019のグループ化 → 103行が「CRP/血液/定量」1候補に収束）

STEP 4  Panel検出:
        JLAC11: 識別9999＋結果単位00 → panel候補（B0001/B0007/B0008/B0009）
                一連検査（識別固有0001〜昇順の階層）→ panel + 結果概念群
        JLAC10: セット親分析物（2A990）＋結果識別(固有)51〜 → panel + member展開
        LOINC : 対応するpanelのPanelsAndForms階層と突合し member_type(R/O/C)を補完

STEP 5  名称候補: JLAC11測定物名称 → JLAC10分析物名称 → MEDIS名称 の優先順で付与

STEP 6  LOINC対応候補: 名古屋対応表 + specimen_class↔System / scale↔Scale の整合検査
        ORDER_OBS と Universal Lab Orders VS 収載有無から orderability を推定

STEP 7  レビューフラグ付与（下記条件に1つでも該当 → mapping_reviews へ）
        該当なし → status=draft で登録、レビュー後 active 化
```

**人によるレビューが必要となる条件**（自動検出ルール）:

| フラグ | 検出条件 |
|---|---|
| scale_mixed | 同一グループ内に定量と定性/判定の結果単位が混在 |
| method_divergence | LOINC対応候補がMethod付きコードに分裂し、かつ微生物・血清学・凝固ドメイン、または点数表で算定項目が分かれる |
| specimen_ambiguous | 材料クラス写像が未定義、または動脈血/毛細管血など運用が分かれる材料 |
| multiple_loinc | LOINC候補が複数でrelationshipがequivalentに定まらない |
| panel_detected | Panel構造検出時（メンバー構成・R/O/C判断は必ず人が確認） |
| jlac10_11_mismatch | JLAC10系とJLAC11系のグループ化結果が食い違う（公式にも1:1対応しないため必ず発生する） |
| unit_property_diff | 単位差がProperty差（%/絶対数、NGSP/IFCC）を示唆 |

ワークフロー: **自動生成 → draft候補＋フラグ提示 → レビューUIで統合/分離/名称を確定 → 承認でactive → 以後のマスタ更新は差分取込で同じ経路**。自動生成は「初期候補の量産と更新差分の検知」に限定し、activeへの昇格は必ず人手を経由する。［導出］公開43+5項目の範囲なら自動グループ化の精度は高い（キーが明確なため）が、JLAC10全域（分析物約2,900）ではグレーゾーンが増えるので、オーダー頻度の高い項目から段階的にレビューするのが現実的。

---

## 6. Panel生成方法

- ［事実］JLAC11はセットを独立した測定物コードで持つ: **B0001**（末梢血液一般検査）、**B0007**（＋末梢血液像）、**B0008**（＋CRP）、**B0009**（＋血液像＋CRP）。見出しは識別9999＋結果単位00（=依頼）。
- ［事実］JLAC10ではセット親2A990の結果識別51〜58がRBC/WBC/Hb/Ht/PLT/MCV/MCH/MCHC、血液像2A160の結果識別51〜99に好中球（51、桿状核52・分葉核53）〜約100結果がぶら下がる。**Panel→member関係はJLAC10コード表そのものに定義済み**で、そのまま `panel_members` に変換できる。
- ［事実］LOINC側は 58410-2（CBC panel）のメンバーR/O区分（WBC〜PLTがR、RDW/PDW/MPVがO）、57021-8が58410-2を**ネスト**して含む構造、69738-3（Differential panel, method unspecified）で%がC・絶対数がOという構成が PanelsAndForms.csv から取れる。member_type（R/O/C/Rflx）の初期値はここから写せる。
- ［提案］生成手順: JLAC由来のPanel構造を骨格にし、LOINCパネルと突合してmember_typeとネスト構造を補完。**診療報酬の算定単位（末梢血液一般21点、末梢血液像15/25点）を「オーダーとして成立する粒度」の妥当性チェック**に使う。矛盾（JLACにあるがLOINCにない、逆）は panel_detected フラグでレビューへ。
- ローカルセット（「術前セット」等）は `order_sets` で施設ごとに編成し、標準Panelとは混ぜない（§4参照）。

---

## 7. 日本語名称生成方法

- ［事実］LOINCに公式日本語訳は存在しない（公式翻訳21言語に日本語なし）。独自の日本語名称は必須。
- ［提案］情報源の優先順位:
  1. **formal_name_ja**: JLAC11測定物名称（学会公式名。例「C反応性蛋白」「グリコヘモグロビンA1c(NGSP)」）→ 未公開項目はJLAC10分析物名称
  2. **display_name_ja**: MEDIS臨床検査マスターの表示名・診療報酬点数表の名称（「末梢血液一般検査」「HbA1c」）—— 現場の慣用に最も近い
  3. **short_name**: 慣用略号（CRP、HbA1c、RBC、WBC、Hb、Ht、PLT、Neut、Lymph…）—— 標準ソースがないため院内辞書として整備し `concept_names` で管理
  4. 検索用に**カナ別名**（シーアールピー、ヘモグロビン…）を alias として追加
- LOINC英語名の機械翻訳は使わない（Long Common Nameは構造確認・マッピング検証にのみ使用）。

---

## 8. サンプル: Order Concept → JLAC11 → JLAC10 → LOINC

すべて公式マスタで実在確認済みのコードのみ記載（JLAC11の17桁は多数併存するうち実在する1例を示す。「未公開」＝JLAC11公開マスタ(43+5項目)に未収載の意）。

| Order Concept | kind / orderability | JLAC11 測定物（17桁例） | JLAC10 | LOINC |
|---|---|---|---|---|
| CRP（血液・定量） | single / both | **E3019**（103コード併存。例 `E3019-0000-250-013-85`） | 分析物 **5C070**（JP-CLINSに37コード。例 `5C070000002306101`＝血清・TIA） | **1988-5**（Methodless。Both） |
| HbA1c（NGSP） | single / both | **B3009**（83コード。例 `B3009-0000-211-031-12`） | **3D046**（例 `3D046000001920402`＝HPLC。免疫法06202・酵素法27102も特定健診公式実例）※3D045(非NGSP)と別 | **4548-4**（Methodless。17856-6=HPLC等のMethod付きは結果側でのみ使用） |
| 赤血球数 | single / both | **B1001**（例 `B1001-0000-211-569-G5`） | **2A020**（単独 `2A020000001930101`／CBC内 2A990+結果識別51） | **789-8**（26453-1=Methodless併存） |
| 白血球数 | single / both | **B1002**（例 `B1002-0000-211-569-G1`） | **2A010** ※2A010=白血球・2A020=赤血球で番号が直感と逆 | **6690-2**（26464-8=Methodless、804-5=Manual） |
| ヘモグロビン | single / both | **B1004**（例 `B1004-0000-211-569-55`） | **2A030**（CBC内は2A990+53） | **718-7**（Methodless） |
| ヘマトクリット | single / both | 未公開 | **2A040**（`2A040000001930102`／CBC内 2A990+54） | **4544-3** |
| 血小板数 | single / both | **B1003** | **2A050**（CBC内 2A990+55） | **777-3**（26515-7=Methodless、778-1=Manual） |
| **末梢血液一般検査** | **panel / order** | **B0001**（`B0001-9999-211-502-00`、単位00=依頼） | **2A990**（結果識別51〜58に展開） | **58410-2** CBC panel（member: WBC/RBC/Hb/Ht/MCV/MCH/MCHC/PLT=R、RDW等=O） |
| **白血球分画** | **panel / order**（自動法と鏡検法は点数上別項目→method_classで分離） | 単独は未公開（**B0007**=CBC＋血液像として収載） | **2A160**（血液像。測定法309=自動/310=鏡検、結果識別51〜に展開） | **69738-3** Differential panel, method unspecified（24318-8/57023-4は**DISCOURAGED**なので使わない） |
| 好中球 | single / **observation**（分画のmember） | 未公開 | 2A160＋結果識別**51**（桿状核52・分葉核53） | %: **770-8** ／ 絶対数: **751-8** |
| リンパ球 | single / observation | 未公開 | 2A160＋**57** | 736-9 ／ 731-0 |
| 単球 | single / observation | 未公開 | 2A160＋**56** | 5905-5 ／ 742-7 |
| 好酸球 | single / observation | 未公開 | 2A160＋**54** | 713-8 ／ 711-2 |
| 好塩基球 | single / observation | 未公開 | 2A160＋**55** | 706-2 ／ 704-7 |

この表自体が設計の検証になっている: CRP 1概念⇔JLAC11 103コード（1:N）、CBC 1オーダー⇔結果8概念（Panel）、好中球はオーダー不可の結果概念（orderability）、%と絶対数は同一概念に2 LOINC（unit_property_diffフラグの実例）。

---

## 9. リスク・未解決事項（人手メンテが必須の部分）

1. **JLAC11マスタの未整備が最大のリスク**。公開は43+5項目のみで、Ht単独・分画単独すら未公開。順次公開待ちの間はJLAC10で骨格を作らざるを得ず、後からのJLAC11張り替えは（公式対応表が廃止されたため）人手レビューが必要。
2. **JLAC10↔JLAC11は公式に1:1対応しない**（Ver1.1で対応情報の掲載終了。「JLAC11→JLAC10は特定可、逆は不可」）。両方をOrder Conceptに独立にマッピングする本設計はこのリスクの緩和策そのもの。
3. **JLAC11の測定法は製品単位**なので、新試薬の発売・切替のたびに新17桁コードが発生する。マッピングの追加取込（差分検知→candidate→承認）を運用として常設する必要がある。JLACセンター付番待ちで公開が遅れるケースも公式に言及あり。
4. **JLAC↔LOINCの公式対応表は存在しない**。名古屋医療センターのMIT対応表＋ヒューリスティクスで候補は出せるが、equivalent判定は最終的に人。ORDER_OBSも「規範的でない最良近似」とRegenstrief自身が明言。
5. **制度の変動**: JLAC11の厚労省標準規格認定は方針公表段階（令和7年度中に運用方針決定、2027年1〜2月全国本格運用目標）。2026年は令和8年度診療報酬改定年でもあり、点数表由来の分離判断（血液像15/25点等）は改定ごとに見直しが必要。
6. **バージョン追従**: LOINCはDISCOURAGED/DEPRECATED遷移がある（分画パネル24318-8が実例）。取込時に `loinc_status` を更新し、primaryマップの張り替えをレビューに回す仕組みが必要。JLAC10コード表も第138版（2026/07）と改版が続いており、`*_version` と valid_from/to での世代管理が効く。
7. **標準コードだけでは決められない判断**: 空腹時/随時のような採取条件を別概念にするか属性にするか、動脈血/毛細管血の扱い、院内でのshort_name・カナ別名——これらは施設の運用判断であり、恒常的なマスタ委員会的レビュー体制（§5のワークフロー）を前提にすべき。

---

## 付録A: 調査で確認した主要事実（補足）

### JLAC11の構造（付番細則 Ver1.0, 2026-03）

| # | 要素 | 桁数 | 備考 |
|---|---|---|---|
| 1 | 測定物コード | 5桁 | 先頭1桁=英字大分類（A=尿・糞便等、B=血液学的、C=生化学的、D=薬物、H=内分泌、E=免疫学的、F=アレルゲン、K=輸血、V=感染症、M=微生物、P=病理、L=その他、G=遺伝学的） |
| 2 | 識別コード | 4桁 | 共通（0000=一依頼一結果、1001〜1299=負荷、1301〜1399=採取時間）／固有（測定物従属。一連検査は0001〜昇順の階層、セット見出しは9999）／ユーザー設定0901〜0999は標準コードとして使用不可 |
| 3 | 材料コード | 3桁 | 血清250、血漿240、全血(静脈・抗凝固剤入り)211、尿100 等 |
| 4 | 測定法コード | 3桁 | **測定物に従属・製品単位**。001〜500=体外診断薬、501〜900=機器、901〜979=計算法等、980〜989=鏡検法、990〜999=その他 |
| 5 | 結果単位コード | 2桁 | 単位を直接表現。00=依頼 |

- 不可変コード（施設が変更不可）: 測定物・識別(固有)・測定法。可変コード（施設が選択）: 識別(共通)・材料・結果単位。
- 付番はJLACセンター（一般社団法人 医療データ活用基盤整備機構 IDIAL）が2025年4月から実施。MEDIS臨床検査マスター維持管理業務も2025年5月にJLACセンターへ移管。

### 電子カルテ情報共有サービスのコード要件（技術解説書1.1.0版, 令和6年10月）

- 検査43項目＋感染症5項目はJLAC10またはJLAC11（FHIRのsystem識別子4区分で判別）。院内ローカルコードは常に記述。標準化不能時は `99999999999999999`。
- **LOINCは日本の公式スタックに入っていない**（JP-CLINSにバインディングなし）。
- 健診文書は特定健診第4期様式のJLAC10のみ使用可（JLAC11不可）。

### LOINCの関連仕様（Users' Guide, 2.82）

- Method: 「同じComponentを測る検査間で臨床的意義または基準範囲が異なる場合にのみ名前に含める」（2.7）。FSN中で唯一null許容。
- ORDER_OBS: Order / Observation / Both / Subset の4値。「規範的・拘束的ではなくRegenstriefによる使われ方の最良近似」（9.1.3）。
- Panel: PanelsAndForms.csv（隣接リスト: ParentID/ID/SEQUENCE、ネスト可）。member区分 R/O/C＋v2.50以降 R-a/Rflx/Rflx-a。PanelType: Panel / Convenience group / Organizer。
- LABORDERS.ONTOLOGY（v2.81新設、約2,500概念）: 「結果用LOINCはオーダーには細かすぎる」への対応。ただし「新コード単独で十分に定義されたオーダーになるとは想定していない」と明記。
- LOINC Universal Lab Orders Value Set: 1,523コード（LOINC_NUM / LONG_COMMON_NAME / ORDER_OBS）。

---

## 付録B: 主要一次資料

- [JSLM 検査項目コード委員会](https://www.jslm.org/committees/code/) — JLAC11付番細則 Ver1.0（2026-03）、JLAC11コード一覧 Ver1.1（2026-06, jlac11_3_1.1.xlsx）、JLAC10コード表 第138版（2026-07, 138jlac10_1.xlsx）
- [IDIAL JLAC11解説](https://www.idial.or.jp/jlac_eleven.html) / [JLACセンター](https://www.idial.or.jp/jlac_center.html)
- [JCMI44 チュートリアル「JLAC入門」(2024-11-21)](https://www.idial.or.jp/tutorial/pdf/jcmi44-tutorial_20241121_jlaclecture_2.pdf) / [JCMI45 (2025-11-12) 講演1](https://www.idial.or.jp/tutorial/pdf/jcmi45-tutorial_20251112_jlaclecture_1.pdf) / [講演2](https://www.idial.or.jp/tutorial/pdf/jcmi45-tutorial_20251112_jlaclecture_2.pdf)
- [厚労省 電子カルテ情報共有サービス技術解説書 1.1.0版（令和6年10月）](https://www.mhlw.go.jp/content/10800000/001315943.pdf)
- [厚労省 電子処方箋・電子カルテの目標設定等について（令和7年7月1日）](https://www.mhlw.go.jp/content/10808000/001511375.pdf)
- [XML用特定健診項目情報](https://www.mhlw.go.jp/content/12400000/001082794.pdf)
- [JP-CLINS 実装ガイド](https://jpfhir.jp/fhir/clins/ig/) — JLAC10/JLAC11 CoreLabo CodeSystem
- [HELICS採択リスト](https://square.umin.ac.jp/helics/html/helicsStdList.html)
- [MEDIS 標準マスター総合サイト](https://www.medis.or.jp/4_hyojyun/medis-master/index.html)（臨床検査マスター=HS014）
- [LOINC Users' Guide](https://loinc.org/kb/users-guide/) — 2.7 Method / 7 Panels / 9.1.3 ORDER_OBS / 13 Orderable grouper concepts
- [LOINC 2.82 Release Highlights](https://loinc.org/news/loinc-version-2-82-release-highlights/)
- [LOINC Universal Lab Orders Value Set CSV（NLM/LHNCBC）](https://lhncbc.nlm.nih.gov/assets/legacy/files/LOINCUniversalLabOrdersValueSet.csv)
- [ONC ISP: Representing Laboratory Test Ordered](https://isp.healthit.gov/representing-laboratory-test-ordered)
- [名古屋医療センター 情報システム研究室（LOINC-JLAC10対応表, MIT License）](https://nagoya.hosp.go.jp/crc/departments/information_system_research/)
- [JAHIS 臨床検査データ交換規約 Ver.5.0C（2024-07）](https://www.jahis.jp/standard/detail/id=1103)
- [GemMed: 電子カルテ情報共有サービスの進捗（2026-01）](https://gemmed.ghc-j.com/?p=72122)
