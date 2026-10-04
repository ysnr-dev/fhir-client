import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- インスリンのスライディングスケールのセット ----
// 注射オーダーのスケールの入力で選ぶと、行がそのまま写る(fhir/insulinScaleHelpers の insulinScaleFromSet)。

/** glucose = 血糖(mg/dL) / meal = 主食の摂取量(%) / free = フリースケール。 */
export type InsulinScaleSetKind = "glucose" | "meal" | "free";

/** 行。値は文字列のまま持つ(画面の入力欄と同じ)。 */
export interface InsulinScaleSetRow {
  low?: string;
  high?: string;
  condition?: string;
  dose?: string;
  note?: string;
}

export interface InsulinScaleSet {
  id: number;
  name: string;
  kind: InsulinScaleSetKind;
  /** 空の項目は返らない(キーごと無い)。 */
  rows: InsulinScaleSetRow[];
  display_order: number | null;
}

export interface InsulinScaleSetPayload {
  name?: string;
  kind?: InsulinScaleSetKind;
  rows?: InsulinScaleSetRow[];
  display_order?: number | null;
}

const INSULIN_SCALE_SETS_PATH = "/master/insulin_scale_sets";

export async function fetchInsulinScaleSets(): Promise<MasterSearchResult<InsulinScaleSet>> {
  const res = await masterFetch(`${INSULIN_SCALE_SETS_PATH}?per=500`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<InsulinScaleSet>;
}

export async function createInsulinScaleSet(payload: InsulinScaleSetPayload): Promise<InsulinScaleSet> {
  const res = await masterFetch(INSULIN_SCALE_SETS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as InsulinScaleSet;
}

export async function updateInsulinScaleSet(
  id: number,
  payload: InsulinScaleSetPayload,
): Promise<InsulinScaleSet> {
  const res = await masterFetch(`${INSULIN_SCALE_SETS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as InsulinScaleSet;
}

export async function deleteInsulinScaleSet(id: number): Promise<void> {
  const res = await masterFetch(`${INSULIN_SCALE_SETS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
