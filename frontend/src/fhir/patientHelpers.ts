import {
  buildJapaneseNames,
  displayJapaneseKana,
  displayJapaneseName,
  parseJapaneseNames,
} from "./humanName";
import { referenceId } from "./shared";

// JP-Core: 医療記関番号(Medical Record Number)の標準 OID。デフォルトの識別子体系として使用する。
export const DEFAULT_IDENTIFIER_SYSTEM = "urn:oid:1.2.392.100495.20.3.51";

// 連絡先の続柄。Patient.contact.relationship の標準値集合(extensible)。
// 「キーパーソン」に当たる単独のコードは無いので、緊急連絡先(C)・近親者(N)を
// 別々に登録し、続柄の組み合わせで表す(N + C なら「近親者かつ緊急連絡先」)。
const CONTACT_RELATIONSHIP_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0131";

export const CONTACT_RELATIONSHIP_OPTIONS = [
  { code: "C", display: "緊急連絡先" },
  { code: "N", display: "近親者(キーパーソン)" },
  { code: "BP", display: "支払・保証人" },
  { code: "E", display: "勤務先" },
  { code: "U", display: "不明" },
] as const;

export type ContactRelationship = (typeof CONTACT_RELATIONSHIP_OPTIONS)[number]["code"];

export function contactRelationshipLabel(code: string | undefined): string {
  return CONTACT_RELATIONSHIP_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

// 使用言語。BCP-47(FHIR の languages 値集合)。日本語を既定に、窓口で当たりの
// つく範囲だけを選択肢に出す(必要になったら足す)。
const LANGUAGE_SYSTEM = "urn:ietf:bcp:47";

export const LANGUAGE_OPTIONS = [
  { code: "", display: "未指定" },
  { code: "ja", display: "日本語" },
  { code: "en", display: "英語" },
  { code: "zh", display: "中国語" },
  { code: "ko", display: "韓国語" },
  { code: "pt", display: "ポルトガル語" },
  { code: "es", display: "スペイン語" },
  { code: "vi", display: "ベトナム語" },
  { code: "tl", display: "タガログ語" },
] as const;

export type PatientLanguage = (typeof LANGUAGE_OPTIONS)[number]["code"];

export function languageLabel(code: string | undefined): string {
  return LANGUAGE_OPTIONS.find((o) => o.code === code)?.display ?? code ?? "";
}

// 旧姓・通称名の use。旧姓は maiden、通称は nickname(FHIR の標準コード)。
const MAIDEN_NAME_USE = "maiden";
const NICKNAME_USE = "nickname";

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

/**
 * 連絡先(緊急連絡先・キーパーソン・保証人)。Patient.contact の 1 件。
 *
 * `Patient.contact.name` は 0..1 で、漢字名とカナ名を別の HumanName に分ける
 * 本人の氏名(humanName.ts)のやり方が使えない。連絡先に要るのは続柄・氏名・
 * 電話までなので、カナは持たない(必要になったら RelatedPerson に切り出す)。
 */
export interface PatientContactValues {
  /** 続柄。複数選べる(近親者かつ緊急連絡先など)。 */
  relationships: string[];
  family: string;
  given: string;
  /** 続柄の補足(「長女」「義弟」など)。標準コードでは表せないので自由記載。 */
  relationshipNote: string;
  homePhone: string;
  mobilePhone: string;
  address: string;
}

export const emptyPatientContact: PatientContactValues = {
  relationships: [],
  family: "",
  given: "",
  relationshipNote: "",
  homePhone: "",
  mobilePhone: "",
  address: "",
};

export interface PatientFormValues {
  identifierSystem: string;
  identifierValue: string;
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
  /** 旧姓(姓のみ)。保険証との照合・名寄せに使う。 */
  maidenFamily: string;
  /** 通称名(呼び名)。 */
  nickname: string;
  gender: Gender;
  birthDate: string;
  active: boolean;
  /** 死亡日時(日付のみ)。空なら生存として扱う。 */
  deceasedDate: string;
  /** 使用言語(BCP-47)。 */
  language: PatientLanguage;
  /** 通訳が要るか。communication.preferred の裏返しではなく、独立した印。 */
  interpreterNeeded: boolean;
  postalCode: string;
  /** 都道府県。Address.state。 */
  prefecture: string;
  /** 市区町村。Address.city。 */
  city: string;
  /** 番地方書(町名・番地・建物名)。Address.line。 */
  addressLine: string;
  homePhone: string;
  mobilePhone: string;
  email: string;
  /** 連絡先。0 件でもよい。 */
  contacts: PatientContactValues[];
  /** かかりつけ医・紹介元。Practitioner または Organization の参照。 */
  generalPractitionerRef: string;
  /** 参照先の表示名(再選択されるまで保持するだけの控え)。 */
  generalPractitionerName: string;
}

export const emptyPatientForm: PatientFormValues = {
  identifierSystem: DEFAULT_IDENTIFIER_SYSTEM,
  identifierValue: "",
  familyKanji: "",
  givenKanji: "",
  familyKana: "",
  givenKana: "",
  maidenFamily: "",
  nickname: "",
  gender: "",
  birthDate: "",
  active: true,
  deceasedDate: "",
  language: "",
  interpreterNeeded: false,
  postalCode: "",
  prefecture: "",
  city: "",
  addressLine: "",
  homePhone: "",
  mobilePhone: "",
  email: "",
  contacts: [],
  generalPractitionerRef: "",
  generalPractitionerName: "",
};

/**
 * 新患登録(窓口で患者を登録しながら受付する)の必須条件。名寄せと受付一覧の
 * 並びに使うので、氏名・カナ・性別・生年月日まで揃っていることを求める。
 * 患者登録画面(PatientForm)は後から埋められるので、ここは通さない。
 */
export function validateNewPatientForm(values: PatientFormValues): string | null {
  if (!values.familyKanji.trim() || !values.givenKanji.trim()) return "患者氏名は必須です。";
  if (!values.familyKana.trim() || !values.givenKana.trim()) return "カナ氏名は必須です。";
  if (!values.gender) return "性別は必須です。";
  if (!values.birthDate) return "生年月日は必須です。";
  return null;
}

export function buildPatient(values: PatientFormValues, id?: string): fhir4.Patient {
  const identifierValue = values.identifierValue.trim();
  const patient: fhir4.Patient = {
    resourceType: "Patient",
    active: values.active,
  };

  // 患者番号は空欄で登録でき、その場合は登録時に自動採番する(useCreatePatient)。
  if (identifierValue) {
    patient.identifier = [{ system: values.identifierSystem, value: identifierValue }];
  }

  if (id) patient.id = id;

  const names = [...buildJapaneseNames(values), ...buildExtraNames(values)];
  if (names.length) patient.name = names;

  if (values.gender) patient.gender = values.gender;
  if (values.birthDate) patient.birthDate = values.birthDate;
  // 死亡は deceasedDateTime だけを使う(deceasedBoolean と併記すると上流で弾かれる)。
  if (values.deceasedDate) patient.deceasedDateTime = values.deceasedDate;

  const communication = buildCommunication(values);
  if (communication) patient.communication = [communication];

  const contacts = values.contacts.map(buildContact).filter((c): c is fhir4.PatientContact => Boolean(c));
  if (contacts.length) patient.contact = contacts;

  if (values.generalPractitionerRef) {
    patient.generalPractitioner = [
      {
        reference: values.generalPractitionerRef,
        display: values.generalPractitionerName || undefined,
      },
    ];
  }
  // 固定電話と携帯電話はどちらも system=phone。区別は use(home / mobile)で持つ。
  const telecom: fhir4.ContactPoint[] = [];
  if (values.homePhone) telecom.push({ system: "phone", value: values.homePhone, use: "home" });
  if (values.mobilePhone) {
    telecom.push({ system: "phone", value: values.mobilePhone, use: "mobile" });
  }
  if (values.email) telecom.push({ system: "email", value: values.email });
  if (telecom.length) patient.telecom = telecom;

  const address = buildAddress(values);
  if (address) patient.address = [address];

  return patient;
}

/**
 * 旧姓・通称名。漢字名・カナ名(buildJapaneseNames)の後ろに足す。
 * 上流は use="official" が無いとき先頭の name を検索用に採るので、
 * 本名より後ろに置く必要がある。
 */
function buildExtraNames(values: PatientFormValues): fhir4.HumanName[] {
  const names: fhir4.HumanName[] = [];
  if (values.maidenFamily.trim()) {
    names.push({ use: MAIDEN_NAME_USE, family: values.maidenFamily.trim() });
  }
  if (values.nickname.trim()) {
    names.push({ use: NICKNAME_USE, text: values.nickname.trim() });
  }
  return names;
}

/**
 * 使用言語。通訳要否は「日本語以外を話す」とは別の判断(日本語が話せても
 * 手話通訳が要ることがある)なので、言語が空でも単独で保存できるようにする。
 * その場合の language は不明(und)にする(communication.language は 1..1 のため)。
 */
function buildCommunication(values: PatientFormValues): fhir4.PatientCommunication | undefined {
  if (!values.language && !values.interpreterNeeded) return undefined;

  const code = values.language || "und";
  return {
    language: {
      coding: [{ system: LANGUAGE_SYSTEM, code, display: languageLabel(values.language) || undefined }],
    },
    // 通訳が要る = この言語での対応を要する、と読む。
    preferred: values.interpreterNeeded ? true : undefined,
  };
}

function buildContact(values: PatientContactValues): fhir4.PatientContact | undefined {
  const contact: fhir4.PatientContact = {};

  const relationships: fhir4.CodeableConcept[] = values.relationships.map((code) => ({
    coding: [
      {
        system: CONTACT_RELATIONSHIP_SYSTEM,
        code,
        display: contactRelationshipLabel(code) || undefined,
      },
    ],
  }));
  // 「長女」のような続柄の補足は標準コードで表せないので、text だけの concept で添える。
  if (values.relationshipNote.trim()) {
    relationships.push({ text: values.relationshipNote.trim() });
  }
  if (relationships.length) contact.relationship = relationships;

  if (values.family.trim() || values.given.trim()) {
    contact.name = {
      family: values.family.trim() || undefined,
      given: values.given.trim() ? [values.given.trim()] : undefined,
    };
  }

  const telecom: fhir4.ContactPoint[] = [];
  if (values.homePhone) telecom.push({ system: "phone", value: values.homePhone, use: "home" });
  if (values.mobilePhone) {
    telecom.push({ system: "phone", value: values.mobilePhone, use: "mobile" });
  }
  if (telecom.length) contact.telecom = telecom;

  if (values.address.trim()) contact.address = { text: values.address.trim() };

  // 何も入っていない行は保存しない(フォームの空行がそのまま増えていくのを防ぐ)。
  return Object.keys(contact).length ? contact : undefined;
}

/**
 * 住所。都道府県・市区町村・それ以降を分けて持ち、続けて書いた text も添える
 * (一覧や帳票は text だけを見るため)。郵便番号しか入っていない場合は text を作らない。
 */
function buildAddress(values: PatientFormValues): fhir4.Address | undefined {
  const address: fhir4.Address = {};
  if (values.postalCode) address.postalCode = values.postalCode;
  if (values.prefecture) address.state = values.prefecture;
  if (values.city) address.city = values.city;
  if (values.addressLine) address.line = [values.addressLine];

  const text = [values.prefecture, values.city, values.addressLine].filter(Boolean).join("");
  if (text) address.text = text;

  return Object.keys(address).length ? address : undefined;
}

export function parsePatient(patient: fhir4.Patient): PatientFormValues {
  const identifier = patient.identifier?.[0];

  return {
    identifierSystem: identifier?.system ?? DEFAULT_IDENTIFIER_SYSTEM,
    identifierValue: identifier?.value ?? "",
    ...parseJapaneseNames(patient.name),
    ...parseExtraNames(patient.name),
    gender: (patient.gender as Gender) ?? "",
    birthDate: patient.birthDate ?? "",
    active: patient.active ?? true,
    // deceasedBoolean だけの患者(他システム由来)は日付が無いので空のまま。
    deceasedDate: patient.deceasedDateTime?.slice(0, 10) ?? "",
    ...parseCommunication(patient.communication),
    contacts: (patient.contact ?? []).map(parseContact),
    generalPractitionerRef: patient.generalPractitioner?.[0]?.reference ?? "",
    generalPractitionerName: patient.generalPractitioner?.[0]?.display ?? "",
    // use の無い電話番号(他システム由来や、分ける前に登録した患者)は固定電話として扱う。
    homePhone:
      patient.telecom?.find((t) => t.system === "phone" && t.use !== "mobile")?.value ?? "",
    mobilePhone:
      patient.telecom?.find((t) => t.system === "phone" && t.use === "mobile")?.value ?? "",
    email: patient.telecom?.find((t) => t.system === "email")?.value ?? "",
    ...parseAddress(patient.address?.[0]),
  };
}

function parseExtraNames(names: fhir4.HumanName[] | undefined) {
  return {
    maidenFamily: names?.find((n) => n.use === MAIDEN_NAME_USE)?.family ?? "",
    nickname: names?.find((n) => n.use === NICKNAME_USE)?.text ?? "",
  };
}

function parseCommunication(communications: fhir4.PatientCommunication[] | undefined) {
  const communication = communications?.[0];
  const code = communication?.language?.coding?.[0]?.code ?? "";

  return {
    // 通訳の印だけを保存したときの und は、言語としては未指定に戻す。
    language: (code === "und" ? "" : code) as PatientLanguage,
    interpreterNeeded: communication?.preferred === true,
  };
}

function parseContact(contact: fhir4.PatientContact): PatientContactValues {
  const concepts = contact.relationship ?? [];

  return {
    relationships: concepts.flatMap((c) => c.coding?.map((coding) => coding.code ?? "") ?? []).filter(Boolean),
    // コードを持たない concept は続柄の補足(「長女」など)。
    relationshipNote: concepts.find((c) => !c.coding?.length)?.text ?? "",
    family: contact.name?.family ?? "",
    given: contact.name?.given?.[0] ?? "",
    homePhone: contact.telecom?.find((t) => t.system === "phone" && t.use !== "mobile")?.value ?? "",
    mobilePhone: contact.telecom?.find((t) => t.system === "phone" && t.use === "mobile")?.value ?? "",
    address: contact.address?.text ?? "",
  };
}

/**
 * 住所。都道府県・市区町村に分かれていない住所(text だけ)は、編集で消えてしまわない
 * よう、まるごと「番地方書」の欄に入れる。
 */
function parseAddress(address: fhir4.Address | undefined) {
  const line = address?.line?.join("") ?? "";
  const divided = Boolean(address?.state || address?.city || line);

  return {
    postalCode: address?.postalCode ?? "",
    prefecture: address?.state ?? "",
    city: address?.city ?? "",
    addressLine: divided ? line : (address?.text ?? ""),
  };
}

/** 患者番号。体系の指定が無い identifier(他システム由来)も患者番号として扱う。 */
export function patientNumberOf(patient: fhir4.Patient): string | undefined {
  const identifier = patient.identifier?.find(
    (i) => !i.system || i.system === DEFAULT_IDENTIFIER_SYSTEM,
  );
  return identifier?.value;
}

/**
 * 患者番号を空欄で登録したときに付ける番号。数字だけの既存番号の最大値 +1(最初は 1)。
 * 手入力の英字混じりの番号は無視する。最大値 +1 なので、途中の欠番は埋めない
 * (削除された番号を別の患者に付け直さないため)。
 */
export function nextPatientNumber(patients: fhir4.Patient[]): string {
  const max = patients.reduce((m, patient) => {
    const value = patientNumberOf(patient);
    return value && /^\d+$/.test(value) ? Math.max(m, Number(value)) : m;
  }, 0);
  return String(max + 1);
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

const SHORT_GENDER_LABELS: Record<string, string> = {
  male: "男",
  female: "女",
};

/** 列の狭い一覧向けの「男 / 女」表記。その他・不明は genderLabel と同じ。 */
export function genderShortLabel(gender: string | undefined): string {
  if (!gender) return "-";
  return SHORT_GENDER_LABELS[gender] ?? genderLabel(gender);
}
