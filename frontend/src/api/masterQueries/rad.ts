import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkCreateRadItemsFromFrequent,
  createRadItem,
  createRadJj1017Code,
  createRadMaterial,
  createRadSetItem,
  deleteRadItem,
  deleteRadJj1017Code,
  deleteRadMaterial,
  deleteRadSetItem,
  fetchRadItem,
  fetchRadJj1017Catalog,
  fetchRadJj1017Elements,
  fetchRadMaterial,
  type MasterSearchResult,
  radDatasetClient,
  radItemLayoutClient,
  type RadItemPayload,
  type RadItemSearchResult,
  type RadJj1017CodePayload,
  type RadMaterialPayload,
  type RadSetItem,
  type RadSetItemPayload,
  searchRadFrequentCodes,
  searchRadItems,
  searchRadJj1017Codes,
  searchRadMaterials,
  searchRadSetItems,
  updateRadItem,
  updateRadJj1017Code,
  updateRadMaterial,
} from "../masterClient";
import { itemLayoutHooks } from "./itemLayout";
import { performDatasetHooks } from "./performDataset";

// 放射線検査オーダーのマスタ群 ----------------------------------------------

// オーダー項目・セット構成は同じ詳細画面で同時に変わるのでまとめて破棄する。
const RAD_JJ1017_CODES_KEY = ["master", "rad_jj1017_codes"];
const RAD_FREQUENT_CODES_KEY = ["master", "rad_frequent_codes"];
const RAD_ITEMS_KEY = ["master", "rad_items"];

const RAD_MATERIALS_KEY = ["master", "rad_materials"];

export interface RadMaterialFilters {
  name?: string;
  maker?: string;
  /** 紐付けのないものだけ(算定できない器材の点検用)。 */
  unlinked?: boolean;
  active?: boolean;
}

/** 放射線検査で使う器材(施設マスタ)の検索。 */
export function useRadMaterialSearch(filters: RadMaterialFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_MATERIALS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadMaterials({
        name: filters.name || undefined,
        maker: filters.maker || undefined,
        unlinked: filters.unlinked || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 編集モーダル用の詳細。器材コードでも id でも引ける。 */
export function useRadMaterial(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...RAD_MATERIALS_KEY, "detail", idOrCode],
    queryFn: () => fetchRadMaterial(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useRadMaterialMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_MATERIALS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadMaterialPayload) => createRadMaterial(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadMaterialPayload }) =>
        updateRadMaterial(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadMaterial(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。

export const radDatasetHooks = performDatasetHooks({
  name: "rad_datasets",
  client: radDatasetClient,
  itemsKey: RAD_ITEMS_KEY,
  searchItemsByCodes: (codes, per) => searchRadItems({ item_code: codes.join(","), per }),
});

export interface RadJj1017CodeFilters {
  element?: string;
  source?: string;
  name?: string;
}

export function useRadJj1017CodeSearch(filters: RadJj1017CodeFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "list", filters, page],
    queryFn: () =>
      searchRadJj1017Codes({
        element: filters.element || undefined,
        source: filters.source || undefined,
        name: filters.name || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 要素の定義(32桁コード内の位置・桁数・施設拡張の範囲)。滅多に変わらないので
// 拡張コードの登録で破棄されるまで使い回す。
export function useRadJj1017Elements() {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "elements"],
    queryFn: fetchRadJj1017Elements,
    staleTime: Infinity,
  });
}

// 全要素の部品コード(要素名でまとめたもの)。編集モーダルは11要素すべての
// 選択肢を同時に使うので、要素ごとに引かずまとめて取る。
// 拡張コードの登録・削除で破棄されるまで使い回す。
export function useRadJj1017Catalog() {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "catalog"],
    queryFn: fetchRadJj1017Catalog,
    staleTime: Infinity,
  });
}

export function useRadJj1017CodeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_JJ1017_CODES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadJj1017CodePayload) => createRadJj1017Code(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadJj1017CodePayload }) =>
        updateRadJj1017Code(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadJj1017Code(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface RadFrequentCodeFilters {
  category?: string;
  modalityCode?: string;
  name?: string;
  unregisteredOnly?: boolean;
}

export function useRadFrequentCodeSearch(
  filters: RadFrequentCodeFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...RAD_FREQUENT_CODES_KEY, "list", filters, page],
    queryFn: () =>
      searchRadFrequentCodes({
        category: filters.category || undefined,
        modality_code: filters.modalityCode || undefined,
        name: filters.name || undefined,
        unregistered: filters.unregisteredOnly || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export interface RadItemFilters {
  name?: string;
  /** 名称・種別(モダリティ)・部位をまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  modalityCode?: string;
  bodyPartCode?: string;
  active?: boolean;
}

export function useRadItemSearch(filters: RadItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadItems({
        name: filters.name || undefined,
        keyword: filters.keyword || undefined,
        kind: filters.kind || undefined,
        groupable: filters.groupable || undefined,
        modality_code: filters.modalityCode || undefined,
        body_part_code: filters.bodyPartCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 要素の名称とセット構成を添えた詳細(編集モーダル用)。
export function useRadItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchRadItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useRadItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });
    // 頻用コード一覧は「未登録のみ」で絞れるため、項目が増減したら引き直す。
    queryClient.invalidateQueries({ queryKey: RAD_FREQUENT_CODES_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: RadItemPayload) => createRadItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadItemPayload }) =>
        updateRadItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
    bulkCreateFromFrequent: useMutation({
      mutationFn: (frequentCodeIds: number[]) => bulkCreateRadItemsFromFrequent(frequentCodeIds),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useRadSetItemMutations() {
  const queryClient = useQueryClient();
  // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadSetItemPayload) => createRadSetItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadSetItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export const radItemLayoutHooks = itemLayoutHooks("rad_item_layouts", radItemLayoutClient);

// 放射線オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・JJ1017 の要素)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
// 検索APIが要素コードの名称(elements)も添えて返すので、種別・部位の名称も同時に揃う。
export function useRadItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchRadItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toSetMemberMap(result: MasterSearchResult<RadSetItem>): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const member of result.items) {
    const list = members.get(member.set_item_code);
    if (list) list.push(member.member_item_code);
    else members.set(member.set_item_code, [member.member_item_code]);
  }
  return members;
}

// セットの構成。「セットコード → 構成項目の項目コード」で返す。
// オーダー画面でセットを選んだときに、その構成項目もオーダーに入れるために引く。
// セットでない項目コードを混ぜても結果が増えないだけなので、呼ぶ側で選別しない。
export function useRadSetMembers(setCodes: string[]) {
  const sorted = Array.from(new Set(setCodes)).sort();

  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "set_members", sorted],
    queryFn: () => searchRadSetItems({ set_item_code: sorted.join(","), per: 500 }),
    select: toSetMemberMap,
    enabled: sorted.length > 0,
  });
}

/** 一覧APIが添えてくる要素コードの名称から、1 つ引く。 */
export function elementName(
  result: RadItemSearchResult | undefined,
  element: string,
  code: string | null | undefined,
): string {
  if (!code) return "";
  return result?.elements?.[element]?.[code] ?? "";
}
