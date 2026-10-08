import { csvBlob } from "../lib/csv";
import { localDay } from "../lib/dates";
import {
  CATEGORY_LABELS,
  DISEASE_KEY_NUMBER_SYSTEM,
  conditionCategoryOf,
  outcomeDisplay,
  problemNumberOf,
} from "./conditionHelpers";
import {
  CLINICAL_STATUS_OPTIONS,
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { departmentOf } from "./orderHeader";
import { conceptLabel } from "./shared";

// 病名の抽出(docs/data-extract-design.md §20)。病名 1 件(Condition)を 1 行にし、開始日・転帰・区分・疑いと、
// 病名のコード(病名管理番号・ICD10・レセ電算)を列にする。

const ICD10_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/ICD10-2013-full";
const RECEIPT_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterB-disease";

export interface ConditionExtractRow extends ExtractPatientRow {
  rowKey: string;
  date: string;
  fixed: string[];
  values: string[];
}

const CONDITION_FIXED = ["開始日", "転帰日", "転帰", "区分", "プロブレム番号", "疑い", "登録日", "診療科"];
const CONDITION_VALUES = ["病名", "病名管理番号", "ICD10", "レセ電算コード"];

const STATUS_LABELS = new Map(CLINICAL_STATUS_OPTIONS.map((o) => [o.value as string, o.label]));

function codeOf(condition: fhir4.Condition, system: string): string {
  return condition.code?.coding?.find((c) => c.system === system)?.code ?? "";
}

/** 病名を表の行にする。行は日付(開始日か登録日)の新しい順。 */
export function conditionExtractRows(
  conditions: fhir4.Condition[],
  patients: Map<string, fhir4.Patient>,
  dateField: "onset" | "recorded",
): ConditionExtractRow[] {
  const rows = conditions.map((condition): ConditionExtractRow => {
    const patientId = condition.subject?.reference?.split("/").pop() ?? "";
    const status = condition.clinicalStatus?.coding?.[0]?.code ?? "";
    const onset = localDay(condition.onsetDateTime);
    const recorded = localDay(condition.recordedDate);
    const category = conditionCategoryOf(condition);
    const suspected = condition.verificationStatus?.coding?.some((c) => c.code === "provisional");
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: condition.id ?? "",
      date: (dateField === "recorded" ? recorded : onset) || onset || recorded,
      fixed: [
        onset,
        localDay(condition.abatementDateTime),
        outcomeDisplay(status) || STATUS_LABELS.get(status) || status,
        CATEGORY_LABELS[category],
        category === "billing" ? "" : String(problemNumberOf(condition) ?? ""),
        suspected ? "疑い" : "",
        recorded,
        departmentOf(condition).departmentName,
      ],
      values: [
        conceptLabel(condition.code),
        codeOf(condition, DISEASE_KEY_NUMBER_SYSTEM),
        codeOf(condition, ICD10_SYSTEM),
        codeOf(condition, RECEIPT_SYSTEM),
      ],
    };
  });
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
}

export function conditionExtractHeader(output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...CONDITION_FIXED,
    ...CONDITION_VALUES,
  ];
}

export function conditionExtractCsv(rows: ConditionExtractRow[], output: ExtractOutput | undefined): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    conditionExtractHeader(output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...row.values,
    ]),
  );
}
