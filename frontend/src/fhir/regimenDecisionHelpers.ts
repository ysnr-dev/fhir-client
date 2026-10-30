import { nowFhirDateTime } from "../lib/dates";
import { latestOf, taskInputOf } from "./notificationHelpers";
import type { LabCriterionCheck } from "./regimenCheckHelpers";
import { cycleDayLabel, regimenOrderOf } from "./regimenOrderHelpers";
import { orderDay, referenceId } from "./shared";
import { TASK_CODE_SYSTEM } from "./taskHelpers";

// 化学療法の当日の投与可否確認(docs/chemo-regimen-design.md §8.18)。
//
//   ServiceRequest(日オーダー) ← focus ── Task chemo-go(completed = 実施可 / cancelled = 取消)
//
// 投与日の検査値・体調を見て医師が「実施可」を記録し、化学療法室・薬剤部はそれを見て
// 投与・調製に進む。日オーダー 1 件に Task 1 件で、確認し直すときは同じ Task を書き直す。
// 確認した時点のオーダーの版を input に残し、その後にオーダーが変わった(移動・編集)なら
// 確認は無効として扱う(確認したのは変わる前の内容と日付だから)。
// 見合わせ(No-go)は Task にしない。延期は投与日の移動、取りやめは中止で記録する。

export const REGIMEN_DECISION_TASK_CODE = { code: "chemo-go", display: "投与可否" };

const INPUT = {
  date: "投与日",
  version: "オーダー版",
  regimen: "レジメン",
} as const;

const OUTPUT = { check: "投与前チェック" } as const;

export function isRegimenDecisionTask(task: fhir4.Task): boolean {
  return Boolean(
    task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === REGIMEN_DECISION_TASK_CODE.code),
  );
}

/** オーダーの id → 投与可否の Task。複数あれば最後に書いたもの。 */
export function regimenDecisionsByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const result = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    if (!isRegimenDecisionTask(task)) continue;
    const orderId = referenceId(task.focus?.reference);
    if (!orderId) continue;
    const current = result.get(orderId);
    if (!current || (task.lastModified ?? "") > (current.lastModified ?? "")) result.set(orderId, task);
  }
  return result;
}

/**
 * 日オーダーの投与可否。
 *   go       … 実施可(確認後にオーダーが変わっていない)
 *   stale    … 実施可にした後でオーダーが移動・編集された(確認し直す)
 *   pending  … まだ確認していない(取り消した後も含む)
 */
export type RegimenDecisionState = "go" | "stale" | "pending";

export interface RegimenDecision {
  state: RegimenDecisionState;
  /** 確認した日時と医師。pending では空。 */
  decidedAt: string;
  decidedBy: string;
  comment: string;
}

const PENDING: RegimenDecision = { state: "pending", decidedAt: "", decidedBy: "", comment: "" };

export function regimenDecisionOf(task: fhir4.Task | undefined, order: fhir4.ServiceRequest): RegimenDecision {
  if (!task || task.status !== "completed") return PENDING;
  const version = taskInputOf(task, INPUT.version)?.valueString;
  const date = taskInputOf(task, INPUT.date)?.valueDate;
  const current = order.meta?.versionId;
  // 版が読めない環境では日付だけで見る(移動は検出できる)。
  const unchanged = version && current ? version === current : date === orderDay(order);
  return {
    state: unchanged ? "go" : "stale",
    decidedAt: task.executionPeriod?.end ?? task.lastModified ?? "",
    decidedBy: task.owner?.display ?? "",
    comment: task.note?.[0]?.text ?? "",
  };
}

export const REGIMEN_DECISION_LABELS: Record<RegimenDecisionState, string> = {
  go: "実施可",
  stale: "要再確認",
  pending: "未確認",
};

/** 投与前チェック 1 行を、確認した時点の記録として残す文字列にする。 */
function checkLine(check: LabCriterionCheck): string {
  const value = check.value !== null ? `${check.value}${check.unit ? ` ${check.unit}` : ""}` : "—";
  const verdict = check.status === "out" ? "基準外" : check.status === "ok" ? "適合" : check.note || "判定なし";
  const date = check.date ? ` ${check.date}` : "";
  return `${check.criterion.item_name} ${value}(${check.range})${date} ${verdict}`;
}

/** 実施可にした Task。既存があれば書き直す(確認し直し)。 */
export function buildRegimenDecisionTask(
  order: fhir4.ServiceRequest,
  existing: fhir4.Task | undefined,
  actor: { practitionerId: string; display: string },
  detail: { comment: string; checks: LabCriterionCheck[] },
): fhir4.Task {
  const now = latestOf(nowFhirDateTime(), existing?.authoredOn);
  const ref = regimenOrderOf(order);
  const patientId = referenceId(order.subject?.reference) ?? "";
  const author = { reference: `Practitioner/${actor.practitionerId}`, display: actor.display };
  const task: fhir4.Task = {
    ...(existing ?? {}),
    resourceType: "Task",
    status: "completed",
    intent: "order",
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...REGIMEN_DECISION_TASK_CODE }],
      text: REGIMEN_DECISION_TASK_CODE.display,
    },
    focus: { reference: `ServiceRequest/${order.id}` },
    basedOn: [{ reference: `ServiceRequest/${order.id}` }],
    for: { reference: `Patient/${patientId}` },
    description: ref ? `${ref.name} ${cycleDayLabel(ref)} 実施可` : "実施可",
    authoredOn: existing?.authoredOn ?? now,
    lastModified: now,
    executionPeriod: { start: now, end: now },
    owner: author,
    input: [
      { type: { text: INPUT.date }, valueDate: orderDay(order) },
      ...(order.meta?.versionId ? [{ type: { text: INPUT.version }, valueString: order.meta.versionId }] : []),
      ...(ref ? [{ type: { text: INPUT.regimen }, valueString: `${ref.name} ${cycleDayLabel(ref)}` }] : []),
    ],
  };
  if (order.requester) task.requester = order.requester;
  else delete task.requester;
  if (detail.checks.length > 0) {
    task.output = detail.checks.map((check) => ({ type: { text: OUTPUT.check }, valueString: checkLine(check) }));
  } else {
    delete task.output;
  }
  if (detail.comment.trim()) task.note = [{ authorReference: author, time: now, text: detail.comment.trim() }];
  else delete task.note;
  return task;
}

/** 実施可の取消。記録は残し(誰がいつ実施可にしたかは履歴で辿る)、状態だけ戻す。 */
export function buildWithdrawnRegimenDecisionTask(task: fhir4.Task): fhir4.Task {
  return { ...task, status: "cancelled", lastModified: latestOf(nowFhirDateTime(), task.authoredOn) };
}
