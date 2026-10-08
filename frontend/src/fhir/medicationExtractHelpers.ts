import { csvBlob } from "../lib/csv";
import { dateTimeLabel, localDay } from "../lib/dates";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { ORDER_TYPE_SYSTEM, departmentOf } from "./orderHeader";
import { PRESCRIPTION_CATEGORY_SYSTEM, SETTING_SYSTEM, groupByRp } from "./prescriptionHelpers";
import { categoryCoding, findSettingDisplay } from "./shared";

// 投薬の抽出(docs/data-extract-design.md §15)。処方・注射のオーダーの薬剤 1 件(MedicationRequest)を 1 行にし、
// オーダーの区分・日付・依頼科と、薬剤・用量・用法・日数を列にする。用法・用量の読み方は処方の表示と同じ(groupByRp)。

export interface MedicationExtractRow extends ExtractPatientRow {
  rowKey: string;
  authoredOn: string;
  /** 折り返さない列(MEDICATION_FIXED_HEADERS と同じ並び)。 */
  fixed: string[];
  /** 折り返す列(MEDICATION_VALUE_HEADERS と同じ並び)。 */
  values: string[];
}

const MEDICATION_FIXED_HEADERS = ["オーダー日", "開始日", "区分", "処方区分", "入外", "依頼科", "依頼者", "状態", "RP"];
const MEDICATION_VALUE_HEADERS = ["薬剤", "薬剤コード", "YJコード", "一般名処方", "用量", "用法", "日数・回数", "補足", "コメント"];

const STATUS_LABELS: Record<string, string> = {
  active: "有効",
  completed: "終了",
  stopped: "中止",
  "on-hold": "保留",
  draft: "下書き",
};

function headerIdOf(request: fhir4.MedicationRequest): string {
  const reference = request.basedOn?.find((r) => r.reference?.startsWith("ServiceRequest/"))?.reference ?? "";
  return reference.slice("ServiceRequest/".length);
}

/** オーダーの薬剤を表の行にする。行はオーダー日の新しい順、同じオーダーは RP の順。 */
export function medicationExtractRows(
  requests: fhir4.MedicationRequest[],
  headers: Map<string, fhir4.ServiceRequest>,
  patients: Map<string, fhir4.Patient>,
): MedicationExtractRow[] {
  const rows = requests.map((request) => {
    const [rp] = groupByRp([request]);
    const medicine = rp?.medicines[0];
    const header = headers.get(headerIdOf(request));
    const setting = header ? categoryCoding(header, SETTING_SYSTEM) : undefined;
    const dosage = request.dosageInstruction?.[0];
    const patientId = request.subject?.reference?.split("/").pop() ?? "";
    const days = rp?.doseDays ? `${rp.doseDays}日` : rp?.doseCount ? `${rp.doseCount}回` : "";
    const dose = medicine?.unevenLabel || (medicine?.dose != null ? `${medicine.dose}${medicine.unit ?? ""}` : "");
    const rpLabel = rp?.rpNumber ? `${rp.rpNumber}-${medicine?.orderInRp ?? ""}` : "";
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: request.id ?? "",
      authoredOn: request.authoredOn ?? "",
      sortKey: `${header?.id ?? ""}|${String(rp?.rpNumber ?? 0).padStart(3, "0")}|${String(medicine?.orderInRp ?? 0).padStart(3, "0")}`,
      fixed: [
        dateTimeLabel(request.authoredOn).slice(0, 10),
        localDay(header?.occurrenceDateTime ?? header?.occurrencePeriod?.start),
        header ? (categoryCoding(header, ORDER_TYPE_SYSTEM)?.display ?? "") : "",
        header ? (categoryCoding(header, PRESCRIPTION_CATEGORY_SYSTEM)?.display ?? "") : "",
        setting ? (setting.display ?? findSettingDisplay(setting.code ?? "")) : "",
        departmentOf(request).departmentName || (header ? departmentOf(header).departmentName : ""),
        request.requester?.display ?? "",
        STATUS_LABELS[request.status] ?? request.status,
        rpLabel,
      ],
      values: [
        medicine?.name ?? "",
        medicine?.code ?? "",
        medicine?.yjCode ?? "",
        medicine?.generic ? "○" : "",
        dose,
        rp?.usageName || dosage?.text || "",
        days,
        [rp?.supplementLabel, rp?.usageComment].filter(Boolean).join(" "),
        medicine?.comment ?? "",
      ],
    };
  });
  rows.sort(
    (a, b) =>
      b.authoredOn.localeCompare(a.authoredOn) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }) ||
      a.sortKey.localeCompare(b.sortKey),
  );
  return rows.map(({ sortKey: _sortKey, ...row }) => row);
}

export function medicationExtractHeader(output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...MEDICATION_FIXED_HEADERS,
    ...MEDICATION_VALUE_HEADERS,
  ];
}

export function medicationExtractCsv(rows: MedicationExtractRow[], output: ExtractOutput | undefined): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    medicationExtractHeader(output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...row.values,
    ]),
  );
}
