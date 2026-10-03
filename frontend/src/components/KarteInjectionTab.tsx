import { useMemo, useState, type MouseEvent } from "react";
import { usePatientInjectionOrders } from "../api/queries";
import {
  buildInjectionCalendar,
  calendarDates,
  INJECTION_SLOT_SYMBOLS,
  injectionSlotSymbol,
  type InjectionCalendarEntry,
  type InjectionCalendarRow,
} from "../fhir/injectionCalendarHelpers";
import { canCancelInjection, injectionTaskStatus, injectionTasksByOrderId } from "../fhir/injectionTaskHelpers";
import { referenceId } from "../fhir/shared";
import { addDays, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionCancelModal } from "./InjectionCancelModal";
import { InjectionContinueModal } from "./InjectionContinueModal";
import { InjectionDayModal } from "./InjectionDayModal";
import { RowMenu } from "./RowMenu";

// カルテ画面の「注射カレンダー」タブ。docs/injection-order-design.md §9。
//
// 「RP × 日付(2 週間)」の表で、各日の注射の予定・進捗・実施を並べる。表から直接
// 指示を出し入れできるようにする:
//   - 注射のマス … モーダルでその日の注射(予定と実施の見比べ、実施・変更・中止・削除・複写)
//   - 空きのマス … 選ぶ(Shift で同じ行の範囲)と、ツールバーの「複写」「新規」がその日付で開く
//   - 行のメニュー … 「継続」(束ねを延ばす)と「中止」(表示中の次の未実施日から以降すべて)
// 登録・変更の入力は他のオーダーと同じ右ペインのフォームで行う。
//
// 進捗は施用 1 回ごとに記号で出し、記号の意味はツールバーの下に凡例として並べる。

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
/** 表示する日数。 */
const CALENDAR_DAYS = 14;
/** 既定の表示開始日は今日の何日前か(過去 1 週間と先 1 週間を並べる)。 */
const DEFAULT_LOOKBACK = 6;

interface KarteInjectionTabProps {
  patientId: string;
  /** URL から渡される表示開始日(YYYY-MM-DD)。空なら既定。 */
  view: string;
  onViewChange?: (view: string | null) => void;
  /** 変更。右ペインでその日の注射の編集を開く。 */
  onEdit: (srId: string) => void;
  /** 新規・複写。右ペインの登録を、期間と(複写なら)元のオーダーを初期値にして開く。 */
  onCreate: (startDate: string, endDate: string, sourceSrId?: string) => void;
}

interface Selection {
  rowKey: string;
  anchor: string;
  from: string;
  to: string;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function weekendClass(weekday: number): string {
  if (weekday === 0) return " injection-calendar__day--sunday";
  if (weekday === 6) return " injection-calendar__day--saturday";
  return "";
}

export function KarteInjectionTab({ patientId, view, onViewChange, onEdit, onCreate }: KarteInjectionTabProps) {
  const todayDate = today();
  // タブの外(別ペイン)から使うときは URL に載せずローカルに持つ。
  const [localView, setLocalView] = useState("");
  const viewValue = onViewChange ? view : localView;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(viewValue) ? viewValue : addDays(todayDate, -DEFAULT_LOOKBACK);
  const setStart = (next: string | null) => {
    if (onViewChange) onViewChange(next);
    else setLocalView(next ?? "");
  };
  const [dayTarget, setDayTarget] = useState<{ srId: string; compareSrId?: string } | null>(null);

  const dates = useMemo(() => calendarDates(start, CALENDAR_DAYS), [start]);
  const end = dates[dates.length - 1];
  const query = usePatientInjectionOrders(patientId, start, end);
  const rows = useMemo(() => (query.data ? buildInjectionCalendar(query.data, dates) : []), [query.data, dates]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [continueRow, setContinueRow] = useState<InjectionCalendarRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ order: fhir4.ServiceRequest; task?: fhir4.Task } | null>(null);

  const orderById = (id: string) => query.data?.orders.find((sr) => sr.id === id);
  const mrsOf = (id: string) =>
    (query.data?.medicationRequests ?? []).filter((mr) => referenceId(mr.basedOn?.[0]?.reference) === id);
  const tasksByOrderId = useMemo(() => injectionTasksByOrderId(query.data?.tasks ?? []), [query.data?.tasks]);

  function shift(days: number) {
    setSelection(null);
    setStart(addDays(start, days));
  }

  function selectEmpty(row: InjectionCalendarRow, date: string, event: MouseEvent) {
    if (event.shiftKey && selection?.rowKey === row.key) {
      const [from, to] = date < selection.anchor ? [date, selection.anchor] : [selection.anchor, date];
      setSelection({ ...selection, from, to });
      return;
    }
    if (selection?.rowKey === row.key && selection.from === date && selection.to === date) {
      setSelection(null);
      return;
    }
    setSelection({ rowKey: row.key, anchor: date, from: date, to: date });
  }

  /** 複写の元。選んだ範囲より前で最も近い日の注射(無ければ行の最後の注射)。 */
  function copySource(row: InjectionCalendarRow, from: string): string {
    const before = [...row.cells.entries()]
      .filter(([date]) => date < from)
      .sort(([a], [b]) => b.localeCompare(a))
      .flatMap(([, entries]) => entries.filter((e) => !e.regimen));
    return before[0]?.srId ?? row.lastOrderId;
  }

  const selectedRow = selection ? rows.find((row) => row.key === selection.rowKey) : undefined;
  const copyFrom = selection && selectedRow ? copySource(selectedRow, selection.from) : "";

  /** 行の「中止」の起点。表示中で今日以降の、まだ中止・実施していない最初の日。 */
  function cancelStart(row: InjectionCalendarRow): InjectionCalendarEntry | undefined {
    return [...row.cells.entries()]
      .filter(([date]) => date >= todayDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, entries]) => entries)
      .find((entry) => !entry.regimen && canCancelInjection(injectionTaskStatus(tasksByOrderId.get(entry.srId))));
  }

  return (
    <div className="karte-tabpanel injection-calendar-panel">
      <div className="karte-tabpanel__header">
        <div className="karte-tabpanel__title">
          <h3>注射カレンダー</h3>
        </div>
      </div>

      <div className="injection-calendar__toolbar">
        <button
          type="button"
          className="patient-chart__step"
          onClick={() => shift(-7)}
          title="前の週"
          aria-label="前の週"
        >
          ◀
        </button>
        <span className="injection-calendar__range">{`${start}〜${end}`}</span>
        <button
          type="button"
          className="patient-chart__step"
          onClick={() => shift(7)}
          title="次の週"
          aria-label="次の週"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => {
            setSelection(null);
            setStart(null);
          }}
        >
          今日
        </button>
        <span className="injection-calendar__actions">
          <button
            type="button"
            disabled={!copyFrom}
            onClick={() => {
              if (!selection) return;
              setSelection(null);
              onCreate(selection.from, selection.to, copyFrom);
            }}
          >
            複写
          </button>
          <button
            type="button"
            onClick={() => {
              setSelection(null);
              onCreate(selection?.from ?? todayDate, selection?.to ?? todayDate);
            }}
          >
            新規
          </button>
        </span>
      </div>

      <ul className="injection-calendar__legend" aria-label="凡例">
        {INJECTION_SLOT_SYMBOLS.map((item) => (
          <li key={item.status}>
            <span className={`injection-calendar__symbol injection-calendar__symbol--${item.status}`}>
              {item.symbol}
            </span>
            {item.label}
          </li>
        ))}
        <li>
          <span className="injection-calendar__extra">+</span>
          予定外の実施
        </li>
        <li>
          <span className="injection-calendar__mark injection-calendar__mark--changed">変</span>
          内容変更
        </li>
        <li>
          <span className="injection-calendar__mark injection-calendar__mark--dose">量</span>
          実施量が指示と違う
        </li>
      </ul>

      <ErrorBanner error={query.error} />

      {query.isPending ? (
        <p>読み込み中...</p>
      ) : (
        <div className="injection-calendar">
          <table className="injection-calendar__table">
            <thead>
              <tr>
                <th className="injection-calendar__head">注射</th>
                {dates.map((date) => (
                  <th
                    key={date}
                    className={`injection-calendar__day${weekendClass(weekdayOf(date))}${
                      date === todayDate ? " injection-calendar__day--today" : ""
                    }`}
                  >
                    <span>{`${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`}</span>
                    <span className="injection-calendar__weekday">{WEEKDAY_LABELS[weekdayOf(date)]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cancelEntry = cancelStart(row);
                return (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className={`injection-calendar__head${row.indent ? " injection-calendar__head--indent" : ""}`}
                    >
                      <div className="injection-calendar__head-body">
                        <div className="injection-calendar__label">
                          {row.medicines.map((name, index) => (
                            <span key={`${name}-${index}`} className="injection-calendar__name" title={name}>
                              {name}
                            </span>
                          ))}
                          <span className="injection-calendar__usage" title={row.usage}>
                            {[row.usage, row.note].filter(Boolean).join(" ")}
                          </span>
                        </div>
                        {row.lastOrderId && (
                          <RowMenu label={`${row.label} の操作`} escapesClipping>
                            <button type="button" className="row-menu__item" onClick={() => setContinueRow(row)}>
                              継続
                            </button>
                            <button
                              type="button"
                              className="row-menu__item"
                              disabled={!cancelEntry}
                              onClick={() => {
                                const order = cancelEntry && orderById(cancelEntry.srId);
                                if (order) setCancelTarget({ order, task: tasksByOrderId.get(cancelEntry.srId) });
                              }}
                            >
                              中止
                            </button>
                          </RowMenu>
                        )}
                      </div>
                    </th>
                    {dates.map((date) => {
                      const entries = row.cells.get(date) ?? [];
                      const selected =
                        selection?.rowKey === row.key && date >= selection.from && date <= selection.to;
                      const className = `injection-calendar__cell${weekendClass(weekdayOf(date))}${
                        date === todayDate ? " injection-calendar__cell--today" : ""
                      }${selected ? " injection-calendar__cell--selected" : ""}`;
                      if (entries.length === 0) {
                        return (
                          <td key={date} className={className}>
                            <button
                              type="button"
                              className="injection-calendar__empty"
                              aria-label={`${date} を選ぶ`}
                              aria-pressed={selected}
                              onClick={(event) => selectEmpty(row, date, event)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={date} className={className}>
                          {entries.map((entry) => (
                            <CalendarEntry
                              key={entry.srId}
                              entry={entry}
                              onOpen={() => {
                                setSelection(null);
                                setDayTarget({ srId: entry.srId, compareSrId: entry.compareSrId });
                              }}
                            />
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="patient-table__empty">この期間の注射はありません。</p>}
        </div>
      )}

      {dayTarget && (
        <InjectionDayModal
          patientId={patientId}
          srId={dayTarget.srId}
          compareSrId={dayTarget.compareSrId}
          onEdit={(srId) => {
            setDayTarget(null);
            onEdit(srId);
          }}
          onCopy={(sourceSrId, startDate) => {
            setDayTarget(null);
            onCreate(startDate, startDate, sourceSrId);
          }}
          onClose={() => setDayTarget(null)}
        />
      )}
      {continueRow && orderById(continueRow.lastOrderId) && (
        <InjectionContinueModal
          patientId={patientId}
          order={orderById(continueRow.lastOrderId) as fhir4.ServiceRequest}
          medicationRequests={mrsOf(continueRow.lastOrderId)}
          onClose={() => setContinueRow(null)}
        />
      )}
      {cancelTarget && (
        <InjectionCancelModal
          serviceRequest={cancelTarget.order}
          task={cancelTarget.task}
          mode="cancel"
          onClose={() => setCancelTarget(null)}
          onDone={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * マスの中の注射 1 件。予定の開始時刻ごとに進捗の記号を並べ、量の違い・内容の変更の印を添える。
 * 終了時刻・実施時刻まで並べると列が広がり 2 週間が収まらないので、title とモーダルに回す。
 */
function CalendarEntry({ entry, onOpen }: { entry: InjectionCalendarEntry; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`injection-calendar__entry injection-calendar__entry--${entry.status}`}
      title={entry.title}
      onClick={onOpen}
    >
      {entry.slots.map((slot, index) => {
        // 実施した回は実施の時刻を出す(予定の時刻は title)。予定を超えた回は時刻の直後に「+」を付ける。
        const time = slot.performedStart || slot.time;
        return (
          <span
            key={`${slot.time}-${index}`}
            className={`injection-calendar__slot${slot.extra ? " injection-calendar__slot--extra" : ""}`}
          >
            <span className={`injection-calendar__symbol injection-calendar__symbol--${slot.status}`}>
              {injectionSlotSymbol(slot.status)}
            </span>
            {(time || slot.extra) && (
              <span
                className={`injection-calendar__time${
                  slot.performedStart ? " injection-calendar__time--performed" : ""
                }`}
              >
                {time}
                {slot.extra && <span className="injection-calendar__extra">+</span>}
              </span>
            )}
          </span>
        );
      })}
      {(entry.changed || entry.doseDiffers) && (
        <span className="injection-calendar__marks">
          {entry.changed && <span className="injection-calendar__mark injection-calendar__mark--changed">変</span>}
          {entry.doseDiffers && <span className="injection-calendar__mark injection-calendar__mark--dose">量</span>}
        </span>
      )}
    </button>
  );
}
