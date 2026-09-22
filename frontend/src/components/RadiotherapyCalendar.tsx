import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { radiotherapyDeviceHooks } from "../api/masterQueries";
import {
  useRadiotherapyCalendar,
  type RadiotherapyCalendarEntry,
  type RadiotherapyWorklistRow,
} from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import { addDays, formatDateLabel, today, weekDates, weekStart } from "../fhir/scheduleHelpers";
import { minutesToTime, weekdayOf } from "../fhir/surgeryConflictHelpers";
import { useCardDrag, type DragState } from "../hooks/useCardDrag";
import { clampGridRatio, readGridRatio, storeGridRatio } from "../surgeryCalendarLayout";
import { ErrorBanner } from "./ErrorBanner";
import { KarteSplitter } from "./KarteSplitter";
import { RowMenu } from "./RowMenu";

// 放射線治療カレンダー(docs/radiotherapy-order-design.md §7)。
//
// 手術カレンダーと同じ見た目で、**列が治療装置、縦が時刻**。載るのは照射の Procedure
// (予定・実績・未実施)で、部門は予定を開いて実績に書き換える。右のパネルは治療コースの
// 一覧(受付・治療開始・照射予定の一括登録・休止・終了・サマリー)で、呼び出し側が渡す。
//
// 操作は手術カレンダーと同じ。**空いているところを掴んで縦に引く**か、**右のパネルの治療コースを
// 掴んで格子に落とす**と、その装置・時刻でコースの照射予定を組む(新しいオーダーは作らない。
// 装置と時刻が決まるのは処方のときではなく、部門が日程を組むとき。§7.4)。
// **照射予定のカードは掴んで動かせ**(別の装置の列へも)、上下の縁で
// 開始・終了時刻を伸縮できる。時刻を決めていない予定も、列の頭の「時刻なし」の置き場から
// 掴んで格子へ落とせる(落とした先の装置・時刻が入る)。実績(実施済・未実施)は照射の記録
// なので動かせない。日をまたぐ変更と、この患者の残り全部の組み直しは、メニューの
// 「予定変更」と一括登録のやり直しで行う。

export type RadiotherapyCalendarMode = "day" | "week";

/** 掴んだ空き枠(または治療コースを落とした先)。照射予定の開始日・時刻・装置の初期値になる。 */
export interface RadiotherapySlot {
  date: string;
  startTime: string;
  /** 引いて決めた長さ(分)。押しただけなら null(既定の長さに任せる)。 */
  durationMinutes: number | null;
  deviceCode: string;
  deviceName: string;
}

/** 照射予定の移動・伸縮の結果。 */
export interface RadiotherapyMove {
  date: string;
  startTime: string;
  endTime: string;
  device: { code: string; name: string };
}

const PX_PER_MINUTE = 2;
const DEFAULT_START_MINUTE = 8 * 60 + 30;
const DEFAULT_END_MINUTE = 17 * 60 + 30;
/** 終了時刻を持たない予定の見かけの長さ。 */
const FALLBACK_MINUTES = 15;
/** 装置を決めていない照射を載せる列。 */
const NO_DEVICE = "";

interface Props {
  date: string;
  onDateChange: (date: string) => void;
  mode: RadiotherapyCalendarMode;
  onModeChange: (mode: RadiotherapyCalendarMode) => void;
  /** 右のパネル(治療コースの一覧)。コースのカードを掴んで格子へ落とせるよう、掴む入口を渡す。 */
  panel: (drag: CoursePanelDrag) => ReactNode;
  onPerform: (entry: RadiotherapyCalendarEntry) => void;
  onReschedule: (entry: RadiotherapyCalendarEntry) => void;
  onDeletePlanned: (entry: RadiotherapyCalendarEntry) => void;
  /** この回を中止する(照射しなかった回として残す)。 */
  onCancelFraction: (entry: RadiotherapyCalendarEntry) => void;
  /** 中止を取り消して予定に戻す。 */
  onRestoreFraction: (entry: RadiotherapyCalendarEntry) => void;
  onView: (entry: RadiotherapyCalendarEntry) => void;
  /** 空き枠を掴んだ(どのコースの照射を入れるかを選ぶ)。 */
  onEmptySlot: (slot: RadiotherapySlot) => void;
  /** 右のパネルの治療コースを格子に落とした(そのコースの照射予定を、落とした枠で組む)。 */
  onCourseDrop: (row: RadiotherapyWorklistRow, slot: RadiotherapySlot) => void;
  /** 照射予定を掴んで動かした・縁を掴んで伸縮した。 */
  onMove: (entry: RadiotherapyCalendarEntry, change: RadiotherapyMove) => void;
}

/** 右のパネルに渡す、治療コースのカードを掴むための入口。 */
export interface CoursePanelDrag {
  onCardPointerDown: (row: RadiotherapyWorklistRow, event: React.PointerEvent) => void;
  /** 掴んでいるコース(カードを薄くするのに使う)。 */
  draggingOrderId?: string;
}

/** ポインタ位置から枠を引く関数の置き場。格子(日・週)が自分の測り方を入れる。 */
type SlotResolver = MutableRefObject<(x: number, y: number) => RadiotherapySlot | null>;

export function RadiotherapyCalendar({
  date,
  onDateChange,
  mode,
  onModeChange,
  panel,
  onPerform,
  onReschedule,
  onDeletePlanned,
  onCancelFraction,
  onRestoreFraction,
  onView,
  onEmptySlot,
  onCourseDrop,
  onMove,
}: Props) {
  const [gridRatio, setGridRatio] = useState(readGridRatio);
  const splitRef = useRef<HTMLDivElement>(null);

  // 治療コースのカードのドラッグ。落とし先の枠は格子にしか測れないので、測る関数を格子から預かる。
  const resolveSlot: SlotResolver = useRef(() => null);
  const courseDrag = useCardDrag<RadiotherapyWorklistRow>({
    onDrop: (state) => {
      const slot = resolveSlot.current(state.x, state.y);
      if (slot) onCourseDrop(state.item, slot);
    },
  });
  const coursePoint = courseDrag.drag ? { x: courseDrag.drag.x, y: courseDrag.drag.y } : null;

  const from = mode === "day" ? date : weekStart(date);
  const to = mode === "day" ? date : addDays(from, 6);
  const calendar = useRadiotherapyCalendar(from, to);
  const devices = radiotherapyDeviceHooks.useOptions();

  const entries = useMemo(() => calendar.data ?? [], [calendar.data]);
  // 列は装置マスタの並び。装置を決めていない照射があるときだけ末尾に「装置未定」を足す。
  const columns = useMemo(() => {
    const list = devices.items.map((device) => ({ code: device.code, name: device.name }));
    const known = new Set(list.map((d) => d.code));
    for (const entry of entries) {
      const code = entry.fraction.deviceCode;
      if (code && !known.has(code)) {
        known.add(code);
        list.push({ code, name: entry.fraction.deviceName || code });
      }
    }
    if (entries.some((entry) => !entry.fraction.deviceCode)) {
      list.push({ code: NO_DEVICE, name: "装置未定" });
    }
    return list;
  }, [devices.items, entries]);

  return (
    <div className="surgery-calendar radiotherapy-calendar">
      <div className="surgery-calendar__toolbar">
        <div className="order-select__tabs" role="tablist">
          {(
            [
              ["day", "日"],
              ["week", "週"],
            ] as const
          ).map(([code, label]) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={mode === code}
              className={mode === code ? "order-select__tab is-active" : "order-select__tab"}
              onClick={() => onModeChange(code)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="surgery-calendar__date">
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, mode === "day" ? -1 : -7))}
            aria-label={mode === "day" ? "前の日" : "前の週"}
          >
            &lt;
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value || today())}
          />
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, mode === "day" ? 1 : 7))}
            aria-label={mode === "day" ? "次の日" : "次の週"}
          >
            &gt;
          </button>
          <button type="button" onClick={() => onDateChange(today())} disabled={date === today()}>
            今日
          </button>
        </div>
      </div>

      <ErrorBanner error={calendar.error} />

      <div
        className="surgery-calendar__split"
        ref={splitRef}
        style={{ "--surgery-calendar-grid-ratio": gridRatio } as CSSProperties}
      >
        <div className="surgery-calendar__grid-pane">
          {calendar.isLoading ? (
            <p>読み込み中...</p>
          ) : columns.length === 0 ? (
            <p className="patient-table__empty">
              治療装置が登録されていません。「マスタメンテ &gt; 放射線治療 &gt;
              治療装置マスタ」から登録してください。
            </p>
          ) : mode === "day" ? (
            <DayGrid
              date={date}
              entries={entries}
              columns={columns}
              onEmptySlot={onEmptySlot}
              onMove={onMove}
              resolveSlot={resolveSlot}
              coursePoint={coursePoint}
              onPerform={onPerform}
              onReschedule={onReschedule}
              onDeletePlanned={onDeletePlanned}
              onCancelFraction={onCancelFraction}
              onRestoreFraction={onRestoreFraction}
              onView={onView}
            />
          ) : (
            <WeekGrid
              from={from}
              entries={entries}
              columns={columns}
              onMove={onMove}
              resolveSlot={resolveSlot}
              coursePoint={coursePoint}
              onOpenDay={(day) => {
                onDateChange(day);
                onModeChange("day");
              }}
            />
          )}
        </div>
        <KarteSplitter
          containerRef={splitRef}
          orientation="vertical"
          ratio={gridRatio}
          label="カレンダーと治療コース一覧の幅"
          onChange={(ratio) => setGridRatio(clampGridRatio(ratio))}
          onChangeEnd={storeGridRatio}
        />
        {panel({
          onCardPointerDown: courseDrag.start,
          draggingOrderId: courseDrag.drag?.item.order.id,
        })}
      </div>
    </div>
  );
}

interface Column {
  code: string;
  name: string;
}

interface CardHandlers {
  onPerform: (entry: RadiotherapyCalendarEntry) => void;
  onReschedule: (entry: RadiotherapyCalendarEntry) => void;
  onDeletePlanned: (entry: RadiotherapyCalendarEntry) => void;
  /** この回を中止する(照射しなかった回として残す)。 */
  onCancelFraction: (entry: RadiotherapyCalendarEntry) => void;
  /** 中止を取り消して予定に戻す。 */
  onRestoreFraction: (entry: RadiotherapyCalendarEntry) => void;
  onView: (entry: RadiotherapyCalendarEntry) => void;
}

/** ポインタを要素に捕まえる。捕まえられない環境(合成イベントなど)でも操作自体は続ける。 */
function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // 捕まえられなくても、列の中で引いているぶんには動く。
  }
}

function toMinutes(time: string): number | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function entryRange(entry: RadiotherapyCalendarEntry): { start: number; end: number } | null {
  const start = toMinutes(entry.fraction.startTime);
  if (start === null) return null;
  const end = toMinutes(entry.fraction.endTime);
  return { start, end: end !== null && end > start ? end : start + FALLBACK_MINUTES };
}

/** 重なっている予定を列の中で横に分ける(同じ時刻に複数の患者を入れてしまったとき)。 */
function assignLanes(ranges: { start: number; end: number }[]): { index: number; total: number }[] {
  const result = ranges.map(() => ({ index: 0, total: 1 }));
  let group: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const i of group) {
      let lane = laneEnds.findIndex((end) => end <= ranges[i].start);
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = ranges[i].end;
      result[i].index = lane;
    }
    for (const i of group) result[i].total = laneEnds.length;
    group = [];
  };
  ranges.forEach((range, i) => {
    if (group.length > 0 && range.start >= groupEnd) flush();
    group.push(i);
    groupEnd = Math.max(groupEnd, range.end);
  });
  flush();
  return result;
}

function statusOf(entry: RadiotherapyCalendarEntry): { code: string; label: string } {
  if (entry.fraction.planned) return { code: "accepted", label: "予定" };
  if (entry.fraction.notDone) return { code: "requested", label: "未実施" };
  return { code: "completed", label: "実施済" };
}

/** 空き枠・移動・伸縮を丸める刻み(分)。照射は 1 回 10〜15 分なので手術(15 分)より細かくする。 */
const SNAP_MINUTES = 5;

function snap(minute: number): number {
  return Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

/** 空き枠の頭。マウスの下の枠を指すので切り捨てる(下見と、押して登録される時刻を同じにする)。 */
function slotStart(minute: number): number {
  return Math.floor(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

/** 引いた範囲。頭は切り捨て、末尾は切り上げて、引いたところを覆う。 */
function slotRange(from: number, to: number): { start: number; end: number } {
  return {
    start: slotStart(Math.min(from, to)),
    end: Math.ceil(Math.max(from, to) / SNAP_MINUTES) * SNAP_MINUTES,
  };
}

interface ResizeState {
  entry: RadiotherapyCalendarEntry;
  edge: "top" | "bottom";
  start: number;
  end: number;
}

function DayGrid({
  date,
  entries,
  columns,
  onEmptySlot,
  onMove,
  resolveSlot,
  coursePoint,
  ...handlers
}: {
  date: string;
  entries: RadiotherapyCalendarEntry[];
  columns: Column[];
  onEmptySlot: (slot: RadiotherapySlot) => void;
  onMove: (entry: RadiotherapyCalendarEntry, change: RadiotherapyMove) => void;
  resolveSlot: SlotResolver;
  /** 治療コースのカードを掴んでいる間のポインタ位置。落とし先の下見に使う。 */
  coursePoint: { x: number; y: number } | null;
} & CardHandlers) {
  const axis = useMemo(() => {
    let start = DEFAULT_START_MINUTE;
    let end = DEFAULT_END_MINUTE;
    for (const entry of entries) {
      const range = entryRange(entry);
      if (!range) continue;
      start = Math.min(start, Math.floor(range.start / 60) * 60);
      end = Math.max(end, Math.ceil(range.end / 60) * 60);
    }
    return { start: Math.max(start, 0), end: Math.min(end, 24 * 60) };
  }, [entries]);

  const hours: number[] = [];
  for (let minute = Math.ceil(axis.start / 60) * 60; minute <= axis.end; minute += 60) {
    hours.push(minute);
  }
  const height = (axis.end - axis.start) * PX_PER_MINUTE;
  // 時刻を持たない照射(時刻なしで実績を入れたもの)の置き場。**どれか 1 列にでもあれば
  // 全列に同じ高さで出す** —— 1 列だけ差し込むと、その列の格子が下へずれて時刻の軸と合わなくなる。
  const hasUntimed = entries.some((entry) => !entryRange(entry));

  // 列の本体。ポインタ位置から「どの装置の何分か」を引くのに使う。
  const bodyRefs = useRef(new Map<string, HTMLDivElement>());

  function minuteAt(code: string, clientY: number): number {
    const rect = bodyRefs.current.get(code)?.getBoundingClientRect();
    if (!rect) return axis.start;
    const minute = axis.start + (clientY - rect.top) / PX_PER_MINUTE;
    return Math.min(Math.max(minute, axis.start), axis.end);
  }

  function columnAt(clientX: number, clientY: number): Column | undefined {
    return columns.find((column) => {
      const rect = bodyRefs.current.get(column.code)?.getBoundingClientRect();
      return rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top - 40 && clientY <= rect.bottom;
    });
  }

  // ---- 治療コースを落とす先(右のパネルのカードを掴んで格子へ) ----
  function courseSlotAt(x: number, y: number): (RadiotherapySlot & { start: number }) | null {
    const column = columnAt(x, y);
    if (!column) return null;
    const start = Math.min(slotStart(minuteAt(column.code, y)), axis.end - FALLBACK_MINUTES);
    return {
      start,
      date,
      startTime: minutesToTime(start),
      durationMinutes: null,
      deviceCode: column.code,
      deviceName: column.code ? column.name : "",
    };
  }
  resolveSlot.current = courseSlotAt;
  const courseTarget = coursePoint ? courseSlotAt(coursePoint.x, coursePoint.y) : null;

  // ---- 空き枠の選択(掴んで縦に引くと、その範囲にコースの照射予定を入れる) ----
  const [selection, setSelection] = useState<{ code: string; from: number; to: number } | null>(null);
  // 空き枠の下見。マウスの下の枠を薄く塗って時刻を出す(手術カレンダーと同じ)。
  const [hover, setHover] = useState<{ code: string; start: number } | null>(null);

  // ---- カードの移動(照射予定だけ。実績は記録なので動かさない) ----
  // 時刻を決めていない予定(「時刻なし」の置き場にあるカード)も掴める。格子に落とすと、
  // そこで初めて装置と時刻が決まる。
  function dropTarget(state: DragState<RadiotherapyCalendarEntry>) {
    const column = columnAt(state.x, state.y);
    if (!column) return null;
    const range = entryRange(state.item);
    const duration = range ? range.end - range.start : FALLBACK_MINUTES;
    // 掴んだ場所とカードの頭のずれを保ったまま落とす(格子に載っていないカードにずれは無い)。
    const grabbed = range ? minuteAt(state.item.fraction.deviceCode, state.startY) - range.start : 0;
    const start = Math.min(Math.max(snap(minuteAt(column.code, state.y) - grabbed), axis.start), axis.end - duration);
    return { column, start, end: start + duration };
  }

  const dragging = useCardDrag<RadiotherapyCalendarEntry>({
    onDrop: (state) => {
      const target = dropTarget(state);
      if (!target) return;
      const range = entryRange(state.item);
      // 位置が変わっていなければ何もしない(掴んで置き直しただけ)。時刻なしのカードは
      // 落とせば必ず時刻が付くので、この判定に掛からない。
      if (range && target.column.code === state.item.fraction.deviceCode && target.start === range.start) return;
      onMove(state.item, {
        date,
        startTime: minutesToTime(target.start),
        endTime: minutesToTime(target.end),
        device: { code: target.column.code, name: target.column.code ? target.column.name : "" },
      });
    },
  });
  const preview = dragging.drag ? dropTarget(dragging.drag) : null;

  // ---- カードの伸縮(上下の縁を掴んで開始・終了時刻を変える) ----
  const [resize, setResize] = useState<ResizeState | null>(null);

  function resizedTo(state: ResizeState, minute: number): ResizeState {
    const at = snap(minute);
    return state.edge === "top"
      ? { ...state, start: Math.min(at, state.end - SNAP_MINUTES) }
      : { ...state, end: Math.max(at, state.start + SNAP_MINUTES) };
  }

  function commitResize(state: ResizeState) {
    const before = entryRange(state.entry);
    if (before && before.start === state.start && before.end === state.end) return;
    const { fraction } = state.entry;
    onMove(state.entry, {
      date,
      startTime: minutesToTime(state.start),
      endTime: minutesToTime(state.end),
      device: { code: fraction.deviceCode, name: fraction.deviceName },
    });
  }

  return (
    <div className="surgery-calendar__day-wrap">
      <div className="surgery-calendar__day">
        <div className="surgery-calendar__axis">
          <div className="surgery-calendar__col-head">時刻</div>
          {hasUntimed && (
            <div className="radiotherapy-calendar__untimed radiotherapy-calendar__untimed--axis">
              時刻なし
            </div>
          )}
          <div className="surgery-calendar__axis-body" style={{ height }}>
            {hours.map((minute) => (
              <div
                key={minute}
                className="surgery-calendar__hour"
                style={{ top: (minute - axis.start) * PX_PER_MINUTE }}
              >
                <span>{minutesToTime(minute)}</span>
              </div>
            ))}
          </div>
        </div>

        {columns.map((column) => {
          const own = entries.filter((entry) => entry.fraction.deviceCode === column.code);
          const timed = own
            .map((entry) => ({ entry, range: entryRange(entry) }))
            .filter((x): x is { entry: RadiotherapyCalendarEntry; range: { start: number; end: number } } =>
              Boolean(x.range),
            )
            .sort((a, b) => a.range.start - b.range.start);
          const untimed = own.filter((entry) => !entryRange(entry));
          const lanes = assignLanes(timed.map((x) => x.range));
          const selected =
            selection?.code === column.code ? slotRange(selection.from, selection.to) : null;

          return (
            <div
              key={column.code || "none"}
              className={
                preview?.column.code === column.code || courseTarget?.deviceCode === column.code
                  ? "surgery-calendar__col surgery-calendar__col--drop-target"
                  : "surgery-calendar__col"
              }
            >
              <div className="surgery-calendar__col-head">
                {column.name}
                <span className="radiotherapy-calendar__count">{own.length} 件</span>
              </div>
              {/* 時刻を決めていない照射。格子には置けないので軸の上に並べる(全列で同じ高さ)。
                  予定はここから掴んで格子へ落とせる(落とした先で装置と時刻が決まる)。 */}
              {hasUntimed && (
                <div className="radiotherapy-calendar__untimed">
                  {untimed.map((entry) => (
                    <FractionCard
                      key={entry.fraction.id}
                      entry={entry}
                      {...handlers}
                      dragging={dragging.drag?.item.fraction.id === entry.fraction.id}
                      onMoveStart={(event) => dragging.start(entry, event)}
                    />
                  ))}
                </div>
              )}
              <div
                ref={(el) => {
                  if (el) bodyRefs.current.set(column.code, el);
                  else bodyRefs.current.delete(column.code);
                }}
                className="surgery-calendar__col-body"
                style={{ height }}
                // 空いているところを掴んで縦に引くと、その範囲で放射線治療を登録する。
                // カード(とその上のボタン)の上は除く。click ではなく pointerup で開くのは手術と同じ理由
                // (カードを同じ列に落としたときの click で登録が開かないように)。
                onPointerDown={(e) => {
                  if (e.button !== 0 || (e.target as HTMLElement).closest(".radiotherapy-calendar__card")) return;
                  const minute = minuteAt(column.code, e.clientY);
                  setSelection({ code: column.code, from: minute, to: minute });
                  // 列から出ても引き続けられるようにする(下へ引くと軸の外へ出やすい)。
                  capturePointer(e.currentTarget, e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (selection?.code === column.code) {
                    setSelection({ ...selection, to: minuteAt(column.code, e.clientY) });
                    return;
                  }
                  // カードの上と、カードを掴んでいる・伸縮している間は出さない(落とし先の枠と紛れる)。
                  const onCard = (e.target as HTMLElement).closest(".radiotherapy-calendar__card");
                  if (onCard || dragging.drag || resize || coursePoint) {
                    if (hover) setHover(null);
                    return;
                  }
                  const start = slotStart(minuteAt(column.code, e.clientY));
                  if (hover?.code !== column.code || hover.start !== start) {
                    setHover({ code: column.code, start });
                  }
                }}
                onPointerLeave={() => setHover(null)}
                onPointerUp={(e) => {
                  if (selection?.code !== column.code) return;
                  setSelection(null);
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  const { start, end } = slotRange(selection.from, selection.to);
                  // 引かずに押しただけなら所要時間は決めていない(既定の長さに任せる)。
                  const dragged = Math.abs(selection.to - selection.from) >= SNAP_MINUTES / 2;
                  onEmptySlot({
                    date,
                    startTime: minutesToTime(start),
                    durationMinutes: dragged && end > start ? end - start : null,
                    deviceCode: column.code,
                    deviceName: column.code ? column.name : "",
                  });
                }}
                onPointerCancel={() => setSelection(null)}
              >
                {hours.map((minute) => (
                  <div
                    key={minute}
                    className="surgery-calendar__gridline"
                    style={{ top: (minute - axis.start) * PX_PER_MINUTE }}
                  />
                ))}

                {hover?.code === column.code && !selected && !preview && (
                  <div
                    className="surgery-calendar__slot-hover"
                    style={{
                      top: (hover.start - axis.start) * PX_PER_MINUTE,
                      // 押しただけで登録したときの既定の長さ(15 分)で塗る。5 分の刻みのままだと
                      // 帯が細すぎて時刻が読めない。
                      height: FALLBACK_MINUTES * PX_PER_MINUTE,
                    }}
                  >
                    <span>{minutesToTime(hover.start)}</span>
                  </div>
                )}

                {selected && selected.end > selected.start && (
                  <div
                    className="surgery-calendar__slot-select"
                    style={{
                      top: (selected.start - axis.start) * PX_PER_MINUTE,
                      height: (selected.end - selected.start) * PX_PER_MINUTE,
                    }}
                  >
                    <span className="surgery-calendar__slot-duration">
                      {minutesToTime(selected.start)}〜{minutesToTime(selected.end)}
                    </span>
                  </div>
                )}

                {courseTarget?.deviceCode === column.code && (
                  <div
                    className="surgery-calendar__drop-preview"
                    style={{
                      top: (courseTarget.start - axis.start) * PX_PER_MINUTE,
                      height: FALLBACK_MINUTES * PX_PER_MINUTE,
                    }}
                  >
                    <span>{courseTarget.startTime}〜</span>
                  </div>
                )}

                {preview?.column.code === column.code && (
                  <div
                    className="surgery-calendar__drop-preview"
                    style={{
                      top: (preview.start - axis.start) * PX_PER_MINUTE,
                      height: (preview.end - preview.start) * PX_PER_MINUTE,
                    }}
                  >
                    <span>
                      {minutesToTime(preview.start)}〜{minutesToTime(preview.end)}
                    </span>
                  </div>
                )}

                {timed.map(({ entry, range }, index) => {
                  const sizing = resize?.entry.fraction.id === entry.fraction.id ? resize : null;
                  const shown = sizing ?? range;
                  return (
                    <FractionCard
                      key={entry.fraction.id}
                      entry={entry}
                      {...handlers}
                      dragging={dragging.drag?.item.fraction.id === entry.fraction.id}
                      timeLabel={sizing ? `${minutesToTime(sizing.start)}〜${minutesToTime(sizing.end)}` : undefined}
                      onMoveStart={(event) => dragging.start(entry, event)}
                      onResizeStart={(edge) => setResize({ entry, edge, start: range.start, end: range.end })}
                      onResizeMove={(clientY) =>
                        setResize((current) =>
                          current ? resizedTo(current, minuteAt(column.code, clientY)) : current,
                        )
                      }
                      onResizeEnd={(commit) => {
                        if (commit && resize) commitResize(resize);
                        setResize(null);
                      }}
                      style={{
                        top: (shown.start - axis.start) * PX_PER_MINUTE,
                        height: Math.max((shown.end - shown.start) * PX_PER_MINUTE, 22),
                        left: `${(lanes[index].index / lanes[index].total) * 100}%`,
                        width: `${100 / lanes[index].total}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 照射 1 回ぶんのカード。1 回 15 分前後で背が低いので、1 行に「状態・時刻・患者・回」を詰める。
//
// **動かせるのは照射予定だけ。** 実績(実施済・未実施)は照射の記録なので、掴めず伸縮もできない。
function FractionCard({
  entry,
  style,
  dragging = false,
  timeLabel,
  onMoveStart,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onPerform,
  onReschedule,
  onDeletePlanned,
  onCancelFraction,
  onRestoreFraction,
  onView,
}: {
  entry: RadiotherapyCalendarEntry;
  style?: CSSProperties;
  dragging?: boolean;
  /** 伸縮中の時刻。渡されている間は開始時刻の代わりに出す。 */
  timeLabel?: string;
  onMoveStart?: (event: React.PointerEvent) => void;
  onResizeStart?: (edge: "top" | "bottom") => void;
  onResizeMove?: (clientY: number) => void;
  onResizeEnd?: (commit: boolean) => void;
} & CardHandlers) {
  const { fraction, patient, order } = entry;
  const status = statusOf(entry);
  const summary = order ? summarizeRadiotherapyOrder(order) : undefined;
  const phase = summary?.phases.find((p) => p.phaseId === fraction.phaseId);
  const count = phase ? `${fraction.fractionNumber}/${phase.fractions}` : `${fraction.fractionNumber}回目`;
  const movable = Boolean(fraction.planned && onMoveStart);
  // 伸縮できるのは格子に載っているカードだけ(「時刻なし」の置き場には掴む縁が無い)。
  const resizable = movable && Boolean(style);
  const timeText = timeLabel ?? fraction.timeLabel;

  const resizeHandle = (edge: "top" | "bottom") => (
    <span
      className={`surgery-calendar__card-resize surgery-calendar__card-resize--${edge}`}
      // 押した指がそのままカードの移動を始めないよう、pointerdown はここで止める。
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        capturePointer(e.currentTarget, e.pointerId);
        onResizeStart?.(edge);
      }}
      onPointerMove={(e) => onResizeMove?.(e.clientY)}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        onResizeEnd?.(true);
      }}
      onPointerCancel={() => onResizeEnd?.(false)}
    />
  );

  return (
    <div
      className={[
        style ? "surgery-calendar__card radiotherapy-calendar__card" : "radiotherapy-calendar__card radiotherapy-calendar__card--inline",
        movable ? "surgery-calendar__card--movable" : "",
        dragging ? "surgery-calendar__card--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerDown={movable ? onMoveStart : undefined}
      title={[
        fraction.timeLabel,
        status.label,
        patient ? displayName(patient) : "",
        summary ? `第${summary.courseNumber}コース ${summary.siteLabel}` : "",
        phase ? `${phase.label} ${count}` : count,
        fraction.notDoneReason,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {resizable && resizeHandle("top")}
      {resizable && resizeHandle("bottom")}
      <span className="radiotherapy-calendar__card-line">
        <span className={`surgery-calendar__status is-${status.code}`}>{status.label}</span>
        {timeText && <span className="radiotherapy-calendar__card-time">{timeText}</span>}
        <span className="surgery-calendar__card-patient-name">
          {patient ? displayName(patient) : "-"}
        </span>
        <span className="radiotherapy-calendar__card-count">{count}</span>
      </span>
      {/* ボタンとメニューを押した指がカードを掴まないよう、pointerdown はここで止める。 */}
      <span className="surgery-calendar__card-actions" onPointerDown={(e) => e.stopPropagation()}>
        {fraction.planned && (
          <button type="button" onClick={() => onPerform(entry)}>
            実施
          </button>
        )}
        <RowMenu label="この照射の操作" escapesClipping>
          <button type="button" className="row-menu__item" onClick={() => onView(entry)}>
            コースを表示
          </button>
          {fraction.planned && (
            <>
              <button type="button" className="row-menu__item" onClick={() => onReschedule(entry)}>
                予定変更
              </button>
              {/* 照射しなかった回として残す(体調不良・休診など)。実施の入力とは別の操作で、
                  コースそのものの中止は右の一覧のカードから。 */}
              <button type="button" className="row-menu__item" onClick={() => onCancelFraction(entry)}>
                この回を中止
              </button>
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={() => onDeletePlanned(entry)}
              >
                予定を削除
              </button>
            </>
          )}
          {fraction.notDone && (
            <>
              <button type="button" className="row-menu__item" onClick={() => onRestoreFraction(entry)}>
                中止を取消
              </button>
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={() => onDeletePlanned(entry)}
              >
                記録を削除
              </button>
            </>
          )}
        </RowMenu>
      </span>
    </div>
  );
}

// 週ビュー。装置 × 日で、件数と患者名を出す。日付かセルの空きを押すと日ビューへ降りる。
// **照射予定の札は掴んで別の日・別の装置へ動かせる**(時刻は変えない。時刻は日ビューで直す)。
function WeekGrid({
  from,
  entries,
  columns,
  onOpenDay,
  onMove,
  resolveSlot,
  coursePoint,
}: {
  from: string;
  entries: RadiotherapyCalendarEntry[];
  columns: Column[];
  onOpenDay: (date: string) => void;
  onMove: (entry: RadiotherapyCalendarEntry, change: RadiotherapyMove) => void;
  resolveSlot: SlotResolver;
  coursePoint: { x: number; y: number } | null;
}) {
  const dates = weekDates(from);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  function cellAt(x: number, y: number): { date: string; column: Column } | null {
    for (const [key, cell] of cellRefs.current) {
      const rect = cell.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const [cellDate, code] = key.split("|");
      const column = columns.find((c) => c.code === code);
      return column ? { date: cellDate, column } : null;
    }
    return null;
  }

  const dragging = useCardDrag<RadiotherapyCalendarEntry>({
    onDrop: (state) => {
      const target = cellAt(state.x, state.y);
      const { fraction } = state.item;
      if (!target) return;
      // 同じセルに戻しただけなら何もしない。
      if (target.date === fraction.performedDate && target.column.code === fraction.deviceCode) return;
      onMove(state.item, {
        date: target.date,
        startTime: fraction.startTime,
        endTime: fraction.endTime,
        device: { code: target.column.code, name: target.column.code ? target.column.name : "" },
      });
    },
  });
  // 治療コースを落とす先。週ビューで決まるのは日と装置だけ(時刻は一括登録で入れる)。
  resolveSlot.current = (x, y) => {
    const target = cellAt(x, y);
    return target
      ? {
          date: target.date,
          startTime: "",
          durationMinutes: null,
          deviceCode: target.column.code,
          deviceName: target.column.code ? target.column.name : "",
        }
      : null;
  };
  const point = dragging.drag ?? coursePoint;
  const over = point ? cellAt(point.x, point.y) : null;

  return (
    <div className="slot-calendar__wrap">
      <table className="slot-calendar surgery-calendar__week">
        <thead>
          <tr>
            <th className="slot-calendar__time-col">治療装置</th>
            {dates.map((d) => (
              <th key={d} className={weekendClass(d)}>
                <button type="button" className="surgery-calendar__day-link" onClick={() => onOpenDay(d)}>
                  {formatDateLabel(d)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.code || "none"}>
              <th className="slot-calendar__time-col">{column.name}</th>
              {dates.map((d) => {
                const cell = entries
                  .filter(
                    (entry) =>
                      entry.fraction.deviceCode === column.code && entry.fraction.performedDate === d,
                  )
                  .sort((a, b) => a.fraction.performedAt.localeCompare(b.fraction.performedAt));
                const done = cell.filter((entry) => !entry.fraction.planned && !entry.fraction.notDone);
                const isTarget = over?.date === d && over.column.code === column.code;
                return (
                  <td
                    key={d}
                    ref={(el) => {
                      const key = `${d}|${column.code}`;
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    }}
                    className={[weekendClass(d), isTarget ? "radiotherapy-calendar__week-td--target" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      // 掴んで離した直後の click は飲む(日ビューへ落ちてしまうため)。
                      if (dragging.consumeClick()) return;
                      onOpenDay(d);
                    }}
                  >
                    {cell.length > 0 && (
                      <div className="radiotherapy-calendar__week-cell">
                        <span className="surgery-calendar__cell-count">
                          {cell.length} 件（実施 {done.length}）
                        </span>
                        {cell.slice(0, 8).map((entry) => (
                          <span
                            key={entry.fraction.id}
                            className={[
                              "surgery-calendar__cell-block",
                              entry.fraction.planned ? "radiotherapy-calendar__chip--movable" : "",
                              dragging.drag?.item.fraction.id === entry.fraction.id
                                ? "surgery-calendar__card--dragging"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            title={entry.fraction.planned ? "掴んで別の日・装置へ" : undefined}
                            onPointerDown={
                              entry.fraction.planned ? (e) => dragging.start(entry, e) : undefined
                            }
                          >
                            {entry.fraction.startTime} {entry.patient ? displayName(entry.patient) : "-"}
                          </span>
                        ))}
                        {cell.length > 8 && (
                          <span className="surgery-calendar__cell-count">ほか {cell.length - 8} 件</span>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function weekendClass(dateISO: string): string | undefined {
  const weekday = weekdayOf(dateISO);
  if (weekday === 6) return "slot-calendar__col--saturday";
  if (weekday === 0) return "slot-calendar__col--sunday";
  return undefined;
}
