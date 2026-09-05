import { today } from "../lib/dates";
import {
  ABO_OPTIONS,
  ABO_SYSTEM,
  RHD_OPTIONS,
  RHD_SYSTEM,
  type AboBloodType,
  type RhdBloodType,
} from "./transfusionOrderHelpers";

/**
 * 患者の血液型(ABO / RhD)。
 *
 * これまで血液型は輸血オーダーにしか無く、オーダーのたびに手入力していた
 * (`transfusionOrderHelpers.ts`)。患者側に持ち、オーダーの初期値に使う。
 *
 * オーダー側の項目は残す。オーダーの血液型は「何型を出すか」という依頼の中身で、
 * 患者の血液型と食い違いうる(未確定のまま O 型を出す、など)ため。
 *
 * 置き場所は `Observation`。「いつ・何を根拠に確認した型か」が要るので、
 * 状態を表す Flag ではなく検査値として持つ。ABO と RhD は LOINC も別項目なので
 * 1 件ずつ分けて作る(「ABO は分かっているが RhD はこれから」がありうる)。
 * コードの値集合は輸血オーダーと同じものを使い、2 か所に持たない。
 */

const LOINC = "http://loinc.org";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

/** ABO 血液型 / RhD 血液型の LOINC。 */
export const ABO_LOINC = { code: "883-9", display: "ABO group [Type] in Blood" } as const;
export const RHD_LOINC = { code: "10331-7", display: "Rh [Type] in Blood" } as const;

/**
 * 情報源。検査で確定した型か、本人・家族の申告かで扱いが変わる
 * (申告のままの型で製剤を出すことはない)ので、必ず区別して持つ。
 * `Observation.method` に入れる。
 */
export const BLOOD_TYPE_SOURCE_SYSTEM = "http://fhir-client.local/CodeSystem/blood-type-source";

export const BLOOD_TYPE_SOURCE_OPTIONS = [
  { code: "tested", display: "検査確定" },
  { code: "reported", display: "本人・家族の申告" },
  { code: "referred", display: "他院からの情報" },
] as const;

export type BloodTypeSource = (typeof BLOOD_TYPE_SOURCE_OPTIONS)[number]["code"];

export function bloodTypeSourceLabel(code: string | undefined): string {
  return BLOOD_TYPE_SOURCE_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export interface BloodTypeFormValues {
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  source: BloodTypeSource;
  /** 確認日(検査日または申告を受けた日)。 */
  effectiveDate: string;
  note: string;
}

export function emptyBloodTypeForm(): BloodTypeFormValues {
  return { abo: "", rhd: "", source: "tested", effectiveDate: today(), note: "" };
}

function categoryLaboratory(): fhir4.CodeableConcept[] {
  return [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory" }] }];
}

function methodConcept(source: BloodTypeSource): fhir4.CodeableConcept {
  return {
    coding: [
      { system: BLOOD_TYPE_SOURCE_SYSTEM, code: source, display: bloodTypeSourceLabel(source) },
    ],
  };
}

/**
 * ABO / RhD の Observation を組み立てる。入っている型の分だけ作る
 * (片方だけ分かっている状態をそのまま保存できるようにするため)。
 * 既存の id を渡すと更新用に id 付きで作る。
 */
export function buildBloodTypeObservations(
  values: BloodTypeFormValues,
  patientId: string,
  existing?: { aboId?: string; rhdId?: string },
): fhir4.Observation[] {
  const observations: fhir4.Observation[] = [];

  if (values.abo) {
    observations.push(
      buildObservation({
        id: existing?.aboId,
        patientId,
        loinc: ABO_LOINC,
        value: {
          coding: [
            {
              system: ABO_SYSTEM,
              code: values.abo,
              display: ABO_OPTIONS.find((o) => o.code === values.abo)?.display,
            },
          ],
        },
        values,
      }),
    );
  }

  if (values.rhd) {
    observations.push(
      buildObservation({
        id: existing?.rhdId,
        patientId,
        loinc: RHD_LOINC,
        value: {
          coding: [
            {
              system: RHD_SYSTEM,
              code: values.rhd,
              display: RHD_OPTIONS.find((o) => o.code === values.rhd)?.display,
            },
          ],
        },
        values,
      }),
    );
  }

  return observations;
}

function buildObservation({
  id,
  patientId,
  loinc,
  value,
  values,
}: {
  id?: string;
  patientId: string;
  loinc: { code: string; display: string };
  value: fhir4.CodeableConcept;
  values: BloodTypeFormValues;
}): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: categoryLaboratory(),
    code: { coding: [{ system: LOINC, code: loinc.code, display: loinc.display }] },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: value,
    method: methodConcept(values.source),
  };

  if (id) observation.id = id;
  if (values.effectiveDate) observation.effectiveDateTime = values.effectiveDate;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];

  return observation;
}

function codeOf(observation: fhir4.Observation, system: string): string {
  const coding = observation.valueCodeableConcept?.coding;
  return coding?.find((c) => c.system === system)?.code ?? coding?.[0]?.code ?? "";
}

function loincOf(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC)?.code ?? "";
}

export interface BloodTypeSummary {
  abo: string;
  rhd: string;
  source: string;
  sourceLabel: string;
  effectiveDate: string;
  note: string;
  aboId: string;
  rhdId: string;
  /** 検査で確定した型か。製剤を出す判断で使うので単独で読めるようにする。 */
  tested: boolean;
}

/**
 * ABO / RhD の Observation から画面用のまとめを作る。同じ項目が複数あれば
 * 確認日の新しいものを採る(古い申告値が後から入っても最新が出るように)。
 */
export function summarizeBloodType(observations: fhir4.Observation[]): BloodTypeSummary | null {
  const newestFirst = [...observations].sort((a, b) =>
    (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""),
  );
  const abo = newestFirst.find((o) => loincOf(o) === ABO_LOINC.code);
  const rhd = newestFirst.find((o) => loincOf(o) === RHD_LOINC.code);
  if (!abo && !rhd) return null;

  // 確認日・情報源は ABO を優先し、無ければ RhD のものを出す。
  const primary = abo ?? rhd;
  const source = primary?.method?.coding?.[0]?.code ?? "";

  return {
    abo: abo ? codeOf(abo, ABO_SYSTEM) : "",
    rhd: rhd ? codeOf(rhd, RHD_SYSTEM) : "",
    source,
    sourceLabel: bloodTypeSourceLabel(source),
    effectiveDate: primary?.effectiveDateTime?.slice(0, 10) ?? "",
    note: primary?.note?.[0]?.text ?? "",
    aboId: abo?.id ?? "",
    rhdId: rhd?.id ?? "",
    tested: source === "tested",
  };
}

export function parseBloodTypeForm(observations: fhir4.Observation[]): BloodTypeFormValues {
  const summary = summarizeBloodType(observations);
  if (!summary) return emptyBloodTypeForm();

  const source = BLOOD_TYPE_SOURCE_OPTIONS.some((o) => o.code === summary.source)
    ? (summary.source as BloodTypeSource)
    : "tested";

  return {
    abo: (summary.abo as AboBloodType) || "",
    rhd: (summary.rhd as RhdBloodType) || "",
    source,
    effectiveDate: summary.effectiveDate || today(),
    note: summary.note,
  };
}
