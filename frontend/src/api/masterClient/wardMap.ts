import type { WardMapLayout } from "../../fhir/wardMapHelpers";
import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 病棟マップ ----

// 病棟ごとのレイアウト(設備・病室・ベッドの配置)。1 病棟 1 行で、レイアウト全体を
// jsonb に持つ。形は fhir/wardMapHelpers.ts の WardMapLayout(backend の layout_shape と同じ)。
export interface WardMap {
  id: number;
  /** 病棟(FHIR Location physicalType=wa)の id。 */
  ward_location_id: string;
  /** 表示用の写し。 */
  ward_name: string | null;
  layout: WardMapLayout;
  note: string | null;
  updated_at: string;
}

export interface WardMapPayload {
  ward_location_id?: string;
  ward_name?: string | null;
  layout?: WardMapLayout;
  note?: string | null;
}

const WARD_MAPS_PATH = "/master/ward_maps";

export async function searchWardMaps(params: {
  /** 病棟。カンマ区切りで複数指定できる。 */
  ward_location_id?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<WardMap>> {
  const search = new URLSearchParams();
  if (params.ward_location_id) search.set("ward_location_id", params.ward_location_id);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${WARD_MAPS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<WardMap>;
}

export async function createWardMap(payload: WardMapPayload): Promise<WardMap> {
  const res = await masterFetch(WARD_MAPS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as WardMap;
}

export async function updateWardMap(id: number, payload: WardMapPayload): Promise<WardMap> {
  const res = await masterFetch(`${WARD_MAPS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as WardMap;
}

export async function deleteWardMap(id: number): Promise<void> {
  const res = await masterFetch(`${WARD_MAPS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
