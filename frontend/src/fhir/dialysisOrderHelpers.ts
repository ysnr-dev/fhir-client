import { shortDate, today } from "../lib/dates";
import type { ValidationFailure } from "../lib/validation";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { DAY_OF_WEEK_OPTIONS } from "./injectionHelpers";
import { ORDER_TYPE_SYSTEM, applyOrderContext, type OrderAttribution } from "./orderHeader";
import {
  MEDICINE_CODE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  YJ_CODE_SYSTEM,
  type PrescriptionSetting,
} from "./prescriptionHelpers";
import {
  MEDICAL_MATERIAL_SYSTEM,
  categoryCoding,
  codingBySystem,
  displayOf,
  orderComment,
  orderDay,
  registrationAuthoredOn,
  transactionBundle,
  withVersionLock,
} from "./shared";
import { keepOrderRevoked } from "./taskHelpers";

// 透析(血液浄化)オーダー。リハビリと同じ期間継続型で、ヘッダ ServiceRequest 1 本が
// 何か月も続き、各回の予約と実施がそれを指す(docs/dialysis-order-design.md)。
//
//   code               = 浄化方法(HD・HDF・CHDF など)
//   occurrenceDateTime = 開始日
//   extension[dialysis-order-end]        = 終了日(無ければ継続中)
//   extension[dialysis-bedside]          = ベッドサイドで行う(透析室のベッドを取らない)
//   extension[dialysis-schedule-pattern] ×N = 曜日 × シフト
//   extension[dialysis-prescription]     = 透析条件(1 回の透析の属性なので明細にしない)
//
// 条件の変更は同じオーダーの編集で行う。作り直すと展開済みの予約の basedOn を付け直すことになるため。
// ドライウェイトは週単位で見直す患者の状態値なのでオーダーに持たない。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const DIALYSIS_ORDER_TYPE = { code: "dialysis", display: "透析" };

const LOCAL = "http://fhir-client.local";

/** 浄化方法。固定の分類で施設ごとに増減しないので DB マスタを持たない。 */
export const DIALYSIS_MODALITY_SYSTEM = `${LOCAL}/CodeSystem/dialysis-modality`;
/** シフト。コードは施設設定 `dialysis_shifts` のもの。 */
export const DIALYSIS_SHIFT_SYSTEM = `${LOCAL}/CodeSystem/dialysis-shift`;

/** 上流の order-period が終了として読む拡張(ORDER_END_EXTENSION_URLS)。 */
const ORDER_END_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-order-end`;
const BEDSIDE_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-bedside`;
const SCHEDULE_PATTERN_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-schedule-pattern`;
const PRESCRIPTION_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-prescription`;

const UCUM_SYSTEM = "http://unitsofmeasure.org";
const FLOW_UNIT = "mL/min";
const VOLUME_UNIT = "L";

// ---- 固定の分類 ----

export type DialysisModality = "hd" | "hdf" | "i-hdf" | "chdf" | "chd" | "pe" | "dfpp" | "dhp";

/** 並びは維持透析、急性血液浄化の順。 */
export const DIALYSIS_MODALITY_OPTIONS: { code: DialysisModality; display: string; short: string }[] = [
  { code: "hd", display: "血液透析(HD)", short: "HD" },
  { code: "hdf", display: "血液透析濾過(HDF)", short: "HDF" },
  { code: "i-hdf", display: "間歇補充型血液透析濾過(I-HDF)", short: "I-HDF" },
  { code: "chdf", display: "持続的血液濾過透析(CHDF)", short: "CHDF" },
  { code: "chd", display: "持続的血液透析(CHD)", short: "CHD" },
  { code: "pe", display: "血漿交換(PE)", short: "PE" },
  { code: "dfpp", display: "二重膜濾過血漿交換(DFPP)", short: "DFPP" },
  { code: "dhp", display: "血液吸着(DHP)", short: "DHP" },
];

/** ICU・病棟のベッドサイドで行うことが多い急性血液浄化。ベッドサイドの初期値を決める。 */
const ACUTE_MODALITIES: readonly string[] = ["chdf", "chd", "pe", "dfpp", "dhp"];

/** 補液量を持つ浄化方法(濾過を伴うもの)。 */
const SUBSTITUTION_MODALITIES: readonly string[] = ["hdf", "i-hdf", "chdf"];

export function isAcuteDialysisModality(code: string): boolean {
  return ACUTE_MODALITIES.includes(code);
}

export function dialysisModalityHasSubstitution(code: string): boolean {
  return SUBSTITUTION_MODALITIES.includes(code);
}

export function dialysisModalityDisplay(code: string): string {
  return displayOf(DIALYSIS_MODALITY_OPTIONS, code);
}

export function dialysisModalityShort(code: string): string {
  return DIALYSIS_MODALITY_OPTIONS.find((o) => o.code === code)?.short ?? code;
}

export type DialysisAccessType = "avf" | "avg" | "catheter" | "other";

export const DIALYSIS_ACCESS_OPTIONS: { code: DialysisAccessType; display: string }[] = [
  { code: "avf", display: "自己血管内シャント" },
  { code: "avg", display: "人工血管" },
  { code: "catheter", display: "カテーテル" },
  { code: "other", display: "その他" },
];

/** 抗凝固薬の量の単位。持続量はこの単位の時間あたり。 */
export const DIALYSIS_DOSE_UNITS = ["単位", "IU", "mg"] as const;

// ---- フォームの値 ----

export interface DialysisPatternEntry {
  /** days-of-week のコード(mon〜sun)。 */
  dayOfWeek: string;
  shift: string;
  /** 登録時のシフト名。施設設定の名前を変えても登録済みのオーダーの表示は動かさない。 */
  shiftLabel: string;
}

export interface DialysisCodedValue {
  /** マスタのコード。マスタに無い名称の手入力は空。 */
  code: string;
  name: string;
}

export interface DialysisAnticoagulant {
  medicineCode: string;
  yjCode: string;
  name: string;
}

export interface DialysisOrderFormValues {
  setting: PrescriptionSetting;
  modality: DialysisModality | "";
  bedside: boolean;
  startDate: string;
  /** 終了日。空なら継続。 */
  endDate: string;
  /** 曜日 × シフト。ベッドサイドは持たない。 */
  pattern: DialysisPatternEntry[];
  /** 透析時間(分)。以下の数値は入力欄で扱うので文字列で持つ。 */
  durationMinutes: string;
  qb: string;
  qd: string;
  dialyzer: DialysisCodedValue | null;
  anticoagulant: DialysisAnticoagulant | null;
  anticoagulantInitialDose: string;
  anticoagulantContinuousDose: string;
  anticoagulantDoseUnit: string;
  dialysate: string;
  /** 補液量(L)。濾過を伴う浄化方法だけ。 */
  substitutionVolume: string;
  accessType: DialysisAccessType | "";
  accessSite: string;
  needle: string;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyDialysisOrderForm(setting: PrescriptionSetting): DialysisOrderFormValues {
  return {
    setting,
    modality: "",
    bedside: false,
    startDate: today(),
    endDate: "",
    pattern: [],
    durationMinutes: "",
    qb: "",
    qd: "",
    dialyzer: null,
    anticoagulant: null,
    anticoagulantInitialDose: "",
    anticoagulantContinuousDose: "",
    anticoagulantDoseUnit: DIALYSIS_DOSE_UNITS[0],
    dialysate: "",
    substitutionVolume: "",
    accessType: "",
    accessSite: "",
    needle: "",
    comment: "",
    problem: null,
  };
}

/** 検証で弾いた項目の鍵。フォームのラベルの印(FieldAlert)の宛先。 */
export type DialysisOrderField =
  | "modality"
  | "startDate"
  | "endDate"
  | "pattern"
  | "durationMinutes"
  | "qb"
  | "qd"
  | "anticoagulant"
  | "anticoagulantInitialDose"
  | "anticoagulantContinuousDose"
  | "substitutionVolume";

const MIN_DURATION_MINUTES = 30;
/** 持続的血液浄化(CHDF)の連日 24 時間まで。 */
const MAX_DURATION_MINUTES = 1440;

function isPositive(text: string): boolean {
  const value = Number(text);
  return Number.isFinite(value) && value > 0;
}

export function validateDialysisOrderForm(
  values: DialysisOrderFormValues,
  /** requireDates を偽にすると開始日を求めない(セットの内容としての入力)。 */
  { requireDates = true }: { requireDates?: boolean } = {},
): ValidationFailure<DialysisOrderField> | null {
  const fail = (field: DialysisOrderField, message: string) => ({ field, message });
  if (!values.modality) return fail("modality", "浄化方法を選んでください。");
  if (requireDates && !values.startDate) return fail("startDate", "開始日を入れてください。");
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    return fail("endDate", "終了日は開始日と同じか、それより後にしてください。");
  }
  if (!values.bedside && values.pattern.length === 0) {
    return fail("pattern", "曜日とシフトを 1 つ以上選んでください。");
  }
  if (!values.bedside && !values.durationMinutes) {
    return fail("durationMinutes", "透析時間を入れてください。");
  }
  if (values.durationMinutes) {
    const minutes = Number(values.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
      return fail(
        "durationMinutes",
        `透析時間は ${MIN_DURATION_MINUTES}〜${MAX_DURATION_MINUTES} 分の整数で入れてください。`,
      );
    }
  }
  if (values.qb && !isPositive(values.qb)) return fail("qb", "QB は正の数で入れてください。");
  if (values.qd && !isPositive(values.qd)) return fail("qd", "QD は正の数で入れてください。");
  if (values.substitutionVolume && !isPositive(values.substitutionVolume)) {
    return fail("substitutionVolume", "補液量は正の数で入れてください。");
  }
  if (values.anticoagulantInitialDose && !isPositive(values.anticoagulantInitialDose)) {
    return fail("anticoagulantInitialDose", "初回量は正の数で入れてください。");
  }
  if (values.anticoagulantContinuousDose && !isPositive(values.anticoagulantContinuousDose)) {
    return fail("anticoagulantContinuousDose", "持続量は正の数で入れてください。");
  }
  if (!values.anticoagulant && (values.anticoagulantInitialDose || values.anticoagulantContinuousDose)) {
    return fail("anticoagulant", "抗凝固薬を選んでください。");
  }
  return null;
}

// ---- FHIR リソースの組み立て ----

/** 透析オーダーの ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isDialysisServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === DIALYSIS_ORDER_TYPE.code;
}

function quantity(text: string, unit: string, ucum = false): fhir4.Quantity {
  return { value: Number(text), unit, ...(ucum ? { system: UCUM_SYSTEM, code: unit } : {}) };
}

/** 透析条件の複合拡張。入力の無い項目は載せない。何も無ければ undefined。 */
function buildPrescriptionExtension(values: DialysisOrderFormValues): fhir4.Extension | undefined {
  const children: fhir4.Extension[] = [];
  if (values.durationMinutes) {
    children.push({ url: "duration-minutes", valueInteger: Number(values.durationMinutes) });
  }
  if (values.qb) children.push({ url: "qb", valueQuantity: quantity(values.qb, FLOW_UNIT, true) });
  if (values.qd) children.push({ url: "qd", valueQuantity: quantity(values.qd, FLOW_UNIT, true) });
  if (values.dialyzer?.name.trim()) {
    const { code, name } = values.dialyzer;
    children.push({
      url: "dialyzer",
      valueCodeableConcept: {
        ...(code ? { coding: [{ system: MEDICAL_MATERIAL_SYSTEM, code, display: name }] } : {}),
        text: name.trim(),
      },
    });
  }
  if (values.anticoagulant) {
    const { medicineCode, yjCode, name } = values.anticoagulant;
    children.push({
      url: "anticoagulant",
      valueCodeableConcept: {
        coding: [
          { system: MEDICINE_CODE_SYSTEM, code: medicineCode, display: name },
          ...(yjCode ? [{ system: YJ_CODE_SYSTEM, code: yjCode }] : []),
        ],
        text: name,
      },
    });
    const unit = values.anticoagulantDoseUnit;
    if (values.anticoagulantInitialDose) {
      children.push({
        url: "anticoagulant-initial-dose",
        valueQuantity: quantity(values.anticoagulantInitialDose, unit),
      });
    }
    if (values.anticoagulantContinuousDose) {
      children.push({
        url: "anticoagulant-continuous-dose",
        valueQuantity: quantity(values.anticoagulantContinuousDose, `${unit}/h`),
      });
    }
  }
  if (values.dialysate.trim()) children.push({ url: "dialysate", valueString: values.dialysate.trim() });
  if (values.substitutionVolume && dialysisModalityHasSubstitution(values.modality)) {
    children.push({
      url: "substitution-volume",
      valueQuantity: quantity(values.substitutionVolume, VOLUME_UNIT, true),
    });
  }
  if (values.accessType) children.push({ url: "access-type", valueCode: values.accessType });
  if (values.accessSite.trim()) children.push({ url: "access-site", valueString: values.accessSite.trim() });
  if (values.needle.trim()) children.push({ url: "needle", valueString: values.needle.trim() });
  return children.length > 0 ? { url: PRESCRIPTION_EXT_URL, extension: children } : undefined;
}

/** 曜日の並び順にそろえる。 */
function sortedPattern(pattern: readonly DialysisPatternEntry[]): DialysisPatternEntry[] {
  const dayIndex = (code: string) => DAY_OF_WEEK_OPTIONS.findIndex((o) => o.code === code);
  return [...pattern].sort((a, b) => dayIndex(a.dayOfWeek) - dayIndex(b.dayOfWeek));
}

function buildDialysisOrderServiceRequest(
  values: DialysisOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 開始日。時刻は持たない(何時に行うかは予約と実施の担当)。
    occurrenceDateTime: values.startDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  if (values.modality) {
    const display = dialysisModalityDisplay(values.modality);
    resource.code = {
      coding: [{ system: DIALYSIS_MODALITY_SYSTEM, code: values.modality, display }],
      text: display,
    };
  }

  const extension: fhir4.Extension[] = [];
  if (values.endDate) extension.push({ url: ORDER_END_EXT_URL, valueDate: values.endDate });
  if (values.bedside) {
    extension.push({ url: BEDSIDE_EXT_URL, valueBoolean: true });
  } else {
    for (const entry of sortedPattern(values.pattern)) {
      extension.push({
        url: SCHEDULE_PATTERN_EXT_URL,
        extension: [
          { url: "dayOfWeek", valueCode: entry.dayOfWeek },
          {
            url: "shift",
            valueCoding: { system: DIALYSIS_SHIFT_SYSTEM, code: entry.shift, display: entry.shiftLabel },
          },
        ],
      });
    }
  }
  const prescription = buildPrescriptionExtension(values);
  if (prescription) extension.push(prescription);
  if (extension.length > 0) resource.extension = extension;

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];

  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }

  // 依頼医師・依頼科・入院病棟のローカル拡張。既存の extension に足す形で効く。
  applyOrderContext(resource, requester);

  return resource;
}

/** 新規登録。明細が無いのでヘッダ 1 件の POST だけ。 */
export function buildDialysisOrderBundle(
  values: DialysisOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildDialysisOrderServiceRequest(values, patientId, requester, registrationAuthoredOn()),
      request: { method: "POST", url: "ServiceRequest" },
    },
  ]);
}

/** 更新。既存ヘッダ 1 件への PUT だけ。登録日時は元のリソースから引き継ぐ。 */
export function buildDialysisOrderUpdateBundle(
  values: DialysisOrderFormValues,
  patientId: string,
  original: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  return keepOrderRevoked(
    withVersionLock(
      transactionBundle([
        {
          resource: buildDialysisOrderServiceRequest(
            values,
            patientId,
            requester,
            registrationAuthoredOn(original),
            original.id,
          ),
          request: { method: "PUT", url: `ServiceRequest/${original.id}` },
        },
      ]),
      original,
    ),
    original,
  );
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。開始を当日に戻し、
 * 終了は引き継がない(前のオーダーの終了日をそのまま持ってくると過去日になる)。
 */
export function buildDoDialysisOrderForm(
  values: DialysisOrderFormValues,
  setting: PrescriptionSetting,
): DialysisOrderFormValues {
  return { ...values, setting, startDate: today(), endDate: "" };
}

// ---- 一覧・カルテ表示のための parse ----

export function dialysisOrderEnd(sr: fhir4.ServiceRequest): string {
  const extension = sr.extension?.find((e) => e.url === ORDER_END_EXT_URL);
  return extension?.valueDate ?? extension?.valueDateTime?.slice(0, 10) ?? "";
}

export function dialysisOrderBedside(sr: fhir4.ServiceRequest): boolean {
  return sr.extension?.some((e) => e.url === BEDSIDE_EXT_URL && e.valueBoolean === true) ?? false;
}

export function dialysisOrderModality(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, DIALYSIS_MODALITY_SYSTEM)?.code ?? "";
}

export function dialysisOrderPattern(sr: fhir4.ServiceRequest): DialysisPatternEntry[] {
  return (sr.extension ?? [])
    .filter((e) => e.url === SCHEDULE_PATTERN_EXT_URL)
    .flatMap((e) => {
      const dayOfWeek = e.extension?.find((child) => child.url === "dayOfWeek")?.valueCode;
      const shift = e.extension?.find((child) => child.url === "shift")?.valueCoding;
      return dayOfWeek && shift?.code
        ? [{ dayOfWeek, shift: shift.code, shiftLabel: shift.display ?? shift.code }]
        : [];
    });
}

/** 「月水金 午前 / 火 午後」。シフトごとに曜日をまとめる。 */
export function dialysisPatternLabel(pattern: readonly DialysisPatternEntry[]): string {
  const byShift = new Map<string, { label: string; days: string[] }>();
  for (const entry of sortedPattern(pattern)) {
    const day = DAY_OF_WEEK_OPTIONS.find((o) => o.code === entry.dayOfWeek)?.label ?? entry.dayOfWeek;
    const group = byShift.get(entry.shift);
    if (group) group.days.push(day);
    else byShift.set(entry.shift, { label: entry.shiftLabel, days: [day] });
  }
  return [...byShift.values()].map(({ label, days }) => `${days.join("")} ${label}`).join(" / ");
}

function prescriptionChild(sr: fhir4.ServiceRequest, url: string): fhir4.Extension | undefined {
  return sr.extension?.find((e) => e.url === PRESCRIPTION_EXT_URL)?.extension?.find((e) => e.url === url);
}

function quantityText(extension: fhir4.Extension | undefined): string {
  const value = extension?.valueQuantity?.value;
  return value == null ? "" : String(value);
}

function quantityLabel(extension: fhir4.Extension | undefined): string {
  const text = quantityText(extension);
  return text ? `${text}${extension?.valueQuantity?.unit ?? ""}` : "";
}

export interface DialysisOrderSummary {
  settingDisplay: string;
  modality: string;
  /** 「血液透析(HD)」。 */
  modalityDisplay: string;
  /** 「HD」。 */
  modalityShort: string;
  bedside: boolean;
  /** 「8/29〜継続中」「8/29〜9/30」。 */
  periodLabel: string;
  startDate: string;
  endDate: string;
  /** 「月水金 午前」。ベッドサイドは「ベッドサイド」。 */
  scheduleLabel: string;
  /** 「4時間 / QB 200mL/min / QD 500mL/min」。 */
  conditionLabel: string;
  durationLabel: string;
  qbLabel: string;
  qdLabel: string;
  dialyzerName: string;
  anticoagulantName: string;
  /** 「初回 1000単位 / 持続 500単位/h」。 */
  anticoagulantDoseLabel: string;
  dialysate: string;
  substitutionLabel: string;
  /** 「自己血管内シャント 左前腕」。 */
  accessLabel: string;
  needle: string;
  comment: string;
}

/** 「4時間」「4時間30分」「90分」。 */
function durationLabel(minutes: number | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}分`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}時間${rest ? `${rest}分` : ""}`;
}

export function summarizeDialysisOrder(sr: fhir4.ServiceRequest): DialysisOrderSummary {
  const modality = dialysisOrderModality(sr);
  const startDate = (sr.occurrenceDateTime ?? "").slice(0, 10);
  const endDate = dialysisOrderEnd(sr);
  const bedside = dialysisOrderBedside(sr);
  const duration = durationLabel(prescriptionChild(sr, "duration-minutes")?.valueInteger);
  const qb = quantityLabel(prescriptionChild(sr, "qb"));
  const qd = quantityLabel(prescriptionChild(sr, "qd"));
  const initialDose = quantityLabel(prescriptionChild(sr, "anticoagulant-initial-dose"));
  const continuousDose = quantityLabel(prescriptionChild(sr, "anticoagulant-continuous-dose"));
  const accessType = prescriptionChild(sr, "access-type")?.valueCode ?? "";

  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    modality,
    modalityDisplay: sr.code?.text || dialysisModalityDisplay(modality),
    modalityShort: dialysisModalityShort(modality),
    bedside,
    periodLabel: startDate ? `${shortDate(startDate)}〜${endDate ? shortDate(endDate) : "継続中"}` : "",
    startDate,
    endDate,
    scheduleLabel: bedside ? "ベッドサイド" : dialysisPatternLabel(dialysisOrderPattern(sr)),
    conditionLabel: [duration, qb && `QB ${qb}`, qd && `QD ${qd}`].filter(Boolean).join(" / "),
    durationLabel: duration,
    qbLabel: qb,
    qdLabel: qd,
    dialyzerName: prescriptionChild(sr, "dialyzer")?.valueCodeableConcept?.text ?? "",
    anticoagulantName: prescriptionChild(sr, "anticoagulant")?.valueCodeableConcept?.text ?? "",
    anticoagulantDoseLabel: [initialDose && `初回 ${initialDose}`, continuousDose && `持続 ${continuousDose}`]
      .filter(Boolean)
      .join(" / "),
    dialysate: prescriptionChild(sr, "dialysate")?.valueString ?? "",
    substitutionLabel: quantityLabel(prescriptionChild(sr, "substitution-volume")),
    accessLabel: [
      accessType ? displayOf(DIALYSIS_ACCESS_OPTIONS, accessType) : "",
      prescriptionChild(sr, "access-site")?.valueString ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    needle: prescriptionChild(sr, "needle")?.valueString ?? "",
    comment: orderComment(sr),
  };
}

export const dialysisOrderComment = orderComment;
export const dialysisOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseDialysisOrderForm(sr: fhir4.ServiceRequest): DialysisOrderFormValues {
  const dialyzer = prescriptionChild(sr, "dialyzer")?.valueCodeableConcept;
  const anticoagulant = prescriptionChild(sr, "anticoagulant")?.valueCodeableConcept;
  const medicineCode = codingBySystem(anticoagulant?.coding, MEDICINE_CODE_SYSTEM)?.code;
  const initialDose = prescriptionChild(sr, "anticoagulant-initial-dose");
  const continuousDose = prescriptionChild(sr, "anticoagulant-continuous-dose");
  const doseUnit =
    initialDose?.valueQuantity?.unit ??
    continuousDose?.valueQuantity?.unit?.replace(/\/h$/, "") ??
    DIALYSIS_DOSE_UNITS[0];

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    modality: dialysisOrderModality(sr) as DialysisModality | "",
    bedside: dialysisOrderBedside(sr),
    startDate: orderDay(sr) || today(),
    endDate: dialysisOrderEnd(sr),
    pattern: dialysisOrderPattern(sr),
    durationMinutes: String(prescriptionChild(sr, "duration-minutes")?.valueInteger ?? ""),
    qb: quantityText(prescriptionChild(sr, "qb")),
    qd: quantityText(prescriptionChild(sr, "qd")),
    dialyzer: dialyzer?.text
      ? { code: codingBySystem(dialyzer.coding, MEDICAL_MATERIAL_SYSTEM)?.code ?? "", name: dialyzer.text }
      : null,
    anticoagulant:
      medicineCode && anticoagulant
        ? {
            medicineCode,
            yjCode: codingBySystem(anticoagulant.coding, YJ_CODE_SYSTEM)?.code ?? "",
            name: anticoagulant.text ?? medicineCode,
          }
        : null,
    anticoagulantInitialDose: quantityText(initialDose),
    anticoagulantContinuousDose: quantityText(continuousDose),
    anticoagulantDoseUnit: doseUnit,
    dialysate: prescriptionChild(sr, "dialysate")?.valueString ?? "",
    substitutionVolume: quantityText(prescriptionChild(sr, "substitution-volume")),
    accessType: (prescriptionChild(sr, "access-type")?.valueCode ?? "") as DialysisAccessType | "",
    accessSite: prescriptionChild(sr, "access-site")?.valueString ?? "",
    needle: prescriptionChild(sr, "needle")?.valueString ?? "",
    comment: dialysisOrderComment(sr),
    problem: dialysisOrderProblem(sr),
  };
}
