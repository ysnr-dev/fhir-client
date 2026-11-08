import type { ReactNode } from "react";
import { encounterHistoryRows } from "../../fhir/encounterHistoryHelpers";
import { displayKana, displayName, genderLabel, patientNumberOf } from "../../fhir/patientHelpers";
import { today } from "../../lib/dates";
import { KartePrintColumnRow, KartePrintEmptyRow, KartePrintGroupRow, KartePrintSheet } from "./KartePrintSheet";

// カルテ印刷の表紙。誰の・いつからいつまでの・何を束ねた記録かと、期間内の入退院歴・受診歴。

const COLUMNS = ["区分", "期間", "状態", "診療科・担当医・場所", "主訴"];
const WIDTHS = ["8%", "30%", "10%", "34%", "18%"];

interface RecordExportCoverProps {
  header: ReactNode;
  facilityName: string;
  patient: fhir4.Patient;
  from: string;
  to: string;
  printedAt: string;
  printedBy: string;
  sectionLabels: string[];
  encounters: fhir4.Encounter[];
  appointments: fhir4.Appointment[];
}

export function RecordExportCover({
  header,
  facilityName,
  patient,
  from,
  to,
  printedAt,
  printedBy,
  sectionLabels,
  encounters,
  appointments,
}: RecordExportCoverProps) {
  const rows = encounterHistoryRows(encounters, appointments, today());
  const fields: [string, string][] = [
    ["医療機関", facilityName],
    ["患者番号", patientNumberOf(patient) ?? ""],
    ["氏名", displayName(patient)],
    ["カナ", displayKana(patient)],
    ["生年月日", patient.birthDate ?? ""],
    ["性別", genderLabel(patient.gender)],
    ["出力期間", `${from} 〜 ${to}`],
    ["出力日時", printedAt],
    ["出力者", printedBy],
    ["収録", sectionLabels.join("、")],
  ];
  return (
    <KartePrintSheet header={header} title="診療記録" span={COLUMNS.length} widths={WIDTHS}>
      <tr>
        <td colSpan={COLUMNS.length}>
          <dl className="karte-print__cover">
            {fields
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="karte-print__cover-field">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </td>
      </tr>
      <KartePrintGroupRow span={COLUMNS.length}>入退院歴・受診歴</KartePrintGroupRow>
      <KartePrintColumnRow columns={COLUMNS} />
      {rows.length === 0 ? (
        <KartePrintEmptyRow span={COLUMNS.length}>期間内の受診はありません。</KartePrintEmptyRow>
      ) : (
        rows.map((row) => (
          <tr key={row.id}>
            <td>{row.kindLabel}</td>
            <td>{row.period}</td>
            <td>{row.status}</td>
            <td>{row.meta}</td>
            <td>{row.note}</td>
          </tr>
        ))
      )}
    </KartePrintSheet>
  );
}
