import { useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import {
  useBookDialysisAppointments,
  useDialysisOrderAppointments,
  useDialysisShifts,
  useDialysisSlots,
  useDialysisUnits,
} from "../api/queries";
import {
  DIALYSIS_PLAN_STATUS_LABELS,
  dialysisExpandStart,
  planDialysisExpansion,
  previousDialysisBeds,
  type DialysisBooking,
} from "../fhir/dialysisAppointmentHelpers";
import { dialysisOrderPattern, summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import {
  MAX_DIALYSIS_EXPAND,
  MAX_DIALYSIS_EXPAND_WEEKS,
  dialysisPatternOccurrences,
} from "../fhir/dialysisShiftHelpers";
import { activeDialysisBeds, dialysisBoardBedLabel } from "../fhir/dialysisUnitHelpers";
import { DAY_OF_WEEK_OPTIONS } from "../fhir/injectionHelpers";
import { displayName } from "../fhir/patientHelpers";
import { formatDateLabel } from "../fhir/scheduleHelpers";
import { addDays, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 予約の一括展開(docs/dialysis-order-design.md §5.3)。オーダーの曜日 × シフトから N 週ぶんの予約を
// 1 transaction で作る。ベッドは曜日 × シフトごとに選べ、前回と同じベッドを初期値にする。
//
// プレビューで「予約 / 予約済(除外) / 空きなし / 枠なし」を出し、予約できる行だけを送る。
// 上限(40 件)を超える指定は打ち切らずに止める。別の患者が先に枠を取ると 412 で全体が落ちるので、
// 読み直したプレビューでやり直させる(部分成功は作らない)。

const DEFAULT_WEEKS = 4;

interface Props {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  onClose: () => void;
}

export function DialysisExpandModal({ order, patient, onClose }: Props) {
  const shifts = useDialysisShifts();
  const units = useDialysisUnits();
  const orderAppointments = useDialysisOrderAppointments(order.id);
  const book = useBookDialysisAppointments();
  const summary = summarizeDialysisOrder(order);
  const pattern = useMemo(() => dialysisOrderPattern(order), [order]);

  const [startDate, setStartDate] = useState("");
  const [weeks, setWeeks] = useState(String(DEFAULT_WEEKS));
  // 曜日 × シフト → ベッドの Location.id。選び直したものだけを持ち、残りは前回のベッドを使う。
  const [bedChoices, setBedChoices] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);

  const appointments = useMemo(() => orderAppointments.data ?? [], [orderAppointments.data]);
  const defaultStart = dialysisExpandStart(summary.startDate, today(), appointments);
  const from = startDate || defaultStart;
  const weekCount = Number(weeks);
  const validWeeks = Number.isInteger(weekCount) && weekCount >= 1 && weekCount <= MAX_DIALYSIS_EXPAND_WEEKS;
  const rangeEnd = validWeeks ? addDays(from, weekCount * 7 - 1) : "";
  const to = summary.endDate && rangeEnd > summary.endDate ? summary.endDate : rangeEnd;

  const beds = useMemo(
    () => activeDialysisBeds(units.data?.groups ?? [], units.data?.schedulesByBedId ?? new Map()),
    [units.data],
  );
  const multiUnit = new Set(beds.map((entry) => entry.unit.id)).size > 1;
  const previous = useMemo(() => previousDialysisBeds(appointments, shifts), [appointments, shifts]);
  const activeBedIds = new Set(beds.map((entry) => entry.bed.id ?? ""));
  const bedIdFor = (dayOfWeek: string, shift: string) => {
    const key = `${dayOfWeek}|${shift}`;
    const chosen = bedChoices[key] ?? previous.byPattern.get(key) ?? previous.latest;
    return chosen && activeBedIds.has(chosen) ? chosen : "";
  };

  const occurrences = useMemo(
    () => (to ? dialysisPatternOccurrences(pattern, from, to, shifts) : []),
    [pattern, from, to, shifts],
  );
  const scheduleIds = Array.from(
    new Set(
      pattern.flatMap((entry) => {
        const schedule = units.data?.schedulesByBedId.get(bedIdFor(entry.dayOfWeek, entry.shift));
        return schedule?.id ? [schedule.id] : [];
      }),
    ),
  );
  const slots = useDialysisSlots(scheduleIds, from, to);

  const rows = planDialysisExpansion({
    occurrences,
    bedIdFor: (occurrence) => bedIdFor(occurrence.dayOfWeek, occurrence.shift),
    schedulesByBedId: units.data?.schedulesByBedId ?? new Map(),
    slots: slots.data ?? [],
    orderAppointments: appointments,
    shifts,
  });
  const bookings = rows.flatMap((row): DialysisBooking[] => (row.booking ? [row.booking] : []));
  const overLimit = bookings.length > MAX_DIALYSIS_EXPAND;
  const loading = units.isLoading || orderAppointments.isLoading || (scheduleIds.length > 0 && slots.isLoading);
  const pending = book.isPending;

  function handleSubmit() {
    if (!patient || !order.id || bookings.length === 0 || overLimit) return;
    setConflict(false);
    book.mutate(
      { patient, orderId: order.id, bookings },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (error instanceof FhirError && error.status === 412) setConflict(true);
        },
      },
    );
  }

  const bedLabelOf = (bedId: string) => {
    const entry = beds.find((b) => b.bed.id === bedId);
    return entry ? dialysisBoardBedLabel(entry, multiUnit) : "-";
  };

  return (
    <Modal
      title={`透析予約の展開${patient ? ` - ${displayName(patient)}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <div className="appointment-panel">
        <p className="appointment-panel__current">
          {[summary.modalityShort, summary.scheduleLabel, summary.periodLabel].filter(Boolean).join(" / ")}
        </p>

        <ErrorBanner error={units.error} />
        <ErrorBanner error={orderAppointments.error} />
        <ErrorBanner error={slots.error} />
        {conflict ? (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              別の患者が取った枠があります。空きを読み直したので、確かめてから展開してください。
            </p>
          </div>
        ) : (
          <ErrorBanner error={book.error} />
        )}
        {!patient && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              患者情報を読み込めなかったため予約できません。
            </p>
          </div>
        )}
        {overLimit && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">
              予約が {bookings.length} 件になり、上限の {MAX_DIALYSIS_EXPAND} 件を超えます。週数を減らしてください。
            </p>
          </div>
        )}

        <div className="walk-in__fields">
          <label>
            開始日
            <input
              type="date"
              value={from}
              min={summary.startDate || undefined}
              max={summary.endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            週数
            <input
              type="number"
              min={1}
              max={MAX_DIALYSIS_EXPAND_WEEKS}
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
              className="dialysis-unit__count"
            />
          </label>
        </div>

        <table className="master-search__table dialysis-expand__beds">
          <thead>
            <tr>
              <th>曜日</th>
              <th>シフト</th>
              <th>ベッド</th>
            </tr>
          </thead>
          <tbody>
            {pattern.map((entry) => {
              const key = `${entry.dayOfWeek}|${entry.shift}`;
              return (
                <tr key={key}>
                  <td>{DAY_OF_WEEK_OPTIONS.find((o) => o.code === entry.dayOfWeek)?.label ?? entry.dayOfWeek}</td>
                  <td>{entry.shiftLabel}</td>
                  <td>
                    <select
                      value={bedIdFor(entry.dayOfWeek, entry.shift)}
                      onChange={(e) => setBedChoices((current) => ({ ...current, [key]: e.target.value }))}
                      aria-label={`${entry.shiftLabel} のベッド`}
                    >
                      <option value="">選択</option>
                      {beds.map((bed) => (
                        <option key={bed.bed.id} value={bed.bed.id}>
                          {dialysisBoardBedLabel(bed, multiUnit)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {loading ? (
          <p>読み込み中...</p>
        ) : (
          <table className="master-search__table dialysis-expand__preview">
            <thead>
              <tr>
                <th>日付</th>
                <th>シフト</th>
                <th>ベッド</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.occurrence.date}|${row.occurrence.shift}`}
                  className={row.status === "ok" ? undefined : "dialysis-expand__row--skip"}
                >
                  <td>{formatDateLabel(row.occurrence.date)}</td>
                  <td>{row.occurrence.shiftLabel}</td>
                  <td>{row.bedId ? bedLabelOf(row.bedId) : "-"}</td>
                  <td>{DIALYSIS_PLAN_STATUS_LABELS[row.status]}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="master-search__empty">
                    期間にパターンの日がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <div className="appointment-panel__actions">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!patient || loading || bookings.length === 0 || overLimit || pending}
          >
            {pending ? "保存中..." : `展開(${bookings.length} 件)`}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
