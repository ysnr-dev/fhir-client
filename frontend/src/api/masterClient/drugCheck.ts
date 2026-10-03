import { buildError, masterFetch } from "./core";

// 薬剤チェックの施設マスタ(相互作用・用量と患者条件)。docs/drug-check-master-design.md
// 薬は YJ コードの先頭 4〜7 桁で指す(7 桁 = 成分、4 桁 = 薬効分類)。

export type DrugCheckSeverity = "contraindicated" | "caution";

export interface DrugInteraction {
  id: number;
  code_a: string;
  name_a: string;
  code_b: string;
  name_b: string;
  severity: DrugCheckSeverity;
  // 機序・症状・対処。
  note: string | null;
}

export type DrugInteractionPayload = Omit<DrugInteraction, "id">;

export interface DrugDoseRule {
  id: number;
  code: string;
  name: string;
  // 剤形区分(1:内用 4:注射 6:外用)。null ならすべての剤形。
  dosage_form: string | null;
  // 年齢 age_from 歳以上 age_to 歳未満。
  age_from: number | null;
  age_to: number | null;
  // 腎機能 renal_index が renal_below 未満。decimal は JSON では文字列で返る。
  renal_index: "egfr" | "ccr" | null;
  renal_below: string | null;
  max_single_dose: string | null;
  max_daily_dose: string | null;
  dose_unit: string | null;
  // 上限が体重 1 kg あたり。
  per_kg: boolean;
  severity: DrugCheckSeverity;
  message: string | null;
}

export type DrugDoseRulePayload = Omit<
  DrugDoseRule,
  "id" | "renal_below" | "max_single_dose" | "max_daily_dose"
> & {
  renal_below: number | null;
  max_single_dose: number | null;
  max_daily_dose: number | null;
};

const INTERACTIONS_PATH = "/master/drug_interactions";
const DOSE_RULES_PATH = "/master/drug_dose_rules";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function fetchAll<T>(path: string, q?: string): Promise<T[]> {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  const res = await masterFetch(`${path}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T[];
}

async function save<T>(path: string, id: number | undefined, payload: unknown): Promise<T> {
  const res = await masterFetch(id ? `${path}/${id}` : path, {
    method: id ? "PATCH" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

async function remove(path: string, id: number): Promise<void> {
  const res = await masterFetch(`${path}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export const fetchDrugInteractions = (q?: string) => fetchAll<DrugInteraction>(INTERACTIONS_PATH, q);
export const saveDrugInteraction = (id: number | undefined, payload: DrugInteractionPayload) =>
  save<DrugInteraction>(INTERACTIONS_PATH, id, payload);
export const deleteDrugInteraction = (id: number) => remove(INTERACTIONS_PATH, id);

export const fetchDrugDoseRules = (q?: string) => fetchAll<DrugDoseRule>(DOSE_RULES_PATH, q);
export const saveDrugDoseRule = (id: number | undefined, payload: DrugDoseRulePayload) =>
  save<DrugDoseRule>(DOSE_RULES_PATH, id, payload);
export const deleteDrugDoseRule = (id: number) => remove(DOSE_RULES_PATH, id);
