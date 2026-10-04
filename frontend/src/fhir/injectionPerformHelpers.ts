import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import {
  INJECTION_ORDER_TYPE,
  groupInjectionByRp,
  type InjectionRpDisplay,
} from "./injectionHelpers";
import { buildInjectionTaskUpdate } from "./injectionTaskHelpers";
import {
  INSULIN_UNIT,
  insulinQuantity,
  type InsulinScaleKind,
  type InsulinScaleValues,
} from "./insulinScaleHelpers";
import { MEAL_INTAKE_STAPLE_MANAGE_NO } from "./flowsheetMealHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { NURSING_GLUCOSE_MANAGE_NO, buildGlucoseObservation } from "./nursingPerformHelpers";
import { CAPILLARY_GLUCOSE } from "./vitalHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import {
  MEDICINE_CODE_SYSTEM,
  ORDER_IN_RP_SYSTEM,
  RP_NUMBER_SYSTEM,
  YJ_CODE_SYSTEM,
  identifierValue,
} from "./prescriptionHelpers";
import { LOINC_SYSTEM, conceptLabel, referenceIdOfType } from "./shared";

// 注射の実施記録(施用)。輸血(transfusionResultHelpers)と同じ形で、実施 1 回を
// Procedure のハブにし、薬剤ごとの MedicationAdministration をぶら下げる。
//
//   ServiceRequest(1 日分の注射オーダー)
//    └ basedOn ← Procedure (実施 1 回。施用のたびに 1 件)
//         │  performedPeriod = 施用の開始/終了(ワンショットは開始だけ)
//         │  performer       = 実施者
//         │  status          = completed(完了) / stopped(途中で中止) / not-done(実施せず)
//         │  statusReason    = 中止・未実施の理由(text)
//         │  note            = 実施コメント
//         └ partOf ← MedicationAdministration (薬剤 1 件ごと)
//              request = その薬剤の MedicationRequest
//              dosage  = 実施量・経路・部位・手技(オーダーの用法から写す)
//
// **なぜ MedicationAdministration だけで持たないか。** FHIR としては request →
// MedicationRequest の MedicationAdministration だけで足りる。それでも Procedure を
// ハブに置くのは、このコードベースの実施記録がすべて「Procedure(basedOn オーダー)
// + partOf の子」で揃っていて、カルテの読み出し(_revinclude Procedure:based-on →
// MedicationAdministration:part-of)も実施取消もその形に乗っているため。注射だけ
// 別の形にすると読み出しの経路が増える。request は FHIR の意味を保つために併記する。
//
// **1 日に複数回の施用がある**(RP の開始時刻が 10:00 と 20:30 など)ので、ハブは
// オーダー 1 件に複数付く。進捗 Task を実施済にするのは、記録した回数がオーダーの
// 開始時刻の数に達したとき(開始時刻が無ければ 1 回で実施済)。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** 実施の結果。Procedure.status にそのまま写す。 */
export type InjectionPerformOutcome = "completed" | "stopped" | "not-done";

export const OUTCOME_OPTIONS: { code: InjectionPerformOutcome; display: string }[] = [
  { code: "completed", display: "実施" },
  { code: "stopped", display: "途中で中止" },
  { code: "not-done", display: "実施せず" },
];

export function outcomeDisplay(code: string): string {
  return OUTCOME_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- 実施入力フォームの値 ----

/** 施用した薬剤 1 行。オーダーの薬剤行から作る。 */
export interface InjectionPerformMedicineLine {
  /** 元の MedicationRequest。request 参照と、薬剤コード・用法の写し元。 */
  medicationRequestId: string;
  rpNumber: number;
  orderInRp: number;
  code: string;
  yjCode?: string;
  name: string;
  /** 実施量。オーダーの投与量を初期値にする。 */
  dose: string;
  unit: string;
  /** オーダーの投与量(参考表示)。 */
  orderedDose?: number;
  /** この行は施用しなかった(混注のうち一部だけ入れなかったなど)。 */
  skipped: boolean;
  /** オーダーに無く実施時に足した薬剤。request を持たない MedicationAdministration になる。 */
  added: boolean;
  /** インスリンのスケール。実施量の初期値はスケールの案内量になる。 */
  insulinScale?: InsulinScaleValues | null;
  /** 実施量を手で直したか。直していなければ案内量を実施量にする。 */
  doseTouched?: boolean;
  /** 案内量と違う量にした理由。 */
  doseReason?: string;
}

export interface InjectionPerformFormValues {
  /** 施用の開始・終了。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  startedAt: string;
  endedAt: string;
  performerId: string;
  performerName: string;
  outcome: InjectionPerformOutcome;
  /** 途中で中止・実施せず の理由。そのときは必須。 */
  reason: string;
  comment: string;
  medicines: InjectionPerformMedicineLine[];
  /** 血糖値(mg/dL)を手で入れた値。null なら直近の記録を使う。 */
  glucose: string | null;
  /** 主食の摂取量(%)を手で入れた値。null なら直近の記録を使う。 */
  mealPercent: string | null;
}

/** インスリンのスケールに使った測定値。記録から採ったものは Observation の id を持つ。 */
export interface InsulinMeasurement {
  value: number;
  observationId?: string;
}

/** インスリンの実施で使う測定値と、新しく書く血糖値の basedOn にする血糖測定の看護指示。 */
export interface InsulinPerformContext {
  glucose: InsulinMeasurement | null;
  meal: InsulinMeasurement | null;
  glucoseOrder?: fhir4.ServiceRequest;
}

/** オーダーの薬剤から実施入力の初期行を作る。実施量はオーダーの投与量をそのまま置く。 */
export function medicineLinesFromOrder(
  mrs: fhir4.MedicationRequest[],
): InjectionPerformMedicineLine[] {
  const rps: InjectionRpDisplay[] = groupInjectionByRp(mrs);
  const mrByKey = new Map<string, fhir4.MedicationRequest>();
  for (const mr of mrs) {
    const rp = identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0";
    const order = identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0";
    mrByKey.set(`${rp}-${order}`, mr);
  }
  return rps.flatMap((rp) =>
    rp.medicines.map((med) => ({
      medicationRequestId: mrByKey.get(`${rp.rpNumber}-${med.orderInRp}`)?.id ?? "",
      rpNumber: rp.rpNumber,
      orderInRp: med.orderInRp,
      code: med.code,
      yjCode: med.yjCode,
      name: med.name,
      dose: med.dose == null ? "" : String(med.dose),
      unit: med.unit ?? "",
      orderedDose: med.dose,
      skipped: false,
      added: false,
      // スケールのインスリンは実施量を案内量から入れる(InjectionPerformModal)。
      ...(med.insulinScale ? { insulinScale: med.insulinScale, dose: "", doseTouched: false, doseReason: "" } : {}),
    })),
  );
}

/**
 * 実施入力の初期値。開始時刻は「今」。オーダーの開始時刻に合わせないのは、
 * 実施入力は施用した直後にその場で入れる想定で、予定時刻を既定にすると
 * 予定どおりでなかったときに直し忘れて予定時刻が実績になってしまうため。
 */
export function emptyInjectionPerformForm(
  mrs: fhir4.MedicationRequest[],
): InjectionPerformFormValues {
  return {
    startedAt: toDateTimeInput(new Date()),
    endedAt: "",
    performerId: "",
    performerName: "",
    outcome: "completed",
    reason: "",
    comment: "",
    medicines: medicineLinesFromOrder(mrs),
    glucose: null,
    mealPercent: null,
  };
}

/** スケールの種別に使う測定値。 */
export function insulinMeasurementOf(
  context: InsulinPerformContext | undefined,
  kind: InsulinScaleKind,
): InsulinMeasurement | null {
  return (kind === "meal" ? context?.meal : context?.glucose) ?? null;
}

// ---- FHIR リソースの組み立て ----

function performedPeriod(values: InjectionPerformFormValues): fhir4.Period {
  const period: fhir4.Period = { start: toFhirDateTime(values.startedAt) };
  if (values.endedAt) period.end = toFhirDateTime(values.endedAt);
  return period;
}

function buildHubProcedure(
  values: InjectionPerformFormValues,
  subject: fhir4.Reference,
  orderReference: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: values.outcome,
    // 処置・手術・輸血の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...INJECTION_ORDER_TYPE }] },
    // 施用手技のコード表は持っていないので表示名だけ。手技そのものは各薬剤の
    // MedicationAdministration.dosage.method にオーダーから写している。
    code: { text: INJECTION_ORDER_TYPE.display },
    subject,
    basedOn: [{ reference: orderReference }],
    performedPeriod: performedPeriod(values),
  };

  if (values.performerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }
  if (values.outcome !== "completed" && values.reason.trim()) {
    procedure.statusReason = { text: values.reason.trim() };
  }
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];

  return procedure;
}

function buildAdministration(
  line: InjectionPerformMedicineLine,
  mr: fhir4.MedicationRequest | undefined,
  values: InjectionPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
  /** スケールの測定値の参照(記録の Observation か、同じ transaction で書く血糖値)。 */
  measurementReference: string | null,
  /** 記録の無い主食の摂取量を手で入れたときの値(%)。 */
  manualMealPercent: number | null,
): fhir4.MedicationAdministration {
  const period = performedPeriod(values);
  const instruction = mr?.dosageInstruction?.[0];

  const dosage: fhir4.MedicationAdministrationDosage = {};
  const dose = Number(line.dose);
  // スケールで 0 単位と判断した施用も量として残す。
  if (Number.isFinite(dose) && (dose > 0 || (line.insulinScale && line.dose !== ""))) {
    dosage.dose =
      line.unit === INSULIN_UNIT ? insulinQuantity(dose) : { value: dose, unit: line.unit || undefined };
  }
  // 経路・部位・手技はオーダーの用法をそのまま写す(施用時に変えることはまず無く、
  // 変えたなら別のオーダーになる)。
  if (instruction?.route) dosage.route = instruction.route;
  if (instruction?.site) dosage.site = instruction.site;
  if (instruction?.method) dosage.method = instruction.method;
  const rate = instruction?.doseAndRate?.[0]?.rateQuantity;
  if (rate) dosage.rateQuantity = rate;

  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    // 途中で中止した施用は、入った量を記録したうえで stopped にする。
    status: values.outcome === "stopped" ? "stopped" : "completed",
    medicationCodeableConcept: mr?.medicationCodeableConcept ?? {
      coding: [
        { system: MEDICINE_CODE_SYSTEM, code: line.code, display: line.name },
        ...(line.yjCode ? [{ system: YJ_CODE_SYSTEM, code: line.yjCode, display: line.name }] : []),
      ],
      text: line.name,
    },
    subject,
    effectivePeriod: period,
    partOf: [{ reference: hubReference }],
    ...(line.medicationRequestId
      ? { request: { reference: `MedicationRequest/${line.medicationRequestId}` } }
      : {}),
    ...(Object.keys(dosage).length ? { dosage } : {}),
  };

  if (values.performerId) {
    administration.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }
  if (line.insulinScale) {
    if (measurementReference) administration.supportingInformation = [{ reference: measurementReference }];
    const notes = [
      manualMealPercent !== null && line.insulinScale.kind === "meal" ? `主食 ${manualMealPercent}%` : "",
      line.doseReason?.trim() ?? "",
    ].filter(Boolean);
    if (notes.length) administration.note = notes.map((text) => ({ text }));
  }

  return administration;
}

/** 実施記録一式(ハブの Procedure・薬剤)の POST エントリ。 */
function performEntries(
  values: InjectionPerformFormValues,
  order: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
  insulin: InsulinPerformContext | undefined,
): fhir4.BundleEntry[] {
  const subject = order.subject ?? {};
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  const mrById = new Map(mrs.map((mr) => [mr.id ?? "", mr]));

  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildHubProcedure(values, subject, `ServiceRequest/${order.id ?? ""}`),
      request: { method: "POST", url: "Procedure" },
    },
  ];

  // 実施せず のときは薬剤の記録を作らない(入れていない薬剤に投与記録があると嘘になる)。
  if (values.outcome === "not-done") return entries;

  const given = values.medicines.filter((l) => !l.skipped);
  const usesScale = (kind: InsulinScaleKind) => given.some((l) => l.insulinScale?.kind === kind);

  // 手で入れた血糖値は看護指示から記録したものと同じ形の Observation にする。
  let glucoseReference: string | null = insulin?.glucose?.observationId
    ? `Observation/${insulin.glucose.observationId}`
    : null;
  const patientId = referenceIdOfType(subject.reference, "Patient");
  if (insulin?.glucose && !insulin.glucose.observationId && usesScale("glucose") && patientId) {
    glucoseReference = `urn:uuid:${crypto.randomUUID()}`;
    entries.push({
      fullUrl: glucoseReference,
      resource: buildGlucoseObservation({
        patientId,
        encounter: order.encounter,
        value: insulin.glucose.value,
        effectiveDateTime: toFhirDateTime(values.startedAt),
        performer: values.performerId ? { id: values.performerId, name: values.performerName } : null,
        order: insulin.glucoseOrder,
      }),
      request: { method: "POST", url: "Observation" },
    });
  }
  const mealReference = insulin?.meal?.observationId ? `Observation/${insulin.meal.observationId}` : null;
  const manualMeal = insulin?.meal && !insulin.meal.observationId ? insulin.meal.value : null;

  for (const line of given) {
    const reference =
      line.insulinScale?.kind === "meal" ? mealReference : line.insulinScale ? glucoseReference : null;
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildAdministration(
        line,
        mrById.get(line.medicationRequestId),
        values,
        subject,
        hubReference,
        reference,
        manualMeal,
      ),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  return entries;
}

/** その日に予定された施用の回数(RP の開始時刻の最大数。無ければ 1)。 */
export function scheduledPerformCount(mrs: fhir4.MedicationRequest[]): number {
  const counts = groupInjectionByRp(mrs).map((rp) => rp.times.length);
  return Math.max(1, ...counts);
}

/**
 * 実施登録の transaction Bundle。実施記録一式と、必要なら Task の実施済を 1 つに
 * まとめる(実施情報だけ保存されて進捗が止まる状態を作らない)。
 *
 * Task を実施済にするのは、この登録で「実施」または「途中で中止」の記録が予定回数に
 * 達したとき。「実施せず」は回数に数えない(その日の施用が済んだわけではない)。
 */
export function buildInjectionPerformBundle(
  values: InjectionPerformFormValues,
  order: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
  task: fhir4.Task | undefined,
  /** 既にあるこのオーダーの実施記録(実施せず を除いた件数)。 */
  donePerformCount: number,
  /** スケールのインスリンを含むときの測定値。 */
  insulin?: InsulinPerformContext,
): fhir4.Bundle {
  const entries = performEntries(values, order, mrs, insulin);

  const counted = values.outcome !== "not-done";
  const reached = counted && donePerformCount + 1 >= scheduledPerformCount(mrs);
  if (reached && task?.status !== "completed") {
    entries.push({
      resource: buildInjectionTaskUpdate(task, order, "completed"),
      request: task?.id
        ? { method: "PUT", url: `Task/${task.id}` }
        : { method: "POST", url: "Task" },
    });
  }

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- カルテ・一覧への表示 ----

export interface InjectionPerformDisplay {
  /** ハブの Procedure id。表示のキー。 */
  id: string;
  /** 施用の時間帯 "2026-08-31 10:00〜11:30"。終了が無ければ開始だけ。 */
  performedAt: string;
  performerName: string;
  /** 施用した薬剤。「生理食塩液 1袋」の形。 */
  medicines: string[];
  /** 実施の結果。完了は空、途中で中止・実施せず はその表示。 */
  statusNote: string;
  reason: string;
  comment: string;
  /** 実施取消で一緒に消す薬剤の記録。 */
  administrationIds: string[];
  /** 進捗の判定に使う。実施せず は施用の回数に数えない。 */
  counted: boolean;
}

/** 注射の実施記録か。処置・手術・輸血の Procedure と振り分ける。 */
export function isInjectionProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === INJECTION_ORDER_TYPE.code,
    ),
  );
}

/** 「YYYY-MM-DD HH:mm〜HH:mm」。日をまたぐときは終了側も日付ごと出す。 */
function periodLabel(period: fhir4.Period | undefined): string {
  if (!period?.start) return "";
  const start = toDateTimeInput(period.start).replace("T", " ");
  if (!period.end) return start;
  const end = toDateTimeInput(period.end).replace("T", " ");
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start}〜${end.slice(11)}`
    : `${start}〜${end}`;
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  const dose = administration.dosage?.dose;
  const amount = dose?.value == null ? "" : `${dose.value}${dose.unit ?? ""}`;
  const name = conceptLabel(administration.medicationCodeableConcept);
  // request が無い = オーダーに無く実施時に足した薬剤。依頼と実施の差が読めるよう印を付ける。
  const added = administration.request ? "" : "(追加)";
  return [name, amount, added].filter(Boolean).join(" ");
}

/**
 * 実施記録をオーダー id ごとの表示内容にまとめる。1 日に複数回の施用があるので
 * 1 オーダーに複数のハブが付き、施用時刻の順に並べる。
 */
export function injectionPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): Map<string, InjectionPerformDisplay[]> {
  const hubs = procedures.filter(
    (procedure) => isInjectionProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const byOrderId = new Map<string, InjectionPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const children = administrations.filter((a) =>
      (a.partOf ?? []).some((r) => referenceIdOfType(r.reference, "Procedure") === hubId),
    );

    const display: InjectionPerformDisplay = {
      id: hubId,
      performedAt: periodLabel(hub.performedPeriod),
      performerName: hub.performer?.[0]?.actor?.display ?? "",
      medicines: children.map(medicineLabel).filter(Boolean),
      statusNote: hub.status === "completed" ? "" : outcomeDisplay(hub.status),
      reason: hub.statusReason?.text ?? "",
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      administrationIds: children.map((a) => a.id).filter((id): id is string => Boolean(id)),
      counted: hub.status !== "not-done",
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

/**
 * 実施取消で消す実施記録の DELETE エントリ。
 *
 * 輸血と同じく記録ごと消す。注射の実施記録は「この薬をこの量入れた」という事実の
 * 記録そのもので、取り消したのに残っているとその記録が嘘になる(放射線検査などが
 * Task を戻すだけで記録を残すのとは違う)。子(薬剤)を先に消してから親を消す。
 */
export function buildInjectionPerformDeleteEntries(
  performs: InjectionPerformDisplay[],
): fhir4.BundleEntry[] {
  return performs.flatMap((perform) => [
    ...perform.administrationIds.map((id) => ({
      request: { method: "DELETE" as const, url: `MedicationAdministration/${id}` },
    })),
    { request: { method: "DELETE" as const, url: `Procedure/${perform.id}` } },
  ]);
}

// ---- 実施入力の測定値 ----

/** 施用時刻より前に遡って測定値を探す幅(分)と、施用後に入れた記録を拾う幅(分)。 */
const MEASUREMENT_WINDOWS: Record<InsulinScaleKind, { before: number; after: number }> = {
  // 食前の血糖を測ってから打つ。
  glucose: { before: 120, after: 30 },
  // 食後に食べた量を見て打つ。摂取量の記録は食事の時刻(08/12/18)に置かれる。
  meal: { before: 180, after: 60 },
};

export interface ScaleMeasurementRecord {
  value: number;
  observationId: string;
  /** 記録の日時(FHIR の dateTime)。 */
  at: string;
}

function hasCoding(observation: fhir4.Observation, system: string, code: string): boolean {
  return Boolean(observation.code?.coding?.some((c) => c.system === system && c.code === code));
}

/** 簡易血糖の記録か(看護指示から記録したものも、インスリンの実施入力で書いたものも)。 */
export function isCapillaryGlucoseObservation(observation: fhir4.Observation): boolean {
  return (
    hasCoding(observation, LOINC_SYSTEM, CAPILLARY_GLUCOSE.code) ||
    hasCoding(observation, NURSING_OBSERVATION_CODE_SYSTEM, NURSING_GLUCOSE_MANAGE_NO)
  );
}

/** 主食の摂取量(%)の記録か。 */
export function isStapleIntakeObservation(observation: fhir4.Observation): boolean {
  return hasCoding(observation, NURSING_OBSERVATION_CODE_SYSTEM, MEAL_INTAKE_STAPLE_MANAGE_NO);
}

/**
 * 施用時刻(datetime-local の値)の前後で、スケールに使う直近の記録。幅の中でいちばん新しいもの。
 * 見つからなければ null(実施入力でその場で入れてもらう)。
 */
export function latestScaleMeasurement(
  observations: fhir4.Observation[],
  kind: InsulinScaleKind,
  at: string,
): ScaleMeasurementRecord | null {
  const base = new Date(at).getTime();
  if (!Number.isFinite(base)) return null;
  const window = MEASUREMENT_WINDOWS[kind];
  const matches = kind === "meal" ? isStapleIntakeObservation : isCapillaryGlucoseObservation;
  let latest: ScaleMeasurementRecord | null = null;
  for (const observation of observations) {
    const value = observation.valueQuantity?.value;
    const effective = observation.effectiveDateTime;
    if (!matches(observation) || value == null || !effective || !observation.id) continue;
    const time = new Date(effective).getTime();
    if (time < base - window.before * 60_000 || time > base + window.after * 60_000) continue;
    if (!latest || time > new Date(latest.at).getTime()) {
      latest = { value, observationId: observation.id, at: effective };
    }
  }
  return latest;
}
