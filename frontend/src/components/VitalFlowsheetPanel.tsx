import { useEffect, useMemo, useRef, useState } from "react";
import { useVitalFlowsheet } from "../api/queries";
import {
  BLOOD_PRESSURE_SERIES,
  bloodPressureNumbers,
  buildVitalFlowsheet,
  flowsheetColumnLabel,
  groupFlowsheetColumns,
  type VitalFlowsheetRow,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";

// バイタルの経過表(POMR のフローシート)。読み取り専用で、編集はカルテの
// バイタルカードから行う(編集の導線を 2 つ持つと同期の負債になるため)。
//
// 表の操作系は検査結果の時系列表示(LabResultTimelinePanel)に合わせるが、
// グラフは温度板にならって表の最上段に常設し、体温・血圧・脈拍・呼吸数を
// 表の列位置に揃えて描く(項目を選んでモーダルで開く方式は採らない)。

const DEFAULT_COLUMN_COUNT = 10;
const MAX_COLUMN_COUNT = 100;

export function VitalFlowsheetPanel({ patientId }: { patientId: string }) {
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMN_COUNT);
  const [fullscreen, setFullscreen] = useState(false);
  // 全画面はビューポート全体ではなく「患者情報の下」から始める。開始位置は
  // カルテのレイアウト(左右ペインの上端)を実測して決める。全画面のときこの
  // 要素自体は fixed で流れから外れるが、レイアウトの上端は上の行(アプリ
  // ヘッダー + 患者情報)で決まるので測り直しても動かない。
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);

  const { data: observations, isLoading, error } = useVitalFlowsheet(patientId, columnCount);
  const flowsheet = useMemo(
    () => buildVitalFlowsheet(observations ?? [], columnCount),
    [observations, columnCount],
  );

  // 全画面は Escape でも抜けられるようにする(モーダルと同じ作法)。
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setFullscreenTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  function handleColumnCountChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    setColumnCount(Math.min(MAX_COLUMN_COUNT, Math.max(1, Math.round(raw))));
  }

  const chartSeries = useMemo(
    () => buildChartSeries(flowsheet.rows, observations ?? []),
    [flowsheet, observations],
  );

  const { columns } = flowsheet;
  const yearGroups = groupFlowsheetColumns(columns, (at) => flowsheetColumnLabel(at).year);
  // 同じ日の朝夕は列を分けたまま、日付の見出しだけ 1 つにまとめる。
  const dateGroups = groupFlowsheetColumns(
    columns,
    (at) => `${flowsheetColumnLabel(at).year}/${flowsheetColumnLabel(at).date}`,
  );

  return (
    // 表の地色・見出し行・1 行おきの濃淡は他のタブ(検査結果の時系列表示)と同じ
    // .karte-tabpanel 配下の指定に任せる。全画面は同じ中身を左右ペインの領域に
    // 重ねるだけ(患者情報の帯までは残り、右ペインなどは覆われて見えなくなる)。
    <div
      ref={panelRef}
      className={`karte-tabpanel vital-flowsheet${fullscreen ? " vital-flowsheet--fullscreen" : ""}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-timeline__controls">
            <label className="lab-timeline__count">
              履歴の表示数
              <input
                type="number"
                min={1}
                max={MAX_COLUMN_COUNT}
                value={columnCount}
                onChange={(e) => handleColumnCountChange(e.target.valueAsNumber)}
              />
            </label>
            <span className="lab-timeline__hint" />
            <button type="button" onClick={() => setFullscreen((prev) => !prev)}>
              {fullscreen ? "全画面を終了" : "全画面"}
            </button>
          </div>

          {flowsheet.rows.length === 0 ? (
            <p className="patient-table__empty">バイタルの記録がありません</p>
          ) : (
            <div className="lab-timeline__table-wrap">
              <table className="lab-timeline__table vital-flowsheet__table">
                <thead>
                  {/* 列は測定 1 回。同じ日の朝夕を潰さないよう、日付の下に時刻を出す。
                      末尾の空列は余白を吸収する(測定列の幅を固定してグラフと揃えるため)。 */}
                  <tr>
                    <th className="lab-timeline__item-col" rowSpan={3}>
                      測定項目
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={3}>
                      単位
                    </th>
                    {yearGroups.map((group) => (
                      <th
                        key={group.columns[0]}
                        className="lab-timeline__year-col"
                        colSpan={group.columns.length}
                      >
                        {group.label}年
                      </th>
                    ))}
                    <th className="vital-flowsheet__filler" rowSpan={3} />
                  </tr>
                  <tr>
                    {dateGroups.map((group) => (
                      <th
                        key={group.columns[0]}
                        className="lab-timeline__date-col vital-flowsheet__date-col"
                        colSpan={group.columns.length}
                        title={group.columns.join("\n")}
                      >
                        {flowsheetColumnLabel(group.columns[0]).date}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map((at) => (
                      <th key={at} className="vital-flowsheet__time-col" title={at}>
                        {flowsheetColumnLabel(at).time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="vital-flowsheet__chart-row">
                    <th className="lab-timeline__item-col vital-flowsheet__axis-cell" colSpan={2}>
                      <FlowsheetAxis series={chartSeries} />
                    </th>
                    <td className="vital-flowsheet__chart-cell" colSpan={columns.length}>
                      <FlowsheetChart columns={columns} series={chartSeries} />
                    </td>
                    <td className="vital-flowsheet__filler" />
                  </tr>
                  {flowsheet.rows.map((row) => (
                    <tr key={row.key}>
                      <td className="lab-timeline__item-col">
                        <span className="lab-timeline__item-label">{row.name}</span>
                      </td>
                      <td className="lab-timeline__unit-col">{row.unit}</td>
                      {columns.map((at) => (
                        // 列幅は固定なので、長い文字値(観察結果)は省略される。全文は title で。
                        <td key={at} className="lab-timeline__value" title={row.values.get(at)}>
                          {row.values.get(at) ?? ""}
                        </td>
                      ))}
                      <td className="vital-flowsheet__filler" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- グラフ(温度板) ----

/** 測定列 1 つの幅(px)。表のセル幅(CSS の .vital-flowsheet__table)と一致させること。 */
export const FLOWSHEET_COLUMN_WIDTH = 64;
const CHART_HEIGHT = 190;
const CHART_PAD = { top: 22, bottom: 12 };
const PLOT_H = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
/** 目盛りの区間数。全系列で共通(同じ横罫線に各系列の目盛りを揃える)。 */
const TICK_INTERVALS = 6;
/** 基準線(下から数えた目盛りの位置)。BP 120 / R 30 / P 75 / T 37 の横罫線。 */
const BASELINE_TICK = 3;

type ChartMarker = "square" | "circle" | "triangle-up" | "triangle-down";

interface ChartSpec {
  key: string;
  /** 略称(T/BP/P/R)。 */
  name: string;
  unit: string;
  /** CSS 側で色を当てる修飾子。 */
  className: string;
  marker: ChartMarker;
  /** 最下段の目盛りと 1 区間の幅。目盛りは TICK_INTERVALS 区間で固定。 */
  min: number;
  step: number;
  /** 軸の列に出す系列。血圧の拡張期は収縮期と同じ列を使う。 */
  axis: boolean;
}

interface ChartSeries extends ChartSpec {
  max: number;
  numbers: Map<string, number>;
}

// 温度板の慣例的な目盛り(BP 0–240 / R 0–60 / P 0–150 / T 34–40)。系列ごとにスケールが
// 違うので 1 つの軸に重ねず、同じ横罫線に各系列の目盛りを割り当てる。
const CHART_SPECS: ChartSpec[] = [
  { key: "8480-6", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-down", min: 0, step: 40, axis: true },
  { key: "8462-4", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-up", min: 0, step: 40, axis: false },
  { key: "9279-1", name: "R", unit: "/分", className: "r", marker: "square", min: 0, step: 10, axis: true },
  { key: "8867-4", name: "P", unit: "/分", className: "p", marker: "circle", min: 0, step: 25, axis: true },
  { key: "8310-5", name: "T", unit: "℃", className: "t", marker: "circle", min: 34, step: 1, axis: true },
];

function buildChartSeries(
  rows: VitalFlowsheetRow[],
  observations: fhir4.Observation[],
): ChartSeries[] {
  const bpKeys = BLOOD_PRESSURE_SERIES.map((series) => series.key as string);
  return CHART_SPECS.map((spec) => {
    const numbers = bpKeys.includes(spec.key)
      ? bloodPressureNumbers(observations, spec.key)
      : (rows.find((row) => row.key === spec.key)?.numbers ?? new Map<string, number>());
    // 目盛りの区間数は固定なので、範囲外の測定があれば目盛りごと平行移動して収める
    // (上側を優先。上下両方にはみ出す極端な場合は下側が切れる)。
    let { min } = spec;
    const span = spec.step * TICK_INTERVALS;
    const values = [...numbers.values()];
    if (values.length > 0) {
      const low = Math.min(...values);
      const high = Math.max(...values);
      while (min > low) min -= spec.step;
      while (min + span < high) min += spec.step;
    }
    return { ...spec, min, max: min + span, numbers };
  });
}

const tickY = (index: number) => CHART_PAD.top + PLOT_H - (PLOT_H * index) / TICK_INTERVALS;

/** 左端の軸。系列ごとの目盛りを列にして、グラフと同じ高さの横罫線に揃える。 */
function FlowsheetAxis({ series }: { series: ChartSeries[] }) {
  const columns = series.filter((s) => s.axis);
  const colWidth = 36;
  const width = columns.length * colWidth;
  return (
    <svg
      className="vital-flowsheet__axis"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      aria-hidden="true"
    >
      {columns.map((s, col) => {
        const x = width - (columns.length - col - 0.5) * colWidth;
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <text className="vital-flowsheet__axis-name" x={x} y={12} textAnchor="middle">
              {s.name}
            </text>
            {Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => (
              <text
                key={i}
                className={`vital-flowsheet__axis-tick${i === BASELINE_TICK ? " vital-flowsheet__axis-tick--base" : ""}`}
                x={x}
                y={tickY(i) + 3.5}
                textAnchor="middle"
              >
                {s.min + s.step * i}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function markerShape(marker: ChartMarker, x: number, y: number) {
  const r = 3.5;
  switch (marker) {
    case "square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} />;
    // 血圧は温度板の慣例で収縮期を ▼、拡張期を ▲ にする。
    case "triangle-down":
      return <path d={`M${x},${y + r + 0.5} L${x + r + 0.5},${y - r} L${x - r - 0.5},${y - r} Z`} />;
    case "triangle-up":
      return <path d={`M${x},${y - r - 0.5} L${x + r + 0.5},${y + r} L${x - r - 0.5},${y + r} Z`} />;
    default:
      return <circle cx={x} cy={y} r={r} />;
  }
}

function FlowsheetChart({ columns, series }: { columns: string[]; series: ChartSeries[] }) {
  const width = columns.length * FLOWSHEET_COLUMN_WIDTH;
  const xOf = (index: number) => (index + 0.5) * FLOWSHEET_COLUMN_WIDTH;
  const yOf = (s: ChartSeries, value: number) =>
    CHART_PAD.top + PLOT_H - ((value - s.min) / (s.max - s.min)) * PLOT_H;

  // 目盛りの横罫線(主)と、区間を 2 等分する補助線。
  const majorLines = Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => tickY(i));
  const minorLines = Array.from({ length: TICK_INTERVALS }, (_, i) => tickY(i + 0.5));

  return (
    <svg
      className="vital-flowsheet__chart"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      role="img"
      aria-label="バイタルの推移グラフ"
    >
      {minorLines.map((y) => (
        <line key={y} className="vital-flowsheet__grid vital-flowsheet__grid--minor" x1={0} x2={width} y1={y} y2={y} />
      ))}
      {majorLines.map((y, i) => (
        <line
          key={y}
          className={`vital-flowsheet__grid${i === BASELINE_TICK ? " vital-flowsheet__grid--base" : ""}`}
          x1={0}
          x2={width}
          y1={y}
          y2={y}
        />
      ))}
      {columns.map((at, index) => (
        <line
          key={at}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={xOf(index)}
          x2={xOf(index)}
          y1={CHART_PAD.top}
          y2={CHART_PAD.top + PLOT_H}
        />
      ))}
      {series.map((s) => {
        const points = columns.flatMap((at, index) => {
          const value = s.numbers.get(at);
          return value == null ? [] : [{ at, value, x: xOf(index), y: yOf(s, value) }];
        });
        if (points.length === 0) return null;
        const path = points
          .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <path className="vital-flowsheet__line" d={path} />
            {points.map((p) => (
              <g key={p.at} className="vital-flowsheet__marker">
                <title>
                  {s.name} {p.value}
                  {s.unit} ({flowsheetColumnLabel(p.at).date} {flowsheetColumnLabel(p.at).time})
                </title>
                {markerShape(s.marker, p.x, p.y)}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
