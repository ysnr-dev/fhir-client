import { shortDate, today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
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
import { ORDER_TYPE_SYSTEM, applyOrderContext, type OrderAttribution } from "./orderHeader";
import { SETTING_OPTIONS, SETTING_SYSTEM, type PrescriptionSetting } from "./prescriptionHelpers";

// 服薬指導オーダー(docs/medication-guidance-order-design.md)。医師が薬剤師へ服薬指導を
// 依頼し、薬剤部が受付 → 入院中に週ごとの指導 → 退院時指導 → 終了と進める。
// 骨格は栄養指導(nutritionGuidanceOrderHelpers.ts)と同じ「期間継続型」:
// - オーダーは ServiceRequest 1 本だけ。明細は持たない。
// - 進捗 Task は「部門の受け入れ状態」(受付 → 期間中ずっと accepted → 終了)。
//   日々の指導は Task を動かさず Procedure を足すだけ。
//
// 栄養指導と違うところ:
// - 指導区分(入院中の服薬指導 / 退院時指導)を code に、指導条件(ハイリスク薬・麻薬など。
//   複数可)を orderDetail に持つ。指導条件は薬剤管理指導料の区分を決める手掛かり。
// - 対象疾患名・指示食種・予約は持たない。服薬指導は薬剤師が病棟で行い、枠を押さえない。
// - 対象薬剤を任意の文字列で持つ。
//
// 載せ方:
//
//   code        = 指導区分(服薬指導 / 退院時指導)
//   orderDetail = 指導条件(複数)
//   occurrenceDateTime = 開始日
//   reasonCode  = 指導してほしいこと
//   note        = 薬剤部への連絡事項
//   extension[medication-guidance-order-end]    = 終了日(無ければ継続中)
//   extension[medication-guidance-target-drugs] = 対象薬剤

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const MEDICATION_GUIDANCE_ORDER_TYPE = {
  code: "medication-guidance",
  display: "服薬指導",
};

/** 指導区分。診療報酬の区分(薬剤管理指導料 / 退院時薬剤情報管理指導料)に対応し、施設で増減しない。 */
export const GUIDANCE_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/medication-guidance-kind";

/** 指導条件。指導で特に見てほしい点で、施設で増減しないのでフロントの定数に置く。 */
export const GUIDANCE_CONDITION_SYSTEM =
  "http://fhir-client.local/CodeSystem/medication-guidance-condition";

/**
 * 終了日。occurrencePeriod を使わないのは、上流が occurrenceDateTime しか索引しないため
 * (栄養指導・リハビリと同じ判断)。この拡張が無いオーダーは「継続中」。
 */
const ORDER_END_EXT_URL = "http://fhir-client.local/StructureDefinition/medication-guidance-order-end";

/** 対象薬剤。処方の薬剤参照ではなく文字列で持つ(持参薬・院外の薬も対象になるため)。 */
const TARGET_DRUGS_EXT_URL =
  "http://fhir-client.local/StructureDefinition/medication-guidance-target-drugs";

// ---- 固定の分類 ----

export type MedicationGuidanceKind = "inpatient" | "discharge";

export const GUIDANCE_KIND_OPTIONS: { code: MedicationGuidanceKind; display: string }[] = [
  { code: "inpatient", display: "服薬指導" },
  { code: "discharge", display: "退院時指導" },
];

export function guidanceKindDisplay(code: string): string {
  return displayOf(GUIDANCE_KIND_OPTIONS, code);
}

/** 一覧・カードの狭い場所で使う短い表示。 */
const GUIDANCE_KIND_SHORT: Record<MedicationGuidanceKind, string> = {
  inpatient: "服薬",
  discharge: "退院時",
};

export function guidanceKindShort(code: string): string {
  return GUIDANCE_KIND_SHORT[code as MedicationGuidanceKind] ?? guidanceKindDisplay(code);
}

export type MedicationGuidanceCondition =
  | "high-risk"
  | "narcotic"
  | "device"
  | "polypharmacy"
  | "adherence"
  | "swallowing"
  | "family";

export const GUIDANCE_CONDITION_OPTIONS: { code: MedicationGuidanceCondition; display: string }[] = [
  { code: "high-risk", display: "ハイリスク薬" },
  { code: "narcotic", display: "麻薬" },
  { code: "device", display: "吸入・自己注射の手技" },
  { code: "polypharmacy", display: "多剤併用" },
  { code: "adherence", display: "服薬状況の確認" },
  { code: "swallowing", display: "嚥下・剤形の相談" },
  { code: "family", display: "家族への指導" },
];

export function guidanceConditionDisplay(code: string): string {
  return displayOf(GUIDANCE_CONDITION_OPTIONS, code);
}

// ---- フォームの値 ----

export interface MedicationGuidanceOrderFormValues {
  setting: PrescriptionSetting;
  /** 指導区分(必須)。 */
  kind: MedicationGuidanceKind | "";
  /** 指導条件(任意・複数)。 */
  conditions: MedicationGuidanceCondition[];
  startDate: string;
  /** 終了日。空なら継続(終了を決めずにオーダーする)。 */
  endDate: string;
  /** 対象薬剤(任意)。 */
  targetDrugs: string;
  /** 指導してほしいこと(任意)。 */
  purpose: string;
  /** 薬剤部への連絡事項。 */
  comment: string;
  problem: ProblemRef | null;
}

export function emptyMedicationGuidanceOrderForm(
  setting: PrescriptionSetting,
): MedicationGuidanceOrderFormValues {
  return {
    setting,
    kind: "inpatient",
    conditions: [],
    startDate: today(),
    endDate: "",
    targetDrugs: "",
    purpose: "",
    comment: "",
    problem: null,
  };
}

/** 入力の検証。空文字なら妥当。 */
export function validateMedicationGuidanceOrderForm(values: MedicationGuidanceOrderFormValues): string {
  if (!values.kind) return "指導区分を選んでください。";
  if (!values.startDate) return "開始日を入れてください。";
  if (values.endDate && values.endDate < values.startDate) {
    return "終了日は開始日と同じか、それより後にしてください。";
  }
  return "";
}

// ---- FHIR リソースの組み立て ----

/** 服薬指導オーダーの ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isMedicationGuidanceServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === MEDICATION_GUIDANCE_ORDER_TYPE.code;
}

function buildMedicationGuidanceServiceRequest(
  values: MedicationGuidanceOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...MEDICATION_GUIDANCE_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                { system: SETTING_SYSTEM, code: values.setting, display: displayOf(SETTING_OPTIONS, values.setting) },
              ],
            },
          ]
        : []),
    ],
    subject: { reference: `Patient/${patientId}` },
    // 登録日時(全種別共通の意味。fhir/shared.ts)。フォームでは入力しない。
    authoredOn,
    // 開始日。部門一覧はこの日付でオーダーを拾い、カルテカードもこの日に置く。
    occurrenceDateTime: values.startDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  if (values.kind) {
    const display = guidanceKindDisplay(values.kind);
    resource.code = { coding: [{ system: GUIDANCE_KIND_SYSTEM, code: values.kind, display }], text: display };
  }

  if (values.conditions.length > 0) {
    resource.orderDetail = values.conditions.map((code) => ({
      coding: [{ system: GUIDANCE_CONDITION_SYSTEM, code, display: guidanceConditionDisplay(code) }],
      text: guidanceConditionDisplay(code),
    }));
  }

  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];

  const extension: fhir4.Extension[] = [];
  if (values.endDate) extension.push({ url: ORDER_END_EXT_URL, valueDate: values.endDate });
  if (values.targetDrugs.trim()) extension.push({ url: TARGET_DRUGS_EXT_URL, valueString: values.targetDrugs.trim() });
  if (extension.length > 0) resource.extension = extension;

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];

  if (values.problem) {
    resource.reasonReference = [
      { reference: `Condition/${values.problem.conditionId}`, display: values.problem.display },
    ];
  }

  // 依頼医師・依頼科・入院病棟のローカル拡張。上で拡張を積んであるので、既存の extension に足す形で効く。
  applyOrderContext(resource, requester);

  return resource;
}

/** 新規登録。 */
export function buildMedicationGuidanceOrderBundle(
  values: MedicationGuidanceOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      // fullUrl は来歴(Provenance)がこのオーダーを指すのに使う。
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildMedicationGuidanceServiceRequest(values, patientId, requester, registrationAuthoredOn()),
      request: { method: "POST", url: "ServiceRequest" },
    },
  ]);
}

/** 更新。登録日時は元から引き継ぎ、読んだ版を ifMatch に添える。 */
export function buildMedicationGuidanceOrderUpdateBundle(
  values: MedicationGuidanceOrderFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  const serviceRequestId = existing.id ?? "";
  return withVersionLock(
    transactionBundle([
      {
        resource: buildMedicationGuidanceServiceRequest(
          values,
          patientId,
          requester,
          registrationAuthoredOn(existing),
          serviceRequestId,
        ),
        request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` },
      },
    ]),
    existing,
  );
}

/**
 * 継続中のオーダーに終了日を書き足す PUT エントリ。部門一覧の「終了」と退院時の打ち切りで使う。
 * Task を completed にするだけだと status=active のまま部門一覧の検索に永久にヒットし続けるので、
 * ServiceRequest にも終了日を書く(栄養指導と同じ)。
 */
export function buildMedicationGuidanceOrderCloseEntry(sr: fhir4.ServiceRequest, endDate: string): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== ORDER_END_EXT_URL),
      { url: ORDER_END_EXT_URL, valueDate: endDate },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/** 退院などで打ち切る PUT エントリ。指定の日までで終わっていないオーダーだけを対象にする。 */
export function buildMedicationGuidanceOrderStopEntries(
  orders: fhir4.ServiceRequest[],
  endDate: string,
): fhir4.BundleEntry[] {
  return orders
    .filter((sr) => medicationGuidanceOrderNeedsStop(sr, endDate))
    .map((sr) => buildMedicationGuidanceOrderCloseEntry(sr, endDate));
}

/** DO(流用)するときのフォーム値。開始を当日に戻し、終了は引き継がない。 */
export function buildDoMedicationGuidanceOrderForm(
  values: MedicationGuidanceOrderFormValues,
  setting: PrescriptionSetting,
): MedicationGuidanceOrderFormValues {
  return { ...values, setting, startDate: today(), endDate: "" };
}

// ---- 一覧・カルテ表示のための parse ----

export function medicationGuidanceOrderEnd(sr: fhir4.ServiceRequest): string {
  const extension = sr.extension?.find((e) => e.url === ORDER_END_EXT_URL);
  return extension?.valueDate ?? extension?.valueDateTime?.slice(0, 10) ?? "";
}

export function medicationGuidanceKind(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, GUIDANCE_KIND_SYSTEM)?.code ?? "";
}

export function medicationGuidanceConditions(sr: fhir4.ServiceRequest): MedicationGuidanceCondition[] {
  return (sr.orderDetail ?? [])
    .map((detail) => codingBySystem(detail.coding, GUIDANCE_CONDITION_SYSTEM)?.code ?? "")
    .filter((code): code is MedicationGuidanceCondition => GUIDANCE_CONDITION_OPTIONS.some((o) => o.code === code));
}

export interface MedicationGuidanceOrderSummary {
  settingDisplay: string;
  kind: string;
  /** 指導区分の表示(「服薬指導」)。 */
  kindDisplay: string;
  /** 狭い場所用の短い表示(「服薬」)。 */
  kindShort: string;
  /** 指導条件の表示(「ハイリスク薬・麻薬」)。 */
  conditionsLabel: string;
  /** 「10/6〜継続中」「10/6〜10/20」。 */
  periodLabel: string;
  startDate: string;
  endDate: string;
  targetDrugs: string;
  purpose: string;
  comment: string;
}

export function summarizeMedicationGuidanceOrder(sr: fhir4.ServiceRequest): MedicationGuidanceOrderSummary {
  const kind = medicationGuidanceKind(sr);
  const startDate = (sr.occurrenceDateTime ?? "").slice(0, 10);
  const endDate = medicationGuidanceOrderEnd(sr);
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    kind,
    kindDisplay: sr.code?.text || guidanceKindDisplay(kind),
    kindShort: guidanceKindShort(kind),
    conditionsLabel: medicationGuidanceConditions(sr).map(guidanceConditionDisplay).join("・"),
    periodLabel: startDate ? `${shortDate(startDate)}〜${endDate ? shortDate(endDate) : "継続中"}` : "",
    startDate,
    endDate,
    targetDrugs: sr.extension?.find((e) => e.url === TARGET_DRUGS_EXT_URL)?.valueString ?? "",
    purpose: sr.reasonCode?.[0]?.text ?? "",
    comment: orderComment(sr),
  };
}

/** 指定の日より後まで続いてしまうオーダーか(= 退院・終了で打ち切る必要があるか)。 */
export function medicationGuidanceOrderNeedsStop(sr: fhir4.ServiceRequest, endDate: string): boolean {
  const end = medicationGuidanceOrderEnd(sr);
  return !end || end > endDate;
}

export const medicationGuidanceOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseMedicationGuidanceOrderForm(sr: fhir4.ServiceRequest): MedicationGuidanceOrderFormValues {
  const summary = summarizeMedicationGuidanceOrder(sr);
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    kind: summary.kind as MedicationGuidanceKind | "",
    conditions: medicationGuidanceConditions(sr),
    startDate: orderDay(sr) || today(),
    endDate: summary.endDate,
    targetDrugs: summary.targetDrugs,
    purpose: summary.purpose,
    comment: summary.comment,
    problem: medicationGuidanceOrderProblem(sr),
  };
}
