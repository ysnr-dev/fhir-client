import {
  formatDateLabel,
  slotCellLabel,
  slotCellStatus,
  summarizeSlotCell,
  weekDates,
  type SlotCalendarRow,
} from "../fhir/scheduleHelpers";

// 枠(Slot)の週表示。列 = 曜日、行 = 開始時刻。行に出るのはその週に実在する
// 開始時刻だけなので、午前だけの枠表なら午前の行しか並ばない。
//
// 1 セル = その日時の枠すべて。「30 分枠で 3 人まで」は同じ日時の Slot 3 件で
// 表すので、セルには残数を「空き 2/3」の形で出す(定員 1 の枠表は従来どおり
// 状態をそのまま出す)。
//
// セルをクリックすると、そのセルの操作できる枠(予約が入っていないもの)が
// まとめて選択に入る。停止・再開・削除は選んだ枠に効かせる。予約の入った枠は
// 選べない —— 枠を消す前に予約を取り消す必要があり、予約の取消はこの画面の
// 担当ではないため。

interface SlotCalendarProps {
  rows: SlotCalendarRow[];
  weekStartISO: string;
  selectedIds: ReadonlySet<string>;
  onToggle: (slots: fhir4.Slot[]) => void;
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
                  {cell.slots.length > 0 ? (
                    <SlotCell slots={cell.slots} selectedIds={selectedIds} onToggle={onToggle} />
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
  slots,
  selectedIds,
  onToggle,
}: {
  slots: fhir4.Slot[];
  selectedIds: ReadonlySet<string>;
  onToggle: (slots: fhir4.Slot[]) => void;
}) {
  const summary = summarizeSlotCell(slots);
  const selected =
    summary.operable.length > 0 &&
    summary.operable.every((slot) => selectedIds.has(slot.id as string));

  const className = [
    "slot-calendar__slot",
    `slot-calendar__slot--${slotCellStatus(summary, slots)}`,
    selected ? "slot-calendar__slot--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onClick={() => onToggle(slots)}
      disabled={summary.operable.length === 0}
      title={cellTitle(summary)}
      aria-pressed={selected}
    >
      {slotCellLabel(summary, slots)}
    </button>
  );
}

function cellTitle(summary: ReturnType<typeof summarizeSlotCell>): string | undefined {
  const detail =
    summary.total === 1
      ? ""
      : `定員 ${summary.total} / 空き ${summary.free} / 予約 ${summary.booked} / 停止 ${summary.unavailable}`;

  if (summary.operable.length === 0) {
    const reason = "予約が入っているため操作できません";
    return detail ? `${detail}(${reason})` : reason;
  }
  return detail || undefined;
}

// 土日は列の背景を変えて週の区切りを見やすくする。
function weekendClass(dateISO: string): string {
  const weekday = new Date(`${dateISO}T00:00:00`).getDay();
  if (weekday === 0) return "slot-calendar__col--sunday";
  if (weekday === 6) return "slot-calendar__col--saturday";
  return "";
}
