import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { LOINC_SYSTEM } from "./shared";

// 時系列チャート(麻酔チャート・透析経過表)の器。docs/dialysis-chart-design.md §3.4。
//
//   Procedure ハブ(部門ごとに作る)
//    ├ partOf ← Observation (打点。1 時点 1 項目。血圧だけはパネル 1 件に収縮期・拡張期を component で持つ)
//    └ partOf ← Observation (イベント。値を持たず時刻が本体。code = 部門ごとの CodeSystem)
//
// 何を打点にするか・どんなイベントがあるかは部門ごとの ChartSpec で渡し、
// Observation の組み立てと時刻ごとの束ねをここで行う。ハブの組み立てと
// 部門固有の子(麻酔の薬剤など)は部門側に残す。

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

/** 打点とイベントを消す DELETE エントリ(ハブは呼び出し側が最後に足す)。 */
export function chartObservationDeleteEntries(
  points: readonly ChartPoint[],
  events: readonly ChartEventLine[],
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
  return entries;
}
