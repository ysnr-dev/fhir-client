import { csvBlob } from "../lib/csv";
import { diffDays } from "../lib/dates";
import { parseAdverseEvent, type AdverseEventRecord, type TreatmentType } from "./adverseEventHelpers";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";

// 有害事象の抽出(docs/data-extract-design.md §12)。有害事象の記録を「1 件 = 1 行」か、
// 「患者 × 治療 = 1 行、用語 = 列(最大 Grade)」の表にする。

export type AdverseEventRowMode = "event" | "treatment";

export const ADVERSE_EVENT_ROW_MODES: { value: AdverseEventRowMode; label: string }[] = [
  { value: "event", label: "1 件ごと" },
  { value: "treatment", label: "患者・治療ごと" },
];

export const TREATMENT_TYPE_OPTIONS: { value: TreatmentType; label: string }[] = [
  { value: "chemo-regimen", label: "化学療法" },
  { value: "radiotherapy", label: "放射線治療" },
];

function treatmentTypeLabel(type: TreatmentType): string {
  return TREATMENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export interface AdverseEventExtractTable {
  header: string[];
  /** 折り返さない列の数(患者の列の後ろ)。 */
  fixedCount: number;
  rows: { key: string; patient: ExtractPatientRow; cells: string[] }[];
}

const EVENT_HEADERS = ["発現日", "回復日", "持続日数", "治療の種別", "治療", "クール", "用語", "Grade", "記録者", "メモ"];
const EVENT_FIXED = 8;
const TREATMENT_HEADERS = ["治療の種別", "治療", "最初の発現日", "件数", "最大Grade", "Grade3以上"];

interface Parsed {
  record: AdverseEventRecord;
  patient: ExtractPatientRow;
}

function parseAll(observations: fhir4.Observation[], patients: Map<string, fhir4.Patient>): Parsed[] {
  return observations.flatMap((observation) => {
    const record = parseAdverseEvent(observation);
    if (!record) return [];
    const patientId = observation.subject?.reference?.split("/").pop() ?? "";
    return [{ record, patient: patientRowOf(patientId, patients.get(patientId)) }];
  });
}

/** 有害事象を表にする。1 件ごとは発現日の新しい順、患者・治療ごとは患者番号 → 最初の発現日の順。 */
export function adverseEventExtractTable(
  observations: fhir4.Observation[],
  patients: Map<string, fhir4.Patient>,
  mode: AdverseEventRowMode,
): AdverseEventExtractTable {
  const parsed = parseAll(observations, patients);
  const byPatientNumber = (a: ExtractPatientRow, b: ExtractPatientRow) =>
    a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true });

  if (mode === "event") {
    const rows = parsed
      .sort((a, b) => b.record.onset.localeCompare(a.record.onset) || byPatientNumber(a.patient, b.patient))
      .map(({ record, patient }) => ({
        key: record.id,
        patient,
        cells: [
          record.onset,
          record.resolved || "継続中",
          record.resolved ? String(diffDays(record.onset, record.resolved) + 1) : "",
          treatmentTypeLabel(record.treatmentType),
          record.treatmentName,
          record.cycle === undefined ? "" : String(record.cycle),
          record.term,
          String(record.grade),
          record.performer?.display ?? "",
          record.note,
        ],
      }));
    return { header: EVENT_HEADERS, fixedCount: EVENT_FIXED, rows };
  }

  // 用語の列は、記録の多い順(同数は名前の順)に並べる。
  const termCounts = new Map<string, number>();
  for (const { record } of parsed) termCounts.set(record.term, (termCounts.get(record.term) ?? 0) + 1);
  const terms = [...termCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([term]) => term);

  const groups = new Map<string, Parsed[]>();
  for (const item of parsed) {
    const key = `${item.patient.patientId}|${item.record.treatmentSrId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const rows = [...groups].map(([key, items]) => {
    const { record, patient } = items[0];
    const maxGrade = (list: Parsed[]) => Math.max(...list.map((i) => i.record.grade));
    const firstOnset = items.map((i) => i.record.onset).sort()[0] ?? "";
    return {
      key,
      patient,
      firstOnset,
      cells: [
        treatmentTypeLabel(record.treatmentType),
        record.treatmentName,
        firstOnset,
        String(items.length),
        String(maxGrade(items)),
        String(items.filter((i) => i.record.grade >= 3).length),
        ...terms.map((term) => {
          const matched = items.filter((i) => i.record.term === term);
          return matched.length ? String(maxGrade(matched)) : "";
        }),
      ],
    };
  });
  rows.sort((a, b) => byPatientNumber(a.patient, b.patient) || a.firstOnset.localeCompare(b.firstOnset));
  return {
    header: [...TREATMENT_HEADERS, ...terms],
    fixedCount: TREATMENT_HEADERS.length,
    rows: rows.map(({ key, patient, cells }) => ({ key, patient, cells })),
  };
}

export function adverseEventExtractHeader(table: AdverseEventExtractTable, output: ExtractOutput | undefined): string[] {
  return ["患者番号", "氏名", ...patientColumnsOf(output).map(patientColumnLabel), ...table.header];
}

export function adverseEventExtractCsv(table: AdverseEventExtractTable, output: ExtractOutput | undefined): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    adverseEventExtractHeader(table, output),
    table.rows.map(({ patient, cells }) => [
      patient.patientNumber,
      patient.name,
      ...patientColumns.map((column) => patientCell(patient, column)),
      ...cells,
    ]),
  );
}
