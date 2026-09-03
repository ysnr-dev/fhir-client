import { categoryCoding, orderDay, referenceId } from "./shared";
import {
  type FlowsheetMark,
  type FlowsheetMarkKind,
  type FlowsheetMarkRow,
} from "./flowsheetEventHelpers";
import { flowsheetTimeLabel } from "./flowsheetInjectionHelpers";
import type { MealScheduleSettings } from "./mealOrderHelpers";
import {
  expandUsageSchedule,
  isAsNeededUsage,
  isOralUsage,
  rpActiveDays,
  type MedicationScheduleSettings,
} from "./medicationScheduleHelpers";
import type { NursingScheduleSettings } from "./nursingScheduleHelpers";
import { oralPerformsByOrderId } from "./oralPerformHelpers";
import {
  SETTING_SYSTEM,
  groupByRp,
  isPrescriptionServiceRequest,
  type RpDisplay,
} from "./prescriptionHelpers";
import { rxTaskStatus, rxTasksByOrderId } from "./rxTaskHelpers";

// 経過表の「内服」欄。行は処方の RP(薬剤の組 × 用法)で、印は与薬の予定と実施。
//
// 注射(flowsheetInjectionHelpers)との違いは**1 件のオーダーが何日も続く**こと。
// 注射は 1 施行 = 1 オーダーだが、処方は投与開始日から投与日数ぶん、毎日決まった
// 回数を飲ませる。そこで予定は「有効な日 × 用法から展開した時刻」で作り、実施の
// 記録が持つ予定枠(`medication-schedule-slot`)と突き合わせて、記録のある枠には
// 予定の印を出さない(看護観察・看護行為と同じやり方)。

/** 経過表が内服を組み立てるのに要るリソース一式。 */
export interface FlowsheetOralData {
  orders: fhir4.ServiceRequest[];
  medicationRequests: fhir4.MedicationRequest[];
  tasks: fhir4.Task[];
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
}

const MARK_LABELS: Record<FlowsheetMarkKind, string> = {
  planned: "予定",
  performed: "与薬",
  stopped: "途中で中止",
  "not-done": "与薬せず",
  cancelled: "中止",
};

/** 薬剤名を「・」で連結。長さは表示側(CSS の省略)に任せる。 */
function medicineLabel(rp: RpDisplay): string {
  return rp.medicines.map((medicine) => medicine.name).filter(Boolean).join("・");
}

/** 行のキー。薬剤の組が同じでも用法が違えば別の行にする。 */
function rowKeyOf(rp: RpDisplay): string {
  return [medicineLabel(rp), rp.usageName ?? ""].join("/");
}

/**
 * 一覧モーダルでまとめる単位。**処方 + 予定枠**にする。
 *
 * 注射は 1 施行 = 1 オーダーなので処方 id だけでまとめれば「その日の施用」に収まるが、
 * 処方は 1 件に何十枠もある(朝昼夕 × 7 日 = 21 枠)。処方でまとめると一覧が全枠になって
 * 読めないので、押した枠の予定と実施だけを見せる。
 */
export function oralGroupId(srId: string, slotAt: string): string {
  return `${srId}#${slotAt}`;
}

/** `oralGroupId` から処方 id を取り出す。 */
export function oralGroupOrderId(groupId: string): string {
  return groupId.split("#")[0] ?? "";
}

function markEvent(
  kind: FlowsheetMarkKind,
  at: string,
  label: string,
  detail: string,
  srId: string,
): FlowsheetMark["event"] {
  return {
    at,
    kind: "oral",
    label: MARK_LABELS[kind],
    name: MARK_LABELS[kind],
    detail: [label, detail].filter(Boolean).join(" "),
    target: { kind: "prescription", id: srId },
  };
}

/** 入院の処方か。外来・院内処方は病棟が与薬しないので経過表に出さない。 */
function isInpatientPrescription(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, SETTING_SYSTEM)?.code === "inpatient";
}

/**
 * 「薬剤の組 × 時系列」の行を組み立てる。
 *
 * 予定は RP の有効な日 × 用法から展開した時刻。実施は処方 1 件の記録なので、その処方の
 * すべての RP 行に付ける(どの薬剤を飲ませたかは一覧モーダルで読む。注射と同じ粒度)。
 */
export function buildOralRows(
  data: FlowsheetOralData,
  /** 表示している日。 */
  days: string[],
  meal: MealScheduleSettings,
  settings: MedicationScheduleSettings,
  nursing: NursingScheduleSettings,
): FlowsheetMarkRow[] {
  const orders = data.orders.filter(
    (sr) => isPrescriptionServiceRequest(sr) && isInpatientPrescription(sr),
  );
  if (orders.length === 0) return [];

  const shownDays = new Set(days);
  const taskByOrderId = rxTasksByOrderId(data.tasks);
  const performsByOrderId = oralPerformsByOrderId(data.procedures, data.administrations);

  const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of data.medicationRequests) {
    const orderId = referenceId(mr.basedOn?.[0]?.reference);
    if (!orderId) continue;
    const list = mrsByOrderId.get(orderId);
    if (list) list.push(mr);
    else mrsByOrderId.set(orderId, [mr]);
  }

  // 古い処方から並べる(列と同じ向き)。同じ行キーは初出の順で上から。
  const sorted = [...orders].sort((a, b) => orderDay(a).localeCompare(orderDay(b)));
  const rows = new Map<string, FlowsheetMarkRow>();

  for (const order of sorted) {
    const srId = order.id ?? "";
    const startDate = orderDay(order);
    if (!srId || !startDate) continue;
    // 中止した処方は予定を薄い × にする(飲ませる予定だったが取り消された)。
    const cancelled =
      order.status === "revoked" || rxTaskStatus(taskByOrderId.get(srId)) === "cancelled";
    const performs = performsByOrderId.get(srId) ?? [];
    const recordedSlots = new Set(performs.map((perform) => perform.slotAt));

    for (const rp of groupByRp(mrsByOrderId.get(srId) ?? [])) {
      if (!isOralUsage(rp.usageCode)) continue;
      const label = medicineLabel(rp);
      if (!label) continue;
      const key = rowKeyOf(rp);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          label,
          title: [label, rp.usageName ?? ""].filter(Boolean).join("\n"),
          marks: [],
        };
        rows.set(key, row);
      }

      // 予定。頓用・イベント型など展開できない用法は空になり、実施の印だけが並ぶ。
      const times = expandUsageSchedule(rp.usageCode, meal, settings, nursing);
      if (times.length > 0 && !isAsNeededUsage(rp.usageCode)) {
        for (const day of rpActiveDays(startDate, rp)) {
          if (!shownDays.has(day)) continue;
          for (const time of times) {
            const at = `${day}T${time}`;
            // その枠の与薬を記録済みなら予定は出さない(実施の印だけを出す)。
            if (recordedSlots.has(at)) continue;
            const kind: FlowsheetMarkKind = cancelled ? "cancelled" : "planned";
            row.marks.push({
              at,
              kind,
              groupId: oralGroupId(srId, at),
              title: [`${MARK_LABELS[kind]} ${flowsheetTimeLabel(at)}`, label, rp.usageName ?? ""]
                .filter(Boolean)
                .join(" "),
              event: markEvent(kind, at, label, rp.usageName ?? "", srId),
            });
          }
        }
      }

      // 実施。印は**予定枠の位置**に置く(実際の時刻が数十分ずれても、読むのは
      // 「朝の薬を飲んだか」なので枠で並べたほうが揃う。実際の時刻は一覧で読む)。
      for (const perform of performs) {
        if (!perform.slotAt || !shownDays.has(perform.slotAt.slice(0, 10))) continue;
        const kind: FlowsheetMarkKind = perform.statusNote ? "not-done" : "performed";
        const detail = [
          perform.medicines.join("・"),
          perform.reason ? `理由: ${perform.reason}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        row.marks.push({
          at: perform.slotAt,
          kind,
          groupId: oralGroupId(srId, perform.slotAt),
          title: [`${MARK_LABELS[kind]} ${flowsheetTimeLabel(perform.performedAt)}`, label, detail]
            .filter(Boolean)
            .join(" "),
          // 一覧に出すのは**実際に与薬した薬剤**。行の薬剤名(label)は入れない
          // (記録は処方 1 件ぶんで全 RP 行に付くので、行名を足すと二重になる)。
          event: markEvent(kind, perform.slotAt, "", detail, srId),
        });
      }
    }
  }

  return [...rows.values()].filter((row) => row.marks.length > 0);
}
