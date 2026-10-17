import { useMemo, type ReactNode } from "react";
import { incidenceAt, incidenceCsv, incidenceCurves, milestonesOf } from "../../fhir/eventExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { StepCurveChart } from "./StepCurveChart";

// データ抽出の「イベント」タブ(docs/data-extract-design.md §25)の結果の「累積発生率」の見方。全体と比較群ごとの
// Kaplan-Meier の階段グラフと、節目の日数ごとの累積発生率(リスク集団)、群ごとの人数・発生・打ち切り・中央値の表。

interface Props {
  /** 結果の表(属性の列を含む)の見出しとセル。 */
  header: string[];
  cells: string[][];
  /** 最大の追跡日数(無ければ最も長い日数)。 */
  followDays?: number;
  onDrill?: (indices: number[], label: string) => void;
}

export function CumulativeIncidenceView({ header, cells, followDays, onDrill }: Props) {
  const curves = useMemo(() => incidenceCurves(header, cells), [header, cells]);
  const maxDays = Math.max(followDays ?? 0, ...curves.flatMap((c) => c.steps.map((s) => s.t)), 0);
  const milestones = milestonesOf(maxDays);
  const drillable = (indices: number[], label: string, content: ReactNode): ReactNode =>
    onDrill && indices.length > 0 ? (
      <button type="button" className="extract-breakdown__drill" title={`${label} を一覧で見る`} onClick={() => onDrill(indices, label)}>
        {content}
      </button>
    ) : (
      content
    );

  return (
    <div className="extract-cluster">
      <StepCurveChart
        title="累積発生率"
        series={curves.map((curve, i) => ({ label: curve.label, slot: i + 1, points: curve.steps }))}
        maxT={maxDays}
      />
      <table className="master-search__table extract-breakdown">
        <thead>
          <tr>
            <th />
            {curves.map((curve) => (
              <th key={curve.label} className="extract-breakdown__number">
                {curve.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="extract-breakdown__label">人数</td>
            {curves.map((curve) => (
              <td key={curve.label} className="extract-breakdown__number">
                {drillable(curve.indices, curve.label, curve.count)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="extract-breakdown__label">発生</td>
            {curves.map((curve) => (
              <td key={curve.label} className="extract-breakdown__number">
                {curve.events}
              </td>
            ))}
          </tr>
          <tr>
            <td className="extract-breakdown__label">打ち切り</td>
            {curves.map((curve) => (
              <td key={curve.label} className="extract-breakdown__number">
                {curve.censored}
              </td>
            ))}
          </tr>
          <tr>
            <td className="extract-breakdown__label">50% に達した日数</td>
            {curves.map((curve) => (
              <td key={curve.label} className="extract-breakdown__number">
                {curve.median === null ? "未到達" : `${curve.median}日`}
              </td>
            ))}
          </tr>
          {milestones.map((t) => (
            <tr key={t}>
              <td className="extract-breakdown__label">{`${t}日`}</td>
              {curves.map((curve) => {
                const at = incidenceAt(curve.steps, t);
                return (
                  <td key={curve.label} className="extract-breakdown__number">
                    {`${at.value}%`}
                    <span className="extract-breakdown__patients">({at.atRisk})</span>
                  </td>
                );
              })}
            </tr>
          ))}
          {curves.length === 0 && (
            <tr>
              <td className="master-search__empty">患者はいません</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="order-select__muted">日数の行は累積発生率(その時点のリスク集団の人数)。打ち切りは観察の終わりまで結果が無かった患者です。</p>
      <div className="data-extract__toolbar">
        <button
          type="button"
          className="extract-breakdown__csv"
          disabled={curves.length === 0}
          onClick={() => downloadBlob(incidenceCsv(curves), `incidence_${today()}.csv`)}
        >
          発生率CSV
        </button>
      </div>
    </div>
  );
}
