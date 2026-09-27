import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 術式マスタ(手術オーダー) ----
//
// 処置と違いセット・伝票レイアウト・実施入力データセットは持たず(術式は検索で
// 選び、実施入力は第2段階)、代わりに申込フォームの初期値になる既定値列を持つ。

/**
 * 術式の種別(分類)。医科点数表 第2章第10部 手術 第1節の「款 → 区分」のように
 * 入れ子になるので、parent_code の自己参照で木を作る(最上位は parent_code = null)。
 * 生理検査の PhysioExamType に当たる分類軸だが、あちらは 1 段しかない。
 */
export interface SurgeryCategory {
  id: number;
  category_code: string;
  name: string;
  name_kana: string | null;
  /** 親分類の category_code。null は最上位。 */
  parent_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  /** 同じ親の中での並び順。 */
  display_order: number | null;
  note: string | null;
}

export interface SurgeryCategoryPayload {
  category_code?: string;
  name?: string;
  name_kana?: string | null;
  parent_code?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const SURGERY_CATEGORIES_PATH = "/master/surgery_categories";

export async function searchSurgeryCategories(params: {
  name?: string;
  /** 分類コード。カンマ区切りで複数指定できる。 */
  category_code?: string;
  /** true なら今日使える分類(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<SurgeryCategory>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category_code) search.set("category_code", params.category_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${SURGERY_CATEGORIES_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<SurgeryCategory>;
}

export async function createSurgeryCategory(
  payload: SurgeryCategoryPayload,
): Promise<SurgeryCategory> {
  const res = await masterFetch(SURGERY_CATEGORIES_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryCategory;
}

export async function updateSurgeryCategory(
  id: number,
  payload: SurgeryCategoryPayload,
): Promise<SurgeryCategory> {
  const res = await masterFetch(`${SURGERY_CATEGORIES_PATH}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryCategory;
}

export async function deleteSurgeryCategory(id: number): Promise<void> {
  const res = await masterFetch(`${SURGERY_CATEGORIES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export interface SurgeryItem {
  id: number;
  item_code: string;
  name: string;
  short_name: string | null;
  name_kana: string | null;
  valid_from: string | null;
  valid_to: string | null;
  /** レセ電算 診療行為コード(K章)。会計・DPC連携用。 */
  receipt_code: string | null;
  /** 種別(master_surgery_categories.category_code)。未分類なら null。 */
  category_code: string | null;
  /** 予定所要時間の既定(分)。 */
  default_duration_minutes: number | null;
  /** 到達法の既定(surgery-approach のコード)。 */
  default_approach: string | null;
  /** 手術体位の既定(surgery-position のコード)。 */
  default_position: string | null;
  /** 麻酔方法の既定(surgery-anesthesia-method のコード)。複数可なのでカンマ区切り。 */
  default_anesthesia_methods: string | null;
  /**
   * 申込時に左右の選択を必須にするか。左右のある術式(鼠径ヘルニア・人工関節置換 など)
   * だけ true にする。左右の無い臓器まで必須にすると「指定なし」を選ぶ手数が増えるため。
   */
  requires_laterality: boolean;
  /**
   * 術前指示の既定テンプレート(Questionnaire の canonical "<url>|<version>")。
   * 申込画面はこれを最初から選んだ状態でテンプレート記入を開く。id ではなく
   * canonical で持つのは、テンプレートを作り直しても指し先が変わらないため。
   */
  preop_template_canonical: string | null;
  display_order: number | null;
  note: string | null;
  /** レセ電算コードから解決した医科診療行為の名称。一覧・詳細APIが添える。 */
  receipt_procedure_name?: string | null;
}

export interface SurgeryItemPayload {
  item_code?: string;
  name?: string;
  short_name?: string | null;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  receipt_code?: string | null;
  category_code?: string | null;
  default_duration_minutes?: number | null;
  default_approach?: string | null;
  default_position?: string | null;
  default_anesthesia_methods?: string | null;
  requires_laterality?: boolean;
  preop_template_canonical?: string | null;
  display_order?: number | null;
  note?: string | null;
}

const SURGERY_ITEMS_PATH = "/master/surgery_items";

export async function searchSurgeryItems(params: {
  name?: string;
  /** 名称・略称・カナを1つの語でまとめて探す(オーダー画面の検索欄用)。 */
  keyword?: string;
  /** 項目コード。カンマ区切りで複数指定できる。 */
  item_code?: string;
  /** 種別。上位の分類を指定すると配下の分類の術式もまとめて返る。 */
  category_code?: string;
  /** true なら今日オーダーできる項目(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<SurgeryItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.keyword) search.set("keyword", params.keyword);
  if (params.item_code) search.set("item_code", params.item_code);
  if (params.category_code) search.set("category_code", params.category_code);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${SURGERY_ITEMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<SurgeryItem>;
}

export async function fetchSurgeryItem(idOrCode: string | number): Promise<SurgeryItem> {
  const res = await masterFetch(`${SURGERY_ITEMS_PATH}/${encodeURIComponent(String(idOrCode))}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryItem;
}

export async function createSurgeryItem(payload: SurgeryItemPayload): Promise<SurgeryItem> {
  const res = await masterFetch(SURGERY_ITEMS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryItem;
}

export async function updateSurgeryItem(id: number, payload: SurgeryItemPayload): Promise<SurgeryItem> {
  const res = await masterFetch(`${SURGERY_ITEMS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryItem;
}

export async function deleteSurgeryItem(id: number): Promise<void> {
  const res = await masterFetch(`${SURGERY_ITEMS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// ---- 手術室のブロックスケジュール ----
//
// 曜日ごとの科割り当て(「月曜の第1手術室 午前は外科」)。手術は予約枠(Slot)を
// 持たない設計なので、FHIR の Schedule ではなく backend のマスタに置いている
// (docs/surgery-calendar-design.md)。

/** 手術室 × 曜日 × 時間帯 に診療科を割り当てた 1 行。 */
export interface SurgeryRoomBlock {
  id: number;
  /** 手術室(FHIR Location 種別 SU)の id。 */
  location_id: string;
  location_name: string | null;
  /** 0=日 … 6=土。Date#getDay と同じ並び。 */
  weekday: number;
  /** "09:00" 形式。 */
  start_time: string;
  end_time: string;
  /** SS-MIX2 統一診療科コード。 */
  department_code: string;
  department_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
}

export interface SurgeryRoomBlockPayload {
  location_id?: string;
  location_name?: string | null;
  weekday?: number;
  start_time?: string;
  end_time?: string;
  department_code?: string;
  department_name?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  note?: string | null;
}

const SURGERY_ROOM_BLOCKS_PATH = "/master/surgery_room_blocks";

export async function searchSurgeryRoomBlocks(params: {
  /** 手術室。カンマ区切りで複数指定できる。 */
  location_id?: string;
  weekday?: number;
  department_code?: string;
  /** true なら有効期間内の割り当てだけ。date を添えるとその日で判定する。 */
  active?: boolean;
  date?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<SurgeryRoomBlock>> {
  const search = new URLSearchParams();
  if (params.location_id) search.set("location_id", params.location_id);
  if (params.weekday != null) search.set("weekday", String(params.weekday));
  if (params.department_code) search.set("department_code", params.department_code);
  if (params.active) search.set("active", "true");
  if (params.date) search.set("date", params.date);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${SURGERY_ROOM_BLOCKS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<SurgeryRoomBlock>;
}

/**
 * 全件。カレンダーの背景と申込フォームの警告は「その部屋のその曜日」を必ず
 * 引き当てられないと嘘になるので、ページを最後まで読む。
 * 1 ページの上限が 100 件(BaseController#pagination_params)なのに対し、
 * 手術室 × 曜日 × 時間帯 は部屋が増えるとすぐ 100 を超える。
 */
export async function fetchAllSurgeryRoomBlocks(params: {
  active?: boolean;
  date?: string;
} = {}): Promise<SurgeryRoomBlock[]> {
  const per = 100;
  const items: SurgeryRoomBlock[] = [];
  for (let page = 1; ; page += 1) {
    const result = await searchSurgeryRoomBlocks({ ...params, page, per });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
  }
}

export async function createSurgeryRoomBlock(
  payload: SurgeryRoomBlockPayload,
): Promise<SurgeryRoomBlock> {
  const res = await masterFetch(SURGERY_ROOM_BLOCKS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryRoomBlock;
}

export async function updateSurgeryRoomBlock(
  id: number,
  payload: SurgeryRoomBlockPayload,
): Promise<SurgeryRoomBlock> {
  const res = await masterFetch(`${SURGERY_ROOM_BLOCKS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SurgeryRoomBlock;
}

export async function deleteSurgeryRoomBlock(id: number): Promise<void> {
  const res = await masterFetch(`${SURGERY_ROOM_BLOCKS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
