import { epochOf, localDay, shortDate, toDateInput, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ROUTE_SYSTEM, type CodeOption } from "./injectionHelpers";
import { lotNumberLabel, withLotNumber } from "./lotNumberHelpers";
import {
  BLOOD_PURIFIER_SYSTEM,
  DIALYSIS_MODALITY_SYSTEM,
  DIALYSIS_ORDER_TYPE,
  dialysisModalityShort,
  isAcuteDialysisModality,
  parseDialysisOrderForm,
} from "./dialysisOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { MEDICINE_CODE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import {
  codingBySystem,
  conceptLabel,
  LOINC_SYSTEM,
  materialLabel,
  MEDICAL_MATERIAL_SYSTEM,
  quantityLabel,
  referenceIdOfType,
  transactionBundle,
} from "./shared";
import {
  BLOOD_PRESSURE,
  bloodPressureCodeableConcept,
  buildBloodPressureComponents,
  DIASTOLIC,
  SYSTOLIC,
} from "./vitalHelpers";

// 透析の実施記録(docs/dialysis-order-design.md §6)。処置と同じ「ハブ Procedure + partOf の子」に、
// 入室 → 開始 → 終了の段階を足した形。1 回の透析 = ハブ 1 件で、期間中に何十件も積み上がる。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure ハブ (category = order-type|dialysis、code = 浄化方法)
//         status = preparation(入室)→ in-progress(開始)→ completed(終了)
//         performedPeriod = 開始〜終了。入室の段階では持たない
//         usedCode = 血液浄化器(施設マスタの製品)と器材(特定保険医療材料)+ 数量の拡張
//         extension[dialysis-appointment] = 対応する予約(ベッドサイドは無し)
//          ├ partOf ← Observation 測定値(dialysis-measurement。透析前後の体重・除水量・実透析時間・QB・QD)
//          ├ partOf ← Observation 血圧(LOINC 85354-9、vital-signs。経過表にそのまま出る)
//          ├ partOf ← MedicationAdministration 薬剤(ESA・鉄・ヘパリンなど)
//          └ partOf ← Procedure 追加の手技(レセ電算の診療行為コード)
//
// **進捗 Task は動かさない**(リハビリと同じ。dialysisTaskHelpers.ts の冒頭)。終了は部門一覧の「終了」の担当。
// 予約(Appointment)は入室・開始で arrived、終了で fulfilled、実施取消で booked に戻す。
//
// 薬剤のうち人工腎臓の所定点数に含まれるもの(透析液・抗凝固薬・ESA など)は記録に残しつつ
// 「算定しない」の印(dialysis-bundled-medication)を付け、会計に送らない(§7)。
//
// ドライウェイトは患者単位の Observation(partOf を持たない)。実施の終了で値を変えたときだけ 1 件足す。

const LOCAL = "http://fhir-client.local";
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const UCUM = "http://unitsofmeasure.org";

/** 各回の測定値とドライウェイトのコード。 */
export const DIALYSIS_MEASUREMENT_SYSTEM = `${LOCAL}/CodeSystem/dialysis-measurement`;
/** 追加の手技(レセ電算の診療行為コード)。会計(OrderCatalog)が `dialysis-procedure-code` の名前で読む。 */
const DIALYSIS_PROCEDURE_CODE_SYSTEM = `${LOCAL}/CodeSystem/dialysis-procedure-code`;
/** usedCode に添える数量。会計が `dialysis-material-quantity` の名前で読む。 */
const MATERIAL_QUANTITY_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-material-quantity`;
const APPOINTMENT_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-appointment`;
/** 所定点数に含まれる薬剤の印。会計が `dialysis-bundled-medication` の名前で読む。 */
const BUNDLED_MEDICATION_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-bundled-medication`;
/** 血圧が透析前か後か。体重はコードで分かれるが、血圧は LOINC のパネル 1 つなので拡張で区別する。 */
const MEASUREMENT_TIMING_EXT_URL = `${LOCAL}/StructureDefinition/dialysis-measurement-timing`;

type MeasurementCode =
  | "pre-weight"
  | "post-weight"
  | "ultrafiltration"
  | "actual-minutes"
  | "qb"
  | "qd"
  | "dry-weight"
  | "uf-rate"
  | "venous-pressure"
  | "arterial-pressure"
  | "tmp";

/** 測定値のコードと単位。実施記録(回の値)と透析経過表(時点の値。dialysisChartHelpers)で共用。 */
export const DIALYSIS_MEASUREMENTS: Record<MeasurementCode, { display: string; unit: string; ucum: string }> = {
  "pre-weight": { display: "透析前体重", unit: "kg", ucum: "kg" },
  "post-weight": { display: "透析後体重", unit: "kg", ucum: "kg" },
  ultrafiltration: { display: "除水量", unit: "L", ucum: "L" },
  "actual-minutes": { display: "実透析時間", unit: "分", ucum: "min" },
  qb: { display: "血流量", unit: "mL/min", ucum: "mL/min" },
  qd: { display: "透析液流量", unit: "mL/min", ucum: "mL/min" },
  "dry-weight": { display: "ドライウェイト", unit: "kg", ucum: "kg" },
  "uf-rate": { display: "除水速度", unit: "mL/h", ucum: "mL/h" },
  "venous-pressure": { display: "静脈圧", unit: "mmHg", ucum: "mm[Hg]" },
  "arterial-pressure": { display: "動脈圧", unit: "mmHg", ucum: "mm[Hg]" },
  tmp: { display: "膜間圧力差", unit: "mmHg", ucum: "mm[Hg]" },
};

/** 薬剤の投与経路。ESA・鉄・ビタミン D などは回路から静注、ヘパリンは持続で回路へ。 */
export const DIALYSIS_ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "SC", display: "皮下" },
  { code: "IM", display: "筋肉内" },
  { code: "PO", display: "経口" },
];

function routeDisplay(code: string): string {
  return DIALYSIS_ROUTE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

/** 維持透析(人工腎臓)。透析液・抗凝固薬は所定点数に含まれる。 */
export function isMaintenanceDialysisModality(code: string): boolean {
  return Boolean(code) && !isAcuteDialysisModality(code);
}

// ---- 実施の読み解き ----

/** 1 回の透析。ハブとその子。 */
export interface DialysisSession {
  hub: fhir4.Procedure;
  observations: fhir4.Observation[];
  administrations: fhir4.MedicationAdministration[];
  /** 追加の手技。 */
  procedures: fhir4.Procedure[];
}

export function isDialysisProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === DIALYSIS_ORDER_TYPE.code),
  );
}

function partOfHubId(resource: { partOf?: fhir4.Reference[] }): string {
  return referenceIdOfType(resource.partOf?.[0]?.reference, "Procedure");
}

/** 検索で集めた Procedure・Observation・MedicationAdministration を 1 回ずつに束ねる。重複は id で除く。 */
export function groupDialysisSessions(
  procedures: fhir4.Procedure[],
  observations: fhir4.Observation[] = [],
  administrations: fhir4.MedicationAdministration[] = [],
): DialysisSession[] {
  const byHubId = new Map<string, DialysisSession>();
  const dialysis = uniqueById(procedures).filter(
    (procedure) => isDialysisProcedure(procedure) && procedure.status !== "entered-in-error",
  );
  for (const hub of dialysis) {
    if (hub.id && !partOfHubId(hub)) byHubId.set(hub.id, { hub, observations: [], administrations: [], procedures: [] });
  }
  for (const child of dialysis) byHubId.get(partOfHubId(child))?.procedures.push(child);
  for (const observation of uniqueById(observations)) byHubId.get(partOfHubId(observation))?.observations.push(observation);
  for (const administration of uniqueById(administrations)) {
    byHubId.get(partOfHubId(administration))?.administrations.push(administration);
  }
  return [...byHubId.values()];
}

function uniqueById<T extends fhir4.Resource>(resources: T[]): T[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    if (!resource.id || seen.has(resource.id)) return false;
    seen.add(resource.id);
    return true;
  });
}

export function dialysisSessionOrderId(session: DialysisSession): string {
  return referenceIdOfType(session.hub.basedOn?.[0]?.reference, "ServiceRequest");
}

export function dialysisSessionAppointmentId(session: DialysisSession): string {
  return dialysisHubAppointmentId(session.hub);
}

/** ハブが指す予約の id。ベッドサイドの回は空。 */
export function dialysisHubAppointmentId(hub: fhir4.Procedure): string {
  const extension = hub.extension?.find((e) => e.url === APPOINTMENT_EXT_URL);
  return referenceIdOfType(extension?.valueReference?.reference, "Appointment");
}

/** 透析を始めた日。入室だけでまだ始めていない回は空。 */
export function dialysisSessionDay(session: DialysisSession): string {
  return localDay(session.hub.performedPeriod?.start);
}

export function isOpenDialysisSession(session: DialysisSession): boolean {
  return session.hub.status === "preparation" || session.hub.status === "in-progress";
}

/**
 * 予約に対応する回。ハブが予約を指していればそれ(同じ日の 2 回目の臨時に備える)、
 * 指していなければ同じオーダー × 同じ日の回。
 */
export function dialysisSessionForAppointment(
  sessions: DialysisSession[],
  appointment: fhir4.Appointment,
  orderId: string,
  date: string,
): DialysisSession | undefined {
  return (
    sessions.find((session) => dialysisSessionAppointmentId(session) === appointment.id) ??
    sessions.find(
      (session) =>
        !dialysisSessionAppointmentId(session) &&
        dialysisSessionOrderId(session) === orderId &&
        dialysisSessionDay(session) === date,
    )
  );
}

function measurementOf(session: DialysisSession, code: MeasurementCode): number | undefined {
  return session.observations.find(
    (observation) => codingBySystem(observation.code?.coding, DIALYSIS_MEASUREMENT_SYSTEM)?.code === code,
  )?.valueQuantity?.value;
}

function bloodPressureOf(session: DialysisSession, timing: "pre" | "post"): string {
  const observation = session.observations.find(
    (o) =>
      codingBySystem(o.code?.coding, LOINC_SYSTEM)?.code === BLOOD_PRESSURE.code &&
      o.extension?.some((e) => e.url === MEASUREMENT_TIMING_EXT_URL && e.valueCode === timing),
  );
  const component = (code: string) =>
    observation?.component?.find((c) => codingBySystem(c.code.coding, LOINC_SYSTEM)?.code === code)?.valueQuantity
      ?.value;
  const systolic = component(SYSTOLIC.code);
  const diastolic = component(DIASTOLIC.code);
  return systolic != null && diastolic != null ? `${systolic}/${diastolic}` : "";
}

/** 「4時間05分」。 */
export function dialysisMinutesLabel(minutes: number | undefined): string {
  if (minutes == null) return "";
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}時間${String(rest).padStart(2, "0")}分`;
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  preparation: "入室",
  "in-progress": "透析中",
  completed: "終了",
  stopped: "中断",
};

/** 1 回の透析の表示内容。ボード・カルテのカード・詳細が使う。 */
export interface DialysisSessionDisplay {
  id: string;
  status: string;
  statusLabel: string;
  /** 開始日。入室だけの回は空。 */
  date: string;
  /** 「9:05〜13:10」「9:05〜」。 */
  timeLabel: string;
  modalityShort: string;
  preWeight?: number;
  postWeight?: number;
  ultrafiltration?: number;
  actualMinutes?: number;
  qb?: number;
  qd?: number;
  preBp: string;
  postBp: string;
  purifiers: string[];
  medicines: string[];
  materials: string[];
  procedures: string[];
  performerName: string;
  comment: string;
  /** 「前 62.3 → 後 60.1kg / 除水 2.2L / 4時間05分」。 */
  summary: string;
}

function clock(value: string | undefined): string {
  const local = toDateTimeInputValue(value);
  return local ? String(Number(local.slice(11, 13))) + local.slice(13, 16) : "";
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  const dosage = administration.dosage;
  const route = codingBySystem(dosage?.route?.coding, ROUTE_SYSTEM)?.code;
  const bundled = administration.extension?.some((e) => e.url === BUNDLED_MEDICATION_EXT_URL && e.valueBoolean);
  return [
    conceptLabel(administration.medicationCodeableConcept),
    quantityLabel(dosage?.dose),
    route ? routeDisplay(route) : "",
    lotNumberLabel(administration),
    bundled ? "(包括)" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function dialysisSessionDisplay(session: DialysisSession): DialysisSessionDisplay {
  const { hub } = session;
  const preWeight = measurementOf(session, "pre-weight");
  const postWeight = measurementOf(session, "post-weight");
  const ultrafiltration = measurementOf(session, "ultrafiltration");
  const actualMinutes = measurementOf(session, "actual-minutes");
  const start = hub.performedPeriod?.start;
  const end = hub.performedPeriod?.end;
  const isMaterial = (concept: fhir4.CodeableConcept) => !codingBySystem(concept.coding, BLOOD_PURIFIER_SYSTEM);
  const weights =
    preWeight != null || postWeight != null
      ? `前 ${preWeight ?? "-"} → 後 ${postWeight ?? "-"}kg`
      : "";
  return {
    id: hub.id ?? "",
    status: hub.status,
    statusLabel: SESSION_STATUS_LABELS[hub.status] ?? hub.status,
    date: dialysisSessionDay(session),
    timeLabel: start ? `${clock(start)}〜${end ? clock(end) : ""}` : "",
    modalityShort: dialysisModalityShort(codingBySystem(hub.code?.coding, DIALYSIS_MODALITY_SYSTEM)?.code ?? ""),
    preWeight,
    postWeight,
    ultrafiltration,
    actualMinutes,
    qb: measurementOf(session, "qb"),
    qd: measurementOf(session, "qd"),
    preBp: bloodPressureOf(session, "pre"),
    postBp: bloodPressureOf(session, "post"),
    purifiers: (hub.usedCode ?? [])
      .filter((concept) => !isMaterial(concept))
      .map((concept) => materialLabel(concept, MATERIAL_QUANTITY_EXT_URL)),
    medicines: session.administrations.map(medicineLabel).filter(Boolean),
    materials: (hub.usedCode ?? [])
      .filter(isMaterial)
      .map((concept) => materialLabel(concept, MATERIAL_QUANTITY_EXT_URL)),
    procedures: session.procedures.map((procedure) => conceptLabel(procedure.code)).filter(Boolean),
    performerName: hub.performer?.[0]?.actor?.display ?? "",
    comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
    summary: [
      weights,
      ultrafiltration != null ? `除水 ${ultrafiltration}L` : "",
      dialysisMinutesLabel(actualMinutes),
    ]
      .filter(Boolean)
      .join(" / "),
  };
}

/** 「11/11 前 62.3 → 後 60.1kg / 除水 2.2L / 4時間05分」。カードの 1 行。 */
export function dialysisSessionLine(display: DialysisSessionDisplay): string {
  return [display.date ? shortDate(display.date) : "", display.status === "completed" ? "" : display.statusLabel, display.summary]
    .filter(Boolean)
    .join(" ");
}

/** オーダーの id → その回(新しい順。入室だけの回は先頭)。 */
export function dialysisSessionsByOrderId(sessions: DialysisSession[]): Map<string, DialysisSessionDisplay[]> {
  const byOrderId = new Map<string, DialysisSessionDisplay[]>();
  for (const session of sessions) {
    const orderId = dialysisSessionOrderId(session);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(dialysisSessionDisplay(session));
    else byOrderId.set(orderId, [dialysisSessionDisplay(session)]);
  }
  const key = (display: DialysisSessionDisplay) => display.date || "9999";
  for (const list of byOrderId.values()) list.sort((a, b) => key(b).localeCompare(key(a)));
  return byOrderId;
}

// ---- ドライウェイト ----

export interface DryWeight {
  value: number;
  /** 測定(設定)日。 */
  date: string;
}

export function dryWeightOf(observation: fhir4.Observation | undefined): DryWeight | null {
  const value = observation?.valueQuantity?.value;
  return observation && value != null ? { value, date: localDay(observation.effectiveDateTime) } : null;
}

export const DRY_WEIGHT_CODE = `${DIALYSIS_MEASUREMENT_SYSTEM}|dry-weight`;

// ---- 入力フォームの値 ----

export interface DialysisPurifierLine {
  /** 施設マスタのコード。手入力は空。 */
  code: string;
  name: string;
  quantity: string;
}

export interface DialysisMedicineLine {
  medicineCode: string;
  yjCode: string;
  name: string;
  dose: string;
  unitName: string;
  routeCode: string;
  lotNumber?: string;
  /** 所定点数に含まれる(会計に送らない)。 */
  bundled: boolean;
}

export interface DialysisMaterialLine {
  /** 特定保険医療材料コード。 */
  code: string;
  name: string;
  quantity: string;
  unitName: string;
}

export interface DialysisProcedureLine {
  code: string;
  name: string;
}

export interface DialysisPerformFormValues {
  /** datetime-local(YYYY-MM-DDTHH:mm)。 */
  startAt: string;
  endAt: string;
  preWeight: string;
  preSystolic: string;
  preDiastolic: string;
  postWeight: string;
  ultrafiltration: string;
  qb: string;
  qd: string;
  postSystolic: string;
  postDiastolic: string;
  purifiers: DialysisPurifierLine[];
  medicines: DialysisMedicineLine[];
  materials: DialysisMaterialLine[];
  procedures: DialysisProcedureLine[];
  comment: string;
  /** 終了時に見直したドライウェイト(kg)。直近の値から変えたときだけ記録する。 */
  dryWeight: string;
}

/** datetime-local の値に分を足す。 */
function addMinutesToInput(input: string, minutes: number): string {
  const date = new Date(epochOf(input) + minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 開始・終了時刻の初期値。開始は記録済みの開始、無ければ予約の枠の開始(別の日の枠を後から記録するとき)か今。
 * 終了は開始 + 指示の透析時間と今の早いほう(今まだ終わっていない時刻にはしない)。
 */
function initialTimes(
  session: DialysisSession | undefined,
  appointment: fhir4.Appointment | undefined,
  durationMinutes: string,
  now: string,
): { startAt: string; endAt: string } {
  const appointmentStart = toDateTimeInputValue(appointment?.start);
  const startAt =
    toDateTimeInputValue(session?.hub.performedPeriod?.start) ||
    (appointmentStart && appointmentStart.slice(0, 10) !== now.slice(0, 10) ? appointmentStart : now);
  const planned = durationMinutes ? addMinutesToInput(startAt, Number(durationMinutes)) : "";
  const endAt = planned && (planned < now || startAt > now) ? planned : now;
  return { startAt, endAt };
}

/**
 * 実施入力の初期値。透析条件(QB・QD・血液浄化器)はオーダーから写す。抗凝固薬と液はオーダーの薬を
 * 薬剤の行に置き、維持透析では所定点数に含まれるので「算定しない」にする。急性血液浄化の液は薬剤料として送る。
 */
/** 透析経過表の最後の血圧・累積除水量と透析中の薬剤。終了の入力の初期値にする(docs/dialysis-chart-design.md §2.3)。 */
export interface DialysisChartLatest {
  systolic: number | null;
  diastolic: number | null;
  ultrafiltration: number | null;
  medicines: DialysisMedicineLine[];
}

/**
 * オーダーから写した薬剤の行に、経過表の薬剤を重ねる。同じ薬で量が空の行(オーダーの抗凝固薬など)には
 * 量と経路を入れ、それ以外は行を足す(算定の印はオーダー側の行のものを残す)。
 */
function mergeChartMedicines(rows: DialysisMedicineLine[], chart: DialysisMedicineLine[]): DialysisMedicineLine[] {
  const merged = rows.map((row) => ({ ...row }));
  for (const line of chart) {
    const target = merged.find((row) => row.medicineCode && row.medicineCode === line.medicineCode && !row.dose);
    if (target) {
      target.dose = line.dose;
      target.unitName = line.unitName || target.unitName;
      target.routeCode = line.routeCode || target.routeCode;
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

export function initialDialysisPerformForm(
  order: fhir4.ServiceRequest,
  session: DialysisSession | undefined,
  appointment: fhir4.Appointment | undefined,
  dryWeight: DryWeight | null,
  now: string,
  chartLatest: DialysisChartLatest | null = null,
): DialysisPerformFormValues {
  const values = parseDialysisOrderForm(order);
  const maintenance = isMaintenanceDialysisModality(values.modality);
  const display = session ? dialysisSessionDisplay(session) : undefined;
  const [preSystolic = "", preDiastolic = ""] = (display?.preBp ?? "").split("/");
  const medicine = (m: { medicineCode: string; yjCode: string; name: string }, bundled: boolean, routeCode = "") =>
    m.name.trim()
      ? [{ medicineCode: m.medicineCode, yjCode: m.yjCode, name: m.name, dose: "", unitName: "", routeCode, bundled }]
      : [];
  return {
    ...initialTimes(session, appointment, values.durationMinutes, now),
    preWeight: display?.preWeight != null ? String(display.preWeight) : "",
    preSystolic,
    preDiastolic,
    postWeight: "",
    // 経過表があれば装置の累積除水と最後の血圧を初期値にする(前後の体重の差より実際の除水に近い)。
    ultrafiltration: chartLatest?.ultrafiltration != null ? String(chartLatest.ultrafiltration) : "",
    qb: values.qb,
    qd: values.qd,
    postSystolic: chartLatest?.systolic != null ? String(chartLatest.systolic) : "",
    postDiastolic: chartLatest?.diastolic != null ? String(chartLatest.diastolic) : "",
    purifiers: values.purifiers
      .filter((p) => p.name.trim())
      .map((p) => ({ code: p.code, name: p.name, quantity: "1" })),
    medicines: mergeChartMedicines(
      [
        ...(values.anticoagulant ? medicine(values.anticoagulant, maintenance, "IV") : []),
        // 維持透析の透析液は所定点数に含まれ、記録しても送らないので行に出さない。
        ...(maintenance ? [] : medicine(values.dialysate, false)),
        ...(maintenance ? [] : medicine(values.substitutionFluid, false)),
        ...medicine(values.replacementFluid, false, "IV"),
      ],
      chartLatest?.medicines ?? [],
    ),
    materials: [],
    procedures: [],
    comment: "",
    dryWeight: dryWeight ? String(dryWeight.value) : "",
  };
}

export type DialysisPerformStage = "start" | "finish";

function numberOrNull(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 実透析時間(分)。開始・終了が読めなければ null。 */
export function dialysisActualMinutes(startAt: string, endAt: string): number | null {
  if (!startAt || !endAt) return null;
  const minutes = Math.round((epochOf(endAt) - epochOf(startAt)) / 60000);
  return minutes > 0 ? minutes : null;
}

/** 入力の検証。空文字なら妥当。 */
export function validateDialysisPerformForm(values: DialysisPerformFormValues, stage: DialysisPerformStage): string {
  if (!values.startAt) return "開始時刻を入れてください。";
  const weight = (text: string, label: string) => {
    const value = numberOrNull(text);
    if (text.trim() && (value === null || value < 1 || value > 300)) return `${label}は 1〜300 kg で入れてください。`;
    return "";
  };
  const bp = (systolic: string, diastolic: string, label: string) => {
    if (!systolic.trim() && !diastolic.trim()) return "";
    const s = numberOrNull(systolic);
    const d = numberOrNull(diastolic);
    if (s === null || d === null || s <= 0 || d <= 0) return `${label}は収縮期と拡張期を両方入れてください。`;
    return "";
  };
  const errors = [weight(values.preWeight, "透析前体重"), bp(values.preSystolic, values.preDiastolic, "透析前血圧")];
  if (stage === "finish") {
    if (!values.endAt) return "終了時刻を入れてください。";
    if (dialysisActualMinutes(values.startAt, values.endAt) === null) return "終了時刻は開始時刻より後にしてください。";
    errors.push(
      weight(values.postWeight, "透析後体重"),
      bp(values.postSystolic, values.postDiastolic, "透析後血圧"),
      weight(values.dryWeight, "ドライウェイト"),
    );
    const uf = numberOrNull(values.ultrafiltration);
    if (values.ultrafiltration.trim() && (uf === null || uf < 0 || uf > 20)) {
      errors.push("除水量は 0〜20 L で入れてください。");
    }
    for (const [text, label] of [
      [values.qb, "QB"],
      [values.qd, "QD"],
    ] as const) {
      const value = numberOrNull(text);
      if (text.trim() && (value === null || value <= 0)) errors.push(`${label}は正の数で入れてください。`);
    }
  }
  return errors.find(Boolean) ?? "";
}

// ---- 組み立て ----

export interface DialysisPerformer {
  id: string;
  name: string;
}

export interface DialysisPerformContext {
  order: fhir4.ServiceRequest;
  /** ベッドの予約。ベッドサイドは無し。 */
  appointment?: fhir4.Appointment;
  /** 既にある回(入室・開始済み)。無ければハブを新しく作る。 */
  session?: DialysisSession;
  performer: DialysisPerformer | null;
}

interface HubRef {
  reference: string;
  entry: (resource: fhir4.Procedure) => fhir4.BundleEntry;
}

function hubRef(session: DialysisSession | undefined): HubRef {
  if (session?.hub.id) {
    const reference = `Procedure/${session.hub.id}`;
    return { reference, entry: (resource) => ({ resource, request: { method: "PUT", url: reference } }) };
  }
  const reference = `urn:uuid:${crypto.randomUUID()}`;
  return {
    reference,
    entry: (resource) => ({ fullUrl: reference, resource, request: { method: "POST", url: "Procedure" } }),
  };
}

function buildHub(
  ctx: DialysisPerformContext,
  status: fhir4.Procedure["status"],
  period?: fhir4.Period,
): fhir4.Procedure {
  const { order, appointment, session, performer } = ctx;
  const base: fhir4.Procedure = session?.hub ?? {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status,
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_ORDER_TYPE }] },
    subject: order.subject ?? {},
    basedOn: [{ reference: `ServiceRequest/${order.id ?? ""}` }],
    ...(order.code ? { code: order.code } : {}),
    ...(appointment?.id
      ? { extension: [{ url: APPOINTMENT_EXT_URL, valueReference: { reference: `Appointment/${appointment.id}` } }] }
      : {}),
  };
  const hub: fhir4.Procedure = { ...base, status };
  if (period) hub.performedPeriod = period;
  if (performer?.id) {
    hub.performer = [{ actor: { reference: `Practitioner/${performer.id}`, display: performer.name || undefined } }];
  }
  return hub;
}

function appointmentEntry(appointment: fhir4.Appointment | undefined, status: fhir4.Appointment["status"]) {
  if (!appointment?.id || appointment.status === status) return [];
  return [
    {
      resource: { ...appointment, status },
      request: { method: "PUT" as const, url: `Appointment/${appointment.id}` },
    },
  ];
}

function observationBase(
  ctx: DialysisPerformContext,
  hubReference: string,
  effectiveDateTime: string,
): Omit<fhir4.Observation, "code"> {
  return {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_ORDER_TYPE }] }],
    subject: ctx.order.subject ?? {},
    effectiveDateTime,
    partOf: [{ reference: hubReference }],
    ...(ctx.performer?.id
      ? { performer: [{ reference: `Practitioner/${ctx.performer.id}`, display: ctx.performer.name || undefined }] }
      : {}),
  };
}

function measurement(
  base: Omit<fhir4.Observation, "code">,
  code: MeasurementCode,
  value: number,
): fhir4.Observation {
  const { display, unit, ucum } = DIALYSIS_MEASUREMENTS[code];
  return {
    ...base,
    code: { coding: [{ system: DIALYSIS_MEASUREMENT_SYSTEM, code, display }], text: display },
    valueQuantity: { value, unit, system: UCUM, code: ucum },
  };
}

/** 透析前後の血圧。経過表がそのまま読めるよう vital-signs にする(体重は前後 2 値が騙し絵になるので入れない)。 */
function bloodPressure(
  base: Omit<fhir4.Observation, "code">,
  timing: "pre" | "post",
  systolic: string,
  diastolic: string,
): fhir4.Observation[] {
  const s = numberOrNull(systolic);
  const d = numberOrNull(diastolic);
  if (s === null || d === null) return [];
  return [
    {
      ...base,
      category: [
        { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "vital-signs" }] },
        ...(base.category ?? []),
      ],
      extension: [{ url: MEASUREMENT_TIMING_EXT_URL, valueCode: timing }],
      code: bloodPressureCodeableConcept(),
      component: buildBloodPressureComponents(s, d),
    },
  ];
}

function postObservation(resource: fhir4.Resource): fhir4.BundleEntry {
  return {
    fullUrl: `urn:uuid:${crypto.randomUUID()}`,
    resource,
    request: { method: "POST", url: resource.resourceType },
  };
}

function preEntries(
  ctx: DialysisPerformContext,
  values: DialysisPerformFormValues,
  hubReference: string,
  startAt: string,
): fhir4.BundleEntry[] {
  const display = ctx.session ? dialysisSessionDisplay(ctx.session) : undefined;
  const base = observationBase(ctx, hubReference, startAt);
  const observations: fhir4.Observation[] = [];
  const preWeight = numberOrNull(values.preWeight);
  // 開始で記録済みの値は書き直さない(終了の入力欄にも出していない)。
  if (preWeight !== null && display?.preWeight == null) observations.push(measurement(base, "pre-weight", preWeight));
  if (!display?.preBp) observations.push(...bloodPressure(base, "pre", values.preSystolic, values.preDiastolic));
  return observations.map(postObservation);
}

/** 入室。ハブを準備中で作り、予約を来院にする。 */
export function buildDialysisArrivalBundle(ctx: DialysisPerformContext): fhir4.Bundle {
  const hub = hubRef(undefined);
  return transactionBundle([hub.entry(buildHub(ctx, "preparation")), ...appointmentEntry(ctx.appointment, "arrived")]);
}

/** 開始。開始時刻と透析前の体重・血圧を記録する。入室していなければ入室も兼ねる。 */
export function buildDialysisStartBundle(ctx: DialysisPerformContext, values: DialysisPerformFormValues): fhir4.Bundle {
  const startAt = toFhirDateTime(values.startAt);
  const hub = hubRef(ctx.session);
  return transactionBundle([
    hub.entry(buildHub(ctx, "in-progress", { start: startAt })),
    ...preEntries(ctx, values, hub.reference, startAt),
    ...appointmentEntry(ctx.appointment, "arrived"),
  ]);
}

function medicationAdministration(
  ctx: DialysisPerformContext,
  line: DialysisMedicineLine,
  hubReference: string,
  effectiveDateTime: string,
): fhir4.MedicationAdministration {
  const dose = numberOrNull(line.dose);
  const dosage: fhir4.MedicationAdministrationDosage = {
    ...(dose !== null && dose > 0 ? { dose: { value: dose, ...(line.unitName ? { unit: line.unitName } : {}) } } : {}),
    ...(line.routeCode
      ? { route: { coding: [{ system: ROUTE_SYSTEM, code: line.routeCode, display: routeDisplay(line.routeCode) }] } }
      : {}),
  };
  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    status: "completed",
    medicationCodeableConcept: {
      ...(line.medicineCode
        ? {
            coding: [
              { system: MEDICINE_CODE_SYSTEM, code: line.medicineCode, display: line.name },
              ...(line.yjCode ? [{ system: YJ_CODE_SYSTEM, code: line.yjCode }] : []),
            ],
          }
        : {}),
      text: line.name,
    },
    subject: ctx.order.subject ?? {},
    effectiveDateTime,
    partOf: [{ reference: hubReference }],
    ...(dosage.dose || dosage.route ? { dosage } : {}),
    ...(line.bundled ? { extension: [{ url: BUNDLED_MEDICATION_EXT_URL, valueBoolean: true }] } : {}),
  };
  return withLotNumber(administration, line.lotNumber ?? "");
}

function quantityExtension(quantity: string, unitName = ""): fhir4.Extension[] {
  const value = numberOrNull(quantity);
  return value !== null && value > 0
    ? [{ url: MATERIAL_QUANTITY_EXT_URL, valueQuantity: { value, ...(unitName ? { unit: unitName } : {}) } }]
    : [];
}

function usedCodes(values: DialysisPerformFormValues): fhir4.CodeableConcept[] {
  const purifiers = values.purifiers
    .filter((line) => line.name.trim())
    .map((line) => {
      const extension = quantityExtension(line.quantity, "本");
      return {
        ...(line.code ? { coding: [{ system: BLOOD_PURIFIER_SYSTEM, code: line.code, display: line.name }] } : {}),
        text: line.name,
        ...(extension.length ? { extension } : {}),
      };
    });
  const materials = values.materials.map((line) => {
    const extension = quantityExtension(line.quantity, line.unitName);
    return {
      ...(line.code ? { coding: [{ system: MEDICAL_MATERIAL_SYSTEM, code: line.code, display: line.name }] } : {}),
      text: line.name,
      ...(extension.length ? { extension } : {}),
    };
  });
  return [...purifiers, ...materials];
}

/**
 * 終了。ハブを完了にし、透析後の測定値・薬剤・器材・追加の手技を足し、予約を実施済にする。
 * 入室・開始を飛ばして後から一度に記録する運用もここで受ける(ハブが無ければ作る)。
 * ドライウェイトは直近の値から変えたときだけ患者単位の Observation を 1 件足す。
 */
export function buildDialysisFinishBundle(
  ctx: DialysisPerformContext,
  values: DialysisPerformFormValues,
  dryWeight: DryWeight | null,
  /** この回の透析経過表のハブ。あれば回と一緒に閉じる。 */
  chartHub?: fhir4.Procedure,
): fhir4.Bundle {
  const startAt = toFhirDateTime(values.startAt);
  const endAt = toFhirDateTime(values.endAt);
  const hub = hubRef(ctx.session);
  const resource = buildHub(ctx, "completed", { start: startAt, end: endAt });
  const used = usedCodes(values);
  if (used.length > 0) resource.usedCode = used;
  else delete resource.usedCode;
  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];
  else delete resource.note;

  const base = observationBase(ctx, hub.reference, endAt);
  const observations: fhir4.Observation[] = [];
  const pushMeasurement = (code: MeasurementCode, text: string) => {
    const value = numberOrNull(text);
    if (value !== null) observations.push(measurement(base, code, value));
  };
  pushMeasurement("post-weight", values.postWeight);
  pushMeasurement("ultrafiltration", values.ultrafiltration);
  const minutes = dialysisActualMinutes(values.startAt, values.endAt);
  if (minutes !== null) observations.push(measurement(base, "actual-minutes", minutes));
  pushMeasurement("qb", values.qb);
  pushMeasurement("qd", values.qd);
  observations.push(...bloodPressure(base, "post", values.postSystolic, values.postDiastolic));

  const procedures: fhir4.Procedure[] = values.procedures.map((line) => ({
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_ORDER_TYPE }] },
    code: { coding: [{ system: DIALYSIS_PROCEDURE_CODE_SYSTEM, code: line.code, display: line.name }], text: line.name },
    subject: ctx.order.subject ?? {},
    // オーダーからも引けるよう basedOn も張る(カルテの詳細はオーダーの _revinclude で読む)。
    basedOn: [{ reference: `ServiceRequest/${ctx.order.id ?? ""}` }],
    partOf: [{ reference: hub.reference }],
    performedDateTime: startAt,
  }));

  const newDryWeight = numberOrNull(values.dryWeight);
  const dryWeightEntries: fhir4.BundleEntry[] =
    newDryWeight !== null && newDryWeight !== dryWeight?.value
      ? [postObservation(buildDryWeightObservation(ctx, newDryWeight, endAt))]
      : [];

  const closedChart: fhir4.Procedure | null = chartHub?.id
    ? { ...chartHub, status: "completed", performedPeriod: { start: chartHub.performedPeriod?.start ?? startAt, end: endAt } }
    : null;
  const chartEntries: fhir4.BundleEntry[] = closedChart
    ? [{ resource: closedChart, request: { method: "PUT", url: `Procedure/${closedChart.id}` } }]
    : [];

  return transactionBundle([
    hub.entry(resource),
    ...preEntries(ctx, values, hub.reference, startAt),
    ...observations.map(postObservation),
    ...values.medicines.map((line) => postObservation(medicationAdministration(ctx, line, hub.reference, startAt))),
    ...procedures.map(postObservation),
    ...dryWeightEntries,
    ...chartEntries,
    ...appointmentEntry(ctx.appointment, "fulfilled"),
  ]);
}

function buildDryWeightObservation(
  ctx: DialysisPerformContext,
  value: number,
  effectiveDateTime: string,
): fhir4.Observation {
  const base = observationBase(ctx, "", effectiveDateTime);
  delete base.partOf;
  return measurement(base, "dry-weight", value);
}

/**
 * 実施取消。経過表 → 子 → ハブの順に消し(上流は配列順に処理する)、予約を予約済に戻す。
 * 実施しなかった回に記録を残すと会計の除外条件が増えるので、entered-in-error で残さず消す(処置と同じ)。
 * ドライウェイトは患者の状態値なので消さない。
 */
export function buildDialysisPerformDeleteBundle(
  session: DialysisSession,
  appointment: fhir4.Appointment | undefined,
  /** この回の透析経過表(打点・イベント・ハブ)。実施しなかった回の経過表は残さない。 */
  chartEntries: fhir4.BundleEntry[] = [],
): fhir4.Bundle {
  const remove = (resourceType: string, id: string | undefined): fhir4.BundleEntry[] =>
    id ? [{ request: { method: "DELETE", url: `${resourceType}/${id}` } }] : [];
  return transactionBundle([
    ...chartEntries,
    ...session.administrations.flatMap((a) => remove("MedicationAdministration", a.id)),
    ...session.observations.flatMap((o) => remove("Observation", o.id)),
    ...session.procedures.flatMap((p) => remove("Procedure", p.id)),
    ...remove("Procedure", session.hub.id),
    ...(appointment && ["arrived", "checked-in", "fulfilled"].includes(appointment.status)
      ? appointmentEntry(appointment, "booked")
      : []),
  ]);
}
