import { useEffect, useMemo, useState, type DragEvent } from "react";
import { usePatientEncounterEvents, useRegimenAdverseEvents, useRegimenApplications, useRegimenDayOrders } from "../api/queries";
import type { EncounterEvent } from "../fhir/encounterHelpers";
import {
  cycleDayLabel,
  cyclePositionOf,
  cycleStartDates,
  nextCycleOf,
  dayOrderDrugNames,
  dayOrderStepNames,
  regimenDayStatusLabel,
  regimenStatusLabel,
  type CyclePosition,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import { toDateInput, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { RegimenDetailView } from "./RegimenDetailView";
import { RegimenHistoryView } from "./RegimenHistoryView";
import { RegimenMoveModal } from "./RegimenPanels";

// カルテ画面の「化学療法」タブ。適用中のレジメンの投与スケジュールを月の暦で見る。
//
// 食事タブと同じ器(月送り + 7 列の暦)。1 マスにはその日の日オーダー(注射・処方)を
// 「C1 Day8」の印と薬剤名で並べる。適用が複数あるときはヘッダのタブで切り替える
// (1 つの暦に 2 レジメンを重ねると、どちらの Day かが読めない)。
//
// 操作(適用・次クール・移動・中止・編集)は右ペインの担当。暦は表示と導線だけ持つ。

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
/** 暦の 1 マスに出すステップの上限。 */
const MAX_STEPS_IN_CELL = 3;

/** 左ペインの中の切り替え。暦と、適用そのものの詳細。 */
const CHEMO_VIEWS = [
  { key: "", label: "カレンダー" },
  { key: "detail", label: "レジメン詳細" },
  // 患者の全適用を並べる面(§7.6 C-4)。暦と詳細は 1 つの適用を読む面。
  { key: "history", label: "治療歴" },
] as const;

interface KarteChemoTabProps {
  patientId: string;
  /** URL から渡される表示。"detail" ならレジメン詳細、空なら暦。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /** 次クールの登録を右ペインで開く。 */
  onAddCycle: (regimenSrId: string) => void;
  /** 暦の 1 日(その日のオーダーの操作)を右ペインで開く。 */
  onOpenDay: (regimenSrId: string, date: string) => void;
  /** クールの有害事象の記録を右ペインで開く。 */
  onOpenAdverseEvents: (regimenSrId: string, cycle: number) => void;
  /** 適用のヘッダの編集を右ペインで開く。 */
  onEditHeader: (regimenSrId: string) => void;
}

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

function monthRange(month: Date): { start: string; end: string } {
  return {
    start: toDateInput(new Date(month.getFullYear(), month.getMonth(), 1)),
    end: toDateInput(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  };
}

function monthOf(date: string): Date {
  const [y, m] = date.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function KarteChemoTab({
  patientId,
  view,
  onViewChange,
  onAddCycle,
  onOpenDay,
  onOpenAdverseEvents,
  onEditHeader,
}: KarteChemoTabProps) {
  const applications = useRegimenApplications(patientId);
  const adverseEvents = useRegimenAdverseEvents(patientId);
  const list = applications.data?.applications ?? [];
  // 適用中を先に、同じ状態なら新しい開始日を先に。
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => {
        const rank = (s: string) => (s === "active" || s === "on-hold" ? 0 : 1);
        return rank(a.status) - rank(b.status) || b.startDate.localeCompare(a.startDate);
      }),
    [list],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: RegimenApplication | null =
    sorted.find((a) => a.id === selectedId) ?? sorted[0] ?? null;

  const instanceIds = useMemo(() => list.map((a) => a.instanceId), [list]);
  const orders = useRegimenDayOrders(patientId, instanceIds);
  const own = useMemo(
    () => (orders.data ?? []).filter((o) => o.ref.regimenSrId === selected?.id),
    [orders.data, selected?.id],
  );
  // 中止はヘッダの ServiceRequest をそのまま書き換えるので、生のリソースも要る。
  const selectedHeader = applications.data?.headers.find((h) => h.id === selected?.id) ?? null;
  const isDetail = view === "detail";
  const isHistory = view === "history";

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // 選んだ適用を変えたら、その開始月(過去なら今月)へ暦を合わせる。
  useEffect(() => {
    if (!selected) return;
    const start = monthOf(selected.startDate);
    const now = new Date();
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    setMonth(start > current ? start : current);
  }, [selected?.id, selected?.startDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const { start, end } = monthRange(month);
  const events = usePatientEncounterEvents(patientId, start, end);
  const days = useMemo(() => calendarDays(month), [month]);
  const byDate = useMemo(() => {
    const map = new Map<string, RegimenDayOrder[]>();
    for (const order of own) map.set(order.date, [...(map.get(order.date) ?? []), order]);
    return map;
  }, [own]);

  // 次に登録するクール(暦のツールバーの登録ボタン)。予定クール数に達したら止める。
  const nextCycle = selected ? nextCycleOf(selected, own) : { cycle: 1, startDate: "" };
  const reachedPlanned =
    selected?.plannedCycles !== null &&
    selected !== null &&
    nextCycle.cycle > (selected.plannedCycles ?? 0);

  // 休薬期間を暦に出すため、登録済みのクールから「その日がクールのどこか」を引く。
  const cycleStarts = useMemo(() => cycleStartDates(own), [own]);
  const positionOf = (date: string): CyclePosition | null =>
    selected ? cyclePositionOf(date, cycleStarts, selected.cycleDays, selected.treatmentDays) : null;

  // ドラッグ＆ドロップで投与日を動かす。掴んでいる日・かざしている先・落とした後の確認。
  // 暦は表示に徹する方針だが、「日を掴んで別の日に落とす」は暦でしかできない操作なので
  // ここだけ持つ(実際の書き込みは確認モーダルが行う)。
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ from: string; to: string } | null>(null);

  function handleDrop(to: string) {
    const from = dragFrom;
    setDragFrom(null);
    setDragOver(null);
    if (!from || from === to) return;
    setPendingMove({ from, to });
  }

  const todayDate = today();
  const monthLabel = `${month.getFullYear()}年${month.getMonth() + 1}月`;

  function shiftMonth(delta: number) {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <div className="karte-tabpanel__title">
          <h3>化学療法</h3>
          {/* 暦と詳細は「その適用を読む」同じ面なので、右ペインに出し分けず左ペインで切り替える。 */}
          <div className="chemo-views" role="tablist" aria-label="表示">
            {CHEMO_VIEWS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={view === item.key}
                className={`chemo-views__tab${view === item.key ? " chemo-views__tab--active" : ""}`}
                onClick={() => onViewChange(item.key || null)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ErrorBanner error={applications.error ?? orders.error ?? events.error} />

      {sorted.length > 0 && !isHistory && (
        <div className="chemo-calendar__regimens" role="tablist" aria-label="適用中のレジメン">
          {sorted.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={a.id === selected?.id}
              className={`chemo-calendar__regimen${a.id === selected?.id ? " chemo-calendar__regimen--active" : ""}${
                a.status !== "active" ? " chemo-calendar__regimen--inactive" : ""
              }`}
              onClick={() => setSelectedId(a.id)}
            >
              {a.name}
              {a.status !== "active" && (
                <span className="chemo-calendar__regimen-status">{regimenStatusLabel(a.status)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && !isDetail && !isHistory && (
        <div className="chemo-calendar__summary">
          <span>
            開始 {selected.startDate}
            {selected.cycleDays > 0 ? ` · ${selected.cycleDays} 日/クール` : ""}
            {selected.plannedCycles !== null ? ` · 予定 ${selected.plannedCycles} クール` : " · 継続"}
          </span>
        </div>
      )}

      {isHistory ? (
        applications.isPending ? (
          <p>読み込み中...</p>
        ) : (
          <RegimenHistoryView
            applications={list}
            orders={orders.data ?? []}
            onSelect={(id) => {
              setSelectedId(id);
              onViewChange("detail");
            }}
          />
        )
      ) : isDetail ? (
        selected && selectedHeader ? (
          <RegimenDetailView
            application={selected}
            header={selectedHeader}
            orders={own}
            error={orders.error}
            adverseEvents={adverseEvents.data ?? []}
            onOpenDay={(date) => onOpenDay(selected.id, date)}
            onAddCycle={() => onAddCycle(selected.id)}
            onOpenAdverseEvents={(cycle) => onOpenAdverseEvents(selected.id, cycle)}
            onEditHeader={() => onEditHeader(selected.id)}
          />
        ) : (
          <p className="patient-table__empty">適用されたレジメンはありません。右ペインの「化学療法」から始めます。</p>
        )
      ) : (
        renderCalendar()
      )}
    </div>
  );

  /** 暦の本体。表示の切り替えで丸ごと入れ替わる。 */
  function renderCalendar() {
    return (
      <>
      <div className="meal-calendar__toolbar chemo-calendar__toolbar">
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
        {/* 次クールの登録は暦を見ながら決めるので、月送りと同じ行の右端に置く
            (レジメン詳細にも同じ入口がある)。 */}
        {selected && selected.status === "active" && (
          <button
            type="button"
            className="chemo-calendar__add-cycle"
            onClick={() => onAddCycle(selected.id)}
            disabled={reachedPlanned}
          >
            第 {nextCycle.cycle} クールを登録
          </button>
        )}
      </div>

      {applications.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="meal-calendar chemo-calendar">
            {WEEKDAY_LABELS.map((label, index) => (
              <div key={label} className={`meal-calendar__weekday${weekendClass(index)}`} aria-hidden="true">
                {label}
              </div>
            ))}
            {days.map((day) => (
              <ChemoDayCell
                key={day.date}
                date={day.date}
                inMonth={day.inMonth}
                weekday={day.weekday}
                isToday={day.date === todayDate}
                orders={day.inMonth ? (byDate.get(day.date) ?? []) : []}
                position={day.inMonth ? positionOf(day.date) : null}
                events={day.inMonth ? eventsOn(events.data?.events ?? [], day.date) : []}
                onOpen={selected ? () => onOpenDay(selected.id, day.date) : undefined}
                dragging={dragFrom === day.date}
                dropTarget={dragFrom !== null && dragOver === day.date && dragFrom !== day.date}
                canDrop={dragFrom !== null && day.inMonth && dragFrom !== day.date}
                onDragStart={() => setDragFrom(day.date)}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragOver={() => setDragOver(day.date)}
                onDrop={() => handleDrop(day.date)}
              />
            ))}
          </div>
          {pendingMove && (
            <RegimenMoveModal
              patientId={patientId}
              from={pendingMove.from}
              to={pendingMove.to}
              todays={own.filter((o) => o.date === pendingMove.from)}
              following={own.filter((o) => o.date > pendingMove.from)}
              onClose={() => setPendingMove(null)}
              onDone={() => setPendingMove(null)}
            />
          )}
          {sorted.length === 0 && (
            <p className="patient-table__empty">適用されたレジメンはありません。右ペインの「化学療法」から始めます。</p>
          )}
        </>
      )}
      </>
    );
  }
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
 * 暦の 1 マス。オーダーのある日はボタンで、押すと右ペインにその日の操作が開く。
 * オーダーの無い日は押せない(暦から直接オーダーを足す操作は無く、クールの追加は
 * 詳細パネルから行う)。クールの中の日には「C1 Day5」を、投与期間を過ぎた日には
 * 休薬の地を敷いて、治療の周期が面で読めるようにする。
 */
function ChemoDayCell({
  date,
  inMonth,
  weekday,
  isToday,
  orders,
  position,
  events,
  onOpen,
  dragging,
  dropTarget,
  canDrop,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  date: string;
  inMonth: boolean;
  weekday: number;
  isToday: boolean;
  orders: RegimenDayOrder[];
  position: CyclePosition | null;
  events: EncounterEvent[];
  onOpen?: () => void;
  /** このマスを掴んでいる(元の位置)。 */
  dragging: boolean;
  /** 掴んだ日をこのマスにかざしている。 */
  dropTarget: boolean;
  /** 落とせるマスか(月内で、掴んだ日と別の日)。 */
  canDrop: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const dayNumber = Number(date.slice(8, 10));
  const first = orders[0];
  const isDay1 = orders.some((o) => o.ref.day === 1) || position?.day === 1;
  const label = first ? cycleDayLabel(first.ref) : position ? cycleDayLabel(position) : "";
  // 実施済しか無い日は動かせない(済んだ事実)。中止済は動かせる。
  const draggable = orders.some((o) => o.status !== "completed");
  const className = [
    "meal-calendar__cell",
    "chemo-calendar__cell",
    inMonth ? "" : "meal-calendar__cell--outside",
    isToday ? "meal-calendar__cell--today" : "",
    isDay1 ? "chemo-calendar__cell--day1" : "",
    position?.rest ? "chemo-calendar__cell--rest" : "",
    dragging ? "chemo-calendar__cell--dragging" : "",
    dropTarget ? "chemo-calendar__cell--drop-target" : "",
    weekendClass(weekday).trim(),
  ]
    .filter(Boolean)
    .join(" ");

  // 落とす側。HTML5 の D&D は dragover で preventDefault しないと drop が来ない。
  const dropHandlers = canDrop
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOver();
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          onDrop();
        },
      }
    : {};

  const body = (
    <>
      <div className="meal-calendar__day">
        <span className="meal-calendar__day-number">{dayNumber}</span>
        {label && (
          <span className={`chemo-calendar__cycle-day${orders.length === 0 ? " chemo-calendar__cycle-day--quiet" : ""}`}>
            {label}
          </span>
        )}
      </div>
      {position?.rest && orders.length === 0 && <span className="chemo-calendar__rest">休薬</span>}
      {events.map((event, index) => (
        <span
          key={`${event.kind}-${index}`}
          className={`meal-calendar__event meal-calendar__event--${event.kind}`}
          title={event.detail ? `${event.label}: ${event.detail}` : event.label}
        >
          <span className="meal-calendar__event-label">{event.label}</span>
        </span>
      ))}
      {orders.map((order) => (
        <div
          key={order.serviceRequest.id}
          className={`chemo-calendar__order chemo-calendar__order--${order.status}`}
          title={dayOrderDrugNames(order).join(" / ")}
        >
          {/* 注射か内服かはマスに出さない(ステップ名で読める)。進捗は依頼済のときだけ省く。 */}
          {order.status !== "requested" && (
            <span className="chemo-calendar__order-head">
              <span className="chemo-calendar__status">{regimenDayStatusLabel(order.status)}</span>
            </span>
          )}
          {/* 薬剤名を並べても幅に収まらないので、医師が組んだ単位であるステップ名を出す。
              縦に伸びすぎないよう 3 つまでで、残りは件数にする。 */}
          {dayOrderStepNames(order)
            .slice(0, MAX_STEPS_IN_CELL)
            .map((name, i) => (
              <span key={i} className="chemo-calendar__step">
                {name}
              </span>
            ))}
          {dayOrderStepNames(order).length > MAX_STEPS_IN_CELL && (
            <span className="chemo-calendar__step chemo-calendar__step--more">
              他 {dayOrderStepNames(order).length - MAX_STEPS_IN_CELL} 件
            </span>
          )}
        </div>
      ))}
    </>
  );

  if (!inMonth || orders.length === 0 || !onOpen) {
    return (
      <div className={className} {...dropHandlers}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onOpen}
      title={draggable ? `${date} のオーダーを開く(ドラッグで移動)` : `${date} のオーダーを開く`}
      draggable={draggable}
      onDragStart={(e) => {
        // Firefox はデータを置かないとドラッグが始まらない。
        e.dataTransfer.setData("text/plain", date);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      {...dropHandlers}
    >
      {body}
    </button>
  );
}
