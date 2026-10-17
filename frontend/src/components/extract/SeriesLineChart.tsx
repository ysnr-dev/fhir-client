import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formatValue, niceTicks } from "../chartScale";

// 期間ごとの値の折れ線(内訳の列ごとの推移と、指標の割合の推移)。x は並べた期間の名前(等間隔)、
// 系列の色はカテゴリ配色 .patient-chart__s1〜s8。値の無い期間で線を切る。

export interface LineSeries {
  label: string;
  /** 色の枠(1〜8)。 */
  slot: number;
  values: (number | null)[];
}

interface Props {
  title: string;
  /** x の期間の名前(系列の values と同じ長さ)。 */
  labels: string[];
  series: LineSeries[];
  /** 値に添える単位(「%」「 件」)。 */
  unit: string;
  /** 軸を 0 から取る(件数・割合)。false なら値の幅で取る(検査値の平均など)。 */
  fromZero: boolean;
  /** 軸の目盛りの最小の幅(件数は 1)。 */
  minStep?: number;
  /** 水平の参照線(指標の目標)。 */
  reference?: { value: number; label: string };
  /** 図の下に出す注記。 */
  note?: ReactNode;
}

const VB_WIDTH = 720;
const VB_HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 24, left: 52 };
const PLOT_W = VB_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = VB_HEIGHT - MARGIN.top - MARGIN.bottom;
/** 期間の名前を重ねずに置ける最小の間隔(viewBox 座標)。 */
const MIN_LABEL_GAP = 72;

export function SeriesLineChart({ title, labels, series, unit, fromZero, minStep, reference, note }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (labels.length < 2 || series.length === 0 || all.length === 0) return null;
  const withReference = reference ? [...all, reference.value] : all;
  const ticks = fromZero
    ? niceTicks(0, Math.max(...withReference, minStep ?? 1), minStep)
    : niceTicks(Math.min(...withReference), Math.max(...withReference));
  const [low, high] = [ticks[0], ticks[ticks.length - 1]];
  const toY = (value: number) => MARGIN.top + PLOT_H - ((value - low) / (high - low || 1)) * PLOT_H;
  const step = labels.length > 1 ? PLOT_W / (labels.length - 1) : 0;
  const toX = (i: number) => MARGIN.left + i * step;
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_GAP / (step || MIN_LABEL_GAP)));
  // 最後の期間はいつも出し、それに近すぎる途中の目盛りは出さない(文字が重ならないように)。
  const last = labels.length - 1;
  const isLabeled = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery);

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
    setActive(Math.min(labels.length - 1, Math.max(0, index)));
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
        {reference && (
          <li className="extract-breakdown-chart__reference">
            <svg className="patient-chart__swatch" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="0" x2="12" y1="6" y2="6" />
            </svg>
            <span className="patient-chart__legend-name">{`${reference.label} ${formatValue(reference.value)}${unit}`}</span>
          </li>
        )}
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
          {labels.map((label, i) =>
            isLabeled(i) ? (
              <text
                key={`${label}-${i}`}
                className="lab-chart__tick"
                x={toX(i)}
                y={VB_HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
              >
                {label}
              </text>
            ) : null,
          )}
          {reference && (
            <line
              className="extract-breakdown-chart__reference-line"
              x1={MARGIN.left}
              x2={VB_WIDTH - MARGIN.right}
              y1={toY(reference.value)}
              y2={toY(reference.value)}
            />
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
            <span className="lab-chart__tooltip-date">{labels[active]}</span>
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
      {note}
    </figure>
  );
}
