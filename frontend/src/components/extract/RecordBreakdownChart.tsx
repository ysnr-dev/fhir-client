import { useState } from "react";
import type { BreakdownRatio, RecordBreakdown } from "../../fhir/recordBreakdownHelpers";
import { SeriesLineChart } from "./SeriesLineChart";

interface Props {
  breakdown: RecordBreakdown;
  /** 行の軸が期間のときだけ描く(期間ごとの件数・集計値の推移)。 */
  periodOnRows: boolean;
  /** 件数を割合で見ているとき(列に分けたときは系列の値も割合にする)。 */
  ratio: BreakdownRatio | null;
}

/** 日付の無い行と、軸が無いときの「計」の行は棒・点にしない。 */
const SKIP = new Set(["(なし)", "計"]);

/** 系列の数の上限(カテゴリ配色 .patient-chart__s1〜s8 の数)。 */
export const BREAKDOWN_CHART_MAX_SERIES = 8;

/**
 * 内訳の期間の推移(docs/data-extract-design.md §18・§21)。行の軸が期間のとき、列に分けていなければ
 * 行ごとの件数か集計値を 1 系列の棒にし、列に分けていれば列の値ごとの折れ線にする(比較群ごとの推移の比較)。
 * 数は下の表にもある(表が図の読み替え)。
 */
export function RecordBreakdownChart({ breakdown, periodOnRows, ratio }: Props) {
  if (!periodOnRows) return null;
  if (breakdown.columnLabels.length > 0) return <SeriesChart breakdown={breakdown} ratio={ratio} />;
  return <TotalBars breakdown={breakdown} />;
}

function TotalBars({ breakdown }: { breakdown: RecordBreakdown }) {
  const [hover, setHover] = useState<number | null>(null);
  const withValue = breakdown.valueLabel !== null;
  const bars = breakdown.rowLabels
    .map((label, r) => ({
      label,
      value: withValue ? (breakdown.rowTotals[r].value ?? 0) : breakdown.rowTotals[r].records,
      records: breakdown.rowTotals[r].records,
    }))
    .filter((bar) => !SKIP.has(bar.label));
  if (bars.length < 2) return null;
  const max = Math.max(...bars.map((bar) => bar.value), 0);
  if (max <= 0) return null;
  // 目盛りの文字が重ならないよう、最初・真ん中・最後だけに期間の名前を出す。
  const labeled = new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]);
  const title = withValue ? breakdown.valueLabel : "件数";

  return (
    <figure className="extract-breakdown-chart" aria-label={`${title}の推移`}>
      <figcaption className="extract-breakdown-chart__title">
        {`${title}の推移`}
        <span className="extract-breakdown-chart__max">{`最大 ${max}`}</span>
      </figcaption>
      <div className="extract-breakdown-chart__plot" onMouseLeave={() => setHover(null)}>
        {bars.map((bar, i) => (
          <div
            key={bar.label}
            className="extract-breakdown-chart__slot"
            onMouseEnter={() => setHover(i)}
            aria-label={`${bar.label} ${bar.value}`}
          >
            <div
              className={`extract-breakdown-chart__bar${hover === i ? " is-hover" : ""}`}
              style={{ height: `${(bar.value / max) * 100}%` }}
            />
            {hover === i && (
              <div className="extract-breakdown-chart__tooltip" role="tooltip">
                <strong>{bar.label}</strong>
                <span>{withValue ? `${title} ${bar.value}(${bar.records} 件)` : `${bar.value} 件`}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="extract-breakdown-chart__axis">
        {bars.map((bar, i) => (
          <span key={bar.label} className="extract-breakdown-chart__tick">
            {labeled.has(i) ? bar.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** 系列の数の上限は BREAKDOWN_CHART_MAX_SERIES。 */
interface Series {
  label: string;
  /** 色の枠(1〜8)。描く系列の、表の列の並びでの順番。 */
  slot: number;
  values: (number | null)[];
}

/** 列の値ごとの折れ線。値は件数・割合(%)か集計値。 */
function SeriesChart({ breakdown, ratio }: { breakdown: RecordBreakdown; ratio: BreakdownRatio | null }) {
  const withValue = breakdown.valueLabel !== null;
  const rows = breakdown.rowLabels.flatMap((label, r) => (SKIP.has(label) ? [] : [{ label, r }]));
  const ranked = breakdown.columnLabels
    .map((label, c) => ({ label, c, records: breakdown.columnTotals[c].records }))
    .filter((column) => !SKIP.has(column.label) && column.label !== "(なし)");
  // 系列は件数の多い順に上限まで。色は表の列の並びの順に割り当てる(表と図で並びをそろえる)。
  const shown = [...ranked]
    .sort((a, b) => b.records - a.records)
    .slice(0, BREAKDOWN_CHART_MAX_SERIES)
    .sort((a, b) => a.c - b.c);
  const hidden = ranked.length - shown.length;
  if (rows.length < 2 || shown.length === 0) return null;

  const valueOf = (r: number, c: number): number | null => {
    const cell = breakdown.cells[r][c];
    if (withValue) return cell.value;
    if (ratio === "row") return percentOf(cell.records, breakdown.rowTotals[r].records);
    if (ratio === "column") return percentOf(cell.records, breakdown.columnTotals[c].records);
    return cell.records;
  };
  const series: Series[] = shown.map(({ label, c }, i) => ({
    label,
    slot: i + 1,
    values: rows.map(({ r }) => valueOf(r, c)),
  }));
  const title = withValue
    ? breakdown.valueLabel
    : ratio === "row"
      ? "行の中の割合"
      : ratio === "column"
        ? "列の中の割合"
        : "件数";

  return (
    <SeriesLineChart
      title={`${title}の推移(${breakdown.columnAxis}ごと)`}
      labels={rows.map(({ label }) => label)}
      series={series}
      unit={withValue ? "" : ratio ? "%" : " 件"}
      fromZero={!withValue}
      minStep={withValue || ratio ? undefined : 1}
      note={
        hidden > 0 ? (
          <p className="order-select__muted">
            {`件数の多い ${shown.length} 系列を描いています(ほか ${hidden} 系列は表にだけ出ています)。`}
          </p>
        ) : undefined
      }
    />
  );
}

function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
