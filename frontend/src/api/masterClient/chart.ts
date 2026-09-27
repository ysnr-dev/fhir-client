import type { ChartDefinitionBody } from "../../fhir/chartDefinitionHelpers";
import { buildError, masterFetch } from "./core";
import type { OrderSetScope } from "./orderSet";

// ---- チャート定義(数値の推移と治療イベントを重ねて読む画面の設定) ----

// 患者を持たない雛形(どの項目を並べ、どのイベントを重ねるか)なので、同じ定義を
// どの患者にも当てられる。持ち主はオーダーセットと同じ 3 段階。
// 設計は docs/patient-chart-design.md。
export interface ChartDefinition {
  id: number;
  /** uuid。複製と環境間の移送に使う。 */
  code: string;
  scope: OrderSetScope;
  /** 診療科 Organization.id / Practitioner.id。院内共通は null。 */
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  active: boolean;
  /** 形は fhir/chartDefinitionHelpers.ts の ChartDefinitionBody。 */
  definition: ChartDefinitionBody;
  updated_at: string;
}

export interface ChartDefinitionPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  name?: string;
  display_order?: number | null;
  active?: boolean;
  definition?: ChartDefinitionBody;
}

const CHART_DEFINITIONS_PATH = "/master/chart_definitions";

/** 院内共通 + 指定した診療科 + 指定した医師の定義を全件(definition 込み)。 */
export async function fetchChartDefinitions(params: {
  department_id?: string;
  practitioner_id?: string;
}): Promise<{ total: number; items: ChartDefinition[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${CHART_DEFINITIONS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: ChartDefinition[] };
}

export async function createChartDefinition(
  payload: ChartDefinitionPayload,
): Promise<ChartDefinition> {
  const res = await masterFetch(CHART_DEFINITIONS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ChartDefinition;
}

export async function updateChartDefinition(
  id: number,
  payload: ChartDefinitionPayload,
): Promise<ChartDefinition> {
  const res = await masterFetch(`${CHART_DEFINITIONS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ChartDefinition;
}

export async function deleteChartDefinition(id: number): Promise<void> {
  const res = await masterFetch(`${CHART_DEFINITIONS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// ---- 患者ごとに最初に開くチャート(ピン留め) ----
// 患者につき 1 つで、利用者の間で共有する。ピンが無ければ chart_definition_id は null。

export interface PatientChartPin {
  patient_id: string;
  chart_definition_id: number | null;
  pinned_by_id: string | null;
  pinned_by_name: string | null;
  updated_at: string | null;
}

const PATIENT_CHART_PINS_PATH = "/master/patient_chart_pins";

export async function fetchPatientChartPin(patientId: string): Promise<PatientChartPin> {
  const res = await masterFetch(`${PATIENT_CHART_PINS_PATH}/${encodeURIComponent(patientId)}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PatientChartPin;
}

export async function pinPatientChart(
  patientId: string,
  chartDefinitionId: number,
  pinnedByName: string | null,
): Promise<PatientChartPin> {
  const res = await masterFetch(`${PATIENT_CHART_PINS_PATH}/${encodeURIComponent(patientId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chart_definition_id: chartDefinitionId, pinned_by_name: pinnedByName }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PatientChartPin;
}

export async function unpinPatientChart(patientId: string): Promise<void> {
  const res = await masterFetch(`${PATIENT_CHART_PINS_PATH}/${encodeURIComponent(patientId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildError(res);
}
