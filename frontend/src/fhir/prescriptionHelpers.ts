import type { Medicine, MedicineUsage } from "../api/masterClient";

// ローカル拡張・コードシステム。JP Core / FHIR 標準に存在しない項目を表現するための、
// この処方オーダー機能専用の URI。
const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting"; // 入外区分
const CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-category"; // 処方区分
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request"; // orderDetail→MedicationRequest 参照
const MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code";
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
  serviceRequestUuid: string,
  mrUuid: string,
): { fullUrl: string; resource: fhir4.MedicationRequest } {
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
          ],
          text: medLine.medicine.name,
        }
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    basedOn: [{ reference: `urn:uuid:${serviceRequestUuid}` }],
    dosageInstruction: [dosageInstruction],
  };

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

  return { fullUrl: `urn:uuid:${mrUuid}`, resource };
}

export function buildPrescriptionBundle(
  values: PrescriptionFormValues,
  patientId: string,
): fhir4.Bundle {
  const authoredOn = authoredOnDateTime(values.authoredDate);
  const serviceRequestUuid = crypto.randomUUID();

  const orderDetail: fhir4.CodeableConcept[] = [];
  const medicationEntries: { fullUrl: string; resource: fhir4.MedicationRequest }[] = [];

  values.rps.forEach((rp, rpIndex) => {
    const rpNumber = rpIndex + 1;
    rp.medicines.forEach((medLine, medIndex) => {
      const orderInRp = medIndex + 1;
      const mrUuid = crypto.randomUUID();
      const entry = buildMedicationRequest(
        rp,
        medLine,
        rpNumber,
        orderInRp,
        patientId,
        authoredOn,
        serviceRequestUuid,
        mrUuid,
      );
      medicationEntries.push(entry);
      orderDetail.push({
        extension: [
          {
            url: ORDER_DETAIL_MR_EXT_URL,
            valueReference: { reference: entry.fullUrl },
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

  if (values.comment) {
    serviceRequest.note = [{ text: values.comment }];
  }

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: `urn:uuid:${serviceRequestUuid}`,
        resource: serviceRequest,
        request: { method: "POST", url: "ServiceRequest" },
      },
      ...medicationEntries.map((entry) => ({
        fullUrl: entry.fullUrl,
        resource: entry.resource,
        request: { method: "POST" as const, url: "MedicationRequest" },
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

    group.medicines.push({
      orderInRp,
      code: medicineCoding?.code ?? "",
      name: medicineCoding?.display ?? mr.medicationCodeableConcept?.text ?? "",
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
