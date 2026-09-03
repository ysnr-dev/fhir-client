import { addDays } from "../lib/dates";
import {
  flowsheetEventAtLabel,
  localDateOf,
  type FlowsheetMark,
  type FlowsheetMarkKind,
  type FlowsheetMarkRow,
} from "./flowsheetEventHelpers";
import {
  groupInjectionByRp,
  injectionDayOf,
  injectionUsageSummary,
  isInjectionServiceRequest,
  type InjectionRpDisplay,
} from "./injectionHelpers";
import { injectionTaskStatus, injectionTasksByOrderId } from "./injectionTaskHelpers";
import { isInjectionProcedure } from "./injectionPerformHelpers";
import { referenceId } from "./shared";

// 経過表(温度板)の注射欄。docs/injection-order-design.md §8-D のバックログ。
//
// 紙の温度板は折れ線の下に Rp ごとの行があり、点滴は開始〜終了の横線、ワンショットは
// 点で書く。同じ形を経過表の列に載せる。
//
// 注射のデータの形(調査済み):
//   ServiceRequest  … 1 施行(= 1 日) = 1 件。occurrenceDateTime は**日付のみ**
//    ├ basedOn ← MedicationRequest … 薬剤。RP(混注のまとまり)ごとに用法・投与速度を持ち、
//    │                                開始時刻は dosageInstruction[0].timing.event(複数可)、
//    │                                終了予定はローカル拡張(docs §2.2)
//    ├ focus  ← Task              … 進捗(依頼済/受付済/払出済/実施済/中止)。SR.status は動かさない
//    └ basedOn ← Procedure(ハブ)  … 実施記録。performedPeriod の start/end(end は任意)
//                └ partOf ← MedicationAdministration … 薬剤ごとの実施

/** 経過表が注射を組み立てるのに要るリソース一式。 */
export interface FlowsheetInjectionData {
  orders: fhir4.ServiceRequest[];
  medicationRequests: fhir4.MedicationRequest[];
  tasks: fhir4.Task[];
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
}

const MARK_LABELS: Record<FlowsheetMarkKind, string> = {
  planned: "予定",
  performed: "実施",
  stopped: "途中で中止",
  "not-done": "実施せず",
  cancelled: "中止",
  exam: "検査",
};

/** 薬剤名を「・」で連結。長さは表示側(CSS の省略)に任せる。 */
function medicineLabel(rp: InjectionRpDisplay): string {
  return rp.medicines.map((medicine) => medicine.name).filter(Boolean).join("・");
}

/** 行のキー。薬剤の組が同じでも、用法種別・経路が違えば別の行にする。 */
function rowKeyOf(rp: InjectionRpDisplay): string {
  return [medicineLabel(rp), rp.usageTypeDisplay ?? "", rp.routeDisplay ?? ""].join("/");
}

/** 実施記録の状態 → 印の種類。 */
function markKindOfProcedure(status: string | undefined): FlowsheetMarkKind {
  if (status === "stopped") return "stopped";
  if (status === "not-done") return "not-done";
  return "performed";
}

/** 印の 1 行(一覧モーダル用)。 */
function markEvent(
  kind: FlowsheetMarkKind,
  at: string,
  end: string | undefined,
  label: string,
  srId: string,
): FlowsheetMark["event"] {
  return {
    at,
    kind: "injection",
    label: MARK_LABELS[kind],
    name: MARK_LABELS[kind],
    detail: [label, end ? `〜${flowsheetTimeLabel(end)}` : ""].filter(Boolean).join(" "),
    target: { kind: "injection", id: srId },
  };
}

/**
 * 「薬剤の組 × 時系列」の行を組み立てる。
 *
 * 予定は RP の開始〜終了(無ければその日)、実施はハブ Procedure の期間。実施は
 * 1 オーダー(その日)の記録なので、そのオーダーのすべての RP 行に付ける
 * (どの薬剤をいつ落としたかまでは MedicationAdministration にしか無く、
 * 経過表の粒度では RP 行に付ければ足りる)。
 */
export function buildInjectionRows(data: FlowsheetInjectionData): FlowsheetMarkRow[] {
  const orders = data.orders.filter(isInjectionServiceRequest);
  if (orders.length === 0) return [];

  const taskByOrderId = injectionTasksByOrderId(data.tasks);
  const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of data.medicationRequests) {
    const orderId = referenceId(mr.basedOn?.[0]?.reference);
    if (!orderId) continue;
    const list = mrsByOrderId.get(orderId);
    if (list) list.push(mr);
    else mrsByOrderId.set(orderId, [mr]);
  }

  // 実施記録(ハブ)をオーダーごとに。取消済み(誤登録)は出さない。
  const proceduresByOrderId = new Map<string, fhir4.Procedure[]>();
  for (const procedure of data.procedures) {
    if (!isInjectionProcedure(procedure) || procedure.status === "entered-in-error") continue;
    const orderId = referenceId(procedure.basedOn?.[0]?.reference);
    if (!orderId) continue;
    const list = proceduresByOrderId.get(orderId);
    if (list) list.push(procedure);
    else proceduresByOrderId.set(orderId, [procedure]);
  }

  // 古い日から並べる(列と同じ向き)。同じ行キーは初出の順で上から。
  const sorted = [...orders].sort((a, b) => injectionDayOf(a).localeCompare(injectionDayOf(b)));
  const rows = new Map<string, FlowsheetMarkRow>();

  for (const order of sorted) {
    const srId = order.id ?? "";
    const day = injectionDayOf(order);
    if (!srId || !day) continue;
    const status = injectionTaskStatus(taskByOrderId.get(srId));
    const cancelled = status === "cancelled";
    const performs = proceduresByOrderId.get(srId) ?? [];

    for (const rp of groupInjectionByRp(mrsByOrderId.get(srId) ?? [])) {
      const key = rowKeyOf(rp);
      const label = medicineLabel(rp);
      if (!label) continue;
      const usage = injectionUsageSummary(rp);
      let row = rows.get(key);
      if (!row) {
        row = { key, label, title: [label, usage].filter(Boolean).join("\n"), marks: [] };
        rows.set(key, row);
      }

      // 予定。時刻はローカルの HH:mm なので、その日と組んで日時にする。終了が
      // 開始以下なら翌日(夜からの持続点滴)。時刻が無ければその日 1 件だけ置く。
      const planned =
        rp.times.length > 0
          ? rp.times.map((time) => ({
              at: `${day}T${time.start}`,
              end: time.end
                ? `${time.end > time.start ? day : addDays(day, 1)}T${time.end}`
                : undefined,
            }))
          : [{ at: day, end: undefined }];
      for (const { at, end } of planned) {
        const kind: FlowsheetMarkKind = cancelled ? "cancelled" : "planned";
        row.marks.push({
          at,
          end,
          kind,
          groupId: srId,
          title: [
            `${MARK_LABELS[kind]} ${flowsheetTimeLabel(at)}${end ? `〜${flowsheetTimeLabel(end)}` : ""}`,
            label,
            usage,
          ]
            .filter(Boolean)
            .join(" "),
          event: markEvent(kind, at, end, label, srId),
        });
      }

      // 実施。終了が記録されていればバーになる。
      for (const procedure of performs) {
        const start = procedure.performedPeriod?.start ?? procedure.performedDateTime;
        if (!start) continue;
        const kind = markKindOfProcedure(procedure.status);
        const end = procedure.performedPeriod?.end;
        row.marks.push({
          at: start,
          end,
          kind,
          groupId: srId,
          title: [
            `${MARK_LABELS[kind]} ${flowsheetTimeLabel(start)}${end ? `〜${flowsheetTimeLabel(end)}` : ""}`,
            label,
          ]
            .filter(Boolean)
            .join(" "),
          event: markEvent(kind, start, end, label, srId),
        });
      }
    }
  }

  return [...rows.values()].filter((row) => row.marks.length > 0);
}

/** 印の日時を「MM/DD HH:mm」にする。日付だけの値は日付のみ。 */
export function flowsheetTimeLabel(at: string): string {
  return flowsheetEventAtLabel(at) || localDateOf(at);
}
