import { buildError, masterFetch } from "./core";

// ---- オーダーセット(よく出すオーダーのひとまとめ) ----

// フォルダとセットを parent_id の隣接リストで積む(シェーマカテゴリと同じ形)。
// 持ち主(scope / owner_id)は 3 段階で、ツリーは持ち主ごとに独立している。
// 設計は docs/order-set-design.md。
export type OrderSetScope = "facility" | "department" | "practitioner";
export type OrderSetKind = "folder" | "set";

export interface OrderSet {
  id: number;
  /** uuid。登録したオーダーに焼く印と、環境間の移送に使う。 */
  code: string;
  kind: OrderSetKind;
  parent_id: number | null;
  scope: OrderSetScope;
  /** 診療科 Organization.id / Practitioner.id。院内共通は null。 */
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  active: boolean;
  /** セットのエントリ数。フォルダは null。 */
  entry_count: number | null;
  updated_at: string;
}

export interface OrderSetEntry {
  id: number;
  display_order: number | null;
  /** "prescription" / "lab-order" など(fhir/orderSetHelpers.ts の OrderSetOrderType)。 */
  order_type: string;
  label: string | null;
  /** そのオーダー種別のフォーム値(患者への参照は保存前に落としてある)。 */
  values: unknown;
  schema_version: number;
}

export interface OrderSetDetail extends OrderSet {
  entries: OrderSetEntry[];
}

export interface OrderSetPayload {
  kind?: OrderSetKind;
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  parent_id?: number | null;
  name?: string;
  display_order?: number | null;
  active?: boolean;
  entries?: OrderSetEntryPayload[];
}

export interface OrderSetEntryPayload {
  order_type: string;
  label?: string;
  values: unknown;
  schema_version: number;
}

export interface OrderSetCopyPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  parent_id?: number | null;
  name?: string;
}

const ORDER_SETS_PATH = "/master/order_sets";

/** 院内共通 + 指定した診療科 + 指定した医師のノードをフラットに全件。 */
export async function fetchOrderSets(params: {
  department_id?: string;
  practitioner_id?: string;
}): Promise<{ total: number; items: OrderSet[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${ORDER_SETS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: OrderSet[] };
}

export async function fetchOrderSet(id: number): Promise<OrderSetDetail> {
  const res = await masterFetch(`${ORDER_SETS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as OrderSetDetail;
}

export async function createOrderSet(payload: OrderSetPayload): Promise<OrderSetDetail> {
  const res = await masterFetch(ORDER_SETS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as OrderSetDetail;
}

export async function updateOrderSet(id: number, payload: OrderSetPayload): Promise<OrderSetDetail> {
  const res = await masterFetch(`${ORDER_SETS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as OrderSetDetail;
}

/** エントリの全置換(配列の順が表示順になる)。 */
export async function replaceOrderSetEntries(
  id: number,
  entries: OrderSetEntryPayload[],
): Promise<OrderSetDetail> {
  const res = await masterFetch(`${ORDER_SETS_PATH}/${id}/entries`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as OrderSetDetail;
}

/** 複製。別の持ち主・フォルダへの昇格(個人 → 診療科 → 院内共通)にも使う。 */
export async function copyOrderSet(id: number, payload: OrderSetCopyPayload): Promise<OrderSetDetail> {
  const res = await masterFetch(`${ORDER_SETS_PATH}/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as OrderSetDetail;
}

export async function deleteOrderSet(id: number): Promise<void> {
  const res = await masterFetch(`${ORDER_SETS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
