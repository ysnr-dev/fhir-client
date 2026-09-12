import { Fragment } from "react";
import type { OverviewRows } from "../fhir/pathwayHelpers";

// パス定義の概要表(読み取り専用)。列 = 病日、行 = アウトカムと大分類ごとのタスク。
// どの日に何が載るかを面で読むためのもので、編集は病日カードで行う。
export function PathwayOverviewTable({ rows }: { rows: OverviewRows }) {
  if (rows.days.length === 0) return null;

  function renderRow(key: string, row: { label: string; days: Set<number>; critical: boolean }) {
    return (
      <tr key={key}>
        <td className={`regimen-day-table__label${row.critical ? " pathway-overview__label--critical" : ""}`}>
          {row.label}
        </td>
        {rows.days.map((d) => (
          <td
            key={d.day}
            className={`regimen-day-table__day${row.days.has(d.day) ? " regimen-day-table__day--on" : ""}`}
          >
            {row.days.has(d.day) ? "●" : ""}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>概要表</h3>
      </div>
      <div className="pathway-overview__wrap">
        <table className="master-search__table regimen-day-table pathway-overview">
          <thead>
            <tr>
              <th></th>
              {rows.days.map((d) => (
                <th key={d.day} className="regimen-day-table__day pathway-overview__day">
                  <span>{d.day}</span>
                  <small>{d.label}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.outcomes.length > 0 && (
              <tr className="pathway-overview__group">
                <td colSpan={rows.days.length + 1}>アウトカム</td>
              </tr>
            )}
            {rows.outcomes.map((row) => renderRow(`o:${row.label}`, row))}
            {rows.taskGroups.map((group) => (
              <Fragment key={group.lv1}>
                <tr className="pathway-overview__group">
                  <td colSpan={rows.days.length + 1}>{group.label}</td>
                </tr>
                {group.rows.map((row) => renderRow(`t:${group.lv1}:${row.label}`, row))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
