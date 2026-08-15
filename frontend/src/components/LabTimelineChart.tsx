import { useRef, useState } from "react";

export interface LabTimelinePoint {
  /**
   * 検体採取日 "YYYY-MM-DD"、または測定日時 "YYYY-MM-DDTHH:mm"(経過表)。
   * 日時を渡すと横軸の位置が時刻まで反映される(同じ日の朝夕が重ならない)。
   * タイムゾーンを持たない形式で渡すこと(端末のローカル時刻として扱う)。
   */
  date: string;
  value: number;
}

export interface LabTimelineSeries {
  key: string;
  name: string;
  unit: string;
  // 日付昇順
  points: LabTimelinePoint[];
}

interface LabTimelineChartProps {
  series: LabTimelineSeries[];
}

// 検査項目ごとに値のスケールが大きく異なる(例: Hb と血小板数)ため、
// 1 つの軸に重ねず項目ごとのパネル(スモールマルチプル)で縦に並べる。
export function LabTimelineChart({ series }: LabTimelineChartProps) {
  return (
    <div className="lab-chart-list">
      {series.map((s) => (
        <ChartPanel key={s.key} series={s} />
      ))}
    </div>
  );
}

const VB_WIDTH = 640;
const VB_HEIGHT = 200;
const MARGIN = { top: 20, right: 28, bottom: 26, left: 56 };
const PLOT_W = VB_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = VB_HEIGHT - MARGIN.top - MARGIN.bottom;
// X 軸ラベルを重ねずに置ける最小間隔(viewBox 座標)。
const MIN_LABEL_GAP = 56;

function formatValue(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function formatDate(date: string, withYear: boolean): string {
  // 日時("...T09:00")で渡されることもあるので日付部分だけを見る。
  const [y, m, d] = date.slice(0, 10).split("-");
  const md = `${Number(m)}/${Number(d)}`;
  return withYear ? `${y}/${md}` : md;
}

/** ツールチップの見出し。日時で渡されたときだけ時刻も出す。 */
function formatPointDate(date: string): string {
  const time = date.slice(11, 16);
  return time ? `${date.slice(0, 10)} ${time}` : date;
}

// 値域を覆う「きりのよい」目盛り(4分割程度)を返す。
function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    // 全点が同じ値のときは値を中央に置ける適当な幅をとる。
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const rawStep = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; ; v += step) {
    // 0.30000000000000004 のような誤差を丸める。
    const tick = Number(v.toPrecision(12));
    ticks.push(tick);
    if (tick >= max) break;
  }
  return ticks;
}

function ChartPanel({ series }: { series: LabTimelineSeries }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const { points } = series;
  const times = points.map((p) => Date.parse(p.date));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const toX = (t: number) =>
    tMax === tMin ? MARGIN.left + PLOT_W / 2 : MARGIN.left + ((t - tMin) / (tMax - tMin)) * PLOT_W;
  const toY = (v: number) => MARGIN.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  const xs = times.map(toX);
  const ys = values.map(toY);
  const linePath = points
    .map((_, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
    .join(" ");

  // X 軸の日付ラベルは点位置から最大 5 個に間引く。
  const labelCount = Math.min(5, points.length);
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, i) =>
      Math.round((i * (points.length - 1)) / Math.max(1, labelCount - 1)),
    ),
  );
  const years = points.map((p) => p.date.slice(0, 4));
  // 横軸は時間に比例するので、近い時刻の点はラベルが重なる(経過表の朝夕の測定など)。
  // 左から順に、直前に採用したラベルと間隔が足りるものだけを残す。末尾は必ず出したい
  // ので、末尾に近すぎる採用済みラベルは落としてから足す。
  const labelList: number[] = [];
  for (const index of [...labelIndexes].sort((a, b) => a - b)) {
    const previous = labelList[labelList.length - 1];
    if (previous === undefined || xs[index] - xs[previous] >= MIN_LABEL_GAP) labelList.push(index);
  }
  const lastPoint = points.length - 1;
  if (labelList[labelList.length - 1] !== lastPoint) {
    while (labelList.length && xs[lastPoint] - xs[labelList[labelList.length - 1]] < MIN_LABEL_GAP) {
      labelList.pop();
    }
    labelList.push(lastPoint);
  }
  // 同じ日に複数の点が残ったときは、2 つ目以降のラベルを時刻に差し替える
  // (同じ日付が並んでも区別できないため)。
  const sameDayAsPreviousLabel = new Set(
    labelList.filter(
      (index, n) => n > 0 && points[labelList[n - 1]].date.slice(0, 10) === points[index].date.slice(0, 10),
    ),
  );
  const labelSet = new Set(labelList);
  const axisLabel = (index: number) =>
    sameDayAsPreviousLabel.has(index) && points[index].date.slice(11, 16)
      ? points[index].date.slice(11, 16)
      : formatDate(points[index].date, index === 0 || years[index] !== years[index - 1]);

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VB_WIDTH;
    let nearest = 0;
    for (let i = 1; i < xs.length; i += 1) {
      if (Math.abs(xs[i] - vx) < Math.abs(xs[nearest] - vx)) nearest = i;
    }
    setActive(nearest);
  }

  const lastIndex = points.length - 1;
  // ツールチップがモーダル外にはみ出さないよう横位置は少し内側に寄せる。
  const tooltipLeft = active != null ? Math.min(92, Math.max(8, (xs[active] / VB_WIDTH) * 100)) : 0;
  const tooltipTop = active != null ? (ys[active] / VB_HEIGHT) * 100 : 0;

  return (
    <div className="lab-chart">
      <p className="lab-chart__title">
        {series.name}
        {series.unit && <span className="lab-chart__unit">({series.unit})</span>}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label={`${series.name}の推移グラフ`}
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
        {points.map((p, i) =>
          labelSet.has(i) ? (
            <text
              key={p.date}
              className="lab-chart__tick"
              x={xs[i]}
              y={VB_HEIGHT - 8}
              textAnchor="middle"
            >
              {axisLabel(i)}
            </text>
          ) : null,
        )}
        {active != null && (
          <line
            className="lab-chart__crosshair"
            x1={xs[active]}
            x2={xs[active]}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_H}
          />
        )}
        <path className="lab-chart__line" d={linePath} />
        {points.map((p, i) => (
          <circle
            key={p.date}
            className="lab-chart__marker"
            cx={xs[i]}
            cy={ys[i]}
            r={active === i ? 5 : 4}
            tabIndex={0}
            aria-label={`${formatPointDate(p.date)} ${formatValue(p.value)}${series.unit}`}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
        {active !== lastIndex && (
          <text
            className="lab-chart__end-label"
            x={xs[lastIndex]}
            y={ys[lastIndex] - 10}
            textAnchor={xs[lastIndex] > VB_WIDTH - MARGIN.right - 24 ? "end" : "middle"}
          >
            {formatValue(points[lastIndex].value)}
          </text>
        )}
      </svg>
      {active != null && (
        <div
          className="lab-chart__tooltip"
          style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
        >
          <span className="lab-chart__tooltip-value">
            {formatValue(points[active].value)}
            {series.unit && ` ${series.unit}`}
          </span>
          <span className="lab-chart__tooltip-date">{formatPointDate(points[active].date)}</span>
        </div>
      )}
    </div>
  );
}
