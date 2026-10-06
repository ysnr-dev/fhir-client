import { useState } from "react";
import { Link } from "react-router-dom";
import type { ExtractQueryRun } from "../../api/masterClient";
import type { ExtractResult } from "../../api/queries";
import { dateTimeLabel } from "../../lib/dates";
import {
  extractBreakdown,
  leafBreakdown,
  type LeafBreakdownAxis,
  leafLabel,
  resultColumns,
  type ExtractLeaf,
  type LeafHit,
} from "../../fhir/extractQueryHelpers";

type Tab = "list" | "breakdown" | "history";

/**
 * 抽出の結果。一覧(患者 1 行)・内訳・履歴(保存した条件を直さずに実行した記録。保存していない
 * 条件や直した条件では出さない)。
 */
export function ExtractResults({ result, history }: { result: ExtractResult; history?: ExtractQueryRun[] }) {
  const [tab, setTab] = useState<Tab>("list");
  const tabs: { key: Tab; label: string }[] = [
    { key: "list", label: "一覧" },
    { key: "breakdown", label: "内訳" },
    ...(history ? [{ key: "history" as const, label: "履歴" }] : []),
  ];
  const current = tab === "history" && !history ? "list" : tab;
  return (
    <section className="extract-results">
      <div className="inpatient-tabs" role="tablist" aria-label="結果の表示切替">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={current === item.key}
            className={`inpatient-tabs__tab${current === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
        <span className="extract-results__count">{`該当 ${result.rows.length} 人`}</span>
      </div>
      {current === "list" && <ResultTable result={result} />}
      {current === "breakdown" && <BreakdownTable result={result} />}
      {current === "history" && history && <HistoryTable runs={history} leaves={result.leaves} />}
    </section>
  );
}

function hitText(hit: LeafHit | undefined): string {
  if (!hit) return "";
  const range = hit.first === hit.last ? hit.last : `${hit.first}〜${hit.last}`;
  return [`${hit.count}件`, range, hit.latest].filter(Boolean).join(" ");
}

function ResultTable({ result }: { result: ExtractResult }) {
  const columns: ExtractLeaf[] = resultColumns(result.leaves);
  return (
    <div className="extract-results__table-wrap">
      <table className="master-search__table extract-results__table">
        <thead>
          <tr>
            <th>患者番号</th>
            <th>氏名</th>
            <th>年齢</th>
            <th>性別</th>
            {columns.map((leaf) => (
              <th key={leaf.key}>{leafLabel(leaf)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.patientId}>
              <td className="extract-results__nowrap">{row.patientNumber || "-"}</td>
              <td className="extract-results__nowrap">
                <Link to={`/patients/${row.patientId}/karte`}>{row.name || row.patientId}</Link>
              </td>
              <td className="extract-results__nowrap">{row.age ?? "-"}</td>
              <td className="extract-results__nowrap">{row.gender}</td>
              {columns.map((leaf) => (
                <td key={leaf.key}>{hitText(row.hits[leaf.key])}</td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 4} className="master-search__empty">
                該当する患者はいません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownTable({ result }: { result: ExtractResult }) {
  const breakdown = extractBreakdown(result.rows);
  const columns = resultColumns(result.leaves);
  return (
    <>
      <table className="master-search__table extract-breakdown">
        <thead>
          <tr>
            <th>年齢</th>
            {breakdown.genders.map((gender) => (
              <th key={gender} className="extract-breakdown__number">
                {gender}
              </th>
            ))}
            <th className="extract-breakdown__number">計</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.bands.map((band) => (
            <tr key={band}>
              <td>{band}</td>
              {breakdown.genders.map((gender) => (
                <td key={gender} className="extract-breakdown__number">
                  {breakdown.cells[band]?.[gender] ?? 0}
                </td>
              ))}
              <td className="extract-breakdown__number">{breakdown.totalsByBand[band] ?? 0}</td>
            </tr>
          ))}
          <tr className="extract-breakdown__total">
            <td>計</td>
            {breakdown.genders.map((gender) => (
              <td key={gender} className="extract-breakdown__number">
                {breakdown.totalsByGender[gender] ?? 0}
              </td>
            ))}
            <td className="extract-breakdown__number">{breakdown.total}</td>
          </tr>
        </tbody>
      </table>
      {columns.length > 0 && <LeafBreakdownTable result={result} columns={columns} />}
      {columns.length > 0 && (
        <table className="master-search__table extract-breakdown">
          <thead>
            <tr>
              <th>条件</th>
              <th className="extract-breakdown__number">条件だけの該当</th>
              <th className="extract-breakdown__number">結果のうち</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((leaf) => (
              <tr key={leaf.key}>
                <td>{leafLabel(leaf)}</td>
                <td className="extract-breakdown__number">{result.hits.get(leaf.key)?.size ?? 0}</td>
                <td className="extract-breakdown__number">
                  {result.rows.filter((row) => row.hits[leaf.key]).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** 条件 1 つの記録を月別・診療科別に数える(結果の患者の記録だけ)。 */
function LeafBreakdownTable({ result, columns }: { result: ExtractResult; columns: ExtractLeaf[] }) {
  const [leafKey, setLeafKey] = useState(columns[0]?.key ?? "");
  const [axis, setAxis] = useState<LeafBreakdownAxis>("month");
  const leaf = columns.find((c) => c.key === leafKey) ?? columns[0];
  const patientIds = new Set(result.rows.map((row) => row.patientId));
  const rows = leaf ? leafBreakdown(result.records.get(leaf.key) ?? [], patientIds, axis) : [];
  const total = rows.reduce((sum, row) => sum + row.records, 0);
  // 患者数の計は行の和ではない(同じ患者が複数の月・科に出る)。
  const totalPatients = new Set(
    (leaf ? (result.records.get(leaf.key) ?? []) : []).filter((r) => patientIds.has(r.patientId)).map((r) => r.patientId),
  ).size;

  return (
    <div className="extract-breakdown__leaf">
      <div className="extract-breakdown__controls">
        <select aria-label="内訳の条件" value={leaf?.key ?? ""} onChange={(e) => setLeafKey(e.target.value)}>
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              {leafLabel(c)}
            </option>
          ))}
        </select>
        <span className="extract-group__ops" role="group" aria-label="内訳の切り口">
          {(
            [
              { value: "month", label: "月別" },
              { value: "department", label: "診療科別" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={axis === option.value}
              className={`extract-group__op${axis === option.value ? " is-active" : ""}`}
              onClick={() => setAxis(option.value)}
            >
              {option.label}
            </button>
          ))}
        </span>
      </div>
      <table className="master-search__table extract-breakdown">
        <thead>
          <tr>
            <th>{axis === "month" ? "月" : "診療科"}</th>
            <th className="extract-breakdown__number">件数</th>
            <th className="extract-breakdown__number">患者数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td className="extract-breakdown__number">{row.records}</td>
              <td className="extract-breakdown__number">{row.patients}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                記録はありません
              </td>
            </tr>
          )}
          {rows.length > 0 && (
            <tr className="extract-breakdown__total">
              <td>計</td>
              <td className="extract-breakdown__number">{total}</td>
              <td className="extract-breakdown__number">{totalPatients}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 実行の記録(新しい順)。条件ごとの人数は今の条件の並びで出す(後から足した条件は前の記録では空)。 */
function HistoryTable({ runs, leaves }: { runs: ExtractQueryRun[]; leaves: ExtractLeaf[] }) {
  return (
    <div className="extract-results__table-wrap">
      <table className="master-search__table extract-breakdown extract-history">
        <thead>
          <tr>
            <th>実行日時</th>
            <th className="extract-breakdown__number">該当</th>
            {leaves.map((leaf) => (
              <th key={leaf.key} className="extract-breakdown__number">
                {leafLabel(leaf)}
              </th>
            ))}
            <th>実行者</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="extract-results__nowrap">{dateTimeLabel(run.ran_at)}</td>
              <td className="extract-breakdown__number">{run.patient_count}</td>
              {leaves.map((leaf) => (
                <td key={leaf.key} className="extract-breakdown__number">
                  {run.leaf_counts[leaf.key] ?? ""}
                </td>
              ))}
              <td className="extract-results__nowrap">{run.ran_by_name ?? ""}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={leaves.length + 3} className="master-search__empty">
                記録はありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
