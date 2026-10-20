import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 実施入力用データセット。放射線・生理・内視鏡・処置で同じ形。
// 実施入力で登録する手技料・薬剤・器材の組み合わせに名前を付けたもので、オーダー項目に
// 紐付けておくと実施入力モーダルの初期明細になる。
export interface PerformDataset {
  id: number;
  dataset_code: string;
  name: string;
  name_kana: string | null;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number | null;
  note: string | null;
}

/** データセット明細の種別。参照先マスタが決まる。 */
export type PerformDatasetDetailType = "procedure" | "medicine" | "material";

export interface PerformDatasetDetail {
  id: number;
  dataset_code: string;
  detail_type: PerformDatasetDetailType;
  /**
   * 参照先マスタのコード(診療行為コード / 医薬品コード / 器材コード)。
   * 器材は放射線だけ施設内の器材コードで、ほかの部門は施設内マスタを挟まないので
   * これがそのまま算定用の特定保険医療材料コードになる。
   */
  code: string;
  /** 実施入力に初期表示する数量。薬剤は使用量、器材は本数など。手技は空。 */
  default_quantity: string | null;
  /** 薬剤の既定の投与経路(JP Core の route-codes)。 */
  route_code: string | null;
  /** 実施入力を開いたときに最初から並べるか。false は使ったときだけ検索して足す。 */
  default_selected: boolean;
  display_order: number | null;
  /** 参照先マスタから解決した名称。未取込・削除済みなら null。 */
  resolved_name: string | null;
  resolved_unit_name: string | null;
  /** 薬剤の個別医薬品コード(YJコード)。処方・注射と揃えるために添える。 */
  yj_code: string | null;
}

export interface PerformDatasetWithDetails<D extends PerformDatasetDetail = PerformDatasetDetail>
  extends PerformDataset {
  details: D[];
}

export interface PerformDatasetPayload {
  dataset_code?: string;
  name?: string;
  name_kana?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  display_order?: number | null;
  note?: string | null;
}

export interface PerformDatasetDetailPayload {
  dataset_code?: string;
  detail_type?: PerformDatasetDetailType;
  code?: string;
  default_quantity?: string | null;
  route_code?: string | null;
  default_selected?: boolean;
  display_order?: number | null;
}

export interface PerformDatasetSearchParams {
  name?: string;
  /** データセットコード。カンマ区切りで複数指定できる。 */
  dataset_code?: string;
  /** true なら今日使えるデータセット(有効期間内)だけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}

export interface PerformDatasetDetailSearchParams {
  /** データセットコード。カンマ区切りで複数指定できる(実施入力が一括で引く)。 */
  dataset_code?: string;
  detail_type?: PerformDatasetDetailType;
  page?: number;
  per?: number;
}

export function performDatasetClient<D extends PerformDatasetDetail>(datasetsPath: string, detailsPath: string) {
  async function get<T>(url: string): Promise<T> {
    const res = await masterFetch(url);
    if (!res.ok) throw await buildError(res);
    return (await res.json()) as T;
  }

  async function send<T>(url: string, method: string, payload: unknown): Promise<T> {
    const res = await masterFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await buildError(res);
    return (await res.json()) as T;
  }

  async function remove(url: string): Promise<void> {
    const res = await masterFetch(url, { method: "DELETE" });
    if (!res.ok) throw await buildError(res);
  }

  return {
    search(params: PerformDatasetSearchParams): Promise<MasterSearchResult<PerformDataset>> {
      const search = new URLSearchParams();
      if (params.name) search.set("name", params.name);
      if (params.dataset_code) search.set("dataset_code", params.dataset_code);
      if (params.active) search.set("active", "true");
      if (params.page) search.set("page", String(params.page));
      if (params.per) search.set("per", String(params.per));
      return get(`${datasetsPath}?${search.toString()}`);
    },
    // 明細を名称付きで添えた詳細。データセットコードでも id でも引ける。
    fetch: (idOrCode: string | number) =>
      get<PerformDatasetWithDetails<D>>(`${datasetsPath}/${encodeURIComponent(String(idOrCode))}`),
    create: (payload: PerformDatasetPayload) => send<PerformDataset>(datasetsPath, "POST", payload),
    update: (id: number, payload: PerformDatasetPayload) =>
      send<PerformDataset>(`${datasetsPath}/${id}`, "PATCH", payload),
    remove: (id: number) => remove(`${datasetsPath}/${id}`),
    searchDetails(params: PerformDatasetDetailSearchParams): Promise<MasterSearchResult<D>> {
      const search = new URLSearchParams();
      if (params.dataset_code) search.set("dataset_code", params.dataset_code);
      if (params.detail_type) search.set("detail_type", params.detail_type);
      if (params.page) search.set("page", String(params.page));
      if (params.per) search.set("per", String(params.per));
      return get(`${detailsPath}?${search.toString()}`);
    },
    createDetail: (payload: PerformDatasetDetailPayload) => send<D>(detailsPath, "POST", payload),
    updateDetail: (id: number, payload: PerformDatasetDetailPayload) =>
      send<D>(`${detailsPath}/${id}`, "PATCH", payload),
    removeDetail: (id: number) => remove(`${detailsPath}/${id}`),
  };
}

export type PerformDatasetClient<D extends PerformDatasetDetail> = ReturnType<typeof performDatasetClient<D>>;
