import {
  EARLY_WARNING_BAND_SYSTEM,
  EARLY_WARNING_SCORE_SYSTEM,
  JCS_MEASURE,
  NEWS2_CODE,
  SYSTOLIC,
  VITAL_MEASURE_CODE_SYSTEM,
  VITAL_MEASURES,
  type VitalFormValues,
} from "./vitalHelpers";
import { LOINC_SYSTEM } from "./shared";

// 早期警告スコア(NEWS2 / qSOFA)。設計は docs/early-warning-design.md。
//
// NEWS2(RCP 2017)は呼吸数・SpO2・酸素投与・収縮期血圧・脈拍・意識・体温の 7 項目を 0〜3 点で足す。
// 意識は JCS で記録し、ACVPU に写して点数にする。qSOFA は呼吸数 ≥ 22・収縮期血圧 ≤ 100・意識変容の 3 項目。
// 欠けた項目は 0 点にせず missing に返し、画面は「暫定」と添える。
//
// NEWS2 は測定セットの transaction に派生の Observation として同梱する(病棟一覧・患者帯が 1 本の検索で
// 最新の点数を引けるようにするため)。qSOFA は同じ入力から表示時に計算し、保存しない。

export type EarlyWarningBand = "low" | "low-medium" | "medium" | "high";

export const EARLY_WARNING_BAND_LABEL: Record<EarlyWarningBand, string> = {
  low: "低",
  "low-medium": "低〜中",
  medium: "中",
  high: "高",
};

const BAND_ORDER: EarlyWarningBand[] = ["low", "low-medium", "medium", "high"];

export function bandAtLeast(band: EarlyWarningBand, min: EarlyWarningBand): boolean {
  return BAND_ORDER.indexOf(band) >= BAND_ORDER.indexOf(min);
}

/** NEWS2 の項目。 */
export type News2ItemKey =
  | "respiration"
  | "spo2"
  | "oxygen"
  | "systolic"
  | "pulse"
  | "consciousness"
  | "temperature";

export const NEWS2_ITEM_LABEL: Record<News2ItemKey, string> = {
  respiration: "呼吸数",
  spo2: "SpO2",
  oxygen: "酸素",
  systolic: "収縮期血圧",
  pulse: "脈拍",
  consciousness: "意識",
  temperature: "体温",
};

const NEWS2_ITEM_ORDER: News2ItemKey[] = [
  "respiration",
  "spo2",
  "oxygen",
  "systolic",
  "pulse",
  "consciousness",
  "temperature",
];

/** 算出の入力。null は測っていない。 */
export interface EarlyWarningInput {
  respiration: number | null;
  spo2: number | null;
  /** 酸素流量(L/分)。0 は室内気。 */
  oxygenFlow: number | null;
  systolic: number | null;
  pulse: number | null;
  jcs: number | null;
  temperature: number | null;
  /** SpO2 スケール 2(高 CO2 血症のリスク)を医師が指定した患者。 */
  spo2Scale2: boolean;
}

export interface News2Item {
  key: News2ItemKey;
  points: number;
}

export interface News2Score {
  total: number;
  items: News2Item[];
  band: EarlyWarningBand;
  missing: News2ItemKey[];
}

export type Acvpu = "A" | "C" | "V" | "P" | "U";

/** JCS を ACVPU に写す。I 桁は新たな見当識障害(C)、II 桁は呼びかけで開眼(V)、III 桁は痛み(P)、300 は無反応(U)。 */
export function jcsToAcvpu(jcs: number): Acvpu {
  if (jcs <= 0) return "A";
  if (jcs < 10) return "C";
  if (jcs < 100) return "V";
  if (jcs < 300) return "P";
  return "U";
}

function respirationPoints(value: number): number {
  if (value <= 8) return 3;
  if (value <= 11) return 1;
  if (value <= 20) return 0;
  if (value <= 24) return 2;
  return 3;
}

function spo2Scale1Points(value: number): number {
  if (value <= 91) return 3;
  if (value <= 93) return 2;
  if (value <= 95) return 1;
  return 0;
}

/** スケール 2 は 88〜92% を目標にし、酸素投与中の 93% 以上も点数にする。 */
function spo2Scale2Points(value: number, onOxygen: boolean): number {
  if (value <= 83) return 3;
  if (value <= 85) return 2;
  if (value <= 87) return 1;
  if (value <= 92 || !onOxygen) return 0;
  if (value <= 94) return 1;
  if (value <= 96) return 2;
  return 3;
}

function systolicPoints(value: number): number {
  if (value <= 90) return 3;
  if (value <= 100) return 2;
  if (value <= 110) return 1;
  if (value <= 219) return 0;
  return 3;
}

function pulsePoints(value: number): number {
  if (value <= 40) return 3;
  if (value <= 50) return 1;
  if (value <= 90) return 0;
  if (value <= 110) return 1;
  if (value <= 130) return 2;
  return 3;
}

function temperaturePoints(value: number): number {
  if (value <= 35) return 3;
  if (value <= 36) return 1;
  if (value <= 38) return 0;
  if (value <= 39) return 1;
  return 2;
}

/** 合計 7 点以上は高、5〜6 点は中、単項目 3 点は低〜中、それ以外は低。 */
function news2Band(total: number, items: News2Item[]): EarlyWarningBand {
  if (total >= 7) return "high";
  if (total >= 5) return "medium";
  if (items.some((item) => item.points === 3)) return "low-medium";
  return "low";
}

export function computeNews2(input: EarlyWarningInput): News2Score {
  const onOxygen = input.oxygenFlow === null ? null : input.oxygenFlow > 0;
  const points: Record<News2ItemKey, number | null> = {
    respiration: input.respiration === null ? null : respirationPoints(input.respiration),
    spo2:
      input.spo2 === null
        ? null
        : input.spo2Scale2
          ? spo2Scale2Points(input.spo2, onOxygen ?? false)
          : spo2Scale1Points(input.spo2),
    oxygen: onOxygen === null ? null : onOxygen ? 2 : 0,
    systolic: input.systolic === null ? null : systolicPoints(input.systolic),
    pulse: input.pulse === null ? null : pulsePoints(input.pulse),
    consciousness: input.jcs === null ? null : jcsToAcvpu(input.jcs) === "A" ? 0 : 3,
    temperature: input.temperature === null ? null : temperaturePoints(input.temperature),
  };
  const items: News2Item[] = [];
  const missing: News2ItemKey[] = [];
  for (const key of NEWS2_ITEM_ORDER) {
    const value = points[key];
    if (value === null) missing.push(key);
    else items.push({ key, points: value });
  }
  const total = items.reduce((sum, item) => sum + item.points, 0);
  return { total, items, band: news2Band(total, items), missing };
}

export type QsofaItemKey = "respiration" | "systolic" | "consciousness";

export interface QsofaScore {
  score: number;
  /** 当てはまった項目。 */
  items: QsofaItemKey[];
  missing: QsofaItemKey[];
}

export function computeQsofa(input: EarlyWarningInput): QsofaScore {
  const checks: [QsofaItemKey, boolean | null][] = [
    ["respiration", input.respiration === null ? null : input.respiration >= 22],
    ["systolic", input.systolic === null ? null : input.systolic <= 100],
    ["consciousness", input.jcs === null ? null : input.jcs >= 1],
  ];
  const items = checks.filter(([, hit]) => hit === true).map(([key]) => key);
  const missing = checks.filter(([, hit]) => hit === null).map(([key]) => key);
  return { score: items.length, items, missing };
}

/** 算出に使う入力欄(右ペインと一括入力の両方が持つ)。 */
export type EarlyWarningFormFields = Pick<
  VitalFormValues,
  "respiration" | "spo2" | "oxygenFlow" | "systolic" | "pulse" | "jcs" | "temperature"
>;

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function earlyWarningInputOf(values: EarlyWarningFormFields, spo2Scale2: boolean): EarlyWarningInput {
  return {
    respiration: numberOrNull(values.respiration),
    spo2: numberOrNull(values.spo2),
    oxygenFlow: numberOrNull(values.oxygenFlow),
    systolic: numberOrNull(values.systolic),
    pulse: numberOrNull(values.pulse),
    jcs: numberOrNull(values.jcs),
    temperature: numberOrNull(values.temperature),
    spo2Scale2,
  };
}

/** 測定値が 1 つも無い(血圧の拡張期や体重だけ等)ときは算出しない。 */
export function hasEarlyWarningInput(score: News2Score): boolean {
  return score.items.length > 0;
}

// ---- 派生の Observation ----

/** 項目ごとの点数を入れる component の code。 */
function itemCoding(key: News2ItemKey): fhir4.Coding {
  if (key === "systolic") return { system: LOINC_SYSTEM, code: SYSTOLIC.code, display: SYSTOLIC.display };
  if (key === "consciousness") return { system: VITAL_MEASURE_CODE_SYSTEM, code: JCS_MEASURE.code, display: "JCS" };
  const measureKey = key === "oxygen" ? "oxygenFlow" : key;
  const measure = VITAL_MEASURES.find((m) => m.key === measureKey);
  return { system: LOINC_SYSTEM, code: measure?.code ?? "", display: measure?.display };
}

function itemKeyOf(component: fhir4.ObservationComponent): News2ItemKey | undefined {
  const coding = component.code?.coding?.[0];
  return NEWS2_ITEM_ORDER.find((key) => {
    const expected = itemCoding(key);
    return expected.system === coding?.system && expected.code === coding?.code;
  });
}

/**
 * 測定セットに同梱する NEWS2 の Observation。`base` は測定の Observation(identifier・subject・encounter・
 * 測定日時・extension をそのまま写す)。`derivedFrom` は同じ transaction の fullUrl。
 */
export function buildEarlyWarningObservation(args: {
  score: News2Score;
  base: fhir4.Observation;
  derivedFrom: string[];
}): fhir4.Observation {
  const { score, base } = args;
  return {
    resourceType: "Observation",
    status: "final",
    identifier: base.identifier,
    category: base.category,
    subject: base.subject,
    ...(base.encounter ? { encounter: base.encounter } : {}),
    effectiveDateTime: base.effectiveDateTime,
    ...(base.performer ? { performer: base.performer } : {}),
    ...(base.extension ? { extension: base.extension } : {}),
    code: {
      coding: [{ system: EARLY_WARNING_SCORE_SYSTEM, code: NEWS2_CODE, display: "NEWS2" }],
      text: "NEWS2",
    },
    valueInteger: score.total,
    interpretation: [
      {
        coding: [
          { system: EARLY_WARNING_BAND_SYSTEM, code: score.band, display: EARLY_WARNING_BAND_LABEL[score.band] },
        ],
      },
    ],
    derivedFrom: args.derivedFrom.map((reference) => ({ reference })),
    component: [
      ...score.items.map((item) => ({ code: { coding: [itemCoding(item.key)] }, valueInteger: item.points })),
      ...score.missing.map((key) => ({
        code: { coding: [itemCoding(key)] },
        dataAbsentReason: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "not-performed" }],
        },
      })),
    ],
  };
}

/** 保存済みの NEWS2(一覧・患者帯が読む)。 */
export interface EarlyWarningSummary {
  observationId: string;
  total: number;
  band: EarlyWarningBand;
  items: News2Item[];
  missing: News2ItemKey[];
  at: string;
}

export function earlyWarningFromObservation(observation: fhir4.Observation): EarlyWarningSummary | null {
  if (observation.valueInteger === undefined) return null;
  const bandCode = observation.interpretation
    ?.flatMap((concept) => concept.coding ?? [])
    .find((coding) => coding.system === EARLY_WARNING_BAND_SYSTEM)?.code;
  const band = BAND_ORDER.find((b) => b === bandCode) ?? "low";
  const items: News2Item[] = [];
  const missing: News2ItemKey[] = [];
  for (const component of observation.component ?? []) {
    const key = itemKeyOf(component);
    if (!key) continue;
    if (component.valueInteger !== undefined) items.push({ key, points: component.valueInteger });
    else missing.push(key);
  }
  return {
    observationId: observation.id ?? "",
    total: observation.valueInteger,
    band,
    items,
    missing,
    at: observation.effectiveDateTime ?? "",
  };
}

/** 「NEWS2 7点(高)」。暫定なら「・暫定」を添える。 */
export function earlyWarningText(score: { total: number; band: EarlyWarningBand; missing: News2ItemKey[] }): string {
  return `NEWS2 ${score.total}点(${EARLY_WARNING_BAND_LABEL[score.band]})${score.missing.length ? "・暫定" : ""}`;
}

/** 「呼吸数 2・SpO2 2 …」(点数のある項目だけ)。 */
export function news2ItemsText(items: News2Item[]): string {
  return items
    .filter((item) => item.points > 0)
    .map((item) => `${NEWS2_ITEM_LABEL[item.key]} ${item.points}`)
    .join("・");
}

export function news2MissingText(missing: News2ItemKey[]): string {
  return missing.map((key) => NEWS2_ITEM_LABEL[key]).join("・");
}

// ---- 施設設定 ----

export interface EarlyWarningSettings {
  /** 算出と通知を行うか。 */
  enabled: boolean;
  /** 主治医に通知する区分の下限。 */
  notify_band: Exclude<EarlyWarningBand, "low">;
  /** 入力フォームに qSOFA を併記するか。 */
  show_qsofa: boolean;
}

export const DEFAULT_EARLY_WARNING: EarlyWarningSettings = {
  enabled: false,
  notify_band: "medium",
  show_qsofa: true,
};

export const EARLY_WARNING_NOTIFY_BANDS: Exclude<EarlyWarningBand, "low">[] = ["low-medium", "medium", "high"];

/** SpO2 スケール 2 の注意区分(注意区分マスタの code)。 */
export const SPO2_SCALE2_CAUTION_CODE = "spo2-scale2";
