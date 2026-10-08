// 様式1 の定義表のうち、診断情報・手術情報・ADL・がん・FIM・JCS。

import {
  and,
  ageAtLeast,
  diedAtDischarge,
  emergencyAdmission,
  generalWardOnly,
  manual,
  not,
  payloadFilled,
  payloadIn,
  resourceIcdIn,
} from "../rules";
import type { Dpc1FieldDef, Dpc1Option, Dpc1Part, Dpc1RecordDef } from "../types";

const V2014 = "20140401";
const V2016 = "20160401";
const V2020 = "20200401";
const V2024 = "20240601";

const NO_YES: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
];

// ---------------------------------------------------------------------------
// 診断情報
// ---------------------------------------------------------------------------

// ICD-10 は小数点を入れずに左詰めで全桁を書く(B18.2 → B182)。5 桁まで要る分類がある。
const ICD10_PATTERN = "[A-Z][0-9]{2,4}";

// 病名付加コードの区分。上 3 桁が付加グループ、下 2 桁がグループ内の連番(付加 Seq)。
const SUFFIX_GROUPS: Record<string, Dpc1Option[]> = {
  "101": [
    { code: "10100", label: "小細胞癌" },
    { code: "10101", label: "非小細胞癌" },
    { code: "10199", label: "不明" },
  ],
  "102": [
    { code: "10200", label: "未分化癌" },
    { code: "10209", label: "その他" },
  ],
  "103": [
    { code: "10300", label: "慢性炎症性脱髄性多発神経炎" },
    { code: "10309", label: "その他" },
  ],
  "104": [
    { code: "10400", label: "特発性肺線維症" },
    { code: "10409", label: "その他" },
  ],
  "201": [
    { code: "20100", label: "頭部（頭蓋内含む） 後頭頚部 顔面" },
    { code: "20101", label: "頚部 頚胸部" },
    { code: "20102", label: "胸部 胸腰部" },
    { code: "20103", label: "腰部 腰仙骨部" },
    { code: "20104", label: "仙骨部 仙尾骨部又は仙腸骨部" },
    { code: "20105", label: "骨盤部 股関節部又は陰部" },
    { code: "20106", label: "下肢" },
    { code: "20107", label: "上肢 肩峰鎖骨部及び胸骨鎖骨部" },
    { code: "20108", label: "胸郭 肋骨肋軟骨部、肋骨椎骨部、胸骨肋軟骨部 腋下" },
    { code: "20109", label: "腹部（胃、大腸、肝含む）" },
    { code: "20190", label: "多発又は全身" },
    { code: "20199", label: "不明" },
  ],
  "202": [
    { code: "20200", label: "食道" },
    { code: "20201", label: "十二指腸" },
    { code: "20202", label: "腸管（空腸、回腸、多発性含む）" },
    { code: "20203", label: "肛門" },
    { code: "20204", label: "肝臓" },
    { code: "20205", label: "胆嚢・胆管" },
    { code: "20206", label: "膵臓" },
    { code: "20207", label: "脾臓" },
    { code: "20221", label: "胃" },
    { code: "20299", label: "不明" },
  ],
  "203": [
    { code: "20300", label: "中耳" },
    { code: "20301", label: "扁桃" },
    { code: "20302", label: "中咽頭" },
    { code: "20303", label: "鼻（上）咽頭" },
    { code: "20304", label: "梨状陥ぼつ（洞）" },
    { code: "20305", label: "下咽頭" },
    { code: "20399", label: "不明" },
  ],
  "204": [
    { code: "20400", label: "心外膜" },
    { code: "20401", label: "副腎" },
    { code: "20402", label: "精嚢" },
    { code: "20403", label: "前立腺" },
    { code: "20404", label: "精管" },
    { code: "20405", label: "腹膜" },
    { code: "20406", label: "後腹膜" },
    { code: "20490", label: "その他" },
    { code: "20499", label: "不明" },
  ],
  "301": [
    { code: "30100", label: "慢性" },
    { code: "30101", label: "急性" },
    { code: "30102", label: "慢性の急性増悪" },
    { code: "30109", label: "不明（急性、慢性の明示なし）" },
  ],
};

/** 付加グループの区分。seqs を渡すと、その連番(付加 Seq)の区分だけに絞る。 */
function suffix(group: string, seqs?: string[]): Dpc1Option[] {
  const all = SUFFIX_GROUPS[group];
  if (!seqs) return all;
  return all.filter((option) => seqs.includes(option.code.slice(3)));
}

/**
 * 病名付加コード(A006030 ペイロード 3)の選択肢。医療資源を最も投入した傷病名の ICD-10 ごとに
 * 使える区分が決まっている。patterns は icdMatches の表記("$" は以降の桁を問わない)。
 */
export const DISEASE_SUFFIX_OPTIONS: { patterns: string[]; options: Dpc1Option[] }[] = [
  { patterns: ["C340", "C341", "C342", "C343", "C348", "C349"], options: suffix("101") },
  {
    patterns: ["C445"],
    options: suffix("201", ["02", "03", "04", "05", "08", "09", "90", "99"]),
  },
  { patterns: ["C493"], options: suffix("201", ["02", "08", "90", "99"]) },
  { patterns: ["C73"], options: suffix("102") },
  { patterns: ["C783"], options: suffix("203") },
  { patterns: ["C788"], options: suffix("202", ["00", "03", "05", "06", "07", "21", "99"]) },
  { patterns: ["C792", "C795"], options: suffix("201") },
  { patterns: ["C798"], options: suffix("204", ["00", "90"]) },
  { patterns: ["C859"], options: suffix("201") },
  { patterns: ["D139"], options: suffix("202", ["02", "07"]) },
  { patterns: ["D180", "D181"], options: suffix("201") },
  { patterns: ["D213"], options: suffix("201", ["02", "08", "90", "99"]) },
  {
    patterns: ["D360"],
    options: suffix("201", ["01", "02", "03", "04", "05", "06", "07", "08", "09", "90", "99"]),
  },
  { patterns: ["D361", "D367"], options: suffix("201") },
  { patterns: ["D376"], options: suffix("202", ["01", "04", "05"]) },
  { patterns: ["D377"], options: suffix("202", ["00", "02", "03", "06", "07"]) },
  { patterns: ["D481", "D485"], options: suffix("201") },
  { patterns: ["G618"], options: suffix("103") },
  { patterns: ["I50$"], options: suffix("301") },
  { patterns: ["J841"], options: suffix("104") },
  { patterns: ["S364$"], options: suffix("202", ["01", "02"]) },
  { patterns: ["S368$"], options: suffix("204", ["05", "06", "90"]) },
  { patterns: ["S378$"], options: suffix("204", ["01", "02", "03", "04", "90"]) },
];

/** 病名付加コードを入力する ICD-10(注記 ※J)。 */
const needsDiseaseSuffix = resourceIcdIn(
  ...DISEASE_SUFFIX_OPTIONS.flatMap((entry) => entry.patterns),
);

/** 診断情報のレコードに共通の欄。nameLabel はペイロード 9 の項目名。 */
function diagnosisFields(nameLabel: string, withSuffix = false): Dpc1FieldDef[] {
  const fields: Dpc1FieldDef[] = [
    { payload: 2, label: "ICD10コード", kind: "text", pattern: ICD10_PATTERN },
  ];
  if (withSuffix) {
    fields.push({
      payload: 3,
      label: "病名付加コード",
      kind: "text",
      pattern: "[0-9]{5}",
      required: needsDiseaseSuffix,
      visible: needsDiseaseSuffix,
    });
  }
  // 傷病名マスタに無い傷病名は未コード化傷病名コード "0000999" を入れる。
  fields.push({ payload: 4, label: "傷病名コード", kind: "digits", digits: 7 });
  // 修飾語は傷病名に近いものから 4 個まで、ペイロード番号の小さい欄から詰めて使う。
  for (const payload of [5, 6, 7, 8] as const) {
    fields.push({
      payload,
      label: `修飾語コード${payload - 4}`,
      kind: "digits",
      digits: 4,
      required: "optional",
    });
  }
  fields.push({ payload: 9, label: nameLabel, kind: "text" });
  return fields;
}

// ---------------------------------------------------------------------------
// 手術情報
// ---------------------------------------------------------------------------

// 点数表コードは基本部分(K + 3 桁、枝番はハイフン付き)に細項目(1、2、ｲ、ﾛ…)を空白なしで続ける。
// 例: K0821、K082-21、K4073ｲ
const SURGERY_CODE_PATTERN = "K[0-9]{3}(-[0-9]+)?[0-9ｦ-ﾟ]*";

// ---------------------------------------------------------------------------
// ADL スコア
// ---------------------------------------------------------------------------

const ADL_UNKNOWN: Dpc1Option = { code: "9", label: "不明" };

const ADL_THREE_LEVELS: Dpc1Option[] = [
  { code: "2", label: "自立" },
  { code: "1", label: "一部介助" },
  { code: "0", label: "全介助" },
  ADL_UNKNOWN,
];

// 10 項目の値をこの順に連ねた 10 桁がペイロードの値になる。
const ADL_PARTS: Dpc1Part[] = [
  {
    label: "食事",
    options: [
      { code: "2", label: "自立" },
      { code: "1", label: "一部介助（切ったり、バターを塗ったりなどで介助を必要とする）" },
      { code: "0", label: "全介助" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "移乗",
    options: [
      { code: "3", label: "自立" },
      { code: "2", label: "一部介助（軽度の介助で可能）" },
      { code: "1", label: "一部介助（高度の介助を必要とするが、座っていられる）" },
      { code: "0", label: "全介助（座位バランス困難）" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "整容",
    options: [
      { code: "1", label: "自立（顔／髪／歯／ひげ剃り）" },
      { code: "0", label: "一部介助・全介助" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "トイレ動作",
    options: [
      { code: "2", label: "自立" },
      { code: "1", label: "一部介助（多少の介助を必要とするがおおよそ自分一人でできる）" },
      { code: "0", label: "全介助" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "入浴",
    options: [
      { code: "1", label: "自立" },
      { code: "0", label: "一部介助・全介助" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "平地歩行",
    options: [
      { code: "3", label: "自立" },
      { code: "2", label: "一部介助（一人介助で歩く）" },
      { code: "1", label: "一部介助（車いすで自立）" },
      { code: "0", label: "全介助" },
      ADL_UNKNOWN,
    ],
  },
  { label: "階段", options: ADL_THREE_LEVELS },
  { label: "更衣", options: ADL_THREE_LEVELS },
  {
    label: "排便管理",
    options: [
      { code: "2", label: "自立" },
      { code: "1", label: "一部介助（時々失敗）" },
      { code: "0", label: "全介助（失禁）" },
      ADL_UNKNOWN,
    ],
  },
  {
    label: "排尿管理",
    options: [
      { code: "2", label: "自立" },
      { code: "1", label: "一部介助（時々失敗）" },
      { code: "0", label: "全介助（失禁）" },
      ADL_UNKNOWN,
    ],
  },
];

export function adlField(label: string): Dpc1FieldDef {
  return { payload: 2, label, kind: "composite", parts: ADL_PARTS };
}

// ---------------------------------------------------------------------------
// がん患者
// ---------------------------------------------------------------------------

/** 記号そのものが提出値になる選択肢。 */
function symbols(...codes: string[]): Dpc1Option[] {
  return codes.map((code) => ({ code, label: code }));
}

// UICC TNM 分類で使われうる記号。部位によって使う記号は違うが、様式1 は記号の一覧だけを定める。
const UICC_T_OPTIONS = symbols(
  "TX",
  "T0",
  "Tis",
  "Tis（DCIS）",
  "Tis（LCIS）",
  "Tis（Paget）",
  "Tis pu",
  "Tis pd",
  "Tis（LAMN）",
  "T1mi",
  "T1mic",
  "T1",
  "T1a",
  "T1a1",
  "T1a2",
  "T1b",
  "T1b1",
  "T1b2",
  "T1c",
  "T1c1",
  "T1c2",
  "T1c3",
  "T1d",
  "T2",
  "T2a",
  "T2a1",
  "T2a2",
  "T2b",
  "T2c",
  "T2d",
  "T3",
  "T3a",
  "T3b",
  "T3c",
  "T3d",
  "T3e",
  "T4",
  "T4a",
  "T4b",
  "T4c",
  "T4d",
  "T4e",
  "Ta",
);

const UICC_N_OPTIONS = symbols(
  "NX",
  "N0",
  "N1mi",
  "N1",
  "N1a",
  "N1a（sn）",
  "N1b",
  "N1c",
  "N2",
  "N2a",
  "N2b",
  "N2c",
  "N3",
  "N3a",
  "N3b",
  "N3c",
  "N4",
);

const UICC_M_OPTIONS = symbols("MX", "M0", "M1", "M1a", "M1b", "M1c", "M1d", "M1e");

// 癌取扱い規約の Stage 分類の入力値。規約(部位)ごとに使う値は違うので、全規約の値を合わせて並べる。
// 5〜8 は悪性リンパ腫の Lugano 分類に割り当てられている。
const STAGE_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "０" },
  { code: "1", label: "Ⅰ" },
  { code: "1N", label: "ⅠNOS" },
  { code: "1A", label: "ⅠA" },
  { code: "1B", label: "ⅠB" },
  { code: "2", label: "Ⅱ" },
  { code: "2N", label: "ⅡNOS" },
  { code: "2A", label: "ⅡA" },
  { code: "2B", label: "ⅡB" },
  { code: "2C", label: "ⅡC" },
  { code: "3", label: "Ⅲ" },
  { code: "3N", label: "ⅢNOS" },
  { code: "3A", label: "ⅢA" },
  { code: "3B", label: "ⅢB" },
  { code: "3C", label: "ⅢC" },
  { code: "4", label: "Ⅳ" },
  { code: "4N", label: "ⅣNOS" },
  { code: "4A", label: "ⅣA" },
  { code: "4B", label: "ⅣB" },
  { code: "4C", label: "ⅣC" },
  { code: "5", label: "Ⅰ（悪性リンパ腫 Lugano分類）" },
  { code: "6", label: "Ⅱ（悪性リンパ腫 Lugano分類）" },
  { code: "7", label: "ⅡE（悪性リンパ腫 Lugano分類）" },
  { code: "8", label: "Ⅳ（悪性リンパ腫 Lugano分類）" },
  { code: "9", label: "不明" },
];

/** 医療資源を最も投入した傷病名が悪性腫瘍(ICD-10 の C00〜C97)。 */
const resourceIsMalignant = resourceIcdIn("C$");

/** がんの初発(CAN0010 ペイロード 3 が 0)。 */
const cancerFirstOccurrence = payloadIn("CAN0010", 3, "0");

// ---------------------------------------------------------------------------
// FIM
// ---------------------------------------------------------------------------

const FIM_SCORE_OPTIONS: Dpc1Option[] = [
  { code: "7", label: "完全自立" },
  { code: "6", label: "修正自立" },
  { code: "5", label: "監視又は準備" },
  { code: "4", label: "最小介助" },
  { code: "3", label: "中等度介助" },
  { code: "2", label: "最大介助" },
  { code: "1", label: "全介助" },
  { code: "9", label: "不明" },
];

// 18 項目の値をこの順に連ねた 18 桁がペイロードの値になる。
const FIM_PARTS: Dpc1Part[] = [
  "食事",
  "整容",
  "清拭",
  "更衣（上半身）",
  "更衣（下半身）",
  "トイレ",
  "排尿コントロール",
  "排便コントロール",
  "移乗（ベッド・車椅子）",
  "移乗（トイレ）",
  "移乗（浴槽・シャワー）",
  "移動（歩行・車椅子）",
  "移動（階段）",
  "理解",
  "表出",
  "社会的交流",
  "問題解決",
  "記憶",
].map((label) => ({ label, options: FIM_SCORE_OPTIONS }));

const WEIGHT_UNMEASURABLE: Dpc1Option[] = [{ code: "000", label: "測定不能" }];

// ---------------------------------------------------------------------------
// JCS
// ---------------------------------------------------------------------------

// 意識障害が無ければ 0。あれば意識レベルの数値に、該当する R(不穏)・I(糞尿失禁)・A(自発性喪失)を
// 続ける(例: 3A、3RI)。桁数が値によって違うので composite ではなく書式で縛る。
const JCS_LEVEL = "0|(1|2|3|10|20|30|100|200|300)R?I?A?";

const JCS_UNKNOWN: Dpc1Option[] = [{ code: "999", label: "不明" }];

export const CLINICAL_RECORDS: Dpc1RecordDef[] = [
  {
    code: "A006010",
    name: "診断情報/主傷病",
    version: V2014,
    section: "diagnosis",
    required: "always",
    custom: "diagnosis",
    fields: diagnosisFields("主傷病名"),
  },
  {
    code: "A006020",
    name: "診断情報/入院契機",
    version: V2014,
    section: "diagnosis",
    required: "always",
    custom: "diagnosis",
    fields: diagnosisFields("入院の契機となった傷病名"),
  },
  {
    code: "A006030",
    name: "診断情報/医療資源",
    version: V2014,
    section: "diagnosis",
    required: "always",
    custom: "diagnosis",
    fields: diagnosisFields("医療資源を最も投入した傷病名", true),
  },
  {
    code: "A006031",
    name: "診断情報/医療資源2",
    version: V2014,
    section: "diagnosis",
    required: "optional",
    custom: "diagnosis",
    fields: diagnosisFields("医療資源を2番目に投入した傷病名"),
  },
  {
    code: "A006040",
    name: "診断情報/併存症",
    version: V2014,
    section: "diagnosis",
    repeat: { max: 10 },
    required: "optional",
    custom: "diagnosis",
    fields: diagnosisFields("入院時併存症名"),
  },
  {
    code: "A006050",
    name: "診断情報/続発症",
    version: V2014,
    section: "diagnosis",
    repeat: { max: 10 },
    required: "optional",
    custom: "diagnosis",
    fields: diagnosisFields("入院後発症疾患名"),
  },
  {
    code: "A006060",
    name: "診断情報/難病",
    version: V2016,
    section: "diagnosis",
    // 指定難病の医療受給者証の交付を受けている場合に、主たるものから 2 個まで入れる。
    required: "optional",
    fields: [
      { payload: 2, label: "難病の告示番号1", kind: "digits" },
      { payload: 3, label: "医療費助成の有無1", kind: "select", options: NO_YES },
      { payload: 4, label: "難病の告示番号2", kind: "digits", required: "optional" },
      {
        payload: 5,
        label: "医療費助成の有無2",
        kind: "select",
        options: NO_YES,
        required: payloadFilled("A006060", 4),
        visible: payloadFilled("A006060", 4),
      },
    ],
  },
  {
    code: "A007010",
    name: "手術情報",
    version: V2014,
    section: "surgery",
    // 主たる手術(又は点数の最も高い手術)を連番 1 にする。
    repeat: { max: 10 },
    required: "optional",
    custom: "surgery",
    fields: [
      { payload: 1, label: "手術日", kind: "date" },
      { payload: 2, label: "点数表コード", kind: "text", pattern: SURGERY_CODE_PATTERN },
      // 外保連手術試案の手術基幹コード(STEM7)。コード間の空白は詰める。
      { payload: 3, label: "手術基幹コード", kind: "text", maxLength: 7 },
      {
        payload: 4,
        label: "手術回数",
        kind: "select",
        options: [
          { code: "1", label: "初回" },
          { code: "2", label: "再手術" },
        ],
      },
      {
        payload: 5,
        label: "手術側数",
        kind: "select",
        options: [
          { code: "0", label: "左右の区別のないもの" },
          { code: "1", label: "右側" },
          { code: "2", label: "左側" },
          { code: "3", label: "左右" },
        ],
      },
      {
        payload: 6,
        label: "麻酔",
        kind: "select",
        options: [
          { code: "1", label: "全身麻酔" },
          { code: "2", label: "硬膜外麻酔" },
          { code: "3", label: "脊椎麻酔" },
          { code: "4", label: "静脈麻酔" },
          { code: "5", label: "局所麻酔" },
          { code: "6", label: "全麻＋硬膜外" },
          { code: "7", label: "脊椎＋硬膜外" },
          { code: "8", label: "その他" },
          { code: "9", label: "無" },
        ],
      },
      {
        payload: 7,
        label: "予防的抗菌薬投与",
        kind: "select",
        options: [
          { code: "1", label: "術前1時間以内" },
          { code: "2", label: "術前1時間より前で2時間以内" },
          { code: "3", label: "術前2時間より前" },
          { code: "0", label: "無" },
        ],
        // 入力は任意(機能評価係数Ⅱの評価対象)。麻酔が全身麻酔・全麻＋硬膜外の手術だけに入れる。
        required: "optional",
        visible: payloadIn("A007010", 6, "1", "6"),
      },
      { payload: 9, label: "手術名", kind: "text" },
    ],
  },
  {
    code: "ADL0010",
    name: "ADLスコア/入院時",
    version: V2014,
    section: "score",
    required: ageAtLeast(15),
    fields: [adlField("入院時のADLスコア")],
  },
  {
    code: "ADL0020",
    name: "ADLスコア/退院時",
    version: V2014,
    section: "score",
    required: and(ageAtLeast(15), not(diedAtDischarge)),
    fields: [adlField("退院時のADLスコア")],
  },
  {
    code: "ADL0030",
    name: "ADLスコア/地域包括ケア入棟・入室時",
    version: V2020,
    section: "score",
    // 地域包括ケア病棟入院料等を算定した期間ごとに、日付の早い順に入れる。
    repeat: { max: 3 },
    required: manual,
    fields: [adlField("入棟・入室時のADLスコア")],
  },
  {
    code: "ADL0040",
    name: "ADLスコア/地域包括ケア退棟・退室時",
    version: V2020,
    section: "score",
    repeat: { max: 3 },
    required: manual,
    fields: [adlField("退棟・退室時のADLスコア")],
  },
  {
    code: "CAN0010",
    name: "がん患者/初発・再発",
    version: V2014,
    section: "cancer",
    required: and(generalWardOnly, resourceIsMalignant),
    fields: [
      {
        payload: 3,
        label: "がんの初発、再発",
        kind: "select",
        options: [
          { code: "0", label: "初発" },
          { code: "1", label: "再発" },
        ],
      },
    ],
  },
  {
    code: "CAN0020",
    name: "がん患者/UICC TNM",
    version: V2014,
    section: "cancer",
    required: cancerFirstOccurrence,
    fields: [
      { payload: 3, label: "UICC病期分類(T)", kind: "select", options: UICC_T_OPTIONS },
      { payload: 4, label: "UICC病期分類(N)", kind: "select", options: UICC_N_OPTIONS },
      { payload: 5, label: "UICC病期分類(M)", kind: "select", options: UICC_M_OPTIONS },
      {
        payload: 6,
        label: "UICC病期分類(版)",
        kind: "select",
        options: [
          { code: "6", label: "第6版" },
          { code: "7", label: "第7版" },
          { code: "8", label: "第8版" },
        ],
      },
    ],
  },
  {
    code: "CAN0030",
    name: "がん患者/Stage",
    version: V2014,
    section: "cancer",
    required: cancerFirstOccurrence,
    fields: [
      {
        payload: 3,
        label: "癌取扱い規約に基づくがんのStage分類",
        kind: "select",
        options: STAGE_OPTIONS,
      },
    ],
  },
  {
    code: "CAN0040",
    name: "がん患者/化学療法の有無",
    version: V2014,
    section: "cancer",
    required: "always",
    fields: [
      {
        payload: 3,
        label: "化学療法の有無",
        kind: "select",
        options: [
          { code: "0", label: "無" },
          { code: "1", label: "有（経口）" },
          { code: "2", label: "有（皮下）" },
          { code: "3", label: "有（経静脈又は経動脈）" },
          { code: "4", label: "有（その他）" },
        ],
      },
    ],
  },
  {
    code: "FIM0010",
    name: "FIM/入退棟日",
    version: V2016,
    section: "rehab",
    // 回復期リハビリテーション病棟入院料等を算定した期間ごとに、日付の早い順に入れる。
    repeat: { max: 3 },
    required: manual,
    fields: [
      { payload: 1, label: "入棟日", kind: "date" },
      // 退棟日・退棟時の得点・退棟時体重は、死亡のため評価できないときは入れない。
      { payload: 2, label: "退棟日", kind: "date", required: not(diedAtDischarge) },
      { payload: 3, label: "入棟時FIM得点", kind: "composite", parts: FIM_PARTS },
      {
        payload: 4,
        label: "退棟時FIM得点",
        kind: "composite",
        parts: FIM_PARTS,
        required: not(diedAtDischarge),
      },
      {
        payload: 5,
        label: "入棟時体重",
        kind: "decimal1",
        specials: WEIGHT_UNMEASURABLE,
        required: "optional",
      },
      {
        payload: 6,
        label: "退棟時体重",
        kind: "decimal1",
        specials: WEIGHT_UNMEASURABLE,
        required: "optional",
      },
    ],
  },
  {
    code: "FIM0020",
    name: "FIM/入棟中",
    version: V2024,
    section: "rehab",
    // 連番は入棟日からの 2 週間ごとの期間(1 = 入棟日〜2 週目、…、12 = 23〜24 週目)。
    repeat: { max: 12 },
    required: manual,
    fields: [
      {
        payload: 1,
        label: "入棟中測定日",
        kind: "date",
        specials: [{ code: "99999999", label: "期間中の測定なし" }],
      },
      {
        payload: 2,
        label: "入棟中のFIM得点",
        kind: "composite",
        parts: FIM_PARTS,
        // 同じ行の測定日が 99999999 のときは入れない。
        visible: not(payloadIn("FIM0020", 1, "99999999")),
      },
    ],
  },
  {
    code: "JCS0010",
    name: "JCS/入院時",
    version: V2014,
    section: "score",
    required: "always",
    fields: [
      { payload: 2, label: "入院時意識障害がある場合のJCS", kind: "text", pattern: JCS_LEVEL },
      {
        payload: 3,
        label: "救急受診時意識障害がある場合のJCS",
        kind: "text",
        pattern: `${JCS_LEVEL}|999`,
        // 救急受診しておらず、入室前の状態がどうしても分からないときだけ 999 を入れる。
        specials: JCS_UNKNOWN,
        visible: emergencyAdmission,
      },
      {
        payload: 4,
        label: "治療室又は病棟入室時意識障害がある場合のJCS",
        kind: "text",
        pattern: JCS_LEVEL,
        visible: emergencyAdmission,
      },
    ],
  },
  {
    code: "JCS0020",
    name: "JCS/退院時",
    version: V2014,
    section: "score",
    required: not(diedAtDischarge),
    fields: [
      { payload: 2, label: "退院時意識障害がある場合のJCS", kind: "text", pattern: JCS_LEVEL },
    ],
  },
];
