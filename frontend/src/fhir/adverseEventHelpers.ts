import { REGIMEN_ORDER_EXT_URL } from "./regimenOrderHelpers";

/**
 * 治療による有害事象(CTCAE Grade)の記録(docs/chemo-regimen-design.md §7.6 C-3、
 * docs/radiotherapy-order-design.md §6.3)。
 *
 * 患者 × 治療 × 用語 × Grade × 発現日 を 1 件の Observation で持つ。上流に AdverseEvent
 * リソースが無い(JP Core プロファイルも無い)ので、患者コンパートメントの検索が効き、
 * 上流改修が要らない Observation を使う。
 *
 * - category: 独自の `adverse-event`(検体検査・バイタルの一覧に混ざらないように)
 * - code.text: CTCAE 用語(自由記述。用語マスタは §7.6 F)
 * - valueInteger: Grade(1〜5)
 * - effectivePeriod: start = 発現日、end = 回復日(継続中なら無し)
 * - **basedOn: 原因となった治療のヘッダ**(レジメン適用 / 放射線治療の治療処方)
 * - extension `treatment-context`: 治療の種別と名前の写し、化学療法ならクール
 * - performer: 記録した医療従事者
 *
 * ［決定］記録者は Provenance ではなく `performer` に置く。オーダーではなく**臨床上の観察**で、
 * 「誰が診て記録したか」は観察そのものの属性だから(承認の対象にもしない。§8.14 N-10)。
 *
 * ［改訂］当初は化学療法専用で、適用ヘッダへの参照を `regimen-order` 拡張の中に持っていた。
 * **標準の `basedOn` に移した** —— 拡張の中の参照は検索できず、1 コースぶんを見るのに患者の
 * 有害事象を全部読む必要があったため。上流は `Observation?based-on=` に対応済みで改修は要らない。
 * 読みは旧形式も受ける(`basedOn` の無い古い記録。編集して保存すると新形式になる)。
 */

const OBSERVATION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/observation-category";
export const ADVERSE_EVENT_CATEGORY = { code: "adverse-event", display: "有害事象" };

/** 原因となった治療の種別と名前の写し(参照そのものは `basedOn`)。 */
export const TREATMENT_CONTEXT_EXT_URL = "http://fhir-client.local/StructureDefinition/treatment-context";

/** 治療の種別。オーダー種別(`order-type`)の code をそのまま使う。 */
export type TreatmentType = "chemo-regimen" | "radiotherapy";

export interface AdverseEventRecord {
  id: string;
  /** 原因となった治療のヘッダ(レジメン適用 / 治療処方)。 */
  treatmentSrId: string;
  treatmentType: TreatmentType;
  /** 治療の名前の写し(レジメン名 /「第1コース 左乳房」)。 */
  treatmentName: string;
  /** 化学療法のクール。放射線治療では持たない。 */
  cycle: number | undefined;
  term: string;
  grade: number;
  /** 発現日。 */
  onset: string;
  /** 回復日。継続中なら空。 */
  resolved: string;
  note: string;
  /** 記録した医療従事者。編集で上書きしないよう読み書きする(§8.14 N-10)。 */
  performer: fhir4.Reference | undefined;
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

function subString(ext: fhir4.Extension | undefined, url: string): string | undefined {
  return ext?.extension?.find((e) => e.url === url)?.valueString;
}

function subInt(ext: fhir4.Extension | undefined, url: string): number | undefined {
  return ext?.extension?.find((e) => e.url === url)?.valueInteger;
}

export function parseAdverseEvent(observation: fhir4.Observation): AdverseEventRecord | null {
  if (!observation.id || !isAdverseEventObservation(observation)) return null;
  const context = observation.extension?.find((e) => e.url === TREATMENT_CONTEXT_EXT_URL);
  // 旧形式(basedOn が無く、適用ヘッダへの参照を拡張の中に持つ化学療法の記録)。
  const legacy = observation.extension?.find((e) => e.url === REGIMEN_ORDER_EXT_URL);
  const reference =
    observation.basedOn?.[0]?.reference ??
    legacy?.extension?.find((e) => e.url === "regimen")?.valueReference?.reference ??
    "";
  const treatmentSrId = reference.split("/").pop() ?? "";
  if (!treatmentSrId) return null;

  const treatmentType: TreatmentType =
    context?.extension?.find((e) => e.url === "type")?.valueCode === "radiotherapy"
      ? "radiotherapy"
      : "chemo-regimen";
  const cycle = subInt(context, "cycle") ?? subInt(legacy, "cycle");
  // 化学療法はクールが記録の単位なので、無ければ読めない記録として落とす。
  if (treatmentType === "chemo-regimen" && cycle === undefined) return null;

  return {
    id: observation.id,
    treatmentSrId,
    treatmentType,
    treatmentName: subString(context, "name") ?? subString(legacy, "name") ?? "",
    cycle: treatmentType === "chemo-regimen" ? cycle : undefined,
    term: observation.code?.text ?? "",
    grade: observation.valueInteger ?? 0,
    onset: observation.effectivePeriod?.start?.slice(0, 10) ?? observation.effectiveDateTime?.slice(0, 10) ?? "",
    resolved: observation.effectivePeriod?.end?.slice(0, 10) ?? "",
    note: observation.note?.[0]?.text ?? "",
    performer: observation.performer?.[0],
  };
}

export interface AdverseEventRef {
  /** 原因となった治療のヘッダ。 */
  treatmentSrId: string;
  treatmentType: TreatmentType;
  /** 治療の名前の写し。 */
  name: string;
  /** 化学療法のクール。放射線治療では渡さない。 */
  cycle?: number;
}

export function buildAdverseEvent(
  values: AdverseEventFormValues,
  patientId: string,
  ref: AdverseEventRef,
  id?: string,
  /** 記録者。編集では元の記録者をそのまま渡す(編集した人で上書きしない)。 */
  performer?: fhir4.Reference,
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
    basedOn: [{ reference: `ServiceRequest/${ref.treatmentSrId}` }],
    extension: [
      {
        url: TREATMENT_CONTEXT_EXT_URL,
        extension: [
          { url: "type", valueCode: ref.treatmentType },
          { url: "name", valueString: ref.name },
          ...(ref.cycle === undefined ? [] : [{ url: "cycle", valueInteger: ref.cycle }]),
        ],
      },
    ],
  };
  if (id) observation.id = id;
  if (performer) observation.performer = [performer];
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

/** 治療(化学療法はクールも)で絞る。発現日の新しい順。 */
export function adverseEventsOf(
  records: AdverseEventRecord[],
  treatmentSrId: string,
  cycle?: number,
): AdverseEventRecord[] {
  return records
    .filter((r) => r.treatmentSrId === treatmentSrId && (cycle === undefined || r.cycle === cycle))
    .sort((a, b) => b.onset.localeCompare(a.onset) || b.grade - a.grade);
}

/** 「末梢性感覚ニューロパチー G2」。 */
export function adverseEventLabel(record: Pick<AdverseEventRecord, "term" | "grade">): string {
  return `${record.term} G${record.grade}`;
}

/** 渡した記録の最大 Grade。無ければ null。 */
export function maxGrade(records: AdverseEventRecord[]): number | null {
  return records.length === 0 ? null : Math.max(...records.map((r) => r.grade));
}
