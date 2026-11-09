import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 血液浄化器の施設マスタ(/master/blood_purifiers)。

export interface BloodPurifier {
  id: number;
  /** 施設内のコード。 */
  purifier_code: string;
  /** 種別(BLOOD_PURIFIER_KIND_OPTIONS)。 */
  kind: string;
  name: string;
  name_kana: string | null;
  maker: string | null;
  model_number: string | null;
  membrane_material: string | null;
  /** 膜面積(㎡)。decimal なので文字列で返る。 */
  membrane_area: string | null;
  /** 算定に使うレセプト電算の特定器材コード。未紐付けなら空。 */
  receipt_material_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
  /** 紐付け先の名称・価格。一覧・詳細 API が添えて返す(未紐付け・未取込なら null)。 */
  receipt_material_name: string | null;
  receipt_material_price: string | null;
}

export interface BloodPurifierPayload {
  kind?: string;
  name?: string;
  name_kana?: string | null;
  maker?: string | null;
  model_number?: string | null;
  membrane_material?: string | null;
  membrane_area?: string | null;
  receipt_material_code?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const BLOOD_PURIFIERS_PATH = "/master/blood_purifiers";

export async function searchBloodPurifiers(params: {
  name?: string;
  maker?: string;
  kind?: string;
  /** true なら紐付けのないものだけ(算定できない製品の点検用)。 */
  unlinked?: boolean;
  /** true なら今日採用している製品(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<BloodPurifier>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.maker) search.set("maker", params.maker);
  if (params.kind) search.set("kind", params.kind);
  if (params.unlinked) search.set("unlinked", "true");
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${BLOOD_PURIFIERS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<BloodPurifier>;
}

export async function fetchBloodPurifier(id: number): Promise<BloodPurifier> {
  const res = await masterFetch(`${BLOOD_PURIFIERS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as BloodPurifier;
}

export async function createBloodPurifier(payload: BloodPurifierPayload): Promise<BloodPurifier> {
  const res = await masterFetch(BLOOD_PURIFIERS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as BloodPurifier;
}

export async function updateBloodPurifier(id: number, payload: BloodPurifierPayload): Promise<BloodPurifier> {
  const res = await masterFetch(`${BLOOD_PURIFIERS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as BloodPurifier;
}

export async function deleteBloodPurifier(id: number): Promise<void> {
  const res = await masterFetch(`${BLOOD_PURIFIERS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
