import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- クリニカルパス(施設パス)定義マスタ(docs/clinical-pathway-design.md) ----

export type PathwayStatus = "draft" | "approved" | "retired";
export type PathwaySetting = "inpatient" | "outpatient";
/** アウトカム・観察項目のコード体系。BOM(Basic Outcome Master)か施設ローカルか。 */
export type PathwayCodeSystem = "bom" | "local";
/** アウトカム大分類(BOM): G 患者目標 / H 患者状態。 */
export type PathwayOutcomeCategory = "G" | "H";
/** ePath のタスク分類(大)。 */
export type PathwayTaskCategoryLv1 = "TP" | "EX" | "ML" | "NO" | "NC" | "EG" | "AL" | "MD";

export interface Pathway {
  id: number;
  pathway_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  version: string | null;
  department_code: string | null;
  department_name: string | null;
  setting: PathwaySetting;
  /** パス予定日数。 */
  scheduled_days: number | null;
  /** 適応基準。承認時必須。 */
  adaptive_criteria: string | null;
  /** 元にしたひな型パスの URL。 */
  protocol_base: string | null;
  status: PathwayStatus;
  approved_on: string | null;
  approved_by: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
  copied_from_code: string | null;
  /** 病日の数と最終病日。API が導出して添える。 */
  event_count: number | null;
  last_day: number | null;
  updated_at: string;
}

export interface PathwayIndication {
  id: number;
  display_order: number | null;
  management_number: string;
  name: string;
  icd10: string | null;
}

export interface PathwayTask {
  id: number;
  task_key: string;
  /** 結んでいる観察項目の識別子。無ければ null。 */
  assessment_key: string | null;
  display_order: number | null;
  name: string;
  category_lv1: PathwayTaskCategoryLv1;
  category_lv2: string | null;
  code: string | null;
  /** オーダー雛形の種別(OrderSetOrderType)。null はチェックリスト項目。 */
  order_type: string | null;
  order_label: string | null;
  order_values: unknown;
  order_schema_version: number | null;
  note: string | null;
}

export interface PathwayAssessment {
  id: number;
  assessment_key: string;
  display_order: number | null;
  name: string;
  category_code: string | null;
  category_name: string | null;
  code_system: PathwayCodeSystem | null;
  code: string | null;
  proper_value: string | null;
  nursing_observation_manage_no: string | null;
  note: string | null;
}

export interface PathwayOatUnit {
  id: number;
  unit_key: string;
  display_order: number | null;
  name: string;
  category: PathwayOutcomeCategory | null;
  code_system: PathwayCodeSystem | null;
  code: string | null;
  critical: boolean;
  note: string | null;
  assessments: PathwayAssessment[];
  tasks: PathwayTask[];
}

/** フェーズの終わりで選べる次の候補。先頭が標準の経路。 */
export interface PathwayPhaseBranch {
  id: number;
  display_order: number | null;
  /** 次のフェーズ。null は「ここでパスを終了」。 */
  to_phase_key: string | null;
  /** 選ぶときの目安。 */
  criteria: string | null;
}

/** フェーズ(連続する病日のまとまり)。適用はフェーズ単位で進める。先頭が開始フェーズ。 */
export interface PathwayPhase {
  id: number;
  phase_key: string;
  display_order: number | null;
  name: string | null;
  note: string | null;
  branches: PathwayPhaseBranch[];
}

export interface PathwayEvent {
  id: number;
  display_order: number | null;
  phase_key: string;
  /** 病日(入院日 = 1、入院前日 = -1)。 */
  elapsed_days: number;
  path_step: number;
  path_step_name: string | null;
  title: string | null;
  /** ePath の action.id(病日[-パスステップ])。API が導出して添える。 */
  event_key: string;
  allowable_condition_type: string | null;
  allowable_days: number | null;
  allowable_range_low: number | null;
  allowable_range_high: number | null;
  note: string | null;
  oat_units: PathwayOatUnit[];
}

export interface PathwayDetail extends Pathway {
  indications: PathwayIndication[];
  phases: PathwayPhase[];
  events: PathwayEvent[];
}

export interface PathwayIndicationPayload {
  management_number: string;
  name: string;
  icd10?: string | null;
}

export interface PathwayTaskPayload {
  task_key: string;
  assessment_key?: string | null;
  name: string;
  category_lv1: PathwayTaskCategoryLv1;
  category_lv2?: string | null;
  code?: string | null;
  order_type?: string | null;
  order_label?: string | null;
  order_values?: unknown;
  order_schema_version?: number | null;
  note?: string | null;
}

export interface PathwayAssessmentPayload {
  assessment_key: string;
  name: string;
  category_code?: string | null;
  category_name?: string | null;
  code_system?: PathwayCodeSystem | null;
  code?: string | null;
  proper_value?: string | null;
  nursing_observation_manage_no?: string | null;
  note?: string | null;
}

export interface PathwayOatUnitPayload {
  unit_key: string;
  name: string;
  category?: PathwayOutcomeCategory | null;
  code_system?: PathwayCodeSystem | null;
  code?: string | null;
  critical: boolean;
  note?: string | null;
  assessments: PathwayAssessmentPayload[];
  tasks: PathwayTaskPayload[];
}

export interface PathwayPhaseBranchPayload {
  to_phase_key: string | null;
  criteria?: string | null;
}

export interface PathwayPhasePayload {
  phase_key: string;
  name?: string | null;
  note?: string | null;
  branches: PathwayPhaseBranchPayload[];
}

export interface PathwayEventPayload {
  phase_key: string;
  elapsed_days: number;
  path_step?: number;
  path_step_name?: string | null;
  title?: string | null;
  note?: string | null;
  oat_units: PathwayOatUnitPayload[];
}

export interface PathwayPayload {
  pathway_code?: string;
  /** 凍結中(承認済・廃止)の更新では運用の項目だけを送るので任意。 */
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  version?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  setting?: PathwaySetting;
  scheduled_days?: number | null;
  adaptive_criteria?: string | null;
  protocol_base?: string | null;
  status?: PathwayStatus;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
  indications?: PathwayIndicationPayload[];
  phases?: PathwayPhasePayload[];
  events?: PathwayEventPayload[];
}

export interface PathwaySearchParams {
  name?: string;
  department_code?: string;
  status?: PathwayStatus | "";
  setting?: PathwaySetting | "";
  active?: boolean;
  page?: number;
  per?: number;
}

const PATHWAYS_PATH = "/master/pathways";

export async function searchPathways(params: PathwaySearchParams): Promise<MasterSearchResult<Pathway>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.department_code) search.set("department_code", params.department_code);
  if (params.status) search.set("status", params.status);
  if (params.setting) search.set("setting", params.setting);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));
  const res = await masterFetch(`${PATHWAYS_PATH}?${search}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Pathway>;
}

/** id でもパスコードでも引ける。 */
export async function fetchPathway(idOrCode: number | string): Promise<PathwayDetail> {
  const res = await masterFetch(`${PATHWAYS_PATH}/${idOrCode}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathwayDetail;
}

export async function createPathway(payload: PathwayPayload): Promise<PathwayDetail> {
  const res = await masterFetch(PATHWAYS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathwayDetail;
}

export async function updatePathway(id: number, payload: PathwayPayload): Promise<PathwayDetail> {
  const res = await masterFetch(`${PATHWAYS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathwayDetail;
}

/** 複製。新しいコードで全部写し(uuid は引き継ぐ)、承認は引き継がず下書きになる。 */
export async function copyPathway(id: number, name?: string): Promise<PathwayDetail> {
  const res = await masterFetch(`${PATHWAYS_PATH}/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathwayDetail;
}

export async function deletePathway(id: number): Promise<void> {
  const res = await masterFetch(`${PATHWAYS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
