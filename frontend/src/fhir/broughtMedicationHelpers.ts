import { nowFhirDateTime, toDateTimeInputValue, toFhirDateTime, today } from "../lib/dates";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import { isAsNeededUsage } from "./medicationScheduleHelpers";
import { ingredientKey, type ActiveMedication } from "./medicationSafetyHelpers";
import {
  BROUGHT_CATEGORY,
  buildDosage,
  emptyMedicineLine,
  hasDoseDays,
  medicationCodeableConcept,
  medicineFromConcept,
  usageFromDosage,
  type PrescriptionFormValues,
  type RpValues,
} from "./prescriptionHelpers";
import { usageCommentOf } from "./supplementaryUsage";

// 持参薬(入院時に患者が持ってきた薬)。持参薬 1 剤 = MedicationStatement 1 件。
// 構造・状態・処方区分「持参」との関係は docs/brought-medication-design.md。

const EXT_BASE = "http://fhir-client.local/StructureDefinition";
const INFO_EXT_URL = `${EXT_BASE}/brought-medication-info`;
const IDENTIFICATION_EXT_URL = `${EXT_BASE}/brought-medication-identification`;
const DECISION_EXT_URL = `${EXT_BASE}/brought-medication-decision`;

export const BROUGHT_DECISION_SYSTEM =
  "http://fhir-client.local/CodeSystem/brought-medication-decision";
const STATEMENT_CATEGORY_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/medication-statement-category";
const UCUM_SYSTEM = "http://unitsofmeasure.org";

/** 医師の判断。継続は院内処方(区分「持参」)に起こす。 */
export type BroughtDecision = "continue" | "hold" | "stop";

const DECISION_DISPLAY: Record<BroughtDecision, string> = {
  continue: "継続",
  hold: "休止",
  stop: "中止",
};

const DECISION_STATUS: Record<BroughtDecision, fhir4.MedicationStatement["status"]> = {
  continue: "active",
  hold: "on-hold",
  stop: "stopped",
};

/** 院内での扱い(鑑別)。 */
export type BroughtSubstitution = "same" | "alternative" | "none";

export const SUBSTITUTION_OPTIONS: { code: BroughtSubstitution; display: string }[] = [
  { code: "same", display: "同じ薬が院内にある" },
  { code: "alternative", display: "院内の代替薬" },
  { code: "none", display: "持参分を使う" },
];

/** 情報源の選択肢。 */
export const SOURCE_OPTIONS = ["本人", "家族", "お薬手帳", "薬剤情報提供書", "紹介状"];

/** 画面での状態(docs §2)。 */
export type BroughtState =
  | "unidentified"
  | "undecided"
  | "continued"
  | "held"
  | "stopped"
  | "not-taken"
  | "completed"
  | "entered-in-error";

export const BROUGHT_STATE_LABELS: Record<BroughtState, string> = {
  unidentified: "未鑑別",
  undecided: "未判断",
  continued: "継続",
  held: "休止",
  stopped: "中止",
  "not-taken": "服用していない",
  completed: "終了",
  "entered-in-error": "誤登録",
};

function subExtension(ext: fhir4.Extension | undefined, url: string): fhir4.Extension | undefined {
  return ext?.extension?.find((e) => e.url === url);
}

function extensionOf(statement: fhir4.MedicationStatement, url: string) {
  return statement.extension?.find((e) => e.url === url);
}

function withoutExtension(statement: fhir4.MedicationStatement, url: string): fhir4.Extension[] {
  return (statement.extension ?? []).filter((e) => e.url !== url);
}

function decisionOf(statement: fhir4.MedicationStatement): BroughtDecision | undefined {
  const code = statement.statusReason
    ?.flatMap((reason) => reason.coding ?? [])
    .find((coding) => coding.system === BROUGHT_DECISION_SYSTEM)?.code;
  return code === "continue" || code === "hold" || code === "stop" ? code : undefined;
}

export function isIdentified(statement: fhir4.MedicationStatement): boolean {
  return Boolean(extensionOf(statement, IDENTIFICATION_EXT_URL));
}

export function broughtStateOf(statement: fhir4.MedicationStatement): BroughtState {
  switch (statement.status) {
    case "entered-in-error":
      return "entered-in-error";
    case "completed":
      return "completed";
    case "not-taken":
      return "not-taken";
    case "stopped":
      return "stopped";
    case "on-hold":
      return "held";
  }
  if (decisionOf(statement) === "continue") return "continued";
  return isIdentified(statement) ? "undecided" : "unidentified";
}

/** 医師の判断を待っている(未鑑別・未判断)。重複チェックに数えるのもこの 2 つ。 */
export function isAwaitingDecision(statement: fhir4.MedicationStatement): boolean {
  const state = broughtStateOf(statement);
  return state === "unidentified" || state === "undecided";
}

/** 一覧の件数表示などに使う、持参薬の状態ごとの数。 */
export function countBroughtStates(statements: fhir4.MedicationStatement[]) {
  let unidentified = 0;
  let undecided = 0;
  for (const statement of statements) {
    const state = broughtStateOf(statement);
    if (state === "unidentified") unidentified += 1;
    else if (state === "undecided") undecided += 1;
  }
  return { total: statements.length, unidentified, undecided };
}

/**
 * 重複チェックの相手にする持参薬(未鑑別・未判断)。成分キーは YJ コードから作るので、
 * 名前だけで登録した鑑別前の薬は相手にならない(docs §6)。
 */
export function broughtActiveMedications(
  statements: fhir4.MedicationStatement[],
): ActiveMedication[] {
  return statements.filter(isAwaitingDecision).flatMap((statement) => {
    const summary = summarizeBroughtMedication(statement);
    const ingredient = ingredientKey(summary.medicine);
    return ingredient && summary.id
      ? [{ orderId: summary.id, name: summary.name, ingredient, endDate: "", brought: true }]
      : [];
  });
}

// ---- 登録・編集 ----

export interface BroughtMedicationLineValues {
  medicine: Medicine | null;
  /** マスタで選べないときの名前。medicine があれば使わない。 */
  name: string;
  usage: MedicineUsage | null;
  /** マスタで選べないときの用法。usage があれば使わない。 */
  usageText: string;
  dose: string;
  quantity: string;
  comment: string;
}

export interface BroughtMedicationFormValues {
  source: string;
  prescriber: string;
  /** 最終服用日時(YYYY-MM-DDTHH:mm)。 */
  lastTakenAt: string;
  lines: BroughtMedicationLineValues[];
}

export const emptyBroughtMedicationLine: BroughtMedicationLineValues = {
  medicine: null,
  name: "",
  usage: null,
  usageText: "",
  dose: "",
  quantity: "",
  comment: "",
};

export function emptyBroughtMedicationForm(): BroughtMedicationFormValues {
  return { source: "", prescriber: "", lastTakenAt: "", lines: [{ ...emptyBroughtMedicationLine }] };
}

export function validateBroughtMedicationForm(values: BroughtMedicationFormValues): string | null {
  for (const [index, line] of values.lines.entries()) {
    if (!line.medicine && !line.name.trim()) return `${index + 1} 行目: 薬剤を入力してください。`;
    if (line.dose && !(Number(line.dose) > 0)) return `${index + 1} 行目: 1 回量は正の数で入力してください。`;
    if (line.quantity && !(Number(line.quantity) > 0)) {
      return `${index + 1} 行目: 持参数は正の数で入力してください。`;
    }
  }
  return null;
}

function lineDosage(line: BroughtMedicationLineValues): fhir4.Dosage {
  const dosage = buildDosage(
    { usage: line.usage, doseCount: "", usageComment: "", supplement: null },
    { medicine: line.medicine, dose: line.dose, unevenDoses: null },
    today(),
  );
  if (!line.usage && line.usageText.trim()) {
    dosage.timing = { code: { text: line.usageText.trim() } };
  }
  return dosage;
}

function medicationConceptOf(line: BroughtMedicationLineValues): fhir4.CodeableConcept {
  return line.medicine ? medicationCodeableConcept(line.medicine) : { text: line.name.trim() };
}

function infoExtension(
  values: Pick<BroughtMedicationFormValues, "source" | "prescriber">,
  line: BroughtMedicationLineValues,
): fhir4.Extension | null {
  const children: fhir4.Extension[] = [];
  if (values.source) children.push({ url: "source", valueString: values.source });
  if (values.prescriber.trim()) children.push({ url: "prescriber", valueString: values.prescriber.trim() });
  if (line.quantity) {
    children.push({
      url: "broughtQuantity",
      valueQuantity: {
        value: Number(line.quantity),
        ...(line.medicine?.unit_name ? { unit: line.medicine.unit_name } : {}),
      },
    });
  }
  return children.length ? { url: INFO_EXT_URL, extension: children } : null;
}

/**
 * 持参薬 1 剤。既存(編集)を渡すと、鑑別・判断の記録と状態は残して聞き取りの内容だけ
 * 入れ替える。
 */
export function buildBroughtMedication(
  values: BroughtMedicationFormValues,
  line: BroughtMedicationLineValues,
  context: { patientId: string; encounterId?: string; practitionerId?: string; practitionerName?: string },
  existing?: fhir4.MedicationStatement,
): fhir4.MedicationStatement {
  const info = infoExtension(values, line);
  const kept = existing ? withoutExtension(existing, INFO_EXT_URL) : [];
  const extension = [...(info ? [info] : []), ...kept];

  const statement: fhir4.MedicationStatement = {
    ...(existing ?? {}),
    resourceType: "MedicationStatement",
    status: existing?.status ?? "active",
    category: {
      coding: [{ system: STATEMENT_CATEGORY_SYSTEM, code: "community", display: "Community" }],
    },
    medicationCodeableConcept: medicationConceptOf(line),
    subject: { reference: `Patient/${context.patientId}` },
    dateAsserted: existing?.dateAsserted ?? nowFhirDateTime(),
    dosage: [lineDosage(line)],
  };
  if (extension.length) statement.extension = extension;
  else delete statement.extension;

  if (!existing && context.encounterId) {
    statement.context = { reference: `Encounter/${context.encounterId}` };
  }
  if (!existing && context.practitionerId) {
    statement.informationSource = {
      reference: `Practitioner/${context.practitionerId}`,
      ...(context.practitionerName ? { display: context.practitionerName } : {}),
    };
  }
  if (values.lastTakenAt) statement.effectivePeriod = { end: toFhirDateTime(values.lastTakenAt) };
  else delete statement.effectivePeriod;
  if (line.comment.trim()) statement.note = [{ text: line.comment.trim() }];
  else delete statement.note;
  return statement;
}

export function parseBroughtMedicationForm(
  statement: fhir4.MedicationStatement,
): BroughtMedicationFormValues {
  const info = extensionOf(statement, INFO_EXT_URL);
  const dosage = statement.dosage?.[0];
  const doseQuantity = dosage?.doseAndRate?.[0]?.doseQuantity;
  const usage = usageFromDosage(dosage);
  const medicine = medicineFromConcept(statement.medicationCodeableConcept, doseQuantity?.unit);
  const quantity = subExtension(info, "broughtQuantity")?.valueQuantity?.value;
  return {
    source: subExtension(info, "source")?.valueString ?? "",
    prescriber: subExtension(info, "prescriber")?.valueString ?? "",
    lastTakenAt: toDateTimeInputValue(statement.effectivePeriod?.end),
    lines: [
      {
        medicine,
        name: medicine ? "" : (statement.medicationCodeableConcept?.text ?? ""),
        usage,
        usageText: usage ? "" : (dosage?.timing?.code?.text ?? ""),
        dose: doseQuantity?.value != null ? String(doseQuantity.value) : "",
        quantity: quantity != null ? String(quantity) : "",
        comment: statement.note?.[0]?.text ?? "",
      },
    ],
  };
}

/** 持参薬の登録・更新の entry。更新は ifMatch で同時編集を 409 にする。 */
export function broughtMedicationEntry(
  statement: fhir4.MedicationStatement,
  fullUrl?: string,
): fhir4.BundleEntry {
  if (statement.id) {
    return {
      fullUrl: `MedicationStatement/${statement.id}`,
      resource: statement,
      request: {
        method: "PUT",
        url: `MedicationStatement/${statement.id}`,
        ...(statement.meta?.versionId ? { ifMatch: `W/"${statement.meta.versionId}"` } : {}),
      },
    };
  }
  return {
    fullUrl: fullUrl ?? `urn:uuid:${crypto.randomUUID()}`,
    resource: statement,
    request: { method: "POST", url: "MedicationStatement" },
  };
}

// ---- 鑑別 ----

export interface BroughtIdentifyValues {
  statementId: string;
  medicine: Medicine | null;
  quantity: string;
  remainingDays: string;
  substitution: BroughtSubstitution | "";
  substitute: Medicine | null;
  notTaken: boolean;
  comment: string;
}

export function parseIdentifyValues(statement: fhir4.MedicationStatement): BroughtIdentifyValues {
  const summary = summarizeBroughtMedication(statement);
  const identification = extensionOf(statement, IDENTIFICATION_EXT_URL);
  const substitution = subExtension(identification, "substitution")?.valueCode;
  return {
    statementId: statement.id ?? "",
    medicine: summary.medicine,
    quantity: summary.quantity != null ? String(summary.quantity) : "",
    remainingDays:
      summary.remainingDays != null
        ? String(summary.remainingDays)
        : estimateRemainingDays(summary.quantity, summary.dose, summary.usageCode),
    substitution:
      substitution === "same" || substitution === "alternative" || substitution === "none"
        ? substitution
        : "",
    substitute: summary.substitute,
    notTaken: statement.status === "not-taken",
    comment: subExtension(identification, "comment")?.valueString ?? "",
  };
}

/**
 * 残日数の初期値。持参数 ÷ 1 日量。1 日量は用法コードの服用回数 × 1 回量で、
 * 頓用・回数の読めない用法では出さない(手で入れる)。
 */
export function estimateRemainingDays(
  quantity: number | undefined,
  dose: number | undefined,
  usageCode: string | undefined,
): string {
  if (!quantity || !dose || !usageCode || isAsNeededUsage(usageCode)) return "";
  const timesPerDay = dailyTimesOf(usageCode);
  if (!timesPerDay) return "";
  return String(Math.floor(quantity / (dose * timesPerDay)));
}

/** 用法コード 4 桁目の 1 日の服用回数。`Z`(不定)などの読めない値は 0。 */
function dailyTimesOf(usageCode: string): number {
  const times = Number(usageCode.charAt(3));
  return Number.isInteger(times) ? times : 0;
}

export function validateIdentifyValues(values: BroughtIdentifyValues, name: string): string | null {
  if (values.notTaken) return null;
  if (!values.medicine) return `${name}: 医薬品を特定してください。`;
  if (!values.substitution) return `${name}: 院内での扱いを選んでください。`;
  if (values.substitution === "alternative" && !values.substitute) {
    return `${name}: 代替薬を選んでください。`;
  }
  if (values.remainingDays && !(Number(values.remainingDays) >= 0)) {
    return `${name}: 残日数は 0 以上の数で入力してください。`;
  }
  return null;
}

/** 鑑別の結果を書いた持参薬。医薬品は特定したものに置き換え、登録時の名前は残す。 */
export function buildIdentifiedMedication(
  statement: fhir4.MedicationStatement,
  values: BroughtIdentifyValues,
  actor: { practitionerId: string; display: string },
): fhir4.MedicationStatement {
  const previous = extensionOf(statement, IDENTIFICATION_EXT_URL);
  const reportedName =
    subExtension(previous, "reportedName")?.valueString ??
    statement.medicationCodeableConcept?.text ??
    "";
  const unit = values.medicine?.unit_name ?? undefined;

  const children: fhir4.Extension[] = [
    {
      url: "identifiedBy",
      valueReference: { reference: `Practitioner/${actor.practitionerId}`, display: actor.display },
    },
    { url: "identifiedAt", valueDateTime: nowFhirDateTime() },
  ];
  if (reportedName) children.push({ url: "reportedName", valueString: reportedName });
  if (values.remainingDays) {
    children.push({
      url: "remainingDays",
      valueQuantity: { value: Number(values.remainingDays), unit: "日", system: UCUM_SYSTEM, code: "d" },
    });
  }
  if (values.substitution) children.push({ url: "substitution", valueCode: values.substitution });
  if (values.substitution === "alternative" && values.substitute) {
    children.push({ url: "substitute", valueCodeableConcept: medicationCodeableConcept(values.substitute) });
  }
  if (values.comment.trim()) children.push({ url: "comment", valueString: values.comment.trim() });

  const extension = withoutExtension(statement, IDENTIFICATION_EXT_URL).map((ext) =>
    ext.url === INFO_EXT_URL ? withQuantity(ext, values.quantity, unit) : ext,
  );
  if (!extension.some((ext) => ext.url === INFO_EXT_URL) && values.quantity) {
    extension.push(withQuantity({ url: INFO_EXT_URL }, values.quantity, unit));
  }
  extension.push({ url: IDENTIFICATION_EXT_URL, extension: children });

  const dosage = statement.dosage?.[0];
  const next: fhir4.MedicationStatement = {
    ...statement,
    extension,
    medicationCodeableConcept: values.medicine
      ? medicationCodeableConcept(values.medicine)
      : statement.medicationCodeableConcept,
    // 医薬品を置き換えたら 1 回量の単位もその医薬品に揃える。
    ...(dosage?.doseAndRate?.[0]?.doseQuantity && unit
      ? {
          dosage: [
            {
              ...dosage,
              doseAndRate: [
                { doseQuantity: { ...dosage.doseAndRate[0].doseQuantity, unit } },
              ],
            },
          ],
        }
      : {}),
  };
  // 服用していない薬は判断が要らない。鑑別し直して服用に戻したら未判断へ。
  if (values.notTaken) {
    next.status = "not-taken";
    delete next.statusReason;
  } else if (statement.status === "not-taken") {
    next.status = "active";
  }
  return next;
}

function withQuantity(ext: fhir4.Extension, quantity: string, unit: string | undefined): fhir4.Extension {
  const rest = (ext.extension ?? []).filter((e) => e.url !== "broughtQuantity");
  return {
    ...ext,
    extension: [
      ...rest,
      ...(quantity
        ? [{ url: "broughtQuantity", valueQuantity: { value: Number(quantity), ...(unit ? { unit } : {}) } }]
        : []),
    ],
  };
}

// ---- 医師の判断 ----

/**
 * 医師の判断を書いた持参薬。継続は起こした処方(convertedOrder)を指す。
 * 同じ transaction で作る処方なら urn:uuid をそのまま渡す(上流が解決する)。
 */
export function buildDecidedMedication(
  statement: fhir4.MedicationStatement,
  decision: BroughtDecision,
  reason: string,
  actor: { practitionerId: string; display: string },
  convertedOrderReference?: string,
): fhir4.MedicationStatement {
  const children: fhir4.Extension[] = [
    {
      url: "decidedBy",
      valueReference: { reference: `Practitioner/${actor.practitionerId}`, display: actor.display },
    },
    { url: "decidedAt", valueDateTime: nowFhirDateTime() },
  ];
  // 継続していた持参薬を止めても、起こした処方への参照は残す(何を止めたかを辿れるように)。
  const orderReference =
    convertedOrderReference ??
    subExtension(extensionOf(statement, DECISION_EXT_URL), "convertedOrder")?.valueReference?.reference;
  if (orderReference) {
    children.push({ url: "convertedOrder", valueReference: { reference: orderReference } });
  }
  return {
    ...statement,
    status: DECISION_STATUS[decision],
    statusReason: [
      {
        coding: [
          { system: BROUGHT_DECISION_SYSTEM, code: decision, display: DECISION_DISPLAY[decision] },
        ],
        ...(reason.trim() ? { text: reason.trim() } : {}),
      },
    ],
    extension: [
      ...withoutExtension(statement, DECISION_EXT_URL),
      { url: DECISION_EXT_URL, extension: children },
    ],
  };
}

/** 判断の取消。未判断(active)に戻す。 */
export function buildUndecidedMedication(
  statement: fhir4.MedicationStatement,
): fhir4.MedicationStatement {
  const next: fhir4.MedicationStatement = {
    ...statement,
    status: "active",
    extension: withoutExtension(statement, DECISION_EXT_URL),
  };
  delete next.statusReason;
  if (!next.extension?.length) delete next.extension;
  return next;
}

/** 誤登録。 */
export function buildEnteredInErrorMedication(
  statement: fhir4.MedicationStatement,
): fhir4.MedicationStatement {
  return { ...statement, status: "entered-in-error" };
}

/**
 * 退院で閉じる entry。active / on-hold を終了にする。effectivePeriod.end は入院前の最終服用日時
 * なので書き換えない。
 */
export function buildBroughtMedicationCloseEntries(
  statements: fhir4.MedicationStatement[],
): fhir4.BundleEntry[] {
  return statements
    .filter((statement) => statement.status === "active" || statement.status === "on-hold")
    .map((statement) => broughtMedicationEntry({ ...statement, status: "completed" }));
}

// ---- 継続 → 処方 ----

/**
 * 継続する持参薬から処方フォームの初期値を作る。RP は用法・頓用の回数・日数・用法の
 * コメントが同じものをまとめる。薬剤は代替薬があればそれ、無ければ特定した医薬品。
 */
export function buildPrescriptionFormFromBrought(
  statements: fhir4.MedicationStatement[],
): PrescriptionFormValues {
  const rps: RpValues[] = [];
  const rpByKey = new Map<string, RpValues>();

  for (const statement of statements) {
    const summary = summarizeBroughtMedication(statement);
    const dosage = statement.dosage?.[0];
    const usage = usageFromDosage(dosage);
    const medicine = summary.substitute ?? summary.medicine;
    const doseDays =
      usage && hasDoseDays(usage.usage_code, usage.basic_usage_category) && summary.remainingDays != null
        ? String(summary.remainingDays)
        : "";
    const doseCount = dosage?.timing?.repeat?.count != null ? String(dosage.timing.repeat.count) : "";
    const usageComment = usageCommentOf(dosage) ?? "";
    const key = [usage?.usage_code ?? "", doseDays, doseCount, usageComment].join("|");

    let rp = rpByKey.get(key);
    if (!rp) {
      rp = {
        usage,
        doseDays,
        doseCount,
        usageComment,
        showUsageComment: Boolean(usageComment),
        medicines: [],
      };
      rpByKey.set(key, rp);
      rps.push(rp);
    }
    rp.medicines.push({
      ...emptyMedicineLine,
      medicine,
      dose: summary.dose != null ? String(summary.dose) : "",
      ...(statement.id ? { broughtMedicationId: statement.id } : {}),
    });
  }

  return {
    setting: "inpatient",
    category: BROUGHT_CATEGORY.code,
    startDate: today(),
    comment: "",
    problem: null,
    rps: rps.length ? rps : [{ usage: null, doseDays: "", doseCount: "", usageComment: "", medicines: [{ ...emptyMedicineLine }] }],
  };
}

/**
 * 継続で処方を登録する transaction に足す entry。処方のヘッダ(ServiceRequest)の fullUrl を
 * 持参薬の convertedOrder に入れる。
 */
export function buildConversionEntries(
  prescriptionBundle: fhir4.Bundle,
  statements: fhir4.MedicationStatement[],
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry[] {
  const header = prescriptionBundle.entry?.find(
    (entry) => entry.resource?.resourceType === "ServiceRequest",
  );
  const orderReference = header?.fullUrl;
  return statements.map((statement) =>
    broughtMedicationEntry(buildDecidedMedication(statement, "continue", "", actor, orderReference)),
  );
}

// ---- 表示 ----

export interface BroughtMedicationSummary {
  id: string;
  state: BroughtState;
  name: string;
  /** 登録時の名前(鑑別で置き換えたときだけ name と違う)。 */
  reportedName?: string;
  medicine: Medicine | null;
  usageCode?: string;
  usageName: string;
  dose?: number;
  unit?: string;
  quantity?: number;
  quantityUnit?: string;
  remainingDays?: number;
  substitution?: BroughtSubstitution;
  substitute: Medicine | null;
  source: string;
  prescriber: string;
  lastTakenAt?: string;
  assertedAt?: string;
  registeredBy: string;
  identifiedBy?: string;
  identifiedAt?: string;
  identificationComment?: string;
  decision?: BroughtDecision;
  decisionReason?: string;
  decidedBy?: string;
  decidedAt?: string;
  /** 継続で起こした処方(ServiceRequest.id)。 */
  convertedOrderId?: string;
  comment: string;
  encounterId?: string;
}

export function summarizeBroughtMedication(
  statement: fhir4.MedicationStatement,
): BroughtMedicationSummary {
  const info = extensionOf(statement, INFO_EXT_URL);
  const identification = extensionOf(statement, IDENTIFICATION_EXT_URL);
  const decisionExt = extensionOf(statement, DECISION_EXT_URL);
  const dosage = statement.dosage?.[0];
  const doseQuantity = dosage?.doseAndRate?.[0]?.doseQuantity;
  const usage = usageFromDosage(dosage);
  const medicine = medicineFromConcept(statement.medicationCodeableConcept, doseQuantity?.unit);
  const name =
    medicine?.name ??
    statement.medicationCodeableConcept?.text ??
    statement.medicationCodeableConcept?.coding?.[0]?.display ??
    "";
  const reportedName = subExtension(identification, "reportedName")?.valueString;
  const substitution = subExtension(identification, "substitution")?.valueCode;
  const substituteConcept = subExtension(identification, "substitute")?.valueCodeableConcept;
  const decision = decisionOf(statement);

  return {
    id: statement.id ?? "",
    state: broughtStateOf(statement),
    name,
    ...(reportedName && reportedName !== name ? { reportedName } : {}),
    medicine,
    usageCode: usage?.usage_code,
    usageName: usage?.usage_name ?? dosage?.timing?.code?.text ?? "",
    dose: doseQuantity?.value,
    unit: doseQuantity?.unit,
    quantity: subExtension(info, "broughtQuantity")?.valueQuantity?.value,
    quantityUnit: subExtension(info, "broughtQuantity")?.valueQuantity?.unit ?? doseQuantity?.unit,
    remainingDays: subExtension(identification, "remainingDays")?.valueQuantity?.value,
    substitution:
      substitution === "same" || substitution === "alternative" || substitution === "none"
        ? substitution
        : undefined,
    substitute: substituteConcept ? medicineFromConcept(substituteConcept, doseQuantity?.unit) : null,
    source: subExtension(info, "source")?.valueString ?? "",
    prescriber: subExtension(info, "prescriber")?.valueString ?? "",
    lastTakenAt: statement.effectivePeriod?.end,
    assertedAt: statement.dateAsserted,
    registeredBy: statement.informationSource?.display ?? "",
    identifiedBy: subExtension(identification, "identifiedBy")?.valueReference?.display,
    identifiedAt: subExtension(identification, "identifiedAt")?.valueDateTime,
    identificationComment: subExtension(identification, "comment")?.valueString,
    decision,
    decisionReason: statement.statusReason?.[0]?.text,
    decidedBy: subExtension(decisionExt, "decidedBy")?.valueReference?.display,
    decidedAt: subExtension(decisionExt, "decidedAt")?.valueDateTime,
    convertedOrderId: subExtension(decisionExt, "convertedOrder")
      ?.valueReference?.reference?.split("/")
      .pop(),
    comment: statement.note?.[0]?.text ?? "",
    encounterId: statement.context?.reference?.split("/").pop(),
  };
}

/** 「1 回 1 錠」の表示。 */
export function broughtDoseLabel(summary: BroughtMedicationSummary): string {
  return summary.dose != null ? `1 回 ${summary.dose}${summary.unit ?? ""}` : "";
}

/** 持参数と残日数の表示(「28錠・残 14 日」)。 */
export function broughtStockLabel(summary: BroughtMedicationSummary): string {
  return [
    summary.quantity != null ? `${summary.quantity}${summary.quantityUnit ?? ""}` : "",
    summary.remainingDays != null ? `残 ${summary.remainingDays} 日` : "",
  ]
    .filter(Boolean)
    .join("・");
}

export function substitutionLabel(code: BroughtSubstitution | undefined): string {
  return SUBSTITUTION_OPTIONS.find((o) => o.code === code)?.display ?? "";
}
