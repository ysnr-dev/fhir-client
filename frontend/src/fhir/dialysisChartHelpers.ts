import { toDateTimeInputValue } from "../lib/dates";
import {
  DIALYSIS_MEASUREMENT_SYSTEM,
  DIALYSIS_MEASUREMENTS,
  DIALYSIS_ROUTE_OPTIONS,
  dialysisSessionDisplay,
  type DialysisChartLatest,
  type DialysisMedicineLine,
  type DialysisPerformer,
  type DialysisSession,
  type DryWeight,
} from "./dialysisResultHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { LOINC_SYSTEM, referenceIdOfType } from "./shared";
import {
  chartChildDeleteEntries,
  groupChartDrugs,
  groupChartObservations,
  type ChartDrugLine,
  type ChartEventLine,
  type ChartMarker,
  type ChartMeasure,
  type ChartPoint,
  type ChartSecondaryAxis,
  type ChartSpec,
} from "./timeSeriesChartHelpers";

// 透析経過表(透析中の時系列記録)。docs/dialysis-chart-design.md。
//
//   Procedure 実施記録のハブ(1 回 = 1 件。dialysisResultHelpers)
//    └ partOf ← Procedure 経過表のハブ(1 回 = 1 件)
//         │  status   = in-progress(記録中)/ completed(回の終了で閉じる)
//         │  category = order-type|dialysis-chart
//         │  basedOn  = 持たない(カルテの詳細の _revinclude に打点を乗せないため)
//         ├ partOf ← Observation 打点(category = order-type|dialysis-chart)
//         ├ partOf ← Observation イベント(code = dialysis-event)
//         └ partOf ← MedicationAdministration 透析中の薬剤(補液・昇圧薬など。category = order-type|dialysis-chart)
//
// 打点・イベント・薬剤の組み立てと読み出しは時系列チャートの器(timeSeriesChartHelpers)。
// 回の開始・終了は実施記録のハブが正本で、イベントには持たない(グラフの固定線にする)。
// 薬剤は時刻つきの記録で、会計に送るのは実施記録の薬剤(終了の入力の初期値に流し込む)。

const LOCAL = "http://fhir-client.local";
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** ハブと打点の category。order-type の仲間に足した経過表専用のコード。 */
export const DIALYSIS_CHART_TYPE = { code: "dialysis-chart", display: "透析経過表" };

const DIALYSIS_EVENT_SYSTEM = `${LOCAL}/CodeSystem/dialysis-event`;

const CHART_CATEGORY: fhir4.CodeableConcept[] = [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_CHART_TYPE }] }];

/** 装置の値。コードは実施記録の測定値と同じ CodeSystem(回の値と時点の値で意味が同じ)。 */
function deviceMeasure(code: keyof typeof DIALYSIS_MEASUREMENTS, label: string, step = "1"): ChartMeasure {
  const { display, unit, ucum } = DIALYSIS_MEASUREMENTS[code];
  return { key: code, label, system: DIALYSIS_MEASUREMENT_SYSTEM, code, display, unit, ucum, step };
}

/** 血圧以外の打点項目。表の行の並びもこの順。 */
export const DIALYSIS_CHART_MEASURES: readonly ChartMeasure[] = [
  { key: "pulse", label: "脈拍", system: LOINC_SYSTEM, code: "8867-4", display: "Heart rate", unit: "/分", ucum: "/min", step: "1" },
  { key: "spo2", label: "SpO2", system: LOINC_SYSTEM, code: "2708-6", display: "Oxygen saturation", unit: "%", ucum: "%", step: "1" },
  { key: "temperature", label: "体温", system: LOINC_SYSTEM, code: "8310-5", display: "Body temperature", unit: "℃", ucum: "Cel", step: "0.1" },
  deviceMeasure("qb", "QB"),
  deviceMeasure("qd", "QD"),
  deviceMeasure("uf-rate", "除水速度"),
  deviceMeasure("ultrafiltration", "累積除水", "0.01"),
  deviceMeasure("venous-pressure", "静脈圧"),
  deviceMeasure("arterial-pressure", "動脈圧"),
  deviceMeasure("tmp", "TMP"),
];

/** イベントの種別。「その他」だけ自由文(note)を本体にし、補液は量をメモに書く。 */
export const DIALYSIS_CHART_EVENT_OPTIONS = [
  { code: "puncture", display: "穿刺" },
  { code: "uf-stop", display: "除水停止" },
  { code: "uf-resume", display: "除水再開" },
  { code: "hypotension", display: "血圧低下" },
  { code: "fluid-bolus", display: "補液" },
  { code: "circuit-change", display: "回路交換" },
  { code: "blood-return", display: "返血" },
  { code: "hemostasis", display: "止血確認" },
  { code: "other", display: "その他" },
] as const;

export const DIALYSIS_CHART_SPEC: ChartSpec = {
  measures: DIALYSIS_CHART_MEASURES,
  events: DIALYSIS_CHART_EVENT_OPTIONS,
  eventSystem: DIALYSIS_EVENT_SYSTEM,
  category: CHART_CATEGORY,
  carryOver: ["qb", "qd", "uf-rate", "ultrafiltration", "venous-pressure", "arterial-pressure", "tmp"],
  drugRoutes: DIALYSIS_ROUTE_OPTIONS,
};

/** 温度板の 24 時間表示に出す打点の code(バイタルだけ。装置の値は出さない)。 */
export const DIALYSIS_CHART_FLOWSHEET_CODES = [
  "85354-9",
  ...DIALYSIS_CHART_MEASURES.filter((m) => m.system === LOINC_SYSTEM).map((m) => m.code),
];

// ---- 組み立て ----

/**
 * 経過表のハブ。最初の打点と同じ transaction で作る(urn:uuid で結ぶ)。
 * 回が終わっていれば最初から completed で、終了時刻も回に揃える。
 */
export function buildDialysisChartHub(
  session: DialysisSession,
  performer: DialysisPerformer | null,
  startAt: string,
): fhir4.Procedure {
  const completed = session.hub.status === "completed";
  const end = session.hub.performedPeriod?.end;
  return {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: completed ? "completed" : "in-progress",
    category: { coding: [{ system: ORDER_TYPE_SYSTEM, ...DIALYSIS_CHART_TYPE }] },
    code: { text: DIALYSIS_CHART_TYPE.display },
    subject: session.hub.subject,
    partOf: [{ reference: `Procedure/${session.hub.id ?? ""}` }],
    performedPeriod: { start: startAt, ...(completed && end ? { end } : {}) },
    ...(performer?.id
      ? { performer: [{ actor: { reference: `Practitioner/${performer.id}`, display: performer.name || undefined } }] }
      : {}),
  };
}

// ---- 読み出し ----

export function isDialysisChartHub(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === DIALYSIS_CHART_TYPE.code),
  );
}

/** 経過表のある回(実施記録のハブの id)。透析一覧とカルテの実施の行に「経過表あり」の印を出すのに使う。 */
export function dialysisChartSessionIds(procedures: fhir4.Procedure[]): Set<string> {
  const ids = new Set<string>();
  for (const procedure of procedures) {
    if (!isDialysisChartHub(procedure) || procedure.status === "entered-in-error") continue;
    const sessionId = referenceIdOfType(procedure.partOf?.[0]?.reference, "Procedure");
    if (sessionId) ids.add(sessionId);
  }
  return ids;
}

export interface DialysisChartData {
  hub: fhir4.Procedure;
  /** 時刻昇順。 */
  points: ChartPoint[];
  events: ChartEventLine[];
  drugs: ChartDrugLine[];
}

export function buildDialysisChartData(
  hub: fhir4.Procedure,
  observations: fhir4.Observation[],
  administrations: fhir4.MedicationAdministration[] = [],
): DialysisChartData {
  const hubId = hub.id ?? "";
  const { points, events } = groupChartObservations(DIALYSIS_CHART_SPEC, hubId, observations);
  return { hub, points, events, drugs: groupChartDrugs(DIALYSIS_CHART_SPEC, hubId, administrations) };
}

/** 経過表の取消と、実施取消の巻き添え。打点・イベント・薬剤 → ハブの順に消す。 */
export function buildDialysisChartDeleteEntries(data: DialysisChartData): fhir4.BundleEntry[] {
  const entries = chartChildDeleteEntries(data.points, data.events, data.drugs);
  if (data.hub.id) entries.push({ request: { method: "DELETE", url: `Procedure/${data.hub.id}` } });
  return entries;
}

/**
 * 終了の入力の初期値に使う、最後の血圧・累積除水量と、透析中に記録した薬剤。
 * 薬剤は実施記録の薬剤の行(会計に送るもの)の初期値になる。持続は総量が分からないので量は空にする。
 */
export function dialysisChartLatest(data: DialysisChartData): DialysisChartLatest {
  const lastBp = [...data.points].reverse().find((p) => p.systolic != null && p.diastolic != null);
  const lastUf = [...data.points].reverse().find((p) => p.values.ultrafiltration != null);
  const medicines: DialysisMedicineLine[] = data.drugs.map((drug) => ({
    medicineCode: drug.medicineCode,
    yjCode: drug.yjCode,
    name: drug.name,
    dose: drug.dose != null ? String(drug.dose) : "",
    unitName: drug.unitName,
    routeCode: drug.routeCode,
    bundled: false,
  }));
  return {
    systolic: lastBp?.systolic ?? null,
    diastolic: lastBp?.diastolic ?? null,
    ultrafiltration: lastUf?.values.ultrafiltration ?? null,
    medicines,
  };
}

/**
 * グラフの右軸(累積除水量)。上端は目標除水の 1.2 倍、目標が無ければ記録の最大値の 1.2 倍を
 * 0.5L 刻みに丸める。目標も記録も無ければ軸を出さない。
 */
export function dialysisChartSecondaryAxis(points: readonly ChartPoint[], target: number | null): ChartSecondaryAxis | undefined {
  const recorded = Math.max(0, ...points.map((p) => p.values.ultrafiltration ?? 0));
  const base = target ?? (recorded > 0 ? recorded : null);
  if (base == null) return undefined;
  const max = Math.max(0.5, Math.ceil((Math.max(base, recorded) * 1.2) / 0.5) * 0.5);
  return { key: "ultrafiltration", label: "累積除水", unit: "L", max, ...(target != null ? { target } : {}) };
}

/** 目標除水(L) = 透析前体重 − ドライウェイト。どちらかが無ければ null。 */
export function dialysisChartTarget(session: DialysisSession, dryWeight: DryWeight | null): number | null {
  const preWeight = dialysisSessionDisplay(session).preWeight;
  return preWeight != null && dryWeight ? Math.round((preWeight - dryWeight.value) * 100) / 100 : null;
}

/** グラフの固定線。回の開始・終了(実施記録のハブの performedPeriod)。 */
export function dialysisChartMarkers(session: DialysisSession): ChartMarker[] {
  const period = session.hub.performedPeriod;
  return [
    { time: toDateTimeInputValue(period?.start).slice(0, 16), label: "開始" },
    { time: toDateTimeInputValue(period?.end).slice(0, 16), label: "終了" },
  ].filter((marker) => marker.time);
}
