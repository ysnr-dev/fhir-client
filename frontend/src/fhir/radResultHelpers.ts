import { toFhirDateTime } from "./clinicalNoteHelpers";
import { ROUTE_SYSTEM, type CodeOption } from "./injectionHelpers";
import { MEDICINE_CODE_SYSTEM, ORDER_TYPE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import { RAD_ORDER_TYPE } from "./radOrderHelpers";
import { buildRadTaskUpdate } from "./radTaskHelpers";

// 放射線検査の実施記録。設計は docs/rad-result-design.md を参照。
//
//   ServiceRequest(オーダー)
//    └ basedOn ← Procedure (実施記録。オーダー単位で1件)
//         │  code     = 主たる手技(レセ電算 診療行為コード)
//         │  usedCode = 使用した器材
//         │  note     = 実施コメント
//         ├ partOf ← Procedure               (2件目以降の手技)
//         ├ partOf ← MedicationAdministration (造影剤)
//         └ partOf ← Observation              (被曝線量)
//
// 造影剤を usedCode に混ぜないのは、usedCode(CodeableConcept)が数量を持てないため。
// 造影剤は mL が薬剤料の算定根拠になるので MedicationAdministration にする。

/** JP Core の Procedure プロファイル。上流の登録先。 */
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** Procedure.code。撮影項目マスタの receipt_code と同じレセ電算の診療行為コード。 */
const RAD_PROCEDURE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/rad-procedure-code";
/** usedCode。施設内の器材コード(放射線器材マスタ)。 */
const RAD_MATERIAL_SYSTEM = "http://fhir-client.local/CodeSystem/rad-material";
/** usedCode。算定に使うレセプト電算の特定器材コード。 */
const MEDICAL_MATERIAL_SYSTEM = "http://fhir-client.local/CodeSystem/medical-material";
/** 被曝線量の測定項目。DICOM RDSR を取り込む段階で標準コードを追加する。 */
const RAD_DOSE_SYSTEM = "http://fhir-client.local/CodeSystem/rad-dose";

// usedCode は CodeableConcept なので数量を持てない。器材は「造影剤注入用チューブ 2本」の
// ように数量で算定するため、拡張で数量を添える(行を数量ぶん繰り返す形にはしない)。
const MATERIAL_QUANTITY_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rad-material-quantity";

const UCUM_SYSTEM = "http://unitsofmeasure.org";

/**
 * 造影剤の投与経路。注射の ROUTE_OPTIONS(静注・動注)に、放射線検査で使う
 * 経口(バリウム等)・注腸・膀胱内を足したもの。コード表は注射と同じ JP Core route-codes。
 */
export const RAD_ROUTE_OPTIONS: CodeOption[] = [
  { code: "IV", display: "静脈内" },
  { code: "IA", display: "動脈内" },
  { code: "PO", display: "経口" },
  { code: "PR", display: "直腸内(注腸)" },
  { code: "IB", display: "膀胱内" },
  { code: "IT", display: "髄腔内" },
  { code: "IJ", display: "関節腔内" },
];

export function radRouteDisplay(code: string): string {
  return RAD_ROUTE_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

/** 被曝線量の測定項目。モダリティごとに出す欄が変わる。 */
export type DoseKey = "ctdivol" | "dlp" | "dap" | "fluoroscopy-time";

interface DoseField {
  key: DoseKey;
  display: string;
  /** 入力欄に出す単位表記。 */
  unit: string;
  /** UCUM コード。valueQuantity に載せる。 */
  ucum: string;
}

const DOSE_FIELDS: Record<DoseKey, DoseField> = {
  ctdivol: { key: "ctdivol", display: "CTDIvol", unit: "mGy", ucum: "mGy" },
  dlp: { key: "dlp", display: "DLP", unit: "mGy·cm", ucum: "mGy.cm" },
  dap: { key: "dap", display: "DAP(面積線量)", unit: "Gy·cm²", ucum: "Gy.cm2" },
  "fluoroscopy-time": { key: "fluoroscopy-time", display: "透視時間", unit: "秒", ucum: "s" },
};

// JJ1017 の種別(モダリティ)コード → 実測が出る線量項目。
// 6=Ｘ線CT検査 / 3=Ｘ線血管撮影 / 2=Ｘ線透視・造影。
// 単純撮影(1・G など)は装置から実測値が出ないため線量欄を出さない。空欄を毎回
// 飛ばすことになると入力自体が形骸化する。
const DOSE_KEYS_BY_MODALITY: Record<string, DoseKey[]> = {
  "6": ["ctdivol", "dlp"],
  "3": ["dap", "fluoroscopy-time"],
  "2": ["dap", "fluoroscopy-time"],
};

/**
 * オーダーに載っているモダリティで出す線量欄。複数モダリティが同居する場合は和集合。
 * 該当が無ければ空(線量セクションごと出さない)。
 */
export function doseFieldsForModalities(modalityCodes: string[]): DoseField[] {
  const keys = new Set<DoseKey>();
  for (const code of modalityCodes) {
    for (const key of DOSE_KEYS_BY_MODALITY[code] ?? []) keys.add(key);
  }
  // 表示順は DOSE_FIELDS の定義順に揃える(モダリティの並びで前後させない)。
  return (Object.keys(DOSE_FIELDS) as DoseKey[]).filter((k) => keys.has(k)).map((k) => DOSE_FIELDS[k]);
}

// ---- 実施入力フォームの値 ----

/** 手技料の行。オーダー時点で確定していない追加の手技を入れる。 */
export interface RadProcedureLine {
  code: string;
  name: string;
}

/** 造影剤の行。使用量(mL)が薬剤料の算定根拠になる。 */
export interface RadContrastLine {
  medicineCode: string;
  name: string;
  /** YJ コード。処方・注射と同じ coding を載せるために持つ(無ければ空)。 */
  yjCode: string;
  /** 使用量(mL)。 */
  dose: string;
  routeCode: string;
}

/** 器材の行。算定は receiptMaterialCode(特定器材コード)で行う。 */
export interface RadMaterialLine {
  /** 施設内の器材コード。 */
  code: string;
  name: string;
  receiptMaterialCode: string;
  quantity: string;
  unitName: string;
}

export interface RadPerformFormValues {
  /** 実施時刻。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  performedAt: string;
  performerId: string;
  performerName: string;
  procedures: RadProcedureLine[];
  contrasts: RadContrastLine[];
  materials: RadMaterialLine[];
  /** 被曝線量。入力された項目だけ Observation にする。 */
  doses: Partial<Record<DoseKey, string>>;
  comment: string;
}

function usedCodeOf(line: RadMaterialLine): fhir4.CodeableConcept {
  const coding: fhir4.Coding[] = [
    { system: RAD_MATERIAL_SYSTEM, code: line.code, display: line.name },
  ];
  // 算定用のコード。施設マスタで未紐付けの器材(算定対象外)では載らない。
  if (line.receiptMaterialCode) {
    coding.push({ system: MEDICAL_MATERIAL_SYSTEM, code: line.receiptMaterialCode });
  }

  const quantity = Number(line.quantity);
  return {
    coding,
    text: line.name,
    ...(Number.isFinite(quantity) && quantity > 0
      ? {
          extension: [
            {
              url: MATERIAL_QUANTITY_EXT_URL,
              valueQuantity: { value: quantity, unit: line.unitName || undefined },
            },
          ],
        }
      : {}),
  };
}

function baseProcedure(
  values: RadPerformFormValues,
  subject: fhir4.Reference,
  orderId: string,
  performedDateTime: string,
): fhir4.Procedure {
  const procedure: fhir4.Procedure = {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "completed",
    // 処方・検体検査の Procedure と振り分けるための区分。
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...RAD_ORDER_TYPE }] },
    subject,
    basedOn: [{ reference: `ServiceRequest/${orderId}` }],
    performedDateTime,
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
  return procedure;
}

function procedureCode(line: RadProcedureLine): fhir4.CodeableConcept {
  return {
    coding: [{ system: RAD_PROCEDURE_CODE_SYSTEM, code: line.code, display: line.name }],
    text: line.name,
  };
}

function buildContrast(
  line: RadContrastLine,
  subject: fhir4.Reference,
  hubReference: string,
  effectiveDateTime: string,
): fhir4.MedicationAdministration {
  const coding: fhir4.Coding[] = [
    { system: MEDICINE_CODE_SYSTEM, code: line.medicineCode, display: line.name },
  ];
  if (line.yjCode) coding.push({ system: YJ_CODE_SYSTEM, code: line.yjCode });

  const dose = Number(line.dose);
  const dosage: fhir4.MedicationAdministrationDosage = {};
  if (Number.isFinite(dose) && dose > 0) {
    dosage.dose = { value: dose, unit: "mL", system: UCUM_SYSTEM, code: "mL" };
  }
  if (line.routeCode) {
    dosage.route = {
      coding: [
        { system: ROUTE_SYSTEM, code: line.routeCode, display: radRouteDisplay(line.routeCode) },
      ],
    };
  }

  return {
    resourceType: "MedicationAdministration",
    status: "completed",
    medicationCodeableConcept: { coding, text: line.name },
    subject,
    effectiveDateTime,
    partOf: [{ reference: hubReference }],
    ...(dosage.dose || dosage.route ? { dosage } : {}),
  };
}

function buildDoseObservation(
  field: DoseField,
  value: number,
  subject: fhir4.Reference,
  hubReference: string,
  effectiveDateTime: string,
): fhir4.Observation {
  return {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [{ system: RAD_DOSE_SYSTEM, code: field.key, display: field.display }],
      text: field.display,
    },
    subject,
    effectiveDateTime,
    valueQuantity: { value, unit: field.unit, system: UCUM_SYSTEM, code: field.ucum },
    partOf: [{ reference: hubReference }],
  };
}

/**
 * 実施登録の transaction Bundle。実施記録一式と Task の完了を 1 つにまとめ、
 * 実施情報だけ保存されて進捗が止まる状態を作らない。
 *
 * 手技が複数あるときは、1件目を Procedure.code に置き、2件目以降を partOf で
 * ぶら下げる。Procedure.code は 0..1 で複数手技を1リソースには載せられず、
 * 異なる手技を1つの CodeableConcept の複数 coding に混ぜるのは(coding は同一概念の
 * 別表現を並べるもの)意味が違うため。
 */
export function buildRadPerformBundle(
  values: RadPerformFormValues,
  order: fhir4.ServiceRequest,
  task: fhir4.Task | undefined,
): fhir4.Bundle {
  const orderId = order.id ?? "";
  const subject = order.subject ?? {};
  const performedDateTime = toFhirDateTime(values.performedAt);
  const hubReference = `urn:uuid:${crypto.randomUUID()}`;

  const hub = baseProcedure(values, subject, orderId, performedDateTime);
  if (values.procedures[0]) hub.code = procedureCode(values.procedures[0]);
  if (values.materials.length > 0) hub.usedCode = values.materials.map(usedCodeOf);
  if (values.comment.trim()) hub.note = [{ text: values.comment.trim() }];

  const entries: fhir4.BundleEntry[] = [
    { fullUrl: hubReference, resource: hub, request: { method: "POST", url: "Procedure" } },
  ];

  // 2件目以降の手技。オーダーからも引けるよう basedOn も張る。
  for (const line of values.procedures.slice(1)) {
    const child = baseProcedure(values, subject, orderId, performedDateTime);
    child.code = procedureCode(line);
    child.partOf = [{ reference: hubReference }];
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: child,
      request: { method: "POST", url: "Procedure" },
    });
  }

  for (const line of values.contrasts) {
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildContrast(line, subject, hubReference, performedDateTime),
      request: { method: "POST", url: "MedicationAdministration" },
    });
  }

  for (const [key, raw] of Object.entries(values.doses)) {
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) continue;
    entries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildDoseObservation(
        DOSE_FIELDS[key as DoseKey],
        value,
        subject,
        hubReference,
        performedDateTime,
      ),
      request: { method: "POST", url: "Observation" },
    });
  }

  // 進捗の完了。Task はステータスを最初に変えたときに作られるので、まだ無ければ作る。
  const nextTask = buildRadTaskUpdate(task, order, "completed");
  entries.push({
    resource: nextTask,
    request: task?.id
      ? { method: "PUT", url: `Task/${task.id}` }
      : { method: "POST", url: "Task" },
  });

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}
