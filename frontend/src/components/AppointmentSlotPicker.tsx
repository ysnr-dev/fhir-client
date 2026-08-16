import { useMemo, useState } from "react";
import {
  useDaySlots,
  useDepartmentList,
  useFreeSlotsOfMonth,
  usePractitionerOptions,
  useScheduleOptions,
} from "../api/queries";
import {
  currentMonth,
  freeCountByDate,
  groupSlotsByTime,
  monthGrid,
  monthLabel,
  monthRange,
  shiftMonth,
} from "../fhir/appointmentHelpers";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { WEEKDAY_LABELS, actorId, scheduleSummary, today } from "../fhir/scheduleHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";

// 予約する枠を選ぶ。枠表を決め、月カレンダーで日を選び、その日の時刻から選ぶ。
//
// 右ペインは幅が狭いので、週表示ではなく「月で日を選んでから時刻」の 2 段階にしている。
// 月のカレンダーは空き枠(status=free)だけを引いて日ごとの残数を出し、日を選んだ時点で
// その日だけ全ステータスを引き直して「空き 2/3」を出す。
//
// 予約の登録(右ペイン)と日時変更(予約タブ)の双方から使う。

export interface SlotSelection {
  schedule: fhir4.Schedule;
  slot: fhir4.Slot;
}

interface AppointmentSlotPickerProps {
  /**
   * 絞り込みの初期値。日時変更では変更前の予約と同じ条件から始めたいので呼び出し側が渡す。
   * 未指定ならカルテヘッダの依頼科・依頼医師を使う。
   */
  defaultDepartmentCode?: string;
  defaultPractitionerId?: string;
  selected: SlotSelection | null;
  onSelect: (selection: SlotSelection | null) => void;
}

export function AppointmentSlotPicker({
  defaultDepartmentCode,
  defaultPractitionerId,
  selected,
  onSelect,
}: AppointmentSlotPickerProps) {
  const orderContext = useOrderContext();

  // 枠表の絞り込み。初期値は診療科だけで、担当医は既定では絞らない。
  //
  // カルテヘッダの依頼医師は「オーダーを出す人(入力者・指示医師)」であって予約先の
  // 担当医とは限らず、初期値にすると自分の枠を持たない医師でログインしたときに
  // 候補が 0 件になってしまう。「その科の誰でもよい」ことも多いので既定は全員にする。
  // 日時変更のときだけ、呼び出し側が変更前の担当医を渡して同じ医師から探させる。
  //
  // 診療科の既定値は診療科マスタが届いてから決まる(OrderContext が持つのは
  // Organization.id で、枠表が持つのは SS-MIX2 コードのため)。useState の初期値に
  // すると読み込み前の空文字で固定されてしまうので、「まだ選び直していない間は
  // 既定値を使う」形にして後から反映されるようにする。
  const { departments } = useDepartmentList({});
  const { practitioners } = usePractitionerOptions();
  const defaultDepartment = departments.find((d) => d.id === orderContext.departmentId);
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [practitionerFilter, setPractitionerFilter] = useState<string | null>(null);
  const departmentCodeFilter =
    departmentFilter ??
    defaultDepartmentCode ??
    (defaultDepartment ? departmentCode(defaultDepartment) : "");
  const practitionerId = practitionerFilter ?? defaultPractitionerId ?? "";
  const filtered = Boolean(departmentCodeFilter) || Boolean(practitionerId);

  const scheduleOptions = useScheduleOptions({
    departmentCode: departmentCodeFilter || undefined,
    practitionerId: practitionerId || undefined,
  });
  // 枠表は、依頼医師(日時変更なら変更前の担当医)の枠があればそれを初期選択にする。
  // 候補が届くのを待つ必要があるので、絞り込みと同じく「まだ選び直していない間は
  // 既定値を使う」形にする。
  const [pickedScheduleId, setPickedScheduleId] = useState<string | null>(null);
  const preferredPractitionerId = defaultPractitionerId ?? orderContext.practitionerId;
  const defaultSchedule = preferredPractitionerId
    ? scheduleOptions.schedules.find(
        (s) => actorId(s, "Practitioner") === preferredPractitionerId,
      )
    : undefined;
  const scheduleId = pickedScheduleId ?? defaultSchedule?.id ?? "";

  // 絞り込みを変えて選択中の枠表が候補から外れたら、選び直させる。
  const schedule = scheduleOptions.schedules.find((s) => s.id === scheduleId);

  const [month, setMonth] = useState(currentMonth);
  const [date, setDate] = useState("");

  const range = useMemo(() => monthRange(month), [month]);
  const monthSlots = useFreeSlotsOfMonth(schedule?.id, range);
  const daySlots = useDaySlots(schedule?.id, date);

  const freeCounts = useMemo(() => freeCountByDate(monthSlots.slots), [monthSlots.slots]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const timeGroups = useMemo(() => groupSlotsByTime(daySlots.slots), [daySlots.slots]);

  function changeSchedule(id: string) {
    setPickedScheduleId(id);
    setDate("");
    onSelect(null);
  }

  // 絞り込みを変えたときは候補ごと変わるので、選択を白紙に戻して初期選択もやり直す。
  function resetSchedule() {
    setPickedScheduleId(null);
    setDate("");
    onSelect(null);
  }

  // 初期の絞り込みから外れた枠表(他科・他の医師)を選びたいときの逃げ道。
  function clearFilters() {
    setDepartmentFilter("");
    setPractitionerFilter("");
    resetSchedule();
  }

  function changeMonth(diff: number) {
    setMonth((m) => shiftMonth(m, diff));
    setDate("");
    onSelect(null);
  }

  function pickTime(group: (typeof timeGroups)[number]) {
    // 定員が複数ある枠は、空いている席のうち先頭の 1 つを押さえる。
    const slot = group.freeSlots[0];
    if (!slot || !schedule) return;
    onSelect({ schedule, slot });
  }

  return (
    <div className="appointment-picker">
      <div className="appointment-picker__filters">
        <label>
          診療科
          <select
            value={departmentCodeFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              resetSchedule();
            }}
          >
            <option value="">すべて</option>
            {departments.map((department) => (
              <option key={department.id} value={departmentCode(department)}>
                {departmentDisplayName(department)}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当医
          <select
            value={practitionerId}
            onChange={(e) => {
              setPractitionerFilter(e.target.value);
              resetSchedule();
            }}
          >
            <option value="">すべて</option>
            {practitioners.map((practitioner) => (
              <option key={practitioner.id} value={practitioner.id}>
                {practitionerDisplayName(practitioner)}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="appointment-picker__clear"
            onClick={clearFilters}
          >
            絞り込みを解除
          </button>
        )}
      </div>

      <label className="appointment-picker__schedule">
        予約枠
        <select value={scheduleId} onChange={(e) => changeSchedule(e.target.value)}>
          <option value="">選択してください</option>
          {scheduleOptions.schedules.map((option) => (
            <option key={option.id} value={option.id}>
              {scheduleSummary(option)}
            </option>
          ))}
        </select>
      </label>

      {/* 絞り込みで候補が消えたことに気づけるようにする(初期値は依頼科・依頼医師なので、
          その医師が枠を持っていないと空になる)。 */}
      {!scheduleOptions.isLoading && scheduleOptions.schedules.length === 0 && (
        <p className="appointment-picker__hint">
          {filtered
            ? "この条件に合う予約枠がありません。「絞り込みを解除」ですべての枠表から選べます。"
            : "有効な予約枠がありません。マスタメンテの「予約枠」で登録してください。"}
        </p>
      )}

      <ErrorBanner error={scheduleOptions.error} />
      <ErrorBanner error={monthSlots.error} />
      <ErrorBanner error={daySlots.error} />

      {!schedule ? (
        <p className="appointment-picker__hint">
          予約枠を選ぶと、空いている日と時間が表示されます。
        </p>
      ) : (
        <>
          <div className="appointment-month__header">
            <button type="button" onClick={() => changeMonth(-1)}>
              ← 前月
            </button>
            <span>{monthLabel(month)}</span>
            <button type="button" onClick={() => changeMonth(1)}>
              翌月 →
            </button>
            {monthSlots.isFetching && <span className="appointment-picker__hint">読み込み中...</span>}
          </div>

          <table className="appointment-month">
            <thead>
              <tr>
                {/* 月曜始まり。日曜を末尾に回す。 */}
                {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                  <th key={weekday} className={weekendClass(weekday)}>
                    {WEEKDAY_LABELS[weekday]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((week) => (
                <tr key={week[0].date}>
                  {week.map((cell) => (
                    <td key={cell.date}>
                      <DayCell
                        date={cell.date}
                        inMonth={cell.inMonth}
                        free={freeCounts.get(cell.date) ?? 0}
                        selected={date === cell.date}
                        onSelect={(next) => {
                          setDate(next);
                          onSelect(null);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {date && (
            <div className="appointment-times">
              <h4>{date} の枠</h4>
              {daySlots.isLoading ? (
                <p>読み込み中...</p>
              ) : timeGroups.length === 0 ? (
                <p className="appointment-picker__hint">この日には枠がありません。</p>
              ) : (
                // 時刻は数が多いので、縦に積まずチップを折り返して並べる
                // (プロブレムの帯と同じ見せ方)。選ぶと選択中の 1 つだけが強調される。
                <div className="appointment-times__list">
                  {timeGroups.map((group) => {
                    const picked = selected?.slot.start === group.freeSlots[0]?.start;
                    const className = [
                      "appointment-times__slot",
                      group.free > 0 ? "appointment-times__slot--free" : "",
                      picked ? "appointment-times__slot--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <button
                        key={group.time}
                        type="button"
                        className={className}
                        onClick={() => pickTime(group)}
                        disabled={group.free === 0}
                        aria-pressed={picked}
                      >
                        <span className="appointment-times__time">
                          {group.endTime ? `${group.time}-${group.endTime}` : group.time}
                        </span>
                        <span className="appointment-times__count">
                          {group.free > 0 ? group.free : "満"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DayCell({
  date,
  inMonth,
  free,
  selected,
  onSelect,
}: {
  date: string;
  inMonth: boolean;
  free: number;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const day = Number(date.slice(8, 10));
  const isToday = date === today();

  const className = [
    "appointment-month__day",
    inMonth ? "" : "appointment-month__day--outside",
    free > 0 ? "appointment-month__day--free" : "",
    selected ? "appointment-month__day--selected" : "",
    isToday ? "appointment-month__day--today" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={className} onClick={() => onSelect(date)}>
      <span className="appointment-month__date">{day}</span>
      {/* 日付の数字と紛れないよう「空き」を添える。月のカレンダーは空き枠だけを
          引いているので出せるのは残数だけで、空きが無い日(満・休診)の区別は
          日を開いたときの時刻リストで分かる。 */}
      <span className="appointment-month__free">{free > 0 ? `空き${free}` : ""}</span>
    </button>
  );
}

function weekendClass(weekday: number): string {
  if (weekday === 0) return "appointment-month__col--sunday";
  if (weekday === 6) return "appointment-month__col--saturday";
  return "";
}
