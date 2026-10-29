import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 指導・管理料の項目マスタ ----
//
// 医学管理料(点数表 B 章)・在宅(C 章)のうち施設が算定するものを登録する
// (docs/medical-management-order-design.md §2)。名称・点数の正は医科診療行為マスタで、
// 一覧 API がそちらの値を添える。

export interface ManagementFeeAddition {
  code: string;
  /** 診療行為マスタの名称。未取込のコードは null。 */
  name: string | null;
  points: string | null;
}

export interface ManagementFeeItem {
  id: number;
  item_code: string;
  name: string;
  name_kana: string | null;
  /** レセ電算 診療行為コード(9 桁)。 */
  receipt_code: string;
  addition_codes: string[];
  inpatient: boolean;
  outpatient: boolean;
  /** 1 か月の算定回数の上限。null は見張らない。 */
  monthly_limit: number | null;
  active: boolean;
  display_order: number | null;
  note: string | null;
  receipt_procedure_name?: string | null;
  receipt_points?: string | null;
  receipt_max_times?: string | null;
  /** addition_codes を名称・点数つきに展開したもの。一覧・詳細 API が添える。 */
  additions?: ManagementFeeAddition[];
}

export interface ManagementFeeItemPayload {
  name?: string;
  name_kana?: string | null;
  receipt_code?: string;
  addition_codes?: string[];
  inpatient?: boolean;
  outpatient?: boolean;
  monthly_limit?: number | null;
  active?: boolean;
  display_order?: number | null;
  note?: string | null;
}

const MANAGEMENT_FEE_ITEMS_PATH = "/master/management_fee_items";

export async function searchManagementFeeItems(params: {
  name?: string;
  active?: boolean;
  /** 入外区分で算定できる項目だけに絞る。 */
  setting?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<ManagementFeeItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.active) search.set("active", "true");
  if (params.setting) search.set("setting", params.setting);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MANAGEMENT_FEE_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<ManagementFeeItem>;
}

export async function createManagementFeeItem(payload: ManagementFeeItemPayload): Promise<ManagementFeeItem> {
  const res = await masterFetch(MANAGEMENT_FEE_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ManagementFeeItem;
}

export async function updateManagementFeeItem(
  id: number,
  payload: ManagementFeeItemPayload,
): Promise<ManagementFeeItem> {
  const res = await masterFetch(`${MANAGEMENT_FEE_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ManagementFeeItem;
}

export async function deleteManagementFeeItem(id: number): Promise<void> {
  const res = await masterFetch(`${MANAGEMENT_FEE_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
