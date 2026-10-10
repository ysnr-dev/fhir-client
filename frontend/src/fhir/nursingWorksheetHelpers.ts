import type { FlowsheetInjectionData } from "./flowsheetInjectionHelpers";
import { groupInjectionByRp } from "./injectionHelpers";
import { injectionPerformsByOrderId, type InjectionPerformDisplay } from "./injectionPerformHelpers";
import { injectionTaskStatus, injectionTasksByOrderId } from "./injectionTaskHelpers";
import type { MealScheduleSettings } from "./mealOrderHelpers";
import {
  expandUsageSchedule,
  isAsNeededUsage,
  isOralUsage,
  rpActiveDays,
  type MedicationScheduleSettings,
} from "./medicationScheduleHelpers";
import { summarizeNursingOrder } from "./nursingOrderHelpers";
import type { NursingPerformDisplay } from "./nursingPerformHelpers";
import {
  expandNursingSchedule,
  matchPerformsToSchedule,
  nursingScheduleOf,
  shiftOf,
  type NursingScheduleSettings,
  type ShiftCode,
} from "./nursingScheduleHelpers";
import { oralPerformsByOrderId } from "./oralPerformHelpers";
import { groupByRp, isPrescriptionServiceRequest, SETTING_SYSTEM } from "./prescriptionHelpers";
import { rxTaskStatus, rxTasksByOrderId } from "./rxTaskHelpers";
import { categoryCoding, conceptLabel, orderDay, referenceId } from "./shared";
import { labelSpecimensByOrderId, specimenArrived } from "./labSpecimenHelpers";

// 看護ワークシート(病棟の患者の 1 日)。看護指示・注射・内服・検体採取・検査や処置の予定を
// 1 日の時刻順の行に並べ、患者ごと・勤務帯ごとに読めるようにする。
//
// 予定の作り方は各画面と同じにする(食い違わせない):
// - 看護指示: 指示簿と同じ頻度の展開と、実施との突き合わせ(matchPerformsToSchedule)
// - 注射: 血糖インスリン一覧と同じ。RP の開始時刻を予定にし、施用の記録の件数で早い予定から埋める
// - 内服: 経過表の内服欄と同じ。用法コードを予定枠に展開し、記録の予定枠で突き合わせる
// - 検体・検査・処置: その日のオーダー 1 件 = 1 行。時刻はオーダーの実施予定日時(持っていれば)

export type WorksheetKind = "nursing" | "injection" | "oral" | "specimen" | "exam";

export const WORKSHEET_KIND_OPTIONS: { code: WorksheetKind; display: string }[] = [
  { code: "nursing", display: "看護" },
  { code: "injection", display: "注射" },
  { code: "oral", display: "内服" },
  { code: "specimen", display: "採取" },
  { code: "exam", display: "検査・処置" },
];

export function worksheetKindDisplay(kind: WorksheetKind): string {
  return WORKSHEET_KIND_OPTIONS.find((o) => o.code === kind)?.display ?? kind;
}

/** グリッドの印に添える区分の 1 文字。 */
export const WORKSHEET_KIND_MARK: Record<WorksheetKind, string> = {
  nursing: "看",
  injection: "注",
  oral: "内",
  specimen: "採",
  exam: "検",
};

/**
 * ワークシートに載せる、その日 1 回きりのオーダーの種別。採取は病棟で検体を採るもの、
 * それ以外は患者が出向くか病棟で受けるもの。`label` は行の区分の後ろに添える種別名。
 */
export const WORKSHEET_ORDER_TYPES = [
  { code: "lab", label: "検体検査", kind: "specimen" },
  { code: "micro", label: "細菌検査", kind: "specimen" },
  { code: "rad", label: "放射線", kind: "exam" },
  { code: "endoscopy", label: "内視鏡", kind: "exam" },
  { code: "physio", label: "生理検査", kind: "exam" },
  { code: "treatment", label: "処置", kind: "exam" },
  { code: "transfusion", label: "輸血", kind: "exam" },
  { code: "surgery", label: "手術", kind: "exam" },
] as const satisfies readonly { code: string; label: string; kind: WorksheetKind }[];

export interface WorksheetItem {
  key: string;
  kind: WorksheetKind;
  patientId: string;
  /** 予定の時刻(HH:mm)。時刻を持たないもの(適宜・時刻未定)は空。 */
  time: string;
  /** 「血圧」「ソルデム3A輸液 500mL」「アムロジピン錠・ランソプラゾール錠」「検体検査」。 */
  title: string;
  /** 頻度・用法・検査項目など。 */
  detail: string;
  done: boolean;
  /** 状態の表示(「実施済」「ラベル済」「受付済」など)。未実施で特に言うことが無ければ空。 */
  status: string;
  /** 実施入力に渡すもの(種別ごとにどれか 1 つ)。 */
  nursingOrder?: fhir4.ServiceRequest;
  injection?: {
    order: fhir4.ServiceRequest;
    medicationRequests: fhir4.MedicationRequest[];
    task: fhir4.Task | undefined;
    performs: InjectionPerformDisplay[];
  };
  oral?: {
    order: fhir4.ServiceRequest;
    medicationRequests: fhir4.MedicationRequest[];
    slotAt: string;
  };
}

function patientIdOf(sr: fhir4.ServiceRequest): string {
  return referenceId(sr.subject?.reference) ?? "";
}

/** occurrenceDateTime の時刻(HH:mm)。日付だけなら空。 */
function occurrenceTime(sr: fhir4.ServiceRequest): string {
  const at = sr.occurrenceDateTime ?? "";
  return at.length >= 16 && at[10] === "T" ? at.slice(11, 16) : "";
}

function mrsByOrderId(mrs: fhir4.MedicationRequest[]): Map<string, fhir4.MedicationRequest[]> {
  const map = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of mrs) {
    const orderId = referenceId(mr.basedOn?.[0]?.reference);
    if (!orderId) continue;
    const list = map.get(orderId);
    if (list) list.push(mr);
    else map.set(orderId, [mr]);
  }
  return map;
}

/** 看護指示。頻度を持つ指示は予定時刻ごと、持たない指示(適宜)は時刻なしの 1 行。 */
export function nursingWorksheetItems(
  orders: fhir4.ServiceRequest[],
  performsByOrderId: Map<string, NursingPerformDisplay[]>,
  date: string,
  settings: NursingScheduleSettings,
): WorksheetItem[] {
  const items: WorksheetItem[] = [];
  for (const order of orders) {
    if (order.status !== "active") continue;
    const id = order.id ?? "";
    const summary = summarizeNursingOrder(order);
    const performs = performsByOrderId.get(id) ?? [];
    const times = expandNursingSchedule(nursingScheduleOf(order), date, settings);
    const { slots } = matchPerformsToSchedule(times, performs);
    const base = {
      kind: "nursing" as const,
      patientId: patientIdOf(order),
      title: summary.text,
      detail: summary.frequency,
      nursingOrder: order,
    };
    if (slots.length === 0) {
      const latest = performs[0];
      items.push({
        ...base,
        key: `nursing:${id}`,
        time: "",
        done: false,
        // 適宜の指示は何度でも入れるので「済」にしない。その日の記録は回数で出す。
        status: latest ? `${performs.length}回 ${latest.value}` : "",
      });
      continue;
    }
    slots.forEach((slot, index) => {
      items.push({
        ...base,
        key: `nursing:${id}:${index}`,
        time: slot.time,
        done: Boolean(slot.done),
        status: slot.done ? slot.done.value : "",
      });
    });
  }
  return items;
}

/** 注射。RP の開始時刻ごとに 1 行。中止した注射は出さない。 */
export function injectionWorksheetItems(data: FlowsheetInjectionData): WorksheetItem[] {
  const tasksByOrderId = injectionTasksByOrderId(data.tasks);
  const performsByOrderId = injectionPerformsByOrderId(data.procedures, data.administrations);
  const mrs = mrsByOrderId(data.medicationRequests);
  const items: WorksheetItem[] = [];

  for (const order of data.orders) {
    const id = order.id ?? "";
    const task = tasksByOrderId.get(id);
    if (order.status === "revoked" || injectionTaskStatus(task) === "cancelled") continue;
    const orderMrs = mrs.get(id) ?? [];
    const rps = groupInjectionByRp(orderMrs);
    if (rps.length === 0) continue;
    const performs = performsByOrderId.get(id) ?? [];
    const counted = performs.filter((p) => p.counted).length;
    const times = [...new Set(rps.flatMap((rp) => rp.times.map((t) => t.start)))].sort();
    const slots = times.length > 0 ? times : [""];

    slots.forEach((time, index) => {
      // その時刻に施用する RP の薬剤。時刻を持たない注射はすべての RP。
      const slotRps = time ? rps.filter((rp) => rp.times.some((t) => t.start === time)) : rps;
      const medicines = slotRps.flatMap((rp) => rp.medicines);
      const done = index < counted;
      items.push({
        key: `injection:${id}:${index}`,
        kind: "injection",
        patientId: patientIdOf(order),
        time,
        title: medicines.map((m) => m.name).filter(Boolean).join("・"),
        detail: medicines
          .map((m) => (m.dose != null ? `${m.dose}${m.unit ?? ""}` : ""))
          .filter(Boolean)
          .join(" / "),
        done,
        status: done ? "実施済" : "",
        injection: { order, medicationRequests: orderMrs, task, performs },
      });
    });
  }
  return items;
}

/** 内服。入院処方のうちその日に有効な RP を予定枠ごとにまとめて 1 行(与薬入力は処方 × 枠の単位)。 */
export function oralWorksheetItems(
  data: FlowsheetInjectionData,
  date: string,
  meal: MealScheduleSettings,
  medication: MedicationScheduleSettings,
  nursing: NursingScheduleSettings,
): WorksheetItem[] {
  const taskByOrderId = rxTasksByOrderId(data.tasks);
  const performsByOrderId = oralPerformsByOrderId(data.procedures, data.administrations);
  const mrs = mrsByOrderId(data.medicationRequests);
  const items: WorksheetItem[] = [];

  for (const order of data.orders) {
    if (!isPrescriptionServiceRequest(order)) continue;
    if (categoryCoding(order, SETTING_SYSTEM)?.code !== "inpatient") continue;
    const id = order.id ?? "";
    if (order.status === "revoked" || rxTaskStatus(taskByOrderId.get(id)) === "cancelled") continue;
    const startDate = orderDay(order);
    const orderMrs = mrs.get(id) ?? [];
    const recorded = new Map((performsByOrderId.get(id) ?? []).map((p) => [p.slotAt, p]));

    // 時刻 → その時刻に飲ませる RP の薬剤名。
    const medicinesByTime = new Map<string, string[]>();
    for (const rp of groupByRp(orderMrs)) {
      if (!isOralUsage(rp.usageCode) || isAsNeededUsage(rp.usageCode)) continue;
      if (!rpActiveDays(startDate, rp).includes(date)) continue;
      for (const time of expandUsageSchedule(rp.usageCode, meal, medication, nursing)) {
        const names = rp.medicines.map((m) => m.name).filter(Boolean);
        medicinesByTime.set(time, [...(medicinesByTime.get(time) ?? []), ...names]);
      }
    }

    for (const [time, names] of medicinesByTime) {
      const slotAt = `${date}T${time}`;
      const perform = recorded.get(slotAt);
      items.push({
        key: `oral:${id}:${time}`,
        kind: "oral",
        patientId: patientIdOf(order),
        time,
        title: [...new Set(names)].join("・"),
        detail: "",
        done: Boolean(perform),
        status: perform ? (perform.statusNote || "与薬済") : "",
        oral: { order, medicationRequests: orderMrs, slotAt },
      });
    }
  }
  return items;
}

/** 部門の Task の状態から、病棟から見た進み具合。 */
function departmentTaskLabel(task: fhir4.Task | undefined): string {
  switch (task?.status) {
    case "accepted":
    case "received":
      return "受付済";
    case "in-progress":
      return "実施中";
    case "completed":
      return "実施済";
    default:
      return "";
  }
}

/** 検体の採取・検査・処置など、その日 1 回きりのオーダー。オーダー 1 件 = 1 行。 */
export function dayOrderWorksheetItems(data: {
  headers: fhir4.ServiceRequest[];
  items: fhir4.ServiceRequest[];
  tasks: fhir4.Task[];
  procedures: fhir4.Procedure[];
  specimens: fhir4.Specimen[];
}): WorksheetItem[] {
  const taskByOrderId = new Map<string, fhir4.Task>();
  for (const task of data.tasks) {
    const orderId = referenceId(task.focus?.reference);
    if (orderId && task.status !== "cancelled") taskByOrderId.set(orderId, task);
  }
  const cancelledOrderIds = new Set(
    data.tasks
      .filter((task) => task.status === "cancelled")
      .map((task) => referenceId(task.focus?.reference))
      .filter((id): id is string => Boolean(id) && !taskByOrderId.has(id as string)),
  );
  const performedOrderIds = new Set(
    data.procedures
      .filter((p) => p.status !== "entered-in-error")
      .flatMap((p) => (p.basedOn ?? []).map((ref) => referenceId(ref.reference) ?? "")),
  );
  const itemNamesByHeader = new Map<string, string[]>();
  for (const item of data.items) {
    const headerId = referenceId(item.basedOn?.[0]?.reference);
    if (!headerId) continue;
    const name = conceptLabel(item.code);
    if (name) itemNamesByHeader.set(headerId, [...(itemNamesByHeader.get(headerId) ?? []), name]);
  }
  const specimensByOrderId = labelSpecimensByOrderId(data.specimens);

  const items: WorksheetItem[] = [];
  for (const order of data.headers) {
    const id = order.id ?? "";
    if (!id || order.status === "revoked" || cancelledOrderIds.has(id)) continue;
    const type = WORKSHEET_ORDER_TYPES.find((candidate) =>
      (order.category ?? []).some((c) => c.coding?.some((coding) => coding.code === candidate.code)),
    );
    if (!type) continue;
    const task = taskByOrderId.get(id);
    const names = [...new Set(itemNamesByHeader.get(id) ?? [])];
    const headerName = conceptLabel(order.code);

    let done = performedOrderIds.has(id) || task?.status === "completed";
    let status = done ? "実施済" : departmentTaskLabel(task);
    if (type.kind === "specimen" && !done) {
      // 病棟の仕事は採って出すところまで。検査室に届いていれば済、ラベルだけなら採取待ち。
      const specimens = specimensByOrderId.get(id) ?? [];
      if (specimens.length > 0 && specimens.every(specimenArrived)) {
        done = true;
        status = "到着済";
      } else if (specimens.length > 0) {
        status = "ラベル済";
      }
    }

    items.push({
      key: `order:${id}`,
      kind: type.kind,
      patientId: patientIdOf(order),
      time: occurrenceTime(order),
      title: type.label,
      detail: names.join("、") || headerName,
      done,
      status,
    });
  }
  return items;
}

/** 行の並び。時刻順(時刻の無いものは後ろ)、同じ時刻は区分の順。 */
export function sortWorksheetItems(items: WorksheetItem[]): WorksheetItem[] {
  const kindOrder = (kind: WorksheetKind) => WORKSHEET_KIND_OPTIONS.findIndex((o) => o.code === kind);
  return [...items].sort(
    (a, b) =>
      (a.time || "99:99").localeCompare(b.time || "99:99") ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      a.title.localeCompare(b.title, "ja"),
  );
}

/**
 * グリッドの列にする時(0〜23)。勤務帯の区切りが :30 なので、区切りの時はどちらの勤務帯にも置く
 * (日勤 8〜16 時、準夜 16〜23 時と 0 時、深夜 0〜8 時)。勤務帯を選ばなければ 0〜23 時。
 */
export function worksheetHourColumns(shift: ShiftCode | ""): number[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  switch (shift) {
    case "day":
      return range(8, 16);
    case "evening":
      return [...range(16, 23), 0];
    case "night":
      return range(0, 8);
    default:
      return range(0, 23);
  }
}

/** 予定の時刻(HH:mm)の時。 */
export function hourOfTime(time: string): number {
  return Number(time.slice(0, 2));
}

/** 勤務帯で絞る。時刻の無い行はどの勤務帯にも出す(いつ入れてもよい指示)。 */
export function inShift(item: WorksheetItem, shift: ShiftCode | ""): boolean {
  return !shift || !item.time || shiftOf(item.time) === shift;
}

/** 遅れているか(今日を見ていて、予定の時刻を過ぎて未実施)。 */
export function isLate(item: WorksheetItem, nowMinutes: number | null): boolean {
  if (nowMinutes === null || item.done || !item.time) return false;
  const [h, m] = item.time.split(":").map(Number);
  return h * 60 + m <= nowMinutes;
}
