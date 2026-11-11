import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ROUTE_SYSTEM } from "./injectionHelpers";
import { MEDICINE_CODE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import { displayOf, LOINC_SYSTEM, type CodeOption } from "./shared";

// 時系列チャート(麻酔チャート・透析経過表)の器。docs/dialysis-chart-design.md §3.4。
//
//   Procedure ハブ(部門ごとに作る)
//    ├ partOf ← Observation (打点。1 時点 1 項目。血圧だけはパネル 1 件に収縮期・拡張期を component で持つ)
//    ├ partOf ← Observation (イベント。値を持たず時刻が本体。code = 部門ごとの CodeSystem)
//    └ partOf ← MedicationAdministration (薬剤。単回 / 持続)
//
// 何を打点にするか・どんなイベントがあるか・薬剤の経路は部門ごとの ChartSpec で渡し、
// リソースの組み立てと時刻ごとの束ねをここで行う。ハブの組み立ては部門側に残す。

const UCUM_SYSTEM = "http://unitsofmeasure.org";

const BLOOD_PRESSURE = { code: "85354-9", display: "Blood pressure panel" } as const;
const SYSTOLIC = { code: "8480-6", display: "Systolic blood pressure" } as const;
const DIASTOLIC = { code: "8462-4", display: "Diastolic blood pressure" } as const;

/** 血圧以外の打点項目。表の行の並びもこの順。 */
export interface ChartMeasure {
  key: string;
  label: string;
  system: string;
  code: string;
  display: string;
  unit: string;
  ucum: string;
  /** 入力欄の刻み。 */
  step: string;
}

export interface ChartEventOption {
  code: string;
  display: string;
}

export interface ChartSpec {
  measures: readonly ChartMeasure[];
  events: readonly ChartEventOption[];
  /** イベントの code の CodeSystem。 */
  eventSystem: string;
  /** 打点とイベントに付ける category。無ければ付けない(経過表の vital-signs 検索に拾わせない)。 */
  category?: fhir4.CodeableConcept[];
  /** 前回の値を次の入力の初期値にする項目(装置の設定値のように、回の中でほぼ変わらないもの)。 */
  carryOver?: readonly string[];
  /** 薬剤の投与経路の選択肢。 */
  drugRoutes: readonly CodeOption[];
}

/** 軸に固定で描く印(回の開始・終了など)。 */
export interface ChartMarker {
  /** "YYYY-MM-DDTHH:mm"(端末ローカル)。 */
  time: string;
  label: string;
}

/** グラフの右軸に重ねる 1 項目(累積除水量など、単調に増える値)。 */
export interface ChartSecondaryAxis {
  /** 打点の key。 */
  key: string;
  label: string;
  unit: string;
  /** 軸の上端(0 から)。 */
  max: number;
  /** 目標の横線。 */
  target?: number;
}

export function chartEventDisplay(spec: ChartSpec, code: string): string {
  return spec.events.find((o) => o.code === code)?.display ?? code;
}

/** datetime-local に入れる現在時刻。記録の時刻の既定値。 */
export function nowInput(): string {
  return toDateTimeInput(new Date());
}

// ---- 組み立て ----

export interface ChartPointFormValues {
  /** datetime-local。必須。 */
  measuredAt: string;
  systolic: string;
  diastolic: string;
  values: Partial<Record<string, string>>;
}

function numberOf(text: string | undefined): number | null {
  if (!text?.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * 1 時点ぶんの打点 Observation。入力した項目だけを作り、同じ時点の組が途中で
 * 欠けないよう呼び出し側は 1 transaction で保存する。hubReference は
 * `Procedure/{id}` か、同じ Bundle でハブを作るときの `urn:uuid`。
 */
export function buildChartPointObservations(
  spec: ChartSpec,
  values: ChartPointFormValues,
  patientId: string,
  hubReference: string,
): fhir4.Observation[] {
  const base = {
    resourceType: "Observation" as const,
    status: "final" as const,
    ...(spec.category ? { category: spec.category } : {}),
    subject: { reference: `Patient/${patientId}` },
    partOf: [{ reference: hubReference }],
    effectiveDateTime: toFhirDateTime(values.measuredAt),
  };

  const observations: fhir4.Observation[] = [];

  const systolic = numberOf(values.systolic);
  const diastolic = numberOf(values.diastolic);
  if (systolic !== null && diastolic !== null) {
    observations.push({
      ...base,
      code: { coding: [{ system: LOINC_SYSTEM, ...BLOOD_PRESSURE }] },
      component: [
        {
          code: { coding: [{ system: LOINC_SYSTEM, ...SYSTOLIC }] },
          valueQuantity: { value: systolic, unit: "mmHg", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
        {
          code: { coding: [{ system: LOINC_SYSTEM, ...DIASTOLIC }] },
          valueQuantity: { value: diastolic, unit: "mmHg", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
      ],
    });
  }

  for (const measure of spec.measures) {
    const value = numberOf(values.values[measure.key]);
    if (value === null) continue;
    observations.push({
      ...base,
      code: { coding: [{ system: measure.system, code: measure.code, display: measure.display }] },
      valueQuantity: { value, unit: measure.unit, system: UCUM_SYSTEM, code: measure.ucum },
    });
  }
  return observations;
}

export function buildChartEventObservation(
  spec: ChartSpec,
  args: {
    patientId: string;
    hubReference: string;
    code: string;
    occurredAt: string;
    note?: string;
  },
): fhir4.Observation {
  const display = chartEventDisplay(spec, args.code);
  return {
    resourceType: "Observation",
    status: "final",
    ...(spec.category ? { category: spec.category } : {}),
    code: {
      coding: [{ system: spec.eventSystem, code: args.code, display }],
      text: display,
    },
    subject: { reference: `Patient/${args.patientId}` },
    partOf: [{ reference: args.hubReference }],
    effectiveDateTime: toFhirDateTime(args.occurredAt),
    ...(args.note?.trim() ? { note: [{ text: args.note.trim() }] } : {}),
  };
}

export interface ChartDrugFormValues {
  medicineCode: string;
  name: string;
  yjCode: string;
  /** 単回(bolus) / 持続(infusion)。 */
  mode: "bolus" | "infusion";
  /** 単回の投与量(製剤単位)。 */
  dose: string;
  unitName: string;
  /** 持続の速度。単位は自由記載(mL/h など)。 */
  rate: string;
  rateUnit: string;
  routeCode: string;
  /** 単回の投与時刻 / 持続の開始時刻(datetime-local)。 */
  givenAt: string;
}

/**
 * 薬剤 1 件。単回は投与時刻、持続は開始時刻で作り(終了は finishChartInfusion)、
 * hubReference は打点と同じく `Procedure/{id}` か `urn:uuid`。
 */
export function buildChartDrugAdministration(
  spec: ChartSpec,
  values: ChartDrugFormValues,
  patientId: string,
  hubReference: string,
): fhir4.MedicationAdministration {
  const coding: fhir4.Coding[] = [{ system: MEDICINE_CODE_SYSTEM, code: values.medicineCode, display: values.name }];
  if (values.yjCode) coding.push({ system: YJ_CODE_SYSTEM, code: values.yjCode });

  const dosage: fhir4.MedicationAdministrationDosage = {};
  if (values.mode === "bolus") {
    const dose = numberOf(values.dose);
    if (dose !== null) {
      // 単位は製剤単位。UCUM に無いので system/code は載せない(実施入力と同じ)。
      dosage.dose = { value: dose, ...(values.unitName ? { unit: values.unitName } : {}) };
    }
  } else {
    const rate = numberOf(values.rate);
    if (rate !== null) {
      dosage.rateQuantity = { value: rate, ...(values.rateUnit ? { unit: values.rateUnit } : {}) };
    }
  }
  if (values.routeCode) {
    dosage.route = {
      coding: [{ system: ROUTE_SYSTEM, code: values.routeCode, display: displayOf(spec.drugRoutes, values.routeCode) }],
    };
  }

  const time = toFhirDateTime(values.givenAt);
  return {
    resourceType: "MedicationAdministration",
    // 持続は投与中(in-progress)で作り、「終了」で completed + end にする。
    status: values.mode === "bolus" ? "completed" : "in-progress",
    ...(spec.category?.[0] ? { category: spec.category[0] } : {}),
    medicationCodeableConcept: { coding, text: values.name },
    subject: { reference: `Patient/${patientId}` },
    partOf: [{ reference: hubReference }],
    ...(values.mode === "bolus" ? { effectiveDateTime: time } : { effectivePeriod: { start: time } }),
    ...(Object.keys(dosage).length ? { dosage } : {}),
  };
}

/** 持続投与の終了。end を入れて completed に確定させた複製を返す。 */
export function finishChartInfusion(
  administration: fhir4.MedicationAdministration,
  endedAt: string,
): fhir4.MedicationAdministration {
  return {
    ...administration,
    status: "completed",
    effectivePeriod: { ...administration.effectivePeriod, end: toFhirDateTime(endedAt) },
  };
}

// ---- 読み出し ----

/** 打点 1 時点(分単位でまとめる)。 */
export interface ChartPoint {
  /** "YYYY-MM-DDTHH:mm"(端末ローカル)。表・グラフのキー。 */
  time: string;
  systolic: number | null;
  diastolic: number | null;
  values: Partial<Record<string, number>>;
  /** この時点を構成する Observation の id(列の削除に使う)。 */
  observationIds: string[];
}

export interface ChartEventLine {
  id: string;
  time: string;
  code: string;
  label: string;
  note: string;
}

/** "YYYY-MM-DDTHH:mm" に丸めた端末ローカル時刻。打点を分単位で束ねるキー。 */
export function minuteOf(dateTime: string | undefined): string {
  return toDateTimeInput(dateTime).slice(0, 16);
}

function codingOf(observation: fhir4.Observation, system: string): string {
  return observation.code?.coding?.find((c) => c.system === system)?.code ?? "";
}

/**
 * ハブの子の Observation を、打点(時刻ごとの組)とイベントに分けて時刻順に並べる。
 * 他のハブの子が混ざっていても partOf で落とす。
 */
export function groupChartObservations(
  spec: ChartSpec,
  hubId: string,
  observations: readonly fhir4.Observation[],
): { points: ChartPoint[]; events: ChartEventLine[] } {
  const hubRef = `Procedure/${hubId}`;
  const pointByTime = new Map<string, ChartPoint>();
  const events: ChartEventLine[] = [];

  for (const observation of observations) {
    if (!(observation.partOf ?? []).some((reference) => reference.reference === hubRef)) continue;

    const event = codingOf(observation, spec.eventSystem);
    if (event) {
      events.push({
        id: observation.id ?? "",
        time: minuteOf(observation.effectiveDateTime),
        code: event,
        label: chartEventDisplay(spec, event),
        note: observation.note?.map((n) => n.text).filter(Boolean).join(" / ") ?? "",
      });
      continue;
    }

    const time = minuteOf(observation.effectiveDateTime);
    if (!time) continue;
    let point = pointByTime.get(time);
    if (!point) {
      point = { time, systolic: null, diastolic: null, values: {}, observationIds: [] };
      pointByTime.set(time, point);
    }
    if (observation.id) point.observationIds.push(observation.id);

    if (codingOf(observation, LOINC_SYSTEM) === BLOOD_PRESSURE.code) {
      const componentValue = (target: string) =>
        observation.component?.find((c) => c.code?.coding?.some((coding) => coding.code === target))
          ?.valueQuantity?.value ?? null;
      point.systolic = componentValue(SYSTOLIC.code);
      point.diastolic = componentValue(DIASTOLIC.code);
      continue;
    }
    const measure = spec.measures.find((m) => codingOf(observation, m.system) === m.code);
    if (measure && observation.valueQuantity?.value != null) {
      point.values[measure.key] = observation.valueQuantity.value;
    }
  }

  const byTime = (a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time);
  return { points: [...pointByTime.values()].sort(byTime), events: events.sort(byTime) };
}

export interface ChartDrugLine {
  id: string;
  administration: fhir4.MedicationAdministration;
  medicineCode: string;
  yjCode: string;
  name: string;
  mode: "bolus" | "infusion";
  /** 単回の時刻 / 持続の開始。 */
  time: string;
  /** 持続の終了(投与中なら空)。 */
  endTime: string;
  /** 単回の投与量と製剤単位。 */
  dose: number | null;
  unitName: string;
  routeCode: string;
  /** 「5mL 静脈内」「4mL/h 静脈内」の形。 */
  doseLabel: string;
  running: boolean;
}

/** ハブの子の MedicationAdministration を時刻順に並べる。他のハブの子が混ざっていても partOf で落とす。 */
export function groupChartDrugs(
  spec: ChartSpec,
  hubId: string,
  administrations: readonly fhir4.MedicationAdministration[],
): ChartDrugLine[] {
  const hubRef = `Procedure/${hubId}`;
  return administrations
    .filter((administration) => (administration.partOf ?? []).some((reference) => reference.reference === hubRef))
    .map((administration) => {
      const mode: ChartDrugLine["mode"] = administration.effectivePeriod ? "infusion" : "bolus";
      const dosage = administration.dosage;
      const codings = administration.medicationCodeableConcept?.coding ?? [];
      const routeCode = dosage?.route?.coding?.find((c) => c.system === ROUTE_SYSTEM)?.code ?? "";
      const dose = mode === "bolus" ? (dosage?.dose?.value ?? null) : null;
      const amount =
        mode === "bolus"
          ? dose != null
            ? `${dose}${dosage?.dose?.unit ?? ""}`
            : ""
          : dosage?.rateQuantity?.value != null
            ? `${dosage.rateQuantity.value}${dosage.rateQuantity.unit ?? ""}`
            : "";
      return {
        id: administration.id ?? "",
        administration,
        medicineCode: codings.find((c) => c.system === MEDICINE_CODE_SYSTEM)?.code ?? "",
        yjCode: codings.find((c) => c.system === YJ_CODE_SYSTEM)?.code ?? "",
        name: administration.medicationCodeableConcept?.text ?? codings[0]?.display ?? "",
        mode,
        time: minuteOf(mode === "bolus" ? administration.effectiveDateTime : administration.effectivePeriod?.start),
        endTime: mode === "infusion" ? minuteOf(administration.effectivePeriod?.end) : "",
        dose,
        unitName: dosage?.dose?.unit ?? "",
        routeCode,
        doseLabel: [amount, routeCode ? displayOf(spec.drugRoutes, routeCode) : ""].filter(Boolean).join(" "),
        running: mode === "infusion" && !administration.effectivePeriod?.end,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** 打点・イベント・薬剤を消す DELETE エントリ(ハブは呼び出し側が最後に足す)。 */
export function chartChildDeleteEntries(
  points: readonly ChartPoint[],
  events: readonly ChartEventLine[],
  drugs: readonly ChartDrugLine[] = [],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  for (const point of points) {
    for (const id of point.observationIds) {
      entries.push({ request: { method: "DELETE", url: `Observation/${id}` } });
    }
  }
  for (const event of events) {
    if (event.id) entries.push({ request: { method: "DELETE", url: `Observation/${event.id}` } });
  }
  for (const drug of drugs) {
    if (drug.id) entries.push({ request: { method: "DELETE", url: `MedicationAdministration/${drug.id}` } });
  }
  return entries;
}
