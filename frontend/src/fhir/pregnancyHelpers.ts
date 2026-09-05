import { today } from "../lib/dates";

/**
 * 妊娠・授乳。
 *
 * 処方(催奇形性・乳汁移行)と放射線検査(被曝)の判断に使う。診療上の注意(Flag)
 * ではなく `Observation` にするのは、「いつ確認したか」が要るため。妊娠は
 * 状態が変わるので、確認日の無い注意として置くと古い情報のまま残りうる。
 *
 * 妊娠状態と授乳は LOINC の別項目なので 1 件ずつ分けて作る(妊娠していないが
 * 授乳中、という状態がありうる)。血液型(bloodTypeHelpers.ts)と同じ作り。
 */

const LOINC = "http://loinc.org";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

/** 妊娠状態 / 授乳状態の LOINC。 */
export const PREGNANCY_LOINC = { code: "82810-3", display: "Pregnancy status" } as const;
export const LACTATION_LOINC = { code: "63895-7", display: "Breastfeeding status" } as const;

/**
 * 妊娠状態。LOINC 82810-3 の推奨値集合(SNOMED CT)に合わせる。
 * 「不明」を残すのは、確認したが分からなかったことと、まだ聞いていないことを
 * 区別するため(未登録は Observation 自体が無い状態)。
 */
const SNOMED = "http://snomed.info/sct";

export const PREGNANCY_STATUS_OPTIONS = [
  { code: "77386006", display: "妊娠中" },
  { code: "60001007", display: "妊娠していない" },
  { code: "261665006", display: "不明" },
] as const;

export type PregnancyStatus = (typeof PREGNANCY_STATUS_OPTIONS)[number]["code"];

export function pregnancyStatusLabel(code: string | undefined): string {
  return PREGNANCY_STATUS_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

/** 妊娠中かどうか。処方・放射線検査の注意を出す判断に使う。 */
export const PREGNANT_CODE: PregnancyStatus = "77386006";

export const LACTATION_STATUS_OPTIONS = [
  { code: "413712001", display: "授乳中" },
  { code: "169750002", display: "授乳していない" },
] as const;

export type LactationStatus = (typeof LACTATION_STATUS_OPTIONS)[number]["code"];

export function lactationStatusLabel(code: string | undefined): string {
  return LACTATION_STATUS_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

export const LACTATING_CODE: LactationStatus = "413712001";

export interface PregnancyFormValues {
  status: PregnancyStatus | "";
  lactation: LactationStatus | "";
  /** 確認日。いつ時点の状態かが分からないと使えないので必須にする。 */
  effectiveDate: string;
  /** 分娩予定日。妊娠中のときだけ入れる。 */
  dueDate: string;
  note: string;
}

export function emptyPregnancyForm(): PregnancyFormValues {
  return { status: "", lactation: "", effectiveDate: today(), dueDate: "", note: "" };
}

/** 分娩予定日。LOINC 11778-8。妊娠状態の Observation に component として添える。 */
const DUE_DATE_LOINC = { code: "11778-8", display: "Delivery date Estimated" } as const;

function buildObservation({
  id,
  patientId,
  loinc,
  code,
  display,
  values,
  components,
}: {
  id?: string;
  patientId: string;
  loinc: { code: string; display: string };
  code: string;
  display: string;
  values: PregnancyFormValues;
  components?: fhir4.ObservationComponent[];
}): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    // 問診・観察で得る情報なので laboratory ではなく social-history に寄せず、
    // 「調査(survey)」に入れる(検体検査の結果一覧に混ざらないようにするため)。
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "survey" }] }],
    code: { coding: [{ system: LOINC, code: loinc.code, display: loinc.display }] },
    subject: { reference: `Patient/${patientId}` },
    valueCodeableConcept: { coding: [{ system: SNOMED, code, display }] },
    effectiveDateTime: values.effectiveDate,
  };

  if (id) observation.id = id;
  if (components?.length) observation.component = components;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];

  return observation;
}

/**
 * 妊娠・授乳の Observation を組み立てる。入っている方の分だけ作る
 * (授乳だけを記録する状態がありうる)。
 */
export function buildPregnancyObservations(
  values: PregnancyFormValues,
  patientId: string,
  existing?: { pregnancyId?: string; lactationId?: string },
): fhir4.Observation[] {
  const observations: fhir4.Observation[] = [];

  if (values.status) {
    // 分娩予定日は妊娠中のときだけ意味を持つ。他の状態では捨てる。
    const components: fhir4.ObservationComponent[] =
      values.status === PREGNANT_CODE && values.dueDate
        ? [
            {
              code: {
                coding: [{ system: LOINC, code: DUE_DATE_LOINC.code, display: DUE_DATE_LOINC.display }],
              },
              valueDateTime: values.dueDate,
            },
          ]
        : [];

    observations.push(
      buildObservation({
        id: existing?.pregnancyId,
        patientId,
        loinc: PREGNANCY_LOINC,
        code: values.status,
        display: pregnancyStatusLabel(values.status),
        values,
        components,
      }),
    );
  }

  if (values.lactation) {
    observations.push(
      buildObservation({
        id: existing?.lactationId,
        patientId,
        loinc: LACTATION_LOINC,
        code: values.lactation,
        display: lactationStatusLabel(values.lactation),
        values,
      }),
    );
  }

  return observations;
}

function loincOf(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC)?.code ?? "";
}

function valueCodeOf(observation: fhir4.Observation | undefined): string {
  return observation?.valueCodeableConcept?.coding?.[0]?.code ?? "";
}

function dueDateOf(observation: fhir4.Observation | undefined): string {
  const component = observation?.component?.find(
    (c) => c.code?.coding?.some((coding) => coding.code === DUE_DATE_LOINC.code),
  );
  return component?.valueDateTime?.slice(0, 10) ?? "";
}

export interface PregnancySummary {
  status: string;
  statusLabel: string;
  lactation: string;
  lactationLabel: string;
  effectiveDate: string;
  dueDate: string;
  note: string;
  pregnancyId: string;
  lactationId: string;
  /** 妊娠中か。処方・放射線検査の注意を出す判断に使う。 */
  pregnant: boolean;
  /** 授乳中か。 */
  lactating: boolean;
}

/**
 * 妊娠・授乳の Observation から画面用のまとめを作る。同じ項目が複数あれば
 * 確認日の新しいものを採る(状態が変わる情報なので、必ず最新を出す)。
 */
export function summarizePregnancy(observations: fhir4.Observation[]): PregnancySummary | null {
  const newestFirst = [...observations].sort((a, b) =>
    (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""),
  );
  const pregnancy = newestFirst.find((o) => loincOf(o) === PREGNANCY_LOINC.code);
  const lactation = newestFirst.find((o) => loincOf(o) === LACTATION_LOINC.code);
  if (!pregnancy && !lactation) return null;

  const primary = pregnancy ?? lactation;
  const status = valueCodeOf(pregnancy);
  const lactationCode = valueCodeOf(lactation);

  return {
    status,
    statusLabel: pregnancyStatusLabel(status),
    lactation: lactationCode,
    lactationLabel: lactationStatusLabel(lactationCode),
    effectiveDate: primary?.effectiveDateTime?.slice(0, 10) ?? "",
    dueDate: dueDateOf(pregnancy),
    note: primary?.note?.[0]?.text ?? "",
    pregnancyId: pregnancy?.id ?? "",
    lactationId: lactation?.id ?? "",
    pregnant: status === PREGNANT_CODE,
    lactating: lactationCode === LACTATING_CODE,
  };
}

export function parsePregnancyForm(observations: fhir4.Observation[]): PregnancyFormValues {
  const summary = summarizePregnancy(observations);
  if (!summary) return emptyPregnancyForm();

  return {
    status: (summary.status as PregnancyStatus) || "",
    lactation: (summary.lactation as LactationStatus) || "",
    effectiveDate: summary.effectiveDate || today(),
    dueDate: summary.dueDate,
    note: summary.note,
  };
}
