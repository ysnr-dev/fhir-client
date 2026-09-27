import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 輸血製剤マスタ ----
//
// 食事(MealItem)と同じ単純編集型。配布形式の標準マスタが無いので取込は持たず、
// 画面から手で登録する(docs/transfusion-order-design.md §3)。

export interface TransfusionProduct {
  id: number;
  item_code: string;
  name: string;
  name_kana: string | null;
  /** RBC-LR など。一覧・カードの狭い場所で使う略称。 */
  abbreviation: string | null;
  /** rbc=赤血球 / ffp=血漿 / plt=血小板 / auto=自己血 / other=その他。 */
  category: string;
  /** 単位の呼び方。既定は「単位」で、自己血は「mL」もある。 */
  unit_label: string;
  /** オーダー画面の単位数の初期値。 */
  default_units: number | null;
  /** 交差適合試験が要る製剤か。オーダー画面の検査区分の初期選択に使う。 */
  requires_crossmatch: boolean;
  /** 医事会計へ送るレセプト電算の医薬品コード。自己血のように薬価収載が無いものは空。 */
  medicine_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

export interface TransfusionProductPayload {
  item_code?: string;
  name?: string;
  name_kana?: string | null;
  abbreviation?: string | null;
  category?: string;
  unit_label?: string;
  default_units?: number | null;
  requires_crossmatch?: boolean;
  medicine_code?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const TRANSFUSION_PRODUCTS_PATH = "/master/transfusion_products";

export async function searchTransfusionProducts(params: {
  name?: string;
  /** 製剤コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  /** 製剤区分。未指定なら全区分。 */
  category?: string;
  /** true なら今日オーダーできる製剤(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<TransfusionProduct>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.category) search.set("category", params.category);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${TRANSFUSION_PRODUCTS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<TransfusionProduct>;
}

// 製剤コードでも id でも引ける。
export async function fetchTransfusionProduct(
  idOrCode: string | number,
): Promise<TransfusionProduct> {
  const res = await masterFetch(
    `${TRANSFUSION_PRODUCTS_PATH}/${encodeURIComponent(String(idOrCode))}`,
  );
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TransfusionProduct;
}

export async function createTransfusionProduct(
  payload: TransfusionProductPayload,
): Promise<TransfusionProduct> {
  const res = await masterFetch(TRANSFUSION_PRODUCTS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TransfusionProduct;
}

export async function updateTransfusionProduct(
  id: number,
  payload: TransfusionProductPayload,
): Promise<TransfusionProduct> {
  const res = await masterFetch(`${TRANSFUSION_PRODUCTS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as TransfusionProduct;
}

export async function deleteTransfusionProduct(id: number): Promise<void> {
  const res = await masterFetch(`${TRANSFUSION_PRODUCTS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
