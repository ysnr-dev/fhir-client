import { addDays } from "../lib/dates";
import type { FlowsheetEvent } from "./flowsheetEventHelpers";
import { localDateOf } from "./flowsheetEventHelpers";
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
// 点で書く。同じ形を経過表の列(測定 1 回 = 64px、時間に比例しない)に載せる。
//
// 注射のデータの形(調査済み):
//   ServiceRequest  … 1 施行(= 1 日) = 1 件。occurrenceDateTime は**日付のみ**
//    ├ basedOn ← MedicationRequest … 薬剤。RP(混注のまとまり)ごとに用法・投与速度を持ち、
//    │                                開始時刻は dosageInstruction[0].timing.event(複数可)
//    ├ focus  ← Task              … 進捗(依頼済/受付済/払出済/実施済/中止)。SR.status は動かさない
//    └ basedOn ← Procedure(ハブ)  … 実施記録。performedPeriod の start/end(end は任意)
//                └ partOf ← MedicationAdministration … 薬剤ごとの実施
//
// **終了予定時刻はどこにも無い**(点滴時間は保存せず投与速度だけを持つ、docs §2)。
// なので予定は「点」、実施は終了が記録されていれば「バー」、無ければ「点」にする。

/** 印の種類。色と形で状態を出す。 */
export type InjectionMarkKind = "planned" | "performed" | "stopped" | "not-done" | "cancelled";

export interface InjectionMark {
  /** 開始(ローカルの日時文字列)。開始時刻の無い予定は YYYY-MM-DD。 */
  at: string;
  /** 実施の終了。あればバーになる。 */
  end?: string;
  kind: InjectionMarkKind;
  /** その日の注射オーダー。一覧モーダルと詳細の対象。 */
  srId: string;
  /** ホバーに出す説明。 */
  title: string;
}

export interface InjectionRow {
  /** 薬剤の組 + 用法種別 + 経路。連日オーダーは同じ行に並ぶ。 */
  key: string;
  /** 行ラベル(薬剤名を「・」で連結)。 */
  label: string;
  /** 全文と用法の要約。項目列は幅が狭いので title で読ませる。 */
  title: string;
  marks: InjectionMark[];
}

/** 経過表が注射を組み立てるのに要るリソース一式。 */
export interface FlowsheetInjectionData {
  orders: fhir4.ServiceRequest[];
  medicationRequests: fhir4.MedicationRequest[];
  tasks: fhir4.Task[];
  procedures: fhir4.Procedure[];
  administrations: fhir4.MedicationAdministration[];
}

const MARK_LABELS: Record<InjectionMarkKind, string> = {
  planned: "予定",
  performed: "実施",
  stopped: "途中で中止",
  "not-done": "実施せず",
  cancelled: "中止",
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
function markKindOfProcedure(status: string | undefined): InjectionMarkKind {
  if (status === "stopped") return "stopped";
  if (status === "not-done") return "not-done";
  return "performed";
}

/**
 * 「薬剤の組 × 時系列」の行を組み立てる。
 *
 * 予定は RP の開始時刻(無ければその日)、実施はハブ Procedure の期間。実施は
 * 1 オーダー(その日)の記録なので、そのオーダーのすべての RP 行に付ける
 * (どの薬剤をいつ落としたかまでは MedicationAdministration にしか無く、
 * 経過表の粒度では RP 行に付ければ足りる)。
 */
export function buildInjectionRows(data: FlowsheetInjectionData): InjectionRow[] {
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

  // 新しい日から並べる(列と同じ向き)。同じ行キーは初出の順で上から。
  const sorted = [...orders].sort((a, b) => injectionDayOf(b).localeCompare(injectionDayOf(a)));
  const rows = new Map<string, InjectionRow>();

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
        row.marks.push({
          at,
          end,
          kind: cancelled ? "cancelled" : "planned",
          srId,
          title: [
            `${cancelled ? MARK_LABELS.cancelled : MARK_LABELS.planned} ${flowsheetTimeLabel(at)}${
              end ? `〜${flowsheetTimeLabel(end)}` : ""
            }`,
            label,
            usage,
          ]
            .filter(Boolean)
            .join(" "),
        });
      }

      // 実施。終了が記録されていればバーになる。
      for (const procedure of performs) {
        const start = procedure.performedPeriod?.start ?? procedure.performedDateTime;
        if (!start) continue;
        const kind = markKindOfProcedure(procedure.status);
        row.marks.push({
          at: start,
          end: procedure.performedPeriod?.end,
          kind,
          srId,
          title: [
            `${MARK_LABELS[kind]} ${flowsheetTimeLabel(start)}${
              procedure.performedPeriod?.end ? `〜${flowsheetTimeLabel(procedure.performedPeriod.end)}` : ""
            }`,
            label,
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
    }
  }

  return [...rows.values()].filter((row) => row.marks.length > 0);
}

/** 印の日時を「MM/DD HH:mm」にする。日付だけの値は日付のみ。 */
export function flowsheetTimeLabel(at: string): string {
  const date = localDateOf(at);
  if (!date) return at;
  const shown = date.replace(/^\d{4}-/, "").replace("-", "/");
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return shown;
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return shown;
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  return `${shown} ${hh}:${mm}`;
}

/**
 * 選んだ印と同じ日の注射(そのオーダーの予定・実施すべて)を、
 * イベントの一覧モーダルに渡せる形にする。
 */
export function injectionModalEvents(rows: InjectionRow[], srId: string): FlowsheetEvent[] {
  const events: FlowsheetEvent[] = [];
  for (const row of rows) {
    for (const mark of row.marks) {
      if (mark.srId !== srId) continue;
      events.push({
        at: mark.at,
        kind: "injection",
        label: MARK_LABELS[mark.kind],
        name: MARK_LABELS[mark.kind],
        detail: [row.label, mark.end ? `〜${flowsheetTimeLabel(mark.end)}` : ""]
          .filter(Boolean)
          .join(" "),
        target: { kind: "injection", id: srId },
      });
    }
  }
  // 予定 → 実施の順ではなく、時刻の新しい順(一覧の他の場所と揃える)。
  return events.sort((a, b) => b.at.localeCompare(a.at));
}
