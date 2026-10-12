import { useRef, useState } from "react";
import { interpretationClass } from "../fhir/labResultHelpers";
import {
  SERIES_SHAPES,
  SERIES_SLOTS,
  formatPointDate,
  formatValue,
  niceTicks,
  placeValueLabels,
  seriesMarkPath,
} from "./chartScale";

export interface LabTimelinePoint {
  /**
   * 検体採取日 "YYYY-MM-DD"、または測定日時 "YYYY-MM-DDTHH:mm"(経過表)。
   * 日時を渡すと横軸の位置が時刻まで反映される(同じ日の朝夕が重ならない)。
   * タイムゾーンを持たない形式で渡すこと(端末のローカル時刻として扱う)。
   */
  date: string;
  value: number;
  /** 判定(H/L など)。数値を出すときの字の色を変える。 */
  flag?: string;
}

export interface LabTimelineSeries {
  key: string;
  name: string;
  unit: string;
  // 日付昇順
  points: LabTimelinePoint[];
  /** 整数しか取らない値(人数など)。目盛りを整数だけにする。 */
  integer?: boolean;
}

interface LabTimelineChartProps {
  series: LabTimelineSeries[];
  /** 全項目を 1 つのグラフに重ねる。 */
  overlay?: boolean;
  /** 点の上に数値を出す。 */
  values?: boolean;
  /** 1 グラフあたりの高さの倍率(1 が標準)。横幅は器に合わせて決まるので、縦横比で変える。 */
  heightScale?: number;
}

// 検査項目ごとに値のスケールが大きく異なる(例: Hb と血小板数)ため、
// 既定では 1 つの軸に重ねず項目ごとのパネル(スモールマルチプル)で縦に並べる。
// 形を比べたいときは overlay で 1 つのグラフに重ねる(マルチチャートの重ね表示と同じ作法)。
export function LabTimelineChart({
  series,
  overlay,
  values,
  heightScale = 1,
}: LabTimelineChartProps) {
  if (overlay) return <OverlayPanel series={series} values={values} heightScale={heightScale} />;
  return (
    <div className="lab-chart-list">
      {series.map((s) => (
        <ChartPanel key={s.key} series={s} values={values} heightScale={heightScale} />
      ))}
    </div>
  );
}

const VB_WIDTH = 640;
const VB_HEIGHT = 200;
const MARGIN = { top: 20, right: 28, bottom: 26, left: 56 };
const PLOT_W = VB_WIDTH - MARGIN.left - MARGIN.right;
// 点の上の数値の字の大きさ。CSS の .lab-chart__value と合わせる。
const VALUE_FONT_SIZE = 9;
// X 軸ラベルを重ねずに置ける最小間隔(viewBox 座標)。
const MIN_LABEL_GAP = 56;

function formatDate(date: string, withYear: boolean): string {
  // 日時("...T09:00")で渡されることもあるので日付部分だけを見る。
  const [y, m, d] = date.slice(0, 10).split("-");
  const md = `${Number(m)}/${Number(d)}`;
  return withYear ? `${y}/${md}` : md;
}

/**
 * X 軸の日付ラベル。点の位置から最大 5 個に間引き、重なるものは落とす。
 * dates は昇順、xs はその横位置。
 */
function axisLabels(dates: string[], xs: number[]): { index: number; text: string }[] {
  if (dates.length === 0) return [];
  const labelCount = Math.min(5, dates.length);
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, i) =>
      Math.round((i * (dates.length - 1)) / Math.max(1, labelCount - 1)),
    ),
  );
  const years = dates.map((date) => date.slice(0, 4));
  // 横軸は時間に比例するので、近い時刻の点はラベルが重なる(経過表の朝夕の測定など)。
  // 左から順に、直前に採用したラベルと間隔が足りるものだけを残す。末尾は必ず出したい
  // ので、末尾に近すぎる採用済みラベルは落としてから足す。
  const labelList: number[] = [];
  for (const index of [...labelIndexes].sort((a, b) => a - b)) {
    const previous = labelList[labelList.length - 1];
    if (previous === undefined || xs[index] - xs[previous] >= MIN_LABEL_GAP) labelList.push(index);
  }
  const lastPoint = dates.length - 1;
  if (labelList[labelList.length - 1] !== lastPoint) {
    while (labelList.length && xs[lastPoint] - xs[labelList[labelList.length - 1]] < MIN_LABEL_GAP) {
      labelList.pop();
    }
    labelList.push(lastPoint);
  }
  // 同じ日に複数の点が残ったときは、2 つ目以降のラベルを時刻に差し替える
  // (同じ日付が並んでも区別できないため)。
  return labelList.map((index, n) => {
    const sameDay = n > 0 && dates[labelList[n - 1]].slice(0, 10) === dates[index].slice(0, 10);
    const time = dates[index].slice(11, 16);
    return {
      index,
      text:
        sameDay && time
          ? time
          : formatDate(dates[index], index === 0 || years[index] !== years[index - 1]),
    };
  });
}

/** 点の上に出す数値。重なるものは間引く。 */
function ValueLabels({
  points,
}: {
  points: { key: string; x: number; y: number; value: number; flag?: string }[];
}) {
  return (
    <>
      {placeValueLabels(
        points.map((point) => ({
          key: point.key,
          x: point.x,
          y: point.y - 7,
          text: formatValue(point.value),
          flag: point.flag ?? "",
        })),
        VALUE_FONT_SIZE,
      ).map((label) => (
        <text
          key={label.key}
          className={`${interpretationClass(label.flag, "patient-chart__value")} lab-chart__value`}
          x={label.x}
          y={label.y}
          textAnchor="middle"
        >
          {label.text}
        </text>
      ))}
    </>
  );
}

function ChartPanel({
  series,
  values,
  heightScale,
}: {
  series: LabTimelineSeries;
  values?: boolean;
  heightScale: number;
}) {
  const vbHeight = Math.round(VB_HEIGHT * heightScale);
  const plotH = vbHeight - MARGIN.top - MARGIN.bottom;
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const { points } = series;
  const times = points.map((p) => Date.parse(p.date));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const pointValues = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...pointValues), Math.max(...pointValues), series.integer ? 1 : 0);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const toX = (t: number) =>
    tMax === tMin ? MARGIN.left + PLOT_W / 2 : MARGIN.left + ((t - tMin) / (tMax - tMin)) * PLOT_W;
  const toY = (v: number) => MARGIN.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const xs = times.map(toX);
  const ys = pointValues.map(toY);
  const linePath = points
    .map((_, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
    .join(" ");
  const labels = axisLabels(
    points.map((p) => p.date),
    xs,
  );

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
  const tooltipTop = active != null ? (ys[active] / vbHeight) * 100 : 0;

  return (
    <div className="lab-chart lab-timeline-chart">
      <p className="lab-chart__title">
        {series.name}
        {series.unit && <span className="lab-chart__unit">({series.unit})</span>}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${vbHeight}`}
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
        {labels.map((label) => (
          <text
            key={points[label.index].date}
            className="lab-chart__tick"
            x={xs[label.index]}
            y={vbHeight - 8}
            textAnchor="middle"
          >
            {label.text}
          </text>
        ))}
        {active != null && (
          <line
            className="lab-chart__crosshair"
            x1={xs[active]}
            x2={xs[active]}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
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
        {values ? (
          <ValueLabels
            points={points.map((p, i) => ({
              key: p.date,
              x: xs[i],
              y: ys[i],
              value: p.value,
              flag: p.flag,
            }))}
          />
        ) : (
          active !== lastIndex && (
            <text
              className="lab-chart__end-label"
              x={xs[lastIndex]}
              y={ys[lastIndex] - 10}
              textAnchor={xs[lastIndex] > VB_WIDTH - MARGIN.right - 24 ? "end" : "middle"}
            >
              {formatValue(points[lastIndex].value)}
            </text>
          )
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

// ---- 全項目を重ねたグラフ ----
//
// 単位も桁も違う項目を 1 本の目盛りに載せると読めず、二重軸は誤読のもとなので、
// 各系列を自分の目盛りの範囲で 0〜100% に正規化して同じ高さに重ねる。実際の値と範囲は
// 凡例とツールチップで示し、縦軸に数値は出さない(マルチチャートの重ね表示と同じ考え)。

const OVERLAY_VB_HEIGHT = 260;
const OVERLAY_MARGIN = { top: 20, right: 28, bottom: 26, left: 28 };
const OVERLAY_PLOT_W = VB_WIDTH - OVERLAY_MARGIN.left - OVERLAY_MARGIN.right;

interface OverlaySpec {
  series: LabTimelineSeries;
  /** 色(0〜7)と印の形(0〜4)の組で見分ける。隠しても付け替えない。 */
  slot: number;
  shape: number;
  min: number;
  max: number;
}

function OverlayPanel({
  series,
  values,
  heightScale,
}: {
  series: LabTimelineSeries[];
  values?: boolean;
  heightScale: number;
}) {
  const vbHeight = Math.round(OVERLAY_VB_HEIGHT * heightScale);
  const plotH = vbHeight - OVERLAY_MARGIN.top - OVERLAY_MARGIN.bottom;
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  // 凡例で一時的に隠している系列。
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const specs: OverlaySpec[] = series.map((s, index) => {
    const pointValues = s.points.map((p) => p.value);
    const ticks = niceTicks(Math.min(...pointValues), Math.max(...pointValues), s.integer ? 1 : 0);
    return {
      series: s,
      slot: index % SERIES_SLOTS,
      shape: index % SERIES_SHAPES,
      min: ticks[0],
      max: ticks[ticks.length - 1],
    };
  });
  const shown = specs.filter((spec) => !hidden.has(spec.series.key));

  // 横軸は表示中の系列の点の日付の和集合。
  const dates = [...new Set(shown.flatMap((spec) => spec.series.points.map((p) => p.date)))].sort();
  const times = dates.map((date) => Date.parse(date));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const toX = (t: number) =>
    tMax === tMin
      ? OVERLAY_MARGIN.left + OVERLAY_PLOT_W / 2
      : OVERLAY_MARGIN.left + ((t - tMin) / (tMax - tMin)) * OVERLAY_PLOT_W;
  const toY = (value: number, spec: OverlaySpec) =>
    OVERLAY_MARGIN.top +
    plotH -
    ((value - spec.min) / Math.max(1e-9, spec.max - spec.min)) * plotH;
  const xs = times.map(toX);
  const labels = axisLabels(dates, xs);

  function toggleHidden(key: string) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || xs.length === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VB_WIDTH;
    let nearest = 0;
    for (let i = 1; i < xs.length; i += 1) {
      if (Math.abs(xs[i] - vx) < Math.abs(xs[nearest] - vx)) nearest = i;
    }
    setActive(nearest);
  }

  const activeDate = active != null ? dates[active] : undefined;
  const hoverRows = activeDate
    ? shown.flatMap((spec) => {
        const point = spec.series.points.find((p) => p.date === activeDate);
        return point ? [{ spec, point }] : [];
      })
    : [];

  return (
    <div className="lab-chart lab-timeline-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${vbHeight}`}
        role="img"
        aria-label="選択した項目を重ねた推移グラフ"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActive(null)}
      >
        {/* 縦軸に数値は出さないので、横罫線は目安の 4 等分だけ引く。 */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            className="lab-chart__grid"
            x1={OVERLAY_MARGIN.left}
            x2={VB_WIDTH - OVERLAY_MARGIN.right}
            y1={OVERLAY_MARGIN.top + (plotH * i) / 4}
            y2={OVERLAY_MARGIN.top + (plotH * i) / 4}
          />
        ))}
        {labels.map((label) => (
          <text
            key={dates[label.index]}
            className="lab-chart__tick"
            x={xs[label.index]}
            y={vbHeight - 8}
            textAnchor="middle"
          >
            {label.text}
          </text>
        ))}
        {active != null && (
          <line
            className="lab-chart__crosshair"
            x1={xs[active]}
            x2={xs[active]}
            y1={OVERLAY_MARGIN.top}
            y2={OVERLAY_MARGIN.top + plotH}
          />
        )}
        {shown.map((spec) => {
          const points = spec.series.points;
          const path = points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${toX(Date.parse(p.date)).toFixed(1)},${toY(p.value, spec).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g key={spec.series.key} className={`patient-chart__s${spec.slot + 1}`}>
              <path className="lab-chart__line" d={path} />
              {points.map((p) => (
                <path
                  key={p.date}
                  className="lab-chart__marker"
                  d={seriesMarkPath(spec.shape, toX(Date.parse(p.date)), toY(p.value, spec), 4)}
                  tabIndex={0}
                  aria-label={`${spec.series.name} ${formatPointDate(p.date)} ${formatValue(p.value)}${spec.series.unit}`}
                  onFocus={() => setActive(dates.indexOf(p.date))}
                  onBlur={() => setActive(null)}
                />
              ))}
            </g>
          );
        })}
        {values && (
          <ValueLabels
            points={shown.flatMap((spec) =>
              spec.series.points.map((p) => ({
                key: `${spec.series.key}/${p.date}`,
                x: toX(Date.parse(p.date)),
                y: toY(p.value, spec),
                value: p.value,
                flag: p.flag,
              })),
            )}
          />
        )}
      </svg>
      {activeDate && hoverRows.length > 0 && (
        <div
          className="lab-chart__tooltip patient-chart__tooltip"
          style={(xs[active ?? 0] ?? 0) > VB_WIDTH / 2 ? { left: 0 } : { right: 0 }}
        >
          {hoverRows.map(({ spec, point }) => (
            <span key={spec.series.key} className="patient-chart__tooltip-row">
              <svg
                className={`patient-chart__swatch patient-chart__s${spec.slot + 1}`}
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
              >
                <path className="lab-chart__marker" d={seriesMarkPath(spec.shape, 6, 6, 4)} />
              </svg>
              <span className="lab-chart__tooltip-value">
                {spec.series.name} {formatValue(point.value)}
                {spec.series.unit && ` ${spec.series.unit}`}
              </span>
            </span>
          ))}
          <span className="lab-chart__tooltip-date">{formatPointDate(activeDate)}</span>
        </div>
      )}
      {/* 縦軸に数値を出さないぶん、各系列の単位と表示範囲は凡例で示す。押すと一時的に隠す。 */}
      <ul className="patient-chart__legend">
        {specs.map((spec) => {
          const isHidden = hidden.has(spec.series.key);
          return (
            <li key={spec.series.key}>
              <button
                type="button"
                className={`patient-chart__legend-item${isHidden ? " is-hidden" : ""}`}
                aria-pressed={!isHidden}
                title={isHidden ? `${spec.series.name} を表示` : `${spec.series.name} を隠す`}
                onClick={() => toggleHidden(spec.series.key)}
              >
                <svg
                  className={`patient-chart__swatch patient-chart__s${spec.slot + 1}`}
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  aria-hidden="true"
                >
                  <path className="lab-chart__line" d="M0,6 H12" />
                  <path className="lab-chart__marker" d={seriesMarkPath(spec.shape, 6, 6, 4)} />
                </svg>
                <span className="patient-chart__legend-name">{spec.series.name}</span>
                <span className="patient-chart__legend-range">
                  {formatValue(spec.min)}〜{formatValue(spec.max)}
                  {spec.series.unit && ` ${spec.series.unit}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
