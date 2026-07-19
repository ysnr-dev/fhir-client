const KANA_REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation";
const KANJI_REPRESENTATION = "IDE";
const KANA_REPRESENTATION = "SYL";

// JP-Core: 医療記関番号(Medical Record Number)の標準 OID。デフォルトの識別子体系として使用する。
export const DEFAULT_IDENTIFIER_SYSTEM = "urn:oid:1.2.392.100495.20.3.51";

export type Gender = "male" | "female" | "other" | "unknown" | "";

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

function buildNames(values: PatientFormValues): fhir4.HumanName[] {
  const names: fhir4.HumanName[] = [];

  if (values.familyKanji || values.givenKanji) {
    names.push({
      extension: [{ url: KANA_REPRESENTATION_URL, valueCode: KANJI_REPRESENTATION }],
      family: values.familyKanji || undefined,
      given: values.givenKanji ? [values.givenKanji] : undefined,
    });
  }

  if (values.familyKana || values.givenKana) {
    names.push({
      extension: [{ url: KANA_REPRESENTATION_URL, valueCode: KANA_REPRESENTATION }],
      family: values.familyKana || undefined,
      given: values.givenKana ? [values.givenKana] : undefined,
    });
  }

  return names;
}

function representationCode(name: fhir4.HumanName): string | undefined {
  return name.extension?.find((ext) => ext.url === KANA_REPRESENTATION_URL)?.valueCode;
}

export function buildPatient(values: PatientFormValues, id?: string): fhir4.Patient {
  const patient: fhir4.Patient = {
    resourceType: "Patient",
    identifier: [{ system: values.identifierSystem, value: values.identifierValue }],
    active: values.active,
  };

  if (id) patient.id = id;

  const names = buildNames(values);
  if (names.length) patient.name = names;

  if (values.gender) patient.gender = values.gender;
  if (values.birthDate) patient.birthDate = values.birthDate;
  if (values.phone) patient.telecom = [{ system: "phone", value: values.phone }];
  if (values.addressText) patient.address = [{ text: values.addressText }];

  return patient;
}

export function parsePatient(patient: fhir4.Patient): PatientFormValues {
  const identifier = patient.identifier?.[0];
  const kanjiName = patient.name?.find((n) => representationCode(n) === KANJI_REPRESENTATION);
  const kanaName = patient.name?.find((n) => representationCode(n) === KANA_REPRESENTATION);
  const fallbackName = patient.name?.find((n) => !representationCode(n));

  return {
    identifierSystem: identifier?.system ?? DEFAULT_IDENTIFIER_SYSTEM,
    identifierValue: identifier?.value ?? "",
    familyKanji: kanjiName?.family ?? fallbackName?.family ?? "",
    givenKanji: kanjiName?.given?.[0] ?? fallbackName?.given?.[0] ?? "",
    familyKana: kanaName?.family ?? "",
    givenKana: kanaName?.given?.[0] ?? "",
    gender: (patient.gender as Gender) ?? "",
    birthDate: patient.birthDate ?? "",
    active: patient.active ?? true,
    phone: patient.telecom?.find((t) => t.system === "phone")?.value ?? "",
    addressText: patient.address?.[0]?.text ?? "",
  };
}

export function displayName(patient: fhir4.Patient): string {
  const kanjiName = patient.name?.find((n) => representationCode(n) === KANJI_REPRESENTATION);
  const fallbackName = patient.name?.find((n) => !representationCode(n)) ?? patient.name?.[0];
  const name = kanjiName ?? fallbackName;
  if (!name) return "(氏名未登録)";
  return [name.family, name.given?.[0]].filter(Boolean).join(" ");
}

export function displayKana(patient: fhir4.Patient): string {
  const kanaName = patient.name?.find((n) => representationCode(n) === KANA_REPRESENTATION);
  if (!kanaName) return "";
  return [kanaName.family, kanaName.given?.[0]].filter(Boolean).join(" ");
}
