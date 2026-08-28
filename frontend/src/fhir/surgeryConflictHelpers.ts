// 手術室の取り合い(ダブルブッキング)とブロックスケジュールの判定。
//
// 手術は予約枠(Slot)を持たない設計(docs/surgery-order-design.md §1)なので、
// 部屋の空き状況の真実の源は手術オーダーそのもの(occurrenceDateTime + 所要時間)。
// ここはその生データから「重なっているか」「割当科の外か」を出すだけの純関数群で、
// 一覧の隣に出す表示(SurgeryRoomDaySchedule)・登録前の確認・カレンダーの 3 か所が
// 同じ判定を使うために切り出してある。
//
// 詳細は docs/surgery-calendar-design.md。

import type { SurgeryWorklistRow } from "../api/queries";
import type { SurgeryRoomBlock } from "../api/masterClient";
import { summarizeSurgeryOrder } from "./surgeryOrderHelpers";
import { surgeryTaskStatus } from "./surgeryTaskHelpers";

/** その日の何分目から何分目か。 */
export interface MinuteRange {
  start: number;
  end: number;
}

/**
 * 入室時刻と所要時間を、その日の分レンジに直す。時刻が無ければ判定できないので null。
 *
 * 所要時間が分からないものは入室時刻の一点として扱う(1 分幅にすると、他方の
 * 時間帯の中に落ちたときだけ重なりとして拾える)。
 */
export function timeRange(
  time: string,
  durationMinutes: number | string | null | undefined,
): MinuteRange | null {
  if (!/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const start = hours * 60 + minutes;
  const duration = Number(durationMinutes);
  return {
    start,
    end: start + (Number.isFinite(duration) && duration > 0 ? duration : 1),
  };
}

/** 境界が接するだけ(前の退室予定 = 次の入室予定)は重なりにしない。 */
export function overlaps(a: MinuteRange, b: MinuteRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** 「09:00〜11:30」。時刻が無ければ「時刻未定」。 */
export function rangeLabel(time: string, durationMinutes: number | null): string {
  if (!time) return "時刻未定";
  const range = timeRange(time, durationMinutes);
  if (durationMinutes == null || !range) return time;
  return `${time}〜${minutesToTime(range.end)}`;
}

export interface RoomDayFilter {
  /** 手術室。空(部屋未定)なら部屋で絞らない。 */
  roomId?: string;
  /** 一覧から外すオーダーの id(編集中の自分自身)。 */
  excludeOrderId?: string;
}

/**
 * その日の一覧から、部屋の取り合いの相手になる行だけを残す。
 *
 * 中止した手術は部屋を空けるので、重なりにも一覧にも数えない。
 */
export function roomDayRows(
  rows: SurgeryWorklistRow[],
  { roomId, excludeOrderId }: RoomDayFilter,
): SurgeryWorklistRow[] {
  return rows
    .filter((row) => row.order.id !== excludeOrderId)
    .filter((row) => surgeryTaskStatus(row.task) !== "cancelled")
    .filter((row) => !roomId || summarizeSurgeryOrder(row.order).roomId === roomId);
}

/**
 * 入れようとしている時間帯と重なる行。部屋が決まっていない・時刻が無いあいだは
 * 取り合う相手が定まらないので空。
 */
export function conflictingRows(
  rows: SurgeryWorklistRow[],
  planned: MinuteRange | null,
): SurgeryWorklistRow[] {
  if (!planned) return [];
  return rows.filter((row) => {
    const summary = summarizeSurgeryOrder(row.order);
    const other = timeRange(summary.scheduledTime, summary.durationMinutes);
    return other != null && overlaps(planned, other);
  });
}

/** id で照合するので、id の無いものは入れない(空文字が全行に当たってしまう)。 */
export function rowIdSet(rows: SurgeryWorklistRow[]): Set<string> {
  return new Set(
    rows.map((row) => row.order.id).filter((id): id is string => Boolean(id)),
  );
}

// ---- ブロックスケジュール ----

/**
 * その日・その部屋の割当。曜日で引く。
 *
 * 有効期間の判定は取得側(useSurgeryRoomBlocks が date を渡す)で済んでいるので、
 * ここでは曜日と部屋だけを見る。
 */
export function blocksOfRoomDay(
  blocks: SurgeryRoomBlock[],
  roomId: string,
  date: string,
): SurgeryRoomBlock[] {
  if (!roomId || !date) return [];
  const weekday = weekdayOf(date);
  if (weekday == null) return [];
  return blocks
    .filter((block) => block.location_id === roomId && block.weekday === weekday)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/** "YYYY-MM-DD" の曜日(0=日 … 6=土)。不正な日付は null。 */
export function weekdayOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  // ローカルタイムで作る(UTC 解釈だと日本時間では前日の曜日になる)。
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

/**
 * 入れようとしている時間帯が、割当のある科と食い違っているか。
 *
 * 「割当のある時間帯に、割当先でない科が入ろうとしている」ときだけ true。
 * 割当が無い時間帯(フリー)は誰でも使える。判定材料が足りないとき(部屋未定・
 * 時刻未定・科未選択)は判定しない。
 *
 * ［提案］これは警告にしか使わない。割当科が使わない枠を他科へ回す運用が、
 * マスタを触らずに回るようにするため(docs/surgery-calendar-design.md)。
 */
export function conflictingBlocks(
  blocks: SurgeryRoomBlock[],
  planned: MinuteRange | null,
  departmentCode: string,
): SurgeryRoomBlock[] {
  if (!planned || !departmentCode) return [];
  return blocks.filter((block) => {
    if (block.department_code === departmentCode) return false;
    const range = blockRange(block);
    return range != null && overlaps(planned, range);
  });
}

export function blockRange(block: SurgeryRoomBlock): MinuteRange | null {
  const start = timeRange(block.start_time, null);
  const end = timeRange(block.end_time, null);
  if (!start || !end) return null;
  return { start: start.start, end: end.start };
}

/** 「9:00-12:00 外科」。 */
export function blockLabel(block: SurgeryRoomBlock): string {
  return `${block.start_time}-${block.end_time} ${block.department_name || block.department_code}`;
}

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// ---- 日程の移動(カレンダーのドラッグ＆ドロップ) ----

/**
 * 日程を動かせる手術か。
 *
 * ［提案］動かせるのは**申込済・受付済**まで。入室中・実施済はもう起きた事実で、
 * 予定日時を後から動かすと実施記録と食い違う(記録の訂正は実施入力側の担当)。
 * 中止はそもそもカレンダーに出さない。
 */
export function isSurgeryMovable(task: fhir4.Task | undefined): boolean {
  const status = surgeryTaskStatus(task);
  return status === "requested" || status === "accepted";
}

/** ドラッグの粒度。手術の入室時刻は 5 分刻みで足りる(1 分刻みは掴みにくい)。 */
export const DRAG_SNAP_MINUTES = 5;

/** 分を刻みに丸める。 */
export function snapMinutes(minutes: number, snap = DRAG_SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}
