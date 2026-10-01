// 様式1 の定義表のうち、疾患別の重症度分類など(M で始まるコード)。
// Mzz0010(その他の重症度分類)は本調査で使用しないので定義しない。

import {
  ADMISSION_DIAGNOSIS,
  COMORBIDITY_DIAGNOSIS,
  COMPLICATION_DIAGNOSIS,
  DIAGNOSIS_CODES,
  MAIN_DIAGNOSIS,
  RESOURCE2_DIAGNOSIS,
  RESOURCE_DIAGNOSIS,
  admissionTypeIn,
  ageAtLeast,
  ageUnder,
  and,
  diagnosisIcdIn,
  diagnosisMdc6In,
  emergencyAdmission,
  manual,
  not,
  or,
  payloadIn,
  psychiatricWard,
  resourceIcdIn,
  resourceMdc6In,
} from "../rules";
import type { Dpc1FieldDef, Dpc1Option, Dpc1Part, Dpc1RecordDef, Dpc1Rule } from "../types";

// バージョン(新設年度)。
const V2014 = "20140401";
const V2018 = "20180401";
const V2022 = "20220401";
const V2024 = "20240601";

/**
 * 医療資源を最も投入した傷病名が、診断群分類(上 6 桁)の範囲に定義されている。
 * 「010040～010070」のような範囲の指定は接頭辞では書けないので、ここで比べる。
 */
const resourceMdc6Between =
  (from: string, to: string): Dpc1Rule =>
  (ctx) =>
    ctx
      .rows(RESOURCE_DIAGNOSIS)
      .some((row) => ctx.mdc6(row.p[2] ?? "").some((code) => code >= from && code <= to));

// 脳卒中(010020、010040～010070)。
const stroke = or(resourceMdc6In("010020"), resourceMdc6Between("010040", "010070"));

// 心不全(I110、I130、I132、I50$)又は心不全での救急医療入院。
const heartFailure = or(
  resourceIcdIn("I110", "I130", "I132", "I50$"),
  admissionTypeIn("334", "324"),
);

// 解離性大動脈瘤(主傷病・医療資源・医療資源2 のいずれかが I710)。
const aorticDissection = diagnosisIcdIn(
  [MAIN_DIAGNOSIS, RESOURCE_DIAGNOSIS, RESOURCE2_DIAGNOSIS],
  "I710",
);

// 医療資源が MDC17 及び 01021x、又は精神病棟グループに属する入院がある。
const psychiatricDisease = or(resourceMdc6In("17", "01021"), psychiatricWard);

// 敗血症(入院契機・医療資源・入院時併存症・入院後発症疾患のいずれかが 180010)。
const sepsis = diagnosisMdc6In(
  [ADMISSION_DIAGNOSIS, RESOURCE_DIAGNOSIS, COMORBIDITY_DIAGNOSIS, COMPLICATION_DIAGNOSIS],
  "180010",
);

const NO_YES: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
];

const NO_YES_UNKNOWN: Dpc1Option[] = [...NO_YES, { code: "9", label: "不明" }];

const UNKNOWN_999: Dpc1Option = { code: "999", label: "不明" };
// 精神の回数の欄は、不明を "a" で表す。
const UNKNOWN_A: Dpc1Option = { code: "a", label: "不明" };

// 発症前 Rankin Scale。"6"(死亡)は退院時だけ選べる。
const RANKIN_BEFORE: Dpc1Option[] = [
  { code: "0", label: "まったく症候がない" },
  { code: "1", label: "明らかな障害はない" },
  { code: "2", label: "軽度の障害" },
  { code: "3", label: "中等度の障害" },
  { code: "4", label: "中等度から重度の障害" },
  { code: "5", label: "重度の障害" },
  { code: "9", label: "不明" },
];

const RANKIN_AT_DISCHARGE: Dpc1Option[] = [
  ...RANKIN_BEFORE.filter((option) => option.code !== "9"),
  { code: "6", label: "死亡" },
  { code: "9", label: "不明" },
];

const NOT_APPLICABLE_OR_APPLICABLE: Dpc1Option[] = [
  { code: "0", label: "該当しない" },
  { code: "1", label: "該当する" },
];

// 肺炎の重症度分類。7 桁を連ねる。「1. 男性 70 歳以上、女性 75 歳以上」は生年月日と
// 重複するので入力せず、2～8 の 7 項目だけを並べる。
const PNEUMONIA_PARTS: Dpc1Part[] = [
  { label: "BUN 21mg/dL以上又は脱水あり", options: NOT_APPLICABLE_OR_APPLICABLE },
  {
    label: "SpO2",
    options: [
      { code: "0", label: "SpO2>90%(room air)" },
      { code: "1", label: "SpO2<=90%(room air)、SpO2>90%の維持にFiO2 35%は要さない" },
      { code: "2", label: "SpO2<=90%(room air)、SpO2>90%の維持にFiO2>35%を要する" },
    ],
  },
  { label: "意識障害", options: NOT_APPLICABLE_OR_APPLICABLE },
  { label: "血圧(収縮期)90mmHg以下", options: NOT_APPLICABLE_OR_APPLICABLE },
  {
    label: "免疫不全状態",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "悪性腫瘍あり又は免疫不全状態あり" },
    ],
  },
  {
    label: "肺炎重症度規定因子",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "CRP>=20mg/dl又は胸部X線写真陰影のひろがりが一側肺の2/3以上" },
    ],
  },
  {
    label: "院内肺炎又は市中肺炎",
    options: [
      { code: "3", label: "院内肺炎" },
      { code: "5", label: "市中肺炎" },
      { code: "8", label: "肺炎以外" },
    ],
  },
];

const NYHA: Dpc1Option[] = [
  { code: "1", label: "Ⅰ" },
  { code: "2", label: "Ⅱ" },
  { code: "3", label: "Ⅲ" },
  { code: "4", label: "Ⅳ" },
  { code: "0", label: "分類不能" },
];

const SYSTOLIC_BP: Dpc1Option[] = [
  { code: "1", label: "100mmHg未満" },
  { code: "2", label: "100mmHg以上、140mmHg以下" },
  { code: "3", label: "140mmHg超" },
];

const SCORE_1_TO_3 = (labels: [string, string, string]): Dpc1Option[] =>
  labels.map((label, i) => ({ code: String(i + 1), label }));

// Child-Pugh 分類。5 項目の Score(1～3)を連ねる。分類不能な項目は "1"。
const CHILD_PUGH_PARTS: Dpc1Part[] = [
  { label: "Bil(mg/dl)", options: SCORE_1_TO_3(["<2", "2-3", "3<"]) },
  { label: "Alb(g/dl)", options: SCORE_1_TO_3(["3.5<", "2.8-3.5", "<2.8"]) },
  { label: "腹水", options: SCORE_1_TO_3(["なし", "少量", "中等量"]) },
  { label: "脳症", options: SCORE_1_TO_3(["なし", "軽症", "ときどき昏睡"]) },
  { label: "PT(%)", options: SCORE_1_TO_3(["70<", "40-70", "<40"]) },
];

const points = (from: number, to: number): Dpc1Option[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    code: String(from + i),
    label: `${from + i}点`,
  }));

// 急性膵炎の重症度分類。予後因子の合計点数と造影 CT 重症度スコアの合計点数を連ねる。
// 全体が不明なら "99"、造影 CT だけが不明なら 2 桁目を "8" にする。"99" の 1 桁目は
// 予後因子 9 点と同じ文字になるので、不明は 2 桁目の選択で表す。
const PANCREATITIS_PARTS: Dpc1Part[] = [
  { label: "A.予後因子 合計点数", options: points(0, 9) },
  {
    label: "B.造影CT重症度スコア 合計点数",
    options: [
      ...points(0, 4),
      { code: "8", label: "造影CTのみ不明" },
      { code: "9", label: "不明(予後因子も不明。Aは9点を選ぶ)" },
    ],
  },
];

// 回数を 1 桁で表す欄の選択肢。9 回以上は "9"、不明は "a"。
const COUNT_DIGIT: Dpc1Option[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ code: String(i), label: `${i}回` })),
  { code: "9", label: "9回以上" },
  UNKNOWN_A,
];

const PLANNED_OR_NOT: Dpc1Option[] = [
  { code: "1", label: "利用予定あり" },
  { code: "2", label: "利用予定なし" },
];

const partsOf = (labels: string[], options: Dpc1Option[]): Dpc1Part[] =>
  labels.map((label) => ({ label, options }));

// 退院に向けた会議への参加職種(14 桁)。
const MEETING_PARTICIPANTS = [
  "医師",
  "保健師",
  "看護師",
  "薬剤師",
  "作業療法士",
  "精神保健福祉士",
  "公認心理師",
  "患者本人",
  "患者の家族等",
  "入退院支援部門の職員",
  "自治体職員",
  "介護サービス事業者",
  "障害福祉サービス事業者",
  "その他",
];

// 患家等への訪問に同行した職種(9 桁)。
const VISIT_COMPANIONS = [
  "医師",
  "保健師",
  "看護師",
  "薬剤師",
  "作業療法士",
  "精神保健福祉士",
  "公認心理師",
  "入退院支援部門の職員",
  "その他",
];

// 障害福祉サービス等(介護給付・訓練等給付・相談支援)。桁の並びは面談回数と利用予定で同じ。
const CARE_BENEFIT_SERVICES = [
  "居宅介護",
  "重度訪問介護",
  "同行援護",
  "行動援護",
  "重度障害者等包括支援",
  "短期入所",
  "療養介護",
  "生活介護",
  "施設入所支援",
];

const TRAINING_BENEFIT_SERVICES = [
  "自立生活援助",
  "共同生活援助",
  "宿泊型自立訓練",
  "自律訓練(機能訓練)",
  "自律訓練(生活訓練)",
  "就労移行支援",
  "就労継続支援(Ａ型)",
  "就労継続支援(Ｂ型)",
  "就労定着支援",
];

const CONSULTATION_SERVICES = ["計画相談支援", "地域移行支援", "地域定着支援"];

// SOFA・pSOFA は 6 機能の点数(0～4)を連ねる。不明な桁は "9"。
// 点数の基準は SOFA と pSOFA で違うが、桁の並びと値の範囲は同じ。
const SOFA_POINT: Dpc1Option[] = [...points(0, 4), { code: "9", label: "不明" }];
const SOFA_PARTS = partsOf(["呼吸", "凝固", "肝", "循環", "中枢神経", "腎"], SOFA_POINT);

// 特定集中治療室の SOFA・pSOFA の欄。
// 入室日当日に退室したときは翌日測定日が "99999999" で、その行の翌日測定値は入力しない。
const icuSofaFields = (code: string): Dpc1FieldDef[] => [
  { payload: 2, label: "入室日当日測定日", kind: "date" },
  {
    payload: 3,
    label: "入室日翌日測定日",
    kind: "date",
    specials: [{ code: "99999999", label: "入室日当日に退室" }],
  },
  { payload: 4, label: "退室日測定日", kind: "date" },
  { payload: 6, label: "入室日当日測定値", kind: "composite", parts: SOFA_PARTS },
  {
    payload: 7,
    label: "入室日翌日測定値",
    kind: "composite",
    parts: SOFA_PARTS,
    visible: not(payloadIn(code, 3, "99999999")),
  },
  { payload: 8, label: "退室日測定値", kind: "composite", parts: SOFA_PARTS },
];

// 敗血症の SOFA・pSOFA の欄。
// 治療を行っていないときは測定日が両方 "99999999" で測定値は入力しない。治療開始日当日に
// 治療が終了したときは翌日測定日が "99999999" で、その行の翌日測定値は入力しない。
const sepsisSofaFields = (code: string): Dpc1FieldDef[] => [
  {
    payload: 2,
    label: "治療開始日当日測定日",
    kind: "date",
    specials: [{ code: "99999999", label: "治療を行っていない" }],
  },
  {
    payload: 3,
    label: "治療開始日翌日測定日",
    kind: "date",
    specials: [{ code: "99999999", label: "治療開始日当日に治療終了・治療を行っていない" }],
  },
  {
    payload: 6,
    label: "治療開始日当日測定値",
    kind: "composite",
    parts: SOFA_PARTS,
    visible: not(payloadIn(code, 2, "99999999")),
  },
  {
    payload: 7,
    label: "治療開始日翌日測定値",
    kind: "composite",
    parts: SOFA_PARTS,
    visible: not(payloadIn(code, 3, "99999999")),
  },
];

export const DISEASE_RECORDS: Dpc1RecordDef[] = [
  {
    code: "M010010",
    name: "脳卒中患者/入院前",
    version: V2014,
    section: "disease",
    required: stroke,
    fields: [
      { payload: 2, label: "発症前 Rankin Scale", kind: "select", options: RANKIN_BEFORE },
      {
        payload: 3,
        label: "脳卒中の発症時期",
        kind: "select",
        options: [
          { code: "1", label: "発症3日目以内" },
          { code: "2", label: "発症4日目以降7日目以内" },
          { code: "3", label: "発症8日目以降" },
          { code: "4", label: "無症候性(発症日なし)" },
        ],
      },
    ],
  },
  {
    code: "M010020",
    name: "脳卒中患者/退院時",
    version: V2014,
    section: "disease",
    required: stroke,
    fields: [
      {
        payload: 2,
        label: "退院時 modified Rankin Scale",
        kind: "select",
        options: RANKIN_AT_DISCHARGE,
      },
    ],
  },
  {
    code: "M010030",
    name: "脳腫瘍患者/テモゾロミド",
    version: V2014,
    section: "disease",
    required: resourceMdc6In("010010"),
    fields: [
      { payload: 2, label: "テモゾロミド(初回治療)の有無", kind: "select", options: NO_YES },
    ],
  },
  {
    code: "M040010",
    name: "MDC04患者/Hugh-Jones",
    version: V2014,
    section: "disease",
    required: and(resourceMdc6In("04"), not(resourceMdc6In("04026"))),
    fields: [
      {
        payload: 2,
        label: "Hugh-Jones分類",
        kind: "select",
        options: [
          { code: "1", label: "Ⅰ" },
          { code: "2", label: "Ⅱ" },
          { code: "3", label: "Ⅲ" },
          { code: "4", label: "Ⅳ" },
          { code: "5", label: "Ⅴ" },
          { code: "0", label: "分類不能" },
        ],
        // 6 歳未満の小児で分類不能の場合は入力不要なので、6 歳未満では空欄を許す。
        required: not(ageUnder(6)),
      },
    ],
  },
  {
    code: "M040020",
    name: "肺炎患者/重症度",
    version: V2014,
    section: "disease",
    required: and(ageAtLeast(15), resourceMdc6In("040070", "040080")),
    fields: [
      { payload: 2, label: "肺炎の重症度分類", kind: "composite", parts: PNEUMONIA_PARTS },
      { payload: 3, label: "医療介護関連肺炎に該当の有無", kind: "select", options: NO_YES },
    ],
  },
  {
    code: "M040031",
    name: "救急医療入院患者/P/F比",
    version: V2024,
    section: "disease",
    required: or(resourceMdc6In("040130"), admissionTypeIn("333", "323", "334", "324")),
    fields: [
      {
        payload: 2,
        label: "救急受診時のP/F比",
        kind: "number",
        min: 0,
        // 700mmHg を超える場合も "700" と入力する。
        max: 700,
        specials: [UNKNOWN_999],
        visible: emergencyAdmission,
      },
      {
        payload: 3,
        label: "救急受診時の酸素投与の有無",
        kind: "select",
        options: NO_YES_UNKNOWN,
        visible: emergencyAdmission,
      },
      {
        payload: 4,
        label: "救急受診時のFiO2",
        kind: "number",
        min: 0,
        max: 100,
        specials: [UNKNOWN_999],
        visible: payloadIn("M040031", 3, "1"),
      },
      {
        payload: 5,
        label: "救急受診時の呼吸補助の有無",
        kind: "select",
        options: NO_YES_UNKNOWN,
        visible: emergencyAdmission,
      },
      {
        payload: 6,
        label: "治療室又は病棟入室時のP/F比",
        kind: "number",
        min: 0,
        max: 700,
        specials: [UNKNOWN_999],
      },
      {
        payload: 7,
        label: "治療室又は病棟入室時の酸素投与の有無",
        kind: "select",
        options: NO_YES_UNKNOWN,
      },
      {
        payload: 8,
        label: "治療室又は病棟入室時のFiO2",
        kind: "number",
        min: 0,
        max: 100,
        specials: [UNKNOWN_999],
        visible: payloadIn("M040031", 7, "1"),
      },
      {
        payload: 9,
        label: "治療室又は病棟入室時の呼吸補助の有無",
        kind: "select",
        options: NO_YES_UNKNOWN,
      },
    ],
  },
  {
    code: "M050011",
    name: "心不全患者/NYHA",
    version: V2024,
    section: "disease",
    required: heartFailure,
    fields: [
      {
        payload: 3,
        label: "救急受診時のNYHA心機能分類",
        kind: "select",
        options: NYHA,
        visible: emergencyAdmission,
      },
      { payload: 4, label: "治療室又は病棟入室時のNYHA心機能分類", kind: "select", options: NYHA },
    ],
  },
  {
    code: "M050020",
    name: "狭心症、慢性虚血性心疾患患者情報/CCS",
    version: V2014,
    section: "disease",
    required: resourceMdc6In("050050"),
    fields: [
      {
        payload: 2,
        label: "入院時の重症度：CCS分類",
        kind: "select",
        options: [
          { code: "1", label: "ClassⅠ" },
          { code: "2", label: "ClassⅡ" },
          { code: "3", label: "ClassⅢ" },
          { code: "4", label: "ClassⅣ" },
          { code: "0", label: "分類不能" },
          { code: "9", label: "症状がない" },
        ],
      },
    ],
  },
  {
    code: "M050030",
    name: "急性心筋梗塞患者情報/Killip",
    version: V2014,
    section: "disease",
    required: resourceMdc6In("050030"),
    fields: [
      {
        payload: 2,
        label: "入院時の重症度：Killip分類",
        kind: "select",
        options: [
          { code: "1", label: "Class1 心不全の兆候なし" },
          { code: "2", label: "Class2 軽症～中等症の心不全" },
          { code: "3", label: "Class3 重症心不全、肺水腫" },
          { code: "4", label: "Class4 心原性ショック" },
          { code: "0", label: "分類不能" },
        ],
      },
    ],
  },
  {
    code: "M050041",
    name: "心不全患者/血行動態的特徴",
    version: V2024,
    section: "disease",
    required: heartFailure,
    fields: [
      {
        payload: 2,
        label: "救急受診時の収縮期血圧",
        kind: "select",
        options: SYSTOLIC_BP,
        visible: emergencyAdmission,
      },
      {
        payload: 3,
        label: "救急受診時の循環作動薬の使用",
        kind: "select",
        options: NO_YES_UNKNOWN,
        visible: emergencyAdmission,
      },
      {
        payload: 4,
        label: "治療室又は病棟入室時の収縮期血圧",
        kind: "select",
        options: SYSTOLIC_BP,
      },
      {
        payload: 5,
        label: "治療室又は病棟入室時の循環作動薬の使用",
        kind: "select",
        options: NO_YES_UNKNOWN,
      },
    ],
  },
  {
    code: "M050051",
    name: "急性心筋梗塞患者情報/発症時期",
    version: V2024,
    section: "disease",
    required: resourceMdc6In("050030"),
    fields: [
      {
        payload: 2,
        label: "急性心筋梗塞の発症時期",
        kind: "select",
        options: [
          { code: "1", label: "発症24時間以内" },
          { code: "2", label: "発症24時間後1週以内" },
          { code: "3", label: "発症1週後4週以内" },
          { code: "9", label: "その他(不明等)" },
        ],
      },
    ],
  },
  {
    code: "M050070",
    name: "解離性大動脈瘤情報/Stanford A/B型",
    version: V2022,
    section: "disease",
    required: aorticDissection,
    fields: [
      {
        payload: 2,
        label: "Stanford A/B型",
        kind: "select",
        options: [
          { code: "1", label: "Stanford A型" },
          { code: "2", label: "Stanford B型" },
          { code: "0", label: "分類不能" },
        ],
      },
    ],
  },
  {
    code: "M050080",
    name: "解離性大動脈瘤情報/発症時期",
    version: V2024,
    section: "disease",
    required: aorticDissection,
    fields: [
      {
        payload: 2,
        label: "解離性大動脈瘤の発症時期",
        kind: "select",
        options: [
          { code: "1", label: "発症2週以内" },
          { code: "2", label: "発症2週後3ヶ月以内" },
          { code: "3", label: "発症3ヶ月後" },
          { code: "9", label: "その他(不明等)" },
        ],
      },
    ],
  },
  {
    code: "M050090",
    name: "心不全患者情報/バイオマーカー",
    version: V2024,
    section: "disease",
    required: resourceMdc6In("050130"),
    fields: [
      {
        payload: 2,
        label: "入院時BNP・NT-proBNP",
        kind: "select",
        options: [
          { code: "1", label: "BNP 400pg/mL未満、又はNT-proBNP 1800pg/mL未満" },
          {
            code: "2",
            label: "BNP 400pg/mL以上1200pg/mL未満、又はNT-proBNP 1800pg/mL以上5000pg/mL未満",
          },
          { code: "3", label: "BNP 1200pg/mL以上、又はNT-proBNP 5000pg/mL以上" },
          { code: "9", label: "不明" },
        ],
      },
    ],
  },
  {
    code: "M060010",
    name: "肝硬変患者情報/Child-Pugh",
    version: V2014,
    section: "disease",
    required: diagnosisMdc6In(DIAGNOSIS_CODES, "060300"),
    fields: [
      {
        payload: 2,
        label: "肝硬変のChild-Pugh分類",
        kind: "composite",
        parts: CHILD_PUGH_PARTS,
      },
    ],
  },
  {
    code: "M060020",
    name: "急性膵炎患者情報/重症度",
    version: V2014,
    section: "disease",
    required: resourceMdc6In("060350"),
    fields: [
      {
        payload: 2,
        label: "急性膵炎の重症度分類",
        kind: "composite",
        parts: PANCREATITIS_PARTS,
      },
    ],
  },
  {
    code: "M120010",
    name: "産科患者情報/分娩",
    version: V2014,
    section: "disease",
    required: resourceMdc6In(
      "120140",
      "120160",
      "120165",
      "120170",
      "120180",
      "120182",
      "120185",
      "120200",
      "120210",
      "120260",
      "120270",
      "120290",
    ),
    fields: [
      {
        payload: 2,
        label: "入院周辺の分娩の有無",
        kind: "select",
        options: [
          { code: "1", label: "入院前1週間以内に分娩あり" },
          { code: "2", label: "入院中に分娩あり" },
          { code: "3", label: "その他" },
        ],
      },
      {
        payload: 3,
        label: "分娩時出血量(mL)",
        kind: "number",
        min: 0,
        specials: [{ code: "99999", label: "不明" }],
        visible: payloadIn("M120010", 2, "1", "2"),
      },
    ],
  },
  {
    code: "M150010",
    name: "川崎病患者情報/ガンマグロブリン",
    version: V2024,
    section: "disease",
    required: resourceMdc6In("150070"),
    fields: [
      { payload: 2, label: "ガンマグロブリンの追加治療の有無", kind: "select", options: NO_YES },
    ],
  },
  {
    code: "M160010",
    name: "熱傷患者情報/BurnIndex",
    version: V2014,
    section: "disease",
    required: diagnosisMdc6In(DIAGNOSIS_CODES, "161000"),
    fields: [{ payload: 2, label: "BurnIndex", kind: "number", min: 0, max: 100 }],
  },
  {
    code: "M170010",
    name: "精神疾患・認知症患者情報/入院時GAF",
    version: V2014,
    section: "psychiatry",
    required: psychiatricDisease,
    fields: [
      // "0" は情報不十分。
      { payload: 2, label: "入院時GAF尺度", kind: "number", min: 0, max: 100 },
    ],
  },
  {
    code: "M170020",
    name: "精神保健福祉法に関する情報",
    version: V2014,
    section: "psychiatry",
    required: psychiatricDisease,
    fields: [
      {
        payload: 2,
        label: "精神保健福祉法における入院形態",
        kind: "select",
        options: [
          { code: "1", label: "任意入院" },
          { code: "2", label: "医療保護入院" },
          { code: "3", label: "措置入院" },
          { code: "4", label: "応急入院" },
        ],
      },
      { payload: 3, label: "精神保健福祉法に基づく隔離日数(日)", kind: "number", min: 0 },
      { payload: 4, label: "精神保健福祉法に基づく身体拘束日数(日)", kind: "number", min: 0 },
    ],
  },
  // M170030～M170060 は、精神療養病棟入院料・地域移行機能強化病棟入院料を算定した場合も
  // 必須になる。算定した入院料は様式1 の入力値から分からないので、条件には入れていない。
  {
    code: "M170030",
    name: "退院に向けた会議の開催状況",
    version: V2024,
    section: "psychiatry",
    required: psychiatricWard,
    fields: [
      {
        payload: 1,
        label: "入棟後に初めて行われた、当該患者の退院に向けた会議の実施日",
        kind: "date",
        specials: [{ code: "99999999", label: "実施していない・不明" }],
      },
      {
        payload: 2,
        label: "当該患者の退院に向けた会議の開催回数",
        kind: "number",
        min: 0,
        specials: [UNKNOWN_A],
      },
      {
        payload: 3,
        label: "当該患者の退院に向けた会議への参加職種",
        kind: "composite",
        parts: partsOf(MEETING_PARTICIPANTS, COUNT_DIGIT),
      },
    ],
  },
  {
    code: "M170040",
    name: "個別支援の実施状況",
    version: V2024,
    section: "psychiatry",
    required: psychiatricWard,
    fields: [
      {
        payload: 2,
        label: "薬剤師による服薬指導の実施回数",
        kind: "number",
        min: 0,
        specials: [UNKNOWN_A],
      },
      {
        payload: 3,
        label: "作業療法士による個別作業療法の実施回数",
        kind: "number",
        min: 0,
        specials: [UNKNOWN_A],
      },
      {
        payload: 4,
        label: "精神保健福祉士による個別相談支援の実施回数",
        kind: "number",
        min: 0,
        specials: [UNKNOWN_A],
      },
      {
        payload: 5,
        label: "公認心理師による個別心理支援の実施回数",
        kind: "number",
        min: 0,
        specials: [UNKNOWN_A],
      },
    ],
  },
  {
    code: "M170050",
    name: "外出又は外泊の実施状況",
    version: V2024,
    section: "psychiatry",
    required: psychiatricWard,
    fields: [
      {
        payload: 2,
        label: "入院中に患者が患家等を訪問した回数",
        kind: "number",
        min: 0,
        // 99 回以上は "99" と入力する。
        max: 99,
        specials: [UNKNOWN_A],
      },
      {
        payload: 3,
        label: "患者の患家等への訪問に同行した職種",
        kind: "composite",
        parts: partsOf(VISIT_COMPANIONS, COUNT_DIGIT),
      },
      {
        payload: 4,
        label: "入院中に患者が外泊を行った回数",
        kind: "number",
        min: 0,
        max: 99,
        specials: [UNKNOWN_A],
      },
    ],
  },
  {
    code: "M170060",
    name: "障害福祉サービス等の連携に関する情報",
    version: V2024,
    section: "psychiatry",
    required: psychiatricWard,
    fields: [
      {
        payload: 2,
        label: "障害福祉サービス等事業所(介護給付)との面談回数",
        kind: "composite",
        parts: partsOf(CARE_BENEFIT_SERVICES, COUNT_DIGIT),
      },
      {
        payload: 3,
        label: "退院時点で今後の利用が予定されている障害福祉サービス等(介護給付)",
        kind: "composite",
        parts: partsOf(CARE_BENEFIT_SERVICES, PLANNED_OR_NOT),
      },
      {
        payload: 4,
        label: "障害福祉サービス等事業所(訓練等給付)との面談回数",
        kind: "composite",
        parts: partsOf(TRAINING_BENEFIT_SERVICES, COUNT_DIGIT),
      },
      {
        payload: 5,
        label: "退院時点で今後の利用が予定されている障害福祉サービス等(訓練等給付)",
        kind: "composite",
        parts: partsOf(TRAINING_BENEFIT_SERVICES, PLANNED_OR_NOT),
      },
      {
        payload: 6,
        label: "障害福祉サービス等事業所(相談支援)との面談回数",
        kind: "composite",
        parts: partsOf(CONSULTATION_SERVICES, COUNT_DIGIT),
      },
      {
        payload: 7,
        label: "退院時点で今後の利用が予定されている障害福祉サービス等(相談支援)",
        kind: "composite",
        parts: partsOf(CONSULTATION_SERVICES, PLANNED_OR_NOT),
      },
    ],
  },
  // M180010・M180020 は特定集中治療室管理料 1～6 を算定する病床に入院した患者が対象
  // (15 歳以上は SOFA、15 歳未満は pSOFA)。算定した入院料は様式1 の入力値から
  // 分からないので、画面で手動で開く。
  {
    code: "M180010",
    name: "SOFAスコア/特定集中治療室",
    version: V2018,
    section: "intensive",
    repeat: { max: 2 },
    required: manual,
    fields: icuSofaFields("M180010"),
  },
  {
    code: "M180011",
    name: "SOFAスコア/敗血症",
    version: V2018,
    section: "intensive",
    repeat: { max: 2 },
    required: and(ageAtLeast(15), sepsis),
    fields: sepsisSofaFields("M180011"),
  },
  {
    code: "M180020",
    name: "pSOFAスコア/特定集中治療室",
    version: V2018,
    section: "intensive",
    repeat: { max: 2 },
    required: manual,
    fields: icuSofaFields("M180020"),
  },
  {
    code: "M180021",
    name: "pSOFAスコア/敗血症",
    version: V2018,
    section: "intensive",
    repeat: { max: 2 },
    required: and(ageUnder(15), sepsis),
    fields: sepsisSofaFields("M180021"),
  },
];
