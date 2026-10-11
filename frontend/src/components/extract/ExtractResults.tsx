import { useState } from "react";
import { Link } from "react-router-dom";
import { useTeamActiveRequestPatientIds, type ExtractResult } from "../../api/queries";
import { formatKarteOpen, KARTE_OPEN_PARAM } from "../../karteUrl";
import {
  extractBreakdown,
  leafCellText,
  leafOutputFieldsOf,
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  type ExtractOutput,
  leafBreakdown,
  type LeafBreakdownAxis,
  leafLabel,
  resultColumns,
  type ExtractLeaf,
} from "../../fhir/extractQueryHelpers";

type Tab = "list" | "breakdown";

/** 抽出の結果。一覧(患者 1 行)と内訳。 */
export function ExtractResults({
  result,
  leaves,
  output,
  teamId,
}: {
  result: ExtractResult;
  /** 出力項目を今の条件で反映した条件(実行し直さなくても出す列が変わる)。 */
  leaves: ExtractLeaf[];
  output: ExtractOutput | undefined;
  /**
   * 条件の持ち主がチームのとき(スクリーニング)、そのチームの id。一覧に「介入」の列
   * (介入中の印と、カルテをチーム依頼の登録で開くリンク)を足す(docs/care-team-design.md §5)。
   */
  teamId?: string;
}) {
  const [tab, setTab] = useState<Tab>("list");
  const tabs: { key: Tab; label: string }[] = [
    { key: "list", label: "一覧" },
    { key: "breakdown", label: "内訳" },
  ];
  return (
    <section className="extract-results">
      <div className="inpatient-tabs" role="tablist" aria-label="結果の表示切替">
        {tabs.map((item) => (
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
      {tab === "list" && <ResultTable result={result} leaves={leaves} output={output} teamId={teamId} />}
      {tab === "breakdown" && <BreakdownTable result={result} />}
    </section>
  );
}

function ResultTable({
  result,
  leaves,
  output,
  teamId,
}: {
  result: ExtractResult;
  leaves: ExtractLeaf[];
  output: ExtractOutput | undefined;
  teamId?: string;
}) {
  const columns: ExtractLeaf[] = resultColumns(leaves);
  const activePatients = useTeamActiveRequestPatientIds(teamId);
  const patientColumns = patientColumnsOf(output);
  return (
    <div className="extract-results__table-wrap">
      <table className="master-search__table extract-results__table">
        <thead>
          <tr>
            <th>患者番号</th>
            <th>氏名</th>
            {patientColumns.map((column) => (
              <th key={column}>{patientColumnLabel(column)}</th>
            ))}
            {columns.map((leaf) => (
              <th key={leaf.key}>{leafLabel(leaf)}</th>
            ))}
            {teamId && <th>介入</th>}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.patientId}>
              <td className="extract-results__nowrap">{row.patientNumber || "-"}</td>
              <td className="extract-results__nowrap">
                <Link to={`/patients/${row.patientId}/karte`}>{row.name || row.patientId}</Link>
              </td>
              {patientColumns.map((column) => (
                <td key={column} className={column === "address" ? undefined : "extract-results__nowrap"}>
                  {patientCell(row, column)}
                </td>
              ))}
              {columns.map((leaf) => (
                <td key={leaf.key}>{leafCellText(row.hits[leaf.key], leafOutputFieldsOf(leaf))}</td>
              ))}
              {teamId && (
                <td className="extract-results__nowrap">
                  {activePatients.data?.has(row.patientId) ? (
                    <span className="micro-result__badge micro-result__badge--muted">介入中</span>
                  ) : (
                    <Link
                      to={`/patients/${row.patientId}/karte?${KARTE_OPEN_PARAM}=${encodeURIComponent(formatKarteOpen({ kind: "team-request", teamId }))}`}
                    >
                      チーム依頼
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + patientColumns.length + 2 + (teamId ? 1 : 0)} className="master-search__empty">
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
