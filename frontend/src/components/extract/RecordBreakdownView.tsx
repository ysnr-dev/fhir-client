import { useMemo, useState } from "react";
import {
  breakdownColumns,
  recordBreakdown,
  recordBreakdownCsv,
} from "../../fhir/recordBreakdownHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";

interface Props {
  header: string[];
  /** 行ごとのセル(見出しと同じ並び)。 */
  cells: string[][];
  patientIds: string[];
}

/**
 * 記録を表にするタブの内訳(docs/data-extract-design.md §18)。日付の列で月別に、分類の列で値ごとに、
 * 件数と患者数を数える。どちらか片方だけでもよい。分類の値は行に、月は列に置く。
 */
export function RecordBreakdownView({ header, cells, patientIds }: Props) {
  const columns = useMemo(() => breakdownColumns(header, cells), [header, cells]);
  const dateColumns = columns.filter((c) => c.isDate);
  const categoryColumns = columns.filter((c) => !c.isDate);
  // 既定は最初の日付の列で月別、分類なし。
  const [dateChoice, setDateChoice] = useState<string | null>(null);
  const [categoryChoice, setCategoryChoice] = useState("");
  const [showPatients, setShowPatients] = useState(true);
  const dateKey = dateChoice ?? (dateColumns[0] ? String(dateColumns[0].index) : "");
  const dateIndex = dateKey === "" ? null : Number(dateKey);
  const categoryIndex = categoryChoice === "" ? null : Number(categoryChoice);

  const breakdown = useMemo(
    () => recordBreakdown(header, cells, patientIds, dateIndex, categoryIndex),
    [header, cells, patientIds, dateIndex, categoryIndex],
  );
  const categoryLabel = categoryIndex === null ? null : (header[categoryIndex] ?? null);
  const hasColumns = breakdown.columnLabels.length > 0;
  // 月を列にした表のセルは「件数(患者数)」。患者数は小さく薄くして件数と見分け、単位は表の下の注釈に 1 回だけ書く。
  // 「患者数」を外すと件数だけにする(CSV も同じ)。
  const cell = (records: number, patients: number) =>
    records ? (
      <>
        {records}
        {showPatients && <span className="extract-breakdown__patients">({patients})</span>}
      </>
    ) : null;

  return (
    <div className="extract-breakdown__leaf">
      <div className="extract-breakdown__controls">
        <select aria-label="月別にする列" value={dateKey} onChange={(e) => setDateChoice(e.target.value)}>
          <option value="">月別にしない</option>
          {dateColumns.map((c) => (
            <option key={c.index} value={c.index}>
              {`${c.label}の月`}
            </option>
          ))}
        </select>
        <select aria-label="分類の列" value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)}>
          <option value="">分類しない</option>
          {categoryColumns.map((c) => (
            <option key={c.index} value={c.index}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="extract-checks__item">
          <input type="checkbox" checked={showPatients} onChange={(e) => setShowPatients(e.target.checked)} />
          患者数
        </label>
        <button
          type="button"
          disabled={cells.length === 0}
          onClick={() =>
            downloadBlob(recordBreakdownCsv(breakdown, showPatients), `breakdown_${today()}.csv`)
          }
        >
          内訳CSV
        </button>
      </div>
      <div className="extract-results__table-wrap">
        <table className="master-search__table extract-breakdown">
          <thead>
            <tr>
              <th>{breakdown.rowAxis}</th>
              {hasColumns ? (
                <>
                  {breakdown.columnLabels.map((label) => (
                    <th key={label} className="extract-breakdown__number">
                      {label}
                    </th>
                  ))}
                  <th className="extract-breakdown__number">計</th>
                </>
              ) : (
                <>
                  <th className="extract-breakdown__number">件数</th>
                  {showPatients && <th className="extract-breakdown__number">患者数</th>}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {breakdown.rowLabels.map((rowLabel, r) => (
              <tr key={rowLabel}>
                <td className="extract-breakdown__label">{rowLabel}</td>
                {hasColumns ? (
                  <>
                    {breakdown.columnLabels.map((label, c) => (
                      <td key={label} className="extract-breakdown__number">
                        {cell(breakdown.records[r][c], breakdown.patients[r][c])}
                      </td>
                    ))}
                    <td className="extract-breakdown__number">
                      {cell(breakdown.rowTotals[r].records, breakdown.rowTotals[r].patients)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="extract-breakdown__number">{breakdown.rowTotals[r].records}</td>
                    {showPatients && <td className="extract-breakdown__number">{breakdown.rowTotals[r].patients}</td>}
                  </>
                )}
              </tr>
            ))}
            {cells.length === 0 && (
              <tr>
                <td colSpan={hasColumns ? breakdown.columnLabels.length + 2 : showPatients ? 3 : 2} className="master-search__empty">
                  記録はありません
                </td>
              </tr>
            )}
            {cells.length > 0 && breakdown.rowLabels.length > 1 && (
              <tr className="extract-breakdown__total">
                <td>計</td>
                {hasColumns ? (
                  <>
                    {breakdown.columnTotals.map((total, c) => (
                      <td key={c} className="extract-breakdown__number">
                        {cell(total.records, total.patients)}
                      </td>
                    ))}
                    <td className="extract-breakdown__number">
                      {cell(breakdown.total.records, breakdown.total.patients)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="extract-breakdown__number">{breakdown.total.records}</td>
                    {showPatients && <td className="extract-breakdown__number">{breakdown.total.patients}</td>}
                  </>
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasColumns && showPatients && cells.length > 0 && (
        <p className="order-select__muted">
          各セルは 件数<span className="extract-breakdown__patients">(患者数)</span>
        </p>
      )}
      {categoryLabel && breakdown.rowLabels.includes("その他") && (
        <p className="order-select__muted">{`${categoryLabel}は件数の多い順に 30 個までを出し、残りは「その他」にまとめています。`}</p>
      )}
    </div>
  );
}
