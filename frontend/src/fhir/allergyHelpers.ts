import type { JfagyAllergen } from "../api/masterClient";

// JP Core AllergyIntolerance プロファイルと J-FAGY アレルゲンコードの URI 群。
const PROFILE_URL = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_AllergyIntolerance";
// J-FAGY の CodeSystem は領域(メタコード3桁目)ごとに URI が分かれる。
const JFAGY_FOOD_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/JP_JfagyFoodAllergen_CS";
const JFAGY_MEDICATION_YCM_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/YCM/JP_JfagyMedicationAllergen_CS";
const JFAGY_MEDICATION_GCM_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/GCM/JP_JfagyMedicationAllergen_CS";
const JFAGY_NONFOOD_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/JP_JfagyNonFoodNonMedicationAllergen_CS";
const JFAGY_SYSTEMS = [
  JFAGY_FOOD_SYSTEM,
  JFAGY_MEDICATION_YCM_SYSTEM,
  JFAGY_MEDICATION_GCM_SYSTEM,
  JFAGY_NONFOOD_SYSTEM,
];

const CLINICAL_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
const VERIFICATION_STATUS_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";

// 領域(メタコード3桁目)。F:食品、M:医薬品、N:非食品・非医薬品
export type AllergenDomain = "F" | "M" | "N";

export const DOMAIN_LABELS: Record<AllergenDomain, string> = {
  F: "食品",
  M: "医薬品",
  N: "非食品・非医薬品",
};

export function allergenDomain(jfagyCode: string | undefined): AllergenDomain | undefined {
  const domain = jfagyCode?.charAt(2);
  return domain === "F" || domain === "M" || domain === "N" ? domain : undefined;
}

export function allergenDomainLabel(jfagyCode: string | undefined): string {
  const domain = allergenDomain(jfagyCode);
  return domain ? DOMAIN_LABELS[domain] : "";
}

// 領域から AllergyIntolerance.category へのマッピング。
// 非食品・非医薬品(花粉・ハウスダスト・ラテックスなど)は environment とする。
const DOMAIN_CATEGORY: Record<AllergenDomain, "food" | "medication" | "environment"> = {
  F: "food",
  M: "medication",
  N: "environment",
};

export function allergyCategory(
  jfagyCode: string | undefined,
): "food" | "medication" | "environment" | undefined {
  const domain = allergenDomain(jfagyCode);
  return domain ? DOMAIN_CATEGORY[domain] : undefined;
}

const CATEGORY_LABELS: Record<string, string> = {
  food: "食品",
  medication: "医薬品",
  environment: "環境",
  biologic: "生物学的製剤",
};

export function categoryLabel(category: string | undefined): string {
  return category ? (CATEGORY_LABELS[category] ?? category) : "";
}

// 医薬品は先頭文字でコード種別が分かれる(Y:YJコード → YCM、G:一般名コード → GCM)。
function jfagySystem(jfagyCode: string): string {
  switch (allergenDomain(jfagyCode)) {
    case "F":
      return JFAGY_FOOD_SYSTEM;
    case "N":
      return JFAGY_NONFOOD_SYSTEM;
    case "M":
      return jfagyCode.startsWith("G") ? JFAGY_MEDICATION_GCM_SYSTEM : JFAGY_MEDICATION_YCM_SYSTEM;
    default:
      return JFAGY_FOOD_SYSTEM;
  }
}

export const CLINICAL_STATUS_OPTIONS = [
  { code: "active", display: "活動性(現在もあり)" },
  { code: "inactive", display: "非活動性" },
  { code: "resolved", display: "解消済み" },
] as const;

export type AllergyClinicalStatus = (typeof CLINICAL_STATUS_OPTIONS)[number]["code"];

export function clinicalStatusDisplay(code: string | undefined): string {
  return CLINICAL_STATUS_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

// entered-in-error は削除で表現するため選択肢に含めない。
export const VERIFICATION_STATUS_OPTIONS = [
  { code: "confirmed", display: "確定" },
  { code: "unconfirmed", display: "未確定" },
  { code: "refuted", display: "否定" },
] as const;

export type AllergyVerificationStatus = (typeof VERIFICATION_STATUS_OPTIONS)[number]["code"];

export function verificationStatusDisplay(code: string | undefined): string {
  return VERIFICATION_STATUS_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export const TYPE_OPTIONS = [
  { code: "", display: "未指定" },
  { code: "allergy", display: "アレルギー" },
  { code: "intolerance", display: "不耐症" },
] as const;

export type AllergyType = (typeof TYPE_OPTIONS)[number]["code"];

export function typeDisplay(code: string | undefined): string {
  return TYPE_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export const CRITICALITY_OPTIONS = [
  { code: "", display: "未指定" },
  { code: "low", display: "低" },
  { code: "high", display: "高" },
  { code: "unable-to-assess", display: "評価不能" },
] as const;

export type AllergyCriticality = (typeof CRITICALITY_OPTIONS)[number]["code"];

export function criticalityDisplay(code: string | undefined): string {
  return CRITICALITY_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export interface AllergyFormValues {
  allergen: JfagyAllergen | null;
  type: AllergyType;
  criticality: AllergyCriticality;
  clinicalStatus: AllergyClinicalStatus;
  verificationStatus: AllergyVerificationStatus;
  onsetDate: string;
  recordedDate: string;
  // 症状(反応)の自由記載。reaction[0].manifestation[0].text に格納する。
  reaction: string;
  note: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyAllergyForm(): AllergyFormValues {
  return {
    allergen: null,
    type: "allergy",
    criticality: "",
    clinicalStatus: "active",
    verificationStatus: "confirmed",
    onsetDate: "",
    recordedDate: today(),
    reaction: "",
    note: "",
  };
}

function toDateTime(dateStr: string): string {
  // fhir-server は Time.iso8601 でパースするため日付のみは不可。時刻0時固定で送る。
  return `${dateStr}T00:00:00+09:00`;
}

export function buildAllergy(
  values: AllergyFormValues,
  patientId: string,
  allergyId?: string,
): fhir4.AllergyIntolerance {
  const allergen = values.allergen;
  const category = allergyCategory(allergen?.jfagy_code);

  const allergy: fhir4.AllergyIntolerance = {
    resourceType: "AllergyIntolerance",
    meta: { profile: [PROFILE_URL] },
    clinicalStatus: {
      coding: [
        {
          system: CLINICAL_STATUS_SYSTEM,
          code: values.clinicalStatus,
          display: clinicalStatusDisplay(values.clinicalStatus),
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: VERIFICATION_STATUS_SYSTEM,
          code: values.verificationStatus,
          display: verificationStatusDisplay(values.verificationStatus),
        },
      ],
    },
    code: allergen
      ? {
          coding: [
            { system: jfagySystem(allergen.jfagy_code), code: allergen.jfagy_code, display: allergen.name },
          ],
          text: allergen.name,
        }
      : undefined,
    patient: { reference: `Patient/${patientId}` },
  };

  if (allergyId) allergy.id = allergyId;
  if (values.type) allergy.type = values.type;
  if (category) allergy.category = [category];
  if (values.criticality) allergy.criticality = values.criticality;
  if (values.onsetDate) allergy.onsetDateTime = toDateTime(values.onsetDate);
  if (values.recordedDate) allergy.recordedDate = toDateTime(values.recordedDate);
  if (values.reaction) allergy.reaction = [{ manifestation: [{ text: values.reaction }] }];
  if (values.note) allergy.note = [{ text: values.note }];

  return allergy;
}

// ---- 一覧・詳細表示のための parse ----

export interface AllergySummary {
  id: string;
  name: string;
  categoryLabel: string;
  typeLabel: string;
  criticalityLabel: string;
  clinicalStatusLabel: string;
  verificationStatusLabel: string;
  onsetDate: string;
  recordedDate: string;
  reaction: string;
  note: string;
  jfagyCode: string;
}

export function summarizeAllergy(allergy: fhir4.AllergyIntolerance): AllergySummary {
  const jfagyCoding = allergy.code?.coding?.find((c) => JFAGY_SYSTEMS.includes(c.system ?? ""));
  return {
    id: allergy.id ?? "",
    name: allergy.code?.text ?? jfagyCoding?.display ?? allergy.code?.coding?.[0]?.display ?? "",
    categoryLabel: categoryLabel(allergy.category?.[0]),
    typeLabel: typeDisplay(allergy.type),
    criticalityLabel: criticalityDisplay(allergy.criticality),
    clinicalStatusLabel: clinicalStatusDisplay(allergy.clinicalStatus?.coding?.[0]?.code),
    verificationStatusLabel: verificationStatusDisplay(
      allergy.verificationStatus?.coding?.[0]?.code,
    ),
    onsetDate: allergy.onsetDateTime?.slice(0, 10) ?? "",
    recordedDate: allergy.recordedDate?.slice(0, 10) ?? "",
    reaction: allergy.reaction?.[0]?.manifestation?.[0]?.text ?? "",
    note: allergy.note?.[0]?.text ?? "",
    jfagyCode: jfagyCoding?.code ?? "",
  };
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(カナ・英名など)は保存されていないため、フォーム上で
// 再選択されない限り、コード・名称のみを持つ簡易オブジェクトとして復元する。

function allergenFromCode(code: fhir4.CodeableConcept | undefined): JfagyAllergen | null {
  const coding =
    code?.coding?.find((c) => JFAGY_SYSTEMS.includes(c.system ?? "")) ?? code?.coding?.[0];
  if (!coding?.code) return null;
  return {
    id: 0,
    jfagy_code: coding.code,
    name: coding.display ?? code?.text ?? "",
    name_kana: null,
    name_en: null,
    level: null,
    main_flag: null,
    guideline: null,
  };
}

function optionCode<T extends string>(
  options: readonly { code: T }[],
  code: string | undefined,
  fallback: T,
): T {
  return options.some((o) => o.code === code) ? (code as T) : fallback;
}

export function parseAllergyForm(allergy: fhir4.AllergyIntolerance): AllergyFormValues {
  return {
    allergen: allergenFromCode(allergy.code),
    type: optionCode(TYPE_OPTIONS, allergy.type, ""),
    criticality: optionCode(CRITICALITY_OPTIONS, allergy.criticality, ""),
    clinicalStatus: optionCode(
      CLINICAL_STATUS_OPTIONS,
      allergy.clinicalStatus?.coding?.[0]?.code,
      "active",
    ),
    verificationStatus: optionCode(
      VERIFICATION_STATUS_OPTIONS,
      allergy.verificationStatus?.coding?.[0]?.code,
      "confirmed",
    ),
    onsetDate: allergy.onsetDateTime?.slice(0, 10) ?? "",
    recordedDate: allergy.recordedDate?.slice(0, 10) ?? "",
    reaction: allergy.reaction?.[0]?.manifestation?.[0]?.text ?? "",
    note: allergy.note?.[0]?.text ?? "",
  };
}
