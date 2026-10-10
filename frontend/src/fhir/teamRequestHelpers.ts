import { today } from "../lib/dates";
import { CARE_TEAM_KIND_SYSTEM, careTeamKindLabel } from "./careTeamHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  categoryCoding,
  codingBySystem,
  displayOf,
  orderComment,
  orderDay,
  referenceId,
  registrationAuthoredOn,
  transactionBundle,
  withVersionLock,
} from "./shared";
import { ORDER_TYPE_SYSTEM, applyOrderContext, type OrderAttribution } from "./orderHeader";
import { SETTING_OPTIONS, SETTING_SYSTEM, type PrescriptionSetting } from "./prescriptionHelpers";

// チーム依頼(docs/care-team-design.md §2)。NST・ICT・褥瘡対策・緩和ケアなどのチームへの介入依頼。
//
// 作りは他科依頼(consultOrderHelpers.ts)を写した「明細を持たないヘッダ 1 本」で、違うのは次の 3 点。
// - 宛先が CareTeam(performer[0])。チームの区分を code に写し、一覧の絞り込みに使う
// - 返ってくるのは 1 件の回答ではなく回診記録(診療記録)の積み重ね。介入の終了はチームが明示する
// - 次回回診日と最後の回診記録をローカル拡張に持つ(ワークリストが依頼を引くだけで描けるように)

export const TEAM_REQUEST_ORDER_TYPE = { code: "team-request", display: "チーム依頼" };

/** 依頼目的をテンプレートから書いたときの、記入内容(QuestionnaireResponse)への参照。 */
const PURPOSE_TEMPLATE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/team-request-purpose-questionnaire-response";
/** 次回回診日(日付)。回診記録の保存と一覧から更新する。 */
const NEXT_ROUND_EXT_URL = "http://fhir-client.local/StructureDefinition/team-request-next-round";
/** 最後の回診記録(Composition)と、その日付。表示用のキャッシュ(正本は Composition.event.detail)。 */
const LAST_ROUND_EXT_URL = "http://fhir-client.local/StructureDefinition/team-request-last-round";
const LAST_ROUND_DATE_EXT_URL = "http://fhir-client.local/StructureDefinition/team-request-last-round-date";

export type TeamRequestPriority = "routine" | "urgent";

export const TEAM_REQUEST_PRIORITY_OPTIONS: { code: TeamRequestPriority; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

// ---- フォームの値 ----

export interface TeamRequestFormValues {
  setting: PrescriptionSetting;
  /** 依頼先のチーム(CareTeam.id)。必須。 */
  teamId: string;
  teamName: string;
  /** チームの区分(care-team-kind)。code に写す。 */
  teamKind: string;
  priority: TeamRequestPriority;
  /** 希望日(必須)。オーダー開始日としてカルテのカードもこの日に載る。既定は今日。 */
  desiredDate: string;
  /** 依頼目的(必須)。テンプレートから書いた場合も平文はここに入る。 */
  purpose: string;
  purposeTemplate: TemplateBinding | null;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyTeamRequestForm(setting: PrescriptionSetting): TeamRequestFormValues {
  return {
    setting,
    teamId: "",
    teamName: "",
    teamKind: "",
    priority: "routine",
    desiredDate: today(),
    purpose: "",
    purposeTemplate: null,
    comment: "",
    problem: null,
  };
}

export function validateTeamRequestForm(
  values: TeamRequestFormValues,
  { requireDates = true }: { requireDates?: boolean } = {},
): string {
  if (!values.teamId) return "依頼先のチームを選んでください。";
  if (!values.purpose.trim()) return "依頼目的を入れてください。";
  if (requireDates && !values.desiredDate) return "希望日を入れてください。";
  return "";
}

// ---- FHIR リソースの組み立て ----

export function isTeamRequestServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === TEAM_REQUEST_ORDER_TYPE.code;
}

function buildTeamRequestServiceRequest(
  values: TeamRequestFormValues,
  patientId: string,
  requester: OrderAttribution,
  purposeTemplateRef: string,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...TEAM_REQUEST_ORDER_TYPE }] },
      ...(values.setting
        ? [{ coding: [{ system: SETTING_SYSTEM, code: values.setting, display: displayOf(SETTING_OPTIONS, values.setting) }] }]
        : []),
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    occurrenceDateTime: values.desiredDate,
    priority: values.priority,
    performer: [
      { reference: `CareTeam/${values.teamId}`, ...(values.teamName ? { display: values.teamName } : {}) },
    ],
  };
  if (serviceRequestId) resource.id = serviceRequestId;

  if (values.teamKind) {
    const display = careTeamKindLabel(values.teamKind);
    resource.code = { coding: [{ system: CARE_TEAM_KIND_SYSTEM, code: values.teamKind, display }], text: display };
  }
  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];
  if (purposeTemplateRef) {
    resource.extension = [
      ...(resource.extension ?? []),
      { url: PURPOSE_TEMPLATE_EXT_URL, valueReference: { reference: purposeTemplateRef } },
    ];
  }
  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];
  if (values.problem) {
    resource.reasonReference = [
      { reference: `Condition/${values.problem.conditionId}`, display: values.problem.display },
    ];
  }
  applyOrderContext(resource, requester);
  return resource;
}

/** 依頼目的のテンプレート記入内容を Bundle に積み、オーダーから指す参照を返す(他科依頼と同じ)。 */
function pushPurposeTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): { reference: string; keptResponseId: string } {
  if (!binding) return { reference: "", keptResponseId: "" };
  const { responseId, draft } = binding;
  if (!draft) {
    return responseId
      ? { reference: `QuestionnaireResponse/${responseId}`, keptResponseId: responseId }
      : { reference: "", keptResponseId: "" };
  }
  const reference = responseId ? `QuestionnaireResponse/${responseId}` : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({ resource: { ...draft.response, id: responseId }, request: { method: "PUT", url: reference } });
  } else {
    entries.push({ fullUrl: reference, resource: draft.response, request: { method: "POST", url: "QuestionnaireResponse" } });
  }
  entries.push(...draft.imageEntries);
  return { reference, keptResponseId: responseId ?? "" };
}

/** 新規登録。ヘッダ 1 件の POST。進捗 Task はチームが最初に触ったときに作る。 */
export function buildTeamRequestBundle(
  values: TeamRequestFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);
  entries.push({
    fullUrl: `urn:uuid:${crypto.randomUUID()}`,
    resource: buildTeamRequestServiceRequest(values, patientId, requester, template.reference, registrationAuthoredOn()),
    request: { method: "POST", url: "ServiceRequest" },
  });
  return transactionBundle(entries);
}

/** 更新。status・次回回診日・最後の回診記録は編集フォームの管理外なので、既存の値を引き継ぐ。 */
export function buildTeamRequestUpdateBundle(
  values: TeamRequestFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  const serviceRequestId = existing.id ?? "";
  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);
  const resource = buildTeamRequestServiceRequest(
    values,
    patientId,
    requester,
    template.reference,
    registrationAuthoredOn(existing),
    serviceRequestId,
  );
  resource.status = existing.status;
  const kept = (existing.extension ?? []).filter((e) =>
    [NEXT_ROUND_EXT_URL, LAST_ROUND_EXT_URL, LAST_ROUND_DATE_EXT_URL].includes(e.url),
  );
  if (kept.length > 0) resource.extension = [...(resource.extension ?? []), ...kept];
  entries.push({ resource, request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` } });
  for (const id of teamRequestResponseIds([existing])) {
    if (id !== template.keptResponseId) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }
  return withVersionLock(transactionBundle(entries), existing);
}

export function buildTeamRequestDeleteBundle(sr: fhir4.ServiceRequest): fhir4.Bundle {
  return transactionBundle([
    ...teamRequestResponseIds([sr]).map((id) => ({
      request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
    })),
    { request: { method: "DELETE", url: `ServiceRequest/${sr.id}` } },
  ]);
}

function withExtension(sr: fhir4.ServiceRequest, url: string, value: fhir4.Extension | null): fhir4.ServiceRequest {
  const rest = (sr.extension ?? []).filter((e) => e.url !== url);
  const extension = value ? [...rest, value] : rest;
  const next = { ...sr };
  if (extension.length > 0) next.extension = extension;
  else delete next.extension;
  return next;
}

/** 次回回診日を書き換えた依頼(空なら外す)。 */
export function withTeamRequestNextRound(sr: fhir4.ServiceRequest, date: string): fhir4.ServiceRequest {
  return withExtension(sr, NEXT_ROUND_EXT_URL, date ? { url: NEXT_ROUND_EXT_URL, valueDate: date } : null);
}

/**
 * 回診記録の保存で依頼側を書き換える PUT エントリ。最後の回診記録への参照と日付、次回回診日を書く。
 * roundReference は同じ transaction 内の Composition を指す `urn:uuid:...`(上流が実 ID に書き換える)。
 */
export function buildTeamRequestRoundEntry(
  sr: fhir4.ServiceRequest,
  args: { roundReference: string; roundDate: string; recorderName: string; nextRoundDate: string },
): fhir4.BundleEntry {
  let next = withExtension(sr, LAST_ROUND_EXT_URL, {
    url: LAST_ROUND_EXT_URL,
    valueReference: { reference: args.roundReference, ...(args.recorderName ? { display: args.recorderName } : {}) },
  });
  next = withExtension(next, LAST_ROUND_DATE_EXT_URL, { url: LAST_ROUND_DATE_EXT_URL, valueDate: args.roundDate });
  next = withTeamRequestNextRound(next, args.nextRoundDate);
  next.status = "active";
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/** 進捗の変更に合わせて ServiceRequest.status も動かす PUT エントリ。 */
export function buildTeamRequestStatusEntry(
  sr: fhir4.ServiceRequest,
  status: fhir4.ServiceRequest["status"],
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = { ...sr, status };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

export function buildDoTeamRequestForm(values: TeamRequestFormValues, setting: PrescriptionSetting): TeamRequestFormValues {
  return { ...values, setting, desiredDate: today(), purposeTemplate: null };
}

// ---- 読み出し ----

export function teamRequestTeam(sr: fhir4.ServiceRequest): { teamId: string; teamName: string } {
  const reference = sr.performer?.find((p) => p.reference?.startsWith("CareTeam/"));
  return { teamId: referenceId(reference?.reference) ?? "", teamName: reference?.display ?? "" };
}

export function teamRequestKind(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, CARE_TEAM_KIND_SYSTEM)?.code ?? "";
}

export function teamRequestPurpose(sr: fhir4.ServiceRequest): string {
  return sr.reasonCode?.[0]?.text ?? "";
}

export function teamRequestNextRound(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === NEXT_ROUND_EXT_URL)?.valueDate ?? "";
}

/** 最後の回診記録(Composition の id・日付・記録者)。まだ無ければ id は空。 */
export function teamRequestLastRound(sr: fhir4.ServiceRequest): { roundId: string; date: string; recorderName: string } {
  const reference = sr.extension?.find((e) => e.url === LAST_ROUND_EXT_URL)?.valueReference;
  return {
    roundId: referenceId(reference?.reference) ?? "",
    date: sr.extension?.find((e) => e.url === LAST_ROUND_DATE_EXT_URL)?.valueDate ?? "",
    recorderName: reference?.display ?? "",
  };
}

function purposeResponseIdOf(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === PURPOSE_TEMPLATE_EXT_URL)?.valueReference?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? "";
}

export function teamRequestResponseIds(serviceRequests: fhir4.ServiceRequest[]): string[] {
  return serviceRequests.map(purposeResponseIdOf).filter(Boolean);
}

export function teamRequestPurposeTemplate(sr: fhir4.ServiceRequest): TemplateBinding | null {
  const responseId = purposeResponseIdOf(sr);
  return responseId ? { responseId, draft: null } : null;
}

export interface TeamRequestSummary {
  settingDisplay: string;
  teamId: string;
  teamName: string;
  teamKind: string;
  teamKindDisplay: string;
  priority: TeamRequestPriority;
  urgent: boolean;
  desiredDate: string;
  purpose: string;
  comment: string;
  nextRoundDate: string;
  lastRoundId: string;
  lastRoundDate: string;
  lastRecorderName: string;
}

export function summarizeTeamRequest(sr: fhir4.ServiceRequest): TeamRequestSummary {
  const team = teamRequestTeam(sr);
  const kind = teamRequestKind(sr);
  const priority = (sr.priority === "urgent" ? "urgent" : "routine") as TeamRequestPriority;
  const last = teamRequestLastRound(sr);
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    teamId: team.teamId,
    teamName: team.teamName,
    teamKind: kind,
    teamKindDisplay: sr.code?.text || careTeamKindLabel(kind),
    priority,
    urgent: priority === "urgent",
    desiredDate: orderDay(sr),
    purpose: teamRequestPurpose(sr),
    comment: orderComment(sr),
    nextRoundDate: teamRequestNextRound(sr),
    lastRoundId: last.roundId,
    lastRoundDate: last.date,
    lastRecorderName: last.recorderName,
  };
}

export const teamRequestComment = orderComment;
export const teamRequestProblem = orderProblem;

export function parseTeamRequestForm(sr: fhir4.ServiceRequest): TeamRequestFormValues {
  const team = teamRequestTeam(sr);
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    teamId: team.teamId,
    teamName: team.teamName,
    teamKind: teamRequestKind(sr),
    priority: sr.priority === "urgent" ? "urgent" : "routine",
    desiredDate: (sr.occurrenceDateTime ?? "").slice(0, 10),
    purpose: teamRequestPurpose(sr),
    purposeTemplate: teamRequestPurposeTemplate(sr),
    comment: orderComment(sr),
    problem: orderProblem(sr),
  };
}
