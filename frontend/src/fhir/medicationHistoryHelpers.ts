import type { MedicationHistoryKind, MedicationHistorySetting, KarteDetailTarget } from "../karteUrl";
import { addDays } from "../lib/dates";
import {
  BROUGHT_STATE_LABELS,
  summarizeBroughtMedication,
  type BroughtState,
} from "./broughtMedicationHelpers";
import {
  activeOrders,
  medicationRequestsByOrderId,
  type ChartMedicationOrders,
  type ChartRange,
} from "./chartDefinitionHelpers";
import { groupInjectionByRp } from "./injectionHelpers";
import { isAsNeededUsage, isOralUsage } from "./medicationScheduleHelpers";
import {
  PRESCRIPTION_CATEGORY_SYSTEM,
  SETTING_SYSTEM,
  groupByRp,
  hasDoseDays,
} from "./prescriptionHelpers";
import { categoryCoding, orderDay } from "./shared";

// 投薬歴。処方・注射・持参薬を「薬剤(銘柄・規格ごと)× 列(日・月)」の表にする。
//
// 内服と持参薬は飲んでいた日すべてに 1 日量を置く(日の列を埋める)。頓用・外用・注射は
// 期間を持たないので、出した日(施行日)だけに置く。月の列はその月の日をまとめたもの。

export const MEDICATION_HISTORY_KINDS: MedicationHistoryKind[] = [
  "oral",
  "external",
  "prn",
  "injection",
  "brought",
];

export const MEDICATION_HISTORY_KIND_LABELS: Record<MedicationHistoryKind, string> = {
  oral: "内服",
  external: "外用",
  prn: "頓用",
  injection: "注射",
  brought: "持参薬",
};

/** 日に置く 1 件。同じ行・同じ日の値は 1 つ(内服は後の処方が勝ち、注射は足し上げる)。 */
interface DayEntry {
  amount: number;
  unit: string;
  /** セルに出す字(単位は行の単位列に出すので持たない。「3」「1×10回」)。 */
  value: string;
  /** 単位付きの字(「3錠」)。行の単位と違う日のセルとツールチップに使う。 */
  text: string;
  detail: string;
  target?: KarteDetailTarget;
}

export type MedicationHistoryChange = "increase" | "decrease" | "change";

export interface MedicationHistoryCell {
  text: string;
  /** 列の中(日の列なら前の日から)で用量が変わった。 */
  change?: MedicationHistoryChange;
  /** 月の列で、その月の一部の日だけ。 */
  partial?: boolean;
  tooltip: string;
  target?: KarteDetailTarget;
}

export interface MedicationHistoryRow {
  key: string;
  name: string;
  /** 行の単位(いちばん多く使われたもの)。セルはこの単位の数値だけを出す。 */
  unit: string;
  /** 持参薬の状態(継続・休止など)。 */
  badge?: string;
  badgeState?: BroughtState;
  /** 列の start → セル。 */
  cells: Map<string, MedicationHistoryCell>;
}

export interface MedicationHistorySection {
  kind: MedicationHistoryKind;
  rows: MedicationHistoryRow[];
}

interface RowDraft {
  key: string;
  name: string;
  sortKey: string;
  /** 日を埋める(内服・持参薬)か、出した日だけか。 */
  daily: boolean;
  days: Map<string, DayEntry>;
  badgeState?: BroughtState;
}

function formatAmount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "").normalize("NFKC");
}

/** 薬効分類(YJ・一般名処方コードの先頭 4 桁)→ 名前の順に並べる。コードが無ければ後ろ。 */
const NO_CLASS = "9999|";

/** 用量の入っていない投与の印。 */
const UNKNOWN_DOSE = "○";

function sortKeyOf(yjLike: string | undefined, name: string): string {
  const head = yjLike && /^\d{4}/.test(yjLike) ? yjLike.slice(0, 4) : "9999";
  return `${head}|${name}`;
}

function draftOf(
  drafts: Map<string, RowDraft>,
  key: string,
  init: () => Omit<RowDraft, "key" | "days">,
): RowDraft {
  const fresh = init();
  let draft = drafts.get(key);
  if (!draft) {
    draft = { key, days: new Map(), ...fresh };
    drafts.set(key, draft);
  } else if (draft.sortKey.startsWith(NO_CLASS) && !fresh.sortKey.startsWith(NO_CLASS)) {
    // 同じ薬品コードでも YJ コードを持たない行があるので、持つものが出てきたら並び順を取り直す。
    draft.sortKey = fresh.sortKey;
  }
  return draft;
}

function settingOf(order: fhir4.ServiceRequest): string {
  return categoryCoding(order, SETTING_SYSTEM)?.code ?? "";
}

function orderLabel(order: fhir4.ServiceRequest): string {
  return [
    categoryCoding(order, SETTING_SYSTEM)?.display,
    categoryCoding(order, PRESCRIPTION_CATEGORY_SYSTEM)?.display,
  ]
    .filter(Boolean)
    .join("・");
}

function formatDay(day: string): string {
  return day.replaceAll("-", "/");
}

/** 処方を内服・外用・頓用の行に振り分けて、日ごとの量を置く。 */
function collectPrescriptions(
  data: ChartMedicationOrders,
  setting: MedicationHistorySetting | undefined,
  drafts: Record<"oral" | "external" | "prn", Map<string, RowDraft>>,
) {
  const byOrderId = medicationRequestsByOrderId(data.medicationRequests);
  // 同じ日に重なる内服は後から始まった処方が勝つ(前の処方の残りを置き換えた、とみなす)。
  const orders = activeOrders(data.orders, data.tasks)
    .filter((order) => !setting || settingOf(order) === setting)
    .sort(
      (a, b) =>
        orderDay(a).localeCompare(orderDay(b)) || (a.authoredOn ?? "").localeCompare(b.authoredOn ?? ""),
    );

  for (const order of orders) {
    const id = order.id ?? "";
    const start = orderDay(order);
    if (!start) continue;
    const target: KarteDetailTarget | undefined = id ? { kind: "prescription", id } : undefined;
    const label = orderLabel(order);
    // 内服は同じ処方の中の RP をまたいで 1 日量を足し上げる(朝と夕で RP を分けた処方)。
    const oral = new Map<
      string,
      { name: string; sortKey: string; amount: number; unit: string; days: number; usages: string[] }
    >();

    for (const group of groupByRp(byOrderId.get(id) ?? [])) {
      const continuous = hasDoseDays(group.usageCode, group.basicCategory) && (group.doseDays ?? 0) > 0;
      const prn = !continuous && isAsNeededUsage(group.usageCode);
      for (const line of group.medicines) {
        const key = line.code || line.name;
        const unit = normalizeUnit(line.unit);
        const dose = line.dose ?? 0;
        const sortKey = sortKeyOf(line.yjCode ?? (line.generic ? line.code : undefined), line.name);
        if (continuous) {
          const current = oral.get(key);
          const usage = [group.usageName, line.unevenLabel].filter(Boolean).join(" ");
          if (current) {
            current.amount += dose;
            current.days = Math.max(current.days, group.doseDays ?? 0);
            if (usage) current.usages.push(usage);
          } else {
            oral.set(key, {
              name: line.name,
              sortKey,
              amount: dose,
              unit,
              days: group.doseDays ?? 0,
              usages: usage ? [usage] : [],
            });
          }
          continue;
        }
        const kind = prn ? "prn" : "external";
        const count = prn ? group.doseCount : undefined;
        const times = count ? `×${count}回` : "";
        const value = `${formatAmount(dose)}${times}`;
        const text = `${formatAmount(dose)}${unit}${times}`;
        const draft = draftOf(drafts[kind], key, () => ({ name: line.name, sortKey, daily: false }));
        const previous = draft.days.get(start);
        const amount = dose * (count ?? 1);
        draft.days.set(start, {
          amount: (previous?.amount ?? 0) + amount,
          unit,
          value: previous ? `${previous.value}+${value}` : value,
          text: previous ? `${previous.text}+${text}` : text,
          detail: [
            previous?.detail,
            [formatDay(start), line.name, text, group.usageName, label].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join("\n"),
          target,
        });
      }
    }

    for (const [key, entry] of oral) {
      const draft = draftOf(drafts.oral, key, () => ({
        name: entry.name,
        sortKey: entry.sortKey,
        daily: true,
      }));
      const end = addDays(start, entry.days - 1);
      const value = formatAmount(entry.amount);
      const text = `${value}${entry.unit}`;
      const detail = [
        `${formatDay(start)}〜${formatDay(end)}(${entry.days}日分)`,
        entry.name,
        `1日 ${text}`,
        entry.usages.join("・"),
        label,
      ]
        .filter(Boolean)
        .join(" ");
      for (let i = 0; i < entry.days; i += 1) {
        draft.days.set(addDays(start, i), { amount: entry.amount, unit: entry.unit, value, text, detail, target });
      }
    }
  }
}

/** 注射は 1 日 1 オーダー。同じ日に複数のオーダー(朝・夕)があれば足し上げる。 */
function collectInjections(
  data: ChartMedicationOrders,
  setting: MedicationHistorySetting | undefined,
  drafts: Map<string, RowDraft>,
) {
  const byOrderId = medicationRequestsByOrderId(data.medicationRequests);
  const orders = activeOrders(data.orders, data.tasks).filter(
    (order) => !setting || settingOf(order) === setting,
  );
  for (const order of orders) {
    const id = order.id ?? "";
    const day = orderDay(order);
    if (!day) continue;
    const target: KarteDetailTarget | undefined = id ? { kind: "injection", id } : undefined;
    for (const group of groupInjectionByRp(byOrderId.get(id) ?? [])) {
      const usage = [group.usageTypeDisplay, group.routeDisplay].filter(Boolean).join(" ");
      for (const line of group.medicines) {
        const key = line.code || line.name;
        const unit = normalizeUnit(line.unit);
        const dose = line.dose ?? 0;
        const draft = draftOf(drafts, key, () => ({
          name: line.name,
          sortKey: sortKeyOf(line.yjCode, line.name),
          daily: false,
        }));
        const previous = draft.days.get(day);
        const amount = (previous?.amount ?? 0) + dose;
        draft.days.set(day, {
          amount,
          unit,
          value: formatAmount(amount),
          text: `${formatAmount(amount)}${unit}`,
          detail: [
            previous?.detail,
            [formatDay(day), line.name, `${formatAmount(dose)}${unit}`, usage].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join("\n"),
          // 同じ日に複数あるときは後のオーダーを開く(どちらも同じ日の注射なので足りる)。
          target,
        });
      }
    }
  }
}

/**
 * 持参薬。持参日から、判断(休止・中止)の日まで、継続なら切り替えた処方の開始前日まで、
 * 判断待ちなら今日まで飲んでいたとみなす。服用していない・誤登録は出さない。
 */
function collectBrought(
  statements: fhir4.MedicationStatement[],
  prescriptions: ChartMedicationOrders | undefined,
  todayDate: string,
  drafts: Map<string, RowDraft>,
) {
  const orderStart = new Map(
    (prescriptions?.orders ?? []).map((order) => [order.id ?? "", orderDay(order)] as const),
  );
  const summaries = statements
    .map(summarizeBroughtMedication)
    .filter((summary) => summary.state !== "not-taken" && summary.state !== "entered-in-error")
    .sort((a, b) => (a.assertedAt ?? "").localeCompare(b.assertedAt ?? ""));

  for (const summary of summaries) {
    const start = summary.assertedAt?.slice(0, 10);
    if (!start) continue;
    const decided = summary.decidedAt?.slice(0, 10);
    const converted = summary.convertedOrderId ? orderStart.get(summary.convertedOrderId) : undefined;
    let end: string;
    if (summary.state === "unidentified" || summary.state === "undecided") end = todayDate;
    else if (summary.state === "continued") end = converted ? addDays(converted, -1) : (decided ?? todayDate);
    else end = decided ?? todayDate;
    if (end < start) end = start;

    const medicine = summary.medicine;
    const key = medicine?.medicine_code || summary.name;
    const unit = normalizeUnit(summary.unit);
    const dose = summary.dose ?? 0;
    // 鑑別前の持参薬は用量が入っていないことがある。飲んでいた日だけは分かるように印を置く。
    const value = summary.dose === undefined ? UNKNOWN_DOSE : formatAmount(dose);
    const text = summary.dose === undefined ? UNKNOWN_DOSE : `${value}${unit}`;
    const daily = isOralUsage(summary.usageCode) && !isAsNeededUsage(summary.usageCode);
    const draft = draftOf(drafts, key, () => ({
      name: summary.name,
      sortKey: sortKeyOf(medicine?.yj_code ?? (medicine?.generic ? medicine.medicine_code : undefined), summary.name),
      daily,
    }));
    // 行の状態は後から持参したもの(並べ替え済み)で上書きする。
    draft.badgeState = summary.state;
    const detail = [
      `持参 ${formatDay(start)}〜${daily ? formatDay(end) : ""}`,
      summary.name,
      daily ? `1日 ${text}` : text,
      summary.usageName,
      BROUGHT_STATE_LABELS[summary.state],
    ]
      .filter(Boolean)
      .join(" ");
    const entry: DayEntry = { amount: dose, unit, value, text, detail };
    if (!daily) {
      draft.days.set(start, entry);
      continue;
    }
    for (let day = start; day <= end; day = addDays(day, 1)) draft.days.set(day, entry);
  }
}

function changeOf(before: DayEntry, after: DayEntry): MedicationHistoryChange | undefined {
  if (before.amount === after.amount && before.unit === after.unit) return undefined;
  if (before.unit !== after.unit) return "change";
  return after.amount > before.amount ? "increase" : "decrease";
}

function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** 行の単位。日数の多い単位を選ぶ(同じ薬品コードなら普通は 1 つ)。 */
function rowUnitOf(draft: RowDraft): string {
  const counts = new Map<string, number>();
  for (const entry of draft.days.values()) {
    if (entry.value === UNKNOWN_DOSE) continue;
    counts.set(entry.unit, (counts.get(entry.unit) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** 列の中の日を 1 つのセルにまとめる。 */
function cellOf(draft: RowDraft, unit: string, start: string, end: string): MedicationHistoryCell | null {
  // 行の単位と違う日だけは、取り違えないよう単位を付けて出す。
  const shown = (entry: DayEntry) =>
    entry.unit === unit || entry.value === UNKNOWN_DOSE ? entry.value : entry.text;
  const days = daysBetween(start, end);
  const entries = days
    .map((day) => ({ day, entry: draft.days.get(day) }))
    .filter((item): item is { day: string; entry: DayEntry } => Boolean(item.entry));
  if (entries.length === 0) return null;

  const first = entries[0].entry;
  const last = entries[entries.length - 1].entry;
  const tooltip = [...new Set(entries.map((item) => item.entry.detail))].join("\n");
  const target = last.target;

  if (!draft.daily) {
    // 出した日だけの行。月の列に複数あれば回数でまとめる。
    return entries.length === 1
      ? { text: shown(first), tooltip, target }
      : { text: `${entries.length}回`, tooltip, target };
  }

  // 日を埋める行。用量の変わり目は、前の日(列の外も含む)と比べて拾う。
  let change: MedicationHistoryChange | undefined;
  let before: DayEntry | undefined;
  let after: DayEntry | undefined;
  for (const { day, entry } of entries) {
    const previous = draft.days.get(addDays(day, -1));
    if (!previous || !changeOf(previous, entry)) continue;
    before ??= previous;
    after = entry;
  }
  if (before && after) change = changeOf(before, after) ?? "change";

  const distinct = entries
    .map((item) => item.entry)
    .filter((entry, index, list) => index === 0 || changeOf(list[index - 1], entry));
  const text = distinct.length > 1 ? `${shown(first)}→${shown(last)}` : shown(first);
  return {
    text,
    tooltip,
    target,
    ...(change ? { change } : {}),
    ...(entries.length < days.length ? { partial: true } : {}),
  };
}

export function buildMedicationHistory(input: {
  prescriptions: ChartMedicationOrders | undefined;
  injections: ChartMedicationOrders | undefined;
  brought: fhir4.MedicationStatement[];
  range: ChartRange;
  setting?: MedicationHistorySetting;
  hidden?: readonly MedicationHistoryKind[];
  today: string;
}): MedicationHistorySection[] {
  const drafts: Record<MedicationHistoryKind, Map<string, RowDraft>> = {
    oral: new Map(),
    external: new Map(),
    prn: new Map(),
    injection: new Map(),
    brought: new Map(),
  };
  if (input.prescriptions) collectPrescriptions(input.prescriptions, input.setting, drafts);
  if (input.injections) collectInjections(input.injections, input.setting, drafts.injection);
  // 持参薬は入院で持ち込むものなので、外来に絞っているときは出さない。
  if (input.setting !== "outpatient") {
    collectBrought(input.brought, input.prescriptions, input.today, drafts.brought);
  }

  const hidden = new Set(input.hidden ?? []);
  return MEDICATION_HISTORY_KINDS.filter((kind) => !hidden.has(kind))
    .map((kind) => {
      const rows = [...drafts[kind].values()]
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"))
        .map((draft): MedicationHistoryRow | null => {
          const unit = rowUnitOf(draft);
          const cells = new Map<string, MedicationHistoryCell>();
          for (const column of input.range.columns) {
            const cell = cellOf(draft, unit, column.start, column.end);
            if (cell) cells.set(column.start, cell);
          }
          if (cells.size === 0) return null;
          return {
            key: draft.key,
            name: draft.name,
            unit,
            cells,
            ...(draft.badgeState
              ? { badge: BROUGHT_STATE_LABELS[draft.badgeState], badgeState: draft.badgeState }
              : {}),
          };
        })
        .filter((row): row is MedicationHistoryRow => row !== null);
      return { kind, rows };
    })
    .filter((section) => section.rows.length > 0);
}
