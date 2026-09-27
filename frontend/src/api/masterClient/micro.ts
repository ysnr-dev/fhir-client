import { buildError, masterFetch, type MasterSearchResult } from "./core";
import type { Medicine } from "./medicine";

// ---- 細菌検査(微生物検査)オーダーのマスタ ----

// JANIS 感染症病原体コード。標準コード(official)は取込で洗い替えるため、
// 画面から書けるのは施設追加分(local)と頻用菌の印(frequent)だけ。
export interface MicroOrganism {
  id: number;
  code: string;
  name: string;
  /** オーダー画面に直接並べる頻用菌の印。取込では消えない。 */
  frequent: boolean;
  source: "official" | "local";
  display_order: number | null;
}

export interface MicroOrganismPayload {
  code?: string;
  name?: string;
  frequent?: boolean;
  display_order?: number | null;
}

// JANIS 材料(検査材料)コード。標準コードは読むだけ、施設追加分のみ編集できる。
export interface MicroSpecimenType {
  id: number;
  code: string;
  name: string;
  /** 系統(口腔・気道・呼吸器 / 泌尿器・生殖器 など)。 */
  category: string | null;
  source: "official" | "local";
  display_order: number | null;
}

export interface MicroSpecimenTypePayload {
  code?: string;
  name?: string;
  category?: string | null;
  display_order?: number | null;
}

// 検査項目(塗抹・鏡検 / 培養・同定 など)。施設マスタ。
export interface MicroOrderItem {
  id: number;
  item_code: string;
  name: string;
  short_name: string | null;
  display_order: number | null;
  valid_from: string | null;
  valid_to: string | null;
  receipt_code: string | null;
  note: string | null;
}

export interface MicroOrderItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  display_order?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  receipt_code?: string | null;
  note?: string | null;
}

// 採取部位。laterality_applicable が true の部位だけ左右を入力できる。
export interface MicroCollectionSite {
  id: number;
  code: string;
  name: string;
  laterality_applicable: boolean;
  display_order: number | null;
}

export interface MicroCollectionSitePayload {
  code?: string;
  name?: string;
  laterality_applicable?: boolean;
  display_order?: number | null;
}

// 採取方法(スワブ / 穿刺 など)。
export interface MicroCollectionMethod {
  id: number;
  code: string;
  name: string;
  display_order: number | null;
}

export interface MicroCollectionMethodPayload {
  code?: string;
  name?: string;
  display_order?: number | null;
}

const MICRO_ORGANISMS_PATH = "/master/micro_organisms";

export async function searchMicroOrganisms(params: {
  name?: string;
  frequent?: boolean;
  source?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MicroOrganism>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.frequent) search.set("frequent", "true");
  if (params.source) search.set("source", params.source);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MICRO_ORGANISMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroOrganism>;
}

export async function createMicroOrganism(payload: MicroOrganismPayload): Promise<MicroOrganism> {
  const res = await masterFetch(MICRO_ORGANISMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroOrganism;
}

export async function updateMicroOrganism(
  id: number,
  payload: MicroOrganismPayload,
): Promise<MicroOrganism> {
  const res = await masterFetch(`${MICRO_ORGANISMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroOrganism;
}

export async function deleteMicroOrganism(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_ORGANISMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const MICRO_SPECIMEN_TYPES_PATH = "/master/micro_specimen_types";

export async function searchMicroSpecimenTypes(params: {
  name?: string;
  category?: string;
  source?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MicroSpecimenType>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category) search.set("category", params.category);
  if (params.source) search.set("source", params.source);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MICRO_SPECIMEN_TYPES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroSpecimenType>;
}

export async function createMicroSpecimenType(
  payload: MicroSpecimenTypePayload,
): Promise<MicroSpecimenType> {
  const res = await masterFetch(MICRO_SPECIMEN_TYPES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroSpecimenType;
}

export async function updateMicroSpecimenType(
  id: number,
  payload: MicroSpecimenTypePayload,
): Promise<MicroSpecimenType> {
  const res = await masterFetch(`${MICRO_SPECIMEN_TYPES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroSpecimenType;
}

export async function deleteMicroSpecimenType(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_SPECIMEN_TYPES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const MICRO_ORDER_ITEMS_PATH = "/master/micro_order_items";

export async function fetchMicroOrderItems(): Promise<MasterSearchResult<MicroOrderItem>> {
  const res = await masterFetch(`${MICRO_ORDER_ITEMS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroOrderItem>;
}

export async function createMicroOrderItem(payload: MicroOrderItemPayload): Promise<MicroOrderItem> {
  const res = await masterFetch(MICRO_ORDER_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroOrderItem;
}

export async function updateMicroOrderItem(
  id: number,
  payload: MicroOrderItemPayload,
): Promise<MicroOrderItem> {
  const res = await masterFetch(`${MICRO_ORDER_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroOrderItem;
}

export async function deleteMicroOrderItem(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_ORDER_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const MICRO_COLLECTION_SITES_PATH = "/master/micro_collection_sites";

export async function fetchMicroCollectionSites(): Promise<MasterSearchResult<MicroCollectionSite>> {
  const res = await masterFetch(`${MICRO_COLLECTION_SITES_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroCollectionSite>;
}

export async function createMicroCollectionSite(
  payload: MicroCollectionSitePayload,
): Promise<MicroCollectionSite> {
  const res = await masterFetch(MICRO_COLLECTION_SITES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroCollectionSite;
}

export async function updateMicroCollectionSite(
  id: number,
  payload: MicroCollectionSitePayload,
): Promise<MicroCollectionSite> {
  const res = await masterFetch(`${MICRO_COLLECTION_SITES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroCollectionSite;
}

export async function deleteMicroCollectionSite(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_COLLECTION_SITES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const MICRO_COLLECTION_METHODS_PATH = "/master/micro_collection_methods";

export async function fetchMicroCollectionMethods(): Promise<
  MasterSearchResult<MicroCollectionMethod>
> {
  const res = await masterFetch(`${MICRO_COLLECTION_METHODS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroCollectionMethod>;
}

export async function createMicroCollectionMethod(
  payload: MicroCollectionMethodPayload,
): Promise<MicroCollectionMethod> {
  const res = await masterFetch(MICRO_COLLECTION_METHODS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroCollectionMethod;
}

export async function updateMicroCollectionMethod(
  id: number,
  payload: MicroCollectionMethodPayload,
): Promise<MicroCollectionMethod> {
  const res = await masterFetch(`${MICRO_COLLECTION_METHODS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroCollectionMethod;
}

export async function deleteMicroCollectionMethod(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_COLLECTION_METHODS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// ---- 細菌検査結果のマスタ ----

// JANIS 抗菌薬コード。標準コード(official)は取込で洗い替えるため、
// 画面から書けるのは施設追加分(local)と頻用薬の印(frequent)だけ。
export interface MicroAntimicrobial {
  id: number;
  code: string;
  name: string;
  /** 略号(ABPC など)。 */
  abbreviation: string | null;
  /** 商品名(参考情報)。 */
  brand_name: string | null;
  /** 系統(ペニシリン系 など)。コード表の見出し行由来。 */
  category: string | null;
  /** 結果画面に直接並べる頻用薬の印。取込では消えない。 */
  frequent: boolean;
  source: "official" | "local";
  display_order: number | null;
}

export interface MicroAntimicrobialPayload {
  code?: string;
  name?: string;
  abbreviation?: string | null;
  brand_name?: string | null;
  category?: string | null;
  frequent?: boolean;
  display_order?: number | null;
}

// JANIS 薬剤感受性検査測定法コード。標準コードは読むだけ、施設追加分のみ編集できる。
export interface MicroSusceptibilityMethod {
  id: number;
  code: string;
  name: string;
  /** 自動化機器 | 用手法。空欄もある。 */
  classification: string | null;
  product_name: string | null;
  company: string | null;
  note: string | null;
  source: "official" | "local";
  display_order: number | null;
}

export interface MicroSusceptibilityMethodPayload {
  code?: string;
  name?: string;
  classification?: string | null;
  product_name?: string | null;
  company?: string | null;
  note?: string | null;
  display_order?: number | null;
}

const MICRO_ANTIMICROBIALS_PATH = "/master/micro_antimicrobials";

export async function searchMicroAntimicrobials(params: {
  name?: string;
  frequent?: boolean;
  source?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MicroAntimicrobial>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.frequent) search.set("frequent", "true");
  if (params.source) search.set("source", params.source);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MICRO_ANTIMICROBIALS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroAntimicrobial>;
}

export async function createMicroAntimicrobial(
  payload: MicroAntimicrobialPayload,
): Promise<MicroAntimicrobial> {
  const res = await masterFetch(MICRO_ANTIMICROBIALS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroAntimicrobial;
}

export async function updateMicroAntimicrobial(
  id: number,
  payload: MicroAntimicrobialPayload,
): Promise<MicroAntimicrobial> {
  const res = await masterFetch(`${MICRO_ANTIMICROBIALS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroAntimicrobial;
}

export async function deleteMicroAntimicrobial(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_ANTIMICROBIALS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const MICRO_SUSCEPTIBILITY_METHODS_PATH = "/master/micro_susceptibility_methods";

export async function searchMicroSusceptibilityMethods(params: {
  name?: string;
  source?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MicroSusceptibilityMethod>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.source) search.set("source", params.source);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${MICRO_SUSCEPTIBILITY_METHODS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MicroSusceptibilityMethod>;
}

export async function createMicroSusceptibilityMethod(
  payload: MicroSusceptibilityMethodPayload,
): Promise<MicroSusceptibilityMethod> {
  const res = await masterFetch(MICRO_SUSCEPTIBILITY_METHODS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroSusceptibilityMethod;
}

export async function updateMicroSusceptibilityMethod(
  id: number,
  payload: MicroSusceptibilityMethodPayload,
): Promise<MicroSusceptibilityMethod> {
  const res = await masterFetch(`${MICRO_SUSCEPTIBILITY_METHODS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MicroSusceptibilityMethod;
}

export async function deleteMicroSusceptibilityMethod(id: number): Promise<void> {
  const res = await masterFetch(`${MICRO_SUSCEPTIBILITY_METHODS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// レセプト電算コードの一括照会。細菌検査オーダーの「処方から取り込み」が、
// 処方中の薬剤が抗菌薬(薬効分類 61x/622/624)かどうかを判定するために使う。
export async function fetchMedicinesByCodes(
  codes: string[],
): Promise<MasterSearchResult<Medicine>> {
  const search = new URLSearchParams();
  for (const code of codes) search.append("medicine_code[]", code);
  search.set("per", "100");

  const res = await masterFetch(`/master/medicines?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Medicine>;
}
