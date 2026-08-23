import { today } from "../lib/dates";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import { emptyOrderContext, type OrderContext } from "../orderContext";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { codingBySystem, findSettingDisplay, orderComment, SETTING_OPTIONS } from "./shared";

export { codingBySystem, SETTING_OPTIONS };

// ローカル拡張・コードシステム。JP Core / FHIR 標準に存在しない項目を表現するための、
// この処方オーダー機能専用の URI。
// 入外区分。注射オーダーでも同じ区分(入院/外来)を使うので injectionHelpers.ts と共用する
// (URI の "prescription-" は登録済みデータと揃えるためそのまま)。
// オーダー種別。処方・注射・検体検査はどれも ServiceRequest で保存するので、
// どの種類のオーダーかを category に持たせて振り分ける(処方は注射より前から
// 存在するため、種別を持たない ServiceRequest は処方として扱う)。
export const ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type";

export const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting";
// 処方区分。処方オーダーだけが持つ CodeSystem なので、処方一覧では上流の
// category 検索(system のみ指定)で処方オーダーだけを絞り込むのにも使う。
export const PRESCRIPTION_CATEGORY_SYSTEM =
  "http://fhir-client.local/CodeSystem/prescription-category";
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request"; // orderDetail→MedicationRequest 参照
// 依頼科(診療科 Organization)。ServiceRequest / MedicationRequest には診療科を持つ
// 標準要素が無い(FHIR では Encounter 経由で表現する)ため、参照をローカル拡張で持たせる。
// 依頼医師は標準の requester に入れる。
const ORDER_DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/order-department";
// オーダー時点の入院病棟(病棟 Location)。標準要素が無いのは依頼科と同じ理由(FHIR では
// Encounter 経由で表す)。部門の一覧が 1 行ずつ入院を引き直さずに済むよう、オーダー側に
// 焼き付ける(入外区分を category に焼き付けているのと同じ考え方)。転棟しても書き換えない
// ので、値は「そのオーダーを出した時点でどの病棟に居たか」を表す。
const ORDER_WARD_EXT_URL = "http://fhir-client.local/StructureDefinition/order-ward";
// レセプト電算コード（6始まり9桁）。JP Core の MedicationCode ValueSet には
// レセ電コードに対応する正式な CodeSystem が定義されていないため、ローカル URI を使用。
// (注射オーダー injectionHelpers.ts とも共用する)
export const MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code";
// 個別医薬品コード（YJコード）。JP Core（CAPS）で定義された正式な CodeSystem URL。
export const YJ_CODE_SYSTEM = "http://capstandard.jp/iyaku.info/CodeSystem/YJ-code";
// 医薬品一般名処方コード(厚労省保険局の一般名処方マスタ)。JP Core の MedicationCode
// ValueSet に含まれる正式な CodeSystem で、一般名処方はこのコードだけを載せる
// (特定の銘柄を指さないので、レセ電コード・YJコードは付けない)。
export const GENERAL_ORDER_CODE_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode";
const USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage";
const USAGE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category";

// JP Core: MedicationRequest.identifier の必須スライス。値を入れないと警告になる。
export const RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber";
export const ORDER_IN_RP_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex";

export const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

const BASIC_USAGE_CATEGORY_ORAL = "内服";
const BASIC_USAGE_CATEGORY_AS_NEEDED = "頓服";

export type PrescriptionSetting = "inpatient" | "outpatient" | "";

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
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない処方。
  problem: ProblemRef | null;
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

// problem を渡すと対象プロブレムを選択済みで開く(プロブレムリストで選んでいる
// プロブレムをそのまま新規処方の対象にするため)。
export function emptyPrescriptionForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): PrescriptionFormValues {
  return {
    setting,
    category: "",
    authoredDate: today(),
    comment: "",
    problem,
    rps: [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}

function findCategoryDisplay(setting: PrescriptionSetting, code: string): string {
  if (!setting) return code;
  return CATEGORY_OPTIONS[setting].find((c) => c.code === code)?.display ?? code;
}

/**
 * 診療科(Organization)を指すローカル拡張。オーダーの依頼科のほか、検査結果
 * (DiagnosticReport)の診療科にも同じ拡張を使う。参照を引き直さずに一覧・カルテで
 * 名前を出せるよう display を埋めておく(PractitionerRole と同じ方針)。
 */
export function departmentExtension(departmentId: string, departmentName: string): fhir4.Extension {
  return {
    url: ORDER_DEPARTMENT_EXT_URL,
    valueReference: {
      reference: `Organization/${departmentId}`,
      ...(departmentName ? { display: departmentName } : {}),
    },
  };
}

/** ローカル拡張に入れた診療科。未設定なら id・名前とも空。 */
export function departmentOf(resource: { extension?: fhir4.Extension[] }): {
  departmentId: string;
  departmentName: string;
} {
  const reference = resource.extension?.find(
    (e) => e.url === ORDER_DEPARTMENT_EXT_URL,
  )?.valueReference;
  return {
    departmentId: reference?.reference?.split("/").pop() ?? "",
    departmentName: reference?.display ?? "",
  };
}

/**
 * 入院病棟(Location)を指すローカル拡張。依頼科と同じく、参照を引き直さずに部門の一覧で
 * 名前を出せるよう display を埋めておく。
 */
export function wardExtension(wardId: string, wardName: string): fhir4.Extension {
  return {
    url: ORDER_WARD_EXT_URL,
    valueReference: {
      reference: `Location/${wardId}`,
      ...(wardName ? { display: wardName } : {}),
    },
  };
}

/** ローカル拡張に入れたオーダー時点の入院病棟。未設定(外来オーダー)なら id・名前とも空。 */
export function wardOf(resource: { extension?: fhir4.Extension[] }): {
  wardId: string;
  wardName: string;
} {
  const reference = resource.extension?.find((e) => e.url === ORDER_WARD_EXT_URL)?.valueReference;
  return {
    wardId: reference?.reference?.split("/").pop() ?? "",
    wardName: reference?.display ?? "",
  };
}

/**
 * オーダーに焼き付ける「誰が・どの科で・どの病棟から」。依頼科・依頼医師はユーザーが選ぶ
 * (OrderContext)が、病棟は選ぶものではなく登録時点の在院状況なので、任意の追加とする。
 */
export interface OrderAttribution extends OrderContext {
  /** オーダー時点の入院病棟(Location.id)。外来オーダーでは空。 */
  wardId?: string;
  wardName?: string;
}

/**
 * 入院のオーダーにだけ在院病棟を添える。入外区分を手で「外来」に変えたときは付けない
 * (一覧の区分列と病棟列が食い違わないように)。
 */
export function withOrderWard(
  requester: OrderContext,
  setting: PrescriptionSetting,
  ward: { wardId: string; wardName: string },
): OrderAttribution {
  if (setting !== "inpatient" || !ward.wardId) return requester;
  return { ...requester, wardId: ward.wardId, wardName: ward.wardName };
}

// 依頼医師は標準の requester、依頼科と入院病棟はローカル拡張に入れる。
export function applyOrderContext(
  resource: fhir4.ServiceRequest | fhir4.MedicationRequest,
  requester: OrderAttribution,
) {
  if (requester.practitionerId) {
    resource.requester = {
      reference: `Practitioner/${requester.practitionerId}`,
      ...(requester.practitionerName ? { display: requester.practitionerName } : {}),
    };
  }
  if (requester.departmentId) {
    resource.extension = [
      ...(resource.extension ?? []),
      departmentExtension(requester.departmentId, requester.departmentName),
    ];
  }
  if (requester.wardId) {
    resource.extension = [
      ...(resource.extension ?? []),
      wardExtension(requester.wardId, requester.wardName ?? ""),
    ];
  }
}

/**
 * 医薬品の CodeableConcept。銘柄はレセプト電算コード(+ あれば YJ コード)、
 * 一般名処方は一般名処方コードだけを載せる。
 */
export function medicationCodeableConcept(medicine: Medicine): fhir4.CodeableConcept {
  if (medicine.generic) {
    return {
      coding: [
        {
          system: GENERAL_ORDER_CODE_SYSTEM,
          code: medicine.medicine_code,
          display: medicine.name,
        },
      ],
      text: medicine.name,
    };
  }

  return {
    coding: [
      { system: MEDICINE_CODE_SYSTEM, code: medicine.medicine_code, display: medicine.name },
      ...(medicine.yj_code
        ? [{ system: YJ_CODE_SYSTEM, code: medicine.yj_code, display: medicine.name }]
        : []),
    ],
    text: medicine.name,
  };
}

function buildMedicationRequest(
  rp: RpValues,
  medLine: MedicineLineValues,
  rpNumber: number,
  orderInRp: number,
  patientId: string,
  authoredOn: string,
  serviceRequestReference: string,
  requester: OrderContext,
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
      ? medicationCodeableConcept(medLine.medicine)
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    basedOn: [{ reference: serviceRequestReference }],
    dosageInstruction: [dosageInstruction],
  };

  if (medLine.id) resource.id = medLine.id;

  applyOrderContext(resource, requester);

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
  requester: OrderContext,
  serviceRequestId?: string,
  originalMedicationRequestIds?: string[],
): fhir4.Bundle {
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容し、fhir-server もそのまま受理する。
  const authoredOn = values.authoredDate;
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
        requester,
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
            system: PRESCRIPTION_CATEGORY_SYSTEM,
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
  // 対象プロブレム(POMR)。オーダーの適応を表す標準要素 reasonReference をそのまま使う
  // (診療記録と違いローカル拡張は不要)。紐付けは処方オーダー 1 件に対して 1 つ持たせ、
  // RP ごとに分けたいときはオーダーを分けて登録する。
  if (values.problem) {
    serviceRequest.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  applyOrderContext(serviceRequest, requester);
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

// requester: 新規はヘッダーで選択中の依頼科・依頼医師、更新は既存の処方から
// 引き継いだ値(prescriptionRequester)を渡す。
export function buildPrescriptionBundle(
  values: PrescriptionFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildPrescriptionTransactionBundle(values, patientId, requester);
}

export function buildPrescriptionUpdateBundle(
  values: PrescriptionFormValues,
  patientId: string,
  serviceRequestId: string,
  originalMedicationRequestIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return buildPrescriptionTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalMedicationRequestIds,
  );
}

// 既存の処方を DO(流用)して新規登録するためのフォーム値に変換する。
// ・用法/投与量/投与日数/コメント/対象プロブレムなど入力値はすべて引き継ぐ
// ・MedicationRequest の id を落とし、既存リソースの更新(PUT)ではなく新規登録(POST)にする
// ・処方日は DO 元ではなく当日にする
// ・入外区分はいまの患者の状態(setting)に合わせる。DO 元と変わる場合は処方区分の
//   選択肢ごと変わるので、処方区分は選び直させる。
export function buildDoPrescriptionForm(
  values: PrescriptionFormValues,
  setting: PrescriptionSetting,
): PrescriptionFormValues {
  return {
    ...values,
    setting,
    category: setting === values.setting ? values.category : "",
    authoredDate: today(),
    rps: values.rps.map((rp) => ({
      ...rp,
      medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
    })),
  };
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
  settingCode: string;
  settingDisplay: string;
  categoryCode: string;
  categoryDisplay: string;
  medicineCount: number;
}

/**
 * ServiceRequest が処方オーダーかどうか。処方は注射・検体検査などより前から存在し
 * オーダー種別(order-type)を持たないので、種別が無いことで判定する
 * (karteTimeline の振り分けと同じ規約)。
 */
export function isPrescriptionServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return !(sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM),
  );
}

export function summarizeServiceRequest(sr: fhir4.ServiceRequest): PrescriptionSummary {
  const setting = codingBySystem(sr.category?.[0]?.coding, SETTING_SYSTEM);
  const category = codingBySystem(sr.category?.[1]?.coding, PRESCRIPTION_CATEGORY_SYSTEM);

  return {
    id: sr.id ?? "",
    date: sr.authoredOn?.slice(0, 10) ?? "",
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
    categoryCode: category?.code ?? "",
    categoryDisplay: category?.display ?? "",
    medicineCount: sr.orderDetail?.length ?? 0,
  };
}

export const prescriptionComment = orderComment;
export const prescriptionProblem = orderProblem;

// 登録時に入れた依頼科・依頼医師。参照の display をそのまま名前として使うので、
// 表示のために Organization / Practitioner を引き直す必要はない。
export function prescriptionRequester(sr: fhir4.ServiceRequest): OrderAttribution {
  const department = departmentOf(sr);
  const ward = wardOf(sr);
  if (!department.departmentId && !sr.requester && !ward.wardId) return emptyOrderContext;
  return {
    ...department,
    // 編集で保存し直しても登録時点の病棟が残るよう、読み戻してそのまま渡す
    // (依頼科・依頼医師を引き継ぐのと同じ扱い)。
    ...(ward.wardId ? ward : {}),
    practitionerId: sr.requester?.reference?.split("/").pop() ?? "",
    practitionerName: sr.requester?.display ?? "",
  };
}

/** 「依頼科 | 依頼医師」の表示文字列。どちらも未設定なら空。 */
export function orderContextSummary(requester: OrderContext): string {
  return [requester.departmentName, requester.practitionerName].filter(Boolean).join(" | ");
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
  /** 一般名処方(【般】〜)の行。名称に【般】が付くので表示上の区別は不要だが、印刷・集計で使う。 */
  generic?: boolean;
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

export function identifierValue(mr: fhir4.MedicationRequest, system: string): string | undefined {
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

    const coding = mr.medicationCodeableConcept?.coding;
    const genericCoding = codingBySystem(coding, GENERAL_ORDER_CODE_SYSTEM);
    const medicineCoding = genericCoding ?? codingBySystem(coding, MEDICINE_CODE_SYSTEM);
    const yjCoding = codingBySystem(coding, YJ_CODE_SYSTEM);

    group.medicines.push({
      orderInRp,
      code: medicineCoding?.code ?? "",
      name: medicineCoding?.display ?? mr.medicationCodeableConcept?.text ?? "",
      yjCode: yjCoding?.code ?? undefined,
      generic: genericCoding ? true : undefined,
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

export function medicineFromCoding(mr: fhir4.MedicationRequest): Medicine | null {
  const codings = mr.medicationCodeableConcept?.coding;
  // 一般名処方は一般名処方コードだけを持ち、レセ電コードは無い。
  const genericCoding = codingBySystem(codings, GENERAL_ORDER_CODE_SYSTEM);
  const coding = genericCoding ?? codingBySystem(codings, MEDICINE_CODE_SYSTEM);
  if (!coding) return null;
  const yjCoding = codingBySystem(codings, YJ_CODE_SYSTEM);
  const name = coding.display ?? mr.medicationCodeableConcept?.text ?? "";
  return {
    id: 0,
    medicine_code: coding.code ?? "",
    name,
    name_kana: null,
    unit_code: null,
    unit_name: mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity?.unit ?? null,
    dosage_form: null,
    injection_volume: null,
    yakka_code: null,
    yakko_code: null,
    yakko_name: null,
    yj_code: yjCoding?.code ?? null,
    price: null,
    generic_name_description: genericCoding ? name : null,
    abolished_on: null,
    ...(genericCoding ? { generic: true } : {}),
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
  const category = codingBySystem(sr.category?.[1]?.coding, PRESCRIPTION_CATEGORY_SYSTEM)?.code ?? "";

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
    problem: prescriptionProblem(sr),
    rps: rps.length ? rps : [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}
