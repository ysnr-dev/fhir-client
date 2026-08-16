import {
  formatDateLabel,
  slotStatusLabel,
  weekDates,
  type SlotCalendarRow,
} from "../fhir/scheduleHelpers";

// 枠(Slot)の週表示。列 = 曜日、行 = 開始時刻。行に出るのはその週に実在する
// 開始時刻だけなので、午前だけの枠表なら午前の行しか並ばない。
//
// セルをクリックすると選択に入り、停止・再開・削除は選んだ枠にまとめて効かせる。
// 予約の入った枠(busy / busy-tentative)は選べない —— 枠を消す前に予約を取り消す
// 必要があり、予約の取消はこの画面の担当ではないため。

interface SlotCalendarProps {
  rows: SlotCalendarRow[];
  weekStartISO: string;
  selectedIds: ReadonlySet<string>;
  onToggle: (slot: fhir4.Slot) => void;
}

export function SlotCalendar({ rows, weekStartISO, selectedIds, onToggle }: SlotCalendarProps) {
  const dates = weekDates(weekStartISO);

  if (rows.length === 0) {
    return (
      <p className="patient-table__empty">
        この週には枠がありません。「枠を一括生成」で作成してください。
      </p>
    );
  }

  return (
    <div className="slot-calendar__wrap">
      <table className="slot-calendar">
        <thead>
          <tr>
            <th className="slot-calendar__time-col">時刻</th>
            {dates.map((date) => (
              <th key={date} className={weekendClass(date)}>
                {formatDateLabel(date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.time}>
              <th className="slot-calendar__time-col">{row.time}</th>
              {row.cells.map((cell) => (
                <td key={cell.date} className={weekendClass(cell.date)}>
                  {cell.slot ? (
                    <SlotCell
                      slot={cell.slot}
                      selected={Boolean(cell.slot.id && selectedIds.has(cell.slot.id))}
                      onToggle={onToggle}
                    />
                  ) : (
                    <span className="slot-calendar__empty">-</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlotCell({
  slot,
  selected,
  onToggle,
}: {
  slot: fhir4.Slot;
  selected: boolean;
  onToggle: (slot: fhir4.Slot) => void;
}) {
  const booked = slot.status === "busy" || slot.status === "busy-tentative";
  const className = [
    "slot-calendar__slot",
    `slot-calendar__slot--${slot.status}`,
    selected ? "slot-calendar__slot--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onClick={() => onToggle(slot)}
      disabled={booked}
      title={booked ? "予約が入っているため操作できません" : undefined}
      aria-pressed={selected}
    >
      {slotStatusLabel(slot.status)}
    </button>
  );
}

// 土日は列の背景を変えて週の区切りを見やすくする。
function weekendClass(dateISO: string): string {
  const weekday = new Date(`${dateISO}T00:00:00`).getDay();
  if (weekday === 0) return "slot-calendar__col--sunday";
  if (weekday === 6) return "slot-calendar__col--saturday";
  return "";
}
