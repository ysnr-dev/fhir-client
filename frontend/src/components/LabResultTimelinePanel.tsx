import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLabResultItemsByJlac11Codes } from "../api/masterQueries";
import { useLabResultTimeline } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { KarteSplitter } from "./KarteSplitter";
import { TruncatedNotice } from "./TruncatedNotice";
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
import {
  clampTopRatio,
  readLabTimelineSplit,
  readLabTimelineTopRatio,
  storeLabTimelineSplit,
  storeLabTimelineTopRatio,
} from "../karteLayout";

// 検査結果の時系列表示。時系列表示ページとカルテ画面の「検体検査時系列」タブの双方から使う。

const DEFAULT_DATE_COUNT = 10;
const MAX_DATE_COUNT = 100;

interface LabResultTimelinePanelProps {
  patientId: string;
  // 指定時はキー(LabTimelineRow.key)が一致する検査項目の行だけを表示する。
  // 検査結果内容ページの「選択項目のみ時系列表示」で使う。
  filterKeys?: ReadonlySet<string>;
  // 上下分割(上に表、下にチェックした項目のグラフ)を使えるようにする。
  // 高さの決まった領域(カルテの左ペイン)に置くときだけ指定する。
  splittable?: boolean;
}

export function LabResultTimelinePanel({
  patientId,
  filterKeys,
  splittable = false,
}: LabResultTimelinePanelProps) {
  const [dateCount, setDateCount] = useState(DEFAULT_DATE_COUNT);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(false);
  const [splitPref, setSplitPref] = useState(readLabTimelineSplit);
  const [topRatio, setTopRatio] = useState(readLabTimelineTopRatio);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const split = splittable && splitPref;

  const { data, isLoading, error } = useLabResultTimeline(patientId, dateCount);
  // 施設コードを持たない結果(JLAC11 のみ)を、同じ JLAC11 を持つ結果項目の
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
  // 分割を切り替えると表を組み直すので、そのときも右端に戻す。
  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, [timeline.dates, rows, split]);

  function handleDateCountChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    setDateCount(Math.min(MAX_DATE_COUNT, Math.max(1, Math.round(raw))));
  }

  function toggleSplit() {
    const next = !split;
    setSplitPref(next);
    storeLabTimelineSplit(next);
    // 分割中はグラフを下に出すので、開いていたモーダルは閉じる。
    if (next) setChartOpen(false);
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

  const notices = (
    <>
      <ErrorBanner error={error ?? legacyItems.error} />
      <TruncatedNotice show={data?.truncated}>
        件数が多いため、古い結果の一部を表示できていません。表示回数を減らしてください。
      </TruncatedNotice>
    </>
  );

  const body =
    isLoading || legacyItems.isLoading ? (
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
          {!split && (
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              disabled={chartSeries.length === 0}
            >
              グラフ表示
            </button>
          )}
          {/* 印の意味は凡例が無いと伝わらないので、印の付いた値があるときだけ添える。 */}
          <span className="lab-timeline__hint">
            {hasMarkedValues && "◦ 中間報告 / ▴ 訂正報告"}
          </span>
          {splittable && <SplitToggleButton split={split} onToggle={toggleSplit} />}
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
    );

  if (split) {
    return (
      <div className="lab-timeline--split" ref={splitRef}>
        <div className="lab-timeline__split-top" style={{ flexBasis: `${topRatio * 100}%` }}>
          {notices}
          {body}
        </div>
        <KarteSplitter
          containerRef={splitRef}
          orientation="horizontal"
          ratio={topRatio}
          label="時系列表とグラフの高さ"
          onChange={(ratio) => setTopRatio(clampTopRatio(ratio))}
          onChangeEnd={storeLabTimelineTopRatio}
        />
        <div className="lab-timeline__split-bottom">
          {chartSeries.length > 0 ? (
            <LabTimelineChart series={chartSeries} />
          ) : (
            <p className="patient-table__empty">グラフ表示する項目が選択されていません</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {notices}
      {body}

      {chartOpen && (
        <Modal title="検査結果グラフ" onClose={() => setChartOpen(false)} className="modal--wide">
          <LabTimelineChart series={chartSeries} />
        </Modal>
      )}
    </>
  );
}

// 表とグラフを上下に並べるかどうかの切り替え。カルテのタブ行の分割ボタンと同じ見た目にする。
function SplitToggleButton({ split, onToggle }: { split: boolean; onToggle: () => void }) {
  const label = split ? "グラフをモーダルで表示する" : "表とグラフを上下に並べる";
  return (
    <button
      type="button"
      className={`karte-tabs__mode lab-timeline__split-toggle${
        split ? " karte-tabs__mode--active" : ""
      }`}
      aria-pressed={split}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        {/* 分割中は 1 枚に戻すアイコン、通常時は上下に割るアイコンを出す。 */}
        {!split && <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
    </button>
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
