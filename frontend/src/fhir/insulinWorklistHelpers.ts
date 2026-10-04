import type { FlowsheetInjectionData } from "./flowsheetInjectionHelpers";
import { groupInjectionByRp } from "./injectionHelpers";
import { injectionPerformsByOrderId, type InjectionPerformDisplay } from "./injectionPerformHelpers";
import { injectionTaskStatus, injectionTasksByOrderId } from "./injectionTaskHelpers";
import { INSULIN_UCUM, INSULIN_UNIT, insulinScaleOf, insulinScaleSummary } from "./insulinScaleHelpers";
import { nursingOrderPeriodLabel, summarizeNursingOrder } from "./nursingOrderHelpers";
import type { NursingPerformDisplay } from "./nursingPerformHelpers";
import {
  expandNursingSchedule,
  matchPerformsToSchedule,
  nursingScheduleOf,
  type NursingScheduleSettings,
} from "./nursingScheduleHelpers";
import { orderRequester } from "./orderHeader";
import { referenceId } from "./shared";

// 血糖インスリン指示患者一覧。病棟の 1 日ぶんの「インスリンの施用」と「血糖測定」の予定を
// 時刻ごとの行に並べる。インスリンは注射オーダー(薬剤の量が単位、またはスケールを持つもの)の
// 開始時刻、血糖測定は看護指示「血糖値」の頻度を展開した時刻。
//
// 予定の消化は、注射は施用の記録の件数(時刻の早い予定から埋まる。実施せずは数えない)、
// 血糖測定は看護指示の予定と実施の突き合わせ(指示簿と同じ matchPerformsToSchedule)で決める。

export type InsulinWorklistKind = "insulin" | "glucose";

export const INSULIN_WORKLIST_KIND_OPTIONS: { code: InsulinWorklistKind; display: string }[] = [
  { code: "insulin", display: "インスリン" },
  { code: "glucose", display: "血糖測定" },
];

export function insulinWorklistKindDisplay(kind: InsulinWorklistKind): string {
  return INSULIN_WORKLIST_KIND_OPTIONS.find((o) => o.code === kind)?.display ?? kind;
}

/**
 * 勤務帯。施設設定には持たず、三交代の区切りで固定する(日勤 8:30〜、準夜 16:30〜、深夜 0:30〜)。
 * 時刻の無い予定(適宜・時刻未指定の注射)はどの勤務帯にも入れる。
 */
export type ShiftCode = "day" | "evening" | "night";

export const SHIFT_OPTIONS: { code: ShiftCode; display: string }[] = [
  { code: "day", display: "日勤" },
  { code: "evening", display: "準夜" },
  { code: "night", display: "深夜" },
];

export function shiftOf(time: string): ShiftCode | null {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const minutes = h * 60 + m;
  if (minutes >= 8 * 60 + 30 && minutes < 16 * 60 + 30) return "day";
  if (minutes >= 16 * 60 + 30 || minutes < 30) return "evening";
  return "night";
}

export interface InsulinWorklistItem {
  key: string;
  kind: InsulinWorklistKind;
  patientId: string;
  patient?: fhir4.Patient;
  /** 予定の時刻(HH:mm)。予定を持たない指示は空。 */
  time: string;
  /** 「ノボラピッド注 フレックスペン 300単位」「血糖値」。 */
  instruction: string;
  /** 量とスケール、または頻度・条件。 */
  detail: string;
  /** 指示の期間(看護指示)、注射は注射日。 */
  period: string;
  requesterName: string;
  departmentId: string;
  done: boolean;
  /** 実施入力に渡すもの。 */
  injection?: {
    order: fhir4.ServiceRequest;
    medicationRequests: fhir4.MedicationRequest[];
    task: fhir4.Task | undefined;
    performs: InjectionPerformDisplay[];
  };
  nursingOrder?: fhir4.ServiceRequest;
}

/** インスリンの薬剤行か。量が国際単位([iU])か、スケールを持つ。 */
export function isInsulinMedicationRequest(mr: fhir4.MedicationRequest): boolean {
  const dosage = mr.dosageInstruction?.[0];
  if (insulinScaleOf(dosage)) return true;
  const doseAndRate = dosage?.doseAndRate?.[0];
  const code = doseAndRate?.doseQuantity?.code ?? doseAndRate?.doseRange?.high?.code;
  return code === INSULIN_UCUM;
}

function patientIdOf(sr: fhir4.ServiceRequest): string {
  return referenceId(sr.subject?.reference) ?? "";
}

/** 注射オーダーからインスリンの施用の予定。中止した注射・インスリンを含まない注射は出さない。 */
function insulinItems(data: FlowsheetInjectionData & { patients: fhir4.Patient[] }): InsulinWorklistItem[] {
  const patientsById = new Map(data.patients.map((p) => [p.id ?? "", p]));
  const tasksByOrderId = injectionTasksByOrderId(data.tasks);
  const performsByOrderId = injectionPerformsByOrderId(data.procedures, data.administrations);
  const items: InsulinWorklistItem[] = [];

  for (const order of data.orders) {
    const id = order.id ?? "";
    const task = tasksByOrderId.get(id);
    if (injectionTaskStatus(task) === "cancelled") continue;
    const mrs = data.medicationRequests.filter((mr) => referenceId(mr.basedOn?.[0]?.reference) === id);
    const insulin = mrs.filter(isInsulinMedicationRequest);
    if (insulin.length === 0) continue;

    const rps = groupInjectionByRp(insulin);
    const medicines = rps.flatMap((rp) => rp.medicines);
    const times = [...new Set(rps.flatMap((rp) => rp.times.map((t) => t.start)))].sort();
    const performs = performsByOrderId.get(id) ?? [];
    const counted = performs.filter((p) => p.counted).length;
    const requester = orderRequester(order);
    const patientId = patientIdOf(order);
    const detail = medicines
      .map((m) =>
        m.insulinScale
          ? insulinScaleSummary(m.insulinScale, m.dose)
          : m.dose != null
            ? `${m.dose}${m.unit ?? INSULIN_UNIT}`
            : "",
      )
      .filter(Boolean)
      .join(" / ");
    const slots = times.length > 0 ? times : [""];
    slots.forEach((time, index) => {
      items.push({
        key: `insulin:${id}:${index}`,
        kind: "insulin",
        patientId,
        patient: patientsById.get(patientId),
        time,
        instruction: medicines.map((m) => m.name).join("・"),
        detail,
        period: (order.occurrenceDateTime ?? "").slice(0, 10),
        requesterName: requester.practitionerName ?? "",
        departmentId: requester.departmentId ?? "",
        // 施用の記録は時刻の早い予定から順に埋める(記録は予定の時刻を持たないため)。
        done: index < counted,
        injection: { order, medicationRequests: mrs, task, performs },
      });
    });
  }
  return items;
}

/** 看護指示「血糖値」から血糖測定の予定。 */
function glucoseItems(
  rows: { order: fhir4.ServiceRequest; patient?: fhir4.Patient }[],
  performsByOrderId: Map<string, NursingPerformDisplay[]>,
  date: string,
  settings: NursingScheduleSettings,
): InsulinWorklistItem[] {
  const items: InsulinWorklistItem[] = [];
  for (const { order, patient } of rows) {
    const id = order.id ?? "";
    const summary = summarizeNursingOrder(order);
    const performs = performsByOrderId.get(id) ?? [];
    const times = expandNursingSchedule(nursingScheduleOf(order), date, settings);
    const { slots } = matchPerformsToSchedule(times, performs);
    const requester = orderRequester(order);
    const base = {
      kind: "glucose" as const,
      patientId: patientIdOf(order),
      patient,
      instruction: summary.text,
      detail: summary.frequency,
      period: nursingOrderPeriodLabel(summary, date),
      requesterName: summary.requesterName,
      departmentId: requester.departmentId ?? "",
      nursingOrder: order,
    };
    if (slots.length === 0) {
      items.push({ ...base, key: `glucose:${id}:0`, time: "", done: performs.length > 0 });
      continue;
    }
    slots.forEach((slot, index) => {
      items.push({ ...base, key: `glucose:${id}:${index}`, time: slot.time, done: Boolean(slot.done) });
    });
  }
  return items;
}

/** 一覧の行。時刻順(時刻の無いものは後ろ)、同じ時刻は病室順。 */
export function buildInsulinWorklist(args: {
  injections: (FlowsheetInjectionData & { patients: fhir4.Patient[] }) | undefined;
  glucoseOrders: { order: fhir4.ServiceRequest; patient?: fhir4.Patient }[];
  nursingPerformsByOrderId: Map<string, NursingPerformDisplay[]>;
  date: string;
  scheduleSettings: NursingScheduleSettings;
  bedLabelOf: (patientId: string) => string;
}): InsulinWorklistItem[] {
  const items = [
    ...(args.injections ? insulinItems(args.injections) : []),
    ...glucoseItems(args.glucoseOrders, args.nursingPerformsByOrderId, args.date, args.scheduleSettings),
  ];
  return items.sort(
    (a, b) =>
      (a.time || "99:99").localeCompare(b.time || "99:99") ||
      args.bedLabelOf(a.patientId).localeCompare(args.bedLabelOf(b.patientId), "ja") ||
      a.kind.localeCompare(b.kind),
  );
}
