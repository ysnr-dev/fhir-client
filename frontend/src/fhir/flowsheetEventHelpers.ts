import type { KarteDetailTarget } from "../karteUrl";
import type { EncounterEvent } from "./encounterHelpers";

// 経過表(温度板)のイベントの帯と、病日・術後日数。
//
// 紙の温度板は、バイタルの折れ線の上に「入院」「手術」などのイベントを縦線で入れ、
// 日付の下に病日を書く。同じ画面で「いつ入院して、今が術後何日目か」を読むための
// 情報なので、経過表にも同じものを載せる。
//
// 経過表の列は「測定 1 回」で等間隔(FLOWSHEET_COLUMN_WIDTH)であり、時間に比例
// しない。イベントは測定と同時刻とは限らないので、**列の中央ではなく列の境目**に置く
// (中央に置くと、その測定のときに起きたイベントに見えてしまう)。表示数が少ないと
// 同じ境目に何件も集まるので、境目ごとにまとめて縦に積む。

/**
 * イベントの種類。色分けにだけ使う。
 * `injection` は帯には出さず、注射欄の一覧モーダル(flowsheetInjectionHelpers)でのみ使う。
 */
export type FlowsheetEventKind = "encounter" | "surgery" | "exam" | "injection";

export interface FlowsheetEvent {
  /** イベントの日時。時刻を持たない登録では YYYY-MM-DD。 */
  at: string;
  kind: FlowsheetEventKind;
  /** 帯に出す短い名前(入院・転棟・手術・放射線 など)。列幅に収まる長さにする。 */
  label: string;
  /** 一覧に出す名前(放射線検査 など)。帯より詳しくてよい。 */
  name: string;
  /** 補足(病棟名・術式名・外出泊の理由など)。無ければ空。 */
  detail: string;
  /**
   * カルテのオーダー詳細モーダルを開く先。手術と検査オーダーだけが持ち、
   * 入退院(Encounter)はカルテのカードにならないので持たない。
   */
  target?: KarteDetailTarget;
}

/** 1 回の入院。病日を数えるのに使う。end は退院済みのときだけ。 */
export interface EncounterStay {
  /** 入院日(YYYY-MM-DD)。 */
  start: string;
  /** 退院日(YYYY-MM-DD)。入院中なら undefined。 */
  end?: string;
}

/**
 * 経過表に出す検査オーダーの種別。患者が動く検査だけを出す(検体系は出さない)。
 * `label` は帯(列幅 64px)に収まる短縮、`name` は一覧に出す正式名、
 * `detailKind` はカルテのオーダー詳細モーダルの種別。
 */
export const FLOWSHEET_EXAM_TYPES = [
  { code: "rad", label: "放射線", name: "放射線検査", detailKind: "rad-order" },
  { code: "endoscopy", label: "内視鏡", name: "内視鏡", detailKind: "endoscopy-order" },
  { code: "physio", label: "生理", name: "生理検査", detailKind: "physio-order" },
] as const;

const DAY_MS = 86_400_000;
/** 術後日数を出す上限。これを超えたら「前回の手術」ではなく既往なので出さない。 */
const POST_OP_DAY_LIMIT = 90;

/**
 * 日時 → epoch(ms)。日付だけの値(YYYY-MM-DD)は端末ローカルの 0 時として読む。
 * `new Date("2026-08-22")` は仕様上 UTC 0 時なので、そのまま使うと時差のぶんだけ
 * イベントが別の列にずれる。
 */
function epochOf(value: string): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** 日時 → 端末ローカルの YYYY-MM-DD。日付だけの値はそのまま。 */
export function localDateOf(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** 日付の差(日数)。どちらもローカルの 0 時として数えるので、夏時間でもずれない。 */
function diffDays(from: string, to: string): number {
  return Math.round((epochOf(to) - epochOf(from)) / DAY_MS);
}

/**
 * イベントが入る列の境目。columns は測定日時の新しい順。
 *
 * 「at 以上の列の数」を返す。0 なら左端(いちばん新しい測定より後に起きた)、
 * columns.length なら右端(いちばん古い測定より前)。i なら列 i-1(新しい側)と
 * 列 i(古い側)の間。
 */
export function flowsheetEventSlot(columns: string[], at: string): number {
  const target = epochOf(at);
  let slot = 0;
  for (const column of columns) {
    // 新しい順なので、1 つでも at より古い列が出たらそれ以降もすべて古い。
    if (epochOf(column) < target) break;
    slot += 1;
  }
  return slot;
}

/** 帯に 1 行として出すラベル。 */
export interface FlowsheetEventLabel {
  kind: FlowsheetEventKind;
  text: string;
}

/** 同じ境目に入るイベントをまとめたもの。 */
export interface FlowsheetEventGroup {
  slot: number;
  /** その境目のイベントすべて。title に出す(新しい順)。 */
  events: FlowsheetEvent[];
  /** 帯に積むラベル。重い順(手術 → 入退院 → 検査)で、同じ名前の検査はまとめる。 */
  labels: FlowsheetEventLabel[];
}

/** 手術・入退院・検査の順に並べる(境目に積むとき、重いイベントを上にする)。 */
const KIND_ORDER: FlowsheetEventKind[] = ["surgery", "encounter", "exam"];

/**
 * イベントを列の境目ごとにまとめる。境目は左(新しい)から順。
 *
 * 表示数が少ないと 1 つの境目に何日ぶんも集まるので、ラベルは重い順に並べ替え、
 * 同じ名前の検査(日をまたいだ「放射線」など)は 1 行にまとめて件数を足す
 * (「放射線×3」が 3 行並んでも読めないため)。日ごとの内訳は title に残る。
 */
export function groupFlowsheetEvents(
  columns: string[],
  events: FlowsheetEvent[],
): FlowsheetEventGroup[] {
  const bySlot = new Map<number, FlowsheetEvent[]>();
  for (const event of events) {
    const slot = flowsheetEventSlot(columns, event.at);
    const list = bySlot.get(slot);
    if (list) list.push(event);
    else bySlot.set(slot, [event]);
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, list]) => {
      const ordered = [...list].sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || epochOf(b.at) - epochOf(a.at),
      );
      const merged = new Map<string, { kind: FlowsheetEventKind; label: string; count: number }>();
      for (const event of ordered) {
        const key = `${event.kind}/${event.label}`;
        const existing = merged.get(key);
        if (existing) existing.count += 1;
        else merged.set(key, { kind: event.kind, label: event.label, count: 1 });
      }
      return {
        slot,
        events: ordered,
        labels: [...merged.values()].map(({ kind, label, count }) => ({
          kind,
          text: count > 1 ? `${label}×${count}` : label,
        })),
      };
    });
}

/**
 * 帯に出すイベントを組み立てる。
 *
 * - 入退院・転棟・外出泊は `encounterEvents`(encounterHelpers)の結果をそのまま使う。
 * - 手術は実施記録のハブ Procedure。入室時刻(`performedPeriod.start`)に置く。
 * - 検査は放射線・内視鏡・生理のオーダー。ヘッダの `ServiceRequest` は `code` を
 *   持たない(検査名は明細側)ので、名前は種別名だけになる。
 * - 未来のイベント(予定の検査)は出さない。経過表は起きたことを読む画面なので。
 *
 * **1 オーダー = 1 件のまま返す**。帯では `groupFlowsheetEvents` が同じ種類を
 * 「放射線×7」にまとめるが、一覧モーダルは 1 件ずつ出してオーダーの詳細へ飛ばすため。
 */
export function buildFlowsheetEvents(
  encounterEvents: EncounterEvent[],
  surgeries: fhir4.Procedure[],
  examOrders: { headers: fhir4.ServiceRequest[]; items: fhir4.ServiceRequest[] },
  now: Date = new Date(),
): FlowsheetEvent[] {
  const limit = now.getTime();
  const events: FlowsheetEvent[] = [];

  for (const event of encounterEvents) {
    if (!event.at) continue;
    events.push({
      at: event.at,
      kind: "encounter",
      label: event.label,
      name: event.label,
      detail: event.detail,
    });
  }

  for (const surgery of surgeries) {
    const at = surgery.performedPeriod?.start ?? surgery.performedDateTime;
    if (!at) continue;
    const coding = surgery.code?.coding?.find((c) => c.display) ?? surgery.code?.coding?.[0];
    const orderId = surgery.basedOn?.[0]?.reference?.split("/")[1] ?? "";
    events.push({
      at,
      kind: "surgery",
      label: "手術",
      name: "手術",
      detail: surgery.code?.text ?? coding?.display ?? "",
      target: orderId ? { kind: "surgery-order", id: orderId } : undefined,
    });
  }

  // 明細をヘッダ id で束ねる。ヘッダ → 明細 → セットの構成項目まであるので、
  // 直下だけでなく孫も同じヘッダに寄せる。
  const itemsByHeader = new Map<string, fhir4.ServiceRequest[]>();
  const headerOfItem = new Map<string, string>();
  const headerIds = new Set(examOrders.headers.map((header) => header.id ?? ""));
  for (let depth = 0; depth < 2; depth += 1) {
    for (const item of examOrders.items) {
      if (!item.id || headerOfItem.has(item.id)) continue;
      const parent = item.basedOn?.[0]?.reference?.split("/")[1] ?? "";
      const header = headerIds.has(parent) ? parent : headerOfItem.get(parent);
      if (!header) continue;
      headerOfItem.set(item.id, header);
      const list = itemsByHeader.get(header);
      if (list) list.push(item);
      else itemsByHeader.set(header, [item]);
    }
  }

  for (const order of examOrders.headers) {
    const at = order.occurrenceDateTime;
    if (!at) continue;
    const type = FLOWSHEET_EXAM_TYPES.find((candidate) =>
      (order.category ?? []).some((category) =>
        category.coding?.some((coding) => coding.code === candidate.code),
      ),
    );
    if (!type) continue;
    const names = (itemsByHeader.get(order.id ?? "") ?? [])
      .map((item) => item.code?.text ?? item.code?.coding?.[0]?.display ?? "")
      .filter(Boolean);
    events.push({
      at,
      kind: "exam",
      label: type.label,
      name: type.name,
      // 検査名は明細にある(ヘッダは code を持たない)。セットは構成項目まで並ぶ。
      detail: [...new Set(names)].join("、"),
      target: order.id ? { kind: type.detailKind, id: order.id } : undefined,
    });
  }

  return events
    .filter((event) => epochOf(event.at) <= limit)
    .sort(
      (a, b) =>
        epochOf(b.at) - epochOf(a.at) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
}

/** 入院中の Encounter から、病日を数えるための入院期間を取り出す。 */
export function encounterStays(encounters: fhir4.Encounter[]): EncounterStay[] {
  const stays: EncounterStay[] = [];
  for (const encounter of encounters) {
    const start = encounter.period?.start?.slice(0, 10);
    if (!start) continue;
    stays.push({ start, end: encounter.period?.end?.slice(0, 10) });
  }
  return stays.sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * その日が入院何日目か。入院日を 1 日目と数える(日本の慣例)。
 * 入院前・退院後の日は undefined(その列には病日を出さない)。
 */
export function hospitalDayOf(date: string, stays: EncounterStay[]): number | undefined {
  if (!date) return undefined;
  const stay = stays.find((candidate) => candidate.start <= date && (!candidate.end || date <= candidate.end));
  return stay ? diffDays(stay.start, date) + 1 : undefined;
}

/**
 * その日が術後何日目か。手術当日を 0 とする(表示は「当日」)。
 * その日以前でいちばん新しい手術を見る。90 日を超えたら既往なので出さない。
 */
export function postOpDayOf(date: string, surgeryDates: string[]): number | undefined {
  if (!date) return undefined;
  const latest = surgeryDates.filter((surgery) => surgery <= date).sort().pop();
  if (!latest) return undefined;
  const days = diffDays(latest, date);
  return days <= POST_OP_DAY_LIMIT ? days : undefined;
}

/** 病日・術後日数のセルに出す文字。 */
export function hospitalDayLabel(day: number | undefined): string {
  return day === undefined ? "" : `${day}`;
}

export function postOpDayLabel(day: number | undefined): string {
  if (day === undefined) return "";
  return day === 0 ? "当日" : `${day}`;
}

/** イベントの日時。時刻を持たない登録(検査オーダー・入院日など)は日付だけ出す。 */
export function flowsheetEventAtLabel(at: string): string {
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

/** 一覧モーダルの見出しに出す期間。同じ日に収まっていれば 1 つだけ出す。 */
export function flowsheetEventRangeLabel(events: FlowsheetEvent[]): string {
  const dates = events.map((event) => localDateOf(event.at)).filter(Boolean).sort();
  if (dates.length === 0) return "";
  const from = dates[0].replace(/^\d{4}-/, "").replace("-", "/");
  const to = dates[dates.length - 1].replace(/^\d{4}-/, "").replace("-", "/");
  return from === to ? from : `${from} 〜 ${to}`;
}
