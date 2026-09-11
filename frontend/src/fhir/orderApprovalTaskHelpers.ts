import { KARTE_KIND_LABELS, orderKindOf } from "./karteTimeline";
import {
  buildNotificationTask,
  hasTaskCode,
  taskInputOf,
  taskInputsOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import { orderSetOf } from "./orderSetHelpers";
import { orderContextSummary, prescriptionRequester } from "./prescriptionHelpers";
import {
  isHeaderEntry,
  needsApproval,
  orderActivityLabel,
  provenanceActivity,
  type OrderActivity,
  type OrderEnterer,
} from "./provenanceHelpers";
import { regimenOrderOf } from "./regimenOrderHelpers";
import { orderDay } from "./shared";

// 代行入力の承認待ちの通知。
//
//   Provenance(来歴) ← focus ── Task(通知) ── owner → 指示医師
//
// 真正性の記録は引き続き Provenance が正本で、「誰が代行入力し、誰が承認したか」は
// そちらにしか無い(provenanceHelpers 冒頭)。この Task は**指示医師あての通知**として、
// 宛先と未対応・対応済みだけを持つ。承認すると Provenance に署名が付き、同じ transaction で
// この Task が completed になる。
//
// 一覧に出す情報(種別・開始日・依頼科/依頼医師・入力者)は Task.input と requester から
// 読めるようにしてある。上流の `_include=Task:focus` は ServiceRequest しか返さないので、
// 一覧から Provenance やオーダーを引き直さずに済ませるため。

export const ORDER_APPROVAL_TASK_CODE = { code: "order-approval", display: "オーダー承認" };

export function isOrderApprovalTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, ORDER_APPROVAL_TASK_CODE.code);
}

// Task.input のキー名。
const ACTIVITY_INPUT = "活動";
const KIND_INPUT = "種別";
const ORDER_INPUT = "対象オーダー";
const DAY_INPUT = "開始日";
const CONTEXT_INPUT = "依頼";
const ORDER_SET_INPUT = "セット";

type OrderKind = ReturnType<typeof orderKindOf>;

/**
 * 承認一覧での種別。化学療法の次クール登録はヘッダを含まない(日オーダーだけの transaction)ので、
 * 日オーダーの `regimen-order` 拡張を見て「化学療法」に寄せる(§8.13 N-6)。カルテのカードの種別
 * (`orderKindOf`)は変えない — そこで化学療法にすると日オーダーがカードから消える。
 */
export function approvalKindOf(order: fhir4.ServiceRequest): OrderKind {
  return regimenOrderOf(order) ? "chemo-regimen" : orderKindOf(order);
}

/** Bundle の entry が指す参照。新規は fullUrl(urn:uuid:)、更新は PUT 先。 */
function entryReference(entry: fhir4.BundleEntry): string | undefined {
  if (entry.request?.method === "DELETE") return undefined;
  if (entry.fullUrl) return entry.fullUrl;
  return entry.request?.method === "PUT" ? entry.request.url : undefined;
}

function approvalTaskInputs(
  orders: { order: fhir4.ServiceRequest; reference: string | undefined }[],
  activity: OrderActivity,
): fhir4.TaskInput[] {
  const first = orders[0]?.order;
  const inputs: fhir4.TaskInput[] = [
    { type: { text: ACTIVITY_INPUT }, valueCode: activity },
  ];

  // オーダーセットの適用は 1 回の操作で複数種別を登録する(来歴も 1 件)。種別は重複なく並べる。
  const kinds = Array.from(new Set(orders.map(({ order }) => approvalKindOf(order)))).filter(
    (kind): kind is NonNullable<OrderKind> => Boolean(kind),
  );
  for (const kind of kinds) inputs.push({ type: { text: KIND_INPUT }, valueCode: kind });

  // 対象オーダー。カルテの詳細モーダルを開くのに先頭を使う(注射の連日は日ごとに並ぶ)。
  for (const { reference } of orders) {
    if (reference) inputs.push({ type: { text: ORDER_INPUT }, valueReference: { reference } });
  }

  // 注射の連日オーダーは 1 回の登録で日ごとのヘッダが並ぶ。開始日は最初の日〜最後の日。
  const days = orders.map(({ order }) => orderDay(order)).filter(Boolean).sort();
  const dayLabel =
    days.length === 0 ? "" : days.length === 1 ? days[0] : `${days[0]} 〜 ${days[days.length - 1]}`;
  if (dayLabel) inputs.push({ type: { text: DAY_INPUT }, valueString: dayLabel });

  if (first) {
    const context = orderContextSummary(prescriptionRequester(first));
    if (context) inputs.push({ type: { text: CONTEXT_INPUT }, valueString: context });
    const orderSet = orderSetOf(first);
    if (orderSet?.name) inputs.push({ type: { text: ORDER_SET_INPUT }, valueString: orderSet.name });
  }

  return inputs;
}

/**
 * 承認待ちの通知の entry。代行でない活動(医師本人の入力)には付けない。
 *
 * focus は同じ Bundle に積む Provenance の fullUrl(urn:uuid:)。上流の transaction が
 * `Provenance/{採番済 id}` に解決するので、クライアントが id を知る必要はない。
 */
export function buildOrderApprovalTaskEntry(
  provenanceEntry: fhir4.BundleEntry,
  orders: { order: fhir4.ServiceRequest; reference: string | undefined }[],
  enterer: OrderEnterer,
): fhir4.BundleEntry | null {
  const provenance = provenanceEntry.resource as fhir4.Provenance | undefined;
  const focusReference = provenanceEntry.fullUrl;
  if (!provenance || !focusReference || !needsApproval(provenance)) return null;

  const first = orders[0]?.order;
  const owner = first?.requester;
  const patientId = first?.subject?.reference?.split("/").pop() ?? "";
  if (!owner?.reference || !patientId) return null;

  const activity = provenanceActivity(provenance);
  const kinds = Array.from(new Set(orders.map(({ order }) => approvalKindOf(order))));
  const description = `${kinds.map(kindLabel).join(" / ")}の${orderActivityLabel(activity)}（入力: ${enterer.display}）`;

  const task = buildNotificationTask({
    code: ORDER_APPROVAL_TASK_CODE,
    // 承認は遅れても診療は止まらない(承認前でも部門にオーダーは流れる)。
    priority: "routine",
    focusReference,
    patientId,
    owner,
    requester: {
      reference: `Practitioner/${enterer.practitionerId}`,
      display: enterer.display || undefined,
    },
    // オーダー側から未承認を逆引きできるようにする(`_revinclude=Task:based-on`)。
    basedOn: orders
      .map(({ reference }) => reference)
      .filter((reference): reference is string => Boolean(reference))
      .map((reference) => ({ reference })),
    description,
    input: approvalTaskInputs(orders, activity),
  });

  return { resource: task, request: { method: "POST", url: "Task" } };
}

/** 登録・編集の Bundle からヘッダとその参照を集める(来歴の target と同じ単位)。 */
export function approvalOrdersOfBundle(
  bundle: fhir4.Bundle,
): { order: fhir4.ServiceRequest; reference: string | undefined }[] {
  return (bundle.entry ?? [])
    .filter(isHeaderEntry)
    .map((entry) => ({ order: entry.resource, reference: entryReference(entry) }));
}

// ---- 一覧の行 ----

export interface OrderApprovalRow extends NotificationRowBase {
  /** 承認する来歴。この id を渡して署名を足す。 */
  provenanceId: string;
  activity: OrderActivity;
  kinds: OrderKind[];
  /** カルテの詳細モーダルを開く対象。 */
  orderId: string;
  dayLabel: string;
  entererName: string;
  contextLabel: string;
  orderSetName: string;
}

export function kindLabel(kind: OrderKind): string {
  if (!kind) return "-";
  if (kind === "nursing-order") return "看護指示";
  if (kind === "chemo-regimen") return "化学療法";
  return KARTE_KIND_LABELS[kind];
}

export function orderApprovalRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): OrderApprovalRow {
  const activityCode = taskInputOf(task, ACTIVITY_INPUT)?.valueCode ?? "CREATE";
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    provenanceId: task.focus?.reference?.match(/^Provenance\/(.+)$/)?.[1] ?? "",
    activity: activityCode as OrderActivity,
    kinds: taskInputsOf(task, KIND_INPUT).map((input) => (input.valueCode ?? null) as OrderKind),
    orderId:
      taskInputsOf(task, ORDER_INPUT)[0]
        ?.valueReference?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "",
    dayLabel: taskInputOf(task, DAY_INPUT)?.valueString ?? "",
    entererName: task.requester?.display ?? "",
    contextLabel: taskInputOf(task, CONTEXT_INPUT)?.valueString ?? "",
    orderSetName: taskInputOf(task, ORDER_SET_INPUT)?.valueString ?? "",
  };
}
