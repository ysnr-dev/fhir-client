import { today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment, referenceId } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type OrderAttribution,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 他科依頼(コンサルテーション)オーダー(docs/consult-order-design.md)。
//
// これまでのオーダーは「部門に作業を頼み、結果や実施記録が返る」ものだったが、
// 他科依頼は「他の診療科の医師に判断を頼み、文章(診療記録)が返る」。
// 違うのは次の 3 点で、それ以外はリハビリ・食事と同じ「明細を持たないヘッダ 1 本」。
//
// - 依頼先が診療科ごとに変わるので、標準の performer に宛先を持つ(§2.1)。
//   依頼元の診療科はローカル拡張 order-department なので衝突しない。
// - 回答は診療記録(Composition)。依頼 → 回答の逆引きだけローカル拡張に持つ(§2.3)。
// - 進捗 Task と同じ transaction で ServiceRequest.status も動かす(§4)。
//   日付軸を持たないオーダーなので、部門一覧が未回答を絞る軸が status しか無い。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const CONSULT_ORDER_TYPE = { code: "consult", display: "他科依頼" };

/**
 * 依頼種別。施設ごとに増減する性質のものではないので DB マスタを持たず
 * ここに置く(docs/consult-order-design.md §2.2)。
 */
export const REQUEST_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/consult-request-type";

/**
 * 回答(Composition)への参照。上流は Composition.event を索引しておらず
 * `_revinclude` で回答を連れて来られないため、依頼側にも参照を持つ。
 * **正本は Composition.event.detail** で、こちらは表示のためのキャッシュ
 * (docs/consult-order-design.md §2.3)。
 */
const CONSULT_REPLY_EXT_URL = "http://fhir-client.local/StructureDefinition/consult-reply";

/**
 * 依頼目的をテンプレートから書いたときの、記入内容(QuestionnaireResponse)への参照。
 * 病理の臨床経過・放射線の特別指示と同じ作りで、平文は reasonCode.text に入れたまま
 * 回答も残す(将来の構造化出力と、テンプレートからの再編集のため)。
 */
const CONSULT_PURPOSE_TEMPLATE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/consult-purpose-questionnaire-response";

// ---- 固定の分類 ----

export type ConsultRequestType = "consult" | "opinion" | "exam" | "transfer";

/**
 * 依頼種別。「何をしてほしいか」で、依頼先科が対応の重さを測る手がかりにする。
 * 具体的な内容は依頼目的(自由記載)に書く。
 */
export const REQUEST_TYPE_OPTIONS: { code: ConsultRequestType; display: string }[] = [
  { code: "consult", display: "診察依頼" },
  { code: "opinion", display: "意見のみ" },
  { code: "exam", display: "検査依頼" },
  { code: "transfer", display: "転科相談" },
];

export function requestTypeDisplay(code: string): string {
  return displayOf(REQUEST_TYPE_OPTIONS, code);
}

/** オーダーの緊急度。他オーダーと同じく FHIR の priority をそのまま使う。 */
export type ConsultPriority = "routine" | "urgent";

export const CONSULT_PRIORITY_OPTIONS: { code: ConsultPriority; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

export function consultPriorityDisplay(code: string): string {
  return displayOf(CONSULT_PRIORITY_OPTIONS, code);
}

// ---- フォームの値 ----

export interface ConsultOrderFormValues {
  setting: PrescriptionSetting;
  authoredDate: string;
  /** 依頼先の診療科(Organization.id)。必須。 */
  targetDepartmentId: string;
  /** 一覧・カードで引き直さずに描くための名称。参照の display に埋める。 */
  targetDepartmentName: string;
  /** 指名する医師(Practitioner.id)。任意。 */
  targetPractitionerId: string;
  targetPractitionerName: string;
  requestType: ConsultRequestType | "";
  priority: ConsultPriority;
  /** 希望日(任意)。入れるとカルテのカードもこの日に載る。 */
  desiredDate: string;
  /** 依頼目的(必須)。テンプレートから書いた場合も平文はここに入る。 */
  purpose: string;
  /** 依頼目的がテンプレート由来なら、その記入内容への紐付け。 */
  purposeTemplate: TemplateBinding | null;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyConsultOrderForm(setting: PrescriptionSetting): ConsultOrderFormValues {
  return {
    setting,
    authoredDate: today(),
    targetDepartmentId: "",
    targetDepartmentName: "",
    targetPractitionerId: "",
    targetPractitionerName: "",
    requestType: "consult",
    priority: "routine",
    desiredDate: "",
    purpose: "",
    purposeTemplate: null,
    comment: "",
    problem: null,
  };
}

/** 入力の検証。空文字なら妥当(リハビリと同じくヘルパー側に置く)。 */
export function validateConsultOrderForm(values: ConsultOrderFormValues): string {
  if (!values.targetDepartmentId) return "依頼先の診療科を選んでください。";
  if (!values.requestType) return "依頼種別を選んでください。";
  if (!values.purpose.trim()) return "依頼目的を入れてください。";
  if (values.desiredDate && values.authoredDate && values.desiredDate < values.authoredDate) {
    return "希望日は依頼日と同じか、それより後にしてください。";
  }
  return "";
}

// ---- FHIR リソースの組み立て ----

/** 他科依頼の ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isConsultServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === CONSULT_ORDER_TYPE.code;
}

function buildConsultOrderServiceRequest(
  values: ConsultOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  /** 依頼目的の記入内容への参照。新規は urn:uuid、既存は QuestionnaireResponse/{id}。 */
  purposeTemplateRef: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    // 未回答。回答・取消で completed / revoked に動かす(§4)。
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...CONSULT_ORDER_TYPE }] },
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
    subject: { reference: `Patient/${patientId}` },
    authoredOn: values.authoredDate,
    priority: values.priority,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  // 希望日。任意なので、入れなかったオーダーはカルテの依頼日にカードが載る。
  if (values.desiredDate) resource.occurrenceDateTime = values.desiredDate;

  if (values.requestType) {
    const display = requestTypeDisplay(values.requestType);
    resource.code = {
      coding: [{ system: REQUEST_TYPE_SYSTEM, code: values.requestType, display }],
      text: display,
    };
  }

  // 依頼先。診療科(必須)が先頭、指名医師(任意)が 2 番目(§2.1)。
  const performer: fhir4.Reference[] = [
    {
      reference: `Organization/${values.targetDepartmentId}`,
      ...(values.targetDepartmentName ? { display: values.targetDepartmentName } : {}),
    },
  ];
  if (values.targetPractitionerId) {
    performer.push({
      reference: `Practitioner/${values.targetPractitionerId}`,
      ...(values.targetPractitionerName ? { display: values.targetPractitionerName } : {}),
    });
  }
  resource.performer = performer;

  // 依頼目的。何を聞きたいかそのものなので必須。コード化はしない
  // (テンプレートから書いた場合も、平文はここに入れて読む側の作りを変えない)。
  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];

  // テンプレート記入内容への参照。applyOrderContext より前に積んでおく
  // (あちらは既存の extension に足す形で効く)。
  if (purposeTemplateRef) {
    resource.extension = [
      ...(resource.extension ?? []),
      {
        url: CONSULT_PURPOSE_TEMPLATE_EXT_URL,
        valueReference: { reference: purposeTemplateRef },
      },
    ];
  }

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];

  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }

  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/**
 * 依頼目的のテンプレート記入内容を Bundle に積み、オーダーから指す参照を返す。
 *
 * オーダー本体と同じ transaction に載せるのは、先に単独で保存すると「オーダーを
 * 保存しなかったときに回答だけが残る」ため(病理の臨床経過・手術の術前指示と同じ)。
 * 参照が外れた回答は呼び出し側が DELETE する。
 */
function pushPurposeTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): { reference: string; keptResponseId: string } {
  if (!binding) return { reference: "", keptResponseId: "" };
  const { responseId, draft } = binding;
  if (!draft) {
    // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
    return responseId
      ? { reference: `QuestionnaireResponse/${responseId}`, keptResponseId: responseId }
      : { reference: "", keptResponseId: "" };
  }
  // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
  // 実 ID への解決は上流の transaction 処理に任せる。
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return { reference, keptResponseId: responseId ?? "" };
}

/**
 * 新規登録。明細が無いのでヘッダ 1 件の POST だけ。
 * 進捗 Task は依頼先科が最初に触ったときに作る(リハビリと同じ。Task が無い
 * オーダーは consultTaskStatus が「依頼済」と読む)。
 */
export function buildConsultOrderBundle(
  values: ConsultOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  // 記入内容はオーダーより先に置く(オーダーがプレースホルダで指すため)。
  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);
  entries.push({
    resource: buildConsultOrderServiceRequest(values, patientId, requester, template.reference),
    request: { method: "POST", url: "ServiceRequest" },
  });
  return transactionBundle(entries);
}

/**
 * 更新。status と回答への参照は編集フォームの管理外なので、既存の値を引き継ぐ
 * (編集で回答済の依頼が未回答に戻ってしまわないように)。
 */
export function buildConsultOrderUpdateBundle(
  values: ConsultOrderFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  const serviceRequestId = existing.id ?? "";

  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);

  const resource = buildConsultOrderServiceRequest(
    values,
    patientId,
    requester,
    template.reference,
    serviceRequestId,
  );
  resource.status = existing.status;
  const reply = existing.extension?.find((e) => e.url === CONSULT_REPLY_EXT_URL);
  if (reply) resource.extension = [...(resource.extension ?? []), reply];

  entries.push({
    resource,
    request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` },
  });

  // テンプレートを解除した(参照が外れた)記入内容も同じ transaction で消す。
  for (const id of consultOrderResponseIds([existing])) {
    if (id !== template.keptResponseId) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  return transactionBundle(entries);
}

/**
 * オーダーを消す Bundle。明細を持たないのでヘッダ 1 件だけだが、依頼目的を
 * テンプレートから書いていれば記入内容(QuestionnaireResponse)も道連れにする
 * (依頼が消えると誰も参照しない孤児になるため)。
 */
export function buildConsultOrderDeleteBundle(sr: fhir4.ServiceRequest): fhir4.Bundle {
  return transactionBundle([
    ...consultOrderResponseIds([sr]).map((id) => ({
      request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
    })),
    { request: { method: "DELETE", url: `ServiceRequest/${sr.id}` } },
  ]);
}

/**
 * 回答の保存で依頼側を書き換える PUT エントリ。status を completed にし、
 * 回答への参照を足す(docs/consult-order-design.md §2.3・§4)。
 *
 * replyReference は同じ transaction 内の Composition を指す `urn:uuid:...`。
 * 実 ID への書き換えは上流の transaction 処理が行う(診療記録がテンプレート回答の
 * QuestionnaireResponse を参照するのと同じやり方)。
 */
export function buildConsultOrderReplyEntry(
  sr: fhir4.ServiceRequest,
  replyReference: string,
  replierName: string,
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    status: "completed",
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== CONSULT_REPLY_EXT_URL),
      {
        url: CONSULT_REPLY_EXT_URL,
        valueReference: {
          reference: replyReference,
          ...(replierName ? { display: replierName } : {}),
        },
      },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 進捗の変更に合わせて ServiceRequest.status も動かす PUT エントリ(§4)。
 *
 * 回答済 → 対応中 に戻す「回答取消」では、回答への参照も外す。回答の診療記録
 * そのものは消さない(別の医師が書いた記録なので、依頼側の操作で消さない)。
 */
export function buildConsultOrderStatusEntry(
  sr: fhir4.ServiceRequest,
  status: fhir4.ServiceRequest["status"],
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = { ...sr, status };
  if (status !== "completed") {
    const extension = (sr.extension ?? []).filter((e) => e.url !== CONSULT_REPLY_EXT_URL);
    if (extension.length > 0) next.extension = extension;
    else delete next.extension;
  }
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。依頼日を当日に戻し、
 * 希望日は引き継がない(前の依頼の希望日をそのまま持ってくると過去日になる)。
 * 依頼先と目的は同じ科へもう一度聞く場面がそのまま多いので引き継ぐ。
 */
export function buildDoConsultOrderForm(
  values: ConsultOrderFormValues,
  setting: PrescriptionSetting,
): ConsultOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    desiredDate: "",
    // テンプレートの記入内容は引き継がない。同じ回答を 2 つのオーダーが指すと、
    // 片方を消したときにもう片方が壊れるため(病理・手術と同じ)。文言だけは
    // purpose に残るので下書きとして使える。
    purposeTemplate: null,
  };
}

// ---- 一覧・カルテ表示のための parse ----

/** 依頼先の診療科(performer の先頭の Organization)。 */
export function consultTargetDepartment(sr: fhir4.ServiceRequest): {
  departmentId: string;
  departmentName: string;
} {
  const reference = sr.performer?.find((p) => p.reference?.startsWith("Organization/"));
  return {
    departmentId: referenceId(reference?.reference) ?? "",
    departmentName: reference?.display ?? "",
  };
}

/** 指名した医師(performer の Practitioner)。指名していなければ空。 */
export function consultTargetPractitioner(sr: fhir4.ServiceRequest): {
  practitionerId: string;
  practitionerName: string;
} {
  const reference = sr.performer?.find((p) => p.reference?.startsWith("Practitioner/"));
  return {
    practitionerId: referenceId(reference?.reference) ?? "",
    practitionerName: reference?.display ?? "",
  };
}

/**
 * 回答(Composition)への参照。まだ回答が無ければ id は空。
 * 正本は Composition.event.detail で、これは表示のためのキャッシュ(§2.3)。
 */
export function consultReply(sr: fhir4.ServiceRequest): {
  replyId: string;
  replierName: string;
} {
  const reference = sr.extension?.find((e) => e.url === CONSULT_REPLY_EXT_URL)?.valueReference;
  return {
    replyId: referenceId(reference?.reference) ?? "",
    replierName: reference?.display ?? "",
  };
}

/** 依頼目的の記入内容(QuestionnaireResponse)の id。テンプレート由来でなければ空。 */
function purposeResponseIdOf(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === CONSULT_PURPOSE_TEMPLATE_EXT_URL)
    ?.valueReference?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? "";
}

/**
 * オーダーが参照している記入内容(QuestionnaireResponse)の id。
 * 更新・削除で孤児を残さないためと、カルテのタイムラインで「オーダーのカードに
 * 描かれる回答」を単独のテンプレートカードから外すために使う(他部門と同じ形なので
 * 配列で受ける)。
 */
export function consultOrderResponseIds(serviceRequests: fhir4.ServiceRequest[]): string[] {
  return serviceRequests.map(purposeResponseIdOf).filter(Boolean);
}

/** 依頼目的がテンプレート由来なら、その回答への紐付け。 */
export function consultOrderPurposeTemplate(sr: fhir4.ServiceRequest): TemplateBinding | null {
  const responseId = purposeResponseIdOf(sr);
  return responseId ? { responseId, draft: null } : null;
}

export function consultOrderRequestType(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, REQUEST_TYPE_SYSTEM)?.code ?? "";
}

/** 依頼目的。コード化していないので text をそのまま読む。 */
export function consultOrderPurpose(sr: fhir4.ServiceRequest): string {
  return sr.reasonCode?.[0]?.text ?? "";
}

export interface ConsultOrderSummary {
  settingDisplay: string;
  /** 依頼先科。 */
  targetDepartmentId: string;
  targetDepartmentName: string;
  /** 指名医師(指名していなければ空)。 */
  targetPractitionerName: string;
  /** 「循環器内科(山田 太郎)」の 1 行表示。 */
  targetLabel: string;
  requestType: string;
  requestTypeDisplay: string;
  priority: ConsultPriority;
  priorityDisplay: string;
  /** 至急の依頼か。カードと一覧で目立たせる。 */
  urgent: boolean;
  desiredDate: string;
  purpose: string;
  comment: string;
  /** 回答の診療記録 id(まだ回答が無ければ空)。 */
  replyId: string;
  replierName: string;
}

export function summarizeConsultOrder(sr: fhir4.ServiceRequest): ConsultOrderSummary {
  const department = consultTargetDepartment(sr);
  const practitioner = consultTargetPractitioner(sr);
  const requestType = consultOrderRequestType(sr);
  const priority = (sr.priority === "urgent" ? "urgent" : "routine") as ConsultPriority;
  const reply = consultReply(sr);

  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    targetDepartmentId: department.departmentId,
    targetDepartmentName: department.departmentName,
    targetPractitionerName: practitioner.practitionerName,
    targetLabel: practitioner.practitionerName
      ? `${department.departmentName}(${practitioner.practitionerName})`
      : department.departmentName,
    requestType,
    requestTypeDisplay: sr.code?.text || requestTypeDisplay(requestType),
    priority,
    priorityDisplay: consultPriorityDisplay(priority),
    urgent: priority === "urgent",
    desiredDate: (sr.occurrenceDateTime ?? "").slice(0, 10),
    purpose: consultOrderPurpose(sr),
    comment: orderComment(sr),
    replyId: reply.replyId,
    replierName: reply.replierName,
  };
}

/**
 * 「2026-08-30 循環器内科 診察依頼」のような 1 行要約。回答モーダルなど、
 * 依頼を 1 行で指すところで使う。
 */
export function consultOrderLabel(sr: fhir4.ServiceRequest): string {
  const summary = summarizeConsultOrder(sr);
  return [sr.authoredOn?.slice(0, 10) ?? "", summary.targetLabel, summary.requestTypeDisplay]
    .filter(Boolean)
    .join(" ");
}

export const consultOrderComment = orderComment;
export const consultOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseConsultOrderForm(sr: fhir4.ServiceRequest): ConsultOrderFormValues {
  const department = consultTargetDepartment(sr);
  const practitioner = consultTargetPractitioner(sr);

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    targetDepartmentId: department.departmentId,
    targetDepartmentName: department.departmentName,
    targetPractitionerId: practitioner.practitionerId,
    targetPractitionerName: practitioner.practitionerName,
    requestType: consultOrderRequestType(sr) as ConsultRequestType | "",
    priority: sr.priority === "urgent" ? "urgent" : "routine",
    desiredDate: (sr.occurrenceDateTime ?? "").slice(0, 10),
    purpose: consultOrderPurpose(sr),
    purposeTemplate: consultOrderPurposeTemplate(sr),
    comment: consultOrderComment(sr),
    problem: consultOrderProblem(sr),
  };
}
