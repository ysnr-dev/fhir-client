import { useRef, useState, type PointerEvent } from "react";
import { formatValue, niceTicks } from "../chartScale";

// 累積発生率の階段グラフ(docs/data-extract-design.md §25)。x は基準日からの日数(数値)、y は %。
// 系列の色はカテゴリ配色 .patient-chart__s1〜s8。乗った日数の全系列の値をツールチップに出す。

export interface StepSeries {
  label: string;
  /** 色の枠(1〜8)。 */
  slot: number;
  /** 時刻の順の点(最初は t=0)。値はその時刻の直後の値。 */
  points: { t: number; value: number }[];
}

interface Props {
  title: string;
  series: StepSeries[];
  /** x の最大の日数。 */
  maxT: number;
}

const VB_WIDTH = 720;
const VB_HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 24, left: 52 };
const PLOT_W = VB_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = VB_HEIGHT - MARGIN.top - MARGIN.bottom;

/** 時刻 t での階段の値(最後の点より後は最後の値)。 */
function valueAt(points: { t: number; value: number }[], t: number): number {
  let value = 0;
  for (const point of points) {
    if (point.t > t) break;
    value = point.value;
  }
  return value;
}

export function StepCurveChart({ title, series, maxT }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  if (series.length === 0 || maxT <= 0) return null;
  const top = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1);
  const yTicks = niceTicks(0, Math.min(100, Math.max(top, 5)));
  const high = yTicks[yTicks.length - 1];
  // x の目盛りは切りのよい日数と、最後に最大の日数(最大に近すぎる目盛りは出さない)。
  const xTicks = [...niceTicks(0, maxT, 1).filter((t) => t < maxT * 0.9), maxT];
  const toX = (t: number) => MARGIN.left + (t / maxT) * PLOT_W;
  const toY = (value: number) => MARGIN.top + PLOT_H - (value / (high || 1)) * PLOT_H;

  const pathOf = (points: { t: number; value: number }[]) => {
    let d = `M${toX(0)},${toY(0)}`;
    let y = toY(0);
    for (const point of points) {
      const x = toX(Math.min(point.t, maxT));
      d += ` H${x}`;
      y = toY(point.value);
      d += ` V${y}`;
      if (point.t >= maxT) break;
    }
    d += ` H${toX(maxT)}`;
    return d;
  };

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * VB_WIDTH;
    const t = Math.round(((x - MARGIN.left) / PLOT_W) * maxT);
    setActive(Math.min(maxT, Math.max(0, t)));
  }

  return (
    <figure className="extract-breakdown-chart extract-breakdown-chart--series" aria-label={title}>
      <figcaption className="extract-breakdown-chart__title">{title}</figcaption>
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
          aria-label={title}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line className="lab-chart__grid" x1={MARGIN.left} x2={VB_WIDTH - MARGIN.right} y1={toY(tick)} y2={toY(tick)} />
              <text className="lab-chart__tick" x={MARGIN.left - 8} y={toY(tick) + 3.5} textAnchor="end">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={t}
              className="lab-chart__tick"
              x={toX(t)}
              y={VB_HEIGHT - 6}
              textAnchor={i === 0 ? "start" : t === xTicks[xTicks.length - 1] ? "end" : "middle"}
            >
              {`${formatValue(t)}日`}
            </text>
          ))}
          {active !== null && (
            <line className="lab-chart__crosshair" x1={toX(active)} x2={toX(active)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} />
          )}
          {series.map((s) => (
            <g key={s.label} className={`patient-chart__s${s.slot}`}>
              <path className="lab-chart__line" d={pathOf(s.points)} />
            </g>
          ))}
        </svg>
        {active !== null && (
          <div
            className="lab-chart__tooltip extract-breakdown-chart__series-tooltip"
            style={{ left: `${Math.min(85, Math.max(15, (toX(active) / VB_WIDTH) * 100))}%`, top: 0 }}
          >
            <span className="lab-chart__tooltip-date">{`${active}日`}</span>
            {series.map((s) => (
              <span key={s.label} className={`patient-chart__tooltip-row patient-chart__s${s.slot}`}>
                <svg className="patient-chart__swatch" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4" fill="var(--chart-series)" />
                </svg>
                <span className="patient-chart__legend-name">{s.label}</span>
                <span className="lab-chart__tooltip-value">{`${formatValue(valueAt(s.points, active))}%`}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
