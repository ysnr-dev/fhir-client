import type { KarteDetailTarget } from "../karteUrl";
import type { EncounterEvent } from "./encounterHelpers";

// 経過表(温度板)のイベントの帯・検査の行と、病日・術後日数。
//
// 紙の温度板は、バイタルの折れ線の上に「入院」「手術」などのイベントを縦線で入れ、
// 日付の下に病日を書く。同じ画面で「いつ入院して、今が術後何日目か」を読むための
// 情報なので、経過表にも同じものを載せる。
//
// 経過表の横軸は「基準日から 1 週間」で、1 日の中は測定ごとに列が分かれる(測定の
// 無い日も 1 列は置く)。イベント・検査・注射の印は**その日の列のまとまりの中央**に置く
// (1 日の中の位置は測定の並びで決まり時間に比例しないため、時刻で細かく置いても
// 読み違える。時刻は title と一覧モーダルで見せる)。

/** イベントの種類。色分けにだけ使う。`injection` / `exam` は一覧モーダルの行でのみ使う。 */
export type FlowsheetEventKind =
  | "encounter"
  | "surgery"
  | "exam"
  | "injection"
  | "oral"
  | "nursing";

export interface FlowsheetEvent {
  /** イベントの日時。時刻を持たない登録では YYYY-MM-DD。 */
  at: string;
  kind: FlowsheetEventKind;
  /** 帯に出す短い名前(入院・転棟・手術 など)。列幅に収まる長さにする。 */
  label: string;
  /** 一覧に出す名前(放射線検査 など)。帯より詳しくてよい。 */
  name: string;
  /** 補足(病棟名・術式名・外出泊の理由など)。無ければ空。 */
  detail: string;
  /**
   * カルテのオーダー詳細モーダルを開く先。手術・検査・注射のオーダーだけが持ち、
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
 * `label` は行の見出し、`detailKind` はカルテのオーダー詳細モーダルの種別。
 */
export const FLOWSHEET_EXAM_TYPES = [
  { code: "rad", label: "放射線検査", detailKind: "rad-order" },
  { code: "endoscopy", label: "内視鏡", detailKind: "endoscopy-order" },
  { code: "physio", label: "生理検査", detailKind: "physio-order" },
] as const;

/** 検査の印に添える状態。予定は無印(オーダーがあるだけ)。 */
const EXAM_STATE_LABELS: Partial<Record<FlowsheetMarkKind, string>> = {
  performed: "実施済",
  stopped: "途中で中止",
  "not-done": "実施せず",
};

// ---- 印の行(注射・検査で共用) ----

/**
 * 印の種類。色と形で状態を出す。注射と検査で共用する
 * (`planned` = 予定、`performed` = 実施、`stopped` / `not-done` = 途中で中止・実施せず、
 * `cancelled` = オーダーごと中止)。
 */
export type FlowsheetMarkKind = "planned" | "performed" | "stopped" | "not-done" | "cancelled";

export interface FlowsheetMark {
  /** 開始(ローカルの日時文字列)。時刻の無いものは YYYY-MM-DD。 */
  at: string;
  /** 終了。あればバーになる。 */
  end?: string;
  kind: FlowsheetMarkKind;
  /** 一覧モーダルでまとめる単位(注射ならその日のオーダー、検査ならオーダー)。 */
  groupId: string;
  /** ホバーに出す説明。 */
  title: string;
  /** 一覧モーダルに出す 1 行。 */
  event: FlowsheetEvent;
}

export interface FlowsheetMarkRow {
  key: string;
  /** 行ラベル。 */
  label: string;
  /** 全文など。項目列は幅が狭いので title で読ませる。 */
  title: string;
  marks: FlowsheetMark[];
}

/** 印を一覧で示すときの並び順のキー。押した 1 件を突き止めるのにも使う。 */
export function markKey(mark: FlowsheetMark): string {
  return `${mark.groupId}/${mark.at}/${mark.kind}`;
}

/**
 * 選んだ印と同じまとまりの印を、一覧モーダルに渡せる形にする(時刻の古い順。
 * 表の左→右と同じ向き)。押した印が一覧の何番目かも返す。
 */
export function markModalEvents(
  rows: FlowsheetMarkRow[],
  groupId: string,
  selectedKey?: string,
): { events: FlowsheetEvent[]; highlightIndex: number; selected?: FlowsheetMark } {
  const marks: FlowsheetMark[] = [];
  // 1 件の実施記録はオーダーのすべての行(薬剤の組ごと)に印が付くので、行を跨いで
  // 同じ内容の印が集まる。一覧では同じ内容を 1 行にまとめる(押した印を突き止める
  // markKey は行に依らないので、まとめても強調の対象は変わらない)。
  const seen = new Set<string>();
  for (const row of rows) {
    for (const mark of row.marks) {
      if (mark.groupId !== groupId) continue;
      const key = [mark.at, mark.end ?? "", mark.kind, mark.event.name, mark.event.detail].join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      marks.push(mark);
    }
  }
  marks.sort((a, b) => a.at.localeCompare(b.at));
  return {
    events: marks.map((mark) => mark.event),
    highlightIndex: selectedKey ? marks.findIndex((mark) => markKey(mark) === selectedKey) : -1,
    selected: marks.find((mark) => (selectedKey ? markKey(mark) === selectedKey : false)),
  };
}

const DAY_MS = 86_400_000;
/** 術後日数を出す上限。これを超えたら「前回の手術」ではなく既往なので出さない。 */
const POST_OP_DAY_LIMIT = 90;

/**
 * 日時 → epoch(ms)。日付だけの値(YYYY-MM-DD)は端末ローカルの 0 時として読む。
 * `new Date("2026-08-22")` は仕様上 UTC 0 時なので、そのまま使うと時差のぶんだけ
 * 日がずれる。
 */
export function epochOf(value: string): number {
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

/** 帯に 1 行として出すラベル。 */
export interface FlowsheetEventLabel {
  kind: FlowsheetEventKind;
  text: string;
}

/** 同じ日に入るイベントをまとめたもの。 */
export interface FlowsheetEventGroup {
  /** YYYY-MM-DD。 */
  day: string;
  /** その日のイベントすべて。title・一覧に出す。 */
  events: FlowsheetEvent[];
  /** 帯に積むラベル。重い順(手術 → 入退院)。 */
  labels: FlowsheetEventLabel[];
}

/** 手術・入退院の順に並べる(積むとき、重いイベントを上にする)。 */
const KIND_ORDER: FlowsheetEventKind[] = ["surgery", "encounter", "exam", "injection"];

/** イベントを日ごとにまとめる。日は古い順(列と同じ向き)。 */
export function groupFlowsheetEventsByDay(events: FlowsheetEvent[]): FlowsheetEventGroup[] {
  const byDay = new Map<string, FlowsheetEvent[]>();
  for (const event of events) {
    const day = localDateOf(event.at);
    if (!day) continue;
    const list = byDay.get(day);
    if (list) list.push(event);
    else byDay.set(day, [event]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, list]) => {
      const ordered = [...list].sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || epochOf(a.at) - epochOf(b.at),
      );
      return {
        day,
        events: ordered,
        labels: ordered.map((event) => ({ kind: event.kind, text: event.label })),
      };
    });
}

/**
 * 帯に出すイベント(手術・入退院・転棟・外出泊)を組み立てる。
 *
 * - 入退院・転棟・外出泊は `encounterEvents`(encounterHelpers)の結果をそのまま使う。
 * - 手術は実施記録のハブ Procedure。入室時刻(`performedPeriod.start`)に置く。
 * - 未来のイベントは出さない。経過表は起きたことを読む画面なので。
 */
export function buildFlowsheetEvents(
  encounterEvents: EncounterEvent[],
  surgeries: fhir4.Procedure[],
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

  return events
    .filter((event) => epochOf(event.at) <= limit)
    .sort((a, b) => epochOf(a.at) - epochOf(b.at));
}

/**
 * 検査の行(放射線・内視鏡・生理)。種別ごとに 1 行で、オーダー 1 件が印 1 つ。
 * ヘッダの `ServiceRequest` は `code` を持たない(検査名は明細側)ので、明細から名前を採る。
 * 予定(未来)も出す。検査は予定を見て準備する情報なので。
 */
export function buildExamRows(examOrders: {
  headers: fhir4.ServiceRequest[];
  items: fhir4.ServiceRequest[];
  procedures?: fhir4.Procedure[];
}): FlowsheetMarkRow[] {
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

  // 実施記録(ハブ Procedure)をオーダーごとに。取消済み(誤登録)は実施と見なさない。
  // 部門ごとに category が違う(rad / endoscopy / physio)が、ここでは basedOn だけを見る
  // (検索が既にこの 3 種別に絞ってあるため)。子の手技は partOf を持つので除く。
  const performedByOrder = new Map<string, fhir4.Procedure>();
  for (const procedure of examOrders.procedures ?? []) {
    if (procedure.status === "entered-in-error" || procedure.partOf?.length) continue;
    const orderId = procedure.basedOn?.[0]?.reference?.split("/")[1] ?? "";
    if (!orderId) continue;
    const existing = performedByOrder.get(orderId);
    // 同じオーダーに複数あれば早い方(最初の実施)を採る。
    const at = procedure.performedDateTime ?? procedure.performedPeriod?.start ?? "";
    const existingAt = existing?.performedDateTime ?? existing?.performedPeriod?.start ?? "";
    if (!existing || (at && existingAt && at < existingAt)) performedByOrder.set(orderId, procedure);
  }

  const rows = new Map<string, FlowsheetMarkRow>();
  for (const order of examOrders.headers) {
    const at = order.occurrenceDateTime;
    if (!at || !order.id) continue;
    const type = FLOWSHEET_EXAM_TYPES.find((candidate) =>
      (order.category ?? []).some((category) =>
        category.coding?.some((coding) => coding.code === candidate.code),
      ),
    );
    if (!type) continue;
    const names = (itemsByHeader.get(order.id) ?? [])
      .map((item) => item.code?.text ?? item.code?.coding?.[0]?.display ?? "")
      .filter(Boolean);
    const detail = [...new Set(names)].join("、");

    let row = rows.get(type.code);
    if (!row) {
      row = { key: type.code, label: type.label, title: type.label, marks: [] };
      rows.set(type.code, row);
    }

    // 実施記録があれば実施(塗り丸)、無ければ予定(空丸)。実施の日時は記録の方を採る
    // (予定と違う日に実施されたら、実施した日に印を置く)。
    const performed = performedByOrder.get(order.id);
    const performedAt = performed
      ? (performed.performedDateTime ?? performed.performedPeriod?.start ?? at)
      : "";
    const kind: FlowsheetMarkKind = performed
      ? performed.status === "not-done"
        ? "not-done"
        : performed.status === "stopped"
          ? "stopped"
          : "performed"
      : "planned";
    const markAt = performedAt || at;
    const state = EXAM_STATE_LABELS[kind];

    row.marks.push({
      at: markAt,
      kind,
      groupId: order.id,
      title: [type.label, state, detail, flowsheetEventAtLabel(markAt)].filter(Boolean).join(" "),
      event: {
        at: markAt,
        kind: "exam",
        label: type.label,
        name: [type.label, state].filter(Boolean).join(" "),
        detail,
        target: { kind: type.detailKind, id: order.id },
      },
    });
  }

  // 種別の並びは FLOWSHEET_EXAM_TYPES の順。
  return FLOWSHEET_EXAM_TYPES.map((type) => rows.get(type.code)).filter(
    (row): row is FlowsheetMarkRow => Boolean(row),
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
