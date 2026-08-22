import {
  buildJapaneseNames,
  displayJapaneseKana,
  displayJapaneseName,
  parseJapaneseNames,
} from "./humanName";
import { referenceId } from "./shared";

// JP-Core: 医療記関番号(Medical Record Number)の標準 OID。デフォルトの識別子体系として使用する。
export const DEFAULT_IDENTIFIER_SYSTEM = "urn:oid:1.2.392.100495.20.3.51";

export type Gender = "male" | "female" | "other" | "unknown" | "";

// "Patient/123" 形式(サーバーによっては絶対 URL)の参照から患者 id を取り出す。
export const patientIdFromReference = referenceId;

// URL 上の患者と、読み込んだリソースが指す患者が食い違っていないかを判定する。
// 一致しない ID を URL に直接書いた場合に、他患者の内容を表示したり、
// 更新で subject を書き換えて別患者に付け替えたりするのを防ぐために使う。
export function isPatientMismatch(
  patientId: string | undefined,
  subject: fhir4.Reference | undefined,
): boolean {
  const sourcePatientId = patientIdFromReference(subject?.reference);
  return Boolean(patientId && sourcePatientId && sourcePatientId !== patientId);
}

export interface PatientFormValues {
  identifierSystem: string;
  identifierValue: string;
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
  gender: Gender;
  birthDate: string;
  active: boolean;
  phone: string;
  addressText: string;
}

export const emptyPatientForm: PatientFormValues = {
  identifierSystem: DEFAULT_IDENTIFIER_SYSTEM,
  identifierValue: "",
  familyKanji: "",
  givenKanji: "",
  familyKana: "",
  givenKana: "",
  gender: "",
  birthDate: "",
  active: true,
  phone: "",
  addressText: "",
};

export function buildPatient(values: PatientFormValues, id?: string): fhir4.Patient {
  const patient: fhir4.Patient = {
    resourceType: "Patient",
    identifier: [{ system: values.identifierSystem, value: values.identifierValue }],
    active: values.active,
  };

  if (id) patient.id = id;

  const names = buildJapaneseNames(values);
  if (names.length) patient.name = names;

  if (values.gender) patient.gender = values.gender;
  if (values.birthDate) patient.birthDate = values.birthDate;
  if (values.phone) patient.telecom = [{ system: "phone", value: values.phone }];
  if (values.addressText) patient.address = [{ text: values.addressText }];

  return patient;
}

export function parsePatient(patient: fhir4.Patient): PatientFormValues {
  const identifier = patient.identifier?.[0];

  return {
    identifierSystem: identifier?.system ?? DEFAULT_IDENTIFIER_SYSTEM,
    identifierValue: identifier?.value ?? "",
    ...parseJapaneseNames(patient.name),
    gender: (patient.gender as Gender) ?? "",
    birthDate: patient.birthDate ?? "",
    active: patient.active ?? true,
    phone: patient.telecom?.find((t) => t.system === "phone")?.value ?? "",
    addressText: patient.address?.[0]?.text ?? "",
  };
}

export function displayName(patient: fhir4.Patient): string {
  return displayJapaneseName(patient.name) || "(氏名未登録)";
}

export function displayKana(patient: fhir4.Patient): string {
  return displayJapaneseKana(patient.name);
}

export function calculateAge(birthDate: string, asOf: Date = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return undefined;

  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDiff = asOf.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : undefined;
}

/**
 * 「36歳7か月」。年だけでは粗いところ(乳幼児や、入院中の細かい経過)でも使えるよう、
 * 満年齢に加えて誕生月からの月数を出す。
 */
export function ageWithMonthsLabel(
  birthDate: string,
  asOf: Date = new Date(),
): string | undefined {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return undefined;

  let months = (asOf.getFullYear() - birth.getFullYear()) * 12 + (asOf.getMonth() - birth.getMonth());
  // 誕生日がまだ来ていない月はひと月数えない。
  if (asOf.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return undefined;

  return `${Math.floor(months / 12)}歳${months % 12}か月`;
}

const GENDER_LABELS: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  unknown: "不明",
};

export function genderLabel(gender: string | undefined): string {
  if (!gender) return "-";
  return GENDER_LABELS[gender] ?? gender;
}
