import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KarteDetailTarget } from "../karteUrl";
import type {
  ChartEvent,
  ChartEventKind,
  ChartLaneData,
  ChartPoint,
  ChartRange,
} from "../fhir/chartDefinitionHelpers";
import { CHART_EVENT_KINDS, chartEventKindLabel } from "../fhir/chartDefinitionHelpers";
import { epochOf } from "../fhir/flowsheetEventHelpers";
import { formatPointDate, formatValue, niceTicks } from "./chartScale";

// チャートの描画。項目ごとのグラフ(レーン)を縦に積み、**横軸を全レーンで共有する**
// (検体検査時系列の LabTimelineChart は各パネルが自分の点で横軸を決めるので、
// 「同じ縦の位置が同じ時期」にならない)。最上段にイベントの帯を置き、縦の位置合わせで
// 「この治療の後に値がどう動いたか」を読む。

// viewBox の幅はパネルの実測幅に合わせる(1 単位 = 1px)。全画面やペインの分割で
// 横に伸びても、文字と点の大きさが変わらない。測れないときの控えの幅。
const DEFAULT_VB_WIDTH = 800;
const MIN_VB_WIDTH = 480;
// left は帯の行ラベル(最長「放射線治療」= 5 文字)が収まる幅にする。
const MARGIN = { top: 16, right: 20, bottom: 24, left: 72 };
/** レーン 1 枚の最小の高さ。パネルに余裕があればここから伸ばす。 */
const MIN_LANE_HEIGHT = 120;
/** 重ね表示の最小の高さ。線が何本も重なるのでレーンより高く取る。 */
const MIN_OVERLAY_HEIGHT = 240;
/** レーンの見出し(項目名)がとる高さ。グラフの高さを割り出すのに使う。 */
const LANE_TITLE_HEIGHT = 22;
/** 本文の子要素(帯・レーン)の間隔。CSS の .patient-chart__body の gap と合わせる。 */
const BODY_GAP = 12;
/** 系列の色は dataviz の検証済みカテゴリ配色を順に使う(CSS の .patient-chart__s1〜8)。 */
const SERIES_SLOTS = 8;
/** 印の形。色と組で系列を見分ける(色だけに頼らない)。8 と 5 は互いに素なので 40 通り。 */
const SERIES_SHAPES = 5;
/** 列ラベルを重ねずに置ける最小間隔(viewBox 座標)。 */
const MIN_LABEL_GAP = 48;
/** イベント帯の 1 行の高さ。 */
const BAND_ROW_HEIGHT = 20;
const BAND_TOP = 6;
const DAY_MS = 86_400_000;

interface PatientChartPanelProps {
  range: ChartRange;
  lanes: ChartLaneData[];
  events: ChartEvent[];
  /** 帯に出す種別(定義で ON にしたもの)。 */
  eventKinds: ChartEventKind[];
  /** 全項目を 1 つのグラフに重ねる。 */
  overlay?: boolean;
  /** 全画面かどうか。幅が変わるので測り直す合図に使う。 */
  fullscreen?: boolean;
  onOpenDetail?: (target: KarteDetailTarget) => void;
}

export function PatientChartPanel({
  range,
  lanes,
  events,
  eventKinds,
  overlay,
  fullscreen,
  onOpenDetail,
}: PatientChartPanelProps) {
  // ホバーは時刻(epoch)で 1 つだけ持ち、全レーンが同じ位置を指す。
  const [hoverT, setHoverT] = useState<number | null>(null);

  // 大きさはパネルから測る。ResizeObserver が動かない環境もあるので、まず同期で測ってから追う。
  const bodyRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState({ width: DEFAULT_VB_WIDTH, height: 0, legend: 0 });
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function measure() {
      const body = bodyRef.current;
      if (!body) return;
      // 凡例は上の余白ごと差し引く(CSS の margin と二重に持たない)。
      const legend = legendRef.current;
      const legendHeight = legend
        ? legend.offsetHeight + (parseFloat(getComputedStyle(legend).marginTop) || 0)
        : 0;
      setSize({
        width: Math.max(MIN_VB_WIDTH, body.clientWidth),
        height: body.clientHeight,
        legend: legendHeight,
      });
    }
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // 重ね表示の切り替えで凡例の有無が変わり、項目数でレーンの数も変わる。
  }, [fullscreen, overlay, lanes.length]);
  const vbWidth = size.width;

  const plotW = vbWidth - MARGIN.left - MARGIN.right;
  const toX = (t: number) => {
    const ratio = (t - range.tMin) / Math.max(1, range.tMax - range.tMin);
    return MARGIN.left + Math.min(1, Math.max(0, ratio)) * plotW;
  };

  // 列の見出しは、幅が足りるものだけ残す(日 92 列のように密なときに重ならない)。
  const columnLabels: { x: number; text: string }[] = [];
  for (const column of range.columns) {
    const x = toX(epochOf(column.start) + (epochOf(column.end) + DAY_MS - epochOf(column.start)) / 2);
    const previous = columnLabels[columnLabels.length - 1];
    if (previous && x - previous.x < MIN_LABEL_GAP) continue;
    columnLabels.push({ x, text: column.label });
  }

  const boundaries = range.columns.map((column) => toX(epochOf(column.start)));
  const todayT = epochOf(new Date().toISOString().slice(0, 10));
  const todayX = todayT >= range.tMin && todayT <= range.tMax ? toX(todayT) : null;

  // 節目のイベント(手術・入退院)だけ各レーンにも縦線を落とす。検査・注射は件数が多く、
  // すべて線にすると値の動きが読めなくなるので帯の印だけにする。
  const markerLines = events
    .filter((event) => !event.end && (event.kind === "surgery" || event.kind === "encounter"))
    .map((event) => ({ x: toX(epochOf(event.at)), kind: event.kind }));

  const shownKinds = CHART_EVENT_KINDS.filter((entry) => eventKinds.includes(entry.kind)).map(
    (entry) => entry.kind,
  );

  // グラフの高さはパネルの残りを使い切る。入りきらない(項目が多い・ペインが低い)ときは
  // 最小の高さで止めて本文を送る。
  const bandHeight = shownKinds.length > 0 ? BAND_TOP + shownKinds.length * BAND_ROW_HEIGHT + 6 : 0;
  const laneCount = overlay ? 1 : Math.max(1, lanes.length);
  const blocks = laneCount + (bandHeight > 0 ? 1 : 0);
  const free = size.height - bandHeight - Math.max(0, blocks - 1) * BODY_GAP;
  const laneHeight = overlay
    ? Math.max(MIN_OVERLAY_HEIGHT, free - size.legend)
    : Math.max(MIN_LANE_HEIGHT, Math.floor(free / laneCount) - LANE_TITLE_HEIGHT);

  return (
    <div className="patient-chart__body" ref={bodyRef}>
      {shownKinds.length > 0 && (
        <EventBand
          kinds={shownKinds}
          events={events}
          range={range}
          vbWidth={vbWidth}
          toX={toX}
          boundaries={boundaries}
          todayX={todayX}
          onOpenDetail={onOpenDetail}
        />
      )}
      {lanes.length === 0 ? (
        <p className="patient-chart__empty">項目が登録されていません。</p>
      ) : overlay ? (
        <OverlayChart
          lanes={lanes}
          range={range}
          vbWidth={vbWidth}
          height={laneHeight}
          legendRef={legendRef}
          toX={toX}
          boundaries={boundaries}
          todayX={todayX}
          markerLines={markerLines}
          hoverT={hoverT}
          onHover={setHoverT}
          columnLabels={columnLabels}
        />
      ) : (
        lanes.map((lane) => (
          <ChartLane
            key={lane.key}
            lane={lane}
            range={range}
            vbWidth={vbWidth}
            height={laneHeight}
            toX={toX}
            boundaries={boundaries}
            todayX={todayX}
            markerLines={markerLines}
            hoverT={hoverT}
            onHover={setHoverT}
            columnLabels={columnLabels}
          />
        ))
      )}
    </div>
  );
}

// ---- イベントの帯 ----

interface EventBandProps {
  kinds: ChartEventKind[];
  events: ChartEvent[];
  range: ChartRange;
  vbWidth: number;
  toX: (t: number) => number;
  boundaries: number[];
  todayX: number | null;
  onOpenDetail?: (target: KarteDetailTarget) => void;
}

function EventBand({
  kinds,
  events,
  range,
  vbWidth,
  toX,
  boundaries,
  todayX,
  onOpenDetail,
}: EventBandProps) {
  const height = BAND_TOP + kinds.length * BAND_ROW_HEIGHT + 6;

  return (
    <div className="patient-chart__band">
      <svg viewBox={`0 0 ${vbWidth} ${height}`} role="img" aria-label="治療歴">
        {boundaries.map((x, i) => (
          <line key={i} className="patient-chart__column-grid" x1={x} x2={x} y1={0} y2={height} />
        ))}
        {todayX !== null && (
          <line className="patient-chart__today" x1={todayX} x2={todayX} y1={0} y2={height} />
        )}
        {kinds.map((kind, row) => {
          const y = BAND_TOP + row * BAND_ROW_HEIGHT;
          // 同じ行に並ぶバーは、隣までの余地を見てラベルを出す(処方のように重なる行で
          // 名前が重なって読めなくなるのを避ける)。
          const rowEvents = events
            .filter((event) => event.kind === kind)
            .sort((a, b) => epochOf(a.at) - epochOf(b.at));
          const rowX = rowEvents.map((event) => toX(epochOf(event.at)));
          return (
            <g key={kind} className={`patient-chart__event--${kind}`}>
              <text className="patient-chart__band-label" x={MARGIN.left - 8} y={y + 12} textAnchor="end">
                {chartEventKindLabel(kind)}
              </text>
              <line
                className="patient-chart__band-rule"
                x1={MARGIN.left}
                x2={vbWidth - MARGIN.right}
                y1={y + 8}
                y2={y + 8}
              />
              {rowEvents.map((event, i) => (
                <EventMark
                  key={`${event.at}/${i}`}
                  event={event}
                  y={y}
                  range={range}
                  toX={toX}
                  room={(rowX[i + 1] ?? vbWidth - MARGIN.right) - rowX[i]}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 頭だけ残っても読めないので、これより短くなるならラベルを出さない(ホバーで読む)。 */
const MIN_BAR_LABEL_CHARS = 4;

/** 10px の字で `width` に収まるところまで切り詰める(全角は約 10px、半角は約 5.5px)。 */
function clipLabel(text: string, width: number): string {
  const widthOf = (value: string) =>
    [...value].reduce((sum, char) => sum + (/[\u0020-\u00ff]/.test(char) ? 5.5 : 10), 0);
  if (widthOf(text) <= width) return text;
  let clipped = "";
  for (const char of text) {
    if (widthOf(clipped + char) + 6 > width) break;
    clipped += char;
  }
  return [...clipped].length >= MIN_BAR_LABEL_CHARS ? `${clipped}…` : "";
}

function EventMark({
  event,
  y,
  range,
  toX,
  room,
  onOpenDetail,
}: {
  event: ChartEvent;
  y: number;
  range: ChartRange;
  toX: (t: number) => number;
  /** 次のバーまでの幅。ラベルを出せるかの判断に使う。 */
  room: number;
  onOpenDetail?: (target: KarteDetailTarget) => void;
}) {
  const target = event.target;
  const clickable = Boolean(target && onOpenDetail);
  const handleClick = () => {
    if (target && onOpenDetail) onOpenDetail(target);
  };
  const title = <title>{`${event.label}${event.detail ? ` / ${event.detail}` : ""}`}</title>;
  const className = clickable ? "patient-chart__event--clickable" : undefined;

  if (event.end) {
    const start = Math.max(toX(epochOf(event.at)), toX(range.tMin));
    const end = Math.min(toX(epochOf(event.end) + DAY_MS), toX(range.tMax));
    const width = Math.max(2, end - start);
    const label = clipLabel(event.label, Math.min(width, room) - 8);
    return (
      <g className={className} onClick={clickable ? handleClick : undefined}>
        {title}
        <rect className="patient-chart__bar" x={start} y={y + 3} width={width} height={10} rx={2} />
        {label && (
          <text className="patient-chart__bar-label" x={start + 4} y={y + 11.5}>
            {label}
          </text>
        )}
      </g>
    );
  }

  const x = toX(epochOf(event.at));
  return (
    <g className={className} onClick={clickable ? handleClick : undefined}>
      {title}
      <path className="patient-chart__marker" d={`M${x - 4},${y + 2} L${x + 4},${y + 2} L${x},${y + 10} Z`} />
    </g>
  );
}

// ---- 全項目を重ねたグラフ ----
//
// 項目ごとに単位も桁も違う(体温 35〜38・血圧 50〜200・WBC 2〜6)ので、1 本の目盛りに
// そのまま載せると読めない。**目盛りを 2 つ置く(二重軸)のは誤読のもと**なので、
// 各系列を自分の表示範囲で 0〜100% に正規化して同じ高さに重ね、実際の値と範囲は
// 凡例とツールチップで示す。形が比べたいときの表示なので、縦軸に数値は出さない。

interface OverlaySeries {
  key: string;
  name: string;
  unit: string;
  /** 色(0〜7)と印の形(0〜4)の組で見分ける。 */
  slot: number;
  shape: number;
  points: ChartPoint[];
  min: number;
  max: number;
}

function buildOverlaySeries(lanes: ChartLaneData[]): OverlaySeries[] {
  const result: OverlaySeries[] = [];
  let index = 0;
  for (const lane of lanes) {
    for (const series of lane.series) {
      const values = series.points.map((point) => point.value);
      const ticks = values.length > 0 ? niceTicks(Math.min(...values), Math.max(...values)) : [0, 1];
      result.push({
        key: series.key,
        // 血圧のように 1 項目が 2 系列になるものは、どちらかが分かる名前にする。
        name: lane.series.length > 1 ? `${lane.name} ${series.name}` : lane.name,
        unit: lane.unit,
        slot: index % SERIES_SLOTS,
        shape: index % SERIES_SHAPES,
        points: series.points,
        min: ticks[0],
        max: ticks[ticks.length - 1],
      });
      index += 1;
    }
  }
  return result;
}

/** 系列の印。色だけに頼らずに見分けられるよう、形も変える。 */
function seriesMarkPath(shape: number, x: number, y: number, r: number): string {
  if (shape === 1) return `M${x - r},${y - r} L${x + r},${y - r} L${x},${y + r} Z`;
  if (shape === 2) return `M${x - r},${y - r} H${x + r} V${y + r} H${x - r} Z`;
  if (shape === 3) return `M${x - r},${y + r} L${x + r},${y + r} L${x},${y - r} Z`;
  if (shape === 4) return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
  // 0 = 丸。パスで描くと他の形と線幅がそろう。
  return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
}

interface OverlayChartProps {
  lanes: ChartLaneData[];
  range: ChartRange;
  vbWidth: number;
  height: number;
  legendRef: React.Ref<HTMLUListElement>;
  toX: (t: number) => number;
  boundaries: number[];
  todayX: number | null;
  markerLines: { x: number; kind: ChartEventKind }[];
  hoverT: number | null;
  onHover: (t: number | null) => void;
  columnLabels: { x: number; text: string }[];
}

function OverlayChart({
  lanes,
  range,
  vbWidth,
  height,
  legendRef,
  toX,
  boundaries,
  todayX,
  markerLines,
  hoverT,
  onHover,
  columnLabels,
}: OverlayChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const series = useMemo(() => buildOverlaySeries(lanes), [lanes]);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const toY = (value: number, spec: OverlaySeries) =>
    MARGIN.top + plotH - ((value - spec.min) / Math.max(1e-9, spec.max - spec.min)) * plotH;

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * vbWidth;
    const ratio = (vx - MARGIN.left) / (vbWidth - MARGIN.left - MARGIN.right);
    if (ratio < 0 || ratio > 1) {
      onHover(null);
      return;
    }
    onHover(range.tMin + ratio * (range.tMax - range.tMin));
  }

  const nearestOf = (spec: OverlaySeries) => {
    if (hoverT === null || spec.points.length === 0) return null;
    let nearest = spec.points[0];
    for (const point of spec.points) {
      if (Math.abs(point.t - hoverT) < Math.abs(nearest.t - hoverT)) nearest = point;
    }
    return nearest;
  };

  const hoverX = hoverT === null ? null : toX(hoverT);
  const hoverRows = hoverT === null ? [] : series.map((spec) => ({ spec, point: nearestOf(spec) }));
  const hoverAt = hoverRows.find((row) => row.point)?.point?.at ?? "";
  const hasPoints = series.some((spec) => spec.points.length > 0);

  return (
    <div className="patient-chart__lane">
      <div className="patient-chart__lane-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vbWidth} ${height}`}
          role="img"
          aria-label="すべての項目を重ねた推移グラフ"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => onHover(null)}
        >
          {boundaries.map((x, i) => (
            <line
              key={i}
              className="patient-chart__column-grid"
              x1={x}
              x2={x}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
          ))}
          {/* 縦軸に数値は出さないので、横罫線は目安の 4 等分だけ引く。 */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i}
              className="lab-chart__grid"
              x1={MARGIN.left}
              x2={vbWidth - MARGIN.right}
              y1={MARGIN.top + (plotH * i) / 4}
              y2={MARGIN.top + (plotH * i) / 4}
            />
          ))}
          {markerLines.map((line, i) => (
            <line
              key={i}
              className={`patient-chart__event-line patient-chart__event--${line.kind}`}
              x1={line.x}
              x2={line.x}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
          ))}
          {todayX !== null && (
            <line
              className="patient-chart__today"
              x1={todayX}
              x2={todayX}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
          )}
          {columnLabels.map((label, i) => (
            <text
              key={i}
              className="lab-chart__tick"
              x={label.x}
              y={height - 8}
              textAnchor="middle"
            >
              {label.text}
            </text>
          ))}
          {hoverX !== null && (
            <line
              className="lab-chart__crosshair"
              x1={hoverX}
              x2={hoverX}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
          )}
          {series.map((spec) => (
            <g key={spec.key} className={`patient-chart__s${spec.slot + 1}`}>
              <path
                className="lab-chart__line"
                d={spec.points
                  .map(
                    (point, i) =>
                      `${i === 0 ? "M" : "L"}${toX(point.t).toFixed(1)},${toY(point.value, spec).toFixed(1)}`,
                  )
                  .join(" ")}
              />
              {spec.points.map((point) => (
                <path
                  key={point.at}
                  className="lab-chart__marker"
                  d={seriesMarkPath(spec.shape, toX(point.t), toY(point.value, spec), 4)}
                  tabIndex={0}
                  aria-label={`${spec.name} ${formatPointDate(point.at)} ${formatValue(point.value)}${spec.unit}`}
                  onFocus={() => onHover(point.t)}
                  onBlur={() => onHover(null)}
                />
              ))}
            </g>
          ))}
          {!hasPoints && (
            <text
              className="patient-chart__no-data"
              x={vbWidth / 2}
              y={height / 2}
              textAnchor="middle"
            >
              この期間に値がありません
            </text>
          )}
        </svg>
        {hoverAt && (
          <div
            className="lab-chart__tooltip patient-chart__tooltip"
            style={(hoverX ?? 0) > vbWidth / 2 ? { left: 0 } : { right: 0 }}
          >
            {hoverRows.map(({ spec, point }) =>
              point ? (
                <span key={spec.key} className="patient-chart__tooltip-row">
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
                    {spec.name} {formatValue(point.value)}
                    {spec.unit && ` ${spec.unit}`}
                  </span>
                </span>
              ) : null,
            )}
            <span className="lab-chart__tooltip-date">{formatPointDate(hoverAt)}</span>
          </div>
        )}
      </div>
      {/* 縦軸に数値を出さないぶん、各系列の単位と表示範囲は凡例で示す。 */}
      <ul className="patient-chart__legend" ref={legendRef}>
        {series.map((spec) => (
          <li key={spec.key}>
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
            <span className="patient-chart__legend-name">{spec.name}</span>
            <span className="patient-chart__legend-range">
              {formatValue(spec.min)}〜{formatValue(spec.max)}
              {spec.unit && ` ${spec.unit}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- 1 項目ぶんのグラフ ----

interface ChartLaneProps {
  lane: ChartLaneData;
  range: ChartRange;
  vbWidth: number;
  height: number;
  toX: (t: number) => number;
  boundaries: number[];
  todayX: number | null;
  markerLines: { x: number; kind: ChartEventKind }[];
  hoverT: number | null;
  onHover: (t: number | null) => void;
  columnLabels: { x: number; text: string }[];
}

function ChartLane({
  lane,
  range,
  vbWidth,
  height,
  toX,
  boundaries,
  todayX,
  markerLines,
  hoverT,
  onHover,
  columnLabels,
}: ChartLaneProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const points = lane.series.flatMap((series) => series.points);
  const hasPoints = points.length > 0;

  const values = points.map((point) => point.value);
  const ticks = hasPoints ? niceTicks(Math.min(...values), Math.max(...values)) : [0, 1];
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const toY = (value: number) =>
    MARGIN.top + plotH - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  // ホバー中の時刻に一番近い点(系列ごと)。縦位置が揃うので複数レーンを同時に読める。
  const nearestOf = (seriesIndex: number) => {
    if (hoverT === null) return null;
    const series = lane.series[seriesIndex];
    if (series.points.length === 0) return null;
    let nearest = series.points[0];
    for (const point of series.points) {
      if (Math.abs(point.t - hoverT) < Math.abs(nearest.t - hoverT)) nearest = point;
    }
    return nearest;
  };

  // 画面の x → 時刻(toX の逆)。どのレーンで動かしても同じ時刻になるので、
  // レーンをまたいで同じ縦線・同じ時期のツールチップが出る。
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * vbWidth;
    const ratio = (vx - MARGIN.left) / (vbWidth - MARGIN.left - MARGIN.right);
    if (ratio < 0 || ratio > 1) {
      onHover(null);
      return;
    }
    onHover(range.tMin + ratio * (range.tMax - range.tMin));
  }

  const hoverX = hoverT === null ? null : toX(hoverT);
  const tooltip = hoverT === null ? null : buildTooltip(lane, nearestOf);

  return (
    <div className="patient-chart__lane">
      <p className="patient-chart__lane-title">
        {lane.name}
        {lane.unit && <span className="patient-chart__lane-unit">({lane.unit})</span>}
      </p>
      <div className="patient-chart__lane-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vbWidth} ${height}`}
          role="img"
          aria-label={`${lane.name}の推移グラフ`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => onHover(null)}
        >
        {boundaries.map((x, i) => (
          <line
            key={i}
            className="patient-chart__column-grid"
            x1={x}
            x2={x}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        ))}
        {markerLines.map((line, i) => (
          <line
            key={i}
            className={`patient-chart__event-line patient-chart__event--${line.kind}`}
            x1={line.x}
            x2={line.x}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        ))}
        {todayX !== null && (
          <line
            className="patient-chart__today"
            x1={todayX}
            x2={todayX}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        )}
        {hasPoints &&
          ticks.map((tick) => (
            <g key={tick}>
              <line
                className="lab-chart__grid"
                x1={MARGIN.left}
                x2={vbWidth - MARGIN.right}
                y1={toY(tick)}
                y2={toY(tick)}
              />
              <text className="lab-chart__tick" x={MARGIN.left - 8} y={toY(tick) + 3.5} textAnchor="end">
                {formatValue(tick)}
              </text>
            </g>
          ))}
        {columnLabels.map((label, i) => (
          <text
            key={i}
            className="lab-chart__tick"
            x={label.x}
            y={height - 8}
            textAnchor="middle"
          >
            {label.text}
          </text>
        ))}
        {hoverX !== null && (
          <line
            className="lab-chart__crosshair"
            x1={hoverX}
            x2={hoverX}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        )}
        {lane.series.map((series, index) => (
          <g key={series.key} className={index > 0 ? "patient-chart__series-2" : undefined}>
            <path
              className="lab-chart__line"
              d={series.points
                .map(
                  (point, i) =>
                    `${i === 0 ? "M" : "L"}${toX(point.t).toFixed(1)},${toY(point.value).toFixed(1)}`,
                )
                .join(" ")}
            />
            {series.points.map((point) => (
              <circle
                key={point.at}
                className="lab-chart__marker"
                cx={toX(point.t)}
                cy={toY(point.value)}
                r={4}
                tabIndex={0}
                aria-label={`${formatPointDate(point.at)} ${formatValue(point.value)}${lane.unit}`}
                onFocus={() => onHover(point.t)}
                onBlur={() => onHover(null)}
              />
            ))}
          </g>
        ))}
          {!hasPoints && (
            <text className="patient-chart__no-data" x={vbWidth / 2} y={height / 2} textAnchor="middle">
              この期間に値がありません
            </text>
          )}
        </svg>
        {/* ツールチップはカーソルと反対側の角に置く(線と点を隠さず、上のレーンにも重ならない)。 */}
        {tooltip && (
          <div
            className="lab-chart__tooltip patient-chart__tooltip"
            style={(hoverX ?? 0) > vbWidth / 2 ? { left: 0 } : { right: 0 }}
          >
            {tooltip.rows.map((row) => (
              <span key={row.key} className="lab-chart__tooltip-value">
                {row.text}
              </span>
            ))}
            <span className="lab-chart__tooltip-date">{tooltip.at}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function buildTooltip(
  lane: ChartLaneData,
  nearestOf: (index: number) => { at: string; value: number } | null,
) {
  const rows: { key: string; text: string }[] = [];
  let at = "";
  lane.series.forEach((series, index) => {
    const point = nearestOf(index);
    if (!point) return;
    at = point.at;
    const label = lane.series.length > 1 ? `${series.name} ` : "";
    rows.push({
      key: series.key,
      text: `${label}${formatValue(point.value)}${lane.unit ? ` ${lane.unit}` : ""}`,
    });
  });
  return rows.length ? { rows, at: formatPointDate(at) } : null;
}
