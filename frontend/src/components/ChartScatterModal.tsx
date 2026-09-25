import { useMemo, useState } from "react";
import {
  relativeDayLabel,
  type ChartChoiceTrack,
  type ChartLaneData,
} from "../fhir/chartDefinitionHelpers";
import { pairByTime, type ChartPair, type ChartPairSource } from "../fhir/chartStateHelpers";
import { spearman } from "../lib/stats";
import { formatPointDate, formatValue, niceTicks } from "./chartScale";
import { ChartScatterGuide } from "./ChartScatterGuide";
import { Modal } from "./Modal";

// 2 項目の対比(散布図)。X と Y を選び、同じ日(または ±N 日)の記録をペアにして描く。
// X には順序尺度の選択肢(NYHA 分類など)も置けるので、定性と定量の関係の向きと強さを直接見る。
// 点は古いほど薄くし、Spearman の ρ と n を添える。読み捨ての分析なので URL には載せない。

const VB_WIDTH = 560;
const VB_HEIGHT = 380;
const MARGIN = { top: 16, right: 20, bottom: 56, left: 64 };
/** これより少ない n では ρ を目安にしないよう注意を出す。 */
const SMALL_N = 10;
const WINDOW_CHOICES = [0, 3, 7, 14] as const;

interface Axis {
  key: string;
  name: string;
  unit: string;
  points: ChartPairSource[];
  /** 順序尺度(選択肢)の目盛り。添字 → 名前。 */
  ordinal?: string[];
}

interface Props {
  lanes: ChartLaneData[];
  choiceTracks: ChartChoiceTrack[];
  anchor?: string;
  onClose: () => void;
}

export function ChartScatterModal({ lanes, choiceTracks, anchor, onClose }: Props) {
  const quantitative: Axis[] = lanes.flatMap((lane) =>
    lane.series.map((series) => ({
      key: series.key,
      name: lane.series.length > 1 ? `${lane.name} ${series.name}` : lane.name,
      unit: lane.unit,
      points: series.points.map((point) => ({ t: point.t, at: point.at, value: point.value })),
    })),
  );
  // 選択肢の項目は添字を値にする(順序の無い項目も並び順で置くが、目盛りは名前で読む)。
  const ordinal: Axis[] = choiceTracks.map((track) => ({
    key: track.key,
    name: track.name,
    unit: "",
    points: track.marks
      .filter((mark) => mark.index >= 0)
      .map((mark) => ({ t: mark.t, at: mark.at, value: mark.index })),
    ordinal: track.options.map((option) => option.display),
  }));
  const xAxes = [...ordinal, ...quantitative];
  const yAxes = quantitative;

  const [xKey, setXKey] = useState(xAxes[0]?.key ?? "");
  const [yKey, setYKey] = useState(yAxes.find((axis) => axis.key !== xAxes[0]?.key)?.key ?? yAxes[0]?.key ?? "");
  const [windowDays, setWindowDays] = useState<number>(0);
  const [hovered, setHovered] = useState<ChartPair | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const x = xAxes.find((axis) => axis.key === xKey) ?? xAxes[0];
  const y = yAxes.find((axis) => axis.key === yKey) ?? yAxes[0];
  const pairs = useMemo(
    () => (x && y ? pairByTime(x.points, y.points, windowDays) : []),
    [x, y, windowDays],
  );
  const rho = spearman(
    pairs.map((pair) => pair.x),
    pairs.map((pair) => pair.y),
  );

  return (
    <Modal
      title="対比"
      onClose={onClose}
      className="modal--wide"
      titleAction={
        <button type="button" className="modal__help" onClick={() => setGuideOpen(true)} aria-label="対比の使い方" title="対比の使い方">
          ?
        </button>
      }
    >
      <div className="patient-chart__analysis">
        <div className="patient-chart__analysis-controls">
          <label>
            横軸
            <select value={x?.key ?? ""} onChange={(e) => setXKey(e.target.value)}>
              {xAxes.map((axis) => (
                <option key={axis.key} value={axis.key}>
                  {axis.ordinal ? `${axis.name}(選択肢)` : axis.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            縦軸
            <select value={y?.key ?? ""} onChange={(e) => setYKey(e.target.value)}>
              {yAxes.map((axis) => (
                <option key={axis.key} value={axis.key}>
                  {axis.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            記録の対応
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {WINDOW_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? "同じ日" : `±${days} 日`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!x || !y ? (
          <p className="patient-chart__stats">対比できる項目がありません。</p>
        ) : (
          <>
            <ScatterPlot x={x} y={y} pairs={pairs} hovered={hovered} onHover={setHovered} anchor={anchor} />
            <p className="patient-chart__stats">
              <span>
                n = <strong>{pairs.length}</strong>
              </span>
              {rho !== undefined && (
                <span>
                  Spearman ρ = <strong>{rho.toFixed(2)}</strong>
                </span>
              )}
              {rho !== undefined && pairs.length < SMALL_N && (
                <span className="patient-chart__stats-note">n が少ないので ρ は目安になりません</span>
              )}
              {rho === undefined && pairs.length > 0 && (
                <span className="patient-chart__stats-note">ρ は求められません(組が 3 未満か、値が変わっていません)</span>
              )}
            </p>
          </>
        )}
      </div>
      {guideOpen && <ChartScatterGuide onClose={() => setGuideOpen(false)} />}
    </Modal>
  );
}

function ScatterPlot({
  x,
  y,
  pairs,
  hovered,
  onHover,
  anchor,
}: {
  x: Axis;
  y: Axis;
  pairs: ChartPair[];
  hovered: ChartPair | null;
  onHover: (pair: ChartPair | null) => void;
  anchor?: string;
}) {
  const plotW = VB_WIDTH - MARGIN.left - MARGIN.right;
  const plotH = VB_HEIGHT - MARGIN.top - MARGIN.bottom;
  const xs = pairs.map((pair) => pair.x);
  const ys = pairs.map((pair) => pair.y);
  // 順序尺度は選択肢の全部を目盛りにする(記録に無い段も並べて、どの段の話かを読めるように)。
  const xTicks = x.ordinal
    ? x.ordinal.map((_, index) => index)
    : xs.length
      ? niceTicks(Math.min(...xs), Math.max(...xs))
      : [0, 1];
  const yTicks = ys.length ? niceTicks(Math.min(...ys), Math.max(...ys)) : [0, 1];
  const xMin = x.ordinal ? -0.5 : xTicks[0];
  const xMax = x.ordinal ? xTicks.length - 0.5 : xTicks[xTicks.length - 1];
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const toX = (value: number) => MARGIN.left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * plotW;
  const toY = (value: number) => MARGIN.top + plotH - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  // 古い記録ほど薄く。時刻の順位で 0.3〜1 に割り付ける。
  const order = [...pairs].sort((a, b) => a.t - b.t);
  const rankOf = new Map(order.map((pair, index) => [pair, index]));
  const opacityOf = (pair: ChartPair) =>
    order.length <= 1 ? 1 : 0.3 + 0.7 * ((rankOf.get(pair) ?? 0) / (order.length - 1));

  const xLabel = (value: number) => (x.ordinal ? (x.ordinal[value] ?? "") : formatValue(value));
  const describe = (pair: ChartPair) =>
    [
      `${x.name} ${xLabel(pair.x)}${x.unit ? ` ${x.unit}` : ""}(${withRelative(pair.xAt, anchor)})`,
      `${y.name} ${formatValue(pair.y)}${y.unit ? ` ${y.unit}` : ""}(${withRelative(pair.yAt, anchor)})`,
    ];

  return (
    <div className="patient-chart__scatter-plot">
      <svg
        className="patient-chart__scatter"
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label={`${x.name}と${y.name}の散布図`}
        onPointerLeave={() => onHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line className="lab-chart__grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={toY(tick)} y2={toY(tick)} />
            <text className="lab-chart__tick" x={MARGIN.left - 8} y={toY(tick) + 3.5} textAnchor="end">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line className="lab-chart__grid" x1={toX(tick)} x2={toX(tick)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            <text className="lab-chart__tick" x={toX(tick)} y={MARGIN.top + plotH + 16} textAnchor="middle">
              {xLabel(tick)}
            </text>
          </g>
        ))}
        <text className="patient-chart__scatter-label" x={MARGIN.left + plotW / 2} y={VB_HEIGHT - 8} textAnchor="middle">
          {x.name}
          {x.unit ? `(${x.unit})` : ""}
        </text>
        <text
          className="patient-chart__scatter-label"
          transform={`translate(14 ${MARGIN.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {y.name}
          {y.unit ? `(${y.unit})` : ""}
        </text>
        {pairs.length === 0 && (
          <text className="patient-chart__no-data" x={VB_WIDTH / 2} y={VB_HEIGHT / 2} textAnchor="middle">
            対応する記録の組がありません
          </text>
        )}
        {order.map((pair) => (
          <circle
            key={`${pair.xAt}/${pair.yAt}`}
            className={`patient-chart__scatter-point${hovered === pair ? " is-active" : ""}`}
            cx={toX(pair.x)}
            cy={toY(pair.y)}
            r={hovered === pair ? 6 : 4.5}
            style={{ fillOpacity: opacityOf(pair) }}
            onPointerEnter={() => onHover(pair)}
            tabIndex={0}
            aria-label={describe(pair).join(" / ")}
            onFocus={() => onHover(pair)}
            onBlur={() => onHover(null)}
          >
            <title>{describe(pair).join("\n")}</title>
          </circle>
        ))}
      </svg>
      {hovered && (
        <div
          className="lab-chart__tooltip patient-chart__scatter-tooltip"
          style={toX(hovered.x) > VB_WIDTH / 2 ? { left: 0 } : { right: 0 }}
        >
          {describe(hovered).map((line) => (
            <span key={line} className="lab-chart__tooltip-value">
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function withRelative(at: string, anchor: string | undefined): string {
  const relative = relativeDayLabel(at, anchor);
  return relative ? `${formatPointDate(at)} ${relative}` : formatPointDate(at);
}
