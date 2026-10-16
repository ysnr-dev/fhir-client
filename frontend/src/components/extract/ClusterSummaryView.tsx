import { useMemo, type ReactNode } from "react";
import {
  clusterOverlap,
  clusterSummary,
  type ClusterCell,
  type ClusterMetricColumn,
} from "../../fhir/clusterExtractHelpers";
import type { RecordTableRow } from "../../fhir/recordTableHelpers";

// データ抽出の「クラスタ」タブ(docs/data-extract-design.md §22)の結果の「クラスタ」の見方。クラスタごとの概要
// (人数・性別・年齢・指標)とクラスタどうしの重なり。数を押すと一覧をその患者に絞る。

interface Props {
  rows: RecordTableRow[];
  groupsOf: Map<string, string[]> | null;
  clusterNames: string[];
  metricColumns: ClusterMetricColumn[];
  onDrill: (indices: number[], label: string) => void;
}

export function ClusterSummaryView({ rows, groupsOf, clusterNames, metricColumns, onDrill }: Props) {
  const summary = useMemo(
    () => clusterSummary(rows, groupsOf, clusterNames, metricColumns),
    [rows, groupsOf, clusterNames, metricColumns],
  );
  const overlap = useMemo(() => clusterOverlap(rows, groupsOf, clusterNames), [rows, groupsOf, clusterNames]);

  const drillable = (cell: ClusterCell, label: string): ReactNode =>
    cell.indices.length > 0 ? (
      <button
        type="button"
        className="extract-breakdown__drill"
        title={`${label} の患者を一覧で見る`}
        onClick={() => onDrill(cell.indices, label)}
      >
        {cell.text}
      </button>
    ) : (
      cell.text
    );

  return (
    <div className="extract-cluster">
      <h3 className="extract-cluster__heading">概要</h3>
      <table className="master-search__table extract-breakdown">
        <thead>
          <tr>
            <th />
            {summary.columns.map((column) => (
              <th key={column} className="extract-breakdown__number">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.sections.map((section) => [
            section.rows.length > 1 || section.label !== section.rows[0]?.label ? (
              <tr key={`section-${section.label}`} className="extract-cluster__section">
                <th colSpan={summary.columns.length + 1}>{section.label}</th>
              </tr>
            ) : null,
            ...section.rows.map((row) => (
              <tr key={`${section.label}-${row.label}`}>
                <td className="extract-breakdown__label">{row.label}</td>
                {row.cells.map((cell, index) => (
                  <td key={summary.columns[index]} className="extract-breakdown__number">
                    {drillable(cell, `${summary.columns[index]} ${section.label === row.label ? row.label : `${section.label} ${row.label}`}`)}
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
      {clusterNames.length > 1 && (
        <>
          <h3 className="extract-cluster__heading">重なり</h3>
          <table className="master-search__table extract-breakdown">
            <thead>
              <tr>
                <th />
                {clusterNames.map((name) => (
                  <th key={name} className="extract-breakdown__number">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clusterNames.map((rowName, r) => (
                <tr key={rowName}>
                  <td className="extract-breakdown__label">{rowName}</td>
                  {clusterNames.map((columnName, c) => {
                    const indices = overlap[r][c];
                    const label = r === c ? rowName : `${rowName} × ${columnName}`;
                    return (
                      <td key={columnName} className="extract-breakdown__number">
                        {drillable({ text: String(indices.length), indices }, label)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
