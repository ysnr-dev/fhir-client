import { shortDate, today } from "../lib/dates";
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { displayOf, referenceIdOfType } from "./shared";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  MEDICATION_GUIDANCE_ORDER_TYPE,
  medicationGuidanceConditions,
  medicationGuidanceKind,
} from "./medicationGuidanceOrderHelpers";

// 服薬指導の実施記録(docs/medication-guidance-order-design.md)。1 回の指導 = Procedure 1 件で、
// 入院中に週ごとに積み上がる。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure
//         code       = 指導種別(服薬指導 / 服薬指導(ハイリスク薬) / 退院時指導)
//         performedDateTime = 実施日時
//         performer  = 指導した薬剤師
//         extension[medication-guidance-understanding] = 患者の理解度
//         extension[medication-guidance-record]        = 指導記録テンプレートの回答
//         note       = 指導内容
//
// 栄養指導と同じく、実施しても進捗 Task を動かさない(初回の指導で終了扱いになると
// 2 回目以降が実施できなくなる)。指導記録のテンプレートの持ち方も栄養指導と同じ。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** 指導種別。薬剤管理指導料(1・2)と退院時薬剤情報管理指導料の区分に対応する。 */
export const SESSION_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/medication-guidance-session-type";

/** 患者の理解度。Procedure に標準の置き場所が無いのでローカル拡張にする。 */
const UNDERSTANDING_EXT_URL = "http://fhir-client.local/StructureDefinition/medication-guidance-understanding";
export const UNDERSTANDING_SYSTEM = "http://fhir-client.local/CodeSystem/medication-guidance-understanding";

/** 指導記録テンプレートの回答への参照。平文は note に入れてある。 */
const RECORD_TEMPLATE_EXT_URL = "http://fhir-client.local/StructureDefinition/medication-guidance-record";

// ---- 固定の分類 ----

export type MedicationGuidanceSessionType = "standard" | "high-risk" | "discharge";

export const SESSION_TYPE_OPTIONS: { code: MedicationGuidanceSessionType; display: string }[] = [
  { code: "standard", display: "服薬指導" },
  { code: "high-risk", display: "服薬指導(ハイリスク薬)" },
  { code: "discharge", display: "退院時指導" },
];

const SESSION_TYPE_SHORT: Record<MedicationGuidanceSessionType, string> = {
  standard: "服薬",
  "high-risk": "ハイリスク",
  discharge: "退院時",
};

export function sessionTypeDisplay(code: string): string {
  return displayOf(SESSION_TYPE_OPTIONS, code);
}

export function sessionTypeShort(code: string): string {
  return SESSION_TYPE_SHORT[code as MedicationGuidanceSessionType] ?? sessionTypeDisplay(code);
}

export type MedicationGuidanceUnderstanding = "good" | "partial" | "poor";

export const UNDERSTANDING_OPTIONS: { code: MedicationGuidanceUnderstanding; display: string }[] = [
  { code: "good", display: "良好" },
  { code: "partial", display: "一部理解" },
  { code: "poor", display: "不十分" },
];

export function understandingDisplay(code: string): string {
  return displayOf(UNDERSTANDING_OPTIONS, code);
}

/** そのオーダーで選べる指導種別。退院時指導のオーダーなら退院時指導だけ。 */
export function sessionTypesForOrder(order: fhir4.ServiceRequest): typeof SESSION_TYPE_OPTIONS {
  return medicationGuidanceKind(order) === "discharge"
    ? SESSION_TYPE_OPTIONS.filter((o) => o.code === "discharge")
    : SESSION_TYPE_OPTIONS.filter((o) => o.code !== "discharge");
}

/** 指導種別の初期値。ハイリスク薬の条件が付いたオーダーならハイリスクにする。 */
export function defaultSessionTypeFor(order: fhir4.ServiceRequest): MedicationGuidanceSessionType {
  if (medicationGuidanceKind(order) === "discharge") return "discharge";
  return medicationGuidanceConditions(order).includes("high-risk") ? "high-risk" : "standard";
}

// ---- 実施入力フォームの値 ----

export interface MedicationGuidancePerformFormValues {
  performedDate: string;
  /** 実施時刻(HH:mm)。空なら日付だけの実施記録にする。 */
  performedTime: string;
  sessionType: MedicationGuidanceSessionType | "";
  understanding: MedicationGuidanceUnderstanding | "";
  performerId: string;
  performerName: string;
  /** 指導内容。テンプレートから書いた場合も平文はここに入る。 */
  note: string;
  recordTemplate: TemplateBinding | null;
}

export function emptyMedicationGuidancePerformForm(
  sessionType: MedicationGuidanceSessionType | "" = "",
): MedicationGuidancePerformFormValues {
  return {
    performedDate: today(),
    performedTime: "",
    sessionType,
    understanding: "",
    performerId: "",
    performerName: "",
    note: "",
    recordTemplate: null,
  };
}

export function validateMedicationGuidancePerformForm(values: MedicationGuidancePerformFormValues): string {
  if (!values.performedDate) return "実施日を入れてください。";
  if (!values.sessionType) return "指導種別を選んでください。";
  if (!values.performerId) return "担当薬剤師を選んでください。";
  return "";
}

// ---- 組み立て ----

function buildMedicationGuidanceProcedure(
  values: MedicationGuidancePerformFormValues,
  order: fhir4.ServiceRequest,
  recordTemplateRef: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 他オーダーの実施記録と振り分けるための区分(リハビリ・栄養指導と同じ持たせ方)。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...MEDICATION_GUIDANCE_ORDER_TYPE }] },
    code: {
      coding: [{ system: SESSION_TYPE_SYSTEM, code: values.sessionType, display: sessionTypeDisplay(values.sessionType) }],
      text: sessionTypeDisplay(values.sessionType),
    },
    subject: order.subject ?? {},
    basedOn: [{ reference: `ServiceRequest/${order.id ?? ""}` }],
    performedDateTime: values.performedTime
      ? toFhirDateTime(`${values.performedDate}T${values.performedTime}`)
      : values.performedDate,
  };

  if (values.performerId) {
    procedure.performer = [
      { actor: { reference: `Practitioner/${values.performerId}`, display: values.performerName || undefined } },
    ];
  }

  const extension: fhir4.Extension[] = [];
  if (values.understanding) {
    extension.push({
      url: UNDERSTANDING_EXT_URL,
      valueCoding: {
        system: UNDERSTANDING_SYSTEM,
        code: values.understanding,
        display: understandingDisplay(values.understanding),
      },
    });
  }
  if (recordTemplateRef) extension.push({ url: RECORD_TEMPLATE_EXT_URL, valueReference: { reference: recordTemplateRef } });
  if (extension.length > 0) procedure.extension = extension;

  if (values.note.trim()) procedure.note = [{ text: values.note.trim() }];
  return procedure;
}

/** 指導記録のテンプレート記入内容を Bundle に積み、実施記録から指す参照を返す(栄養指導と同じ)。 */
function pushRecordTemplateEntry(entries: fhir4.BundleEntry[], binding: TemplateBinding | null): string {
  if (!binding) return "";
  const { responseId, draft } = binding;
  if (!draft) return responseId ? `QuestionnaireResponse/${responseId}` : "";
  const reference = responseId ? `QuestionnaireResponse/${responseId}` : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({ resource: { ...draft.response, id: responseId }, request: { method: "PUT", url: reference } });
  } else {
    entries.push({ fullUrl: reference, resource: draft.response, request: { method: "POST", url: "QuestionnaireResponse" } });
  }
  entries.push(...draft.imageEntries);
  return reference;
}

/** 1 回ぶんの実施登録。Procedure(+ テンプレート回答)を POST するだけで、Task は動かさない。 */
export function buildMedicationGuidancePerformBundle(
  values: MedicationGuidancePerformFormValues,
  order: fhir4.ServiceRequest,
): fhir4.Bundle {
  const entries: fhir4.BundleEntry[] = [];
  const recordRef = pushRecordTemplateEntry(entries, values.recordTemplate);
  entries.push({
    resource: buildMedicationGuidanceProcedure(values, order, recordRef),
    request: { method: "POST", url: "Procedure" },
  });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- カルテ・一覧への表示 ----

export interface MedicationGuidancePerformDisplay {
  id: string;
  performedDate: string;
  /** 「YYYY-MM-DD HH:mm」。時刻を持たない実施記録では日付だけ。 */
  performedAt: string;
  sessionType: string;
  sessionTypeShort: string;
  understanding: string;
  performerName: string;
  note: string;
  /** 指導記録テンプレートの回答 id。実施を消すとき道連れにする。 */
  recordResponseId: string;
  /** 「10/6 ハイリスク 良好 薬剤 花子」の 1 行表示。 */
  label: string;
}

export function isMedicationGuidanceProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === MEDICATION_GUIDANCE_ORDER_TYPE.code,
    ),
  );
}

function toDisplay(procedure: fhir4.Procedure): MedicationGuidancePerformDisplay {
  const performed = procedure.performedDateTime ?? "";
  const performedDate = performed.slice(0, 10);
  const sessionType = procedure.code?.coding?.find((c) => c.system === SESSION_TYPE_SYSTEM)?.code ?? "";
  const understanding =
    procedure.extension?.find((e) => e.url === UNDERSTANDING_EXT_URL)?.valueCoding?.code ?? "";
  const performerName = procedure.performer?.[0]?.actor?.display ?? "";
  const recordReference = procedure.extension?.find((e) => e.url === RECORD_TEMPLATE_EXT_URL)?.valueReference
    ?.reference;

  return {
    id: procedure.id ?? "",
    performedDate,
    performedAt: performed.length > 10 ? `${performedDate} ${performed.slice(11, 16)}` : performedDate,
    sessionType,
    sessionTypeShort: sessionType ? sessionTypeShort(sessionType) : "",
    understanding: understanding ? understandingDisplay(understanding) : "",
    performerName,
    note: procedure.note?.[0]?.text ?? "",
    recordResponseId: referenceIdOfType(recordReference, "QuestionnaireResponse"),
    label: [
      shortDate(performedDate),
      sessionType ? sessionTypeShort(sessionType) : "",
      understanding ? understandingDisplay(understanding) : "",
      performerName,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** オーダーの id → その実施記録(新しい順)。 */
export function medicationGuidancePerformsByOrderId(
  procedures: fhir4.Procedure[],
): Map<string, MedicationGuidancePerformDisplay[]> {
  const byOrderId = new Map<string, MedicationGuidancePerformDisplay[]>();
  for (const procedure of procedures) {
    if (!isMedicationGuidanceProcedure(procedure) || procedure.status === "entered-in-error") continue;
    const orderId = referenceIdOfType(procedure.basedOn?.[0]?.reference, "ServiceRequest");
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(toDisplay(procedure));
    else byOrderId.set(orderId, [toDisplay(procedure)]);
  }
  for (const list of byOrderId.values()) list.sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  return byOrderId;
}

/** 実施記録を消すエントリ。指導記録テンプレートの回答も道連れにする。 */
export function buildMedicationGuidancePerformDeleteEntries(
  performs: { id: string; recordResponseId?: string }[],
): fhir4.BundleEntry[] {
  return performs.flatMap((perform) => [
    { request: { method: "DELETE" as const, url: `Procedure/${perform.id}` } },
    ...(perform.recordResponseId
      ? [{ request: { method: "DELETE" as const, url: `QuestionnaireResponse/${perform.recordResponseId}` } }]
      : []),
  ]);
}
