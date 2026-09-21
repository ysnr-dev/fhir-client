import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { radiotherapyDeviceHooks } from "../api/masterQueries";
import { useRadiotherapyCalendar, type RadiotherapyCalendarEntry } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import { addDays, formatDateLabel, today, weekDates, weekStart } from "../fhir/scheduleHelpers";
import { minutesToTime, weekdayOf } from "../fhir/surgeryConflictHelpers";
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
// 手術と違ってカードを掴んで動かす操作は持たない。照射は 1 日に何十件も同じ長さで並び、
// 動かすのは「この患者の残りを全部 1 日ずらす」のような単位なので、個別の変更はメニューの
// 「予定変更」、まとめての組み直しは一括登録のやり直しで行う。

export type RadiotherapyCalendarMode = "day" | "week";

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
  /** 右のパネル(治療コースの一覧)。 */
  panel: ReactNode;
  onPerform: (entry: RadiotherapyCalendarEntry) => void;
  onReschedule: (entry: RadiotherapyCalendarEntry) => void;
  onDeletePlanned: (entry: RadiotherapyCalendarEntry) => void;
  onView: (entry: RadiotherapyCalendarEntry) => void;
}

export function RadiotherapyCalendar({
  date,
  onDateChange,
  mode,
  onModeChange,
  panel,
  onPerform,
  onReschedule,
  onDeletePlanned,
  onView,
}: Props) {
  const [gridRatio, setGridRatio] = useState(readGridRatio);
  const splitRef = useRef<HTMLDivElement>(null);

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
              entries={entries}
              columns={columns}
              onPerform={onPerform}
              onReschedule={onReschedule}
              onDeletePlanned={onDeletePlanned}
              onView={onView}
            />
          ) : (
            <WeekGrid
              from={from}
              entries={entries}
              columns={columns}
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
        {panel}
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
  onView: (entry: RadiotherapyCalendarEntry) => void;
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

function DayGrid({
  entries,
  columns,
  ...handlers
}: { entries: RadiotherapyCalendarEntry[]; columns: Column[] } & CardHandlers) {
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

          return (
            <div key={column.code || "none"} className="surgery-calendar__col">
              <div className="surgery-calendar__col-head">
                {column.name}
                <span className="radiotherapy-calendar__count">{own.length} 件</span>
              </div>
              {/* 時刻を決めていない照射。格子には置けないので軸の上に並べる(全列で同じ高さ)。 */}
              {hasUntimed && (
                <div className="radiotherapy-calendar__untimed">
                  {untimed.map((entry) => (
                    <FractionCard key={entry.fraction.id} entry={entry} {...handlers} />
                  ))}
                </div>
              )}
              <div className="surgery-calendar__col-body" style={{ height }}>
                {hours.map((minute) => (
                  <div
                    key={minute}
                    className="surgery-calendar__gridline"
                    style={{ top: (minute - axis.start) * PX_PER_MINUTE }}
                  />
                ))}
                {timed.map(({ entry, range }, index) => (
                  <FractionCard
                    key={entry.fraction.id}
                    entry={entry}
                    {...handlers}
                    style={{
                      top: (range.start - axis.start) * PX_PER_MINUTE,
                      height: Math.max((range.end - range.start) * PX_PER_MINUTE, 22),
                      left: `${(lanes[index].index / lanes[index].total) * 100}%`,
                      width: `${100 / lanes[index].total}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 照射 1 回ぶんのカード。1 回 15 分前後で背が低いので、1 行に「時刻・状態・患者・回」を詰める。
function FractionCard({
  entry,
  style,
  onPerform,
  onReschedule,
  onDeletePlanned,
  onView,
}: { entry: RadiotherapyCalendarEntry; style?: CSSProperties } & CardHandlers) {
  const { fraction, patient, order } = entry;
  const status = statusOf(entry);
  const summary = order ? summarizeRadiotherapyOrder(order) : undefined;
  const phase = summary?.phases.find((p) => p.phaseId === fraction.phaseId);
  const count = phase ? `${fraction.fractionNumber}/${phase.fractions}` : `${fraction.fractionNumber}回目`;

  return (
    <div
      className={
        style
          ? "surgery-calendar__card radiotherapy-calendar__card"
          : "radiotherapy-calendar__card radiotherapy-calendar__card--inline"
      }
      style={style}
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
      <span className="radiotherapy-calendar__card-line">
        <span className="surgery-calendar__card-time">{fraction.startTime}</span>
        <span className={`surgery-calendar__status is-${status.code}`}>{status.label}</span>
        <span className="surgery-calendar__card-patient-name">
          {patient ? displayName(patient) : "-"}
        </span>
        <span className="radiotherapy-calendar__card-count">{count}</span>
      </span>
      <span className="surgery-calendar__card-actions">
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
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={() => onDeletePlanned(entry)}
              >
                予定を削除
              </button>
            </>
          )}
        </RowMenu>
      </span>
    </div>
  );
}

// 週ビュー。装置 × 日で、件数と患者名を出す。日付を押すと日ビューへ降りる。
function WeekGrid({
  from,
  entries,
  columns,
  onOpenDay,
}: {
  from: string;
  entries: RadiotherapyCalendarEntry[];
  columns: Column[];
  onOpenDay: (date: string) => void;
}) {
  const dates = weekDates(from);

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
                return (
                  <td key={d} className={weekendClass(d)}>
                    {cell.length > 0 && (
                      <button
                        type="button"
                        className="radiotherapy-calendar__week-cell"
                        onClick={() => onOpenDay(d)}
                      >
                        <span className="surgery-calendar__cell-count">
                          {cell.length} 件（実施 {done.length}）
                        </span>
                        {cell.slice(0, 6).map((entry) => (
                          <span key={entry.fraction.id} className="surgery-calendar__cell-block">
                            {entry.fraction.startTime} {entry.patient ? displayName(entry.patient) : "-"}
                          </span>
                        ))}
                        {cell.length > 6 && (
                          <span className="surgery-calendar__cell-count">ほか {cell.length - 6} 件</span>
                        )}
                      </button>
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
