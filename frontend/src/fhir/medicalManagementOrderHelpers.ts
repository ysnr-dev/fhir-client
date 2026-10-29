import { shortDate, today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { advisoryKey, type Advisory } from "./advisoryHelpers";
import {
  categoryCoding,
  codingBySystem,
  displayOf,
  orderComment,
  orderDay,
  registrationAuthoredOn,
  transactionBundle,
  withVersionLock,
} from "./shared";
import { ORDER_TYPE_SYSTEM, applyOrderContext, departmentExtension, type OrderAttribution } from "./orderHeader";
import { SETTING_OPTIONS, SETTING_SYSTEM, type PrescriptionSetting } from "./prescriptionHelpers";

// 指導・管理料(医学管理料・在宅)のオーダー(docs/medical-management-order-design.md)。
//
// 部門が受けて実施する種別ではなく、医師が「この日に算定した」ことを記録するので、
// 登録と同時に実施済にする。ヘッダの ServiceRequest(status = completed)と、算定する
// 項目ごとの実施記録(Procedure のハブ)・加算(ハブの子)を 1 つの transaction で書く。
// 医事会計は他部門と同じく実施記録から剤を組む(項目 1 つ = 1 剤)。
//
//   ServiceRequest  code.text = 項目名のまとめ / occurrenceDateTime = 算定日 / note = 備考
//   Procedure(ハブ) code = レセ電算コード / basedOn = ヘッダ / performer = 指示医師
//   Procedure(加算) partOf = ハブ / basedOn = ヘッダ(1 本の _revinclude で一緒に引くため)
//
// 備考は ServiceRequest に置き、Procedure.note は使わない。実施記録の note は会計送信で
// フリーコメントとして日レセへ送られるため。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const MEDICAL_MANAGEMENT_ORDER_TYPE = {
  code: "medical-management",
  display: "指導・管理料",
};

/** 実施記録の手技コード(レセ電算 診療行為コード)。会計は `{種別}-procedure-code` を読む。 */
export const MEDICAL_MANAGEMENT_PROCEDURE_CODE_SYSTEM =
  "http://fhir-client.local/CodeSystem/medical-management-procedure-code";

const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

// ---- フォームの値 ----

export interface MedicalManagementAddition {
  /** レセ電算コード。 */
  code: string;
  name: string;
}

/** 算定する項目 1 つ。項目マスタの行ではなくレセ電算コードで持つ(実施記録に残るのがコードのため)。 */
export interface MedicalManagementLine {
  code: string;
  name: string;
  additions: MedicalManagementAddition[];
}

export interface MedicalManagementOrderFormValues {
  setting: PrescriptionSetting;
  /** 算定日。 */
  date: string;
  lines: MedicalManagementLine[];
  comment: string;
  problem: ProblemRef | null;
}

export function emptyMedicalManagementOrderForm(
  setting: PrescriptionSetting,
): MedicalManagementOrderFormValues {
  return { setting, date: today(), lines: [], comment: "", problem: null };
}

export function validateMedicalManagementOrderForm(
  values: MedicalManagementOrderFormValues,
  /** requireDates を偽にすると算定日を求めない(セットの内容としての入力)。 */
  { requireDates = true }: { requireDates?: boolean } = {},
): string {
  if (values.lines.length === 0) return "算定する項目を選んでください。";
  if (requireDates && !values.date) return "算定日を入れてください。";
  return "";
}

/** 点数の表示(「225点」)。診療行為マスタの点数は "225.0" のような文字列で届く。 */
export function formatPoints(points: string | null | undefined): string {
  if (points == null || points === "") return "";
  const value = Number(points);
  return Number.isFinite(value) ? `${value}点` : "";
}

// ---- FHIR リソースの組み立て ----

export function isMedicalManagementServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === MEDICAL_MANAGEMENT_ORDER_TYPE.code;
}

export function isMedicalManagementProcedure(procedure: fhir4.Procedure): boolean {
  return codingBySystem(procedure.category?.coding, ORDER_TYPE_SYSTEM)?.code === MEDICAL_MANAGEMENT_ORDER_TYPE.code;
}

/** カード・履歴・会計の名称に使う、項目名のまとめ(「特定疾患療養管理料 ほか1件」)。 */
function linesTitle(lines: MedicalManagementLine[]): string {
  if (lines.length === 0) return MEDICAL_MANAGEMENT_ORDER_TYPE.display;
  return lines.length === 1 ? lines[0].name : `${lines[0].name} ほか${lines.length - 1}件`;
}

function buildServiceRequest(
  values: MedicalManagementOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "completed",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...MEDICAL_MANAGEMENT_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    code: { text: linesTitle(values.lines) },
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 算定日。カルテのカードもこの日に置く。
    occurrenceDateTime: values.date,
  };
  if (serviceRequestId) resource.id = serviceRequestId;
  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];
  if (values.problem) {
    resource.reasonReference = [
      { reference: `Condition/${values.problem.conditionId}`, display: values.problem.display },
    ];
  }
  applyOrderContext(resource, requester);
  return resource;
}

function buildProcedure(
  code: string,
  name: string,
  values: MedicalManagementOrderFormValues,
  patientId: string,
  orderRef: string,
  requester: OrderAttribution,
  hubRef?: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...MEDICAL_MANAGEMENT_ORDER_TYPE }] },
    code: {
      coding: [{ system: MEDICAL_MANAGEMENT_PROCEDURE_CODE_SYSTEM, code, display: name }],
      text: name,
    },
    subject: { reference: `Patient/${patientId}` },
    basedOn: [{ reference: orderRef }],
    performedDateTime: values.date,
  };
  if (hubRef) procedure.partOf = [{ reference: hubRef }];
  if (requester.practitionerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${requester.practitionerId}`,
          ...(requester.practitionerName ? { display: requester.practitionerName } : {}),
        },
      },
    ];
  }
  if (requester.departmentId) {
    procedure.extension = [departmentExtension(requester.departmentId, requester.departmentName)];
  }
  return procedure;
}

/** 実施記録の id で引けるように。新規は urn:uuid の fullUrl で POST する。 */
function procedureEntry(procedure: fhir4.Procedure, id: string | undefined): fhir4.BundleEntry & { ref: string } {
  if (id) {
    return {
      ref: `Procedure/${id}`,
      resource: { ...procedure, id },
      request: { method: "PUT", url: `Procedure/${id}` },
    };
  }
  const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
  return { ref: fullUrl, fullUrl, resource: procedure, request: { method: "POST", url: "Procedure" } };
}

/**
 * 項目ごとのハブと加算の実施記録。編集では同じコードの記録を使い回して PUT し
 * (会計の送り直しで同じ剤と分かるように)、外した項目・加算の記録は消す(子 → ハブの順)。
 */
function procedureEntries(
  values: MedicalManagementOrderFormValues,
  patientId: string,
  orderRef: string,
  requester: OrderAttribution,
  existing: fhir4.Procedure[],
): fhir4.BundleEntry[] {
  const hubs = existing.filter((p) => !p.partOf?.length);
  const childrenOf = (hubId: string | undefined) =>
    existing.filter((p) => hubId && p.partOf?.some((ref) => ref.reference === `Procedure/${hubId}`));
  const kept = new Set<string>();
  const take = (candidates: fhir4.Procedure[], code: string) => {
    const found = candidates.find((p) => p.id && !kept.has(p.id) && procedureCode(p) === code);
    if (found?.id) kept.add(found.id);
    return found?.id;
  };

  const entries: fhir4.BundleEntry[] = [];
  for (const line of values.lines) {
    const hubId = take(hubs, line.code);
    const hub = procedureEntry(
      buildProcedure(line.code, line.name, values, patientId, orderRef, requester),
      hubId,
    );
    entries.push(stripRef(hub));
    const children = childrenOf(hubId);
    for (const addition of line.additions) {
      const child = procedureEntry(
        buildProcedure(addition.code, addition.name, values, patientId, orderRef, requester, hub.ref),
        take(children, addition.code),
      );
      entries.push(stripRef(child));
    }
  }

  const dropped = existing.filter((p) => p.id && !kept.has(p.id));
  const ordered = [...dropped.filter((p) => p.partOf?.length), ...dropped.filter((p) => !p.partOf?.length)];
  for (const p of ordered) entries.push({ request: { method: "DELETE", url: `Procedure/${p.id}` } });
  return entries;
}

function stripRef({ ref: _ref, ...entry }: fhir4.BundleEntry & { ref: string }): fhir4.BundleEntry {
  return entry;
}

/** 新規登録。ヘッダと実施記録を 1 つの transaction で書く。 */
export function buildMedicalManagementOrderBundle(
  values: MedicalManagementOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
  return transactionBundle([
    {
      // fullUrl は来歴(Provenance)がこのオーダーを指すのと、実施記録の basedOn に使う。
      fullUrl,
      resource: buildServiceRequest(values, patientId, requester, registrationAuthoredOn()),
      request: { method: "POST", url: "ServiceRequest" },
    },
    ...procedureEntries(values, patientId, fullUrl, requester, []),
  ]);
}

/** 更新。依頼科・指示医師・登録日時は元のオーダーから引き継ぐ。 */
export function buildMedicalManagementOrderUpdateBundle(
  values: MedicalManagementOrderFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
  procedures: fhir4.Procedure[],
  requester: OrderAttribution,
): fhir4.Bundle {
  const id = existing.id ?? "";
  const bundle = transactionBundle([
    {
      resource: buildServiceRequest(values, patientId, requester, registrationAuthoredOn(existing), id),
      request: { method: "PUT", url: `ServiceRequest/${id}` },
    },
    ...procedureEntries(values, patientId, `ServiceRequest/${id}`, requester, procedures),
  ]);
  return withVersionLock(bundle, existing, ...procedures);
}

/** 削除。実施記録(子 → ハブ)と一緒にヘッダを消す。 */
export function buildMedicalManagementOrderDeleteBundle(
  srId: string,
  procedures: fhir4.Procedure[],
): fhir4.Bundle {
  const ordered = [...procedures.filter((p) => p.partOf?.length), ...procedures.filter((p) => !p.partOf?.length)];
  return transactionBundle([
    ...ordered.map((p) => ({ request: { method: "DELETE" as const, url: `Procedure/${p.id}` } })),
    { request: { method: "DELETE", url: `ServiceRequest/${srId}` } },
  ]);
}

/** DO(流用)。算定日を当日に戻し、入外区分はいまの状態に合わせる。 */
export function buildDoMedicalManagementOrderForm(
  values: MedicalManagementOrderFormValues,
  setting: PrescriptionSetting,
): MedicalManagementOrderFormValues {
  return { ...values, setting, date: today() };
}

// ---- 一覧・カルテ表示のための parse ----

export function procedureCode(procedure: fhir4.Procedure): string {
  return codingBySystem(procedure.code?.coding, MEDICAL_MANAGEMENT_PROCEDURE_CODE_SYSTEM)?.code ?? "";
}

function procedureName(procedure: fhir4.Procedure): string {
  return procedure.code?.text || codingBySystem(procedure.code?.coding, MEDICAL_MANAGEMENT_PROCEDURE_CODE_SYSTEM)?.display || procedureCode(procedure);
}

function orderIdOf(procedure: fhir4.Procedure): string {
  const reference = procedure.basedOn?.[0]?.reference ?? "";
  return reference.startsWith("ServiceRequest/") ? reference.slice("ServiceRequest/".length) : "";
}

/** 有効な実施記録(取消・誤登録を除く)。 */
function alive(procedure: fhir4.Procedure): boolean {
  return procedure.status === "completed";
}

/** オーダーの算定項目(ハブ)ごとに、加算を束ねたもの。 */
export interface MedicalManagementItemDisplay {
  id: string;
  code: string;
  name: string;
  additions: { id: string; code: string; name: string }[];
}

/** 実施記録をオーダー(ヘッダ)ごとに、項目 + 加算の形に束ねる。他の種別の記録は無視する。 */
export function medicalManagementItemsByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, MedicalManagementItemDisplay[]> {
  const ours = procedures.filter((p) => isMedicalManagementProcedure(p) && alive(p));
  const result = new Map<string, MedicalManagementItemDisplay[]>();
  for (const hub of ours.filter((p) => !p.partOf?.length)) {
    const orderId = orderIdOf(hub);
    if (!orderId) continue;
    const additions = ours
      .filter((p) => p.partOf?.some((ref) => ref.reference === `Procedure/${hub.id}`))
      .map((p) => ({ id: p.id ?? "", code: procedureCode(p), name: procedureName(p) }));
    const items = result.get(orderId) ?? [];
    items.push({ id: hub.id ?? "", code: procedureCode(hub), name: procedureName(hub), additions });
    result.set(orderId, items);
  }
  return result;
}

/** オーダーに付いた実施記録(ハブと加算)。編集・削除で使う。 */
export function medicalManagementProceduresOf(
  procedures: fhir4.Procedure[],
  srId: string,
): fhir4.Procedure[] {
  return procedures.filter((p) => isMedicalManagementProcedure(p) && orderIdOf(p) === srId);
}

export interface MedicalManagementOrderSummary {
  settingDisplay: string;
  date: string;
  title: string;
  comment: string;
}

export function summarizeMedicalManagementOrder(sr: fhir4.ServiceRequest): MedicalManagementOrderSummary {
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    date: orderDay(sr),
    title: sr.code?.text ?? "",
    comment: orderComment(sr),
  };
}

export const medicalManagementOrderProblem = orderProblem;

/** 加算を字下げした項目の行(紹介状などへの転記・詳細表示用)。 */
export function medicalManagementItemLines(items: MedicalManagementItemDisplay[]): string[] {
  return items.flatMap((item) => [item.name, ...item.additions.map((a) => `　${a.name}`)]);
}

// ---- 編集フォームへの復元 ----

export function parseMedicalManagementOrderForm(
  sr: fhir4.ServiceRequest,
  procedures: fhir4.Procedure[],
): MedicalManagementOrderFormValues {
  const items = medicalManagementItemsByOrderId(medicalManagementProceduresOf(procedures, sr.id ?? "")).get(sr.id ?? "") ?? [];
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    date: orderDay(sr) || today(),
    lines: items.map((item) => ({
      code: item.code,
      name: item.name,
      additions: item.additions.map((a) => ({ code: a.code, name: a.name })),
    })),
    comment: orderComment(sr),
    problem: orderProblem(sr),
  };
}

// ---- 前回算定日・当月の回数 ----

export interface MedicalManagementHistory {
  /** 最後に算定した日。 */
  lastDate: string;
  /** その月(基準日の月)に算定した回数。 */
  monthCount: number;
}

/**
 * レセ電算コードごとの前回算定日と当月の回数。編集中のオーダー自身の記録は数えない
 * (保存し直すと置き換わるため)。加算もコードを持つので同じく数える。
 */
export function medicalManagementHistoryByCode(
  procedures: fhir4.Procedure[],
  baseDate: string,
  excludeOrderId?: string,
): Map<string, MedicalManagementHistory> {
  const month = baseDate.slice(0, 7);
  const result = new Map<string, MedicalManagementHistory>();
  for (const procedure of procedures) {
    if (!isMedicalManagementProcedure(procedure) || !alive(procedure)) continue;
    if (excludeOrderId && orderIdOf(procedure) === excludeOrderId) continue;
    const code = procedureCode(procedure);
    const date = (procedure.performedDateTime ?? "").slice(0, 10);
    if (!code || !date) continue;
    const current = result.get(code) ?? { lastDate: "", monthCount: 0 };
    if (date > current.lastDate) current.lastDate = date;
    if (date.slice(0, 7) === month) current.monthCount += 1;
    result.set(code, current);
  }
  return result;
}

/** 「前回 9/12・当月 1/2回」。履歴も上限も無ければ空。 */
export function historyLabel(history: MedicalManagementHistory | undefined, limit: number | null): string {
  const parts: string[] = [];
  if (history?.lastDate) parts.push(`前回 ${shortDate(history.lastDate)}`);
  if (limit) parts.push(`当月 ${history?.monthCount ?? 0}/${limit}回`);
  else if (history?.monthCount) parts.push(`当月 ${history.monthCount}回`);
  return parts.join("・");
}

/** 選んだ項目のうち、当月の算定がマスタの上限に達しているもの。表示のみの警告にする。 */
export function medicalManagementLimitAdvisories(
  lines: MedicalManagementLine[],
  history: Map<string, MedicalManagementHistory>,
  limits: Map<string, number | null>,
): Advisory[] {
  return lines.flatMap((line) => {
    const limit = limits.get(line.code);
    const count = history.get(line.code)?.monthCount ?? 0;
    if (!limit || count + 1 <= limit) return [];
    return [
      {
        key: advisoryKey("management-fee-limit", line.code),
        kind: "management-fee-limit" as const,
        severity: "info" as const,
        message: `${line.name}は当月すでに${count}回算定しています(上限${limit}回)`,
      },
    ];
  });
}
