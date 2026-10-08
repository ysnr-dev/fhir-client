import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RECORD_DISPLAY_LIMIT,
  patientCell,
  type ExtractPatientRow,
  type PatientColumn,
} from "../../fhir/extractQueryHelpers";
import { RecordBreakdownView } from "./RecordBreakdownView";

export interface RecordTableRow {
  key: string;
  patient: ExtractPatientRow;
  /** 固定列(折り返さない)の値。 */
  fixed: string[];
  /** 項目の列の値(長ければ折り返す)。 */
  values: string[];
}

interface Props {
  header: string[];
  patientColumns: PatientColumn[];
  rows: RecordTableRow[];
  emptyLabel: string;
}

type View = "list" | "breakdown";

const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "一覧" },
  { key: "breakdown", label: "内訳" },
];

/**
 * 記録を表にするタブの結果。「一覧」(表)と「内訳」(月別・分類ごとの件数と患者数。docs/data-extract-design.md §18)を
 * 切り替える。内訳は表と同じ見出しとセルから数えるので、タブごとの知識を持たない。
 */
export function RecordResultTable(props: Props) {
  const { header, patientColumns, rows } = props;
  const [view, setView] = useState<View>("list");
  // 内訳に渡すセル(見出しと同じ並び)。
  const cells = useMemo(
    () =>
      rows.map(({ patient, fixed, values }) => [
        patient.patientNumber,
        patient.name,
        ...patientColumns.map((column) => String(patientCell(patient, column) ?? "")),
        ...fixed,
        ...values,
      ]),
    [rows, patientColumns],
  );
  const patientIds = useMemo(() => rows.map((row) => row.patient.patientId), [rows]);
  return (
    <>
      <div className="inpatient-tabs" role="tablist" aria-label="結果の表示切替">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`inpatient-tabs__tab${view === item.key ? " is-active" : ""}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {view === "list" ? (
        <ListTable {...props} />
      ) : (
        <RecordBreakdownView header={header} cells={cells} patientIds={patientIds} />
      )}
    </>
  );
}

/** 患者番号・氏名(カルテへのリンク)・患者の列・固定列・項目の列の順に並べ、先頭 RECORD_DISPLAY_LIMIT 行だけを出す。 */
function ListTable({ header, patientColumns, rows, emptyLabel }: Props) {
  return (
    <div className="extract-results__table-wrap">
      <table className="master-search__table extract-results__table template-extract__table">
        <thead>
          <tr>
            {header.map((label, index) => (
              <th key={index}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, RECORD_DISPLAY_LIMIT).map(({ key, patient, fixed, values }) => (
            <tr key={key}>
              <td className="extract-results__nowrap">{patient.patientNumber || "-"}</td>
              <td className="extract-results__nowrap">
                <Link to={`/patients/${patient.patientId}/karte`}>{patient.name || patient.patientId}</Link>
              </td>
              {patientColumns.map((column) => (
                <td key={column} className={column === "address" ? undefined : "extract-results__nowrap"}>
                  {patientCell(patient, column)}
                </td>
              ))}
              {fixed.map((cell, index) => (
                <td key={`fixed-${index}`} className="extract-results__nowrap">
                  {cell}
                </td>
              ))}
              {values.map((value, index) => (
                <td key={`value-${index}`} title={value || undefined}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={header.length} className="master-search__empty">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
