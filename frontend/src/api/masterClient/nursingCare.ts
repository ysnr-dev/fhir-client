import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 看護計画の用語(看護診断・看護成果・看護介入)と標準看護計画 ----
// NANDA-I / NOC / NIC と同じ「領域 → 類 → 用語」の 3 階層(docs/nursing-care-plan-design.md)。

export type NursingTaxonomy = "diagnosis" | "outcome" | "intervention";
export type NursingTermLevel = "domain" | "class" | "term";
export type NursingDiagnosisType = "problem" | "risk" | "health_promotion";
export type NursingTermItemType =
  | "defining_characteristic"
  | "related_factor"
  | "risk_factor"
  | "indicator"
  | "activity";

export interface NursingTermItem {
  item_type: NursingTermItemType;
  code: string;
  name: string;
}

export interface NursingTerm {
  id: number;
  taxonomy: NursingTaxonomy;
  level: NursingTermLevel;
  code: string;
  parent_code: string | null;
  name: string;
  name_kana: string | null;
  diagnosis_type: NursingDiagnosisType | null;
  definition: string | null;
  guidance: string | null;
  items: NursingTermItem[];
  source: "local" | "licensed";
  active: boolean;
  display_order: number | null;
}

export type NursingTermPayload = Partial<Omit<NursingTerm, "id">>;

export interface NursingTermSearchParams {
  taxonomy?: NursingTaxonomy;
  level?: NursingTermLevel;
  parentCode?: string;
  q?: string;
  codes?: string[];
  active?: boolean;
}

const NURSING_TERMS_PATH = "/master/nursing_terms";

export async function fetchNursingTerms(
  params: NursingTermSearchParams,
  page = 1,
): Promise<MasterSearchResult<NursingTerm>> {
  const search = new URLSearchParams({ per: "500", page: String(page) });
  if (params.taxonomy) search.set("taxonomy", params.taxonomy);
  if (params.level) search.set("level", params.level);
  if (params.parentCode) search.set("parent_code", params.parentCode);
  if (params.q) search.set("q", params.q);
  if (params.codes?.length) search.set("code", params.codes.join(","));
  if (params.active !== undefined) search.set("active", String(params.active));
  const res = await masterFetch(`${NURSING_TERMS_PATH}?${search}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingTerm>;
}

/** 条件に合う用語をページを辿って全件読む(NANDA-I・NIC・NOC を取り込むと 1 ページの上限 500 を超える)。 */
export async function fetchAllNursingTerms(params: NursingTermSearchParams): Promise<NursingTerm[]> {
  const items: NursingTerm[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchNursingTerms(params, page);
    items.push(...result.items);
    if (result.items.length === 0 || page * result.per >= result.total) return items;
  }
}

export async function createNursingTerm(payload: NursingTermPayload): Promise<NursingTerm> {
  const res = await masterFetch(NURSING_TERMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as NursingTerm;
}

export async function updateNursingTerm(id: number, payload: NursingTermPayload): Promise<NursingTerm> {
  const res = await masterFetch(`${NURSING_TERMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as NursingTerm;
}

export async function deleteNursingTerm(id: number): Promise<void> {
  const res = await masterFetch(`${NURSING_TERMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export type NursingPlanActivityType = "op" | "tp" | "ep";

export interface NursingStandardPlanGoal {
  text: string;
  outcome_code: string;
}

export interface NursingStandardPlanActivity {
  activity_type: NursingPlanActivityType;
  text: string;
  intervention_code?: string;
  /** MEDIS 看護実践用語標準マスターの看護行為・看護観察。紐付けない行は空。 */
  item_kind?: "act" | "observation" | "";
  code16?: string;
  manage_no?: string;
  item_name?: string;
}

export interface NursingStandardPlan {
  id: number;
  code: string;
  name: string;
  name_kana: string | null;
  diagnosis_code: string | null;
  goals: NursingStandardPlanGoal[];
  activities: NursingStandardPlanActivity[];
  note: string | null;
  active: boolean;
  display_order: number | null;
}

export type NursingStandardPlanPayload = Partial<Omit<NursingStandardPlan, "id">>;

const NURSING_STANDARD_PLANS_PATH = "/master/nursing_standard_plans";

export async function fetchNursingStandardPlans(params: {
  diagnosisCodes?: string[];
  /** 看護診断に結びつかない計画だけ。 */
  withoutDiagnosis?: boolean;
  q?: string;
  active?: boolean;
}): Promise<MasterSearchResult<NursingStandardPlan>> {
  const search = new URLSearchParams({ per: "500" });
  if (params.withoutDiagnosis) search.set("diagnosis_code", "none");
  else if (params.diagnosisCodes?.length) search.set("diagnosis_code", params.diagnosisCodes.join(","));
  if (params.q) search.set("q", params.q);
  if (params.active !== undefined) search.set("active", String(params.active));
  const res = await masterFetch(`${NURSING_STANDARD_PLANS_PATH}?${search}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingStandardPlan>;
}

export async function createNursingStandardPlan(
  payload: NursingStandardPlanPayload,
): Promise<NursingStandardPlan> {
  const res = await masterFetch(NURSING_STANDARD_PLANS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as NursingStandardPlan;
}

export async function updateNursingStandardPlan(
  id: number,
  payload: NursingStandardPlanPayload,
): Promise<NursingStandardPlan> {
  const res = await masterFetch(`${NURSING_STANDARD_PLANS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as NursingStandardPlan;
}

export async function deleteNursingStandardPlan(id: number): Promise<void> {
  const res = await masterFetch(`${NURSING_STANDARD_PLANS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
