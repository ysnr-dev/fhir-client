// 2026 年度版(2026 年 6 月 1 日施行)の定義表。2025 年度版の定義表に、実施説明資料
// (2026 年 7 月 17 日版)の変更を当てて組み立てる。仮様式1(入院 90 日目時点で未転棟・
// 未退院の患者の様式1)は作らないので、それだけに関わる変更(退院先 "b" など)は持たない。

import {
  admissionRouteIn,
  ageAtLeast,
  and,
  diedAtDischarge,
  formPeriodLongerThan,
  manual,
  not,
  notShortStayAdmission,
  or,
  payloadIn,
  resourceIcdIn,
  resourceMdc6In,
} from "../rules";
import type { Dpc1FieldDef, Dpc1Option, Dpc1Part, Dpc1RecordDef } from "../types";
import { adlField } from "./clinical";
import { ADMISSION_TYPE_OPTIONS } from "./common";
import { sepsis } from "./disease";

const V2026 = "20260601";

const NO_YES: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
];

const TRANSPORT_VEHICLE_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "市町村又は都道府県の救急隊に属する自動車等" },
  { code: "2", label: "医療機関に属する病院自動車等" },
  { code: "3", label: "消防機関が認定する患者等搬送事業者による自動車等" },
  { code: "9", label: "その他の自動車等" },
];

const RETURN_HOME_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "入院前の生活の場への復帰無し" },
  { code: "1", label: "入院前の生活の場への復帰有り" },
  { code: "9", label: "不明" },
];

// 患者の状態等。5 項目の該当を 1 桁ずつ連ねた 5 桁で表す。
const PATIENT_STATE_PARTS: Dpc1Part[] = [
  "重度の肢体不自由児(者)(脳卒中の後遺症の患者及び認知症の患者を除く)",
  "脊髄損傷等の重度障害者(脳卒中の後遺症の患者及び認知症の患者を除く)",
  "重度の意識障害者",
  "筋ジストロフィー患者",
  "難病患者",
].map((label) => ({
  label,
  options: [
    { code: "0", label: "該当しない" },
    { code: "1", label: "該当する" },
    { code: "9", label: "不明" },
  ],
}));

const SEVERE_BRAIN_INJURY_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "高次脳機能障害を伴った重症脳血管障害" },
  { code: "2", label: "重度の頸髄損傷" },
  { code: "3", label: "頭部外傷を含む多部位外傷" },
];

/** 入院経路が家庭・他院・施設からの入院(1・4・5)で、短期滞在手術等の予定入院(102)以外。 */
const admittedFromOutsideNotShortStay = and(admissionRouteIn("1", "4", "5"), notShortStayAdmission);

const longerThan5Days = formPeriodLongerThan(5);

const ADDED_RECORDS: Record<string, Dpc1RecordDef> = {
  A000021: {
    code: "A000021",
    name: "搬送情報",
    version: V2026,
    section: "admission",
    // 入院経路が 1・5・9 でも、他院の救急外来等を受診してそのまま転院してきた場合は入力する。
    // 受診の経緯は入力値から分からないので、そのときは画面で手動で開く。
    required: admissionRouteIn("4"),
    fields: [
      { payload: 1, label: "下り搬送の有無", kind: "select", options: NO_YES },
      {
        payload: 2,
        label: "下り搬送時に使用された車両",
        kind: "select",
        options: TRANSPORT_VEHICLE_OPTIONS,
        visible: payloadIn("A000021", 1, "1"),
      },
    ],
  },
  A001050: {
    code: "A001050",
    name: "患者プロファイル/患者の状態等",
    version: V2026,
    section: "profile",
    // 障害者施設等入院基本料・特殊疾患入院医療管理料・特殊疾患病棟入院料を算定した場合。
    required: manual,
    fields: [{ payload: 2, label: "患者の状態等", kind: "composite", parts: PATIENT_STATE_PARTS }],
  },
  A004060: {
    code: "A004060",
    name: "高次脳機能障害を伴った重症脳血管障害等",
    version: V2026,
    section: "profile",
    // 回復期リハビリテーション病棟入院料等を算定した期間中に、脳血管疾患等リハビリテーション料を
    // 算定した場合。
    required: manual,
    fields: [
      {
        payload: 2,
        label: "高次脳機能障害を伴った重症脳血管障害等の有無",
        kind: "select",
        options: SEVERE_BRAIN_INJURY_OPTIONS,
      },
    ],
  },
  ADL0005: {
    code: "ADL0005",
    name: "ADLスコア/発症前",
    version: V2026,
    section: "score",
    // 15 歳以上で、疾患別リハビリテーション料を算定した場合(産科の患者を除く)。
    required: manual,
    fields: [adlField("発症前のADLスコア")],
  },
};

/** 新設のレコードを、資料の並びでこのコードの直後に置く。 */
const INSERT_AFTER: Record<string, string> = {
  A000021: "A000020",
  A001050: "A001040",
  A004060: "A004050",
  ADL0005: "A007010",
};

const REMOVED_CODES = new Set([
  "A001020", // 喫煙指数
  "A001030", // 褥瘡(療養病棟)
  "A006060", // 難病
  "M170030", // 退院に向けた会議の開催状況
  "M170040", // 個別支援の実施状況
  "M170050", // 外出又は外泊の実施状況
  "M170060", // 障害福祉サービス等の連携に関する情報
]);

type FieldChange = Partial<Dpc1FieldDef> | null;

/** ペイロード番号ごとに欄を差し替える。null はその欄を外す(資料で「空欄」になったもの)。 */
function changeFields(
  fields: Dpc1FieldDef[],
  changes: Partial<Record<number, FieldChange>>,
  added: Dpc1FieldDef[] = [],
): Dpc1FieldDef[] {
  const changed = fields.flatMap((field) => {
    if (!(field.payload in changes)) return [field];
    const change = changes[field.payload];
    return change === null ? [] : [{ ...field, ...change }];
  });
  return [...changed, ...added].sort((a, b) => a.payload - b.payload);
}

const REVISIONS: Record<string, (def: Dpc1RecordDef) => Dpc1RecordDef> = {
  A000020: (def) => ({
    ...def,
    fields: changeFields(def.fields, {
      5: { options: ADMISSION_TYPE_OPTIONS },
      // 精神病棟グループに属する入院があっても、MDC17 でなければ必須ではない。
      8: { required: resourceMdc6In("17") },
    }),
  }),
  A000030: (def) => ({
    ...def,
    fields: changeFields(def.fields, {}, [
      {
        payload: 6,
        label: "入院前の生活の場への復帰の有無",
        kind: "select",
        options: RETURN_HOME_OPTIONS,
        visible: payloadIn("A000030", 2, "1", "2", "3", "4", "5", "6", "7", "8", "9", "a"),
      },
    ]),
  }),
  A001010: (def) => ({
    ...def,
    required: or(admittedFromOutsideNotShortStay, longerThan5Days),
    fields: changeFields(def.fields, {
      2: { required: admittedFromOutsideNotShortStay },
      3: { required: admittedFromOutsideNotShortStay },
      4: { required: longerThan5Days },
    }),
  }),
  A007010: (def) => ({
    ...def,
    fields: changeFields(def.fields, {
      6: {
        options: def.fields
          .find((field) => field.payload === 6)
          ?.options?.map((option) =>
            option.code === "4" ? { ...option, label: "吸入麻酔又は静脈麻酔" } : option,
          ),
      },
    }),
  }),
  ADL0020: (def) => ({
    ...def,
    required: and(ageAtLeast(15), longerThan5Days, not(diedAtDischarge)),
  }),
  M040010: (def) => ({
    ...def,
    required: "optional",
    fields: changeFields(def.fields, { 2: { required: "optional" } }),
  }),
  // 救急受診時の欄(2〜5)は空欄になり、救急医療入院の状態による条件も無くなった。
  M040031: (def) => ({
    ...def,
    name: "呼吸不全患者/P/F比",
    required: resourceMdc6In("040130"),
    fields: changeFields(def.fields, { 2: null, 3: null, 4: null, 5: null }),
  }),
  M050011: (def) => ({
    ...def,
    required: resourceIcdIn("I110", "I130", "I132", "I50$"),
    fields: changeFields(def.fields, { 3: null }),
  }),
  M050090: (def) => ({
    ...def,
    required: "optional",
    fields: changeFields(def.fields, { 2: { required: "optional" } }),
  }),
  // 退室日の欄は、敗血症(180010)の傷病名があるときだけ入力する。
  M180010: (def) => ({
    ...def,
    fields: changeFields(def.fields, {
      4: { required: sepsis, visible: sepsis },
      8: { required: sepsis, visible: sepsis },
    }),
  }),
  M180020: (def) => ({
    ...def,
    fields: changeFields(def.fields, { 4: null, 8: null }),
  }),
};

export function revise2026(base: Dpc1RecordDef[]): Dpc1RecordDef[] {
  const revised = base
    .filter((def) => !REMOVED_CODES.has(def.code))
    .map((def) => REVISIONS[def.code]?.(def) ?? def);
  for (const [code, after] of Object.entries(INSERT_AFTER)) {
    const index = revised.findIndex((def) => def.code === after);
    revised.splice(index + 1, 0, ADDED_RECORDS[code]);
  }
  return revised;
}
