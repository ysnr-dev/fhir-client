import { toDateTimeInput, toFhirDateTime } from "./clinicalNoteHelpers";
import { ORDER_TYPE_SYSTEM } from "./orderHeader";
import { STAFF_ROLE_SYSTEM, surgeryStaffRoleDisplay } from "./surgeryOrderHelpers";
import { SURGERY_ROUTE_OPTIONS } from "./surgeryResultHelpers";
import { LOINC_SYSTEM } from "./shared";
import {
  chartChildDeleteEntries,
  groupChartDrugs,
  groupChartObservations,
  type ChartDrugLine,
  type ChartEventLine,
  type ChartMeasure,
  type ChartPoint,
  type ChartSpec,
} from "./timeSeriesChartHelpers";

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
// 打点・イベント・薬剤の組み立てと読み出しは時系列チャートの器(timeSeriesChartHelpers)。

const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";

/** ハブの category。order-type の仲間に足したチャート専用のコード。 */
export const ANESTHESIA_CHART_TYPE = { code: "anesthesia-chart", display: "麻酔チャート" };

/** イベント(麻酔開始・挿管など)の code。 */
const ANESTHESIA_EVENT_SYSTEM = "http://fhir-client.local/CodeSystem/anesthesia-event";

/** 血圧以外の打点項目。表の行の並びもこの順。 */
export const CHART_MEASURES: readonly ChartMeasure[] = [
  { key: "pulse", label: "脈拍", system: LOINC_SYSTEM, code: "8867-4", display: "Heart rate", unit: "/分", ucum: "/min", step: "1" },
  { key: "spo2", label: "SpO2", system: LOINC_SYSTEM, code: "2708-6", display: "Oxygen saturation", unit: "%", ucum: "%", step: "1" },
  { key: "etco2", label: "EtCO2", system: LOINC_SYSTEM, code: "19889-5", display: "Carbon dioxide [Partial pressure] in Exhaled gas --at end expiration", unit: "mmHg", ucum: "mm[Hg]", step: "1" },
  { key: "temperature", label: "体温", system: LOINC_SYSTEM, code: "8310-5", display: "Body temperature", unit: "℃", ucum: "Cel", step: "0.1" },
  { key: "respiration", label: "呼吸数", system: LOINC_SYSTEM, code: "9279-1", display: "Respiratory rate", unit: "/分", ucum: "/min", step: "1" },
];

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

/** 打点は category を持たせない(経過表・カルテのバイタルに出さない。設計 §1-3)。 */
export const ANESTHESIA_CHART_SPEC: ChartSpec = {
  measures: CHART_MEASURES,
  events: CHART_EVENT_OPTIONS,
  eventSystem: ANESTHESIA_EVENT_SYSTEM,
  drugRoutes: SURGERY_ROUTE_OPTIONS,
};

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

// ---- 読み出し ----

export function isAnesthesiaChartHub(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === ANESTHESIA_CHART_TYPE.code,
    ),
  );
}

export interface AnesthesiaChartData {
  hub: fhir4.Procedure;
  /** 時刻昇順。 */
  vitals: ChartPoint[];
  events: ChartEventLine[];
  drugs: ChartDrugLine[];
  /** 麻酔担当の表示名。 */
  performerName: string;
  readOnly: boolean;
}

export function buildAnesthesiaChartData(
  hub: fhir4.Procedure,
  observations: fhir4.Observation[],
  administrations: fhir4.MedicationAdministration[],
): AnesthesiaChartData {
  const hubId = hub.id ?? "";
  const { points, events } = groupChartObservations(ANESTHESIA_CHART_SPEC, hubId, observations);
  const performer = hub.performer?.[0]?.actor;

  return {
    hub,
    vitals: points,
    events,
    drugs: groupChartDrugs(ANESTHESIA_CHART_SPEC, hubId, administrations),
    performerName: performer?.display ?? "",
    readOnly: hub.status === "completed",
  };
}

/** チャートの取消。子 → ハブの順に消す(実施取消と同じ理由で記録は残さない)。 */
export function buildAnesthesiaChartDeleteEntries(data: AnesthesiaChartData): fhir4.BundleEntry[] {
  const entries = chartChildDeleteEntries(data.vitals, data.events, data.drugs);
  if (data.hub.id) {
    entries.push({ request: { method: "DELETE", url: `Procedure/${data.hub.id}` } });
  }
  return entries;
}
