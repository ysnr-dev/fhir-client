import { diffDays, localDay, toFhirDateTime, today } from "../lib/dates";
import type { ValidationFailure } from "../lib/validation";
import { ORDER_TYPE_SYSTEM, departmentExtension, departmentOf } from "./orderHeader";
import { categoryCoding, displayOf, referenceId, transactionBundle, withVersionLock } from "./shared";

// 地域連携の紹介台帳(docs/referral-design.md)。
//
// 他院から受けた紹介(紹介受)と、他院へ出した紹介(紹介・逆紹介・転院)を 1 件ずつ ServiceRequest で持つ。
// 部門オーダーではないのでカルテのカードにはせず(fhir/orderKinds.ts に入れない)、地域連携の一覧と
// プロファイルタブで見る。
//
//   紹介受 … requester = 紹介元の医療機関、performer = 自院の担当医
//   紹介   … requester = 自院の担当医、performer = 紹介先の医療機関
//
// 進み具合は status(active = 進行中 / completed = 完了 / revoked = 取消)と、受診日・返書の拡張で表す。

/** オーダー種別(category)。カルテのオーダー検索はこの種別を外す。 */
export const REFERRAL_ORDER_TYPE = { code: "referral", display: "紹介" };
export const REFERRAL_ORDER_TYPE_TOKEN = `${ORDER_TYPE_SYSTEM}|${REFERRAL_ORDER_TYPE.code}`;

export const REFERRAL_DIRECTION_SYSTEM = "http://fhir-client.local/CodeSystem/referral-direction";
export const REFERRAL_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/referral-kind";

const PARTNER_PRACTITIONER_EXT_URL = "http://fhir-client.local/StructureDefinition/referral-partner-practitioner";
const VISIT_DATE_EXT_URL = "http://fhir-client.local/StructureDefinition/referral-visit-date";
const REPLY_EXT_URL = "http://fhir-client.local/StructureDefinition/referral-reply";

export type ReferralDirection = "inbound" | "outbound";

export const REFERRAL_DIRECTION_OPTIONS: { code: ReferralDirection; display: string }[] = [
  { code: "inbound", display: "紹介受" },
  { code: "outbound", display: "紹介" },
];

/** 紹介の区分。紹介受と紹介で選択肢が違う。逆紹介率は outbound の counter-referral を数える。 */
export const REFERRAL_KIND_OPTIONS: Record<ReferralDirection, { code: string; display: string }[]> = {
  inbound: [
    { code: "visit", display: "診察" },
    { code: "admission", display: "入院" },
    { code: "exam", display: "検査" },
  ],
  outbound: [
    { code: "referral", display: "紹介" },
    { code: "counter-referral", display: "逆紹介" },
    { code: "transfer", display: "転院" },
  ],
};

export const COUNTER_REFERRAL_KIND = "counter-referral";

/** 返書の区分。最終報告(紹介受)・返書受領(紹介)を記録すると台帳は完了になる。 */
export const REFERRAL_REPLY_KIND_OPTIONS: Record<
  ReferralDirection,
  { code: string; display: string; final: boolean }[]
> = {
  inbound: [
    { code: "visit-report", display: "受診報告", final: false },
    { code: "interim-report", display: "中間報告", final: false },
    { code: "final-report", display: "最終報告", final: true },
  ],
  outbound: [
    { code: "received", display: "返書受領", final: true },
    { code: "interim-received", display: "経過報告受領", final: false },
  ],
};

export type ReferralStatus = "waiting" | "reply-pending" | "completed" | "revoked";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  waiting: "受診待ち",
  "reply-pending": "返書待ち",
  completed: "完了",
  revoked: "取消",
};

/** 受診(紹介受)・紹介(紹介)から返書までの日数がこれを超えたら遅れとして示す。 */
export const REFERRAL_REPLY_OVERDUE_DAYS = 14;

// ---- フォームの値 ----

export interface ReferralFormValues {
  direction: ReferralDirection;
  kind: string;
  /** 紹介日(紹介状の日付・申込日)。 */
  referralDate: string;
  /** 紹介受: 受診予定日。紹介: 紹介先の受診予定日。任意。 */
  plannedDate: string;
  partnerOrganizationId: string;
  partnerOrganizationName: string;
  /** 紹介元・紹介先の医師名。任意。 */
  partnerPractitionerName: string;
  departmentId: string;
  departmentName: string;
  practitionerId: string;
  practitionerName: string;
  /** 紹介の目的・傷病名。 */
  purpose: string;
  /** 紹介状・診療情報提供書(患者のファイル)。任意。 */
  documentId: string;
  documentName: string;
  comment: string;
}

export function emptyReferralForm(direction: ReferralDirection): ReferralFormValues {
  return {
    direction,
    kind: REFERRAL_KIND_OPTIONS[direction][0].code,
    referralDate: today(),
    plannedDate: "",
    partnerOrganizationId: "",
    partnerOrganizationName: "",
    partnerPractitionerName: "",
    departmentId: "",
    departmentName: "",
    practitionerId: "",
    practitionerName: "",
    purpose: "",
    documentId: "",
    documentName: "",
    comment: "",
  };
}

export function validateReferralForm(values: ReferralFormValues): ValidationFailure | null {
  if (!values.referralDate) return { field: "referralDate", message: "紹介日を入力してください" };
  if (!values.partnerOrganizationId) {
    return {
      field: "partnerOrganizationId",
      message: values.direction === "inbound" ? "紹介元を選択してください" : "紹介先を選択してください",
    };
  }
  if (!values.departmentId) return { field: "departmentId", message: "診療科を選択してください" };
  if (values.plannedDate && values.plannedDate < values.referralDate && values.direction === "outbound") {
    return { field: "plannedDate", message: "受診予定日は紹介日以降にしてください" };
  }
  return null;
}

// ---- 返書 ----

export interface ReferralReply {
  date: string;
  kind: string;
  note: string;
  recorderName: string;
  documentId: string;
  documentName: string;
}

export interface ReferralReplyInput {
  date: string;
  kind: string;
  note: string;
  documentId: string;
  documentName: string;
}

function replyExtension(input: ReferralReplyInput, recorder: { practitionerId: string; display: string } | null): fhir4.Extension {
  const parts: fhir4.Extension[] = [
    { url: "date", valueDate: input.date },
    { url: "kind", valueCode: input.kind },
  ];
  if (input.note.trim()) parts.push({ url: "note", valueString: input.note.trim() });
  if (recorder) {
    parts.push({
      url: "recorder",
      valueReference: { reference: `Practitioner/${recorder.practitionerId}`, display: recorder.display },
    });
  }
  if (input.documentId) {
    parts.push({
      url: "document",
      valueReference: {
        reference: `DocumentReference/${input.documentId}`,
        ...(input.documentName ? { display: input.documentName } : {}),
      },
    });
  }
  return { url: REPLY_EXT_URL, extension: parts };
}

function parseReply(extension: fhir4.Extension): ReferralReply {
  const part = (url: string) => extension.extension?.find((e) => e.url === url);
  return {
    date: part("date")?.valueDate ?? "",
    kind: part("kind")?.valueCode ?? "",
    note: part("note")?.valueString ?? "",
    recorderName: part("recorder")?.valueReference?.display ?? "",
    documentId: referenceId(part("document")?.valueReference?.reference) ?? "",
    documentName: part("document")?.valueReference?.display ?? "",
  };
}

export function replyKindDisplay(direction: ReferralDirection, code: string): string {
  return displayOf(REFERRAL_REPLY_KIND_OPTIONS[direction], code);
}

function isFinalReply(direction: ReferralDirection, code: string): boolean {
  return REFERRAL_REPLY_KIND_OPTIONS[direction].some((option) => option.code === code && option.final);
}

// ---- 組み立て ----

function dayToDateTime(date: string): string {
  return toFhirDateTime(`${date}T00:00`);
}

function buildReferralServiceRequest(
  values: ReferralFormValues,
  patientId: string,
  existing?: fhir4.ServiceRequest,
): fhir4.ServiceRequest {
  const direction = values.direction;
  const partner: fhir4.Reference = {
    reference: `Organization/${values.partnerOrganizationId}`,
    ...(values.partnerOrganizationName ? { display: values.partnerOrganizationName } : {}),
  };
  const own: fhir4.Reference | undefined = values.practitionerId
    ? {
        reference: `Practitioner/${values.practitionerId}`,
        ...(values.practitionerName ? { display: values.practitionerName } : {}),
      }
    : undefined;

  // 受診日と返書は編集フォームの管理外なので、既存の値を引き継ぐ。
  const kept = (existing?.extension ?? []).filter((e) => e.url === VISIT_DATE_EXT_URL || e.url === REPLY_EXT_URL);
  const extension: fhir4.Extension[] = [departmentExtension(values.departmentId, values.departmentName), ...kept];
  if (values.partnerPractitionerName.trim()) {
    extension.push({ url: PARTNER_PRACTITIONER_EXT_URL, valueString: values.partnerPractitionerName.trim() });
  }

  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    ...(existing?.id ? { id: existing.id } : {}),
    status: existing?.status ?? "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...REFERRAL_ORDER_TYPE }] },
      {
        coding: [
          { system: REFERRAL_DIRECTION_SYSTEM, code: direction, display: displayOf(REFERRAL_DIRECTION_OPTIONS, direction) },
        ],
      },
      {
        coding: [
          { system: REFERRAL_KIND_SYSTEM, code: values.kind, display: displayOf(REFERRAL_KIND_OPTIONS[direction], values.kind) },
        ],
      },
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn: dayToDateTime(values.referralDate),
    extension,
  };
  if (values.plannedDate) resource.occurrenceDateTime = dayToDateTime(values.plannedDate);
  if (direction === "inbound") {
    resource.requester = partner;
    if (own) resource.performer = [own];
  } else {
    if (own) resource.requester = own;
    resource.performer = [partner];
  }
  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];
  if (values.documentId) {
    resource.supportingInfo = [
      {
        reference: `DocumentReference/${values.documentId}`,
        ...(values.documentName ? { display: values.documentName } : {}),
      },
    ];
  }
  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];
  return resource;
}

export function buildReferralBundle(values: ReferralFormValues, patientId: string): fhir4.Bundle {
  return transactionBundle([
    {
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildReferralServiceRequest(values, patientId),
      request: { method: "POST", url: "ServiceRequest" },
    },
  ]);
}

export function buildReferralUpdateBundle(
  values: ReferralFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
): fhir4.Bundle {
  return withVersionLock(
    transactionBundle([
      {
        resource: buildReferralServiceRequest(values, patientId, existing),
        request: { method: "PUT", url: `ServiceRequest/${existing.id}` },
      },
    ]),
    existing,
  );
}

function putBundle(resource: fhir4.ServiceRequest): fhir4.Bundle {
  return transactionBundle([{ resource, request: { method: "PUT", url: `ServiceRequest/${resource.id}` } }]);
}

/** 受診日を記録する(空なら外す)。 */
export function buildReferralVisitBundle(sr: fhir4.ServiceRequest, visitDate: string): fhir4.Bundle {
  const rest = (sr.extension ?? []).filter((e) => e.url !== VISIT_DATE_EXT_URL);
  return putBundle({
    ...sr,
    extension: visitDate ? [...rest, { url: VISIT_DATE_EXT_URL, valueDate: visitDate }] : rest,
  });
}

/** 返書を 1 件足す。最終の区分なら完了にする。 */
export function buildReferralReplyBundle(
  sr: fhir4.ServiceRequest,
  input: ReferralReplyInput,
  recorder: { practitionerId: string; display: string } | null,
): fhir4.Bundle {
  const direction = referralDirectionOf(sr);
  return putBundle({
    ...sr,
    status: isFinalReply(direction, input.kind) ? "completed" : sr.status,
    extension: [...(sr.extension ?? []), replyExtension(input, recorder)],
  });
}

/** 最後の返書を取り消す。完了は進行中に戻す。 */
export function buildReferralReplyUndoBundle(sr: fhir4.ServiceRequest): fhir4.Bundle {
  const extension = [...(sr.extension ?? [])];
  const last = extension.map((e) => e.url).lastIndexOf(REPLY_EXT_URL);
  if (last >= 0) extension.splice(last, 1);
  return putBundle({ ...sr, status: sr.status === "completed" ? "active" : sr.status, extension });
}

/** 取消と、その取り消し。 */
export function buildReferralStatusBundle(sr: fhir4.ServiceRequest, status: "active" | "revoked" | "completed"): fhir4.Bundle {
  return putBundle({ ...sr, status });
}

// ---- 読み戻し ----

export function isReferralServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === REFERRAL_ORDER_TYPE.code;
}

export function referralDirectionOf(sr: fhir4.ServiceRequest): ReferralDirection {
  return categoryCoding(sr, REFERRAL_DIRECTION_SYSTEM)?.code === "outbound" ? "outbound" : "inbound";
}

export interface ReferralRow {
  id: string;
  serviceRequest: fhir4.ServiceRequest;
  patientId: string;
  patient?: fhir4.Patient;
  direction: ReferralDirection;
  kind: string;
  kindLabel: string;
  referralDate: string;
  plannedDate: string;
  visitDate: string;
  partnerOrganizationId: string;
  partnerOrganizationName: string;
  partnerPractitionerName: string;
  departmentId: string;
  departmentName: string;
  practitionerId: string;
  practitionerName: string;
  purpose: string;
  documentId: string;
  documentName: string;
  comment: string;
  replies: ReferralReply[];
  status: ReferralStatus;
  /** 返書待ちの起点(紹介受は受診日、紹介は紹介日)からの日数。返書待ちでなければ null。 */
  waitingDays: number | null;
}

export function referralRowOf(sr: fhir4.ServiceRequest, patient?: fhir4.Patient): ReferralRow {
  const direction = referralDirectionOf(sr);
  const partner = direction === "inbound" ? sr.requester : sr.performer?.[0];
  const own = direction === "inbound" ? sr.performer?.[0] : sr.requester;
  const department = departmentOf(sr);
  const kind = categoryCoding(sr, REFERRAL_KIND_SYSTEM)?.code ?? "";
  const referralDate = localDay(sr.authoredOn);
  const visitDate = sr.extension?.find((e) => e.url === VISIT_DATE_EXT_URL)?.valueDate ?? "";
  const replies = (sr.extension ?? []).filter((e) => e.url === REPLY_EXT_URL).map(parseReply);
  const document = sr.supportingInfo?.[0];

  let status: ReferralStatus;
  if (sr.status === "revoked") status = "revoked";
  else if (sr.status === "completed") status = "completed";
  else if (direction === "inbound" && !visitDate) status = "waiting";
  else status = "reply-pending";

  const origin = direction === "inbound" ? visitDate : referralDate;
  const lastReply = replies.length ? replies[replies.length - 1].date : "";
  const waitingDays =
    status === "reply-pending" && origin ? diffDays(lastReply > origin ? lastReply : origin, today()) : null;

  return {
    id: sr.id ?? "",
    serviceRequest: sr,
    patientId: referenceId(sr.subject?.reference) ?? "",
    patient,
    direction,
    kind,
    kindLabel: displayOf(REFERRAL_KIND_OPTIONS[direction], kind),
    referralDate,
    plannedDate: localDay(sr.occurrenceDateTime),
    visitDate,
    partnerOrganizationId: referenceId(partner?.reference) ?? "",
    partnerOrganizationName: partner?.display ?? "",
    partnerPractitionerName: sr.extension?.find((e) => e.url === PARTNER_PRACTITIONER_EXT_URL)?.valueString ?? "",
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    practitionerId: referenceId(own?.reference) ?? "",
    practitionerName: own?.display ?? "",
    purpose: sr.reasonCode?.[0]?.text ?? "",
    documentId: referenceId(document?.reference) ?? "",
    documentName: document?.display ?? "",
    comment: sr.note?.[0]?.text ?? "",
    replies,
    status,
    waitingDays,
  };
}

export function referralFormOf(row: ReferralRow): ReferralFormValues {
  return {
    direction: row.direction,
    kind: row.kind || REFERRAL_KIND_OPTIONS[row.direction][0].code,
    referralDate: row.referralDate,
    plannedDate: row.plannedDate,
    partnerOrganizationId: row.partnerOrganizationId,
    partnerOrganizationName: row.partnerOrganizationName,
    partnerPractitionerName: row.partnerPractitionerName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    practitionerId: row.practitionerId,
    practitionerName: row.practitionerName,
    purpose: row.purpose,
    documentId: row.documentId,
    documentName: row.documentName,
    comment: row.comment,
  };
}

// ---- 集計 ----

export interface ReferralPartnerCount {
  organizationId: string;
  organizationName: string;
  inbound: number;
  outbound: number;
  counterReferral: number;
}

export interface ReferralStats {
  inbound: number;
  outbound: number;
  counterReferral: number;
  /** 紹介受のうち受診済みの件数と、そのうち返書(区分を問わず)を 1 通以上出した件数。 */
  inboundVisited: number;
  inboundReplied: number;
  /** 返書待ちのまま REFERRAL_REPLY_OVERDUE_DAYS を超えた件数。 */
  replyOverdue: number;
  partners: ReferralPartnerCount[];
}

/** 取消を除いた紹介の件数と、連携先ごとの内訳(紹介受の多い順)。 */
export function referralStatsOf(rows: readonly ReferralRow[]): ReferralStats {
  const stats: ReferralStats = {
    inbound: 0,
    outbound: 0,
    counterReferral: 0,
    inboundVisited: 0,
    inboundReplied: 0,
    replyOverdue: 0,
    partners: [],
  };
  const partners = new Map<string, ReferralPartnerCount>();
  for (const row of rows) {
    if (row.status === "revoked") continue;
    let partner = partners.get(row.partnerOrganizationId);
    if (!partner) {
      partner = {
        organizationId: row.partnerOrganizationId,
        organizationName: row.partnerOrganizationName,
        inbound: 0,
        outbound: 0,
        counterReferral: 0,
      };
      partners.set(row.partnerOrganizationId, partner);
    }
    if (row.direction === "inbound") {
      stats.inbound += 1;
      partner.inbound += 1;
      if (row.visitDate) {
        stats.inboundVisited += 1;
        if (row.replies.length) stats.inboundReplied += 1;
      }
    } else {
      stats.outbound += 1;
      partner.outbound += 1;
      if (row.kind === COUNTER_REFERRAL_KIND) {
        stats.counterReferral += 1;
        partner.counterReferral += 1;
      }
    }
    if (row.waitingDays !== null && row.waitingDays > REFERRAL_REPLY_OVERDUE_DAYS) stats.replyOverdue += 1;
  }
  stats.partners = [...partners.values()].sort(
    (a, b) => b.inbound - a.inbound || b.outbound - a.outbound || a.organizationName.localeCompare(b.organizationName, "ja"),
  );
  return stats;
}

/** 割合(%)を小数 1 桁で。分母が 0 なら空。 */
export function percentLabel(numerator: number, denominator: number): string {
  if (!denominator) return "";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
