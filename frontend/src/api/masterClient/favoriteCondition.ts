import type { FavoriteConditionBody } from "../../fhir/conditionHelpers";
import { buildError, masterFetch } from "./core";
import type { OrderSetScope } from "./orderSet";

// ---- 頻用病名(病名+修飾語の組み合わせを持ち主ごとに持つ。docs/features/patient-profile.md「頻用病名」) ----

export interface FavoriteCondition {
  id: number;
  /** uuid。複製と環境間の移送に使う。 */
  code: string;
  /** 院内共通 / 診療科 / 医師(チームは持たない)。 */
  scope: OrderSetScope;
  owner_id: string | null;
  owner_name: string | null;
  /** 接頭語+病名+接尾語を連結した表示名(同じ持ち主の中で一意)。 */
  name: string;
  display_order: number | null;
  active: boolean;
  /** 形は fhir/conditionHelpers.ts の FavoriteConditionBody。 */
  definition: FavoriteConditionBody;
  updated_at: string;
}

export interface FavoriteConditionPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  name?: string;
  display_order?: number | null;
  active?: boolean;
  definition?: FavoriteConditionBody;
}

const PATH = "/master/favorite_conditions";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** 院内共通 + 指定した診療科 + 指定した医師の頻用病名を全件(definition 込み)。 */
export async function fetchFavoriteConditions(params: {
  department_id?: string;
  practitioner_id?: string;
}): Promise<{ total: number; items: FavoriteCondition[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: FavoriteCondition[] };
}

export async function createFavoriteCondition(payload: FavoriteConditionPayload): Promise<FavoriteCondition> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FavoriteCondition;
}

export async function updateFavoriteCondition(id: number, payload: FavoriteConditionPayload): Promise<FavoriteCondition> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FavoriteCondition;
}

export async function deleteFavoriteCondition(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
