import { dateTimeLabel } from "../lib/dates";
import { patientColumnLabel, patientColumnsOf, patientRowOf, type ExtractOutput, type ExtractPatientRow } from "./extractQueryHelpers";
import { taskInputOf, taskPatientId } from "./notificationHelpers";
import {
  interventionOutcomeDisplay,
  RX_VERIFICATION_RESULT_OPTIONS,
  rxVerificationResultOf,
  rxVerificationSummaryOf,
  type RxVerificationOrderKind,
} from "./rxVerificationHelpers";

// 薬剤師介入(処方監査の記録)の抽出(docs/rx-verification-design.md §4.2)。監査 1 件を 1 行にし、監査日・
// 結果・介入種別・処方医の対応・内容と、元の処方・注射の要約を列にする。介入種別が複数なら 1 つのセルに「、」で
// 並べる(1 監査 = 1 行。種別ごとに数えるときは内訳の「複数値を分ける」で分ける)。

export interface InterventionExtractFilter {
  /** intervened は介入ありだけ(既定)、all は問題なしも含める。 */
  result: "intervened" | "all";
  orderKind?: RxVerificationOrderKind;
  /** 介入種別のコード。どれか 1 つを含む監査を残す。空なら絞らない。 */
  types: string[];
  /** 依頼科(Organization.id)。 */
  departmentId?: string;
}

export interface InterventionExtractRow extends ExtractPatientRow {
  rowKey: string;
  verifiedAt: string;
  fixed: string[];
  values: string[];
}

const FIXED_HEADERS = ["監査日時", "種別", "処方日", "入外", "依頼科", "処方医", "監査者", "監査結果"];
const VALUE_HEADERS = ["介入種別", "処方医の対応", "介入内容", "薬剤"];

function departmentIdOf(task: fhir4.Task): string {
  return taskInputOf(task, "診療科")?.valueReference?.reference?.split("/").pop() ?? "";
}

export function interventionExtractRows(
  tasks: fhir4.Task[],
  patients: Map<string, fhir4.Patient>,
  filter: InterventionExtractFilter,
): InterventionExtractRow[] {
  const rows: InterventionExtractRow[] = [];
  for (const task of tasks) {
    const result = rxVerificationResultOf(task);
    if (!result) continue;
    if (filter.result === "intervened" && result.result !== "intervened") continue;
    const summary = rxVerificationSummaryOf(task);
    if (filter.orderKind && summary.kind !== filter.orderKind) continue;
    if (filter.types.length > 0 && !result.types.some((t) => filter.types.includes(t.code))) continue;
    if (filter.departmentId && departmentIdOf(task) !== filter.departmentId) continue;
    const patientId = taskPatientId(task);
    rows.push({
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: task.id ?? `${rows.length}`,
      verifiedAt: summary.verifiedAt,
      fixed: [
        dateTimeLabel(summary.verifiedAt),
        summary.kind === "injection" ? "注射" : "処方",
        summary.orderDate,
        summary.setting,
        summary.departmentName,
        summary.requesterName,
        summary.verifierName,
        RX_VERIFICATION_RESULT_OPTIONS.find((o) => o.code === result.result)?.display ?? "",
      ],
      values: [
        result.types.map((t) => t.name).join("、"),
        interventionOutcomeDisplay(result.outcome),
        result.content,
        summary.medicines.join("、"),
      ],
    });
  }
  rows.sort(
    (a, b) =>
      b.verifiedAt.localeCompare(a.verifiedAt) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
  return rows;
}

export function interventionExtractHeader(output: ExtractOutput | undefined): string[] {
  return ["患者番号", "氏名", ...patientColumnsOf(output).map(patientColumnLabel), ...FIXED_HEADERS, ...VALUE_HEADERS];
}
