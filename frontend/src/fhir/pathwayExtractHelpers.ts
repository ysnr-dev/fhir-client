import { csvBlob } from "../lib/csv";
import { diffDays, localDay } from "../lib/dates";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { PATHWAY_APPLY_ID_SYSTEM, PATHWAY_EXT, pathwayCodeOf } from "./pathwayApplyHelpers";
import {
  PATHWAY_APPLY_GOAL_ID_SYSTEM,
  PATHWAY_CLOSING_TYPE_EXT,
  closingTypeLabel,
  pathwayCloseValuesOf,
} from "./pathwayCloseHelpers";
import { ACHIEVEMENT_SYSTEM, PATHWAY_OUTCOME_GOAL_ID_SYSTEM } from "./pathwayEvaluationHelpers";
import { pathwayStatusLabel } from "./pathwaySheetHelpers";

// クリニカルパスの適用の抽出(docs/data-extract-design.md §14)。適用 1 件(CarePlan の木の根)を 1 行にし、
// 期間・日数・入院・終了区分と、アウトカムの評価(達成・バリアンス)の件数とバリアンスの内容を列にする。

export interface PathwayExtractRow extends ExtractPatientRow {
  rowKey: string;
  start: string;
  /** 折り返さない列(PATHWAY_FIXED_HEADERS と同じ並び)。 */
  fixed: string[];
  /** 折り返す列(PATHWAY_VALUE_HEADERS と同じ並び)。 */
  values: string[];
}

const PATHWAY_FIXED_HEADERS = [
  "適用日",
  "終了日",
  "状態",
  "終了区分",
  "予定日数",
  "実日数",
  "予定との差",
  "入院日",
  "退院日",
  "診療科",
  "評価",
  "達成",
  "バリアンス",
  "未評価",
];
const PATHWAY_VALUE_HEADERS = ["パス", "パスコード", "バリアンスの内容", "中止理由", "総合評価"];

function achievementOf(goal: fhir4.Goal): string {
  return goal.achievementStatus?.coding?.find((c) => c.system === ACHIEVEMENT_SYSTEM)?.code ?? "";
}

function identifierOf(goal: fhir4.Goal, system: string): string {
  return goal.identifier?.find((i) => i.system === system)?.value ?? "";
}

/** 開始日から終了日(無ければ今日)までの日数(両端を含む)。 */
function daysBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  return diffDays(start, end) + 1;
}

/** 適用を表の行にする。行は適用日の新しい順。 */
export function pathwayExtractRows(
  applications: fhir4.CarePlan[],
  encounters: Map<string, fhir4.Encounter>,
  goals: fhir4.Goal[],
  patients: Map<string, fhir4.Patient>,
  today: string,
): PathwayExtractRow[] {
  const applyGoals = new Map<string, fhir4.Goal>();
  const outcomeGoals: { applyPrefix: string; goal: fhir4.Goal }[] = [];
  for (const goal of goals) {
    const applyId = identifierOf(goal, PATHWAY_APPLY_GOAL_ID_SYSTEM);
    if (applyId) applyGoals.set(applyId, goal);
    const unitId = identifierOf(goal, PATHWAY_OUTCOME_GOAL_ID_SYSTEM);
    if (unitId) outcomeGoals.push({ applyPrefix: unitId, goal });
  }

  const rows = applications.map((application): PathwayExtractRow => {
    const applyId = application.identifier?.find((i) => i.system === PATHWAY_APPLY_ID_SYSTEM)?.value ?? "";
    // アウトカムの識別子は「適用の識別子.病日.OAT ユニット」なので、前半で適用に結ぶ。
    const outcomes = applyId
      ? outcomeGoals.filter((o) => o.applyPrefix.startsWith(`${applyId}.`)).map((o) => o.goal)
      : [];
    const evaluated = outcomes.filter((g) => achievementOf(g));
    const variances = evaluated
      .filter((g) => achievementOf(g) === "2")
      .sort((a, b) => (a.statusDate ?? "").localeCompare(b.statusDate ?? ""));
    const applyGoal = applyGoals.get(applyId);
    const close = pathwayCloseValuesOf(application, applyGoal);
    const closed = application.status === "completed" || application.status === "revoked";
    const closingCode =
      applyGoal?.extension?.find((e) => e.url === PATHWAY_CLOSING_TYPE_EXT)?.valueCodeableConcept?.coding?.[0]?.code ??
      "";

    const start = localDay(application.period?.start);
    const end = localDay(application.period?.end);
    const scheduled = application.extension?.find((e) => e.url === PATHWAY_EXT.scheduledDays)?.valueInteger;
    const actual = daysBetween(start, end || today);
    const encounterId = application.encounter?.reference?.split("/").pop() ?? "";
    const encounter = encounters.get(encounterId);
    const patientId = application.subject?.reference?.split("/").pop() ?? "";
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: application.id ?? applyId,
      start,
      fixed: [
        start,
        end,
        pathwayStatusLabel(application.status),
        closed ? closingTypeLabel(closingCode || (application.status === "revoked" ? "2" : "1")) : "",
        scheduled === undefined ? "" : String(scheduled),
        actual === null ? "" : String(actual),
        closed && actual !== null && scheduled !== undefined ? String(actual - scheduled) : "",
        localDay(encounter?.period?.start),
        localDay(encounter?.period?.end),
        encounter?.serviceProvider?.display ?? "",
        String(evaluated.length),
        String(evaluated.filter((g) => achievementOf(g) === "1").length),
        String(variances.length),
        String(evaluated.filter((g) => achievementOf(g) === "3").length),
      ],
      values: [
        application.title ?? "",
        pathwayCodeOf(application),
        variances.map((g) => `${g.statusDate ?? ""} ${g.description?.text ?? ""}`.trim()).join("、"),
        closed ? close.reason : "",
        closed ? close.comment : "",
      ],
    };
  });
  return rows.sort(
    (a, b) =>
      b.start.localeCompare(a.start) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
}

export function pathwayExtractHeader(output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...PATHWAY_FIXED_HEADERS,
    ...PATHWAY_VALUE_HEADERS,
  ];
}

export function pathwayExtractCsv(rows: PathwayExtractRow[], output: ExtractOutput | undefined): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    pathwayExtractHeader(output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...row.values,
    ]),
  );
}
