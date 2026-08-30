import { useMemo, useState } from "react";
import { useMealOrderMonth, usePatientEncounterEvents } from "../api/queries";
import type { EncounterEvent } from "../fhir/encounterHelpers";
import {
  MEAL_TIMING_OPTIONS,
  isMealOrderStoppedByDischarge,
  mealDayEntries,
  mealOrderDietName,
  mealOrderEnd,
  mealOrderEndReasonLabel,
  mealOrderKindLabel,
  mealOrderLink,
  mealStapleSummary,
  type MealDayEntry,
} from "../fhir/mealOrderHelpers";
import { toDateInput, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// カルテ画面の「食事」タブ。1 か月ぶんの食事を暦の形で並べる。
//
// 食事オーダーは「開始した食事から次の指示まで」続くので、一覧にすると
// 「いつ何を食べているか」が読み取りにくい。日付の器に流し込んで、続いている
// 期間がそのまま面で見えるようにする。
//
// 入院・退院・転床・外出泊の日には印を出す。食事は入院に付いて回る(入院で始まり、
// 退院で終わり、外出泊で止まる)ので、暦の上で食事の切れ目と突き合わせられる。
//
// 編集は右ペイン(MealOrderPanels)の担当。左ペインは表示と、編集を開く導線だけ持つ。

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

interface KarteMealTabProps {
  patientId: string;
  /** 食事オーダーの編集を右ペインで開く。その日に始まったオーダーだけが対象。 */
  onEdit: (srId: string) => void;
  /**
   * その日から始まる新規登録を右ペインで開く。sourceSrId はその日に出ている
   * オーダー(あれば)で、内容を引き継ぐ元になる。
   */
  onCreate: (date: string, sourceSrId?: string) => void;
}

/** その月の 1 日と末日(YYYY-MM-DD)。 */
function monthRange(month: Date): { start: string; end: string } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { start: toDateInput(start), end: toDateInput(end) };
}

/**
 * 暦に並べる日。前後の月にはみ出すぶんも埋めて、週の行が揃うようにする
 * (はみ出したマスは日付だけ薄く出し、食事は出さない)。
 */
function calendarDays(month: Date): { date: string; inMonth: boolean; weekday: number }[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days: { date: string; inMonth: boolean; weekday: number }[] = [];

  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - first.getDay());
  const endCursor = new Date(last);
  endCursor.setDate(endCursor.getDate() + (6 - last.getDay()));

  while (cursor <= endCursor) {
    days.push({
      date: toDateInput(cursor),
      inMonth: cursor.getMonth() === month.getMonth(),
      weekday: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function KarteMealTab({ patientId, onEdit, onCreate }: KarteMealTabProps) {
  // 月は Date で持つ(月送りが月末日に引っ張られないよう常に 1 日を指す)。
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const { start, end } = monthRange(month);
  const orders = useMealOrderMonth(patientId, start, end);
  const events = usePatientEncounterEvents(patientId, start, end);
  const days = useMemo(() => calendarDays(month), [month]);
  const rows = orders.data ?? [];

  const todayDate = today();
  const monthLabel = `${month.getFullYear()}年${month.getMonth() + 1}月`;

  function shiftMonth(delta: number) {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>食事</h3>
        <div className="meal-calendar__toolbar">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="前の月">
            ‹
          </button>
          <span className="meal-calendar__month">{monthLabel}</span>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="次の月">
            ›
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            今月
          </button>
        </div>
      </div>

      <ErrorBanner error={orders.error ?? events.error} />

      {orders.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="meal-calendar">
            {WEEKDAY_LABELS.map((label, index) => (
              <div
                key={label}
                className={`meal-calendar__weekday${weekendClass(index)}`}
                aria-hidden="true"
              >
                {label}
              </div>
            ))}
            {days.map((day) => (
              <MealDayCell
                key={day.date}
                date={day.date}
                inMonth={day.inMonth}
                weekday={day.weekday}
                isToday={day.date === todayDate}
                // 月外のマスは日付だけ出す(前後の月を開けばそこで見られる)。
                entries={day.inMonth ? mealDayEntries(rows, day.date) : []}
                events={day.inMonth ? eventsOn(events.data ?? [], day.date) : []}
                onEdit={onEdit}
                onCreate={onCreate}
              />
            ))}
          </div>
          {rows.length === 0 && (
            <p className="patient-table__empty">この月にかかる食事オーダーはありません。</p>
          )}
        </>
      )}
    </div>
  );
}

function eventsOn(events: EncounterEvent[], date: string): EncounterEvent[] {
  return events.filter((event) => event.date === date);
}

function weekendClass(weekday: number): string {
  if (weekday === 0) return " meal-calendar__cell--sunday";
  if (weekday === 6) return " meal-calendar__cell--saturday";
  return "";
}

/**
 * 暦の 1 マス。マスごとボタンで、押したときの行き先はその日の性格で決まる。
 *
 * - **オーダーが始まった日**(「変更」の印が付く日) → そのオーダーの編集(更新)
 * - **それ以外の日** → その日から始まる新規登録。その日に出ているオーダーがあれば
 *   内容を引き継ぐ(= その日からの食事変更)
 *
 * オーダーは自分が始まった日のマスからだけ直せる、という分かりやすい対応になる。
 * 続いている途中の日を押したときに元のオーダーを直してしまう(遡って変わってしまう)
 * 事故も起きない。月外のマスは週の行を揃えるための器なので押せない。
 */
function MealDayCell({
  date,
  inMonth,
  weekday,
  isToday,
  entries,
  events,
  onEdit,
  onCreate,
}: {
  date: string;
  inMonth: boolean;
  weekday: number;
  isToday: boolean;
  entries: MealDayEntry[];
  /** その日の入退院・移動。食事の切れ目と見比べるための印で、押す先には関わらない。 */
  events: EncounterEvent[];
  onEdit: (srId: string) => void;
  onCreate: (date: string, sourceSrId?: string) => void;
}) {
  const dayNumber = Number(date.slice(8, 10));
  // その日に始まったオーダー。あればこのマスは更新モードになる。
  const startingOrder = entries.find(
    (entry) => (entry.order.occurrenceDateTime ?? "").slice(0, 10) === date,
  )?.order;
  const className = [
    "meal-calendar__cell",
    inMonth ? "" : "meal-calendar__cell--outside",
    isToday ? "meal-calendar__cell--today" : "",
    weekendClass(weekday).trim(),
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="meal-calendar__day">
        <span className="meal-calendar__day-number">{dayNumber}</span>
      </div>
      {events.map((event, index) => (
        <span
          key={`${event.kind}-${index}`}
          className={`meal-calendar__event meal-calendar__event--${event.kind}`}
          title={event.detail ? `${event.label}: ${event.detail}` : event.label}
        >
          <span className="meal-calendar__event-label">{event.label}</span>
          {event.detail && <span className="meal-calendar__event-detail">{event.detail}</span>}
        </span>
      ))}
      {entries.map((entry) => (
        <MealEntryBlock key={entry.order.id ?? ""} entry={entry} date={date} />
      ))}
    </>
  );

  if (!inMonth) return <div className={className}>{body}</div>;

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (startingOrder?.id) onEdit(startingOrder.id);
        // 続いている途中の日は、その日に出ている食事の内容を引き継いで登録する。
        else onCreate(date, entries[0]?.order.id);
      }}
      title={
        startingOrder
          ? `${monthDayLabel(date)} の食事オーダーを編集`
          : entries.length > 0
            ? `${monthDayLabel(date)} から食事を登録(この日の内容を引き継ぐ)`
            : `${monthDayLabel(date)} から食事を登録`
      }
    >
      {body}
    </button>
  );
}

/**
 * 1 マスの中の 1 オーダー。押す先はマス全体で決まるので、ここは表示だけ。
 * その日に始まったオーダーには種別(開始 / 変更 / 再開 / 外泊食止め)の印を、
 * 退院(予定)で止められたオーダーの最後の日には「退院食止め」の印を付ける。
 */
function MealEntryBlock({ entry, date }: { entry: MealDayEntry; date: string }) {
  const { order, timings } = entry;
  const startsToday = (order.occurrenceDateTime ?? "").slice(0, 10) === date;
  const endsToday = mealOrderEnd(order).slice(0, 10) === date;
  const dischargeStop = endsToday && isMealOrderStoppedByDischarge(order);
  const kind = mealOrderLink(order)?.kind ?? "change";
  const staple = mealStapleSummary(order, timings);
  // 1 日を通して同じオーダーなら食事の見出しは出さない(3 食ぶんと分かるため)。
  const partial = timings.length < MEAL_TIMING_OPTIONS.length;

  return (
    <div className={`meal-calendar__entry${startsToday ? " meal-calendar__entry--changed" : ""}`}>
      {startsToday && (
        <span className={`meal-calendar__changed-badge meal-calendar__changed-badge--${kind}`}>
          {mealOrderKindLabel(order)}
        </span>
      )}
      {dischargeStop && (
        <span className="meal-calendar__changed-badge meal-calendar__changed-badge--discharge">
          {mealOrderEndReasonLabel(order)}
        </span>
      )}
      <span className="meal-calendar__diet">{mealOrderDietName(order) || "(食種なし)"}</span>
      {/* 途中で食事が変わった日は、このオーダーが担当する食事を明示する。 */}
      {partial && (
        <span className="meal-calendar__timings">
          {timings.map((timing) => timingDisplay(timing)).join("・")}
        </span>
      )}
      {staple.stapleName && <span className="meal-calendar__staple">{staple.stapleName}</span>}
      {staple.stapleLines.map((line) => (
        <span className="meal-calendar__staple" key={line.timingDisplay}>
          {line.timingDisplay} {line.text}
        </span>
      ))}
    </div>
  );
}

function timingDisplay(timing: string): string {
  return MEAL_TIMING_OPTIONS.find((t) => t.code === timing)?.display ?? "";
}

/** 「8/28」。 */
function monthDayLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}
