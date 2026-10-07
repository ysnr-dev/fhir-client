import { Link } from "react-router-dom";
import {
  RECORD_DISPLAY_LIMIT,
  patientCell,
  type ExtractPatientRow,
  type PatientColumn,
} from "../../fhir/extractQueryHelpers";

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

/**
 * 記録を表にするタブ(テンプレート・検査結果・細菌検査)の結果の表。患者番号・氏名(カルテへのリンク)・
 * 患者の列・固定列・項目の列の順に並べ、先頭 RECORD_DISPLAY_LIMIT 行だけを出す。
 */
export function RecordResultTable({ header, patientColumns, rows, emptyLabel }: Props) {
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
