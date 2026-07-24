import type { Medicine, MedicineUsage } from "../api/masterClient";

// ローカル拡張・コードシステム。JP Core / FHIR 標準に存在しない項目を表現するための、
// この処方オーダー機能専用の URI。
const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting"; // 入外区分
const CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-category"; // 処方区分
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request"; // orderDetail→MedicationRequest 参照
// レセプト電算コード（6始まり9桁）。JP Core の MedicationCode ValueSet には
// レセ電コードに対応する正式な CodeSystem が定義されていないため、ローカル URI を使用。
const MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code";
// 個別医薬品コード（YJコード）。JP Core（CAPS）で定義された正式な CodeSystem URL。
const YJ_CODE_SYSTEM = "http://capstandard.jp/iyaku.info/CodeSystem/YJ-code";
const USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage";
const USAGE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category";

// JP Core: MedicationRequest.identifier の必須スライス。値を入れないと警告になる。
const RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber";
const ORDER_IN_RP_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex";

const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

const BASIC_USAGE_CATEGORY_ORAL = "内服";
const BASIC_USAGE_CATEGORY_AS_NEEDED = "頓服";

export type PrescriptionSetting = "inpatient" | "outpatient" | "";

export const SETTING_OPTIONS: { code: Exclude<PrescriptionSetting, "">; display: string }[] = [
  { code: "inpatient", display: "入院" },
  { code: "outpatient", display: "外来" },
];

export const CATEGORY_OPTIONS: Record<
  Exclude<PrescriptionSetting, "">,
  { code: string; display: string }[]
> = {
  inpatient: [
    { code: "regular", display: "定期" },
    { code: "continuous", display: "継続" },
    { code: "temporary", display: "臨時" },
    { code: "discharge", display: "退院" },
    { code: "emergency", display: "緊急" },
  ],
  outpatient: [
    { code: "external", display: "院外" },
    { code: "internal", display: "院内" },
  ],
};

export interface MedicineLineValues {
  id?: string;
  medicine: Medicine | null;
  dose: string;
  comment: string;
}

export interface RpValues {
  usage: MedicineUsage | null;
  doseDays: string;
  doseCount: string;
  usageComment: string;
  medicines: MedicineLineValues[];
}

export interface PrescriptionFormValues {
  setting: PrescriptionSetting;
  category: string;
  authoredDate: string;
  comment: string;
  rps: RpValues[];
}

export const emptyMedicineLine: MedicineLineValues = { medicine: null, dose: "", comment: "" };

export const emptyRp: RpValues = {
  usage: null,
  doseDays: "",
  doseCount: "",
  usageComment: "",
  medicines: [{ ...emptyMedicineLine }],
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyPrescriptionForm(): PrescriptionFormValues {
  return {
    setting: "outpatient",
    category: "",
    authoredDate: today(),
    comment: "",
    rps: [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}

function findCategoryDisplay(setting: PrescriptionSetting, code: string): string {
  if (!setting) return code;
  return CATEGORY_OPTIONS[setting].find((c) => c.code === code)?.display ?? code;
}

function findSettingDisplay(code: string): string {
  return SETTING_OPTIONS.find((s) => s.code === code)?.display ?? code;
}

function authoredOnDateTime(dateStr: string): string {
  // fhir-server は Time.iso8601 でパースするため日付のみは不可。時刻0時固定で送る。
  return `${dateStr}T00:00:00+09:00`;
}

function buildMedicationRequest(
  rp: RpValues,
  medLine: MedicineLineValues,
  rpNumber: number,
  orderInRp: number,
  patientId: string,
  authoredOn: string,
  serviceRequestReference: string,
): fhir4.MedicationRequest {
  const timingCoding: fhir4.Coding[] = [];
  if (rp.usage) {
    timingCoding.push({
      system: USAGE_CODE_SYSTEM,
      code: rp.usage.usage_code,
      display: rp.usage.usage_name,
    });
    timingCoding.push({
      system: USAGE_CATEGORY_SYSTEM,
      code: rp.usage.basic_usage_category_code ?? undefined,
      display: rp.usage.basic_usage_category ?? undefined,
    });
  }

  const dosageInstruction: fhir4.Dosage = {
    timing: {
      code: {
        coding: timingCoding.length ? timingCoding : undefined,
        text: rp.usage?.usage_name,
      },
    },
    doseAndRate: medLine.dose
      ? [{ doseQuantity: { value: Number(medLine.dose), unit: medLine.medicine?.unit_name ?? undefined } }]
      : undefined,
  };

  if (rp.usageComment) {
    dosageInstruction.additionalInstruction = [{ text: rp.usageComment }];
  }

  const basicCategory = rp.usage?.basic_usage_category;
  if (basicCategory === BASIC_USAGE_CATEGORY_AS_NEEDED) {
    dosageInstruction.asNeededBoolean = true;
    if (rp.doseCount) {
      dosageInstruction.timing = {
        ...dosageInstruction.timing,
        repeat: { count: Number(rp.doseCount) },
      };
    }
  }

  const resource: fhir4.MedicationRequest = {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    identifier: [
      { system: RP_NUMBER_SYSTEM, value: String(rpNumber) },
      { system: ORDER_IN_RP_SYSTEM, value: String(orderInRp) },
    ],
    medicationCodeableConcept: medLine.medicine
      ? {
          coding: [
            {
              system: MEDICINE_CODE_SYSTEM,
              code: medLine.medicine.medicine_code,
              display: medLine.medicine.name,
            },
            ...(medLine.medicine.yj_code
              ? [
                  {
                    system: YJ_CODE_SYSTEM,
                    code: medLine.medicine.yj_code,
                    display: medLine.medicine.name,
                  },
                ]
              : []),
          ],
          text: medLine.medicine.name,
        }
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    basedOn: [{ reference: serviceRequestReference }],
    dosageInstruction: [dosageInstruction],
  };

  if (medLine.id) resource.id = medLine.id;

  if (basicCategory === BASIC_USAGE_CATEGORY_ORAL && rp.doseDays) {
    resource.dispenseRequest = {
      expectedSupplyDuration: {
        value: Number(rp.doseDays),
        unit: "日",
        system: UNITS_OF_MEASURE_SYSTEM,
        code: "d",
      },
    };
  }

  if (medLine.comment) {
    resource.note = [{ text: medLine.comment }];
  }

  return resource;
}

function buildPrescriptionTransactionBundle(
  values: PrescriptionFormValues,
  patientId: string,
  serviceRequestId?: string,
  originalMedicationRequestIds?: string[],
): fhir4.Bundle {
  const authoredOn = authoredOnDateTime(values.authoredDate);
  const serviceRequestReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const orderDetail: fhir4.CodeableConcept[] = [];
  const medicationEntries: fhir4.BundleEntry[] = [];
  const keptMedicationRequestIds = new Set<string>();

  values.rps.forEach((rp, rpIndex) => {
    const rpNumber = rpIndex + 1;
    rp.medicines.forEach((medLine, medIndex) => {
      const orderInRp = medIndex + 1;
      const resource = buildMedicationRequest(
        rp,
        medLine,
        rpNumber,
        orderInRp,
        patientId,
        authoredOn,
        serviceRequestReference,
      );

      const fullUrl = medLine.id ? `MedicationRequest/${medLine.id}` : `urn:uuid:${crypto.randomUUID()}`;
      if (medLine.id) keptMedicationRequestIds.add(medLine.id);

      medicationEntries.push({
        fullUrl,
        resource,
        request: medLine.id
          ? { method: "PUT", url: `MedicationRequest/${medLine.id}` }
          : { method: "POST", url: "MedicationRequest" },
      });
      orderDetail.push({
        extension: [
          {
            url: ORDER_DETAIL_MR_EXT_URL,
            valueReference: { reference: fullUrl },
          },
        ],
        text: `RP${rpNumber}-${orderInRp}`,
      });
    });
  });

  const serviceRequest: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
      {
        coding: [
          {
            system: CATEGORY_SYSTEM,
            code: values.category,
            display: findCategoryDisplay(values.setting, values.category),
          },
        ],
      },
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    orderDetail,
  };

  if (serviceRequestId) serviceRequest.id = serviceRequestId;
  if (values.comment) {
    serviceRequest.note = [{ text: values.comment }];
  }

  const removedMedicationRequestEntries: fhir4.BundleEntry[] = (originalMedicationRequestIds ?? [])
    .filter((id) => !keptMedicationRequestIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `MedicationRequest/${id}` } }));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: serviceRequestReference,
        resource: serviceRequest,
        request: serviceRequestId
          ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
          : { method: "POST", url: "ServiceRequest" },
      },
      ...medicationEntries,
      ...removedMedicationRequestEntries,
    ],
  };
}

export function buildPrescriptionBundle(
  values: PrescriptionFormValues,
  patientId: string,
): fhir4.Bundle {
  return buildPrescriptionTransactionBundle(values, patientId);
}

export function buildPrescriptionUpdateBundle(
  values: PrescriptionFormValues,
  patientId: string,
  serviceRequestId: string,
  originalMedicationRequestIds: string[],
): fhir4.Bundle {
  return buildPrescriptionTransactionBundle(values, patientId, serviceRequestId, originalMedicationRequestIds);
}

export function buildPrescriptionDeleteBundle(
  serviceRequestId: string,
  medicationRequestIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
      ...medicationRequestIds.map((id) => ({
        request: { method: "DELETE" as const, url: `MedicationRequest/${id}` },
      })),
    ],
  };
}

// ---- 一覧・詳細表示のための parse ----

export interface PrescriptionSummary {
  id: string;
  date: string;
  settingDisplay: string;
  categoryDisplay: string;
  medicineCount: number;
}

function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
}

export function summarizeServiceRequest(sr: fhir4.ServiceRequest): PrescriptionSummary {
  const setting = codingBySystem(sr.category?.[0]?.coding, SETTING_SYSTEM);
  const category = codingBySystem(sr.category?.[1]?.coding, CATEGORY_SYSTEM);

  return {
    id: sr.id ?? "",
    date: sr.authoredOn?.slice(0, 10) ?? "",
    settingDisplay: setting?.display ?? "",
    categoryDisplay: category?.display ?? "",
    medicineCount: sr.orderDetail?.length ?? 0,
  };
}

export function prescriptionComment(sr: fhir4.ServiceRequest): string {
  return sr.note?.[0]?.text ?? "";
}

export interface PrescriptionDetailBundle {
  serviceRequest?: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
}

export function splitPrescriptionDetailBundle(bundle: fhir4.Bundle): PrescriptionDetailBundle {
  const result: PrescriptionDetailBundle = { medicationRequests: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "ServiceRequest") {
      result.serviceRequest = resource as fhir4.ServiceRequest;
    } else if (resource?.resourceType === "MedicationRequest") {
      result.medicationRequests.push(resource as fhir4.MedicationRequest);
    }
  }
  return result;
}

export interface MedicineLineDisplay {
  orderInRp: number;
  code: string;
  name: string;
  yjCode?: string;
  dose?: number;
  unit?: string;
  comment?: string;
}

export interface RpDisplay {
  rpNumber: number;
  usageCode?: string;
  usageName?: string;
  basicCategory?: string;
  doseDays?: number;
  doseCount?: number;
  usageComment?: string;
  medicines: MedicineLineDisplay[];
}

function identifierValue(mr: fhir4.MedicationRequest, system: string): string | undefined {
  return mr.identifier?.find((i) => i.system === system)?.value;
}

export function groupByRp(mrs: fhir4.MedicationRequest[]): RpDisplay[] {
  const groups = new Map<number, RpDisplay>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];
    const usageCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CODE_SYSTEM);
    const categoryCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CATEGORY_SYSTEM);

    let group = groups.get(rpNumber);
    if (!group) {
      group = {
        rpNumber,
        usageCode: usageCoding?.code,
        usageName: usageCoding?.display,
        basicCategory: categoryCoding?.display,
        doseDays: mr.dispenseRequest?.expectedSupplyDuration?.value,
        doseCount: dosage?.timing?.repeat?.count,
        usageComment: dosage?.additionalInstruction?.[0]?.text,
        medicines: [],
      };
      groups.set(rpNumber, group);
    }

    const medicineCoding = mr.medicationCodeableConcept?.coding?.find(
      (c) => c.system === MEDICINE_CODE_SYSTEM,
    );
    const yjCoding = mr.medicationCodeableConcept?.coding?.find(
      (c) => c.system === YJ_CODE_SYSTEM,
    );

    group.medicines.push({
      orderInRp,
      code: medicineCoding?.code ?? "",
      name: medicineCoding?.display ?? mr.medicationCodeableConcept?.text ?? "",
      yjCode: yjCoding?.code ?? undefined,
      dose: dosage?.doseAndRate?.[0]?.doseQuantity?.value,
      unit: dosage?.doseAndRate?.[0]?.doseQuantity?.unit,
      comment: mr.note?.[0]?.text,
    });
  }

  const result = Array.from(groups.values());
  result.forEach((g) => g.medicines.sort((a, b) => a.orderInRp - b.orderInRp));
  result.sort((a, b) => a.rpNumber - b.rpNumber);
  return result;
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(id, 剤形など)は保存されていないため、フォーム上で
// 再選択されない限り、コード・名称・単位など保存済みの項目のみを持つ簡易オブジェクトとして復元する。

function medicineFromCoding(mr: fhir4.MedicationRequest): Medicine | null {
  const coding = mr.medicationCodeableConcept?.coding?.find((c) => c.system === MEDICINE_CODE_SYSTEM);
  if (!coding) return null;
  const yjCoding = mr.medicationCodeableConcept?.coding?.find((c) => c.system === YJ_CODE_SYSTEM);
  return {
    id: 0,
    medicine_code: coding.code ?? "",
    name: coding.display ?? mr.medicationCodeableConcept?.text ?? "",
    name_kana: null,
    unit_code: null,
    unit_name: mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.unit ?? null,
    dosage_form: null,
    yakka_code: null,
    yakko_code: null,
    yakko_name: null,
    yj_code: yjCoding?.code ?? null,
    price: null,
    generic_name_description: null,
    abolished_on: null,
  };
}

function usageFromCoding(mr: fhir4.MedicationRequest): MedicineUsage | null {
  const dosage = mr.dosageInstruction?.[0];
  const usageCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CODE_SYSTEM);
  const categoryCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CATEGORY_SYSTEM);
  if (!usageCoding) return null;
  return {
    id: 0,
    usage_code: usageCoding.code ?? "",
    usage_name: usageCoding.display ?? "",
    basic_usage_category_code: categoryCoding?.code ?? null,
    basic_usage_category: categoryCoding?.display ?? null,
    detailed_usage_category_code: null,
    detailed_usage_category: null,
    timing_category_code: null,
    timing_category: null,
  };
}

export function parsePrescriptionForm(
  sr: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
): PrescriptionFormValues {
  const setting = (codingBySystem(sr.category?.[0]?.coding, SETTING_SYSTEM)?.code ??
    "") as PrescriptionSetting;
  const category = codingBySystem(sr.category?.[1]?.coding, CATEGORY_SYSTEM)?.code ?? "";

  const rpGroups = new Map<number, RpValues & { medicinesByOrder: Map<number, MedicineLineValues> }>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = rpGroups.get(rpNumber);
    if (!group) {
      group = {
        usage: usageFromCoding(mr),
        doseDays: mr.dispenseRequest?.expectedSupplyDuration?.value != null
          ? String(mr.dispenseRequest.expectedSupplyDuration.value)
          : "",
        doseCount: dosage?.timing?.repeat?.count != null ? String(dosage.timing.repeat.count) : "",
        usageComment: dosage?.additionalInstruction?.[0]?.text ?? "",
        medicines: [],
        medicinesByOrder: new Map(),
      };
      rpGroups.set(rpNumber, group);
    }

    const doseValue = dosage?.doseAndRate?.[0]?.doseQuantity?.value;
    group.medicinesByOrder.set(orderInRp, {
      id: mr.id,
      medicine: medicineFromCoding(mr),
      dose: doseValue != null ? String(doseValue) : "",
      comment: mr.note?.[0]?.text ?? "",
    });
  }

  const rps: RpValues[] = Array.from(rpGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => ({
      usage: group.usage,
      doseDays: group.doseDays,
      doseCount: group.doseCount,
      usageComment: group.usageComment,
      medicines: Array.from(group.medicinesByOrder.entries())
        .sort(([a], [b]) => a - b)
        .map(([, medLine]) => medLine),
    }));

  return {
    setting,
    category,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    comment: prescriptionComment(sr),
    rps: rps.length ? rps : [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}
