import { useMemo, type ReactNode } from "react";
import type { IndicatorExtractDefinition } from "../../fhir/extractRecordQuery";
import {
  indicatorCsv,
  indicatorPointsOf,
  meetsTarget,
  targetLabel,
  type IndicatorCount,
} from "../../fhir/indicatorExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { BREAKDOWN_CHART_MAX_SERIES } from "./RecordBreakdownChart";
import { SeriesLineChart, type LineSeries } from "./SeriesLineChart";

// データ抽出の「指標」タブ(docs/data-extract-design.md §23)の結果の「指標」の見方。期間ごとの割合の折れ線(目標は破線)と、
// 期間 × (全体・比較群)の分母・分子・割合の表。数を押すと一覧をその行に絞る。

interface Props {
  /** 結果の表(属性の列を含む)の見出しとセル、行ごとの患者。 */
  header: string[];
  cells: string[][];
  patientIds: string[];
  definition: Pick<IndicatorExtractDefinition, "target" | "target_direction">;
  /** 結果の期間の並び(行の無い期間も出す)。 */
  periods?: { date: string; label: string }[];
  onDrill?: (indices: number[], label: string) => void;
  /** false なら CSV を出さない(ダッシュボードのタイル)。 */
  controls?: boolean;
}

const OVERALL = "全体";

export function IndicatorTrendView({ header, cells, patientIds, definition, periods, onDrill, controls = true }: Props) {
  const points = useMemo(() => indicatorPointsOf(header, cells, patientIds, periods), [header, cells, patientIds, periods]);
  const groupNames = points.groupNames.slice(0, BREAKDOWN_CHART_MAX_SERIES - 1);
  const labels = points.points.map((p) => p.label);
  const series: LineSeries[] = [
    { label: OVERALL, slot: 1, values: points.points.map((p) => p.rate) },
    ...groupNames.map((name, i) => ({
      label: name,
      slot: i + 2,
      values: points.points.map((p) => p.groups.get(name)?.rate ?? null),
    })),
  ];
  const target = definition.target;
  const reference = target != null ? { value: target, label: "目標" } : undefined;
  const columns = [OVERALL, ...groupNames];

  const drillable = (indices: number[], label: string, content: ReactNode): ReactNode =>
    onDrill && indices.length > 0 ? (
      <button
        type="button"
        className="extract-breakdown__drill"
        title={`${label} を一覧で見る`}
        onClick={() => onDrill(indices, label)}
      >
        {content}
      </button>
    ) : (
      content
    );

  const countCell = (count: IndicatorCount, label: string): ReactNode => {
    if (count.denominator === 0) return "-";
    const met = meetsTarget(count.rate, target, definition.target_direction);
    return (
      <>
        {drillable(count.hitIndices, `${label} 分子`, <strong>{`${count.rate}%`}</strong>)}
        <span className="extract-breakdown__patients">
          ({drillable(count.hitIndices, `${label} 分子`, count.numerator)}/
          {drillable(count.indices, `${label} 分母`, count.denominator)})
        </span>
        {met !== null && <span className={met ? "extract-indicator__met" : "extract-indicator__unmet"}>{met ? "○" : "×"}</span>}
      </>
    );
  };

  return (
    <div className="extract-indicator">
      <SeriesLineChart
        title={`割合の推移${target != null ? `(${targetLabel(definition)})` : ""}`}
        labels={labels}
        series={series}
        unit="%"
        fromZero
        reference={reference}
      />
      <div className="extract-results__table-wrap">
        <table className="master-search__table extract-breakdown">
          <thead>
            <tr>
              <th>期間</th>
              {columns.map((name) => (
                <th key={name} className="extract-breakdown__number">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.points.map((point) => (
              <tr key={point.date}>
                <td className="extract-breakdown__label">{point.label}</td>
                <td className="extract-breakdown__number">{countCell(point, point.label)}</td>
                {groupNames.map((name) => (
                  <td key={name} className="extract-breakdown__number">
                    {countCell(point.groups.get(name)!, `${point.label} ${name}`)}
                  </td>
                ))}
              </tr>
            ))}
            {points.points.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="master-search__empty">
                  期間はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted">
        各セルは割合(分子/分母)。分母・分子は患者数です。
        {points.groupNames.length > groupNames.length &&
          `比較群は人数の多い ${groupNames.length} 群を出しています(ほか ${points.groupNames.length - groupNames.length} 群は CSV に出ます)。`}
      </p>
      {controls && (
        <div className="data-extract__toolbar">
          <button
            type="button"
            className="extract-breakdown__csv"
            disabled={points.points.length === 0}
            onClick={() => downloadBlob(indicatorCsv(points), `indicator_${today()}.csv`)}
          >
            指標CSV
          </button>
        </div>
      )}
    </div>
  );
}
