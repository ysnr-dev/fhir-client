import { Link } from "react-router-dom";
import { appointmentStatusLabel } from "../fhir/appointmentHelpers";
import {
  dialysisAppointmentBedId,
  dialysisAppointmentDate,
  dialysisAppointmentShift,
  dialysisSlotKey,
  findDialysisSlot,
} from "../fhir/dialysisAppointmentHelpers";
import { dialysisOrderModality, dialysisModalityShort } from "../fhir/dialysisOrderHelpers";
import { dialysisSessionDisplay, type DialysisSession } from "../fhir/dialysisResultHelpers";
import type { DialysisShift } from "../fhir/dialysisShiftHelpers";
import { dialysisBedLabel, type DialysisBoardBed } from "../fhir/dialysisUnitHelpers";
import { displayName } from "../fhir/patientHelpers";
import { formatDateLabel } from "../fhir/scheduleHelpers";
import { useReturnLinkState } from "../returnTo";
import { RowMenu } from "./RowMenu";

// 透析室のボード(ベッド × シフトの格子)。docs/dialysis-order-design.md §5。
//
// 1 日(当日ボード)と 7 日(週)の両方をこの格子で描く。列は日 × シフト、行は有効なベッド。
// セルには予約(1 ベッド 1 患者)を出し、予約の無いセルは枠の状態(空き・停止・枠なし)を出す。
// ベッドやシフトに当てはまらない予約(無効にしたベッド・消したシフト)は格子の下に別に並べ、黙って落とさない。
//
// 実施は予約ごとに 入室 → 開始 → 終了 と進める(dialysisResultHelpers.ts)。セルには実施の段階と
// 体重・除水を出し、次の段階のボタンを 1 つだけ表に置く(残りはケバブ)。

// 列幅(px)。予約の入ったセルだけ広がらないよう、表の幅ごと固定する。
const BED_COLUMN_WIDTH = 72;
const DAY_COLUMN_WIDTH = 200;
const WEEK_COLUMN_WIDTH = 104;

export interface DialysisBoardEntry {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
  order?: fhir4.ServiceRequest;
  /** この予約の回(入室以降)。 */
  session?: DialysisSession;
}

export type DialysisPerformAction = "arrive" | "start" | "finish" | "cancel-perform";

export interface DialysisBoardActions {
  onView: (entry: DialysisBoardEntry) => void;
  onReschedule: (entry: DialysisBoardEntry) => void;
  onCancel: (entry: DialysisBoardEntry) => void;
  /** placeLabel は「ベッド 3 / 午前」。実施入力の見出しに出す。 */
  onPerform: (entry: DialysisBoardEntry, action: DialysisPerformAction, placeLabel: string) => void;
  pending: boolean;
}

interface Props extends DialysisBoardActions {
  dates: string[];
  beds: DialysisBoardBed[];
  shifts: DialysisShift[];
  entries: DialysisBoardEntry[];
  /** 表示している期間の、ベッドの枠表の枠。 */
  slots: fhir4.Slot[];
}

export function DialysisBoard({ dates, beds, shifts, entries, slots, ...actions }: Props) {
  const byCell = new Map<string, DialysisBoardEntry[]>();
  const unplaced: DialysisBoardEntry[] = [];
  const bedIds = new Set(beds.map((entry) => entry.bed.id));
  // ベッドは押さえた枠の枠表から引く(予約タブの汎用の日時変更では participant の場所が書き換わらないため)。
  // 枠が読めていなければ予約の participant の場所を使う。
  const bedIdBySchedule = new Map(beds.flatMap((entry) => (entry.schedule?.id ? [[entry.schedule.id, entry.bed.id ?? ""]] : [])));
  const scheduleIdBySlot = new Map(slots.map((slot) => [slot.id ?? "", slot.schedule.reference?.split("/").pop() ?? ""]));
  const bedOf = (appointment: fhir4.Appointment) => {
    const slotId = appointment.slot?.[0]?.reference?.split("/").pop() ?? "";
    return bedIdBySchedule.get(scheduleIdBySlot.get(slotId) ?? "") ?? dialysisAppointmentBedId(appointment);
  };
  for (const entry of entries) {
    const bedId = bedOf(entry.appointment);
    const shift = dialysisAppointmentShift(entry.appointment, shifts);
    if (!bedIds.has(bedId) || !shift || !shifts.some((s) => s.code === shift.code)) {
      unplaced.push(entry);
      continue;
    }
    const key = `${bedId}|${dialysisSlotKey(dialysisAppointmentDate(entry.appointment), shift.code)}`;
    const list = byCell.get(key);
    if (list) list.push(entry);
    else byCell.set(key, [entry]);
  }

  const slotsBySchedule = new Map<string, fhir4.Slot[]>();
  for (const slot of slots) {
    const id = slot.schedule.reference?.split("/").pop() ?? "";
    const list = slotsBySchedule.get(id);
    if (list) list.push(slot);
    else slotsBySchedule.set(id, [slot]);
  }

  const multiDay = dates.length > 1;
  const multiUnit = new Set(beds.map((entry) => entry.unit.id)).size > 1;
  const columnCount = 1 + dates.length * shifts.length;

  return (
    <>
      <div className="dialysis-board-wrap">
        <table
          className={`dialysis-board${multiDay ? " dialysis-board--week" : ""}`}
          style={{ width: BED_COLUMN_WIDTH + dates.length * shifts.length * (multiDay ? WEEK_COLUMN_WIDTH : DAY_COLUMN_WIDTH) }}
        >
          {/* 列幅は先頭行(日付の colSpan)からは決まらないので colgroup で固定する。 */}
          <colgroup>
            <col style={{ width: BED_COLUMN_WIDTH }} />
            {dates.flatMap((date) =>
              shifts.map((shift) => (
                <col key={`${date}|${shift.code}`} style={{ width: multiDay ? WEEK_COLUMN_WIDTH : DAY_COLUMN_WIDTH }} />
              )),
            )}
          </colgroup>
          <thead>
            {multiDay && (
              <tr>
                <th rowSpan={2} className="dialysis-board__bed-head">
                  ベッド
                </th>
                {dates.map((date) => (
                  <th key={date} colSpan={shifts.length} className={dayClass(date)}>
                    {formatDateLabel(date)}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {!multiDay && <th className="dialysis-board__bed-head">ベッド</th>}
              {dates.flatMap((date) =>
                shifts.map((shift) => (
                  <th key={`${date}|${shift.code}`} className="dialysis-board__shift-head">
                    {shift.label}
                    {!multiDay && (
                      <span className="dialysis-board__shift-time">
                        {shift.start}〜{shift.end}
                      </span>
                    )}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {beds.map((entry, index) => {
              const unitChanged = multiUnit && entry.unit.id !== beds[index - 1]?.unit.id;
              const scheduleSlots = slotsBySchedule.get(entry.schedule?.id ?? "") ?? [];
              return [
                unitChanged && (
                  <tr key={`unit-${entry.unit.id}`}>
                    <th colSpan={columnCount} className="dialysis-board__unit">
                      {entry.unit.name}
                    </th>
                  </tr>
                ),
                <tr key={entry.bed.id}>
                  <th className="dialysis-board__bed">{dialysisBedLabel(entry.bed)}</th>
                  {dates.flatMap((date) =>
                    shifts.map((shift) => {
                      const cellEntries =
                        byCell.get(`${entry.bed.id}|${dialysisSlotKey(date, shift.code)}`) ?? [];
                      return (
                        <td key={`${date}|${shift.code}`} className="dialysis-board__cell">
                          {cellEntries.length > 0 ? (
                            cellEntries.map((cellEntry) => (
                              <BoardCard
                                key={cellEntry.appointment.id}
                                entry={cellEntry}
                                compact={multiDay}
                                placeLabel={`ベッド ${dialysisBedLabel(entry.bed)} / ${shift.label}`}
                                {...actions}
                              />
                            ))
                          ) : (
                            <EmptyCell slot={findDialysisSlot(scheduleSlots, date, shift)} />
                          )}
                        </td>
                      );
                    }),
                  )}
                </tr>,
              ];
            })}
            {beds.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="master-search__empty">
                  有効なベッドがありません(<Link to="/dialysis-unit">透析室の設定</Link>)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {unplaced.length > 0 && (
        <div className="dialysis-board__unplaced">
          <h3 className="dialysis-board__subtitle">ベッド・シフトに当てはまらない予約</h3>
          <ul>
            {unplaced.map((entry) => (
              <li key={entry.appointment.id}>
                <BoardCard entry={entry} compact={false} showWhen placeLabel={entry.appointment.description ?? ""} {...actions} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function dayClass(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay();
  if (day === 0) return "dialysis-board__day dialysis-board__day--sun";
  if (day === 6) return "dialysis-board__day dialysis-board__day--sat";
  return "dialysis-board__day";
}

function EmptyCell({ slot }: { slot: fhir4.Slot | undefined }) {
  if (!slot) return <span className="dialysis-board__empty dialysis-board__empty--none">枠なし</span>;
  if (slot.status === "free") return <span className="dialysis-board__empty">空き</span>;
  if (slot.status === "busy-unavailable") {
    return <span className="dialysis-board__empty dialysis-board__empty--none">停止</span>;
  }
  return <span className="dialysis-board__empty">埋まり</span>;
}

/** 次に進める段階。表のボタンに出す。 */
const NEXT_ACTION: Record<string, { action: DialysisPerformAction; label: string }> = {
  none: { action: "arrive", label: "入室" },
  preparation: { action: "start", label: "開始" },
  "in-progress": { action: "finish", label: "終了" },
};

function BoardCard({
  entry,
  compact,
  showWhen,
  placeLabel,
  onView,
  onReschedule,
  onCancel,
  onPerform,
  pending,
}: {
  entry: DialysisBoardEntry;
  compact: boolean;
  /** 格子の外に出すときは日時とベッドも添える。 */
  showWhen?: boolean;
  placeLabel: string;
} & DialysisBoardActions) {
  const returnLinkState = useReturnLinkState();
  const { appointment, patient, order, session } = entry;
  const modality = order ? dialysisModalityShort(dialysisOrderModality(order)) : "";
  const status = appointment.status;
  const name = patient ? displayName(patient) : "-";
  const perform = session ? dialysisSessionDisplay(session) : undefined;
  const performStatus = perform?.status ?? "none";
  // 実施があれば実施の段階、無ければ予約済(booked)以外の予約の状態を添える。
  const statusLabel = perform
    ? [perform.statusLabel, perform.timeLabel].filter(Boolean).join(" ")
    : status !== "booked"
      ? appointmentStatusLabel(status)
      : "";
  const next = order && status !== "noshow" ? NEXT_ACTION[performStatus] : undefined;
  const performAction = (action: DialysisPerformAction) => () => onPerform(entry, action, placeLabel);

  return (
    <div className={`dialysis-board__card dialysis-board__card--${perform ? `perform-${performStatus}` : status}`}>
      <span className="dialysis-board__card-main">
        {patient?.id ? (
          <Link to={`/patients/${patient.id}/karte`} state={returnLinkState} className="dialysis-board__patient">
            {name}
          </Link>
        ) : (
          <span className="dialysis-board__patient">{name}</span>
        )}
        {!compact && (
          <span className="dialysis-board__meta">
            {[
              showWhen ? `${dialysisAppointmentDate(appointment)} ${appointment.description ?? ""}` : "",
              patient?.identifier?.[0]?.value ?? "",
              modality,
              statusLabel,
            ]
              .filter(Boolean)
              .join(" / ")}
          </span>
        )}
        {compact && (modality || statusLabel) && (
          <span className="dialysis-board__meta">{[modality, statusLabel].filter(Boolean).join(" ")}</span>
        )}
        {!compact && perform?.summary && <span className="dialysis-board__meta">{perform.summary}</span>}
      </span>
      {!compact && next && (
        <button type="button" className="rp-card__compact-button" disabled={pending} onClick={performAction(next.action)}>
          {next.label}
        </button>
      )}
      <RowMenu label={`${name} の予約の操作`} escapesClipping>
        <button type="button" className="row-menu__item" onClick={() => onView(entry)} disabled={!order}>
          表示
        </button>
        {/* 透析経過表(透析中の時系列記録)。開始後に書き始め、終了後は振り返りに読む。
            docs/dialysis-chart-design.md §3.1 */}
        {session?.hub.id && performStatus !== "preparation" && (
          <Link
            className="row-menu__item"
            to={`/dialysis-sessions/${session.hub.id}/chart`}
            state={returnLinkState}
          >
            経過表
          </Link>
        )}
        {compact && next && (
          <button type="button" className="row-menu__item" disabled={pending} onClick={performAction(next.action)}>
            {next.label}
          </button>
        )}
        {/* 後から記録する運用のため、入室・開始を飛ばして終了を入れられる。 */}
        {order && performStatus !== "completed" && next?.action !== "finish" && (
          <button type="button" className="row-menu__item" disabled={pending} onClick={performAction("finish")}>
            一括記録
          </button>
        )}
        {session && (
          <button
            type="button"
            className="row-menu__item row-menu__item--danger"
            disabled={pending}
            onClick={performAction("cancel-perform")}
          >
            実施取消
          </button>
        )}
        {status === "booked" && !session && (
          <>
            <button type="button" className="row-menu__item" onClick={() => onReschedule(entry)}>
              予約変更
            </button>
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={() => onCancel(entry)}
            >
              予約取消
            </button>
          </>
        )}
      </RowMenu>
    </div>
  );
}
