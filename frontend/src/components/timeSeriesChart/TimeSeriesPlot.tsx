import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toDateTimeInput } from "../../fhir/clinicalNoteHelpers";
import type { ChartEventLine, ChartMarker, ChartPoint, ChartSecondaryAxis } from "../../fhir/timeSeriesChartHelpers";

// 時系列チャートのグラフ(SVG)。横軸 = 時刻、収縮期(∨)・拡張期(∧)・脈拍(●)を
// 0〜220 の共通軸に描く(紙のチャートと同じ流儀)。イベントは上端に ▼ + ラベル。
// SpO2 など軸の違う項目はグラフに重ねず表で見せる。累積除水量のように
// 単調に増える 1 項目だけは右軸(secondary)で重ねられる。

const PLOT = {
  height: 292,
  top: 46, // イベント帯(ラベルを 2 段に振るぶんの高さを見ている)
  bottom: 22, // 時刻ラベル
  left: 34,
  right: 16,
  /** 右軸があるときの右の余白(目盛りのラベルぶん)。 */
  rightWithAxis: 44,
  yMax: 220,
};

/** 右軸の目盛りの刻み。4〜5 本に収まる見やすい値を選ぶ。 */
function secondaryStep(max: number): number {
  return [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find((step) => max / step <= 5) ?? max / 4;
}

/**
 * 横軸の目盛り。30 分で終わる記録から 8 時間を超えるものまであり、
 * 1 分あたりの幅を固定すると短い記録は左端に潰れ、長い記録は延々と横に伸びる。
 * 記録しながら切り替えられるよう選択式にした(既定は 5 分グリッドが読める広さ)。
 *
 * "fit" は 1 分あたりの幅を決めず、記録の全体が画面幅にちょうど収まるよう
 * その場で計算する(pxPerMin: null)。短い記録で枠が左に縮むのも、長い記録で
 * 横スクロールが要るのも避けられる。
 */
const PLOT_SCALES = [
  { key: "wide", label: "広く", pxPerMin: 1.5 },
  { key: "normal", label: "標準", pxPerMin: 4 },
  { key: "zoom", label: "拡大", pxPerMin: 10 },
  { key: "fit", label: "全画面", pxPerMin: null },
] as const;

type PlotScaleKey = (typeof PLOT_SCALES)[number]["key"];

/**
 * グリッドと時刻ラベルの間隔。1 分あたりの幅から決めるので、"全画面" で
 * 幅が変わっても目盛りが詰まりすぎない。
 */
function gridSpec(pxPerMin: number): { gridMinutes: number; labelMinutes: number } {
  if (pxPerMin >= 8) return { gridMinutes: 5, labelMinutes: 15 };
  if (pxPerMin >= 3) return { gridMinutes: 5, labelMinutes: 30 };
  return { gridMinutes: 15, labelMinutes: 60 };
}

/** "YYYY-MM-DDTHH:mm" → 分(ローカル)。 */
function minutesOf(time: string): number {
  return new Date(time).getTime() / 60000;
}

/**
 * 記号の凡例。グラフと同じクラスで同じ形・同じ色を描くので、色や記号を
 * 変えたときに凡例だけ取り残されることがない。
 */
function PlotLegend({ secondary }: { secondary?: ChartSecondaryAxis }) {
  return (
    <span className="time-chart__legend">
      <span className="time-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <path d="M3 4 L8 9 L13 4" className="time-plot__bp" />
        </svg>
        収縮期
      </span>
      <span className="time-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <path d="M3 8 L8 3 L13 8" className="time-plot__bp" />
        </svg>
        拡張期
      </span>
      <span className="time-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <line x1="1" y1="6" x2="15" y2="6" className="time-plot__pulse-line" />
          <circle cx="8" cy="6" r="3" className="time-plot__pulse" />
        </svg>
        脈拍
      </span>
      <span className="time-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <line x1="8" y1="2" x2="8" y2="11" className="time-plot__event-line" />
          <text x="8" y="7" textAnchor="middle" className="time-plot__event">
            ▼
          </text>
        </svg>
        イベント
      </span>
      {secondary && (
        <span className="time-chart__legend-item">
          <svg width="16" height="12" aria-hidden="true" focusable="false">
            <line x1="1" y1="9" x2="15" y2="3" className="time-plot__secondary-line" />
            <rect x="6" y="4" width="4" height="4" className="time-plot__secondary" />
          </svg>
          {secondary.label}(右軸)
        </span>
      )}
    </span>
  );
}

interface TimeSeriesPlotProps {
  points: readonly ChartPoint[];
  events: readonly ChartEventLine[];
  /** 打点・イベント以外で軸の範囲に入れる時刻(薬剤の投与時刻など。"YYYY-MM-DDTHH:mm")。 */
  extraTimes?: readonly string[];
  /** 記録が 1 件も無いときに枠の起点にする時刻(FHIR dateTime)。 */
  emptyStart?: string;
  /** 軸に固定で描く縦線(回の開始・終了など)。軸の範囲にも入れる。 */
  markers?: readonly ChartMarker[];
  /** 確定後は右の余白を詰める。 */
  readOnly: boolean;
  /** 折れ線にする打点の key。 */
  pulseKey?: string;
  /** 右軸に重ねる項目。 */
  secondary?: ChartSecondaryAxis;
  /**
   * 幅を固定して全体を収める(印刷)。横軸の切り替えは出さず、スクロールもしない。
   */
  fixedWidth?: number;
  /** グラフ全体の高さ(px)。印刷で紙に収めるときに縮める。 */
  height?: number;
  ariaLabel: string;
}

export function TimeSeriesPlot({
  points,
  events,
  extraTimes = [],
  emptyStart,
  markers = [],
  readOnly,
  pulseKey = "pulse",
  secondary,
  fixedWidth,
  height = PLOT.height,
  ariaLabel,
}: TimeSeriesPlotProps) {
  const [scaleKey, setScaleKey] = useState<PlotScaleKey>("normal");
  const scale = PLOT_SCALES.find((s) => s.key === scaleKey) ?? PLOT_SCALES[1];
  const fit = scale.pxPerMin === null || fixedWidth != null;
  const right = secondary ? PLOT.rightWithAxis : PLOT.right;

  // "全画面" は置ける幅から 1 分あたりの幅を逆算するので、実際の幅を測る。
  // 初回は同期で測る(ResizeObserver の初回配信を待つと、標準の幅で 1 度描いて
  // から飛ぶ)。以後の追従は observer に任せる。fit の切り替えでコンテナの
  // 幅指定自体が変わるので、そのたびに測り直す。
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    setWrapWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWrapWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  const model = useMemo(() => {
    // 軸は「記録がある範囲」で決める。ハブの開始や「今」まで伸ばすと、
    // 記録を止めている間や退室後に開いたときに余白ばかりの軸になる。
    const times = [...points.map((p) => p.time), ...events.map((e) => e.time), ...markers.map((m) => m.time), ...extraTimes]
      .map((t) => t.slice(0, 16))
      .filter(Boolean)
      .map(minutesOf)
      .filter(Number.isFinite);
    // 記録が 1 件も無いうちは、開始時刻から先の 30 分ぶんを枠として見せる。
    if (!times.length) {
      const start = minutesOf(toDateTimeInput(emptyStart).slice(0, 16));
      if (!Number.isFinite(start)) return null;
      const min = Math.floor(start / 5) * 5;
      return { min, max: min + 30 };
    }

    const min = Math.floor(Math.min(...times) / 5) * 5;
    // 記録中は右に少し余白を足す(次の打点を置く先が見えるように)。
    const pad = readOnly ? 5 : 15;
    const max = Math.max(Math.ceil((Math.max(...times) + pad) / 5) * 5, min + 30);
    return { min, max };
  }, [points, events, markers, extraTimes, emptyStart, readOnly]);

  if (!model) return null;

  const span = model.max - model.min;
  // 全画面(と印刷の固定幅)のときだけ、置ける幅に収まる 1 分あたりの幅にする(幅を測る前の
  // 初回描画では標準の幅で描いておき、測れ次第 1 度だけ描き直す)。
  const fitWidth = fixedWidth ?? wrapWidth;
  const pxPerMin =
    fixedWidth != null || scale.pxPerMin === null
      ? fitWidth > 0
        ? Math.max(0.3, (fitWidth - PLOT.left - right) / span)
        : 4
      : scale.pxPerMin;
  const { gridMinutes, labelMinutes } = gridSpec(pxPerMin);
  const width = PLOT.left + right + span * pxPerMin;
  const plotH = height - PLOT.top - PLOT.bottom;
  const x = (time: string) => PLOT.left + (minutesOf(time) - model.min) * pxPerMin;
  const y = (value: number) => PLOT.top + plotH - (Math.min(value, PLOT.yMax) / PLOT.yMax) * plotH;

  const gridX: { minute: number; major: boolean }[] = [];
  for (let m = model.min; m <= model.max; m += gridMinutes) {
    gridX.push({ minute: m, major: m % labelMinutes === 0 });
  }
  const gridY: number[] = [];
  for (let v = 0; v <= PLOT.yMax; v += 20) gridY.push(v);

  const minuteX = (minute: number) => PLOT.left + (minute - model.min) * pxPerMin;
  const timeLabel = (minute: number) => {
    const date = new Date(minute * 60000);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const pulseOf = (point: ChartPoint) => point.values[pulseKey];
  const pulseLine = points
    .filter((p) => pulseOf(p) != null)
    .map((p) => `${x(p.time)},${y(pulseOf(p) ?? 0)}`)
    .join(" ");

  // 右軸。上端を超える値は上端に貼り付ける(目標を超えた除水など)。
  const secondaryOf = (point: ChartPoint) => (secondary ? point.values[secondary.key] : undefined);
  const y2 = (value: number) =>
    secondary ? PLOT.top + plotH - (Math.min(Math.max(value, 0), secondary.max) / secondary.max) * plotH : 0;
  const secondaryLine = secondary
    ? points
        .filter((p) => secondaryOf(p) != null)
        .map((p) => `${x(p.time)},${y2(secondaryOf(p) ?? 0)}`)
        .join(" ")
    : "";
  const secondaryTicks: number[] = [];
  if (secondary && secondary.max > 0) {
    const step = secondaryStep(secondary.max);
    for (let v = 0; v <= secondary.max + step / 1000; v += step) secondaryTicks.push(Math.round(v * 1000) / 1000);
  }

  return (
    <>
      <div className="time-chart__plot-bar">
        {fixedWidth == null && (
          <>
            <span>横軸</span>
            {PLOT_SCALES.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === scaleKey ? "time-chart__scale time-chart__scale--active" : "time-chart__scale"}
                onClick={() => setScaleKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </>
        )}
        <PlotLegend secondary={secondary} />
      </div>
      <div ref={wrapRef} className={fit ? "time-chart__plot-scroll time-chart__plot-scroll--fit" : "time-chart__plot-scroll"}>
        <svg
          className="time-chart__plot"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
        >
          {/* 目盛り */}
          {gridY.map((v) => (
            <g key={v}>
              <line
                x1={PLOT.left}
                y1={y(v)}
                x2={width - right}
                y2={y(v)}
                className={v % 40 === 0 ? "time-plot__grid--major" : "time-plot__grid"}
              />
              {v % 40 === 0 && (
                <text x={PLOT.left - 6} y={y(v) + 3} className="time-plot__ylabel">
                  {v}
                </text>
              )}
            </g>
          ))}
          {gridX.map(({ minute, major }) => (
            <g key={minute}>
              <line
                x1={minuteX(minute)}
                y1={PLOT.top}
                x2={minuteX(minute)}
                y2={height - PLOT.bottom}
                className={major ? "time-plot__grid--major" : "time-plot__grid"}
              />
              {major && (
                <text x={minuteX(minute)} y={height - 8} textAnchor="middle" className="time-plot__xlabel">
                  {timeLabel(minute)}
                </text>
              )}
            </g>
          ))}

          {/* 右軸(目盛りは右端の外)。目標があれば破線の横線にする。 */}
          {secondary &&
            secondaryTicks.map((v) => (
              <text key={`y2-${v}`} x={width - right + 6} y={y2(v) + 3} className="time-plot__ylabel--right">
                {v}
              </text>
            ))}
          {secondary && secondary.target != null && secondary.target > 0 && (
            <g>
              <line
                x1={PLOT.left}
                y1={y2(secondary.target)}
                x2={width - right}
                y2={y2(secondary.target)}
                className="time-plot__target"
              />
              <text x={width - right - 3} y={y2(secondary.target) - 3} textAnchor="end" className="time-plot__target-label">
                目標 {secondary.target}
                {secondary.unit}
              </text>
            </g>
          )}

          {/* 固定の印(回の開始・終了)。イベントとは別物なので実線で、ラベルは枠の中に置く。 */}
          {markers
            .filter((marker) => marker.time)
            .map((marker) => (
              <g key={`marker-${marker.time}`}>
                <line
                  x1={x(marker.time)}
                  y1={PLOT.top}
                  x2={x(marker.time)}
                  y2={height - PLOT.bottom}
                  className="time-plot__marker"
                />
                <text x={x(marker.time) + 3} y={PLOT.top + 10} className="time-plot__marker-label">
                  {marker.label}
                </text>
              </g>
            ))}

          {/* イベント(上端の帯)。数分差で続くことがあり、ラベルを同じ高さに置くと
              重なって読めない。前のラベルと近ければ 1 段下げる(2 段で足りない密度は
              「拡大」で開いてもらう)。 */}
          {(() => {
            // ラベルは中央揃えなので、隣り合う 2 つが触れるかは「前の半分 + 自分の
            // 半分」で決まる。文字幅はフォントサイズ(10px)を全角 1 文字として見る。
            const halfWidthOf = (text: string) => (text.length * 10) / 2;
            let previousX = -Infinity;
            let previousHalf = 0;
            let previousRow = 1;
            return events.map((event) => {
              const eventX = x(event.time);
              const text = event.code === "other" && event.note ? event.note : event.label;
              const half = halfWidthOf(text);
              const row = eventX - previousX < previousHalf + half + 4 ? 1 - previousRow : 0;
              previousX = eventX;
              previousHalf = half;
              previousRow = row;
              return (
                <g key={event.id}>
                  <line
                    x1={eventX}
                    y1={PLOT.top}
                    x2={eventX}
                    y2={height - PLOT.bottom}
                    className="time-plot__event-line"
                  />
                  <text x={eventX} y={12} textAnchor="middle" className="time-plot__event">
                    ▼
                  </text>
                  <text x={eventX} y={26 + row * 13} textAnchor="middle" className="time-plot__event-label">
                    {text}
                  </text>
                </g>
              );
            });
          })()}

          {/* 右軸の項目(折れ線 + ■) */}
          {secondaryLine && <polyline points={secondaryLine} className="time-plot__secondary-line" />}
          {secondary &&
            points.map((point) => {
              const value = secondaryOf(point);
              return value != null ? (
                <rect
                  key={`s-${point.time}`}
                  x={x(point.time) - 2.5}
                  y={y2(value) - 2.5}
                  width={5}
                  height={5}
                  className="time-plot__secondary"
                />
              ) : null;
            })}

          {/* 脈拍(折れ線 + ●) */}
          {pulseLine && <polyline points={pulseLine} className="time-plot__pulse-line" />}
          {points.map((point) => {
            const pulse = pulseOf(point);
            return pulse != null ? (
              <circle key={`hr-${point.time}`} cx={x(point.time)} cy={y(pulse)} r={3} className="time-plot__pulse" />
            ) : null;
          })}

          {/* 血圧(∨ = 収縮期 / ∧ = 拡張期。紙のチャートと同じ記号) */}
          {points.map((point) => (
            <g key={`bp-${point.time}`}>
              {point.systolic != null && (
                <path
                  d={`M ${x(point.time) - 5} ${y(point.systolic) - 5} L ${x(point.time)} ${y(point.systolic)} L ${x(point.time) + 5} ${y(point.systolic) - 5}`}
                  className="time-plot__bp"
                />
              )}
              {point.diastolic != null && (
                <path
                  d={`M ${x(point.time) - 5} ${y(point.diastolic) + 5} L ${x(point.time)} ${y(point.diastolic)} L ${x(point.time) + 5} ${y(point.diastolic) + 5}`}
                  className="time-plot__bp"
                />
              )}
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
