import { today } from "../lib/dates";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import { MANUAL_CATEGORY } from "./infectionHelpers";
import { codingBySystem, displayOf } from "./shared";
import {
  ABO_OPTIONS,
  ABO_SYSTEM,
  RHD_OPTIONS,
  RHD_SYSTEM,
  bloodTypeLabel,
  rhdDisplay,
  type AboBloodType,
  type RhdBloodType,
} from "./transfusionOrderHelpers";

// 輸血に関わる患者の属性のうち、検査結果からは読めず手で登録するもの(プロファイルタブの「身体」)。
//
//  - 不規則抗体の特異性(抗 E・抗 c など)。スクリーニングの陽性・陰性は検体検査の結果から読むが、
//    同定した抗体の種類は結果項目に無いので手で持つ。出庫で抗原陰性血の確認に使う
//    (JAHIS 患者安全ガイド 輸血編 7.3.3-1 ⑤)。
//  - 造血幹細胞移植後の血液型。ABO 不適合移植の前後で患者の型が変わるので、移植患者であること・
//    ドナーの型・移植後に輸血に使う型(赤血球と血漿・血小板で違う)を持ち、オーダーの既定と
//    適合表に使う(同 7.8.3)。
//
// どちらも感染症の手入力と同じ `category=exam` の Observation。検査結果(laboratory)と混ざらない。

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

/** 手入力の項目の code。 */
export const PROFILE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-profile";
export const IRREGULAR_ANTIBODY_CODE = { code: "irregular-antibody", display: "不規則抗体の特異性" };
export const TRANSPLANT_CODE = { code: "transplant-blood-type", display: "造血幹細胞移植後の血液型" };

/** 赤血球抗原(= 不規則抗体の特異性)。出庫のバッグの抗原陰性の確認にも同じ一覧を使う。 */
export const ANTIGEN_SYSTEM = "http://fhir-client.local/CodeSystem/red-cell-antigen";
export const ANTIGEN_OPTIONS: { code: string; display: string }[] = [
  { code: "D", display: "D" },
  { code: "C", display: "C" },
  { code: "c", display: "c" },
  { code: "E", display: "E" },
  { code: "e", display: "e" },
  { code: "K", display: "K" },
  { code: "k", display: "k" },
  { code: "Jka", display: "Jk(a)" },
  { code: "Jkb", display: "Jk(b)" },
  { code: "Fya", display: "Fy(a)" },
  { code: "Fyb", display: "Fy(b)" },
  { code: "M", display: "M" },
  { code: "N", display: "N" },
  { code: "S", display: "S" },
  { code: "s", display: "s" },
  { code: "Dia", display: "Di(a)" },
  { code: "Lea", display: "Le(a)" },
  { code: "Leb", display: "Le(b)" },
  { code: "P1", display: "P1" },
  { code: "other", display: "その他" },
];

export function antigenDisplay(code: string): string {
  return displayOf(ANTIGEN_OPTIONS, code);
}

/** 「抗E」の表記。 */
export function antibodyLabel(code: string): string {
  return code === "other" ? "その他" : `抗${antigenDisplay(code)}`;
}

/** 移植後に輸血に使う型の区分(赤血球は抗原、血漿・血小板は抗体で決まるので別に持つ)。 */
const TRANSPLANT_COMPONENT_SYSTEM = "http://fhir-client.local/CodeSystem/transplant-blood-type-component";

function isManual(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.category?.some((c) => c.coding?.some((coding) => coding.code === MANUAL_CATEGORY)),
  );
}

function profileCodeOf(observation: fhir4.Observation): string {
  return codingBySystem(observation.code?.coding, PROFILE_CODE_SYSTEM)?.code ?? "";
}

// ---- 不規則抗体の特異性 ----

export interface IrregularAntibodyFormValues {
  antibodies: string[];
  /** 同定した日(検査日)。 */
  effectiveDate: string;
  note: string;
}

export function emptyIrregularAntibodyForm(): IrregularAntibodyFormValues {
  return { antibodies: [], effectiveDate: today(), note: "" };
}

export function buildIrregularAntibodyObservation(
  values: IrregularAntibodyFormValues,
  patientId: string,
  observationId?: string,
): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: MANUAL_CATEGORY }] }],
    code: { coding: [{ system: PROFILE_CODE_SYSTEM, ...IRREGULAR_ANTIBODY_CODE }], text: IRREGULAR_ANTIBODY_CODE.display },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: {
      text: values.antibodies.map(antibodyLabel).join("、") || "なし",
    },
    component: values.antibodies.map((code) => ({
      code: { coding: [{ system: ANTIGEN_SYSTEM, code, display: antibodyLabel(code) }] },
      valueBoolean: true,
    })),
  };
  if (observationId) observation.id = observationId;
  if (values.effectiveDate) observation.effectiveDateTime = values.effectiveDate;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];
  return observation;
}

export interface IrregularAntibodySummary {
  id: string;
  antibodies: string[];
  /** 「抗E、抗c」。無ければ「なし」。 */
  label: string;
  effectiveDate: string;
  note: string;
}

export function summarizeIrregularAntibody(
  observations: fhir4.Observation[],
): IrregularAntibodySummary | null {
  const found = observations
    .filter((o) => isManual(o) && profileCodeOf(o) === IRREGULAR_ANTIBODY_CODE.code)
    .sort((a, b) => (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""))[0];
  if (!found) return null;
  const antibodies = (found.component ?? [])
    .map((c) => codingBySystem(c.code?.coding, ANTIGEN_SYSTEM)?.code ?? "")
    .filter(Boolean);
  return {
    id: found.id ?? "",
    antibodies,
    label: antibodies.map(antibodyLabel).join("、") || "なし",
    effectiveDate: found.effectiveDateTime?.slice(0, 10) ?? "",
    note: found.note?.[0]?.text ?? "",
  };
}

export function parseIrregularAntibodyForm(
  summary: IrregularAntibodySummary | null,
): IrregularAntibodyFormValues {
  if (!summary) return emptyIrregularAntibodyForm();
  return {
    antibodies: summary.antibodies,
    effectiveDate: summary.effectiveDate || today(),
    note: summary.note,
  };
}

// ---- 造血幹細胞移植後の血液型 ----

export interface TransplantBloodTypeFormValues {
  /** 移植日。 */
  transplantDate: string;
  donorAbo: AboBloodType | "";
  donorRhd: RhdBloodType | "";
  /** 移植後に赤血球製剤で使う型。 */
  rbcAbo: AboBloodType | "";
  rbcRhd: RhdBloodType | "";
  /** 移植後に血漿・血小板製剤で使う型。 */
  plasmaAbo: AboBloodType | "";
  plasmaRhd: RhdBloodType | "";
  note: string;
}

export function emptyTransplantBloodTypeForm(): TransplantBloodTypeFormValues {
  return {
    transplantDate: today(),
    donorAbo: "",
    donorRhd: "",
    rbcAbo: "",
    rbcRhd: "",
    plasmaAbo: "",
    plasmaRhd: "",
    note: "",
  };
}

const TRANSPLANT_COMPONENTS: {
  key: keyof Omit<TransplantBloodTypeFormValues, "transplantDate" | "note">;
  code: string;
  display: string;
  system: string;
}[] = [
  { key: "donorAbo", code: "donor-abo", display: "ドナー ABO", system: ABO_SYSTEM },
  { key: "donorRhd", code: "donor-rhd", display: "ドナー RhD", system: RHD_SYSTEM },
  { key: "rbcAbo", code: "rbc-abo", display: "赤血球製剤 ABO", system: ABO_SYSTEM },
  { key: "rbcRhd", code: "rbc-rhd", display: "赤血球製剤 RhD", system: RHD_SYSTEM },
  { key: "plasmaAbo", code: "plasma-abo", display: "血漿・血小板製剤 ABO", system: ABO_SYSTEM },
  { key: "plasmaRhd", code: "plasma-rhd", display: "血漿・血小板製剤 RhD", system: RHD_SYSTEM },
];

function typeDisplay(system: string, code: string): string {
  return system === ABO_SYSTEM ? code : rhdDisplay(code);
}

export function buildTransplantBloodTypeObservation(
  values: TransplantBloodTypeFormValues,
  patientId: string,
  observationId?: string,
): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: MANUAL_CATEGORY }] }],
    code: { coding: [{ system: PROFILE_CODE_SYSTEM, ...TRANSPLANT_CODE }], text: TRANSPLANT_CODE.display },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: {
      text: `赤血球 ${bloodTypeLabel(values.rbcAbo, values.rbcRhd) || "-"} / 血漿・血小板 ${
        bloodTypeLabel(values.plasmaAbo, values.plasmaRhd) || "-"
      }`,
    },
    component: TRANSPLANT_COMPONENTS.filter((c) => values[c.key]).map((c) => ({
      code: { coding: [{ system: TRANSPLANT_COMPONENT_SYSTEM, code: c.code, display: c.display }] },
      valueCodeableConcept: {
        coding: [{ system: c.system, code: values[c.key], display: typeDisplay(c.system, values[c.key]) }],
      },
    })),
  };
  if (observationId) observation.id = observationId;
  if (values.transplantDate) observation.effectiveDateTime = values.transplantDate;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];
  return observation;
}

export interface TransplantBloodTypeSummary extends TransplantBloodTypeFormValues {
  id: string;
}

export function summarizeTransplantBloodType(
  observations: fhir4.Observation[],
): TransplantBloodTypeSummary | null {
  const found = observations
    .filter((o) => isManual(o) && profileCodeOf(o) === TRANSPLANT_CODE.code)
    .sort((a, b) => (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""))[0];
  if (!found) return null;
  const values = emptyTransplantBloodTypeForm();
  for (const definition of TRANSPLANT_COMPONENTS) {
    const component = found.component?.find((c) =>
      c.code?.coding?.some((x) => x.system === TRANSPLANT_COMPONENT_SYSTEM && x.code === definition.code),
    );
    const code = codingBySystem(component?.valueCodeableConcept?.coding, definition.system)?.code ?? "";
    const valid =
      definition.system === ABO_SYSTEM
        ? ABO_OPTIONS.some((o) => o.code === code)
        : RHD_OPTIONS.some((o) => o.code === code);
    // 型の union は ABO と RhD で違うが、どちらも文字列の列挙なのでまとめて入れる。
    (values as unknown as Record<string, string>)[definition.key] = valid ? code : "";
  }
  return {
    ...values,
    id: found.id ?? "",
    transplantDate: found.effectiveDateTime?.slice(0, 10) ?? "",
    note: found.note?.[0]?.text ?? "",
  };
}

/** 移植後の患者に出す案内(依頼時)。 */
export function transplantAdvisory(summary: TransplantBloodTypeSummary | null): Advisory | null {
  if (!summary) return null;
  const rbc = bloodTypeLabel(summary.rbcAbo, summary.rbcRhd) || "未設定";
  const plasma = bloodTypeLabel(summary.plasmaAbo, summary.plasmaRhd) || "未設定";
  return {
    key: advisoryKey("transplant-blood-type", summary.id),
    kind: "transplant-blood-type",
    severity: severityOf("transplant-blood-type", false),
    message: `造血幹細胞移植後（${summary.transplantDate || "日付不明"}）: 輸血に使う型は赤血球 ${rbc} / 血漿・血小板 ${plasma}`,
  };
}
