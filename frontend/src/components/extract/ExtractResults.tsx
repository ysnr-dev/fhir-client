import { useState } from "react";
import { Link } from "react-router-dom";
import type { ExtractResult } from "../../api/queries";
import {
  extractBreakdown,
  leafLabel,
  resultColumns,
  type ExtractLeaf,
  type LeafHit,
} from "../../fhir/extractQueryHelpers";

type Tab = "list" | "breakdown";

/** 抽出の結果。一覧(患者 1 行)と内訳(性別 × 年齢階級)。 */
export function ExtractResults({ result }: { result: ExtractResult }) {
  const [tab, setTab] = useState<Tab>("list");
  return (
    <section className="extract-results">
      <div className="inpatient-tabs" role="tablist" aria-label="結果の表示切替">
        {(
          [
            { key: "list", label: "一覧" },
            { key: "breakdown", label: "内訳" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`inpatient-tabs__tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
        <span className="extract-results__count">{`該当 ${result.rows.length} 人`}</span>
      </div>
      {tab === "list" ? <ResultTable result={result} /> : <BreakdownTable result={result} />}
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
