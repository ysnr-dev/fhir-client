import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLabResultItemsByJlac11Codes } from "../api/masterQueries";
import { useLabResultTimeline } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { LabTimelineChart, type LabTimelineSeries } from "./LabTimelineChart";
import { Modal } from "./Modal";
import {
  buildLabTimeline,
  interpretationClass,
  isCorrectedReport,
  labReportStatusDisplay,
  legacyJlac11CodesOf,
  resultItemAliases,
  type LabTimelineRow,
} from "../fhir/labResultHelpers";
import { flowsheetDayLabel } from "../fhir/vitalHelpers";

// 検査結果の時系列表示。時系列表示ページとカルテ画面の「検体検査時系列」タブの双方から使う。

const DEFAULT_DATE_COUNT = 10;
const MAX_DATE_COUNT = 100;

interface LabResultTimelinePanelProps {
  patientId: string;
  // 指定時はキー(LabTimelineRow.key)が一致する検査項目の行だけを表示する。
  // 検査結果内容ページの「選択項目のみ時系列表示」で使う。
  filterKeys?: ReadonlySet<string>;
}

export function LabResultTimelinePanel({ patientId, filterKeys }: LabResultTimelinePanelProps) {
  const [dateCount, setDateCount] = useState(DEFAULT_DATE_COUNT);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useLabResultTimeline(patientId, dateCount);
  // 結果項目マスタ導入前の保存済み結果(施設コード無し)を、同じ JLAC11 を持つ結果項目の
  // 行に合流させる。読み替えが揃うまで待つ(先に描くと行が一度分かれてから合流する)。
  const legacyCodes = useMemo(() => legacyJlac11CodesOf(data?.observations ?? []), [data]);
  const legacyItems = useLabResultItemsByJlac11Codes(legacyCodes);
  const aliases = useMemo(
    () => resultItemAliases(legacyItems.data?.items ?? []),
    [legacyItems.data],
  );
  const timeline = useMemo(
    () => buildLabTimeline(data?.reports ?? [], data?.observations ?? [], dateCount, aliases),
    [data, dateCount, aliases],
  );
  const rows = useMemo(
    () => (filterKeys ? timeline.rows.filter((row) => filterKeys.has(row.key)) : timeline.rows),
    [timeline, filterKeys],
  );

  // 中間報告・訂正報告の印の凡例を出すかどうか。
  const hasMarkedValues = useMemo(() => rows.some((row) => row.statuses.size > 0), [rows]);

  // 日付の列は古い順に並ぶため、開いた時点では右端(最新)が見えるようにする。
  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, [timeline.dates, rows]);

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
    return rows
      .filter((row) => checkedKeys.has(row.key) && row.numbers.size > 0)
      .map((row) => ({
        key: row.key,
        name: row.name || row.abbreviation,
        unit: row.unit,
        // timeline.dates は古い順なので、グラフの X 軸もそのまま古い順になる。
        points: timeline.dates.flatMap((date) => {
          const value = row.numbers.get(date);
          return value != null ? [{ date, value }] : [];
        }),
      }));
  }, [timeline, rows, checkedKeys]);

  return (
    <>
      <ErrorBanner error={error ?? legacyItems.error} />

      {isLoading || legacyItems.isLoading ? (
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
            {/* 印の意味は凡例が無いと伝わらないので、印の付いた値があるときだけ添える。 */}
            <span className="lab-timeline__hint">
              {hasMarkedValues && "◦ 中間報告 / ▴ 訂正報告"}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="patient-table__empty">検査結果がありません</p>
          ) : (
            <div className="lab-timeline__table-wrap" ref={tableWrapRef}>
              <table className="lab-timeline__table lab-timeline__table--ruled">
                <thead>
                  {/* 日付カラムは mm/dd のみ表示し、年は上段にまとめる。 */}
                  <tr>
                    <th className="lab-timeline__item-col" rowSpan={2}>
                      検査項目(略称)
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={2}>
                      単位
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={2}>
                      基準値
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
                        {monthDayWeekday(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
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

// "YYYY-MM-DD" -> "MM/DD(曜)"。想定外の形式はそのまま返す。
function monthDayWeekday(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return date;
  return flowsheetDayLabel(date.slice(0, 10)).label;
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
      <td className="lab-timeline__unit-col">{row.referenceRange}</td>
      {dates.map((date) => {
        // 中間報告・訂正報告は値の読み方が変わるので、列を増やさずセルの印で示す。
        const status = row.statuses.get(date) ?? "";
        const mark = status
          ? isCorrectedReport(status)
            ? " lab-timeline__value--corrected"
            : " lab-timeline__value--preliminary"
          : "";
        return (
          <td
            key={date}
            className={
              interpretationClass(row.interpretations.get(date) ?? "", "lab-timeline__value") + mark
            }
            title={status ? labReportStatusDisplay(status) : undefined}
          >
            {row.values.get(date) ?? ""}
          </td>
        );
      })}
    </tr>
  );
}
