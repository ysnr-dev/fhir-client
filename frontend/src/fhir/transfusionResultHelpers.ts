import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { nowFhirDateTime } from "../lib/dates";
import { parseIsbt128 } from "./isbt128";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { displayName, patientNumberOf } from "./patientHelpers";
import {
  PRODUCT_SYSTEM,
  TRANSFUSION_ORDER_TYPE,
  bloodTypeExtensions,
  bloodTypeLabel,
  bloodTypeOfExtensions,
  transfusionOrderProducts,
  type AboBloodType,
  type RhdBloodType,
  type TransfusionProductValues,
} from "./transfusionOrderHelpers";
import { buildTransfusionTaskUpdate } from "./transfusionTaskHelpers";
import { conceptLabel, displayOf, referenceIdOfType } from "./shared";
import {
  BLOOD_PRESSURE,
  VITAL_MEASURES,
  buildVitalObservations,
  emptyVitalFormValues,
  type VitalFormValues,
} from "./vitalHelpers";

// 輸血の実施記録。手術(docs/surgery-result-design.md)と同じ形。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (実施記録。オーダー単位で1件)
//         │  performedPeriod = 輸血の開始/終了
//         │  performer       = 実施者(performer)と確認者(verifier)
//         │  extension       = 照合(患者・バッグのバーコード)の結果
//         │  note            = 実施コメント
//         ├ partOf ← MedicationAdministration (バッグ 1 本ごと。入れなかったバッグは not-done)
//         ├ partOf ← Observation              (副作用の有無と症状。投与後の遅発性副作用も同じ code)
//         └ partOf ← Observation              (投与前・5 分後・15 分後・終了時のバイタル)
//
// 他部門の実施記録と違うところ:
//
// - **時点ではなく期間で持つ**。輸血は「いつ始めていつ終わったか」が副作用の判断に
//   直結する(開始 15 分以内の観察が要る)ため、処置の performedDateTime(時点)では
//   なく performedPeriod にする。バッグごとの時刻も MedicationAdministration の
//   effectivePeriod(R4 標準)で持つ。
// - **製剤番号をローカル拡張で持つ**。FHIR で製剤のロット番号を標準的に置く場所は
//   Medication.batch.lotNumber だが、このコードベースは処方・注射・処置・手術の
//   どこでも contained Medication を使っておらず(すべて medicationCodeableConcept)、
//   ここだけ別の作法を持ち込むと読み手が 2 通りの形を覚えることになる。在庫引当を
//   しないので Medication インスタンスを作る動機も無い
//   (docs/transfusion-order-design.md §2.6)。
// - **副作用は「なし」も記録する**。輸血では観察したうえで無かったことが記録として
//   要るので、Observation が無い = 未観察、値が none = 観察して無かった、を区別する。
//   症状は日本輸血・細胞治療学会の症状項目を component に並べる。
// - **入れなかったバッグも記録する**。出庫したのに未実施・返却したバッグは
//   status = not-done の MedicationAdministration にして理由を持つ(ガイド 7.5.3-4)。
//   医事・ロット管理は completed だけを投与として数える。
// - **バイタルはふつうのバイタル(vital-signs)として書く**。経過表にそのまま載り、
//   partOf と時点の拡張でこの輸血の観察だと分かる。
//
// Procedure.code は輸血手技のコード表を持っていないので text だけ("輸血")。
// 輸血手技のレセコン向けコードは backend の receipt_codes が持つ。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** 製剤番号(ロット番号)。MedicationAdministration に直接付ける。 */
const LOT_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-lot-number";

/** 実施記録の Observation の code。手術の surgery-observation と同じ役割。 */
export const OBSERVATION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-observation";
/** 副作用の値(なし / あり)。code の体系とは別に持つ。 */
const REACTION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-reaction";
/** 副作用の症状項目(日本輸血・細胞治療学会 ヘモビジランス委員会「輸血副反応の症状項目」)。 */
export const REACTION_SYMPTOM_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-reaction-symptom";
/** 副作用の時期。即時(輸血中〜直後)か遅発性(輸血後 24 時間以降)か。 */
const REACTION_TIMING_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-reaction-timing";
/** バイタルの観察時点(投与前・5 分後・15 分後・終了時)。 */
const OBSERVATION_POINT_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-observation-point";
/** 入れなかったバッグの理由(MedicationAdministration.statusReason)。 */
const BAG_OUTCOME_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-bag-outcome";
/** 実施者・確認者の役割(Procedure.performer.function)。 */
const PERFORMER_FUNCTION_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-performer";
/** 投与時の照合の結果(Procedure の拡張)。 */
export const TRANSFUSION_VERIFICATION_EXT_URL =
  "http://fhir-client.local/StructureDefinition/transfusion-verification";
export const TRANSFUSION_VERIFICATION_SKIP_REASON_SYSTEM =
  "http://fhir-client.local/CodeSystem/transfusion-verification-skip-reason";

export const REACTION_CODE = { code: "reaction", display: "輸血副作用" };

/**
 * 副作用の有無。「未観察」を選択肢に置かないのは、観察していないことを
 * Observation を作らないことで表すため(§2.7)。
 */
export type TransfusionReaction = "none" | "present";

export const REACTION_OPTIONS: { code: TransfusionReaction; display: string }[] = [
  { code: "none", display: "なし" },
  { code: "present", display: "あり" },
];

export function reactionDisplay(code: string): string {
  return REACTION_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

/** 日本輸血・細胞治療学会の症状項目(ガイド引用文献 2)。 */
export const REACTION_SYMPTOM_OPTIONS: { code: string; display: string }[] = [
  { code: "fever", display: "発熱" },
  { code: "chills", display: "悪寒・戦慄" },
  { code: "flushing", display: "熱感・ほてり" },
  { code: "itching", display: "掻痒感・かゆみ" },
  { code: "redness", display: "発赤・顔面紅潮" },
  { code: "urticaria", display: "発疹・蕁麻疹" },
  { code: "dyspnea", display: "呼吸困難" },
  { code: "nausea", display: "嘔気・嘔吐" },
  { code: "pain", display: "胸痛・腹痛・腰背部痛" },
  { code: "headache", display: "頭痛・頭重感" },
  { code: "hypotension", display: "血圧低下" },
  { code: "hypertension", display: "血圧上昇" },
  { code: "tachycardia", display: "動悸・頻脈" },
  { code: "vascular-pain", display: "血管痛" },
  { code: "consciousness", display: "意識障害" },
  { code: "hemoglobinuria", display: "赤褐色尿(血色素尿)" },
  { code: "other", display: "その他" },
];

export function reactionSymptomDisplay(code: string): string {
  return displayOf(REACTION_SYMPTOM_OPTIONS, code);
}

/** 入れなかったバッグの扱い。 */
export type TransfusionBagOutcome = "given" | "not-given" | "returned";

export const BAG_OUTCOME_OPTIONS: { code: TransfusionBagOutcome; display: string }[] = [
  { code: "given", display: "実施" },
  { code: "not-given", display: "未実施" },
  { code: "returned", display: "返却" },
];

export function bagOutcomeDisplay(code: string): string {
  return displayOf(BAG_OUTCOME_OPTIONS, code);
}

/** 観察の時点。投与前・5 分後・15 分後・終了時(ガイド 6.1)。 */
export const OBSERVATION_POINTS = [
  { code: "before", display: "投与前", offsetMinutes: 0 },
  { code: "5min", display: "5分後", offsetMinutes: 5 },
  { code: "15min", display: "15分後", offsetMinutes: 15 },
  { code: "end", display: "終了時", offsetMinutes: null },
] as const;

export type ObservationPointCode = (typeof OBSERVATION_POINTS)[number]["code"];

export function observationPointDisplay(code: string): string {
  return OBSERVATION_POINTS.find((p) => p.code === code)?.display ?? code;
}

export const VERIFICATION_SKIP_REASON_OPTIONS: { code: string; display: string }[] = [
  { code: "emergency", display: "緊急・急変" },
  { code: "no-wristband", display: "リストバンド未装着・読取不可" },
  { code: "no-label", display: "製剤ラベル読取不可" },
  { code: "scanner-unavailable", display: "リーダー不調" },
  { code: "no-practitioner", display: "ログインに医療従事者が無い" },
  { code: "other", display: "その他" },
];

export function verificationSkipReasonDisplay(code: string): string {
  return displayOf(VERIFICATION_SKIP_REASON_OPTIONS, code);
}

// ---- 実施入力フォームの値 ----

/** 輸血したバッグ 1 本。製剤番号は遡及調査の起点になるので 1 本ずつ持つ。 */
export interface TransfusionBagLine {
  productCode: string;
  productName: string;
  /** 単位数。オーダーの単位数を初期値にする。 */
  units: string;
  /** 単位の呼び方(単位 / mL / 本)。 */
  unitLabel: string;
  /** 製剤番号(ロット番号)。 */
  lotNumber: string;
  /** バッグの血液型(出庫記録から写す)。 */
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  /** 実施したか。出庫したのに入れなかったバッグは未実施・返却で残す。 */
  outcome: TransfusionBagOutcome;
  /**
   * このバッグの開始・終了。空なら輸血全体の開始・終了を使う
   * (1 本だけの輸血でいちいち同じ時刻を 2 回入れさせないため)。
   */
  startedAt: string;
  endedAt: string;
}

/** 観察 1 時点。バイタルの入力値とその時刻。 */
export interface TransfusionObservationPoint {
  point: ObservationPointCode;
  vitals: VitalFormValues;
}

/** 投与時の照合の結果。ハブの Procedure の拡張に書く。 */
export interface TransfusionVerificationValues {
  status: "verified" | "skipped";
  patientMatched: boolean;
  /** 一致した製剤番号。 */
  bagNumbers: string[];
  reasonCode?: string;
  reasonText?: string;
  /** 照合を終えた・スキップした日時(オフセット付き)。 */
  at: string;
}

export interface TransfusionPerformFormValues {
  /** 輸血全体の開始・終了。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  startedAt: string;
  endedAt: string;
  performerId: string;
  performerName: string;
  /** 確認者(実施者と一緒にバッグと患者を読み合わせた人)。 */
  confirmerId: string;
  confirmerName: string;
  bags: TransfusionBagLine[];
  /** 副作用の有無。必ず選ばせる(未選択のままでは登録させない)。 */
  reaction: TransfusionReaction | "";
  /** 副作用の症状(REACTION_SYMPTOM_OPTIONS の code)。あり のときだけ使う。 */
  symptoms: string[];
  /** 副作用の内容(自由記述)。 */
  reactionNote: string;
  observations: TransfusionObservationPoint[];
  verification: TransfusionVerificationValues | null;
  comment: string;
}

export function emptyBagLine(): TransfusionBagLine {
  return {
    productCode: "",
    productName: "",
    units: "",
    unitLabel: "単位",
    lotNumber: "",
    abo: "",
    rhd: "",
    outcome: "given",
    startedAt: "",
    endedAt: "",
  };
}

/** オーダーの製剤から実施入力の初期行を作る。単位数はオーダーの値をそのまま置く。 */
export function bagLinesFromOrder(
  itemRequests: fhir4.ServiceRequest[],
): TransfusionBagLine[] {
  return transfusionOrderProducts(itemRequests).map((product: TransfusionProductValues) => ({
    ...emptyBagLine(),
    productCode: product.productCode,
    productName: product.productName,
    units: product.units,
    unitLabel: product.unitLabel,
    abo: product.abo,
    rhd: product.rhd,
  }));
}

/** 観察の時点の初期値。時刻は開始時刻からのずらしで入れ、終了時は終了時刻が入れば追う。 */
export function observationPointsFrom(startedAt: string, endedAt: string): TransfusionObservationPoint[] {
  return OBSERVATION_POINTS.map((point) => ({
    point: point.code,
    vitals: { ...emptyVitalFormValues(), measuredAt: pointTime(point.code, startedAt, endedAt) },
  }));
}

export function pointTime(point: ObservationPointCode, startedAt: string, endedAt: string): string {
  const definition = OBSERVATION_POINTS.find((p) => p.code === point);
  if (!definition) return "";
  if (definition.offsetMinutes === null) return endedAt;
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + definition.offsetMinutes);
  return toDateTimeInput(date);
}

export function emptyTransfusionPerformForm(
  itemRequests: fhir4.ServiceRequest[],
): TransfusionPerformFormValues {
  const now = toDateTimeInput(new Date());
  return {
    startedAt: now,
    endedAt: "",
    performerId: "",
    performerName: "",
    confirmerId: "",
    confirmerName: "",
    bags: bagLinesFromOrder(itemRequests),
    reaction: "",
    symptoms: [],
    reactionNote: "",
    observations: observationPointsFrom(now, ""),
    verification: null,
    comment: "",
  };
}

/** 時点にバイタルが 1 つでも入っているか(空の時点は Observation を作らない)。 */
export function hasVitalValues(vitals: VitalFormValues): boolean {
  return (
    Boolean(vitals.systolic && vitals.diastolic) ||
    VITAL_MEASURES.some((m) => vitals[m.key] !== "") ||
    vitals.jcs !== ""
  );
}

// ---- 投与時の照合 ----

export interface TransfusionScanState {
  patient: "none" | "matched" | "mismatch";
  scannedPatient: string;
  /** 一致した製剤番号。 */
  bagNumbers: string[];
  message: { text: string; error: boolean } | null;
}

export const EMPTY_TRANSFUSION_SCAN: TransfusionScanState = {
  patient: "none",
  scannedPatient: "",
  bagNumbers: [],
  message: null,
};

function patientCodesOf(patient: fhir4.Patient): Set<string> {
  const codes = (patient.identifier ?? []).map((i) => i.value ?? "").filter(Boolean);
  if (patient.id) codes.push(patient.id);
  return new Set(codes.map((code) => code.normalize("NFKC").trim().toUpperCase()));
}

/**
 * 1 回の読み取りを照合して次の状態を返す。製剤ラベルの献血番号(ISBT 128 の `=`)は
 * 入力中のバッグの製剤番号と、それ以外は患者番号(リストバンド)と突き合わせる。
 */
export function applyTransfusionScan(
  state: TransfusionScanState,
  raw: string,
  context: { patient: fhir4.Patient | undefined; bagNumbers: string[] },
): TransfusionScanState {
  const value = raw.normalize("NFKC").trim().toUpperCase();
  if (!value) return state;
  const field = parseIsbt128(value);
  if (field?.kind === "din" || (!field && context.bagNumbers.includes(value))) {
    const number = field?.kind === "din" ? field.value : value;
    if (!context.bagNumbers.includes(number)) {
      return { ...state, message: { text: `製剤番号 ${number} はこの輸血のバッグにありません。`, error: true } };
    }
    const bagNumbers = state.bagNumbers.includes(number) ? state.bagNumbers : [...state.bagNumbers, number];
    return { ...state, bagNumbers, message: { text: `バッグ ${number} 一致`, error: false } };
  }
  if (field) {
    return { ...state, message: { text: "製剤ラベルの献血番号を読んでください。", error: true } };
  }
  if (!context.patient) return state;
  if (patientCodesOf(context.patient).has(value)) {
    return { ...state, patient: "matched", scannedPatient: value, message: { text: "患者 一致", error: false } };
  }
  return {
    ...state,
    patient: "mismatch",
    scannedPatient: value,
    message: { text: `患者番号 ${value} はこの患者ではありません。`, error: true },
  };
}

/** 患者の見出し(照合の表に出す)。 */
export function patientVerifyLabel(patient: fhir4.Patient | undefined): string {
  return patient ? `${displayName(patient)}　${patientNumberOf(patient) ?? ""}` : "";
}

function verificationExtension(values: TransfusionVerificationValues): fhir4.Extension {
  const parts: fhir4.Extension[] = [
    { url: "status", valueCode: values.status },
    { url: "patient", valueCode: values.patientMatched ? "matched" : "not-scanned" },
    ...values.bagNumbers.map((number) => ({ url: "bag", valueString: number })),
  ];
  if (values.status === "skipped" && values.reasonCode) {
    const text = values.reasonText?.trim();
    parts.push({
      url: "reason",
      valueCodeableConcept: {
        coding: [
          {
            system: TRANSFUSION_VERIFICATION_SKIP_REASON_SYSTEM,
            code: values.reasonCode,
            display: verificationSkipReasonDisplay(values.reasonCode),
          },
        ],
        ...(text ? { text } : {}),
      },
    });
  }
  parts.push({ url: "at", valueDateTime: values.at });
  return { url: TRANSFUSION_VERIFICATION_EXT_URL, extension: parts };
}

/** 「照合済」/「照合スキップ(緊急・急変)」。照合を出さなかった記録は空。 */
export function verificationLabelOf(procedure: fhir4.Procedure): string {
  const ext = procedure.extension?.find((e) => e.url === TRANSFUSION_VERIFICATION_EXT_URL);
  if (!ext) return "";
  const part = (url: string) => ext.extension?.find((e) => e.url === url);
  if (part("status")?.valueCode !== "skipped") return "照合済";
  const reason = part("reason")?.valueCodeableConcept;
  const label = [reason?.coding?.[0]?.display, reason?.text].filter(Boolean).join(" ");
  return label ? `照合スキップ(${label})` : "照合スキップ";
}

// ---- FHIR リソースの組み立て ----

function performedPeriod(values: TransfusionPerformFormValues): fhir4.Period {
  const period: fhir4.Period = { start: toFhirDateTime(values.startedAt) };
  if (values.endedAt) period.end = toFhirDateTime(values.endedAt);
  return period;
}

function performerEntry(
  id: string,
  name: string,
  role: { code: string; display: string },
): fhir4.ProcedurePerformer {
  return {
    function: { coding: [{ system: PERFORMER_FUNCTION_SYSTEM, ...role }] },
    actor: { reference: `Practitioner/${id}`, display: name || undefined },
  };
}

const PERFORMER_ROLE = { code: "performer", display: "実施者" };
const VERIFIER_ROLE = { code: "verifier", display: "確認者" };

function buildHubProcedure(
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 処方・処置・手術の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...TRANSFUSION_ORDER_TYPE }] },
    // 輸血手技のコード表を持っていないので表示名だけ。
    code: { text: TRANSFUSION_ORDER_TYPE.display },
    subject,
    basedOn: [{ reference: orderReference }],
    performedPeriod: performedPeriod(values),
  };

  const performer: fhir4.ProcedurePerformer[] = [];
  if (values.performerId) performer.push(performerEntry(values.performerId, values.performerName, PERFORMER_ROLE));
  if (values.confirmerId) performer.push(performerEntry(values.confirmerId, values.confirmerName, VERIFIER_ROLE));
  if (performer.length > 0) procedure.performer = performer;
  if (values.verification) procedure.extension = [verificationExtension(values.verification)];
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];

  return procedure;
}

function buildBagAdministration(
  bag: TransfusionBagLine,
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationAdministration {
  // effective[x] は 1..1 なので必ず埋める。バッグごとの時刻を入れていなければ
  // 輸血全体の時間帯をそのまま使う。
  const period: fhir4.Period = {
    start: toFhirDateTime(bag.startedAt || values.startedAt),
  };
  const end = bag.endedAt || values.endedAt;
  if (end) period.end = toFhirDateTime(end);

  const dosage: fhir4.MedicationAdministrationDosage = {};
  const units = Number(bag.units);
  if (Number.isFinite(units) && units > 0) {
    // 単位は製剤マスタの数え方(単位 / mL / 本)。UCUM には無いので表示名だけ持たせる。
    dosage.dose = { value: units, unit: bag.unitLabel || "単位" };
  }

  const given = bag.outcome === "given";
  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    status: given ? "completed" : "not-done",
    medicationCodeableConcept: {
      coding: [{ system: PRODUCT_SYSTEM, code: bag.productCode, display: bag.productName }],
      text: bag.productName,
    },
    subject,
    effectivePeriod: period,
    partOf: [{ reference: hubReference }],
    ...(given && dosage.dose ? { dosage } : {}),
  };
  if (!given) {
    administration.statusReason = [
      {
        coding: [{ system: BAG_OUTCOME_SYSTEM, code: bag.outcome, display: bagOutcomeDisplay(bag.outcome) }],
        text: bagOutcomeDisplay(bag.outcome),
      },
    ];
  }

  const extension: fhir4.Extension[] = bloodTypeExtensions(bag.abo, bag.rhd);
  if (bag.lotNumber.trim()) extension.unshift({ url: LOT_NUMBER_EXT_URL, valueString: bag.lotNumber.trim() });
  if (extension.length > 0) administration.extension = extension;

  return administration;
}

function reactionObservation(
  reaction: TransfusionReaction,
  symptoms: string[],
  note: string,
  effectiveDateTime: string,
  timing: "immediate" | "delayed",
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.Observation {
  const display = reactionDisplay(reaction);
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    // 他部門の Observation(手術の出血量など)と振り分けるための区分。
    category: [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...TRANSFUSION_ORDER_TYPE }] }],
    code: {
      coding: [{ system: OBSERVATION_SYSTEM, ...REACTION_CODE }],
      text: REACTION_CODE.display,
    },
    subject,
    effectiveDateTime,
    valueCodeableConcept: {
      coding: [{ system: REACTION_SYSTEM, code: reaction, display }],
      text: display,
    },
    partOf: [{ reference: hubReference }],
    extension: [{ url: REACTION_TIMING_EXT_URL, valueCode: timing }],
  };

  if (reaction === "present" && symptoms.length > 0) {
    observation.component = symptoms.map((code) => ({
      code: { coding: [{ system: REACTION_SYMPTOM_SYSTEM, code, display: reactionSymptomDisplay(code) }] },
      valueBoolean: true,
    }));
  }
  if (reaction === "present" && note.trim()) observation.note = [{ text: note.trim() }];

  return observation;
}

/** 観察の時点のバイタル。ふつうのバイタル(vital-signs)として書き、partOf と時点の拡張で結ぶ。 */
function buildPointObservations(
  point: TransfusionObservationPoint,
  values: TransfusionPerformFormValues,
  patientId: string,
  hubReference: string,
): fhir4.Observation[] {
  if (!hasVitalValues(point.vitals) || !point.vitals.measuredAt) return [];
  return buildVitalObservations({
    values: point.vitals,
    patientId,
    entryId: crypto.randomUUID(),
    problem: null,
    performer: values.performerId
      ? { reference: `Practitioner/${values.performerId}`, display: values.performerName || undefined }
      : undefined,
  }).map((observation) => ({
    ...observation,
    partOf: [{ reference: hubReference }],
    extension: [
      ...(observation.extension ?? []),
      { url: OBSERVATION_POINT_EXT_URL, valueCode: point.point },
    ],
  }));
}

/** 実施記録一式(ハブの Procedure・バッグ・副作用・観察)の POST エントリ。 */
function performEntries(
  values: TransfusionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.BundleEntry[] {
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  const patientId = referenceIdOfType(subject.reference, "Patient");

  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildHubProcedure(values, subject, orderReference),
      request: { method: "POST", url: "Procedure" },
    },
  ];

  // 製剤が選ばれていない行(追加したまま入力しなかった行)は保存しない。
  for (const bag of values.bags.filter((line) => line.productCode)) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildBagAdministration(bag, values, subject, hubReference),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  if (values.reaction) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: reactionObservation(
        values.reaction,
        values.symptoms,
        values.reactionNote,
        toFhirDateTime(values.startedAt),
        "immediate",
        subject,
        hubReference,
      ),
      request: { method: "POST", url: "Observation" },
    });
  }

  for (const point of values.observations) {
    for (const observation of buildPointObservations(point, values, patientId, hubReference)) {
      entries.push({
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: observation,
        request: { method: "POST", url: "Observation" },
      });
    }
  }

  return entries;
}

/**
 * 実施登録の transaction Bundle。実施記録一式と Task の完了を 1 つにまとめ、
 * 実施情報だけ保存されて進捗が止まる状態を作らない。
 */
export function buildTransfusionPerformBundle(
  values: TransfusionPerformFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const entries = performEntries(values, order.subject ?? {}, `ServiceRequest/${order.id ?? ""}`);

  // 進捗の完了。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  entries.push({
    resource: buildTransfusionTaskUpdate(task, order, "completed"),
    request: task?.id
      ? { method: "PUT", url: `Task/${task.id}` }
      : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** 遅発性副作用の追記。 */
export interface DelayedReactionValues {
  /** 発症日時。datetime-local の入力形式。 */
  onsetAt: string;
  symptoms: string[];
  note: string;
}

/** 実施済みの輸血に、後から分かった副作用(遅発性)を足す Observation。 */
export function buildDelayedReactionObservation(
  values: DelayedReactionValues,
  hub: fhir4.Procedure,
): fhir4.Observation {
  return reactionObservation(
    "present",
    values.symptoms,
    values.note,
    toFhirDateTime(values.onsetAt),
    "delayed",
    hub.subject,
    `Procedure/${hub.id ?? ""}`,
  );
}

/**
 * 実施取消で消す実施記録の DELETE エントリ。
 *
 * 手術と同じく実施記録ごと消す(放射線・生理・内視鏡・処置は Task を戻すだけで
 * 記録を残している)。輸血の実施記録は「このバッグを輸血した」という遡及調査の
 * 記録そのもので、取り消したのに残っているとその記録が嘘になるため。
 */
export function buildTransfusionPerformDeleteEntries(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): fhir4.BundleEntry[] {
  const hubs = procedures.filter(isTransfusionProcedure);
  const hubIds = new Set(hubs.map((procedure) => procedure.id).filter(Boolean));
  const belongsToHub = (resource: { partOf?: fhir4.Reference[] }) =>
    (resource.partOf ?? []).some((reference) =>
      hubIds.has(referenceIdOfType(reference.reference, "Procedure")),
    );

  const deleteEntry = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE" as const, url: `${resourceType}/${id}` } }] : [];

  // 子(バッグ・副作用・観察)を先に消してから親を消す。
  return [
    ...observations.filter(belongsToHub).flatMap((o) => deleteEntry("Observation", o.id)),
    ...administrations
      .filter(belongsToHub)
      .flatMap((a) => deleteEntry("MedicationAdministration", a.id)),
    ...hubs.flatMap((procedure) => deleteEntry("Procedure", procedure.id)),
  ];
}

// ---- カルテ・一覧への表示 ----

export interface TransfusionPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 実施時間帯 "2026-08-31 14:00〜15:30"。終了が無ければ開始だけ。 */
  performedAt: string;
  performerName: string;
  confirmerName: string;
  /** 「照合済」「照合スキップ(…)」。照合を出さなかった記録は空。 */
  verification: string;
  /** 輸血したバッグ。「赤血球液-LR 2単位 / 2単位 (No.1234)」の形。 */
  bags: string[];
  /** 入れなかったバッグ。「赤血球液-LR … (No.1234) 返却」の形。 */
  notGivenBags: string[];
  /** 副作用。「なし」「あり: 発熱、悪寒・戦慄 / 内容」。記録が無ければ空。 */
  reaction: string;
  /** 遅発性副作用(実施後に追記したもの)。 */
  delayedReactions: string[];
  /** 観察の時点ごとのバイタル。「投与前 BP 120/80 P 72 T 36.5 SpO2 98」の形。 */
  observations: string[];
  comment: string;
  /**
   * 実施まで至らなかった記録の注記(status が completed 以外)。
   * 通常は空で、途中で中止したときなどに入る。
   */
  statusNote: string;
}

// completed 以外の実施記録に添える注記(処置と同じ)。
const PROCEDURE_STATUS_NOTES: Record<string, string> = {
  "not-done": "実施せず",
  stopped: "途中で中止",
  "in-progress": "実施中",
  preparation: "準備中",
  "on-hold": "保留中",
  unknown: "状態不明",
};

/** 輸血の実施記録か。処方・処置・手術の Procedure と振り分ける。 */
export function isTransfusionProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === TRANSFUSION_ORDER_TYPE.code,
    ),
  );
}

/** 副作用の Observation か(観察のバイタルと振り分ける)。 */
export function isReactionObservation(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.code?.coding?.some((c) => c.system === OBSERVATION_SYSTEM && c.code === REACTION_CODE.code),
  );
}

function isDelayedReaction(observation: fhir4.Observation): boolean {
  return observation.extension?.find((e) => e.url === REACTION_TIMING_EXT_URL)?.valueCode === "delayed";
}

/** 「YYYY-MM-DD HH:mm〜HH:mm」。日をまたぐときは終了側も日付ごと出す。 */
function periodLabel(period: fhir4.Period | undefined): string {
  if (!period?.start) return "";
  const start = toDateTimeInput(period.start).replace("T", " ");
  if (!period.end) return start;
  const end = toDateTimeInput(period.end).replace("T", " ");
  // 同じ日なら終了は時刻だけにして短くする。
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start}〜${end.slice(11)}`
    : `${start}〜${end}`;
}

function bagLabel(administration: fhir4.MedicationAdministration): string {
  const dose = administration.dosage?.dose;
  const amount = dose?.value == null ? "" : `${dose.value}${dose.unit ?? ""}`;
  const lot = administration.extension?.find((e) => e.url === LOT_NUMBER_EXT_URL)?.valueString;
  const type = bloodTypeLabel(
    bloodTypeOfExtensions(administration.extension).abo,
    bloodTypeOfExtensions(administration.extension).rhd,
  );
  // 製剤名に規格(「2単位」)が入るので、使用量は区切り文字を挟んで名称と分ける
  // (オーダー側の productLabel と同じ理由)。
  const name = conceptLabel(administration.medicationCodeableConcept);
  const outcome =
    administration.status === "completed" ? "" : conceptLabel(administration.statusReason?.[0]) || "未実施";
  return [[name, amount].filter(Boolean).join(" / "), type, lot && `(No.${lot})`, outcome]
    .filter(Boolean)
    .join(" ");
}

export function reactionLabel(observation: fhir4.Observation | undefined): string {
  if (!observation) return "";
  const value = conceptLabel(observation.valueCodeableConcept);
  const symptoms = (observation.component ?? [])
    .map((c) => conceptLabel(c.code))
    .filter(Boolean)
    .join("、");
  const note = observation.note?.map((n) => n.text).filter(Boolean).join(" ");
  const detail = [symptoms, note].filter(Boolean).join(" / ");
  return detail ? `${value}: ${detail}` : value;
}

function delayedReactionLabel(observation: fhir4.Observation): string {
  const when = (observation.effectiveDateTime ?? "").slice(0, 16).replace("T", " ");
  const label = reactionLabel(observation).replace(/^あり:?\s*/, "");
  return [when, label].filter(Boolean).join(" ");
}

/** 観察 1 時点のバイタルを 1 行に。 */
function pointLabel(point: string, observations: fhir4.Observation[]): string {
  const parts: string[] = [];
  const bp = observations.find((o) => o.code?.coding?.some((c) => c.code === BLOOD_PRESSURE.code));
  if (bp) {
    const value = (code: string) =>
      bp.component?.find((c) => c.code?.coding?.some((x) => x.code === code))?.valueQuantity?.value;
    parts.push(`BP ${value("8480-6") ?? "-"}/${value("8462-4") ?? "-"}`);
  }
  const short: Record<string, string> = { pulse: "P", temperature: "T", spo2: "SpO2", respiration: "R" };
  for (const measure of VITAL_MEASURES) {
    const found = observations.find((o) => o.code?.coding?.some((c) => c.code === measure.code));
    if (found?.valueQuantity?.value != null) {
      parts.push(`${short[measure.key] ?? measure.label} ${found.valueQuantity.value}`);
    }
  }
  if (parts.length === 0) return "";
  const at = (observations[0]?.effectiveDateTime ?? "").slice(11, 16);
  return [observationPointDisplay(point), at, parts.join(" ")].filter(Boolean).join(" ");
}

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。
 *
 * 実施取消では記録ごと消すので、1 オーダーに残るハブは通常 1 件。それでも配列で
 * 返すのは、消し損ねが残ったときに黙って 1 件だけ出すより全部見えた方が安全なため。
 */
export function transfusionPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  observations: fhir4.Observation[],
): Map<string, TransfusionPerformDisplay[]> {
  // 誤登録として取り消されたものは実施していないのと同じなので出さない。
  const hubs = procedures.filter(
    (procedure) => isTransfusionProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const byOrderId = new Map<string, TransfusionPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const partOfHub = (resource: { partOf?: fhir4.Reference[] }) =>
      (resource.partOf ?? []).some(
        (reference) => referenceIdOfType(reference.reference, "Procedure") === hubId,
      );
    const own = observations.filter(partOfHub);
    const reactions = own.filter(isReactionObservation);
    const vitals = own.filter((o) => !isReactionObservation(o));
    const pointOf = (o: fhir4.Observation) =>
      o.extension?.find((e) => e.url === OBSERVATION_POINT_EXT_URL)?.valueCode ?? "";
    const performerOf = (role: string) =>
      hub.performer?.find((p) => p.function?.coding?.some((c) => c.code === role))?.actor?.display ?? "";
    const bags = administrations.filter(partOfHub);

    const display: TransfusionPerformDisplay = {
      id: hubId,
      performedAt: periodLabel(hub.performedPeriod),
      // 役割を持たない古い記録は先頭を実施者として読む。
      performerName: performerOf(PERFORMER_ROLE.code) || hub.performer?.[0]?.actor?.display || "",
      confirmerName: performerOf(VERIFIER_ROLE.code),
      verification: verificationLabelOf(hub),
      bags: bags.filter((a) => a.status === "completed").map(bagLabel).filter(Boolean),
      notGivenBags: bags.filter((a) => a.status !== "completed").map(bagLabel).filter(Boolean),
      reaction: reactionLabel(reactions.find((o) => !isDelayedReaction(o))),
      delayedReactions: reactions.filter(isDelayedReaction).map(delayedReactionLabel),
      observations: OBSERVATION_POINTS.map((point) =>
        pointLabel(point.code, vitals.filter((o) => pointOf(o) === point.code)),
      ).filter(Boolean),
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      statusNote: PROCEDURE_STATUS_NOTES[hub.status] ?? "",
    };

    for (const basedOn of hub.basedOn ?? []) {
      const orderId = referenceIdOfType(basedOn.reference, "ServiceRequest");
      if (!orderId) continue;
      const list = byOrderId.get(orderId);
      if (list) list.push(display);
      else byOrderId.set(orderId, [display]);
    }
  }

  for (const list of byOrderId.values()) {
    list.sort((a, b) => a.performedAt.localeCompare(b.performedAt));
  }
  return byOrderId;
}

/** 実施記録のハブ(遅発性副作用の追記先)。オーダー id で引く。 */
export function transfusionHubOf(
  procedures: fhir4.Procedure[],
  orderId: string,
): fhir4.Procedure | undefined {
  return procedures.find(
    (procedure) =>
      isTransfusionProcedure(procedure) &&
      procedure.status !== "entered-in-error" &&
      (procedure.basedOn ?? []).some((b) => referenceIdOfType(b.reference, "ServiceRequest") === orderId),
  );
}

export { nowFhirDateTime };
