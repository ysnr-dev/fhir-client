import { addDays, dateTimeLabel } from "../lib/dates";
import {
  injectionMedicineLabel,
  injectionRowKeyOf,
  type FlowsheetInjectionData,
} from "./flowsheetInjectionHelpers";
import {
  groupInjectionByRp,
  injectionDayOf,
  injectionSeriesOf,
  injectionTimeLabel,
  injectionUsageSummary,
  isInjectionServiceRequest,
  scheduleLabel,
  type InjectionRpDisplay,
  type InjectionTimeValues,
} from "./injectionHelpers";
import { isInjectionProcedure, scheduledPerformCount } from "./injectionPerformHelpers";
import { ORDER_IN_RP_SYSTEM, RP_NUMBER_SYSTEM, identifierValue } from "./prescriptionHelpers";
import { injectionTaskStatus, injectionTasksByOrderId } from "./injectionTaskHelpers";
import { regimenOrderLabel, regimenOrderOf } from "./regimenOrderHelpers";
import { referenceId } from "./shared";

// 注射カレンダー(カルテ左ペイン「注射カレンダー」タブ)。docs/injection-order-design.md §9。
//
// 「RP × 日付」の表にする。行は経過表の注射欄と同じ行キー(薬剤の組・用法種別・経路)で、
// 別の束ねで出した同じ内容の注射も同じ行に並ぶ。1 マスはその日のその RP で、予定時刻と
// 進捗、実施の時刻、指示と違う量で入れた印、前の日から内容が変わった印を持つ。
//
// 「この日以降すべて」の変更は束ね(requisition)を保ったまま後続日の薬剤を差し替えるので、
// 内容が変わると行が分かれる。同じ束ねから分かれた行は上下に並べ、後の行を字下げして
// 1 本の指示の流れとして読めるようにする。

/** オーダー(その日)全体の進捗。Task の進捗に、実施記録から分かる「一部」「途中中止」「実施せず」を足したもの。 */
export type InjectionCalendarStatus =
  | "requested"
  | "accepted"
  | "in-progress"
  | "partial"
  | "completed"
  | "stopped"
  | "not-done"
  | "cancelled";

/**
 * 施用 1 回ぶんの状態。マスでは予定時刻ごとに記号を 1 つ置く(1 日 2 回なら 2 つ)。
 * 「一部」は記号の並び(● と ○ が混ざる)で読めるので、施用単位には持たない。
 */
export type InjectionSlotStatus = Exclude<InjectionCalendarStatus, "partial">;

/**
 * 記号と凡例の並び。予定側は白抜き(依頼 → 受付 → 払出で形が詰まる)、実施側は塗り、
 * 実施できなかったものは △・×、中止は横線。経過表の注射欄(予定=空丸、実施=塗り丸)と揃える。
 */
export const INJECTION_SLOT_SYMBOLS: { status: InjectionSlotStatus; symbol: string; label: string }[] = [
  { status: "requested", symbol: "○", label: "依頼" },
  { status: "accepted", symbol: "◎", label: "受付" },
  { status: "in-progress", symbol: "◇", label: "払出" },
  { status: "completed", symbol: "●", label: "実施" },
  { status: "stopped", symbol: "△", label: "途中中止" },
  { status: "not-done", symbol: "×", label: "実施せず" },
  { status: "cancelled", symbol: "―", label: "中止" },
];

export function injectionSlotSymbol(status: InjectionSlotStatus): string {
  return INJECTION_SLOT_SYMBOLS.find((item) => item.status === status)?.symbol ?? "";
}

/** マスの施用 1 回。time は予定の開始時刻(時刻の無いオーダーは空)。 */
export interface InjectionCalendarSlot {
  /** 予定の開始時刻。予定を超えた施用・時刻の無いオーダーは空。 */
  time: string;
  status: InjectionSlotStatus;
  /** 実施の開始時刻(HH:mm)。実施記録が付いた回だけ(実施せず は空)。 */
  performedStart: string;
  /** 実施の時間帯(「10:05〜11:30」)。title に出す。 */
  performed: string;
  /** 予定の回数を超えて実施した回。 */
  extra: boolean;
}

/** 1 マスに入る 1 オーダー(その日のその RP)。 */
export interface InjectionCalendarEntry {
  srId: string;
  date: string;
  /** この RP の予定時刻。 */
  times: InjectionTimeValues[];
  status: InjectionCalendarStatus;
  /** 予定時刻ごとの状態。 */
  slots: InjectionCalendarSlot[];
  /** 実施量が指示と違う・入れなかった薬剤・追加した薬剤がある。 */
  doseDiffers: boolean;
  /** 同じ束ねの前の日から内容が変わった。比べた相手は compareSrId。 */
  changed: boolean;
  compareSrId?: string;
  /** 化学療法レジメンの日オーダー(変更・継続はレジメン側で行う)。 */
  regimen: boolean;
  /** マスの title。 */
  title: string;
}

export interface InjectionCalendarRow {
  key: string;
  label: string;
  /** 行見出しに 1 行ずつ出す薬剤名。 */
  medicines: string[];
  /** 用法の要約(行の中で最後の日のもの)。 */
  usage: string;
  /** 束ねの実施パターン(「毎日(9/29〜)」)、またはレジメンの「mFOLFOX6 C2 Day1」。 */
  note: string;
  /** 同じ束ねの前の行から分かれた行。 */
  indent: boolean;
  cells: Map<string, InjectionCalendarEntry[]>;
  /** 行の中で最後の日の、レジメンでないオーダー。継続・中止の起点。 */
  lastOrderId: string;
}

/** 表示期間の日付(start から days 日)。 */
export function calendarDates(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** 実施の時刻。日付は列で分かるので時刻だけ(日をまたぐ終了は日付ごと)。 */
function performedTimeLabel(period: fhir4.Period | undefined): string {
  const start = dateTimeLabel(period?.start);
  if (!start) return "";
  const end = dateTimeLabel(period?.end);
  if (!end) return start.slice(11);
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start.slice(11)}〜${end.slice(11)}`
    : `${start.slice(11)}〜${end.slice(5).replace("-", "/")}`;
}

/** 内容の比較に使う RP の要約。薬剤・量・用法・時刻が同じなら同じ文字列になる。 */
function rpSignature(rp: InjectionRpDisplay): string {
  return JSON.stringify([
    rp.medicines.map((m) => [m.name, m.dose ?? null, m.unit ?? ""]),
    injectionUsageSummary(rp),
    rp.times.map(injectionTimeLabel),
    rp.usageComment ?? "",
  ]);
}

function orderSignature(rps: InjectionRpDisplay[]): string {
  return rps.map(rpSignature).join("|");
}

/** 束ねの実施パターンの短い表示(「毎日(9/29〜)」)。 */
function seriesNote(sr: fhir4.ServiceRequest): string {
  const series = injectionSeriesOf(sr);
  if (!series) return "";
  const [, m, d] = series.start.split("-");
  return `${scheduleLabel(series.schedule)}(${Number(m)}/${Number(d)}〜)`;
}

/**
 * 実施量が指示と違うか(RP ごと)。完了した実施記録だけを見る(途中で中止した施用は
 * 量が違うのが当然なので数えない)。オーダーに無く足した薬剤はどの RP か分からない
 * ので、そのオーダーのすべての RP に付ける。
 */
function doseDiffersByRp(
  mrs: fhir4.MedicationRequest[],
  hubs: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
  rpNumbers: number[],
): Set<number> {
  const result = new Set<number>();
  const completed = hubs.filter((hub) => hub.status === "completed");
  if (completed.length === 0) return result;

  const rpOfMr = new Map<string, number>();
  for (const mr of mrs) {
    if (mr.id) rpOfMr.set(mr.id, Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0"));
  }

  for (const hub of completed) {
    const children = administrations.filter((a) =>
      (a.partOf ?? []).some((r) => referenceId(r.reference) === hub.id),
    );
    if (children.some((a) => !a.request)) rpNumbers.forEach((n) => result.add(n));
    for (const mr of mrs) {
      const rpNumber = mr.id ? rpOfMr.get(mr.id) : undefined;
      if (rpNumber === undefined) continue;
      const given = children.find((a) => referenceId(a.request?.reference) === mr.id);
      const ordered = mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.value;
      if (!given || (ordered != null && given.dosage?.dose?.value !== ordered)) result.add(rpNumber);
    }
  }
  return result;
}

/** 実施記録 1 件ぶんの施用。time は当てた予定の時刻。 */
function performedSlot(time: string, hub: fhir4.Procedure, extra: boolean): InjectionCalendarSlot {
  const status: InjectionSlotStatus =
    hub.status === "stopped" ? "stopped" : hub.status === "not-done" ? "not-done" : "completed";
  const done = hub.status !== "not-done";
  return {
    time,
    status,
    performedStart: done ? dateTimeLabel(hub.performedPeriod?.start).slice(11) : "",
    performed: done ? performedTimeLabel(hub.performedPeriod) : "",
    extra,
  };
}

/**
 * 予定時刻ごとの状態。実施記録は施用の順に予定時刻へ割り当てる(実施記録はどの予定の
 * 回かを持たないので、1 回目の記録を 1 回目の予定に当てる)。記録の無い回はオーダーの進捗。
 * 予定の回数より多い実施記録は、予定を超えた回として後ろに足す(中止した日でも記録は残す)。
 */
function entrySlots(
  times: InjectionTimeValues[],
  task: fhir4.Task | undefined,
  hubs: fhir4.Procedure[],
): InjectionCalendarSlot[] {
  const taskStatus = injectionTaskStatus(task);
  const starts = times.length > 0 ? times.map((time) => time.start) : [""];
  const scheduled = starts.map((time, index): InjectionCalendarSlot => {
    const hub = hubs[index];
    if (hub) return performedSlot(time, hub, false);
    return { time, status: taskStatus, performedStart: "", performed: "", extra: false };
  });
  const extras = hubs.slice(starts.length).map((hub) => performedSlot("", hub, true));
  return [...scheduled, ...extras];
}

function entryStatus(
  task: fhir4.Task | undefined,
  hubs: fhir4.Procedure[],
  scheduled: number,
): InjectionCalendarStatus {
  const taskStatus = injectionTaskStatus(task);
  if (taskStatus === "cancelled") return "cancelled";
  const counted = hubs.filter((hub) => hub.status !== "not-done");
  if (taskStatus === "completed" || counted.length >= scheduled) {
    return counted.some((hub) => hub.status === "stopped") ? "stopped" : "completed";
  }
  if (counted.length > 0) return "partial";
  if (hubs.length > 0) return "not-done";
  return taskStatus;
}

/**
 * 行の並び。行は最初に出てくる日の順。そのうえで、ある行と同じ束ねから分かれた行は
 * その行の直後に置き、字下げする(「水曜から変更」の後の内容が前の内容の下に来る)。
 */
function orderRows(
  rows: InjectionCalendarRow[],
  firstDate: Map<string, string>,
  seriesOfRow: Map<string, Set<string>>,
): InjectionCalendarRow[] {
  const sorted = [...rows].sort(
    (a, b) => (firstDate.get(a.key) ?? "").localeCompare(firstDate.get(b.key) ?? "") || a.label.localeCompare(b.label),
  );
  const placed = new Set<string>();
  const result: InjectionCalendarRow[] = [];
  const place = (row: InjectionCalendarRow, indent: boolean) => {
    placed.add(row.key);
    result.push({ ...row, indent });
    const own = seriesOfRow.get(row.key) ?? new Set<string>();
    for (const other of sorted) {
      if (placed.has(other.key)) continue;
      const shares = [...(seriesOfRow.get(other.key) ?? [])].some((id) => own.has(id));
      if (shares) place(other, true);
    }
  };
  for (const row of sorted) if (!placed.has(row.key)) place(row, false);
  return result;
}

/** 注射カレンダーの行を組み立てる。dates は表示する日付(列)。 */
export function buildInjectionCalendar(
  data: FlowsheetInjectionData,
  dates: string[],
): InjectionCalendarRow[] {
  const inRange = new Set(dates);
  const orders = data.orders
    .filter(isInjectionServiceRequest)
    .filter((sr) => sr.id && inRange.has(injectionDayOf(sr)))
    .sort((a, b) => injectionDayOf(a).localeCompare(injectionDayOf(b)));

  const taskByOrderId = injectionTasksByOrderId(data.tasks);
  const mrsByOrderId = groupBy(data.medicationRequests, (mr) => referenceId(mr.basedOn?.[0]?.reference));
  const hubsByOrderId = groupBy(
    data.procedures.filter((p) => isInjectionProcedure(p) && p.status !== "entered-in-error"),
    (p) => referenceId(p.basedOn?.[0]?.reference),
  );

  // 同じ束ねの前の日と内容を比べる(レジメンの日オーダーは束ねを持たないので比べない)。
  const rpsByOrderId = new Map(
    orders.map((sr) => [sr.id ?? "", groupInjectionByRp(mrsByOrderId.get(sr.id ?? "") ?? [])]),
  );
  const compareByOrderId = new Map<string, string>();
  const bySeries = groupBy(orders, (sr) => injectionSeriesOf(sr)?.requisition);
  for (const list of bySeries.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1].id ?? "";
      const own = list[i].id ?? "";
      if (orderSignature(rpsByOrderId.get(prev) ?? []) !== orderSignature(rpsByOrderId.get(own) ?? [])) {
        compareByOrderId.set(own, prev);
      }
    }
  }

  const rows = new Map<string, InjectionCalendarRow>();
  const firstDate = new Map<string, string>();
  const seriesOfRow = new Map<string, Set<string>>();

  for (const sr of orders) {
    const srId = sr.id ?? "";
    const date = injectionDayOf(sr);
    const mrs = mrsByOrderId.get(srId) ?? [];
    const rps = rpsByOrderId.get(srId) ?? [];
    const hubs = (hubsByOrderId.get(srId) ?? []).sort((a, b) =>
      (a.performedPeriod?.start ?? "").localeCompare(b.performedPeriod?.start ?? ""),
    );
    const status = entryStatus(taskByOrderId.get(srId), hubs, scheduledPerformCount(mrs));
    const differs = doseDiffersByRp(mrs, hubs, data.administrations, rps.map((rp) => rp.rpNumber));
    const regimen = regimenOrderOf(sr) !== null;
    const requisition = injectionSeriesOf(sr)?.requisition;
    const compareSrId = compareByOrderId.get(srId);

    for (const rp of rps) {
      const label = injectionMedicineLabel(rp);
      if (!label) continue;
      const key = injectionRowKeyOf(rp);
      const usage = injectionUsageSummary(rp);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          label,
          medicines: rp.medicines.map((medicine) => medicine.name).filter(Boolean),
          usage,
          note: "",
          indent: false,
          cells: new Map(),
          lastOrderId: "",
        };
        rows.set(key, row);
        firstDate.set(key, date);
      }
      // 見出しの用法・パターンは行の中で最後の日のものにする(日の順に回しているので上書きでよい)。
      row.usage = usage;
      row.note = regimen ? regimenOrderLabel(sr) : seriesNote(sr);
      if (!regimen) row.lastOrderId = srId;
      if (requisition) {
        const set = seriesOfRow.get(key) ?? new Set<string>();
        set.add(requisition);
        seriesOfRow.set(key, set);
      }

      const slots = entrySlots(rp.times, taskByOrderId.get(srId), hubs);
      const slotLabel = (status: InjectionSlotStatus) =>
        INJECTION_SLOT_SYMBOLS.find((item) => item.status === status)?.label ?? "";
      const entry: InjectionCalendarEntry = {
        srId,
        date,
        times: rp.times,
        status,
        slots,
        doseDiffers: differs.has(rp.rpNumber),
        changed: Boolean(compareSrId),
        compareSrId,
        regimen,
        title: [
          label,
          usage,
          ...slots.map((slot, index) =>
            [
              slot.extra ? "予定外" : rp.times[index] ? injectionTimeLabel(rp.times[index]) : "",
              slotLabel(slot.status),
              slot.performed ? `(${slot.performed})` : "",
            ]
              .filter(Boolean)
              .join(" "),
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      };
      const list = row.cells.get(date);
      if (list) list.push(entry);
      else row.cells.set(date, [entry]);
    }
  }

  return orderRows([...rows.values()], firstDate, seriesOfRow);
}

// ---- その日の注射(InjectionDayModal) ----

/** 予定と実施の見比べの 1 行(薬剤 1 件)。 */
export interface InjectionComparisonLine {
  name: string;
  /** 指示量(「1g」)。実施時に足した薬剤は空。 */
  ordered: string;
  /** 実施ごとの量。入れなかった施用は空。列は performs と同じ順。 */
  performed: string[];
}

export interface InjectionComparisonRp {
  rpNumber: number;
  usage: string;
  times: string;
  lines: InjectionComparisonLine[];
}

export interface InjectionComparison {
  rps: InjectionComparisonRp[];
  /** 実施ごとの見出し(「10:05〜11:30」「途中中止 10:05」)。 */
  performs: string[];
  /** 実施ごとの結果(Procedure.status)。量の食い違いは完了した実施だけで見る。 */
  performKinds: string[];
}

function amountLabel(value: number | undefined, unit: string | undefined): string {
  return value == null ? "" : `${value}${unit ?? ""}`;
}

/** その日の注射の予定(指示量)と実施(実施量)を薬剤ごとに並べる。 */
export function injectionComparison(
  mrs: fhir4.MedicationRequest[],
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): InjectionComparison {
  const rps = groupInjectionByRp(mrs);
  const hubs = procedures
    .filter((p) => isInjectionProcedure(p) && p.status !== "entered-in-error")
    .sort((a, b) => (a.performedPeriod?.start ?? "").localeCompare(b.performedPeriod?.start ?? ""));
  const childrenOf = (hub: fhir4.Procedure) =>
    administrations.filter((a) => (a.partOf ?? []).some((r) => referenceId(r.reference) === hub.id));
  const mrIdOf = (rpNumber: number, orderInRp: number) =>
    mrs.find(
      (mr) =>
        Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0") === rpNumber &&
        Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0") === orderInRp,
    )?.id;

  const comparisonRps: InjectionComparisonRp[] = rps.map((rp) => ({
    rpNumber: rp.rpNumber,
    usage: injectionUsageSummary(rp),
    times: rp.times.map(injectionTimeLabel).join("、"),
    lines: rp.medicines.map((med) => {
      const mrId = mrIdOf(rp.rpNumber, med.orderInRp);
      return {
        name: med.name,
        ordered: amountLabel(med.dose, med.unit),
        performed: hubs.map((hub) => {
          const given = childrenOf(hub).find((a) => mrId && referenceId(a.request?.reference) === mrId);
          return given ? amountLabel(given.dosage?.dose?.value, given.dosage?.dose?.unit) : "";
        }),
      };
    }),
  }));

  // 実施時に足した薬剤(request を持たない)は、最後の RP の下に「追加」として並べる。
  const added = new Map<string, InjectionComparisonLine>();
  hubs.forEach((hub, index) => {
    for (const a of childrenOf(hub)) {
      if (a.request) continue;
      const name = a.medicationCodeableConcept?.coding?.[0]?.display ?? a.medicationCodeableConcept?.text ?? "";
      const line = added.get(name) ?? { name: `${name}(追加)`, ordered: "", performed: hubs.map(() => "") };
      line.performed[index] = amountLabel(a.dosage?.dose?.value, a.dosage?.dose?.unit);
      added.set(name, line);
    }
  });
  if (added.size && comparisonRps.length) {
    comparisonRps[comparisonRps.length - 1].lines.push(...added.values());
  }

  return {
    rps: comparisonRps,
    performKinds: hubs.map((hub) => hub.status),
    performs: hubs.map((hub) => {
      const time = performedTimeLabel(hub.performedPeriod);
      if (hub.status === "stopped") return `途中中止 ${time}`;
      if (hub.status === "not-done") return "実施せず";
      return time;
    }),
  };
}

/**
 * 前の日からの変更点(「量: セファゾリン 1g → 2g」の形)。薬剤は名前で突き合わせ、
 * 用法と時刻は RP の番号で突き合わせる。
 */
export function injectionContentDiff(
  previous: fhir4.MedicationRequest[],
  current: fhir4.MedicationRequest[],
): string[] {
  const before = groupInjectionByRp(previous);
  const after = groupInjectionByRp(current);
  const medsOf = (rps: InjectionRpDisplay[]) =>
    new Map(rps.flatMap((rp) => rp.medicines.map((m) => [m.name, amountLabel(m.dose, m.unit)] as const)));
  const beforeMeds = medsOf(before);
  const afterMeds = medsOf(after);
  const lines: string[] = [];

  for (const [name, amount] of afterMeds) {
    if (!beforeMeds.has(name)) lines.push(`追加: ${name} ${amount}`.trim());
    else if (beforeMeds.get(name) !== amount) lines.push(`量: ${name} ${beforeMeds.get(name)} → ${amount}`);
  }
  for (const [name, amount] of beforeMeds) {
    if (!afterMeds.has(name)) lines.push(`削除: ${name} ${amount}`.trim());
  }
  for (const rp of after) {
    const old = before.find((b) => b.rpNumber === rp.rpNumber);
    if (!old) continue;
    const prefix = after.length > 1 ? `RP${rp.rpNumber} ` : "";
    const oldUsage = injectionUsageSummary(old);
    const newUsage = injectionUsageSummary(rp);
    if (oldUsage !== newUsage) lines.push(`${prefix}用法: ${oldUsage || "なし"} → ${newUsage || "なし"}`);
    const oldTimes = old.times.map(injectionTimeLabel).join("、");
    const newTimes = rp.times.map(injectionTimeLabel).join("、");
    if (oldTimes !== newTimes) lines.push(`${prefix}時刻: ${oldTimes || "なし"} → ${newTimes || "なし"}`);
    if ((old.usageComment ?? "") !== (rp.usageComment ?? "")) {
      lines.push(`${prefix}用法コメント: ${old.usageComment || "なし"} → ${rp.usageComment || "なし"}`);
    }
  }
  return lines;
}
