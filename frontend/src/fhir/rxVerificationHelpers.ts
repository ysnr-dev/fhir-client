import { shortDate } from "../lib/dates";
import { INJECTION_ORDER_TYPE, INJECTION_SERIES_SYSTEM, injectionDayOf, injectionSeriesOf } from "./injectionHelpers";
import {
  buildCompletedNotificationTask,
  buildNotificationTask,
  hasTaskCode,
  taskInputOf,
  taskInputsOf,
} from "./notificationHelpers";
import { departmentOf, ORDER_TYPE_SYSTEM } from "./orderHeader";
import { PRACTITIONER_ROLE_SYSTEM } from "./practitionerRoleHelpers";
import {
  isBroughtPrescription,
  PRESCRIPTION_CATEGORY_SYSTEM,
  PRESCRIPTION_ORDER_TYPE,
  prescriptionCategoryOf,
  SETTING_SYSTEM,
} from "./prescriptionHelpers";
import { regimenOrderOf } from "./regimenOrderHelpers";
import { categoryCoding, orderDay, versionEtag } from "./shared";

// 処方監査(docs/rx-verification-design.md)。
//
//   ServiceRequest(処方・注射) ← focus ── Task rx-verification(未監査 → 監査済)
//
// 院内の処方と注射を確定したときに作り、薬剤師が監査して完了にする。宛先は個人ではなく
// 職種(performerType = 薬剤師)で、通知の対応表には載せず「処方監査」一覧で追う。
// 連日の注射は束ね(requisition)に 1 件で、groupIdentifier に束ねの uuid、focus は束ねの最初の日。
// 監査結果と介入(プレアボイド)は output に持つ。

export const RX_VERIFICATION_TASK_CODE = { code: "rx-verification", display: "処方監査" };

const RESULT_SYSTEM = "http://fhir-client.local/CodeSystem/rx-verification-result";
export const INTERVENTION_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/pharmacist-intervention-type";
const OUTCOME_SYSTEM = "http://fhir-client.local/CodeSystem/rx-intervention-outcome";

export type RxVerificationResultCode = "no-issue" | "intervened";
export type RxInterventionOutcome = "order-changed" | "unchanged" | "cancelled";

export const RX_VERIFICATION_RESULT_OPTIONS: { code: RxVerificationResultCode; display: string }[] = [
  { code: "no-issue", display: "問題なし" },
  { code: "intervened", display: "介入あり" },
];

export const RX_INTERVENTION_OUTCOME_OPTIONS: { code: RxInterventionOutcome; display: string }[] = [
  { code: "order-changed", display: "処方変更" },
  { code: "unchanged", display: "変更なし" },
  { code: "cancelled", display: "中止" },
];

export type RxVerificationOrderKind = "prescription" | "injection";

/** 施設設定 rx_verification。 */
export interface RxVerificationSettings {
  /** 監査済になるまで処方一覧の「調剤登録」・注射一覧の「払出登録」を出さない。 */
  block_dispense_before_verified: boolean;
}

export const DEFAULT_RX_VERIFICATION: RxVerificationSettings = { block_dispense_before_verified: false };

const INPUT = {
  kind: "種別",
  orderDate: "処方日",
  setting: "入外区分",
  category: "区分",
  medicine: "薬剤",
  period: "期間",
  department: "診療科",
} as const;

const OUTPUT = {
  result: "監査結果",
  type: "介入種別",
  content: "介入内容",
  outcome: "処方医の対応",
} as const;

const REVERIFY_NOTE = "処方が変更されたため再監査";
const VERIFIED_NOTE = "監査しました。";

function isReverifyPending(task: fhir4.Task): boolean {
  return task.status === "requested" && Boolean(task.note?.some((n) => n.text === REVERIFY_NOTE));
}

export function isRxVerificationTask(task: fhir4.Task): boolean {
  return hasTaskCode(task, RX_VERIFICATION_TASK_CODE.code);
}

export function rxVerificationOrderKind(sr: fhir4.ServiceRequest): RxVerificationOrderKind | null {
  const type = categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code;
  if (type === PRESCRIPTION_ORDER_TYPE.code) return "prescription";
  if (type === INJECTION_ORDER_TYPE.code) return "injection";
  return null;
}

/**
 * 監査の対象か。院外処方は保険薬局が、持参の処方は持参薬鑑別が、化学療法の日オーダーは
 * レジメンの適用が確かめるので対象外。
 */
export function isRxVerificationTarget(sr: fhir4.ServiceRequest): boolean {
  const kind = rxVerificationOrderKind(sr);
  if (kind === "prescription") return prescriptionCategoryOf(sr) !== "external" && !isBroughtPrescription(sr);
  if (kind === "injection") return regimenOrderOf(sr) === null;
  return false;
}

/** 束ねの uuid。注射だけが持つ(単日の注射も 1 日の束ねを持つ)。 */
export function rxVerificationGroupOf(sr: fhir4.ServiceRequest): string | undefined {
  return rxVerificationOrderKind(sr) === "injection" ? injectionSeriesOf(sr)?.requisition : undefined;
}

export function rxVerificationGroupIdentifier(task: fhir4.Task): string | undefined {
  return task.groupIdentifier?.system === INJECTION_SERIES_SYSTEM ? task.groupIdentifier.value : undefined;
}

export function medicineNameOf(mr: fhir4.MedicationRequest): string {
  return mr.medicationCodeableConcept?.text ?? mr.medicationCodeableConcept?.coding?.[0]?.display ?? "";
}

/** 一覧の要約に出す薬剤名(先頭 1 剤 + 残りの剤数)。 */
function medicinesLabel(names: string[]): string {
  if (names.length === 0) return "";
  return names.length === 1 ? names[0] : `${names[0]} ほか ${names.length - 1} 剤`;
}

export interface RxVerificationTaskInput {
  /** 起点のオーダー。連日の注射は束ねの最初の日。 */
  order: fhir4.ServiceRequest;
  /** 起点のオーダーを指す参照。同じ transaction で作るなら urn:uuid。 */
  orderReference: string;
  medicationRequests: fhir4.MedicationRequest[];
  /** 連日の注射の期間(束ねで書く日の最初と最後)。 */
  period?: { start: string; end: string };
}

/**
 * 未監査の Task。既存を渡すと内容を書き直して未監査に戻す。監査済だったものを戻すときは
 * note に再監査の理由を残す。
 */
export function buildRxVerificationTask(input: RxVerificationTaskInput, existing?: fhir4.Task): fhir4.Task {
  const { order, orderReference, medicationRequests, period } = input;
  const kind = rxVerificationOrderKind(order) ?? "prescription";
  const setting = categoryCoding(order, SETTING_SYSTEM);
  const categoryCode =
    kind === "prescription"
      ? categoryCoding(order, PRESCRIPTION_CATEGORY_SYSTEM)
      : order.category?.flatMap((c) => c.coding ?? []).find(
          (c) => c.system !== ORDER_TYPE_SYSTEM && c.system !== SETTING_SYSTEM,
        );
  // 外来の注射区分は「外来」の 1 つだけで、入外区分と同じ表示になるので省く。
  const category = categoryCode?.display === setting?.display ? undefined : categoryCode;
  const names = [...new Set(medicationRequests.map(medicineNameOf).filter(Boolean))];
  const { departmentId, departmentName } = departmentOf(order);
  const kindLabel = kind === "prescription" ? "処方" : "注射";
  const head = [setting?.display, category?.display].filter(Boolean).join("・");
  const description = `${kindLabel}${head ? `(${head})` : ""} ${medicinesLabel(names)}`.trim();
  const patientId = order.subject?.reference?.split("/").pop() ?? "";
  const reverify = existing?.status === "completed" || Boolean(existing && isReverifyPending(existing));

  const task = buildNotificationTask(
    {
      code: RX_VERIFICATION_TASK_CODE,
      severity: "info",
      focusReference: orderReference,
      patientId,
      requester: order.requester,
      basedOn: [{ reference: orderReference }],
      description,
      input: [
        { type: { text: INPUT.kind }, valueCode: kind },
        { type: { text: INPUT.orderDate }, valueDate: period?.start ?? orderDay(order) },
        ...(setting?.display ? [{ type: { text: INPUT.setting }, valueString: setting.display }] : []),
        ...(category?.display ? [{ type: { text: INPUT.category }, valueString: category.display }] : []),
        ...names.map((name) => ({ type: { text: INPUT.medicine }, valueString: name })),
        ...(period && period.end !== period.start
          ? [{ type: { text: INPUT.period }, valuePeriod: { start: period.start, end: period.end } }]
          : []),
        ...(departmentId
          ? [
              {
                type: { text: INPUT.department },
                valueReference: { reference: `Organization/${departmentId}`, display: departmentName },
              },
            ]
          : []),
      ],
    },
    existing,
  );
  // 通知の強度ではなくオーダーの至急区分を写す(至急の処方を一覧の上に出すため)。
  task.priority = order.priority ?? "routine";
  task.performerType = [
    { coding: [{ system: PRACTITIONER_ROLE_SYSTEM, code: "pharmacist", display: "薬剤師" }], text: "薬剤師" },
  ];
  const group = rxVerificationGroupOf(order);
  if (group) task.groupIdentifier = { system: INJECTION_SERIES_SYSTEM, value: group };
  else delete task.groupIdentifier;
  delete task.output;
  if (reverify) task.note = [{ time: task.lastModified, text: REVERIFY_NOTE }];
  return task;
}

/**
 * 起点を残りの日に付け替えた Task(連日の注射で最初の日を消したとき)。lastModified は動かさない
 * (監査済の一覧が監査日として読む)。
 */
export function refocusRxVerificationTask(task: fhir4.Task, orderId: string): fhir4.Task {
  const reference = `ServiceRequest/${orderId}`;
  return { ...task, focus: { reference }, basedOn: [{ reference }] };
}

export interface RxVerificationResult {
  result: RxVerificationResultCode;
  /** 介入種別(マスタのコードと名称)。介入ありのときだけ。 */
  types: { code: string; name: string }[];
  content: string;
  outcome?: RxInterventionOutcome;
}

function resultDisplay(code: RxVerificationResultCode): string {
  return RX_VERIFICATION_RESULT_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

export function interventionOutcomeDisplay(code: RxInterventionOutcome | undefined): string {
  return RX_INTERVENTION_OUTCOME_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

/** 監査済にした Task。監査した薬剤師を owner に入れる(薬剤師ごとに数えるため)。 */
export function buildVerifiedRxTask(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
  result: RxVerificationResult,
): fhir4.Task {
  const intervened = result.result === "intervened";
  const output: fhir4.TaskOutput[] = [
    {
      type: { text: OUTPUT.result },
      valueCodeableConcept: {
        coding: [{ system: RESULT_SYSTEM, code: result.result, display: resultDisplay(result.result) }],
      },
    },
  ];
  if (intervened) {
    for (const type of result.types) {
      output.push({
        type: { text: OUTPUT.type },
        valueCodeableConcept: { coding: [{ system: INTERVENTION_TYPE_SYSTEM, code: type.code, display: type.name }] },
      });
    }
    if (result.content.trim()) output.push({ type: { text: OUTPUT.content }, valueString: result.content.trim() });
    if (result.outcome) {
      output.push({
        type: { text: OUTPUT.outcome },
        valueCodeableConcept: {
          coding: [
            { system: OUTCOME_SYSTEM, code: result.outcome, display: interventionOutcomeDisplay(result.outcome) },
          ],
        },
      });
    }
  }
  return {
    ...buildCompletedNotificationTask(task, actor, VERIFIED_NOTE),
    owner: { reference: `Practitioner/${actor.practitionerId}`, display: actor.display },
    output,
  };
}

function outputsOf(task: fhir4.Task, key: string): fhir4.TaskOutput[] {
  return (task.output ?? []).filter((o) => o.type?.text === key);
}

/** 保存済みの監査結果。未監査なら null。 */
export function rxVerificationResultOf(task: fhir4.Task): RxVerificationResult | null {
  const code = outputsOf(task, OUTPUT.result)[0]?.valueCodeableConcept?.coding?.[0]?.code;
  if (task.status !== "completed" || (code !== "no-issue" && code !== "intervened")) return null;
  const outcome = outputsOf(task, OUTPUT.outcome)[0]?.valueCodeableConcept?.coding?.[0]?.code;
  return {
    result: code,
    types: outputsOf(task, OUTPUT.type)
      .map((o) => o.valueCodeableConcept?.coding?.[0])
      .filter((c): c is fhir4.Coding => Boolean(c?.code))
      .map((c) => ({ code: c.code ?? "", name: c.display ?? c.code ?? "" })),
    content: outputsOf(task, OUTPUT.content)[0]?.valueString ?? "",
    outcome: RX_INTERVENTION_OUTCOME_OPTIONS.some((o) => o.code === outcome)
      ? (outcome as RxInterventionOutcome)
      : undefined,
  };
}

export function rxVerificationResultLabel(result: RxVerificationResult | null): string {
  if (!result) return "";
  if (result.result === "no-issue") return resultDisplay("no-issue");
  const types = result.types.map((t) => t.name).join("・");
  return types ? `${resultDisplay("intervened")}(${types})` : resultDisplay("intervened");
}

/** 一覧に出す Task 自身の情報。 */
export interface RxVerificationSummary {
  kind: RxVerificationOrderKind;
  orderDate: string;
  setting: string;
  category: string;
  medicines: string[];
  periodLabel: string;
  departmentName: string;
  requesterName: string;
  verifierName: string;
  verifiedAt: string;
  reverify: boolean;
}

export function rxVerificationSummaryOf(task: fhir4.Task): RxVerificationSummary {
  const period = taskInputOf(task, INPUT.period)?.valuePeriod;
  const verifier = task.status === "completed" ? task.owner?.display ?? "" : "";
  return {
    kind: taskInputOf(task, INPUT.kind)?.valueCode === "injection" ? "injection" : "prescription",
    orderDate: taskInputOf(task, INPUT.orderDate)?.valueDate ?? "",
    setting: taskInputOf(task, INPUT.setting)?.valueString ?? "",
    category: taskInputOf(task, INPUT.category)?.valueString ?? "",
    medicines: taskInputsOf(task, INPUT.medicine).map((i) => i.valueString ?? "").filter(Boolean),
    periodLabel: period?.start && period.end ? `${shortDate(period.start)}〜${shortDate(period.end)}` : "",
    departmentName: taskInputOf(task, INPUT.department)?.valueReference?.display ?? "",
    requesterName: task.requester?.display ?? "",
    verifierName: verifier,
    verifiedAt: task.status === "completed" ? task.executionPeriod?.end ?? "" : "",
    reverify: isReverifyPending(task),
  };
}

export function rxVerificationOrderId(task: fhir4.Task): string | undefined {
  return task.focus?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
}

function isOpenOrVerified(task: fhir4.Task): boolean {
  return isRxVerificationTask(task) && (task.status === "requested" || task.status === "completed");
}

/** 起点のオーダーの id → 監査 Task(_revinclude=Task:focus の Task から拾う)。 */
export function rxVerificationTasksByOrderId(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const byOrder = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    const id = rxVerificationOrderId(task);
    if (id && isOpenOrVerified(task)) byOrder.set(id, task);
  }
  return byOrder;
}

/** 束ねの uuid → 監査 Task。 */
export function rxVerificationTasksByGroup(tasks: fhir4.Task[]): Map<string, fhir4.Task> {
  const byGroup = new Map<string, fhir4.Task>();
  for (const task of tasks) {
    const group = rxVerificationGroupIdentifier(task);
    if (group && isOpenOrVerified(task)) byGroup.set(group, task);
  }
  return byGroup;
}

/** オーダーの監査の状態。対象外のオーダーと、監査 Task を持たないオーダー(導入前の登録)は null。 */
export function rxVerificationStateOf(task: fhir4.Task | undefined): "pending" | "verified" | null {
  if (!task) return null;
  return task.status === "completed" ? "verified" : "pending";
}

// ---- オーダーの登録・編集 Bundle に足す ----

interface BundleOrder {
  sr: fhir4.ServiceRequest;
  /** Bundle の中でこのオーダーを指す参照(POST なら fullUrl、PUT なら ServiceRequest/{id})。 */
  reference: string;
  /** 保存済みのオーダーの id(PUT のとき)。 */
  id?: string;
  medicationRequests: fhir4.MedicationRequest[];
}

/** Bundle が書く対象のオーダー(処方・注射のヘッダ)と、それぞれの薬剤明細。 */
export function rxVerificationOrdersInBundle(bundle: fhir4.Bundle): BundleOrder[] {
  const entries = bundle.entry ?? [];
  const medicationRequests = entries
    .filter((e) => e.resource?.resourceType === "MedicationRequest" && e.request?.method !== "DELETE")
    .map((e) => e.resource as fhir4.MedicationRequest);
  const orders: BundleOrder[] = [];
  for (const entry of entries) {
    if (entry.resource?.resourceType !== "ServiceRequest") continue;
    const sr = entry.resource as fhir4.ServiceRequest;
    if (!isRxVerificationTarget(sr)) continue;
    const method = entry.request?.method;
    const id = method === "PUT" ? entry.request?.url?.match(/^ServiceRequest\/([^/?]+)$/)?.[1] : undefined;
    const reference = id ? `ServiceRequest/${id}` : entry.fullUrl;
    if (!reference || (method !== "POST" && method !== "PUT")) continue;
    const refs = new Set([reference, entry.fullUrl].filter(Boolean));
    orders.push({
      sr,
      reference,
      id,
      medicationRequests: medicationRequests.filter((mr) => mr.basedOn?.some((b) => refs.has(b.reference ?? ""))),
    });
  }
  return orders;
}

/** Bundle から既存の監査 Task を探すための検索値。 */
export function rxVerificationLookupOf(orders: BundleOrder[]): { orderIds: string[]; groups: string[] } {
  return {
    orderIds: [...new Set(orders.filter((o) => !rxVerificationGroupOf(o.sr) && o.id).map((o) => o.id as string))],
    groups: [...new Set(orders.map((o) => rxVerificationGroupOf(o.sr)).filter((g): g is string => Boolean(g)))],
  };
}

// 束ねの期間。編集・継続では束ねの一部の日しか Bundle に無いので、束ねの開始日と前の期間も見る。
function seriesPeriod(days: fhir4.ServiceRequest[], existing: fhir4.Task | undefined): { start: string; end: string } {
  const previous = existing && taskInputOf(existing, INPUT.period)?.valuePeriod;
  const previousStart = existing && taskInputOf(existing, INPUT.orderDate)?.valueDate;
  const starts = [
    ...days.map((sr) => injectionSeriesOf(sr)?.start ?? injectionDayOf(sr)),
    previous?.start ?? previousStart ?? "",
  ].filter(Boolean);
  const ends = [
    ...days.map((sr) => injectionDayOf(sr)),
    ...days.map((sr) => injectionSeriesOf(sr)?.end ?? ""),
    previous?.end ?? "",
  ].filter(Boolean);
  return { start: starts.sort()[0], end: ends.sort()[ends.length - 1] };
}

/**
 * 監査 Task を作る・未監査へ戻す entry。処方はオーダーごと、注射は束ねごとに 1 件。
 * existing は未監査・監査済の Task(focus か groupIdentifier で突き合わせる)。
 */
export function rxVerificationEntries(orders: BundleOrder[], existing: fhir4.Task[]): fhir4.BundleEntry[] {
  const byGroup = new Map<string, BundleOrder[]>();
  for (const order of orders) {
    const key = rxVerificationGroupOf(order.sr) ?? order.reference;
    byGroup.set(key, [...(byGroup.get(key) ?? []), order]);
  }
  const entries: fhir4.BundleEntry[] = [];
  for (const [key, group] of byGroup) {
    const isSeries = Boolean(rxVerificationGroupOf(group[0].sr));
    const found = existing.find((task) =>
      isSeries ? rxVerificationGroupIdentifier(task) === key : task.focus?.reference === key,
    );
    const days = [...group].sort((a, b) => injectionDayOf(a.sr).localeCompare(injectionDayOf(b.sr)));
    const first = days[0];
    const keepFocus = found?.focus?.reference;
    const anchor = (keepFocus ? group.find((o) => o.reference === keepFocus) : undefined) ?? first;
    const task = buildRxVerificationTask(
      {
        order: anchor.sr,
        orderReference: keepFocus ?? first.reference,
        medicationRequests: group.flatMap((o) => o.medicationRequests),
        period: isSeries ? seriesPeriod(days.map((o) => o.sr), found) : undefined,
      },
      found,
    );
    // 編集では明細を書き直さない日もある(束ねの一部の日だけの編集)。前の要約を消さない。
    if (found && group.every((o) => o.medicationRequests.length === 0)) task.description = found.description;
    const ifMatch = versionEtag(found);
    entries.push(
      found?.id
        ? { resource: task, request: { method: "PUT", url: `Task/${found.id}`, ...(ifMatch ? { ifMatch } : {}) } }
        : { resource: task, request: { method: "POST", url: "Task" } },
    );
  }
  return entries;
}
