import { useMemo, useState } from "react";
import { useLabResultTimeline } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { LabTimelineChart, type LabTimelineSeries } from "./LabTimelineChart";
import { Modal } from "./Modal";
import {
  buildLabTimeline,
  interpretationClass,
  type LabTimelineRow,
} from "../fhir/labResultHelpers";

// 検査結果の時系列表示。時系列表示ページとカルテ画面の検査結果タブの双方から使う。

const DEFAULT_DATE_COUNT = 10;
const MAX_DATE_COUNT = 100;

export function LabResultTimelinePanel({ patientId }: { patientId: string }) {
  const [dateCount, setDateCount] = useState(DEFAULT_DATE_COUNT);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(false);

  const { data, isLoading, error } = useLabResultTimeline(patientId, dateCount);
  const timeline = useMemo(
    () => buildLabTimeline(data?.reports ?? [], data?.observations ?? [], dateCount),
    [data, dateCount],
  );

  function handleDateCountChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    setDateCount(Math.min(MAX_DATE_COUNT, Math.max(1, Math.round(raw))));
  }

  function toggleChecked(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const chartSeries: LabTimelineSeries[] = useMemo(() => {
    // グラフの X 軸は古い順に並べる。
    const datesAscending = [...timeline.dates].reverse();
    return timeline.rows
      .filter((row) => checkedKeys.has(row.key) && row.numbers.size > 0)
      .map((row) => ({
        key: row.key,
        name: row.name || row.abbreviation,
        unit: row.unit,
        points: datesAscending.flatMap((date) => {
          const value = row.numbers.get(date);
          return value != null ? [{ date, value }] : [];
        }),
      }));
  }, [timeline, checkedKeys]);

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-timeline__controls">
            <label className="lab-timeline__count">
              履歴の表示数
              <input
                type="number"
                min={1}
                max={MAX_DATE_COUNT}
                value={dateCount}
                onChange={(e) => handleDateCountChange(e.target.valueAsNumber)}
              />
            </label>
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              disabled={chartSeries.length === 0}
            >
              グラフ表示
            </button>
            <span className="lab-timeline__hint" />
          </div>

          {timeline.rows.length === 0 ? (
            <p className="patient-table__empty">検査結果がありません</p>
          ) : (
            <div className="lab-timeline__table-wrap">
              <table className="lab-timeline__table">
                <thead>
                  {/* 日付カラムは mm/dd のみ表示し、年は上段にまとめる。 */}
                  <tr>
                    <th className="lab-timeline__item-col" rowSpan={2}>
                      検査項目(略称)
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={2}>
                      単位
                    </th>
                    {groupDatesByYear(timeline.dates).map((group) => (
                      <th
                        key={group.dates[0]}
                        className="lab-timeline__year-col"
                        colSpan={group.dates.length}
                      >
                        {group.year}年
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {timeline.dates.map((date) => (
                      <th key={date} className="lab-timeline__date-col" title={date}>
                        {monthDay(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeline.rows.map((row) => (
                    <TimelineRow
                      key={row.key}
                      row={row}
                      dates={timeline.dates}
                      checked={checkedKeys.has(row.key)}
                      onToggle={() => toggleChecked(row.key)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {chartOpen && (
        <Modal title="検査結果グラフ" onClose={() => setChartOpen(false)} className="modal--wide">
          <LabTimelineChart series={chartSeries} />
        </Modal>
      )}
    </>
  );
}

// "YYYY-MM-DD" -> "MM/DD"。想定外の形式はそのまま返す。
function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[2]}/${m[3]}` : date;
}

// 連続する同じ年の日付をまとめる。年不明の日付は単独グループにする。
function groupDatesByYear(dates: string[]): { year: string; dates: string[] }[] {
  const groups: { year: string; dates: string[] }[] = [];
  for (const date of dates) {
    const year = /^(\d{4})-/.exec(date)?.[1] ?? "";
    const last = groups[groups.length - 1];
    if (last && year && last.year === year) {
      last.dates.push(date);
    } else {
      groups.push({ year, dates: [date] });
    }
  }
  return groups;
}

interface TimelineRowProps {
  row: LabTimelineRow;
  dates: string[];
  checked: boolean;
  onToggle: () => void;
}

function TimelineRow({ row, dates, checked, onToggle }: TimelineRowProps) {
  const plottable = row.numbers.size > 0;
  return (
    <tr>
      <td className="lab-timeline__item-col">
        <label className="lab-timeline__item-label">
          <input
            type="checkbox"
            checked={checked && plottable}
            disabled={!plottable}
            onChange={onToggle}
          />
          <span title={row.name}>{row.abbreviation || row.name}</span>
        </label>
      </td>
      <td className="lab-timeline__unit-col">{row.unit}</td>
      {dates.map((date) => (
        <td
          key={date}
          className={interpretationClass(
            row.interpretations.get(date) ?? "",
            "lab-timeline__value",
          )}
        >
          {row.values.get(date) ?? ""}
        </td>
      ))}
    </tr>
  );
}
