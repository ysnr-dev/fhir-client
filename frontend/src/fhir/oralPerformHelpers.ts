import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { isAsNeededUsage, isOralUsage } from "./medicationScheduleHelpers";
import {
  MEDICINE_CODE_SYSTEM,
  ORDER_IN_RP_SYSTEM,
  ORDER_TYPE_SYSTEM,
  PRESCRIPTION_ORDER_TYPE,
  RP_NUMBER_SYSTEM,
  YJ_CODE_SYSTEM,
  groupByRp,
  identifierValue,
} from "./prescriptionHelpers";

// 内服の与薬実施(1 回ごとの服薬)。注射の実施(injectionPerformHelpers)と同じ形で、
// 与薬 1 回を Procedure のハブにし、薬剤ごとの MedicationAdministration をぶら下げる。
//
//   ServiceRequest(処方。投与開始日と RP を持つ)
//    └ basedOn ← Procedure (与薬 1 回。予定枠ごとに 1 件)
//         │  performedDateTime = 実際に飲ませた時刻
//         │  extension[medication-schedule-slot] = **どの予定枠の与薬か**
//         │  status       = completed(与薬) / not-done(与薬せず)
//         │  statusReason = 与薬しなかった理由(text)
//         │  note         = コメント
//         └ partOf ← MedicationAdministration (薬剤 1 件ごと)
//              request = その薬剤の MedicationRequest
//              dosage  = 用量(オーダーから写す)
//
// **なぜ予定枠を拡張で持つか。** 処方は 1 件で何日ぶんも続き、1 日に何回も飲ませる
// (朝昼夕食後 × 7 日 = 21 枠)。実際に飲ませた時刻は予定と数十分ずれるのが普通なので、
// 時刻の近さで予定と記録を突き合わせると取り違える。どの枠の記録かを明示して持つ。
//
// **「途中で中止」は無い**(注射との違い)。内服は飲むか飲まないかで、点滴のような
// 途中停止が無い。飲ませなかった薬剤が一部あるときは、その薬剤の記録を作らない。
//
// **進捗 Task は動かさない**。処方の Task は薬剤部の進捗(受付 → 調剤)で、与薬とは別の軸。
// 継続処方に「実施済」という 1 つの状態は定まらない(docs/prescription-order-design.md)。

/** JP Core の Procedure プロファイル。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** どの予定枠の与薬か。ローカル拡張(valueDateTime)。 */
export const SLOT_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/medication-schedule-slot";

/** 与薬の結果。Procedure.status にそのまま写す。 */
export type OralPerformOutcome = "completed" | "not-done";

export const OUTCOME_OPTIONS: { code: OralPerformOutcome; display: string }[] = [
  { code: "completed", display: "与薬" },
  { code: "not-done", display: "与薬せず" },
];

export function outcomeDisplay(code: string): string {
  return OUTCOME_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- 与薬入力フォームの値 ----

/** 与薬した薬剤 1 行。処方の薬剤行から作る。 */
export interface OralPerformMedicineLine {
  medicationRequestId: string;
  rpNumber: number;
  orderInRp: number;
  code: string;
  yjCode?: string;
  name: string;
  /** 用量。オーダーの値をそのまま出し、変えられない(内服は量を刻まない)。 */
  dose?: number;
  unit: string;
  /** 飲ませなかった。この薬剤の記録を作らない。 */
  skipped: boolean;
}

export interface OralPerformFormValues {
  /** 実際に飲ませた時刻(datetime-local)。既定は予定枠の時刻。 */
  performedAt: string;
  performerId: string;
  performerName: string;
  outcome: OralPerformOutcome;
  reason: string;
  comment: string;
  medicines: OralPerformMedicineLine[];
}

/** その処方の内服の薬剤行。頓用の RP は予定枠を持たないので出さない。 */
export function oralMedicineLines(mrs: fhir4.MedicationRequest[]): OralPerformMedicineLine[] {
  const mrByKey = new Map<string, fhir4.MedicationRequest>();
  for (const mr of mrs) {
    const key = `${identifierValue(mr, RP_NUMBER_SYSTEM) ?? ""}/${identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? ""}`;
    mrByKey.set(key, mr);
  }

  const lines: OralPerformMedicineLine[] = [];
  for (const rp of groupByRp(mrs)) {
    if (!isOralUsage(rp.usageCode) || isAsNeededUsage(rp.usageCode)) continue;
    for (const medicine of rp.medicines) {
      const mr = mrByKey.get(`${rp.rpNumber}/${medicine.orderInRp}`);
      lines.push({
        medicationRequestId: mr?.id ?? "",
        rpNumber: rp.rpNumber,
        orderInRp: medicine.orderInRp,
        code: medicine.code,
        yjCode: medicine.yjCode,
        name: medicine.name,
        dose: medicine.dose,
        unit: medicine.unit ?? "",
        skipped: false,
      });
    }
  }
  return lines;
}

/**
 * 与薬入力の初期値。時刻は**予定枠の時刻**にする(注射は「今」だが、内服は 1 日の
 * 枠が前もって決まっており、配薬はその枠に沿う。ずれたら手で直す)。
 */
export function emptyOralPerformForm(
  mrs: fhir4.MedicationRequest[],
  slotAt: string,
): OralPerformFormValues {
  return {
    performedAt: toDateTimeInput(slotAt),
    performerId: "",
    performerName: "",
    outcome: "completed",
    reason: "",
    comment: "",
    medicines: oralMedicineLines(mrs),
  };
}

/** 保存できる状態か。足りないものがあればその説明を返す。 */
export function validateOralPerformForm(values: OralPerformFormValues): string | null {
  if (!values.performedAt) return "与薬した時刻を入れてください。";
  if (values.outcome === "completed" && values.medicines.every((line) => line.skipped)) {
    return "与薬した薬剤がありません。すべて飲ませなかったなら「与薬せず」にしてください。";
  }
  if (values.outcome === "not-done" && !values.reason.trim()) {
    return "与薬せずの理由を入れてください。";
  }
  return null;
}

// ---- FHIR リソースの組み立て ----

function buildHubProcedure(
  values: OralPerformFormValues,
  subject: fhir4.Reference,
  encounter: fhir4.Reference | undefined,
  orderReference: string,
  slotAt: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: values.outcome,
    // 注射・処置・手術の Procedure と振り分けるための区分。処方の ServiceRequest には
    // order-type を付けない(付けると isPrescriptionServiceRequest が壊れる)ので、
    // このコードが出てくるのは実施の側だけ。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...PRESCRIPTION_ORDER_TYPE }] },
    code: { text: "与薬" },
    subject,
    ...(encounter ? { encounter } : {}),
    basedOn: [{ reference: orderReference }],
    performedDateTime: toFhirDateTime(values.performedAt),
    extension: [{ url: SLOT_EXTENSION_URL, valueDateTime: toFhirDateTime(slotAt) }],
  };

  if (values.performerId) {
    procedure.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }
  if (values.outcome !== "completed" && values.reason.trim()) {
    procedure.statusReason = { text: values.reason.trim() };
  }
  if (values.comment.trim()) procedure.note = [{ text: values.comment.trim() }];

  return procedure;
}

function buildAdministration(
  line: OralPerformMedicineLine,
  mr: fhir4.MedicationRequest | undefined,
  values: OralPerformFormValues,
  subject: fhir4.Reference,
  hubReference: string,
): fhir4.MedicationAdministration {
  const instruction = mr?.dosageInstruction?.[0];
  const dosage: fhir4.MedicationAdministrationDosage = {};
  const dose = instruction?.doseAndRate?.[0]?.doseQuantity ?? {
    ...(line.dose == null ? {} : { value: line.dose }),
    ...(line.unit ? { unit: line.unit } : {}),
  };
  if (dose.value != null) dosage.dose = dose;
  if (instruction?.route) dosage.route = instruction.route;

  const administration: fhir4.MedicationAdministration = {
    resourceType: "MedicationAdministration",
    status: "completed",
    medicationCodeableConcept: mr?.medicationCodeableConcept ?? {
      coding: [
        { system: MEDICINE_CODE_SYSTEM, code: line.code, display: line.name },
        ...(line.yjCode ? [{ system: YJ_CODE_SYSTEM, code: line.yjCode, display: line.name }] : []),
      ],
      text: line.name,
    },
    subject,
    effectiveDateTime: toFhirDateTime(values.performedAt),
    partOf: [{ reference: hubReference }],
    ...(line.medicationRequestId
      ? { request: { reference: `MedicationRequest/${line.medicationRequestId}` } }
      : {}),
    ...(Object.keys(dosage).length ? { dosage } : {}),
  };

  if (values.performerId) {
    administration.performer = [
      {
        actor: {
          reference: `Practitioner/${values.performerId}`,
          display: values.performerName || undefined,
        },
      },
    ];
  }

  return administration;
}

/**
 * 与薬 1 回ぶんの transaction Bundle。ハブと薬剤の記録だけを作り、Task は動かさない。
 */
export function buildOralPerformBundle(
  values: OralPerformFormValues,
  order: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
  slotAt: string,
): fhir4.Bundle {
  const subject = order.subject ?? {};
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;
  const mrById = new Map(mrs.map((mr) => [mr.id ?? "", mr]));

  const entry: fhir4.BundleEntry[] = [
    {
      fullUrl: hubReference,
      resource: buildHubProcedure(
        values,
        subject,
        order.encounter,
        `ServiceRequest/${order.id ?? ""}`,
        slotAt,
      ),
      request: { method: "POST", url: "Procedure" },
    },
  ];

  // 与薬せず のときは薬剤の記録を作らない(飲ませていない薬に投与記録があると嘘になる)。
  if (values.outcome !== "not-done") {
    for (const line of values.medicines.filter((l) => !l.skipped)) {
      entry.push({
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: buildAdministration(
          line,
          mrById.get(line.medicationRequestId),
          values,
          subject,
          hubReference,
        ),
        request: { method: "POST", url: "MedicationAdministration" },
      });
    }
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}

// ---- 一覧への表示 ----

export interface OralPerformDisplay {
  /** ハブの Procedure id。 */
  id: string;
  /** どの予定枠の記録か "YYYY-MM-DDTHH:mm"。予定の印との突き合わせに使う。 */
  slotAt: string;
  /** 実際に飲ませた時刻(ISO)。 */
  performedAt: string;
  /** 「2026-09-03 08:30」。 */
  performedLabel: string;
  performerName: string;
  /** 与薬した薬剤。「アムロジピン錠 1錠」の形。 */
  medicines: string[];
  /** 結果。与薬は空、与薬せず はその表示。 */
  statusNote: string;
  reason: string;
  comment: string;
  /** 取消で一緒に消す薬剤の記録。 */
  administrationIds: string[];
}

/** 与薬の実施記録か。注射・処置・手術の Procedure と振り分ける。 */
export function isOralProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === PRESCRIPTION_ORDER_TYPE.code,
    ),
  );
}

function referenceId(reference: string | undefined, resourceType: string): string {
  return reference?.match(new RegExp(`^${resourceType}/(.+)$`))?.[1] ?? "";
}

function conceptLabel(concept: fhir4.CodeableConcept | undefined): string {
  if (!concept) return "";
  const coding = concept.coding?.find((c) => c.display) ?? concept.coding?.[0];
  return concept.text || coding?.display || coding?.code || "";
}

function medicineLabel(administration: fhir4.MedicationAdministration): string {
  const dose = administration.dosage?.dose;
  const amount = dose?.value == null ? "" : `${dose.value}${dose.unit ?? ""}`;
  return [conceptLabel(administration.medicationCodeableConcept), amount].filter(Boolean).join(" ");
}

/** ハブが持つ予定枠。拡張が無い記録は実施時刻で代用する。 */
function slotOf(hub: fhir4.Procedure): string {
  const slot = hub.extension?.find((e) => e.url === SLOT_EXTENSION_URL)?.valueDateTime;
  return toDateTimeInput(slot ?? hub.performedDateTime ?? "");
}

/** 与薬の記録を処方 id ごとにまとめる。1 処方に何枠ぶんも付くので、枠の順に並べる。 */
export function oralPerformsByOrderId(
  procedures: fhir4.Procedure[],
  administrations: fhir4.MedicationAdministration[],
): Map<string, OralPerformDisplay[]> {
  const hubs = procedures.filter(
    (procedure) => isOralProcedure(procedure) && procedure.status !== "entered-in-error",
  );

  const byOrderId = new Map<string, OralPerformDisplay[]>();
  for (const hub of hubs) {
    const hubId = hub.id ?? "";
    const children = administrations.filter((a) =>
      (a.partOf ?? []).some((r) => referenceId(r.reference, "Procedure") === hubId),
    );

    const display: OralPerformDisplay = {
      id: hubId,
      slotAt: slotOf(hub),
      performedAt: hub.performedDateTime ?? "",
      performedLabel: toDateTimeInput(hub.performedDateTime ?? "").replace("T", " "),
      performerName: hub.performer?.[0]?.actor?.display ?? "",
      medicines: children.map(medicineLabel).filter(Boolean),
      statusNote: hub.status === "completed" ? "" : outcomeDisplay(hub.status),
      reason: hub.statusReason?.text ?? "",
      comment: hub.note?.map((note) => note.text).filter(Boolean).join("\n") ?? "",
      administrationIds: children.map((a) => a.id).filter((id): id is string => Boolean(id)),
    };

    for (const basedOn of hub.basedOn ?? []) {
      const orderId = referenceId(basedOn.reference, "ServiceRequest");
      if (!orderId) continue;
      const list = byOrderId.get(orderId);
      if (list) list.push(display);
      else byOrderId.set(orderId, [display]);
    }
  }

  for (const list of byOrderId.values()) list.sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  return byOrderId;
}

/**
 * 与薬の取消で消す記録の DELETE エントリ。注射と同じく記録ごと消す
 * (「この薬を飲ませた」という事実の記録なので、取り消したのに残っていると嘘になる)。
 * 子(薬剤)を先に消してから親を消す。
 */
export function buildOralPerformDeleteEntries(
  performs: OralPerformDisplay[],
): fhir4.BundleEntry[] {
  return performs.flatMap((perform) => [
    ...perform.administrationIds.map((id) => ({
      request: { method: "DELETE" as const, url: `MedicationAdministration/${id}` },
    })),
    { request: { method: "DELETE" as const, url: `Procedure/${perform.id}` } },
  ]);
}
