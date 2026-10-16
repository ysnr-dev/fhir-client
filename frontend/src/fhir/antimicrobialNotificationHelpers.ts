import type { AntimicrobialCategory, MedicineAttributeFlags } from "../api/masterClient";
import { ANTIMICROBIAL_CATEGORY_LABEL, antimicrobialCategoryOf } from "./antimicrobialHelpers";
import { injectionSeriesOf, INJECTION_ORDER_TYPE } from "./injectionHelpers";
import {
  buildCompletedNotificationTask,
  buildNotificationTask,
  hasTaskCode,
  notificationTaskEntry,
  taskInputOf,
  taskOwnerName,
  taskPatientId,
  type NotificationRowBase,
} from "./notificationHelpers";
import { approvalOrdersOfBundle } from "./orderApprovalTaskHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { codingBySystem, MEDICINE_CODE_SYSTEM, PRESCRIPTION_ORDER_TYPE } from "./prescriptionHelpers";

// 特定抗菌薬の届出の通知。設計は docs/antimicrobial-stewardship-design.md §2.1。
//
//   処方・注射のオーダー ← focus ── Task(通知) ── owner → 依頼医
//
// 特定抗菌薬(薬剤付加情報の届出制・許可制)を含むオーダーを登録・編集した transaction で作る。
// 連日の注射は束(requisition)で 1 件にし、初日のオーダーを focus、束の全オーダーを basedOn にする。
// 同じ束・同じ処方に通知が既にあれば作らない(状態は問わない。編集で特定抗菌薬が増えても出し直さない)。
// 閉じ方: 届出制は届出書(AST_NOTIFY_01)を basedOn 付きで保存すると完了。許可制は届出書で「許可待ち」になり、
// AST チームの構成員が一覧で許可すると完了する。

export const ANTIMICROBIAL_NOTIFICATION_TASK_CODE = { code: "antimicrobial-notification", display: "特定抗菌薬の届出" };

/** 届出書のテンプレート(docs/report-mappings/ast-notify-01.questionnaire.json)。 */
export const AST_NOTIFY_QUESTIONNAIRE_URL = "http://fhir-client.local/Questionnaire/ast-notify-01";

/** 許可したときに通知へ残す文。 */
export const ANTIMICROBIAL_APPROVE_NOTE = "特定抗菌薬の使用を許可しました。";
/** 届出書の保存で完了したときに残す文。 */
export const ANTIMICROBIAL_NOTIFIED_NOTE = "届出書を提出しました。";

const CATEGORY_INPUT = "区分";
const MEDICINES_INPUT = "薬剤";
const START_INPUT = "開始日";
const SERIES_INPUT = "束";
const KIND_INPUT = "種別";
const FORM_INPUT = "届出書";

export function isAntimicrobialNotificationTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, ANTIMICROBIAL_NOTIFICATION_TASK_CODE.code);
}

function orderTypeOf(order: fhir4.ServiceRequest): string | undefined {
  return codingBySystem(order.category?.flatMap((c) => c.coding ?? []), ORDER_TYPE_SYSTEM)?.code;
}

function patientIdOf(order: fhir4.ServiceRequest): string {
  return order.subject?.reference?.match(/^Patient\/(.+)$/)?.[1] ?? "";
}

/** Bundle の中の、そのオーダーの薬剤(MedicationRequest)の医薬品コードと名前。 */
function medicinesOf(bundle: fhir4.Bundle, reference: string): { code: string; name: string }[] {
  return (bundle.entry ?? []).flatMap((entry) => {
    const resource = entry.resource;
    if (resource?.resourceType !== "MedicationRequest" || entry.request?.method === "DELETE") return [];
    const mr = resource as fhir4.MedicationRequest;
    if (!mr.basedOn?.some((ref) => ref.reference === reference)) return [];
    const coding = mr.medicationCodeableConcept?.coding;
    const code = codingBySystem(coding, MEDICINE_CODE_SYSTEM)?.code;
    return code ? [{ code, name: mr.medicationCodeableConcept?.text ?? coding?.[0]?.display ?? code }] : [];
  });
}

/** 届出の通知の要る薬を含むオーダー群(処方は 1 オーダー、注射は束)。 */
interface NotificationGroup {
  patientId: string;
  /** 束の requisition。処方は無い。 */
  series?: string;
  orders: { order: fhir4.ServiceRequest; reference: string }[];
  medicines: { code: string; name: string; category: AntimicrobialCategory }[];
}

/** Bundle の中で、薬剤付加情報の lookup が要る医薬品コード(処方・注射の薬剤)。 */
export function bundleMedicineCodes(bundle: fhir4.Bundle): string[] {
  const codes = new Set<string>();
  for (const { order, reference } of approvalOrdersOfBundle(bundle)) {
    const type = orderTypeOf(order);
    if (!reference || (type !== PRESCRIPTION_ORDER_TYPE.code && type !== INJECTION_ORDER_TYPE.code)) continue;
    for (const medicine of medicinesOf(bundle, reference)) codes.add(medicine.code);
  }
  return [...codes];
}

/** Bundle の患者(通知の重複を引くのに使う)。 */
export function bundlePatientIds(bundle: fhir4.Bundle): string[] {
  return [...new Set(approvalOrdersOfBundle(bundle).map(({ order }) => patientIdOf(order)).filter(Boolean))];
}

function notificationGroups(
  bundle: fhir4.Bundle,
  attributes: ReadonlyMap<string, MedicineAttributeFlags>,
): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const { order, reference } of approvalOrdersOfBundle(bundle)) {
    const type = orderTypeOf(order);
    if (!reference || (type !== PRESCRIPTION_ORDER_TYPE.code && type !== INJECTION_ORDER_TYPE.code)) continue;
    const medicines = medicinesOf(bundle, reference)
      .map((m) => ({ ...m, category: antimicrobialCategoryOf(m.code, attributes) }))
      .filter((m) => m.category !== "none");
    if (medicines.length === 0) continue;
    const series = type === INJECTION_ORDER_TYPE.code ? injectionSeriesOf(order)?.requisition : undefined;
    const key = series ? `series:${series}` : `order:${reference}`;
    const group = groups.get(key) ?? { patientId: patientIdOf(order), series, orders: [], medicines: [] };
    group.orders.push({ order, reference });
    for (const medicine of medicines) {
      if (!group.medicines.some((m) => m.code === medicine.code)) group.medicines.push(medicine);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** 既存の通知がこの群(同じ束・同じオーダー)のものか。 */
function coveredBy(task: fhir4.Task, group: NotificationGroup): boolean {
  if (group.series) return taskInputOf(task, SERIES_INPUT)?.valueString === group.series;
  const refs = [task.focus?.reference, ...(task.basedOn ?? []).map((ref) => ref.reference)];
  return group.orders.some(({ reference }) => refs.includes(reference));
}

/**
 * オーダーの登録・編集 Bundle に足す届出の通知。`existing` は対象患者のこれまでの届出の通知(状態を問わない)。
 */
export function antimicrobialNotificationEntries(
  bundle: fhir4.Bundle,
  attributes: ReadonlyMap<string, MedicineAttributeFlags>,
  existing: fhir4.Task[],
): fhir4.BundleEntry[] {
  return notificationGroups(bundle, attributes).flatMap((group) => {
    if (!group.patientId || existing.some((task) => coveredBy(task, group))) return [];
    const ordered = [...group.orders].sort((a, b) =>
      (a.order.occurrenceDateTime ?? "").localeCompare(b.order.occurrenceDateTime ?? ""),
    );
    const first = ordered[0].order;
    const category: AntimicrobialCategory = group.medicines.some((m) => m.category === "approve") ? "approve" : "notify";
    const names = group.medicines.map((m) => m.name).join("、");
    const start = (first.occurrenceDateTime ?? "").slice(0, 10);
    const kind = orderTypeOf(first) === INJECTION_ORDER_TYPE.code ? "注射" : "処方";
    const task = buildNotificationTask({
      code: ANTIMICROBIAL_NOTIFICATION_TASK_CODE,
      severity: "caution",
      focusReference: ordered[0].reference,
      patientId: group.patientId,
      owner: first.requester,
      requester: first.requester,
      basedOn: ordered.map(({ reference }) => ({ reference })),
      description: `特定抗菌薬(${ANTIMICROBIAL_CATEGORY_LABEL[category]}) ${names}`,
      input: [
        { type: { text: CATEGORY_INPUT }, valueCode: category },
        { type: { text: MEDICINES_INPUT }, valueString: names },
        { type: { text: KIND_INPUT }, valueString: kind },
        ...(start ? [{ type: { text: START_INPUT }, valueDate: start }] : []),
        ...(group.series ? [{ type: { text: SERIES_INPUT }, valueString: group.series }] : []),
      ],
    });
    if (first.encounter) task.encounter = first.encounter;
    return [notificationTaskEntry(task)];
  });
}

/** 通知の状態。 */
export type AntimicrobialNotificationState = "pending" | "awaiting-approval" | "completed";

export function antimicrobialNotificationState(task: fhir4.Task): AntimicrobialNotificationState {
  if (task.status === "completed") return "completed";
  return taskInputOf(task, FORM_INPUT)?.valueReference ? "awaiting-approval" : "pending";
}

export const ANTIMICROBIAL_NOTIFICATION_STATE_LABEL: Record<AntimicrobialNotificationState, string> = {
  pending: "届出未提出",
  "awaiting-approval": "許可待ち",
  completed: "届出済",
};

export function antimicrobialNotificationCategory(task: fhir4.Task): AntimicrobialCategory {
  return (taskInputOf(task, CATEGORY_INPUT)?.valueCode as AntimicrobialCategory | undefined) ?? "notify";
}

/**
 * 届出書を保存する transaction に足す entry。届出制は完了、許可制は届出書の参照を足して許可待ちにする。
 * `formReference` は同じ transaction の QuestionnaireResponse の fullUrl。
 */
export function antimicrobialNotifiedEntries(
  tasks: fhir4.Task[],
  formReference: string,
  actor: { practitionerId: string; display: string } | null,
): fhir4.BundleEntry[] {
  return tasks
    .filter((task) => task.id && task.status === "requested")
    .map((task) => {
      const input = [
        ...(task.input ?? []).filter((i) => i.type?.text !== FORM_INPUT),
        { type: { text: FORM_INPUT }, valueReference: { reference: formReference } },
      ];
      if (antimicrobialNotificationCategory(task) === "approve" || !actor) {
        return notificationTaskEntry({ ...task, input }, task.id);
      }
      return notificationTaskEntry(buildCompletedNotificationTask({ ...task, input }, actor, ANTIMICROBIAL_NOTIFIED_NOTE), task.id);
    });
}

/** 許可(許可制の通知を完了にする)。 */
export function antimicrobialApproveEntry(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
): fhir4.BundleEntry {
  return notificationTaskEntry(buildCompletedNotificationTask(task, actor, ANTIMICROBIAL_APPROVE_NOTE), task.id);
}

export interface AntimicrobialNotificationRow extends NotificationRowBase {
  category: AntimicrobialCategory;
  state: AntimicrobialNotificationState;
  medicines: string;
  kind: string;
  startDate: string;
  /** 届出書の保存先(basedOn に入れるオーダー)。 */
  orderId: string;
}

export function antimicrobialNotificationRowOf(
  task: fhir4.Task,
  patient: fhir4.Patient | undefined,
): AntimicrobialNotificationRow {
  return {
    task,
    patient,
    patientId: taskPatientId(task),
    authoredOn: task.authoredOn ?? "",
    ownerName: taskOwnerName(task),
    category: antimicrobialNotificationCategory(task),
    state: antimicrobialNotificationState(task),
    medicines: taskInputOf(task, MEDICINES_INPUT)?.valueString ?? task.description ?? "",
    kind: taskInputOf(task, KIND_INPUT)?.valueString ?? "",
    startDate: taskInputOf(task, START_INPUT)?.valueDate ?? "",
    orderId: task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1] ?? "",
  };
}
