import { today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type OrderAttribution,
} from "./prescriptionHelpers";
import { buildNursingTaskUpdate } from "./nursingTaskHelpers";
import {
  isValidTime,
  nursingScheduleExtension,
  nursingScheduleLabel,
  nursingScheduleOf,
  timingToScheduleValues,
  type NursingScheduleValues,
} from "./nursingScheduleHelpers";

// 看護指示(指示簿)。医師が入院患者に出す看護向けの指示(安静度・清潔・観察項目など)。
//
// 他の部門オーダーと違い **1 指示行 = 1 ServiceRequest** で、ヘッダ SR は作らない。
// 指示簿の各行は別々に開始・終了・中止されるので、検体検査のように伝票にまとめて
// 「伝票ごと」動かす形が合わない。同時に出した指示群は requisition(同じ uuid)で
// 束ね、履歴ビューで「いつ・誰が・何を」として並べる(docs/nursing-order-design.md §1)。
//
// 用語は MEDIS 看護実践用語標準マスター(看護行為編・看護観察編)。code.coding に
// 行為は 16 桁コード(A/B/C/D 階層の連結)と 8 桁の管理番号を併記、観察は観察名称
// 管理番号を入れる。マスタに無い指示は code.text だけで持つ。
//
// 頻度(1 日 3 回 / 4 時間毎)は FHIR の Timing を root 拡張 `nursing-order-schedule` の
// valueTiming に持つ(nursingScheduleHelpers)。occurrenceTiming にしないのは、
// occurrence[x] が choice で occurrenceDateTime(開始日)と併用できず、上流も
// occurrenceDateTime しか索引しないため(docs/rehab-order-design.md §2.3)。
// 条件(38℃以上で報告 など)は頻度とは別物なので orderDetail[0].text の自由記載。
// 拡張を付ける前の指示は頻度も orderDetail に書かれているが、条件として読めば
// 表示は変わらない(移行しない)。
//
// 進捗 Task は「看護師の指示受け」を表す(nursingTaskHelpers)。

export const NURSING_ORDER_TYPE = { code: "nursing", display: "看護指示" };

/** 看護行為テーブル(MEDIS OID 1.2.392.200119.4.704)。code は 16 桁の階層コード。 */
export const NURSING_ACT_CODE_SYSTEM = "http://medis.or.jp/CodeSystem/master-nursingAction-16digits";
/** 同じ看護行為テーブルの 8 桁管理番号。16 桁コードと併記する。 */
export const NURSING_ACT_MANAGE_NO_SYSTEM = "urn:oid:1.2.392.200119.4.704";
/** 看護観察テーブル(MEDIS OID 1.2.392.200119.4.804)。code は観察名称管理番号。 */
export const NURSING_OBSERVATION_CODE_SYSTEM =
  "http://medis.or.jp/CodeSystem/master-nursingObservationKeyCode";

/**
 * 終了日(いつまでの指示か)。食事・リハビリと同じく occurrencePeriod ではなく
 * ローカル拡張にする(上流が occurrenceDateTime しか索引しない)。無ければ継続中。
 */
const NURSING_ORDER_END_EXT_URL = "http://fhir-client.local/StructureDefinition/nursing-order-end";

/** 同時に出した指示群の束ね。値は登録ごとに振る uuid。 */
export const NURSING_REQUISITION_SYSTEM =
  "http://fhir-client.local/Identifier/nursing-order-requisition";

// ---- フォームの値 ----

/** マスタから選んだ用語。null は自由記載。 */
export type NursingItemRef =
  | { kind: "act"; code16: string; manageNo: string; display: string }
  | { kind: "observation"; manageNo: string; display: string }
  | null;

export interface NursingOrderLineValues {
  item: NursingItemRef;
  /** 指示内容の文言。マスタ選択時は用語名で埋め、自由記載ではこれが本体。 */
  text: string;
  /** 頻度(予定)。null は適宜・必要時。 */
  schedule: NursingScheduleValues;
  /** 条件(自由記載)。 */
  condition: string;
  startDate: string;
  endDate: string;
  comment: string;
}

export interface NursingOrderFormValues {
  lines: NursingOrderLineValues[];
  problem: ProblemRef | null;
}

export function emptyNursingOrderLine(): NursingOrderLineValues {
  return {
    item: null,
    text: "",
    schedule: null,
    condition: "",
    startDate: today(),
    endDate: "",
    comment: "",
  };
}

export function emptyNursingOrderForm(): NursingOrderFormValues {
  return { lines: [emptyNursingOrderLine()], problem: null };
}

/** 入力チェック。問題なければ空文字。 */
export function validateNursingOrderForm(values: NursingOrderFormValues): string {
  if (values.lines.length === 0) return "指示を 1 行以上入れてください。";
  for (const [index, line] of values.lines.entries()) {
    const n = index + 1;
    if (!line.text.trim()) return `${n} 行目: 指示内容を入れてください。`;
    if (!line.startDate) return `${n} 行目: 開始日を入れてください。`;
    if (line.endDate && line.endDate < line.startDate) {
      return `${n} 行目: 終了日は開始日以降にしてください。`;
    }
    const scheduleError = validateSchedule(line.schedule);
    if (scheduleError) return `${n} 行目: ${scheduleError}`;
  }
  return "";
}

function validateSchedule(schedule: NursingScheduleValues): string {
  if (!schedule) return "";
  switch (schedule.kind) {
    case "daily":
    case "times":
      if (schedule.times.length === 0) return "時刻を入れてください。";
      if (!schedule.times.every(isValidTime)) return "時刻の形式が正しくありません。";
      return "";
    case "interval":
      if (!(schedule.hours > 0)) return "間隔(時間)を入れてください。";
      if (!isValidTime(schedule.start)) return "起点の時刻を入れてください。";
      return "";
    case "weekly":
      if (schedule.days.length === 0) return "曜日を選んでください。";
      if (schedule.time && !isValidTime(schedule.time)) return "時刻の形式が正しくありません。";
      return "";
  }
}

/** 看護指示の ServiceRequest か。 */
export function isNursingServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === NURSING_ORDER_TYPE.code;
}

// ---- 組み立て ----

interface BuildOptions {
  /** 入院 Encounter の id。指示は入院に紐づく。 */
  encounterId?: string;
  /** 同時発行の束ね。 */
  requisition: string;
  problem: ProblemRef | null;
  serviceRequestId?: string;
  /** 編集時に元のリソースから引き継ぐもの。 */
  authoredOn?: string;
}

function itemCodeableConcept(line: NursingOrderLineValues): fhir4.CodeableConcept {
  const text = line.text.trim();
  const item = line.item;
  if (!item) return { text };
  if (item.kind === "act") {
    return {
      coding: [
        { system: NURSING_ACT_CODE_SYSTEM, code: item.code16, display: item.display },
        { system: NURSING_ACT_MANAGE_NO_SYSTEM, code: item.manageNo, display: item.display },
      ],
      text,
    };
  }
  return {
    coding: [{ system: NURSING_OBSERVATION_CODE_SYSTEM, code: item.manageNo, display: item.display }],
    text,
  };
}

function buildNursingOrderServiceRequest(
  line: NursingOrderLineValues,
  patientId: string,
  requester: OrderAttribution,
  options: BuildOptions,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    // 看護指示は入院患者にだけ出すので入外区分は入院で固定(食事と同じ)。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...NURSING_ORDER_TYPE }] },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: "inpatient",
            display: displayOf(SETTING_OPTIONS, "inpatient"),
          },
        ],
      },
    ],
    code: itemCodeableConcept(line),
    subject: { reference: `Patient/${patientId}` },
    authoredOn: options.authoredOn ?? today(),
    occurrenceDateTime: line.startDate,
    requisition: { system: NURSING_REQUISITION_SYSTEM, value: options.requisition },
  };

  if (options.serviceRequestId) resource.id = options.serviceRequestId;
  if (options.encounterId) resource.encounter = { reference: `Encounter/${options.encounterId}` };

  const condition = line.condition.trim();
  if (condition) resource.orderDetail = [{ text: condition }];

  // 終了日と頻度はどちらも root 拡張。依頼科・病棟は applyOrderContext がこの配列に足す。
  const extensions: fhir4.Extension[] = [];
  if (line.endDate) extensions.push({ url: NURSING_ORDER_END_EXT_URL, valueDate: line.endDate });
  const schedule = nursingScheduleExtension(line.schedule);
  if (schedule) extensions.push(schedule);
  if (extensions.length > 0) resource.extension = extensions;

  if (line.comment.trim()) resource.note = [{ text: line.comment.trim() }];

  if (options.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${options.problem.conditionId}`,
        display: options.problem.display,
      },
    ];
  }

  // 依頼医師・依頼科・入院病棟。終了の拡張を先に積んであるので足す形で効く。
  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/**
 * 新規登録。行ごとに ServiceRequest と「指示受け待ち」の Task を作り、全行を
 * 1 transaction に載せる。Task の focus は同じ Bundle 内の fullUrl(urn:uuid)で、
 * 上流が transaction 内で実 id に解決する(生理検査の即実施と同じ作り)。
 */
export function buildNursingOrderBundle(
  values: NursingOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  encounterId: string | undefined,
): fhir4.Bundle {
  const requisition = crypto.randomUUID();
  return transactionBundle(
    values.lines.flatMap((line) => {
      const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
      const sr = buildNursingOrderServiceRequest(line, patientId, requester, {
        encounterId,
        requisition,
        problem: values.problem,
      });
      return [
        { fullUrl, resource: sr, request: { method: "POST", url: "ServiceRequest" } },
        {
          resource: buildNursingTaskUpdate(undefined, sr, "requested", fullUrl),
          request: { method: "POST", url: "Task" },
        },
      ];
    }),
  );
}

/** 1 行の更新。束ね(requisition)・入院・発行日は元のリソースから引き継ぐ。 */
export function buildNursingOrderUpdateBundle(
  line: NursingOrderLineValues,
  problem: ProblemRef | null,
  patientId: string,
  original: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  const resource = buildNursingOrderServiceRequest(line, patientId, requester, {
    encounterId: original.encounter?.reference?.split("/")[1],
    requisition: original.requisition?.value ?? crypto.randomUUID(),
    problem,
    serviceRequestId: original.id,
    authoredOn: original.authoredOn,
  });
  // 中止・終了済みを編集で有効に戻さない。
  resource.status = original.status;
  return transactionBundle([
    { resource, request: { method: "PUT", url: `ServiceRequest/${original.id}` } },
  ]);
}

/** 継続中の指示に終了日を書き足す PUT エントリ(食事・リハビリと同じ形)。 */
export function buildNursingOrderCloseEntry(
  sr: fhir4.ServiceRequest,
  endDate: string,
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== NURSING_ORDER_END_EXT_URL),
      { url: NURSING_ORDER_END_EXT_URL, valueDate: endDate },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/** 退院などで指示を打ち切る PUT エントリ(対象が無ければ空配列)。 */
export function buildNursingOrderStopEntries(
  orders: fhir4.ServiceRequest[],
  endDate: string,
): fhir4.BundleEntry[] {
  return orders
    .filter((sr) => nursingOrderNeedsStop(sr, endDate))
    .map((sr) => buildNursingOrderCloseEntry(sr, endDate));
}

/** 中止。指示そのものを取り下げる(終了日で自然に終わるのとは別)。 */
export function buildNursingOrderRevokeEntry(sr: fhir4.ServiceRequest): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = { ...sr, status: "revoked" };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

// ---- 読み取り ----

export function nursingOrderEnd(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === NURSING_ORDER_END_EXT_URL)?.valueDate ?? "";
}

export function nursingOrderStart(sr: fhir4.ServiceRequest): string {
  return (sr.occurrenceDateTime ?? "").slice(0, 10);
}

export function nursingOrderRequisition(sr: fhir4.ServiceRequest): string {
  return sr.requisition?.system === NURSING_REQUISITION_SYSTEM ? (sr.requisition.value ?? "") : "";
}

export function nursingOrderEndsOnOrAfter(sr: fhir4.ServiceRequest, at: string): boolean {
  const end = nursingOrderEnd(sr);
  return !end || end >= at;
}

/** 指定の日に効いている指示か(その日までに始まり、まだ終わっていない)。 */
export function isNursingOrderRunningOn(sr: fhir4.ServiceRequest, at: string): boolean {
  const start = nursingOrderStart(sr);
  if (!start || start > at) return false;
  return nursingOrderEndsOnOrAfter(sr, at);
}

/** 指定の日より後まで続いてしまう指示か(= 退院で打ち切る必要があるか)。 */
export function nursingOrderNeedsStop(sr: fhir4.ServiceRequest, endDate: string): boolean {
  if (sr.status !== "active") return false;
  const end = nursingOrderEnd(sr);
  return !end || end > endDate;
}

/** 指示簿のグループ分けのキー。行為は第 1・第 2 階層(16 桁コードの先頭 8 桁)。 */
export type NursingOrderGroup =
  | { kind: "act"; level1Code: string; level2Code: string }
  | { kind: "observation" }
  | { kind: "free" };

export function nursingOrderItem(sr: fhir4.ServiceRequest): NursingItemRef {
  const act = codingBySystem(sr.code?.coding, NURSING_ACT_CODE_SYSTEM);
  if (act?.code) {
    return {
      kind: "act",
      code16: act.code,
      manageNo: codingBySystem(sr.code?.coding, NURSING_ACT_MANAGE_NO_SYSTEM)?.code ?? "",
      display: act.display ?? "",
    };
  }
  const obs = codingBySystem(sr.code?.coding, NURSING_OBSERVATION_CODE_SYSTEM);
  if (obs?.code) return { kind: "observation", manageNo: obs.code, display: obs.display ?? "" };
  return null;
}

/** 16 桁コードのうち行為(第 3 階層)までの部分。修飾語の選択肢を引くのに使う。 */
export function nursingActLevel3Code(code16: string): string {
  return code16.slice(8, 12);
}

export function nursingOrderGroup(sr: fhir4.ServiceRequest): NursingOrderGroup {
  const item = nursingOrderItem(sr);
  if (!item) return { kind: "free" };
  if (item.kind === "observation") return { kind: "observation" };
  return { kind: "act", level1Code: item.code16.slice(0, 4), level2Code: item.code16.slice(4, 8) };
}

export type NursingOrderState = "active" | "ended" | "revoked" | "completed" | "other";

/** 指示の状態。有効でも終了日を過ぎていれば「終了」。 */
export function nursingOrderState(sr: fhir4.ServiceRequest, at: string): NursingOrderState {
  if (sr.status === "revoked") return "revoked";
  if (sr.status === "completed") return "completed";
  if (sr.status !== "active") return "other";
  return nursingOrderEndsOnOrAfter(sr, at) ? "active" : "ended";
}

export const NURSING_ORDER_STATE_LABELS: Record<NursingOrderState, string> = {
  active: "有効",
  ended: "終了",
  revoked: "中止",
  completed: "終了",
  other: "-",
};

export interface NursingOrderSummary {
  /** 指示内容(code.text、無ければ用語名)。 */
  text: string;
  /** 頻度のラベルと条件を " / " で繋いだ表示。 */
  frequency: string;
  /** 頻度(Timing)。適宜など予定を持たない指示は undefined。 */
  schedule: fhir4.Timing | undefined;
  condition: string;
  startDate: string;
  endDate: string;
  requesterName: string;
  comment: string;
  requisition: string;
  authoredOn: string;
  group: NursingOrderGroup;
  /** 用語の参照(詳細でコードを出すため)。自由記載は null。 */
  item: NursingItemRef;
}

/**
 * 一覧の期間表示。同じ入院の中で見るものなので年は省く(年をまたぐ指示だけ年を付ける)。
 * 列を「開始」「終了」に分けると左ペインの幅では日付が折り返すため 1 セルにまとめる。
 */
export function nursingOrderPeriodLabel(summary: NursingOrderSummary, at: string): string {
  const year = at.slice(0, 4);
  const short = (date: string) => (date.slice(0, 4) === year ? date.slice(5) : date);
  if (!summary.startDate) return "";
  return summary.endDate
    ? `${short(summary.startDate)} 〜 ${short(summary.endDate)}`
    : `${short(summary.startDate)} 〜`;
}

export function summarizeNursingOrder(sr: fhir4.ServiceRequest): NursingOrderSummary {
  const schedule = nursingScheduleOf(sr);
  const condition = sr.orderDetail?.[0]?.text ?? "";
  return {
    text: sr.code?.text || nursingOrderItem(sr)?.display || "",
    frequency: [nursingScheduleLabel(schedule), condition].filter(Boolean).join(" / "),
    schedule,
    condition,
    startDate: nursingOrderStart(sr),
    endDate: nursingOrderEnd(sr),
    requesterName: sr.requester?.display ?? "",
    comment: orderComment(sr),
    requisition: nursingOrderRequisition(sr),
    authoredOn: sr.authoredOn ?? "",
    group: nursingOrderGroup(sr),
    item: nursingOrderItem(sr),
  };
}

export const nursingOrderProblem = orderProblem;

export function parseNursingOrderLine(sr: fhir4.ServiceRequest): NursingOrderLineValues {
  const item = nursingOrderItem(sr);
  return {
    item,
    text: sr.code?.text || item?.display || "",
    schedule: timingToScheduleValues(nursingScheduleOf(sr)),
    condition: sr.orderDetail?.[0]?.text ?? "",
    startDate: nursingOrderStart(sr) || today(),
    endDate: nursingOrderEnd(sr),
    comment: orderComment(sr),
  };
}

export function parseNursingOrderForm(sr: fhir4.ServiceRequest): NursingOrderFormValues {
  return { lines: [parseNursingOrderLine(sr)], problem: nursingOrderProblem(sr) };
}
