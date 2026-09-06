import { REGIMEN_ORDER_EXT_URL } from "./regimenOrderHelpers";

/**
 * 化学療法の有害事象(CTCAE Grade)の記録(docs/chemo-regimen-design.md §7.6 C-3)。
 *
 * 患者 × 適用 × クール × 用語 × Grade × 発現日 を 1 件の Observation で持つ。上流に
 * AdverseEvent リソースが無い(JP Core プロファイルも無い)ので、患者コンパートメントの
 * 検索が効き、上流改修が要らない Observation を使う。
 *
 * - category: 独自の `adverse-event`(検体検査・バイタルの一覧に混ざらないように)
 * - code.text: CTCAE 用語(自由記述。用語マスタは §7.6 F)
 * - valueInteger: Grade(1〜5)
 * - effectivePeriod: start = 発現日、end = 回復日(継続中なら無し)
 * - extension `regimen-order`: 適用ヘッダへの参照とクール(日は持たない)
 */

const OBSERVATION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/observation-category";
export const ADVERSE_EVENT_CATEGORY = { code: "adverse-event", display: "有害事象" };

export interface AdverseEventRecord {
  id: string;
  regimenSrId: string;
  cycle: number;
  term: string;
  grade: number;
  /** 発現日。 */
  onset: string;
  /** 回復日。継続中なら空。 */
  resolved: string;
  note: string;
}

export interface AdverseEventFormValues {
  term: string;
  grade: string;
  onset: string;
  resolved: string;
  note: string;
}

export function emptyAdverseEventForm(onset: string): AdverseEventFormValues {
  return { term: "", grade: "1", onset, resolved: "", note: "" };
}

export function isAdverseEventObservation(observation: fhir4.Observation): boolean {
  return (observation.category ?? []).some((c) =>
    (c.coding ?? []).some((x) => x.system === OBSERVATION_CATEGORY_SYSTEM && x.code === ADVERSE_EVENT_CATEGORY.code),
  );
}

export function parseAdverseEvent(observation: fhir4.Observation): AdverseEventRecord | null {
  if (!observation.id || !isAdverseEventObservation(observation)) return null;
  const ext = observation.extension?.find((e) => e.url === REGIMEN_ORDER_EXT_URL);
  const reference = ext?.extension?.find((e) => e.url === "regimen")?.valueReference?.reference ?? "";
  const regimenSrId = reference.split("/").pop() ?? "";
  const cycle = ext?.extension?.find((e) => e.url === "cycle")?.valueInteger;
  if (!regimenSrId || cycle === undefined) return null;
  return {
    id: observation.id,
    regimenSrId,
    cycle,
    term: observation.code?.text ?? "",
    grade: observation.valueInteger ?? 0,
    onset: observation.effectivePeriod?.start?.slice(0, 10) ?? observation.effectiveDateTime?.slice(0, 10) ?? "",
    resolved: observation.effectivePeriod?.end?.slice(0, 10) ?? "",
    note: observation.note?.[0]?.text ?? "",
  };
}

export interface AdverseEventRef {
  regimenSrId: string;
  cycle: number;
  code: string;
  name: string;
}

export function buildAdverseEvent(
  values: AdverseEventFormValues,
  patientId: string,
  ref: AdverseEventRef,
  id?: string,
): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, ...ADVERSE_EVENT_CATEGORY }] }],
    code: { text: values.term.trim() },
    subject: { reference: `Patient/${patientId}` },
    effectivePeriod: {
      start: values.onset,
      ...(values.resolved ? { end: values.resolved } : {}),
    },
    valueInteger: Number(values.grade),
    extension: [
      {
        url: REGIMEN_ORDER_EXT_URL,
        extension: [
          { url: "regimen", valueReference: { reference: `ServiceRequest/${ref.regimenSrId}` } },
          { url: "cycle", valueInteger: ref.cycle },
          { url: "code", valueString: ref.code },
          { url: "name", valueString: ref.name },
        ],
      },
    ],
  };
  if (id) observation.id = id;
  if (values.note.trim()) observation.note = [{ text: values.note.trim() }];
  return observation;
}

export function validateAdverseEvent(values: AdverseEventFormValues): string | null {
  if (!values.term.trim()) return "有害事象の用語を入力してください";
  const grade = Number(values.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 5) return "Grade は 1〜5 で選んでください";
  if (!values.onset) return "発現日を入力してください";
  if (values.resolved && values.resolved < values.onset) return "回復日は発現日以降にしてください";
  return null;
}

export function formValuesOf(record: AdverseEventRecord): AdverseEventFormValues {
  return {
    term: record.term,
    grade: String(record.grade),
    onset: record.onset,
    resolved: record.resolved,
    note: record.note,
  };
}

/** 適用(とクール)で絞る。発現日の新しい順。 */
export function adverseEventsOf(
  records: AdverseEventRecord[],
  regimenSrId: string,
  cycle?: number,
): AdverseEventRecord[] {
  return records
    .filter((r) => r.regimenSrId === regimenSrId && (cycle === undefined || r.cycle === cycle))
    .sort((a, b) => b.onset.localeCompare(a.onset) || b.grade - a.grade);
}

/** 「末梢性感覚ニューロパチー G2」。 */
export function adverseEventLabel(record: Pick<AdverseEventRecord, "term" | "grade">): string {
  return `${record.term} G${record.grade}`;
}

/** そのクールの最大 Grade。無ければ null。 */
export function maxGrade(records: AdverseEventRecord[]): number | null {
  return records.length === 0 ? null : Math.max(...records.map((r) => r.grade));
}
