import { Fragment } from "react";
import type { OverviewColumn, OverviewRow, OverviewRows, OverviewTaskRow } from "../fhir/pathwayHelpers";

// パス定義の概要表。列 = 病日(分けた日はステップごと)、行 = アウトカムと大分類ごとのタスク。
// 行は識別子でまとめるので、1 行 = 1 つの続き(日をまたぐアウトカム・継続するタスク)。
// セルを押すと、その病日に続きを足す(近い日の内容を写す)か外す。タスクはそのアウトカムが
// 載っている日にしか足せない。中身の編集は病日カードで行う。
export function PathwayOverviewTable({
  rows,
  canAddTask,
  onToggleOutcome,
  onToggleTask,
  onLinkSameNames,
}: {
  rows: OverviewRows;
  /** 名前が同じで識別子が別々のアウトカムを続きにまとめる。まとめるものが無ければ null(ボタンを出さない)。 */
  onLinkSameNames: (() => void) | null;
  canAddTask: (row: OverviewTaskRow, column: OverviewColumn) => boolean;
  onToggleOutcome: (row: OverviewRow, column: OverviewColumn) => void;
  onToggleTask: (row: OverviewTaskRow, column: OverviewColumn) => void;
}) {
  if (rows.columns.length === 0) return null;

  function renderRow<R extends OverviewRow>(
    key: string,
    row: R,
    onToggle: (row: R, column: OverviewColumn) => void,
    canAdd: (row: R, column: OverviewColumn) => boolean,
  ) {
    return (
      <tr key={key}>
        <td
          className={`regimen-day-table__label${row.critical ? " pathway-overview__label--critical" : ""}`}
          title={row.label}
        >
          {row.label}
        </td>
        {rows.columns.map((column) => {
          const on = row.eventKeys.has(column.eventKey);
          const day = column.stepLabel ? `病日 ${column.day} ${column.stepLabel}` : `病日 ${column.day}`;
          return (
            <td
              key={column.eventKey}
              className={`regimen-day-table__day pathway-overview__cell${on ? " regimen-day-table__day--on" : ""}`}
            >
              <button
                type="button"
                className="pathway-overview__toggle"
                onClick={() => onToggle(row, column)}
                disabled={!on && !canAdd(row, column)}
                aria-pressed={on}
                aria-label={`${row.label} ${day}`}
              >
                {on ? "●" : ""}
              </button>
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>概要表</h3>
        {onLinkSameNames && (
          <button type="button" onClick={onLinkSameNames}>
            同じ名前を続きにまとめる
          </button>
        )}
      </div>
      <div className="pathway-overview__wrap">
        <table className="master-search__table regimen-day-table pathway-overview">
          <thead>
            <tr>
              <th></th>
              {rows.columns.map((column) => (
                <th key={column.eventKey} className="regimen-day-table__day pathway-overview__day">
                  <span>{column.day}</span>
                  <small>{column.label}</small>
                  {column.stepLabel && <small>{column.stepLabel}</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.outcomes.length > 0 && (
              <tr className="pathway-overview__group">
                <td colSpan={rows.columns.length + 1}>アウトカム</td>
              </tr>
            )}
            {rows.outcomes.map((row) => renderRow(`o:${row.seriesKey}`, row, onToggleOutcome, () => true))}
            {rows.taskGroups.map((group) => (
              <Fragment key={group.lv1}>
                <tr className="pathway-overview__group">
                  <td colSpan={rows.columns.length + 1}>{group.label}</td>
                </tr>
                {group.rows.map((row) => renderRow(`t:${row.seriesKey}`, row, onToggleTask, canAddTask))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
