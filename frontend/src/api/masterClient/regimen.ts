import { buildError, masterFetch, type MasterSearchResult } from "./core";
import type { MedicineUsage } from "./medicine";

// ---- 化学療法レジメンマスタ ----

// 審査委員会で承認する施設共通の参照表。本体と子(適応疾患・投与ステップ・薬剤・
// 検査基準・副作用)を 1 リクエストで読み書きする。設計は docs/chemo-regimen-design.md。
export type RegimenPurpose = "neoadjuvant" | "adjuvant" | "curative" | "palliative" | "other";
export type RegimenSetting = "outpatient" | "inpatient" | "both";
export type RegimenEmeticRisk = "high" | "moderate" | "low" | "minimal";
export type RegimenStatus = "draft" | "approved" | "retired";
export type RegimenStepUsageType = "drip" | "one-shot" | "oral";
export type RegimenDrugRole = "anticancer" | "fluid" | "antiemetic" | "premedication" | "supportive" | "other";
export type RegimenDoseBasis = "bsa" | "weight" | "auc" | "fixed" | "unit";
export type RegimenLabCategory = "renal" | "hepatic" | "blood" | "other";

export interface Regimen {
  id: number;
  regimen_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  department_code: string | null;
  department_name: string | null;
  purpose: RegimenPurpose | null;
  setting: RegimenSetting | null;
  /** 投与期間(日)。1 クール = 投与期間 + 休薬期間。 */
  treatment_days: number | null;
  rest_days: number | null;
  /** 予定クール数。null は継続。 */
  planned_cycles: number | null;
  emetic_risk: RegimenEmeticRisk | null;
  status: RegimenStatus;
  approved_on: string | null;
  approved_by: string | null;
  indication_note: string | null;
  discontinuation_criteria: string | null;
  dose_reduction_criteria: string | null;
  references_note: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
  /** 投与期間 + 休薬期間。API が導出して添える。 */
  cycle_days: number;
  /** 複製元のレジメンコード。改訂の系列を辿る(承認済は凍結し、直すときは複製する)。 */
  copied_from_code: string | null;
  updated_at: string;
}

export interface RegimenIndication {
  id: number;
  display_order: number | null;
  /** 病名マスタの管理番号。 */
  management_number: string;
  name: string;
  icd10: string | null;
}

export interface RegimenDrug {
  id: number;
  step_id: number;
  display_order: number | null;
  drug_role: RegimenDrugRole;
  medicine_code: string;
  dose_basis: RegimenDoseBasis;
  // decimal は JSON では文字列で返る。
  dose_value: string | null;
  dose_unit: string | null;
  dose_max: string | null;
  note: string | null;
  // 以下は詳細 API が薬剤マスタから JOIN で付与する(未取込なら null)。
  resolved_name: string | null;
  resolved_unit_name: string | null;
  dosage_form: string | null;
  yj_code: string | null;
  /** 薬価基準からの削除日・経過措置日。入っていれば使い続けられない薬剤。 */
  abolished_on: string | null;
  transitional_measure_on: string | null;
}

export interface RegimenStep {
  id: number;
  display_order: number | null;
  name: string | null;
  /** 相対日(1 始まり)。 */
  days: number[];
  usage_type: RegimenStepUsageType;
  route_code: string | null;
  method_code: string | null;
  line_code: string | null;
  infusion_minutes: number | null;
  rate: string | null;
  device_note: string | null;
  usage_code: string | null;
  /** 内服の用法。詳細 API が用法マスタから付与する(未取込なら null)。 */
  usage?: MedicineUsage | null;
  dose_days: number | null;
  note: string | null;
  drugs: RegimenDrug[];
}

export interface RegimenLabCriterion {
  id: number;
  display_order: number | null;
  category: RegimenLabCategory;
  /** JLAC11 分析物コード(5 桁)。計算値(CCr など)は null。 */
  analyte_code: string | null;
  item_name: string;
  unit: string | null;
  lower_limit: string | null;
  upper_limit: string | null;
  note: string | null;
}

export interface RegimenAdverseEvent {
  id: number;
  display_order: number | null;
  term: string;
  grade: number | null;
  note: string | null;
}

export interface RegimenDetail extends Regimen {
  indications: RegimenIndication[];
  steps: RegimenStep[];
  lab_criteria: RegimenLabCriterion[];
  adverse_events: RegimenAdverseEvent[];
}

export interface RegimenIndicationPayload {
  management_number: string;
  name: string;
  icd10?: string | null;
}

export interface RegimenDrugPayload {
  drug_role: RegimenDrugRole;
  medicine_code: string;
  dose_basis: RegimenDoseBasis;
  dose_value?: number | null;
  dose_unit?: string | null;
  dose_max?: number | null;
  note?: string | null;
}

export interface RegimenStepPayload {
  name?: string | null;
  days: number[];
  usage_type: RegimenStepUsageType;
  route_code?: string | null;
  method_code?: string | null;
  line_code?: string | null;
  infusion_minutes?: number | null;
  rate?: number | null;
  device_note?: string | null;
  usage_code?: string | null;
  dose_days?: number | null;
  note?: string | null;
  drugs: RegimenDrugPayload[];
}

export interface RegimenLabCriterionPayload {
  category: RegimenLabCategory;
  analyte_code?: string | null;
  item_name: string;
  unit?: string | null;
  lower_limit?: number | null;
  upper_limit?: number | null;
  note?: string | null;
}

export interface RegimenAdverseEventPayload {
  term: string;
  grade?: number | null;
  note?: string | null;
}

/** 子の配列は送った種別だけ丸ごと置換される(配列の順が表示順)。 */
export interface RegimenPayload {
  regimen_code?: string;
  /** 凍結中(承認済・廃止)の更新では運用の項目だけを送るので任意。 */
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  purpose?: RegimenPurpose | null;
  setting?: RegimenSetting | null;
  treatment_days?: number | null;
  rest_days?: number | null;
  planned_cycles?: number | null;
  emetic_risk?: RegimenEmeticRisk | null;
  status?: RegimenStatus;
  approved_on?: string | null;
  approved_by?: string | null;
  indication_note?: string | null;
  discontinuation_criteria?: string | null;
  dose_reduction_criteria?: string | null;
  references_note?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
  indications?: RegimenIndicationPayload[];
  steps?: RegimenStepPayload[];
  lab_criteria?: RegimenLabCriterionPayload[];
  adverse_events?: RegimenAdverseEventPayload[];
}

export interface RegimenSearchParams {
  name?: string;
  department_code?: string;
  status?: RegimenStatus | "";
  purpose?: RegimenPurpose | "";
  active?: boolean;
  /** この薬剤を含むレジメン(カンマ区切りで複数可)。 */
  medicine_code?: string;
  page?: number;
  per?: number;
}

const REGIMENS_PATH = "/master/regimens";

export async function searchRegimens(params: RegimenSearchParams): Promise<MasterSearchResult<Regimen>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.department_code) search.set("department_code", params.department_code);
  if (params.status) search.set("status", params.status);
  if (params.purpose) search.set("purpose", params.purpose);
  if (params.active) search.set("active", "true");
  if (params.medicine_code) search.set("medicine_code", params.medicine_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));
  const res = await masterFetch(`${REGIMENS_PATH}?${search}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Regimen>;
}

/** id でもレジメンコードでも引ける。 */
export async function fetchRegimen(idOrCode: number | string): Promise<RegimenDetail> {
  const res = await masterFetch(`${REGIMENS_PATH}/${idOrCode}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RegimenDetail;
}

export async function createRegimen(payload: RegimenPayload): Promise<RegimenDetail> {
  const res = await masterFetch(REGIMENS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RegimenDetail;
}

export async function updateRegimen(id: number, payload: RegimenPayload): Promise<RegimenDetail> {
  const res = await masterFetch(`${REGIMENS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RegimenDetail;
}

/** 複製。新しいコードで全部写し、承認は引き継がず下書きになる。 */
export async function copyRegimen(id: number, name?: string): Promise<RegimenDetail> {
  const res = await masterFetch(`${REGIMENS_PATH}/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as RegimenDetail;
}

export async function deleteRegimen(id: number): Promise<void> {
  const res = await masterFetch(`${REGIMENS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
