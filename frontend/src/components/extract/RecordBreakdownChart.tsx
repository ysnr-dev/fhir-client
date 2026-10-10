import { useRef, useState, type PointerEvent } from "react";
import type { BreakdownRatio, RecordBreakdown } from "../../fhir/recordBreakdownHelpers";
import { formatValue, niceTicks } from "../chartScale";

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

const VB_WIDTH = 720;
const VB_HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 24, left: 52 };
const PLOT_W = VB_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = VB_HEIGHT - MARGIN.top - MARGIN.bottom;
/** 期間の名前を重ねずに置ける最小の間隔(viewBox 座標)。 */
const MIN_LABEL_GAP = 72;

interface Series {
  label: string;
  /** 色の枠(1〜8)。描く系列の、表の列の並びでの順番。 */
  slot: number;
  values: (number | null)[];
}

/** 列の値ごとの折れ線。値は件数・割合(%)か集計値。値の無い期間で線を切る。 */
function SeriesChart({ breakdown, ratio }: { breakdown: RecordBreakdown; ratio: BreakdownRatio | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
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
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (all.length === 0) return null;
  // 件数・割合は 0 から、集計値(検査値の平均など)は値の幅で軸を取る。
  const ticks = withValue
    ? niceTicks(Math.min(...all), Math.max(...all))
    : niceTicks(0, Math.max(...all, 1), ratio ? 0 : 1);
  const [low, high] = [ticks[0], ticks[ticks.length - 1]];
  const toY = (value: number) => MARGIN.top + PLOT_H - ((value - low) / (high - low || 1)) * PLOT_H;
  const step = rows.length > 1 ? PLOT_W / (rows.length - 1) : 0;
  const toX = (i: number) => MARGIN.left + i * step;
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_GAP / (step || MIN_LABEL_GAP)));
  // 最後の期間はいつも出し、それに近すぎる途中の目盛りは出さない(文字が重ならないように)。
  const last = rows.length - 1;
  const isLabeled = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery);
  const unit = withValue ? "" : ratio ? "%" : " 件";
  const title = withValue
    ? breakdown.valueLabel
    : ratio === "row"
      ? "行の中の割合"
      : ratio === "column"
        ? "列の中の割合"
        : "件数";

  const pathOf = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${i === 0 || values[i - 1] === null ? "M" : "L"}${toX(i)},${toY(v)}`))
      .filter(Boolean)
      .join(" ");

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * VB_WIDTH;
    const index = Math.round((x - MARGIN.left) / (step || 1));
    setActive(Math.min(rows.length - 1, Math.max(0, index)));
  }

  return (
    <figure className="extract-breakdown-chart extract-breakdown-chart--series" aria-label={`${title}の推移`}>
      <figcaption className="extract-breakdown-chart__title">
        {`${title}の推移(${breakdown.columnAxis}ごと)`}
      </figcaption>
      <ul className="patient-chart__legend extract-breakdown-chart__legend">
        {series.map((s) => (
          <li key={s.label} className={`patient-chart__s${s.slot}`}>
            <svg className="patient-chart__swatch" viewBox="0 0 12 12" aria-hidden="true">
              <circle cx="6" cy="6" r="4" fill="var(--chart-series)" />
            </svg>
            <span className="patient-chart__legend-name">{s.label}</span>
          </li>
        ))}
      </ul>
      <div className="lab-chart extract-breakdown-chart__series">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          role="img"
          aria-label={`${title}の推移`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="lab-chart__grid"
                x1={MARGIN.left}
                x2={VB_WIDTH - MARGIN.right}
                y1={toY(tick)}
                y2={toY(tick)}
              />
              <text className="lab-chart__tick" x={MARGIN.left - 8} y={toY(tick) + 3.5} textAnchor="end">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {rows.map(({ label }, i) =>
            isLabeled(i) ? (
              <text
                key={label}
                className="lab-chart__tick"
                x={toX(i)}
                y={VB_HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}
              >
                {label}
              </text>
            ) : null,
          )}
          {active !== null && (
            <line
              className="lab-chart__crosshair"
              x1={toX(active)}
              x2={toX(active)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_H}
            />
          )}
          {series.map((s) => (
            <g key={s.label} className={`patient-chart__s${s.slot}`}>
              <path className="lab-chart__line" d={pathOf(s.values)} />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} className="lab-chart__marker" cx={toX(i)} cy={toY(v)} r={active === i ? 5 : 4} />
                ),
              )}
            </g>
          ))}
        </svg>
        {active !== null && (
          <div
            className="lab-chart__tooltip extract-breakdown-chart__series-tooltip"
            style={{ left: `${Math.min(85, Math.max(15, (toX(active) / VB_WIDTH) * 100))}%`, top: 0 }}
          >
            <span className="lab-chart__tooltip-date">{rows[active].label}</span>
            {series.map((s) => (
              <span key={s.label} className={`patient-chart__tooltip-row patient-chart__s${s.slot}`}>
                <svg className="patient-chart__swatch" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4" fill="var(--chart-series)" />
                </svg>
                <span className="patient-chart__legend-name">{s.label}</span>
                <span className="lab-chart__tooltip-value">
                  {s.values[active] === null ? "-" : `${formatValue(s.values[active]!)}${unit}`}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      {hidden > 0 && (
        <p className="order-select__muted">
          {`件数の多い ${shown.length} 系列を描いています(ほか ${hidden} 系列は表にだけ出ています)。`}
        </p>
      )}
    </figure>
  );
}

function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
