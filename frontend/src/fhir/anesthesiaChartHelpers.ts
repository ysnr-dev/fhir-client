import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ROUTE_SYSTEM } from "./injectionHelpers";
import { MEDICINE_CODE_SYSTEM, ORDER_TYPE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import { STAFF_ROLE_SYSTEM, surgeryStaffRoleDisplay } from "./surgeryOrderHelpers";
import { SURGERY_ROUTE_OPTIONS, surgeryRouteDisplay } from "./surgeryResultHelpers";

// 麻酔チャート(術中リアルタイム記録)。docs/anesthesia-chart-design.md。
//
//   ServiceRequest(申込)
//    └ basedOn ← Procedure (チャートハブ。オーダー単位で1件)
//         │  status    = in-progress(記録中) / completed(確定)
//         │  category  = order-type|anesthesia-chart
//         │  performer = 麻酔担当(function = surgery-staff-role|anesthetist)
//         ├ partOf ← Observation               (バイタル打点。category 無し)
//         ├ partOf ← Observation               (イベント。code = anesthesia-event)
//         └ partOf ← MedicationAdministration  (薬剤。単回/持続)
//
// 手術の実施記録(surgeryResultHelpers)と同型のツリーだが別物。category を
// 変えてあるので、実施記録の振り分け(isSurgeryProcedure)には引っかからない。
// 実施入力が「退室後に完成形で1回」なのに対し、チャートは術中に 1 点ずつ
// 保存する進行形の記録なので、ハブは in-progress の期間を持つ。

const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** ハブの category。order-type の仲間に足したチャート専用のコード。 */
export const ANESTHESIA_CHART_TYPE = { code: "anesthesia-chart", display: "麻酔チャート" };

/** イベント(麻酔開始・挿管など)の code。 */
const ANESTHESIA_EVENT_SYSTEM = "http://fhir-client.local/CodeSystem/anesthesia-event";

const LOINC = "http://loinc.org";
const UCUM_SYSTEM = "http://unitsofmeasure.org";

/** 血圧はバイタル入力と同じくパネル 1 件に component で収縮期・拡張期を持つ。 */
const BLOOD_PRESSURE = { code: "85354-9", display: "Blood pressure panel" } as const;
const SYSTOLIC = { code: "8480-6", display: "Systolic blood pressure" } as const;
const DIASTOLIC = { code: "8462-4", display: "Diastolic blood pressure" } as const;

/** 血圧以外の打点項目。表の行の並びもこの順。 */
export const CHART_MEASURES = [
  { key: "pulse", label: "脈拍", code: "8867-4", display: "Heart rate", unit: "/分", ucum: "/min", step: "1" },
  { key: "spo2", label: "SpO2", code: "2708-6", display: "Oxygen saturation", unit: "%", ucum: "%", step: "1" },
  { key: "etco2", label: "EtCO2", code: "19889-5", display: "Carbon dioxide [Partial pressure] in Exhaled gas --at end expiration", unit: "mmHg", ucum: "mm[Hg]", step: "1" },
  { key: "temperature", label: "体温", code: "8310-5", display: "Body temperature", unit: "℃", ucum: "Cel", step: "0.1" },
  { key: "respiration", label: "呼吸数", code: "9279-1", display: "Respiratory rate", unit: "/分", ucum: "/min", step: "1" },
] as const;

export type ChartMeasureKey = (typeof CHART_MEASURES)[number]["key"];

/** イベントの種別。「その他」だけ自由文(note)を本体にする。 */
export const CHART_EVENT_OPTIONS = [
  { code: "anesthesia-start", display: "麻酔開始" },
  { code: "intubation", display: "挿管" },
  { code: "incision-start", display: "執刀開始" },
  { code: "incision-end", display: "執刀終了" },
  { code: "extubation", display: "抜管" },
  { code: "anesthesia-end", display: "麻酔終了" },
  { code: "other", display: "その他" },
] as const;

export function chartEventDisplay(code: string): string {
  return CHART_EVENT_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

export { SURGERY_ROUTE_OPTIONS };

// ---- 組み立て ----

/** チャートハブ。麻酔担当はログイン中の医療従事者を入れる。 */
export function buildAnesthesiaChartHub(args: {
  patientId: string;
  orderId: string;
  practitionerId?: string;
  practitionerName?: string;
}): fhir4.Procedure {
  return {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "in-progress",
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...ANESTHESIA_CHART_TYPE }] },
    code: { text: ANESTHESIA_CHART_TYPE.display },
    subject: { reference: `Patient/${args.patientId}` },
    basedOn: [{ reference: `ServiceRequest/${args.orderId}` }],
    performedPeriod: { start: toFhirDateTime(toDateTimeInput(new Date())) },
    ...(args.practitionerId
      ? {
          performer: [
            {
              function: {
                coding: [
                  {
                    system: STAFF_ROLE_SYSTEM,
                    code: "anesthetist",
                    display: surgeryStaffRoleDisplay("anesthetist"),
                  },
                ],
              },
              actor: {
                reference: `Practitioner/${args.practitionerId}`,
                ...(args.practitionerName ? { display: args.practitionerName } : {}),
              },
            },
          ],
        }
      : {}),
  };
}

export interface ChartVitalFormValues {
  /** datetime-local。必須。 */
  measuredAt: string;
  systolic: string;
  diastolic: string;
  values: Partial<Record<ChartMeasureKey, string>>;
}

function numberOf(text: string | undefined): number | null {
  if (!text?.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * 1 時点ぶんの打点 Observation。入力した項目だけを作り、同じ時点の組が途中で
 * 欠けないよう呼び出し側は 1 transaction で保存する。
 */
export function buildChartVitalObservations(
  values: ChartVitalFormValues,
  patientId: string,
  hubId: string,
): fhir4.Observation[] {
  const base = {
    resourceType: "Observation" as const,
    status: "final" as const,
    subject: { reference: `Patient/${patientId}` },
    partOf: [{ reference: `Procedure/${hubId}` }],
    effectiveDateTime: toFhirDateTime(values.measuredAt),
  };

  const observations: fhir4.Observation[] = [];

  const systolic = numberOf(values.systolic);
  const diastolic = numberOf(values.diastolic);
  if (systolic !== null && diastolic !== null) {
    observations.push({
      ...base,
      code: { coding: [{ system: LOINC, ...BLOOD_PRESSURE }] },
      component: [
        {
          code: { coding: [{ system: LOINC, ...SYSTOLIC }] },
          valueQuantity: { value: systolic, unit: "mmHg", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
        {
          code: { coding: [{ system: LOINC, ...DIASTOLIC }] },
          valueQuantity: { value: diastolic, unit: "mmHg", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
      ],
    });
  }

  for (const measure of CHART_MEASURES) {
    const value = numberOf(values.values[measure.key]);
    if (value === null) continue;
    observations.push({
      ...base,
      code: { coding: [{ system: LOINC, code: measure.code, display: measure.display }] },
      valueQuantity: { value, unit: measure.unit, system: UCUM_SYSTEM, code: measure.ucum },
    });
  }
  return observations;
}

export function buildChartEventObservation(args: {
  patientId: string;
  hubId: string;
  code: string;
  occurredAt: string;
  note?: string;
}): fhir4.Observation {
  const display = chartEventDisplay(args.code);
  return {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [{ system: ANESTHESIA_EVENT_SYSTEM, code: args.code, display }],
      text: display,
    },
    subject: { reference: `Patient/${args.patientId}` },
    partOf: [{ reference: `Procedure/${args.hubId}` }],
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

export function buildChartDrugAdministration(
  values: ChartDrugFormValues,
  patientId: string,
  hubId: string,
): fhir4.MedicationAdministration {
  const coding: fhir4.Coding[] = [
    { system: MEDICINE_CODE_SYSTEM, code: values.medicineCode, display: values.name },
  ];
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
      coding: [
        { system: ROUTE_SYSTEM, code: values.routeCode, display: surgeryRouteDisplay(values.routeCode) },
      ],
    };
  }

  const time = toFhirDateTime(values.givenAt);
  return {
    resourceType: "MedicationAdministration",
    // 持続は投与中(in-progress)で作り、「終了」で completed + end にする。
    status: values.mode === "bolus" ? "completed" : "in-progress",
    medicationCodeableConcept: { coding, text: values.name },
    subject: { reference: `Patient/${patientId}` },
    partOf: [{ reference: `Procedure/${hubId}` }],
    ...(values.mode === "bolus"
      ? { effectiveDateTime: time }
      : { effectivePeriod: { start: time } }),
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

export function isAnesthesiaChartHub(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === ANESTHESIA_CHART_TYPE.code,
    ),
  );
}

/** バイタル打点 1 時点(分単位でまとめる)。 */
export interface ChartVitalPoint {
  /** "YYYY-MM-DDTHH:mm"(端末ローカル)。表・グラフのキー。 */
  time: string;
  systolic: number | null;
  diastolic: number | null;
  values: Partial<Record<ChartMeasureKey, number>>;
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

export interface ChartDrugLine {
  id: string;
  administration: fhir4.MedicationAdministration;
  name: string;
  mode: "bolus" | "infusion";
  /** 単回の時刻 / 持続の開始。 */
  time: string;
  /** 持続の終了(投与中なら空)。 */
  endTime: string;
  /** 「5mL 静脈内」「4mL/h 静脈内」の形。 */
  doseLabel: string;
  running: boolean;
}

export interface AnesthesiaChartData {
  hub: fhir4.Procedure;
  /** 時刻昇順。 */
  vitals: ChartVitalPoint[];
  events: ChartEventLine[];
  drugs: ChartDrugLine[];
  /** 麻酔担当の表示名。 */
  performerName: string;
  readOnly: boolean;
}

/** "YYYY-MM-DDTHH:mm" に丸めた端末ローカル時刻。打点を分単位で束ねるキー。 */
function minuteOf(dateTime: string | undefined): string {
  return toDateTimeInput(dateTime).slice(0, 16);
}

function loincCode(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === LOINC)?.code ?? "";
}

function eventCode(observation: fhir4.Observation): string {
  return observation.code?.coding?.find((c) => c.system === ANESTHESIA_EVENT_SYSTEM)?.code ?? "";
}

export function buildAnesthesiaChartData(
  hub: fhir4.Procedure,
  observations: fhir4.Observation[],
  administrations: fhir4.MedicationAdministration[],
): AnesthesiaChartData {
  const hubRef = `Procedure/${hub.id}`;
  const mine = (resource: { partOf?: fhir4.Reference[] }) =>
    (resource.partOf ?? []).some((reference) => reference.reference === hubRef);

  const pointByTime = new Map<string, ChartVitalPoint>();
  const events: ChartEventLine[] = [];

  for (const observation of observations) {
    if (!mine(observation)) continue;

    const event = eventCode(observation);
    if (event) {
      events.push({
        id: observation.id ?? "",
        time: minuteOf(observation.effectiveDateTime),
        code: event,
        label: chartEventDisplay(event),
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

    const code = loincCode(observation);
    if (code === BLOOD_PRESSURE.code) {
      const componentValue = (target: string) =>
        observation.component?.find((c) =>
          c.code?.coding?.some((coding) => coding.code === target),
        )?.valueQuantity?.value ?? null;
      point.systolic = componentValue(SYSTOLIC.code);
      point.diastolic = componentValue(DIASTOLIC.code);
      continue;
    }
    const measure = CHART_MEASURES.find((m) => m.code === code);
    if (measure && observation.valueQuantity?.value != null) {
      point.values[measure.key] = observation.valueQuantity.value;
    }
  }

  const drugs: ChartDrugLine[] = administrations.filter(mine).map((administration) => {
    const mode: ChartDrugLine["mode"] = administration.effectivePeriod ? "infusion" : "bolus";
    const dosage = administration.dosage;
    const route = dosage?.route?.coding?.find((c) => c.system === ROUTE_SYSTEM)?.code ?? "";
    const amount =
      mode === "bolus"
        ? dosage?.dose?.value != null
          ? `${dosage.dose.value}${dosage.dose.unit ?? ""}`
          : ""
        : dosage?.rateQuantity?.value != null
          ? `${dosage.rateQuantity.value}${dosage.rateQuantity.unit ?? ""}`
          : "";
    return {
      id: administration.id ?? "",
      administration,
      name:
        administration.medicationCodeableConcept?.text ??
        administration.medicationCodeableConcept?.coding?.[0]?.display ??
        "",
      mode,
      time: minuteOf(
        mode === "bolus"
          ? administration.effectiveDateTime
          : administration.effectivePeriod?.start,
      ),
      endTime: mode === "infusion" ? minuteOf(administration.effectivePeriod?.end) : "",
      doseLabel: [amount, route ? surgeryRouteDisplay(route) : ""].filter(Boolean).join(" "),
      running: mode === "infusion" && !administration.effectivePeriod?.end,
    };
  });

  const byTime = (a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time);
  const performer = hub.performer?.[0]?.actor;

  return {
    hub,
    vitals: [...pointByTime.values()].sort(byTime),
    events: events.sort(byTime),
    drugs: drugs.sort(byTime),
    performerName: performer?.display ?? "",
    readOnly: hub.status === "completed",
  };
}

/** チャートの取消。子 → ハブの順に消す(実施取消と同じ理由で記録は残さない)。 */
export function buildAnesthesiaChartDeleteEntries(data: AnesthesiaChartData): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  for (const point of data.vitals) {
    for (const id of point.observationIds) {
      entries.push({ request: { method: "DELETE", url: `Observation/${id}` } });
    }
  }
  for (const event of data.events) {
    if (event.id) entries.push({ request: { method: "DELETE", url: `Observation/${event.id}` } });
  }
  for (const drug of data.drugs) {
    if (drug.id) {
      entries.push({ request: { method: "DELETE", url: `MedicationAdministration/${drug.id}` } });
    }
  }
  if (data.hub.id) {
    entries.push({ request: { method: "DELETE", url: `Procedure/${data.hub.id}` } });
  }
  return entries;
}
