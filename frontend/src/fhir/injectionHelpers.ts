import type { OrderContext } from "../orderContext";
import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import {
  MEDICINE_CODE_SYSTEM,
  ORDER_IN_RP_SYSTEM,
  RP_NUMBER_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  UNITS_OF_MEASURE_SYSTEM,
  YJ_CODE_SYSTEM,
  applyOrderContext,
  codingBySystem,
  identifierValue,
  medicineFromCoding,
  type MedicineLineDisplay,
  type MedicineLineValues,
  type PrescriptionSetting,
  emptyMedicineLine,
} from "./prescriptionHelpers";

// 注射オーダー(JAHIS注射データ交換規約 / JP_MedicationRequest_Injection 参考)。
// 処方と同じく ServiceRequest(オーダーヘッダ) + 薬剤ごとの MedicationRequest で表現し、
// RP(剤グループ) = 同じルートから同時に投与する薬剤のまとまり(混注)とする。
//
// 用法は JP Core の JP_MedicationDosage_Injection に寄せて dosageInstruction に持つ:
//   - route:  投与経路。JP Core route-codes(HL7 Table 0162 ベース)
//   - site:   投与部位。JAMI標準用法規格 表13 外用部位コード(SS-MIX2 でも利用)
//   - method: 手技。JAMI詳細用法コード(2桁)の注射手技(30〜3Z)
//   - ライン: JP Core の JP_MedicationDosage_Line 拡張(公式コード表が無いためローカルコード)
//   - 投与速度: doseAndRate.rateQuantity(mL/h)
//   - 開始時刻: timing.event(複数可)
//   - 用法種別(点滴/ワンショット): 対応する標準コード表が存在しないためローカル拡張

// 処方の ServiceRequest と区別するためのオーダー種別。category に付与する。
export const ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type";
export const INJECTION_ORDER_TYPE = { code: "injection", display: "注射" };

// 注射区分。処方区分(処方の CATEGORY_SYSTEM)と選択肢が違うので別のコードシステムにする。
const CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/injection-category";

// 用法種別(点滴/ワンショット)。JAHIS・JP Core に対応するコード表が無いためローカル定義。
const USAGE_TYPE_EXT_URL = "http://fhir-client.local/StructureDefinition/injection-usage-type";
const USAGE_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/injection-usage-type";

// 投与経路。JP Core route-codes(HL7 Table 0162 ベース)のうち注射で使うもの。
const ROUTE_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/route-codes";

// 投与部位。JAMI標準用法規格 表13 外用部位コード(urn:oid:1.2.392.200250.2.2.20.32)。
const SITE_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.32";

// 手技。JAMI詳細用法コード(urn:oid:1.2.392.200250.2.2.20.40)の注射手技(30〜3Z)。
const METHOD_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.40";

// ライン。拡張 URL は JP Core の JP_MedicationDosage_Line、コードは公式表が無いためローカル。
const LINE_EXT_URL = "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_Line";
const LINE_SYSTEM = "http://fhir-client.local/CodeSystem/injection-line";

export interface CodeOption {
  code: string;
  display: string;
}

// 注射区分。入外区分(処方と共通の SETTING_OPTIONS)で選択肢が変わる。
export const CATEGORY_OPTIONS: Record<Exclude<PrescriptionSetting, "">, CodeOption[]> = {
  inpatient: [
    { code: "regular", display: "定時" },
    { code: "temporary", display: "臨時" },
    { code: "emergency", display: "緊急" },
  ],
  outpatient: [{ code: "outpatient", display: "外来" }],
};

export type InjectionUsageType = "drip" | "one-shot";

export const USAGE_TYPE_OPTIONS: { code: InjectionUsageType; display: string }[] = [
  { code: "drip", display: "点滴" },
  { code: "one-shot", display: "ワンショット" },
];

/** 点滴のときの投与経路の既定値。点滴はほぼ静脈内なので未選択なら入れる。 */
export const DRIP_DEFAULT_ROUTE = "IV";

export const ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "IM", display: "筋肉内" },
  { code: "SC", display: "皮下" },
  { code: "ID", display: "皮内" },
  { code: "IA", display: "動脈内" },
  { code: "IT", display: "髄腔内" },
  { code: "IP", display: "腹腔内" },
];

// JAMI詳細用法コードの注射手技全 23 区分。
export const METHOD_OPTIONS: CodeOption[] = [
  { code: "30", display: "静脈注射" },
  { code: "31", display: "中心静脈注射" },
  { code: "32", display: "皮下注射" },
  { code: "33", display: "筋肉内注射" },
  { code: "34", display: "皮内注射" },
  { code: "35", display: "動脈注射" },
  { code: "3A", display: "硬膜外注射" },
  { code: "3B", display: "脳脊髄腔注射" },
  { code: "3C", display: "骨髄内注射" },
  { code: "3D", display: "関節腔内注射" },
  { code: "3E", display: "腱鞘内注射" },
  { code: "3F", display: "腱鞘周囲注射" },
  { code: "3G", display: "硝子体内注射" },
  { code: "3H", display: "結膜下注射" },
  { code: "3J", display: "テノン氏のう内注射" },
  { code: "3K", display: "耳茸内注射" },
  { code: "3L", display: "咽頭注射" },
  { code: "3M", display: "胸腔内注射" },
  { code: "3N", display: "痔核注射" },
  { code: "3P", display: "角膜内注射" },
  { code: "3Q", display: "球後注射" },
  { code: "3R", display: "腹腔内注射" },
  { code: "3Z", display: "局所・病巣内注射" },
];

// JAMI外用部位コードから注射でよく使う部位を抜粋(表示名はコード表のまま)。
export const SITE_OPTIONS: CodeOption[] = [
  { code: "74L", display: "左上腕" },
  { code: "74R", display: "右上腕" },
  { code: "75L", display: "左前腕" },
  { code: "75R", display: "右前腕" },
  { code: "72L", display: "左上肢" },
  { code: "72R", display: "右上肢" },
  { code: "92L", display: "左ふともも" },
  { code: "92R", display: "右ふともも" },
  { code: "8DL", display: "左臀部" },
  { code: "8DR", display: "右臀部" },
  { code: "8D0", display: "臀部" },
  { code: "890", display: "上腹部" },
  { code: "8A0", display: "下腹部" },
  { code: "91L", display: "左下肢" },
  { code: "91R", display: "右下肢" },
];

// 投与経路から手技が一意に決まる組み合わせ。静脈内(IV)だけは末梢の静脈注射(30)と
// 中心静脈注射(31)のどちらもありうるため入れない。
const ROUTE_METHODS: Record<string, string> = {
  IM: "33", // 筋肉内 → 筋肉内注射
  SC: "32", // 皮下 → 皮下注射
  ID: "34", // 皮内 → 皮内注射
  IA: "35", // 動脈内 → 動脈注射
  IT: "3B", // 髄腔内 → 脳脊髄腔注射
  IP: "3R", // 腹腔内 → 腹腔内注射
};

/**
 * 投与経路を選んだときの手技。経路から一意に決まるならその手技にする。決まらない
 * (静脈内・未選択)場合は今の手技を残すが、別の経路に固有の手技(経路を選び直す前に
 * 自動で入ったもの)なら経路と食い違うので落とす。
 */
export function methodForRoute(routeCode: string, currentMethod: string): string {
  const unique = ROUTE_METHODS[routeCode];
  if (unique) return unique;
  return Object.values(ROUTE_METHODS).includes(currentMethod) ? "" : currentMethod;
}

export const LINE_OPTIONS: CodeOption[] = [
  { code: "peripheral", display: "末梢ルート" },
  { code: "peripheral-side", display: "末梢ルート(側管)" },
  { code: "central", display: "中心静脈ルート" },
  { code: "central-side", display: "中心静脈ルート(側管)" },
];

function displayOf(options: CodeOption[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

function findCategoryDisplay(setting: PrescriptionSetting, code: string): string {
  if (!setting) return code;
  return displayOf(CATEGORY_OPTIONS[setting], code);
}

// 投与時間の選択肢。総投与量(mL)をこの時間で割って投与速度(mL/h)を出す。
export const INFUSION_HOURS_OPTIONS: { value: string; display: string }[] = [
  { value: "0.5", display: "30分" },
  { value: "1", display: "1時間" },
  { value: "1.5", display: "1時間30分" },
  { value: "2", display: "2時間" },
  { value: "3", display: "3時間" },
  { value: "4", display: "4時間" },
  { value: "5", display: "5時間" },
  { value: "6", display: "6時間" },
  { value: "8", display: "8時間" },
  { value: "12", display: "12時間" },
  { value: "24", display: "24時間" },
];

export interface RpDoseTotal {
  /** mL に換算できた薬剤の合計(mL)。 */
  ml: number;
  /** mL 換算できなかった薬剤の数(粉末バイアル等、容量がマスタに無いもの)。 */
  unconvertible: number;
}

/**
 * RP の総投与量。投与量は薬価算定単位(管・瓶・袋…)で入力するので、投与量換算マスタの
 * 係数(1[薬価算定単位] = factor[mL])を掛けて mL に揃えてから合計する。
 */
export function rpDoseTotal(
  medicines: MedicineLineValues[],
  mlFactors: Map<string, number>,
): RpDoseTotal {
  let ml = 0;
  let unconvertible = 0;
  for (const line of medicines) {
    const code = line.medicine?.medicine_code;
    const dose = Number(line.dose);
    if (!code || !line.dose || !Number.isFinite(dose)) continue;
    const factor = mlFactors.get(code);
    if (factor === undefined) unconvertible += 1;
    else ml += dose * factor;
  }
  return { ml, unconvertible };
}

/** 総投与量(mL)と投与時間から投与速度(mL/h)を求める。表示・保存とも小数第 1 位まで。 */
export function infusionRate(totalMl: number, hours: string): string {
  const h = Number(hours);
  if (!totalMl || !h) return "";
  return String(Math.round((totalMl / h) * 10) / 10);
}

export interface InjectionRpValues {
  usageType: InjectionUsageType | "";
  routeCode: string;
  siteCode: string;
  methodCode: string;
  lineCode: string;
  /** 投与速度(mL/h)。点滴のときのみ使用。infusionHours を選んでいる間は自動計算値で埋まる。 */
  rate: string;
  /**
   * 投与時間。総投与量から投与速度を自動計算するための入力で、FHIR には保存しない
   * (保存するのは計算結果の投与速度)。空なら投与速度を直接入力する。
   */
  infusionHours: string;
  /** 開始時刻(HH:mm)。日付は注射日を使う。複数設定可能。 */
  startTimes: string[];
  usageComment: string;
  medicines: MedicineLineValues[];
}

export interface InjectionFormValues {
  setting: PrescriptionSetting;
  category: string;
  authoredDate: string;
  comment: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない注射。
  problem: ProblemRef | null;
  rps: InjectionRpValues[];
}

/** 入外区分に対応する注射区分。選択肢が 1 つだけならそれを既定にする。 */
export function defaultCategory(setting: PrescriptionSetting): string {
  const options = setting ? CATEGORY_OPTIONS[setting] : [];
  return options.length === 1 ? options[0].code : "";
}

export const emptyInjectionRp: InjectionRpValues = {
  usageType: "",
  routeCode: "",
  siteCode: "",
  methodCode: "",
  lineCode: "",
  rate: "",
  infusionHours: "",
  startTimes: [],
  usageComment: "",
  medicines: [{ ...emptyMedicineLine }],
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyInjectionForm(problem: ProblemRef | null = null): InjectionFormValues {
  return {
    setting: "outpatient",
    category: defaultCategory("outpatient"),
    authoredDate: today(),
    comment: "",
    problem,
    rps: [{ ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
  };
}

// ---- FHIR dateTime との相互変換 ----
//
// 開始時刻はフォーム上は時刻(HH:mm)だけを持ち、日付は注射日を使う。FHIR の dateTime は
// 時刻を持つならタイムゾーンが必須なので、実行環境のオフセットを付けて保存する。

function toFhirDateTime(date: string, time: string): string {
  const offsetMinutes = -new Date(`${date}T${time}`).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** FHIR の dateTime から時刻(HH:mm)だけを取り出す。 */
function toLocalTime(fhirDateTime: string): string {
  return fhirDateTime.slice(11, 16);
}

// ---- FHIR リソースの組み立て ----

// ServiceRequest が注射オーダーかどうか。処方(注射より前から存在し order-type を
// 持たない)との振り分けに使うため、category のローカルコードだけを見る。
export function isInjectionServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === INJECTION_ORDER_TYPE.code,
    ),
  );
}

function usageTypeDisplay(code: string): string {
  return USAGE_TYPE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// カルテカードなどに出す用法 1 行の要約(「点滴 静脈内 左前腕 100mL/h」)。
function usageSummaryText(rp: InjectionRpValues): string {
  return [
    rp.usageType ? usageTypeDisplay(rp.usageType) : "",
    rp.methodCode ? displayOf(METHOD_OPTIONS, rp.methodCode) : "",
    rp.routeCode ? displayOf(ROUTE_OPTIONS, rp.routeCode) : "",
    rp.siteCode ? displayOf(SITE_OPTIONS, rp.siteCode) : "",
    rp.lineCode ? displayOf(LINE_OPTIONS, rp.lineCode) : "",
    rp.usageType === "drip" && rp.rate ? `${rp.rate}mL/h` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildInjectionMedicationRequest(
  rp: InjectionRpValues,
  medLine: MedicineLineValues,
  rpNumber: number,
  orderInRp: number,
  patientId: string,
  authoredOn: string,
  serviceRequestReference: string,
  requester: OrderContext,
): fhir4.MedicationRequest {
  const dosageInstruction: fhir4.Dosage = {
    text: usageSummaryText(rp) || undefined,
  };

  if (rp.usageType) {
    dosageInstruction.extension = [
      {
        url: USAGE_TYPE_EXT_URL,
        valueCodeableConcept: {
          coding: [
            {
              system: USAGE_TYPE_SYSTEM,
              code: rp.usageType,
              display: usageTypeDisplay(rp.usageType),
            },
          ],
        },
      },
    ];
  }
  if (rp.lineCode) {
    dosageInstruction.extension = [
      ...(dosageInstruction.extension ?? []),
      {
        url: LINE_EXT_URL,
        valueCodeableConcept: {
          coding: [
            { system: LINE_SYSTEM, code: rp.lineCode, display: displayOf(LINE_OPTIONS, rp.lineCode) },
          ],
        },
      },
    ];
  }

  if (rp.startTimes.length) {
    dosageInstruction.timing = {
      event: rp.startTimes.map((time) => toFhirDateTime(authoredOn, time)),
    };
  }
  if (rp.routeCode) {
    dosageInstruction.route = {
      coding: [
        { system: ROUTE_SYSTEM, code: rp.routeCode, display: displayOf(ROUTE_OPTIONS, rp.routeCode) },
      ],
    };
  }
  if (rp.siteCode) {
    dosageInstruction.site = {
      coding: [
        { system: SITE_SYSTEM, code: rp.siteCode, display: displayOf(SITE_OPTIONS, rp.siteCode) },
      ],
    };
  }
  if (rp.methodCode) {
    dosageInstruction.method = {
      coding: [
        {
          system: METHOD_SYSTEM,
          code: rp.methodCode,
          display: displayOf(METHOD_OPTIONS, rp.methodCode),
        },
      ],
    };
  }

  const doseAndRate: fhir4.DosageDoseAndRate = {};
  if (medLine.dose) {
    doseAndRate.doseQuantity = {
      value: Number(medLine.dose),
      unit: medLine.medicine?.unit_name ?? undefined,
    };
  }
  // 投与速度は用法(RP)の値だが、FHIR 上は各 MedicationRequest に持つしかないので
  // 同じ RP の全薬剤に同じ値を入れる(用法コードなどと同じ扱い)。
  if (rp.usageType === "drip" && rp.rate) {
    doseAndRate.rateQuantity = {
      value: Number(rp.rate),
      unit: "mL/h",
      system: UNITS_OF_MEASURE_SYSTEM,
      code: "mL/h",
    };
  }
  if (doseAndRate.doseQuantity || doseAndRate.rateQuantity) {
    dosageInstruction.doseAndRate = [doseAndRate];
  }

  if (rp.usageComment) {
    dosageInstruction.additionalInstruction = [{ text: rp.usageComment }];
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

  applyOrderContext(resource, requester);

  if (medLine.comment) {
    resource.note = [{ text: medLine.comment }];
  }

  return resource;
}

// 処方の buildPrescriptionTransactionBundle と同じ構成。ServiceRequest の category に
// オーダー種別(注射)を持たせる点と、orderDetail の拡張 URL を共用する点だけ異なる。
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request";

function buildInjectionTransactionBundle(
  values: InjectionFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalMedicationRequestIds?: string[],
): fhir4.Bundle {
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
      const resource = buildInjectionMedicationRequest(
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
    // 読み出し側(summarizeInjectionServiceRequest)は system で引くので順序には依存しない。
    category: [
      {
        coding: [{ system: ORDER_TYPE_SYSTEM, ...INJECTION_ORDER_TYPE }],
      },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: values.setting,
            display: displayOf(SETTING_OPTIONS, values.setting),
          },
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

export function buildInjectionBundle(
  values: InjectionFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildInjectionTransactionBundle(values, patientId, requester);
}

export function buildInjectionUpdateBundle(
  values: InjectionFormValues,
  patientId: string,
  serviceRequestId: string,
  originalMedicationRequestIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return buildInjectionTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalMedicationRequestIds,
  );
}

// 既存の注射を DO(流用)して新規登録するためのフォーム値に変換する。処方の DO と同じく
// id を落として新規登録(POST)にし、注射日は当日にする。開始時刻は時刻だけを持ち
// 日付は注射日から決まるので、そのまま引き継げる。
export function buildDoInjectionForm(values: InjectionFormValues): InjectionFormValues {
  return {
    ...values,
    authoredDate: today(),
    rps: values.rps.map((rp) => ({
      ...rp,
      medicines: rp.medicines.map(({ id: _id, ...rest }) => rest),
    })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface InjectionRpDisplay {
  rpNumber: number;
  usageTypeDisplay?: string;
  routeDisplay?: string;
  siteDisplay?: string;
  methodDisplay?: string;
  lineDisplay?: string;
  /** 投与速度(mL/h)。 */
  rate?: number;
  /** 開始時刻(HH:mm)。 */
  startTimes: string[];
  usageComment?: string;
  medicines: MedicineLineDisplay[];
}

function extensionCoding(
  extensions: fhir4.Extension[] | undefined,
  url: string,
): fhir4.Coding | undefined {
  return extensions?.find((e) => e.url === url)?.valueCodeableConcept?.coding?.[0];
}

export function groupInjectionByRp(mrs: fhir4.MedicationRequest[]): InjectionRpDisplay[] {
  const groups = new Map<number, InjectionRpDisplay>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = groups.get(rpNumber);
    if (!group) {
      const doseAndRate = dosage?.doseAndRate?.[0];
      group = {
        rpNumber,
        usageTypeDisplay: extensionCoding(dosage?.extension, USAGE_TYPE_EXT_URL)?.display,
        routeDisplay: dosage?.route?.coding?.[0]?.display,
        siteDisplay: dosage?.site?.coding?.[0]?.display,
        methodDisplay: dosage?.method?.coding?.[0]?.display,
        lineDisplay: extensionCoding(dosage?.extension, LINE_EXT_URL)?.display,
        rate: doseAndRate?.rateQuantity?.value,
        startTimes: (dosage?.timing?.event ?? []).map(toLocalTime),
        usageComment: dosage?.additionalInstruction?.[0]?.text,
        medicines: [],
      };
      groups.set(rpNumber, group);
    }

    const medicineCoding = codingBySystem(mr.medicationCodeableConcept?.coding, MEDICINE_CODE_SYSTEM);
    const yjCoding = codingBySystem(mr.medicationCodeableConcept?.coding, YJ_CODE_SYSTEM);

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

export interface InjectionSummary {
  settingDisplay: string;
  categoryDisplay: string;
}

// category はオーダー種別・入外区分・注射区分の 3 つを持つので、処方(添字で引く
// summarizeServiceRequest)と違い system で引く。
function categoryCoding(sr: fhir4.ServiceRequest, system: string): fhir4.Coding | undefined {
  for (const category of sr.category ?? []) {
    const coding = codingBySystem(category.coding, system);
    if (coding) return coding;
  }
  return undefined;
}

export function summarizeInjectionServiceRequest(sr: fhir4.ServiceRequest): InjectionSummary {
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    categoryDisplay: categoryCoding(sr, CATEGORY_SYSTEM)?.display ?? "",
  };
}

export function injectionComment(sr: fhir4.ServiceRequest): string {
  return sr.note?.[0]?.text ?? "";
}

// 注射が対象としているプロブレム。処方と同じく reasonReference の Condition 参照を拾う。
export function injectionProblem(sr: fhir4.ServiceRequest | undefined): ProblemRef | null {
  for (const reference of sr?.reasonReference ?? []) {
    const problem = problemRefFromReference(reference);
    if (problem) return problem;
  }
  return null;
}

// ---- 編集フォームへの復元 ----

export function parseInjectionForm(
  sr: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
): InjectionFormValues {
  const rpGroups = new Map<
    number,
    InjectionRpValues & { medicinesByOrder: Map<number, MedicineLineValues> }
  >();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = rpGroups.get(rpNumber);
    if (!group) {
      const doseAndRate = dosage?.doseAndRate?.[0];
      group = {
        usageType: (extensionCoding(dosage?.extension, USAGE_TYPE_EXT_URL)?.code ??
          "") as InjectionUsageType | "",
        routeCode: dosage?.route?.coding?.[0]?.code ?? "",
        siteCode: dosage?.site?.coding?.[0]?.code ?? "",
        methodCode: dosage?.method?.coding?.[0]?.code ?? "",
        lineCode: extensionCoding(dosage?.extension, LINE_EXT_URL)?.code ?? "",
        rate:
          doseAndRate?.rateQuantity?.value != null ? String(doseAndRate.rateQuantity.value) : "",
        // 投与時間は保存していないので、編集時は投与速度を直接入力する状態に戻す。
        infusionHours: "",
        startTimes: (dosage?.timing?.event ?? []).map(toLocalTime),
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

  const rps: InjectionRpValues[] = Array.from(rpGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => ({
      usageType: group.usageType,
      routeCode: group.routeCode,
      siteCode: group.siteCode,
      methodCode: group.methodCode,
      lineCode: group.lineCode,
      rate: group.rate,
      infusionHours: group.infusionHours,
      startTimes: group.startTimes,
      usageComment: group.usageComment,
      medicines: Array.from(group.medicinesByOrder.entries())
        .sort(([a], [b]) => a - b)
        .map(([, medLine]) => medLine),
    }));

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    category: categoryCoding(sr, CATEGORY_SYSTEM)?.code ?? "",
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    comment: injectionComment(sr),
    problem: injectionProblem(sr),
    rps: rps.length
      ? rps
      : [{ ...emptyInjectionRp, startTimes: [], medicines: [{ ...emptyMedicineLine }] }],
  };
}
