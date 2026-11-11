import { useMemo } from "react";
import { useDialysisMonth, useDialysisSlots } from "../api/queries";
import {
  buildDialysisMonthlyStats,
  capacityTotal,
  dialysisMonthRange,
  rateLabel,
  type DialysisCapacityStats,
  type DialysisMonthlyStats as Stats,
} from "../fhir/dialysisStatsHelpers";
import { dialysisMinutesLabel } from "../fhir/dialysisResultHelpers";
import type { DialysisShift } from "../fhir/dialysisShiftHelpers";
import type { DialysisBoardBed } from "../fhir/dialysisUnitHelpers";
import { csvBlob } from "../lib/csv";
import { shortDate } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { ErrorBanner } from "./ErrorBanner";

// 透析の月間統計(docs/dialysis-order-design.md §6.3)。透析一覧の「統計」ビュー。
// 回数・浄化方法別、シフト別とベッド別の稼働、日別。

interface Props {
  month: string;
  beds: DialysisBoardBed[];
  shifts: DialysisShift[];
}

export function DialysisMonthlyStats({ month, beds, shifts }: Props) {
  const { from, to } = dialysisMonthRange(month);
  const data = useDialysisMonth(month);
  const scheduleIds = beds.flatMap((entry) => (entry.schedule?.id ? [entry.schedule.id] : []));
  const slots = useDialysisSlots(scheduleIds, from, to);

  const stats = useMemo(
    () =>
      data.data
        ? buildDialysisMonthlyStats({
            month,
            hubs: data.data.hubs,
            ordersById: data.data.ordersById,
            appointments: data.data.appointments,
            slots: slots.data ?? [],
            beds,
            shifts,
          })
        : null,
    [data.data, slots.data, month, beds, shifts],
  );

  return (
    <>
      <ErrorBanner error={data.error} />
      <ErrorBanner error={slots.error} />
      {!stats || data.isLoading || (scheduleIds.length > 0 && slots.isLoading) ? (
        <p>読み込み中...</p>
      ) : (
        <StatsBody month={month} stats={stats} />
      )}
    </>
  );
}

function StatsBody({ month, stats }: { month: string; stats: Stats }) {
  const { summary } = stats;

  function handleCsv() {
    const header = [
      "日付",
      "曜日",
      ...stats.dayColumns.flatMap((column) => [`${column.label} 実施`, `${column.label} 枠`]),
      "ベッドサイド",
      "実施",
      "枠",
      "稼働率",
    ];
    const rows = stats.byDay.map((day) => [
      day.date,
      day.weekday,
      ...stats.dayColumns.flatMap((column) => [day.byShift[column.key].sessions, day.byShift[column.key].slots]),
      day.bedside,
      day.sessions,
      day.slots,
      rateLabel(day.rate),
    ]);
    downloadBlob(csvBlob(header, rows), `透析日別_${month}.csv`);
  }

  return (
    <div className="dialysis-stats">
      <dl className="dialysis-stats__summary">
        <SummaryCard
          label="実施回数"
          value={String(summary.sessions)}
          sub={[
            `入院 ${summary.inpatient}`,
            `外来 ${summary.outpatient}`,
            summary.bedside > 0 ? `ベッドサイド ${summary.bedside}` : "",
          ]
            .filter(Boolean)
            .join(" / ")}
        />
        <SummaryCard label="実患者数" value={String(summary.patients)} />
        <SummaryCard label="平均実透析時間" value={dialysisMinutesLabel(summary.averageMinutes) || "-"} />
        <SummaryCard
          label="ベッド稼働率"
          value={rateLabel(summary.rate)}
          sub={`実施 ${summary.unitSessions} / 枠 ${summary.slots}`}
        />
        <SummaryCard label="予約" value={String(summary.booked)} sub={`未来院 ${summary.noshow}`} />
      </dl>

      <div className="dialysis-stats__tables">
        <section className="dialysis-stats__card">
          <h3 className="dialysis-stats__title">浄化方法別</h3>
          <table className="master-search__table dialysis-stats__table">
            <thead>
              <tr>
                <th>浄化方法</th>
                <th className="dialysis-stats__number">回数</th>
                <th className="dialysis-stats__number">患者数</th>
                <th className="dialysis-stats__number">入院</th>
                <th className="dialysis-stats__number">外来</th>
                <th className="dialysis-stats__number">平均時間</th>
              </tr>
            </thead>
            <tbody>
              {stats.byModality.map((row) => (
                <tr key={row.code}>
                  <td>{row.label}</td>
                  <td className="dialysis-stats__number">{row.sessions}</td>
                  <td className="dialysis-stats__number">{row.patients}</td>
                  <td className="dialysis-stats__number">{row.inpatient}</td>
                  <td className="dialysis-stats__number">{row.outpatient}</td>
                  <td className="dialysis-stats__number">{dialysisMinutesLabel(row.averageMinutes) || "-"}</td>
                </tr>
              ))}
              {stats.byModality.length === 0 && (
                <tr>
                  <td colSpan={6} className="master-search__empty">
                    この月の実施はありません
                  </td>
                </tr>
              )}
            </tbody>
            {stats.byModality.length > 1 && (
              <tfoot>
                <tr>
                  <th>合計</th>
                  <td className="dialysis-stats__number">{summary.sessions}</td>
                  <td className="dialysis-stats__number">{summary.patients}</td>
                  <td className="dialysis-stats__number">{summary.inpatient}</td>
                  <td className="dialysis-stats__number">{summary.outpatient}</td>
                  <td className="dialysis-stats__number">{dialysisMinutesLabel(summary.averageMinutes) || "-"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>

        <CapacityTable title="シフト別" heading="シフト" rows={stats.byShift} />
        <CapacityTable title="ベッド別" heading="ベッド" rows={stats.byBed} />
      </div>

      <section className="dialysis-stats__card">
        <div className="dialysis-stats__card-head">
          <h3 className="dialysis-stats__title">日別</h3>
          <button type="button" className="rp-card__compact-button" onClick={handleCsv}>
            CSV
          </button>
        </div>
        {/* 月報の形(日付を横に並べる)。行はシフトごとの実施・ベッドサイド・計・枠・稼働率。 */}
        <div className="dialysis-stats__days-wrap">
          <table className="dialysis-stats__days">
            <thead>
              <tr>
                <th className="dialysis-stats__days-head"></th>
                {stats.byDay.map((day) => (
                  <th key={day.date} className={weekdayClass(day.weekday)}>
                    {Number(day.date.slice(8, 10))}
                    <span className="dialysis-stats__weekday">{day.weekday}</span>
                  </th>
                ))}
                <th className="dialysis-stats__days-total">計</th>
              </tr>
            </thead>
            <tbody>
              {stats.dayColumns.map((column) => (
                <tr key={column.key}>
                  <th className="dialysis-stats__days-head">{column.label}</th>
                  {stats.byDay.map((day) => {
                    const cell = day.byShift[column.key];
                    return (
                      <td
                        key={day.date}
                        className={weekdayClass(day.weekday)}
                        title={`${shortDate(day.date)} ${column.label} 実施 ${cell.sessions} / 枠 ${cell.slots}`}
                      >
                        {cell.slots > 0 || cell.sessions > 0 ? cell.sessions : ""}
                      </td>
                    );
                  })}
                  <td className="dialysis-stats__days-total">
                    {stats.byDay.reduce((total, day) => total + day.byShift[column.key].sessions, 0)}
                  </td>
                </tr>
              ))}
              {summary.bedside > 0 && (
                <tr>
                  <th className="dialysis-stats__days-head">ベッドサイド</th>
                  {stats.byDay.map((day) => (
                    <td key={day.date} className={weekdayClass(day.weekday)}>
                      {day.bedside || ""}
                    </td>
                  ))}
                  <td className="dialysis-stats__days-total">{summary.bedside}</td>
                </tr>
              )}
              <tr className="dialysis-stats__days-sum">
                <th className="dialysis-stats__days-head">計</th>
                {stats.byDay.map((day) => (
                  <td key={day.date} className={weekdayClass(day.weekday)}>
                    {day.slots > 0 || day.sessions > 0 ? day.sessions : ""}
                  </td>
                ))}
                <td className="dialysis-stats__days-total">{summary.sessions}</td>
              </tr>
              <tr className="dialysis-stats__days-sub">
                <th className="dialysis-stats__days-head">枠</th>
                {stats.byDay.map((day) => (
                  <td key={day.date} className={weekdayClass(day.weekday)}>
                    {day.slots || ""}
                  </td>
                ))}
                <td className="dialysis-stats__days-total">{summary.slots}</td>
              </tr>
              <tr className="dialysis-stats__days-sub">
                <th className="dialysis-stats__days-head">稼働率</th>
                {stats.byDay.map((day) => (
                  <td key={day.date} className={weekdayClass(day.weekday)}>
                    {percentLabel(day.rate)}
                  </td>
                ))}
                <td className="dialysis-stats__days-total">{percentLabel(summary.rate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dialysis-stats__summary-card">
      <dt>{label}</dt>
      <dd>
        <span className="dialysis-stats__value">{value}</span>
        {sub && <span className="dialysis-stats__sub">{sub}</span>}
      </dd>
    </div>
  );
}

/** 日別の列の土日。 */
function weekdayClass(weekday: string): string | undefined {
  if (weekday === "日") return "dialysis-stats__sun";
  if (weekday === "土") return "dialysis-stats__sat";
  return undefined;
}

/** 日別の稼働率は幅を取らないよう整数の %。 */
function percentLabel(rate: number | undefined): string {
  return rate == null ? "" : `${Math.round(rate * 100)}%`;
}

function CapacityTable({
  title,
  heading,
  rows,
}: {
  title: string;
  heading: string;
  rows: DialysisCapacityStats[];
}) {
  const total = capacityTotal(rows);
  return (
    <section className="dialysis-stats__card">
      <h3 className="dialysis-stats__title">{title}</h3>
      <table className="master-search__table dialysis-stats__table">
        <thead>
          <tr>
            <th>{heading}</th>
            <th className="dialysis-stats__number">枠</th>
            <th className="dialysis-stats__number">予約</th>
            <th className="dialysis-stats__number">未来院</th>
            <th className="dialysis-stats__number">実施</th>
            <th className="dialysis-stats__number">稼働率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="dialysis-stats__number">{row.slots || "-"}</td>
              <td className="dialysis-stats__number">{row.booked}</td>
              <td className="dialysis-stats__number">{row.noshow}</td>
              <td className="dialysis-stats__number">{row.sessions}</td>
              <td className="dialysis-stats__number">{rateLabel(row.rate)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                透析室のベッドがありません
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <th>合計</th>
              <td className="dialysis-stats__number">{total.slots}</td>
              <td className="dialysis-stats__number">{total.booked}</td>
              <td className="dialysis-stats__number">{total.noshow}</td>
              <td className="dialysis-stats__number">{total.sessions}</td>
              <td className="dialysis-stats__number">{rateLabel(total.rate)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}
