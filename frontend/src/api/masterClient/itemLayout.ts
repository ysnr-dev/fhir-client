import { buildError, masterFetch, type MasterSearchResult } from "./core";

// オーダーレイアウト(伝票のようなグリッド)。検体検査・放射線・生理・内視鏡・処置で同じ形。
// グリッドの大きさを持ち、1マスの中身は ItemLayoutCell が持つ。
export interface ItemLayout {
  id: number;
  name: string;
  row_count: number;
  column_count: number;
  display_order: number | null;
  active: boolean;
  note: string | null;
}

// レイアウトの1マス。item=オーダー項目 / label=表示専用の文言。
// 項目コードの列名は部門のオーダー項目マスタに合わせる(K: 検体検査は order_item_code、ほかは item_code)。
// item_name 以降は詳細APIがオーダー項目から付与する。
export type ItemLayoutCell<K extends string> = {
  id: number;
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type: string;
  // item: 伝票上の表示名(空ならオーダー項目名) / label: 表示文言
  display_name: string | null;
  item_name?: string | null;
  item_short_name?: string | null;
  item_kind?: string | null;
} & { [P in K]: string | null };

export interface ItemLayoutDetail<K extends string> extends ItemLayout {
  cells: ItemLayoutCell<K>[];
  // 行数・列数を縮めたとき、範囲外で片付けられたセルの数(update の応答のみ)。
  removed_cells?: number;
}

export interface ItemLayoutPayload {
  name?: string;
  row_count?: number;
  column_count?: number;
  display_order?: number | null;
  active?: boolean;
  note?: string | null;
}

export interface ItemLayoutCellPayload {
  layout_id: number;
  grid_row: number;
  grid_column: number;
  cell_type?: string;
  // item のオーダー項目コード。送るときに部門の列名(codeKey)に置き換える。
  code?: string | null;
  display_name?: string | null;
}

export function itemLayoutClient<K extends string>(codeKey: K, layoutsPath: string, cellsPath: string) {
  function cellBody({ code, ...rest }: Partial<ItemLayoutCellPayload>) {
    return code === undefined ? rest : { ...rest, [codeKey]: code };
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
    codeKey,
    async fetchLayouts(): Promise<MasterSearchResult<ItemLayout>> {
      const res = await masterFetch(`${layoutsPath}?per=100`);
      if (!res.ok) throw await buildError(res);
      return (await res.json()) as MasterSearchResult<ItemLayout>;
    },
    async fetchLayout(id: number): Promise<ItemLayoutDetail<K>> {
      const res = await masterFetch(`${layoutsPath}/${id}`);
      if (!res.ok) throw await buildError(res);
      return (await res.json()) as ItemLayoutDetail<K>;
    },
    createLayout: (payload: ItemLayoutPayload) => send<ItemLayout>(layoutsPath, "POST", payload),
    updateLayout: (id: number, payload: ItemLayoutPayload) =>
      send<ItemLayoutDetail<K>>(`${layoutsPath}/${id}`, "PATCH", payload),
    deleteLayout: (id: number) => remove(`${layoutsPath}/${id}`),
    createCell: (payload: ItemLayoutCellPayload) =>
      send<ItemLayoutCell<K>>(cellsPath, "POST", cellBody(payload)),
    updateCell: (id: number, payload: Partial<ItemLayoutCellPayload>) =>
      send<ItemLayoutCell<K>>(`${cellsPath}/${id}`, "PATCH", cellBody(payload)),
    deleteCell: (id: number) => remove(`${cellsPath}/${id}`),
  };
}

export type ItemLayoutClient<K extends string> = ReturnType<typeof itemLayoutClient<K>>;
